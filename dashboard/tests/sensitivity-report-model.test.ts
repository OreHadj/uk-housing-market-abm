import assert from 'node:assert/strict';
import { buildCompactReportOutcomes, compactReportChange } from '../src/pages/experiments/view/sensitivity-report/compactReport';
import type {
  SensitivityExperimentMetadata,
  SensitivityExperimentResultsPayload,
  SensitivityIndicatorPointMetric,
  SensitivityPointResult,
  SensitivitySamplePoint
} from '../shared/types.js';
import {
  buildSensitivityReport,
  chooseReportFocusRow,
  formatReportNumber,
  formatReportSetting,
  formatReportValue,
  getReportWindowLabel,
  isReportMetricEligible,
  isReportRowEligible,
  reportPolicyUnit,
  REPORT_INDICATORS,
  REPORT_OUTCOMES
} from '../src/pages/experiments/view/sensitivity-report/reportModel.js';

const approvals = 'core_mortgageApprovals';
const debt = 'core_debtToIncome';
const price = 'core_priceToIncome';
const growth = 'core_creditGrowth';
const nearZero = 'near_zero';

function metric(id: string, mean: number | null, delta: number | null): SensitivityIndicatorPointMetric {
  return {
    indicatorId: id,
    title: REPORT_INDICATORS.find((indicator) => indicator.id === id)?.title ?? id,
    units: id === approvals ? 'count/month' : id === price ? 'ratio' : '%',
    kpi: { mean, cv: 0.2, range: 5, annualisedTrend: null },
    deltaFromBaseline: { mean: delta, cv: null, range: null, annualisedTrend: null }
  };
}

function sample(pointId: string, value: number | null, isBaseline = false): SensitivitySamplePoint {
  return { pointId, value, label: pointId, slotLabels: [], isBaseline };
}

function result(
  point: SensitivitySamplePoint,
  values: Record<string, { means: Array<number | null>; delta: number | null }>
): SensitivityPointResult {
  return {
    ...point,
    status: 'succeeded', runId: point.pointId, outputPath: null,
    indicatorMetrics: Object.entries(values).map(([id, data]) => {
      const finite = data.means.filter((value): value is number => value !== null);
      return metric(id, finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null, data.delta);
    }),
    seedResults: [11, 12, 13].map((seed, index) => ({
      seed, status: 'succeeded', runId: `${point.pointId}-${seed}`, outputPath: null,
      indicatorMetrics: Object.entries(values).map(([id, data]) => metric(id, data.means[index], null))
    }))
  };
}

function fixture(): { detail: SensitivityExperimentMetadata; results: SensitivityExperimentResultsPayload } {
  const base = sample('base', 0.045, true);
  const low = sample('low', 0.04);
  const high = sample('high', 0.05);
  return {
    detail: {
      experimentId: 'report-test', baseline: 'v5o3', status: 'succeeded', createdAt: '2026-09-20',
      parameter: {
        key: 'CENTRAL_BANK_INITIAL_BASE_RATE', title: 'Bank Rate', description: '', type: 'number',
        baselineValue: 0.045, min: 0.04, max: 0.05, sampleCount: 3
      },
      sampledPoints: [high, base, low], seeds: [11, 12, 13], seedsPerPoint: 3,
      warnings: [], warningSummary: { byPoint: {} }, collapsedSlots: {}, runCommand: { commandTemplate: '' }
    },
    results: {
      experimentId: 'report-test', baselinePointId: base.pointId,
      points: [
        result(high, {
          [approvals]: { means: [110, 120, 100], delta: 10 },
          [debt]: { means: [220, 240, 200], delta: 10 },
          [price]: { means: [6, 7, 5], delta: 20 },
          [growth]: { means: [-1, -2, 0], delta: -50 },
          [nearZero]: { means: [0.1, 0.1, 0.1], delta: null }
        }),
        result(base, {
          [approvals]: { means: [100, 110, 90], delta: 0 },
          [debt]: { means: [200, 220, 180], delta: 0 },
          [price]: { means: [5, 6, 4], delta: 0 },
          [growth]: { means: [-2, -3, -1], delta: 0 },
          [nearZero]: { means: [0, 0, 0], delta: null }
        }),
        result(low, {
          [approvals]: { means: [90, 110, 100], delta: 0 },
          [debt]: { means: [180, 200, 160], delta: -10 },
          [price]: { means: [4, 5, 3], delta: -20 },
          [growth]: { means: [-3, -4, -2], delta: 50 },
          [nearZero]: { means: [-0.1, -0.1, -0.1], delta: null }
        })
      ]
    }
  };
}

