import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  experimentDemoStepContractViolations,
  shouldAutoAdvanceExperimentDemoAction,
  type ExperimentDemoStep
} from '../src/components/ExperimentDemoOverlay.js';
import {
  POLICY_EXPERIMENT_DEMO_STEPS,
  POLICY_EXPERIMENT_DEMO_TARGETS,
  PolicyExperimentDemo,
  committedExperimentDemoText,
  isCommittedExperimentDemoTextComplete,
  isPolicyExperimentDemoFtbLtvComplete,
  isPolicyExperimentDemoStepComplete
} from '../src/components/PolicyExperimentDemo.js';
import {
  SENSITIVITY_EXPERIMENT_DEMO_STEPS,
  SENSITIVITY_EXPERIMENT_DEMO_TARGETS,
  SensitivityExperimentDemo,
  isSensitivityExperimentDemoStepComplete,
  sensitivityExperimentDemoPreviewFingerprint,
  sensitivityExperimentDemoRangeFingerprint
} from '../src/components/SensitivityExperimentDemo.js';
import {
  EXPERIMENT_DEMO_COMBINED_LAUNCH_HREF,
  EXPERIMENT_DEMO_POLICY_LAUNCH_HREF,
  EXPERIMENT_DEMO_SENSITIVITY_LAUNCH_HREF
} from '../src/lib/experimentDemo.js';
import { DEMO_CHOICES, EXPERIMENT_DEMO_CHOICES } from '../src/pages/HomePage.js';
import { isExperimentDemoSubmissionBlocked } from '../src/pages/experiments/run/useExperimentRunController.js';

const noop = () => {};

for (const [href, path, mode] of [
  [EXPERIMENT_DEMO_COMBINED_LAUNCH_HREF, '/scenarios/new', 'both'],
  [EXPERIMENT_DEMO_POLICY_LAUNCH_HREF, '/scenarios/new', 'policy'],
  [EXPERIMENT_DEMO_SENSITIVITY_LAUNCH_HREF, '/sensitivity/new', 'sensitivity']
] as const) {
  const url = new URL(href, 'http://dashboard.local');
  assert.equal(url.pathname, path);
  assert.equal(url.searchParams.get('demo'), 'experiment');
  assert.equal(url.searchParams.get('mode'), mode);
}

assert.equal(
  DEMO_CHOICES.find((choice) => choice.label === 'Run experiment demo')?.opensExperimentChooser,
  true,
  'Run experiment demo should open the in-place Experiment sub-chooser'
);
assert.deepEqual(
  EXPERIMENT_DEMO_CHOICES.map((choice) => choice.label),
  ['Both — policy then sensitivity', 'Policy scenario demo', 'Sensitivity analysis demo']
);
assert.deepEqual(
  EXPERIMENT_DEMO_CHOICES.map((choice) => choice.to),
  [
    EXPERIMENT_DEMO_COMBINED_LAUNCH_HREF,
    EXPERIMENT_DEMO_POLICY_LAUNCH_HREF,
    EXPERIMENT_DEMO_SENSITIVITY_LAUNCH_HREF
  ]
);

assert.deepEqual(experimentDemoStepContractViolations(POLICY_EXPERIMENT_DEMO_STEPS), []);
assert.deepEqual(experimentDemoStepContractViolations(SENSITIVITY_EXPERIMENT_DEMO_STEPS), []);
assert.equal(POLICY_EXPERIMENT_DEMO_STEPS.length, 29);
assert.equal(SENSITIVITY_EXPERIMENT_DEMO_STEPS.length, 21);
assert.equal(POLICY_EXPERIMENT_DEMO_STEPS.at(-1)?.id, 'policy-complete');
assert.equal(SENSITIVITY_EXPERIMENT_DEMO_STEPS.at(-1)?.id, 'sensitivity-complete');

const chapterStepLists: readonly (readonly ExperimentDemoStep[])[] = [
  POLICY_EXPERIMENT_DEMO_STEPS,
  SENSITIVITY_EXPERIMENT_DEMO_STEPS
];
for (const steps of chapterStepLists) {
  steps.forEach((step, index) => {
    if (!step.reveals) return;
    const inspection = steps[index + 1];
    assert.equal(inspection?.kind, 'inspect', `${step.id} must immediately enter inspection`);
    assert.equal(inspection?.targetId, step.reveals);
    assert.equal(inspection?.pairedActionId, step.id);
    assert.notEqual(step.targetId, inspection?.targetId);
  });
}

