import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExperimentDemoProgressEvent, ExperimentDemoStepProgressEvent } from '../src/lib/experimentDemo';
import type { CreationDemoStep, GuidedCreationDemoProps } from '../src/lib/guidedDemos/creation';
import {
  GuidedCreationDemo, createCreationDemoLifecycle, creationDemoOverlayProps,
  resolveCreationDemoStep, synchronizeCreationDemo
} from '../src/components/GuidedCreationDemo';
import { GuidedTourOverlay } from '../src/components/GuidedTourOverlay';

const steps: CreationDemoStep[] = [
  { id: 'intro', chapter: 'policy', kind: 'info', targetId: null, wizardStep: 0, title: 'Build a policy scenario', body: 'Nothing in this practice is submitted.' },
  { id: 'name', chapter: 'policy', kind: 'action', targetId: 'policy-name', additionalTargetIds: ['policy-name-help'], wizardStep: 0, title: 'Name it', body: 'Enter a name.', actionHint: 'Press Enter to commit your name.', completionNote: 'Your name is saved in the practice draft.' },
  { id: 'model', chapter: 'policy', kind: 'info', targetId: 'policy-model', wizardStep: 1, title: 'Choose the model', body: 'Keep this model for the example.' },
  { id: 'complete', chapter: 'policy', kind: 'info', targetId: null, wizardStep: 4, title: 'Ready to explore', body: 'Nothing has been submitted.' }
];
const progress: ExperimentDemoStepProgressEvent[] = [];
const restored: string[] = [];
const completed: ExperimentDemoProgressEvent[] = [];
const actionCalls: string[] = [];
const props: GuidedCreationDemoProps = {
  active: true, paused: false, chapter: 'policy', label: 'Create a policy scenario',
  journeyId: 'experiment-demo-test-journey', draftId: 'experiment-demo-policy-v2-test-draft', mode: 'policy',
  savedStepId: 'intro', committedValues: {}, ready: true, loading: false, error: '',
  steps, completionStepId: 'complete', fingerprint: 'initial draft',
  onRetryLoad: () => actionCalls.push('retry'), onCommit: () => actionCalls.push('commit'),
  onProgress: (event) => progress.push(event), onRestoreStep: (step) => restored.push(step.id),
  onChapterComplete: (event) => completed.push(event), isStepComplete: () => false,
  onContinueToSensitivity: () => actionCalls.push('forbidden combined onward action'),
  onFinish: () => actionCalls.push('finish'), onExploreResults: () => actionCalls.push('explore'),
  onPause: () => actionCalls.push('editing'), onExit: () => actionCalls.push('exit')
};

assert.equal(resolveCreationDemoStep(steps, 'name')?.index, 1);
assert.equal(resolveCreationDemoStep(steps, 'retired-step')?.step.id, 'intro');
assert.equal(resolveCreationDemoStep([], 'intro'), null);
const lifecycle = createCreationDemoLifecycle();
for (const unavailable of [{ active: false }, { paused: true }, { ready: false }, { loading: true }, { error: 'Unavailable' }]) {
  assert.equal(synchronizeCreationDemo({ ...props, ...unavailable }, lifecycle), false);
}
assert.equal(progress.length, 0);
assert.equal(restored.length, 0);

assert.equal(synchronizeCreationDemo({ ...props, savedStepId: 'retired-step' }, lifecycle), true);
assert.deepEqual(restored, ['intro']);
assert.deepEqual(progress, [{ journeyId: props.journeyId, chapter: 'policy', draftId: props.draftId, stepId: 'intro', fingerprint: 'initial draft' }]);
// New callbacks/step objects must not restore the builder page or emit duplicate state updates.
const updatedCallbacks = { ...props, steps: steps.map((step) => ({ ...step, body: `${step.body} Current copy.` })), onRestoreStep: (step: CreationDemoStep) => restored.push(`new:${step.id}`), onProgress: (event: ExperimentDemoStepProgressEvent) => progress.push(event) };
assert.equal(synchronizeCreationDemo(updatedCallbacks, lifecycle), false);
assert.equal(progress.length, 1);
assert.equal(restored.length, 1);
assert.equal(synchronizeCreationDemo({ ...updatedCallbacks, fingerprint: 'edited draft', isStepComplete: () => true }, lifecycle), false);
assert.equal(progress.at(-1)?.stepId, 'intro', 'Draft edits and action completion must never advance the stop.');
assert.equal(progress.at(-1)?.fingerprint, 'edited draft');
assert.equal(restored.length, 1, 'Fingerprint changes must not restore/reset the builder.');

