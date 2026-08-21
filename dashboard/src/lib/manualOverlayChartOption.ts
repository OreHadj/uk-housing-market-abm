// Author: Max Stoddard
import type { EChartsOption } from 'echarts';
import type { ResultsCompareIndicator, ResultsCompareSeries } from '../../shared/types';

export const BASELINE_COLOR = '#0b7285';
export const COMPARISON_COLOR = '#18958b';
const FALLBACK_COLOR = '#495057';

function formatOverlayValue(value: number, units: string): string {
  if (units === 'GBP') {
    return `£${value.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
  }
  if (units === '%' || units === 'rate') {
    return value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  }
  if (units === 'count' || units === 'count/month') {
    return value.toLocaleString('en-GB', { maximumFractionDigits: 0 });
  }
  return value.toLocaleString('en-GB', { maximumFractionDigits: 3 });
}

function getRunRoleLabel(runId: string, baselineRunId: string, comparisonRunId: string): string {
  if (runId === baselineRunId) {
    return 'Baseline';
  }
  if (comparisonRunId && runId === comparisonRunId) {
    return 'Comparison';
  }
  return runId;
}

function getRunColor(runId: string, baselineRunId: string, comparisonRunId: string): string {
  if (runId === baselineRunId) {
    return BASELINE_COLOR;
  }
  if (comparisonRunId && runId === comparisonRunId) {
    return COMPARISON_COLOR;
  }
  return FALLBACK_COLOR;
}

function computeVisibleMean(points: ResultsCompareSeries['points']): number | null {
  const values = points
    .map((point) => point.value)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildManualOverlayOption(
  indicatorPayload: ResultsCompareIndicator,
  baselineRunId: string,
  comparisonRunId: string,
  selectedSeries?: Record<string, boolean>
): EChartsOption {
  const xValues = indicatorPayload.seriesByRun[0]?.points.map((point) => String(point.modelTime)) ?? [];
  const meanBySeriesName = new Map<string, number>();

  const series = indicatorPayload.seriesByRun.map((runSeries) => {
    const color = getRunColor(runSeries.runId, baselineRunId, comparisonRunId);
    const label = getRunRoleLabel(runSeries.runId, baselineRunId, comparisonRunId);
    const mean = computeVisibleMean(runSeries.points);

    if (mean !== null) {
      meanBySeriesName.set(label, mean);
    }

    return {
      name: label,
      type: 'line' as const,
      showSymbol: false,
      smooth: false,
      connectNulls: false,
      data: runSeries.points.map((point) => point.value),
      lineStyle: {
        color,
        width: 2
      },
      itemStyle: {
        color
      },
      ...(mean === null
        ? {}
        : {
            markLine: {
              symbol: 'none',
              silent: true,
              animation: false,
              label: { show: false },
              lineStyle: {
                type: 'dotted' as const,
                width: 1.6,
                color,
                opacity: 0.75
              },
              data: [{ yAxis: mean }]
            }
          })
    };
  });

  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const items = (Array.isArray(params) ? params : [params]) as {
          axisValueLabel: string;
          seriesName: string;
          marker: string;
          value: number | null;
        }[];
        const units = indicatorPayload.indicator.units;
        const header = `<div style="margin-bottom:4px;font-weight:600">Month ${items[0]?.axisValueLabel ?? ''}</div>`;
        const lines: string[] = [];
        for (const item of items) {
          const formatted = typeof item.value === 'number' && !Number.isNaN(item.value)
            ? formatOverlayValue(item.value, units)
            : 'n/a';
          lines.push(`${item.marker} ${item.seriesName}: <b>${formatted}</b>`);
          const mean = meanBySeriesName.get(item.seriesName);
          if (mean !== undefined) {
            lines.push(`&nbsp;&nbsp;&nbsp;&nbsp;&#x2508; ${item.seriesName} mean: <b>${formatOverlayValue(mean, units)}</b>`);
          }
        }
        return header + lines.join('<br/>');
      }
    },
    legend: {
      top: 4,
      selected: selectedSeries
    },
    grid: {
      left: 72,
      right: 20,
      top: 48,
      bottom: 42
    },
    xAxis: {
      type: 'category',
      data: xValues,
      name: 'Model Time (months)',
      nameLocation: 'middle',
      nameGap: 30,
      axisLabel: {
        formatter: (value: string, index: number) => {
          return index % 120 === 0 ? value : '';
        }
      }
    },
    yAxis: {
      type: 'value',
      name: indicatorPayload.indicator.units,
      nameLocation: 'middle',
      nameGap: 52,
      scale: true
    },
    series
  };
}
