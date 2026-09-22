import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { DEMO_EXAMPLE_FIGURES, DEMO_MODEL_VERSION } from '../shared/demoExamples.js';
import { BASE_POLICY_OPTIONS, CENTRAL_BANK_POLICY_KEYS } from '../shared/policyCatalogue.js';
import { CENTRAL_BANK_POLICY_DISPLAY } from '../shared/policyDisplay.js';
import type { ModelRunParameterDefinition } from '../shared/types.js';
import {
  POLICY_EXPERIMENT_DEMO_STEPS,
  POLICY_EXPERIMENT_DEMO_TARGETS,
  PolicyExperimentDemo,
  buildPolicyExperimentDemoSteps,
  isPolicyExperimentDemoBankRateComplete,
  isPolicyExperimentDemoStepComplete,
  policyExperimentDemoWizardStep,
  type PolicyExperimentDemoProps
} from '../src/components/PolicyExperimentDemo.js';
import { ManualRunSetupCard } from '../src/pages/run-experiments/ManualRunSetupCard.js';
import { DEFAULT_EXPERIMENT_SEED_COUNT, DEFAULT_POLICY_RUN_N_STEPS } from '../src/lib/experimentRunDefaults.js';
import { scenarioDraftStorageKey } from '../src/lib/scenarioDraft.js';
import { POLICY_PRACTICE_SETTINGS } from '../src/lib/policyPractice.js';

