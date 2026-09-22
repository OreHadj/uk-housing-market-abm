import assert from 'node:assert/strict';
import * as echarts from 'echarts';
import type {
  SensitivityExperimentMetadata,
  SensitivityExperimentResultsPayload,
  SensitivityIndicatorPointMetric,
  SensitivityPointResult,
  SensitivitySamplePoint
} from '../shared/types.js';
import { buildSensitivityReport2 } from '../src/pages/sensitivity-report2/sensitivityReport2Model.js';
import {
  buildSensitivityReport2Comparison,
  buildSensitivityReport2Response,
  sensitivityReport2ClickedPointId
} from '../src/pages/sensitivity-report2/sensitivityReport2Charts.js';

const approvals = 'core_mortgageApprovals';
const borrowers = ['core_advancesToFTB', 'core_advancesToHM', 'core_advancesToBTL'];
const cycles = ['core_housePriceGrowth', 'core_creditGrowth'];

function metric(indicatorId: string, value: number | null): SensitivityIndicatorPointMetric {
  return {
    indicatorId, title: indicatorId, units: cycles.includes(indicatorId) ? '%' : 'count/month',
    kpi: { mean: value, cv: null, annualisedTrend: null, range: value === null ? null : value / 10 },
    deltaFromBaseline: { mean: 0, cv: null, annualisedTrend: null, range: 0 }
  };
}

function fixture() {
  const points: SensitivitySamplePoint[] = [0.7, 0.75, 0.8, 0.9, 1].map((value, index) => ({
    pointId: `p${index}`, value, label: String(value), slotLabels: [], isBaseline: value === 0.8
  }));
  const results: SensitivityExperimentResultsPayload = {
    experimentId: 'chart-test', baselinePointId: 'p2',
    points: points.map((point, index): SensitivityPointResult => {
      const indicatorMetrics = [approvals, ...borrowers, ...cycles].map((id) => metric(id, (index + 1) * 10));
      return {
        ...point, status: 'succeeded', runId: point.pointId, outputPath: null, indicatorMetrics,
        seedResults: [1, 2].map((seed) => ({ seed, status: 'succeeded', runId: `${point.pointId}-${seed}`, outputPath: null, indicatorMetrics }))
      };
    })
  };
  const detail: SensitivityExperimentMetadata = {
    experimentId: 'chart-test', baseline: 'v5o3', status: 'succeeded', createdAt: '2026-09-21',
    parameter: { key: 'CENTRAL_BANK_LTV_HARD_MAX_FTB', title: 'LTV limit', description: '', type: 'number', baselineValue: 0.8, min: 0.7, max: 1, sampleCount: 5 },
    sampledPoints: points, seeds: [1, 2], seedsPerPoint: 2,
    warnings: [], warningSummary: { byPoint: {} }, collapsedSlots: {}, runCommand: { commandTemplate: '' }
  };
  return { detail, results };
}

type Shape = {
  xAxis: { type: string; name: string; min: number; max: number; axisLabel: { formatter: (value: number) => string; customValues?: number[] } };
  yAxis: { name: string; min: number; max: number; axisLabel: { showMinLabel?: boolean; showMaxLabel?: boolean } };
  tooltip: { renderMode: string; confine: boolean; formatter: (params: unknown) => string };
  series: Array<{
    type: string; data: Array<{ value: [number, number | null]; pointId: string; symbolSize: number } | number | null>;
    smooth?: boolean; connectNulls?: boolean; showSymbol?: boolean; symbol?: string;
    markLine?: { data: Array<{ yAxis: number }>; label: { formatter: string } };
  }>;
};
function shape(option: ReturnType<typeof buildSensitivityReport2Response>): Shape {
  assert.ok(option);
  return option as unknown as Shape;
}
function points(option: Shape, index = 0) {
  return option.series[index].data as Array<{ value: [number, number | null]; pointId: string; symbolSize: number }>;
}

{
  const { detail, results } = fixture();
  results.points[1].status = 'failed';
  results.points[1].indicatorMetrics[0].kpi.mean = 10000;
  results.points[3].seedResults = results.points[3].seedResults?.slice(0, 1);
  const model = buildSensitivityReport2(detail, results, 'post_200');
  const original = JSON.stringify(model);
  const option = shape(buildSensitivityReport2Response(model, approvals, 'p4'));
  assert.equal(option.xAxis.type, 'value');
  assert.deepEqual(points(option).map((datum) => datum.value), [[70, 10], [75, null], [80, 30], [90, null], [100, 50]], 'Actual unequal policy spacing is retained and failed/incomplete points break the line');
  assert.equal(option.series[0].smooth, false);
  assert.equal(option.series[0].connectNulls, false);
  assert.equal(option.series[0].showSymbol, true);
  assert.equal(option.series[1].type, 'scatter');
  assert.equal(option.series[1].symbol, 'diamond');
  assert.deepEqual(points(option, 1).map((datum) => datum.value), [[90, 40]], 'Partial aggregates remain visibly qualified, separate from the complete line');
  assert.ok(option.yAxis.max < 100, 'Failed stale aggregate cannot distort the scale');
  assert.equal(option.xAxis.axisLabel.formatter(80), '80', 'Fraction-to-percentage conversion is applied exactly once by the model');
  assert.deepEqual(option.xAxis.axisLabel.customValues, [70, 75, 80, 90, 100], 'Axis labels mark the tested settings, not the padded bounds');
  assert.equal(option.yAxis.axisLabel.showMinLabel, false, 'Padded outcome bounds are not labelled as data');
  assert.equal(option.yAxis.axisLabel.showMaxLabel, false);
  assert.ok(points(option)[4].symbolSize > points(option)[0].symbolSize);
  assert.equal(sensitivityReport2ClickedPointId({ data: points(option)[4] }), 'p4');
  assert.equal(sensitivityReport2ClickedPointId({ data: points(option, 1)[0] }), 'p3');
  assert.equal(sensitivityReport2ClickedPointId({ componentType: 'xAxis' }), null);
  assert.equal(sensitivityReport2ClickedPointId(null), null);
  assert.equal(sensitivityReport2ClickedPointId({ data: { pointId: 4 } }), null);
  assert.match(option.tooltip.formatter([{ data: points(option, 1)[0] }]), /Partial.*1\/2 successful seeds/);
  assert.equal(option.tooltip.renderMode, 'richText');
  assert.equal(option.tooltip.confine, true);
  assert.equal(JSON.stringify(model), original, 'Chart builders do not mutate report state');
}

