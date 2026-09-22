import assert from 'node:assert/strict';
import type { ModelRunOptionsPayload } from '../shared/types.js';
import {
  readScenarioDraft,
  restoreScenarioDraft,
  scenarioDraftStorageKey,
  updateScenarioDraftModel,
  updateScenarioDraftStep,
  writeScenarioDraft,
  type ScenarioDraftV1
} from '../src/lib/scenarioDraft.js';

const options: ModelRunOptionsPayload = {
  executionEnabled: false,
  snapshots: ['v0o7', 'v5o3'].map((version) => ({
    version, status: 'stable', evidenceYear: 2024, outputCalibrated: true
  })),
  defaultBaseline: 'v0o7',
  requestedBaseline: 'v0o7',
  parameters: [
    { key: 'N_STEPS', title: 'Duration', description: '', group: 'General model control', type: 'integer', defaultValue: 3500 },
    { key: 'N_SIMS', title: 'Seeds', description: '', group: 'General model control', type: 'integer', defaultValue: 8 },
    { key: 'recordTransactions', title: 'Record transactions', description: '', group: 'General model control', type: 'boolean', defaultValue: true },
    { key: 'recordCoreIndicators', title: 'Core indicators', description: '', group: 'General model control', type: 'boolean', defaultValue: true }
  ],
  basePolicies: [{ id: '2024', title: '2024', summary: '', values: {} }],
  defaultBasePolicy: '2024',
  sensitivityPolicyPackages: []
};

const fallback: ScenarioDraftV1 = {
  version: 1,
  title: '',
  calibratedModel: 'v0o7',
  basePolicy: '2024',
  formValues: { N_STEPS: '3500', N_SIMS: '8', recordTransactions: true, recordCoreIndicators: true },
  maxWorkers: '1'
};
const legacy: ScenarioDraftV1 = {
  ...fallback,
  title: 'Existing policy scenario',
  formValues: { N_STEPS: '4000', N_SIMS: '4', recordTransactions: false, recordCoreIndicators: true },
  maxWorkers: '2',
  currentStep: 3,
  lockedParameterKeys: ['N_SIMS']
};
const values = new Map<string, string>();
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  }
});

function readDraft(draftId: string): ScenarioDraftV1 {
  const draft = readScenarioDraft(draftId);
  assert.ok(draft, `Expected saved draft ${draftId}`);
  return draft;
}

try {
  writeScenarioDraft('legacy', legacy);
  assert.equal(readDraft('legacy').recordingDefaultsVersion, undefined, 'Saving a legacy draft must not mark its defaults as migrated');
  const migrated = restoreScenarioDraft(readDraft('legacy'), options, fallback).draft;
  assert.deepEqual(migrated, {
    ...legacy,
    formValues: { ...legacy.formValues, recordTransactions: true },
    recordingDefaultsVersion: 1
  }, 'Legacy recording defaults should update once while preserving the saved setup and wizard step');
  assert.equal(legacy.formValues.recordTransactions, false, 'Restoration must not mutate the stored input');
  writeScenarioDraft('legacy', migrated);
  assert.deepEqual(readDraft('legacy'), migrated, 'The migration marker must survive a storage round trip');

  const optedOut: ScenarioDraftV1 = {
    ...migrated,
    formValues: { ...migrated.formValues, recordTransactions: false }
  };
  writeScenarioDraft('opted-out', optedOut);
  assert.equal(
    restoreScenarioDraft(readDraft('opted-out'), options, fallback).draft.formValues.recordTransactions,
    false,
    'An explicit opt-out after migration must survive reopening'
  );
  assert.equal(updateScenarioDraftStep('opted-out', 4), true);
  assert.equal(updateScenarioDraftModel('opted-out', 'v5o3'), true);
  const reopened = restoreScenarioDraft(readDraft('opted-out'), options, fallback).draft;
  assert.equal(reopened.recordingDefaultsVersion, 1, 'Step and model updates must retain the migration marker');
  assert.equal(reopened.formValues.recordTransactions, false, 'Step and model updates must retain an explicit opt-out');
  assert.equal(reopened.currentStep, 4);
  assert.equal(reopened.calibratedModel, 'v5o3');

  writeScenarioDraft('unmigrated', legacy);
  assert.equal(updateScenarioDraftStep('unmigrated', 4), true);
  assert.equal(updateScenarioDraftModel('unmigrated', 'v5o3'), true);
  const stillLegacy = readDraft('unmigrated');
  assert.equal(stillLegacy.recordingDefaultsVersion, undefined, 'Step and model updates must not bypass the defaults migration');
  assert.equal(stillLegacy.formValues.recordTransactions, false, 'Navigation alone must not change a draft field');
  assert.equal(restoreScenarioDraft(stillLegacy, options, fallback).draft.formValues.recordTransactions, true);

  const locked = restoreScenarioDraft({
    ...legacy,
    lockedParameterKeys: ['N_SIMS', 'recordTransactions']
  }, options, fallback).draft;
  assert.equal(locked.formValues.recordTransactions, false, 'A workflow-locked recording choice must be preserved');
  assert.equal(locked.recordingDefaultsVersion, 1);
  assert.deepEqual(locked.lockedParameterKeys, ['N_SIMS', 'recordTransactions']);

  const partial = restoreScenarioDraft({
    ...legacy,
    formValues: { N_STEPS: '4000', N_SIMS: '4' }
  }, options, fallback).draft;
  assert.equal(partial.formValues.recordTransactions, true, 'A partial draft must inherit the current recording default');
  assert.equal(partial.recordingDefaultsVersion, 1);
  assert.equal(partial.formValues.N_STEPS, '4000');
  assert.equal(partial.formValues.N_SIMS, '4');

  for (const invalidVersion of [0, 2, '1', null]) {
    sessionStorage.setItem(scenarioDraftStorageKey('invalid-marker'), JSON.stringify({
      ...legacy, recordingDefaultsVersion: invalidVersion
    }));
    assert.equal(readDraft('invalid-marker').recordingDefaultsVersion, undefined, 'Only the supported numeric marker may preserve the old recording choice');
  }
  console.log('Policy recording default migration tests passed.');
} finally {
  if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage);
  else Reflect.deleteProperty(globalThis, 'sessionStorage');
}
