import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEMO_EXAMPLE_IDS } from '../shared/demoExamples';
import { buildGuidedDemoHref, GUIDED_DEMOS, guidedDemoExitHref, guidedDemoState, hasGuidedDemoExamples, isGuidedActionComplete } from '../src/lib/guidedDemos/registry';
import { DEMO_CHOICES } from '../src/pages/HomePage';

const url = (href: string) => new URL(href, 'http://dashboard.local');
assert.deepEqual(GUIDED_DEMOS.map((demo) => demo.id), ['dashboard-overview', 'policy-results', 'sensitivity-results', 'model-information'], 'Only approved and implemented guides are registered');
assert.equal(GUIDED_DEMOS.filter((demo) => demo.startHere).length, 1);
const overview = GUIDED_DEMOS.find((entry) => entry.id === 'dashboard-overview')!;
assert.equal(hasGuidedDemoExamples(overview, [], []), true);
for (const [index, step] of overview.steps.entries()) {
  const href = url(buildGuidedDemoHref(overview.id, index));
  assert.equal(href.pathname, step.path);
  assert.equal(guidedDemoState(href.searchParams)?.step.id, step.id);
  assert.equal(url(buildGuidedDemoHref(overview.id, index, href.searchParams, true)).href, href.href);
  assert.equal(url(guidedDemoExitHref(href.pathname, href.searchParams)).searchParams.has('demo'), false);
}
assert.equal(DEMO_CHOICES.find((choice) => choice.startHere)?.requiresExamples, false);
assert.deepEqual(DEMO_CHOICES.filter((choice) => choice.requiresExamples).map((choice) => choice.label), ['Explore policy results', 'Explore sensitivity results']);
const demo = GUIDED_DEMOS.find((entry) => entry.id === 'policy-results')!;
assert.deepEqual(demo.steps.map((step) => step.id), [
  'results-section', 'choose-runs', 'saved-example', 'headline', 'market', 'borrowers', 'tenure', 'detailed', 'investigate', 'run-history'
], 'Orient the reader to the section and run selectors before interpreting the saved comparison');
assert.equal(demo.finishOnLastStep, true, 'Finish closes the tour on the final Run History lesson without another completion screen');
assert.equal(demo.steps[0].target, '.sidebar-type-navigation[aria-label="Results type"]');
assert.equal(demo.steps[1].target, '[data-guided-target="policy-run-selectors"]');
const lessonText = (step: typeof demo.steps[number]) => [step.body, ...(step.bullets ?? [])].filter(Boolean).join(' ');
assert.match(lessonText(demo.steps[1]), /A baseline run shows what happens without that policy change/);
assert.match(lessonText(demo.steps[1]), /Comparison baseline.*help isolate the policy’s effect/);
assert.match(lessonText(demo.steps[1]), /Match the model, other settings, duration and seeds/);
assert.match(lessonText(demo.steps[2]), /does not create a baseline.*Select or generate it separately/);
const stepIndex = (id: string) => {
  const index = demo.steps.findIndex((step) => step.id === id);
  assert.ok(index >= 0, `Expected ${id} stop`);
  return index;
};
assert.equal(new Set(demo.steps.map((step) => step.id)).size, demo.steps.length);
for (const [index, step] of demo.steps.entries()) {
  assert.equal(step.body, '', `${step.id} teaches through bullet points`);
  assert.ok(step.bullets?.length, `${step.id} needs lesson bullets`);
  for (const text of [lessonText(step), step.completionNote, step.completionBullets?.join(' '), step.unavailableBody].filter(Boolean) as string[]) {
    assert.ok(text.split(/\s+/).length <= 40, `${step.id} exceeds its copy budget: ${text}`);
    assert.doesNotMatch(text, /[;:→←↔]/, `${step.id} uses plain sentences without semicolons, colons or arrows`);
  }
  if (step.kind === 'action') {
    assert.ok(step.actionHint && step.completion && step.interactive, `${step.id} needs a real action contract`);
    assert.ok(step.completionBullets?.length, `${step.id} keeps action feedback in bullet points`);
    assert.ok(`${lessonText(step)} ${step.actionHint}`.split(/\s+/).length <= 40, `${step.id} visible action copy exceeds budget`);
  }
  const entry = url(buildGuidedDemoHref(demo.id, index));
  const restored = guidedDemoState(entry.searchParams);
  assert.equal(restored?.step.id, step.id);
  assert.equal(restored?.index, index);
  assert.equal(entry.pathname, step.path);
  assert.equal(entry.searchParams.get('baselineRunId'), DEMO_EXAMPLE_IDS.policyRunId);
  assert.equal(entry.searchParams.get('comparisonRunId'), DEMO_EXAMPLE_IDS.baselineRunId);
  assert.equal(url(buildGuidedDemoHref(demo.id, index, entry.searchParams, true)).href, entry.href);
}
const market = demo.steps.find((step) => step.id === 'market')!;
const marketIndex = stepIndex('market');
const marketUrl = url(buildGuidedDemoHref(demo.id, marketIndex));
assert.equal(isGuidedActionComplete(market.completion, marketUrl.searchParams), false);
marketUrl.searchParams.set('indicator', 'core_mortgageApprovals');
assert.equal(isGuidedActionComplete(market.completion, marketUrl.searchParams), true);
assert.equal(url(buildGuidedDemoHref(demo.id, marketIndex, marketUrl.searchParams, true)).searchParams.get('indicator'), 'core_mortgageApprovals');
const detailedIndex = stepIndex('detailed');
const detailed = url(buildGuidedDemoHref(demo.id, detailedIndex));
detailed.searchParams.set('presentation', 'detailed');
assert.equal(isGuidedActionComplete(demo.steps[detailedIndex].completion, detailed.searchParams), true);
assert.equal(url(buildGuidedDemoHref(demo.id, detailedIndex, detailed.searchParams, true)).searchParams.get('presentation'), 'detailed', 'Refresh never undoes the completed presentation action');
assert.equal(url(buildGuidedDemoHref(demo.id, detailedIndex - 1, detailed.searchParams)).searchParams.get('presentation'), 'report', 'Back enters the preceding report step');

