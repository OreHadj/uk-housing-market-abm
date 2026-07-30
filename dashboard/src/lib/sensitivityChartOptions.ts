// Author: Max Stoddard
import type { EChartsOption } from 'echarts';
import type { KpiMetricKey, SensitivityDeltaTrendSeries } from '../../shared/types';
import { KPI_LABELS } from './kpiLabels';

interface AxisDomain {
  min: number;
  max: number;
}

function buildPaddedAxisDomain(values: Array<number | null | undefined>, zeroPadding = 1): AxisDomain | undefined {
  const finiteValues = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (finiteValues.length === 0) {
    return undefined;
  }

  const rawMin = Math.min(...finiteValues);
  const rawMax = Math.max(...finiteValues);
  if (Math.abs(rawMax - rawMin) < 1e-12) {
    const padding = Math.abs(rawMin) > 0 ? Math.max(Math.abs(rawMin) * 0.1, 1e-6) : zeroPadding;
    return {
      min: rawMin - padding,
      max: rawMax + padding
    };
  }

  const padding = Math.max((rawMax - rawMin) * 0.08, 1e-6);
  return {
    min: rawMin - padding,
    max: rawMax + padding
  };
}

export function buildDeltaTrendOption(
  series: SensitivityDeltaTrendSeries,
  parameterTitle: string,
  kpi: KpiMetricKey
): EChartsOption {
  const chartData = series.points
    .filter((point) => point.parameterValue !== null)
    .map((point) => [point.parameterValue as number, point.deltaByKpi[kpi]] as [number, number | null])
    .filter((point) => Number.isFinite(point[0]));
  const xDomain = buildPaddedAxisDomain(chartData.map((point) => point[0]));
  const yDomain = buildPaddedAxisDomain(chartData.map((point) => point[1]));

  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: unknown) => {
        if (typeof value !== 'number' || Number.isNaN(value)) {
          return 'n/a';
        }
        return `${value.toLocaleString('en-GB', { maximumFractionDigits: 6 })}%`;
      }
    },
    grid: {
      left: 80,
      right: 24,
      top: 20,
      bottom: 48
    },
    xAxis: {
      type: 'value',
      name: parameterTitle,
      nameGap: 30,
      nameLocation: 'middle',
      scale: true,
      ...xDomain
    },
    yAxis: {
      type: 'value',
      name: `% diff ${KPI_LABELS[kpi]?.short ?? kpi}`,
      nameLocation: 'middle',
      nameGap: 48,
      scale: true,
      ...yDomain
    },
    series: [
      {
        type: 'line',
        showSymbol: true,
        connectNulls: false,
        data: chartData
      }
    ]
  };
}
