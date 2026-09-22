import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ExperimentsLandingPage } from '../src/pages/ExperimentsLandingPage.js';
import { ExperimentsPage } from '../src/pages/ExperimentsPage.js';
import { ResultsPage } from '../src/pages/ResultsPage.js';
import { ResultsLandingPage } from '../src/pages/ResultsLandingPage.js';
import { WorkspaceTypeNavigation } from '../src/components/WorkspaceTypeNavigation.js';
import type { ExperimentType } from '../src/pages/experiments/types.js';

const permissions = {
  canWrite: true,
  canDownloadResults: true,
  canDeleteResults: true,
  deleteKeyRequired: false,
  authEnabled: false
};

function renderWorkspace(workspace: ExperimentType, query = '', initialView: 'create' | 'workspace' = 'create') {
  const path = workspace === 'manual' ? '/scenarios' : '/sensitivity';
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [`${path}${initialView === 'create' ? '/new' : ''}${query}`] },
      createElement(ExperimentsPage, { ...permissions, workspace, initialView })
    )
  );
}

function renderTypeNavigation(area: 'experiments' | 'results', path: string) {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [path] }, createElement(WorkspaceTypeNavigation, { area }))
  );
}

function renderResults(workspace: ExperimentType, query = '') {
  return renderToStaticMarkup(createElement(
    MemoryRouter,
    { initialEntries: [`/results?type=${workspace}${query}`] },
    createElement(ResultsPage, permissions)
  ));
}

function assertResultsPresentation(markup: string, selected: 'Report' | 'Detailed', context: string) {
  const labels = [...markup.matchAll(/<button\b[^>]*>(Report|Detailed|Report2)<\/button>/g)].map((match) => match[1]);
  assert.deepEqual(labels, ['Report', 'Detailed'], `${context}: only Report and Detailed are available`);
  assert.match(markup, new RegExp(`aria-pressed="true"[^>]*>${selected}</button>`), `${context}: ${selected} is selected`);
}

const landingMarkup = renderToStaticMarkup(
  createElement(MemoryRouter, { initialEntries: ['/experiments'] }, createElement(ExperimentsLandingPage))
);
const landingNavigation = renderTypeNavigation('experiments', '/experiments');
assert.ok(landingNavigation.includes('role="group" aria-label="Experiment type"'));
assert.ok(landingNavigation.includes('href="/scenarios/new"'));
assert.ok(landingNavigation.includes('href="/sensitivity/new"'));
assert.ok(landingNavigation.includes('Policy scenarios'));
assert.ok(landingNavigation.includes('Sensitivity analysis'));
assert.equal(landingNavigation.includes('aria-current="page"'), false, 'The initial chooser has no selected type');
const landingCards = landingMarkup.match(/<a\b[^>]*class="experiment-launch-action"[^>]*>/g) ?? [];
assert.equal(landingCards.length, 2, 'The landing page offers both experiment creation cards');
assert.ok(landingCards[0].includes('href="/scenarios/new"'), 'The policy card links directly to its setup page');
assert.ok(landingCards[1].includes('href="/sensitivity/new"'), 'The sensitivity card links directly to its setup page');
assert.ok(landingMarkup.includes('Policy scenario'));
assert.ok(landingMarkup.includes('Sensitivity analysis'));
assert.equal(landingMarkup.includes('role="dialog"'), false);

const resultsLandingMarkup = renderToStaticMarkup(createElement(
  MemoryRouter, { initialEntries: ['/results'] },
  createElement(ResultsLandingPage, { resultsSearch: '?baselineRunId=kept-run&experimentId=kept-sweep&presentation=detailed' })
));
const resultsLandingCards = resultsLandingMarkup.match(/<a\b[^>]*class="experiment-launch-action"[^>]*>/g) ?? [];
assert.equal(resultsLandingCards.length, 2, 'Results offers both kinds using the Experiments card layout');
assert.ok(resultsLandingCards[0].includes('type=manual') && resultsLandingCards[1].includes('type=sensitivity'));
assert.ok(resultsLandingCards.every((card) => card.includes('baselineRunId=kept-run') && card.includes('experimentId=kept-sweep')), 'Both cards retain the saved selections');
assert.ok(resultsLandingCards.every((card) => card.includes('presentation=report') && !card.includes('presentation=detailed')), 'Both cards open Report even when the previous view was Detailed');
assert.ok(resultsLandingMarkup.includes('Policy scenario results') && resultsLandingMarkup.includes('Sensitivity analysis results'));
assert.equal(resultsLandingMarkup.includes('results-presentation-toggle'), false, 'Report controls belong to the results views');
assert.equal(resultsLandingMarkup.includes('role="dialog"'), false, 'Results is an ordinary landing page');

