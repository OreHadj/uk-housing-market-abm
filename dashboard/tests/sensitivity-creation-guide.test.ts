import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { DEMO_EXAMPLE_FIGURES, DEMO_MODEL_VERSION } from '../shared/demoExamples.js';
import { getBasePolicyOption } from '../shared/policyCatalogue.js';
import type { ModelRunParameterDefinition, ModelRunSnapshotOption, SensitivityPolicyPackageDefinition } from '../shared/types.js';
import {
  SENSITIVITY_EXPERIMENT_DEMO_STEPS,
  SENSITIVITY_EXPERIMENT_DEMO_TARGETS,
  buildSensitivityCreationSteps,
  isSensitivityExperimentDemoStepComplete,
  sensitivityExperimentDemoWizardStep,
  type SensitivityExperimentDemoState
} from '../src/components/SensitivityExperimentDemo.js';
import { committedExperimentDemoText, type ExperimentDemoChapterContext } from '../src/lib/guidedDemos/creation.js';
import { sensitivityDraftStorageKey } from '../src/lib/sensitivityDraft.js';
import {
  SensitivitySetupCard,
  buildSensitivitySampleValues,
  sensitivityCreationAdvanceValidation
} from '../src/pages/run-experiments/SensitivitySetupCard.js';

const defaults = DEMO_EXAMPLE_FIGURES.configuration;
const policyPackage: SensitivityPolicyPackageDefinition = {
  id: 'owner_occupier_lti_soft_max', title: 'Owner-occupier LTI threshold',
  description: 'Moves the flow-limit threshold for first-time buyers and home movers.',
  parameterKeys: ['CENTRAL_BANK_LTI_SOFT_MAX_FTB', 'CENTRAL_BANK_LTI_SOFT_MAX_HM'], type: 'number'
};
const baseline = getBasePolicyOption('2024');
const snapshot: ModelRunSnapshotOption = { version: DEMO_MODEL_VERSION, status: 'stable', evidenceYear: defaults.evidenceYear, outputCalibrated: true };
const sampleValues = buildSensitivitySampleValues(policyPackage, baseline, '4', '5', '5');
assert.deepEqual(sampleValues, defaults.sensitivitySettings.map(String), 'The actual preview matches the verified bundled settings');
const state: SensitivityExperimentDemoState = {
  currentWizardStep: 0, currentName: 'LTI threshold comparison', minValue: '4', maxValue: '5', sampleCount: '5',
  baselineValues: [4.5, 4.5], sampleValues, selectedInstrument: policyPackage.id,
  selectedModel: DEMO_MODEL_VERSION, selectedBaselinePolicy: defaults.basePolicy, seedsPerPoint: defaults.seeds
};
const steps = buildSensitivityCreationSteps(state);
assert.equal(steps.length, 9, 'Eight teaching stops plus completion');
assert.equal(steps[0].id, 'sensitivity-name', 'Naming is the first step');
assert.deepEqual(steps.map((step) => step.wizardStep), [0, 1, 1, 2, 2, 3, 4, 4, 4]);
assert.deepEqual(steps.filter((step) => step.kind === 'action').map((step) => step.id), ['sensitivity-name', 'sensitivity-submit']);
assert.equal(steps[1].interactive, undefined, 'Instrument stays read-only while highlighted');
assert.equal(steps[2].interactive, true, 'The real range remains optionally editable');
assert.equal(sensitivityExperimentDemoWizardStep('sensitivity-run-recording'), 3);
assert.equal(sensitivityExperimentDemoWizardStep('obsolete-step'), 0);
const copy = (step: typeof steps[number]) => step.bullets?.join(' ') ?? step.body;
assert.match(copy(steps[1]), /LTI threshold.*first-time buyers and home movers/);
assert.match(copy(steps[2]), /Min and Max.*Sample count.*evenly spaced.*baseline/);
assert.match(copy(steps[3]), /model version defines the calibrated economy/);
assert.match(copy(steps[3]), /For more information about the model, use the blue boxes to visit the dedicated pages/);
assert.match(copy(steps[4]), /supplies every policy value/);
assert.match(copy(steps[5]), /Core indicators.*Transaction and household exports stay off/);
assert.match(copy(steps[6]), new RegExp(`${defaults.sensitivitySettings.length} settings with ${defaults.seeds} seeds each give ${defaults.sensitivitySettings.length * defaults.seeds} simulations`));
assert.match(copy(steps[7]), /real analysis.*Report opens/);
for (const step of [...steps, ...SENSITIVITY_EXPERIMENT_DEMO_STEPS]) {
  assert.equal(step.body, '', 'Use the same bullet format as policy creation');
  assert.ok(copy(step).split(/\s+/).length <= 45, `${step.id} must respect the 45-word budget`);
  assert.doesNotMatch([step.title, copy(step), 'actionHint' in step ? step.actionHint : '', 'completionNote' in step ? step.completionNote : ''].join(' '), /[;:←→]/);
}
const changedSteps = buildSensitivityCreationSteps({ ...state, sampleCount: '3', sampleValues: ['4', '4.5', '5'], seedsPerPoint: 12 });
assert.match(copy(changedSteps[6]), /3 settings with 12 seeds each give 36 simulations/);
assert.doesNotMatch(changedSteps.map(copy).join(' '), /40 simulations/, 'Edited values cannot leave stale workload copy');
const distinctBaselineSteps = buildSensitivityCreationSteps({ ...state, sampleValues: ['baseline policy values (4.5, 4.75)', '4', '4.25', '4.5', '4.75', '5'] });
assert.ok(copy(distinctBaselineSteps[2]).split(/\s+/).length <= 45, 'Long preview labels cannot overflow the coach copy budget');
assert.equal(committedExperimentDemoText('Retained title', false), '', 'Restored text is not a deliberate commit');
const committedName = committedExperimentDemoText('  LTI threshold comparison  ', true);
assert.equal(isSensitivityExperimentDemoStepComplete('sensitivity-name', { currentName: state.currentName, committedName: '' }), false);
assert.equal(isSensitivityExperimentDemoStepComplete('sensitivity-name', { currentName: state.currentName, committedName }), true, 'Persisted committed text survives recreation');
assert.equal(isSensitivityExperimentDemoStepComplete('sensitivity-name', { currentName: 'Changed name', committedName }), false);
assert.equal(isSensitivityExperimentDemoStepComplete('sensitivity-tested-values', { currentName: '', committedName: '' }), true, 'No range/sample edit is forced');
assert.equal(isSensitivityExperimentDemoStepComplete('sensitivity-submit', { currentName: state.currentName, committedName }), false, 'Completion requires a real accepted analysis');
assert.equal(isSensitivityExperimentDemoStepComplete('sensitivity-submit', { currentName: state.currentName, committedName, sensitivityRun: { status: 'submitting', title: 'Pending' } }), false);
assert.equal(isSensitivityExperimentDemoStepComplete('sensitivity-submit', { currentName: state.currentName, committedName, sensitivityRun: { status: 'submitted', title: 'Accepted', runId: 'sensitivity-test', jobRef: 'sensitivity:sensitivity-test' } }), true);

