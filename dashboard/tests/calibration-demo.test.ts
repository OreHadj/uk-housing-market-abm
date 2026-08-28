import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { CompareResponse } from '../shared/types.js';
import {
  CALIBRATION_DEMO_REQUIRED_ACTION_STEPS,
  CALIBRATION_DEMO_STEPS,
  CALIBRATION_DEMO_TARGETS,
  calibrationDemoAssumptionGroupTargetId,
  calibrationDemoAssumptionTargetId,
  calibrationDemoParameterTargetId,
  CalibrationDemoPrototype,
  isCalibrationComparisonReady,
  isCalibrationDemoRequiredActionStep,
  isCalibrationDemoStepComplete,
  resolveCalibrationDemoResumeStep,
  shouldAutoAdvanceCalibrationDemoStep,
  type CalibrationDemoRuntimeState
} from '../src/components/CalibrationDemoPrototype.js';
import {
  chronologicalCalibrationPair,
  normalizeCalibrationComparison
} from '../src/lib/calibrationComparison.js';
import {
  AssumptionGroupDisclosure,
  calibrationAssumptionGroupId,
  ComparePage,
  FittedParameterRow
} from '../src/pages/ComparePage.js';

const expectedStepIds = [
  'purpose',
  'primary-model',
  'compare',
  'comparison-model',
  'behavioural-origin',
  'fitted-parameters',
  'representative-parameter',
  'other-assumptions',
  'assumption-group',
  'assumption-row'
] as const;

assert.deepEqual(CALIBRATION_DEMO_STEPS.map((step) => step.id), expectedStepIds);
assert.deepEqual(CALIBRATION_DEMO_STEPS.map((step) => step.title), [
  'What calibration is for',
  'Inspect one model',
  'Compare two configurations',
  'Choose a comparison model',
  'Trace the behavioural fit',
  'Understand the five fitted behaviours',
  'Inspect one fitted parameter',
  'Open the other model assumptions',
  'Browse assumptions by system',
  'Read an assumption row'
]);
assert.equal(
  CALIBRATION_DEMO_STEPS[0].body,
  'Calibration documents how each model version was configured: which behavioural parameters were fitted to model outcomes, what values were selected, and which measured, policy-set, technical, or postulated assumptions supply the rest of the model.'
);
assert.ok(CALIBRATION_DEMO_STEPS[0].body.trim().split(/\s+/).length <= 50);

const staticTargetIds = CALIBRATION_DEMO_STEPS.flatMap((step) => step.targetId ? [step.targetId] : []);
assert.equal(new Set(staticTargetIds).size, staticTargetIds.length);
assert.deepEqual(CALIBRATION_DEMO_TARGETS, {
  primaryModel: 'calibration-primary-model',
  compareToggle: 'calibration-compare-toggle',
  comparisonModel: 'calibration-comparison-model',
  behaviouralOrigin: 'calibration-behavioural-origin',
  fittedParameters: 'calibration-fitted-parameters',
  otherAssumptions: 'calibration-other-assumptions'
});
assert.equal(
  calibrationDemoParameterTargetId('PSYCHOLOGICAL_COST_OF_RENTING'),
  'calibration-parameter-PSYCHOLOGICAL_COST_OF_RENTING'
);
assert.equal(
  calibrationDemoAssumptionGroupTargetId('household-demographics-wealth'),
  'calibration-assumption-group-household-demographics-wealth'
);
assert.equal(calibrationDemoAssumptionTargetId('age_distribution'), 'calibration-assumption-age_distribution');
assert.equal(
  calibrationAssumptionGroupId('Household Demographics & Wealth'),
  'household-demographics-wealth'
);

assert.deepEqual(CALIBRATION_DEMO_REQUIRED_ACTION_STEPS, [
  'compare',
  'comparison-model',
  'behavioural-origin',
  'fitted-parameters',
  'representative-parameter',
  'other-assumptions',
  'assumption-group'
]);
for (const stepId of CALIBRATION_DEMO_REQUIRED_ACTION_STEPS) {
  assert.equal(isCalibrationDemoRequiredActionStep(stepId), true);
}
for (const stepId of ['purpose', 'primary-model', 'assumption-row'] as const) {
  assert.equal(isCalibrationDemoRequiredActionStep(stepId), false);
}

