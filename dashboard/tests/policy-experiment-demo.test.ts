import assert from 'node:assert/strict';
import fs from 'node:fs';
import { POLICY_EXPERIMENT_DEMO_STEPS } from '../src/components/PolicyExperimentDemo';
import { SENSITIVITY_EXPERIMENT_DEMO_STEPS } from '../src/components/SensitivityExperimentDemo';
import { DEMO_CHOICES, DEMO_SECTIONS } from '../src/pages/HomePage';
import { GUIDED_DEMOS } from '../src/lib/guidedDemos/registry';
import { isExperimentDemoSubmissionBlocked } from '../src/pages/experiments/run/useExperimentRunController';

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
assert.deepEqual(DEMO_SECTIONS.map((section) => section.label), [
  'Getting started', 'Creating experiments', 'Exploring results', 'Model information'
]);
assert.deepEqual(DEMO_CHOICES.filter((choice) => choice.section === 'exploring-results' && !choice.unavailableReason).map((choice) => choice.guidedDemoId), GUIDED_DEMOS.filter((demo) => demo.id.endsWith('-results')).map((demo) => demo.id));
assert.ok(DEMO_CHOICES.filter((choice) => choice.unavailableReason).every((choice) => choice.label === 'Explore sensitivity results' && choice.unavailableReason === 'Coming soon'));
assert.ok(DEMO_CHOICES.every((choice) => choice.description && choice.to && DEMO_SECTIONS.some((section) => section.id === choice.section)));
const modelInformationDemo = GUIDED_DEMOS.find((demo) => demo.id === 'model-information');
assert.ok(modelInformationDemo);
assert.ok(DEMO_CHOICES.some((choice) => new URL(choice.to, 'http://dashboard.test').searchParams.get('demo') === modelInformationDemo.id));
assert.ok(modelInformationDemo.steps.some((step) => step.query.view === 'calibration'));
assert.ok(modelInformationDemo.steps.some((step) => step.query.view === 'validation'));
assert.equal(DEMO_CHOICES.find((choice) => choice.label === 'Create a policy scenario')?.to, '/scenarios/new?demo=experiment&mode=policy');
assert.equal(DEMO_CHOICES.find((choice) => choice.label === 'Create a sensitivity analysis')?.to, '/sensitivity/new?demo=experiment&mode=sensitivity');
assert.equal(DEMO_CHOICES.filter((choice) => choice.startHere).length, 1);
assert.ok(DEMO_CHOICES.every((choice) => !choice.to.includes('mode=both')));

for (const [steps, teachingCount, completionId] of [
  [POLICY_EXPERIMENT_DEMO_STEPS, 10, 'policy-complete'],
  [SENSITIVITY_EXPERIMENT_DEMO_STEPS, 8, 'sensitivity-complete']
] as const) {
  assert.equal(steps.length, teachingCount + 1);
  assert.equal(steps.at(-1)?.id, completionId);
  assert.equal(steps[0].targetId, completionId === 'policy-complete' ? null : 'sensitivity-name');
  assert.equal(new Set(steps.map((step) => step.id)).size, steps.length);
  for (const step of steps) {
    const copy = [step.body, ...('bullets' in step ? step.bullets ?? [] : [])].join(' ').trim();
    assert.ok(copy.split(/\s+/).length <= 45, step.id + ' exceeds copy budget');
    assert.ok(!step.body.includes('automatically'), step.id + ' must not describe automatic advancement');
  }
}

const page = read('../src/pages/ExperimentsPage.tsx');
const policy = read('../src/pages/run-experiments/ManualRunSetupCard.tsx');
const sensitivity = read('../src/pages/run-experiments/SensitivitySetupCard.tsx');
const controller = read('../src/pages/experiments/run/useExperimentRunController.ts');
const state = read('../src/lib/experimentDemo.ts');
const guide = read('../src/components/GuidedCreationDemo.tsx');
assert.ok(page.includes("const inlineSetup = initialView === 'create';"), 'Practice shares the current full-page builder');
assert.ok(page.includes('Start is disabled while editing this practice draft.'));
assert.ok(page.includes('Resume guide') && page.includes('Finish practice'));
assert.ok(!page.includes('Pause demo'));
assert.ok(page.includes('committedValues:') && page.includes('onCommit: recordDemoCommit'), 'Committed action evidence comes from persisted chapter progress');
assert.ok(policy.includes('isPolicyDemoActive') && sensitivity.includes('isSensitivityDemoActive'));
assert.ok(policy.includes('CENTRAL_BANK_INITIAL_BASE_RATE'), 'The real Bank Rate control is used');
assert.ok(guide.includes('GuidedTourOverlay'), 'Creation and results share the current spotlight engine');
assert.ok(!guide.includes('shouldAutoAdvanceExperimentDemoAction'), 'Legacy automatic advancement is retired');
for (const chapter of ['Policy', 'Sensitivity']) {
  const source = read('../src/components/' + chapter + 'ExperimentDemo.tsx');
  assert.ok(source.includes('GuidedCreationDemo'));
  assert.ok(!source.includes("from './ExperimentDemoOverlay'"));
}

assert.equal(isExperimentDemoSubmissionBlocked('manual', true), true);
assert.equal(isExperimentDemoSubmissionBlocked('sensitivity', true), true);
assert.equal(isExperimentDemoSubmissionBlocked('manual', false), false);
const manualSubmit = controller.slice(controller.indexOf('const onSubmitRun'), controller.indexOf('const onSubmitSensitivity'));
assert.ok(
  manualSubmit.indexOf('isExperimentDemoSubmissionBlocked(') >= 0 &&
  manualSubmit.indexOf('isExperimentDemoSubmissionBlocked(') < manualSubmit.indexOf('submitModelRun(payload)'),
  'Policy guard requires explicit practice permission before submitting'
);
const sensitivitySubmit = controller.slice(controller.indexOf('const onSubmitSensitivity'), controller.indexOf('const onCancelActiveSensitivity'));
assert.ok(
  sensitivitySubmit.indexOf('isExperimentDemoSubmissionBlocked(activeType, guidedPracticeActive, false, allowSensitivityPracticeSubmission)') >= 0 &&
  sensitivitySubmit.indexOf('isExperimentDemoSubmissionBlocked(activeType, guidedPracticeActive, false, allowSensitivityPracticeSubmission)') < sensitivitySubmit.indexOf('submitSensitivityExperiment(payload)'),
  'Sensitivity guard precedes both warning checks and confirmed submission'
);
assert.ok(controller.slice(controller.indexOf('const onCancelActiveSensitivity')).includes('if (guidedPracticeActive)'), 'Practice also blocks active-job cancellation');
assert.equal(state.includes('scenario-draft:v1:active'), false);
assert.equal(state.includes('sensitivity-draft:v1:active'), false);
console.log('Current creation integration, direct entry points, shared overlay and hard practice boundaries passed.');
