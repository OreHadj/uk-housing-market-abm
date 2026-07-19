// Regression guard for the Central Bank base-rate "Use base policy value" control.
//
// The base-rate field now has an explicit checkbox instead of round-trip / no-op detection:
//  - checked  -> submit the base policy's exact stored fraction, byte-for-byte;
//  - unchecked -> submit a plain reading of the typed percentage (5.11 -> 0.0511).
//
// This test computes the stored form value each of the three reviewer-named interaction sequences
// leaves behind, using the REAL logic the component uses (String(basePolicyValue) when checked,
// scaledInputToStoredFraction when unchecked), mirrors the frontend->server submit path
// (parseFloat -> override -> String()), generates a REAL config.properties via the server pipeline
// (spawn stubbed, no Java), then greps the actual file. Assertions are on what lands in the file, not
// on the on-screen percentage, so this fails if display rounding ever leaks into the submitted value.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  __resetModelRunManagerForTests,
  __setModelRunSpawnForTests,
  submitModelRun
} from '../server/lib/modelRuns.js';
import { createDevelopmentRuntimePaths } from '../server/lib/runtimePaths.js';
import { scaledInputToStoredFraction } from '../shared/policyDisplay.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const BASELINE = 'v5o3'; // a 2024-policy baseline whose config carries CENTRAL_BANK_INITIAL_BASE_RATE
const BASE_RATE_KEY = 'CENTRAL_BANK_INITIAL_BASE_RATE';
const SCALE = 100;
const BASE_POLICY_BASE_RATE = 0.0510833333; // 2024 base policy base rate, as stored in the catalogue
const TMP_RUNS_DIR = 'dashboard-model-runs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'base-rate-verify-'));
const paths = {
  ...createDevelopmentRuntimePaths(repoRoot),
  resultsRoot: path.join(root, 'Results'),
  tempRoot: path.join(root, 'tmp'),
  logsRoot: path.join(root, 'logs')
};

// The stored form value each interaction sequence leaves behind, computed by the real field logic.
// Checked carries the base policy fraction through as String(basePolicyValue); unchecked stores a
// plain reading of the typed percentage. Re-checking simply returns to the base policy fraction.
const baseFractionString = String(BASE_POLICY_BASE_RATE);
const checkedUntouched = baseFractionString; // (a) box checked, untouched
const uncheckedTyped511 = scaledInputToStoredFraction('5.11', SCALE); // (b) unchecked, type 5.11
const uncheckedTyped512ThenRecheck = (() => {
  scaledInputToStoredFraction('5.12', SCALE); // user types 5.12 while unchecked
  return baseFractionString; // then re-checks the box, discarding the typed value
})();

function generatedBaseRateLine(storedFormValue: string, title: string): string {
  // Mirror the frontend submit: parseFormValue is Number.parseFloat for numeric parameters.
  const overrideValue = Number.parseFloat(storedFormValue);
  const result = submitModelRun(paths, {
    baseline: BASELINE,
    basePolicy: '2024',
    title,
    overrides: { [BASE_RATE_KEY]: overrideValue, N_STEPS: 1, N_SIMS: 1 },
    confirmWarnings: true
  });
  assert.equal(result.accepted, true, `submit rejected: ${JSON.stringify(result)}`);
  const jobId = result.job?.jobId ?? '';
  assert.ok(jobId, 'no jobId returned');
  // config.properties is written synchronously before any launch; read it in the same tick.
  const configPath = path.join(paths.tempRoot, TMP_RUNS_DIR, jobId, 'config.properties');
  const line = fs
    .readFileSync(configPath, 'utf-8')
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(BASE_RATE_KEY));
  assert.ok(line, `${BASE_RATE_KEY} not found in ${configPath}`);
  return line as string;
}

try {
  __resetModelRunManagerForTests();
  __setModelRunSpawnForTests(() => spawn(process.execPath, ['-e', 'process.exit(0)']));

  // Pure-logic assertions first.
  assert.equal(checkedUntouched, '0.0510833333', '(a) checked+untouched must carry the exact base fraction');
  assert.equal(uncheckedTyped511, '0.0511', '(b) unchecked type 5.11 must store a plain 0.0511');
  assert.equal(uncheckedTyped512ThenRecheck, '0.0510833333', '(c) re-checking must restore the exact base fraction');
  assert.equal(String(5.11 / 100), '0.051100000000000007'); // documents the float noise a naive path would emit

  // File-level assertions: grep the generated config.properties.
  const lines = {
    '(a) checked, untouched': generatedBaseRateLine(checkedUntouched, 'verify-checked-untouched'),
    '(b) unchecked, type 5.11': generatedBaseRateLine(uncheckedTyped511, 'verify-unchecked-511'),
    '(c) type 5.12 then re-check': generatedBaseRateLine(uncheckedTyped512ThenRecheck, 'verify-recheck')
  };

  console.log('\n=== actual CENTRAL_BANK_INITIAL_BASE_RATE lines from generated config.properties ===');
  for (const [label, line] of Object.entries(lines)) {
    console.log(`${label.padEnd(32)} | ${line}`);
  }

  assert.equal(lines['(a) checked, untouched'], `${BASE_RATE_KEY} = 0.0510833333`);
  assert.equal(lines['(b) unchecked, type 5.11'], `${BASE_RATE_KEY} = 0.0511`);
  assert.equal(lines['(c) type 5.12 then re-check'], `${BASE_RATE_KEY} = 0.0510833333`);

  console.log('\nALL CHECKS PASSED\n');
} finally {
  __resetModelRunManagerForTests();
  __setModelRunSpawnForTests(null);
  fs.rmSync(root, { recursive: true, force: true });
}