const completedTransition = {
  isSameStepVisit: true,
  sawIncompleteDuringVisit: true,
  isComplete: true,
  advancePendingOrHandled: false
} as const;
for (const stepId of CALIBRATION_DEMO_REQUIRED_ACTION_STEPS) {
  assert.equal(shouldAutoAdvanceCalibrationDemoStep({ stepId, ...completedTransition }), true);
}
assert.equal(
  shouldAutoAdvanceCalibrationDemoStep({
    stepId: 'compare',
    ...completedTransition,
    sawIncompleteDuringVisit: false
  }),
  false,
  'Back/resume at an already-complete action must remain reviewable'
);
assert.equal(
  shouldAutoAdvanceCalibrationDemoStep({
    stepId: 'compare',
    ...completedTransition,
    isComplete: false
  }),
  false,
  'A reversed action must cancel progression'
);
assert.equal(
  shouldAutoAdvanceCalibrationDemoStep({
    stepId: 'compare',
    ...completedTransition,
    advancePendingOrHandled: true
  }),
  false,
  'A pending or handled transition must not advance twice'
);
assert.equal(
  shouldAutoAdvanceCalibrationDemoStep({ stepId: 'assumption-row', ...completedTransition }),
  false,
  'The final informational row still waits for Next'
);

function runtime(overrides: Partial<CalibrationDemoRuntimeState> = {}): CalibrationDemoRuntimeState {
  return {
    primaryVersion: 'v5o3',
    comparisonVersion: 'v4.26',
    isCompareChecked: true,
    requestedPrimaryVersion: 'v5o3',
    requestedComparisonVersion: 'v4.26',
    completedPrimaryVersion: 'v5o3',
    completedComparisonVersion: 'v4.26',
    overviewPrimaryVersion: 'v5o3',
    overviewComparisonVersion: 'v4.26',
    compareResponsePrimaryVersion: 'v5o3',
    compareResponseComparisonVersion: 'v4.26',
    isComparisonLoading: false,
    isComparisonWaiting: false,
    comparisonError: '',
    hasAtLeastTwoModels: true,
    isBehaviouralOriginOpen: false,
    isFittedParametersOpen: true,
    representativeParameterKey: 'PSYCHOLOGICAL_COST_OF_RENTING',
    isRepresentativeParameterOpen: false,
    hasOtherAssumptions: true,
    isOtherAssumptionsOpen: false,
    representativeAssumptionGroupId: 'household-demographics-wealth',
    isRepresentativeAssumptionGroupOpen: false,
    representativeAssumptionId: 'age_distribution',
    ...overrides
  };
}

const exactPair = runtime();
assert.equal(isCalibrationComparisonReady(exactPair), true);
for (const mismatch of [
  runtime({ completedComparisonVersion: 'v4.19' }),
  runtime({ overviewPrimaryVersion: 'v4.26' }),
  runtime({ overviewComparisonVersion: 'v4.19' }),
  runtime({ compareResponsePrimaryVersion: 'v4.26' }),
  runtime({ compareResponseComparisonVersion: 'v4.19' }),
  runtime({ isComparisonLoading: true }),
  runtime({ isComparisonWaiting: true }),
  runtime({ comparisonError: 'Request failed' }),
  runtime({ comparisonVersion: 'v5o3' }),
  runtime({ isCompareChecked: false })
]) {
  assert.equal(isCalibrationComparisonReady(mismatch), false);
}
assert.equal(isCalibrationDemoStepComplete('fitted-parameters', runtime()), true);
assert.equal(isCalibrationDemoStepComplete('fitted-parameters', runtime({ isFittedParametersOpen: false })), false);
assert.equal(isCalibrationDemoStepComplete('representative-parameter', runtime({ representativeParameterKey: '' })), true);
assert.equal(isCalibrationDemoStepComplete('other-assumptions', runtime({ hasOtherAssumptions: false })), true);
assert.equal(isCalibrationDemoStepComplete('assumption-group', runtime({ representativeAssumptionGroupId: '' })), true);
assert.equal(
  resolveCalibrationDemoResumeStep('assumption-row', runtime({
    isBehaviouralOriginOpen: true,
    isRepresentativeParameterOpen: true,
    isOtherAssumptionsOpen: false
  })),
  'other-assumptions'
);
assert.equal(
  resolveCalibrationDemoResumeStep('assumption-row', runtime({
    isBehaviouralOriginOpen: true,
    isRepresentativeParameterOpen: true,
    isOtherAssumptionsOpen: true,
    isRepresentativeAssumptionGroupOpen: false
  })),
  'assumption-group'
);

