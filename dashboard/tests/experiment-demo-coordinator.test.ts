import assert from 'node:assert/strict';
import {
  EXPERIMENT_DEMO_SESSION_KEY,
  LEGACY_POLICY_EXPERIMENT_DEMO_SESSION_KEY,
  buildExperimentDemoLaunchHref,
  clearExperimentDemoState,
  completeExperimentDemoChapter,
  commitExperimentDemoValue,
  continueExperimentDemoToSensitivity,
  createExperimentDemoProgress,
  experimentDemoLaunchMode,
  isExperimentDemoPolicyDraftId,
  isExperimentDemoRequested,
  isExperimentDemoSensitivityDraftId,
  parseExperimentDemoProgress,
  readExperimentDemoProgress,
  setExperimentDemoPaused,
  updateExperimentDemoStep,
  updatePolicyPracticeRun,
  buildPolicyPracticeResultsHref,
  writeExperimentDemoProgress,
  persistPolicyPracticeProgress,
  type SessionStorageLike
} from '../src/lib/experimentDemo.js';
import { scenarioDraftStorageKey } from '../src/lib/scenarioDraft.js';
import { sensitivityDraftStorageKey } from '../src/lib/sensitivityDraft.js';

class MemoryStorage implements SessionStorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const journeyId = 'experiment-demo-coordinator-test';
const initial = createExperimentDemoProgress('both', journeyId);
assert.equal(initial.journeyId, journeyId);
assert.equal(initial.mode, 'both');
assert.equal(initial.phase, 'policy', 'Combined mode must always start with Policy');
assert.equal(isExperimentDemoPolicyDraftId(initial.policy.draftId), true);
assert.equal(isExperimentDemoSensitivityDraftId(initial.sensitivity.draftId), true);
assert.notEqual(initial.policy.draftId, initial.sensitivity.draftId);

const storage = new MemoryStorage();
const ordinaryPolicyDraft = 'ordinary-policy-draft';
const ordinarySensitivityDraft = 'ordinary-sensitivity-draft';
storage.setItem('scenario-draft:v1:active', ordinaryPolicyDraft);
storage.setItem('sensitivity-draft:v1:active', ordinarySensitivityDraft);
storage.setItem(scenarioDraftStorageKey(ordinaryPolicyDraft), '{"ordinary":"policy"}');
storage.setItem(sensitivityDraftStorageKey(ordinarySensitivityDraft), '{"ordinary":"sensitivity"}');
storage.setItem(scenarioDraftStorageKey(initial.policy.draftId), '{"demo":"policy"}');
storage.setItem(sensitivityDraftStorageKey(initial.sensitivity.draftId), '{"demo":"sensitivity"}');

writeExperimentDemoProgress(initial, storage);
persistPolicyPracticeProgress(initial, storage);
assert.throws(() => persistPolicyPracticeProgress(initial, null), /could not be saved/);
assert.throws(() => persistPolicyPracticeProgress(initial, { ...storage, getItem: () => null, setItem: () => {}, removeItem: () => {} }), /could not be saved/, 'Silently discarded storage cannot authorize a real request');
assert.throws(() => persistPolicyPracticeProgress(initial, { ...storage, getItem: () => null, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} }), /could not be saved/, 'Blocked storage must prevent submission');
assert.deepEqual(readExperimentDemoProgress(storage), initial);
assert.deepEqual(parseExperimentDemoProgress(JSON.stringify(initial)), initial);
assert.equal(parseExperimentDemoProgress('{broken'), null);
assert.equal(parseExperimentDemoProgress(JSON.stringify({ ...initial, version: 1 })), null);
assert.equal(
  parseExperimentDemoProgress(JSON.stringify({ ...initial, mode: 'policy', phase: 'sensitivity' })),
  null,
  'Malformed mode/phase combinations fail safely'
);

const namedPolicyStep = updateExperimentDemoStep(initial, {
  journeyId,
  chapter: 'policy',
  draftId: initial.policy.draftId,
  stepId: 'policy-model',
  fingerprint: '{"model":"v5o3"}'
});
assert.equal(namedPolicyStep.policy.stepId, 'policy-model');
assert.equal(namedPolicyStep.policy.fingerprint, '{"model":"v5o3"}');
assert.equal(namedPolicyStep.sensitivity.stepId, initial.sensitivity.stepId);