{
  const { detail, results } = fixture();
  const original = JSON.stringify({ detail, results });
  const report = buildSensitivityReport(detail, results, 'post_200');
  assert.deepEqual(report.rows.map((row) => row.point.pointId), ['low', 'base', 'high']);
  assert.deepEqual(report.rows.map((row) => row.setting), ['4%', '4.5%', '5%']);
  assert.equal(report.complete, true);
  assert.equal(report.coverageKnown, true);
  assert.equal(report.successfulSeeds, 9);
  assert.equal(report.expectedSeeds, 9);
  assert.equal(report.windowLabel, 'After first 200 valid observations');
  assert.deepEqual(report.rows[0].metrics[approvals].consistency, { higher: 1, lower: 1, equal: 1, total: 3 });
  assert.deepEqual(report.rows[2].metrics[approvals].consistency, { higher: 3, lower: 0, equal: 0, total: 3 });
  assert.equal(report.baselineRow?.metrics[approvals].consistency, null);
  assert.equal(report.rows[2].metrics[growth].absoluteChange, 1, 'Direction comes from raw change for a negative baseline');
  assert.equal(report.rows[2].metrics[growth].relativeChange, -50, 'Keep the existing signed-denominator percentage');
  assert.ok(Math.abs(report.rows[2].metrics[nearZero].absoluteChange! - 0.1) < 1e-12);
  assert.equal(report.rows[2].metrics[nearZero].relativeChange, null, 'Do not recreate a suppressed percent difference');
  assert.ok(report.unrankedTitles.includes(nearZero));
  assert.deepEqual(report.ranking[0].settings, ['4%', '5%']);
  assert.equal(report.ranking[0].relativeChange, 50, 'Tied changes describe the first sorted setting only');
  assert.equal(report.ranking[0].absoluteChange, -1);
  assert.deepEqual(report.outcomes.map((outcome) => outcome.id), [
    'core_housePriceGrowth', growth, debt, approvals, 'core_advancesToFTB', 'core_advancesToBTL'
  ]);
  assert.deepEqual(report.outcomes.map((outcome) => outcome.measure), ['range', 'range', 'mean', 'mean', 'mean', 'mean']);
  assert.deepEqual(report.outcomes.map((outcome) => outcome.baselineMean), [null, -2, 200, 100, null, null]);
  assert.deepEqual(report.outcomes.map((outcome) => outcome.baselineRange), [null, 5, 5, 5, null, null]);
  assert.equal(report.indicators.length, 15);
  assert.equal(new Set(report.indicators.map((indicator) => indicator.id)).size, 15);
  assert.ok(report.indicators.every((indicator) => indicator.title && indicator.units && indicator.group && indicator.theme));
  assert.match(report.indicators.find((indicator) => indicator.id === 'core_ooLTV')!.title, /Mean Above Median/);
  assert.match(report.indicators.find((indicator) => indicator.id === growth)!.title, /12-month/);
  assert.match(report.indicators.find((indicator) => indicator.id === 'core_housePriceGrowth')!.title, /QoQ/);
  assert.equal(report.indicators.find((indicator) => indicator.id === price)!.baselineMean, 5, 'Matrix retains indicators outside the six plotted outcomes');
  assert.equal(report.indicators.find((indicator) => indicator.id === 'core_ooLTV')!.baselineMean, null, 'Absent matrix indicators have no invented baseline mean');
  assert.equal(JSON.stringify({ detail, results }), original, 'Building a report does not mutate shared payloads');
}

