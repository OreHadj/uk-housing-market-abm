import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuidedTourOverlay, guidedTourCanAdvance } from '../src/components/GuidedTourOverlay.js';
import { DEMO_CHOICES } from '../src/pages/HomePage.js';
import {
  MODEL_INFORMATION_DEMO,
  legacyModelInformationDemoHref,
  modelInformationDemoSearch
} from '../src/lib/guidedDemos/modelInformation.js';
import {
  buildGuidedDemoHref,
  guidedDemoExitHref,
  guidedDemoState,
  hasGuidedDemoExamples,
  isGuidedActionComplete
} from '../src/lib/guidedDemos/registry.js';

const demo = MODEL_INFORMATION_DEMO;
const url = (href: string) => new URL(href, 'http://dashboard.local');
const choices = DEMO_CHOICES.filter((choice) => choice.section === 'model-information');
assert.equal(choices.length, 1, 'Home offers one combined calibration and validation demo');
assert.equal(guidedDemoState(url(choices[0].to).searchParams)?.definition.id, demo.id);
assert.equal(url(choices[0].to).searchParams.get('view'), 'calibration');
assert.equal(DEMO_CHOICES.some((choice) => url(choice.to).searchParams.get('demo') === 'validation'), false,
  'There is no standalone validation launch button');
assert.equal(hasGuidedDemoExamples(demo, [], []), true, 'Model information does not depend on example runs');

assert.equal(demo.steps.length, 6, 'The complete journey ends with one outcome and optional Details');
assert.equal(new Set(demo.steps.map((step) => step.id)).size, 6);
assert.equal(demo.steps[2].scrollOnEnter, 'start', 'Step 3 scrolls down to put the assumptions heading near the top');
assert.ok(demo.steps[2].target?.includes('[aria-expanded="true"]'), 'Wait for the assumptions panel to open before measuring and scrolling');
assert.deepEqual(demo.steps.map((step) => step.query.view), [
  'calibration', 'calibration', 'calibration', 'validation', 'validation', 'validation'
]);
for (const step of demo.steps) {
  assert.equal(step.body, '', 'The shared overlay presents concise bullets instead of long paragraphs');
  assert.ok(step.bullets && step.bullets.length >= 2 && step.bullets.length <= 3);
  assert.ok([...step.bullets, step.actionHint ?? ''].join(' ').trim().split(/\s+/).length <= 40,
    `${step.id} exceeds the short lesson copy budget`);
  assert.ok(step.target, 'Each stop highlights a real page section');
  if (step.kind === 'info') {
    assert.equal(step.completion, undefined, 'Information stops do not retain old comparison gates');
    assert.equal(guidedTourCanAdvance(step.kind, false, 'ready', 'ready'), true);
  }
}

const requested = new URLSearchParams('right=v5o3&left=v4o1&comparisonVersion=v4o1&evidenceYear=2024&mode=compare');
const original = requested.toString();
const clean = modelInformationDemoSearch(requested);
assert.equal(requested.toString(), original, 'Normalising demo state must not mutate the caller’s page search');
assert.equal(clean.get('version'), 'v5o3');
assert.equal(clean.get('evidenceYear'), '2024');
assert.equal(modelInformationDemoSearch(new URLSearchParams('version=v0o7&right=v5o3')).get('version'), 'v0o7');

// Exercise forward, Back across the page boundary, and URL-owned refresh restoration.
let current = requested;
for (const index of [0, 1, 2, 3, 2, 3, 4, 5, 4, 5]) {
  const next = url(buildGuidedDemoHref(demo.id, index, current));
  const state = guidedDemoState(next.searchParams);
  assert.equal(state?.index, index);
  assert.equal(state?.completed, false, 'The page handoff is part of one uninterrupted journey');
  assert.equal(next.pathname, '/model-evidence');
  assert.equal(next.searchParams.get('view'), index < 3 ? 'calibration' : 'validation');
  assert.equal(next.searchParams.get('version'), 'v5o3', 'The selected model follows both directions');
  assert.equal(next.searchParams.get('evidenceYear'), '2024');
  assert.equal(next.searchParams.get('mode'), index < 3 ? 'single' : null);
  for (const key of ['left', 'right', 'comparisonVersion']) assert.equal(next.searchParams.has(key), false);
  assert.deepEqual(
    Object.fromEntries(url(buildGuidedDemoHref(demo.id, index, next.searchParams, true)).searchParams),
    Object.fromEntries(next.searchParams),
    'Refresh preserves the same stop, model and evidence year');
  current = next.searchParams;
}

const comparisonIndex = demo.steps.findIndex((step) => step.id === 'validation-comparison');
const comparisonStep = demo.steps[comparisonIndex];
assert.equal(comparisonStep.interactive, true, 'The comparison selector is usable during its stop');
assert.equal(comparisonStep.kind, 'info', 'Choosing a second model is optional');
let withComparison = url(buildGuidedDemoHref(demo.id, comparisonIndex, current)).searchParams;
withComparison.set('comparisonVersion', 'v4o1');
for (const index of [comparisonIndex, comparisonIndex + 1, comparisonIndex, 5]) {
  const next = url(buildGuidedDemoHref(demo.id, index, withComparison));
  assert.equal(next.searchParams.get('comparisonVersion'), 'v4o1', 'The chosen comparison survives Next and Back in Validation');
  assert.equal(next.searchParams.get('version'), 'v5o3');
  assert.equal(next.searchParams.get('evidenceYear'), '2024');
  const restored = url(buildGuidedDemoHref(demo.id, index, next.searchParams, true));
  assert.equal(restored.searchParams.get('comparisonVersion'), 'v4o1', 'Refresh retains the chosen comparison');
  withComparison = next.searchParams;
}
assert.equal(url(guidedDemoExitHref('/model-evidence', withComparison)).searchParams.get('comparisonVersion'), 'v4o1',
  'Finish leaves both models visible on the ordinary Validation page');
