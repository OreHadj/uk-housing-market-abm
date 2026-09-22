import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import type { ModelRunJobStatus } from '../shared/types.js';

// Execute the real effect and loader with deferred APIs to test timing without running a model.
const source = fs.readFileSync(new URL('../src/pages/experiments/view/ManualResultsView.tsx', import.meta.url), 'utf8');
const sourceFile = ts.createSourceFile('ManualResultsView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let pollEffect = '';
let pollDependencies = '';
let loadRunsInitializer = '';
function visit(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'loadRuns' && node.initializer) {
    loadRunsInitializer = node.initializer.getText(sourceFile);
  }
  if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === 'useEffect' &&
      node.arguments[0]?.getText(sourceFile).includes('const pollActiveRuns')) {
    pollEffect = node.arguments[0].getText(sourceFile);
    pollDependencies = node.arguments[1].getText(sourceFile);
  }
  ts.forEachChild(node, visit);
}
visit(sourceFile);
assert.ok(pollEffect && loadRunsInitializer, 'Exercise the actual history polling effect and loader');
const executable = ts.transpileModule(`const loadRuns = ${loadRunsInitializer}; const mount = ${pollEffect}; const dependencies = () => ${pollDependencies};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
type Job = { jobId: string; runId: string; status: ModelRunJobStatus };
type Run = { runId: string };
const job = (id: string, status: ModelRunJobStatus): Job => ({ jobId: `job-${id}`, runId: `run-${id}`, status });
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness(requestedJobId = '', requestedBaselineRunId = '') {
  const jobRequests: ReturnType<typeof deferred<Job[]>>[] = [];
  const runRequests: ReturnType<typeof deferred<Run[]>>[] = [];
  const updates: Array<{ name: string; value: unknown }> = [];
  const removedRunIds = { current: new Set<string>() };
  let tick!: () => void;
  let timerCleared = false;
  const record = (name: string) => (value: unknown) => { updates.push({ name, value: structuredClone(value) }); };
  const context = vm.createContext({
    requestedJobId,
    historyRequestedJobId: { current: requestedJobId },
    historyRequestedRunId: { current: requestedBaselineRunId },
    removedJobIds: { current: new Set<string>() }, removedRunIds,
    runsRequestId: { current: 0 },
    useCallback: (callback: unknown) => callback,
    fetchModelRunJobs: () => { const request = deferred<Job[]>(); jobRequests.push(request); return request.promise; },
    fetchResultsRuns: () => { const request = deferred<Run[]>(); runRequests.push(request); return request.promise; },
    setRunJobs: record('jobs'), setRuns: record('runs'),
    setLoadError: record('error'), setIsLoadingRuns: record('loading'),
    window: {
      setInterval: (callback: () => void) => { tick = callback; return 1; },
      clearInterval: () => { timerCleared = true; }
    }
  });
  vm.runInContext(executable, context);
  let cleanup = vm.runInContext('mount()', context) as () => void;
  let dependencies = vm.runInContext('dependencies()', context) as unknown[];
  const loadRuns = vm.runInContext('loadRuns', context) as (isCurrent?: () => boolean) => Promise<Run[]>;
  return {
    jobRequests, runRequests, updates, removedRunIds, loadRuns,
    selectSubmittedJob: (jobId: string) => {
      context.requestedJobId = jobId;
      context.historyRequestedJobId.current = jobId;
      const next = vm.runInContext('dependencies()', context) as unknown[];
      if (next.some((value, index) => !Object.is(value, dependencies[index]))) {
        cleanup();
        cleanup = vm.runInContext('mount()', context) as () => void;
      }
      dependencies = next;
    },
    tick: () => tick(),
    cleanup: () => { cleanup(); assert.equal(timerCleared, true); },
    async jobs(value: Job[], initial = false) {
      if (!initial) tick();
      jobRequests.at(-1)!.resolve(value);
      await settle();
    },
    async runs(...ids: string[]) {
      runRequests.at(-1)!.resolve(ids.map((id) => ({ runId: `run-${id}` })));
      await settle();
    }
  };
}

// A finishes and B starts without the user following either submitted job.
{
  const h = harness();
  await h.jobs([job('a', 'running'), job('b', 'queued')], true);
  assert.equal(h.runRequests.length, 0);
  await h.jobs([job('a', 'succeeded'), job('b', 'running')]);
  assert.equal(h.runRequests.length, 1, 'Refresh immediately for any completion while another job is active');
  await h.runs('a');
  assert.deepEqual(h.updates.filter((update) => update.name === 'runs').at(-1)?.value, [{ runId: 'run-a' }]);
  await h.jobs([job('a', 'succeeded'), job('b', 'running')]);
  assert.equal(h.runRequests.length, 1, 'Do not repeatedly refresh unchanged completed jobs');
  await h.jobs([job('a', 'succeeded'), job('b', 'succeeded')]);
  assert.equal(h.runRequests.length, 2);
  await h.runs('a', 'b');
  h.cleanup();
}

// All terminal transitions refresh history, and several in one response cause one refresh.
for (const terminal of ['succeeded', 'failed', 'canceled'] as const) {
  const h = harness();
  await h.jobs([job('a', 'running'), job('b', 'running'), job('c', 'queued')], true);
  await h.jobs([job('a', terminal), job('b', terminal), job('c', 'running')]);
  assert.equal(h.runRequests.length, 1, `${terminal}: refresh once for concurrent completions`);
  await h.runs(...(terminal === 'succeeded' ? ['a', 'b'] : []));
  h.cleanup();
}

// Output listing may lag completion; retry even after the terminal status was already observed.
for (const requested of [false, true]) {
  const h = harness(requested ? 'job-a' : '');
  if (!requested) await h.jobs([job('a', 'running'), job('b', 'queued')], true);
  await h.jobs([job('a', 'succeeded'), job('b', 'running')], requested);
  assert.equal(h.runRequests.length, 1, 'A directly opened finished submission also refreshes');
  await h.runs();
  await h.jobs([job('a', 'succeeded'), job('b', 'running')]);
  assert.equal(h.runRequests.length, 2, 'Retry until finished output is available');
  await h.runs('a');
  await h.jobs([job('a', 'succeeded'), job('b', 'running')]);
  assert.equal(h.runRequests.length, 2, 'Stop output retries when the saved run appears');
  h.cleanup();
}

// A direct run URL has no submitted-job reference, but must still retry delayed finished output.
{
  const h = harness('', 'run-a');
  await h.jobs([job('a', 'succeeded'), job('b', 'running')], true);
  assert.equal(h.runRequests.length, 1, 'A directly opened run without jobRef refreshes completed output');
  await h.runs();
  await h.jobs([job('a', 'succeeded'), job('b', 'running')]);
  assert.equal(h.runRequests.length, 2, 'Retry delayed output for direct run URLs');
  await h.runs('a');
  await h.jobs([job('a', 'succeeded'), job('b', 'running')]);
  assert.equal(h.runRequests.length, 2, 'Stop direct-run retries once its output appears');
  h.cleanup();
}

// New jobs can start and finish between polls; disappearing active jobs can remove partial output.
{
  const h = harness();
  await h.jobs([job('old', 'succeeded'), job('b', 'running')], true);
  assert.equal(h.runRequests.length, 0, 'Initial history already covers old terminal jobs');
  await h.jobs([job('old', 'succeeded'), job('b', 'running'), job('a', 'succeeded')]);
  assert.equal(h.runRequests.length, 1);
  await h.runs('old', 'a');
  await h.jobs([job('old', 'succeeded'), job('a', 'succeeded'), job('c', 'running')]);
  assert.equal(h.runRequests.length, 2, 'Refresh when active work disappears, even with other work running');
  await h.runs('old', 'a');
  h.cleanup();
}

// A deliberate deletion must end pending-output retries and cannot restore removed results.
{
  const h = harness('job-a');
  await h.jobs([job('a', 'succeeded')], true);
  h.removedRunIds.current.add('run-a');
  await h.runs('a');
  assert.deepEqual(h.updates.filter((update) => update.name === 'runs').at(-1)?.value, []);
  await h.jobs([job('a', 'succeeded')]);
  assert.equal(h.runRequests.length, 1);
  h.cleanup();
}

// Keep the previous snapshot after network failures so the completion is retried.
{
  const h = harness();
  await h.jobs([job('a', 'running'), job('b', 'queued')], true);
  h.tick();
  h.jobRequests.at(-1)!.reject(new Error('temporary queue failure'));
  await settle();
  await h.jobs([job('a', 'succeeded'), job('b', 'running')]);
  h.runRequests.at(-1)!.reject(new Error('temporary history failure'));
  await settle();
  await h.jobs([job('a', 'succeeded'), job('b', 'running')]);
  assert.equal(h.runRequests.length, 2, 'Retry a failed completion refresh');
  await h.runs('a');
  h.cleanup();
}

// Slow requests never overlap and neither queue nor history responses update an unmounted view.
{
  const h = harness('job-a');
  h.tick();
  assert.equal(h.jobRequests.length, 1, 'No overlapping queue requests');
  await h.jobs([job('a', 'succeeded')], true);
  h.tick();
  assert.equal(h.jobRequests.length, 1, 'Do not start another poll during history refresh');
  h.cleanup();
  const before = h.updates.length;
  await h.runs('a');
  assert.equal(h.updates.length, before, 'A late history response cannot update the unmounted view');
  h.tick();
  assert.equal(h.jobRequests.length, 1);
}
{
  const h = harness();
  h.cleanup();
  h.jobRequests[0].resolve([job('a', 'succeeded')]);
  await settle();
  assert.equal(h.updates.length, 0);
  assert.equal(h.runRequests.length, 0);
}

// Initial/manual history refreshes can overlap: only the newest request may commit its result.
{
  const h = harness();
  h.cleanup();
  const older = h.loadRuns();
  const newer = h.loadRuns();
  h.runRequests[1].resolve([{ runId: 'newer-history' }]);
  await newer;
  const before = h.updates.length;
  h.runRequests[0].resolve([{ runId: 'older-history' }]);
  await older;
  assert.equal(h.updates.length, before, 'An older result cannot overwrite a newer history response');
  assert.deepEqual(h.updates.filter((update) => update.name === 'runs').at(-1)?.value, [{ runId: 'newer-history' }]);
}

// Selecting a saved run during a completion refresh keeps the queue lifecycle and loading state.
{
  const h = harness('job-a');
  await h.jobs([job('a', 'running'), job('b', 'queued')], true);
  await h.jobs([job('a', 'succeeded'), job('b', 'running')]);
  h.selectSubmittedJob('');
  await h.runs('a');
  assert.equal(h.updates.filter((update) => update.name === 'loading').at(-1)?.value, false);
  assert.deepEqual(h.updates.filter((update) => update.name === 'runs').at(-1)?.value, [{ runId: 'run-a' }]);
  await h.jobs([job('a', 'succeeded'), job('b', 'succeeded')]);
  assert.equal(h.runRequests.length, 2, 'Changing the selected run retains prior job status transitions');
  await h.runs('a', 'b');
  h.cleanup();
}

console.log('Manual history refresh tests passed.');
