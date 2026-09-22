import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real handlers with deferred API doubles, without mounting a browser or running a model.
const source = fs.readFileSync(new URL('../src/pages/experiments/run/useExperimentRunController.ts', import.meta.url), 'utf8');
const sourceFile = ts.createSourceFile('controller.ts', source, ts.ScriptTarget.Latest, true);
const handlerInitializers = new Map<string, string>();
let demoGuard = '';
function visit(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.initializer) {
    const name = node.name.getText(sourceFile);
    if (name === 'onSubmitRun' || name === 'onSubmitSensitivity') {
      handlerInitializers.set(name, node.initializer.getText(sourceFile));
    }
  }
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'isExperimentDemoSubmissionBlocked') {
    demoGuard = node.getText(sourceFile);
  }
  ts.forEachChild(node, visit);
}
visit(sourceFile);
assert.equal(handlerInitializers.size, 2, 'Both submission handlers must be exercised');
assert.ok(demoGuard);
const executable = ts.transpileModule(
  [demoGuard, ...Array.from(handlerInitializers, ([name, initializer]) => `const ${name} = ${initializer};`)].join('\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
).outputText;

type Workspace = 'manual' | 'sensitivity';
interface RecordedCall { name: string; args: unknown[] }
const draftId = 'unfinished-draft';
const handoffNames = ['onManualRunAccepted', 'onSensitivityRunAccepted'];
const navigationNames = [...handoffNames, 'onSelectedJobRefChange', 'setPendingManualJobRef', 'setPendingSensitivityJobRef', 'refreshJobs'];

function createHarness(workspace: Workspace, withHandoff = true, demo = false, guards: Record<string, unknown> = {}) {
  const calls: RecordedCall[] = [];
  const drafts = new Set([`manual:${draftId}`, `sensitivity:${draftId}`]);
  const lifecycle = Symbol('mounted controller');
  const jobsLifecycleRef = { current: lifecycle as symbol | null };
  const handoffLifecycles: Array<symbol | null> = [];
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  const response = new Promise<unknown>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const record = (name: string, ...args: unknown[]) => calls.push({ name, args: structuredClone(args) });
  const handoff = (name: string) => (...args: unknown[]) => {
    handoffLifecycles.push(jobsLifecycleRef.current);
    record(name, ...args);
  };
  const setters = [
    'setPageError', 'setIsSubmitting', 'setIsSubmittingSensitivity', 'setDraftHydrated',
    'setWarnings', 'setSensitivityWarnings', 'setTitle', 'setSensitivityTitle', 'setManualLockedParameterKeys',
    'setPendingManualJobRef', 'setPendingSensitivityJobRef', 'onSelectedJobRefChange'
  ];
  const context = vm.createContext({
    exports: {},
    activeType: workspace,
    guidedPracticeActive: demo,
    allowPolicyPracticeSubmission: false,
    allowSensitivityPracticeSubmission: false,
    canWrite: true,
    isLoadingOptions: false,
    draftHydrated: true,
    isLoadingJobs: false,
    manualSubmissionLockedBySensitivity: false,
    sensitivitySubmissionLockedByManual: false,
    jobsLifecycleRef,
    submissionInFlightRef: { current: false },
    draftId,
    manualMaxWorkers: '3',
    selectedBaseline: 'v5o3',
    sensitivityBasePolicy: '2024',
    sensitivityTitle: 'New sweep',
    selectedSensitivityPackage: { id: 'owner_occupier_lti_soft_max' },
    sensitivityMin: '4',
    sensitivityMax: '5',
    sensitivitySampleCount: '5',
    sensitivityMaxWorkers: '3',
    options: { executionEnabled: true, sensitivityMaxWorkersCap: 4 },
    buildSubmitPayload: (confirmWarnings: boolean, maxWorkers: number) => ({ confirmWarnings, maxWorkers }),
    buildSensitivityGeneralOverrides: () => ({ N_SIMS: 8 }),
    submitModelRun: (payload: unknown) => { record('submitModelRun', payload); return response; },
    submitSensitivityExperiment: (payload: unknown) => { record('submitSensitivityExperiment', payload); return response; },
    clearScenarioDraft: (id: string) => { record('clearScenarioDraft', id); drafts.delete(`manual:${id}`); },
    clearSensitivityDraft: (id: string) => { record('clearSensitivityDraft', id); drafts.delete(`sensitivity:${id}`); },
    onManualRunAccepted: withHandoff ? handoff('onManualRunAccepted') : undefined,
    onSensitivityRunAccepted: withHandoff ? handoff('onSensitivityRunAccepted') : undefined,
    refreshJobs: async () => { record('refreshJobs'); },
    ...Object.fromEntries(setters.map((name) => [name, (...args: unknown[]) => record(name, ...args)])),
    ...guards
  });
  vm.runInContext(executable, context);
  const submit = vm.runInContext(workspace === 'manual' ? 'onSubmitRun' : 'onSubmitSensitivity', context) as (confirmWarnings: boolean) => Promise<void>;
  return { calls, drafts, jobsLifecycleRef, lifecycle, handoffLifecycles, submit, resolve, reject, named: (name: string) => calls.filter((call) => call.name === name) };
}

for (const workspace of ['manual', 'sensitivity'] as const) {
  const manual = workspace === 'manual';
  const apiName = manual ? 'submitModelRun' : 'submitSensitivityExperiment';
  const callbackName = manual ? 'onManualRunAccepted' : 'onSensitivityRunAccepted';
  const clearName = manual ? 'clearScenarioDraft' : 'clearSensitivityDraft';
  const warningSetter = manual ? 'setWarnings' : 'setSensitivityWarnings';
  const busySetter = manual ? 'setIsSubmitting' : 'setIsSubmittingSensitivity';
  const pendingSetter = manual ? 'setPendingManualJobRef' : 'setPendingSensitivityJobRef';
  const resultId = manual ? 'new-policy-run-23' : 'new-sensitivity-31';
  const jobRef = manual ? 'manual:new-policy-job-17' : `sensitivity:${resultId}`;
  const acceptedResponse = manual
    ? { accepted: true, warnings: [], job: { jobId: 'new-policy-job-17', runId: resultId, status: 'queued' } }
    : { accepted: true, warnings: [], experiment: { experimentId: resultId, status: 'queued' } };
  const assertNoNavigation = (harness: ReturnType<typeof createHarness>) => {
    assert.deepEqual(harness.calls.filter((call) => navigationNames.includes(call.name)), [], `${workspace}: no navigation before acceptance`);
  };

  const accepted = createHarness(workspace);
  const acceptedPending = accepted.submit(false);
  const repeatedClick = accepted.submit(false);
  assert.equal(accepted.named(apiName).length, 1);
  assert.equal(accepted.drafts.size, 2, `${workspace}: keep unfinished work while the request is pending`);
  assert.deepEqual(accepted.named(busySetter).map((call) => call.args), [[true]]);
  assertNoNavigation(accepted);
  accepted.resolve(acceptedResponse);
  await Promise.all([acceptedPending, repeatedClick]);
  assert.deepEqual(accepted.named(callbackName).map((call) => call.args), [[resultId, jobRef]], `${workspace}: hand off the exact accepted identity`);
  assert.deepEqual(accepted.calls.filter((call) => navigationNames.includes(call.name)).map((call) => call.name), [callbackName], `${workspace}: handoff must not be followed by old-workspace selection or polling`);
  assert.deepEqual(accepted.named(clearName).map((call) => call.args), [[draftId]]);
  assert.equal(accepted.drafts.has(`${workspace}:${draftId}`), false);
  assert.equal(accepted.drafts.size, 1, `${workspace}: keep the other experiment type's draft`);
  assert.ok(accepted.calls.findIndex((call) => call.name === clearName) < accepted.calls.findIndex((call) => call.name === callbackName), `${workspace}: retire the draft before navigating`);
  assert.deepEqual(accepted.named(busySetter).map((call) => call.args), [[true], [false]]);
  assert.equal(accepted.jobsLifecycleRef.current, null, `${workspace}: invalidate in-flight polling before leaving setup`);
  assert.deepEqual(accepted.handoffLifecycles, [null], `${workspace}: the callback must observe polling already invalidated`);

  const warnings = [{ code: 'runtime', message: 'Confirm this setup first.', severity: 'warning' }];
  const rejected = createHarness(workspace);
  const rejectedPending = rejected.submit(false);
  rejected.resolve({ accepted: false, warnings });
  await rejectedPending;
  assert.deepEqual(rejected.named(warningSetter).map((call) => call.args), [[warnings]]);
  assert.equal(rejected.named(clearName).length, 0);
  assert.equal(rejected.drafts.size, 2);
  assertNoNavigation(rejected);
  assert.deepEqual(rejected.named(busySetter).map((call) => call.args), [[true], [false]]);
  assert.equal(rejected.jobsLifecycleRef.current, rejected.lifecycle);

  const failed = createHarness(workspace);
  const failedPending = failed.submit(false);
  failed.reject(new Error('Submission unavailable'));
  await failedPending;
  assert.equal(failed.named(clearName).length, 0);
  assert.equal(failed.drafts.size, 2);
  assertNoNavigation(failed);
  assert.deepEqual(failed.named('setPageError').at(-1)?.args, ['Submission unavailable']);
  assert.deepEqual(failed.named(busySetter).map((call) => call.args), [[true], [false]]);
  assert.equal(failed.jobsLifecycleRef.current, failed.lifecycle);
  await failed.submit(false);
  assert.equal(failed.named(apiName).length, 2, `${workspace}: a failed submission must allow retrying`);

  const fallback = createHarness(workspace, false);
  const fallbackPending = fallback.submit(true);
  fallback.resolve(acceptedResponse);
  await fallbackPending;
  assert.deepEqual(fallback.named(pendingSetter).map((call) => call.args), [[jobRef]]);
  assert.deepEqual(fallback.named('onSelectedJobRefChange').map((call) => call.args), [[jobRef]]);
  assert.equal(fallback.named('refreshJobs').length, 1, `${workspace}: callers without a handoff retain live run management`);
  assert.equal(fallback.named(clearName).length, 1);
  assert.equal(fallback.calls.filter((call) => handoffNames.includes(call.name)).length, 0);
  assert.equal(fallback.jobsLifecycleRef.current, fallback.lifecycle, `${workspace}: keep polling active for live run management`);

  const guidedDemo = createHarness(workspace, true, true);
  await guidedDemo.submit(false);
  assert.equal(guidedDemo.named(apiName).length, 0, `${workspace}: practice cannot submit outside its explicit Start lesson`);
  assert.equal(guidedDemo.drafts.size, 2);
  assertNoNavigation(guidedDemo);
  assert.match(String(guidedDemo.named('setPageError')[0]?.args[0]), /only from its Start lesson, once per practice/);
  assert.equal(guidedDemo.jobsLifecycleRef.current, guidedDemo.lifecycle);

  for (const guards of [
    { canWrite: false }, { isLoadingOptions: true }, { draftHydrated: false },
    { options: { executionEnabled: false } },
    manual ? { manualSubmissionLockedBySensitivity: true } : { sensitivitySubmissionLockedByManual: true }
  ]) {
    const blocked = createHarness(workspace, true, false, guards);
    await blocked.submit(false);
    assert.equal(blocked.named(apiName).length, 0, `${workspace}: ${JSON.stringify(guards)} must block submission`);
    assert.equal(blocked.drafts.size, 2);
    assertNoNavigation(blocked);
    assert.equal(blocked.named('setPageError').length, 1);
  }
}

console.log('Experiment submission handoff tests passed.');
