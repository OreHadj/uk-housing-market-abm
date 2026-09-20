import assert from 'node:assert/strict';
import {
  EXPERIMENT_DEMO_SESSION_KEY,
  LEGACY_POLICY_EXPERIMENT_DEMO_SESSION_KEY,
  buildExperimentDemoLaunchHref,
  clearExperimentDemoState,
  completeExperimentDemoChapter,
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
  writeExperimentDemoProgress,
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