{
  const { detail, results } = fixture();
  detail.status = 'running';
  let report = buildSensitivityReport(detail, results, 'post_200');
  assert.equal(report.complete, false, 'Complete point coverage cannot make a running experiment final');
  assert.ok(report.rows.every((row) => row.complete));
  detail.status = 'failed';
  results.points[0].seedResults = results.points[0].seedResults?.slice(0, 1);
  report = buildSensitivityReport(detail, results, 'post_200');
  const high = report.rows[2];
  assert.equal(high.status, 'partial', 'A persisted succeeded point may have only one finished seed');
  assert.equal(high.metrics[approvals].mean, 110, 'Keep partial raw aggregates visible');
  assert.equal(high.successfulSeeds, 1);
  assert.equal(isReportRowEligible(high), false);
  assert.equal(high.metrics[approvals].consistency, null, 'One pair is insufficient for direction counts');
  assert.equal(report.ranking.find((entry) => entry.id === approvals)?.magnitude, 0, 'An incomplete point cannot dominate the ranking');
  results.points = results.points.filter((point) => point.pointId !== 'high');
  report = buildSensitivityReport(detail, results, 'post_200');
  assert.equal(report.rows.length, 3, 'Unrun intended values must stay in the table');
  assert.equal(report.rows[2].status, 'not run');
  assert.equal(report.rows[2].metrics[approvals].mean, null);
  assert.equal(report.expectedSeeds, 9);
}

{
  const { detail, results } = fixture();
  const high = results.points[0];
  high.seedResults![0].seed = 99;
  let report = buildSensitivityReport(detail, results, 'post_200');
  assert.equal(report.rows[2].complete, false, 'Equal seed counts cannot substitute for intended seed IDs');
  assert.equal(report.rows[2].status, 'partial');
  assert.equal(report.rows[2].successfulSeeds, 2, 'Unexpected seed IDs do not inflate intended success counts');
  assert.equal(report.successfulSeeds, 8);
  assert.equal(report.rows[2].metrics[approvals].consistency?.total, 2, 'Only matched expected seeds contribute');
  high.seedResults![0].seed = 12;
  report = buildSensitivityReport(detail, results, 'post_200');
  assert.equal(report.rows[2].successfulSeeds, 1, 'Ambiguous duplicate IDs do not inflate successful coverage');
  assert.equal(report.rows[2].metrics[approvals].consistency, null);
}

{
  const { detail, results } = fixture();
  results.points[0].seedResults![0].indicatorMetrics.find((entry) => entry.indicatorId === approvals)!.kpi.mean = null;
  const report = buildSensitivityReport(detail, results, 'post_200');
  const high = report.rows[2];
  assert.equal(high.complete, true, 'Execution coverage and finite indicator coverage are separate');
  assert.equal(report.complete, true, 'Complete labels seed coverage, not complete metric availability');
  assert.equal(high.metrics[approvals].contributingSeeds, 2);
  assert.equal(isReportMetricEligible(high, approvals), false);
  assert.equal(isReportMetricEligible(high, debt), true, 'One missing KPI does not discard other complete outcomes');
  assert.equal(report.ranking.find((entry) => entry.id === approvals)?.magnitude, 0);
  assert.equal(high.metrics[approvals].consistency?.total, 2);
}

