import fs from 'node:fs';
import { PARAMETER_CATALOG } from '../../shared/catalog';
import type {
  AxisScaleType,
  BinnedDatum,
  BinnedSourceDatum,
  CompareResult,
  CompareResponse,
  CurvePoint,
  DerivedScalarMeta,
  JointCell,
  JointPayload,
  ParameterCardMeta,
  ScalarDatum,
  ValidationOverviewPayload,
  VersionChangeOrigin,
  VisualPayload
} from '../../shared/types';
import {
  getConfigPath,
  getNumericConfigValue,
  parseConfigFile,
  readNumericCsvRows,
  resolveConfigDataFilePath,
  resolveVersionPath
} from './io';
import { compareVersions, listVersions } from './versioning';
import {
  loadDashboardInputVersionHistory,
  type DashboardInputVersionHistoryEntry
} from './dashboardInputVersionHistory';
import { getValidationOverview as getTrackedValidationOverview } from './validationSummaries';
import {
  buildLatestSourceTagsByKey,
  parseConfigWithComments,
  resolveDatasetAttributions
} from './datasetAttribution';
import {
  formatRuntimePath,
  resolveRuntimePaths,
  type RuntimePathInput,
  type RuntimePaths
} from './runtimePaths';

const EPSILON = 1e-12;
export type ProvenanceScope = 'range' | 'through_right';

interface CompareContext {
  runtimePaths: RuntimePaths;
  leftVersion: string;
  rightVersion: string;
  leftConfig: Map<string, string>;
  rightConfig: Map<string, string>;
  leftConfigDetails: Map<string, { value: string; comment: string }>;
  rightConfigDetails: Map<string, { value: string; comment: string }>;
  leftFallbackTagsByKey: Map<string, string[]>;
  rightFallbackTagsByKey: Map<string, string[]>;
  dashboardInputVersionHistory: DashboardInputVersionHistoryEntry[];
  provenanceScope: ProvenanceScope;
}

type VisualContext = Pick<CompareContext, 'runtimePaths' | 'leftVersion' | 'rightVersion' | 'leftConfig' | 'rightConfig'>;

interface StepRateRow {
  threshold: number;
  rate: number;
}

function asRelative(paths: RuntimePaths, absolutePath: string): string {
  return formatRuntimePath(paths, absolutePath);
}

function deltaStat(left: number, right: number) {
  const absolute = right - left;
  const percent = Math.abs(left) < EPSILON ? null : (absolute / left) * 100;
  return { absolute, percent };
}

function pairStat(left: number, right: number) {
  return {
    left,
    right,
    delta: deltaStat(left, right)
  };
}

function isNearlyZero(value: number): boolean {
  return Math.abs(value) < EPSILON;
}

function scalarRows(keys: string[], leftConfig: Map<string, string>, rightConfig: Map<string, string>): ScalarDatum[] {
  return keys.map((key) => {
    const left = getNumericConfigValue(leftConfig, key);
    const right = getNumericConfigValue(rightConfig, key);
    return {
      key,
      left,
      right,
      delta: deltaStat(left, right)
    };
  });
}

function derivedScalarValue(derived: DerivedScalarMeta, config: Map<string, string>): number {
  switch (derived.expression) {
    case 'btl_mixed_probability': {
      if (derived.sourceConfigKeys.length !== 2) {
        throw new Error(`Derived scalar ${derived.key} expects exactly two source config keys`);
      }
      const [incomeDrivenKey, capitalDrivenKey] = derived.sourceConfigKeys;
      return 1 - getNumericConfigValue(config, incomeDrivenKey) - getNumericConfigValue(config, capitalDrivenKey);
    }
  }
}

function derivedScalarRows(
  derivedScalars: DerivedScalarMeta[] | undefined,
  leftConfig: Map<string, string>,
  rightConfig: Map<string, string>
): ScalarDatum[] {
  return (derivedScalars ?? []).map((derived) => {
    const left = derivedScalarValue(derived, leftConfig);
    const right = derivedScalarValue(derived, rightConfig);
    return {
      key: derived.key,
      left,
      right,
      delta: deltaStat(left, right)
    };
  });
}

function scalarRowsForMeta(
  meta: ParameterCardMeta,
  leftConfig: Map<string, string>,
  rightConfig: Map<string, string>
): ScalarDatum[] {
  return [
    ...scalarRows(meta.configKeys, leftConfig, rightConfig),
    ...derivedScalarRows(meta.derivedScalars, leftConfig, rightConfig)
  ];
}

function intersects(left: string[], right: string[]): boolean {
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}

