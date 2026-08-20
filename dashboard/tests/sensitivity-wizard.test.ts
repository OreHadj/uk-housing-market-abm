import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type {
  BasePolicyOption,
  ModelRunParameterDefinition,
  ModelRunSnapshotOption,
  SensitivityPolicyPackageDefinition
} from '../shared/types.js';
import { createDevelopmentRuntimePaths } from '../server/lib/runtimePaths.js';
import { prepareSensitivityExperimentSubmission } from '../server/lib/sensitivityRuns.js';
import {
  buildSensitivityGeneralModelControlOverridesFromForm,
  normalizeSensitivityFormValues
} from '../src/lib/experimentRunDefaults.js';
import {
  SensitivitySetupCard,
  buildSensitivitySampleValues,
  validateSensitivityExperimentDetails,
  validateSensitivityModelAndBaseline,
  validateSensitivityRunSettings,
  validateSensitivitySweepDefinition
} from '../src/pages/run-experiments/SensitivitySetupCard.js';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../..');
const noop = () => {};

const snapshot: ModelRunSnapshotOption = {
  version: 'v5o3',
  status: 'stable',
  evidenceYear: 2024,
  outputCalibrated: true
};
const basePolicy: BasePolicyOption = {
  id: '2024',
  title: '2024 policy',
  summary: 'Current policy reference values.',
  values: {
    CENTRAL_BANK_LTI_SOFT_MAX_FTB: 4.5,
    CENTRAL_BANK_LTI_SOFT_MAX_HM: 4.5
  }
};
const policyPackage: SensitivityPolicyPackageDefinition = {
  id: 'owner_occupier_lti_soft_max',
  title: 'Owner-occupier soft LTI limit',
  description: 'Varies the FTB and home-mover soft LTI limit together.',
  parameterKeys: ['CENTRAL_BANK_LTI_SOFT_MAX_FTB', 'CENTRAL_BANK_LTI_SOFT_MAX_HM'],
  type: 'number'
};
const parameters: ModelRunParameterDefinition[] = [
  {
    key: 'N_STEPS', title: 'Simulation duration (steps)', description: '',
    group: 'General model control', type: 'integer', defaultValue: 3500
  },
  {
    key: 'N_SIMS', title: 'Monte Carlo runs', description: '',
    group: 'General model control', type: 'integer', defaultValue: 1
  },
  {
    key: 'TARGET_POPULATION', title: 'Target population', description: '',
    group: 'General model control', type: 'integer', defaultValue: 10000
  },
  {
    key: 'TIME_TO_START_RECORDING_TRANSACTIONS', title: 'Transaction recording start time', description: '',
    group: 'General model control', type: 'integer', defaultValue: 0
  },
  {
    key: 'recordCoreIndicators', title: 'Record core indicators', description: '',
    group: 'General model control', type: 'boolean', defaultValue: false
  },
  {
    key: 'recordTransactions', title: 'Record transactions', description: '',
    group: 'General model control', type: 'boolean', defaultValue: true
  },
  {
    key: 'recordNBidUpFrequency', title: 'Record bid-up frequency', description: '',
    group: 'General model control', type: 'boolean', defaultValue: true
  },
  {
    key: 'recordQualityBandPrice', title: 'Record quality-band prices', description: '',
    group: 'General model control', type: 'boolean', defaultValue: true
  },
  {
    key: 'recordHouseholdID', title: 'Record household ID', description: '',
    group: 'General model control', type: 'boolean', defaultValue: true
  }
];
const formValues = {
  N_STEPS: '3500',
  N_SIMS: '5',
  TARGET_POPULATION: '10000',
  TIME_TO_START_RECORDING_TRANSACTIONS: '1000',
  recordCoreIndicators: false,
  recordTransactions: true,
  recordNBidUpFrequency: true,
  recordQualityBandPrice: true,
  recordHouseholdID: true
};