const navigation = createCreationDemoLifecycle();
synchronizeCreationDemo(props, navigation);
const beforeNext = progress.length;
creationDemoOverlayProps(props, navigation).onNext();
assert.equal(progress.length, beforeNext + 1);
assert.equal(progress.at(-1)?.stepId, 'name');
const named = { ...props, savedStepId: 'name' };
const beforeEntry = progress.length;
synchronizeCreationDemo(named, navigation);
assert.equal(progress.length, beforeEntry, 'Entering an explicitly persisted stop does not write it twice.');
assert.equal(restored.at(-1), 'name');
const gated = creationDemoOverlayProps(named, navigation);
assert.equal(gated.isComplete, false);
assert.equal(gated.step.interactive, true);
assert.equal(gated.step.target, '[data-experiment-demo-target="policy-name"]');
assert.deepEqual(gated.step.additionalInteractiveTargets, ['[data-experiment-demo-target="policy-name-help"]']);
const done = creationDemoOverlayProps({ ...named, isStepComplete: () => true }, navigation);
assert.equal(done.isComplete, true);
assert.equal(progress.length, beforeEntry, 'Unlocking Next is separate from advancing.');

const attempted: string[] = [];
let blocked = false;
const refused = creationDemoOverlayProps({ ...named, isStepComplete: () => true, onBeforeAdvance: (next) => { attempted.push(next.id); return false; } }, navigation, false, (value) => { blocked = value; });
refused.onNext();
assert.deepEqual(attempted, ['model']);
assert.equal(blocked, true);
assert.equal(progress.length, beforeEntry, 'Native invalid fields keep the current stop.');
assert.equal(creationDemoOverlayProps(named, navigation, true).feedback, 'Check the highlighted fields before continuing.');
assert.equal(creationDemoOverlayProps({ ...named, feedback: 'Correct the value in this field.' }, navigation, true).feedback, 'Correct the value in this field.');
const repairedSteps = steps.map((step) => step.id === 'name' ? { ...step, targetId: 'invalid-field', interactive: true } : { ...step });
const beforeRetarget = restored.length;
synchronizeCreationDemo({ ...named, steps: repairedSteps, fingerprint: 'repairing field', feedback: 'Check this field.' }, navigation);
assert.equal(restored.length, beforeRetarget, 'Repairing a native validation field must not reset the builder page.');
assert.equal(creationDemoOverlayProps({ ...named, steps: repairedSteps }, navigation).step.target, '[data-experiment-demo-target="invalid-field"]');

const accepted = creationDemoOverlayProps({ ...named, onBeforeAdvance: (next) => { attempted.push(next.id); return true; } }, navigation, true, (value) => { blocked = value; });
accepted.onNext();
assert.equal(blocked, false);
assert.equal(progress.at(-1)?.stepId, 'model');
const atModel = { ...props, savedStepId: 'model' };
synchronizeCreationDemo(atModel, navigation);
assert.equal(creationDemoOverlayProps(atModel, navigation).step.interactive, false);
assert.equal(creationDemoOverlayProps({ ...atModel, steps: steps.map((step) => ({ ...step, interactive: true })) }, navigation).step.interactive, true);
creationDemoOverlayProps({ ...atModel, onBeforeAdvance: () => { throw new Error('Back must not validate forward navigation'); } }, navigation).onBack();
assert.equal(progress.at(-1)?.stepId, 'name');

