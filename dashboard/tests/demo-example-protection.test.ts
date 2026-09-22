import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEMO_EXAMPLE_IDS as ids, DEMO_EXAMPLE_TITLES as titles } from '../shared/demoExamples';
import { createDevelopmentRuntimePaths } from '../server/lib/runtimePaths';
import { seedDemoExamples } from '../server/lib/demoExamples';
import { getResultsCompare, getResultsRunDetail, deleteResultsRun, renameResultsRun } from '../server/lib/results';
import { prepareModelRunSubmission } from '../server/lib/modelRuns';
import { cancelSensitivityExperiment, deleteSensitivityExperiment, prepareSensitivityExperimentSubmission } from '../server/lib/sensitivityRuns';
import { writeDashboardManagedRunMarker } from '../server/lib/runOwnership';
import { startDashboardServer } from '../server/dashboardServer';
import { getLendingDistribution } from '../server/lib/lendingDistribution';
import type { RemoteExecutionManager } from '../server/lib/remoteExecution';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-demo-protection-'));
const paths = { ...createDevelopmentRuntimePaths(repoRoot), resultsRoot: path.join(fixture, 'results'), tempRoot: path.join(fixture, 'tmp'), logsRoot: path.join(fixture, 'logs') };
const manualRequest = { baseline: 'v0o7', basePolicy: '2024' as const, title: titles.policy, overrides: {}, confirmWarnings: true };
const sweepRequest = { baseline: 'v0o7', basePolicy: '2024' as const, title: titles.sensitivity, policyPackageId: 'owner_occupier_lti_soft_max', min: 4, max: 5, sampleCount: 5 };

