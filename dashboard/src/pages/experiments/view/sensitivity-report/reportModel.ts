import type {
  SensitivityExperimentChartsPayload,
  SensitivityExperimentMetadata,
  SensitivityExperimentParameterSelection,
  SensitivityExperimentResultsPayload,
  SensitivityPointResult,
  SensitivitySamplePoint,
  SensitivitySeedRunResult
} from '../../../../../shared/types';
import { CENTRAL_BANK_POLICY_DISPLAY, formatPolicyValue, type PolicyUnit } from '../../../../../shared/policyDisplay';

export interface ReportIndicator {
  id: string;
  title: string;
  units: string;
  group: string;
  theme: string;
  baselineMean: number | null;
}

/** The fifteen retained core outputs, including their growth horizons and loan-distribution qualifiers. */
export const REPORT_INDICATORS = [
  { id: 'core_mortgageApprovals', title: 'Mortgage Approvals', units: 'count/month', group: 'Market activity', theme: 'Credit activity' },
  { id: 'core_housingTransactions', title: 'Housing Transactions', units: 'count/month', group: 'Market activity', theme: 'Housing activity' },
  { id: 'core_advancesToFTB', title: 'Advances to First-Time Buyers', units: 'count/month', group: 'Market activity', theme: 'First-time buyers' },
  { id: 'core_advancesToHM', title: 'Advances to Home Movers', units: 'count/month', group: 'Market activity', theme: 'Home movers' },
  { id: 'core_advancesToBTL', title: 'Advances to Buy-to-Let Investors', units: 'count/month', group: 'Market activity', theme: 'Buy-to-let lending' },
  { id: 'core_debtToIncome', title: 'Mortgage Debt to Income', units: '%', group: 'Household leverage', theme: 'Household leverage' },
  { id: 'core_ooDebtToIncome', title: 'Owner-Occupier Mortgage Debt to Income', units: '%', group: 'Household leverage', theme: 'Owner-occupier leverage' },
  { id: 'core_ooLTV', title: 'Owner-Occupier LTV (Mean Above Median)', units: '%', group: 'Lending conditions', theme: 'Mortgage LTV' },
  { id: 'core_ooLTI', title: 'Owner-Occupier LTI (Mean Above Median)', units: 'ratio', group: 'Lending conditions', theme: 'Mortgage LTI' },
  { id: 'core_btlLTV', title: 'Buy-to-Let LTV (Mean)', units: '%', group: 'Lending conditions', theme: 'Buy-to-let leverage' },
  { id: 'core_interestRateSpread', title: 'Mortgage Interest Rate Spread', units: 'percentage points', group: 'Lending conditions', theme: 'Mortgage pricing' },
  { id: 'core_priceToIncome', title: 'Price to Income', units: 'ratio', group: 'Prices and rental market', theme: 'Affordability' },
  { id: 'core_rentalYield', title: 'Rental Yield', units: '%', group: 'Prices and rental market', theme: 'Rental returns' },
  { id: 'core_housePriceGrowth', title: 'House Price Growth (QoQ)', units: '%', group: 'Cycles', theme: 'House-price cycles' },
  { id: 'core_creditGrowth', title: 'Household Credit Growth (12-month)', units: '%', group: 'Cycles', theme: 'Credit cycles' }
] as const satisfies readonly Omit<ReportIndicator, 'baselineMean'>[];

export const REPORT_OUTCOMES = [
  { id: 'core_housePriceGrowth', title: 'House Price Growth (QoQ)', theme: 'House-price cycles', measure: 'range' },
  { id: 'core_creditGrowth', title: 'Household Credit Growth (12-month)', theme: 'Credit cycles', measure: 'range' },
  { id: 'core_debtToIncome', title: 'Mortgage Debt to Income', theme: 'Household leverage', measure: 'mean' },
  { id: 'core_mortgageApprovals', title: 'Mortgage Approvals', theme: 'Credit activity', measure: 'mean' },
  { id: 'core_advancesToFTB', title: 'Advances to First-Time Buyers', theme: 'First-time buyers', measure: 'mean' },
  { id: 'core_advancesToBTL', title: 'Advances to Buy-to-Let Investors', theme: 'Buy-to-let lending', measure: 'mean' }
] as const;

export interface ReportMetric {
  mean: number | null;
  /** Mean of successful seeds' within-time P95–P5 values, never an uncertainty interval. */
  temporalRange: number | null;
  absoluteChange: number | null;
  relativeChange: number | null;
  contributingSeeds: number | null;
  rangeContributingSeeds: number | null;
  consistency: { higher: number; lower: number; equal: number; total: number } | null;
}

