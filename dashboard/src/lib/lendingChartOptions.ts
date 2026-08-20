import type { EChartsOption } from 'echarts';
import type {
  JointCell,
  LendingBandGroup,
  LendingBorrowerType,
  LendingCap,
  LendingDistributionPayload,
  LendingHistogram,
  LendingJointGrid,
  LendingMetricId
} from '../../shared/types';
import { BASELINE_COLOR, COMPARISON_COLOR } from './manualOverlayChartOption';

const CAP_RULE_COLOR = '#c92a2a';
const BAND_COLORS = ['#0b7285', '#3bc9db', '#ffa8a8'];

export const LENDING_DISTRIBUTION_METRICS: Array<{ id: LendingMetricId; label: string }> = [
  { id: 'ltv', label: 'LTV' },
  { id: 'lti', label: 'LTI' },
  { id: 'dsti', label: 'DSTI' }
];

export const LENDING_BORROWER_TYPES: Array<{ id: LendingBorrowerType; label: string }> = [
  { id: 'FTB', label: 'First-time buyers' },
  { id: 'HM', label: 'Home movers' },
  { id: 'BTL', label: 'Buy-to-let' }
];

/**
 * Axis titles always carry their units in parentheses, matching the discipline chartAxes.ts
 * asserts for the calibration charts.
 */
const METRIC_AXIS_TITLES: Record<LendingMetricId, string> = {
  ltv: 'Loan-to-value (%)',
  lti: 'Loan-to-income (ratio)',
  dsti: 'Debt-service-to-income (ratio)',
  priceToIncome: 'House-price-to-income (ratio)',
  buyerAge: 'Borrower age (years)'
};

export function metricAxisTitle(metric: LendingMetricId): string {
  return METRIC_AXIS_TITLES[metric];
}

export function borrowerTypeLabel(borrowerType: LendingBorrowerType): string {
  return LENDING_BORROWER_TYPES.find((entry) => entry.id === borrowerType)?.label ?? borrowerType;
}

/** The cap that actually binds for this borrower type and metric, or null when none applies. */
export function findCap(
  caps: LendingCap[],
  borrowerType: LendingBorrowerType,
  metric: LendingMetricId
): LendingCap | null {
  if (metric !== 'ltv' && metric !== 'lti' && metric !== 'dsti') {
    return null;
  }
  return caps.find((cap) => cap.borrowerType === borrowerType && cap.metric === metric) ?? null;
}

export function formatCapValue(cap: LendingCap): string {
  return cap.units === '%' ? `${cap.value}%` : `${cap.value}`;
}

function capSourceLabel(cap: LendingCap): string {
  if (cap.source === 'central_bank') {
    return 'Central Bank';
  }
  if (cap.source === 'bank') {
    return 'lender';
  }
  return 'Central Bank and lender';
}

export function capRuleLabel(cap: LendingCap): string {
  return `${capSourceLabel(cap)} ${cap.binding} cap ${formatCapValue(cap)}`;
}

function histogramFor(payload: LendingDistributionPayload | null, metric: LendingMetricId): LendingHistogram | null {
  return payload?.histograms.find((histogram) => histogram.metric === metric) ?? null;
}

function seriesPoints(histogram: LendingHistogram, borrowerType: LendingBorrowerType): number[] {
  const series = histogram.seriesByBorrowerType.find((entry) => entry.borrowerType === borrowerType);
  return series ? series.bins.map((bin) => bin.share) : [];
}

/**
 * One borrower type at a time: each type faces its own cap, so a single chart carrying all three
 * could not draw the cap rule without ambiguity about which limit belongs to which line.
 */