const parameters: ModelRunParameterDefinition[] = [
  { key: 'N_STEPS', title: 'Simulation duration', description: '', group: 'General model control', type: 'integer', defaultValue: defaults.sensitivityMonths },
  { key: 'N_SIMS', title: 'Monte Carlo runs', description: '', group: 'General model control', type: 'integer', defaultValue: defaults.seeds },
  { key: 'recordCoreIndicators', title: 'Record core indicators', description: '', group: 'General model control', type: 'boolean', defaultValue: true }
];
const formValues = { N_STEPS: String(defaults.sensitivityMonths), N_SIMS: String(defaults.seeds), recordCoreIndicators: true };
const validationState = {
  title: state.currentName, selectedSnapshot: snapshot, selectedBasePolicy: baseline, selectedPackage: policyPackage,
  minValue: '4', maxValue: '5', sampleCount: '5', parameters, formValues, maxWorkers: '2', maxWorkersCap: 4
};
assert.equal(sensitivityCreationAdvanceValidation(steps[0], { ...validationState, title: '' }), null, 'The first step opens the name before validation');
for (const step of steps.slice(1)) assert.equal(sensitivityCreationAdvanceValidation(step, validationState), null, `${step.id}: defaults can advance unchanged`);
assert.equal(sensitivityCreationAdvanceValidation(steps[1], { ...validationState, title: '' })?.targetId, SENSITIVITY_EXPERIMENT_DEMO_TARGETS.name);
assert.equal(sensitivityCreationAdvanceValidation(steps[4], { ...validationState, minValue: '6' })?.targetId, SENSITIVITY_EXPERIMENT_DEMO_TARGETS.range);
assert.equal(sensitivityCreationAdvanceValidation(steps[4], { ...validationState, sampleCount: '1.5' })?.targetId, SENSITIVITY_EXPERIMENT_DEMO_TARGETS.sampleCount);
const excludedBaseline = sensitivityCreationAdvanceValidation(steps[4], { ...validationState, minValue: '4.6' });
assert.equal(excludedBaseline?.step, 1);
assert.equal(excludedBaseline?.targetId, SENSITIVITY_EXPERIMENT_DEMO_TARGETS.testedValues, 'An excluded baseline is repaired on the sweep page');
assert.match(excludedBaseline?.message ?? '', /must fall inside/);
assert.equal(sensitivityCreationAdvanceValidation(steps[5], { ...validationState, selectedSnapshot: null })?.targetId, SENSITIVITY_EXPERIMENT_DEMO_TARGETS.model);
assert.equal(sensitivityCreationAdvanceValidation(steps[6], { ...validationState, formValues: { ...formValues, N_SIMS: '0' } })?.step, 3);
assert.match(sensitivityCreationAdvanceValidation(steps[7], { ...validationState, maxWorkers: '5' })?.message ?? '', /cannot exceed 4/, 'Completion cannot bypass native worker validation');

