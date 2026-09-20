import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listModelRunJobs, prepareModelRunSubmission } from '../server/lib/modelRuns.js';
import { prepareSensitivityExperimentSubmission } from '../server/lib/sensitivityRuns.js';
import { createDevelopmentRuntimePaths } from '../server/lib/runtimePaths.js';
import { writeDashboardManagedRunMarker } from '../server/lib/runOwnership.js';

// Exercise real submission validation only: no job is enqueued and no model is launched.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'housing-experiment-start-'));
const paths = {
  ...createDevelopmentRuntimePaths(repoRoot),
  resultsRoot: path.join(fixtureRoot, 'Results'),
  tempRoot: path.join(fixtureRoot, 'tmp'),
  logsRoot: path.join(fixtureRoot, 'logs')
};
const advisoryOverrides = { N_STEPS: 5001, TARGET_POPULATION: 20000, N_SIMS: 51 };
const request = {
  baseline: 'v5o3',
  title: 'Single click policy',
  overrides: advisoryOverrides,
  maxWorkers: 1,
  confirmWarnings: false
};

try {
  const manual = prepareModelRunSubmission(paths, request);
  assert.ok(manual.accepted, 'A first policy Start must accept workload warnings');
  for (const code of ['high_n_steps', 'high_target_population', 'multiple_simulations']) {
    assert.ok(manual.prepared.warnings.some((warning) => warning.code === code), `Keep advisory ${code}`);
  }

  const sensitivity = prepareSensitivityExperimentSubmission(paths, {
    baseline: 'v5o3',
    title: 'Single click sensitivity',
    policyPackageId: 'owner_occupier_lti_soft_max',
    min: 4,
    max: 6,
    sampleCount: 3,
    overrides: advisoryOverrides,
    maxWorkers: 1,
    confirmWarnings: false
  });
  assert.ok(sensitivity.accepted, 'A first sensitivity Start must accept workload and policy warnings');
  for (const code of ['high_n_steps', 'high_target_population', 'multiple_simulations', 'central_bank_lti_soft_limit_non_binding']) {
    assert.ok(sensitivity.prepared.warnings.some((warning) => warning.code === code), `Keep advisory ${code}`);
  }

  // Keep the destructive case distinct: one click must never replace saved results.
  const { runAbsolutePath, runId } = manual.prepared;
  fs.mkdirSync(runAbsolutePath, { recursive: true });
  const savedOutput = path.join(runAbsolutePath, 'saved-results.txt');
  fs.writeFileSync(savedOutput, 'Existing results');
  assert.throws(
    () => prepareModelRunSubmission(paths, { ...request, confirmWarnings: true }),
    /not marked as a dashboard-managed run/,
    'Even explicit confirmation must not overwrite unrelated files'
  );
  writeDashboardManagedRunMarker(runAbsolutePath, {
    jobId: 'job-existing-fixture', runId, baseline: request.baseline,
    title: request.title, createdAt: new Date().toISOString()
  });
  const overwrite = prepareModelRunSubmission(paths, request);
  assert.equal(overwrite.accepted, false, 'Replacing existing results still requires confirmation');
  if (!overwrite.accepted) {
    assert.ok(overwrite.warnings.some((warning) => warning.code === 'output_folder_exists'));
  }
  assert.equal(fs.readFileSync(savedOutput, 'utf8'), 'Existing results');
  const confirmed = prepareModelRunSubmission(paths, { ...request, confirmWarnings: true });
  assert.ok(confirmed.accepted);
  assert.equal(fs.existsSync(savedOutput), false, 'Only explicit replacement may remove existing results');
  assert.deepEqual(listModelRunJobs(), [], 'This regression test must not enqueue a run');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('Single-click experiment start tests passed.');
