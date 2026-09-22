import assert from 'node:assert/strict';
import * as echarts from 'echarts';
import type {
  SensitivityDeltaTrendSeries,
  SensitivityExperimentParameterSelection,
  SensitivitySamplePoint
} from '../shared/types.js';
import {
  buildDeltaTrendOption,
  buildSensitivityReportMeanOption
} from '../src/lib/sensitivityChartOptions.js';
import type {
  ReportOutcome,
  ReportRow
} from '../src/pages/experiments/view/sensitivity-report/reportModel.js';

type ChartShape = {
  xAxis: { name: string; min: number; max: number; splitNumber: number; axisLabel: { formatter: (value: number) => string } };
  yAxis: { name: string; min: number; max: number; splitNumber: number; nameLocation: string; axisLabel: { formatter: (value: number) => string } };
  tooltip: { confine?: boolean; formatter?: (params: unknown) => string };
  series: Array<{
    connectNulls: boolean;
    smooth: boolean;
    showSymbol: boolean;
    data: Array<[number, number | null]>;
    markLine?: { label: { position: string }; data: Array<{ yAxis: number }> };
    markPoint?: { symbol: string; data: Array<{ coord: [number, number] }> };
  }>;
};

const parameter: SensitivityExperimentParameterSelection = {
  key: 'CENTRAL_BANK_LTV_HARD_MAX_FTB',
  title: 'LTV limit — first-time buyers',
  description: '',
  type: 'number',
  baselineValue: 0.85,
  min: 0.7,
  max: 1,
  sampleCount: 7
};
const outcome: ReportOutcome = {
  id: 'core_rentalYield',
  title: 'Rental yield',
  theme: 'Housing market',
  units: '%',
  baselineMean: 3,
  available: true
};

function row(value: number | null, mean: number | null, overrides: Partial<ReportRow> = {}): ReportRow {
  const point: SensitivitySamplePoint = {
    pointId: `point-${value}`,
    value,
    label: String(value),
    slotLabels: [],
    isBaseline: value === null,
    ...(value === null ? { valuesByKey: { first: 0.8, second: 0.9 } } : {})
  };
  return {
    point,
    result: { ...point, status: 'succeeded', runId: '', outputPath: null, indicatorMetrics: [] },
    setting: value === null ? 'FTB 80%; HM 90%' : `${Number((value * 100).toPrecision(15))}%`,
    status: 'succeeded',
    complete: true,
    successfulSeeds: 3,
    expectedSeeds: 3,
    metrics: {
      [outcome.id]: {
        mean,
        absoluteChange: mean === null ? null : mean - 3,
        relativeChange: null,
        contributingSeeds: 3,
        temporalRange: null,
        rangeContributingSeeds: 3,
        consistency: null
      }
    },
    ...overrides
  };
}

function chart(rows: ReportRow[], currentOutcome = outcome, currentParameter = parameter, focusPointId?: string): ChartShape {
  return buildSensitivityReportMeanOption(currentOutcome, rows, currentParameter, focusPointId) as unknown as ChartShape;
}

const failed = row(0.75, 50, { status: 'failed', complete: false, successfulSeeds: 2 });
if (failed.result) failed.result.status = 'failed';
const partial = row(0.8, 60, { complete: false, successfulSeeds: 1 });
const missingMetric = row(0.85, null, { metrics: {} });
const pending = row(0.9, 70, { result: null, complete: false, successfulSeeds: 0, status: 'not run' });
const partialMetric = row(0.95, 80);
partialMetric.metrics[outcome.id].contributingSeeds = 2;
const points = [row(1, 5), partialMetric, pending, missingMetric, partial, failed, row(0.7, 2)];
const originalOrder = points.map((point) => point.point.value);
const gaps = chart(points);
assert.deepEqual(gaps.series[0].data, [
  [0.7, 2], [0.75, null], [0.8, null], [0.85, null], [0.9, null], [0.95, null], [1, 5]
], 'Failed, incomplete, missing and metric-incomplete tested values remain explicit gaps');
assert.deepEqual(points.map((point) => point.point.value), originalOrder, 'Building charts does not reorder report rows');
assert.equal(gaps.series[0].connectNulls, false);
assert.equal(gaps.series[0].smooth, false);
assert.equal(gaps.series[0].showSymbol, true);
assert.ok(gaps.yAxis.max < 50, 'Unusable partial means do not distort the outcome axis');

const percentage = chart([row(0.8, 2.8), row(0.9, 3.2)]);
assert.deepEqual(percentage.series[0].data, [[0.8, 2.8], [0.9, 3.2]], 'Stored x values and raw outcome means are unchanged');
assert.equal(percentage.xAxis.axisLabel.formatter(0.8), '80%', 'Only policy x tick labels convert stored fractions to percent');
assert.equal(percentage.yAxis.axisLabel.formatter(2.8), '2.8', 'Outcome values already expressed as percent are not multiplied again');
assert.equal(percentage.yAxis.name, 'Mean (%)');
assert.equal(percentage.yAxis.nameLocation, 'end', 'Compact report units occupy the chart top rather than side space');

