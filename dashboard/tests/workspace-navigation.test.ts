import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { WorkspaceTypeNavigation } from '../src/components/WorkspaceTypeNavigation.js';
import { ModelInformationNavigation } from '../src/components/ModelInformationNavigation.js';
import {
  MODEL_INFORMATION_VIEWS,
  buildModelInformationViewHref,
  buildResultsTypeHref,
  getActivePrimaryDestination,
  getExperimentType,
  getResultsType,
  getResultsNavigationSearch,
  isResultsLanding,
  getModelInformationView,
  resolveExperimentSetupHref,
  type PrimaryDestination
} from '../src/lib/workspaceNavigation.js';
import {
  readScenarioDraft,
  setActiveScenarioDraftId,
  writeScenarioDraft
} from '../src/lib/scenarioDraft.js';
import {
  readSensitivityDraft,
  setActiveSensitivityDraftId,
  writeSensitivityDraft
} from '../src/lib/sensitivityDraft.js';

const primaryDestinations: ReadonlyArray<readonly [string, PrimaryDestination | null]> = [
  ['/', 'home'],
  ['/experiments', 'experiments'],
  ['/scenarios', 'experiments'],
  ['/scenarios/new', 'experiments'],
  ['/sensitivity', 'experiments'],
  ['/sensitivity/new', 'experiments'],
  ['/runs', 'experiments'],
  ['/new-scenario', 'experiments'],
  ['/compare', 'experiments'],
  ['/results', 'results'],
  ['/model-evidence', 'model-evidence'],
  ['/calibration', 'model-evidence'],
  ['/validation', 'model-evidence'],
  ['/settings', 'settings'],
  ['/login', null]
];
for (const [pathname, expected] of primaryDestinations) {
  assert.equal(getActivePrimaryDestination(pathname), expected, pathname);
}
assert.equal(getExperimentType('/experiments'), null, 'The landing page must not imply a chosen experiment');
assert.equal(getExperimentType('/scenarios/new'), 'manual');
assert.equal(getExperimentType('/sensitivity/new'), 'sensitivity');
assert.equal(getExperimentType('/scenarios'), 'manual');
assert.equal(getExperimentType('/sensitivity'), 'sensitivity');
assert.equal(getExperimentType('/results'), null);
assert.equal(getResultsType(new URLSearchParams()), 'manual');
assert.equal(getResultsType(new URLSearchParams('type=unknown')), 'manual');
assert.equal(getResultsType(new URLSearchParams('type=manual')), 'manual');
assert.equal(getResultsType(new URLSearchParams('type=%20sensitivity%20')), 'sensitivity');
for (const query of ['', 'type=', 'baselineRunId=%20', 'demo=dashboard-overview&step=results', 'utm_source=help']) {
  assert.equal(isResultsLanding(new URLSearchParams(query)), true, `General Results opens the landing page for ${query}`);
}
for (const [query, expectedType] of [
  ['type=manual', 'manual'],
  ['type=sensitivity', 'sensitivity'],
  ['type=unknown', 'manual'],
  ['baselineRunId=scenario&comparisonRunId=baseline', 'manual'],
  ['comparisonRunId=baseline', 'manual'],
  ['runId=legacy-scenario', 'manual'],
  ['experimentId=sweep', 'sensitivity'],
  ['jobRef=manual:queued-run', 'manual'],
  ['jobRef=sensitivity:queued-sweep', 'sensitivity'],
  ['type=manual&experimentId=sweep&jobRef=sensitivity:old-sweep', 'manual'],
  ['type=sensitivity&baselineRunId=scenario&jobRef=manual:old-run', 'sensitivity'],
  ['baselineRunId=scenario&experimentId=sweep', 'manual'],
  ['presentation=report2&runId=legacy-scenario', 'manual'],
  ['presentation=detailed&experimentId=sweep', 'sensitivity'],
  ['presentation=report', 'manual'],
  ['queue=open', 'manual'],
  ['window=post500&indicator=core_mortgageApprovals', 'manual'],
  ['outcome=core_mortgageApprovals&setting=point-1&experimentId=sweep', 'sensitivity'],
  ['policyResults=open', 'manual'],
  ['demo=policy-results&step=choose-runs', 'manual'],
  ['demo=sensitivity-results', 'sensitivity'],
  ['demo=navigation&tour=results', 'manual'],
  ['practice=policy&journey=old', 'manual'],
  ['practice=sensitivity&journey=old', 'sensitivity'],
  ['resultsDemo=policy-results', 'manual'],
  ['resultsDemo=sensitivity-results', 'sensitivity']
] as const) {
  const search = new URLSearchParams(query);
  assert.equal(isResultsLanding(search), false, `A specific results link bypasses the landing page for ${query}`);
  assert.equal(getResultsType(search), expectedType, `The results type is retained for ${query}`);
}