for (const baselineState of ['partial', 'failed', 'canceled', 'no designation', 'missing KPI'] as const) {
  const { detail, results } = fixture();
  const baseline = results.points[1];
  if (baselineState === 'partial') baseline.seedResults = baseline.seedResults?.slice(0, 2);
  else if (baselineState === 'failed' || baselineState === 'canceled') baseline.status = baselineState;
  else if (baselineState === 'no designation') results.baselinePointId = null;
  else baseline.seedResults![0].indicatorMetrics.find((entry) => entry.indicatorId === approvals)!.kpi.mean = null;
  const report = buildSensitivityReport(detail, results, 'post_200');
  assert.equal(report.outcomes.find((outcome) => outcome.id === approvals)!.baselineMean, null, `${baselineState}: no authoritative baseline reference`);
  for (const row of report.rows) {
    assert.equal(row.metrics[approvals].absoluteChange, null);
    assert.equal(row.metrics[approvals].relativeChange, null);
    assert.equal(row.metrics[approvals].consistency, null, `${baselineState}: never salvage baseline seed comparisons`);
  }
  assert.equal(report.ranking.some((entry) => entry.id === approvals), false);
  assert.equal(report.indicators.find((indicator) => indicator.id === approvals)!.baselineMean, null);
  if (baselineState !== 'missing KPI') {
    assert.ok(report.indicators.every((indicator) => indicator.baselineMean === null), 'All matrix baseline values respect baseline eligibility');
  }
}

{
  const { detail, results } = fixture();
  results.points[0].status = 'failed';
  results.points[0].error = 'seed 13 failed';
  results.points[0].seedResults![2].status = 'failed';
  const report = buildSensitivityReport(detail, results, 'post_200');
  assert.equal(report.rows[2].status, 'failed');
  assert.equal(report.rows[2].result?.error, 'seed 13 failed');
  assert.equal(report.rows[2].successfulSeeds, 2);
  assert.equal(report.rows[2].metrics[approvals].contributingSeeds, 2);
  assert.equal(report.rows[2].metrics[approvals].consistency?.total, 2, 'Failed current seeds are excluded from descriptive pair counts');
  assert.equal(isReportMetricEligible(report.rows[2], approvals), false);
}

{
  const { detail, results } = fixture();
  delete detail.seeds;
  delete detail.seedsPerPoint;
  for (const point of results.points) delete point.seedResults;
  const report = buildSensitivityReport(detail, results, 'tail_120');
  assert.equal(report.complete, false);
  assert.equal(report.coverageKnown, false);
  assert.equal(report.expectedSeeds, null);
  assert.equal(report.windowLabel, 'Last up to 120 observations');
  assert.equal(report.rows[0].successfulSeeds, null);
  assert.equal(report.rows[0].metrics[approvals].contributingSeeds, null);
  assert.equal(report.rows[0].metrics[approvals].consistency, null);
  assert.equal(isReportMetricEligible(report.rows[0], approvals), true, 'Legacy raw means remain available with unknown coverage');
  assert.ok(report.ranking.length > 0);
}

{
  const { detail, results } = fixture();
  delete detail.seeds;
  const report = buildSensitivityReport(detail, results, null);
  assert.equal(report.coverageKnown, true, 'Recorded expected count can verify unique coverage if seed IDs were not retained');
  assert.equal(report.complete, true);
  assert.equal(report.windowLabel, 'Not recorded');
  detail.seeds = [11, 12, 13, 13];
  assert.equal(buildSensitivityReport(detail, results, null).expectedSeeds, 9, 'Expected IDs are unique');
}

{
  const { detail, results } = fixture();
  results.points[0].indicatorMetrics.find((entry) => entry.indicatorId === approvals)!.kpi.mean = null;
  results.points[2].indicatorMetrics.find((entry) => entry.indicatorId === approvals)!.kpi.mean = Number.NaN;
  const report = buildSensitivityReport(detail, results, 'post_200');
  assert.equal(report.rows[2].metrics[approvals].mean, null);
  assert.equal(report.rows[2].metrics[approvals].absoluteChange, null);
  assert.equal(report.rows[2].metrics[approvals].relativeChange, null);
  assert.equal(report.rows[0].metrics[approvals].mean, null);
  assert.equal(isReportMetricEligible(report.rows[2], approvals), false);
  assert.equal(report.ranking.some((entry) => entry.id === approvals), false);
  report.rows[2].metrics[approvals].mean = Number.POSITIVE_INFINITY;
  assert.equal(isReportMetricEligible(report.rows[2], approvals), false);
}