{
  const { detail, results } = fixture();
  results.points = results.points.filter((point) => point.pointId !== 'p1');
  delete results.points[2].seedResults;
  const model = buildSensitivityReport2(detail, results, 'post_200');
  const option = shape(buildSensitivityReport2Response(model, approvals, 'p3'));
  assert.deepEqual(points(option).map((datum) => datum.value), [[70, 10], [75, null], [80, 30], [90, null], [100, 50]], 'Absent results and legacy seed coverage are explicit gaps');
  assert.match(option.tooltip.formatter([{ data: points(option, 1)[0] }]), /Legacy coverage/);
}

{
  const { detail, results } = fixture();
  detail.sampledPoints[2].value = null;
  detail.sampledPoints[2].valuesByKey = { CENTRAL_BANK_LTV_HARD_MAX_FTB: 0.8, CENTRAL_BANK_LTV_HARD_MAX_HM: 0.9 };
  results.points[2].value = null;
  const model = buildSensitivityReport2(detail, results, 'post_200');
  const option = shape(buildSensitivityReport2Response(model, approvals, 'p4'));
  assert.deepEqual(points(option).map((datum) => datum.value[0]), [70, 75, 90, 100], 'Unequal linked baseline has no invented x-coordinate');
  assert.equal(option.series[0].markLine?.data[0].yAxis, 30, 'The package baseline is an outcome reference only');
  assert.ok(option.xAxis.min > 0);
  const renderer = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: 320, height: 260 });
  try {
    const responseOption = buildSensitivityReport2Response(model, approvals, 'p4');
    assert.ok(responseOption);
    renderer.setOption(responseOption);
    const svg = renderer.renderToSVGString();
    assert.match(svg, />Baseline<\//);
    assert.equal(svg.includes('NaN'), false);
    const cycleOption = buildSensitivityReport2Comparison(model, 'cycles', 'p4');
    assert.ok(cycleOption);
    renderer.resize({ width: 320, height: 130 });
    renderer.setOption(cycleOption, true);
    const cyclesSvg = renderer.renderToSVGString();
    assert.match(cyclesSvg, /Temporal P95–P5 \(pp\)/);
    assert.match(cyclesSvg, /quarter-on-quarter/);
    assert.match(cyclesSvg, /House-price growth/);
    assert.match(cyclesSvg, /Credit growth/);
    assert.match(cyclesSvg, /12-month/);
    assert.equal(cyclesSvg.includes('NaN'), false);
  } finally { renderer.dispose(); }
}

{
  const { detail, results } = fixture();
  results.points[4].indicatorMetrics.find((item) => item.indicatorId === borrowers[1])!.kpi.mean = null;
  const model = buildSensitivityReport2(detail, results, 'post_200');
  const comparison = shape(buildSensitivityReport2Comparison(model, 'borrowers', 'p4'));
  assert.deepEqual(comparison.series[0].data, [50, null, 50], 'Missing borrower activity never becomes zero');
  assert.deepEqual(comparison.series[1].data, [30, 30, 30]);
  assert.match(comparison.tooltip.formatter([{ dataIndex: 1 }]), /Selected setting Not available/);
  const growth = shape(buildSensitivityReport2Response(model, 'core_housePriceGrowth:range', 'p4'));
  assert.equal(growth.yAxis.name, 'Temporal P95–P5 (pp)', 'Temporal growth range is measured in percentage points, not percentages or confidence intervals');
  assert.equal(points(growth)[4].value[1], 5);
  assert.equal(buildSensitivityReport2Response(model, 'unknown-outcome', 'p4'), null);
}

{
  const { detail, results } = fixture();
  results.baselinePointId = 'nonexistent';
  const model = buildSensitivityReport2(detail, results, 'post_200');
  const option = shape(buildSensitivityReport2Response(model, approvals, 'p4'));
  assert.equal(option.series[0].markLine, undefined, 'Unconfirmed baseline metadata cannot create a comparison reference');
  const comparison = shape(buildSensitivityReport2Comparison(model, 'borrowers', 'p4'));
  assert.deepEqual(comparison.series[1].data, [null, null, null]);
}

{
  const { detail, results } = fixture();
  results.points.forEach((point) => { point.status = 'canceled'; });
  const model = buildSensitivityReport2(detail, results, 'post_200');
  assert.equal(buildSensitivityReport2Response(model, approvals, 'p4'), null);
  assert.equal(buildSensitivityReport2Comparison(model, 'borrowers', 'p4'), null);
}

console.log('Sensitivity Report2 chart checks passed.');