const staleStep = updateExperimentDemoStep(namedPolicyStep, {
  journeyId: 'experiment-demo-stale-journey',
  chapter: 'policy',
  draftId: initial.policy.draftId,
  stepId: 'policy-complete',
  fingerprint: ''
});
assert.equal(staleStep, namedPolicyStep, 'A stale journey event must not mutate progress');

const staleDraftCompletion = completeExperimentDemoChapter(namedPolicyStep, {
  journeyId,
  chapter: 'policy',
  draftId: 'experiment-demo-policy-v2-stale'
});
assert.equal(staleDraftCompletion, namedPolicyStep, 'A stale draft event must not advance the journey');

const policyComplete = completeExperimentDemoChapter(namedPolicyStep, {
  journeyId,
  chapter: 'policy',
  draftId: initial.policy.draftId
});
assert.equal(policyComplete.phase, 'policy-transition');
assert.equal(
  continueExperimentDemoToSensitivity(policyComplete, 'experiment-demo-stale-journey'),
  policyComplete,
  'A stale transition event must not change chapters'
);
const sensitivityStarted = continueExperimentDemoToSensitivity(policyComplete, journeyId);
assert.equal(sensitivityStarted.phase, 'sensitivity');
assert.equal(sensitivityStarted.policy.draftId, initial.policy.draftId, 'Policy draft survives the transition');
assert.equal(sensitivityStarted.sensitivity.draftId, initial.sensitivity.draftId);

const sensitivityComplete = completeExperimentDemoChapter(sensitivityStarted, {
  journeyId,
  chapter: 'sensitivity',
  draftId: initial.sensitivity.draftId
});
assert.equal(sensitivityComplete.phase, 'complete');
assert.equal(setExperimentDemoPaused(sensitivityComplete, journeyId, true).paused, true);
assert.equal(
  setExperimentDemoPaused(sensitivityComplete, 'experiment-demo-stale-journey', true),
  sensitivityComplete
);

const standalonePolicy = createExperimentDemoProgress('policy', 'experiment-demo-policy-only');
assert.equal(standalonePolicy.phase, 'policy');
assert.equal(
  completeExperimentDemoChapter(standalonePolicy, {
    journeyId: standalonePolicy.journeyId,
    chapter: 'policy',
    draftId: standalonePolicy.policy.draftId
  }).phase,
  'policy-transition'
);
const standaloneSensitivity = createExperimentDemoProgress(
  'sensitivity',
  'experiment-demo-sensitivity-only'
);
assert.equal(standaloneSensitivity.phase, 'sensitivity');

const commitEvent = { journeyId, chapter: 'policy' as const, draftId: initial.policy.draftId, field: 'name' as const, value: 'Bank Rate rise' };
const committed = commitExperimentDemoValue(initial, commitEvent);
assert.equal(committed.policy.committedValues?.name, 'Bank Rate rise');
assert.equal(parseExperimentDemoProgress(JSON.stringify(committed))?.policy.committedValues?.name, 'Bank Rate rise', 'Refresh preserves actual commit evidence separately from typed draft values');
assert.equal(commitExperimentDemoValue(committed, commitEvent), committed, 'Repeated commit is idempotent');
assert.equal(commitExperimentDemoValue(committed, { ...commitEvent, journeyId: 'stale' }), committed);
assert.equal(commitExperimentDemoValue(committed, { ...commitEvent, draftId: 'stale' }), committed);
const bankCommitted = commitExperimentDemoValue(committed, { ...commitEvent, field: 'bankRate', value: '0.0610833333' });
assert.equal(bankCommitted.policy.committedValues?.bankRate, '0.0610833333');
const edited = commitExperimentDemoValue(bankCommitted, { ...commitEvent, field: 'bankRate', value: '' });
assert.equal(edited.policy.committedValues?.bankRate, '', 'Editing invalidates acknowledgement until the next commit');
assert.equal(edited.policy.committedValues?.name, 'Bank Rate rise');

