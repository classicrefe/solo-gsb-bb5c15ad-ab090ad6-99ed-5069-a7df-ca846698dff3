import { useState } from 'react';
import InputStage from './components/InputStage';
import MergeStage from './components/MergeStage';
import OutputStage from './components/OutputStage';
import { diff, type PatchOp } from './merge/rfc6902';
import {
  buildMerged,
  threeWayMerge,
  type MergeResult,
  type Resolutions,
} from './merge/threeWayMerge';
import { isAbsent, type JsonValue } from './merge/types';
import type { CompiledSchema } from './merge/schema';
import {
  restoreResolutions,
  type RestoreSummary,
  type SessionSnapshot,
} from './merge/snapshot';
import {
  canRedo,
  canUndo,
  createHistory,
  diffResolutions,
  pushTransaction,
  redoTransaction,
  undoTransaction,
  type DecisionHistory,
} from './merge/history';

type Stage = 'input' | 'merge' | 'output';

export default function App() {
  const [stage, setStage] = useState<Stage>('input');
  const [baseDoc, setBaseDoc] = useState<JsonValue | null>(null);
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const [resolutions, setResolutions] = useState<Resolutions>({});
  // 决策撤销/重做历史：放在 App 层，输出页 ↔ 冲突页往返后仍可继续撤销/重做
  const [history, setHistory] = useState<DecisionHistory>(createHistory);
  const [merged, setMerged] = useState<JsonValue | null>(null);
  const [patch, setPatch] = useState<PatchOp[]>([]);
  // 快照导入的恢复汇总（进入合并页时展示一次）
  const [restoreInfo, setRestoreInfo] = useState<RestoreSummary | null>(null);
  // Schema 校验状态在「返回调整 ↔ 输出」之间保留，重新开始时清空
  const [schemaEnabled, setSchemaEnabled] = useState(false);
  const [schema, setSchema] = useState<CompiledSchema | null>(null);

  const handleMerge = (base: JsonValue, ours: JsonValue, theirs: JsonValue) => {
    setBaseDoc(base);
    setMergeResult(threeWayMerge(base, ours, theirs));
    setResolutions({});
    setHistory(createHistory());
    setMerged(null);
    setPatch([]);
    setRestoreInfo(null);
    setStage('merge');
  };

  // 导入会话快照：用快照中的三份源 JSON 重新执行三方合并，再按指针 + 三方值恢复选择
  const handleImportSnapshot = (snapshot: SessionSnapshot) => {
    const result = threeWayMerge(snapshot.base, snapshot.ours, snapshot.theirs);
    const { resolutions: restored, ...summary } = restoreResolutions(snapshot, result);
    setBaseDoc(snapshot.base);
    setMergeResult(result);
    setResolutions(restored);
    // 快照恢复的结果作为不可撤销的初始状态：历史从空开始
    setHistory(createHistory());
    setMerged(null);
    setPatch([]);
    setRestoreInfo(summary);
    setStage('merge');
  };

  // 冲突页的每一次决策变更（手动单项 / 自定义值 / 一次批量规则应用整体）记为一个历史事务
  const handleResolutionsChange = (next: Resolutions) => {
    setHistory((h) => pushTransaction(h, diffResolutions(resolutions, next)));
    setResolutions(next);
  };

  const handleUndo = () => {
    const step = undoTransaction(history, resolutions);
    if (!step) return;
    setHistory(step.history);
    setResolutions(step.resolutions);
  };

  const handleRedo = () => {
    const step = redoTransaction(history, resolutions);
    if (!step) return;
    setHistory(step.history);
    setResolutions(step.resolutions);
  };

  const handleFinish = () => {
    if (!mergeResult || baseDoc === null) return;
    const result = buildMerged(mergeResult.root, resolutions);
    if (result === undefined || isAbsent(result)) return;
    setMerged(result);
    setPatch(diff(baseDoc, result));
    setStage('output');
  };

  const handleRestart = () => {
    setStage('input');
    setMergeResult(null);
    setBaseDoc(null);
    setResolutions({});
    setHistory(createHistory());
    setMerged(null);
    setPatch([]);
    setRestoreInfo(null);
    setSchema(null);
    setSchemaEnabled(false);
  };

  return (
    <>
      <header className="app-header">
        <h1>JSON 三方合并台</h1>
        <div className="steps">
          <span className={`step ${stage === 'input' ? 'active' : 'done'}`}>1 输入三份 JSON</span>
          <span className={`step ${stage === 'merge' ? 'active' : stage === 'output' ? 'done' : ''}`}>
            2 解决冲突
          </span>
          <span className={`step ${stage === 'output' ? 'active' : ''}`}>3 导出结果</span>
        </div>
      </header>
      <main>
        {stage === 'input' && <InputStage onMerge={handleMerge} onImportSnapshot={handleImportSnapshot} />}
        {stage === 'merge' && mergeResult && (
          <MergeStage
            mergeResult={mergeResult}
            resolutions={resolutions}
            onResolutionsChange={handleResolutionsChange}
            canUndo={canUndo(history)}
            canRedo={canRedo(history)}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onFinish={handleFinish}
            onBack={handleRestart}
            restoreInfo={restoreInfo}
          />
        )}
        {stage === 'output' && merged !== null && (
          <OutputStage
            merged={merged}
            patch={patch}
            schemaEnabled={schemaEnabled}
            schema={schema}
            onSchemaEnabledChange={setSchemaEnabled}
            onSchemaChange={setSchema}
            onBack={() => setStage('merge')}
            onRestart={handleRestart}
          />
        )}
      </main>
    </>
  );
}
