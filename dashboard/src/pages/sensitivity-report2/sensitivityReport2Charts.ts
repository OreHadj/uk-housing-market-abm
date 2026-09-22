import type { BarSeriesOption, EChartsOption, LineSeriesOption, ScatterSeriesOption } from 'echarts';
import { reportPolicyUnit } from '../experiments/view/sensitivity-report/reportModel';
import {
  REPORT2_OUTCOMES,
  formatReport2Value,
  type SensitivityReport2Model,
  type Report2Outcome
} from './sensitivityReport2Model';

export const SENSITIVITY_REPORT2_COLORS = {
  selected: '#4568e8',
  baseline: '#20ae9c',
  partial: '#b77d22'
} as const;

const INK = '#25314b';
const MUTED = '#78839a';
const GRID = '#edf0f6';
type Row = SensitivityReport2Model['rows'][number];

export interface SensitivityReport2ChartDatum {
  value: [number, number | null];
  pointId: string;
  name: string;
  symbolSize: number;
  itemStyle: { color: string; borderColor: string; borderWidth: number };
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compact(value: number): string {
  return value.toLocaleString('en-GB', {
    notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(value) < 0.01 && value !== 0 ? 5 : 3
  });
}

function domain(values: Array<number | null>): { min: number; max: number } | undefined {
  const valid = values.filter((value): value is number => finite(value) !== null);
  if (!valid.length) return undefined;
  const minimum = Math.min(...valid);
  const maximum = Math.max(...valid);
  const padding = maximum === minimum
    ? Math.max(Math.abs(minimum) * 0.05, 0.01)
    : (maximum - minimum) * 0.08;
  return { min: minimum - padding, max: maximum + padding };
}

function baseOption(): EChartsOption {
  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: '"Space Grotesk", "Segoe UI", sans-serif', color: INK, fontSize: 13 },
    aria: { enabled: true },
    legend: { show: false }
  };
}

/** Failed/canceled results cannot contribute even when an old aggregate remains in the payload. */
function visibleValue(row: Row | null | undefined, key: string): number | null {
  if (!row || ['failed', 'canceled', 'missing'].includes(row.coverage.state)) return null;
  return finite(row.metrics[key]?.value);
}

function baselineValue(model: SensitivityReport2Model, key: string): number | null {
  return visibleValue(model.baselineRow, key) === null ? null : finite(model.baselineRow?.metrics[key]?.baselineValue);
}

function coverageLabel(row: Row, key: string): string {
  const count = row.metrics[key]?.finiteSeeds;
  return `${row.coverage.label}${typeof count === 'number' ? ` · ${count} valid seed summaries` : ''}`;
}

function measurementLabel(outcome: Report2Outcome): string {
  const units = outcome.units === 'percentage points' || (outcome.measure === 'range' && outcome.units === '%') ? 'pp' : outcome.units;
  const unitLabel = units === 'count/month' ? outcome.id === 'core_housingTransactions' ? 'UK transactions / month' : 'UK mortgages / month'
    : units === 'ratio' ? '×' : units;
  return `${outcome.measure === 'range' ? 'Temporal P95–P5' : 'Mean'} (${unitLabel})`;
}

function eventPointId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('pointId' in value)) return null;
  return typeof value.pointId === 'string' ? value.pointId : null;
}

/** Read only a plotted point identity; axis/legend clicks must not change the selected setting. */
export function sensitivityReport2ClickedPointId(event: unknown): string | null {
  if (typeof event !== 'object' || event === null || !('data' in event)) return null;
  return eventPointId(event.data);
}

