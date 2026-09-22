import assert from 'node:assert/strict';
import {
  readScenarioDraft,
  scenarioDraftStorageKey,
  updateScenarioDraftModel,
  updateScenarioDraftStep,
  writeScenarioDraft,
  type ScenarioDraftV1
} from '../src/lib/scenarioDraft.js';
import {
  readSensitivityDraft,
  sensitivityDraftStorageKey,
  updateSensitivityDraftModel,
  updateSensitivityDraftStep,
  writeSensitivityDraft,
  type SensitivityDraftV1
} from '../src/lib/sensitivityDraft.js';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  }
});

const scenario: ScenarioDraftV1 = {
  version: 1,
  title: 'Policy draft',
  calibratedModel: 'v5o3',
  basePolicy: '2024',
  formValues: { N_SIMS: '10', recordTransactions: true },
  maxWorkers: '2',
  lockedParameterKeys: ['N_SIMS']
};
const sensitivity: SensitivityDraftV1 = {
  version: 1,
  title: 'Sensitivity draft',
  calibratedModel: 'v5o3',
  basePolicy: '2024',
  policyPackageId: 'owner_occupier_lti_soft_max',
  min: '3',
  max: '5',
  sampleCount: '5',
  formValues: { N_SIMS: '10', recordTransactions: true },
  maxWorkers: '2'
};

// The two experiment types must remain independent even if their IDs happen to match.
const draftId = 'shared-draft-id';
writeScenarioDraft(draftId, scenario);
writeSensitivityDraft(draftId, sensitivity);
assert.equal(readScenarioDraft(draftId)?.currentStep, undefined, 'Existing policy drafts remain readable');
assert.equal(readSensitivityDraft(draftId)?.currentStep, undefined, 'Existing sensitivity drafts remain readable');

assert.equal(updateScenarioDraftStep(draftId, 3), true);
assert.equal(updateSensitivityDraftStep(draftId, 1), true);
assert.deepEqual(readScenarioDraft(draftId), { ...scenario, currentStep: 3 });
assert.deepEqual(readSensitivityDraft(draftId), { ...sensitivity, currentStep: 1 });

for (const invalidStep of [-1, 5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.equal(updateScenarioDraftStep(draftId, invalidStep), false);
  assert.equal(updateSensitivityDraftStep(draftId, invalidStep), false);
}
assert.deepEqual(readScenarioDraft(draftId), { ...scenario, currentStep: 3 }, 'Invalid steps must not alter policy settings');
assert.deepEqual(readSensitivityDraft(draftId), { ...sensitivity, currentStep: 1 }, 'Invalid steps must not alter sensitivity settings');

assert.equal(updateScenarioDraftStep('missing', 2), false, 'Step changes cannot create an unhydrated policy draft');
assert.equal(updateSensitivityDraftStep('missing', 2), false, 'Step changes cannot create an unhydrated sensitivity draft');
assert.equal(values.has(scenarioDraftStorageKey('missing')), false);
assert.equal(values.has(sensitivityDraftStorageKey('missing')), false);

assert.equal(updateScenarioDraftModel(draftId, 'v4'), true);
assert.equal(updateSensitivityDraftModel(draftId, 'v4'), true);
assert.deepEqual(readScenarioDraft(draftId), { ...scenario, calibratedModel: 'v4', currentStep: 3 });
assert.deepEqual(readSensitivityDraft(draftId), { ...sensitivity, calibratedModel: 'v4', currentStep: 1 });

for (const invalidStep of [-1, 5, 1.5, '2', null]) {
  sessionStorage.setItem(scenarioDraftStorageKey(draftId), JSON.stringify({ ...scenario, currentStep: invalidStep }));
  sessionStorage.setItem(sensitivityDraftStorageKey(draftId), JSON.stringify({ ...sensitivity, currentStep: invalidStep }));
  assert.deepEqual(readScenarioDraft(draftId), scenario, 'Ignore invalid stored policy steps while retaining the draft');
  assert.deepEqual(readSensitivityDraft(draftId), sensitivity, 'Ignore invalid stored sensitivity steps while retaining the draft');
}

for (const currentStep of [0, 4]) {
  writeScenarioDraft(draftId, { ...scenario, currentStep });
  writeSensitivityDraft(draftId, { ...sensitivity, currentStep });
  assert.equal(readScenarioDraft(draftId)?.currentStep, currentStep);
  assert.equal(readSensitivityDraft(draftId)?.currentStep, currentStep);
}

console.log('Experiment draft step tests passed.');
