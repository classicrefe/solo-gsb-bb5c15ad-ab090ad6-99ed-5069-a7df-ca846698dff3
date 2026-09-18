import { deepEqual } from './deepEqual';
import type { Resolution, Resolutions } from './threeWayMerge';

/**
 * 决策撤销 / 重做历史。
 *
 * 事务模型：
 * - 一次手动「采用当前 / 目标分支」或提交自定义值 = 一个事务（单条变更）；
 * - 一次批量规则应用 = 一个事务（该批次涉及的全部冲突作为多条变更整体记录，
 *   撤销 / 重做时同步恢复）；
 * - 撤销后再产生新决策会清空重做分支；
 * - 快照恢复的结果不进入历史，作为不可撤销的初始状态（历史从空开始）。
 */

/** 一条变更：某个冲突在事务前后的选择（undefined 表示该侧未选择） */
export interface ResolutionChange {
  conflictId: string;
  /** 事务前的选择（undefined 表示此前未选择） */
  before: Resolution | undefined;
  /** 事务后的选择（undefined 表示事务取消了选择；当前流程不会产生） */
  after: Resolution | undefined;
}

/** 一次决策事务 */
export interface DecisionTransaction {
  changes: ResolutionChange[];
}

/** 决策历史：past 顶为最近事务，future 顶为最近撤销（可重做）的事务 */
export interface DecisionHistory {
  past: DecisionTransaction[];
  future: DecisionTransaction[];
}

/** 空历史（初始状态，快照恢复后也从空开始） */
export function createHistory(): DecisionHistory {
  return { past: [], future: [] };
}

export function canUndo(history: DecisionHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: DecisionHistory): boolean {
  return history.future.length > 0;
}

/**
 * 比较一次决策前后的两份选择，生成事务的变更列表。
 * 值相同（键序无关深比较）的项不产生变更；无实际变化时返回空数组。
 */
export function diffResolutions(prev: Resolutions, next: Resolutions): ResolutionChange[] {
  const changes: ResolutionChange[] = [];
  const ids = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const id of ids) {
    const before = prev[id];
    const after = next[id];
    if (before === undefined && after === undefined) continue;
    if (before !== undefined && after !== undefined && deepEqual(before, after)) continue;
    changes.push({ conflictId: id, before, after });
  }
  return changes;
}

/**
 * 提交一个新事务：追加到 past 并清空重做分支。
 * 空变更列表（决策未实际改变任何选择）不产生记录，历史原样返回。
 */
export function pushTransaction(
  history: DecisionHistory,
  changes: ResolutionChange[],
): DecisionHistory {
  if (changes.length === 0) return history;
  return { past: [...history.past, { changes }], future: [] };
}

/** 把一组变更的 before / after 应用到选择上（返回新对象，不修改入参） */
function applyChanges(
  resolutions: Resolutions,
  changes: ResolutionChange[],
  side: 'before' | 'after',
): Resolutions {
  const next: Resolutions = { ...resolutions };
  for (const change of changes) {
    const value = change[side];
    if (value === undefined) delete next[change.conflictId];
    else next[change.conflictId] = value;
  }
  return next;
}

export interface HistoryStep {
  history: DecisionHistory;
  resolutions: Resolutions;
}

/** 撤销最近一个事务，恢复该事务涉及的全部冲突；无可撤销记录时返回 null */
export function undoTransaction(
  history: DecisionHistory,
  resolutions: Resolutions,
): HistoryStep | null {
  const tx = history.past[history.past.length - 1];
  if (!tx) return null;
  return {
    history: { past: history.past.slice(0, -1), future: [...history.future, tx] },
    resolutions: applyChanges(resolutions, tx.changes, 'before'),
  };
}

/** 重做最近撤销的一个事务，重放该事务涉及的全部冲突；无可重做记录时返回 null */
export function redoTransaction(
  history: DecisionHistory,
  resolutions: Resolutions,
): HistoryStep | null {
  const tx = history.future[history.future.length - 1];
  if (!tx) return null;
  return {
    history: { past: [...history.past, tx], future: history.future.slice(0, -1) },
    resolutions: applyChanges(resolutions, tx.changes, 'after'),
  };
}
