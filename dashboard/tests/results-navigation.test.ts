import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual selection handlers and render-time guards without starting a model or API.
function readView(name: string) {
  const source = fs.readFileSync(new URL(`../src/pages/experiments/view/${name}.tsx`, import.meta.url), 'utf8');
  const file = ts.createSourceFile(`${name}.tsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const expressions = new Map<string, string>();
  const selectionEffects: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      expressions.set(node.name.text, node.initializer.getText(file));
    }
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect') {
      const effect = node.arguments[0].getText(file);
      if (effect.includes('onSelectedExperimentIdChange')) selectionEffects.push(effect);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { expressions, selectionEffects };
}

function execute(source: string, context: vm.Context) {
  return vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, context);
}

const manual = readView('ManualResultsView');
const sensitivity = readView('SensitivityResultsView');
// Picking a run in the selector selects it.
for (const kind of ['manual', 'sensitivity']) {
  const calls: Array<{ name: string; value?: unknown }> = [];
  const context = vm.createContext({
    baselineRunId: 'current', selectedExperimentId: 'current', selectedRunPending: false, requestedRunId: '', requestedJobRef: '',
    useCallback: (callback: unknown) => callback,
    setPageError: () => {},
    onManualSelectionChange: (value: unknown) => calls.push({ name: 'select', value: structuredClone(value) }),
    onSelectedExperimentIdChange: (value: unknown) => calls.push({ name: 'select', value })
  });
  const view = kind === 'manual' ? manual : sensitivity;
  const handlers = kind === 'manual' ? ['updateSelection', 'setBaselineSelection'] : ['selectExperiment'];
  execute(handlers.map((name) => `const ${name} = ${view.expressions.get(name)};`).join('\n'), context);
  execute(kind === 'manual' ? "setBaselineSelection('other')" : "selectExperiment('other')", context);
  assert.deepEqual(calls, [
    { name: 'select', value: kind === 'manual' ? { baselineRunId: 'other', comparisonRunId: '', comparisonNoneFor: '' } : 'other' }
  ], `${kind}: picking a run selects it`);
  assert.equal(view.expressions.has('viewRunResults'), false, `${kind}: Run History is not part of Results`);
}

for (const requested of ['run-a', 'run-b', 'run-a', 'just-submitted']) {
  const writes: string[] = [];
  const context = vm.createContext({
    requestedExperimentId: requested,
    experiments: [{ experimentId: 'run-b' }, { experimentId: 'run-a' }],
    isLoadingHistory: false,
    onSelectedExperimentIdChange: (value: string) => writes.push(value)
  });
  const selected = execute(`const selectedExperimentId = ${sensitivity.expressions.get('selectedExperimentId')}; selectedExperimentId;`, context);
  assert.equal(selected, requested, 'Clicks, back/forward navigation and new submissions retain their explicit selection');
  for (const effect of sensitivity.selectionEffects) execute(`(${effect})()`, context);
  assert.deepEqual(writes, [], 'A refresh cannot overwrite the URL selection with an older local value');
}

for (const [view, guards, context] of [
  [manual, ['baselineDetail', 'comparisonDetail', 'comparePayload'], {
    baselineRunId: 'new-primary', comparisonRunId: 'new-comparison', selectedRunIds: ['new-primary', 'new-comparison'], selectedRunPending: false,
    loadedBaselineDetail: { runId: 'old-primary' }, loadedComparisonDetail: { runId: 'old-comparison' },
    loadedComparePayload: { runIds: ['old-primary', 'old-comparison'] }
  }],
  [sensitivity, ['detail', 'results', 'charts'], {
    selectedExperimentId: 'new', loadedDetail: { experimentId: 'old' },
    loadedResults: { experimentId: 'old' }, loadedCharts: { experimentId: 'old' }
  }]
] as const) {
  for (const guard of guards) {
    assert.equal(execute(`(${view.expressions.get(guard)})`, vm.createContext(context)), null,
      `${guard}: never paint a previous run's data under the newly selected run`);
  }
}

console.log('Results navigation tests passed.');
