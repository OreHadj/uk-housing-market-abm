import assert from 'node:assert/strict';
import type {
  KpiMetricSummary,
  LendingDistributionPayload,
  LendingSummaryStats,
  ResultsComparePayload,
  ResultsRunDetail
} from '../shared/types';
import {
  getReport2Kpi,
  getReport2LoanMean,
  getReport2Points,
  getReport2PrivateRentingShare,
  getReport2TailShare,
  getReport2Volatility
} from '../src/pages/report2/report2Model';

const kpi: KpiMetricSummary = {
  indicatorId: 'output_nRenting', title: 'Private renters', units: 'count', scaling: 'dashboard',
  windowType: 'post_500', mean: 20, cv: null, annualisedTrend: null, range: null
};
const points = [{ modelTime: 500, value: 10 }, { modelTime: 501, value: null }, { modelTime: 502, value: 30 }];
const payload: ResultsComparePayload = {
  runIds: ['reference', 'policy'], indicatorIds: ['output_nRenting'], smoothWindow: 0, window: 'post500',
  kpiSummaryByRun: [{ runId: 'reference', kpiSummary: [{ ...kpi, mean: 40 }] }, { runId: 'policy', kpiSummary: [kpi] }],
  indicators: [{
    indicator: { id: 'output_nRenting', title: 'Private renters', units: 'count', description: '', source: 'output', scaling: 'dashboard' },
    seriesByRun: [{ runId: 'reference', points: [] }, { runId: 'policy', points }]
  }]
};
assert.equal(getReport2Kpi(payload, 'policy', 'output_nRenting'), kpi, 'Run lookup is independent of array order');
assert.equal(getReport2Kpi(null, 'policy', 'output_nRenting'), undefined);
assert.equal(getReport2Kpi(payload, 'missing', 'output_nRenting'), undefined);
assert.deepEqual(getReport2Points(payload, 'policy', 'output_nRenting'), points, 'Keep missing months as gaps');
assert.deepEqual(getReport2Points(payload, 'policy', 'missing'), []);
assert.deepEqual(getReport2Points(null, 'policy', 'output_nRenting'), []);

assert.equal(getReport2Volatility(points), 10, 'Population SD must not use the sample denominator');
assert.equal(getReport2Volatility([]), null);
assert.equal(getReport2Volatility([{ modelTime: 1, value: 0 }]), null);
assert.equal(getReport2Volatility([{ modelTime: 1, value: 0 }, { modelTime: 2, value: 0 }]), 0);
assert.equal(getReport2Volatility([
  ...points, { modelTime: 503, value: Number.NaN }, { modelTime: 504, value: Infinity },
  { modelTime: Number.NaN, value: 200 }
]), 10, 'Invalid observations must not become zero-valued observations');

const summary = (borrowerType: LendingSummaryStats['borrowerType'], count: number, meanLtv: number | null, meanLti: number | null): LendingSummaryStats => ({
  borrowerType, count, meanLtv, meanLti, medianLtv: null, medianLti: null, meanDsti: null, meanPriceToIncome: null, meanIcr: null
});
const lending: LendingDistributionPayload = {
  runId: 'policy', available: true,
  window: { requested: 'post500', effective: 'post500', clamped: false, startModelTime: 500, endModelTime: 1000,
    recordingStartModelTime: 500, dataStartModelTime: 500, dataEndModelTime: 1000 },
  counts: { transactions: 500, mortgaged: 110, cashExcluded: 390, byBorrowerType: [] },
  seedCount: 2, seedLabels: ['1', '2'], caps: [], histograms: [], quintiles: null, joint: null, capTolerance: 0,
  summaryByBorrowerType: [summary('FTB', 2, 80, 4), summary('HM', 8, 60, 2), summary('BTL', 100, 90, 10)],
  bandGroups: [{
    metric: 'ltv', title: 'LTV', units: '%', highThreshold: 75,
    bands: [{ id: '75', label: '75–85%', lowerEdge: 75, upperEdge: 85 }, { id: '85', label: '85%+', lowerEdge: 85, upperEdge: null }],
    seriesByBorrowerType: [
      { borrowerType: 'FTB', count: 2, bands: [{ bandId: '75', count: 1, share: 50 }, { bandId: '85', count: 0, share: 0 }] },
      { borrowerType: 'HM', count: 8, bands: [{ bandId: '75', count: 0, share: 0 }, { bandId: '85', count: 0, share: 0 }] }
    ]
  }, {
    metric: 'lti', title: 'LTI', units: 'ratio', highThreshold: 3.35,
    bands: [{ id: '3.35', label: '3.35+', lowerEdge: 3.35, upperEdge: null }],
    seriesByBorrowerType: [
      { borrowerType: 'FTB', count: 2, bands: [{ bandId: '3.35', count: 2, share: 100 }] },
      { borrowerType: 'HM', count: 8, bands: [{ bandId: '3.35', count: 0, share: 0 }] }
    ]
  }]
};
const before = structuredClone(lending);
assert.equal(getReport2LoanMean(lending, 'ltv'), 64, 'Pool FTB/HM by loan count; exclude BTL and cash');
assert.equal(getReport2LoanMean(lending, 'lti'), 2.4);
const incompleteIncome = structuredClone(lending);
incompleteIncome.summaryByBorrowerType = [summary('FTB', 10, 80, 4), summary('HM', 10, 60, 2)];
incompleteIncome.bandGroups[1].seriesByBorrowerType[1].count = 10;
assert.equal(getReport2LoanMean(incompleteIncome, 'lti'), 28 / 12,
  'Two valid FTB incomes and ten valid HM incomes must not be weighted as ten loans each');
