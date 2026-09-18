// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import App from './App';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 未实现 scrollIntoView（合并树定位冲突时会调用）
Element.prototype.scrollIntoView = function scrollIntoView() {};

// jsdom 的 File 未实现 .text()（快照导入依赖），用 FileReader 补齐
if (typeof File.prototype.text !== 'function') {
  File.prototype.text = function text(this: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

function makeRenderer(container: HTMLElement) {
  const root = createRoot(container);
  return (node: ReactElement) => act(() => root.render(node));
}

const h = (container: HTMLElement, sel: string) => container.querySelector(sel);
const all = (container: HTMLElement, sel: string) => [...container.querySelectorAll(sel)];
const btnByText = (container: HTMLElement, text: string) =>
  all(container, 'button').find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

const BASE = { a: 1, b: 2, c: 3 };
const OURS = { a: 10, b: 2, c: 30 };
const THEIRS = { a: 20, b: 2, c: 40 };
// 冲突：/a（1→10 vs 1→20）、/c（3→30 vs 3→40）

/** React 受控组件需要用原生 setter 赋值后再派发 input 事件 */
function typeIntoTextarea(ta: HTMLTextAreaElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(ta, v);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function typeIntoInput(input: HTMLInputElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, v);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 从输入页开始：填入三份 JSON 并进入冲突处理页 */
function setup() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  makeRenderer(container)(<App />);

  const panels = all(container, '.input-panel textarea') as HTMLTextAreaElement[];
  act(() => typeIntoTextarea(panels[0], JSON.stringify(BASE)));
  act(() => typeIntoTextarea(panels[1], JSON.stringify(OURS)));
  act(() => typeIntoTextarea(panels[2], JSON.stringify(THEIRS)));
  act(() => btnByText(container, '开始合并')!.click());

  expect(h(container, '.progress-line')?.textContent).toContain('已解决 0 / 2');
  return { container };
}

const progressText = (container: HTMLElement) => h(container, '.progress-line')?.textContent ?? '';
const undoBtn = (container: HTMLElement) => btnByText(container, '撤销')!;
const redoBtn = (container: HTMLElement) => btnByText(container, '重做')!;

function pressUndoRedoKey(target: Window | HTMLElement, opts: { shift?: boolean; meta?: boolean }) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: opts.shift ? 'Z' : 'z',
      ctrlKey: !opts.meta,
      metaKey: !!opts.meta,
      shiftKey: !!opts.shift,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe('决策撤销 / 重做', () => {
  it('手动选择记为一个事务：按钮撤销 / 重做，无记录时按钮禁用', () => {
    const { container } = setup();

    // 初始无记录：两个按钮均禁用
    expect(undoBtn(container).disabled).toBe(true);
    expect(redoBtn(container).disabled).toBe(true);

    // 采用当前分支 → 记为一个事务
    act(() => btnByText(container, '采用当前分支')!.click());
    expect(progressText(container)).toContain('已解决 1 / 2');
    expect(undoBtn(container).disabled).toBe(false);

    // 撤销 → 回到未解决；重做 → 恢复选择
    act(() => undoBtn(container).click());
    expect(progressText(container)).toContain('已解决 0 / 2');
    expect(undoBtn(container).disabled).toBe(true);
    expect(redoBtn(container).disabled).toBe(false);

    act(() => redoBtn(container).click());
    expect(progressText(container)).toContain('已解决 1 / 2');
    expect(redoBtn(container).disabled).toBe(true);
  });

  it('提交自定义值记为一个事务，撤销后恢复未选择', () => {
    const { container } = setup();

    const customArea = h(container, '.custom-resolve textarea') as HTMLTextAreaElement;
    act(() => typeIntoTextarea(customArea, '{"merged": true}'));
    act(() => btnByText(container, '使用自定义值')!.click());
    expect(progressText(container)).toContain('已解决 1 / 2');
    expect(h(container, '.tree-row .badge.resolved')?.textContent).toContain('自定义');

    act(() => undoBtn(container).click());
    expect(progressText(container)).toContain('已解决 0 / 2');
    expect(h(container, '.tree-row .badge.resolved')).toBeNull();
  });

  it('一次批量规则应用整体记为一个事务，撤销 / 重做同步恢复全部冲突', () => {
    const { container } = setup();

    // 一条 /** 规则命中全部 2 个冲突，一次应用
    const pattern = h(container, '.batch-pattern-input') as HTMLInputElement;
    act(() => typeIntoInput(pattern, '/**'));
    act(() => btnByText(container, '应用规则')!.click());
    expect(progressText(container)).toContain('已解决 2 / 2');

    // 一次撤销：整批 2 个冲突同步恢复为未解决
    act(() => undoBtn(container).click());
    expect(progressText(container)).toContain('已解决 0 / 2');
    expect(all(container, '.tree-row .badge.resolved')).toHaveLength(0);

    // 一次重做：整批同步重放
    act(() => redoBtn(container).click());
    expect(progressText(container)).toContain('已解决 2 / 2');
  });

  it('撤销后产生新决策会清空重做分支', () => {
    const { container } = setup();

    act(() => btnByText(container, '采用当前分支')!.click());
    act(() => undoBtn(container).click());
    expect(redoBtn(container).disabled).toBe(false);

    // 撤销后做出新决策：重做分支被清空
    act(() => btnByText(container, '采用目标分支')!.click());
    expect(redoBtn(container).disabled).toBe(true);
    expect(progressText(container)).toContain('已解决 1 / 2');
  });

  it('Ctrl/Cmd+Z 与 Ctrl/Cmd+Shift+Z 快捷键生效，输入框聚焦时不拦截', () => {
    const { container } = setup();

    act(() => btnByText(container, '采用当前分支')!.click());
    expect(progressText(container)).toContain('已解决 1 / 2');

    // Ctrl+Z 撤销
    act(() => pressUndoRedoKey(window, {}));
    expect(progressText(container)).toContain('已解决 0 / 2');

    // Ctrl+Shift+Z 重做
    act(() => pressUndoRedoKey(window, { shift: true }));
    expect(progressText(container)).toContain('已解决 1 / 2');

    // Cmd+Z（macOS）撤销
    act(() => pressUndoRedoKey(window, { meta: true }));
    expect(progressText(container)).toContain('已解决 0 / 2');

    // Cmd+Shift+Z 重做
    act(() => pressUndoRedoKey(window, { meta: true, shift: true }));
    expect(progressText(container)).toContain('已解决 1 / 2');

    // 文本域聚焦时不拦截：原生编辑撤销优先，决策历史不变
    const customArea = h(container, '.custom-resolve textarea') as HTMLTextAreaElement;
    act(() => pressUndoRedoKey(customArea, {}));
    expect(progressText(container)).toContain('已解决 1 / 2');
    expect(redoBtn(container).disabled).toBe(true);

    // 批量规则模式输入框聚焦时同样不拦截
    const pattern = h(container, '.batch-pattern-input') as HTMLInputElement;
    act(() => pressUndoRedoKey(pattern, {}));
    expect(progressText(container)).toContain('已解决 1 / 2');
  });

  it('从输出页返回后历史仍可继续使用', () => {
    const { container } = setup();

    // 解决全部冲突并生成结果
    act(() => btnByText(container, '采用当前分支')!.click());
    act(() => btnByText(container, '采用目标分支')!.click());
    expect(progressText(container)).toContain('已解决 2 / 2');
    act(() => btnByText(container, '生成合并结果')!.click());
    expect(h(container, '.output-panel h3')?.textContent).toContain('合并结果 JSON');

    // 返回冲突处理页：历史保留，仍可撤销
    act(() => btnByText(container, '返回继续调整')!.click());
    expect(progressText(container)).toContain('已解决 2 / 2');
    expect(undoBtn(container).disabled).toBe(false);

    act(() => undoBtn(container).click());
    expect(progressText(container)).toContain('已解决 1 / 2');
    act(() => redoBtn(container).click());
    expect(progressText(container)).toContain('已解决 2 / 2');
  });

  it('快照恢复结果作为不可撤销的初始状态，之后的新决策正常记录', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    makeRenderer(container)(<App />);

    const snapshot = {
      format: 'json-three-way-merge/session',
      version: 1,
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      resolutions: [
        {
          pointer: '/a',
          base: { present: true, value: 1 },
          ours: { present: true, value: 10 },
          theirs: { present: true, value: 20 },
          resolution: { kind: 'ours' },
        },
        {
          pointer: '/c',
          base: { present: true, value: 3 },
          ours: { present: true, value: 30 },
          theirs: { present: true, value: 40 },
          resolution: { kind: 'theirs' },
        },
      ],
    };
    const file = new File([JSON.stringify(snapshot)], 'session.json', { type: 'application/json' });
    const fileInput = h(container, '.input-actions input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // FileReader 完成读取属于宏任务，等待异步导入链路跑完
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 快照恢复 2 项选择，但作为初始状态不可撤销
    expect(progressText(container)).toContain('已解决 2 / 2');
    expect(h(container, '.restore-banner')?.textContent).toContain('恢复 2 项');
    expect(undoBtn(container).disabled).toBe(true);
    expect(redoBtn(container).disabled).toBe(true);

    // 之后的新决策正常记录：改选 /a 为目标分支，撤销后回到快照恢复的状态
    act(() => btnByText(container, '采用目标分支')!.click());
    expect(undoBtn(container).disabled).toBe(false);
    act(() => undoBtn(container).click());
    expect(progressText(container)).toContain('已解决 2 / 2');
    expect(undoBtn(container).disabled).toBe(true);
    // 重做为新决策（而非快照内容）
    act(() => redoBtn(container).click());
    expect(progressText(container)).toContain('已解决 2 / 2');
  });
});