const noop = () => {};
const configuration = DEMO_EXAMPLE_FIGURES.configuration;
const reference = configuration.referenceBankRate / 100;
const raised = String(configuration.policyBankRate / 100);
type DemoStep = ReturnType<typeof buildPolicyExperimentDemoSteps>[number];
const stepText = (step: DemoStep) => [step.body, ...(step.bullets ?? [])].filter(Boolean).join(' ');
const wordCount = (text: string) => text.trim() ? text.trim().split(/\s+/).length : 0;
const stepById = (steps: readonly DemoStep[], id: DemoStep['id']): DemoStep => {
  const step = steps.find((candidate) => candidate.id === id);
  assert.ok(step, `Missing ${id}`);
  return step;
};
assert.equal(configuration.policyMonths, DEFAULT_POLICY_RUN_N_STEPS);
assert.equal(configuration.seeds, DEFAULT_EXPERIMENT_SEED_COUNT);
assert.equal(POLICY_EXPERIMENT_DEMO_STEPS.length, 11, 'Ten lessons followed by a separate completion card');
assert.deepEqual(POLICY_EXPERIMENT_DEMO_STEPS.map((step) => step.id), [
  'policy-purpose', 'policy-navigation', 'policy-name', 'policy-model', 'policy-reference-policy',
  'policy-change-bank-rate', 'policy-run-settings', 'policy-exports', 'policy-review-overview', 'policy-submit', 'policy-complete'
]);
assert.deepEqual(POLICY_EXPERIMENT_DEMO_STEPS.map((step) => step.wizardStep), [0, 0, 0, 1, 2, 2, 3, 3, 4, 4, 4]);
assert.deepEqual(POLICY_EXPERIMENT_DEMO_STEPS.map((step) => step.targetId), [
  null, POLICY_EXPERIMENT_DEMO_TARGETS.stepper, POLICY_EXPERIMENT_DEMO_TARGETS.name, POLICY_EXPERIMENT_DEMO_TARGETS.model,
  POLICY_EXPERIMENT_DEMO_TARGETS.referencePolicy, POLICY_EXPERIMENT_DEMO_TARGETS.bankRateContent,
  POLICY_EXPERIMENT_DEMO_TARGETS.technicalSettings, POLICY_EXPERIMENT_DEMO_TARGETS.additionalExportsContent,
  POLICY_EXPERIMENT_DEMO_TARGETS.reviewOverview, POLICY_EXPERIMENT_DEMO_TARGETS.startBoundary, null
]);
assert.equal(new Set(POLICY_EXPERIMENT_DEMO_STEPS.map((step) => step.id)).size, 11);
for (const step of POLICY_EXPERIMENT_DEMO_STEPS) {
  assert.ok(wordCount(stepText(step)) <= 40, `${step.id} stays within the concise creation copy budget`);
  assert.doesNotMatch([step.title, stepText(step), 'actionHint' in step ? step.actionHint : '', 'completionNote' in step ? step.completionNote : ''].join(' '), /[;:←→]/);
  assert.ok(step.bullets.length >= 2 && step.bullets.length <= 3, `${step.id} uses two or three bullets`);
  assert.ok(wordCount(step.body) <= 8, `${step.id} has at most a short introduction`);
  assert.equal(policyExperimentDemoWizardStep(step.id), step.wizardStep);
  if (step.kind === 'action') {
    assert.ok(step.interactive && step.actionHint && step.completionNote);
    assert.ok(wordCount(step.completionNote) <= 30);
    assert.equal(stepText(step).includes('press Enter'), false, 'Only the action hint repeats the commit instruction');
    assert.ok(step.actionHint.includes(step.id === 'policy-submit' ? 'Select Start policy scenario' : step.id === 'policy-name' ? 'Enter a name to continue' : 'Raise Bank Rate to enable Next'));
  }
}
assert.equal(policyExperimentDemoWizardStep('retired-step'), 0);
assert.deepEqual(POLICY_EXPERIMENT_DEMO_STEPS.filter((step) => step.kind === 'action').map((step) => step.id), ['policy-name', 'policy-change-bank-rate', 'policy-submit']);
assert.ok(stepText(stepById(POLICY_EXPERIMENT_DEMO_STEPS, 'policy-purpose')).includes('A baseline run keeps policy unchanged for comparison'));
assert.ok(stepText(stepById(POLICY_EXPERIMENT_DEMO_STEPS, 'policy-model')).includes('Refitted 2011 model'));
assert.ok(stepText(stepById(POLICY_EXPERIMENT_DEMO_STEPS, 'policy-model')).includes('For more information about the model, use the blue boxes to visit the dedicated pages.'));
assert.ok(stepText(stepById(POLICY_EXPERIMENT_DEMO_STEPS, 'policy-change-bank-rate')).includes(configuration.policyBankRate.toFixed(1)));
assert.ok(stepText(stepById(POLICY_EXPERIMENT_DEMO_STEPS, 'policy-purpose')).includes('real short run'));
assert.ok(stepText(stepById(POLICY_EXPERIMENT_DEMO_STEPS, 'policy-run-settings')).includes(`${POLICY_PRACTICE_SETTINGS.months} model months`));
assert.ok(stepText(stepById(POLICY_EXPERIMENT_DEMO_STEPS, 'policy-review-overview')).includes(`${POLICY_PRACTICE_SETTINGS.households.toLocaleString('en-GB')} households`));
assert.ok(stepText(stepById(POLICY_EXPERIMENT_DEMO_STEPS, 'policy-exports')).includes(`month ${POLICY_PRACTICE_SETTINGS.recordFrom}`));
const navigation = stepById(POLICY_EXPERIMENT_DEMO_STEPS, 'policy-navigation');
assert.equal(navigation.kind, 'info');
assert.equal(navigation.interactive, true, 'The highlighted strip can scroll while its page buttons stay disabled');
assert.ok(stepText(navigation).includes('Your current section is highlighted'));
assert.ok(stepText(navigation).includes('Normally, click a section'));
assert.ok(stepText(navigation).includes('Scroll to see more'));
assert.ok(stepText(navigation).includes('In this guide, use Back and Next'));

assert.equal(isPolicyExperimentDemoBankRateComplete(raised, reference, raised), true);
for (const [current, committed] of [
  [raised, ''], ['', raised], [String(reference), String(reference)], ['0.04', '0.04'],
  ['0.06junk', '0.06junk'], ['Infinity', 'Infinity'], ['-0.1', '-0.1'], ['0.062', raised]
]) assert.equal(isPolicyExperimentDemoBankRateComplete(current, reference, committed), false, `${current}/${committed} must not unlock Next`);
assert.equal(isPolicyExperimentDemoBankRateComplete(raised, undefined, raised), false);

