import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  createHistory,
  diffResolutions,
  pushTransaction,
  redoTransaction,
  undoTransaction,
  type DecisionHistory,
} from './history';
import type { Resolutions } from './threeWayMerge';

/** 连续提交若干事务（每个事务一组变更） */
function pushAll(history: DecisionHistory, ...allChanges: Parameters<typeof pushTransaction>[1][]) {
  return allChanges.reduce((h, changes) => pushTransaction(h, changes), history);
}

describe('diffResolutions', () => {
  it('识别新增与改选，忽略值相同（深比较）的项', () => {
    const prev: Resolutions = {
      c0: { kind: 'ours' },
      c1: { kind: 'custom', value: { a: 1, b: [2] } },
      c2: { kind: 'theirs' },
    };
    const next: Resolutions = {
      c0: { kind: 'ours' }, // 未变
      c1: { kind: 'custom', value: { b: [2], a: 1 } }, // 键序不同但值相同，未变
      c2: { kind: 'ours' }, // 改选
      c3: { kind: 'theirs' }, // 新增
    };
    expect(diffResolutions(prev, next)).toEqual([
      { conflictId: 'c2', before: { kind: 'theirs' }, after: { kind: 'ours' } },
      { conflictId: 'c3', before: undefined, after: { kind: 'theirs' } },
    ]);
  });

  it('前后完全一致时返回空数组', () => {
    const prev: Resolutions = { c0: { kind: 'custom', value: [1, { x: 'y' }] } };
    const next: Resolutions = { c0: { kind: 'custom', value: [1, { x: 'y' }] } };
    expect(diffResolutions(prev, next)).toEqual([]);
  });
});

describe('决策历史事务', () => {
  it('提交事务后可撤销、撤销后可重做，空变更不产生记录', () => {
    let h = createHistory();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);

    // 空变更（决策未实际改变任何选择）不记录
    h = pushTransaction(h, []);
    expect(canUndo(h)).toBe(false);

    h = pushTransaction(h, [{ conflictId: 'c0', before: undefined, after: { kind: 'ours' } }]);
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);

    const undone = undoTransaction(h, { c0: { kind: 'ours' } })!;
    expect(undone.resolutions).toEqual({});
    expect(canUndo(undone.history)).toBe(false);
    expect(canRedo(undone.history)).toBe(true);

    const redone = redoTransaction(undone.history, undone.resolutions)!;
    expect(redone.resolutions).toEqual({ c0: { kind: 'ours' } });
    expect(canUndo(redone.history)).toBe(true);
    expect(canRedo(redone.history)).toBe(false);
  });

  it('一次批量应用的多条变更作为一个事务整体撤销 / 重做', () => {
    const batchChanges = [
      { conflictId: 'c0', before: undefined, after: { kind: 'ours' } as const },
      { conflictId: 'c1', before: undefined, after: { kind: 'theirs' } as const },
      { conflictId: 'c2', before: { kind: 'ours' } as const, after: { kind: 'theirs' } as const },
    ];
    const h = pushAll(createHistory(), batchChanges);
    const current: Resolutions = {
      c0: { kind: 'ours' },
      c1: { kind: 'theirs' },
      c2: { kind: 'theirs' },
    };

    // 一次撤销同步恢复该批次全部冲突（c2 恢复事务前的改选）
    const undone = undoTransaction(h, current)!;
    expect(undone.resolutions).toEqual({ c2: { kind: 'ours' } });

    // 一次重做同步重放全部变更
    const redone = redoTransaction(undone.history, undone.resolutions)!;
    expect(redone.resolutions).toEqual(current);
  });

  it('多个事务按后进先出顺序撤销', () => {
    const h = pushAll(
      createHistory(),
      [{ conflictId: 'c0', before: undefined, after: { kind: 'ours' } }],
      [{ conflictId: 'c1', before: undefined, after: { kind: 'theirs' } }],
    );
    let current: Resolutions = { c0: { kind: 'ours' }, c1: { kind: 'theirs' } };

    const first = undoTransaction(h, current)!;
    expect(first.resolutions).toEqual({ c0: { kind: 'ours' } });
    const second = undoTransaction(first.history, first.resolutions)!;
    expect(second.resolutions).toEqual({});
    expect(undoTransaction(second.history, second.resolutions)).toBeNull();
    current = second.resolutions;
    expect(current).toEqual({});
  });

  it('撤销后产生新决策会清空重做分支', () => {
    let h = pushAll(
      createHistory(),
      [{ conflictId: 'c0', before: undefined, after: { kind: 'ours' } }],
    );
    const undone = undoTransaction(h, { c0: { kind: 'ours' } })!;
    expect(canRedo(undone.history)).toBe(true);

    // 撤销后提交新决策：重做分支被清空
    h = pushTransaction(undone.history, [
      { conflictId: 'c1', before: undefined, after: { kind: 'theirs' } },
    ]);
    expect(canRedo(h)).toBe(false);
    expect(redoTransaction(h, { c1: { kind: 'theirs' } })).toBeNull();
    // 原事务仍留在 past 中，可继续撤销新决策
    expect(canUndo(h)).toBe(true);
  });

  it('无可撤销 / 可重做记录时返回 null', () => {
    const h = createHistory();
    expect(undoTransaction(h, {})).toBeNull();
    expect(redoTransaction(h, {})).toBeNull();
  });

  it('历史操作不修改原历史与选择对象（不可变）', () => {
    const h = pushAll(createHistory(), [
      { conflictId: 'c0', before: undefined, after: { kind: 'ours' } },
    ]);
    const current: Resolutions = { c0: { kind: 'ours' } };
    const undone = undoTransaction(h, current)!;
    expect(h.past).toHaveLength(1);
    expect(current).toEqual({ c0: { kind: 'ours' } });
    expect(undone.resolutions).not.toBe(current);
  });
});