function toChangeOriginsInRange(context: CompareContext, meta: ParameterCardMeta): VersionChangeOrigin[] {
  const includeByScope = (entry: DashboardInputVersionHistoryEntry): boolean => {
    if (context.provenanceScope === 'through_right') {
      return compareVersions(entry.snapshot_folder, context.rightVersion) <= 0;
    }
    return (
      compareVersions(entry.snapshot_folder, context.leftVersion) > 0 &&
      compareVersions(entry.snapshot_folder, context.rightVersion) <= 0
    );
  };

  return context.dashboardInputVersionHistory
    .filter(
      (entry) =>
        includeByScope(entry) &&
        intersects(meta.configKeys, entry.config_parameters)
    )
    .map((entry) => ({
      versionId: entry.version_id,
      description: entry.description,
      updatedDataSources: entry.updated_data_sources,
      calibrationFiles: entry.calibration_files,
      configParameters: entry.config_parameters,
      parameterChanges: entry.parameter_changes.map((change) => ({
        configParameter: change.config_parameter,
        datasetSource: change.dataset_source
      })),
      validationStatus: entry.validation.status,
      methodVariations: entry.method_variations
        .filter((variation) => intersects(meta.configKeys, variation.config_parameters))
        .map((variation) => ({
          configParameters: variation.config_parameters,
          improvementSummary: variation.improvement_summary,
          whyChanged: variation.why_changed,
          methodChosen: variation.method_chosen,
          decisionLogic: variation.decision_logic
        }))
    }));
}

function formatThreshold(value: number): string {
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString('en-GB', { maximumFractionDigits: 0 });
  }
  if (Math.abs(value) >= 1) {
    return value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  }
  return value.toLocaleString('en-GB', { maximumFractionDigits: 4 });
}

function normalizeStepRateRows(rows: number[][]): StepRateRow[] {
  const deduped = new Map<number, number>();
  for (const row of rows) {
    if (row.length < 2) {
      continue;
    }
    const threshold = row[0];
    const rate = row[1];
    if (!Number.isFinite(threshold) || !Number.isFinite(rate)) {
      continue;
    }
    deduped.set(threshold, rate);
  }

  return [...deduped.entries()]
    .map(([threshold, rate]) => ({ threshold, rate }))
    .sort((a, b) => a.threshold - b.threshold);
}

function rateAt(thresholdRows: StepRateRow[], value: number): number {
  if (thresholdRows.length === 0) {
    return 0;
  }
  let activeRate = 0;
  for (const row of thresholdRows) {
    if (value < row.threshold) {
      break;
    }
    activeRate = row.rate;
  }
  return activeRate;
}

function buildStepRateComparison(leftRows: number[][], rightRows: number[][]): BinnedDatum[] {
  const left = normalizeStepRateRows(leftRows);
  const right = normalizeStepRateRows(rightRows);

  const breakpoints = [...new Set([0, ...left.map((row) => row.threshold), ...right.map((row) => row.threshold)])]
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (breakpoints.length === 0) {
    return [];
  }

  return breakpoints.map((lower, index) => {
    const upper = breakpoints[index + 1];
    const leftRate = rateAt(left, lower);
    const rightRate = rateAt(right, lower);
    const isOpenEnded = upper === undefined;
    return {
      label: isOpenEnded ? `>=${formatThreshold(lower)}` : `${formatThreshold(lower)}-${formatThreshold(upper)}`,
      lower,
      upper: isOpenEnded ? lower : upper,
      left: leftRate,
      right: rightRate,
      delta: rightRate - leftRate
    };
  });
}

interface BinnedMassRow {
  lower: number;
  upper: number;
  value: number;
}

interface BinnedComparisonPayload {
  bins: BinnedDatum[];
  sourceBins: {
    left: BinnedSourceDatum[];
    right: BinnedSourceDatum[];
  };
}

type BinnedValueMode = 'mass' | 'density';

interface JointMassCell {
  xLower: number;
  xUpper: number;
  yLower: number;
  yUpper: number;
  value: number;
}

function normalizeBinnedRows(rows: number[][]): BinnedMassRow[] {
  if (rows.length === 0) {
    return [];
  }

  if (rows[0].length >= 3) {
    return rows.map((row) => ({
      lower: row[0],
      upper: row[1],
      value: row[2]
    }));
  }

  return rows.map((row, index) => {
    const lower = row[0];
    const upper = rows[index + 1]?.[0] ?? row[0];
    return {
      lower,
      upper,
      value: row[1]
    };
  });
}

function buildSourceBins(
  rows: BinnedMassRow[],
  scaleType: AxisScaleType = 'linear',
  valueMode: BinnedValueMode = 'mass'
): BinnedSourceDatum[] {
  const linearKind = inferLinearAxisKind(extractEdgesFromBins(rows));
  return rows.map((row) => {
    const width = row.upper - row.lower;
    const value = valueMode === 'density' ? row.value * width : row.value;
    return {
      label: formatBandLabel(row.lower, row.upper, scaleType, linearKind),
      lower: row.lower,
      upper: row.upper,
      value,
      density: valueMode === 'density' ? row.value : width > EPSILON ? row.value / width : 0
    };
  });
}

function normalizeJointRows(rows: number[][]): JointMassCell[] {
  return rows
    .filter((row) => row.length >= 5)
    .map((row) => ({
      xLower: row[0],
      xUpper: row[1],
      yLower: row[2],
      yUpper: row[3],
      value: row[4]
    }));
}

function extractEdgesFromBins(bins: BinnedMassRow[]): number[] {
  const values = bins.flatMap((bin) => [bin.lower, bin.upper]).filter(Number.isFinite);
  const uniqueSorted = [...new Set(values)].sort((a, b) => a - b);
  return uniqueSorted;
}

