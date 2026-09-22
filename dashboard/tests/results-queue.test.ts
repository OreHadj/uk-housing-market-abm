import assert from 'node:assert/strict';
import { register } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { findSubmittedReportJob, getResultsQueueRows, manualResultsQueueItem, sensitivityResultsQueueItem, watchResultsQueue,
  type ResultsQueueItem, type ResultsQueueState } from '../src/lib/resultsQueue.js';
import { ExperimentRunProgress } from '../src/pages/experiments/view/ExperimentRunProgress.js';
import { ResultsQueue } from '../src/pages/experiments/view/ResultsQueue.js';
import { SubmittedReport } from '../src/components/SubmittedReport.js';

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

const manual = manualResultsQueueItem({
  jobId: 'policy-job', runId: 'policy-output', title: 'My policy run', baseline: 'v0o7',
  status: 'running', createdAt: '2026-09-22T10:00:00Z', outputPath: '', configPath: ''
});
const sensitivity = sensitivityResultsQueueItem({
  experimentId: 'sweep', title: 'My sensitivity run', baseline: 'v0o7',
  status: 'running', createdAt: manual.createdAt,
  parameter: { key: 'CENTRAL_BANK_BASE_RATE', title: 'Bank rate', description: '', type: 'number', baselineValue: 0.04, min: 0.03, max: 0.05, sampleCount: 3 }
});
assert.equal(manual.jobRef, 'manual:policy-job');
assert.equal(manual.runId, 'policy-output', 'Cancellation identity and output identity remain distinct');
assert.equal(sensitivity.jobRef, 'sensitivity:sweep');
assert.equal(sensitivity.instrumentTitle, 'Bank rate');

function buttons(node: ReactNode): ReactElement<{ children?: ReactNode; onClick: () => void; disabled?: boolean; className?: string }>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode; onClick: () => void; disabled?: boolean; className?: string }>(child)) return [];
    return child.type === 'button' ? [child] : buttons(child.props.children);
  });
}

