// Author: Max Stoddard
import type { EChartsOption } from 'echarts';
import type { BinnedDatum, BinnedSourceDatum, CompareResult, CurvePoint, HomePreviewItem, ScalarDatum } from '../../shared/types';
import { createCalibrationComparisonFormatter } from './calibrationNumberFormat';
import type { JointHeatmapLayoutOverrides } from './jointHeatmapOption';

export function formatChartNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return value.toLocaleString('en-GB', { maximumFractionDigits: 0 });
  }
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  }
  if (Math.abs(value) >= 1) {
    return value.toLocaleString('en-GB', { maximumFractionDigits: 4 });
  }
  return value.toLocaleString('en-GB', { maximumFractionDigits: 8 });
}

function formatScientific(value: number, digits = 2): string {
  const [mantissa, exponent] = value.toExponential(digits).split('e');
  const trimmedMantissa = mantissa.replace(/\.?0+$/, '');
  const normalizedExponent = exponent.replace('+', '').replace(/^(-?)0+(\d)/, '$1$2');
  return `${trimmedMantissa}e${normalizedExponent}`;
}

function formatCurveValue(value: number): string {
  const absolute = Math.abs(value);
  if (absolute < 1e-12) {
    return '0';
  }
  if (absolute < 0.001) {
    return formatScientific(value, 2);
  }
  if (absolute < 1) {
    return value.toLocaleString('en-GB', { maximumFractionDigits: 6 });
  }
  return formatChartNumber(value);
}

function createCurveComparisonFormatter(left: number, right: number): (value: number) => string {
  const maximumAbsolute = Math.max(Math.abs(left), Math.abs(right));
  if (maximumAbsolute > 0 && maximumAbsolute < 0.001) {
    return (value: number) => {
      if (Math.abs(value) < 1e-300) return '0.00';
      const [mantissa, exponent] = value.toExponential(2).split('e');
      const normalizedExponent = exponent.replace('+', '').replace(/^(-?)0+(\d)/, '$1$2');
      return `${mantissa}e${normalizedExponent}`;
    };
  }
  return createCalibrationComparisonFormatter([left, right]);
}

function formatAxisTick(value: number): string {
  const absolute = Math.abs(value);
  if (absolute < 1e-12) {
    return '0';
  }
  if (absolute >= 1) {
    return value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  }
  if (absolute >= 0.01) {
    return value.toLocaleString('en-GB', { maximumFractionDigits: 3 });
  }
  if (absolute >= 0.001) {
    return value.toLocaleString('en-GB', { maximumFractionDigits: 4 });
  }
  return formatScientific(value, 1);
}

function formatDensityAxisTitle(yAxisName: string): string {
  const baseName = yAxisName.replace(/\s*\(-\)\s*$/, '').trim();
  return baseName ? `${baseName} density` : 'Density';
}

