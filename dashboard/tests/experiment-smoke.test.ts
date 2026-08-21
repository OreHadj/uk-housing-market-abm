// Author: Max Stoddard
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  __resetModelRunManagerForTests,
  getModelRunJob,
  getModelRunOptions,
  prepareModelRunSubmission,
  submitModelRun
} from '../server/lib/modelRuns.js';
import { createDevelopmentRuntimePaths } from '../server/lib/runtimePaths.js';
import { buildDefaultRunSubmitRequest } from '../src/lib/homeDefaultRun.js';
import {
  __resetSensitivityRunsForTests,
  getSensitivityExperiment,
  getSensitivityExperimentLogs,
  submitSensitivityExperiment
} from '../server/lib/sensitivityRuns.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-experiment-smoke-'));
const paths = {
  ...createDevelopmentRuntimePaths(repoRoot),
  resultsRoot: path.join(smokeRoot, 'Results'),
  tempRoot: path.join(smokeRoot, 'tmp'),
  logsRoot: path.join(smokeRoot, 'logs')
};

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'canceled']);
const SMOKE_TIMEOUT_MS = 240_000;
const SMOKE_POLL_MS = 500;
const smokeOverrides = {
  N_STEPS: 1,
  N_SIMS: 1,
  TARGET_POPULATION: 100,
  recordTransactions: false,
  recordNBidUpFrequency: false,
  recordCoreIndicators: true,
  recordQualityBandPrice: false,
  recordHouseholdID: false,
  recordEmploymentIncome: false,
  recordRentalIncome: false,
  recordBankBalance: false,
  recordHousingWealth: false,
  recordTotalDebt: false,
  recordHousingStatus: false,
  recordConsumption: false,
  recordNHousesOwned: false,
  recordAge: false,
  recordSavingRate: false
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForCondition(label: string, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + SMOKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await sleep(SMOKE_POLL_MS);
  }
  throw new Error(`${label} timed out after ${SMOKE_TIMEOUT_MS}ms`);
}

try {
  __resetModelRunManagerForTests();
  __resetSensitivityRunsForTests();

  // Home "Default Run" preset: the payload builder must select the stable default baseline,
  // the 2011 base policy, 3500 steps / 1 seed, a minimal record set, and no individual Central
  // Bank levers — and must submit with zero warnings (acceptance criteria 1, 2 and 4).
  const defaultRunOptions = getModelRunOptions(paths, undefined, true);
  const defaultRunRequest = buildDefaultRunSubmitRequest(defaultRunOptions, new Date('2026-07-13T00:00:00.000Z'));
  assert.equal(defaultRunRequest.baseline, defaultRunOptions.defaultBaseline, 'Default run must use the stable default baseline');
  assert.equal(defaultRunRequest.basePolicy, '2011', 'Default run must use the 2011 base policy');
  assert.equal(defaultRunRequest.overrides.N_STEPS, 3500, 'Default run must simulate 3500 steps');
  assert.equal(defaultRunRequest.overrides.N_SIMS, 1, 'Default run must use a single seed');
  assert.ok(
    !Object.keys(defaultRunRequest.overrides).some((key) => key.startsWith('CENTRAL_BANK_')),
    'Default run must not set Central Bank levers individually'
  );
  assert.notEqual(defaultRunRequest.overrides.recordCoreIndicators, false, 'Default run must keep core indicators on');
  assert.equal(defaultRunRequest.overrides.recordTransactions, false, 'Default run must disable heavy transaction recording');
  const defaultRunPrepared = prepareModelRunSubmission(
    paths,
    { ...defaultRunRequest, confirmWarnings: false },
    { ignoreStorageCap: true }
  );
  assert.equal(defaultRunPrepared.accepted, true, 'Default run preset must submit without any warnings');

  const manualSubmit = submitModelRun(paths, {
    baseline: 'v0o7',
    basePolicy: '2011',
    title: 'local experiment smoke manual v0o7',
    overrides: smokeOverrides,
    confirmWarnings: true
  });
  assert.equal(manualSubmit.accepted, true, 'Expected v0o7 manual smoke submission to be accepted');
  const manualJobId = manualSubmit.job?.jobId ?? '';
  assert.ok(manualJobId, 'Expected v0o7 manual smoke submission to create a job');
  await waitForCondition('manual model smoke', () => TERMINAL_STATUSES.has(getModelRunJob(manualJobId).status));
  const manualJob = getModelRunJob(manualJobId);
  assert.equal(manualJob.status, 'succeeded', `Expected v0o7 manual smoke to succeed; got ${manualJob.status}`);
  assert.ok(
    fs.existsSync(path.join(paths.resultsRoot, manualJob.runId, 'Output-run1.csv')),
    'Expected v0o7 manual smoke to write Output-run1.csv'
  );

  const sensitivitySubmit = submitSensitivityExperiment(paths, {
    baseline: 'v0o7',
    basePolicy: '2011',
    title: 'local experiment smoke sensitivity v0o7',
    policyPackageId: 'owner_occupier_lti_soft_max',
    min: 5,
    max: 6,
    sampleCount: 2,
    overrides: smokeOverrides,
    maxWorkers: 2,
    confirmWarnings: true
  });
  assert.equal(sensitivitySubmit.accepted, true, 'Expected v0o7 sensitivity smoke submission to be accepted');
  const experimentId = sensitivitySubmit.experiment?.experimentId ?? '';
  assert.ok(experimentId, 'Expected v0o7 sensitivity smoke submission to create an experiment');
  await waitForCondition('sensitivity smoke', () => {
    const detail = getSensitivityExperiment(paths, experimentId).experiment;
    return TERMINAL_STATUSES.has(detail.status);
  });
  const sensitivityDetail = getSensitivityExperiment(paths, experimentId).experiment;
  assert.equal(
    sensitivityDetail.status,
    'succeeded',
    `Expected v0o7 sensitivity smoke to succeed; got ${sensitivityDetail.status}: ${sensitivityDetail.failureReason ?? ''}`
  );
  assert.equal(sensitivityDetail.maxWorkers, 2, 'Expected sensitivity smoke to record two parallel workers');
  assert.equal(sensitivityDetail.seedsPerPoint, 1, 'Expected sensitivity smoke to use one seed per sampled point');
  const sensitivityLogs = getSensitivityExperimentLogs(paths, experimentId, 0, 200);
  assert.equal(sensitivityLogs.progress?.percentComplete, 100, 'Expected sensitivity smoke logs to expose final progress');
  assert.ok(
    sensitivityLogs.lines.some((line) => /Worker \d+\/2 (started|finished) point/.test(line)),
    'Expected sensitivity smoke logs to include summarized worker lifecycle lines'
  );
  assert.ok(
    sensitivityLogs.lines.every((line) => !line.includes('Simulation: 1, time:')),
    'Expected sensitivity smoke Live Logs to hide raw JVM progress lines'
  );
} finally {
  __resetModelRunManagerForTests();
  __resetSensitivityRunsForTests();
  fs.rmSync(smokeRoot, { recursive: true, force: true });
}
