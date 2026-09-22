import type { BarSeriesOption, EChartsOption, LineSeriesOption } from 'echarts';
import type {
  LendingDistributionPayload,
  ResultsCompareIndicator,
  ResultsComparePayload
} from '../../../shared/types';
import { getReport2TailShare } from './report2Model';

export const REPORT2_COLORS = {
  policy: '#4568e8',
  comparison: '#20ae9c'
} as const;

const INK = '#25314b';
const MUTED = '#78839a';
const GRID = '#edf0f6';
const FONT = '"Space Grotesk", "Avenir Next", "Trebuchet MS", sans-serif';

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compact(value: number): string {
  return value.toLocaleString('en-GB', { notation: 'compact', maximumFractionDigits: 1 });
}

function formatValue(value: unknown, units: string): string {
  const number = finite(value);
  if (number === null) return 'Unavailable';
  const formatted = number.toLocaleString('en-GB', { maximumFractionDigits: units === 'ratio' || units === 'index' ? 3 : 2 });
  if (units === '%') return `${formatted}%`;
  if (units === 'ratio') return `${formatted}×`;
  if (units === 'GBP' || units === '£') return `£${formatted}`;
  return `${formatted}${units ? ` ${units}` : ''}`;
}

function baseOption(): EChartsOption {
  return {
    animation: false,
    backgroundColor: 'transparent',
    color: [REPORT2_COLORS.policy, REPORT2_COLORS.comparison],
    textStyle: { fontFamily: FONT, color: INK, fontSize: 14 },
    aria: { enabled: true },
    legend: {
      show: false,
      top: 0,
      right: 0,
      itemWidth: 14,
      itemHeight: 8,
      itemGap: 16,
      textStyle: { color: MUTED, fontSize: 13 },
      selectedMode: false
    }
  };
}