const clearedComparison = new URLSearchParams(withComparison);
clearedComparison.delete('comparisonVersion');
assert.equal(url(buildGuidedDemoHref(demo.id, comparisonIndex + 1, clearedComparison)).searchParams.has('comparisonVersion'), false,
  'Clearing the comparison is respected by subsequent steps');
assert.equal(url(buildGuidedDemoHref(demo.id, 2, withComparison)).searchParams.has('comparisonVersion'), false,
  'Returning to Calibration restores its single-model presentation');
const sameModelComparison = new URLSearchParams(withComparison);
sameModelComparison.set('comparisonVersion', 'v5o3');
assert.equal(url(buildGuidedDemoHref(demo.id, comparisonIndex, sameModelComparison)).searchParams.has('comparisonVersion'), false,
  'A duplicate comparison cannot compare the primary model against itself');

for (const legacy of [
  'demo=model-evidence&view=calibration&step=compare&right=v5o3&left=v4o1&mode=compare',
  'demo=model-evidence&view=validation&step=comparison-results&version=v5o3&comparisonVersion=v4o1',
  'demo=validation&view=validation&step=methodology&version=v5o3&comparisonVersion=v4o1'
]) {
  const search = new URLSearchParams(`${legacy}&evidenceYear=2024&journey=old-progress&tour=old-tour&metric=old-metric`);
  const migrated = url(legacyModelInformationDemoHref(search)!);
  const state = guidedDemoState(migrated.searchParams);
  assert.equal(state?.definition.id, demo.id);
  assert.equal(state?.index, 0, 'Obsolete long-tour step IDs restart the short combined demo safely');
  assert.equal(migrated.searchParams.get('view'), 'calibration');
  assert.equal(migrated.searchParams.get('mode'), 'single');
  assert.equal(migrated.searchParams.get('version'), 'v5o3');
  assert.equal(migrated.searchParams.get('evidenceYear'), '2024');
  for (const key of ['comparisonVersion', 'left', 'right', 'journey', 'tour', 'metric']) {
    assert.equal(migrated.searchParams.has(key), false, `${key} from the old tour must not interfere`);
  }
  assert.equal(legacyModelInformationDemoHref(migrated.searchParams), null, 'Migration cannot loop');
}
assert.equal(legacyModelInformationDemoHref(new URLSearchParams('view=validation&version=v5o3')), null,
  'Ordinary model information navigation is unaffected');

const actions = demo.steps.filter((step) => step.kind === 'action');
assert.equal(actions.length, 0, 'The demo requires neither a comparison model nor opening Details');
const detailsStep = demo.steps[5];
assert.equal(detailsStep.id, 'validation-outcome');
assert.match(detailsStep.bullets?.join(' ') ?? '', /Details contains the supporting sources and scoring notes/);
assert.equal(detailsStep.interactive, true);
assert.equal(detailsStep.actionHint, undefined);
assert.equal(detailsStep.completion, undefined);
const detailsClosed = { querySelector: () => null };
assert.equal(isGuidedActionComplete(detailsStep.completion, current, detailsClosed), false);
assert.equal(guidedTourCanAdvance(detailsStep.kind, false, 'ready', 'ready'), true,
  'The final outcome step can finish while Details is closed');
const retiredSources = new URLSearchParams(current);
retiredSources.set('step', 'validation-sources');
const resumed = guidedDemoState(retiredSources)!;
assert.equal(resumed.step.id, 'validation-outcome', 'The removed seventh stop resumes at the final outcome');
assert.equal(resumed.index, 5);
const restoredOutcome = url(buildGuidedDemoHref(demo.id, resumed.index, retiredSources, true));
assert.equal(restoredOutcome.searchParams.get('step'), 'validation-outcome');
assert.equal(restoredOutcome.searchParams.get('version'), 'v5o3');
assert.equal(restoredOutcome.searchParams.get('evidenceYear'), '2024');

assert.equal(demo.finishOnLastStep, true, 'The final stop ends on the highlighted page without a separate completion screen');
const noop = () => {};
const finalMarkup = renderToStaticMarkup(createElement(GuidedTourOverlay, {
  demoLabel: demo.label, step: detailsStep, stepIndex: 5, stepCount: demo.steps.length,
  isComplete: false, onBack: noop, onNext: noop, onExit: noop,
  completionActions: [{ id: 'finish', label: 'Finish', onClick: noop, primary: true }]
}));
assert.ok(finalMarkup.includes('6 of 6'));
assert.ok(finalMarkup.includes('guided-tour-bullets'));
assert.ok(finalMarkup.includes('>Finish</button>'));
assert.ok(finalMarkup.includes('>Back</button>') && finalMarkup.includes('>Exit</button>'));
assert.equal(finalMarkup.includes('>Next</button>'), false);
const exit = url(guidedDemoExitHref('/model-evidence', current));
assert.equal(guidedDemoState(exit.searchParams), null);
assert.equal(exit.searchParams.get('view'), 'validation');
assert.equal(exit.searchParams.get('version'), 'v5o3');
assert.equal(exit.searchParams.get('evidenceYear'), '2024');

console.log('Short combined model information demo: launch, optional comparison and Details, model continuity, legacy migration and Finish checks passed.');
