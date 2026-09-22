import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deleteRunHistorySelection, type RunHistoryItem } from '../src/lib/runHistoryDeletion.js';
import { RunHistoryCheckbox, RunHistorySelectionToolbar } from '../src/pages/experiments/view/RunHistorySelection.js';

type DeleteOptions = Parameters<typeof deleteRunHistorySelection>[0];
const items: RunHistoryItem[] = [
  { id: 'first', label: 'First policy run' },
  { id: 'second', label: 'Second sensitivity run' },
  { id: 'third', label: 'Third run' }
];

function harness(overrides: Partial<DeleteOptions> = {}) {
  const confirmations: string[] = [];
  const requests: { id: string; key: string | undefined }[] = [];
  const events: string[] = [];
  let keyPrompts = 0;
  const options: DeleteOptions = {
    items,
    selectedIds: new Set(['first', 'second']),
    canDelete: true,
    deleteKeyRequired: false,
    confirm: (message) => {
      confirmations.push(message);
      events.push('confirm');
      return true;
    },
    promptDeleteKey: () => {
      keyPrompts += 1;
      events.push('key');
      return 'private-test-key';
    },
    deleteItem: async (id, key) => {
      requests.push({ id, key });
      events.push(`delete:${id}`);
    },
    ...overrides
  };
  return { options, confirmations, requests, events, keyPrompts: () => keyPrompts };
}

for (const overrides of [
  { canDelete: false },
  { selectedIds: new Set<string>() },
  { items: [] },
  { selectedIds: new Set(['unknown', 'protected-example', 'active-run']) }
]) {
  const state = harness(overrides);
  const result = await deleteRunHistorySelection(state.options);
  assert.deepEqual(result, { deletedIds: [], failures: [], cancelled: false });
  assert.deepEqual(state.events, [], 'No access or eligible selection must never prompt or delete');
}

{
  const state = harness({ selectedIds: new Set(['second', 'unknown', 'protected-example', 'active-run']) });
  const result = await deleteRunHistorySelection(state.options);
  assert.deepEqual(state.requests, [{ id: 'second', key: undefined }],
    'Only selected IDs in the eligible history snapshot can reach the delete API');
  assert.deepEqual(result.deletedIds, ['second']);
  assert.deepEqual(result.failures, []);
  assert.equal(result.cancelled, false);
  assert.equal(state.confirmations.length, 1);
  assert.ok(state.confirmations[0].includes('Second sensitivity run'));
  for (const excluded of ['First policy run', 'Third run', 'unknown', 'protected-example', 'active-run']) {
    assert.equal(state.confirmations[0].includes(excluded), false, 'Confirmation lists only eligible selections');
  }
  assert.equal(state.keyPrompts(), 0, 'Local deletion must not request a remote key');
}

{
  let confirmations = 0;
  const state = harness({
    deleteKeyRequired: true,
    confirm: () => {
      confirmations += 1;
      return false;
    }
  });
  assert.deepEqual(await deleteRunHistorySelection(state.options), {
    deletedIds: [], failures: [], cancelled: true
  });
  assert.equal(confirmations, 1);
  assert.equal(state.keyPrompts(), 0, 'Declining the batch must not request a key');
  assert.deepEqual(state.requests, [], 'Declining the batch must not delete any run');
}

for (const key of [null, '', '   ']) {
  let keyPrompts = 0;
  const state = harness({
    deleteKeyRequired: true,
    promptDeleteKey: () => {
      keyPrompts += 1;
      return key;
    }
  });
  assert.deepEqual(await deleteRunHistorySelection(state.options), {
    deletedIds: [], failures: [], cancelled: true
  });
  assert.equal(state.confirmations.length, 1);
  assert.equal(keyPrompts, 1);
  assert.deepEqual(state.requests, [], 'Cancelling or omitting the required key must leave all results intact');
}

{
  const state = harness({ deleteKeyRequired: true, selectedIds: new Set(['second', 'first']) });
  const result = await deleteRunHistorySelection(state.options);
  assert.deepEqual(state.events, ['confirm', 'key', 'delete:first', 'delete:second'],
    'A batch confirms and requests the remote key once, then follows eligible history order');
  assert.equal(state.keyPrompts(), 1);
  assert.equal(state.confirmations.length, 1);
  assert.match(state.confirmations[0], /\b2\b/, 'The confirmation states how many runs will be deleted');
  assert.ok(state.confirmations[0].includes('First policy run'));
  assert.ok(state.confirmations[0].includes('Second sensitivity run'));
  assert.equal(state.confirmations[0].includes('Third run'), false);
  assert.deepEqual(state.requests, [
    { id: 'first', key: 'private-test-key' },
    { id: 'second', key: 'private-test-key' }
  ]);
  assert.deepEqual(result, { deletedIds: ['first', 'second'], failures: [], cancelled: false });
}

{
  const attempts: string[] = [];
  let inFlight = 0;
  const state = harness({
    selectedIds: new Set(['first', 'second', 'third']),
    deleteItem: async (id) => {
      assert.equal(inFlight, 0, 'Requests must run sequentially');
      inFlight += 1;
      attempts.push(id);
      await Promise.resolve();
      inFlight -= 1;
      if (id === 'second') throw new Error('Remote deletion was rejected');
    }
  });
  const result = await deleteRunHistorySelection(state.options);
  assert.deepEqual(attempts, ['first', 'second', 'third'], 'One failure must not abandon later selected runs');
  assert.deepEqual(result.deletedIds, ['first', 'third']);
  assert.deepEqual(result.failures, [
    { id: 'second', label: 'Second sensitivity run', message: 'Remote deletion was rejected' }
  ]);
  assert.equal(result.cancelled, false);
  assert.equal(state.confirmations.length, 1);
}