const runEvent = { journeyId, chapter: 'policy' as const, draftId: initial.policy.draftId };
const pendingRun = { status: 'submitting' as const, title: 'Bank Rate rise practice unique' };
const submitting = updatePolicyPracticeRun(bankCommitted, { ...runEvent, run: pendingRun });
assert.deepEqual(parseExperimentDemoProgress(JSON.stringify(submitting))?.policy.submission, pendingRun, 'Refresh retains the pending identity and prevents blind repeat submission');
assert.equal(updatePolicyPracticeRun(submitting, { ...runEvent, journeyId: 'stale', run: undefined }), submitting);
assert.equal(updatePolicyPracticeRun(submitting, { ...runEvent, run: { ...pendingRun, title: 'Different attempt' } }), submitting);
const acceptedRun = { ...pendingRun, status: 'submitted' as const, runId: 'saved practice v0o7', jobRef: 'manual:practice-job' };
const accepted = updatePolicyPracticeRun(submitting, { ...runEvent, run: acceptedRun });
assert.equal(accepted.policy.stepId, 'policy-complete');
assert.equal(accepted.policy.draftId, initial.policy.draftId);
assert.deepEqual(accepted.policy.committedValues, bankCommitted.policy.committedValues);
assert.deepEqual(parseExperimentDemoProgress(JSON.stringify(accepted))?.policy.submission, acceptedRun);
assert.equal(updatePolicyPracticeRun(accepted, { ...runEvent, run: undefined }), accepted, 'Accepted run identity cannot be cleared to resubmit');
assert.equal(updatePolicyPracticeRun(submitting, { ...runEvent, run: undefined }).policy.submission, undefined, 'A definitive rejected request can return to its explicit Start action');
const practiceResults = new URL(buildPolicyPracticeResultsHref(acceptedRun.runId, acceptedRun.jobRef), 'http://dashboard.local');
assert.equal(practiceResults.pathname, '/results');
assert.equal(practiceResults.searchParams.get('presentation'), 'report', 'A submitted practice run opens the default Report presentation');
assert.equal(practiceResults.searchParams.get('baselineRunId'), acceptedRun.runId);
assert.equal(practiceResults.searchParams.get('jobRef'), acceptedRun.jobRef);
assert.equal(practiceResults.searchParams.has('practice'), false);
assert.equal(practiceResults.searchParams.has('journey'), false);
assert.equal(practiceResults.searchParams.get('resultsDemo'), 'policy-results');
assert.equal(practiceResults.searchParams.has('demo'), false, 'Own results must not launch the bundled example guide');

const combinedSensitivityUrl = new URL(
  buildExperimentDemoLaunchHref('both', journeyId, 'sensitivity'),
  'http://dashboard.local'
);
assert.equal(combinedSensitivityUrl.pathname, '/sensitivity/new');
assert.equal(combinedSensitivityUrl.searchParams.get('journey'), journeyId);
assert.equal(experimentDemoLaunchMode(combinedSensitivityUrl.searchParams), 'both');
assert.equal(isExperimentDemoRequested(combinedSensitivityUrl.searchParams, 'policy'), true);
assert.equal(isExperimentDemoRequested(combinedSensitivityUrl.searchParams, 'sensitivity'), true);

const legacyUrl = new URL('/scenarios/new?demo=experiment&segment=policy', 'http://dashboard.local');
assert.equal(experimentDemoLaunchMode(legacyUrl.searchParams), 'policy');

clearExperimentDemoState(journeyId, storage);
assert.equal(storage.getItem(EXPERIMENT_DEMO_SESSION_KEY), null);
assert.equal(storage.getItem(scenarioDraftStorageKey(initial.policy.draftId)), null);
assert.equal(storage.getItem(sensitivityDraftStorageKey(initial.sensitivity.draftId)), null);
assert.equal(storage.getItem('scenario-draft:v1:active'), ordinaryPolicyDraft);
assert.equal(storage.getItem('sensitivity-draft:v1:active'), ordinarySensitivityDraft);
assert.equal(storage.getItem(scenarioDraftStorageKey(ordinaryPolicyDraft)), '{"ordinary":"policy"}');
assert.equal(
  storage.getItem(sensitivityDraftStorageKey(ordinarySensitivityDraft)),
  '{"ordinary":"sensitivity"}'
);

const legacyStorage = new MemoryStorage();
const legacyDemoDraft = 'experiment-demo-policy-old-draft';
legacyStorage.setItem(
  LEGACY_POLICY_EXPERIMENT_DEMO_SESSION_KEY,
  JSON.stringify({ version: 1, draftId: legacyDemoDraft, stageId: 'continue' })
);
legacyStorage.setItem(scenarioDraftStorageKey(legacyDemoDraft), '{"legacy":true}');
clearExperimentDemoState('', legacyStorage);
assert.equal(legacyStorage.getItem(LEGACY_POLICY_EXPERIMENT_DEMO_SESSION_KEY), null);
assert.equal(legacyStorage.getItem(scenarioDraftStorageKey(legacyDemoDraft)), null);

console.log('Experiment demo coordinator tests passed.');