const originalSearch = new URLSearchParams({
  type: 'manual',
  baselineRunId: 'scenario-1',
  runId: 'legacy-scenario',
  comparisonRunId: 'scenario-2',
  experimentId: 'sweep-1',
  presentation: 'detailed',
  queue: 'open',
  jobRef: 'manual:job-1',
  futureControl: 'keep me'
});
const originalQuery = originalSearch.toString();
const rememberedSearch = new URLSearchParams(originalSearch);
rememberedSearch.delete('presentation');
const walkthroughSearch = new URLSearchParams(originalSearch);
for (const key of ['demo', 'step', 'tour', 'from', 'journey', 'practice', 'resultsDemo']) walkthroughSearch.set(key, 'old-tour');
assert.equal(getResultsNavigationSearch(walkthroughSearch), `?${rememberedSearch}`, 'Remembered navigation retains selections without remembering Detailed or restarting a walkthrough');
assert.equal(walkthroughSearch.get('demo'), 'old-tour', 'Remembering a selection leaves the active walkthrough untouched');
assert.equal(walkthroughSearch.get('presentation'), 'detailed', 'Remembering a selection does not change the open presentation');
const sensitivityHref = buildResultsTypeHref(originalSearch, 'sensitivity');
const sensitivityLocation = new URL(sensitivityHref, 'http://dashboard.test');
assert.equal(sensitivityLocation.pathname, '/results');
assert.equal(getResultsType(sensitivityLocation.searchParams), 'sensitivity');
assert.equal(sensitivityLocation.searchParams.get('presentation'), 'report', 'Switching result types always opens Report');
assert.equal(originalSearch.toString(), originalQuery, 'Building a link must not mutate the current route');
for (const [key, value] of originalSearch) {
  if (key !== 'type' && key !== 'presentation') assert.equal(sensitivityLocation.searchParams.get(key), value, key);
}
const reportSearch = new URLSearchParams(originalSearch);
reportSearch.set('presentation', 'report');
assert.equal(
  buildResultsTypeHref(sensitivityLocation.searchParams, 'manual'),
  `/results?${reportSearch}`,
  'Returning to policy results retains selections and opens Report'
);

function renderTypes(area: 'experiments' | 'results', path: string, resultsSearch?: string) {
  return renderToStaticMarkup(createElement(
    MemoryRouter,
    { initialEntries: [path] },
    createElement(WorkspaceTypeNavigation, { area, resultsSearch })
  ));
}

const offRouteResults = renderTypes('results', '/model-evidence?view=validation&version=model-a', `?${originalQuery}`);
assert.equal(offRouteResults.includes('aria-current'), false, 'Expanded Results links must not claim to be current on another page');
const retainedResultsHrefs = [...offRouteResults.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll('&amp;', '&'));
assert.deepEqual(retainedResultsHrefs, [
  buildResultsTypeHref(originalSearch, 'manual'),
  buildResultsTypeHref(originalSearch, 'sensitivity')
], 'Expanded Results links preserve the last Results selection and exclude the current evidence query');

const unvisitedResults = renderTypes('results', '/model-evidence?view=validation&version=model-a');
assert.ok(unvisitedResults.includes('href="/results?type=manual&amp;presentation=report"'));
assert.ok(unvisitedResults.includes('href="/results?type=sensitivity&amp;presentation=report"'));
assert.equal(unvisitedResults.includes('version=model-a'), false, 'Before visiting Results, its links start without unrelated page state');

const currentResults = renderTypes('results', '/results?type=sensitivity&experimentId=current-sweep', `?${originalQuery}`);
const activeResultsLink = currentResults.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
assert.equal(activeResultsLink.length, 1);
assert.ok(activeResultsLink[0].includes('type=sensitivity'));
assert.ok(activeResultsLink[0].includes('experimentId=current-sweep'), 'The current Results query takes precedence over cached navigation state');
assert.equal(currentResults.includes('baselineRunId=scenario-1'), false);
for (const path of ['/results', '/results?demo=dashboard-overview&step=results']) {
  const landingResults = renderTypes('results', path, `?${originalQuery}`);
  assert.equal(landingResults.includes('aria-current'), false, 'The Results landing page has no selected subtype');
  const hrefs = [...landingResults.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll('&amp;', '&'));
  assert.deepEqual(hrefs, [buildResultsTypeHref(originalSearch, 'manual'), buildResultsTypeHref(originalSearch, 'sensitivity')], 'Landing navigation retains the previous selections');
}