function sameIntervalGrid(left: BinnedSourceDatum[] | BinnedDatum[], right: BinnedSourceDatum[] | BinnedDatum[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((bin, index) => {
    const other = right[index];
    return Math.abs(bin.lower - other.lower) < 1e-9 && Math.abs(bin.upper - other.upper) < 1e-9;
  });
}

function shouldUseIntervalComparison(item: CompareResult): boolean {
  if (item.visualPayload.type !== 'binned_distribution') {
    return false;
  }
  const sourceBins = item.visualPayload.sourceBins;
  if (!sourceBins || sourceBins.left.length === 0 || sourceBins.right.length === 0) {
    return false;
  }
  return (
    !sameIntervalGrid(sourceBins.left, sourceBins.right) ||
    !sameIntervalGrid(sourceBins.left, item.visualPayload.bins) ||
    !sameIntervalGrid(sourceBins.right, item.visualPayload.bins)
  );
}

function shouldUseIntervalSingle(
  item: Pick<CompareResult | HomePreviewItem, 'visualPayload' | 'rightVersion'>
): boolean {
  if (item.visualPayload.type !== 'binned_distribution') {
    return false;
  }
  const sourceBins = item.visualPayload.sourceBins?.right;
  return Boolean(sourceBins && sourceBins.length > 0 && !sameIntervalGrid(sourceBins, item.visualPayload.bins));
}

export interface CurveLayoutOverrides {
  gridLeft?: number;
  gridRight?: number;
  yAxisNameGap?: number;
}

interface CurveVerticalMarker {
  x: number;
  label?: string;
  color?: string;
}

interface CurveLegendMarker {
  x: number;
  name: string;
  color?: string;
}

function resolveCurveYExtent(seriesGroups: CurvePoint[][]): [number, number] {
  const yValues: number[] = [];
  for (const series of seriesGroups) {
    for (const point of series) {
      if (Number.isFinite(point.y)) {
        yValues.push(point.y);
      }
    }
  }

  if (yValues.length === 0) {
    return [0, 1];
  }

  let yMin = Math.min(...yValues);
  let yMax = Math.max(...yValues);
  if (Math.abs(yMax - yMin) < 1e-12) {
    const padding = Math.max(Math.abs(yMin) * 0.05, 1e-6);
    yMin -= padding;
    yMax += padding;
  }

  return [yMin, yMax];
}

function buildVerticalMarker(marker: CurveVerticalMarker | undefined, fallbackColor = '#495057') {
  if (!marker || !Number.isFinite(marker.x)) {
    return undefined;
  }
  const color = marker.color ?? fallbackColor;
  return {
    symbol: 'none',
    silent: true,
    lineStyle: { type: 'dashed' as const, width: 1.5, color },
    label: {
      formatter: marker.label ?? `x=${formatChartNumber(marker.x)}`,
      position: 'insideEndTop' as const,
      color
    },
    data: [{ xAxis: marker.x }]
  };
}

function buildLegendMarkerSeries(
  legendMarkers: CurveLegendMarker[] | undefined,
  yMin: number,
  yMax: number
): Array<Record<string, unknown>> {
  if (!legendMarkers || legendMarkers.length === 0) {
    return [];
  }

  return legendMarkers
    .filter((marker) => Number.isFinite(marker.x))
    .map((marker) => ({
      name: marker.name,
      type: 'line',
      silent: true,
      clip: true,
      showSymbol: false,
      tooltip: { show: false },
      emphasis: { disabled: true },
      data: [
        [marker.x, yMin],
        [marker.x, yMax]
      ],
      lineStyle: {
        type: 'dashed' as const,
        width: 1.5,
        color: marker.color ?? '#495057'
      }
    }));
}

export function scalarOption(
  values: ScalarDatum[],
  leftVersion: string,
  rightVersion: string,
  xAxisName: string,
  yAxisName: string
): EChartsOption {
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0, data: [leftVersion, rightVersion] },
    grid: { left: 74, right: 34, top: 44, bottom: 98, containLabel: true },
    xAxis: {
      type: 'category',
      data: values.map((entry) => entry.key),
      axisLabel: { rotate: 25 },
      name: xAxisName,
      nameLocation: 'middle',
      nameGap: 66,
      nameTextStyle: { fontSize: 12, fontWeight: 600, color: '#495057' }
    },
    yAxis: {
      type: 'value',
      name: yAxisName,
      nameLocation: 'middle',
      nameGap: 58,
      nameTextStyle: { fontSize: 12, fontWeight: 600, color: '#495057' }
    },
    series: [
      {
        name: leftVersion,
        type: 'bar',
        data: values.map((entry) => entry.left),
        itemStyle: { color: '#0b7285' }
      },
      {
        name: rightVersion,
        type: 'bar',
        data: values.map((entry) => entry.right),
        itemStyle: { color: '#18958b' }
      }
    ]
  };
}

export function scalarSingleOption(
  values: ScalarDatum[],
  version: string,
  xAxisName: string,
  yAxisName: string
): EChartsOption {
  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0, data: [version] },
    grid: { left: 74, right: 34, top: 44, bottom: 98, containLabel: true },
    xAxis: {
      type: 'category',
      data: values.map((entry) => entry.key),
      axisLabel: { rotate: 25 },
      name: xAxisName,
      nameLocation: 'middle',
      nameGap: 66,
      nameTextStyle: { fontSize: 12, fontWeight: 600, color: '#495057' }
    },
    yAxis: {
      type: 'value',
      name: yAxisName,
      nameLocation: 'middle',
      nameGap: 58,
      nameTextStyle: { fontSize: 12, fontWeight: 600, color: '#495057' }
    },
    series: [
      {
        name: version,
        type: 'bar',
        data: values.map((entry) => entry.right),
        itemStyle: { color: '#0b7285' }
      }
    ]
  };
}