/** Actual numeric policy spacing; incomplete observations are isolated from the complete-result line. */
export function buildSensitivityReport2Response(
  model: SensitivityReport2Model,
  outcomeKey: string,
  selectedPointId: string
): EChartsOption | null {
  const outcome = REPORT2_OUTCOMES.find((candidate) => candidate.key === outcomeKey);
  if (!outcome) return null;
  const rows = model.numericRows;
  const policyUnit = reportPolicyUnit(model.detail.parameter);
  const policyAxis = `Tested policy value${policyUnit === 'percentage' ? ' (%)' : policyUnit === 'multiple' ? ' (× income)' : policyUnit === 'months' ? ' (months)' : policyUnit === 'ratio' ? ' (ratio)' : ''}`;
  const baseline = baselineValue(model, outcomeKey);
  const values = rows.map((row) => visibleValue(row, outcomeKey));
  if (baseline === null && values.every((value) => value === null)) return null;
  const outcomeDomain = domain([...values, baseline]);
  // Padded bounds keep points off the chart edge but are not data; label only tested settings.
  const testedValues = rows.map((row) => row.x).filter((value): value is number => finite(value) !== null);

  const datum = (row: Row, value: number | null, partial = false): SensitivityReport2ChartDatum => ({
    value: [row.x as number, value],
    pointId: row.point.pointId,
    name: row.setting,
    symbolSize: row.point.pointId === selectedPointId ? 11 : partial ? 8 : 6,
    itemStyle: {
      color: partial ? SENSITIVITY_REPORT2_COLORS.partial : SENSITIVITY_REPORT2_COLORS.selected,
      borderColor: '#fff',
      borderWidth: row.point.pointId === selectedPointId ? 2 : 1
    }
  });
  const completeData = rows.map((row) => datum(row, row.metrics[outcomeKey]?.eligible ? visibleValue(row, outcomeKey) : null));
  const qualifiedData = rows
    .filter((row) => !row.metrics[outcomeKey]?.eligible && visibleValue(row, outcomeKey) !== null)
    .map((row) => datum(row, visibleValue(row, outcomeKey), true));
  const complete: LineSeriesOption = {
    name: 'Complete seed coverage',
    type: 'line',
    data: completeData,
    dimensions: ['Tested policy value', 'Outcome'],
    encode: { x: 0, y: 1 },
    smooth: false,
    connectNulls: false,
    showSymbol: true,
    symbol: 'circle',
    lineStyle: { color: SENSITIVITY_REPORT2_COLORS.selected, width: 2.5 },
    itemStyle: { color: SENSITIVITY_REPORT2_COLORS.selected },
    emphasis: { scale: 1.3 },
    ...(baseline === null ? {} : {
      markLine: {
        silent: true,
        symbol: ['none', 'none'],
        lineStyle: { color: SENSITIVITY_REPORT2_COLORS.baseline, type: 'dashed', width: 1.5 },
        label: {
          show: true,
          formatter: model.baselineRow?.metrics[outcomeKey]?.eligible ? 'Baseline' : 'Baseline (qualified)',
          position: 'insideEndTop',
          color: '#258579',
          fontSize: 13
        },
        data: [{ yAxis: baseline }]
      }
    })
  };
  const qualified: ScatterSeriesOption = {
    name: 'Partial / legacy seed coverage',
    type: 'scatter',
    symbol: 'diamond',
    data: qualifiedData,
    itemStyle: { color: SENSITIVITY_REPORT2_COLORS.partial },
    emphasis: { scale: 1.3 }
  };

  return {
    ...baseOption(),
    grid: { left: 6, right: 25, top: 33, bottom: 43, containLabel: true },
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      backgroundColor: '#fff',
      borderColor: GRID,
      textStyle: { color: INK, fontSize: 14 },
      axisPointer: { type: 'line', lineStyle: { color: '#c4cde0', type: 'dashed' } },
      formatter: (params) => {
        const items = Array.isArray(params) ? params : [params];
        const pointId = items.map((item) => eventPointId(item.data)).find(Boolean);
        const row = rows.find((candidate) => candidate.point.pointId === pointId);
        if (!row) return '';
        return [
          row.setting,
          `${outcome.title} ${formatReport2Value(visibleValue(row, outcomeKey), outcome)}`,
          coverageLabel(row, outcomeKey),
          `Baseline ${formatReport2Value(baseline, outcome)}`
        ].join('\n');
      }
    },
    xAxis: {
      type: 'value',
      name: policyAxis,
      nameLocation: 'middle',
      nameGap: 31,
      nameTextStyle: { color: MUTED, fontSize: 13 },
      scale: true,
      splitNumber: 4,
      ...domain(rows.map((row) => row.x)),
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { color: MUTED, fontSize: 13, hideOverlap: true, formatter: compact, customValues: testedValues }
    },
    yAxis: {
      type: 'value',
      name: measurementLabel(outcome),
      nameLocation: 'end',
      nameGap: 15,
      nameTextStyle: { color: MUTED, fontSize: 13, align: 'left' },
      scale: true,
      splitNumber: 3,
      ...outcomeDomain,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: GRID, type: 'dashed' } },
      axisLabel: {
        color: MUTED, fontSize: 13, formatter: compact, hideOverlap: true,
        ...(outcomeDomain ? { showMinLabel: false, showMaxLabel: false } : {})
      }
    },
    series: qualifiedData.length ? [complete, qualified] : [complete]
  };
}

