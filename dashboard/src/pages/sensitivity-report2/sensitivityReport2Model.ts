import type {
  SensitivityExperimentChartsPayload,
  SensitivityExperimentMetadata,
  SensitivityExperimentResultsPayload,
  SensitivityPointResult,
  SensitivitySamplePoint,
  SensitivitySeedRunResult
} from '../../../shared/types';
import {
  REPORT_INDICATORS,
  formatReportSetting,
  getReportWindowLabel,
  reportPolicyUnit
} from '../experiments/view/sensitivity-report/reportModel';

export interface Report2Outcome {
  key: string;
  id: string;
  title: string;
  units: string;
  measure: 'mean' | 'range';
  group: string;
}

export const REPORT2_OUTCOMES: readonly Report2Outcome[] = [
  ...REPORT_INDICATORS.map((indicator) => ({
    key: indicator.id, id: indicator.id, title: indicator.title, units: indicator.units,
    measure: 'mean' as const, group: indicator.group
  })),
  ...REPORT_INDICATORS.filter((indicator) => indicator.group === 'Cycles').map((indicator) => ({
    key: `${indicator.id}:range`, id: indicator.id,
    title: `${indicator.title} — temporal P95–P5 range`, units: 'percentage points',
    measure: 'range' as const, group: 'Cycles'
  }))
];

export const REPORT2_SUMMARY_KEYS = ['core_mortgageApprovals', 'core_debtToIncome', 'core_priceToIncome', 'core_advancesToFTB'];
export const REPORT2_BORROWER_KEYS = ['core_advancesToFTB', 'core_advancesToHM', 'core_advancesToBTL'];
export const REPORT2_CYCLE_KEYS = ['core_housePriceGrowth:range', 'core_creditGrowth:range'];

export type Report2CoverageState = 'complete' | 'partial' | 'failed' | 'canceled' | 'legacy' | 'missing';

export interface Report2Coverage {
  state: Report2CoverageState;
  successful: number | null;
  expected: number | null;
  returned: number | null;
  label: string;
}

export interface Report2PairedDifferences {
  total: number;
  higher: number;
  lower: number;
  equal: number;
  min: number | null;
  max: number | null;
  differences: Array<{ seed: number; difference: number }>;
}

export interface Report2Metric {
  value: number | null;
  baselineValue: number | null;
  change: number | null;
  relativeChange: number | null;
  finiteSeeds: number | null;
  baselineFiniteSeeds: number | null;
  baselineEligible: boolean;
  comparisonEligible: boolean;
  /** Complete execution AND a finite value from each intended seed for this KPI. */
  eligible: boolean;
  paired: Report2PairedDifferences | null;
}

export interface Report2Row {
  point: SensitivitySamplePoint;
  result: SensitivityPointResult | null;
  setting: string;
  /** Display units, e.g. 95 for a stored LTV fraction of 0.95. Never impute a package baseline. */
  x: number | null;
  coverage: Report2Coverage;
  metrics: Record<string, Report2Metric>;
}

export interface Report2Warning {
  code: string;
  message: string;
  messages: string[];
  pointIds: string[];
  settings: string[];
}

export interface SensitivityReport2Model {
  detail: SensitivityExperimentMetadata;
  rows: Report2Row[];
  numericRows: Report2Row[];
  baselineRow: Report2Row | null;
  outcomes: readonly Report2Outcome[];
  windowLabel: string;
  axis: { scale: number; label: string; stepUnit: string };
  complete: boolean;
  successfulSeeds: number;
  expectedSeeds: number | null;
  warnings: Report2Warning[];
}

export interface Report2Interval {
  from: Report2Row;
  to: Report2Row;
  change: number;
  distance: number;
  slope: number;
  slopeUnits: string;
}

export interface Report2Reversal {
  left: Report2Interval;
  right: Report2Interval;
}