for (const job of [manual, sensitivity]) {
  const waiting: ResultsQueueItem = { ...job, id: 'waiting', jobRef: `${job.type}:waiting`, title: 'Waiting run', status: 'queued' };
  const secondRunning: ResultsQueueItem = { ...job, id: 'parallel', jobRef: `${job.type}:parallel`, title: 'Parallel run' };
  const finished: ResultsQueueItem = { ...job, id: 'finished', jobRef: `${job.type}:finished`, title: 'Finished run', status: 'succeeded' };
  const calls: string[][] = [];
  const props = {
    items: [waiting, job, secondRunning, finished], expanded: false, onExpandedChange: (expanded: boolean) => { assert.equal(expanded, true); },
    canCancel: true,
    stopDeletion: { pending: null, error: '', retry: null, stopAndDelete: async (...args: string[]) => { calls.push(args); } }
  };
  const collapsed = renderToStaticMarkup(createElement(ResultsQueue, props));
  assert.equal(collapsed.match(/role="progressbar"/g)?.length, 2, 'Every running job stays visible in Report and Detailed');
  assert.equal(collapsed.includes('Waiting run'), false);
  assert.equal(collapsed.includes('Finished run'), false);
  assert.ok(collapsed.includes('1 other queued run'));
  const expanded = renderToStaticMarkup(createElement(ResultsQueue, { ...props, expanded: true }));
  assert.equal(expanded.match(/role="progressbar"/g)?.length, 3);
  assert.ok(expanded.includes('aria-valuenow="0"'));
  assert.equal(expanded.match(/>Cancel</g)?.length, 3, 'Waiting jobs can be canceled as well as running jobs');
  assert.equal(expanded.includes('View results'), false, 'An unfinished sensitivity run has no ineffective View action');
  if (job.type === 'sensitivity') assert.ok(expanded.includes('Instrument · Bank rate'));
  const actions = buttons(ResultsQueue({ ...props, expanded: true })).filter((button) => button.props.className === 'danger-button');
  actions.forEach((button) => button.props.onClick());
  assert.deepEqual(calls, [[job.jobRef, job.title], [waiting.jobRef, waiting.title], [secondRunning.jobRef, secondRunning.title]], 'Each action targets its own job using the existing cancellation hook');
  buttons(ResultsQueue(props)).find((button) => button.props.className === 'disclosure-preview-toggle')!.props.onClick();
  assert.equal(renderToStaticMarkup(createElement(ResultsQueue, { ...props, canCancel: false })).includes('>Cancel<'), false, 'Read-only queues still show progress without mutation controls');

  for (const phase of ['stopping', 'deleting'] as const) {
    const busy = { ...props, expanded: true, items: [{ ...job, status: 'canceled' as const }, waiting],
      stopDeletion: { ...props.stopDeletion, pending: { jobRef: job.jobRef, title: job.title, phase } } };
    const markup = renderToStaticMarkup(createElement(ResultsQueue, busy));
    assert.ok(markup.includes(`data-job-ref="${job.jobRef}"`), 'The row remains visible until deletion is confirmed');
    assert.ok(markup.includes(phase === 'stopping' ? 'Stopping…' : 'Deleting…'));
    assert.ok(buttons(ResultsQueue(busy)).filter((button) => button.props.className === 'danger-button').every((button) => button.props.disabled));
  }
  let retries = 0;
  const failed = { ...props, items: [], stopDeletion: { ...props.stopDeletion, error: 'The run stopped but could not be deleted.', retry: async () => { retries += 1; } } };
  assert.ok(renderToStaticMarkup(createElement(ResultsQueue, failed)).includes('Retry cancellation'));
  buttons(ResultsQueue(failed))[0].props.onClick();
  assert.equal(retries, 1, 'Deletion can be retried even after the job leaves the active queue');

  const selectionId = job.type === 'manual' ? job.runId! : job.id;
  assert.equal(findSubmittedReportJob([manual, sensitivity], job.type, job.jobRef, selectionId), job);
  assert.equal(findSubmittedReportJob([job], job.type, '', selectionId), job, 'Selecting an active run without a handoff link still shows its queue');
  assert.equal(findSubmittedReportJob([job], job.type, job.jobRef, ''), job, 'A job-only link can still follow the accepted job');
  assert.equal(findSubmittedReportJob([job], job.type, `${job.type}:unrelated`, selectionId), undefined);
  assert.equal(findSubmittedReportJob([job], job.type, job.jobRef, 'different-output'), undefined, 'An old job reference cannot replace the selected report');
  assert.equal(findSubmittedReportJob([job], job.type, '', ''), undefined, 'Reading a saved report is not blocked by unrelated queued work');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

for (const job of [manual, sensitivity]) {
  const recovered = deferred<void>();
  const observed: ResultsQueueState[] = [];
  let calls = 0;
  let inFlight = 0;
  const stop = watchResultsQueue({
    type: job.type, pollIntervalMs: 1,
    loadJobs: async (type) => {
      assert.equal(type, job.type);
      assert.equal(++inFlight, 1, 'Slow queue requests never overlap');
      await delay(2);
      inFlight -= 1;
      calls += 1;
      if (calls === 1) return [{ ...job, status: 'queued' }];
      if (calls === 2) throw new Error('Disconnected');
      if (calls === 3) return [job];
      return [{ ...job, status: 'succeeded' }, { ...job, jobRef: `${job.type}:new`, id: 'new', status: 'queued' }];
    },
    onUpdate: (state) => {
      observed.push(state);
      if (state.items[0]?.status === 'succeeded') recovered.resolve();
    }
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([recovered.promise, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Queue polling timed out')), 1500); })]);
    assert.ok(observed.some((state) => state.error && state.items[0]?.status === 'queued'), 'A connection failure retains the last known queue and retries');
    assert.equal(observed.at(-1)?.error, '');
    assert.ok(observed.some((state) => state.items[0]?.status === 'running'));
    assert.equal(observed.at(-1)?.items[0]?.status, 'succeeded', 'The selected report receives completion without a page reload');
    await delay(8);
    assert.ok(calls > 4, 'Keep monitoring other queued runs while a finished report is open');
  } finally {
    stop();
    clearTimeout(timeout);
  }
}

for (const rejectRequest of [false, true]) {
  const pending = deferred<ResultsQueueItem[]>();
  let updates = 0;
  const stop = watchResultsQueue({ type: 'manual', pollIntervalMs: 1, loadJobs: () => pending.promise, onUpdate: () => { updates += 1; } });
  stop();
  if (rejectRequest) pending.reject(new Error('Late response'));
  else pending.resolve([manual]);
  await delay(0);
  assert.equal(updates, 1, 'Leaving Report ignores in-flight responses and errors');
}

// Render the actual report shells, ignoring browser-only CSS imports in this Node check.
register('data:text/javascript,' + encodeURIComponent(`export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
  return nextLoad(url, context);
}`), import.meta.url);
const { Report2Page } = await import('../src/pages/report2/Report2Page.js');
const { SensitivityReport2Page } = await import('../src/pages/sensitivity-report2/SensitivityReport2Page.js');
for (const job of [manual, sensitivity]) {
  const selectionId = job.type === 'manual' ? job.runId! : job.id;
  const route = `/results?type=${job.type}&${job.type === 'manual' ? 'baselineRunId' : 'experimentId'}=${selectionId}&jobRef=${job.jobRef}`;
  const presentationControls = createElement('div', { 'aria-label': 'Results presentation' }, 'Report / Detailed');
  const children: Parameters<typeof SubmittedReport>[0]['children'] = (queueControls, execution) => job.type === 'manual'
    ? createElement(Report2Page, { canWrite: true, queueControls, execution, presentationControls })
    : createElement(SensitivityReport2Page, { queueControls, execution, presentationControls });
  const markup = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [route] }, createElement(SubmittedReport, {
    type: job.type, jobRef: job.jobRef, selectionId, queueInitiallyExpanded: true,
    canWrite: true, canDeleteResults: true, deleteKeyRequired: false, onDeleted: () => {}, children
  })));
  const selectorLabel = job.type === 'manual' ? 'Selected policy run' : 'Sensitivity experiment';
  assert.ok(markup.includes(`aria-label="${selectorLabel}"`), 'The Report must retain its run selector while checking a submitted job');
  if (job.type === 'manual') assert.ok(markup.includes('aria-label="Comparison baseline"'));
  assert.ok(markup.includes('aria-label="Results presentation"'));
  assert.ok(markup.includes('submitted-report-progress'));
  assert.ok(markup.indexOf('run-queue-card') < markup.indexOf(`aria-label="${selectorLabel}"`), 'The queue stays above the run and comparison selectors');
  assert.equal(markup.includes('Loading the policy report'), false);
  assert.equal(markup.includes('Loading saved sensitivity results'), false, 'A queued job is not treated as finished report data');

  for (const status of ['queued', 'running'] as const) {
    const currentJob = { ...job, status };
    const queueControls = createElement(ResultsQueue, {
      items: [currentJob], expanded: true, onExpandedChange: () => {}, canCancel: true,
      stopDeletion: { pending: null, error: '', retry: null, stopAndDelete: async () => {} }
    });
    const shell = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [route] }, children(queueControls, {
      blocked: true, selectedJob: currentJob, items: [currentJob], revision: status, removedIds: []
    })));
    assert.ok(shell.includes(`aria-label="${selectorLabel}"`) && shell.includes('role="progressbar"'));
    assert.ok(shell.indexOf('run-queue-card') < shell.indexOf(`aria-label="${selectorLabel}"`));
    assert.ok(shell.includes(`<option value="${selectionId}" selected="">${job.title}</option>`), 'The selector shows the accepted run name while its report is pending');
    assert.ok(shell.includes('>Cancel<'));
    assert.equal(shell.includes('Loading the policy report'), false);
    assert.equal(shell.includes('Loading saved sensitivity results'), false);
  }
}

console.log('Results queue tests passed.');
