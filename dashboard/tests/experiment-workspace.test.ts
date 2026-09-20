import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ExperimentsLandingPage } from '../src/pages/ExperimentsLandingPage.js';
import { ExperimentsPage } from '../src/pages/ExperimentsPage.js';
import { ResultsPage } from '../src/pages/ResultsPage.js';
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

const landingMarkup = renderToStaticMarkup(
  createElement(MemoryRouter, { initialEntries: ['/experiments'] }, createElement(ExperimentsLandingPage))
);
assert.ok(landingMarkup.includes('aria-label="Experiment type"'));
assert.ok(landingMarkup.includes('href="/scenarios/new"'));
assert.ok(landingMarkup.includes('href="/sensitivity/new"'));
assert.ok(landingMarkup.includes('Policy run'));
assert.ok(landingMarkup.includes('Sensitivity analysis'));
assert.equal(landingMarkup.includes('aria-current="page"'), false, 'The initial chooser has no selected type');
assert.equal(landingMarkup.includes('role="dialog"'), false);

for (const workspace of ['manual', 'sensitivity'] as const) {
  const markup = renderWorkspace(workspace, `?draft=test-${workspace}`);
  const expectedHref = workspace === 'manual' ? '/scenarios/new' : '/sensitivity/new';
  const currentLink = markup.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
  assert.equal(currentLink.length, 1, `${workspace}: exactly one experiment type is current`);
  assert.ok(currentLink[0].includes(`href="${expectedHref}"`), `${workspace}: current type matches the route`);
  assert.ok(markup.includes('experiment-setup-workspace'), `${workspace}: setup is an in-page workspace`);
  assert.ok(markup.includes('experiment-setup-content'), `${workspace}: setup has its own content region`);
  assert.ok(markup.includes('scenario-builder-surface'), `${workspace}: the existing builder is reused`);
  assert.equal(markup.includes('role="dialog"'), false, `${workspace}: ordinary setup is not a dialog`);
  assert.equal(markup.includes('scenario-create-modal'), false, `${workspace}: no hidden modal builder is mounted`);
  assert.equal(markup.includes('Run History'), false, `${workspace}: setup does not render the results workspace`);
  assert.equal(markup.includes('Live Logs'), false, `${workspace}: setup does not introduce run management`);

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
  assert.ok(demoMarkup.includes('role="dialog"'), `${workspace}: the paused demo retains its modal structure`);
  assert.ok(demoMarkup.includes('scenario-create-modal-body'), `${workspace}: demo scrolling targets remain available`);
  assert.equal(demoMarkup.includes('experiment-setup-workspace'), false, `${workspace}: demo does not use the ordinary workspace`);

  const submittedMarkup = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [`/results?type=${workspace}&jobRef=${workspace}:new-job&queue=open`] },
      createElement(ResultsPage, permissions)
    )
  );
  assert.equal(submittedMarkup.includes('Browse results'), false, `${workspace}: submission has no extra results navigation step`);
  assert.equal(submittedMarkup.includes('aria-label="Submitted experiment"'), false, `${workspace}: no separate status screen blocks Results`);
  assert.ok(submittedMarkup.includes('Run History'), `${workspace}: history remains directly available after submission`);
  assert.ok(
    submittedMarkup.includes(workspace === 'manual' ? 'Primary run' : 'Select run to view'),
    `${workspace}: the normal results controls render immediately after submission`
  );
}

console.log('Experiment workspace rendering tests passed.');