const allTargetIds = [
  ...Object.values(POLICY_EXPERIMENT_DEMO_TARGETS),
  ...Object.values(SENSITIVITY_EXPERIMENT_DEMO_TARGETS)
];
assert.equal(new Set(allTargetIds).size, allTargetIds.length, 'Every semantic target id should be unique');

const eligibleTransition = {
  kind: 'action' as const,
  isSameStepVisit: true,
  sawIncompleteDuringVisit: true,
  isComplete: true,
  advancePendingOrHandled: false
};
assert.equal(shouldAutoAdvanceExperimentDemoAction(eligibleTransition), true);
assert.equal(
  shouldAutoAdvanceExperimentDemoAction({ ...eligibleTransition, advancePendingOrHandled: true }),
  false,
  'An action must advance exactly once'
);
assert.equal(
  shouldAutoAdvanceExperimentDemoAction({ ...eligibleTransition, sawIncompleteDuringVisit: false }),
  false,
  'Back to an already-complete action must not bounce'
);
assert.equal(
  shouldAutoAdvanceExperimentDemoAction({ ...eligibleTransition, isComplete: false }),
  false,
  'A rapid reversal must cancel pending advancement'
);
assert.equal(
  shouldAutoAdvanceExperimentDemoAction({ ...eligibleTransition, kind: 'inspect' }),
  false,
  'Inspection steps are never auto-advanced'
);
assert.equal(
  shouldAutoAdvanceExperimentDemoAction({ ...eligibleTransition, kind: 'info' }),
  false,
  'Informational steps wait for Next'
);

assert.equal(committedExperimentDemoText('F', false), '', 'Typing alone is not a commit');
assert.equal(committedExperimentDemoText('   ', true), '', 'Blank text is never valid');
assert.equal(committedExperimentDemoText('  FTB test  ', true), 'FTB test');
assert.equal(isCommittedExperimentDemoTextComplete('FTB test', 'FTB test', 1), true);
assert.equal(isCommittedExperimentDemoTextComplete('F', '', 0), false);
assert.equal(isPolicyExperimentDemoFtbLtvComplete('0.9', 0.95, '0.9', 1), true);
assert.equal(isPolicyExperimentDemoFtbLtvComplete('0.95', 0.95, '0.95', 1), false);
assert.equal(isPolicyExperimentDemoFtbLtvComplete('-0.1', 0.95, '-0.1', 1), false);

const policyState = {
  currentWizardStep: 0,
  currentName: 'FTB test',
  committedName: 'FTB test',
  nameCommitRevision: 1,
  openPolicyGroups: new Set(['bankRate', 'ltv', 'lti', 'affordability-and-btl']),
  currentFtbLtv: '0.9',
  referenceFtbLtv: 0.95,
  committedFtbLtv: '0.9',
  ftbCommitRevision: 1,
  additionalExportsOpen: true,
  recordingOpen: true,
  modelSelectionPending: false,
  selectedModel: 'v5o3',
  selectedReferencePolicy: '2024'
};
assert.equal(isPolicyExperimentDemoStepComplete('policy-name', policyState), true);
assert.equal(isPolicyExperimentDemoStepComplete('policy-open-bank-rate', policyState), true);
assert.equal(isPolicyExperimentDemoStepComplete('policy-open-ltv', policyState), true);
assert.equal(isPolicyExperimentDemoStepComplete('policy-change-ftb-ltv', policyState), true);
assert.equal(isPolicyExperimentDemoStepComplete('policy-open-lti', policyState), true);
assert.equal(isPolicyExperimentDemoStepComplete('policy-open-affordability', policyState), true);
assert.equal(isPolicyExperimentDemoStepComplete('policy-open-exports', policyState), true);
assert.equal(isPolicyExperimentDemoStepComplete('policy-open-recording', policyState), true);

