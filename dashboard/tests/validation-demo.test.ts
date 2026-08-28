import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  getValidationDemoTargetState,
  isValidationComparisonReady,
  isValidationDemoRequested,
  isValidationDemoRequiredActionStep,
  isValidationDemoStepComplete,
  resolveValidationDemoResumeStep,
  shouldAutoAdvanceValidationDemoStep,
  VALIDATION_DEMO_COMPLETION,
  VALIDATION_DEMO_COMPLETION_EVENT,
  VALIDATION_DEMO_REQUIRED_ACTION_STEPS,
  VALIDATION_DEMO_SESSION_KEY,
  VALIDATION_DEMO_STEPS,
  VALIDATION_DEMO_TARGETS,
  type ValidationDemoRuntimeState,
  validationDemoMetricTargetId,
  validationDemoProvenanceTargetId,
  validationDemoThemeTargetId,
  ValidationDemoPrototype
} from '../src/components/ValidationDemoPrototype.js';
import { ValidationPage } from '../src/pages/ValidationPage.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const validationPageSource = fs.readFileSync(
  path.resolve(repoRoot, 'dashboard/src/pages/ValidationPage.tsx'),
  'utf-8'
);
const walkthroughSource = fs.readFileSync(
  path.resolve(repoRoot, 'dashboard/src/components/ValidationDemoPrototype.tsx'),
  'utf-8'
);
const collapsibleSource = fs.readFileSync(
  path.resolve(repoRoot, 'dashboard/src/components/CollapsibleSection.tsx'),
  'utf-8'
);
const homePageSource = fs.readFileSync(
  path.resolve(repoRoot, 'dashboard/src/pages/HomePage.tsx'),
  'utf-8'
);
const handoffSource = fs.readFileSync(
  path.resolve(repoRoot, 'docs/validation-demo-handoff.txt'),
  'utf-8'
);

const expectedStepIds = [
  'purpose',
  'primary-model',
  'compare',
  'status-legend',
  'sort-models',
  'comparison-model',
  'comparison-results',
  'summary-card',
  'outcome-comparisons',
  'themes',
  'representative-metric',
  'sources-and-provenance',
  'methodology'
] as const;

assert.deepEqual(
  VALIDATION_DEMO_STEPS.map((step) => step.id),
  expectedStepIds,
  'The walkthrough should preserve Phase 1 and add the approved Phase 2 sequence'
);
assert.deepEqual(
  VALIDATION_DEMO_STEPS.map((step) => step.title),
  [
    'What validation is for',
    'Inspect one model',
    'Compare two models',
    'Read pass, warn, and fail',
    'Sort models by evidence fit',
    'Choose a comparison model',
    'Read the side-by-side results',
    'Open the summary card',
    'Open outcome comparisons',
    'Explore the five evidence themes',
    'Inspect a representative metric',
    'Check sources and provenance',
    'Review the validation method'
  ]
);

const stepIds = VALIDATION_DEMO_STEPS.map((step) => step.id);
const targetIds = VALIDATION_DEMO_STEPS.flatMap((step) => step.targetId ? [step.targetId] : []);
assert.equal(new Set(stepIds).size, stepIds.length, 'Validation demo step ids should be unique');
assert.equal(new Set(targetIds).size, targetIds.length, 'Validation demo target roles should be unique');

assert.deepEqual(
  VALIDATION_DEMO_REQUIRED_ACTION_STEPS,
  [
    'compare',
    'sort-models',
    'comparison-model',
    'summary-card',
    'outcome-comparisons',
    'themes',
    'representative-metric',
    'sources-and-provenance',
    'methodology'
  ],
  'Only steps that require a real UI action should auto-advance'
);
for (const stepId of VALIDATION_DEMO_REQUIRED_ACTION_STEPS) {
  assert.equal(isValidationDemoRequiredActionStep(stepId), true, `${stepId} should be action-required`);
}
for (const stepId of ['purpose', 'primary-model', 'status-legend', 'comparison-results'] as const) {
  assert.equal(isValidationDemoRequiredActionStep(stepId), false, `${stepId} should remain informational`);
}