type IntervalDatum = [number, number, number, number, string];

function intervalData(bins: BinnedSourceDatum[]): IntervalDatum[] {
  return bins.map((bin) => [bin.lower, bin.upper, bin.density, bin.value, bin.label]);
}

function intervalDomain(...seriesGroups: BinnedSourceDatum[][]): [number, number] {
  const bounds = seriesGroups.flatMap((series) => series.flatMap((bin) => [bin.lower, bin.upper]));
  const finite = bounds.filter(Number.isFinite);
  if (finite.length === 0) {
    return [0, 1];
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return Math.abs(max - min) < 1e-12 ? [min, min + 1] : [min, max];
}

function renderIntervalBar(fill: string, stroke: string) {
  return (_params: any, api: any) => {
    const lower = Number(api.value(0));
    const upper = Number(api.value(1));
    const density = Number(api.value(2));
    const topLeft = api.coord([lower, density]);
    const bottomRight = api.coord([upper, 0]);
    const width = Math.max(bottomRight[0] - topLeft[0], 1);
    const height = Math.max(bottomRight[1] - topLeft[1], 0);

    return {
      type: 'rect' as const,
      shape: {
        x: topLeft[0],
        y: topLeft[1],
        width,
        height
      },
      style: api.style({
        fill,
        stroke,
        lineWidth: 1
      })
    };
  };
}

function intervalTooltipFormatter(yAxisName: string) {
  const valueLabel = yAxisName.replace(/\s*\(-\)\s*$/, '').trim() || 'Value';
  return (rawParams: unknown) => {
    const params = Array.isArray(rawParams) ? rawParams[0] : rawParams;
    const row = (params as any)?.data as IntervalDatum | undefined;
    if (!row) {
      return '';
    }
    const label = row[4];
    const value = Number(row[3]);
    const density = Number(row[2]);
    return `${label}<br/>${(params as any).seriesName}: ${formatChartNumber(value)}<br/>${valueLabel} density: ${formatCurveValue(
      density
    )}`;
  };
}

function intervalBinnedOption(
  leftVersion: string,
  rightVersion: string,
  leftBins: BinnedSourceDatum[],
  rightBins: BinnedSourceDatum[],
  xAxisName: string,
  yAxisName: string
): EChartsOption {
  const [xMin, xMax] = intervalDomain(leftBins, rightBins);
  return {
    tooltip: {
      trigger: 'item',
      formatter: intervalTooltipFormatter(yAxisName)
    },
    legend: { top: 0, data: [leftVersion, rightVersion] },
    grid: { left: 78, right: 34, top: 44, bottom: 82, containLabel: true },
    xAxis: {
      type: 'value',
      min: xMin,
      max: xMax,
      name: xAxisName,
      nameLocation: 'middle',
      nameGap: 52,
      nameTextStyle: { fontSize: 12, fontWeight: 600, color: '#495057' },
      axisLabel: {
        formatter: (rawValue: number) => formatAxisTick(Number(rawValue))
      }
    },
    yAxis: {
      type: 'value',
      name: formatDensityAxisTitle(yAxisName),
      nameLocation: 'middle',
      nameGap: 64,
      nameTextStyle: { fontSize: 12, fontWeight: 600, color: '#495057' },
      axisLabel: {
        formatter: (rawValue: number) => formatAxisTick(Number(rawValue))
      }
    },
    series: [
      {
        name: leftVersion,
        type: 'custom',
        clip: true,
        renderItem: renderIntervalBar('rgba(20, 84, 214, 0.32)', 'rgba(20, 84, 214, 0.82)'),
        data: intervalData(leftBins),
        encode: { x: [0, 1], y: 2 },
        z: 1
      },
      {
        name: rightVersion,
        type: 'custom',
        clip: true,
        renderItem: renderIntervalBar('rgba(24, 149, 139, 0.32)', 'rgba(24, 149, 139, 0.82)'),
        data: intervalData(rightBins),
        encode: { x: [0, 1], y: 2 },
        z: 2
      }
    ]
  };
}

function intervalBinnedSingleOption(
  version: string,
  bins: BinnedSourceDatum[],
  xAxisName: string,
  yAxisName: string
): EChartsOption {
  const [xMin, xMax] = intervalDomain(bins);
  return {
    tooltip: {
      trigger: 'item',
      formatter: intervalTooltipFormatter(yAxisName)
    },
    legend: { top: 0, data: [version] },
    grid: { left: 78, right: 34, top: 44, bottom: 82, containLabel: true },
    xAxis: {
      type: 'value',
      min: xMin,
      max: xMax,
      name: xAxisName,
      nameLocation: 'middle',
      nameGap: 52,
      nameTextStyle: { fontSize: 12, fontWeight: 600, color: '#495057' },
      axisLabel: {
        formatter: (rawValue: number) => formatAxisTick(Number(rawValue))
      }
    },
    yAxis: {
      type: 'value',
      name: formatDensityAxisTitle(yAxisName),
      nameLocation: 'middle',
      nameGap: 64,
      nameTextStyle: { fontSize: 12, fontWeight: 600, color: '#495057' },
      axisLabel: {
        formatter: (rawValue: number) => formatAxisTick(Number(rawValue))
      }
    },
    series: [
      {
        name: version,
        type: 'custom',
        clip: true,
        renderItem: renderIntervalBar('rgba(11, 114, 133, 0.42)', 'rgba(11, 114, 133, 0.88)'),
        data: intervalData(bins),
        encode: { x: [0, 1], y: 2 }
      }
    ]
  };
}

export function binnedOption(
  item: CompareResult,
  xAxisName: string,
  yAxisName: string,
  deltaAxisName: string,
  labels?: { leftLabel?: string; rightLabel?: string }
): EChartsOption {
  if (item.visualPayload.type !== 'binned_distribution') {
    return {};
  }

  const leftLabel = labels?.leftLabel ?? item.leftVersion;
  const rightLabel = labels?.rightLabel ?? item.rightVersion;
  if (shouldUseIntervalComparison(item) && item.visualPayload.sourceBins) {
    return intervalBinnedOption(
      leftLabel,
      rightLabel,
      item.visualPayload.sourceBins.left,
      item.visualPayload.sourceBins.right,
      xAxisName,
      yAxisName
    );
  }

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (rawParams: unknown) => {
        const rows = Array.isArray(rawParams) ? rawParams : [rawParams];
        const axis = String((rows[0] as any)?.axisValueLabel ?? (rows[0] as any)?.axisValue ?? '');
        const left = (rows.find((entry: any) => entry.seriesName === leftLabel) as any)?.data ?? 0;
        const right = (rows.find((entry: any) => entry.seriesName === rightLabel) as any)?.data ?? 0;
        const delta = (rows.find((entry: any) => entry.seriesName === 'Delta') as any)?.data ?? 0;
        const leftValue = Number(left);
        const rightValue = Number(right);
        const formatComparisonValue = createCalibrationComparisonFormatter([leftValue, rightValue]);
        return `${axis}<br/>${leftLabel}: ${formatComparisonValue(leftValue)}<br/>${rightLabel}: ${formatComparisonValue(
          rightValue
        )}<br/>Delta: ${formatComparisonValue(Number(delta))}`;
      }
    },
    legend: { top: 0 },
    grid: { left: 78, right: 76, top: 44, bottom: 108, containLabel: true },
    xAxis: {
      type: 'category',
      data: item.visualPayload.bins.map((bin) => bin.label),
      axisLabel: { rotate: 35 },
      name: xAxisName,
      nameLocation: 'middle',
      nameGap: 70,
      nameTextStyle: { fontSize: 12, fontWeight: 600, color: '#495057' }
    },
    yAxis: [
      {
        type: 'value',
        name: yAxisName,
        nameLocation: 'middle',
        nameGap: 64,
        nameTextStyle: { fontSize: 12, fontWeight: 600, color: '#495057' }
      },
      {
        type: 'value',
        name: deltaAxisName,
        position: 'right',
        nameLocation: 'middle',
        nameGap: 64,
        nameTextStyle: { fontSize: 12, fontWeight: 600, color: '#495057' }
      }
    ],
    series: [
      {
        name: leftLabel,
        type: 'bar',
        data: item.visualPayload.bins.map((bin) => bin.left),
        barGap: '-100%',
        itemStyle: { color: 'rgba(20, 84, 214, 0.55)' }
      },
      {
        name: rightLabel,
        type: 'bar',
        data: item.visualPayload.bins.map((bin) => bin.right),
        itemStyle: { color: 'rgba(24, 149, 139, 0.55)' }
      },
      {
        name: 'Delta',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        data: item.visualPayload.bins.map((bin) => bin.delta),
        lineStyle: { color: '#5c7cfa', width: 2 }
      }
    ]
  };
}