{
  const { detail, results } = fixture();
  for (let index = 0; index < 7; index += 1) {
    const id = `extra_${index}`;
    for (const point of results.points) {
      point.indicatorMetrics.push(metric(id, point.isBaseline ? 1 : 2, point.isBaseline ? 0 : 100 + index));
      for (const seed of point.seedResults!) seed.indicatorMetrics.push(metric(id, point.isBaseline ? 1 : 2, null));
    }
  }
  const report = buildSensitivityReport(detail, results, 'post_200');
  assert.equal(report.ranking.length, 5);
  assert.deepEqual(report.ranking.map((item) => item.magnitude), [106, 105, 104, 103, 102]);
  assert.equal(report.unrankedTitles.includes('Mortgage Approvals'), false, 'Comparable outcomes outside the top five are not unavailable');
}

{
  const { detail, results } = fixture();
  const keys = ['CENTRAL_BANK_LTV_HARD_MAX_FTB', 'CENTRAL_BANK_LTV_HARD_MAX_HM'];
  detail.parameter.parameterKeys = keys;
  detail.parameter.baselineValue = null;
  detail.parameter.baselineValuesByKey = { [keys[0]]: 0.9, [keys[1]]: 0.85 };
  const baseline = detail.sampledPoints.find((point) => point.isBaseline)!;
  baseline.value = null;
  const report = buildSensitivityReport(detail, results, 'post_200');
  assert.equal(report.rows.at(-1)?.point.pointId, 'base');
  assert.match(report.baselineRow!.setting, /first-time buyers 90%/);
  assert.match(report.baselineRow!.setting, /home movers 85%/);
  assert.equal(report.outcomes.find((outcome) => outcome.id === approvals)!.baselineMean, 100, 'A composite baseline remains a horizontal reference without scalar x');
  assert.equal(reportPolicyUnit(detail.parameter), 'percentage');
  assert.equal(formatReportSetting(sample('shared', 0.8), detail.parameter), '80%');
  detail.parameter.parameterKeys = ['CENTRAL_BANK_INITIAL_BASE_RATE', 'CENTRAL_BANK_LTI_SOFT_MAX_FTB'];
  assert.equal(reportPolicyUnit(detail.parameter), null, 'Mixed-unit packages cannot be assigned one unit');
}

{
  const { detail, results } = fixture();
  detail.sampledPoints.find((point) => point.isBaseline)!.value = null;
  results.points = results.points.filter((point) => point.isBaseline);
  let report = buildSensitivityReport(detail, results, 'post_200');
  assert.equal(report.outcomes.find((outcome) => outcome.id === approvals)!.baselineMean, 100);
  assert.ok(report.outcomes.every((outcome) => !outcome.available), 'A composite baseline alone is not a scalar response chart');
  detail.sampledPoints.find((point) => point.isBaseline)!.value = 0.045;
  report = buildSensitivityReport(detail, results, 'post_200');
  assert.ok(report.outcomes.every((outcome) => !outcome.available), 'A scalar baseline alone still has no tested response');
}