for (const workspace of ['manual', 'sensitivity'] as const) {
  const markup = renderWorkspace(workspace, `?draft=test-${workspace}`);
  const expectedHref = workspace === 'manual' ? '/scenarios/new' : '/sensitivity/new';
  const navigationMarkup = renderTypeNavigation('experiments', `${expectedHref}?draft=test-${workspace}`);
  const currentLink = navigationMarkup.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
  assert.equal(currentLink.length, 1, `${workspace}: exactly one experiment type is current`);
  assert.ok(currentLink[0].includes(`href="${expectedHref}"`), `${workspace}: current type matches the route`);
  assert.ok(markup.includes('experiment-setup-workspace'), `${workspace}: setup is an in-page workspace`);
  assert.ok(markup.includes('experiment-setup-content'), `${workspace}: setup has its own content region`);
  assert.ok(markup.includes('scenario-builder-surface'), `${workspace}: the existing builder is reused`);
  assert.equal(markup.includes('role="dialog"'), false, `${workspace}: ordinary setup is not a dialog`);
  assert.equal(markup.includes('scenario-create-modal'), false, `${workspace}: no hidden modal builder is mounted`);
  assert.equal(markup.includes('Run History'), false, `${workspace}: setup does not render the results workspace`);
  assert.equal(markup.includes('Live Logs'), false, `${workspace}: setup does not introduce run management`);
  assert.equal(markup.includes('experiment-type-selector'), false, `${workspace}: setup does not repeat the sidebar choices`);

  const unresolvedMarkup = renderWorkspace(workspace);
  assert.equal(
    unresolvedMarkup.includes('scenario-builder-surface'),
    false,
    `${workspace}: defer mounting until the draft identity has been resolved`
  );

  const historyMarkup = renderWorkspace(workspace, '', 'workspace');
  assert.ok(historyMarkup.includes('Run History'), `${workspace}: existing results routes remain available`);
  assert.equal(historyMarkup.includes('scenario-builder-surface'), false, `${workspace}: results do not mount a hidden builder`);

  const demoMode = workspace === 'manual' ? 'policy' : 'sensitivity';
  const demoMarkup = renderWorkspace(workspace, `?demo=experiment&mode=${demoMode}`);
  assert.equal(demoMarkup.includes('scenario-create-modal'), false, `${workspace}: practice never renders the retired modal builder`);
  assert.ok(demoMarkup.includes('experiment-setup-workspace'), `${workspace}: practice uses the current ordinary workspace`);
  assert.ok(demoMarkup.includes('experiment-setup-body'), `${workspace}: practice uses the same page-scrolling surface`);
  assert.equal(
    renderTypeNavigation('experiments', `${expectedHref}?demo=experiment&mode=${demoMode}`),
    navigationMarkup,
    `${workspace}: practice retains the current sidebar sections`
  );

  const submittedMarkup = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [`/results?type=${workspace}&jobRef=${workspace}:new-job&queue=open`] },
      createElement(ResultsPage, permissions)
    )
  );
  assert.equal(submittedMarkup.includes('Browse results'), false, `${workspace}: submission has no extra results navigation step`);
  assert.equal(submittedMarkup.includes('aria-label="Submitted experiment"'), false, `${workspace}: no separate status screen blocks Results`);
  assert.equal(submittedMarkup.includes('results-type-toggle'), false, `${workspace}: Results does not repeat the sidebar type choices`);
  assert.ok(submittedMarkup.includes('aria-label="Results presentation"'), `${workspace}: the report/detailed control stays available`);
  assertResultsPresentation(submittedMarkup, 'Report', `${workspace}: submitted work opens Report by default`);
  const resultsNavigation = renderTypeNavigation('results', `/results?type=${workspace}&jobRef=${workspace}:new-job&queue=open`);
  const currentResultsLink = resultsNavigation.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
  assert.equal(currentResultsLink.length, 1, `${workspace}: exactly one Results type is current in the sidebar`);
  assert.ok(currentResultsLink[0].includes(`type=${workspace}`), `${workspace}: the Results sidebar follows the submitted type`);
  assert.equal(submittedMarkup.includes('Run History'), false, `${workspace}: submission does not mount Detailed`);
}

for (const workspace of ['manual', 'sensitivity'] as const) {
  for (const presentationQuery of ['', '&presentation=report', '&presentation=report2']) {
    const reportMarkup = renderResults(workspace, presentationQuery);
    assertResultsPresentation(reportMarkup, 'Report', `${workspace}: default, Report and legacy Report2 links`);
    assert.equal(reportMarkup.includes('Run History'), false, `${workspace}: the promoted report does not mount the old results workspace`);
  }

  const detailedMarkup = renderResults(workspace, '&presentation=detailed');
  assertResultsPresentation(detailedMarkup, 'Detailed', `${workspace}: explicit Detailed link`);
  assert.ok(detailedMarkup.includes('Run History'), `${workspace}: Detailed retains run management`);

  for (const queueQuery of ['&queue=open', `&jobRef=${workspace}:new-job`]) {
    const queueMarkup = renderResults(workspace, queueQuery);
    assertResultsPresentation(queueMarkup, 'Report', `${workspace}: queue or submitted-job links default to Report`);
    assert.equal(queueMarkup.includes('Run History'), false, `${workspace}: queue state does not force Detailed`);

    const explicitDetailed = renderResults(workspace, `${queueQuery}&presentation=detailed`);
    assertResultsPresentation(explicitDetailed, 'Detailed', `${workspace}: Detailed remains an explicit choice for queued work`);
    assert.ok(explicitDetailed.includes('Run History'), `${workspace}: explicit Detailed retains run management`);

    for (const presentation of ['report', 'report2']) {
      const reportMarkup = renderResults(workspace, `${queueQuery}&presentation=${presentation}`);
      assertResultsPresentation(reportMarkup, 'Report', `${workspace}: explicit ${presentation} retains Report for queue entries`);
    }
  }

  const otherWorkspace = workspace === 'manual' ? 'sensitivity' : 'manual';
  assertResultsPresentation(
    renderResults(workspace, `&jobRef=${otherWorkspace}:old-job`),
    'Report',
    `${workspace}: another result type's job reference does not force its monitoring view`
  );
}

console.log('Experiment workspace rendering tests passed.');