export function binnedSingleOption(
  item: Pick<CompareResult | HomePreviewItem, 'visualPayload' | 'rightVersion'>,
  xAxisName: string,
  yAxisName: string,
  versionLabel?: string
): EChartsOption {
  if (item.visualPayload.type !== 'binned_distribution') {
    return {};
  }

  const label = versionLabel ?? item.rightVersion;
  const sourceBins = item.visualPayload.sourceBins?.right;
  if (shouldUseIntervalSingle(item) && sourceBins) {
    return intervalBinnedSingleOption(label, sourceBins, xAxisName, yAxisName);
  }

  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: { left: 78, right: 34, top: 44, bottom: 108, containLabel: true },
    xAxis: {
      type: 'category',
      data: item.visualPayload.bins.map((bin) => bin.label),
      axisLabel: { rotate: 35 },
      name: xAxisName,
      nameLocation: 'middle',
      nameGap: 70,
      nameTextStyle: { fontSize: 12, fontWeight: 600, color: '#495057' }
    },
    yAxis: [
      {
        type: 'value',
        name: yAxisName,
        nameLocation: 'middle',
        nameGap: 64,
        nameTextStyle: { fontSize: 12, fontWeight: 600, color: '#495057' }
      }
    ],
    series: [
      {
        name: label,
        type: 'bar',
        data: item.visualPayload.bins.map((bin) => bin.right),
        itemStyle: { color: 'rgba(11, 114, 133, 0.72)' }
      }
    ]
  };
}