export function buildLendingDistributionOption(
  baseline: LendingDistributionPayload | null,
  comparison: LendingDistributionPayload | null,
  metric: LendingMetricId,
  borrowerType: LendingBorrowerType
): EChartsOption | null {
  const baselineHistogram = histogramFor(baseline, metric);
  if (!baselineHistogram) {
    return null;
  }

  const comparisonHistogram = histogramFor(comparison, metric);
  const binCentres = baselineHistogram.seriesByBorrowerType[0]?.bins.map(
    (bin) => (bin.lowerEdge + bin.upperEdge) / 2
  ) ?? [];

  const cap = baseline ? findCap(baseline.caps, borrowerType, metric) : null;
  const comparisonCap = comparison ? findCap(comparison.caps, borrowerType, metric) : null;
  const capMoved = cap !== null && comparisonCap !== null && comparisonCap.value !== cap.value;

  const markLineData = [
    ...(cap
      ? [
          {
            xAxis: cap.value,
            lineStyle: { color: CAP_RULE_COLOR, type: 'solid' as const, width: 1.5 },
            label: {
              formatter: capMoved ? `Baseline ${formatCapValue(cap)}` : capRuleLabel(cap),
              position: 'insideEndTop' as const,
              color: CAP_RULE_COLOR
            }
          }
        ]
      : []),
    ...(capMoved && comparisonCap
      ? [
          {
            xAxis: comparisonCap.value,
            lineStyle: { color: COMPARISON_COLOR, type: 'dashed' as const, width: 1.5 },
            label: {
              formatter: `Comparison ${formatCapValue(comparisonCap)}`,
              position: 'insideEndBottom' as const,
              color: COMPARISON_COLOR
            }
          }
        ]
      : [])
  ];

  const series: EChartsOption['series'] = [
    {
      name: 'Baseline',
      type: 'line',
      smooth: false,
      showSymbol: false,
      areaStyle: { opacity: 0.18 },
      lineStyle: { width: 1.5 },
      itemStyle: { color: BASELINE_COLOR },
      data: seriesPoints(baselineHistogram, borrowerType),
      ...(markLineData.length > 0
        ? { markLine: { silent: true, symbol: 'none', data: markLineData } }
        : {})
    }
  ];

  if (comparisonHistogram) {
    series.push({
      name: 'Comparison',
      type: 'line',
      smooth: false,
      showSymbol: false,
      lineStyle: { width: 1.5 },
      itemStyle: { color: COMPARISON_COLOR },
      data: seriesPoints(comparisonHistogram, borrowerType)
    });
  }

  return {
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) => `${Number(value).toFixed(2)}%`
    },
    legend: { top: 0, data: comparisonHistogram ? ['Baseline', 'Comparison'] : ['Baseline'] },
    grid: { left: 64, right: 24, top: 40, bottom: 52, containLabel: true },
    xAxis: {
      type: 'category',
      data: binCentres.map((centre) => String(centre)),
      name: metricAxisTitle(metric),
      nameLocation: 'middle',
      nameGap: 30,
      axisLabel: {
        formatter: (value: string) => {
          const numeric = Number(value);
          return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
        }
      }
    },
    yAxis: {
      type: 'value',
      name: 'Share of new lending (%)',
      nameLocation: 'middle',
      nameGap: 44
    },
    series
  };
}

/** Stacked band shares, one bar per borrower type. */
export function buildLendingTailBandOption(
  group: LendingBandGroup,
  comparisonGroup: LendingBandGroup | null
): EChartsOption {
  const categories = LENDING_BORROWER_TYPES.map((entry) => entry.label);

  const shareFor = (source: LendingBandGroup, bandId: string): number[] =>
    LENDING_BORROWER_TYPES.map((entry) => {
      const series = source.seriesByBorrowerType.find((item) => item.borrowerType === entry.id);
      return series?.bands.find((band) => band.bandId === bandId)?.share ?? 0;
    });

  const series = group.bands.flatMap((band, index) => {
    const colour = BAND_COLORS[index % BAND_COLORS.length];
    const bars: EChartsOption['series'] = [
      {
        name: comparisonGroup ? `${band.label} · baseline` : band.label,
        type: 'bar',
        stack: 'baseline',
        itemStyle: { color: colour },
        emphasis: { focus: 'series' },
        data: shareFor(group, band.id)
      }
    ];
    if (comparisonGroup) {
      bars.push({
        name: `${band.label} · comparison`,
        type: 'bar',
        stack: 'comparison',
        itemStyle: { color: colour, opacity: 0.55, borderColor: COMPARISON_COLOR, borderWidth: 1 },
        emphasis: { focus: 'series' },
        data: shareFor(comparisonGroup, band.id)
      });
    }
    return bars;
  });

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (value) => `${Number(value).toFixed(1)}%`
    },
    legend: { top: 0, type: 'scroll' },
    grid: { left: 64, right: 24, top: 44, bottom: 52, containLabel: true },
    xAxis: {
      type: 'value',
      name: "Share of the borrower type's new lending (%)",
      nameLocation: 'middle',
      nameGap: 30
    },
    yAxis: { type: 'category', data: categories, name: 'Borrower type (-)', nameGap: 12 },
    series
  };
}

export interface LendingJointHeatmapData {
  cells: JointCell[];
  xLabels: string[];
  yLabels: string[];
  max: number;
}

/** Reshapes the sparse joint grid into the cell/label form jointHeatmapOption expects. */
export function toJointHeatmapData(
  joint: LendingJointGrid,
  borrowerType: LendingBorrowerType
): LendingJointHeatmapData {
  const series = joint.seriesByBorrowerType.find((entry) => entry.borrowerType === borrowerType);
  const xLabels = joint.ltvEdges.slice(0, -1).map((edge, index) => `${edge}–${joint.ltvEdges[index + 1]}`);
  const yLabels = joint.ltiEdges.slice(0, -1).map((edge, index) => `${edge}–${joint.ltiEdges[index + 1]}`);
  const cells: JointCell[] = (series?.cells ?? []).map((cell) => ({
    xIndex: cell.ltvBin,
    yIndex: cell.ltiBin,
    value: cell.share
  }));
  const max = cells.reduce((highest, cell) => Math.max(highest, cell.value), 0);
  return { cells, xLabels, yLabels, max };
}
