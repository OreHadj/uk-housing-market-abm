import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getResultsQueueRows } from '../src/lib/resultsQueue.js';
import { ExperimentRunProgress } from '../src/pages/experiments/view/ExperimentRunProgress.js';

const jobs = [
  { id: 'waiting-a', status: 'queued' },
  { id: 'running-a', status: 'running' },
  { id: 'waiting-b', status: 'queued' },
  { id: 'running-b', status: 'running' }
];
for (const expanded of [false, true]) {
  const rows = getResultsQueueRows(jobs, expanded);
  assert.equal(rows.preview?.id, 'running-a', 'Waiting jobs cannot hide the running-job preview');
  const visible = [rows.preview, ...rows.visibleRemaining];
  assert.deepEqual(visible.filter((job) => job?.status === 'running').map((job) => job?.id), ['running-a', 'running-b']);
  assert.equal(new Set(visible).size, visible.length, 'Each running job has exactly one visible progress bar');
  assert.equal(rows.waitingCount, 2);
  assert.equal(visible.length, expanded ? 4 : 2);
}

const next = getResultsQueueRows(jobs.filter((job) => job.id !== 'running-a'), false);
assert.equal(next.preview?.id, 'running-b', 'The remaining running job stays visible when another one finishes');
const waiting = getResultsQueueRows(jobs.filter((job) => job.status === 'queued'), false);
assert.equal(waiting.preview?.id, 'waiting-a');
assert.equal(waiting.visibleRemaining.length, 0);
assert.equal(waiting.waitingCount, 1);
assert.deepEqual(getResultsQueueRows([], false), { preview: null, visibleRemaining: [], waitingCount: 0 });

for (const kind of ['manual', 'sensitivity']) {
  const queued = renderToStaticMarkup(createElement(ExperimentRunProgress, {
    jobRef: `${kind}:waiting`, title: 'Waiting run', status: 'queued'
  }));
  assert.ok(queued.includes('role="progressbar"'));
  assert.ok(queued.includes('aria-valuenow="0"'));
  assert.ok(queued.includes('Queued, waiting to start'));
  assert.equal(queued.includes('Starting'), false);
  const starting = renderToStaticMarkup(createElement(ExperimentRunProgress, {
    jobRef: `${kind}:running`, title: 'Running run', status: 'running'
  }));
  assert.ok(starting.includes('role="progressbar"'), 'The running bar is visible even before its first API update');
  assert.equal(starting.includes('aria-valuenow'), false, 'Starting progress remains indeterminate until reported');
}

console.log('Results queue tests passed.');
