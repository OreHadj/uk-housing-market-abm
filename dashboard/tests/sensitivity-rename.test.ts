import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEMO_EXAMPLE_IDS } from '../shared/demoExamples.js';
import { getSensitivityExperiment, listSensitivityExperiments, renameSensitivityExperiment } from '../server/lib/sensitivityRuns.js';

// A finished analysis on disk, as the dashboard leaves it: metadata plus its run manifest.
const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sensitivity-rename-'));
const experimentId = 'sensitivity-20261012T120000Z-abcdef12';
const experimentDir = path.join(repoRoot, 'Results', 'experiments', 'sensitivity', experimentId);
fs.mkdirSync(experimentDir, { recursive: true });
const metadataPath = path.join(experimentDir, 'metadata.json');
const manifestPath = path.join(experimentDir, 'dashboard-run-manifest.json');
fs.writeFileSync(metadataPath, JSON.stringify({
  experimentId,
  title: 'Practice LTI sweep [practice-id]',
  baseline: 'v0o7',
  basePolicy: '2024',
  status: 'succeeded',
  createdAt: '2026-10-12T12:00:00.000Z',
  endedAt: '2026-10-12T12:05:00.000Z',
  parameter: { key: 'CENTRAL_BANK_LTI_HARD_MAX_FTB', title: 'LTI threshold', description: '', baselineValue: 4.5, min: 4, max: 5, sampleCount: 3 },
  warnings: [],
  warningSummary: { byPoint: {} },
  sampledPoints: [],
  collapsedSlots: {},
  runCommand: { commandTemplate: '' }
}, null, 2));
fs.writeFileSync(manifestPath, JSON.stringify({
  manifestType: 'sensitivity-experiment',
  updatedAt: '2026-10-12T12:05:00.000Z',
  experiment: { experimentId, title: 'Practice LTI sweep [practice-id]', points: [{ pointId: 'p1' }] }
}, null, 2));

try {
  // The name is saved in the analysis's own files and served straight away.
  assert.deepEqual(renameSensitivityExperiment(repoRoot, experimentId, '  LTI sweep:  4x to 5x  '), {
    experimentId, title: 'LTI sweep 4x to 5x'
  }, 'A new name is cleaned up the way a new analysis title is');
  assert.equal(JSON.parse(fs.readFileSync(metadataPath, 'utf-8')).title, 'LTI sweep 4x to 5x');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  assert.equal(manifest.experiment.title, 'LTI sweep 4x to 5x');
  assert.deepEqual(manifest.experiment.points, [{ pointId: 'p1' }], 'The rest of the manifest is left as it was');
  assert.notEqual(manifest.updatedAt, '2026-10-12T12:05:00.000Z');
  assert.equal(getSensitivityExperiment(repoRoot, experimentId).experiment.title, 'LTI sweep 4x to 5x');
  assert.equal(listSensitivityExperiments(repoRoot).experiments[0].title, 'LTI sweep 4x to 5x', 'The list shows the new name without a restart');

  // An empty name clears it, so the analysis is identified by its id again.
  assert.deepEqual(renameSensitivityExperiment(repoRoot, experimentId, '   '), { experimentId, title: null });
  assert.equal(JSON.parse(fs.readFileSync(metadataPath, 'utf-8')).title, undefined);
  assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')).experiment.title, null);

  assert.throws(() => renameSensitivityExperiment(repoRoot, experimentId, 'x'.repeat(121)), /120 characters or fewer/);
  assert.throws(() => renameSensitivityExperiment(repoRoot, 'sensitivity-unknown', 'Name'), /Unknown sensitivity experiment/);
  assert.throws(() => renameSensitivityExperiment(repoRoot, DEMO_EXAMPLE_IDS.sensitivityExperimentId, 'Mine now'),
    'Bundled examples cannot be renamed');
} finally {
  fs.rmSync(repoRoot, { recursive: true, force: true });
}

console.log('Sensitivity rename: saved to metadata and manifest, cleared names, limits and protected examples passed.');