assert.deepEqual(chronologicalCalibrationPair('v5o3', 'v4.26'), ['v4.26', 'v5o3']);
assert.deepEqual(chronologicalCalibrationPair('v0', 'v4.26'), ['v0', 'v4.26']);
const rawComparison: CompareResponse = {
  left: 'v4.26',
  right: 'v5o3',
  items: [{
    id: 'fixture',
    title: 'Fixture',
    group: 'Government & Tax',
    format: 'scalar',
    unchanged: false,
    sourceInfo: {
      configPathLeft: 'comparison.properties',
      configPathRight: 'primary.properties',
      configKeys: ['FIXTURE'],
      dataFilesLeft: ['comparison.csv'],
      dataFilesRight: ['primary.csv'],
      datasetsLeft: [{ tag: 'comparison', fullName: 'Comparison source', year: '2011' }],
      datasetsRight: [{ tag: 'primary', fullName: 'Primary source', year: '2024' }]
    },
    explanation: 'Fixture',
    leftVersion: 'v4.26',
    rightVersion: 'v5o3',
    changeOriginsInRange: [],
    visualPayload: {
      type: 'scalar',
      values: [{ key: 'FIXTURE', left: 2, right: 5, delta: { absolute: 3, percent: 150 } }]
    }
  }]
};
const normalized = normalizeCalibrationComparison(rawComparison, 'v5o3', 'v4.26');
assert.equal(normalized.left, 'v5o3');
assert.equal(normalized.right, 'v4.26');
assert.equal(normalized.items[0].leftVersion, 'v5o3');
assert.equal(normalized.items[0].rightVersion, 'v4.26');
assert.equal(normalized.items[0].sourceInfo.configPathLeft, 'primary.properties');
assert.equal(normalized.items[0].sourceInfo.datasetsLeft[0].fullName, 'Primary source');
if (normalized.items[0].visualPayload.type !== 'scalar') throw new Error('Expected scalar fixture');
assert.deepEqual(normalized.items[0].visualPayload.values[0], {
  key: 'FIXTURE',
  left: 5,
  right: 2,
  delta: { absolute: -3, percent: -60 }
});

const parameter = {
  key: 'PSYCHOLOGICAL_COST_OF_RENTING',
  name: 'Psychological cost of renting',
  value: 0.75,
  lower: 0,
  upper: 1,
  priorLower: null,
  priorUpper: null,
  meaning: 'Meaning',
  calibrationReason: 'Reason',
  increaseEffect: 'Increase',
  decreaseEffect: 'Decrease'
};
const controlledParameter = renderToStaticMarkup(createElement(FittedParameterRow, {
  parameter,
  compared: { ...parameter, value: 0.5 },
  primaryVersion: 'v5o3',
  comparisonVersion: 'v4.26',
  mode: 'compare',
  open: true,
  onOpenChange: () => undefined,
  demoTarget: calibrationDemoParameterTargetId(parameter.key)
}));
assert.match(controlledParameter, /^<details[^>]*open=""/);
assert.ok(controlledParameter.includes('data-calibration-demo-target="calibration-parameter-PSYCHOLOGICAL_COST_OF_RENTING"'));
assert.ok(controlledParameter.indexOf('v5o3 value') < controlledParameter.indexOf('v4.26 value'));

const controlledGroup = renderToStaticMarkup(createElement(AssumptionGroupDisclosure, {
  group: 'Household Demographics & Wealth',
  assumptionCount: 1,
  open: true,
  onOpenChange: () => undefined,
  demoTarget: calibrationDemoAssumptionGroupTargetId('household-demographics-wealth'),
  children: createElement('p', null, 'Assumption')
}));
assert.match(controlledGroup, /^<details[^>]*open=""/);
assert.ok(controlledGroup.includes('data-calibration-demo-target="calibration-assumption-group-household-demographics-wealth"'));

const ordinaryMarkup = renderToStaticMarkup(
  createElement(MemoryRouter, null, createElement(ComparePage))
);
assert.equal(ordinaryMarkup.includes('calibration-demo-layer'), false, 'Non-demo Calibration must not render an overlay');

const source = fs.readFileSync(new URL('../src/components/CalibrationDemoPrototype.tsx', import.meta.url), 'utf8');
const comparePageSource = fs.readFileSync(new URL('../src/pages/ComparePage.tsx', import.meta.url), 'utf8');
assert.ok(source.includes('window.requestAnimationFrame') && source.includes('latest.stepId !== scheduledStepId'));
assert.ok(source.includes('window.cancelAnimationFrame(frame)') && source.includes('sawIncompleteRef'));
assert.ok(source.includes('Retry comparison') && source.includes('This demo step isn’t ready'));
assert.ok(source.includes('role="dialog"') && !source.includes('aria-modal="true"'));
assert.ok(comparePageSource.includes('data-calibration-demo-target'));
assert.ok(comparePageSource.includes('completedPrimaryVersion') && comparePageSource.includes('completedComparisonVersion'));
assert.ok(comparePageSource.includes('normalizeCalibrationComparison'));

void CalibrationDemoPrototype;
console.log('Calibration demo walkthrough tests passed.');
