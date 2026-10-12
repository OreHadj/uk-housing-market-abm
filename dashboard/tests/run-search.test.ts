import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { policyPracticeRunTitle } from '../src/lib/policyPractice.js';
import {
  groupRunsByModel,
  groupRunHistory,
  isPracticeRunTitle,
  isRunHistoryGroupOpen,
  runNameMatches,
  shownRunHistory
} from '../src/lib/runSearch.js';
import { noRunsMatchMessage, RunHistoryGroup, RunHistorySearch } from '../src/pages/run-history/RunHistorySearch.js';
import { RunHistorySelectionToolbar } from '../src/pages/experiments/view/RunHistorySelection.js';
import { RunPicker, type RunPickerOption } from '../src/components/RunPicker.js';

// Practice runs are recognised by the title the guided tours give them, for both kinds of run.
const practiceTitle = policyPracticeRunTitle('Bank Rate test', 'experiment-demo-policy-v2-374e2026-b519-4798-8d5f-5274dce056c6');
assert.equal(practiceTitle, 'Practice Bank Rate test [374e2026-b519-4798-8d5f-5274dce056c6]');
assert.equal(isPracticeRunTitle(practiceTitle), true);
assert.equal(isPracticeRunTitle(policyPracticeRunTitle('', 'fallback/draft id')), true, 'Fallback identities are recognised too');
assert.equal(isPracticeRunTitle(`  ${practiceTitle}  `), true);
for (const title of ['Practice makes perfect', 'Practice run [two words]', 'My Practice x [abc]', 'Bank Rate test', '', null, undefined]) {
  assert.equal(isPracticeRunTitle(title), false, `${title} is an ordinary run`);
}

// Search matches the run name only, ignoring case; every word must appear, in any order.
assert.equal(runNameMatches('Lower LTV for FTBs', ''), true, 'An empty search shows everything');
assert.equal(runNameMatches('Lower LTV for FTBs', '   '), true);
assert.equal(runNameMatches('Lower LTV for FTBs', 'ltv'), true);
assert.equal(runNameMatches('Lower LTV for FTBs', 'LOWER'), true);
assert.equal(runNameMatches('Lower LTV for FTBs', 'ftbs lower'), true, 'Words match in any order');
assert.equal(runNameMatches('Lower LTV for FTBs', '  ftb   ltv '), true, 'Extra spaces are ignored');
assert.equal(runNameMatches('Lower LTV for FTBs', 'ltv bank'), false, 'Every word must appear');
assert.equal(runNameMatches('Lower LTV for FTBs', 'lower-ltv'), false, 'A word is matched as typed');
assert.equal(runNameMatches('Bank Rate +1pp', '+1'), true, 'Symbols are matched literally, not as patterns');
assert.equal(runNameMatches('Bank Rate', '.*'), false);

const run = (name: string, extra: { isExample?: boolean; isPractice?: boolean } = {}) => ({
  name, isExample: extra.isExample ?? false, isPractice: extra.isPractice ?? isPracticeRunTitle(name)
});
const history = [
  run('Lower LTV for FTBs'),
  run(policyPracticeRunTitle('LTV practice', 'practice-one')),
  run('Bank Rate +1pp'),
  run('Example: 2024 policy, unchanged', { isExample: true }),
  run(policyPracticeRunTitle('Bank Rate practice', 'practice-two')),
  run('Example: Bank Rate raised by 1 pp', { isExample: true })
];

// Practice runs and examples sit in their own groups, each keeping the newest-first order given.
const all = groupRunHistory(history, '');
assert.deepEqual(all.main.map((item) => item.name), ['Lower LTV for FTBs', 'Bank Rate +1pp']);
assert.deepEqual(all.practice.map((item) => item.name), [
  'Practice LTV practice [practice-one]', 'Practice Bank Rate practice [practice-two]'
]);
assert.deepEqual(all.examples.map((item) => item.name), ['Example: 2024 policy, unchanged', 'Example: Bank Rate raised by 1 pp']);
assert.equal(all.main.length + all.practice.length + all.examples.length, history.length, 'Every run is listed once');

// The bottom groups start collapsed while there are other runs to show.
assert.equal(isRunHistoryGroupOpen(all, 'practice', '', undefined), false);
assert.equal(isRunHistoryGroupOpen(all, 'examples', '', undefined), false);
assert.deepEqual(shownRunHistory(all, { practice: false, examples: false }).map((item) => item.name), ['Lower LTV for FTBs', 'Bank Rate +1pp']);

