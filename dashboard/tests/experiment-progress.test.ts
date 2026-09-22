import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExperimentJobLogsPayload, ExperimentProgressSnapshot } from '../shared/types.js';
import { ExperimentProgressBar } from '../src/pages/experiments/view/ExperimentRunProgress.js';
import { watchExperimentLogs } from '../src/pages/run-experiments/useExperimentLogs.js';

const snapshot: ExperimentProgressSnapshot = {
  kind: 'manual', status: 'running', totalRuns: 10, completedRuns: 4,
  failedRuns: 0, canceledRuns: 0, activeRuns: 2, totalWorkers: 2, activeWorkers: 2,
  completedRunEquivalents: 4.5, percentComplete: 45,
  throughputRunsPerMinute: 1, completedRunsPerMinute: 0.9,
  etaSeconds: 330, estimatedFinishAt: '2026-09-19T12:10:00Z', elapsedSeconds: 270,
  updatedAt: '2026-09-19T12:04:30Z'
};
const markup = (progress: ExperimentProgressSnapshot | null, error = '') =>
  renderToStaticMarkup(createElement(ExperimentProgressBar, { progress, error, label: 'Progress for my run' }));

const running = markup(snapshot);
assert.ok(running.includes('role="progressbar"') && running.includes('aria-label="Progress for my run"'));
assert.ok(running.includes('aria-valuenow="45"') && running.includes('width:45%'));
assert.ok(running.includes('45.0%'));
assert.equal(running.includes('Elapsed'), false);
assert.equal(running.includes('Estimated remaining'), false);
const starting = markup(null);
assert.ok(starting.includes('Waiting for the first progress update'));
assert.equal(starting.includes('aria-valuenow'), false, 'Missing progress is indeterminate, not a fabricated percentage');
assert.equal(markup({ ...snapshot, etaSeconds: null }), running, 'Time estimates do not affect the progress display');
assert.ok(markup({ ...snapshot, percentComplete: 100, etaSeconds: null }).includes('100.0%'));
for (const status of ['failed', 'canceled'] as const) {
  const stopped = markup({ ...snapshot, status, percentComplete: 100 });
  assert.equal(stopped.includes('progressbar'), false, 'Failed/cancelled attempts must not show a full success bar');
  assert.equal(stopped.includes('Estimated remaining'), false);
}
const stale = markup(snapshot, 'Connection lost');
assert.ok(stale.includes('Last reported: 45.0%') && stale.includes('retrying'));
assert.equal(markup({ ...snapshot, percentComplete: Number.NaN }).includes('aria-valuenow'), false);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function withinTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Progress test timed out')), 1500); })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function payload(jobRef: string, progress?: ExperimentProgressSnapshot): ExperimentJobLogsPayload {
  return {
    jobRef, type: jobRef.startsWith('manual:') ? 'manual' : 'sensitivity',
    cursor: 0, nextCursor: 1, lines: ['unused log line'], hasMore: true, done: false, truncated: false,
    ...(progress ? { progress } : {})
  };
}

for (const kind of ['manual', 'sensitivity'] as const) {
  const jobRef = `${kind}:selected-run`;
  const finished = deferred<void>();
  const observed: Array<{ progress: ExperimentProgressSnapshot | null; error: string; lines: string[] }> = [];
  let calls = 0;
  let inFlight = 0;
  const stop = watchExperimentLogs({
    jobRef, progressOnly: true, pollIntervalMs: 1,
    loadLogs: async (requested, cursor, limit) => {
      assert.equal(requested, jobRef);
      assert.equal(limit, 1, 'A progress bar must not download a log backlog');
      assert.equal(cursor, calls === 0 ? 0 : 1);
      assert.equal(++inFlight, 1, 'Slow requests must not overlap');
      await delay(3);
      inFlight -= 1;
      calls += 1;
      if (calls === 1) return payload(jobRef);
      if (calls === 2) throw new Error('Temporary failure');
      return payload(jobRef, { ...snapshot, kind, status: calls === 3 ? 'running' : 'succeeded' });
    },
    onUpdate: (state) => {
      observed.push(state);
      if (state.progress?.status === 'succeeded') finished.resolve();
    }
  });
  try {
    await withinTimeout(finished.promise);
    await delay(8);
    assert.equal(calls, 4, 'Stop at a terminal snapshot even when old logs remain unread');
    assert.ok(observed.some((state) => state.error === 'Temporary failure'));
    assert.equal(observed.at(-1)?.error, '', 'Clear errors when polling recovers');
    assert.ok(observed.every((state) => state.lines.length === 0));
  } finally {
    stop();
  }
}

for (const status of ['failed', 'canceled'] as const) {
  const ended = deferred<void>();
  let calls = 0;
  const stop = watchExperimentLogs({
    jobRef: 'manual:stopped', progressOnly: true, pollIntervalMs: 1,
    loadLogs: async () => { calls += 1; return payload('manual:stopped', { ...snapshot, status }); },
    onUpdate: (state) => { if (state.progress) ended.resolve(); }
  });
  try {
    await withinTimeout(ended.promise);
    await delay(8);
    assert.equal(calls, 1);
  } finally {
    stop();
  }
}

for (const rejectRequest of [false, true]) {
  const pending = deferred<ExperimentJobLogsPayload>();
  let updates = 0;
  const stop = watchExperimentLogs({
    jobRef: 'manual:old-run', progressOnly: true, pollIntervalMs: 1,
    loadLogs: () => pending.promise,
    onUpdate: () => { updates += 1; }
  });
  stop();
  if (rejectRequest) pending.reject(new Error('Late error from the previous run'));
  else pending.resolve(payload('manual:old-run', snapshot));
  await delay(0);
  assert.equal(updates, 1, 'Leaving or switching runs must ignore old responses and errors');
}

// The original log-card mode must still drain log pages and honour truncation.
const drained = deferred<void>();
let logCalls = 0;
let finalLines: string[] = [];
const stopLogs = watchExperimentLogs({
  jobRef: 'manual:logs', pollIntervalMs: 1,
  loadLogs: async (_jobRef, _cursor, limit) => {
    assert.equal(limit, 200);
    logCalls += 1;
    return { ...payload('manual:logs', { ...snapshot, status: 'succeeded' }),
      lines: [String(logCalls)], truncated: logCalls === 2, done: logCalls === 3, nextCursor: logCalls };
  },
  onUpdate: (state) => {
    finalLines = state.lines;
    if (state.lines.includes('3')) drained.resolve();
  }
});
try {
  await withinTimeout(drained.promise);
  await delay(8);
  assert.deepEqual(finalLines, ['2', '3']);
  assert.equal(logCalls, 3);
} finally {
  stopLogs();
}

console.log('Experiment progress tests passed.');