const guideProps: PolicyExperimentDemoProps = {
  active: true, paused: false, journeyId: 'experiment-demo-policy-guide-test',
  draftId: 'experiment-demo-policy-v2-guide-test', mode: 'policy', savedStepId: 'policy-purpose',
  committedValues: {}, ready: true, loading: false, error: '',
  onRetryLoad: noop, onCommit: noop, onProgress: noop, onChapterComplete: noop,
  onContinueToSensitivity: noop, onExploreResults: noop, onFinish: noop, onPause: noop,
  onExit: noop, onRestoreStep: noop, currentName: 'Bank Rate rise', currentBankRate: raised,
  referenceBankRate: reference, selectedModel: DEMO_MODEL_VERSION, selectedReferencePolicy: configuration.basePolicy,
  runMonths: String(configuration.policyMonths), seedCount: String(configuration.seeds),
  householdCount: '12000', recordingStartMonth: '500', recordTransactions: true
};
const changedDraft = {
  ...guideProps, selectedModel: 'v5o3', selectedReferencePolicy: '2011', referenceBankRate: 0.005,
  runMonths: '5000', seedCount: '12'
};
const changedDraftSteps = buildPolicyExperimentDemoSteps(changedDraft);
assert.ok(stepText(stepById(changedDraftSteps, 'policy-model')).includes('Your draft uses Refitted 2024 model. The saved example uses Refitted 2011 model'));
const changedReferenceText = stepText(stepById(changedDraftSteps, 'policy-reference-policy'));
assert.ok(changedReferenceText.includes('2011 reference year supplies all unchanged policy values'));
assert.ok(changedReferenceText.includes('separate from the calibrated model'));
assert.ok(changedReferenceText.includes('creates no comparison run'));
const changedBankRateText = stepText(stepById(changedDraftSteps, 'policy-change-bank-rate'));
assert.ok(changedBankRateText.includes('1 percentage point above reference, about 1.5%'));
assert.equal(changedBankRateText.includes('6.1%'), false);
const changedRunSettingsText = stepText(stepById(changedDraftSteps, 'policy-run-settings'));
assert.ok(changedRunSettingsText.includes('5,000 model months') && changedRunSettingsText.includes('12 seeds'));
assert.equal(changedRunSettingsText.includes('3,500'), false);
for (const state of [guideProps, changedDraft, { ...changedDraft, runMonths: '', seedCount: '0' }, { ...changedDraft, seedCount: '1', referenceBankRate: undefined }]) {
  const runtimeSteps = buildPolicyExperimentDemoSteps(state);
  assert.deepEqual(runtimeSteps.map((step) => step.id), POLICY_EXPERIMENT_DEMO_STEPS.map((step) => step.id));
  for (const step of runtimeSteps) {
    assert.ok(wordCount(stepText(step)) <= 40, `${step.id} runtime copy remains concise`);
    assert.doesNotMatch(stepText(step), /[;:←→]/);
    assert.ok(step.bullets && step.bullets.length >= 2 && step.bullets.length <= 3, `${step.id} runtime copy retains concise bullets`);
  }
}
for (const state of [
  { ...guideProps, recordingStartMonth: '1250', recordTransactions: false },
  { ...guideProps, recordingStartMonth: '0' },
  { ...guideProps, recordingStartMonth: '1' },
  { ...guideProps, recordingStartMonth: '', householdCount: '' },
  { ...guideProps, recordingStartMonth: '-1' }
]) {
  const runtimeSteps = buildPolicyExperimentDemoSteps(state);
  for (const step of runtimeSteps) assert.ok(wordCount(stepText(step)) <= 40, `${step.id} remains concise with edited recording settings`);
}
const defaultDraftSteps = buildPolicyExperimentDemoSteps(guideProps);
assert.ok(stepText(stepById(defaultDraftSteps, 'policy-change-bank-rate')).includes(configuration.policyBankRate.toFixed(1)));
assert.ok(stepText(stepById(defaultDraftSteps, 'policy-run-settings')).includes('3,500 model months'));
assert.ok(stepText(stepById(defaultDraftSteps, 'policy-run-settings')).includes('8 seeds'));
const shortDraft = {
  ...guideProps, runMonths: String(POLICY_PRACTICE_SETTINGS.months), seedCount: String(POLICY_PRACTICE_SETTINGS.seeds),
  householdCount: String(POLICY_PRACTICE_SETTINGS.households), recordingStartMonth: String(POLICY_PRACTICE_SETTINGS.recordFrom)
};
const shortDraftSteps = buildPolicyExperimentDemoSteps(shortDraft);
assert.ok(stepText(stepById(shortDraftSteps, 'policy-review-overview')).includes('1,000 households, 600 months and 1 seed'));
assert.ok(stepText(stepById(shortDraftSteps, 'policy-run-settings')).includes('1 seed demonstrates the workflow, not seed consistency'));
assert.equal(stepText(stepById(shortDraftSteps, 'policy-review-overview')).includes('3,500'), false);
const defaultExports = stepText(stepById(defaultDraftSteps, 'policy-exports'));
assert.ok(defaultExports.includes('Start recording at month 500 skips the first 500 transaction months'));
assert.ok(defaultExports.includes('lets the model settle and keeps files smaller'));
assert.ok(defaultExports.includes('Record transactions enables Lending risk’s High LTV and High LTI charts'));
assert.ok(defaultExports.includes('Other exports add files only'));
const editedExports = stepText(stepById(buildPolicyExperimentDemoSteps({ ...guideProps, recordingStartMonth: '1250', recordTransactions: false }), 'policy-exports'));
assert.ok(editedExports.includes('month 1,250 skips the first 1,250 transaction months'));
assert.ok(editedExports.includes('Enable Record transactions'));
assert.equal(editedExports.includes('month 500'), false);
const zeroRecording = stepText(stepById(buildPolicyExperimentDemoSteps({ ...guideProps, recordingStartMonth: '0' }), 'policy-exports'));
assert.ok(zeroRecording.includes('month 0 keeps transactions from the first month'));
const invalidRecording = stepText(stepById(buildPolicyExperimentDemoSteps({ ...guideProps, recordingStartMonth: '-1' }), 'policy-exports'));
assert.ok(invalidRecording.includes('needs a valid nonnegative month'));
const changedReview = stepText(stepById(changedDraftSteps, 'policy-review-overview'));
assert.ok(changedReview.includes('12,000 households, 5,000 months and 12 seeds'));
const invalidCounts = stepText(stepById(buildPolicyExperimentDemoSteps({ ...changedDraft, runMonths: '', seedCount: '0' }), 'policy-run-settings'));
assert.ok(invalidCounts.includes('Duration needs a valid number') && invalidCounts.includes('Seed count is invalid'));
const renderGuide = (overrides: Partial<PolicyExperimentDemoProps> = {}) => renderToStaticMarkup(createElement(PolicyExperimentDemo, { ...guideProps, ...overrides }));
assert.ok(renderGuide({ ...changedDraft, savedStepId: 'policy-model' }).includes('Your draft uses Refitted 2024 model'));
assert.ok(renderGuide({ ...changedDraft, savedStepId: 'policy-run-settings' }).includes('5,000 model months'));
assert.ok(renderGuide({ ...changedDraft, seedCount: '1', savedStepId: 'policy-run-settings' }).includes('not seed consistency'));
const intro = renderGuide();
assert.ok(intro.includes('Create a policy scenario · 1 of 10'));
assert.ok(intro.includes('Build a policy scenario'));
assert.match(intro, /<ul class="guided-tour-bullets"><li>A policy scenario runs one policy configuration\.<\/li>/);
assert.equal(intro.includes('Pause demo'), false);
assert.match(intro, /<button[^>]*disabled=""[^>]*>Back<\/button>/);
const navigationMarkup = renderGuide({ savedStepId: 'policy-navigation' });
assert.ok(navigationMarkup.includes('Create a policy scenario · 2 of 10'));
assert.ok(navigationMarkup.includes('Move between sections'));
for (const savedStepId of ['policy-name', 'policy-change-bank-rate', 'policy-submit']) {
  assert.match(renderGuide({ savedStepId }), /<button[^>]*disabled=""[^>]*>Next<\/button>/);
}
assert.equal(isPolicyExperimentDemoStepComplete('policy-name', guideProps), false, 'Hydrated text alone is not a deliberate commit');
assert.equal(isPolicyExperimentDemoStepComplete('policy-change-bank-rate', guideProps), false, 'A persisted field value alone is not a deliberate commit');
assert.equal(isPolicyExperimentDemoStepComplete('policy-submit', guideProps), false);
const submittingRun = { status: 'submitting' as const, title: 'Unique practice title' };
const submittedRun = { ...submittingRun, status: 'submitted' as const, runId: 'practice-run', jobRef: 'manual:practice-job' };
assert.equal(isPolicyExperimentDemoStepComplete('policy-submit', { ...guideProps, policyRun: submittingRun }), false);
assert.equal(isPolicyExperimentDemoStepComplete('policy-submit', { ...guideProps, policyRun: submittedRun }), true);
const restored = { ...guideProps, committedValues: { name: 'Bank Rate rise', bankRate: raised } };
assert.equal(isPolicyExperimentDemoStepComplete('policy-name', restored), true);
assert.equal(isPolicyExperimentDemoStepComplete('policy-change-bank-rate', restored), true);
assert.equal(isPolicyExperimentDemoStepComplete('policy-name', { ...restored, currentName: 'Edited name' }), false);
const resumedBankRate = renderGuide({ ...restored, savedStepId: 'policy-change-bank-rate' });
assert.ok(resumedBankRate.includes('Bank Rate changed. Select Next to continue.'));
assert.equal(resumedBankRate.includes('Raise Bank Rate by'), false, 'Acknowledgement replaces the action bullets after a commit');
assert.equal(/<button[^>]*disabled=""[^>]*>Next<\/button>/.test(resumedBankRate), false, 'Restored commitment unlocks the action without another edit');
const completion = renderGuide({ ...restored, savedStepId: 'policy-complete' });
assert.ok(completion.includes('No run has been submitted'));
assert.ok(['Finish', 'Explore example policy results', 'Return to editing'].every((label) => completion.includes(`>${label}</button>`)));
assert.equal(completion.includes('>Next</button>'), false);
const submittedCompletion = renderGuide({ ...restored, savedStepId: 'policy-complete', policyRun: submittedRun, onViewSubmittedRun: noop });
assert.ok(submittedCompletion.includes('Your policy scenario was submitted.'));
assert.equal(submittedCompletion.includes('No run has been submitted'), false);
assert.ok(renderGuide({ ...restored, savedStepId: 'policy-complete', policyRun: submittingRun }).includes('Submission is in progress.'));
assert.equal(renderGuide({ paused: true }), '');

