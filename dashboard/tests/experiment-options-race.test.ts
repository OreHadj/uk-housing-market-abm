import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import type { ModelRunOptionsPayload } from '../shared/types.js';
import { DEFAULT_SENSITIVITY_POLICY_PACKAGE_ID } from '../shared/policyCatalogue.js';
import * as defaults from '../src/lib/experimentRunDefaults.js';
import { restoreScenarioDraft, type ScenarioDraftV1 } from '../src/lib/scenarioDraft.js';
import { restoreSensitivityDraft, type SensitivityDraftV1 } from '../src/lib/sensitivityDraft.js';
import { applyPolicyPracticeDefaults } from '../src/lib/policyPractice.js';
import { applySensitivityPracticeDefaults, SENSITIVITY_PRACTICE_SETTINGS } from '../src/lib/sensitivityPractice.js';

// Run the real options loader with controlled responses; no browser, API or draft storage is touched.
const source = fs.readFileSync(new URL('../src/pages/experiments/run/useExperimentRunController.ts', import.meta.url), 'utf8');
const sourceFile = ts.createSourceFile('controller.ts', source, ts.ScriptTarget.Latest, true);
const definitions = new Map<string, string>();
const setters = new Set<string>();
function visit(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.initializer) {
    const name = node.name.getText(sourceFile);
    if (name === 'refreshOptions' || name === 'load') definitions.set(name, `const ${name} = ${node.initializer.getText(sourceFile)};`);
  }
  if (ts.isFunctionDeclaration(node) && node.name && ['parsePositiveInteger', 'defaultMaxWorkers'].includes(node.name.text)) {
    definitions.set(node.name.text, node.getText(sourceFile));
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^set[A-Z]/.test(node.expression.text)) setters.add(node.expression.text);
  ts.forEachChild(node, visit);
}
visit(sourceFile);
assert.equal(definitions.size, 4);
const executable = ts.transpileModule([...definitions.values()].join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

function payload(baseline: string, population = 10000): ModelRunOptionsPayload {
  return {
    executionEnabled: true, sensitivityMaxWorkersCap: 4, defaultBaseline: baseline, requestedBaseline: baseline,
    snapshots: [{ version: baseline, status: 'stable', evidenceYear: 2024, outputCalibrated: true }],
    defaultBasePolicy: '2024',
    basePolicies: [{ id: '2024', title: '2024', summary: '', values: { CENTRAL_BANK_LTI_SOFT_MAX_FTB: 4.5 } }],
    sensitivityPolicyPackages: [{ id: DEFAULT_SENSITIVITY_POLICY_PACKAGE_ID, title: 'LTI', description: '', type: 'number', parameterKeys: ['CENTRAL_BANK_LTI_SOFT_MAX_FTB'] }],
    parameters: [
      { key: 'N_SIMS', title: '', description: '', group: 'General model control', type: 'integer', defaultValue: 1 },
      { key: 'N_STEPS', title: '', description: '', group: 'General model control', type: 'integer', defaultValue: 2000 },
      { key: 'TARGET_POPULATION', title: '', description: '', group: 'General model control', type: 'integer', defaultValue: population },
      { key: 'recordTransactions', title: '', description: '', group: 'General model control', type: 'boolean', defaultValue: false },
      { key: 'recordCoreIndicators', title: '', description: '', group: 'General model control', type: 'boolean', defaultValue: true }
    ]
  };
}

type Workspace = 'manual' | 'sensitivity';
interface Request {
  baseline: string | undefined;
  resolve: (value: ModelRunOptionsPayload) => void;
  reject: (error: Error) => void;
}
function harness(activeType: Workspace, stored: ScenarioDraftV1 | SensitivityDraftV1 | null = null, practice = false) {
  const requests: Request[] = [];
  const state: Record<string, unknown> = {};
  const calls: string[] = [];
  const jobsLifecycleRef: { current: symbol | null } = { current: Symbol('mounted') };
  const context = vm.createContext({
    ...defaults, DEFAULT_SENSITIVITY_POLICY_PACKAGE_ID, restoreScenarioDraft, restoreSensitivityDraft,
    applyPolicyPracticeDefaults, applySensitivityPracticeDefaults, SENSITIVITY_PRACTICE_SETTINGS,
    activeType, draftId: stored || practice ? 'isolated-draft' : '', selectedJobRef: 'manual:existing-job',
    hasPolicyPracticeIdentity: practice && activeType === 'manual', hasSensitivityPracticeIdentity: practice && activeType === 'sensitivity',
    manualLockedParameterKeys: [], formValues: {}, skipSensitivityRangeResetForPackage: { current: '' },
    jobsLifecycleRef, optionsRequestRef: { current: 0 }, cancelled: false, URLSearchParams,
    window: { location: { search: '' }, navigator: { hardwareConcurrency: 8 } },
    fetchModelRunOptions: (baseline?: string) => new Promise<ModelRunOptionsPayload>((resolve, reject) => requests.push({ baseline, resolve, reject })),
    readScenarioDraft: () => activeType === 'manual' ? stored : null,
    readSensitivityDraft: () => activeType === 'sensitivity' ? stored : null,
    refreshJobs: async () => { calls.push('refreshJobs'); },
    onSelectedJobRefChange: () => { calls.push('onSelectedJobRefChange'); },
    ...Object.fromEntries([...setters].map((name) => [name, (value: unknown) => {
      state[name] = value;
      calls.push(name);
    }]))
  });
  vm.runInContext(executable, context);
  return {
    requests, state, calls, jobsLifecycleRef,
    refresh: vm.runInContext('refreshOptions', context) as (baseline?: string, hydrate?: boolean) => Promise<ModelRunOptionsPayload | null>,
    load: vm.runInContext('load', context) as () => Promise<void>
  };
}

for (const workspace of ['manual', 'sensitivity'] as const) {
  const newest = harness(workspace);
  const old = newest.refresh('old');
  const current = newest.refresh('new');
  const selected = payload('new', 20000);
  newest.requests[1].resolve(selected);
  assert.equal(await current, selected);
  const settledCalls = newest.calls.length;
  newest.requests[0].resolve(payload('old', 5000));
  assert.equal(await old, null);
  assert.equal(newest.calls.length, settledCalls, `${workspace}: a late success must not update any state`);
  assert.equal(newest.state.setSelectedBaseline, 'new');
  assert.equal((newest.state.setFormValues as Record<string, unknown>).TARGET_POPULATION, '20000');
  assert.equal((newest.state.setSensitivityFormValues as Record<string, unknown>).TARGET_POPULATION, '20000');

  // A stale error cannot end the newer request's loading state or display an obsolete error.
  const pending = harness(workspace);
  const first = pending.refresh('old');
  const second = pending.refresh('new');
  const pendingCalls = pending.calls.length;
  pending.requests[0].reject(new Error('Old model unavailable'));
  await first;
  assert.equal(pending.calls.length, pendingCalls);
  assert.equal(pending.state.setIsLoadingOptions, true);
  assert.equal(pending.state.setOptionsError, '');
  pending.requests[1].resolve(payload('new'));
  await second;
  assert.equal(pending.state.setIsLoadingOptions, false);

  const failed = harness(workspace);
  const superseded = failed.refresh('old');
  const failing = failed.refresh('new');
  failed.requests[1].reject(new Error('Latest model unavailable'));
  await failing;
  const failedCalls = failed.calls.length;
  failed.requests[0].resolve(payload('old'));
  await superseded;
  assert.equal(failed.calls.length, failedCalls, 'An older success cannot hide a newer failure');
  assert.equal(failed.state.setOptionsError, 'Latest model unavailable');
  assert.equal(failed.state.setIsLoadingOptions, false);
  const retry = failed.refresh('new', true);
  failed.requests[2].resolve(payload('new'));
  await retry;
  assert.equal(failed.state.setOptionsError, '');
  assert.equal(failed.state.setSelectedBaseline, 'new');
  assert.equal(failed.state.setDraftHydrated, true);

  for (const fail of [false, true]) {
    const leaving = harness(workspace);
    const request = leaving.refresh('pending');
    leaving.jobsLifecycleRef.current = null;
    const callsBeforeReply = leaving.calls.length;
    if (fail) leaving.requests[0].reject(new Error('Disconnected'));
    else leaving.requests[0].resolve(payload('pending'));
    assert.equal(await request, null);
    assert.equal(leaving.calls.length, callsBeforeReply, 'Unmounted requests must not update state');
    assert.equal(await leaving.refresh('after-unmount'), null);
    assert.equal(leaving.requests.length, 1);
  }

  const remount = harness(workspace);
  const previousLifecycle = remount.refresh('before-remount');
  remount.jobsLifecycleRef.current = Symbol('StrictMode setup');
  remount.requests[0].resolve(payload('before-remount'));
  assert.equal(await previousLifecycle, null, 'A new lifecycle must reject the old setup response');
  assert.equal(remount.state.setSelectedBaseline, undefined);

  const initial = harness(workspace);
  const initialLoad = initial.load();
  const modelChange = initial.refresh('chosen');
  initial.requests[1].resolve(payload('chosen'));
  await modelChange;
  initial.requests[0].resolve(payload('old-initial'));
  await initialLoad;
  assert.equal(initial.state.setSelectedBaseline, 'chosen');
  assert.equal(initial.calls.includes('setJobs'), false, 'A superseded initial loader must not clear the queue');
  assert.equal(initial.calls.includes('onSelectedJobRefChange'), false);

  const stored: SensitivityDraftV1 = {
    version: 1, title: 'Saved work', calibratedModel: 'saved', basePolicy: '2024',
    formValues: { TARGET_POPULATION: '4321', N_SIMS: '3', N_STEPS: '900', recordTransactions: false }, maxWorkers: '2',
    policyPackageId: DEFAULT_SENSITIVITY_POLICY_PACKAGE_ID, min: '4', max: '5', sampleCount: '3'
  };
  const restoring = harness(workspace, stored);
  const restore = restoring.load();
  assert.equal(restoring.requests[0].baseline, 'saved');
  restoring.requests[0].resolve(payload('saved'));
  await restore;
  assert.equal(restoring.state[workspace === 'manual' ? 'setTitle' : 'setSensitivityTitle'], 'Saved work');
  assert.equal((restoring.state[workspace === 'manual' ? 'setFormValues' : 'setSensitivityFormValues'] as Record<string, unknown>).TARGET_POPULATION, '4321');
  assert.equal(restoring.state[workspace === 'manual' ? 'setManualMaxWorkers' : 'setSensitivityMaxWorkers'], '2');
  assert.equal(restoring.state.setDraftHydrated, true);
  assert.ok(restoring.calls.includes('refreshJobs'), 'The current initial load still refreshes the queue');

  const practice = harness(workspace, null, true);
  const practiceLoad = practice.load();
  practice.requests[0].resolve(payload('practice'));
  await practiceLoad;
  const practiceValues = practice.state[workspace === 'manual' ? 'setFormValues' : 'setSensitivityFormValues'] as Record<string, unknown>;
  assert.equal(practiceValues.N_SIMS, '1');
  assert.equal(practiceValues.N_STEPS, '600');
  assert.equal(practiceValues.TARGET_POPULATION, '1000');
  assert.equal(practiceValues.recordTransactions, workspace === 'manual');
  assert.equal(practice.state.setDraftHydrated, true);
}

console.log('Experiment options race tests passed (latest selection, errors, loading, lifecycle, retries and draft/practice hydration).');