const offRouteExperiments = renderTypes('experiments', '/model-evidence?view=validation');
assert.equal(offRouteExperiments.includes('aria-current'), false, 'Expanded experiment links are inactive away from setup');
assert.ok(offRouteExperiments.includes('href="/scenarios/new"'));
assert.ok(offRouteExperiments.includes('href="/sensitivity/new"'));

assert.deepEqual(MODEL_INFORMATION_VIEWS.map(({ id, label }) => ({ id, label })), [
  { id: 'calibration', label: 'Calibration' },
  { id: 'validation', label: 'Validation' }
]);
for (const query of ['', 'view=unknown', 'view=', 'view=calibration', 'view=%20calibration%20']) {
  assert.equal(getModelInformationView(new URLSearchParams(query)), 'calibration', query);
}
assert.equal(getModelInformationView(new URLSearchParams('view=%20validation%20')), 'validation');

const evidenceSearch = new URLSearchParams({
  view: 'calibration', mode: 'compare', left: 'model-a', right: 'model-b', version: 'model-b',
  metric: 'core_housingTransactions', validationTargetYear: '2024', from: 'sensitivity',
  draft: 'retained-practice-draft', sensitivityStep: 'model-baseline', return: '/sensitivity/new?draft=retained-practice-draft',
  demo: 'model-evidence', demoStep: 'evidence-stop', journey: 'retained-journey', futureControl: 'keep me'
});
evidenceSearch.append('futureControl', 'keep this too');
const evidenceQuery = evidenceSearch.toString();
const validationHref = buildModelInformationViewHref(evidenceSearch, 'validation');
const validationLocation = new URL(validationHref, 'http://dashboard.test');
assert.equal(validationLocation.pathname, '/model-evidence');
assert.equal(getModelInformationView(validationLocation.searchParams), 'validation');
assert.equal(evidenceSearch.toString(), evidenceQuery, 'Section links must not mutate the current evidence route');
for (const key of evidenceSearch.keys()) {
  if (key !== 'view') assert.deepEqual(validationLocation.searchParams.getAll(key), evidenceSearch.getAll(key), key);
}
assert.equal(
  buildModelInformationViewHref(validationLocation.searchParams, 'calibration'),
  `/model-evidence?${evidenceQuery}`,
  'Switching evidence sections round trips selections, draft returns, demo state and repeated parameters'
);

function renderModelInformation(path: string, modelInformationSearch?: string) {
  return renderToStaticMarkup(createElement(
    MemoryRouter,
    { initialEntries: [path] },
    createElement(ModelInformationNavigation, { modelInformationSearch })
  ));
}
function linkHrefs(markup: string): string[] {
  return [...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll('&amp;', '&'));
}

const offRouteEvidence = renderModelInformation('/results?type=sensitivity&experimentId=unrelated', `?${evidenceQuery}`);
assert.match(offRouteEvidence, /class="sidebar-type-navigation" role="group" aria-label="Model information sections"/);
assert.equal((offRouteEvidence.match(/class="sidebar-type-link"/g) ?? []).length, 2);
assert.equal(offRouteEvidence.includes('aria-current'), false, 'Expanded evidence links must not claim to be current away from Model information');
assert.deepEqual(linkHrefs(offRouteEvidence), [
  buildModelInformationViewHref(evidenceSearch, 'calibration'),
  buildModelInformationViewHref(evidenceSearch, 'validation')
], 'Off-route evidence links use the cached evidence query, not the current workspace query');
assert.equal(offRouteEvidence.includes('experimentId=unrelated'), false);