const basePolicy = BASE_POLICY_OPTIONS.find((policy) => policy.id === configuration.basePolicy)!;
assert.ok(basePolicy);
const policyParameters: ModelRunParameterDefinition[] = CENTRAL_BANK_POLICY_KEYS.map((key) => ({
  key, title: CENTRAL_BANK_POLICY_DISPLAY[key].label, description: '', group: 'Central Bank policy',
  type: key === 'CENTRAL_BANK_LTI_MONTHS_TO_CHECK' ? 'integer' : 'number', defaultValue: basePolicy.values[key]
}));
const parameters: ModelRunParameterDefinition[] = [
  { key: 'TARGET_POPULATION', title: 'Target population', description: '', group: 'General model control', type: 'integer', defaultValue: 12000 },
  { key: 'N_STEPS', title: 'Simulation duration', description: '', group: 'General model control', type: 'integer', defaultValue: configuration.policyMonths },
  { key: 'N_SIMS', title: 'Monte Carlo runs', description: '', group: 'General model control', type: 'integer', defaultValue: configuration.seeds },
  { key: 'recordCoreIndicators', title: 'Record core indicators', description: '', group: 'General model control', type: 'boolean', defaultValue: true },
  { key: 'TIME_TO_START_RECORDING_TRANSACTIONS', title: 'Start recording transactions', description: '', group: 'General model control', type: 'integer', defaultValue: 500 },
  { key: 'recordTransactions', title: 'Record transactions', description: '', group: 'General model control', type: 'boolean', defaultValue: true },
  ...policyParameters
];
const formValues = {
  ...Object.fromEntries(CENTRAL_BANK_POLICY_KEYS.map((key) => [key, String(basePolicy.values[key])])),
  CENTRAL_BANK_INITIAL_BASE_RATE: raised, N_STEPS: String(configuration.policyMonths), N_SIMS: String(configuration.seeds), recordCoreIndicators: true,
  TARGET_POPULATION: '12000', TIME_TO_START_RECORDING_TRANSACTIONS: '500', recordTransactions: true
};
const builderProps: ComponentProps<typeof ManualRunSetupCard> = {
  draftId: guideProps.draftId, formDisabled: false, submissionDisabled: false, submissionDisabledReason: '',
  isLoadingOptions: false, selectedBaseline: DEMO_MODEL_VERSION, onBaselineChange: noop,
  basePolicies: [basePolicy], basePolicy: basePolicy.id, onBasePolicyChange: noop,
  snapshots: [{ version: DEMO_MODEL_VERSION, status: 'stable', evidenceYear: 2011, outputCalibrated: true }],
  title: 'Bank Rate rise', onTitleChange: noop, parameters, policyParameters, formValues, onFormValueChange: noop,
  maxWorkers: '8', onMaxWorkersChange: noop, warnings: [], isSubmitting: false,
  manualSubmissionLockedBySensitivity: false, lockMessage: null, onSubmit: noop,
  policyDemo: { ...restored, savedStepId: 'policy-change-bank-rate' }
};
const renderBuilder = (overrides: Partial<typeof builderProps> = {}) => renderToStaticMarkup(createElement(StaticRouter, { location: '/scenarios/new' }, createElement(ManualRunSetupCard, { ...builderProps, ...overrides })));
const navigationBuilder = renderBuilder({ policyDemo: { ...restored, savedStepId: 'policy-navigation' } });
const guidedStepper = navigationBuilder.match(/<nav[^>]*class="scenario-stepper policy-stepper"[\s\S]*?<\/nav>/)?.[0] ?? '';
assert.ok(guidedStepper.includes('data-experiment-demo-target="policy-stepper"'));
assert.ok(guidedStepper.includes('tabindex="0"'), 'The highlighted strip supports keyboard scrolling');
const guidedSectionButtons = guidedStepper.match(/<button\b[^>]*>/g) ?? [];
assert.equal(guidedSectionButtons.length, 5);
assert.ok(guidedSectionButtons.every((button) => button.includes('disabled=""')), 'The navigation lesson describes normal section clicks without enabling them during the guide');
const bankRateBuilder = renderBuilder();
assert.ok(bankRateBuilder.includes('aria-current="step"><span>3</span>Policy settings'));
assert.match(bankRateBuilder, /<details[^>]*open=""[^>]*>\s*<summary[^>]*data-experiment-demo-target="policy-bank-rate-toggle"/);
assert.equal((bankRateBuilder.match(/data-experiment-demo-target="policy-bank-rate-input"/g) ?? []).length, 1);
assert.equal(bankRateBuilder.includes('policy-ftb-ltv-input'), false);
assert.ok(bankRateBuilder.includes('The reference run is not created automatically.'));
assert.match(bankRateBuilder, /<button[^>]*disabled=""[^>]*aria-label="Continue to next step"/);

