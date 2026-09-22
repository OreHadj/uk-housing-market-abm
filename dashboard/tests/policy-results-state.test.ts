import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { ModelRunJob, ResultsComparePayload, ResultsRunSummary } from '../shared/types.js';
import { DEMO_EXAMPLE_IDS } from '../shared/demoExamples.js';
import { createDevelopmentRuntimePaths } from '../server/lib/runtimePaths.js';
import { getResultsRunDetail } from '../server/lib/results.js';
import { resolveManualRunSelection } from '../src/lib/manualResultsView.js';
import { POLICY_ANALYSIS_WINDOWS, policyDetailedSelection, readPolicyAnalysisWindow, updateReportQuery } from '../src/lib/reportUrlState.js';

// Evaluate the actual component state and URL handlers with controlled job/history snapshots.
// This covers navigation/state behaviour without claiming an interactive browser check.
const source = fs.readFileSync(new URL('../src/pages/experiments/view/ManualResultsView.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('ManualResultsView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const expressions = new Map<string, string>();
let canonicalEffect = '';
function visit(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) expressions.set(node.name.text, node.initializer.getText(file));
  if (ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect') {
    const effect = node.arguments[0].getText(file);
    if (effect.includes("Don't canonicalise the URL selection")) canonicalEffect = effect;
  }
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(canonicalEffect);
const pageSource = fs.readFileSync(new URL('../src/pages/ResultsPage.tsx', import.meta.url), 'utf8');
const pageFile = ts.createSourceFile('ResultsPage.tsx', pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let updateSearchExpression = '';
let manualSelectionCallback = '';
function visitPage(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.name.getText(pageFile) === 'updateSearch' && node.initializer) updateSearchExpression = node.initializer.getText(pageFile);
  if (ts.isJsxAttribute(node) && node.name.getText(pageFile) === 'onManualSelectionChange' && node.initializer && ts.isJsxExpression(node.initializer)) {
    manualSelectionCallback = node.initializer.expression?.getText(pageFile) ?? '';
  }
  ts.forEachChild(node, visitPage);
}
visitPage(pageFile);
assert.ok(updateSearchExpression);
assert.ok(manualSelectionCallback);
function execute(code: string, context: vm.Context) {
  return vm.runInContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, context);
}
const stateNames = [
  'compareWindow', 'analysisCutoffMonths', 'comparisonDefaultOptOutRunId', 'requestedJobId', 'requestedJob',
  'requestedRunId', 'requestedJobPending', 'activeRunIds', 'historyRuns', 'awaitingRequestedResult',
  'selectedRunPending', 'comparisonDefaultOptOut', 'resolvedSelection', 'baselineRunId', 'comparisonRunId', 'selectedRunIds',
  'baselineDetail', 'comparisonDetail', 'comparePayload', 'manifestRunId',
  'updateSelection', 'setBaselineSelection', 'setComparisonSelection', 'setAnalysisCutoffMonths'
];
for (const name of stateNames) assert.ok(expressions.has(name), `Actual ${name} expression must exist`);

// Read bundled records directly; the test never installs, changes or deletes user results.
const paths = createDevelopmentRuntimePaths(fileURLToPath(new URL('../../', import.meta.url)));
const examplePaths = { ...paths, resultsRoot: path.join(paths.demoExamplesRoot, 'runs') };
const scenario = getResultsRunDetail(examplePaths, DEMO_EXAMPLE_IDS.policyRunId);
const reference = getResultsRunDetail(examplePaths, DEMO_EXAMPLE_IDS.baselineRunId);
const saved = [scenario, reference];
assert.equal(resolveManualRunSelection(saved, scenario.runId, '').comparisonRunId, reference.runId, 'Fixture must have a real automatically matched baseline');

interface Selection { baselineRunId: string; comparisonRunId: string; comparisonNoneFor: string; jobRef?: string }
function render(query: URLSearchParams, runJobs: Array<Pick<ModelRunJob, 'jobId' | 'runId' | 'status'>> = [], overrides: Record<string, unknown> = {}) {
  let url = new URLSearchParams(query);
  const writes: Selection[] = [];
  const context = vm.createContext({
    pageSearch: query, searchParams: query, URLSearchParams, runJobs, runs: saved, requestedJobRef: query.get('jobRef') ?? '',
    requestedBaselineRunId: query.get('baselineRunId') || query.get('runId') || '',
    requestedComparisonRunId: query.get('comparisonRunId') ?? '',
    stopDeletion: { pending: null }, isGuidedPolicy: false, isLoadingRuns: false,
    loadedBaselineDetail: scenario, loadedComparisonDetail: reference, loadedComparePayload: null,
    manifestTarget: 'baseline', effectiveSmoothWindow: 12, requestedIndicatorIds: ['output_saleAvSalePrice'],
    readPolicyAnalysisWindow, updateReportQuery, resolveManualRunSelection,
    useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn,
    setSearchParams: (next: URLSearchParams) => { url = next; },
    setPageSearch: (update: (params: URLSearchParams) => URLSearchParams) => { url = update(url); },
    ...overrides
  });
  execute(`const updateSearch = ${updateSearchExpression}; const parentSelection = ${manualSelectionCallback};`, context);
  const parentSelection = execute('parentSelection', context) as (selection: Selection) => void;
  context.onManualSelectionChange = (selection: Selection) => {
    writes.push(structuredClone(selection));
    parentSelection(selection);
  };
  execute(stateNames.map((name) => `const ${name} = ${expressions.get(name)};`).join('\n'), context);
  const state = structuredClone(execute(`({ ${stateNames.filter((name) => !name.startsWith('set') && name !== 'updateSelection').join(', ')} })`, context));
  return {
    state, writes, url: () => new URLSearchParams(url),
    canonicalise: () => execute(`(${canonicalEffect})()`, context),
    chooseRun: (id: string) => { context.nextRunId = id; execute('setBaselineSelection(nextRunId)', context); },
    chooseComparison: (id: string) => { context.nextRunId = id; execute('setComparisonSelection(nextRunId)', context); },
    chooseCutoff: (months: number) => { context.nextCutoff = months; execute('setAnalysisCutoffMonths(nextCutoff)', context); }
  };
}

assert.deepEqual(POLICY_ANALYSIS_WINDOWS.map((window) => window.value), ['post500', 'post1000', 'post1500', 'post2000', 'full']);
for (const invalid of ['', 'tail120', 'post200', 'unknown']) assert.equal(readPolicyAnalysisWindow(new URLSearchParams({ window: invalid })), 'post500');
for (const option of POLICY_ANALYSIS_WINDOWS) {
  const report = new URLSearchParams({ type: 'manual', presentation: 'report', baselineRunId: scenario.runId, window: option.value, demo: 'policy-results', step: 'market', experimentId: 'saved-sweep' });
  const detailed = updateReportQuery(report, { presentation: 'detailed', ...policyDetailedSelection(report) });
  const view = render(detailed);
  assert.equal(view.state.compareWindow, option.value);
  assert.equal(view.state.analysisCutoffMonths, option.value === 'full' ? 0 : Number(option.value.slice(4)));
  view.canonicalise();
  assert.deepEqual(view.writes, []);
  assert.equal(render(new URLSearchParams(detailed.toString())).state.compareWindow, option.value, 'Refresh restores the chosen period');
  const returned = updateReportQuery(view.url(), { presentation: 'report' });
  assert.equal(readPolicyAnalysisWindow(returned), option.value);
  assert.equal(returned.get('comparisonRunId'), null);
  for (const key of ['demo', 'step', 'experimentId']) assert.equal(returned.get(key), report.get(key));
  view.chooseCutoff(1500);
  assert.equal(view.url().get('window'), 'post1500');
  assert.equal(readPolicyAnalysisWindow(view.url()), 'post1500');
  assert.equal(readPolicyAnalysisWindow(detailed), option.value, 'Back/forward snapshots are not mutated');
}

const runId = 'submitted-run';
const jobId = 'accepted-job';
const otherJob = { jobId: 'other-job', runId: 'other-active', status: 'running' as const };
const submittedRun: ResultsRunSummary = { ...scenario, runId, title: 'Submitted fixture', status: 'invalid' };
const submitted = new URLSearchParams({ baselineRunId: runId, comparisonRunId: reference.runId, jobRef: `manual:${jobId}`, window: 'full' });
for (const status of ['checking', 'queued', 'running'] as const) {
  const jobs = status === 'checking' ? [] : [{ jobId, runId, status }, otherJob];
  const view = render(submitted, jobs, { runs: [submittedRun, ...saved], loadedBaselineDetail: { ...scenario, runId } });
  assert.equal(view.state.baselineRunId, runId, `${status}: keep the submitted run selected`);
  assert.equal(view.state.comparisonRunId, reference.runId);
  assert.equal(view.state.selectedRunPending, true);
  assert.deepEqual(view.state.selectedRunIds, []);
  assert.equal(view.state.baselineDetail, null, 'Even same-ID cached output cannot become a finished analysis during execution');
  assert.equal(view.state.comparisonDetail, null);
  assert.equal(view.state.manifestRunId, '');
  assert.equal(view.state.historyRuns.some((run: ResultsRunSummary) => run.runId === runId), false);
  view.canonicalise();
  assert.deepEqual(view.writes, [], 'Pending work must not canonicalise to an older saved run');

  const changeComparison = render(submitted, jobs, { runs: [submittedRun, ...saved] });
  changeComparison.chooseComparison(scenario.runId);
  assert.equal(changeComparison.url().get('jobRef'), `manual:${jobId}`, `${status}: changing only comparison retains the pending job identity`);
  const changedComparison = render(changeComparison.url(), jobs, { runs: [submittedRun, ...saved] });
  assert.equal(changedComparison.state.baselineRunId, runId);
  assert.equal(changedComparison.state.comparisonRunId, scenario.runId);
  assert.equal(changedComparison.state.selectedRunPending, true);
  changedComparison.canonicalise();
  assert.deepEqual(changedComparison.writes, []);
  changedComparison.chooseComparison('');
  assert.equal(changedComparison.url().get('jobRef'), `manual:${jobId}`);
  const noComparisonPending = render(changedComparison.url(), jobs, { runs: [submittedRun, ...saved] });
  assert.equal(noComparisonPending.state.baselineRunId, runId);
  assert.equal(noComparisonPending.state.comparisonRunId, '');
  assert.equal(noComparisonPending.state.selectedRunPending, true);

  view.chooseRun(scenario.runId);
  assert.equal(view.url().get('jobRef'), null);
  const selectedSaved = render(view.url(), jobs, { runs: [submittedRun, ...saved] });
  assert.equal(selectedSaved.state.baselineRunId, scenario.runId);
  assert.equal(selectedSaved.state.selectedRunPending, false);
  assert.deepEqual(selectedSaved.state.selectedRunIds, [scenario.runId, reference.runId]);
  assert.equal(selectedSaved.state.baselineDetail.runId, scenario.runId);
}

for (const status of ['queued', 'running'] as const) {
  const jobs = [{ jobId, runId, status }];
  const direct = render(new URLSearchParams({ baselineRunId: runId }), jobs);
  const jobOnly = render(new URLSearchParams({ jobRef: `manual:${jobId}` }), jobs);
  for (const view of [direct, jobOnly]) {
    assert.equal(view.state.baselineRunId, runId);
    assert.equal(view.state.selectedRunPending, true);
    assert.deepEqual(view.state.selectedRunIds, []);
    view.canonicalise();
    assert.deepEqual(view.writes, []);
  }
}
const loading = render(submitted, [], { runs: [], isLoadingRuns: true });
assert.equal(loading.state.baselineRunId, runId);
loading.canonicalise();
assert.deepEqual(loading.writes, []);

const jobOnlyReport = new URLSearchParams({ jobRef: `manual:${jobId}` });
const jobOnlyDetailed = updateReportQuery(jobOnlyReport, { presentation: 'detailed', ...policyDetailedSelection(jobOnlyReport) });
assert.equal(jobOnlyDetailed.get('comparisonNoneFor'), `manual:${jobId}`);
const checkingJob = render(jobOnlyDetailed);
assert.equal(checkingJob.state.baselineRunId, '', 'An unchecked job-only URL must not temporarily select an older result');
assert.equal(checkingJob.state.selectedRunPending, true);
assert.deepEqual(checkingJob.state.selectedRunIds, []);
checkingJob.canonicalise();
assert.deepEqual(checkingJob.writes, []);
const jobOnlyFinished = render(jobOnlyDetailed, [{ jobId, runId: scenario.runId, status: 'succeeded' }]);
assert.equal(jobOnlyFinished.state.baselineRunId, scenario.runId);
assert.equal(jobOnlyFinished.state.comparisonRunId, '', 'Job-scoped No comparison survives learning the accepted run ID');
jobOnlyFinished.canonicalise();
assert.equal(jobOnlyFinished.url().get('comparisonNoneFor'), scenario.runId);
assert.equal(jobOnlyFinished.url().get('jobRef'), null);
const refreshedJobOnly = render(jobOnlyFinished.url());
refreshedJobOnly.canonicalise();
assert.equal(refreshedJobOnly.state.comparisonRunId, '');
assert.deepEqual(refreshedJobOnly.writes, []);

const completedJobs = [{ jobId, runId, status: 'succeeded' as const }, otherJob];
const waitingForOutput = render(submitted, completedJobs);
assert.equal(waitingForOutput.state.baselineRunId, runId);
assert.equal(waitingForOutput.state.selectedRunPending, true, 'A succeeded job waits for its results listing');
waitingForOutput.canonicalise();
assert.deepEqual(waitingForOutput.writes, []);
const completedRuns = [{ ...submittedRun, status: 'complete' as const }, ...saved];
const completed = render(submitted, completedJobs, { runs: completedRuns });
assert.equal(completed.state.baselineRunId, runId);
assert.equal(completed.state.selectedRunPending, false);
assert.deepEqual(completed.state.selectedRunIds, [runId, reference.runId]);
completed.canonicalise();
assert.equal(completed.writes.length, 1, 'Completed handoff retires the job reference');
assert.equal(completed.url().get('jobRef'), null);
const afterCompletion = render(completed.url(), completedJobs, { runs: completedRuns });
afterCompletion.canonicalise();
assert.deepEqual(afterCompletion.writes, [], 'Matching a succeeded run without a jobRef must not repeatedly replace the URL');

const compared = render(new URLSearchParams({ baselineRunId: scenario.runId, comparisonRunId: reference.runId }));
compared.chooseComparison('');
assert.equal(compared.url().get('comparisonNoneFor'), scenario.runId);
for (const presentation of ['report', 'detailed', 'report', 'detailed']) {
  const refresh = render(updateReportQuery(compared.url(), { presentation }));
  assert.equal(refresh.state.comparisonRunId, '', 'Explicit No comparison survives presentation changes and refresh');
  refresh.canonicalise();
  assert.deepEqual(refresh.writes, []);
}
const otherScenario = { ...scenario, runId: 'another-policy' };
const scoped = render(updateReportQuery(compared.url(), { baselineRunId: otherScenario.runId }), [], { runs: [otherScenario, ...saved] });
assert.equal(scoped.state.comparisonRunId, reference.runId, 'An opt-out for one run does not suppress another run’s default');
const explicit = render(compared.url());
explicit.chooseComparison(reference.runId);
assert.equal(explicit.url().has('comparisonNoneFor'), false);
assert.equal(render(explicit.url()).state.comparisonRunId, reference.runId);
assert.deepEqual(policyDetailedSelection(new URLSearchParams({ runId: scenario.runId })), { comparisonNoneFor: scenario.runId });
assert.deepEqual(policyDetailedSelection(new URLSearchParams(), runId), { comparisonNoneFor: runId });
assert.deepEqual(policyDetailedSelection(new URLSearchParams({ baselineRunId: scenario.runId, comparisonRunId: reference.runId })), { comparisonNoneFor: '' });

// The same IDs are insufficient if an older response used another analysis window.
const cached = { runIds: [scenario.runId], window: 'post500', smoothWindow: 12, indicatorIds: ['output_saleAvSalePrice'] } as ResultsComparePayload;
const full = new URLSearchParams({ baselineRunId: scenario.runId, comparisonNoneFor: scenario.runId, window: 'full' });
assert.equal(render(full, [], { loadedComparePayload: cached }).state.comparePayload, null);
assert.notEqual(render(full, [], { loadedComparePayload: { ...cached, window: 'full' } }).state.comparePayload, null);

for (const runs of [[], saved]) {
  const legacy = render(new URLSearchParams({ runId: 'missing-legacy-run' }), [], { runs });
  legacy.canonicalise();
  assert.equal(legacy.writes.length, 1);
  assert.equal(legacy.url().has('runId'), false, 'Canonical selection clears the legacy alias even when history is empty');
  let canonical = render(legacy.url(), [], { runs });
  canonical.canonicalise();
  // A missing run first falls back to history; that run may then acquire its matched baseline.
  if (runs.length > 0 && canonical.writes.length > 0) {
    assert.equal(canonical.writes.length, 1);
    canonical = render(canonical.url(), [], { runs });
    canonical.canonicalise();
  }
  assert.deepEqual(canonical.writes, [], 'A missing legacy alias must not cause repeated URL replacements');
}

console.log('Policy results state tests passed (windows, pending/finished selection, comparison persistence and canonical URL completion).');
