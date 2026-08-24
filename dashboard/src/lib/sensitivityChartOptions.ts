// Author: Max Stoddard
import type { EChartsOption } from 'echarts';
import type {
  KpiMetricKey,
  SensitivityDeltaTrendSeries,
  SensitivityExperimentChartsPayload
} from '../../shared/types';
import { KPI_LABELS } from './kpiLabels';
import {
  formatResultsAxisTick,
  resultsValueAxisNameGap,
  wrapResultsAxisName
} from './resultsChartLayout';

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
      left: 18,
      right: 22,
      top: 24,
      bottom: 72,
      containLabel: true
    },
    xAxis: {
      type: 'value',
      name: wrapResultsAxisName(parameterTitle),
      nameGap: 34,
      nameLocation: 'middle',
      nameTextStyle: {
        lineHeight: 14,
        align: 'center'
      },
      axisLabel: {
        hideOverlap: true,
        margin: 10,
        formatter: formatResultsAxisTick
      },
      scale: true,
      ...xDomain
    },
    yAxis: {
      type: 'value',
      name: `% diff ${KPI_LABELS[kpi]?.short ?? kpi}`,
      nameLocation: 'middle',
      nameGap: resultsValueAxisNameGap(chartData.map((point) => point[1])),
      nameTextStyle: {
        fontWeight: 600
      },
      axisLabel: {
        hideOverlap: true,
        margin: 10,
        formatter: formatResultsAxisTick
      },
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

export function buildSensitivityTornadoOption(
  bars: SensitivityExperimentChartsPayload['tornado'],
  kpi: KpiMetricKey
): EChartsOption {
  const sorted = [...bars].sort((left, right) => {
    const leftValue = left.maxAbsDeltaByKpi[kpi] ?? Number.NEGATIVE_INFINITY;
    const rightValue = right.maxAbsDeltaByKpi[kpi] ?? Number.NEGATIVE_INFINITY;
    return rightValue - leftValue;
  });
  const values = sorted.map((item) => item.maxAbsDeltaByKpi[kpi]);

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
      left: 16,
      right: 24,
      top: 16,
      bottom: 58,
      containLabel: true
    },
    xAxis: {
      type: 'value',
      name: `Max |% diff ${KPI_LABELS[kpi]?.short ?? kpi}|`,
      nameLocation: 'middle',
      nameGap: 36,
      nameTextStyle: {
        fontWeight: 600
      },
      axisLabel: {
        hideOverlap: true,
        margin: 10,
        formatter: formatResultsAxisTick
      }
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: sorted.map((item) => item.title),
      axisLabel: {
        interval: 0,
        width: 180,
        overflow: 'break',
        lineHeight: 14,
        margin: 12,
        fontSize: 11
      }
    },
    series: [
      {
        type: 'bar',
        data: values,
        itemStyle: {
          color: '#0b7285'
        }
      }
    ]
  };
}