const referenceBuilder = renderBuilder({ policyDemo: { ...restored, savedStepId: 'policy-reference-policy' } });
assert.ok(referenceBuilder.includes('aria-current="step"><span>3</span>Policy settings'));
assert.equal((referenceBuilder.match(/data-experiment-demo-target="policy-reference-policy"/g) ?? []).length, 1);
const exportsBuilder = renderBuilder({ policyDemo: { ...restored, savedStepId: 'policy-exports' } });
assert.ok(exportsBuilder.includes('aria-current="step"><span>4</span>Technical details'));
assert.match(exportsBuilder, /<button\b(?=[^>]*data-experiment-demo-target="policy-additional-exports-toggle")(?=[^>]*aria-expanded="true")[^>]*>/);
assert.equal((exportsBuilder.match(/data-experiment-demo-target="policy-additional-exports-content"/g) ?? []).length, 1);

const reviewBuilder = renderBuilder({ policyDemo: { ...restored, savedStepId: 'policy-complete' } });
assert.match(reviewBuilder, /<button\b(?=[^>]*class="[^"]*scenario-create-button)(?=[^>]*disabled="")[^>]*>/);
const pausedReview = renderBuilder({ initialStep: 4, policyDemo: { ...restored, paused: true, savedStepId: 'policy-complete' } });
assert.match(pausedReview, /<button\b(?=[^>]*class="[^"]*scenario-create-button)(?=[^>]*disabled="")[^>]*>/, 'Return to editing must not enable Start');
const pausedStepper = pausedReview.match(/<nav[^>]*class="scenario-stepper policy-stepper"[\s\S]*?<\/nav>/)?.[0] ?? '';
assert.ok(pausedStepper);
assert.equal(pausedStepper.includes('disabled=""'), false, 'All normal wizard sections are available in paused practice');
assert.equal(pausedReview.includes('guided-tour-layer'), false);

