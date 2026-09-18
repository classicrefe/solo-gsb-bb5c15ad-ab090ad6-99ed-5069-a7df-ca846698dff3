import { useState } from 'react';
import BatchRulesPanel from './BatchRulesPanel';
import ConflictPanel from './ConflictPanel';
import MergeTree from './MergeTree';
import {
  countConflicts,
  type MergeResult,
  type Resolution,
  type Resolutions,
} from '../merge/threeWayMerge';
import { applyBatchRules, type BatchRule } from '../merge/batchRules';
import { createSnapshot, type RestoreSummary } from '../merge/snapshot';
import { downloadText } from '../download';

interface Props {
  mergeResult: MergeResult;
  resolutions: Resolutions;
  onResolutionsChange: (r: Resolutions) => void;
  onFinish: () => void;
  onBack: () => void;
  /** 从快照导入时的恢复汇总（非快照导入时为 null） */
  restoreInfo: RestoreSummary | null;
}

export default function MergeStage({
  mergeResult,
  resolutions,
  onResolutionsChange,
  onFinish,
  onBack,
  restoreInfo,
}: Props) {
  // 初始定位到首个未解决的冲突（快照导入时跳过已恢复的项）
  const [selectedId, setSelectedId] = useState<string | null>(
    () =>
      mergeResult.conflicts.find((c) => !resolutions[c.id])?.id ??
      mergeResult.conflicts[0]?.id ??
      null,
  );
  const [showUnchanged, setShowUnchanged] = useState(true);
  const [showRestoreInfo, setShowRestoreInfo] = useState(true);

  const { total, resolved } = countConflicts(mergeResult.root, resolutions);
  const allResolved = total === resolved;

  const handleResolve = (id: string, res: Resolution) => {
    const next = { ...resolutions, [id]: res };
    onResolutionsChange(next);
    // 自动跳到下一个未解决的冲突
    const nextUnresolved = mergeResult.conflicts.find((c) => c.id !== id && !next[c.id]);
    if (nextUnresolved) setSelectedId(nextUnresolved.id);
  };

  const handleDownloadSnapshot = () => {
    const snapshot = createSnapshot(mergeResult, resolutions);
    downloadText('merge-session-snapshot.json', JSON.stringify(snapshot, null, 2));
  };

  // 批量决策规则：自上而下首条命中，只处理尚未选择的冲突，绝不覆盖已有选择
  const handleApplyBatch = (rules: BatchRule[]) => {
    const result = applyBatchRules(rules, mergeResult.conflicts, resolutions);
    onResolutionsChange(result.resolutions);
    // 应用后定位到第一个仍未解决的冲突，便于继续逐项处理
    const nextUnresolved = mergeResult.conflicts.find((c) => !result.resolutions[c.id]);
    if (nextUnresolved) setSelectedId(nextUnresolved.id);
    return { applied: result.applied, skippedResolved: result.skippedResolved };
  };

  return (
    <>
      <div className="merge-layout">
        <div className="merge-tree-panel">
          <h3>合并树</h3>
          <div className="tree-toolbar">
            <label>
              <input
                type="checkbox"
                checked={showUnchanged}
                onChange={(e) => setShowUnchanged(e.target.checked)}
              />{' '}
              显示未变更节点
            </label>
            <span>点击红色冲突行可定位并解决</span>
          </div>
          <MergeTree
            root={mergeResult.root}
            resolutions={resolutions}
            selectedConflictId={selectedId}
            onSelectConflict={setSelectedId}
            showUnchanged={showUnchanged}
          />
        </div>
        <div className="conflict-panel">
          <h3>冲突解决</h3>
          {restoreInfo && showRestoreInfo && (
            <div className="restore-banner">
              <div className="restore-head">
                <span>
                  📥 快照已导入：恢复 <strong>{restoreInfo.restored}</strong> 项选择，跳过{' '}
                  <strong>{restoreInfo.skipped.length}</strong> 项
                </span>
                <button
                  className="dismiss"
                  onClick={() => setShowRestoreInfo(false)}
                  title="关闭提示"
                >
                  ×
                </button>
              </div>
              {restoreInfo.skipped.length > 0 && (
                <ul>
                  {restoreInfo.skipped.map((s, i) => (
                    <li key={i}>
                      <code>{s.pointer || '（根节点）'}</code>：{s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="progress-line">
            已解决 <strong>{resolved}</strong> / {total} 个冲突
          </div>
          <div className="progress-bar">
            <div style={{ width: total === 0 ? '100%' : `${(resolved / total) * 100}%` }} />
          </div>
          {allResolved && (
            <div className="all-done">✅ 全部冲突已解决，可以生成合并结果。</div>
          )}
          <ConflictPanel
            conflicts={mergeResult.conflicts}
            resolutions={resolutions}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onResolve={handleResolve}
          />
        </div>
      </div>
      {mergeResult.conflicts.length > 0 && (
        <BatchRulesPanel
          conflicts={mergeResult.conflicts}
          resolutions={resolutions}
          onApply={handleApplyBatch}
          onLocateConflict={setSelectedId}
        />
      )}
      <div className="merge-footer">
        <button onClick={onBack}>← 返回重新输入</button>
        <button onClick={handleDownloadSnapshot}>下载会话快照</button>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="primary" onClick={onFinish} disabled={!allResolved}>
          生成合并结果 →
        </button>
      </div>
    </>
  );
}