incompleteIncome.bandGroups[1].seriesByBorrowerType[0].count = 0;
incompleteIncome.summaryByBorrowerType[0].meanLti = null;
assert.equal(getReport2LoanMean(incompleteIncome, 'lti'), 2, 'Loans without a valid ratio do not enter the pooled mean');
assert.equal(getReport2LoanMean({ ...lending, bandGroups: [], histograms: [] }, 'lti'), null,
  'Missing valid-ratio denominators must not fall back to all transaction counts');
assert.equal(getReport2LoanMean(null, 'ltv'), null);
assert.equal(getReport2LoanMean({ ...lending, available: false }, 'ltv'), null);
assert.equal(getReport2LoanMean({ ...lending, summaryByBorrowerType: [summary('FTB', 0, null, null)] }, 'ltv'), null);
assert.equal(getReport2LoanMean({ ...lending, summaryByBorrowerType: [summary('FTB', 2, 0, 0), summary('HM', 0, null, null)] }, 'ltv'), 0);
assert.equal(getReport2LoanMean({ ...lending, summaryByBorrowerType: [summary('FTB', 2, 80, 4), summary('HM', 8, null, 2)] }, 'ltv'), null,
  'A missing mean for positive-count loans must not silently exclude those borrowers');
assert.equal(getReport2LoanMean({ ...lending, summaryByBorrowerType: [summary('FTB', NaN, 80, 4)] }, 'ltv'), null);
assert.equal(getReport2TailShare(lending, 'ltv', 'FTB'), 50);
assert.equal(getReport2TailShare(lending, 'ltv', 'HM'), 0, 'An observed zero tail differs from unavailable data');
assert.equal(getReport2TailShare(lending, 'lti', 'FTB'), 100);
assert.equal(getReport2TailShare({ ...lending, bandGroups: [] }, 'lti', 'FTB'), null);
assert.equal(getReport2TailShare(null, 'ltv', 'FTB'), null);
assert.equal(getReport2TailShare({ ...lending, available: false }, 'ltv', 'FTB'), null);
const changedThreshold = structuredClone(lending);
changedThreshold.bandGroups[0].highThreshold = 85;
assert.equal(getReport2TailShare(changedThreshold, 'ltv', 'FTB'), 0, 'Use the returned threshold rather than a fixed cut');
changedThreshold.bandGroups[0].highThreshold = 80;
assert.equal(getReport2TailShare(changedThreshold, 'ltv', 'FTB'), null, 'Cannot infer a cut inside a band');
const missingTail = structuredClone(lending);
missingTail.bandGroups[0].seriesByBorrowerType[0].bands.pop();
assert.equal(getReport2TailShare(missingTail, 'ltv', 'FTB'), null);
const invalidTail = structuredClone(lending);
invalidTail.bandGroups[0].seriesByBorrowerType[0].bands[0].share = NaN;
assert.equal(getReport2TailShare(invalidTail, 'ltv', 'FTB'), null);
assert.deepEqual(lending, before, 'Report helpers do not mutate API data');

const detail: ResultsRunDetail = {
  runId: 'policy', title: 'Policy', path: '', modifiedAt: '', createdAt: '', sizeBytes: 0, fileCount: 0,
  status: 'complete', configAvailable: true,
  parseCoverage: { requiredCount: 0, supportedCount: 0, emptyCount: 0, errorCount: 0 }, policySettings: [],
  provenance: { ukHouseholds: 100, ukDwellings: 90, dwellingsPerHousehold: 0.9, targetPopulation: 10,
    meanModelHouseholds: 10, meanScaleFactor: 10, nSteps: 1000, seeds: [1], seedSource: 'manifest' },
  configuration: { modelVersion: null, basePolicy: null, maxWorkers: null, parameterValues: {} }, indicators: [], kpiSummary: []
};
assert.equal(getReport2PrivateRentingShare(payload, 'policy', detail), 20);
assert.equal(getReport2PrivateRentingShare(payload, 'reference', detail), null, 'Never divide by another run’s population');
assert.equal(getReport2PrivateRentingShare(payload, 'policy', null), null);
assert.equal(getReport2PrivateRentingShare(null, 'policy', detail), null);
for (const ukHouseholds of [null, 0, -1, NaN]) {
  assert.equal(getReport2PrivateRentingShare(payload, 'policy', { ...detail, provenance: { ...detail.provenance, ukHouseholds } }), null);
}
const updatedRenting = (mean: number | null, scaling: KpiMetricSummary['scaling'] = 'dashboard'): ResultsComparePayload => ({
  ...payload, kpiSummaryByRun: [{ runId: 'policy', kpiSummary: [{ ...kpi, mean, scaling }] }]
});
assert.equal(getReport2PrivateRentingShare(updatedRenting(0), 'policy', detail), 0);
assert.equal(getReport2PrivateRentingShare(updatedRenting(20, 'none'), 'policy', detail), null, 'Unscaled counts are not a UK share');
for (const mean of [null, NaN, -1, 101]) {
  assert.equal(getReport2PrivateRentingShare(updatedRenting(mean), 'policy', detail), null);
}

console.log('Report2 model tests passed.');
