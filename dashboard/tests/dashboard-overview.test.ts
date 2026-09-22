import assert from 'node:assert/strict';
import { DASHBOARD_OVERVIEW_DEMO } from '../src/lib/guidedDemos/dashboardOverview.js';

const overview = DASHBOARD_OVERVIEW_DEMO;
const destinations = [
  ['home', '/', 'Home'],
  ['experiments', '/experiments', 'Experiments'],
  ['results', '/results', 'Results'],
  ['model-information', '/model-evidence', 'Model information'],
  ['settings', '/settings', 'Settings']
];
const textById = (id: string): string => {
  const step = overview.steps.find((candidate) => candidate.id === id);
  assert.ok(step, `Missing ${id} overview stop`);
  return [step.body, ...(step.bullets ?? [])].filter(Boolean).join(' ');
};

assert.equal(overview.id, 'dashboard-overview');
assert.equal(overview.label, 'Explore the dashboard');
assert.equal(overview.startHere, true);
assert.equal(overview.finishOnLastStep, true, 'Finish remains on the highlighted Settings link');
assert.equal(overview.duration, 'Five short stops');
assert.deepEqual(overview.requiredRunIds, [], 'Orientation does not require saved model runs');
assert.deepEqual(overview.requiredExperimentIds, [], 'Orientation does not require sensitivity examples');
assert.deepEqual(overview.steps.map((step) => [step.id, step.path, step.title]), destinations);
assert.equal(new Set(overview.steps.map((step) => step.id)).size, 5);
assert.ok(overview.completion.title && overview.completion.body, 'A fallback completion card remains available');

for (const step of overview.steps) {
  assert.equal(step.kind, 'info');
  assert.equal(step.interactive, false, `${step.id} does not require sidebar interaction`);
  assert.equal(step.target, `[data-guided-target="sidebar-${step.id}"]`, 'Only primary sidebar links are highlighted');
  assert.deepEqual(step.query, {}, 'Overview leaves each page in its ordinary starting state');
  assert.equal(step.completion, undefined, 'No action gate or data-dependent completion check');
  assert.equal(step.actionHint, undefined);
  assert.equal(step.completionNote, undefined);
  assert.equal(step.additionalInteractiveTargets, undefined);
  assert.ok(step.bullets && step.bullets.length >= 2 && step.bullets.length <= 3);
  assert.ok(textById(step.id).split(/\s+/).length <= 25, `${step.id} stays concise`);
  assert.ok(step.unavailableBody.includes('Back'));
  assert.ok(step.id === 'settings'
    ? step.unavailableBody.includes('Finish') && !step.unavailableBody.includes('Exit')
    : step.unavailableBody.includes('Next') && step.unavailableBody.includes('Exit'));
}

const experiments = textById('experiments');
assert.ok(experiments.includes('one policy configuration'));
assert.ok(experiments.includes('range of values for one policy instrument'));
const results = textById('results');
assert.ok(results.includes('Compare saved policy runs') && results.includes('sensitivity results'));
assert.ok(results.includes('Detailed') && results.includes('submitted jobs'));
const model = textById('model-information');
assert.ok(overview.steps.find((step) => step.id === 'model-information')?.bullets?.[0].startsWith('Understand the model’s assumptions'));
assert.ok(model.includes('outputs match observed housing market data'));
assert.ok(model.includes('Calibration explains the setup. Validation checks the fit to evidence'));
assert.doesNotMatch(model, /independen|out.of.sample/i, 'A check of fit is not described as independent validation');
const settings = textById('settings');
assert.ok(settings.includes('application information in browser and desktop versions'));
assert.ok(settings.includes('Desktop also opens results and logs folders, and exports support bundles'));

console.log('Dashboard overview: five concise sidebar stops, routes, no example dependencies, and accurate page options passed.');
