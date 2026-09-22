import type { EChartsOption, LineSeriesOption } from 'echarts';
import type { ResultsCompareIndicator, ResultsCompareSeries } from '../../shared/types';
import { buildManualOverlayOption, COMPARISON_RUN_LABEL } from './manualOverlayChartOption';

export const POLICY_REPORT_INDICATORS = [
  {
    id: 'core_mortgageApprovals',
    title: 'Mortgage approvals',
    units: 'count/month',
    description: 'House-purchase approvals per month at UK scale. Recorded values already use the model’s rolling average.'
  },
  {
    id: 'output_saleHPI',
    title: 'Sale house price index',
    units: 'index',
    description: 'Sale prices relative to the model’s initial calibration, where the index starts at 1. This is not a calendar-year base.'
  },
  {
    id: 'core_priceToIncome',
    title: 'Price to income',
    units: 'ratio',
    description: 'The house price index times the initial mean price, divided by mean annualised net total income across all households.'
  },
  {
    id: 'core_debtToIncome',
    title: 'Mortgage debt to income',
    units: '%',
    description: 'Total owner-occupier and buy-to-let mortgage debt as a percentage of annualised net total income across all households.'
  }
] as const;

/** Actual finite observations, not the configured horizon or the interval between endpoints. */
export function getPolicyReportCoverage(
  points: ResultsCompareSeries['points']
): { startMonth: number; endMonth: number; observedMonths: number } | null {
  const months = new Set<number>();
  let startMonth = Number.POSITIVE_INFINITY;
  let endMonth = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!Number.isFinite(point.modelTime) || point.value === null || !Number.isFinite(point.value)) {
      continue;
    }
    months.add(point.modelTime);
    startMonth = Math.min(startMonth, point.modelTime);
    endMonth = Math.max(endMonth, point.modelTime);
  }
  return months.size > 0 ? { startMonth, endMonth, observedMonths: months.size } : null;
}

/**
 * The caller supplies aligned, unsmoothed monthly series from the compare endpoint. Keeping that
 * input unchanged makes the dotted temporal means agree with the report's server-computed KPIs.
 * No interpolation or seed-uncertainty bands are introduced here.
 */
export function buildPolicyReportChartOption(
  indicatorPayload: ResultsCompareIndicator,
  primaryId: string,
  comparisonId: string
): EChartsOption {
  const option = buildManualOverlayOption(indicatorPayload, primaryId, comparisonId);
  const xAxis = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis;
  const yAxis = Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis;
  const lastIndex = Math.max(0, (indicatorPayload.seriesByRun[0]?.points.length ?? 0) - 1);
  const tickIndexes = new Set([0, Math.floor(lastIndex / 3), Math.floor((lastIndex * 2) / 3), lastIndex]);
  const series = (Array.isArray(option.series) ? option.series : option.series ? [option.series] : []) as LineSeriesOption[];
  const axisUnits: Record<string, string> = {
    'count/month': 'UK approvals / month',
    index: 'Index (initial = 1)',
    ratio: 'Ratio (×)',
    '%': '%'
  };

  return {
    ...option,
    legend: {
      top: 0,
      left: 'center',
      right: 8,
      type: 'scroll',
      textStyle: { fontSize: 11 }
    },
    grid: { left: 8, right: 12, top: 58, bottom: 42, containLabel: true },
    xAxis: {
      ...xAxis,
      name: 'Model month',
      nameGap: 28,
      nameTextStyle: { fontSize: 11 },
      axisLabel: {
        hideOverlap: true,
        margin: 8,
        fontSize: 11,
        interval: (index: number) => tickIndexes.has(index),
        formatter: (value: string) => Number(value).toLocaleString('en-GB')
      }
    },
    yAxis: {
      ...yAxis,
      name: axisUnits[indicatorPayload.indicator.units] ?? indicatorPayload.indicator.units,
      nameLocation: 'end',
      nameRotate: 0,
      nameGap: 12,
      nameTextStyle: { fontSize: 11, fontWeight: 500, align: 'left' },
      splitNumber: 4,
      axisLabel: { ...yAxis?.axisLabel, fontSize: 11, margin: 8 }
    },
    series: series.map((entry) => ({
      ...entry,
      lineStyle: {
        ...entry.lineStyle,
        type: entry.name === COMPARISON_RUN_LABEL ? 'dashed' : 'solid'
      }
    }))
  };
}