const transitionedToComplete = {
  isSameStepVisit: true,
  sawIncompleteDuringVisit: true,
  isComplete: true,
  advancePendingOrHandled: false
} as const;
for (const stepId of VALIDATION_DEMO_REQUIRED_ACTION_STEPS) {
  assert.equal(
    shouldAutoAdvanceValidationDemoStep({ stepId, ...transitionedToComplete }),
    true,
    `${stepId} should auto-advance after its new incomplete-to-complete transition`
  );
}
assert.equal(
  shouldAutoAdvanceValidationDemoStep({ stepId: 'compare', ...transitionedToComplete }),
  true,
  'A newly checked Compare control should auto-advance'
);
assert.equal(
  shouldAutoAdvanceValidationDemoStep({ stepId: 'status-legend', ...transitionedToComplete }),
  false,
  'Informational steps must still wait for Next'
);
assert.equal(
  shouldAutoAdvanceValidationDemoStep({
    stepId: 'compare',
    ...transitionedToComplete,
    isSameStepVisit: false
  }),
  false,
  'A completed state observed while entering a step is a review state, not a new transition'
);
assert.equal(
  shouldAutoAdvanceValidationDemoStep({
    stepId: 'compare',
    ...transitionedToComplete,
    sawIncompleteDuringVisit: false
  }),
  false,
  'Back navigation to an already-completed action must not bounce forward'
);
assert.equal(
  shouldAutoAdvanceValidationDemoStep({
    stepId: 'compare',
    ...transitionedToComplete,
    isComplete: false
  }),
  false,
  'A reversed action must cancel automatic progression'
);
assert.equal(
  shouldAutoAdvanceValidationDemoStep({
    stepId: 'compare',
    ...transitionedToComplete,
    advancePendingOrHandled: true
  }),
  false,
  'A scheduled or consumed transition must not advance twice'
);
assert.equal(
  shouldAutoAdvanceValidationDemoStep({ stepId: 'methodology', ...transitionedToComplete }),
  true,
  'Opening Methodology should transition to completion'
);

const purposeStep = VALIDATION_DEMO_STEPS[0];
assert.ok(
  purposeStep.body.trim().split(/\s+/).length <= 50,
  'The approved purpose copy should remain at or below 50 whitespace-delimited words'
);
assert.equal(
  purposeStep.body,
  'Validation checks whether a model reproduces independent UK housing evidence. Use this page to see which outcomes pass, warn, or fail, how consistent they are across random seeds, and whether one model version performs better than another.'
);

const themeStep = VALIDATION_DEMO_STEPS.find((step) => step.id === 'themes');
assert.ok(themeStep);
for (const title of [
  'Market activity and lending',
  'Credit and affordability',
  'Prices and cycles',
  'Tenure and rental market',
  'Distributional realism'
]) {
  assert.ok(themeStep.body.includes(title), `Theme guidance should name ${title}`);
}
assert.match(themeStep.body, /distribution shape and loss/i);

assert.equal(
  isValidationDemoRequested(new URLSearchParams('view=validation&demo=validation')),
  true,
  'The direct Validation demo URL should arm the walkthrough'
);
assert.equal(isValidationDemoRequested(new URLSearchParams('view=validation')), false);
assert.equal(isValidationDemoRequested(new URLSearchParams('view=validation&demo=results')), false);

function runtime(overrides: Partial<ValidationDemoRuntimeState> = {}): ValidationDemoRuntimeState {
  return {
    primaryVersion: 'v5o3',
    isCompareChecked: false,
    sortMetricId: '',
    requestedComparisonVersion: '',
    loadedComparisonVersion: '',
    isComparisonLoading: false,
    comparisonError: '',
    isSummaryOpen: false,
    isOutcomeComparisonsOpen: false,
    isRepresentativeThemeOpen: false,
    isRepresentativeMetricOpen: false,
    isRepresentativeProvenanceOpen: false,
    isMethodologyOpen: false,
    ...overrides
  };
}

const comparisonReadyState = runtime({
  isCompareChecked: true,
  sortMetricId: 'core_mortgageApprovals',
  requestedComparisonVersion: 'v4o1',
  loadedComparisonVersion: 'v4o1'
});