assert.equal(detailedIndex, 7, 'Switching to Detailed prepares the trend lesson');
const trendIndex = stepIndex('investigate');
assert.equal(trendIndex, 8, 'The ninth step opens the mortgage approvals trend');
const trend = demo.steps[trendIndex];
assert.match(lessonText(trend), /Open Policy results, then Credit access/);
assert.match(lessonText(trend), /View trend beside Mortgage approvals/);
assert.match(trend.completionBullets?.join(' ') ?? '', /Next, find Run History below Policy results/);
assert.match(trend.target ?? '', /#policy-results-credit_access.*policy-mortgage-approvals-trend/);
assert.match(trend.completion?.kind === 'selector' ? trend.completion.selector : '', /data-indicator-id="core_mortgageApprovals"/);
const trendEntry = url(buildGuidedDemoHref(demo.id, trendIndex, detailed.searchParams));
assert.equal(trendEntry.searchParams.get('presentation'), 'detailed');
assert.equal(trendEntry.searchParams.get('policyResults'), 'closed');
assert.equal(trendEntry.searchParams.get('policyTrend'), '');
assert.equal(isGuidedActionComplete(trend.completion, trendEntry.searchParams), false, 'A URL alone cannot complete the trend action');
for (const [key, value] of [['policyResults', 'open'], ['policyTrend', 'core_mortgageApprovals']]) {
  trendEntry.searchParams.set(key, value);
  const restoredTrend = url(buildGuidedDemoHref(demo.id, trendIndex, trendEntry.searchParams, true));
  assert.equal(restoredTrend.href, trendEntry.href, 'Each real control survives refresh without resetting prior actions');
}
const restartedTrend = url(buildGuidedDemoHref(demo.id, trendIndex, trendEntry.searchParams));
assert.equal(restartedTrend.searchParams.get('policyResults'), 'closed', 'Entering the step again starts with the first control');
assert.equal(restartedTrend.searchParams.get('policyTrend'), '', 'Entering again clears the previously opened trend');
const historyIndex = stepIndex('run-history');
assert.equal(historyIndex, 9, 'The tenth step points to Run History');
const historyStep = demo.steps[historyIndex];
assert.equal(historyStep.kind, 'info', 'Run History needs no interaction');
assert.equal(historyStep.interactive, undefined);
assert.equal(historyStep.completion, undefined);
assert.equal(historyStep.target, '.run-history-card > .collapsible-section-toggle');
assert.match(lessonText(historyStep), /Run History below lists saved runs.*manage eligible runs/);
const historyEntry = url(buildGuidedDemoHref(demo.id, historyIndex, trendEntry.searchParams));
assert.equal(historyEntry.searchParams.get('presentation'), 'detailed');
assert.equal(historyEntry.searchParams.get('policyTrend'), '', 'Moving to Run History closes the trend');
const restoredHistory = url(buildGuidedDemoHref(demo.id, historyIndex, trendEntry.searchParams, true));
assert.equal(restoredHistory.searchParams.get('policyTrend'), '', 'A stale trend link cannot obscure the informational stop');
const completion = new URL(detailed.href);
completion.searchParams.set('step', 'complete');
assert.equal(guidedDemoState(completion.searchParams)?.completed, false, 'Older completion links reopen the final teaching step without a completion screen');
assert.equal(guidedDemoState(completion.searchParams)?.step.id, 'run-history', 'Older completion links resolve to the final teaching step');
assert.equal(guidedDemoState(completion.searchParams)?.index, historyIndex, 'Back from an older completion link returns to the trend lesson');
const restoredCompletion = url(buildGuidedDemoHref(demo.id, guidedDemoState(completion.searchParams)!.index, completion.searchParams, true));
assert.equal(restoredCompletion.searchParams.get('step'), 'run-history');
assert.equal(restoredCompletion.searchParams.get('presentation'), 'detailed');
assert.equal(completion.searchParams.get('presentation'), 'detailed');
const exit = url(guidedDemoExitHref(historyEntry.pathname, historyEntry.searchParams));
assert.equal(exit.pathname, '/results');
assert.equal(exit.searchParams.get('baselineRunId'), DEMO_EXAMPLE_IDS.policyRunId);
assert.equal(exit.searchParams.get('presentation'), 'detailed');
assert.equal(exit.searchParams.get('comparisonRunId'), DEMO_EXAMPLE_IDS.baselineRunId);
assert.ok(['demo', 'step', 'from', 'journey', 'policyTrend'].every((key) => !exit.searchParams.has(key)));
assert.equal(guidedDemoState(new URLSearchParams('demo=experiment')), null);
assert.equal(guidedDemoState(new URLSearchParams('demo=navigation')), null);
assert.equal(guidedDemoState(new URLSearchParams('demo=policy-results&step=obsolete'))?.index, 0);
assert.equal(hasGuidedDemoExamples(demo, [], []), false);
assert.equal(hasGuidedDemoExamples(demo, [DEMO_EXAMPLE_IDS.policyRunId], []), false);
assert.equal(hasGuidedDemoExamples(demo, Object.values(DEMO_EXAMPLE_IDS), []), true);
assert.equal(DEMO_CHOICES.filter((choice) => 'startHere' in choice && choice.startHere).length, 1);
assert.equal(DEMO_CHOICES.filter((choice) => choice.to?.includes('demo=navigation')).length, 0);
const coordinator = fs.readFileSync(new URL('../src/components/GuidedDemo.tsx', import.meta.url), 'utf8');
assert.ok(coordinator.includes('entered.current === identity'), 'Page changes do not continuously re-enforce step defaults');
assert.ok(coordinator.includes("search.get('demo') === 'navigation'"), 'Legacy URLs retire safely');
assert.ok(coordinator.includes('run.isExample') && coordinator.includes('experiment.isExample'), 'Unmarked ID collisions cannot impersonate built-in examples');
console.log('Guided definitions, copy budgets, URL restoration, explicit actions, availability and checkpoint scope checks passed.');