function extractEdgesFromJoint(cells: JointMassCell[], axis: 'x' | 'y'): number[] {
  const values =
    axis === 'x'
      ? cells.flatMap((cell) => [cell.xLower, cell.xUpper])
      : cells.flatMap((cell) => [cell.yLower, cell.yUpper]);
  return [...new Set(values.filter(Number.isFinite))].sort((a, b) => a - b);
}

function inferLinearAxisKind(edges: number[]): 'age' | 'percentile' | 'generic' {
  const min = edges[0];
  const max = edges[edges.length - 1];
  if (min >= 0 && max <= 1.2) {
    return 'percentile';
  }
  if (min >= 10 && max <= 120) {
    return 'age';
  }
  return 'generic';
}

function formatCompactNumber(value: number): string {
  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat('en-GB', {
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(value);
  }
  if (Math.abs(value) >= 1) {
    return value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  }
  return value.toLocaleString('en-GB', { maximumFractionDigits: 4 });
}

function formatCurrencyCompact(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `£${new Intl.NumberFormat('en-GB', {
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(value)}`;
  }
  return `£${value.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

function formatBound(value: number, scaleType: AxisScaleType, linearKind: 'age' | 'percentile' | 'generic'): string {
  if (scaleType === 'log') {
    return formatCurrencyCompact(Math.exp(value));
  }

  if (linearKind === 'age') {
    return `${Math.round(value)}`;
  }
  if (linearKind === 'percentile') {
    return value.toFixed(2);
  }
  return formatCompactNumber(value);
}

function formatBandLabel(
  lower: number,
  upper: number,
  scaleType: AxisScaleType,
  linearKind: 'age' | 'percentile' | 'generic'
): string {
  return `${formatBound(lower, scaleType, linearKind)}-${formatBound(upper, scaleType, linearKind)}`;
}

function buildSharedAxis(
  edgesLeft: number[],
  edgesRight: number[],
  scaleType: AxisScaleType,
  targetBinCount: number
): { edges: number[]; labels: string[]; scaleType: AxisScaleType } {
  const min = Math.min(...edgesLeft, ...edgesRight);
  let max = Math.max(...edgesLeft, ...edgesRight);
  const bins = Math.max(targetBinCount, 1);

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error('Invalid axis domain for shared bin alignment');
  }

  if (Math.abs(max - min) < EPSILON) {
    max = min + 1;
  }

  const step = (max - min) / bins;
  const edges = Array.from({ length: bins + 1 }, (_, index) => min + step * index);
  edges[0] = min;
  edges[edges.length - 1] = max;

  const linearKind = inferLinearAxisKind(edges);
  const labels = edges.slice(0, -1).map((lower, index) => {
    const upper = edges[index + 1];
    return formatBandLabel(lower, upper, scaleType, linearKind);
  });

  return {
    edges,
    labels,
    scaleType
  };
}

function rebin1DMass(
  source: BinnedMassRow[],
  targetEdges: number[],
  valueMode: BinnedValueMode = 'mass'
): number[] {
  const target = Array.from({ length: targetEdges.length - 1 }, () => 0);

  for (const src of source) {
    const srcWidth = src.upper - src.lower;
    if (srcWidth <= EPSILON) {
      continue;
    }
    for (let i = 0; i < target.length; i += 1) {
      const overlapLower = Math.max(src.lower, targetEdges[i]);
      const overlapUpper = Math.min(src.upper, targetEdges[i + 1]);
      const overlap = overlapUpper - overlapLower;
      if (overlap > EPSILON) {
        target[i] += valueMode === 'density' ? src.value * overlap : src.value * (overlap / srcWidth);
      }
    }
  }

  return target;
}

function rebin2DMass(source: JointMassCell[], targetXEdges: number[], targetYEdges: number[]): number[] {
  const xBins = targetXEdges.length - 1;
  const yBins = targetYEdges.length - 1;
  const target = Array.from({ length: xBins * yBins }, () => 0);

  for (const src of source) {
    const srcWidthX = src.xUpper - src.xLower;
    const srcWidthY = src.yUpper - src.yLower;
    if (srcWidthX <= EPSILON || srcWidthY <= EPSILON) {
      continue;
    }

    for (let xi = 0; xi < xBins; xi += 1) {
      const overlapX = Math.min(src.xUpper, targetXEdges[xi + 1]) - Math.max(src.xLower, targetXEdges[xi]);
      if (overlapX <= EPSILON) {
        continue;
      }
      const ratioX = overlapX / srcWidthX;

      for (let yi = 0; yi < yBins; yi += 1) {
        const overlapY = Math.min(src.yUpper, targetYEdges[yi + 1]) - Math.max(src.yLower, targetYEdges[yi]);
        if (overlapY <= EPSILON) {
          continue;
        }
        const ratioY = overlapY / srcWidthY;
        target[xi * yBins + yi] += src.value * ratioX * ratioY;
      }
    }
  }

  return target;
}

function buildBinnedComparison(
  leftRows: number[][],
  rightRows: number[][],
  scaleType: AxisScaleType = 'linear',
  valueMode: BinnedValueMode = 'mass'
): BinnedComparisonPayload {
  const left = normalizeBinnedRows(leftRows);
  const right = normalizeBinnedRows(rightRows);
  const leftEdges = extractEdgesFromBins(left);
  const rightEdges = extractEdgesFromBins(right);
  const leftCount = Math.max(leftEdges.length - 1, 1);
  const rightCount = Math.max(rightEdges.length - 1, 1);

  const axis = buildSharedAxis(leftEdges, rightEdges, scaleType, Math.max(leftCount, rightCount));
  const leftMass = rebin1DMass(left, axis.edges, valueMode);
  const rightMass = rebin1DMass(right, axis.edges, valueMode);

  const bins = axis.edges.slice(0, -1).map((lower, index) => {
    const upper = axis.edges[index + 1];
    const leftValue = leftMass[index] ?? 0;
    const rightValue = rightMass[index] ?? 0;
    return {
      label: axis.labels[index],
      lower,
      upper,
      left: leftValue,
      right: rightValue,
      delta: rightValue - leftValue
    };
  });

  return {
    bins,
    sourceBins: {
      left: buildSourceBins(left, scaleType, valueMode),
      right: buildSourceBins(right, scaleType, valueMode)
    }
  };
}

function buildJointPayload(
  leftRows: number[][],
  rightRows: number[][],
  xScaleType: AxisScaleType,
  yScaleType: AxisScaleType
): JointPayload {
  const left = normalizeJointRows(leftRows);
  const right = normalizeJointRows(rightRows);

  const xLeftEdges = extractEdgesFromJoint(left, 'x');
  const xRightEdges = extractEdgesFromJoint(right, 'x');
  const yLeftEdges = extractEdgesFromJoint(left, 'y');
  const yRightEdges = extractEdgesFromJoint(right, 'y');

  const xAxis = buildSharedAxis(
    xLeftEdges,
    xRightEdges,
    xScaleType,
    Math.max(xLeftEdges.length - 1, xRightEdges.length - 1, 1)
  );
  const yAxis = buildSharedAxis(
    yLeftEdges,
    yRightEdges,
    yScaleType,
    Math.max(yLeftEdges.length - 1, yRightEdges.length - 1, 1)
  );

  const leftMass = rebin2DMass(left, xAxis.edges, yAxis.edges);
  const rightMass = rebin2DMass(right, xAxis.edges, yAxis.edges);

  const xBins = xAxis.edges.length - 1;
  const yBins = yAxis.edges.length - 1;

  const cellsLeft: JointCell[] = [];
  const cellsRight: JointCell[] = [];
  const cellsDelta: JointCell[] = [];

  for (let xIndex = 0; xIndex < xBins; xIndex += 1) {
    for (let yIndex = 0; yIndex < yBins; yIndex += 1) {
      const flatIndex = xIndex * yBins + yIndex;
      const leftValue = leftMass[flatIndex] ?? 0;
      const rightValue = rightMass[flatIndex] ?? 0;
      cellsLeft.push({ xIndex, yIndex, value: leftValue });
      cellsRight.push({ xIndex, yIndex, value: rightValue });
      cellsDelta.push({ xIndex, yIndex, value: rightValue - leftValue });
    }
  }

  return {
    xAxis,
    yAxis,
    left: cellsLeft,
    right: cellsRight,
    delta: cellsDelta
  };
}

function lognormalPdf(x: number, mu: number, sigma: number): number {
  if (x <= 0 || sigma <= 0) {
    return 0;
  }
  const denom = x * sigma * Math.sqrt(2 * Math.PI);
  const exponent = -((Math.log(x) - mu) ** 2) / (2 * sigma ** 2);
  return Math.exp(exponent) / denom;
}

function normalPdf(x: number, mu: number, sigma: number): number {
  if (sigma <= 0) {
    return 0;
  }
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absX);
  const poly = (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t);
  return sign * (1 - poly * Math.exp(-absX * absX));
}

function normalCdf(x: number, mu: number, sigma: number): number {
  if (sigma <= 0) {
    return x < mu ? 0 : 1;
  }
  const z = (x - mu) / (sigma * Math.sqrt(2));
  return 0.5 * (1 + erf(z));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function linearRange(min: number, max: number, points: number): number[] {
  if (points <= 1) {
    return [min];
  }
  return Array.from({ length: points }, (_, index) => {
    const t = index / (points - 1);
    return min + t * (max - min);
  });
}

function geometricRange(minValue: number, maxValue: number, points: number): number[] {
  const safeMin = Math.max(minValue, EPSILON);
  const safeMax = Math.max(maxValue, safeMin * 1.0001);
  const logMin = Math.log(safeMin);
  const logMax = Math.log(safeMax);

  return Array.from({ length: points }, (_, index) => {
    const t = index / (points - 1);
    return Math.exp(logMin + t * (logMax - logMin));
  });
}

function buildGaussianCurves(muLeft: number, sigmaLeft: number, muRight: number, sigmaRight: number) {
  const safeSigmaLeft = Math.max(sigmaLeft, EPSILON);
  const safeSigmaRight = Math.max(sigmaRight, EPSILON);
  const min = Math.min(muLeft - 4 * safeSigmaLeft, muRight - 4 * safeSigmaRight);
  const max = Math.max(muLeft + 4 * safeSigmaLeft, muRight + 4 * safeSigmaRight);
  const xs = linearRange(min, max, 180);
  const percentCap = 50;
  const logPercentCap = Math.log(percentCap);
  const percentMin = Math.min(Math.exp(min), percentCap * 0.999);
  const percents = geometricRange(percentMin, percentCap, 180);

  const logCurveLeft: CurvePoint[] = xs.map((x) => ({ x, y: normalPdf(x, muLeft, safeSigmaLeft) }));
  const logCurveRight: CurvePoint[] = xs.map((x) => ({ x, y: normalPdf(x, muRight, safeSigmaRight) }));

  const percentCurveLeft: CurvePoint[] = percents.map((percent) => {
    return {
      x: percent,
      y: lognormalPdf(percent, muLeft, safeSigmaLeft)
    };
  });

  const percentCurveRight: CurvePoint[] = percents.map((percent) => {
    return {
      x: percent,
      y: lognormalPdf(percent, muRight, safeSigmaRight)
    };
  });

  const percentDomain = {
    min: Math.min(...percentCurveLeft.map((point) => point.x), ...percentCurveRight.map((point) => point.x)),
    max: percentCap
  };
  const percentCapMassLeft = clamp01(1 - normalCdf(logPercentCap, muLeft, safeSigmaLeft));
  const percentCapMassRight = clamp01(1 - normalCdf(logPercentCap, muRight, safeSigmaRight));
  const logMedian = pairStat(muLeft, muRight);
  const percentMedian = pairStat(Math.exp(muLeft), Math.exp(muRight));

  return {
    logDomain: { min, max },
    percentDomain,
    percentCap,
    percentCapMassLeft,
    percentCapMassRight,
    logMedian,
    percentMedian,
    logCurveLeft,
    logCurveRight,
    percentCurveLeft,
    percentCurveRight
  };
}

function buildHpaExpectationLines(
  factorLeft: number,
  constLeft: number,
  factorRight: number,
  constRight: number
) {
  const dt = 1;
  const domain = { min: -0.2, max: 0.2 };
  const xs = linearRange(domain.min, domain.max, 180);
  const curveLeft: CurvePoint[] = xs.map((x) => ({ x, y: factorLeft * dt * x + constLeft }));
  const curveRight: CurvePoint[] = xs.map((x) => ({ x, y: factorRight * dt * x + constRight }));
  return { domain, dt, curveLeft, curveRight };
}

function deriveIncomeDomain(context: VisualContext): { min: number; max: number } {
  const ranges: Array<{ min: number; max: number }> = [];

  for (const side of [
    { version: context.leftVersion, config: context.leftConfig },
    { version: context.rightVersion, config: context.rightConfig }
  ]) {
    const dataPath = side.config.get('DATA_INCOME_GIVEN_AGE');
    if (!dataPath) {
      continue;
    }

    const absolute = resolveConfigDataFilePath(context.runtimePaths, side.version, dataPath);
    if (!fs.existsSync(absolute)) {
      continue;
    }

    const rows = readNumericCsvRows(absolute).filter((row) => row.length >= 4);
    if (rows.length === 0) {
      continue;
    }

    const minLog = Math.min(...rows.map((row) => row[2]));
    const maxLog = Math.max(...rows.map((row) => row[3]));
    ranges.push({ min: Math.exp(minLog), max: Math.exp(maxLog) });
  }

  if (ranges.length === 0) {
    return { min: 10_000, max: 250_000 };
  }

  return {
    min: Math.max(1_000, Math.min(...ranges.map((r) => r.min))),
    max: Math.max(...ranges.map((r) => r.max))
  };
}

function buildLognormalCurves(muLeft: number, sigmaLeft: number, muRight: number, sigmaRight: number) {
  const min = Math.exp(Math.min(muLeft - 3 * sigmaLeft, muRight - 3 * sigmaRight));
  const max = Math.exp(Math.max(muLeft + 3 * sigmaLeft, muRight + 3 * sigmaRight));
  const xs = geometricRange(min, max, 180);

  const curveLeft: CurvePoint[] = xs.map((x) => ({ x, y: lognormalPdf(x, muLeft, sigmaLeft) }));
  const curveRight: CurvePoint[] = xs.map((x) => ({ x, y: lognormalPdf(x, muRight, sigmaRight) }));
  const median = pairStat(Math.exp(muLeft), Math.exp(muRight));

  return {
    domain: { min, max },
    median,
    curveLeft,
    curveRight
  };
}

function getBinnedScaleType(parameterId: string): AxisScaleType {
  switch (parameterId) {
    case 'btl_probability_bins':
    case 'age_distribution':
    case 'national_insurance_rates':
    case 'income_tax_rates':
      return 'linear';
    default:
      return 'linear';
  }
}

function getBinnedValueMode(parameterId: string): BinnedValueMode {
  return parameterId === 'age_distribution' ? 'density' : 'mass';
}

function useStepRateComparison(parameterId: string): boolean {
  return parameterId === 'national_insurance_rates' || parameterId === 'income_tax_rates';
}

function getJointAxisScaleTypes(parameterId: string): { xScaleType: AxisScaleType; yScaleType: AxisScaleType } {
  switch (parameterId) {
    case 'income_given_age_joint':
      return { xScaleType: 'linear', yScaleType: 'log' };
    case 'wealth_given_income_joint':
      return { xScaleType: 'log', yScaleType: 'log' };
    default:
      return { xScaleType: 'linear', yScaleType: 'linear' };
  }
}

function createSourceInfo(context: CompareContext, meta: ParameterCardMeta) {
  const leftFiles = (meta.dataFileConfigKeys ?? [])
    .map((key) => context.leftConfig.get(key))
    .filter((value): value is string => Boolean(value))
    .map((value) => resolveConfigDataFilePath(context.runtimePaths, context.leftVersion, value))
    .filter((absolutePath) => fs.existsSync(absolutePath))
    .map((absolutePath) => asRelative(context.runtimePaths, absolutePath));

  const rightFiles = (meta.dataFileConfigKeys ?? [])
    .map((key) => context.rightConfig.get(key))
    .filter((value): value is string => Boolean(value))
    .map((value) => resolveConfigDataFilePath(context.runtimePaths, context.rightVersion, value))
    .filter((absolutePath) => fs.existsSync(absolutePath))
    .map((absolutePath) => asRelative(context.runtimePaths, absolutePath));

  return {
    configPathLeft: asRelative(context.runtimePaths, getConfigPath(context.runtimePaths, context.leftVersion)),
    configPathRight: asRelative(context.runtimePaths, getConfigPath(context.runtimePaths, context.rightVersion)),
    configKeys: meta.configKeys,
    dataFilesLeft: leftFiles,
    dataFilesRight: rightFiles,
    datasetsLeft: resolveDatasetAttributions({
      configKeys: meta.configKeys,
      configDetails: context.leftConfigDetails,
      fallbackTagsByKey: context.leftFallbackTagsByKey
    }),
    datasetsRight: resolveDatasetAttributions({
      configKeys: meta.configKeys,
      configDetails: context.rightConfigDetails,
      fallbackTagsByKey: context.rightFallbackTagsByKey
    })
  };
}

function ensureVersionExists(paths: RuntimePaths, version: string): void {
  const versionPath = resolveVersionPath(paths, version);
  if (!fs.existsSync(versionPath)) {
    throw new Error(`Unknown version: ${version}`);
  }
}

function buildVisualComparison(
  context: VisualContext,
  meta: ParameterCardMeta
): { unchanged: boolean; visualPayload: VisualPayload } {
  switch (meta.format) {
    case 'scalar': {
      const values = scalarRowsForMeta(meta, context.leftConfig, context.rightConfig);
      return {
        unchanged: values.every((value) => isNearlyZero(value.delta.absolute)),
        visualPayload: {
          type: 'scalar',
          values
        }
      };
    }

    case 'scalar_pair': {
      const values = scalarRowsForMeta(meta, context.leftConfig, context.rightConfig);
      return {
        unchanged: values.every((value) => isNearlyZero(value.delta.absolute)),
        visualPayload: {
          type: 'scalar',
          values
        }
      };
    }

    case 'binned_distribution': {
      const key = meta.dataFileConfigKeys?.[0];
      if (!key) {
        throw new Error(`Missing data file key mapping for ${meta.id}`);
      }
      const leftFileConfig = context.leftConfig.get(key);
      const rightFileConfig = context.rightConfig.get(key);
      if (!leftFileConfig || !rightFileConfig) {
        throw new Error(`Missing file config value for ${meta.id}`);
      }

      const leftRows = readNumericCsvRows(
        resolveConfigDataFilePath(context.runtimePaths, context.leftVersion, leftFileConfig)
      );
      const rightRows = readNumericCsvRows(
        resolveConfigDataFilePath(context.runtimePaths, context.rightVersion, rightFileConfig)
      );
      if (useStepRateComparison(meta.id)) {
        const bins = buildStepRateComparison(leftRows, rightRows);
        return {
          unchanged: bins.every((bin) => isNearlyZero(bin.delta)),
          visualPayload: {
            type: 'binned_distribution',
            bins
          }
        };
      }

      const comparison = buildBinnedComparison(
        leftRows,
        rightRows,
        getBinnedScaleType(meta.id),
        getBinnedValueMode(meta.id)
      );

      return {
        unchanged: comparison.bins.every((bin) => isNearlyZero(bin.delta)),
        visualPayload: {
          type: 'binned_distribution',
          bins: comparison.bins,
          sourceBins: comparison.sourceBins
        }
      };
    }

    case 'joint_distribution': {
      const key = meta.dataFileConfigKeys?.[0];
      if (!key) {
        throw new Error(`Missing data file key mapping for ${meta.id}`);
      }
      const leftFileConfig = context.leftConfig.get(key);
      const rightFileConfig = context.rightConfig.get(key);
      if (!leftFileConfig || !rightFileConfig) {
        throw new Error(`Missing file config value for ${meta.id}`);
      }

      const leftRows = readNumericCsvRows(
        resolveConfigDataFilePath(context.runtimePaths, context.leftVersion, leftFileConfig)
      );
      const rightRows = readNumericCsvRows(
        resolveConfigDataFilePath(context.runtimePaths, context.rightVersion, rightFileConfig)
      );

      const { xScaleType, yScaleType } = getJointAxisScaleTypes(meta.id);
      const matrix = buildJointPayload(leftRows, rightRows, xScaleType, yScaleType);

      return {
        unchanged: matrix.delta.every((cell) => isNearlyZero(cell.value)),
        visualPayload: {
          type: 'joint_distribution',
          matrix
        }
      };
    }

    case 'lognormal_pair': {
      if (meta.configKeys.length !== 2) {
        throw new Error(`Expected two config keys for lognormal pair: ${meta.id}`);
      }
      const values = scalarRows(meta.configKeys, context.leftConfig, context.rightConfig);

      const muLeft = values[0].left;
      const sigmaLeft = values[1].left;
      const muRight = values[0].right;
      const sigmaRight = values[1].right;

      const curves = buildLognormalCurves(muLeft, sigmaLeft, muRight, sigmaRight);

      return {
        unchanged: values.every((value) => isNearlyZero(value.delta.absolute)),
        visualPayload: {
          type: 'lognormal_pair',
          parameters: values,
          curveLeft: curves.curveLeft,
          curveRight: curves.curveRight,
          median: curves.median,
          domain: curves.domain
        }
      };
    }

    case 'power_law_pair': {
      if (meta.configKeys.length !== 2) {
        throw new Error(`Expected two config keys for power-law pair: ${meta.id}`);
      }
      const values = scalarRows(meta.configKeys, context.leftConfig, context.rightConfig);
      const domain = deriveIncomeDomain(context);
      const xs = geometricRange(domain.min, domain.max, 180);

      const scaleLeft = values[0].left;
      const exponentLeft = values[1].left;
      const scaleRight = values[0].right;
      const exponentRight = values[1].right;

      const curveLeft = xs.map((x) => ({ x, y: scaleLeft * x ** exponentLeft }));
      const curveRight = xs.map((x) => ({ x, y: scaleRight * x ** exponentRight }));

      return {
        unchanged: values.every((value) => isNearlyZero(value.delta.absolute)),
        visualPayload: {
          type: 'power_law_pair',
          parameters: values,
          curveLeft,
          curveRight,
          domain
        }
      };
    }

    case 'gaussian_pair': {
      if (meta.configKeys.length !== 2) {
        throw new Error(`Expected two config keys for gaussian pair: ${meta.id}`);
      }
      const values = scalarRows(meta.configKeys, context.leftConfig, context.rightConfig);
      const curves = buildGaussianCurves(values[0].left, values[1].left, values[0].right, values[1].right);

      return {
        unchanged: values.every((value) => isNearlyZero(value.delta.absolute)),
        visualPayload: {
          type: 'gaussian_pair',
          parameters: values,
          logCurveLeft: curves.logCurveLeft,
          logCurveRight: curves.logCurveRight,
          percentCurveLeft: curves.percentCurveLeft,
          percentCurveRight: curves.percentCurveRight,
          logDomain: curves.logDomain,
          percentDomain: curves.percentDomain,
          percentCap: curves.percentCap,
          percentCapMassLeft: curves.percentCapMassLeft,
          percentCapMassRight: curves.percentCapMassRight,
          logMedian: curves.logMedian,
          percentMedian: curves.percentMedian
        }
      };
    }

    case 'hpa_expectation_line': {
      if (meta.configKeys.length !== 2) {
        throw new Error(`Expected two config keys for hpa expectation line: ${meta.id}`);
      }
      const values = scalarRows(meta.configKeys, context.leftConfig, context.rightConfig);
      const lines = buildHpaExpectationLines(values[0].left, values[1].left, values[0].right, values[1].right);

      return {
        unchanged: values.every((value) => isNearlyZero(value.delta.absolute)),
        visualPayload: {
          type: 'hpa_expectation_line',
          parameters: values,
          curveLeft: lines.curveLeft,
          curveRight: lines.curveRight,
          domain: lines.domain,
          dt: lines.dt
        }
      };
    }

    case 'buy_quad': {
      if (meta.configKeys.length !== 4) {
        throw new Error(`Expected four config keys for buy-quad: ${meta.id}`);
      }
      const values = scalarRows(meta.configKeys, context.leftConfig, context.rightConfig);
      const domain = deriveIncomeDomain(context);
      const xs = geometricRange(domain.min, domain.max, 180);

      const [scale, exponent, mu, sigma] = values;

      const budgetLeft = xs.map((x) => ({ x, y: scale.left * x ** exponent.left }));
      const budgetRight = xs.map((x) => ({ x, y: scale.right * x ** exponent.right }));

      const multiplierMin = Math.exp(Math.min(mu.left - 3 * sigma.left, mu.right - 3 * sigma.right));
      const multiplierMax = Math.exp(Math.max(mu.left + 3 * sigma.left, mu.right + 3 * sigma.right));
      const multiplierXs = geometricRange(multiplierMin, multiplierMax, 180);

      const multiplierLeft = multiplierXs.map((x) => ({ x, y: lognormalPdf(x, mu.left, sigma.left) }));
      const multiplierRight = multiplierXs.map((x) => ({ x, y: lognormalPdf(x, mu.right, sigma.right) }));

      const medianLeft = Math.exp(mu.left);
      const medianRight = Math.exp(mu.right);
      const expectedLeft = Math.exp(mu.left + 0.5 * sigma.left ** 2);
      const expectedRight = Math.exp(mu.right + 0.5 * sigma.right ** 2);

      return {
        unchanged: values.every((value) => isNearlyZero(value.delta.absolute)),
        visualPayload: {
          type: 'buy_quad',
          parameters: values,
          budgetLeft,
          budgetRight,
          multiplierLeft,
          multiplierRight,
          medianMultiplier: pairStat(medianLeft, medianRight),
          expectedMultiplier: pairStat(expectedLeft, expectedRight),
          domain
        }
      };
    }

    default:
      throw new Error(`Unsupported format for ${meta.id}`);
  }
}

function buildCompareItem(context: CompareContext, meta: ParameterCardMeta): CompareResult {
  const sourceInfo = createSourceInfo(context, meta);
  const changeOriginsInRange = toChangeOriginsInRange(context, meta);
  const { unchanged, visualPayload } = buildVisualComparison(context, meta);

  return {
    id: meta.id,
    title: meta.title,
    group: meta.group,
    format: meta.format,
    unchanged,
    sourceInfo,
    explanation: meta.explanation,
    leftVersion: context.leftVersion,
    rightVersion: context.rightVersion,
    changeOriginsInRange,
    visualPayload
  };
}

export function getVersions(pathsInput: RuntimePathInput): string[] {
  const paths = resolveRuntimePaths(pathsInput);
  return listVersions(paths.dataRoot);
}

export function getInProgressVersions(pathsInput: RuntimePathInput): string[] {
  const paths = resolveRuntimePaths(pathsInput);
  const versions = getVersions(paths);
  const versionSet = new Set(versions);
  const dashboardInputVersionHistory = loadDashboardInputVersionHistory(paths);
  const inProgress = new Set<string>();

  for (const entry of dashboardInputVersionHistory) {
    if (entry.validation.status === 'in_progress' && versionSet.has(entry.snapshot_folder)) {
      inProgress.add(entry.snapshot_folder);
    }
  }

  return versions.filter((version) => inProgress.has(version));
}

export function getValidationOverview(
  pathsInput: RuntimePathInput,
  version?: string,
  validationTargetYear?: number,
  comparisonVersion?: string
): ValidationOverviewPayload {
  return getTrackedValidationOverview(pathsInput, version, validationTargetYear, comparisonVersion);
}

export function getParameterCatalog() {
  return PARAMETER_CATALOG;
}

export function compareParameters(
  pathsInput: RuntimePathInput,
  leftVersion: string,
  rightVersion: string,
  ids: string[],
  provenanceScope: ProvenanceScope = 'range'
): CompareResponse {
  const paths = resolveRuntimePaths(pathsInput);
  ensureVersionExists(paths, leftVersion);
  ensureVersionExists(paths, rightVersion);

  const leftConfig = parseConfigFile(getConfigPath(paths, leftVersion));
  const rightConfig = parseConfigFile(getConfigPath(paths, rightVersion));
  const dashboardInputVersionHistory = loadDashboardInputVersionHistory(paths);
  const leftConfigDetails = parseConfigWithComments(getConfigPath(paths, leftVersion));
  const rightConfigDetails = parseConfigWithComments(getConfigPath(paths, rightVersion));
  const leftFallbackTagsByKey = buildLatestSourceTagsByKey(dashboardInputVersionHistory, leftVersion);
  const rightFallbackTagsByKey = buildLatestSourceTagsByKey(dashboardInputVersionHistory, rightVersion);

  const catalogById = new Map(PARAMETER_CATALOG.map((meta) => [meta.id, meta]));
  const selected = (ids.length > 0 ? ids : PARAMETER_CATALOG.map((meta) => meta.id)).map((id) => {
    const meta = catalogById.get(id);
    if (!meta) {
      throw new Error(`Unknown parameter id: ${id}`);
    }
    return meta;
  });

  const context: CompareContext = {
    runtimePaths: paths,
    leftVersion,
    rightVersion,
    leftConfig,
    rightConfig,
    leftConfigDetails,
    rightConfigDetails,
    leftFallbackTagsByKey,
    rightFallbackTagsByKey,
    dashboardInputVersionHistory,
    provenanceScope
  };

  return {
    left: leftVersion,
    right: rightVersion,
    items: selected.map((meta) => buildCompareItem(context, meta))
  };
}