{
  const { detail, results } = fixture();
  const selected = results.points[0];
  const current = selected.indicatorMetrics.find((entry) => entry.indicatorId === growth)!;
  current.kpi.mean = 0;
  current.kpi.range = 4;
  current.deltaFromBaseline.mean = null;
  for (const [index, seed] of selected.seedResults!.entries()) {
    seed.indicatorMetrics.find((entry) => entry.indicatorId === growth)!.kpi.range = index + 3;
  }
  let report = buildSensitivityReport(detail, results, 'post_200');
  let high = report.rows[2];
  assert.equal(high.metrics[growth].mean, 0, 'A zero mean remains a valid mean');
  assert.equal(high.metrics[growth].temporalRange, 4, 'Use retained mean temporal P95–P5, not a range of seed means');
  assert.equal(high.metrics[growth].rangeContributingSeeds, 3);
  assert.equal(high.metrics[growth].relativeChange, null);
  assert.equal(isReportMetricEligible(high, growth, 'range'), true, 'Missing relative mean differences do not suppress temporal range');
  assert.equal(report.outcomes.find((outcome) => outcome.id === growth)!.available, true);

  selected.seedResults![0].indicatorMetrics.find((entry) => entry.indicatorId === growth)!.kpi.range = null;
  report = buildSensitivityReport(detail, results, 'post_200');
  high = report.rows[2];
  assert.equal(high.metrics[growth].rangeContributingSeeds, 2);
  assert.equal(isReportMetricEligible(high, growth, 'range'), false, 'Finite range coverage is checked independently');
  assert.equal(isReportMetricEligible(high, growth), true);
  assert.equal(high.metrics[growth].temporalRange, 4, 'A partially covered retained range remains visible in raw values');

  const baseline = results.points[1];
  baseline.seedResults![0].indicatorMetrics.find((entry) => entry.indicatorId === growth)!.kpi.range = null;
  report = buildSensitivityReport(detail, results, 'post_200');
  assert.equal(report.outcomes.find((outcome) => outcome.id === growth)!.baselineRange, null);
  assert.equal(report.outcomes.find((outcome) => outcome.id === growth)!.baselineMean, -2);
  assert.equal(report.rows[0].metrics[growth].relativeChange, 50, 'Range availability does not alter mean differences');
}

{
  const { detail, results } = fixture();
  for (const point of results.points) {
    point.indicatorMetrics.find((entry) => entry.indicatorId === growth)!.kpi.range = null;
  }
  let report = buildSensitivityReport(detail, results, 'post_200');
  assert.equal(report.outcomes.find((outcome) => outcome.id === growth)!.available, false, 'Range plots require range data even if means exist');
  assert.equal(report.rows[0].metrics[growth].temporalRange, null);
  delete detail.seeds;
  delete detail.seedsPerPoint;
  for (const point of results.points) delete point.seedResults;
  report = buildSensitivityReport(detail, results, 'tail_120');
  assert.equal(report.rows[0].metrics[growth].rangeContributingSeeds, null);
  assert.equal(report.outcomes.find((outcome) => outcome.id === growth)!.available, false, 'Mean-only legacy records cannot invent a temporal range');
  assert.equal(isReportMetricEligible(report.rows[0], growth), true);
  report.rows[0].metrics[growth].temporalRange = Number.POSITIVE_INFINITY;
  assert.equal(isReportMetricEligible(report.rows[0], growth, 'range'), false);
}

{
  const { detail, results } = fixture();
  const baseline = results.points[1];
  baseline.indicatorMetrics.find((entry) => entry.indicatorId === growth)!.kpi.mean = null;
  baseline.seedResults![0].indicatorMetrics.find((entry) => entry.indicatorId === growth)!.kpi.mean = null;
  const report = buildSensitivityReport(detail, results, 'post_200');
  const outcome = report.outcomes.find((entry) => entry.id === growth)!;
  assert.equal(outcome.baselineMean, null);
  assert.equal(outcome.baselineRange, 5, 'A valid temporal baseline range does not depend on mean availability');
  assert.equal(report.rows[0].metrics[growth].relativeChange, null);
}

