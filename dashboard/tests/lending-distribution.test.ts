// Verification for the new-lending distributions parsed out of SaleTransactions-run1.csv.
//
// Part 1 is a synthetic fixture covering the parsing rules that are easy to get silently wrong:
// trimming the file's inconsistent whitespace, excluding cash purchases, taking LTI/DSTI off
// employment income rather than total income, borrower-type precedence, window clamping, and
// pooling the per-seed files that multi-seed runs never merge up to the run root.
//
// Part 2 is the real oracle: every figure below is reproduced from Results/v0-output, and the FTB
// and HM rows match Table 5 and Figs 4-5 of BoE Staff Working Paper 976 to the published precision.
// It is skipped (loudly) if that benchmark run is not present.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  __resetLendingDistributionCacheForTests,
  getLendingDistribution,
  getLendingDistributionCompare
} from '../server/lib/lendingDistribution.js';
import { getResultsRunFiles } from '../server/lib/results.js';
import { createDevelopmentRuntimePaths } from '../server/lib/runtimePaths.js';
import type { LendingBorrowerType, LendingDistributionPayload } from '../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const SALE_FILE = 'SaleTransactions-run1.csv';
let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  try {
    assert.deepEqual(actual, expected);
    console.log(`  ok   ${label}`);
  } catch {
    failures += 1;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function summaryFor(payload: LendingDistributionPayload, borrowerType: LendingBorrowerType) {
  const entry = payload.summaryByBorrowerType.find((row) => row.borrowerType === borrowerType);
  assert.ok(entry, `no summary for ${borrowerType}`);
  return entry;
}

/** Share of a borrower type at or above the lowest band edge, i.e. the whole tail. */
function tailShare(payload: LendingDistributionPayload, metric: 'ltv' | 'lti', borrowerType: LendingBorrowerType): number {
  const group = payload.bandGroups.find((entry) => entry.metric === metric);
  assert.ok(group, `no ${metric} band group`);
  const series = group.seriesByBorrowerType.find((entry) => entry.borrowerType === borrowerType);
  assert.ok(series, `no ${metric} series for ${borrowerType}`);
  return series.bands.reduce((total, band) => total + band.share, 0);
}

function round(value: number | null, digits: number): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

// ---------------------------------------------------------------------------
// Part 1 - synthetic fixture
// ---------------------------------------------------------------------------

// Header written with the same ragged spacing as the model's own output, so a parser that does not
// trim every field fails here rather than in production.
const FIXTURE_HEADER = [
  'modelTime', ' houseId', ' houseQuality', ' initialListedPrice', ' timeFirstOffered',
  ' transactionPrice', ' buyerId', 'buyerAge', ' buyerHasBTLGene', ' buyerMonthlyGrossTotalIncome',
  ' buyerMonthlyGrossEmploymentIncome', ' buyerMonthlyNetEmploymentIncome', ' desiredPurchasePrice',
  ' buyerPostPurchaseBankBalance', ' buyerCapGainCoeff', ' mortgageDownpayment', ' mortgagePrincipal',
  ' mortgageMonthlyPayment', ' annualInterestRate', ' ICR', ' maturity', ' firstTimeBuyerMortgage',
  ' buyToLetMortgage'
].join(';');

interface FixtureRow {
  modelTime: number;
  price: number;
  age: number;
  totalIncome: number;
  employmentIncome: number;
  principal: number;
  monthlyPayment: number;
  icr: string;
  ftb: boolean;
  btl: boolean;
}

function fixtureLine(row: FixtureRow): string {
  return [
    row.modelTime, ' 1', ' 0', ' 0.00', ' 0', ` ${row.price.toFixed(2)}`, ' 1', `${row.age.toFixed(2)}`,
    ' false', ` ${row.totalIncome.toFixed(2)}`, ` ${row.employmentIncome.toFixed(2)}`, ' 0.00', ' 0.00',
    ' 0.00', ' 0.00', ` ${(row.price - row.principal).toFixed(2)}`, ` ${row.principal.toFixed(2)}`,
    ` ${row.monthlyPayment.toFixed(2)}`, ' 0.0336', ` ${row.icr}`, ' 300',
    ` ${row.ftb}`, ` ${row.btl}`
  ].join(';');
}

function writeFixtureRun(runRoot: string, rowsByFile: Record<string, FixtureRow[]>, configLines: string[]): void {
  for (const [relativePath, rows] of Object.entries(rowsByFile)) {
    const filePath = path.join(runRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, [FIXTURE_HEADER, ...rows.map(fixtureLine)].join('\n'), 'utf-8');
  }
  fs.writeFileSync(path.join(runRoot, 'config.properties'), configLines.join('\n'), 'utf-8');
}

// One FTB, one HM, one BTL, one cash purchase. The FTB's total income is deliberately double its
// employment income: an LTI taken off total income would read 2.0 instead of 4.0.
const BASE_ROWS: FixtureRow[] = [
  { modelTime: 1000, price: 200000, age: 30, totalIncome: 5000, employmentIncome: 2500, principal: 120000, monthlyPayment: 750, icr: 'NaN', ftb: true, btl: false },
  { modelTime: 1000, price: 300000, age: 45, totalIncome: 5000, employmentIncome: 5000, principal: 150000, monthlyPayment: 1500, icr: 'NaN', ftb: false, btl: false },
  { modelTime: 1001, price: 100000, age: 50, totalIncome: 8000, employmentIncome: 4000, principal: 75000, monthlyPayment: 400, icr: '1.80', ftb: false, btl: true },
  { modelTime: 1001, price: 250000, age: 60, totalIncome: 9000, employmentIncome: 9000, principal: 0, monthlyPayment: 0, icr: 'NaN', ftb: false, btl: false }
];

const FIXTURE_CONFIG = [
  '# fixture',
  'TIME_TO_START_RECORDING_TRANSACTIONS = 1000',
  'recordTransactions = true',
  'CENTRAL_BANK_LTV_HARD_MAX_FTB = 0.95',
  'BANK_LTV_HARD_MAX_FTB = 0.9',
  'CENTRAL_BANK_LTV_HARD_MAX_BTL = 0.8',
  'BANK_LTV_HARD_MAX_BTL = 0.75'
];

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lending-distribution-'));
const fixturePaths = {
  ...createDevelopmentRuntimePaths(repoRoot),
  resultsRoot: path.join(fixtureRoot, 'Results')
};

try {
  console.log('\n=== fixture: parsing, derivations and window ===');
  const singleSeedRun = path.join(fixturePaths.resultsRoot, 'fixture-single');
  writeFixtureRun(singleSeedRun, { [SALE_FILE]: BASE_ROWS }, FIXTURE_CONFIG);

  const single = getLendingDistribution(fixturePaths, 'fixture-single', 'full');
  check('available', single.available, true);
  check('mortgaged count', single.counts.mortgaged, 3);
  check('cash purchases excluded', single.counts.cashExcluded, 1);
  check('transactions in window', single.counts.transactions, 4);
  check(
    'counts by borrower type',
    single.counts.byBorrowerType,
    [
      { borrowerType: 'FTB', count: 1 },
      { borrowerType: 'HM', count: 1 },
      { borrowerType: 'BTL', count: 1 }
    ]
  );
  check('one source file, no seed labels', [single.seedCount, single.seedLabels], [1, []]);

  // 120000 / 200000 = 60%; 120000 / (2500 * 12) = 4.0 on employment income (2.0 on total income);
  // 750 / 2500 = 0.3.
  check('FTB mean LTV', round(summaryFor(single, 'FTB').meanLtv, 4), 60);
  check('FTB mean LTI uses employment income', round(summaryFor(single, 'FTB').meanLti, 4), 4);
  check('FTB mean DSTI uses employment income', round(summaryFor(single, 'FTB').meanDsti, 4), 0.3);
  check('BTL mean ICR', round(summaryFor(single, 'BTL').meanIcr, 4), 1.8);
  check('owner-occupier ICR is not counted', summaryFor(single, 'FTB').meanIcr, null);

  // The BTL row is buyToLet AND not first-time: type precedence must put it in BTL.
  check('BTL LTV', round(summaryFor(single, 'BTL').meanLtv, 4), 75);

  // Binding cap is the tighter of the Central Bank and the lender limit.
  const ftbCap = single.caps.find((cap) => cap.borrowerType === 'FTB' && cap.metric === 'ltv');
  check('FTB LTV cap is the lender limit', [ftbCap?.value, ftbCap?.source], [90, 'bank']);
  const btlCap = single.caps.find((cap) => cap.borrowerType === 'BTL' && cap.metric === 'ltv');
  check('BTL LTV cap is the lender limit', [btlCap?.value, btlCap?.source], [75, 'bank']);

  // Recording starts at model time 1000, as in every shipped run, so a spin-up cutoff below that
  // point is a no-op and must be reported as the full window rather than as what was asked for.
  const clamped = getLendingDistribution(fixturePaths, 'fixture-single', 'post500');
  check('post500 clamps to the recording start', clamped.window.effective, 'full');
  check('clamp is reported', clamped.window.clamped, true);
  check('requested window is preserved', clamped.window.requested, 'post500');
  check('effective start is the data start', clamped.window.startModelTime, 1000);
  check('recording start is reported', clamped.window.recordingStartModelTime, 1000);
  check('post500 keeps every row', clamped.counts.mortgaged, 3);

  const clampedShort = getLendingDistribution(fixturePaths, 'fixture-single', 'post200');
  check('post200 clamps too', [clampedShort.window.effective, clampedShort.window.clamped], ['full', true]);

  const tail = getLendingDistribution(fixturePaths, 'fixture-single', 'tail120');
  check('tail120 over a 2-month file collapses to full', tail.window.effective, 'full');

  // A run that records from the start is the one case where the cutoff genuinely bites.
  const earlyRun = path.join(fixturePaths.resultsRoot, 'fixture-early');
  writeFixtureRun(
    earlyRun,
    {
      [SALE_FILE]: [
        { ...BASE_ROWS[0], modelTime: 100 },
        { ...BASE_ROWS[1], modelTime: 600 }
      ]
    },
    ['TIME_TO_START_RECORDING_TRANSACTIONS = 0', 'recordTransactions = true']
  );
  const biting = getLendingDistribution(fixturePaths, 'fixture-early', 'post500');
  check('post500 is honoured when recording starts early', biting.window.effective, 'post500');
  check('no clamp reported', biting.window.clamped, false);
  check('window starts at the cutoff', biting.window.startModelTime, 500);
  check('rows before the cutoff are dropped', biting.counts.mortgaged, 1);

  console.log('\n=== fixture: seed pooling ===');
  // Multi-seed runs merge only Output-run1.csv and the coreIndicator files to the run root, so the
  // transaction files live solely under seeds/.
  const multiSeedRun = path.join(fixturePaths.resultsRoot, 'fixture-seeds');
  writeFixtureRun(
    multiSeedRun,
    {
      [path.join('seeds', 'seed-1', SALE_FILE)]: BASE_ROWS,
      [path.join('seeds', 'seed-2', SALE_FILE)]: BASE_ROWS
    },
    FIXTURE_CONFIG
  );
  const pooled = getLendingDistribution(fixturePaths, 'fixture-seeds', 'full');
  check('pools across seeds', pooled.counts.mortgaged, 6);
  check('pools the cash count too', pooled.counts.cashExcluded, 2);
  check('seed count', pooled.seedCount, 2);
  check('seed labels', pooled.seedLabels, ['seed-1', 'seed-2']);

  console.log('\n=== fixture: unavailable states ===');
  const disabledRun = path.join(fixturePaths.resultsRoot, 'fixture-disabled');
  fs.mkdirSync(disabledRun, { recursive: true });
  fs.writeFileSync(
    path.join(disabledRun, 'config.properties'),
    ['TIME_TO_START_RECORDING_TRANSACTIONS = 1000', 'recordTransactions = false'].join('\n'),
    'utf-8'
  );
  const disabled = getLendingDistribution(fixturePaths, 'fixture-disabled', 'full');
  check('recording-disabled run is unavailable', disabled.available, false);
  check('reason names the config flag', disabled.unavailableReason, 'recording_disabled');

  const missingRun = path.join(fixturePaths.resultsRoot, 'fixture-missing');
  fs.mkdirSync(missingRun, { recursive: true });
  fs.writeFileSync(path.join(missingRun, 'config.properties'), 'recordTransactions = true', 'utf-8');
  const missing = getLendingDistribution(fixturePaths, 'fixture-missing', 'full');
  check('run with no transaction file is unavailable', missing.unavailableReason, 'no_transaction_file');

  console.log('\n=== fixture: compare ===');
  const compared = getLendingDistributionCompare(fixturePaths, ['fixture-single', 'fixture-seeds'], 'full');
  check('compare returns one payload per run', compared.runs.length, 2);
  check('compare echoes the run ids', compared.runIds, ['fixture-single', 'fixture-seeds']);
  assert.throws(() => getLendingDistributionCompare(fixturePaths, [], 'full'), /At least one runId/);
  assert.throws(() => getLendingDistributionCompare(fixturePaths, ['a', 'b', 'c'], 'full'), /maximum of 2/);
  console.log('  ok   compare rejects 0 and >2 runs');

  // ---------------------------------------------------------------------------
  // Part 2 - the verification oracle, against the shipped benchmark run
  // ---------------------------------------------------------------------------
  const benchmarkPaths = createDevelopmentRuntimePaths(repoRoot);
  const benchmarkFile = path.join(benchmarkPaths.resultsRoot, 'v0-output', SALE_FILE);

  if (!fs.existsSync(benchmarkFile)) {
    console.log(`\n=== ORACLE SKIPPED: ${benchmarkFile} not present ===`);
  } else {
    console.log('\n=== oracle: Results/v0-output vs BoE SWP 976 Table 5 / Figs 4-5, 8 ===');
    __resetLendingDistributionCacheForTests();
    const oracle = getLendingDistribution(benchmarkPaths, 'v0-output', 'full');

    check('cash purchases excluded', oracle.counts.cashExcluded, 17859);
    check('mortgaged transactions', oracle.counts.mortgaged, 20338);
    check(
      'counts by borrower type',
      oracle.counts.byBorrowerType,
      [
        { borrowerType: 'FTB', count: 8984 },
        { borrowerType: 'HM', count: 6632 },
        { borrowerType: 'BTL', count: 4722 }
      ]
    );

    check('FTB mean LTV (paper: 68)', round(summaryFor(oracle, 'FTB').meanLtv, 1), 68.1);
    check('HM mean LTV (paper: 62.8)', round(summaryFor(oracle, 'HM').meanLtv, 1), 62.9);
    check('BTL mean LTV', round(summaryFor(oracle, 'BTL').meanLtv, 1), 57.3);
    check('FTB mean LTI (paper: 2.7)', round(summaryFor(oracle, 'FTB').meanLti, 2), 2.66);
    check('HM mean LTI (paper: 3.1)', round(summaryFor(oracle, 'HM').meanLti, 2), 3.1);
    check('BTL mean LTI', round(summaryFor(oracle, 'BTL').meanLti, 2), 2.13);

    check('FTB share LTV >= 75% (paper: 52)', round(tailShare(oracle, 'ltv', 'FTB'), 1), 52.2);
    check('HM share LTV >= 75% (paper: 28)', round(tailShare(oracle, 'ltv', 'HM'), 1), 29);
    check('BTL share LTV >= 75%', round(tailShare(oracle, 'ltv', 'BTL'), 1), 8);

    // The band group's lowest LTI band opens at 3.0; high-LTI in the paper is > 3.35, so drop it.
    const ltiGroup = oracle.bandGroups.find((group) => group.metric === 'lti');
    assert.ok(ltiGroup);
    const highLtiShare = (borrowerType: LendingBorrowerType): number => {
      const series = ltiGroup.seriesByBorrowerType.find((entry) => entry.borrowerType === borrowerType);
      assert.ok(series);
      return series.bands.filter((band) => band.bandId !== '3').reduce((total, band) => total + band.share, 0);
    };
    check('FTB share LTI > 3.35 (paper: 30.3)', round(highLtiShare('FTB'), 1), 30.5);
    check('HM share LTI > 3.35 (paper: 42.3)', round(highLtiShare('HM'), 1), 42);

    const quintiles = oracle.quintiles;
    assert.ok(quintiles, 'quintile matrix missing');
    check('owner-occupier mortgaged pool', quintiles.poolCount, 15616);
    check(
      'quintile cut points',
      quintiles.cutPoints.map((cut) => Math.round(cut)),
      [92762, 132787, 184591, 264332]
    );

    const expectedQuintiles = [
      { highLtv: 26, highLti: 12.3, ftb: 1423, hm: 295 },
      { highLtv: 23.1, highLti: 18.3, ftb: 1054, hm: 473 },
      { highLtv: 21, highLti: 20.3, ftb: 942, hm: 448 },
      { highLtv: 16.7, highLti: 24.3, ftb: 684, hm: 423 },
      { highLtv: 13.2, highLti: 24.8, ftb: 589, hm: 286 }
    ];
    expectedQuintiles.forEach((expected, index) => {
      const row = quintiles.quintiles[index];
      const cellFor = (borrowerType: LendingBorrowerType) =>
        row.byBorrowerType.find((cell) => cell.borrowerType === borrowerType)?.highLtvCount;
      check(
        `HPQ ${index + 1}: % of all high-LTV / high-LTI lending, FTB/HM counts`,
        [round(row.highLtvShareOfAll, 1), round(row.highLtiShareOfAll, 1), cellFor('FTB'), cellFor('HM')],
        [expected.highLtv, expected.highLti, expected.ftb, expected.hm]
      );
    });

    // The paper's two directional claims, asserted rather than eyeballed.
    const highLtvByQuintile = quintiles.quintiles.map((row) => row.highLtvShareOfAll);
    const highLtiByQuintile = quintiles.quintiles.map((row) => row.highLtiShareOfAll);
    check(
      'high-LTV lending falls monotonically across price quintiles',
      highLtvByQuintile.every((share, index) => index === 0 || share < highLtvByQuintile[index - 1]),
      true
    );
    check(
      'high-LTI lending rises monotonically across price quintiles',
      highLtiByQuintile.every((share, index) => index === 0 || share > highLtiByQuintile[index - 1]),
      true
    );
    check(
      'FTB above HM for high-LTV in every quintile',
      quintiles.quintiles.every((row) => {
        const ftb = row.byBorrowerType.find((cell) => cell.borrowerType === 'FTB')?.highLtvCount ?? 0;
        const hm = row.byBorrowerType.find((cell) => cell.borrowerType === 'HM')?.highLtvCount ?? 0;
        return ftb > hm;
      }),
      true
    );

    console.log('\n=== oracle: payload shape ===');
    check(
      'histograms cover every metric',
      oracle.histograms.map((histogram) => histogram.metric),
      ['ltv', 'lti', 'dsti', 'priceToIncome', 'buyerAge']
    );
    check('joint grid is present', oracle.joint !== null, true);
    const jointCells = oracle.joint?.seriesByBorrowerType.reduce((total, series) => total + series.cells.length, 0) ?? 0;
    check('joint grid is sparse (< 20x24x3 dense cells)', jointCells < 20 * 24 * 3, true);
    check('effective window reported', oracle.window.effective, 'full');
    check('recording start read from config', oracle.window.recordingStartModelTime, 1000);

    const manifest = getResultsRunFiles(benchmarkPaths, 'v0-output');
    const saleEntry = manifest.find((entry) => entry.fileName === SALE_FILE);
    check('transaction file no longer reports unsupported', saleEntry?.coverageStatus, 'supported');
    const rentalEntry = manifest.find((entry) => entry.fileName === 'RentalTransactions-run1.csv');
    check('rental transactions left out of scope', rentalEntry?.coverageStatus, 'unsupported');
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
  if (failures > 0) {
    process.exitCode = 1;
  }
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
