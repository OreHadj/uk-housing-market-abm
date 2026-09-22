import type { ReportOutcome, ReportRow, SensitivityReportModel } from './reportModel';
import { isReportMetricEligible } from './reportModel';

const OUTCOMES = [
  { id: 'core_mortgageApprovals', title: 'Mortgage approvals', theme: 'Credit activity', description: 'Monthly house-purchase approvals at UK scale.', cue: 'Where do approval responses change sharply or flatten?' },
  { id: 'core_debtToIncome', title: 'Mortgage debt to income', theme: 'Household indebtedness', description: 'Total mortgage debt relative to annualised net household income.', cue: 'Do settings that increase approvals also raise indebtedness?' },
  { id: 'core_priceToIncome', title: 'House price to income', theme: 'Housing affordability', description: 'House price relative to mean annualised net household income.', cue: 'How does affordability move at those same policy settings?' }
] as const;

export interface CompactReportOutcome extends ReportOutcome {
  description: string;
  cue: string;
  relative: boolean;
  /** A representative raw mean when the designated baseline cannot support a comparison. */
  focusRow: ReportRow | null;
  largest: { row: ReportRow; change: number } | null;
  /** Equally large changes may have opposite signs; keep their rows and values separate. */
  ties: Array<{ row: ReportRow; change: number }>;
}

export function buildCompactReportOutcomes(report: SensitivityReportModel): CompactReportOutcome[] {
  return OUTCOMES.map((definition) => {
    const indicator = report.indicators.find((item) => item.id === definition.id);
    const baselineMean = indicator?.baselineMean ?? null;
    const eligible = report.rows.filter((row) => !row.point.isBaseline &&
      row.point.value !== null && Number.isFinite(row.point.value) && isReportMetricEligible(row, definition.id));
    // Preserve the backend's near-zero guard. A negative denominator also obscures direction:
    // show raw levels for the entire outcome, never mix relative and raw values on one axis.
    const relative = baselineMean !== null && baselineMean > 0 && eligible.length > 0 &&
      eligible.every((row) => row.metrics[definition.id].relativeChange !== null);
    const candidates = eligible.flatMap((row) => {
      const metric = row.metrics[definition.id];
      const change = relative ? metric.relativeChange : metric.absoluteChange;
      return change !== null && Number.isFinite(change) ? [{ row, change }] : [];
    });
    const magnitude = candidates.reduce((max, candidate) => Math.max(max, Math.abs(candidate.change)), -1);
    const winners = candidates.filter((candidate) => Math.abs(candidate.change) === magnitude);
    return {
      ...definition,
      units: indicator?.units ?? '',
      measure: 'mean',
      baselineMean,
      available: eligible.length > 0,
      relative,
      focusRow: winners[0]?.row ?? eligible[0] ?? null,
      largest: winners[0] ?? null,
      ties: winners.slice(1)
    };
  });
}

export function compactReportNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Unavailable';
  return value.toLocaleString('en-GB', Math.abs(value) > 0 && Math.abs(value) < 0.1
    ? { maximumSignificantDigits: 3 }
    : { maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2 });
}

export function compactReportValue(value: number | null, units: string, signed = false): string {
  if (value === null || !Number.isFinite(value)) return 'Unavailable';
  const number = `${signed && value > 0 ? '+' : ''}${compactReportNumber(value)}`;
  const suffix = units === '%' ? signed ? ' pp' : '%'
    : units === 'percentage points' ? ' pp'
      : units === 'count/month' ? ' / month'
        : units === 'ratio' ? '×' : ` ${units}`;
  return number + suffix;
}

export function compactReportChange(value: number, outcome: Pick<CompactReportOutcome, 'relative' | 'units'>): string {
  return outcome.relative
    ? `${value > 0 ? '+' : ''}${compactReportNumber(value)}%`
    : compactReportValue(value, outcome.units, true);
}