// A group is open when there are no other runs.
const onlyGrouped = groupRunHistory(history.filter((item) => item.isExample || item.isPractice), '');
assert.equal(isRunHistoryGroupOpen(onlyGrouped, 'practice', '', undefined), true);
assert.equal(isRunHistoryGroupOpen(onlyGrouped, 'examples', '', undefined), true);
const onlyExamples = groupRunHistory(history.filter((item) => item.isExample), '');
assert.equal(isRunHistoryGroupOpen(onlyExamples, 'examples', '', undefined), true, 'A fresh install shows its examples');

// While searching, a group with matches opens by itself; one without matches stays shut.
const bankRate = groupRunHistory(history, 'bank rate');
assert.deepEqual(bankRate.main.map((item) => item.name), ['Bank Rate +1pp']);
assert.deepEqual(bankRate.practice.map((item) => item.name), ['Practice Bank Rate practice [practice-two]']);
assert.deepEqual(bankRate.examples.map((item) => item.name), ['Example: Bank Rate raised by 1 pp']);
assert.equal(isRunHistoryGroupOpen(bankRate, 'practice', 'bank rate', undefined), true);
assert.equal(isRunHistoryGroupOpen(bankRate, 'examples', 'bank rate', undefined), true);
const ltv = groupRunHistory(history, 'ltv');
assert.equal(ltv.examples.length, 0);
assert.equal(isRunHistoryGroupOpen(ltv, 'examples', 'ltv', undefined), false);
assert.equal(isRunHistoryGroupOpen(ltv, 'practice', '   ', undefined), false, 'Spaces alone are not a search');
assert.equal(groupRunHistory(history, 'zzz').main.length + groupRunHistory(history, 'zzz').practice.length, 0);

// A viewer's own choice wins over the defaults.
assert.equal(isRunHistoryGroupOpen(all, 'practice', '', true), true);
assert.equal(isRunHistoryGroupOpen(bankRate, 'examples', 'bank rate', false), false);
assert.equal(isRunHistoryGroupOpen(onlyGrouped, 'examples', '', false), false);

// "Select all shown" and deletion only reach visible runs: matches, in open groups, never examples.
const shownWhileSearching = shownRunHistory(bankRate, { practice: true, examples: false });
assert.deepEqual(shownWhileSearching.map((item) => item.name), ['Bank Rate +1pp', 'Practice Bank Rate practice [practice-two]']);
assert.deepEqual(
  shownRunHistory(all, { practice: true, examples: true }).filter((item) => !item.isExample).map((item) => item.name),
  ['Lower LTV for FTBs', 'Bank Rate +1pp', 'Practice LTV practice [practice-one]', 'Practice Bank Rate practice [practice-two]'],
  'Examples are shown but never offered for deletion'
);

// The search box states what is shown, and an empty result names the search.
const idle = renderToStaticMarkup(createElement(RunHistorySearch, { query: '', matchCount: 18, totalCount: 18, onQueryChange: () => {} }));
assert.match(idle, /<input type="search" placeholder="Search runs"[^>]*value=""/);
assert.match(idle, /role="status">18 finished runs</);
assert.match(idle, /class="visually-hidden">Search runs by name</);
const searching = renderToStaticMarkup(createElement(RunHistorySearch, { query: 'bank rate', matchCount: 3, totalCount: 18, onQueryChange: () => {} }));
assert.match(searching, /role="status">Showing 3 of 18</);
assert.match(searching, /value="bank rate"/);
assert.equal(noRunsMatchMessage(' xyz '), 'No runs match “xyz”.');

const group = renderToStaticMarkup(createElement(RunHistoryGroup, {
  id: 'practice-list', label: 'Practice runs', count: 6, open: false, onToggle: () => {}, children: createElement('li', null, 'run')
}));
assert.match(group, /aria-expanded="false"/);
assert.match(group, /aria-controls="practice-list"/);
assert.match(group, /<strong>Practice runs \(6\)<\/strong>/);
assert.match(group, /<ul id="practice-list" class="run-list run-history-group-list" hidden="">/);
assert.equal(renderToStaticMarkup(createElement(RunHistoryGroup, {
  id: 'empty', label: 'Examples', count: 0, open: true, onToggle: () => {}, children: null
})), '', 'An empty group is not shown');

const toolbar = renderToStaticMarkup(createElement(RunHistorySelectionToolbar, {
  selectAllLabel: 'Select all shown',
  selection: {
    selectedIds: new Set<string>(), selectedCount: 0, selectableCount: 2,
    allSelected: false, someSelected: false, isDeleting: false, error: '',
    toggle: () => {}, selectAll: () => {}, deleteSelected: async () => {}
  }
}));
assert.match(toolbar, /<span>Select all shown<\/span>/);