{
  const low = row(0.8, 2.8);
  const high = row(0.9, 3.2);
  low.metrics[outcome.id].relativeChange = -6;
  high.metrics[outcome.id].relativeChange = 7;
  const response = buildSensitivityReportMeanOption(outcome, [low, high, failed], parameter, high.point.pointId, true) as unknown as ChartShape;
  assert.deepEqual(response.series[0].data, [[0.75, null], [0.8, -6], [0.9, 7]], 'Relative response plots retain backend percentages and failed-point gaps');
  assert.equal(response.series[0].markLine?.data[0].yAxis, 0, 'Relative charts mark zero as the baseline');
  assert.equal(response.yAxis.name, 'Difference from baseline (%)');
  assert.deepEqual(response.series[0].markPoint?.data[0].coord, [0.9, 7]);
  assert.equal(low.metrics[outcome.id].mean, 2.8, 'Plotting percentages must not overwrite raw baseline/point means');
}
assert.equal(percentage.xAxis.splitNumber, 3);
assert.equal(percentage.yAxis.splitNumber, 3);
assert.ok(percentage.xAxis.min < 0.8 && percentage.xAxis.max > 0.9);
const tooltip = percentage.tooltip.formatter?.([{ dataIndex: 0 }]) ?? '';
assert.match(tooltip, /80%/);
assert.match(tooltip, /2\.8\s*%/);
assert.match(tooltip, /3\/3 seeds succeeded/);
assert.match(tooltip, /3 valid seed means/);
assert.equal(percentage.tooltip.confine, true);

const composite = chart([row(null, 3), row(0.8, 4), row(0.9, 5)]);
assert.deepEqual(composite.series[0].data, [[0.8, 4], [0.9, 5]], 'An unequal package baseline has no invented scalar x coordinate');
assert.equal(composite.series[0].markLine?.data[0].yAxis, 3);
assert.equal(composite.series[0].markLine?.label.position, 'insideEndTop', 'Baseline label stays inside the plotting area');
assert.ok(composite.yAxis.min < 3 && composite.yAxis.max > 5, 'The baseline is included in the raw y domain');
const focused = chart(points, outcome, parameter, 'point-1');
assert.equal(focused.series[0].markPoint?.symbol, 'circle');
assert.deepEqual(focused.series[0].markPoint?.data[0].coord, [1, 5], 'Selected setting is marked at its eligible raw value');
for (const focusPointId of ['point-0.75', 'point-0.8', 'point-0.85', 'point-0.9', 'point-0.95', 'missing']) {
  assert.equal(chart(points, outcome, parameter, focusPointId).series[0].markPoint, undefined, 'Unavailable selected values never get a focus marker');
}
assert.equal(chart([row(null, 3), row(0.8, 4)], outcome, parameter, 'point-null').series[0].markPoint, undefined, 'A composite baseline has no invented focus coordinate');

const rangeOutcome: ReportOutcome = { ...outcome, measure: 'range', baselineMean: 100, baselineRange: 0.5 };
const rangeRows = [row(0.8, 100), row(0.85, 110), row(0.9, null)];
rangeRows[0].metrics[outcome.id].temporalRange = 1.2;
rangeRows[1].metrics[outcome.id].temporalRange = 1.8;
rangeRows[1].metrics[outcome.id].rangeContributingSeeds = 2;
rangeRows[2].metrics[outcome.id].temporalRange = 2.4;
const rangeChart = chart(rangeRows, rangeOutcome, parameter, 'point-0.9');
assert.deepEqual(rangeChart.series[0].data, [[0.8, 1.2], [0.85, null], [0.9, 2.4]], 'Temporal range uses its own metric and seed coverage, independently of the mean');
assert.equal(rangeChart.yAxis.name, 'P95–P5 (pp)', 'Temporal dispersion of percentage observations is in percentage points');
assert.equal(rangeChart.series[0].markLine?.data[0].yAxis, 0.5, 'Dispersion uses baseline P95–P5 rather than baseline mean');
assert.deepEqual(rangeChart.series[0].markPoint?.data[0].coord, [0.9, 2.4]);
assert.equal(chart(rangeRows, rangeOutcome, parameter, 'point-0.85').series[0].markPoint, undefined);
assert.match(rangeChart.tooltip.formatter?.([{ dataIndex: 0 }]) ?? '', /P95–P5 1\.2 pp/);
assert.match(rangeChart.tooltip.formatter?.([{ dataIndex: 0 }]) ?? '', /3 valid seed P95–P5 measures/);
assert.equal(chart(rangeRows, { ...rangeOutcome, baselineRange: 0 }).series[0].markLine?.data[0].yAxis, 0);
assert.equal(chart(rangeRows, { ...rangeOutcome, baselineRange: null }).series[0].markLine, undefined, 'A missing baseline range does not fall back to the mean');

