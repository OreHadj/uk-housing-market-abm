import assert from 'node:assert/strict';
import {
  buildNavigationDemoHref,
  NAVIGATION_DEMO_STEPS,
  navigationDemoExitHref,
  navigationDemoState,
  type NavigationDemoMode
} from '../src/lib/navigationDemo.js';
import { DEMO_CHOICES } from '../src/pages/HomePage.js';

const url = (href: string) => new URL(href, 'http://dashboard.local');

// The complete tour visits each workspace without opening or submitting a creation form.
assert.equal(NAVIGATION_DEMO_STEPS.full.length, 12);
assert.equal(NAVIGATION_DEMO_STEPS.results.length, 8);
assert.equal(NAVIGATION_DEMO_STEPS['model-information'].length, 3);
assert.deepEqual(new Set(NAVIGATION_DEMO_STEPS.full.map((step) => step.path)),
  new Set(['/', '/results', '/experiments', '/model-evidence']));
for (const mode of ['full', 'results', 'model-information'] as NavigationDemoMode[]) {
  const steps = NAVIGATION_DEMO_STEPS[mode];
  assert.equal(new Set(steps.map((step) => step.id)).size, steps.length);
  for (let index = 0; index < steps.length; index++) {
    const href = url(buildNavigationDemoHref(mode, index));
    // A refresh or copied link restores the same step on the right page.
    const resumed = navigationDemoState(href.searchParams);
    assert.equal(resumed?.mode, mode);
    assert.equal(resumed?.index, index);
    assert.equal(resumed?.step.path, href.pathname);
    assert.ok(steps[index].body.split(/\s+/).length <= 55, 'Keep each stop brief');
  }
}

const reportIndex = NAVIGATION_DEMO_STEPS.full.findIndex((step) => step.id === 'market');
const detailedIndex = NAVIGATION_DEMO_STEPS.full.findIndex((step) => step.id === 'detailed');
const sensitivityIndex = NAVIGATION_DEMO_STEPS.full.findIndex((step) => step.id === 'sensitivity-runs');
const selected = new URLSearchParams({ baselineRunId: 'saved policy + 1', comparisonRunId: 'reference/1', window: 'tail120', experimentId: 'saved-sweep', draft: 'ordinary-draft', journey: 'old-tour', demo: 'experiment' });
const detailed = url(buildNavigationDemoHref('full', detailedIndex, selected));
const sensitivity = url(buildNavigationDemoHref('full', sensitivityIndex, detailed.searchParams));
const backToReport = url(buildNavigationDemoHref('full', reportIndex, sensitivity.searchParams));
for (const entry of [detailed, sensitivity, backToReport]) {
  assert.equal(entry.searchParams.get('baselineRunId'), 'saved policy + 1');
  assert.equal(entry.searchParams.get('comparisonRunId'), 'reference/1');
  assert.equal(entry.searchParams.get('experimentId'), 'saved-sweep');
  assert.equal(entry.searchParams.get('window'), 'tail120');
  assert.equal(entry.searchParams.has('draft'), false);
  assert.equal(entry.searchParams.has('journey'), false);
}
assert.equal(detailed.searchParams.get('presentation'), 'detailed');
assert.equal(sensitivity.searchParams.get('type'), 'sensitivity');
assert.equal(backToReport.searchParams.get('presentation'), 'report');
assert.equal(backToReport.searchParams.get('type'), 'manual');

const modelSelection = new URLSearchParams('right=model-a&left=model-b&mode=compare&version=model-a&comparisonVersion=model-b&evidenceYear=2024');
const validation = url(buildNavigationDemoHref('model-information', 1, modelSelection));
const completion = url(buildNavigationDemoHref('model-information', 2, validation.searchParams));
const backToCalibration = url(buildNavigationDemoHref('model-information', 0, completion.searchParams));
for (const [key, value] of modelSelection) assert.equal(backToCalibration.searchParams.get(key), value);
assert.equal(url(buildNavigationDemoHref('full', 0, new URLSearchParams('mode=both'))).searchParams.has('mode'), false);

const exited = url(navigationDemoExitHref(detailed.pathname, detailed.searchParams));
assert.equal(exited.pathname, '/results');
assert.equal(exited.searchParams.get('baselineRunId'), 'saved policy + 1');
assert.equal(exited.searchParams.get('presentation'), 'detailed');
assert.ok(['demo', 'tour', 'step'].every((key) => !exited.searchParams.has(key)));
assert.equal(navigationDemoExitHref('/', new URLSearchParams('demo=navigation&tour=full&step=welcome')), '/');
assert.equal(navigationDemoState(new URLSearchParams('demo=experiment')), null);
assert.equal(navigationDemoState(new URLSearchParams('demo=navigation&tour=invalid&step=obsolete'))?.step.id, 'welcome');
assert.equal(navigationDemoState(url(buildNavigationDemoHref('results', -1)).searchParams)?.index, 0);
assert.equal(navigationDemoState(url(buildNavigationDemoHref('results', 99)).searchParams)?.step.id, 'finish');

// Legacy helpers remain available during the staged migration, but Home launches the new slice.
assert.equal(new URL(DEMO_CHOICES.find((choice) => choice.startHere)!.to, 'http://dashboard.local').searchParams.get('demo'), 'dashboard-overview');
assert.equal(DEMO_CHOICES.some((choice) => choice.to?.includes('demo=navigation')), false);
assert.equal(DEMO_CHOICES.find((choice) => choice.label === 'Create a policy scenario')?.to, '/scenarios/new?demo=experiment&mode=policy');
console.log('Navigation demo route, progress, selection and entry-point checks passed.');