assert.equal(isValidationDemoStepComplete('compare', runtime()), false, 'Compare should be required');
assert.equal(
  isValidationDemoStepComplete('compare', runtime({ isCompareChecked: true })),
  true,
  'The real checked state should complete Compare'
);
assert.equal(isValidationDemoStepComplete('sort-models', runtime()), false, 'A non-empty sort metric is required');
assert.equal(
  isValidationDemoStepComplete('sort-models', runtime({ sortMetricId: 'core_mortgageApprovals' })),
  true
);
assert.equal(isValidationComparisonReady(comparisonReadyState), true);
assert.equal(
  isValidationComparisonReady(runtime({
    ...comparisonReadyState,
    loadedComparisonVersion: 'v3o1'
  })),
  false,
  'A stale comparison response must not unlock Next'
);
assert.equal(
  isValidationComparisonReady(runtime({
    ...comparisonReadyState,
    isComparisonLoading: true
  })),
  false,
  'Loading must keep comparison selection incomplete'
);
assert.equal(
  isValidationComparisonReady(runtime({
    ...comparisonReadyState,
    comparisonError: 'Request failed'
  })),
  false,
  'A comparison error must keep the step recoverable and incomplete'
);
for (const pendingComparisonState of [
  runtime({
    ...comparisonReadyState,
    loadedComparisonVersion: 'v3o1'
  }),
  runtime({
    ...comparisonReadyState,
    isComparisonLoading: true
  }),
  runtime({
    ...comparisonReadyState,
    comparisonError: 'Request failed'
  })
]) {
  assert.equal(
    shouldAutoAdvanceValidationDemoStep({
      stepId: 'comparison-model',
      ...transitionedToComplete,
      isComplete: isValidationDemoStepComplete('comparison-model', pendingComparisonState)
    }),
    false,
    'Model 2 must not advance for stale, loading, or failed comparison state'
  );
}
assert.equal(
  shouldAutoAdvanceValidationDemoStep({
    stepId: 'comparison-model',
    ...transitionedToComplete,
    isComplete: isValidationDemoStepComplete('comparison-model', comparisonReadyState)
  }),
  true,
  'Model 2 should advance only when the requested comparison response is exactly ready'
);

for (const [stepId, stateKey] of [
  ['summary-card', 'isSummaryOpen'],
  ['outcome-comparisons', 'isOutcomeComparisonsOpen'],
  ['themes', 'isRepresentativeThemeOpen'],
  ['representative-metric', 'isRepresentativeMetricOpen'],
  ['sources-and-provenance', 'isRepresentativeProvenanceOpen'],
  ['methodology', 'isMethodologyOpen']
] as const) {
  assert.equal(isValidationDemoStepComplete(stepId, runtime()), false, `${stepId} should require its real disclosure`);
  assert.equal(isValidationDemoStepComplete(stepId, runtime({ [stateKey]: true })), true);
}

const fullyPreparedState = runtime({
  ...comparisonReadyState,
  isSummaryOpen: true,
  isOutcomeComparisonsOpen: true,
  isRepresentativeThemeOpen: true,
  isRepresentativeMetricOpen: true,
  isRepresentativeProvenanceOpen: true,
  isMethodologyOpen: true
});
assert.equal(resolveValidationDemoResumeStep('methodology', runtime()), 'compare');
assert.equal(
  resolveValidationDemoResumeStep('methodology', runtime({ isCompareChecked: true })),
  'sort-models'
);
assert.equal(
  resolveValidationDemoResumeStep('methodology', runtime({
    isCompareChecked: true,
    sortMetricId: 'core_mortgageApprovals'
  })),
  'comparison-model'
);
assert.equal(
  resolveValidationDemoResumeStep('methodology', comparisonReadyState),
  'summary-card'
);
assert.equal(
  resolveValidationDemoResumeStep('methodology', runtime({ ...fullyPreparedState, isRepresentativeMetricOpen: false })),
  'representative-metric'
);
assert.equal(resolveValidationDemoResumeStep('methodology', fullyPreparedState), 'methodology');

assert.equal(validationDemoThemeTargetId('activity'), 'validation-theme-activity');
assert.equal(
  validationDemoMetricTargetId('core_mortgageApprovals'),
  'validation-metric-core_mortgageApprovals'
);
assert.equal(
  validationDemoProvenanceTargetId('core_mortgageApprovals'),
  'validation-provenance-core_mortgageApprovals'
);

const compareStep = VALIDATION_DEMO_STEPS.find((step) => step.id === 'compare');
assert.ok(compareStep);
assert.equal(getValidationDemoTargetState(compareStep, null), 'missing');
assert.equal(getValidationDemoTargetState(purposeStep, null), 'not-required');
assert.ok(
  walkthroughSource.includes("targetState === 'missing'") &&
    walkthroughSource.includes('This demo step isn’t ready') &&
    walkthroughSource.includes('Retry') &&
    walkthroughSource.includes('Exit demo'),
  'A missing target should produce a recoverable Retry and Exit state'
);