{
  const { detail, results } = fixture();
  let report = buildSensitivityReport(detail, results, 'post_200');
  assert.equal(chooseReportFocusRow(report)?.point.pointId, 'low', 'Default to the lowest eligible tested setting, not the possibly flat high endpoint');
  assert.equal(chooseReportFocusRow(report, 'high')?.point.pointId, 'high');
  assert.equal(chooseReportFocusRow(report, 'unknown')?.point.pointId, 'low');
  results.points.find((point) => point.pointId === 'low')!.seedResults!.pop();
  report = buildSensitivityReport(detail, results, 'post_200');
  assert.equal(chooseReportFocusRow(report)?.point.pointId, 'high', 'Skip incomplete points for the initial selection');
  assert.equal(chooseReportFocusRow(report, 'low')?.status, 'partial', 'Preserve an explicit partial selection without changing its values');
  results.points = results.points.filter((point) => point.isBaseline);
  report = buildSensitivityReport(detail, results, 'post_200');
  assert.equal(chooseReportFocusRow(report)?.point.pointId, 'base');
  const unrun = chooseReportFocusRow(report, 'high');
  assert.equal(unrun?.status, 'not run');
  assert.equal(unrun?.metrics[approvals].mean, null);
  detail.sampledPoints = detail.sampledPoints.filter((point) => !point.isBaseline);
  report = buildSensitivityReport(detail, results, 'post_200');
  assert.equal(chooseReportFocusRow(report)?.point.pointId, 'low', 'If no baseline exists, retain the first intended setting');
  detail.sampledPoints = [];
  report = buildSensitivityReport(detail, results, 'post_200');
  assert.equal(chooseReportFocusRow(report), null);
}

assert.equal(REPORT_OUTCOMES.length, 6);
assert.equal(formatReportValue(12.5, '%'), '12.5%');
assert.equal(formatReportValue(1.5, '%', true), '+1.5 pp');
assert.equal(formatReportValue(-1.5, '%', true), '-1.5 pp');
assert.equal(formatReportValue(0.5, 'ratio', true), '+0.5 ratio');
assert.equal(formatReportValue(100, 'count/month'), '100 count/month');
assert.equal(formatReportValue(null, '%'), 'n/a');
assert.equal(formatReportNumber(Number.NaN), 'n/a');
assert.notEqual(formatReportNumber(0.00000001), '0', 'Small nonzero changes do not look exactly equal');
assert.equal(getReportWindowLabel(null), 'Not recorded');
{
  const { detail, results } = fixture();
  const original = JSON.stringify({ detail, results });
  const compact = buildCompactReportOutcomes(buildSensitivityReport(detail, results, 'post_200'));
  assert.deepEqual(compact.map((outcome) => outcome.id), [approvals, debt, price]);
  assert.equal(compact[0].baselineMean, 100);
  assert.equal(compact[0].largest?.row.point.pointId, 'high');
  assert.equal(compact[0].largest?.change, 10);
  assert.equal(compact[0].relative, true);
  assert.equal(compactReportChange(10, compact[0]), '+10%');
  assert.equal(compact[1].largest?.change, -10, 'Keep the sign of the largest-magnitude response');
  assert.equal(compact[1].ties[0].change, 10, 'Opposite-signed ties must remain distinguishable');
  assert.equal(compact[1].ties[0].row.setting, '5%');
  assert.equal(JSON.stringify({ detail, results }), original, 'Report selection cannot mutate retained results');

  results.points[0].indicatorMetrics.find((metric) => metric.indicatorId === debt)!.deltaFromBaseline.mean = null;
  let raw = buildCompactReportOutcomes(buildSensitivityReport(detail, results, 'post_200'))[1];
  assert.equal(raw.relative, false, 'One unavailable percentage switches the whole outcome to raw units');
  assert.equal(raw.largest?.change, -20);
  assert.equal(compactReportChange(raw.largest!.change, raw), '-20 pp');

  results.points[0].seedResults!.pop();
  const partial = buildCompactReportOutcomes(buildSensitivityReport(detail, results, 'post_200'));
  assert.notEqual(partial[0].largest?.row.point.pointId, 'high', 'Incomplete points cannot supply headline changes');

  results.baselinePointId = null;
  raw = buildCompactReportOutcomes(buildSensitivityReport(detail, results, 'post_200'))[1];
  assert.equal(raw.relative, false);
  assert.equal(raw.baselineMean, null);
  assert.equal(raw.largest, null, 'Do not invent a comparison without the designated baseline');
  assert.equal(raw.available, true, 'Raw outcomes can remain visible without a usable baseline');
}
console.log('Sensitivity report model tests passed.');