export function jointLayoutOverrides(itemId: string): JointHeatmapLayoutOverrides | undefined {
  void itemId;
  return undefined;
}

export function curveOption(
  leftVersion: string,
  rightVersion: string,
  leftSeries: CurvePoint[],
  rightSeries: CurvePoint[],
  xLabel: string,
  yLabel: string,
  valueFormatter?: (value: number) => string,
  verticalMarkerX?: number,
  verticalMarkerLabel?: string,
  layoutOverrides?: CurveLayoutOverrides,
  legendMarkers?: CurveLegendMarker[]
): EChartsOption {
  const resolvedGridLeft = layoutOverrides?.gridLeft ?? 82;
  const resolvedGridRight = layoutOverrides?.gridRight ?? 36;
  const resolvedYAxisNameGap = layoutOverrides?.yAxisNameGap ?? 58;

  const marker = buildVerticalMarker(
    verticalMarkerX !== undefined ? { x: verticalMarkerX, label: verticalMarkerLabel } : undefined
  );
  const [yMin, yMax] = resolveCurveYExtent([leftSeries, rightSeries]);
  const legendMarkerSeries = buildLegendMarkerSeries(legendMarkers, yMin, yMax);

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (rawParams: unknown) => {
        const rows = Array.isArray(rawParams) ? rawParams : [rawParams];
        const xValue = Number((rows[0] as any)?.axisValue ?? 0);
        const xText = valueFormatter ? valueFormatter(Number(xValue)) : formatChartNumber(Number(xValue));
        const leftSeriesData = (rows.find((entry: any) => entry.seriesName === leftVersion) as any)?.data;
        const rightSeriesData = (rows.find((entry: any) => entry.seriesName === rightVersion) as any)?.data;
        const left = Array.isArray(leftSeriesData) ? Number(leftSeriesData[1]) : 0;
        const right = Array.isArray(rightSeriesData) ? Number(rightSeriesData[1]) : 0;
        const formatComparisonValue = createCurveComparisonFormatter(left, right);
        return `${xLabel}: ${xText}<br/>${leftVersion}: ${formatComparisonValue(left)}<br/>${rightVersion}: ${formatComparisonValue(right)}`;
      }
    },
    legend: { top: 0 },
    grid: { left: resolvedGridLeft, right: resolvedGridRight, top: 44, bottom: 82, containLabel: true },
    xAxis: {
      type: 'value',
      name: xLabel,
      nameLocation: 'middle',
      nameGap: 52,
      nameTextStyle: { fontSize: 12, fontWeight: 600, color: '#495057' }
    },
    yAxis: {
      type: 'value',
      name: yLabel,
      nameLocation: 'middle',
      nameGap: resolvedYAxisNameGap,
      nameTextStyle: { fontSize: 12, fontWeight: 600, color: '#495057' },
      axisLabel: {
        formatter: (rawValue: number) => formatAxisTick(Number(rawValue))
      }
    },
    series: [
      {
        name: leftVersion,
        type: 'line',
        showSymbol: false,
        clip: true,
        smooth: true,
        data: leftSeries.map((point) => [point.x, point.y]),
        lineStyle: { color: '#0b7285', width: 2 }
      },
      {
        name: rightVersion,
        type: 'line',
        showSymbol: false,
        clip: true,
        smooth: true,
        data: rightSeries.map((point) => [point.x, point.y]),
        lineStyle: { color: '#18958b', width: 2 },
        ...(marker ? { markLine: marker } : {})
      },
      ...legendMarkerSeries
    ]
  };
}