assert.equal(validateSensitivityExperimentDetails(''), 'Enter an experiment name before continuing.');
assert.equal(validateSensitivityExperimentDetails('  LTI sweep  '), null);
assert.equal(
  validateSensitivitySweepDefinition(policyPackage, '5', '4', '5'),
  'Minimum value must be lower than maximum value.'
);
assert.equal(
  validateSensitivitySweepDefinition(policyPackage, '4', '5', '1.5'),
  'Sample count must be a whole number of at least 2.'
);
assert.equal(validateSensitivitySweepDefinition(policyPackage, '4', '5', '3'), null);
assert.equal(validateSensitivityModelAndBaseline(snapshot, basePolicy, policyPackage, '4', '5'), null);
assert.match(
  validateSensitivityModelAndBaseline(snapshot, basePolicy, policyPackage, '4.6', '5') ?? '',
  /must fall inside the sweep range/
);
assert.match(validateSensitivityRunSettings(parameters, { ...formValues, N_STEPS: '0' }, '2') ?? '', /at least 1/);
assert.match(validateSensitivityRunSettings(parameters, formValues, '5', 4) ?? '', /cannot exceed 4/);
assert.equal(validateSensitivityRunSettings(parameters, formValues, '2'), null);

assert.deepEqual(
  buildSensitivitySampleValues(policyPackage, basePolicy, '4', '5', '3'),
  ['4', '4.5', '5'],
  'The preview should show the de-duplicated sampled points, including the baseline'
);

const normalizedForm = normalizeSensitivityFormValues(parameters, formValues);
assert.equal(normalizedForm.recordCoreIndicators, true, 'Core indicators must remain enabled');
assert.equal(normalizedForm.recordTransactions, false, 'Discarded transaction exports must remain disabled');
assert.equal(normalizedForm.recordNBidUpFrequency, false, 'Discarded bid-up exports must remain disabled');
assert.equal(normalizedForm.recordQualityBandPrice, false, 'Discarded quality-band exports must remain disabled');
assert.equal(normalizedForm.recordHouseholdID, false, 'Discarded household exports must remain disabled');

const sensitivityOverrides = buildSensitivityGeneralModelControlOverridesFromForm(parameters, formValues);
assert.equal(sensitivityOverrides.recordCoreIndicators, true);
assert.equal(sensitivityOverrides.recordTransactions, false);
assert.equal(sensitivityOverrides.recordNBidUpFrequency, false);
assert.equal(sensitivityOverrides.recordQualityBandPrice, false);
assert.equal(sensitivityOverrides.recordHouseholdID, false);
assert.equal('TIME_TO_START_RECORDING_TRANSACTIONS' in sensitivityOverrides, false);
assert.equal(sensitivityOverrides.N_SIMS, 5);

const commonProps = {
  executionDisabled: false,
  isLoadingOptions: false,
  selectedBaseline: snapshot.version,
  onBaselineChange: noop,
  snapshots: [snapshot],
  basePolicies: [basePolicy],
  basePolicy: basePolicy.id,
  onBasePolicyChange: noop,
  policyPackages: [policyPackage],
  policyPackageId: policyPackage.id,
  onPolicyPackageChange: noop,
  minValue: '4',
  maxValue: '5',
  onMinValueChange: noop,
  onMaxValueChange: noop,
  sampleCount: '3',
  onSampleCountChange: noop,
  parameters,
  formValues,
  onFormValueChange: noop,
  maxWorkers: '4',
  onMaxWorkersChange: noop,
  title: 'Retained LTI sweep',
  onTitleChange: noop,
  selectedPackage: policyPackage,
  warnings: [],
  isSubmitting: false,
  isCanceling: false,
  sensitivitySubmissionLockedByManual: false,
  lockMessage: null,
  hasActiveSensitivityJob: false,
  onSubmit: noop,
  onCancelActive: noop
};