export interface Report2OutcomeAnalysis {
  outcome: Report2Outcome;
  intervals: Report2Interval[];
  largestIntervals: Report2Interval[];
  reversals: Report2Reversal[];
  diminishing: Array<{ earlier: Report2Interval; later: Report2Interval }>;
  boundaryRows: Report2Row[];
  excludedPointIds: string[];
}

export interface Report2Observation {
  kind: 'interval' | 'reversal' | 'diminishing' | 'boundary' | 'tradeoff' | 'warning' | 'coverage';
  title: string;
  text: string;
  pointIds: string[];
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-10 * Math.max(1, Math.abs(left), Math.abs(right));
}

/** Duplicate IDs are ambiguous, so neither copy can enter coverage or paired comparisons. */
function uniqueSeeds(result: SensitivityPointResult | null): Map<number, SensitivitySeedRunResult> | null {
  if (!result?.seedResults) return null;
  const map = new Map<number, SensitivitySeedRunResult>();
  const duplicates = new Set<number>();
  for (const seed of result.seedResults) {
    if (!Number.isInteger(seed.seed)) continue;
    if (map.has(seed.seed)) duplicates.add(seed.seed);
    map.set(seed.seed, seed);
  }
  for (const seed of duplicates) map.delete(seed);
  return map;
}

function valueFor(result: SensitivityPointResult | SensitivitySeedRunResult | null, outcome: Report2Outcome): number | null {
  return finite(result?.indicatorMetrics.find((metric) => metric.indicatorId === outcome.id)?.kpi[outcome.measure]);
}

function countLabel(successful: number | null, expected: number | null): string {
  if (successful === null) return 'seed details not retained';
  return expected === null ? `${successful} successful seeds; planned count unknown` : `${successful}/${expected} successful seeds`;
}

function buildCoverage(
  result: SensitivityPointResult | null,
  seeds: Map<number, SensitivitySeedRunResult> | null,
  expectedIds: Set<number> | null,
  expected: number | null,
  consistentPlan: boolean
): Report2Coverage {
  const successful = result === null ? 0 : seeds === null ? null : [...seeds.values()].filter((seed) =>
    seed.status === 'succeeded' && (!expectedIds || expectedIds.has(seed.seed))).length;
  const returned = seeds?.size ?? null;
  const idsMatch = !expectedIds || (seeds !== null && seeds.size === expectedIds.size && [...expectedIds].every((seed) => seeds.has(seed)));
  const fullyReturned = result?.seedResults?.length === expected && returned === expected;
  let state: Report2CoverageState;
  if (!result) state = 'missing';
  else if (result.status === 'failed' || result.status === 'canceled') state = result.status;
  else if (!seeds || expected === null) state = 'legacy';
  else if (consistentPlan && idsMatch && fullyReturned && successful === expected) state = 'complete';
  else state = 'partial';
  const prefix = state === 'legacy' ? 'Legacy coverage' : state === 'missing' ? 'No result' : state[0].toUpperCase() + state.slice(1);
  return { state, successful, expected, returned, label: `${prefix} · ${countLabel(successful, expected)}` };
}

function pairedDifferences(
  row: Report2Row,
  baseline: Report2Row,
  outcome: Report2Outcome,
  expectedIds: Set<number> | null
): Report2PairedDifferences | null {
  if (row === baseline) return null;
  const currentSeeds = uniqueSeeds(row.result);
  const baselineSeeds = uniqueSeeds(baseline.result);
  if (!currentSeeds || !baselineSeeds) return null;
  const differences: Report2PairedDifferences['differences'] = [];
  for (const [seed, current] of currentSeeds) {
    if (expectedIds && !expectedIds.has(seed)) continue;
    const reference = baselineSeeds.get(seed);
    if (current.status !== 'succeeded' || reference?.status !== 'succeeded') continue;
    const currentValue = valueFor(current, outcome);
    const baselineValue = valueFor(reference, outcome);
    if (currentValue === null || baselineValue === null) continue;
    const difference = finite(currentValue - baselineValue);
    if (difference !== null) differences.push({ seed, difference });
  }
  differences.sort((left, right) => left.seed - right.seed);
  return {
    total: differences.length,
    higher: differences.filter((pair) => pair.difference > 0).length,
    lower: differences.filter((pair) => pair.difference < 0).length,
    equal: differences.filter((pair) => pair.difference === 0).length,
    min: differences.length ? Math.min(...differences.map((pair) => pair.difference)) : null,
    max: differences.length ? Math.max(...differences.map((pair) => pair.difference)) : null,
    differences
  };
}