const noop = () => {};
const demo: ExperimentDemoChapterContext = {
  active: true, paused: true, journeyId: 'creation-test', draftId: 'practice-sensitivity-creation-test', mode: 'sensitivity',
  savedStepId: 'sensitivity-complete', committedValues: { name: state.currentName }, ready: true, loading: false, error: '',
  onRetryLoad: noop, onCommit: noop, onProgress: noop, onChapterComplete: noop, onContinueToSensitivity: noop,
  onFinish: noop, onPause: noop, onExit: noop
};
const props = {
  draftId: demo.draftId, initialStep: 4, executionDisabled: false, isLoadingOptions: false,
  selectedBaseline: snapshot.version, onBaselineChange: noop, snapshots: [snapshot], basePolicies: [baseline],
  basePolicy: baseline.id, onBasePolicyChange: noop, policyPackages: [policyPackage], policyPackageId: policyPackage.id,
  onPolicyPackageChange: noop, minValue: '4', maxValue: '5', onMinValueChange: noop, onMaxValueChange: noop,
  sampleCount: '5', onSampleCountChange: noop, parameters, formValues, onFormValueChange: noop,
  maxWorkers: '2', maxWorkersCap: 4, onMaxWorkersChange: noop, title: state.currentName, onTitleChange: noop,
  selectedPackage: policyPackage, warnings: [], isSubmitting: false, isCanceling: false,
  sensitivitySubmissionLockedByManual: false, lockMessage: null, hasActiveSensitivityJob: false,
  onSubmit: noop, onCancelActive: noop, sensitivityDemo: demo
};
const render = (overrides: Partial<typeof props> = {}) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SensitivitySetupCard, { ...props, ...overrides })));
const pausedMarkup = render();
const pausedStepper = pausedMarkup.slice(pausedMarkup.indexOf('<nav'), pausedMarkup.indexOf('</nav>'));
assert.doesNotMatch(pausedStepper, /disabled/, 'Paused practice restores normal step navigation');
assert.match(pausedMarkup, /<button(?=[^>]*aria-label="Back to previous step")(?![^>]*disabled)[^>]*>/, 'Paused practice allows Back');
assert.match(pausedMarkup, /<button(?=[^>]*disabled)(?=[^>]*data-experiment-demo-target="sensitivity-start-boundary")[^>]*>Start sensitivity analysis<\/button>/, 'Paused practice still cannot submit');
for (const target of [SENSITIVITY_EXPERIMENT_DEMO_TARGETS.testedValues, SENSITIVITY_EXPERIMENT_DEMO_TARGETS.seedsWorkload, SENSITIVITY_EXPERIMENT_DEMO_TARGETS.review]) {
  assert.equal(pausedMarkup.split(`data-experiment-demo-target="${target}"`).length - 1, 1, `${target} is unique`);
}
const workloadMarkup = pausedMarkup.slice(pausedMarkup.indexOf('data-experiment-demo-target="sensitivity-seeds-workload"'), pausedMarkup.indexOf('data-experiment-demo-target="sensitivity-fixed-recording"'));
assert.match(workloadMarkup, /Seeds per sampled point/);
assert.match(workloadMarkup, /5 settings × 8 seeds per setting/);
assert.equal((pausedMarkup.match(/<input[^>]*value="8"/g) ?? []).length, 1, 'The real seeds control is rendered once');
const activeMarkup = render({ initialStep: 3, sensitivityDemo: { ...demo, paused: false, savedStepId: 'sensitivity-run-recording' } });
const activeStepper = activeMarkup.slice(activeMarkup.indexOf('<nav'), activeMarkup.indexOf('</nav>'));
assert.equal((activeStepper.match(/disabled=""/g) ?? []).length, 5, 'Coach Next owns page progression while guiding');
assert.match(activeMarkup, /<button(?=[^>]*aria-label="Continue to next step")(?=[^>]*disabled)[^>]*>/);
const startMarkup = render({ sensitivityDemo: { ...demo, paused: false, savedStepId: 'sensitivity-submit', allowSensitivitySubmission: true } });
assert.match(startMarkup, /<button(?![^>]*disabled)(?=[^>]*data-experiment-demo-target="sensitivity-start-boundary")[^>]*>Start sensitivity analysis<\/button>/);
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: (key: string) => key === sensitivityDraftStorageKey(demo.draftId) ? JSON.stringify({ version: 1, title: state.currentName, calibratedModel: snapshot.version, currentStep: 2 }) : null } });
try {
  assert.match(render({ initialStep: undefined }), /aria-current="step"><span>3<\/span>Model and baseline/, 'Paused practice restores its saved page on refresh');
} finally {
  if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage);
  else Reflect.deleteProperty(globalThis, 'sessionStorage');
}
console.log('Sensitivity creation guide tests passed.');