const submitContext = { ...restored, savedStepId: 'policy-submit', allowPolicySubmission: true };
const startTag = (markup: string): string => {
  const tag = markup.match(/<button\b(?=[^>]*class="[^"]*scenario-create-button)[^>]*>/)?.[0];
  assert.ok(tag, 'Review contains the real Start button');
  return tag;
};
assert.equal(startTag(renderBuilder({ policyDemo: submitContext })).includes('disabled=""'), false, 'Explicit permitted Start is available');
for (const policyDemo of [
  { ...submitContext, allowPolicySubmission: false },
  { ...submitContext, paused: true },
  { ...submitContext, savedStepId: 'policy-review-overview' },
  { ...submitContext, savedStepId: 'policy-complete' },
  { ...submitContext, policyRun: submittingRun },
  { ...submitContext, policyRun: submittedRun }
]) assert.ok(startTag(renderBuilder({ initialStep: 4, policyDemo })).includes('disabled=""'), 'Only the unsubmitted explicit submit stop permits Start');
for (const restriction of ['formDisabled', 'submissionDisabled', 'manualSubmissionLockedBySensitivity', 'isSubmitting'] as const) {
  assert.ok(startTag(renderBuilder({ policyDemo: submitContext, [restriction]: true })).includes('disabled=""'), `${restriction} still blocks the real button`);
}
const ordinaryReview = renderBuilder({ initialStep: 4, policyDemo: undefined });
assert.equal(startTag(ordinaryReview).includes('disabled=""'), false, 'Ordinary creation still permits Start');
const overwriteWarning = { code: 'output_folder_exists', message: 'Existing result.', severity: 'warning' as const };
assert.ok(renderBuilder({ initialStep: 4, policyDemo: undefined, warnings: [overwriteWarning] }).includes('Replace results and start'));
assert.equal(renderBuilder({ policyDemo: submitContext, warnings: [overwriteWarning] }).includes('Replace results and start'), false, 'Practice never presents an overwrite action');

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
  getItem: (key: string) => key === scenarioDraftStorageKey(guideProps.draftId)
    ? JSON.stringify({ version: 1, title: 'Bank Rate rise', calibratedModel: DEMO_MODEL_VERSION, basePolicy: basePolicy.id, formValues, maxWorkers: '8', currentStep: 2 }) : null
} });
try {
  const pausedRestored = renderBuilder({ policyDemo: { ...restored, paused: true, savedStepId: 'policy-complete' } });
  assert.ok(pausedRestored.includes('aria-current="step"><span>3</span>Policy settings'), 'Refresh in practice editing restores its saved wizard page');
  assert.equal(pausedRestored.includes('guided-tour-layer'), false);
} finally {
  if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'sessionStorage');
}