export function curveSingleOption(
  version: string,
  series: CurvePoint[],
  xLabel: string,
  yLabel: string,
  valueFormatter?: (value: number) => string,
  verticalMarkerX?: number,
  verticalMarkerLabel?: string,
  layoutOverrides?: CurveLayoutOverrides,
  legendMarkers?: CurveLegendMarker[]
): EChartsOption {
  const resolvedGridLeft = layoutOverrides?.gridLeft ?? 82;
  const resolvedGridRight = layoutOverrides?.gridRight ?? 36;
  const resolvedYAxisNameGap = layoutOverrides?.yAxisNameGap ?? 58;

  const marker =
    verticalMarkerX !== undefined && Number.isFinite(verticalMarkerX)
      ? {
          symbol: 'none',
          silent: true,
          lineStyle: { type: 'dashed' as const, width: 1.5, color: '#495057' },
          label: {
            formatter: verticalMarkerLabel ?? `x=${formatChartNumber(verticalMarkerX)}`,
            position: 'insideEndTop' as const,
            color: '#495057'
          },
          data: [{ xAxis: verticalMarkerX }]
        }
      : undefined;
  const [yMin, yMax] = resolveCurveYExtent([series]);
  const legendMarkerSeries = buildLegendMarkerSeries(legendMarkers, yMin, yMax);

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (rawParams: unknown) => {
        const rows = Array.isArray(rawParams) ? rawParams : [rawParams];
        const xValue = Number((rows[0] as any)?.axisValue ?? 0);
        const xText = valueFormatter ? valueFormatter(Number(xValue)) : formatChartNumber(Number(xValue));
        const seriesData = (rows.find((entry: any) => entry.seriesName === version) as any)?.data;
        const value = Array.isArray(seriesData) ? Number(seriesData[1]) : 0;
        return `${xLabel}: ${xText}<br/>${version}: ${formatCurveValue(value)}`;
      }
    },
    legend: { top: 0 },
    grid: { left: resolvedGridLeft, right: resolvedGridRight, top: 44, bottom: 82, containLabel: true },
    xAxis: {
      type: 'value',
      name: xLabel,
      nameLocation: 'middle',
      nameGap: 52,
      nameTextStyle: { fontSize: 12, fontWeight: 600, color: '#495057' }
    },
    yAxis: {
      type: 'value',
      name: yLabel,
      nameLocation: 'middle',
      nameGap: resolvedYAxisNameGap,
      nameTextStyle: { fontSize: 12, fontWeight: 600, color: '#495057' },
      axisLabel: {
        formatter: (rawValue: number) => formatAxisTick(Number(rawValue))
      }
    },
    series: [
      {
        name: version,
        type: 'line',
        showSymbol: false,
        clip: true,
        smooth: true,
        data: series.map((point) => [point.x, point.y]),
        lineStyle: { color: '#0b7285', width: 2 },
        ...(marker ? { markLine: marker } : {})
      },
      ...legendMarkerSeries
    ]
  };
}