// The run pickers group runs by model, newest analysis first, then examples and practice runs.
const pickerRun = (value: string, modelVersion: string | null, extra: Partial<RunPickerOption> = {}): RunPickerOption => ({
  value, name: value, modelVersion, isExample: false, isPractice: isPracticeRunTitle(value), ...extra
});
const pickerRuns = [
  pickerRun('Newest 2011 refit', 'v0o7'),
  pickerRun('Example: 2024 policy, unchanged', 'v0o7', { isExample: true }),
  pickerRun('Original run', 'v0'),
  pickerRun(policyPracticeRunTitle('Tour run', 'tour-id'), 'v5o3'),
  pickerRun('Untitled legacy run', null),
  pickerRun('Old calibration step', 'v4.19'),
  pickerRun('Lower LTV for FTBs', 'v5o3'),
  pickerRun('Data-only run', 'v4.26'),
  pickerRun('Older 2011 refit', 'v0o7'),
  pickerRun('Blank model', '  ')
];
const byModel = groupRunsByModel(pickerRuns);
assert.deepEqual(byModel.map((group) => [group.label, group.items.map((item) => item.value)]), [
  ['Refitted 2024 model', ['Lower LTV for FTBs']],
  ['2024 data model', ['Data-only run']],
  ['Refitted 2011 model', ['Newest 2011 refit', 'Older 2011 refit']],
  ['Original 2011 model', ['Original run']],
  ['v4.19', ['Old calibration step']],
  ['Model not recorded', ['Untitled legacy run', 'Blank model']],
  ['Examples', ['Example: 2024 policy, unchanged']],
  ['Practice runs', ['Practice Tour run [tour-id]']]
], 'Anchors in the agreed order, other steps by id, then no model, examples and practice runs');
assert.deepEqual(groupRunsByModel(pickerRuns, 'refit').map((group) => group.label), ['Refitted 2011 model'],
  'Searching hides groups without a match');
assert.deepEqual(groupRunsByModel(pickerRuns, 'zzz'), [], 'No match leaves no groups');
assert.deepEqual(groupRunsByModel([pickerRun('Remote run', undefined as unknown as string)]).map((group) => group.label),
  ['Model not recorded'], 'A remote payload without a model is not an error');

// Closed, the picker shows the selected run, with any note after its name.
const renderPicker = (props: Partial<Parameters<typeof RunPicker>[0]>) => renderToStaticMarkup(createElement(RunPicker, {
  label: 'Comparison baseline', value: '', options: pickerRuns, onChange: () => {}, ...props
}));
const comparison = renderPicker({
  value: 'Lower LTV for FTBs', noneLabel: 'No comparison run', clearLabel: 'Clear comparison run',
  options: [pickerRun('Lower LTV for FTBs', 'v5o3', { note: '2011 calibration' })]
});
assert.match(comparison, /<button type="button" role="combobox" class="run-picker-trigger" aria-label="Comparison baseline" aria-haspopup="listbox" aria-expanded="false">/);
assert.match(comparison, /<span class="run-picker-value">Lower LTV for FTBs — 2011 calibration<\/span>/,
  'The note follows the name after a dash');
assert.match(comparison, /aria-label="Clear comparison run"/, 'A selected comparison can be cleared with ✕');
assert.match(comparison, /class="run-search-icon"/, 'The closed field shows a magnifier, so it reads as a search');
assert.equal(comparison.includes('chevron'), false, 'No dropdown arrow');
assert.equal(comparison.includes('role="listbox"'), false, 'The list renders only while open');
const noComparison = renderPicker({ noneLabel: 'No comparison run', clearLabel: 'Clear comparison run' });
assert.match(noComparison, /run-picker-value">No comparison run</);
assert.equal(noComparison.includes('Clear comparison run'), false, 'Nothing to clear without a comparison');
const disabledComparison = renderPicker({ value: 'Lower LTV for FTBs', disabled: true, clearLabel: 'Clear comparison run' });
assert.match(disabledComparison, /aria-expanded="false" disabled="">/, 'The comparison stays disabled until a policy run is selected');
assert.equal(disabledComparison.includes('Clear comparison run'), false);
assert.match(renderPicker({ value: 'deleted-run', missingLabel: 'Deleted run title' }), /run-picker-value">Deleted run title</,
  'A selected run that is no longer listed still shows its name');
assert.match(renderPicker({ value: 'deleted-run' }), /run-picker-value">deleted-run</);
assert.match(renderPicker({ placeholder: 'Loading runs…' }), /run-picker-value">Loading runs…</);

console.log('Run search: practice titles, name matching, bottom groups, select-all-shown, search box and run picker grouping passed.');