/** Same aggregate denominator as the backend; additionally omit non-positive reference values. */
function relativeChange(row: Report2Row, baseline: Report2Row, outcome: Report2Outcome): number | null {
  const current = row.metrics[outcome.key].value;
  const reference = baseline.metrics[outcome.key].value;
  if (current === null || reference === null || reference < 1e-12) return null;
  const baselineMetric = baseline.result?.indicatorMetrics.find((metric) => metric.indicatorId === outcome.id);
  const spread = finite(baselineMetric?.kpi.range);
  if (outcome.measure === 'mean' && spread !== null && spread > 0 && Math.abs(reference) < 0.05 * spread) return null;
  // Retain any suppression already encoded in the API, including legacy / unavailable comparisons.
  const stored = row.result?.indicatorMetrics.find((metric) => metric.indicatorId === outcome.id)?.deltaFromBaseline[outcome.measure];
  if (finite(stored) === null) return null;
  return finite(100 * (current - reference) / reference);
}

export function buildSensitivityReport2(
  detail: SensitivityExperimentMetadata,
  results: SensitivityExperimentResultsPayload,
  windowType: SensitivityExperimentChartsPayload['windowType'] | null
): SensitivityReport2Model {
  const expectedIds = detail.seeds?.length ? new Set(detail.seeds.filter(Number.isInteger)) : null;
  const count = Number.isInteger(detail.seedsPerPoint) && (detail.seedsPerPoint ?? 0) > 0 ? detail.seedsPerPoint! : null;
  const expected = Math.max(expectedIds?.size ?? 0, count ?? 0) || null;
  const consistentPlan = (!detail.seeds?.length || expectedIds?.size === detail.seeds.length) &&
    (count === null || !expectedIds || count === expectedIds.size);
  const unit = reportPolicyUnit(detail.parameter);
  const axis = {
    scale: unit === 'percentage' ? 100 : 1,
    label: `${detail.parameter.title}${unit === 'percentage' ? ' (%)' : unit === 'multiple' ? ' (× income)' : unit === 'months' ? ' (months)' : unit === 'ratio' ? ' (ratio)' : ''}`,
    stepUnit: unit === 'percentage' ? '1 pp of policy setting' : unit === 'multiple' ? '1× income of policy setting' : unit === 'months' ? '1 month of policy setting' : '1 unit of policy setting'
  };
  // An ID mismatch must not let a stale response enter this experiment's report.
  const byId = new Map((results.experimentId === detail.experimentId ? results.points : []).map((point) => [point.pointId, point]));
  const rows: Report2Row[] = detail.sampledPoints.map((point) => {
    const result = byId.get(point.pointId) ?? null;
    const seeds = uniqueSeeds(result);
    const coverage = buildCoverage(result, seeds, expectedIds, expected, consistentPlan);
    const metrics: Record<string, Report2Metric> = {};
    for (const outcome of REPORT2_OUTCOMES) {
      const value = valueFor(result, outcome);
      const finiteSeeds = seeds === null ? null : [...seeds.values()].filter((seed) =>
        seed.status === 'succeeded' && (!expectedIds || expectedIds.has(seed.seed)) && valueFor(seed, outcome) !== null).length;
      metrics[outcome.key] = {
        value, baselineValue: null, change: null, relativeChange: null, finiteSeeds,
        baselineFiniteSeeds: null, baselineEligible: false, comparisonEligible: false,
        eligible: coverage.state === 'complete' && finiteSeeds === expected && value !== null,
        paired: null
      };
    }
    return {
      point, result, setting: formatReportSetting(point, detail.parameter),
      x: finite(point.value) === null ? null : point.value! * axis.scale, coverage, metrics
    };
  }).sort((left, right) => left.x === null ? (right.x === null ? 0 : 1) : right.x === null ? -1 : left.x - right.x);
  const baselineRow = rows.find((row) => row.point.isBaseline) ?? null;
  const validBaseline = baselineRow !== null && results.experimentId === detail.experimentId &&
    baselineRow.point.pointId === results.baselinePointId && baselineRow.result?.status === 'succeeded';
  if (validBaseline) {
    for (const row of rows) {
      for (const outcome of REPORT2_OUTCOMES) {
        const metric = row.metrics[outcome.key];
        metric.baselineValue = baselineRow.metrics[outcome.key].value;
        metric.baselineFiniteSeeds = baselineRow.metrics[outcome.key].finiteSeeds;
        metric.baselineEligible = baselineRow.metrics[outcome.key].eligible;
        metric.comparisonEligible = metric.eligible && metric.baselineEligible;
        metric.change = metric.value === null || metric.baselineValue === null ? null : finite(metric.value - metric.baselineValue);
        metric.relativeChange = relativeChange(row, baselineRow, outcome);
        metric.paired = pairedDifferences(row, baselineRow, outcome, expectedIds);
      }
    }
  }
  const codes = new Set([
    ...(detail.warnings ?? []).map((warning) => warning.code),
    ...Object.values(detail.warningSummary?.byPoint ?? {}).flat()
  ]);
  const warnings = [...codes].map((code) => {
    const messages = [...new Set((detail.warnings ?? []).filter((warning) => warning.code === code).map((warning) => warning.message))];
    const affected = rows.filter((row) => detail.warningSummary?.byPoint?.[row.point.pointId]?.includes(code));
    return { code, message: messages[0] ?? `Recorded configuration warning: ${code}`, messages,
      pointIds: affected.map((row) => row.point.pointId), settings: affected.map((row) => row.setting) };
  });
  return {
    detail, rows, numericRows: rows.filter((row) => row.x !== null), baselineRow,
    outcomes: REPORT2_OUTCOMES, windowLabel: getReportWindowLabel(windowType), axis,
    complete: detail.status === 'succeeded' && rows.length > 0 && rows.every((row) => row.coverage.state === 'complete'),
    successfulSeeds: rows.reduce((sum, row) => sum + (row.coverage.successful ?? 0), 0),
    expectedSeeds: expected === null ? null : expected * rows.length, warnings
  };
}