assert.match(
  validationPageSource,
  /<section[\s\S]{0,220}data-validation-demo-target=\{VALIDATION_DEMO_TARGETS\.primaryModel\}[\s\S]{0,160}aria-labelledby="validation-primary-model-heading"/,
  'The Primary-model hook should be on the real Primary model column'
);
assert.match(
  validationPageSource,
  /<label[\s\S]{0,220}data-validation-demo-target=\{VALIDATION_DEMO_TARGETS\.compareToggle\}[\s\S]{0,100}<input\s+type="checkbox"/,
  'The Compare hook should wrap the real Compare checkbox'
);
assert.ok(validationPageSource.includes('data-validation-demo-target={VALIDATION_DEMO_TARGETS.statusLegend}'));
assert.ok(validationPageSource.includes('data-validation-demo-target={VALIDATION_DEMO_TARGETS.sortModels}'));
assert.ok(validationPageSource.includes('demoTarget={VALIDATION_DEMO_TARGETS.comparisonModel}'));
assert.ok(validationPageSource.includes('rootDemoTarget={VALIDATION_DEMO_TARGETS.comparisonResults}'));
assert.ok(validationPageSource.includes('demoTarget={VALIDATION_DEMO_TARGETS.summaryCard}'));
assert.ok(validationPageSource.includes('demoTarget={VALIDATION_DEMO_TARGETS.outcomeComparisons}'));
assert.ok(validationPageSource.includes('demoTarget={validationDemoThemeTargetId(theme.id)}'));
assert.ok(
  validationPageSource.includes('data-validation-demo-target={metric.metricId === demoMetricId') &&
    validationPageSource.includes('validationDemoMetricTargetId(metric.metricId)'),
  'The representative-metric step should target the real table Details button'
);
assert.ok(
  validationPageSource.includes('data-validation-demo-target={validationDemoProvenanceTargetId(demoMetricId)}'),
  'The provenance step should target the real disclosure inside the table details panel'
);
assert.ok(validationPageSource.includes('demoTarget={VALIDATION_DEMO_TARGETS.methodology}'));
assert.ok(collapsibleSource.includes('data-validation-demo-target={demoTarget}'));
assert.ok(collapsibleSource.includes('data-validation-demo-target={rootDemoTarget}'));

assert.ok(
  validationPageSource.includes('loadedComparisonVersion={loadedComparisonVersion}') &&
    validationPageSource.includes('comparisonError={validationDemoComparisonError}') &&
    validationPageSource.includes('setValidationReloadToken((current) => current + 1)'),
  'The tour should wait for an exact comparison response and expose retry recovery'
);
assert.ok(
  validationPageSource.includes('open={isValidationSummaryOpen}') &&
    validationPageSource.includes('open={isOutcomeComparisonsOpen}') &&
    validationPageSource.includes('open={isValidationMethodologyOpen}') &&
    validationPageSource.includes('activeMetricId={activeValidationDetail?.metric.metricId}') &&
    validationPageSource.includes('sourceOpen={openValidationProvenanceIds.has(activeValidationDetail.metric.metricId)}'),
  'Required disclosures should be controlled by the real page state'
);
assert.ok(
  walkthroughSource.includes('window.sessionStorage') &&
    walkthroughSource.includes('resolveValidationDemoResumeStep') &&
    !walkthroughSource.includes('window.localStorage'),
  'Pause/resume should be tab-scoped and prerequisite-aware'
);
assert.ok(
  walkthroughSource.includes('sawIncompleteDuringVisitRef') &&
    walkthroughSource.includes('autoAdvanceHandledRef') &&
    walkthroughSource.includes('autoAdvanceVisitRef') &&
    walkthroughSource.includes('latest.stepId !== scheduledStepId') &&
    walkthroughSource.includes('!latest.isComplete') &&
    walkthroughSource.includes('window.cancelAnimationFrame(frame)'),
  'Runtime auto-advance should be visit-scoped, exactly once, revalidated, and cancellable'
);
assert.ok(
  walkthroughSource.includes("{isRequiredActionStep ? 'Continue' : 'Next'}") &&
    !walkthroughSource.includes('previousStepCompletionRef'),
  'Completed review steps should retain Continue without focusing the old action before advancement'
);
for (const staleMessage of ['You can continue.', 'You can finish.']) {
  assert.equal(walkthroughSource.includes(staleMessage), false, `Remove stale action copy: ${staleMessage}`);
}
assert.ok(
  handoffSource.includes('automatically advance') &&
    !handoffSource.includes('Do not auto-advance on the same click.') &&
    !handoffSource.includes('After the user presses Next on step 3'),
  'The handoff should describe automatic required-action progression'
);
assert.equal(VALIDATION_DEMO_SESSION_KEY, 'validation-demo-progress-v1');
assert.equal(VALIDATION_DEMO_COMPLETION_EVENT, 'validation-demo:complete');
assert.ok(
  walkthroughSource.includes('completionEventName = VALIDATION_DEMO_COMPLETION_EVENT') &&
    walkthroughSource.includes('window.dispatchEvent(new CustomEvent(completionEventName'),
  'Standalone Validation should retain its default completion event while allowing journey context'
);
assert.ok(
  walkthroughSource.includes('progressStorageKey = VALIDATION_DEMO_SESSION_KEY'),
  'Standalone Validation should retain its original progress key by default'
);

