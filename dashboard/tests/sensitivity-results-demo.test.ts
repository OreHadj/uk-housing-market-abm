import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEMO_EXAMPLE_IDS } from '../shared/demoExamples';
import { GuidedTourOverlay } from '../src/components/GuidedTourOverlay';
import { CollapsibleSection } from '../src/components/CollapsibleSection';
import { SENSITIVITY_RESULTS_DEMO as demo } from '../src/lib/guidedDemos/sensitivityResults';
import { buildGuidedDemoHref, guidedDemoExitHref, guidedDemoState, hasGuidedDemoExamples, isGuidedActionComplete } from '../src/lib/guidedDemos/registry';
import { readSensitivityDetailedState, sensitivityDetailedSelection, updateReportQuery } from '../src/lib/reportUrlState';
import { DEMO_CHOICES } from '../src/pages/HomePage';

const url = (href: string) => new URL(href, 'http://dashboard.local');
const entry = (index: number, current = new URLSearchParams(), restore = false) => url(buildGuidedDemoHref(demo.id, index, current, restore));
const ids = ['results-section', 'baseline', 'response', 'pairing', 'setting', 'outcome', 'table', 'finding', 'detailed', 'tested-values', 'run-history'];
assert.deepEqual(demo.steps.map((step) => step.id), ids);
assert.equal(demo.finishOnLastStep, true);
assert.deepEqual(demo.requiredRunIds, []);
assert.deepEqual(demo.requiredExperimentIds, [DEMO_EXAMPLE_IDS.sensitivityExperimentId]);
assert.equal(hasGuidedDemoExamples(demo, [], []), false);
assert.equal(hasGuidedDemoExamples(demo, [], demo.requiredExperimentIds), true);
const home = DEMO_CHOICES.filter((choice) => choice.label === demo.label);
assert.equal(home.length, 1, 'Registry supplies exactly one working Home card');
assert.equal(home[0].to, buildGuidedDemoHref(demo.id));
assert.equal(home[0].requiresExamples, true);
assert.equal(entry(0, new URLSearchParams('presentation=detailed&experimentId=my-run&jobRef=sensitivity:my-run&queue=open')).searchParams.get('presentation'), 'report');
assert.match(demo.steps[0].bullets!.join(' '), /one policy lever.*holding everything else fixed.*which outcomes respond, by how much, and whether each response is real or simulation noise/);
assert.match(demo.steps[1].bullets!.join(' '), /baseline.*Nothing else changes.*check that all \d+ seed runs completed/);
assert.match(demo.steps[3].bullets!.join(' '), /matched with the same seed.*not statistical significance/);
assert.match(demo.steps[5].completionBullets!.join(' '), /only \d+ of \d+ seeds are higher.*no detectable effect/);
assert.match(demo.steps[6].bullets!.join(' '), /averages, not seed agreement/);
assert.match(demo.steps[7].bullets!.join(' '), /in every seed.*no consistent response.*finding too.*Quote changes, not levels/);