/** Lowest recorded non-baseline numeric setting: deterministic, independent of outcomes. */
export function chooseReport2Setting(model: SensitivityReport2Model, pointId?: string): Report2Row | null {
  return model.rows.find((row) => row.point.pointId === pointId) ??
    model.numericRows.find((row) => !row.point.isBaseline) ?? model.baselineRow ?? model.rows[0] ?? null;
}

export function formatReport2Number(value: number | null): string {
  const number = finite(value);
  if (number === null) return 'Not available';
  return number !== 0 && Math.abs(number) < 0.01
    ? number.toLocaleString('en-GB', { maximumSignificantDigits: 3 })
    : number.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

export function formatReport2Value(value: number | null, outcome: Report2Outcome): string {
  if (finite(value) === null) return 'Not available';
  const unit = outcome.units === 'percentage points' ? 'pp' : outcome.units === 'count/month' ? '/ month' : outcome.units === 'ratio' ? '×' : outcome.units;
  return `${formatReport2Number(value)}${unit === '%' ? '' : ' '}${unit}`;
}

export function formatReport2Difference(value: number | null, outcome: Report2Outcome): string {
  if (finite(value) === null) return 'Not available';
  const unit = outcome.units === '%' || outcome.units === 'percentage points' ? 'pp' : outcome.units === 'count/month' ? '/ month' : outcome.units === 'ratio' ? '×' : outcome.units;
  return `${value! > 0 ? '+' : ''}${formatReport2Number(value)} ${unit}`;
}

export function formatReport2Pairing(metric: Report2Metric): string {
  const pairs = metric.paired;
  if (!pairs || pairs.total === 0) return 'No valid matched seed pairs';
  if (pairs.total === 1) return '1 matched seed; variation across seeds cannot be assessed';
  if (metric.change === null || metric.change === 0) {
    return `${pairs.higher} higher, ${pairs.lower} lower, ${pairs.equal} unchanged across ${pairs.total} matched seeds`;
  }
  const direction = metric.change > 0 ? 'higher' : 'lower';
  const count = metric.change > 0 ? pairs.higher : pairs.lower;
  return `${count} of ${pairs.total} matched seeds moved ${direction}`;
}

export function analyseReport2Outcome(model: SensitivityReport2Model, outcomeKey: string): Report2OutcomeAnalysis {
  const outcome = model.outcomes.find((item) => item.key === outcomeKey) ?? model.outcomes[0];
  const intervals: Report2Interval[] = [];
  for (let index = 1; index < model.numericRows.length; index += 1) {
    const from = model.numericRows[index - 1];
    const to = model.numericRows[index];
    const first = from.metrics[outcome.key];
    const second = to.metrics[outcome.key];
    if (!first.eligible || !second.eligible || first.value === null || second.value === null) continue;
    const distance = to.x! - from.x!;
    if (distance <= 0) continue;
    const change = second.value - first.value;
    const slope = change / distance;
    if (!Number.isFinite(slope)) continue;
    const nativeDifferenceUnit = outcome.units === '%' || outcome.units === 'percentage points' ? 'pp' : outcome.units;
    intervals.push({ from, to, change, distance, slope, slopeUnits: `${nativeDifferenceUnit} per ${model.axis.stepUnit}` });
  }
  const maximum = intervals.length ? Math.max(...intervals.map((interval) => Math.abs(interval.slope))) : 0;
  const largestIntervals = maximum > 0 ? intervals.filter((interval) => nearlyEqual(Math.abs(interval.slope), maximum)) : [];
  const reversals: Report2Reversal[] = [];
  const diminishing: Report2OutcomeAnalysis['diminishing'] = [];
  for (let index = 1; index < intervals.length; index += 1) {
    const left = intervals[index - 1];
    const right = intervals[index];
    if (left.to !== right.from) continue;
    if (left.slope * right.slope < 0) reversals.push({ left, right });
    if (left.slope !== 0 && (right.slope === 0 || Math.sign(left.slope) === Math.sign(right.slope)) &&
      Math.abs(right.slope) < Math.abs(left.slope) && !nearlyEqual(Math.abs(right.slope), Math.abs(left.slope))) {
      diminishing.push({ earlier: left, later: right });
    }
  }
  const baselineEligible = model.baselineRow?.metrics[outcome.key].eligible === true;
  const candidates = baselineEligible ? model.numericRows.filter((row) => !row.point.isBaseline &&
    row.metrics[outcome.key].eligible && row.metrics[outcome.key].change !== null) : [];
  const maxChange = candidates.length ? Math.max(...candidates.map((row) => Math.abs(row.metrics[outcome.key].change!))) : 0;
  const boundaryRows = maxChange > 0 ? candidates.filter((row) =>
    (row === model.numericRows[0] || row === model.numericRows[model.numericRows.length - 1]) &&
    nearlyEqual(Math.abs(row.metrics[outcome.key].change!), maxChange)) : [];
  return {
    outcome, intervals, largestIntervals, reversals, diminishing, boundaryRows,
    excludedPointIds: model.numericRows.filter((row) => !row.metrics[outcome.key].eligible).map((row) => row.point.pointId)
  };
}

function intervalLabel(interval: Report2Interval): string {
  return `${interval.from.setting} to ${interval.to.setting}`;
}

function intervalCoverage(interval: Report2Interval, outcome: Report2Outcome): string {
  return `${interval.from.metrics[outcome.key].finiteSeeds}/${interval.from.coverage.expected} and ${interval.to.metrics[outcome.key].finiteSeeds}/${interval.to.coverage.expected} valid planned seeds`;
}

export function formatReport2ConstraintWarning(warning: Report2Warning): string {
  const ltvCaps = [...new Set(warning.messages.flatMap((message) =>
    [...message.matchAll(/\bBANK_LTV_HARD_MAX_(?:FTB|HM|BTL)=([\d.e+-]+)/g)].map((match) => Number(match[1]))
  ).filter(Number.isFinite))];
  return ltvCaps.length ? `Recorded warnings identify bank LTV caps of ${ltvCaps.map((value) => `${formatReport2Number(value * 100)}%`).join(' and ')}.`
    : 'The stored warning identifies a potentially binding constraint.';
}

/** Evidence-only follow-ups, capped at three; no objective, optimisation or cross-unit ranking. */
export function buildReport2Observations(
  model: SensitivityReport2Model,
  outcomeKey: string,
  selectedPointId?: string
): Report2Observation[] {
  const analysis = analyseReport2Outcome(model, outcomeKey);
  const outcome = analysis.outcome;
  const observations: Report2Observation[] = [];
  const selected = chooseReport2Setting(model, selectedPointId);

  // A visible reversal with incomplete KPI coverage is a completion task, never a headline result.
  for (let index = 2; index < model.numericRows.length; index += 1) {
    const rows = model.numericRows.slice(index - 2, index + 1);
    const metrics = rows.map((row) => row.metrics[outcome.key]);
    if (metrics.every((metric) => metric.value !== null) && metrics.some((metric) => !metric.eligible)) {
      const [a, b, c] = metrics.map((metric) => metric.value!);
      if ((b - a) * (c - b) < 0) {
        observations.push({ kind: 'coverage', title: 'Complete coverage before interpreting the reversal',
          text: `${outcome.title} changes ${formatReport2Difference(b - a, outcome)} from ${rows[0].setting} to ${rows[1].setting}, then ${formatReport2Difference(c - b, outcome)} to ${rows[2].setting}. ${rows.filter((row) => !row.metrics[outcome.key].eligible).map((row) => `${row.setting}: ${row.coverage.label}, ${row.metrics[outcome.key].finiteSeeds ?? 'unknown'} finite KPI seeds`).join('; ')}.`,
          pointIds: rows.map((row) => row.point.pointId) });
        break;
      }
    }
  }

  const warning = model.warnings.find((item) => /non_binding|bank.*cap/i.test(`${item.code} ${item.message}`) &&
    analysis.intervals.some((interval) => interval.change === 0 &&
      item.pointIds.includes(interval.from.point.pointId) && item.pointIds.includes(interval.to.point.pointId)));
  if (warning) {
    const flat = analysis.intervals.find((interval) => interval.change === 0 &&
      warning.pointIds.includes(interval.from.point.pointId) && warning.pointIds.includes(interval.to.point.pointId))!;
    observations.push({ kind: 'warning', title: 'Inspect the recorded binding-constraint warning',
      text: `${outcome.title} is unchanged (${formatReport2Difference(0, outcome)}) from ${intervalLabel(flat)}; ${intervalCoverage(flat, outcome)}. ${formatReport2ConstraintWarning(warning)} This may explain the flat interval.`,
      pointIds: [flat.from.point.pointId, flat.to.point.pointId] });
  }

  if (analysis.largestIntervals.length > 0) {
    const tied = analysis.largestIntervals.length > 1;
    observations.push({ kind: 'interval', title: tied ? 'Sample the tied most responsive intervals more densely' : 'Sample the most responsive interval more densely',
      text: `${outcome.title}: ${analysis.largestIntervals.map((interval) => `${intervalLabel(interval)} (${formatReport2Difference(interval.change, outcome)}; slope ${formatReport2Number(interval.slope)} ${interval.slopeUnits}; ${intervalCoverage(interval, outcome)})`).join('; ')}. ${tied ? 'These intervals share the largest absolute observed slope.' : 'This is the largest absolute observed slope.'} Sampled endpoints do not locate an exact threshold.${analysis.excludedPointIds.length ? ' Incomplete or unavailable neighbouring intervals are excluded.' : ''}`,
      pointIds: [...new Set(analysis.largestIntervals.flatMap((interval) => [interval.from.point.pointId, interval.to.point.pointId]))] });
  }

  if (selected && !selected.point.isBaseline && model.baselineRow) {
    const debt = selected.metrics.core_debtToIncome;
    const ftb = selected.metrics.core_advancesToFTB;
    if (debt.eligible && ftb.eligible && model.baselineRow.metrics.core_debtToIncome.eligible &&
      model.baselineRow.metrics.core_advancesToFTB.eligible && debt.change !== null && ftb.change !== null &&
      debt.change !== 0 && Math.sign(debt.change) === Math.sign(ftb.change)) {
      const debtOutcome = model.outcomes.find((item) => item.key === 'core_debtToIncome')!;
      const ftbOutcome = model.outcomes.find((item) => item.key === 'core_advancesToFTB')!;
      observations.push({ kind: 'tradeoff', title: `Inspect lending activity and leverage at ${selected.setting}`,
        text: `Against the same simulated baseline, mortgage debt to income changes ${formatReport2Difference(debt.change, debtOutcome)} alongside first-time-buyer advances ${formatReport2Difference(ftb.change, ftbOutcome)}. ${formatReport2Pairing(debt)} for debt to income; ${formatReport2Pairing(ftb)} for FTB advances. Complete KPI coverage at both settings; this does not establish a desirable policy change.`,
        pointIds: [selected.point.pointId, model.baselineRow.point.pointId] });
    }
  }

  if (analysis.reversals.length > 0) {
    const { left, right } = analysis.reversals[0];
    observations.push({ kind: 'reversal', title: `Investigate the sampled direction change at ${left.to.setting}`,
      text: `${outcome.title} changes ${formatReport2Difference(left.change, outcome)} from ${intervalLabel(left)}, then ${formatReport2Difference(right.change, outcome)} from ${intervalLabel(right)}. Both intervals have complete KPI seed coverage. A reversal between sampled points does not establish smooth behaviour between them.`,
      pointIds: [left.from.point.pointId, left.to.point.pointId, right.to.point.pointId] });
  } else if (analysis.diminishing.length > 0) {
    const { earlier, later } = analysis.diminishing[0];
    observations.push({ kind: 'diminishing', title: 'Investigate the smaller response in the next interval',
      text: `${outcome.title}: ${intervalLabel(earlier)} changes ${formatReport2Difference(earlier.change, outcome)} (slope ${formatReport2Number(earlier.slope)}), then ${intervalLabel(later)} changes ${formatReport2Difference(later.change, outcome)} (slope ${formatReport2Number(later.slope)}). Slopes use ${earlier.slopeUnits}; both intervals have complete KPI seed coverage.`,
      pointIds: [earlier.from.point.pointId, earlier.to.point.pointId, later.to.point.pointId] });
  }

  if (analysis.boundaryRows.length > 0) {
    observations.push({ kind: 'boundary', title: 'Consider extending the sampled range',
      text: `${outcome.title} has ${analysis.boundaryRows.length > 1 ? 'tied largest absolute changes' : 'a largest absolute change'} from baseline at ${analysis.boundaryRows.map((row) => `${row.setting} (${formatReport2Difference(row.metrics[outcome.key].change, outcome)})`).join(' and ')}, at the tested boundary. These comparisons have complete KPI seed coverage; behaviour beyond the sampled range is unknown.${analysis.excludedPointIds.length ? ' Incomplete settings are excluded from this comparison.' : ''}`,
      pointIds: analysis.boundaryRows.map((row) => row.point.pointId) });
  }
  return observations.slice(0, 3);
}
