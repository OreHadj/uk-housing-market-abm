import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeLenderCap, describeRanAs, findLenderCap, readLenderLimits } from '../shared/lenderLimits';
import { getModelRunOptions } from '../server/lib/modelRuns';
import { getResultsRunDetail } from '../server/lib/results';
import { createDevelopmentRuntimePaths } from '../server/lib/runtimePaths';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function readModelConfig(version: string): Map<string, number> {
  const contents = fs.readFileSync(path.join(repoRoot, 'input-data-versions', version, 'config.properties'), 'utf-8');
  const values = new Map<string, number>();
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*([^#\s]+)/.exec(line);
    if (match && Number.isFinite(Number.parseFloat(match[2]))) values.set(match[1], Number.parseFloat(match[2]));
  }
  return values;
}

// The lender limits Bank.java combines with the policy settings, read from the real model configs.
const refitted2024 = readLenderLimits((key) => readModelConfig('v5o3').get(key));
const refitted2011 = readLenderLimits((key) => readModelConfig('v0o7').get(key));
assert.deepEqual(refitted2024, {
  CENTRAL_BANK_LTV_HARD_MAX_FTB: 0.95,
  CENTRAL_BANK_LTV_HARD_MAX_HM: 0.95,
  CENTRAL_BANK_LTV_HARD_MAX_BTL: 0.85,
  CENTRAL_BANK_LTI_SOFT_MAX_FTB: 5.4,
  CENTRAL_BANK_LTI_SOFT_MAX_HM: 5.6,
  CENTRAL_BANK_AFFORDABILITY_HARD_MAX: 0.4,
  CENTRAL_BANK_ICR_HARD_MIN: 1.25
});
assert.equal(refitted2011.CENTRAL_BANK_LTV_HARD_MAX_BTL, 0.75, 'The 2011 models lend buy-to-let at most 75%');

// Caps take the minimum, so only a value above the lender's limit runs at the limit.
assert.equal(findLenderCap('CENTRAL_BANK_LTV_HARD_MAX_BTL', 3, refitted2024), 0.85, "Tong's 300% buy-to-let LTV runs as 85%");
assert.equal(findLenderCap('CENTRAL_BANK_LTV_HARD_MAX_BTL', 0.85, refitted2024), null, 'A value at the limit takes effect');
assert.equal(findLenderCap('CENTRAL_BANK_LTV_HARD_MAX_BTL', 0.6, refitted2024), null, 'A tighter value takes effect');
assert.equal(findLenderCap('CENTRAL_BANK_LTV_HARD_MAX_BTL', 0.8, refitted2011), 0.75, 'A tightening can still be past a 2011 lender limit');
assert.equal(findLenderCap('CENTRAL_BANK_LTI_SOFT_MAX_FTB', 5, refitted2024), null, 'Loosening the LTI threshold works up to the limit');
assert.equal(findLenderCap('CENTRAL_BANK_LTI_SOFT_MAX_FTB', 6, refitted2024), 5.4);
// The ICR floor takes the maximum, so the direction reverses.
assert.equal(findLenderCap('CENTRAL_BANK_ICR_HARD_MIN', 1, refitted2024), 1.25, 'A lower ICR floor runs at the lenders’ floor');
assert.equal(findLenderCap('CENTRAL_BANK_ICR_HARD_MIN', 1.5, refitted2024), null, 'A higher ICR floor takes effect');
// Settings without a lender limit, and models that record none, are never flagged.
assert.equal(findLenderCap('CENTRAL_BANK_INITIAL_BASE_RATE', 0.5, refitted2024), null);
assert.equal(findLenderCap('CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_FTB', 2, refitted2024), null);
assert.equal(findLenderCap('CENTRAL_BANK_LTV_HARD_MAX_BTL', 3, undefined), null);
assert.equal(findLenderCap('CENTRAL_BANK_LTV_HARD_MAX_BTL', null, refitted2024), null);

assert.equal(
  describeLenderCap('CENTRAL_BANK_LTV_HARD_MAX_BTL', 0.85, 'the Refitted 2024 model'),
  'Runs as 85%. Lenders in the Refitted 2024 model never lend buy-to-let landlords more than 85% of the property value, so a higher limit has no extra effect.'
);
assert.equal(
  describeLenderCap('CENTRAL_BANK_ICR_HARD_MIN', 1.25, 'the Refitted 2024 model'),
  'Runs as 1.25×. Lenders in the Refitted 2024 model already require buy-to-let rent to cover at least 1.25× the mortgage interest, so a lower floor has no extra effect.'
);
// When the reference is past the limit too (a 2011 model under the 2024 policy), the note says why
// the 95% reference and the new value run the same.
assert.equal(
  describeLenderCap('CENTRAL_BANK_LTV_HARD_MAX_HM', 0.9, 'the Refitted 2011 model', 0.95),
  'Runs as 90%, like the 95% reference: lenders in the Refitted 2011 model never lend home movers more than 90% of the property value.'
);
assert.equal(
  describeRanAs('CENTRAL_BANK_LTI_SOFT_MAX_HM', 5.6),
  'This run used 5.6× income: lenders in its model never lend home movers more than 5.6× income.'
);

// Run setup receives the selected model's limits with its options.
const paths = createDevelopmentRuntimePaths(repoRoot);
assert.deepEqual(getModelRunOptions(paths, 'v5o3', false).lenderLimits, refitted2024);
assert.equal(getModelRunOptions(paths, 'v0', false).lenderLimits?.CENTRAL_BANK_LTV_HARD_MAX_FTB, 0.9);

// A completed run records what it actually ran with, from its own config.
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'lender-limits-'));
try {
  const resultsRoot = path.join(fixture, 'results');
  const runPath = path.join(resultsRoot, 'capped-btl-run');
  fs.mkdirSync(runPath, { recursive: true });
  const config = fs.readFileSync(path.join(repoRoot, 'input-data-versions', 'v5o3', 'config.properties'), 'utf-8')
    .replace(/^CENTRAL_BANK_LTV_HARD_MAX_BTL\s*=.*$/m, 'CENTRAL_BANK_LTV_HARD_MAX_BTL = 3.0');
  fs.writeFileSync(path.join(runPath, 'config.properties'), config);
  const detail = getResultsRunDetail({ ...paths, resultsRoot }, 'capped-btl-run');
  const settingsByKey = new Map(detail.policySettings.map((setting) => [setting.key, setting]));
  assert.deepEqual(settingsByKey.get('CENTRAL_BANK_LTV_HARD_MAX_BTL'), { key: 'CENTRAL_BANK_LTV_HARD_MAX_BTL', value: 3, ranAs: 0.85 });
  assert.deepEqual(settingsByKey.get('CENTRAL_BANK_LTV_HARD_MAX_FTB'), { key: 'CENTRAL_BANK_LTV_HARD_MAX_FTB', value: 0.95 }, 'A setting within its limit has no ranAs');
  assert.equal(settingsByKey.get('CENTRAL_BANK_INITIAL_BASE_RATE')?.ranAs, undefined);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

console.log('Lender limit tests passed.');