function fingerprint(root: string): string {
  const hash = createHash('sha256');
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).sort((a, b) => path.join(a.parentPath, a.name).localeCompare(path.join(b.parentPath, b.name)))) {
    const file = path.join(entry.parentPath, entry.name);
    hash.update(path.relative(root, file));
    hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

async function checkRejected(url: string, method: string, body?: unknown): Promise<void> {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(response.status, 400, `${method} ${url}`);
  assert.match((await response.json() as { error: string }).error, /used by a built-in example/);
}

async function checkMutationApi(base: string): Promise<void> {
  for (const id of [ids.policyRunId, ids.baselineRunId]) {
    await checkRejected(`${base}/api/results/runs/${encodeURIComponent(id)}/title`, 'POST', { title: 'Changed' });
    await checkRejected(`${base}/api/results/runs/${encodeURIComponent(id)}`, 'DELETE');
  }
  await checkRejected(`${base}/api/model-runs`, 'POST', manualRequest);
  await checkRejected(`${base}/api/experiments/sensitivity`, 'POST', sweepRequest);
  await checkRejected(`${base}/api/experiments/sensitivity/${ids.sensitivityExperimentId}`, 'DELETE');
  await checkRejected(`${base}/api/experiments/sensitivity/${ids.sensitivityExperimentId}/cancel`, 'POST');
  await checkRejected(`${base}/api/experiments/jobs/${encodeURIComponent(`sensitivity:${ids.sensitivityExperimentId}`)}`, 'DELETE');
  await checkRejected(`${base}/api/experiments/jobs/${encodeURIComponent(`sensitivity:${ids.sensitivityExperimentId}`)}/cancel`, 'POST');
}

try {
  seedDemoExamples(paths);
  // Even a forged management marker cannot make an example mutable.
  writeDashboardManagedRunMarker(path.join(paths.resultsRoot, ids.policyRunId), { jobId: 'forged', runId: ids.policyRunId, baseline: 'v0o7', createdAt: new Date().toISOString() });
  const before = fingerprint(paths.resultsRoot);
  for (const runId of [ids.policyRunId, ids.baselineRunId]) {
    assert.throws(() => deleteResultsRun(paths, runId), /used by a built-in example/);
    assert.throws(() => renameResultsRun(paths, runId, 'Changed'), /used by a built-in example/);
  }
  assert.throws(() => prepareModelRunSubmission(paths, manualRequest), /used by a built-in example/);
  assert.throws(() => prepareModelRunSubmission(paths, { ...manualRequest, title: titles.baseline.toUpperCase() }), /used by a built-in example/);
  assert.throws(() => renameResultsRun(paths, 'ordinary-user-run', titles.policy), /used by a built-in example/);
  assert.throws(() => prepareSensitivityExperimentSubmission(paths, sweepRequest), /used by a built-in example/);
  assert.throws(() => prepareSensitivityExperimentSubmission(paths, { ...sweepRequest, title: 'Ordinary sweep' }, { forcedExperimentId: ids.sensitivityExperimentId }), /used by a built-in example/);
  assert.throws(() => deleteSensitivityExperiment(paths, ids.sensitivityExperimentId), /used by a built-in example/);
  assert.throws(() => cancelSensitivityExperiment(paths, ids.sensitivityExperimentId), /used by a built-in example/);

  const server = await startDashboardServer({ repoRoot, runtimePaths: paths, host: '127.0.0.1', port: 0, modelRunsConfigured: true, isDevRuntime: true, logStartup: false, memoryLoggingEnabled: false });
  try {
    await checkMutationApi(server.url);
    const listed = await (await fetch(`${server.url}/api/results/runs`)).json() as { runs: Array<{ isExample?: boolean }> };
    assert.equal(listed.runs.filter((entry) => entry.isExample).length, 2);
  } finally { await server.shutdown(); }
  assert.equal(fingerprint(paths.resultsRoot), before, 'Rejected local mutations must leave every fixture file unchanged.');

  // Remote mode still lists and reads locally shipped examples and pairs them with remote runs.
  const remoteId = 'remote-user-run';
  let remoteComparisons = 0;
  const forbidden = async () => { throw new Error('Example incorrectly reached a remote mutation/read.'); };
  const remote = {
    listRemoteManualResultRuns: async () => ({ runs: [{ ...getResultsRunDetail(paths, ids.policyRunId), runId: remoteId, isExample: false }] }),
    listSensitivityExperiments: async () => ({ experiments: [] }),
    getRemoteManualResultCompare: async (runIds: string[], indicatorIds: string[], window: string, smoothWindow: number) => {
      assert.deepEqual(runIds, [remoteId]); remoteComparisons++;
      const compare = getResultsCompare(paths, [ids.policyRunId], indicatorIds, window, smoothWindow);
      return { ...compare, runIds: [remoteId], kpiSummaryByRun: compare.kpiSummaryByRun.map((entry) => ({ ...entry, runId: remoteId })), indicators: compare.indicators.map((entry) => ({ ...entry, seriesByRun: entry.seriesByRun.map((series) => ({ ...series, runId: remoteId })) })) };
    },
    getRemoteManualResultDetail: forbidden, getRemoteManualResultFiles: forbidden,
    getRemoteManualResultLending: async (runId: string, window: string) => {
      assert.equal(runId, remoteId);
      return { ...getLendingDistribution(paths, ids.policyRunId, window), runId: remoteId };
    },
    getSensitivityExperiment: forbidden, getSensitivityExperimentResults: forbidden, getSensitivityExperimentCharts: forbidden,
    submitModelRun: forbidden, submitSensitivityExperiment: forbidden, deleteRemoteManualResultRun: forbidden,
    deleteSensitivityExperiment: forbidden, cancelExperimentJob: forbidden, deleteExperimentJob: forbidden,
    shutdown: async () => {}
  } as unknown as RemoteExecutionManager;
  const cloud = await startDashboardServer({ repoRoot, runtimePaths: paths, remoteExecution: remote, host: '127.0.0.1', port: 0, modelRunsConfigured: true, isDevRuntime: true, logStartup: false, memoryLoggingEnabled: false });
  try {
    await checkMutationApi(cloud.url);
    const list = await (await fetch(`${cloud.url}/api/results/runs`)).json() as { runs: Array<{ runId: string; isExample?: boolean }> };
    assert.equal(list.runs.length, 3);
    assert.equal(list.runs.filter((run) => run.isExample).length, 2);
    for (const endpoint of [`results/runs/${encodeURIComponent(ids.policyRunId)}`, `results/runs/${encodeURIComponent(ids.policyRunId)}/files`, 'experiments/sensitivity', `experiments/sensitivity/${ids.sensitivityExperimentId}`, `experiments/sensitivity/${ids.sensitivityExperimentId}/results`, `experiments/sensitivity/${ids.sensitivityExperimentId}/charts`]) {
      assert.equal((await fetch(`${cloud.url}/api/${endpoint}`)).status, 200, endpoint);
    }
    const query = new URLSearchParams({ window: 'post500', indicatorId: 'core_mortgageApprovals' });
    query.append('runId', remoteId); query.append('runId', ids.baselineRunId);
    const response = await fetch(`${cloud.url}/api/results/compare?${query}`);
    assert.equal(response.status, 200);
    const compare = await response.json() as { runIds: string[]; indicators: Array<{ seriesByRun: Array<{ runId: string; points: unknown[] }> }> };
    assert.deepEqual(compare.runIds, [remoteId, ids.baselineRunId]);
    assert.equal(remoteComparisons, 1);
    assert(compare.indicators[0].seriesByRun.every((entry) => entry.points.length === 3001));
    const lendingResponse = await fetch(`${cloud.url}/api/results/lending/compare?${query}`);
    assert.equal(lendingResponse.status, 200);
    const lending = await lendingResponse.json() as { runIds: string[]; window: string; runs: Array<{ runId: string; available: boolean; window: { requested: string } }> };
    assert.equal(lending.window, 'post500');
    assert.deepEqual(lending.runIds, [remoteId, ids.baselineRunId]);
    assert(lending.runs.every((run) => !run.available && run.window.requested === 'post500'));
    // Demo availability is independent of a remote outage; ordinary history retains its error.
    remote.listRemoteManualResultRuns = async () => { throw new Error('Remote history unavailable'); };
    remote.listSensitivityExperiments = async () => { throw new Error('Remote history unavailable'); };
    assert.equal((await fetch(`${cloud.url}/api/results/runs`)).status, 500);
    assert.equal((await fetch(`${cloud.url}/api/experiments/sensitivity`)).status, 400);
    const exampleRunsResponse = await fetch(`${cloud.url}/api/results/runs?examplesOnly=true`);
    assert.equal(exampleRunsResponse.status, 200);
    const exampleRuns = await exampleRunsResponse.json() as { runs: Array<{ isExample: boolean }> };
    assert.equal(exampleRuns.runs.length, 2);
    assert(exampleRuns.runs.every((run) => run.isExample));
    const exampleSweepsResponse = await fetch(`${cloud.url}/api/experiments/sensitivity?examplesOnly=true`);
    assert.equal(exampleSweepsResponse.status, 200);
    const exampleSweeps = await exampleSweepsResponse.json() as { experiments: Array<{ isExample: boolean }> };
    assert.equal(exampleSweeps.experiments.length, 1);
    assert(exampleSweeps.experiments.every((experiment) => experiment.isExample));
  } finally { await cloud.shutdown(); }
  assert.equal(fingerprint(paths.resultsRoot), before, 'Rejected remote-mode mutations must leave every fixture file unchanged.');

  const missingPaths = { ...paths, resultsRoot: path.join(fixture, 'missing-results'), demoExamplesRoot: path.join(fixture, 'missing-bundle') };
  const missing = await startDashboardServer({ repoRoot, runtimePaths: missingPaths, host: '127.0.0.1', port: 0, isDevRuntime: true, logStartup: false, memoryLoggingEnabled: false });
  try {
    const payload = await (await fetch(`${missing.url}/api/results/runs`)).json() as { runs: unknown[] };
    assert.deepEqual(payload.runs, []);
    const experiments = await (await fetch(`${missing.url}/api/experiments/sensitivity`)).json() as { experiments: unknown[] };
    assert.deepEqual(experiments.experiments, []);
    assert.equal((await fetch(`${missing.url}/api/results/runs/${encodeURIComponent(ids.policyRunId)}`)).status, 400);
  } finally { await missing.shutdown(); }
  console.log('demo-example-protection: direct/API rename, delete, overwrite and cancel guards; unchanged fixture hashes; cloud availability/mixed comparison; isolated missing examples passed.');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