for (const [index, step] of demo.steps.entries()) {
  assert.equal(step.body, '');
  assert.ok(step.bullets?.length);
  for (const text of [step.title, step.bullets!.join(' '), step.completionBullets?.join(' '), step.actionHint, step.unavailableBody].filter(Boolean) as string[]) {
    assert.doesNotMatch(text, /[;:→←↔]/);
    assert.ok(text.split(/\s+/).length <= 40, `${step.id} exceeds the copy budget`);
  }
  assert.ok([...step.bullets!, step.actionHint ?? ''].join(' ').trim().split(/\s+/).length <= 40);
  if (step.kind === 'action') assert.ok(step.interactive && step.completion && step.completionBullets?.length && step.actionHint);
  const href = entry(index);
  assert.equal(href.pathname, '/results');
  assert.equal(href.searchParams.get('type'), 'sensitivity');
  assert.equal(href.searchParams.get('experimentId'), DEMO_EXAMPLE_IDS.sensitivityExperimentId);
  assert.equal(guidedDemoState(href.searchParams)?.index, index);
  assert.equal(entry(index, href.searchParams, true).href, href.href);
}
assert.equal(demo.steps[4].target, '[data-guided-target="sensitivity-setting"]', 'Changing a setting does not unlock the outcome');
assert.equal(demo.steps[5].target, '[data-guided-target="sensitivity-outcome"]', 'Changing an outcome does not unlock the chart or setting');
assert.equal(demo.steps[6].target, '[data-guided-target="sensitivity-selected"] .sr2-table-wrap', 'The averages lesson highlights the summary table');
for (const index of [4, 5, 8]) {
  const step = demo.steps[index];
  assert.equal(step.completion?.kind, 'query');
  if (step.completion?.kind !== 'query') throw new Error('Expected query action');
  const { key, value } = step.completion;
  const before = entry(index).searchParams;
  assert.equal(isGuidedActionComplete(step.completion, before), false);
  const after = updateReportQuery(before, { [key]: value });
  assert.equal(isGuidedActionComplete(step.completion, after), true, 'The action enables Next without an acknowledgement');
  assert.equal(after.get('step'), step.id, 'The action waits for explicit Next');
  assert.equal(entry(index, after, true).searchParams.get(key), value, 'Refresh and history preserve a completed action');
  assert.equal(isGuidedActionComplete(step.completion, updateReportQuery(after, { [key]: 'another-selection' })), false, 'Changing away removes the fixed numerical feedback');
}
const mismatched = new URLSearchParams('presentation=detailed&outcome=core_housePriceGrowth&setting=point-5');
for (const [index, outcome, setting] of [[2, 'core_debtToIncome', 'point-4'], [3, 'core_debtToIncome', 'point-4'], [6, 'core_mortgageApprovals', 'point-5'], [7, 'core_debtToIncome', 'point-4']] as const) {
  const fixedComparison = entry(index, mismatched, true).searchParams;
  assert.equal(fixedComparison.get('presentation'), 'report');
  assert.equal(fixedComparison.get('outcome'), outcome);
  assert.equal(fixedComparison.get('setting'), setting, 'Fixed comparison lessons restore the context quoted by their copy');
}
assert.equal(entry(4, mismatched, true).searchParams.get('outcome'), 'core_debtToIncome', 'The setting lesson keeps debt to income');
assert.equal(entry(4, mismatched, true).searchParams.get('setting'), 'point-5', 'A completed setting action survives refresh');
assert.equal(entry(4).searchParams.get('setting'), 'point-4', 'The setting lesson starts from the tighter setting');
assert.equal(entry(5, mismatched, true).searchParams.get('setting'), 'point-5', 'The outcome lesson stays at the looser setting');
assert.equal(entry(5).searchParams.get('outcome'), 'core_debtToIncome', 'The outcome lesson starts from debt to income');

const indicators = ['core_ooLTV', 'core_debtToIncome', 'core_mortgageApprovals', 'core_housePriceGrowth'];
assert.deepEqual(readSensitivityDetailedState(new URLSearchParams(), indicators), { indicatorId: 'core_ooLTV', measure: 'mean', resultsOpen: false }, 'Ordinary Detailed retains its first-series fallback');
assert.deepEqual(sensitivityDetailedSelection(new URLSearchParams()), { indicator: 'core_mortgageApprovals', measure: 'mean' }, 'Switching from the default Report carries the displayed outcome');
assert.deepEqual(sensitivityDetailedSelection(new URLSearchParams('outcome=core_housePriceGrowth:range')), { indicator: 'core_housePriceGrowth', measure: 'range' });
assert.deepEqual(readSensitivityDetailedState(new URLSearchParams('outcome=core_debtToIncome'), indicators), { indicatorId: 'core_debtToIncome', measure: 'mean', resultsOpen: false });
assert.deepEqual(readSensitivityDetailedState(new URLSearchParams('indicator=missing&measure=annualisedTrend&sensitivityResults=true'), indicators), { indicatorId: 'core_ooLTV', measure: 'mean', resultsOpen: false }, 'Unknown indicators and measures retain valid fallback controls');
assert.equal(readSensitivityDetailedState(new URLSearchParams('indicator=core_debtToIncome'), []).indicatorId, '', 'Missing data cannot fabricate a retained indicator');