/** Recorded model-month coordinates; null observations remain gaps in the line. */
export function buildReport2Trend(
  indicator: ResultsCompareIndicator | undefined,
  primaryId: string,
  comparisonId: string
): EChartsOption | null {
  if (!indicator) return null;

  const series: LineSeriesOption[] = [
    { id: primaryId, name: 'Selected run', color: REPORT2_COLORS.policy, comparison: false },
    { id: comparisonId, name: 'Baseline', color: REPORT2_COLORS.comparison, comparison: true }
  ].filter((run) => run.id && (!run.comparison || run.id !== primaryId)).map((run) => ({
    id: run.id,
    type: 'line',
    name: run.name,
    dimensions: ['Model month', 'Value'],
    encode: { x: 0, y: 1, tooltip: [1] },
    data: (indicator.seriesByRun.find((entry) => entry.runId === run.id)?.points ?? [])
      .filter((point) => Number.isFinite(point.modelTime))
      .map((point) => [point.modelTime, finite(point.value)]),
    smooth: false,
    connectNulls: false,
    showSymbol: false,
    symbolSize: 5,
    lineStyle: { color: run.color, width: 2, type: run.comparison ? 'dashed' : 'solid', cap: 'round', join: 'round' },
    areaStyle: run.comparison ? undefined : { color: 'rgba(69,104,232,0.07)' },
    itemStyle: { color: run.color },
    legendHoverLink: false,
    emphasis: { disabled: true }
  }));
  // Use both runs even when one is hidden, so toggling lines cannot move either axis.
  let minTime = Infinity;
  let maxTime = -Infinity;
  let minValue = Infinity;
  let maxValue = -Infinity;
  for (const run of indicator.seriesByRun) {
    if (run.runId !== primaryId && (!comparisonId || run.runId !== comparisonId)) continue;
    for (const point of run.points) {
      if (!Number.isFinite(point.modelTime)) continue;
      minTime = Math.min(minTime, point.modelTime);
      maxTime = Math.max(maxTime, point.modelTime);
      const value = finite(point.value);
      if (value === null) continue;
      minValue = Math.min(minValue, value);
      maxValue = Math.max(maxValue, value);
    }
  }
  if (!Number.isFinite(minValue)) return null;
  const valuePadding = (maxValue - minValue || Math.abs(maxValue) || 1) * 0.05;

  const units = indicator.indicator.units;
  const axisUnits: Record<string, string> = {
    'count/month': 'UK-scaled count',
    ratio: 'Ratio (×)',
    index: 'Index',
    '%': '%',
    GBP: '£',
    'GBP/month': '£ / month'
  };
  return {
    ...baseOption(),
    legend: { show: false, selectedMode: 'multiple' },
    // Reserve the label space explicitly: automatic containment shifts the plot whenever
    // the selected market indicator changes the width of the compact value labels.
    grid: { left: 66, right: 30, top: 32, bottom: 62, containLabel: false },
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      backgroundColor: '#fff',
      borderColor: GRID,
      textStyle: { fontFamily: FONT, color: INK, fontSize: 14 },
      valueFormatter: (value) => formatValue(value, units),
      axisPointer: { type: 'line', animation: false, lineStyle: { color: '#c4cde0', type: 'dashed' } }
    },
    xAxis: {
      type: 'value',
      name: 'Model month',
      nameLocation: 'middle',
      nameGap: 30,
      nameTextStyle: { color: MUTED, fontSize: 13 },
      min: minTime === maxTime ? minTime - 1 : minTime,
      max: minTime === maxTime ? maxTime + 1 : maxTime,
      minInterval: 1,
      splitNumber: 3,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        color: MUTED, fontSize: 13, hideOverlap: true, showMinLabel: true, showMaxLabel: true,
        formatter: (value: number) => value.toLocaleString('en-GB')
      },
      axisPointer: { label: { formatter: ({ value }) => `Model month ${Number(value).toLocaleString('en-GB')}` } }
    },
    yAxis: {
      type: 'value',
      name: axisUnits[units] ?? units,
      nameLocation: 'end',
      nameGap: 15,
      nameTextStyle: { color: MUTED, fontSize: 13, align: 'left' },
      scale: true,
      min: minValue - valuePadding,
      max: maxValue + valuePadding,
      splitNumber: 3,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: GRID, type: 'dashed' } },
      axisLabel: { color: MUTED, fontSize: 13, formatter: compact }
    },
    series
  };
}

function comparisonBars(primary: Array<number | null>, comparison: Array<number | null>, includeComparison: boolean): BarSeriesOption[] {
  const series: BarSeriesOption[] = [{
    name: 'Selected run',
    type: 'bar',
    data: primary,
    barMaxWidth: 12,
    barGap: '45%',
    itemStyle: { color: REPORT2_COLORS.policy, borderRadius: [0, 3, 3, 0] }
  }];
  if (includeComparison) series.push({
    name: 'Baseline',
    type: 'bar',
    data: comparison,
    barMaxWidth: 12,
    itemStyle: { color: REPORT2_COLORS.comparison, borderRadius: [0, 3, 3, 0] }
  });
  return series;
}

/** Uses the server's UK-scaled monthly means, including any missing borrower groups. */
export function buildReport2Borrowers(
  payload: ResultsComparePayload | null,
  primaryId: string,
  comparisonId: string
): EChartsOption | null {
  if (!payload) return null;
  const indicatorIds = ['core_advancesToFTB', 'core_advancesToHM', 'core_advancesToBTL'];
  const values = (runId: string) => indicatorIds.map((id) => finite(payload.kpiSummaryByRun
    .find((run) => run.runId === runId)?.kpiSummary.find((kpi) => kpi.indicatorId === id)?.mean));
  const primary = values(primaryId);
  const comparison = comparisonId && comparisonId !== primaryId ? values(comparisonId) : [];
  if (![...primary, ...comparison].some((value) => value !== null)) return null;

  return {
    ...baseOption(),
    grid: { left: 10, right: 12, top: 16, bottom: 41, containLabel: true },
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      textStyle: { fontFamily: FONT, color: INK, fontSize: 14 },
      axisPointer: { type: 'shadow', shadowStyle: { color: '#f4f6fb' } },
      valueFormatter: (value) => formatValue(value, 'UK mortgages / month')
    },
    xAxis: {
      type: 'value',
      name: 'UK mortgages / month',
      nameLocation: 'middle',
      nameGap: 30,
      nameTextStyle: { color: MUTED, fontSize: 13 },
      min: 0,
      splitNumber: 3,
      splitLine: { lineStyle: { color: GRID, type: 'dashed' } },
      axisLabel: { color: MUTED, fontSize: 13, formatter: compact, hideOverlap: true },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: ['First-time buyers', 'Home movers', 'Buy-to-let'],
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: INK, fontSize: 13, margin: 14 }
    },
    series: comparisonBars(primary, comparison, comparison.length > 0)
  };
}

