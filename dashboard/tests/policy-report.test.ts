import assert from 'node:assert/strict';
import type { LineSeriesOption } from 'echarts';
import type { ResultsCompareIndicator } from '../shared/types';
import {
  buildPolicyReportChartOption,
  getPolicyReportCoverage,
  POLICY_REPORT_INDICATORS
} from '../src/lib/policyReport';

// Coverage counts actual observed months: gaps, absent values and invalid timestamps do not count.
assert.equal(getPolicyReportCoverage([]), null);
assert.equal(getPolicyReportCoverage([
  { modelTime: 500, value: null },
  { modelTime: 501, value: Number.NaN },
  { modelTime: 502, value: Number.POSITIVE_INFINITY },
  { modelTime: Number.NaN, value: 10 }
]), null);
assert.deepEqual(getPolicyReportCoverage([
  { modelTime: 507, value: 25 },
  { modelTime: 499, value: null },
  { modelTime: 500, value: 0 },
  { modelTime: 501, value: null },
  { modelTime: 503, value: -5 },
  { modelTime: 503, value: -5 },
  { modelTime: 600, value: Number.NaN },
  { modelTime: Number.POSITIVE_INFINITY, value: 1 }
]), { startMonth: 500, endMonth: 507, observedMonths: 3 });

const payload: ResultsCompareIndicator = {
  indicator: {
    id: 'core_debtToIncome',
    title: 'Debt to income',
    units: '%',
    description: 'Whole-sector debt to income',
    source: 'core_indicator',
    scaling: 'none'
  },
  seriesByRun: [
    { runId: 'policy', points: [
      { modelTime: 500, value: 20 },
      { modelTime: 501, value: null },
      { modelTime: 502, value: 40 },
      { modelTime: 503, value: null }
    ] },
    { runId: 'baseline', points: [
      { modelTime: 500, value: 0 },
      { modelTime: 501, value: 10 },
      { modelTime: 502, value: 20 },
      { modelTime: 503, value: 30 }
    ] }
  ]
};
const inputBefore = structuredClone(payload);
const option = buildPolicyReportChartOption(payload, 'policy', 'baseline');
const series = option.series as LineSeriesOption[];
assert.equal(series.length, 2, 'Only observed trajectories are plotted; there are no synthetic uncertainty bands');
assert.deepEqual(series[0].data, [20, null, 40, null], 'The plot retains recorded values and gaps');
assert.equal(series[0].connectNulls, false);
assert.equal(series[0].smooth, false);
assert.equal(series[0].lineStyle?.type, 'solid');
assert.equal(series[1].lineStyle?.type, 'dashed', 'Run roles remain distinguishable without relying on colour');
assert.deepEqual(series[0].markLine?.data, [{ yAxis: 30 }], 'Mean excludes absent months');
assert.deepEqual(series[1].markLine?.data, [{ yAxis: 15 }], 'Each mean uses its own run’s observed months');
assert.deepEqual(payload, inputBefore, 'Building a report must not alter the shared Results payload');

// Swapping the run roles changes styling, without accidentally associating means with array order.
const reversed = buildPolicyReportChartOption(payload, 'baseline', 'policy').series as LineSeriesOption[];
assert.equal(reversed[0].lineStyle?.type, 'dashed');
assert.equal(reversed[1].lineStyle?.type, 'solid');
assert.deepEqual(reversed[0].markLine?.data, [{ yAxis: 30 }]);

const emptyPayload: ResultsCompareIndicator = {
  ...payload,
  seriesByRun: [{ runId: 'policy', points: [{ modelTime: 500, value: null }] }]
};
const emptySeries = buildPolicyReportChartOption(emptyPayload, 'policy', '').series as LineSeriesOption[];
assert.equal(emptySeries.length, 1);
assert.equal(emptySeries[0].markLine, undefined, 'An unavailable metric must not acquire a zero-valued mean');

// The small-card month axis remains useful for both a short window and a paper-length run.
const shortAxis = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis;
const shortInterval = (shortAxis?.axisLabel as { interval: (index: number) => boolean }).interval;
assert.equal(shortInterval(0), true);
assert.equal(shortInterval(3), true);
const longPayload: ResultsCompareIndicator = {
  ...payload,
  seriesByRun: [{ runId: 'policy', points: Array.from({ length: 9_501 }, (_, index) => ({
    modelTime: index + 500,
    value: index % 2 === 0 ? 10 : 20
  })) }]
};
const longOption = buildPolicyReportChartOption(longPayload, 'policy', '');
const longAxis = Array.isArray(longOption.xAxis) ? longOption.xAxis[0] : longOption.xAxis;
const longInterval = (longAxis?.axisLabel as { interval: (index: number) => boolean }).interval;
assert.equal(longInterval(0), true);
assert.equal(longInterval(9_500), true);
assert.equal(longPayload.seriesByRun[0].points.filter((_point, index) => longInterval(index)).length, 4);

// The report must use compatible KPI units; particularly, debt/income is a percentage, not a ratio.
assert.deepEqual(POLICY_REPORT_INDICATORS.map(({ id, units }) => [id, units]), [
  ['core_mortgageApprovals', 'count/month'],
  ['output_saleHPI', 'index'],
  ['core_priceToIncome', 'ratio'],
  ['core_debtToIncome', '%']
]);

console.log('Policy report tests passed.');
