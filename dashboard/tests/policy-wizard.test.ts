import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { BASE_POLICY_OPTIONS, CENTRAL_BANK_POLICY_KEYS } from '../shared/policyCatalogue.js';
import { CENTRAL_BANK_POLICY_DISPLAY, formatPolicyValue } from '../shared/policyDisplay.js';
import type { ModelRunParameterDefinition, ModelRunSnapshotOption } from '../shared/types.js';
import { ManualRunSetupCard } from '../src/pages/run-experiments/ManualRunSetupCard.js';

const noop = () => {};
const basePolicy = BASE_POLICY_OPTIONS.find((policy) => policy.id === '2024');
assert.ok(basePolicy, 'Expected the 2024 reference policy');

const snapshot: ModelRunSnapshotOption = {
  version: 'v5o3',
  status: 'stable',
  evidenceYear: 2024,
  outputCalibrated: true
};

const policyParameters: ModelRunParameterDefinition[] = CENTRAL_BANK_POLICY_KEYS.map((key) => ({
  key,
  title: CENTRAL_BANK_POLICY_DISPLAY[key].label,
  description: '',
  group: 'Central Bank policy',
  type: key === 'CENTRAL_BANK_LTI_MONTHS_TO_CHECK' ? 'integer' : 'number',
  defaultValue: basePolicy.values[key]
}));

const generalParameters: ModelRunParameterDefinition[] = [
  {
    key: 'N_STEPS', title: 'Simulation duration', description: '',
    group: 'General model control', type: 'integer', defaultValue: 3500
  },
  {
    key: 'N_SIMS', title: 'Monte Carlo runs', description: '',
    group: 'General model control', type: 'integer', defaultValue: 3
  },
  {
    key: 'recordCoreIndicators', title: 'Record core indicators', description: '',
    group: 'General model control', type: 'boolean', defaultValue: true
  },
  {
    key: 'recordTransactions', title: 'Record transactions', description: '',
    group: 'General model control', type: 'boolean', defaultValue: false
  }
];

const baselineFormValues: Record<string, string | boolean> = {
  N_STEPS: '3500',
  N_SIMS: '3',
  recordCoreIndicators: true,
  recordTransactions: false,
  ...Object.fromEntries(CENTRAL_BANK_POLICY_KEYS.map((key) => [key, String(basePolicy.values[key])]))
};

const commonProps = {
  formDisabled: false,
  submissionDisabled: false,
  submissionDisabledReason: '',
  isLoadingOptions: false,
  selectedBaseline: snapshot.version,
  onBaselineChange: noop,
  basePolicies: [basePolicy],
  basePolicy: basePolicy.id,
  onBasePolicyChange: noop,
  snapshots: [snapshot],
  title: 'Tighter first-time buyer LTV',
  onTitleChange: noop,
  parameters: [...generalParameters, ...policyParameters],
  policyParameters,
  formValues: baselineFormValues,
  onFormValueChange: noop,
  maxWorkers: '2',
  onMaxWorkersChange: noop,
  warnings: [],
  isSubmitting: false,
  manualSubmissionLockedBySensitivity: false,
  lockMessage: null,
  onSubmit: noop
};

const firstStepMarkup = renderToStaticMarkup(
  createElement(MemoryRouter, null, createElement(ManualRunSetupCard, commonProps))
);
assert.ok(firstStepMarkup.includes('Review and start'), 'The policy wizard should expose a fifth review step');
assert.equal(firstStepMarkup.includes('Start policy scenario'), false, 'Submission must not appear before review');

const unchangedReviewMarkup = renderToStaticMarkup(
  createElement(MemoryRouter, null, createElement(ManualRunSetupCard, { ...commonProps, initialStep: 4 }))
);
assert.ok(unchangedReviewMarkup.includes('Start policy scenario'), 'Submission should appear on the final step');
assert.ok(
  unchangedReviewMarkup.includes('Scenario name') &&
    unchangedReviewMarkup.includes('Model') &&
    unchangedReviewMarkup.includes('Reference policy') &&
    unchangedReviewMarkup.includes('Run settings') &&
    unchangedReviewMarkup.includes('Recording configuration'),
  'The review should summarise the complete scenario and execution setup'
);
assert.equal(
  (unchangedReviewMarkup.match(/scenario-policy-review-status is-unchanged/g) ?? []).length,
  CENTRAL_BANK_POLICY_KEYS.length,
  'Every baseline-matching policy setting should be marked Unchanged'
);
assert.equal(
  (unchangedReviewMarkup.match(/scenario-policy-review-status is-changed/g) ?? []).length,
  0,
  'An unchanged reference scenario should not show changed policy settings'
);

for (const key of CENTRAL_BANK_POLICY_KEYS) {
  const display = CENTRAL_BANK_POLICY_DISPLAY[key];
  assert.ok(unchangedReviewMarkup.includes(display.label), `Expected review row for ${display.label}`);
  assert.ok(
    unchangedReviewMarkup.includes(formatPolicyValue(basePolicy.values[key], display.unit)),
    `Expected review value for ${display.label}`
  );
}

const changedReviewMarkup = renderToStaticMarkup(
  createElement(
    MemoryRouter,
    null,
    createElement(ManualRunSetupCard, {
      ...commonProps,
      initialStep: 4,
      formValues: { ...baselineFormValues, CENTRAL_BANK_LTV_HARD_MAX_FTB: '0.9' }
    })
  )
);
assert.equal((changedReviewMarkup.match(/scenario-policy-review-status is-changed/g) ?? []).length, 1);
assert.equal(
  (changedReviewMarkup.match(/scenario-policy-review-status is-unchanged/g) ?? []).length,
  CENTRAL_BANK_POLICY_KEYS.length - 1
);
assert.ok(
  changedReviewMarkup.includes('90%') && changedReviewMarkup.includes('Reference: 95%'),
  'A changed policy row should show its new value and reference value'
);

const warningMarkup = renderToStaticMarkup(
  createElement(
    MemoryRouter,
    null,
    createElement(ManualRunSetupCard, {
      ...commonProps,
      initialStep: 4,
      warnings: [{ code: 'runtime', message: 'This scenario may take longer.', severity: 'warning' }]
    })
  )
);
assert.ok(warningMarkup.includes('Confirm and start') && warningMarkup.includes('This scenario may take longer.'));

console.log('Policy wizard tests passed.');