export interface ReportRow {
  point: SensitivitySamplePoint;
  result: SensitivityPointResult | null;
  setting: string;
  status: 'succeeded' | 'failed' | 'canceled' | 'not run' | 'partial';
  successfulSeeds: number | null;
  expectedSeeds: number | null;
  /** Verified successful seed coverage; legacy coverage is never assumed complete. */
  complete: boolean;
  metrics: Record<string, ReportMetric>;
}

export interface ReportOutcome {
  id: string;
  title: string;
  theme: string;
  units: string;
  measure?: 'mean' | 'range';
  baselineMean: number | null;
  baselineRange?: number | null;
  available: boolean;
}

export interface RankingItem {
  id: string;
  title: string;
  units: string;
  magnitude: number;
  /** Signed changes describe settings[0]; other tied settings may have the opposite sign. */
  relativeChange: number;
  absoluteChange: number | null;
  settings: string[];
}

export interface SensitivityReportModel {
  rows: ReportRow[];
  indicators: ReportIndicator[];
  outcomes: ReportOutcome[];
  ranking: RankingItem[];
  unrankedTitles: string[];
  baselineRow: ReportRow | null;
  /** Experiment succeeded with complete intended seed coverage; individual KPIs may still be missing. */
  complete: boolean;
  coverageKnown: boolean;
  successfulSeeds: number;
  expectedSeeds: number | null;
  windowLabel: string;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatReportNumber(value: number | null): string {
  const number = finite(value);
  if (number === null) return 'n/a';
  if (number !== 0 && Math.abs(number) < 0.000001) return number.toExponential(3);
  return number.toLocaleString('en-GB', { maximumFractionDigits: 6 });
}

/** `signed` means an absolute difference, so a difference of percentage values uses pp. */
export function formatReportValue(value: number | null, units: string, signed = false): string {
  const finiteValue = finite(value);
  if (finiteValue === null) return 'n/a';
  const prefix = signed && finiteValue > 0 ? '+' : '';
  const number = `${prefix}${formatReportNumber(finiteValue)}`;
  if (units === '%') return signed ? `${number} pp` : `${number}%`;
  if (units === 'percentage points') return `${number} pp`;
  return units ? `${number} ${units}` : number;
}

export function reportPolicyUnit(parameter: SensitivityExperimentParameterSelection): PolicyUnit | null {
  const keys = parameter.parameterKeys?.length ? parameter.parameterKeys : [parameter.key];
  const units = keys.map((key) => CENTRAL_BANK_POLICY_DISPLAY[key]?.unit ?? null);
  return units[0] !== null && units.every((unit) => unit === units[0]) ? units[0] : null;
}

export function formatReportSetting(
  point: SensitivitySamplePoint,
  parameter: SensitivityExperimentParameterSelection
): string {
  const unit = reportPolicyUnit(parameter);
  if (finite(point.value) !== null) {
    return unit ? formatPolicyValue(point.value as number, unit) : formatReportNumber(point.value);
  }
  const values = point.valuesByKey ?? (point.isBaseline ? parameter.baselineValuesByKey : undefined);
  if (!values || Object.keys(values).length === 0) return point.label || 'Not recorded';
  return Object.entries(values).map(([key, value]) => {
    const display = CENTRAL_BANK_POLICY_DISPLAY[key];
    const formatted = display ? formatPolicyValue(value, display.unit) : formatReportNumber(value);
    return `${display?.label ?? key}: ${formatted}`;
  }).join('; ');
}

export function getReportWindowLabel(windowType: SensitivityExperimentChartsPayload['windowType'] | null): string {
  if (windowType === 'post_200') return 'After first 200 valid observations';
  if (windowType === 'tail_120') return 'Last up to 120 observations';
  return 'Not recorded';
}

/** Ambiguous duplicate IDs cannot establish seed coverage or enter paired comparisons. */
function uniqueSeeds(result: SensitivityPointResult | null): Map<number, SensitivitySeedRunResult> | null {
  if (!result?.seedResults) return null;
  const seeds = new Map<number, SensitivitySeedRunResult>();
  const duplicates = new Set<number>();
  for (const seedResult of result.seedResults) {
    if (!Number.isInteger(seedResult.seed)) continue;
    if (seeds.has(seedResult.seed)) duplicates.add(seedResult.seed);
    seeds.set(seedResult.seed, seedResult);
  }
  for (const seed of duplicates) seeds.delete(seed);
  return seeds;
}

export function isReportRowEligible(row: ReportRow): boolean {
  return row.complete || (row.status === 'succeeded' && row.successfulSeeds === null);
}

export function isReportMetricEligible(row: ReportRow, indicatorId: string, measure: 'mean' | 'range' = 'mean'): boolean {
  const metric = row.metrics[indicatorId];
  const value = measure === 'range' ? metric?.temporalRange : metric?.mean;
  const count = measure === 'range' ? metric?.rangeContributingSeeds : metric?.contributingSeeds;
  return isReportRowEligible(row) && finite(value) !== null &&
    (row.successfulSeeds === null || count === row.expectedSeeds);
}

/** One explicit tested setting supplies headline values; never average across the sweep. */
export function chooseReportFocusRow(report: SensitivityReportModel, pointId?: string): ReportRow | null {
  const requested = pointId ? report.rows.find((row) => row.point.pointId === pointId) : null;
  if (requested) return requested;
  const candidates = report.rows.filter((row) => !row.point.isBaseline && finite(row.point.value) !== null &&
    isReportRowEligible(row) && report.indicators.some((indicator) => isReportMetricEligible(row, indicator.id)));
  candidates.sort((left, right) => (left.point.value as number) - (right.point.value as number));
  return candidates[0] ?? report.baselineRow ?? report.rows[0] ?? null;
}

function pairedDirectionCounts(
  row: ReportRow,
  baseline: ReportRow,
  indicatorId: string,
  expectedIds: Set<number> | null
): ReportMetric['consistency'] {
  if (row === baseline || !isReportMetricEligible(baseline, indicatorId)) return null;
  const seeds = uniqueSeeds(row.result);
  const baselineSeeds = uniqueSeeds(baseline.result);
  if (!seeds || !baselineSeeds) return null;
  const counts = { higher: 0, lower: 0, equal: 0, total: 0 };
  for (const [seed, current] of seeds) {
    if (expectedIds && !expectedIds.has(seed)) continue;
    const reference = baselineSeeds.get(seed);
    if (current.status !== 'succeeded' || reference?.status !== 'succeeded') continue;
    const currentMean = finite(current.indicatorMetrics.find((metric) => metric.indicatorId === indicatorId)?.kpi.mean);
    const baselineMean = finite(reference.indicatorMetrics.find((metric) => metric.indicatorId === indicatorId)?.kpi.mean);
    if (currentMean === null || baselineMean === null) continue;
    counts.total += 1;
    if (currentMean > baselineMean) counts.higher += 1;
    else if (currentMean < baselineMean) counts.lower += 1;
    else counts.equal += 1;
  }
  return counts.total >= 2 ? counts : null;
}

export function buildSensitivityReport(
  detail: SensitivityExperimentMetadata,
  results: SensitivityExperimentResultsPayload,
  windowType: SensitivityExperimentChartsPayload['windowType'] | null
): SensitivityReportModel {
  const expectedIds = detail.seeds?.length
    ? new Set(detail.seeds.filter((seed) => Number.isInteger(seed)))
    : null;
  const recordedCount = detail.seedsPerPoint;
  const expectedPerPoint = expectedIds?.size
    ? expectedIds.size
    : typeof recordedCount === 'number' && Number.isInteger(recordedCount) && recordedCount > 0
      ? recordedCount
      : null;
  const resultById = new Map(results.points.map((point) => [point.pointId, point]));
  const indicators = new Map<string, { title: string; units: string }>();
  for (const indicator of REPORT_INDICATORS) {
    indicators.set(indicator.id, { title: indicator.title, units: indicator.units });
  }
  for (const result of results.points) {
    for (const metric of result.indicatorMetrics) {
      indicators.set(metric.indicatorId, { title: indicators.get(metric.indicatorId)?.title ?? metric.title, units: metric.units });
    }
  }

  const rows: ReportRow[] = [...detail.sampledPoints].sort((left, right) => {
    const leftValue = finite(left.value);
    const rightValue = finite(right.value);
    if (leftValue === null) return rightValue === null ? 0 : 1;
    return rightValue === null ? -1 : leftValue - rightValue;
  }).map((point) => {
    const result = resultById.get(point.pointId) ?? null;
    const seeds = uniqueSeeds(result);
    const successful = seeds ? [...seeds.values()].filter((seed) =>
      seed.status === 'succeeded' && (expectedIds === null || expectedIds.has(seed.seed))
    ) : null;
    const successfulSeeds = result === null ? 0 : successful?.length ?? null;
    const correctIds = expectedIds === null || (seeds !== null && seeds.size === expectedIds.size &&
      [...expectedIds].every((seed) => seeds.has(seed)));
    const complete = result?.status === 'succeeded' && expectedPerPoint !== null &&
      successfulSeeds === expectedPerPoint && seeds?.size === expectedPerPoint && correctIds;
    const status = !result ? 'not run' : result.status !== 'succeeded' ? result.status
      : seeds !== null && !complete ? 'partial' : 'succeeded';
    const metrics: Record<string, ReportMetric> = {};
    for (const indicatorId of indicators.keys()) {
      const metric = result?.indicatorMetrics.find((entry) => entry.indicatorId === indicatorId);
      metrics[indicatorId] = {
        mean: finite(metric?.kpi.mean),
        temporalRange: finite(metric?.kpi.range),
        absoluteChange: null,
        relativeChange: null,
        contributingSeeds: successful === null ? null : successful.filter((seed) =>
          finite(seed.indicatorMetrics.find((entry) => entry.indicatorId === indicatorId)?.kpi.mean) !== null
        ).length,
        rangeContributingSeeds: successful === null ? null : successful.filter((seed) =>
          finite(seed.indicatorMetrics.find((entry) => entry.indicatorId === indicatorId)?.kpi.range) !== null
        ).length,
        consistency: null
      };
    }
    return {
      point, result, setting: formatReportSetting(point, detail.parameter), status,
      successfulSeeds, expectedSeeds: expectedPerPoint, complete, metrics
    };
  });

  // Respect the backend's designated eligible baseline; never salvage failed baseline seeds.
  const baselineRow = rows.find((row) => row.point.isBaseline) ?? null;
  const baselineEligible = baselineRow !== null && baselineRow.point.pointId === results.baselinePointId &&
    isReportRowEligible(baselineRow);
  for (const row of rows) {
    for (const [indicatorId, metric] of Object.entries(row.metrics)) {
      if (!baselineEligible || !isReportMetricEligible(baselineRow, indicatorId)) continue;
      const baselineMean = baselineRow.metrics[indicatorId].mean;
      metric.absoluteChange = metric.mean === null || baselineMean === null ? null : finite(metric.mean - baselineMean);
      // Keep the backend's near-zero guard and signed-denominator definition unchanged.
      metric.relativeChange = metric.mean === null ? null :
        finite(row.result?.indicatorMetrics.find((entry) => entry.indicatorId === indicatorId)?.deltaFromBaseline.mean);
      metric.consistency = pairedDirectionCounts(row, baselineRow, indicatorId, expectedIds);
    }
  }

  const ranking: RankingItem[] = [];
  const unrankedTitles: string[] = [];
  for (const [id, indicator] of indicators) {
    const candidates = rows.filter((row) => !row.point.isBaseline && isReportMetricEligible(row, id) &&
      row.metrics[id].relativeChange !== null);
    if (candidates.length === 0) {
      unrankedTitles.push(indicator.title);
      continue;
    }
    const magnitude = Math.max(...candidates.map((row) => Math.abs(row.metrics[id].relativeChange as number)));
    const winners = candidates.filter((row) => Math.abs(row.metrics[id].relativeChange as number) === magnitude);
    const first = winners[0];
    ranking.push({
      id, title: indicator.title, units: indicator.units, magnitude,
      relativeChange: first.metrics[id].relativeChange as number,
      absoluteChange: first.metrics[id].absoluteChange,
      settings: winners.map((row) => row.setting)
    });
  }
  ranking.sort((left, right) => right.magnitude - left.magnitude || left.title.localeCompare(right.title));

  return {
    rows,
    indicators: REPORT_INDICATORS.map((indicator) => ({
      ...indicator,
      units: indicators.get(indicator.id)?.units ?? indicator.units,
      baselineMean: baselineEligible && isReportMetricEligible(baselineRow, indicator.id)
        ? baselineRow.metrics[indicator.id].mean : null
    })),
    outcomes: REPORT_OUTCOMES.map((outcome) => ({
      ...outcome,
      units: indicators.get(outcome.id)?.units ?? '',
      baselineMean: baselineEligible && isReportMetricEligible(baselineRow, outcome.id)
        ? baselineRow.metrics[outcome.id].mean : null,
      baselineRange: baselineEligible && isReportMetricEligible(baselineRow, outcome.id, 'range')
        ? baselineRow.metrics[outcome.id].temporalRange : null,
      available: rows.some((row) => !row.point.isBaseline && finite(row.point.value) !== null &&
        isReportMetricEligible(row, outcome.id, outcome.measure))
    })),
    ranking: ranking.slice(0, 5),
    unrankedTitles,
    baselineRow,
    complete: detail.status === 'succeeded' && rows.length > 0 && rows.every((row) => row.complete),
    coverageKnown: expectedPerPoint !== null && rows.every((row) => row.successfulSeeds !== null),
    successfulSeeds: rows.reduce((sum, row) => sum + (row.successfulSeeds ?? 0), 0),
    expectedSeeds: expectedPerPoint === null ? null : expectedPerPoint * rows.length,
    windowLabel: getReportWindowLabel(windowType)
  };
}