const sampleValues = ['4', '4.5', '5.2'];
const sensitivityState = {
  currentWizardStep: 1,
  currentName: 'LTI sweep',
  committedName: 'LTI sweep',
  nameCommitRevision: 1,
  minValue: '4',
  maxValue: '5.2',
  sampleCount: '3',
  baselineValues: [4.5],
  committedRangeFingerprint: sensitivityExperimentDemoRangeFingerprint('4', '5.2'),
  committedRangePreviewFingerprint: sensitivityExperimentDemoPreviewFingerprint(sampleValues),
  rangeCommitRevision: 1,
  rangeChangedFromEntry: true,
  committedSampleCount: '3',
  committedSamplePreviewFingerprint: sensitivityExperimentDemoPreviewFingerprint(sampleValues),
  sampleCommitRevision: 1,
  sampleChangedFromEntry: true,
  sampleValues,
  instrumentSelectionPending: false,
  modelSelectionPending: false,
  selectedInstrument: 'owner_occupier_lti_soft_max',
  selectedModel: 'v5o3',
  selectedBaselinePolicy: '2024'
};
assert.equal(isSensitivityExperimentDemoStepComplete('sensitivity-name', sensitivityState), true);
assert.equal(isSensitivityExperimentDemoStepComplete('sensitivity-edit-range', sensitivityState), true);
assert.equal(isSensitivityExperimentDemoStepComplete('sensitivity-change-samples', sensitivityState), true);
assert.equal(
  isSensitivityExperimentDemoStepComplete('sensitivity-edit-range', {
    ...sensitivityState,
    baselineValues: [5.5]
  }),
  false,
  'The baseline-inside-range rule remains authoritative'
);
assert.equal(
  isSensitivityExperimentDemoStepComplete('sensitivity-change-samples', {
    ...sensitivityState,
    sampleCount: '3.5',
    committedSampleCount: '3.5'
  }),
  false,
  'Sample count must remain a whole number of at least two'
);

const policyCoordinatorProps = {
  active: true,
  paused: false,
  journeyId: 'experiment-demo-testjourney',
  draftId: 'experiment-demo-policy-v2-test',
  mode: 'policy' as const,
  savedStepId: 'policy-purpose',
  ready: true,
  loading: false,
  error: '',
  onRetryLoad: noop,
  onProgress: noop,
  onChapterComplete: noop,
  onContinueToSensitivity: noop,
  onFinish: noop,
  onPause: noop,
  onExit: noop,
  onRestoreStep: noop,
  ...policyState
};
const policyMarkup = renderToStaticMarkup(createElement(PolicyExperimentDemo, policyCoordinatorProps));
assert.ok(policyMarkup.includes('Build a policy scenario'));
assert.ok(policyMarkup.includes('Start chapter'));
assert.ok(policyMarkup.includes('Pause demo') && policyMarkup.includes('End demo'));
assert.ok(policyMarkup.includes('role="dialog"'));
assert.equal(policyMarkup.includes('aria-modal'), false, 'The coach must not nest a second aria-modal');

const sensitivityMarkup = renderToStaticMarkup(createElement(SensitivityExperimentDemo, {
  ...policyCoordinatorProps,
  mode: 'sensitivity' as const,
  draftId: 'experiment-demo-sensitivity-v2-test',
  savedStepId: 'sensitivity-purpose',
  onRestoreStep: noop,
  actionError: '',
  actionErrorTargetId: null,
  ...sensitivityState
}));
assert.ok(sensitivityMarkup.includes('Build a sensitivity analysis'));
assert.ok(sensitivityMarkup.includes('Start chapter'));
assert.equal(sensitivityMarkup.includes('aria-modal'), false);

const policyPurpose = POLICY_EXPERIMENT_DEMO_STEPS[0].body.split(/\s+/).length;
const sensitivityPurpose = SENSITIVITY_EXPERIMENT_DEMO_STEPS[0].body.split(/\s+/).length;
assert.ok(policyPurpose < 50 && sensitivityPurpose < 50, 'Both purpose descriptions stay below 50 words');

assert.equal(isExperimentDemoSubmissionBlocked('manual', true), true);
assert.equal(isExperimentDemoSubmissionBlocked('sensitivity', true), true);
assert.equal(isExperimentDemoSubmissionBlocked('manual', false), false);

const homeSource = fs.readFileSync(new URL('../src/pages/HomePage.tsx', import.meta.url), 'utf8');
const pageSource = fs.readFileSync(new URL('../src/pages/ExperimentsPage.tsx', import.meta.url), 'utf8');
const policyCardSource = fs.readFileSync(
  new URL('../src/pages/run-experiments/ManualRunSetupCard.tsx', import.meta.url),
  'utf8'
);
const sensitivityCardSource = fs.readFileSync(
  new URL('../src/pages/run-experiments/SensitivitySetupCard.tsx', import.meta.url),
  'utf8'
);
const controllerSource = fs.readFileSync(
  new URL('../src/pages/experiments/run/useExperimentRunController.ts', import.meta.url),
  'utf8'
);
const overlaySource = fs.readFileSync(
  new URL('../src/components/ExperimentDemoOverlay.tsx', import.meta.url),
  'utf8'
);
const demoStateSource = fs.readFileSync(new URL('../src/lib/experimentDemo.ts', import.meta.url), 'utf8');