const completionState = createCreationDemoLifecycle();
const atCompletion = { ...props, savedStepId: 'complete' };
synchronizeCreationDemo(atCompletion, completionState);
const completionCount = completed.length;
synchronizeCreationDemo({ ...atCompletion, fingerprint: 'a later draft' }, completionState);
assert.equal(completed.length, completionCount);
synchronizeCreationDemo({ ...atCompletion, paused: true }, completionState);
const beforeResume = restored.length;
synchronizeCreationDemo(atCompletion, completionState);
assert.equal(restored.length, beforeResume + 1, 'Unpausing restores the currently saved builder page once.');
assert.equal(completed.length, completionCount, 'Resuming the same completion card does not complete the chapter again.');
const finalActions = creationDemoOverlayProps(atCompletion, completionState).completionActions!;
assert.deepEqual(finalActions.map((action) => action.label), ['Finish', 'Explore example policy results', 'Return to editing']);
finalActions.forEach((action) => action.onClick());
assert.deepEqual(actionCalls, ['finish', 'explore', 'editing']);
assert.equal(creationDemoOverlayProps({ ...atCompletion, onExploreResults: undefined }, completionState).completionActions!.length, 2);
creationDemoOverlayProps(atCompletion, completionState).onBack();
assert.equal(progress.at(-1)?.stepId, 'model', 'Completion Back uses the actual index, not the clamped displayed count.');
synchronizeCreationDemo(atModel, completionState);
synchronizeCreationDemo(atCompletion, completionState);
assert.equal(completed.length, completionCount + 1, 'Only a new entry to completion notifies again.');
const differentJourney = { ...atCompletion, journeyId: 'experiment-demo-new-journey' };
synchronizeCreationDemo(differentJourney, completionState);
assert.equal(completed.at(-1)?.journeyId, differentJourney.journeyId);

const render = (overrides: Partial<GuidedCreationDemoProps> = {}) => renderToStaticMarkup(createElement(GuidedCreationDemo, { ...props, ...overrides }));
const first = render();
assert(first.includes('Create a policy scenario · 1 of 3'));
assert.match(first, /<button[^>]*disabled=""[^>]*>Back<\/button>/);
assert(first.includes('>Next</button>') && first.includes('>Exit</button>'));
assert.equal(render({ active: false }), '');
assert.equal(render({ paused: true }), '');
const waiting = render({ savedStepId: 'name' });
assert.match(waiting, /<button[^>]*disabled=""[^>]*>Next<\/button>/);
assert(waiting.includes('Press Enter to commit your name.'));
const completeAction = render({ savedStepId: 'name', isStepComplete: () => true });
assert(completeAction.includes('Your name is saved in the practice draft.'));
assert(!completeAction.includes('>Finish</button>'), 'Completing a real action keeps its coach visible until explicit Next.');
const final = render({ savedStepId: 'complete' });
assert(final.includes('Create a policy scenario · 3 of 3'));
assert(!final.includes('4 of 3'));
assert(final.includes('>Finish</button>') && final.includes('>Return to editing</button>'));
assert(!final.includes('>Next</button>') && !final.includes('Continue to sensitivity'));
assert(render({ ready: false, loading: true }).includes('Loading the policy scenario'));
assert(render({ chapter: 'sensitivity', ready: false, loading: true }).includes('Loading the sensitivity analysis'));
const error = render({ error: 'Model options could not be loaded.', ready: false });
assert(error.includes('Could not load the policy scenario') && error.includes('Model options could not be loaded.'));
assert(error.includes('>Retry</button>') && error.includes('>Exit</button>'));
const errorOverlay = creationDemoOverlayProps({ ...props, error: 'Loading failed' }, createCreationDemoLifecycle());
errorOverlay.completionActions![0].onClick(); errorOverlay.onExit();
assert.deepEqual(actionCalls.slice(-2), ['retry', 'exit']);
assert(render({ steps: [] }).includes('Practice guide unavailable'));
assert(render({ steps: [] }).includes('>Exit</button>'), 'An absent definition still provides a usable exit.');
// Adapter does not re-block the shared overlay's timeout-enabled Next with another action check.
const fallback = creationDemoOverlayProps(named, createCreationDemoLifecycle());
fallback.onNext();
assert.equal(progress.at(-1)?.stepId, 'model');
const feedback = renderToStaticMarkup(createElement(GuidedTourOverlay, creationDemoOverlayProps(named, createCreationDemoLifecycle(), true)));
assert(feedback.includes('role="alert"') && feedback.includes('Check the highlighted fields before continuing.'));

console.log('guided-creation-coordinator: controlled progress, explicit transitions, entry/commit persistence, native validation recovery, pause/completion and SSR controls passed.');