/** Tail shares retain their borrower-type denominator and use a fixed percentage scale. */
export function buildReport2Risk(
  primary: LendingDistributionPayload | null,
  comparison: LendingDistributionPayload | null,
  metric: 'ltv' | 'lti'
): EChartsOption | null {
  const types = ['FTB', 'HM'] as const;
  const primaryValues = types.map((type) => getReport2TailShare(primary, metric, type));
  const comparisonValues = types.map((type) => getReport2TailShare(comparison, metric, type));
  if (![...primaryValues, ...comparisonValues].some((value) => value !== null)) return null;

  return {
    ...baseOption(),
    grid: { left: 10, right: 16, top: 16, bottom: 39, containLabel: true },
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      textStyle: { fontFamily: FONT, color: INK, fontSize: 14 },
      axisPointer: { type: 'shadow', shadowStyle: { color: '#f4f6fb' } },
      valueFormatter: (value) => formatValue(value, '%')
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: 100,
      interval: 25,
      name: 'Share of new lending (%)',
      nameLocation: 'middle',
      nameGap: 29,
      nameTextStyle: { color: MUTED, fontSize: 13 },
      splitLine: { lineStyle: { color: GRID, type: 'dashed' } },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: MUTED, fontSize: 13, formatter: '{value}%', hideOverlap: true }
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: ['First-time buyers', 'Home movers'],
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: INK, fontSize: 13, margin: 14 }
    },
    series: comparisonBars(primaryValues, comparisonValues, comparison !== null)
  };
}

/** Inputs are household shares in percent, with the unclassified remainder labelled explicitly. */
export function buildReport2Tenure(ownership: number | null, privateRenting: number | null): EChartsOption | null {
  if (finite(ownership) === null || finite(privateRenting) === null || ownership === null || privateRenting === null
    || ownership < 0 || privateRenting < 0 || ownership > 100 || privateRenting > 100
    || ownership + privateRenting > 100) return null;

  return {
    ...baseOption(),
    legend: { show: false },
    tooltip: {
      trigger: 'item',
      renderMode: 'richText',
      confine: true,
      textStyle: { fontFamily: FONT, color: INK, fontSize: 14 },
      valueFormatter: (value) => formatValue(value, '%')
    },
    series: [{
      type: 'pie',
      name: 'Household tenure',
      radius: ['70%', '89%'],
      center: ['50%', '50%'],
      startAngle: 90,
      clockwise: true,
      avoidLabelOverlap: true,
      label: { show: false },
      labelLine: { show: false },
      itemStyle: { borderColor: '#fff', borderWidth: 3, borderRadius: 3 },
      emphasis: { scale: false },
      data: [
        { name: 'Ownership', value: ownership, itemStyle: { color: REPORT2_COLORS.policy } },
        { name: 'Private renting', value: privateRenting, itemStyle: { color: REPORT2_COLORS.comparison } },
        { name: 'Other households', value: 100 - ownership - privateRenting, itemStyle: { color: '#e6ebf5' } }
      ]
    }]
  };
}