const unvisitedEvidence = renderModelInformation('/results?type=sensitivity&experimentId=unrelated');
assert.deepEqual(linkHrefs(unvisitedEvidence), ['/model-evidence?view=calibration', '/model-evidence?view=validation']);
const currentEvidence = renderModelInformation('/model-evidence?view=validation&version=current-model&metric=current-metric&draft=current-draft', `?${evidenceQuery}`);
const activeEvidenceLinks = currentEvidence.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
assert.equal(activeEvidenceLinks.length, 1);
assert.match(activeEvidenceLinks[0], /class="sidebar-type-link active"/);
assert.match(activeEvidenceLinks[0], /view=validation/);
for (const href of linkHrefs(currentEvidence)) {
  const query = new URL(href, 'http://dashboard.test').searchParams;
  assert.equal(query.get('version'), 'current-model', 'Current evidence state takes precedence over cached state');
  assert.equal(query.get('metric'), 'current-metric');
  assert.equal(query.get('draft'), 'current-draft');
  assert.equal(query.has('left'), false);
  assert.equal(query.has('journey'), false);
}
for (const query of ['', '?view=invalid', '?view=%20calibration%20']) {
  const markup = renderModelInformation(`/model-evidence${query}`, '?view=validation&version=cached-model');
  const active = markup.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
  assert.equal(active.length, 1);
  assert.match(active[0], /view=calibration/, 'Missing or invalid view highlights Calibration');
  assert.equal(markup.includes('cached-model'), false, 'Even an empty current query wins over the cache');
}
const legacyEvidence = renderModelInformation('/validation?version=legacy-current', '?view=calibration&version=cached-model');
assert.equal(legacyEvidence.includes('aria-current'), false, 'Legacy routes are not treated as the canonical evidence route');
assert.ok(linkHrefs(legacyEvidence).every((href) => href.includes('version=cached-model')));

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const entries = new Map<string, string>();
const storage: Storage = {
  get length() { return entries.size; },
  clear: () => entries.clear(),
  getItem: (key) => entries.get(key) ?? null,
  key: (index) => [...entries.keys()][index] ?? null,
  removeItem: (key) => { entries.delete(key); },
  setItem: (key, value) => { entries.set(key, value); }
};
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
try {
  writeScenarioDraft('policy-draft', {
    version: 1,
    title: 'Edited policy',
    calibratedModel: 'model-policy',
    basePolicy: '2024',
    formValues: { CENTRAL_BANK_LTV_HARD_MAX_FTB: '0.8', N_STEPS: '3500' },
    maxWorkers: '2',
    currentStep: 3,
    lockedParameterKeys: ['N_STEPS']
  });
  setActiveScenarioDraftId('policy-draft');
  writeSensitivityDraft('sweep-draft', {
    version: 1,
    title: 'Edited sweep',
    calibratedModel: 'model-sweep',
    basePolicy: '2011',
    policyPackageId: 'ltv',
    min: '0.7',
    max: '0.9',
    sampleCount: '5',
    formValues: { N_SIMS: '3' },
    maxWorkers: '3',
    currentStep: 2
  });
  setActiveSensitivityDraftId('sweep-draft');
  const policyDraft = readScenarioDraft('policy-draft');
  const sweepDraft = readSensitivityDraft('sweep-draft');
  const savedEntries = [...entries.entries()];

  assert.equal(resolveExperimentSetupHref('sensitivity'), '/sensitivity/new?draft=sweep-draft');
  assert.equal(resolveExperimentSetupHref('manual'), '/scenarios/new?draft=policy-draft');
  assert.deepEqual(readScenarioDraft('policy-draft'), policyDraft);
  assert.deepEqual(readSensitivityDraft('sweep-draft'), sweepDraft);
  assert.deepEqual([...entries.entries()], savedEntries, 'Choosing a destination must not rewrite drafts or pointers');

  setActiveScenarioDraftId('missing-draft');
  const freshPolicyLocation = new URL(resolveExperimentSetupHref('manual'), 'http://dashboard.test');
  assert.equal(freshPolicyLocation.pathname, '/scenarios/new');
  assert.ok(freshPolicyLocation.searchParams.get('draft'));
  assert.notEqual(freshPolicyLocation.searchParams.get('draft'), 'missing-draft');
  assert.notEqual(freshPolicyLocation.searchParams.get('draft'), 'sweep-draft');
  assert.deepEqual([...freshPolicyLocation.searchParams.keys()], ['draft']);
  assert.equal(resolveExperimentSetupHref('sensitivity'), '/sensitivity/new?draft=sweep-draft');
  assert.deepEqual(readScenarioDraft('policy-draft'), policyDraft, 'A stale pointer must not discard the old body');
} finally {
  if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'sessionStorage');
}

console.log('Workspace navigation tests passed.');