function renderValidation(entry: string): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [entry] },
      createElement(Routes, null, createElement(Route, {
        path: '/model-evidence',
        element: createElement(ValidationPage)
      }))
    )
  );
}

const ordinaryValidationMarkup = renderValidation('/model-evidence?view=validation');
assert.ok(ordinaryValidationMarkup.includes('Primary model'));
assert.ok(ordinaryValidationMarkup.includes('Comparison model'));
assert.ok(ordinaryValidationMarkup.includes('Check Compare to enable this column.'));
assert.equal(
  ordinaryValidationMarkup.includes('validation-demo-layer'),
  false,
  'Non-demo Validation rendering should not include the walkthrough overlay'
);
for (const target of [
  VALIDATION_DEMO_TARGETS.primaryModel,
  VALIDATION_DEMO_TARGETS.compareToggle,
  VALIDATION_DEMO_TARGETS.statusLegend,
  VALIDATION_DEMO_TARGETS.sortModels,
  VALIDATION_DEMO_TARGETS.comparisonModel
]) {
  assert.ok(ordinaryValidationMarkup.includes(`data-validation-demo-target="${target}"`));
}

const purposeMarkup = renderToStaticMarkup(createElement(ValidationDemoPrototype, {
  active: true,
  ready: true,
  ...runtime(),
  representativeThemeId: 'activity',
  representativeMetricId: 'core_mortgageApprovals',
  onRetryComparison: () => undefined,
  onPause: () => undefined,
  onFinish: () => undefined,
  onExitToHome: () => undefined
}));
assert.ok(purposeMarkup.includes('Validation demo · 1 of 13'));
assert.ok(purposeMarkup.includes('What validation is for'));
assert.ok(purposeMarkup.includes('Start demo'));
assert.ok(purposeMarkup.includes('Exit demo'));
assert.ok(purposeMarkup.includes('role="dialog"'));
assert.equal(purposeMarkup.includes('aria-modal'), false, 'The coach must not claim modal semantics over an external target');
assert.ok(walkthroughSource.includes('aria-live="polite"'));

assert.equal(VALIDATION_DEMO_COMPLETION.title, 'Validation walkthrough complete');
assert.ok(VALIDATION_DEMO_COMPLETION.body.includes('representative metric’s sources and scoring method'));
assert.ok(walkthroughSource.includes('Finish and inspect page'));
assert.ok(walkthroughSource.includes('Exit to Home'));
assert.ok(walkthroughSource.includes('prefers-reduced-motion: reduce'));

assert.ok(
  (homePageSource.match(/to: null/g) ?? []).length === 2 &&
    homePageSource.includes('to: POLICY_EXPERIMENT_DEMO_LAUNCH_HREF') &&
    homePageSource.includes('to: MODEL_EVIDENCE_DEMO_LAUNCH_HREF') &&
    homePageSource.includes('disabled={!choice.to}'),
  'Experiment and Model Evidence should launch while the other demo choices remain disabled'
);

console.log('Validation demo walkthrough tests passed.');