for (const failure of ['Connection unavailable', undefined]) {
  const state = harness({
    selectedIds: new Set(['first']),
    deleteItem: async () => { throw failure; }
  });
  const result = await deleteRunHistorySelection(state.options);
  assert.deepEqual(result.deletedIds, []);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].id, 'first');
  assert.equal(result.failures[0].label, 'First policy run');
  assert.equal(typeof result.failures[0].message, 'string', 'Non-Error failures must be displayable');
  assert.ok(result.failures[0].message.length > 0);
}

{
  const state = harness({ items: [items[0], items[0], items[1], items[1], items[2]] });
  const result = await deleteRunHistorySelection(state.options);
  assert.deepEqual(state.requests.map(({ id }) => id), ['first', 'second'],
    'Duplicate inventory entries must not issue duplicate destructive requests');
  assert.deepEqual(result.deletedIds, ['first', 'second']);
  assert.equal(state.confirmations.length, 1);
  assert.match(state.confirmations[0], /\b2\b/, 'The confirmation counts unique selected runs');
  assert.equal(state.confirmations[0].split('First policy run').length - 1, 1);
}

{
  const mutableItems = [...items];
  const selectedIds = new Set(['first']);
  const attempts: string[] = [];
  const state = harness({
    items: mutableItems,
    selectedIds,
    confirm: () => {
      selectedIds.add('third');
      mutableItems.push({ id: 'new-run', label: 'New run' });
      selectedIds.add('new-run');
      return true;
    },
    deleteItem: async (id) => { attempts.push(id); }
  });
  const result = await deleteRunHistorySelection(state.options);
  assert.deepEqual(attempts, ['first'], 'Changes after confirmation cannot add unconfirmed runs to the batch');
  assert.deepEqual(result.deletedIds, ['first']);
}

{
  const eligible = new Set(['first', 'second', 'third']);
  const checks: string[] = [];
  const attempts: string[] = [];
  const state = harness({
    selectedIds: new Set(['first', 'second', 'third']),
    canDeleteItem: (id) => {
      checks.push(id);
      return eligible.has(id);
    },
    deleteItem: async (id) => {
      attempts.push(id);
      if (id === 'first') eligible.delete('second');
    }
  });
  const result = await deleteRunHistorySelection(state.options);
  assert.deepEqual(attempts, ['first', 'third'], 'A run that became protected before its request must be skipped');
  assert.deepEqual(result.deletedIds, ['first', 'third']);
  assert.ok(checks.includes('second'), 'The helper rechecks current eligibility before deleting each run');
  assert.equal(result.cancelled, false);
}

{
  type Selection = Parameters<typeof RunHistorySelectionToolbar>[0]['selection'];
  const renderToolbar = (overrides: Partial<Selection> = {}) => renderToStaticMarkup(createElement(
    RunHistorySelectionToolbar,
    { selection: {
      selectedIds: new Set<string>(), selectedCount: 0, selectableCount: 3,
      allSelected: false, someSelected: false, isDeleting: false, error: '',
      toggle: () => {}, selectAll: () => {}, deleteSelected: async () => {},
      ...overrides
    } }
  ));
  const empty = renderToolbar();
  assert.match(empty, /aria-label="Run history selection"/);
  assert.match(empty, /<button[^>]*disabled=""[^>]*aria-label="Delete 0 selected runs"/,
    'The trash action is disabled until the user selects an eligible run');
  assert.match(empty, /<svg[^>]*aria-hidden="true"[^>]*focusable="false"/,
    'The trash icon is decorative beside the accessible button label');
  assert.match(empty, /role="status">0 selected</);

  const selected = renderToolbar({ selectedIds: new Set(['first']), selectedCount: 1, someSelected: true });
  assert.match(selected, /<input[^>]*aria-checked="mixed"/,
    'Partial selection is exposed to assistive technology');
  const selectedButton = selected.match(/<button[^>]*>/)?.[0] ?? '';
  assert.match(selectedButton, /aria-label="Delete 1 selected run"/);
  assert.equal(selectedButton.includes('disabled'), false);

  const busy = renderToolbar({ selectedCount: 2, someSelected: true, isDeleting: true });
  assert.match(busy, /aria-busy="true"/);
  assert.match(busy, /<input[^>]*disabled=""/);
  assert.match(busy, /<button[^>]*disabled=""[^>]*aria-label="Deleting selected runs"/,
    'A batch in progress disables both selection changes and repeat deletion');
  assert.match(renderToolbar({ selectableCount: 0 }), /<input[^>]*disabled=""/,
    'Select all is disabled when there are no eligible runs');

  const protectedRow = renderToStaticMarkup(createElement(RunHistoryCheckbox, {
    label: 'Saved example', checked: false, disabled: true,
    disabledReason: 'Saved examples cannot be deleted', onChange: () => {}
  }));
  assert.match(protectedRow, /<input[^>]*disabled=""/);
  assert.match(protectedRow, /aria-label="Select Saved example for deletion\. Saved examples cannot be deleted"/,
    'Protected rows explain their disabled checkbox accessibly');
}

console.log('Run history selection: authorization, confirmation/key, snapshots, partial failure, eligibility, and accessible controls passed.');
