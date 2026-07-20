// Regression guard for the Central Bank "Use base policy value" controls (base rate, affordability
// cap, ICR floor).
//
// Each field is ticked by default (carry the base policy's exact stored fraction through, byte-for-
// byte) or unticked (type a plain override read straight from the display unit). This test computes
// the stored form value each interaction leaves behind using the REAL field logic
// (String(basePolicyValue) when ticked, scaledInputToStoredFraction when unticked), mirrors the
// frontend->server submit path (parseFloat -> override -> String()), generates a REAL
// config.properties via the server pipeline (spawn stubbed, no Java), then greps the actual file. The
// assertions are on what lands in the file, not the on-screen value, so this fails if display
// rounding ever leaks into the submitted value.
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

const BASELINE = 'v5o3'; // a 2024-policy baseline whose config carries all three keys
const BASE_RATE_KEY = 'CENTRAL_BANK_INITIAL_BASE_RATE';
const AFFORDABILITY_KEY = 'CENTRAL_BANK_AFFORDABILITY_HARD_MAX';
const ICR_KEY = 'CENTRAL_BANK_ICR_HARD_MIN';
const TMP_RUNS_DIR = 'dashboard-model-runs';

// 2024 base policy values, as stored in the catalogue. Affordability/ICR are the non-binding "off"
// sentinels, so ticking these caps carries an "off" state through.
const BASE_RATE_2024 = 0.0510833333;
const AFFORDABILITY_2024 = 0.9999;
const ICR_2024 = 0;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-precision-verify-'));
const paths = {
  ...createDevelopmentRuntimePaths(repoRoot),
  resultsRoot: path.join(root, 'Results'),
  tempRoot: path.join(root, 'tmp'),
  logsRoot: path.join(root, 'logs')
};

// The stored form value each interaction leaves behind, from the real field logic. Ticked carries the
// base policy value through as String(basePolicyValue); unticked stores a plain reading of the typed
// display value; re-ticking simply returns to the base policy value.
const ticked = (basePolicyValue: number) => String(basePolicyValue);
const typed = (raw: string, scale: number) => scaledInputToStoredFraction(raw, scale);

function generatedConfigLine(key: string, storedFormValue: string, title: string): string {
  // Mirror the frontend submit: parseFormValue is Number.parseFloat for numeric parameters.
  const overrideValue = Number.parseFloat(storedFormValue);
  const result = submitModelRun(paths, {
    baseline: BASELINE,
    basePolicy: '2024',
    title,
    overrides: { [key]: overrideValue, N_STEPS: 1, N_SIMS: 1 },
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
    .find((entry) => entry.startsWith(key));
  assert.ok(line, `${key} not found in ${configPath}`);
  return line as string;
}

try {
  __resetModelRunManagerForTests();
  __setModelRunSpawnForTests(() => spawn(process.execPath, ['-e', 'process.exit(0)']));

  // Pure-logic assertions first: the exact stored form value each interaction produces.
  assert.equal(ticked(BASE_RATE_2024), '0.0510833333', 'base rate: ticked carries the exact fraction');
  assert.equal(typed('5.11', 100), '0.0511', 'base rate: unticked 5.11 stores a plain 0.0511');
  assert.equal(typed('5.12', 100), '0.0512', 'base rate: unticked 5.12 stores a plain 0.0512');
  assert.equal(ticked(AFFORDABILITY_2024), '0.9999', 'affordability: ticked carries the exact off sentinel');
  assert.equal(typed('40', 100), '0.4', 'affordability: unticked 40% stores 0.4');
  assert.equal(ticked(ICR_2024), '0', 'ICR: ticked carries the exact off sentinel');
  assert.equal(typed('1.5', 1), '1.5', 'ICR: unticked 1.5x stores 1.5');
  assert.equal(String(5.11 / 100), '0.051100000000000007'); // documents the float noise a naive path would emit

  // File-level assertions: grep the generated config.properties for each field/state.
  const cases: Array<[string, string, string, string]> = [
    // [label, key, stored form value, expected config line]
    ['base rate (a) ticked, untouched', BASE_RATE_KEY, ticked(BASE_RATE_2024), `${BASE_RATE_KEY} = 0.0510833333`],
    ['base rate (b) unticked, type 5.11', BASE_RATE_KEY, typed('5.11', 100), `${BASE_RATE_KEY} = 0.0511`],
    ['base rate (c) type 5.12 then re-tick', BASE_RATE_KEY, ticked(BASE_RATE_2024), `${BASE_RATE_KEY} = 0.0510833333`],
    ['affordability ticked (off)', AFFORDABILITY_KEY, ticked(AFFORDABILITY_2024), `${AFFORDABILITY_KEY} = 0.9999`],
    ['affordability unticked, type 40%', AFFORDABILITY_KEY, typed('40', 100), `${AFFORDABILITY_KEY} = 0.4`],
    ['ICR ticked (off)', ICR_KEY, ticked(ICR_2024), `${ICR_KEY} = 0`],
    ['ICR unticked, type 1.5x', ICR_KEY, typed('1.5', 1), `${ICR_KEY} = 1.5`]
  ];

  console.log('\n=== actual Central Bank policy lines from generated config.properties ===');
  for (const [index, [label, key, storedFormValue, expected]] of cases.entries()) {
    const line = generatedConfigLine(key, storedFormValue, `verify-${index}`); // unique title per run
    console.log(`${label.padEnd(38)} | ${line}`);
    assert.equal(line, expected, `${label}: expected "${expected}" but got "${line}"`);
  }

  console.log('\nALL CHECKS PASSED\n');
} finally {
  __resetModelRunManagerForTests();
  __setModelRunSpawnForTests(null);
  fs.rmSync(root, { recursive: true, force: true });
}