const cardSource = readFileSync(new URL('../src/pages/run-experiments/ManualRunSetupCard.tsx', import.meta.url), 'utf8');
assert.ok(cardSource.includes("policyDemo?.onCommit('name', event.target.value.trim())"), 'Typing a nonempty name enables Next without requiring Enter');
assert.ok(cardSource.includes("policyDemo?.onCommit('bankRate', '')"), 'An invalid Bank Rate edit clears the previous acknowledgement');
assert.ok(cardSource.includes("policyDemo?.onCommit('name', committedName)") && cardSource.includes("policyDemo?.onCommit('bankRate', value)"));
assert.ok(cardSource.includes('if (!isPolicyGuideActive && !isLoadingOptions) updateScenarioDraftStep(draftId, activeStep)'));
assert.ok(cardSource.includes('disabled={isLoadingOptions || policyPracticeSubmissionBlocked || formDisabled'), 'Both Start controls share the narrow practice guard');
assert.ok(cardSource.includes("policyDemo?.savedStepId !== 'policy-submit'") && cardSource.includes('policyDemo?.allowPolicySubmission !== true') && cardSource.includes('Boolean(policyDemo?.policyRun)'));
assert.ok(cardSource.includes('const confirmOverwrite = requiresOverwriteConfirmation && !isPolicyDemoActive'));
assert.equal((cardSource.match(/onSubmit\(confirmOverwrite\)/g) ?? []).length, 2, 'Both ordinary Start handlers retain confirmation while practice passes false');
assert.ok(cardSource.includes("if (step.id === 'policy-exports') setAdditionalExportsOpen(true)"));
assert.equal(cardSource.includes('committedDemoFtbLtv'), false);
assert.equal(cardSource.includes('ExperimentDemoOverlay'), false);

console.log('Policy creation guide: ten concise lessons, reference/export copy, committed actions, explicit real-run guard and restored practice wizard checks passed.');