const testedValues = demo.steps[9];
const closed = entry(9).searchParams;
const expanded = updateReportQuery(closed, { sensitivityResults: 'open', indicator: 'core_mortgageApprovals', measure: 'cv' });
const restored = entry(9, expanded, true).searchParams;
assert.deepEqual(readSensitivityDetailedState(restored, indicators), { indicatorId: 'core_mortgageApprovals', measure: 'cv', resultsOpen: true });
assert.equal(entry(9, expanded).searchParams.get('sensitivityResults'), 'closed', 'A new step entry offers the opening action again');
assert.equal(entry(8, expanded).searchParams.get('presentation'), 'report', 'Back re-enters the presentation lesson');
assert.equal(isGuidedActionComplete(testedValues.completion, expanded, { querySelector: () => null }), false, 'A URL flag alone cannot complete the real opening action');
assert.equal(isGuidedActionComplete(testedValues.completion, expanded, { querySelector: (selector: string) => selector === '#sensitivity-tested-values > button[aria-expanded="true"]' ? {} as Element : null }), true);
assert.equal(guidedDemoState(new URLSearchParams('demo=sensitivity-results&step=investigate'))?.step.id, 'results-section', 'Policy migration does not apply to sensitivity');
const exit = url(guidedDemoExitHref('/results', restored));
assert.equal(exit.searchParams.has('demo'), false);
assert.equal(exit.searchParams.has('step'), false);
for (const key of ['experimentId', 'presentation', 'indicator', 'measure', 'sensitivityResults', 'outcome', 'setting']) assert.equal(exit.searchParams.get(key), restored.get(key));

const noop = () => {};
for (const isComplete of [false, true]) {
  const markup = renderToStaticMarkup(createElement(GuidedTourOverlay, {
    demoLabel: demo.label, step: testedValues, stepIndex: 9, stepCount: 11, isComplete,
    onBack: noop, onNext: noop, onExit: noop
  }));
  assert.ok(markup.includes('10 of 11'));
  assert.equal(/<button[^>]*disabled=""[^>]*>Next<\/button>/.test(markup), !isComplete, 'Opening the section enables Next');
  assert.equal(markup.includes('The ranking shows size, not reliability. A large bar can still be noise.'), isComplete);
  assert.equal(markup.includes('Next, find Run History below.'), isComplete, 'The completed lesson points to the final stop');
  const section = renderToStaticMarkup(createElement(CollapsibleSection, {
    id: 'sensitivity-tested-values', title: 'Outcome responses and results by tested value',
    open: isComplete, onOpenChange: noop, children: createElement('select', { 'aria-label': 'Outcome measure' })
  }));
  assert.equal(section.includes('aria-expanded="true"'), isComplete);
  assert.equal(section.includes('hidden=""'), !isComplete, 'Saved expansion controls the actual chart section');
}
const history = demo.steps[10];
assert.equal(history.kind, 'info', 'Run History needs no interaction');
assert.equal(history.interactive, undefined);
assert.equal(history.completion, undefined);
assert.equal(history.target, '.sensitivity-run-history-card > .collapsible-section-toggle');
assert.match(history.bullets!.join(' '), /Run History below lists saved sensitivity analyses.*manage eligible runs.*its own baseline/);
const historyEntry = entry(10, expanded).searchParams;
assert.equal(historyEntry.get('presentation'), 'detailed', 'Run History is found in Detailed');
assert.equal(historyEntry.get('sensitivityResults'), 'open', 'Moving to Run History does not undo the opened section');
assert.equal(entry(10, new URLSearchParams('presentation=report'), true).searchParams.get('presentation'), 'detailed', 'A stale Report link cannot hide Run History');
const finalMarkup = renderToStaticMarkup(createElement(GuidedTourOverlay, {
  demoLabel: demo.label, step: history, stepIndex: 10, stepCount: 11, isComplete: false,
  onBack: noop, onNext: noop, onExit: noop, nextLabel: 'Finish', showExit: false
}));
assert.ok(finalMarkup.includes('11 of 11'));
assert.match(finalMarkup, /<button[^>]*>Finish<\/button>/);
assert.equal(/<button[^>]*disabled=""[^>]*>Finish<\/button>/.test(finalMarkup), false, 'The informational final stop can always finish');
assert.equal(finalMarkup.includes('>Exit</button>'), false);
console.log('Sensitivity guide copy, eleven-step journey, fixed contexts, actions, Detailed restoration and Run History Finish passed.');