const COMPARISON_GROUPS = {
  borrowers: {
    keys: ['core_advancesToFTB', 'core_advancesToHM', 'core_advancesToBTL'],
    labels: ['First-time buyers', 'Home movers', 'Buy-to-let'],
    axis: 'UK mortgages / month'
  },
  cycles: {
    keys: ['core_housePriceGrowth:range', 'core_creditGrowth:range'],
    labels: ['House-price growth\n(quarter-on-quarter)', 'Credit growth\n(12-month)'],
    axis: 'Temporal P95–P5 (pp)'
  }
} as const;

/** Only comparable native units share an axis. Null entries stay missing, including in tooltips. */
export function buildSensitivityReport2Comparison(
  model: SensitivityReport2Model,
  group: keyof typeof COMPARISON_GROUPS,
  selectedPointId: string
): EChartsOption | null {
  const definition = COMPARISON_GROUPS[group];
  const selectedRow = model.rows.find((row) => row.point.pointId === selectedPointId);
  const selected = definition.keys.map((key) => visibleValue(selectedRow, key));
  const baseline = definition.keys.map((key) => baselineValue(model, key));
  if (![...selected, ...baseline].some((value) => value !== null)) return null;
  const bar = (name: string, values: Array<number | null>, color: string): BarSeriesOption => ({
    name,
    type: 'bar',
    data: values,
    barMaxWidth: 18,
    barGap: '45%',
    itemStyle: { color, borderRadius: [0, 3, 3, 0] }
  });
  return {
    ...baseOption(),
    // Keep a small inset beyond containLabel: browser font metrics can extend the
    // first glyph past the computed label bounds, especially for multiline cycles.
    grid: { left: 18, right: 16, top: 16, bottom: 48, containLabel: true },
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      textStyle: { fontSize: 14 },
      axisPointer: { type: 'shadow', shadowStyle: { color: '#f4f6fb' } },
      formatter: (params) => {
        const items = Array.isArray(params) ? params : [params];
        const index = items[0]?.dataIndex;
        const key = typeof index === 'number' ? definition.keys[index] : undefined;
        const outcome = REPORT2_OUTCOMES.find((candidate) => candidate.key === key);
        if (!outcome || index === undefined) return '';
        return [
          outcome.title,
          `Selected setting ${formatReport2Value(selected[index], outcome)}`,
          selectedRow ? coverageLabel(selectedRow, outcome.key) : 'Setting unavailable',
          `Baseline ${formatReport2Value(baseline[index], outcome)}`,
          model.baselineRow ? coverageLabel(model.baselineRow, outcome.key) : 'Baseline unavailable'
        ].join('\n');
      }
    },
    xAxis: {
      type: 'value',
      min: 0,
      name: definition.axis,
      nameLocation: 'middle',
      nameGap: 35,
      nameTextStyle: { color: MUTED, fontSize: 13 },
      splitNumber: 3,
      splitLine: { lineStyle: { color: GRID, type: 'dashed' } },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: MUTED, fontSize: 13, formatter: compact, hideOverlap: true }
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: [...definition.labels],
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: INK, fontSize: 13, lineHeight: 18, margin: 12, interval: 0 }
    },
    series: [
      bar('Selected setting', selected, SENSITIVITY_REPORT2_COLORS.selected),
      bar('Baseline', baseline, SENSITIVITY_REPORT2_COLORS.baseline)
    ]
  };
}