for (const baselineMean of [0, -2]) {
  const option = chart([row(0.8, 4)], { ...outcome, baselineMean });
  assert.equal(option.series[0].markLine?.data[0].yAxis, baselineMean, 'Zero and negative raw baselines remain visible');
  assert.ok(option.yAxis.min < baselineMean && option.yAxis.max > 4);
}
for (const baselineMean of [null, Number.NaN]) {
  assert.equal(chart([row(0.8, 4)], { ...outcome, baselineMean }).series[0].markLine, undefined, 'Unavailable baselines do not create a reference line');
}
assert.equal(chart([row(0.8, Number.NaN)]).series[0].data[0][1], null, 'Nonfinite means remain missing');

const legacy = row(0.8, 2.8, { complete: false, successfulSeeds: null, expectedSeeds: null });
legacy.metrics[outcome.id].contributingSeeds = null;
const legacyChart = chart([legacy]);
assert.deepEqual(legacyChart.series[0].data, [[0.8, 2.8]], 'Legacy succeeded means can be plotted without claiming verified seed coverage');
assert.match(legacyChart.tooltip.formatter?.([{ dataIndex: 0 }]) ?? '', /Seed coverage unavailable/);

const malicious = row(0.8, 2.8, { setting: '<img src=x onerror=alert(1)><script>bad</script>' });
const safeTooltip = chart([malicious], { ...outcome, title: '<b>Rental yield</b>' }).tooltip.formatter?.([{ dataIndex: 0 }]) ?? '';
assert.equal(safeTooltip.includes('<img'), false);
assert.equal(safeTooltip.includes('<script'), false);
assert.equal(safeTooltip.includes('<b>Rental'), false);
assert.match(safeTooltip, /&lt;img/);

const linkedParameter = { ...parameter, key: 'package', parameterKeys: ['CENTRAL_BANK_LTV_HARD_MAX_HM'] };
assert.equal(chart([row(0.8, 4)], outcome, linkedParameter).xAxis.axisLabel.formatter(0.8), '80%');
const multipleParameter = { ...parameter, key: 'CENTRAL_BANK_LTI_SOFT_MAX_FTB', parameterKeys: undefined };
assert.equal(chart([row(4.5, 4)], outcome, multipleParameter).xAxis.axisLabel.formatter(4.5), '4.5×');

const deltaSeries: SensitivityDeltaTrendSeries = {
  indicatorId: outcome.id,
  title: outcome.title,
  units: '%',
  points: [{ parameterValue: 0.8, deltaByKpi: { mean: 10, cv: null, range: null, annualisedTrend: null } }]
};
const legacyDetailed = buildDeltaTrendOption(deltaSeries, parameter.title, 'mean') as unknown as ChartShape;
assert.equal(legacyDetailed.xAxis.axisLabel.formatter(0.8), '0.8', 'Three-argument Detailed chart calls retain their existing display');
const formattedDetailed = buildDeltaTrendOption(deltaSeries, parameter.title, 'mean', 'percentage') as unknown as ChartShape;
assert.equal(formattedDetailed.xAxis.axisLabel.formatter(0.8), '80%');
assert.deepEqual(formattedDetailed.series[0].data, [[0.8, 10]]);
assert.match(formattedDetailed.tooltip.formatter?.([{ value: [0.8, 10] }]) ?? '', /80%<br\/>Mean \(monthly\) 10%/);

const renderedChart = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: 320, height: 160 });
try {
  renderedChart.setOption(buildSensitivityReportMeanOption(outcome, [row(null, 3), row(0.8, 4), row(0.9, 5)], parameter, 'point-0.9'));
  const svg = renderedChart.renderToSVGString();
  assert.match(svg, />Baseline<\//, 'The report baseline renders at compact card dimensions');
  assert.match(svg, />Mean \(%\)<\//);
  assert.match(svg, />\d+(?:\.\d+)?%<\//, 'The actual chart renderer uses policy percentage tick labels');
  assert.match(svg, /fill="#155d61"/, 'The selected setting dot renders in the compact chart');
  assert.equal(svg.includes('NaN'), false, 'Composite baseline coordinates remain finite in the rendered chart');
  renderedChart.setOption(buildSensitivityReportMeanOption(rangeOutcome, rangeRows, parameter, 'point-0.9'), true);
  const rangeSvg = renderedChart.renderToSVGString();
  assert.match(rangeSvg, />P95–P5 \(pp\)<\//, 'Temporal range units render at compact dimensions');
  assert.match(rangeSvg, />Baseline<\//);
  assert.match(rangeSvg, /fill="#155d61"/);
  assert.equal(rangeSvg.includes('NaN'), false);
} finally {
  renderedChart.dispose();
}

console.log('Sensitivity report chart checks passed.');