assert.ok(homeSource.includes("setDemoChooserView('experiment')"));
assert.ok(homeSource.includes('Two ways to test policy'));
assert.ok(homeSource.includes('Both use a calibrated model, repeated seeds, saved drafts'));
assert.ok(pageSource.includes('continueExperimentDemoToSensitivity'));
assert.ok(pageSource.includes('completeExperimentDemoChapter'));
assert.ok(pageSource.includes('demoProgress?.paused'));
assert.ok(pageSource.includes('buildExperimentDemoLaunchHref(next.mode, next.journeyId, \'sensitivity\')'));

for (const target of Object.keys(POLICY_EXPERIMENT_DEMO_TARGETS)) {
  assert.ok(
    policyCardSource.includes(`POLICY_EXPERIMENT_DEMO_TARGETS.${target}`) ||
      target === 'continueButton',
    `Policy builder should expose target ${target}`
  );
}
for (const target of Object.keys(SENSITIVITY_EXPERIMENT_DEMO_TARGETS)) {
  assert.ok(
    sensitivityCardSource.includes(`SENSITIVITY_EXPERIMENT_DEMO_TARGETS.${target}`) ||
      target === 'fixedRecording',
    `Sensitivity builder should expose target ${target}`
  );
}
assert.ok(policyCardSource.includes('disabled={isLoadingOptions || isPolicyDemoActive}'));
assert.ok(sensitivityCardSource.includes('disabled={isLoadingOptions || isSensitivityDemoActive}'));
assert.ok(policyCardSource.includes('onBlur={(event) => commitDemoName(event.currentTarget.value)}'));
assert.match(
  sensitivityCardSource,
  /onBlur=\{\(\) => \{\s*commitDemoRange\(\);\s*clearValidationError\(true\);\s*\}\}/,
  'Range blur should commit the real values before returning from validation recovery to Continue'
);
assert.match(
  sensitivityCardSource,
  /onBlur=\{\(\) => \{\s*commitDemoSampleCount\(\);\s*clearValidationError\(true\);\s*\}\}/,
  'Sample-count blur should commit the real value before returning from validation recovery to Continue'
);
assert.ok(sensitivityCardSource.includes('actionErrorTargetId={stepErrorTargetId}'));
assert.ok(overlaySource.includes("currentStep.kind === 'action' && actionError && actionErrorTargetId"));
assert.ok(overlaySource.includes("closest<HTMLElement>('.scenario-create-modal-body')"));
assert.ok(overlaySource.includes('MutationObserver'));
assert.ok(overlaySource.includes("window.matchMedia('(prefers-reduced-motion: reduce)')"));
assert.ok(overlaySource.includes("event.key === 'Escape'"));
assert.ok(overlaySource.includes('visibleFocusableElements'));

const manualSubmitSource = controllerSource.slice(
  controllerSource.indexOf('const onSubmitRun'),
  controllerSource.indexOf('const onSubmitSensitivity')
);
assert.ok(
  manualSubmitSource.indexOf('isExperimentDemoSubmissionBlocked(activeType, experimentDemoActive)') >= 0 &&
    manualSubmitSource.indexOf('isExperimentDemoSubmissionBlocked(activeType, experimentDemoActive)') <
      manualSubmitSource.indexOf('submitModelRun(payload)'),
  'The hard Policy guard must run before either warning-check or confirmed submission'
);
const sensitivitySubmitSource = controllerSource.slice(
  controllerSource.indexOf('const onSubmitSensitivity'),
  controllerSource.indexOf('const onCancelActiveSensitivity')
);
assert.ok(
  sensitivitySubmitSource.indexOf('isExperimentDemoSubmissionBlocked(activeType, experimentDemoActive)') >= 0 &&
    sensitivitySubmitSource.indexOf('isExperimentDemoSubmissionBlocked(activeType, experimentDemoActive)') <
      sensitivitySubmitSource.indexOf('submitSensitivityExperiment({'),
  'The hard Sensitivity guard must run before either warning-check or confirmed submission'
);
assert.ok(
  controllerSource.slice(controllerSource.indexOf('const onCancelActiveSensitivity'))
    .includes('if (experimentDemoActive)'),
  'Demo mode must hard-block active-job cancellation as well as submission'
);
assert.equal(demoStateSource.includes('scenario-draft:v1:active'), false);
assert.equal(demoStateSource.includes('sensitivity-draft:v1:active'), false);
assert.ok(sensitivityCardSource.includes('const formDisabled = isSubmitting;'));

console.log('Complete Policy and Sensitivity experiment demo tests passed.');