const firstStepMarkup = renderToStaticMarkup(
  createElement(MemoryRouter, null, createElement(SensitivitySetupCard, commonProps))
);
assert.equal(firstStepMarkup.includes('Start sensitivity analysis'), false, 'Submission must not appear before review');
assert.ok(firstStepMarkup.includes('Back') && firstStepMarkup.includes('Continue'));
assert.equal((firstStepMarkup.match(/role="tab"/g) ?? []).length, 0, 'The stepper should use step navigation, not result tabs');
assert.equal((firstStepMarkup.match(/<nav class="scenario-stepper sensitivity-stepper"/g) ?? []).length, 1);
const stepperMarkup = firstStepMarkup.slice(
  firstStepMarkup.indexOf('<nav class="scenario-stepper sensitivity-stepper"'),
  firstStepMarkup.indexOf('</nav>')
);
assert.equal(stepperMarkup.includes('disabled'), false, 'Every numbered sensitivity step should be clickable');
assert.ok(
  firstStepMarkup.includes('aria-label="Back to previous step"') &&
    firstStepMarkup.includes('aria-label="Continue to next step"') &&
    firstStepMarkup.includes('>←</span>') &&
    firstStepMarkup.includes('>→</span>'),
  'Back and Continue should render as accessible directional arrows'
);
for (const label of ['Experiment details', 'Define the sweep', 'Model and baseline', 'Run and recording', 'Review and start']) {
  assert.ok(firstStepMarkup.includes(label), `Expected sensitivity step ${label}`);
}

const reviewMarkup = renderToStaticMarkup(
  createElement(MemoryRouter, null, createElement(SensitivitySetupCard, { ...commonProps, initialStep: 4 }))
);
for (const reviewLabel of [
  'Experiment name', 'Policy instrument', 'Sweep range', 'Actual sampled values', 'Model', 'Baseline policy',
  'Simulation duration', 'Seeds per sampled point', 'Max workers', 'Recording configuration', 'Total model executions'
]) {
  assert.ok(reviewMarkup.includes(reviewLabel), `Expected review field ${reviewLabel}`);
}
assert.ok(reviewMarkup.includes('Retained LTI sweep') && reviewMarkup.includes('3 unique sampled points'));
assert.ok(reviewMarkup.includes('<strong>15</strong>'), 'Review should calculate unique points × seeds per point');
assert.ok(reviewMarkup.includes('Dashboard outcomes') && reviewMarkup.includes('raw output directory is discarded'));
assert.equal(reviewMarkup.includes('Record core indicators'), false, 'Core indicator recording must not be editable');
assert.equal(reviewMarkup.includes('Record transactions'), false, 'Discarded transaction recording must not be editable');
assert.ok(reviewMarkup.includes('Start sensitivity analysis'), 'Submission should appear on the final step');

const warningMarkup = renderToStaticMarkup(
  createElement(
    MemoryRouter,
    null,
    createElement(SensitivitySetupCard, {
      ...commonProps,
      initialStep: 4,
      warnings: [{ code: 'runtime', message: 'This run may take longer.', severity: 'warning' }]
    })
  )
);
assert.ok(warningMarkup.includes('Confirm and start') && warningMarkup.includes('This run may take longer.'));

const prepared = prepareSensitivityExperimentSubmission(
  createDevelopmentRuntimePaths(repoRoot),
  {
    baseline: 'v5o3',
    basePolicy: '2024',
    title: 'Recording policy test',
    policyPackageId: policyPackage.id,
    min: 4,
    max: 5,
    sampleCount: 3,
    overrides: {
      N_SIMS: 1,
      recordCoreIndicators: false,
      recordTransactions: true,
      recordNBidUpFrequency: true,
      recordQualityBandPrice: true,
      recordHouseholdID: true
    },
    maxWorkers: 1,
    confirmWarnings: true
  }
);
assert.equal(prepared.accepted, true);
if (prepared.accepted) {
  assert.equal(prepared.prepared.generalOverrides.recordCoreIndicators, true);
  assert.equal(prepared.prepared.generalOverrides.recordTransactions, false);
  assert.equal(prepared.prepared.generalOverrides.recordNBidUpFrequency, false);
  assert.equal(prepared.prepared.generalOverrides.recordQualityBandPrice, false);
  assert.equal(prepared.prepared.generalOverrides.recordHouseholdID, false);
}

console.log('Sensitivity wizard tests passed.');
