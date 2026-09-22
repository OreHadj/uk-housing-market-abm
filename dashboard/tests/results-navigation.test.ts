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
for (const kind of ['manual', 'sensitivity']) {
  const calls: Array<{ name: string; value?: unknown }> = [];
  const context = vm.createContext({
    baselineRunId: 'current', selectedExperimentId: 'current', selectedRunPending: false, requestedRunId: '', requestedJobRef: '',
    useCallback: (callback: unknown) => callback,
    setPageError: () => {},
    onManualSelectionChange: (value: unknown) => calls.push({ name: 'select', value: structuredClone(value) }),
    onSelectedExperimentIdChange: (value: unknown) => calls.push({ name: 'select', value }),
    requestScrollToTop: () => calls.push({ name: 'scroll' })
  });
  const view = kind === 'manual' ? manual : sensitivity;
  const handlers = kind === 'manual'
    ? ['updateSelection', 'setBaselineSelection', 'viewRunResults']
    : ['selectExperiment', 'viewRunResults'];
  execute(handlers.map((name) => `const ${name} = ${view.expressions.get(name)};`).join('\n'), context);
  execute("viewRunResults('other')", context);
  assert.deepEqual(calls, [
    { name: 'select', value: kind === 'manual' ? { baselineRunId: 'other', comparisonRunId: '', comparisonNoneFor: '' } : 'other' },
    { name: 'scroll' }
  ], `${kind}: select the clicked run before requesting the scroll`);
  calls.length = 0;
  execute("viewRunResults('current')", context);
  assert.deepEqual(calls, [{ name: 'scroll' }], `${kind}: reopening the current results scrolls without resetting selection or comparison`);
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

// Verify that scrolling happens after the selection render, and is repeatable for the same run.
const hookSource = fs.readFileSync(new URL('../src/pages/experiments/view/useResultsTopNavigation.ts', import.meta.url), 'utf8');
const hookFile = ts.createSourceFile('hook.ts', hookSource, ts.ScriptTarget.Latest, true);
const hook = hookFile.statements.find((node) => ts.isFunctionDeclaration(node))?.getText(hookFile);
assert.ok(hook);
let request = 0;
let previousRequest = -1;
let layoutEffect: (() => void) | undefined;
const scrolls: unknown[] = [];
const focusOptions: unknown[] = [];
const hookContext = vm.createContext({
  exports: {},
  useState: () => [request, (update: (current: number) => number) => { request = update(request); }],
  useRef: () => ({ current: { focus: (options: unknown) => focusOptions.push(options) } }),
  useLayoutEffect: (effect: () => void, deps: number[]) => {
    if (deps[0] !== previousRequest) { layoutEffect = effect; previousRequest = deps[0]; }
  },
  window: { scrollTo: (options: unknown) => scrolls.push(options) }
});
execute(hook, hookContext);
const renderNavigation = () => {
  const value = execute('useResultsTopNavigation()', hookContext) as { requestScrollToTop: () => void };
  layoutEffect?.();
  layoutEffect = undefined;
  return value;
};
let navigation = renderNavigation();
assert.equal(scrolls.length, 0, 'Polling and initial renders must not jump the page');
for (let click = 1; click <= 2; click += 1) {
  navigation.requestScrollToTop();
  assert.equal(scrolls.length, click - 1, 'Wait for the selected run to render before scrolling');
  navigation = renderNavigation();
  assert.equal(scrolls.length, click);
  assert.equal(focusOptions.length, click);
  assert.equal((scrolls.at(-1) as ScrollToOptions).top, 0);
  assert.equal((scrolls.at(-1) as ScrollToOptions).behavior, 'instant');
  assert.equal((focusOptions.at(-1) as FocusOptions).preventScroll, true);
  renderNavigation();
  assert.equal(scrolls.length, click, 'Background re-renders do not repeat a user scroll');
}

console.log('Results navigation tests passed.');
