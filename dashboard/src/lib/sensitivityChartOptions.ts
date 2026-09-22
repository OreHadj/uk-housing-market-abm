// Author: Max Stoddard
import type { EChartsOption } from 'echarts';
import type {
  KpiMetricKey,
  SensitivityDeltaTrendSeries,
  SensitivityExperimentChartsPayload,
  SensitivityExperimentParameterSelection
} from '../../shared/types';
import { formatPolicyValue, type PolicyUnit } from '../../shared/policyDisplay';
import {
  formatReportValue,
  isReportMetricEligible,
  reportPolicyUnit,
  type ReportOutcome,
  type ReportRow
} from '../pages/experiments/view/sensitivity-report/reportModel';
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

function escapeTooltipText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character] ?? character);
}

function formatPolicyAxisTick(value: number | string, unit: PolicyUnit | null): string {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return String(value);
  if (unit === 'percentage') return `${formatResultsAxisTick(numericValue * 100)}%`;
  if (unit === 'multiple') return `${formatResultsAxisTick(numericValue)}×`;
  return formatResultsAxisTick(numericValue);
}

/** Mean levels or temporal P95–P5 across policy settings; seed failures remain gaps in the line. */
export function buildSensitivityReportMeanOption(
  outcome: ReportOutcome,
  rows: ReportRow[],
  parameter: SensitivityExperimentParameterSelection,
  focusPointId?: string,
  relativeMean = false
): EChartsOption {
  const policyUnit = reportPolicyUnit(parameter);
  const measure = outcome.measure ?? 'mean';
  const measureLabel = relativeMean ? 'Difference from baseline' : measure === 'range' ? 'P95–P5' : 'Mean';
  const units = relativeMean ? '%' : measure === 'range' && outcome.units === '%' ? 'pp' : outcome.units;
  const valueForRow = (row: ReportRow) => {
    if (!isReportMetricEligible(row, outcome.id, measure)) return null;
    if (relativeMean) return row.metrics[outcome.id].relativeChange;
    return measure === 'range' ? row.metrics[outcome.id].temporalRange : row.metrics[outcome.id].mean;
  };
  // A package baseline with unequal settings has no scalar x coordinate. Its mean is still the
  // horizontal reference; its component settings are shown in the report context and table.
  const scalarRows = rows
    .filter((row) => row.point.value !== null && Number.isFinite(row.point.value))
    .sort((left, right) => (left.point.value as number) - (right.point.value as number));
  const data = scalarRows.map((row) => [
    row.point.value as number,
    valueForRow(row)
  ] as [number, number | null]);
  const focusRow = scalarRows.find((row) => row.point.pointId === focusPointId && valueForRow(row) !== null);
  const baselineValue = relativeMean ? outcome.baselineMean === null ? null : 0
    : measure === 'range' ? outcome.baselineRange : outcome.baselineMean;
  const baseline = typeof baselineValue === 'number' && Number.isFinite(baselineValue)
    ? baselineValue
    : null;
  const yValues = [...data.map((point) => point[1]), baseline];
  const xUnitLabel = policyUnit === 'percentage' ? ' (%)'
    : policyUnit === 'multiple' ? ' (× income)'
      : policyUnit === 'months' ? ' (months)'
        : policyUnit === 'ratio' ? ' (ratio)' : '';

  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      confine: true,
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params;
        const row = item ? scalarRows[item.dataIndex] : undefined;
        if (!row) return '';
        const metric = row.metrics[outcome.id];
        const value = valueForRow(row);
        const finiteCount = (count: number | null) => typeof count === 'number' && Number.isFinite(count);
        const coverage = finiteCount(row.successfulSeeds) && finiteCount(row.expectedSeeds)
          ? `${row.successfulSeeds}/${row.expectedSeeds} seeds succeeded`
          : 'Seed coverage unavailable';
        const contributingSeeds = measure === 'range' ? metric?.rangeContributingSeeds : metric?.contributingSeeds;
        const contributions = finiteCount(contributingSeeds ?? null)
          ? `${contributingSeeds} valid seed ${measure === 'range' ? 'P95–P5 measures' : 'means'}`
          : null;
        return [
          `<strong>${escapeTooltipText(row.setting)}</strong>`,
          `${escapeTooltipText(outcome.title)} — ${measureLabel} ${escapeTooltipText(formatReportValue(value, units))}`,
          `Status ${escapeTooltipText(row.status)}`,
          escapeTooltipText(coverage),
          contributions ? escapeTooltipText(contributions) : null,
          baseline !== null
            ? `Baseline ${escapeTooltipText(formatReportValue(baseline, units))}`
            : 'Baseline unavailable'
        ].filter((line) => line !== null).join('<br/>');
      }
    },
    grid: { left: 8, right: 16, top: 28, bottom: 36, containLabel: true },
    xAxis: {
      type: 'value',
      name: `Tested policy value${xUnitLabel}`,
      nameLocation: 'middle',
      nameGap: 29,
      nameTextStyle: { fontSize: 14 },
      splitNumber: 3,
      axisLabel: {
        hideOverlap: true,
        margin: 6,
        fontSize: 14,
        formatter: (value: number) => formatPolicyAxisTick(value, policyUnit)
      },
      axisPointer: {
        label: {
          formatter: ({ value }) => policyUnit
            ? formatPolicyValue(Number(value), policyUnit)
            : String(value)
        }
      },
      splitLine: { show: false },
      scale: true,
      ...buildPaddedAxisDomain(data.map((point) => point[0]))
    },
    yAxis: {
      type: 'value',
      name: `${measureLabel} (${units})`,
      nameLocation: 'end',
      nameGap: 7,
      nameTextStyle: { fontSize: 14, align: 'left' },
      splitNumber: 3,
      axisLabel: { hideOverlap: true, margin: 6, fontSize: 14, formatter: formatResultsAxisTick },
      splitLine: { lineStyle: { color: '#e6e9e8' } },
      scale: true,
      ...buildPaddedAxisDomain(yValues)
    },
    series: [{
      name: outcome.title,
      type: 'line',
      smooth: false,
      showSymbol: true,
      symbol: 'circle',
      symbolSize: 4.5,
      connectNulls: false,
      lineStyle: { color: '#287d80', width: 2 },
      itemStyle: { color: '#287d80' },
      data,
      ...(focusRow ? {
        markPoint: {
          silent: true,
          symbol: 'circle',
          symbolSize: 10,
          label: { show: false },
          itemStyle: { color: '#155d61', borderColor: '#fff', borderWidth: 1.5 },
          data: [{ name: 'Selected policy setting', coord: [focusRow.point.value as number, valueForRow(focusRow) as number] }]
        }
      } : {}),
      ...(baseline === null ? {} : {
        markLine: {
          silent: true,
          symbol: ['none', 'none'],
          lineStyle: { color: '#7a8583', type: 'dashed', width: 1 },
          label: {
            show: true,
            formatter: 'Baseline',
            position: 'insideEndTop',
            color: '#596561',
            fontSize: 14,
            distance: 4
          },
          data: [{ yAxis: baseline }]
        }
      })
    }]
  };
}

export function buildDeltaTrendOption(
  series: SensitivityDeltaTrendSeries,
  parameterTitle: string,
  kpi: KpiMetricKey,
  policyUnit: PolicyUnit | null = null
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
      ...(policyUnit ? {
        confine: true,
        formatter: (params: unknown) => {
          const item = Array.isArray(params) ? params[0] : params;
          const value = typeof item === 'object' && item !== null && 'value' in item ? item.value : null;
          if (!Array.isArray(value) || typeof value[0] !== 'number') return '';
          const delta = typeof value[1] === 'number' && Number.isFinite(value[1])
            ? `${value[1].toLocaleString('en-GB', { maximumFractionDigits: 6 })}%`
            : 'n/a';
          return `${escapeTooltipText(formatPolicyValue(value[0], policyUnit))}<br/>${escapeTooltipText(KPI_LABELS[kpi].label)} ${delta}`;
        }
      } : {}),
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
        formatter: policyUnit ? (value: number) => formatPolicyAxisTick(value, policyUnit) : formatResultsAxisTick
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
