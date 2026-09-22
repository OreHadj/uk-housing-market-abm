import type { ValidationMetricSummary, ValidationOverviewPayload } from '../../../shared/types';

type DemonstrableMetric = Pick<ValidationMetricSummary,
  'metricId' | 'status' | 'sourceValue' | 'targetBand' | 'seedMean' | 'insideRate' | 'lossFamily'>;

/** The short tour needs a scalar target, a meaningful band and repeated-run results. */
export function selectModelInformationValidationMetric<Metric extends DemonstrableMetric>(
  metrics: readonly Metric[],
  visibleMetricIds: readonly string[]
): Metric | null {
  const usable = new Map(metrics.filter((metric) =>
    metric.status !== 'unsupported' &&
    metric.lossFamily !== 'bounded_low_is_better' &&
    metric.sourceValue !== null && Number.isFinite(metric.sourceValue) &&
    Number.isFinite(metric.seedMean) &&
    metric.insideRate !== null && Number.isFinite(metric.insideRate) &&
    metric.insideRate >= 0 && metric.insideRate <= 1 &&
    metric.targetBand !== null &&
    Number.isFinite(metric.targetBand.lower) && Number.isFinite(metric.targetBand.upper) &&
    metric.targetBand.lower <= metric.targetBand.upper
  ).map((metric) => [metric.metricId, metric]));
  if (visibleMetricIds.includes('core_mortgageApprovals') && usable.has('core_mortgageApprovals')) {
    return usable.get('core_mortgageApprovals') ?? null;
  }
  for (const metricId of visibleMetricIds) {
    const metric = usable.get(metricId);
    if (metric) return metric;
  }
  return null;
}

/** A walkthrough must not quietly switch the model or evidence behind its explanation. */
export function matchesModelInformationValidationSelection(
  overview: Pick<ValidationOverviewPayload, 'selectedVersion' | 'selectedValidationTargetYear' | 'selectedSummary'> &
    Partial<Pick<ValidationOverviewPayload, 'comparisonSummary'>>,
  version: string,
  evidenceYear: number,
  comparisonVersion?: string
): boolean {
  const primaryMatches = Boolean(version && overview.selectedVersion === version &&
    overview.selectedValidationTargetYear === evidenceYear &&
    overview.selectedSummary?.version === version &&
    overview.selectedSummary.validationTargetYear === evidenceYear);
  if (!primaryMatches) return false;
  // Omitting the optional selection checks the primary alone, including when recovering from
  // an unavailable comparison. An explicit empty selection must never show stale comparison data.
  if (comparisonVersion === undefined) return true;
  if (!comparisonVersion) return !overview.comparisonSummary;
  return comparisonVersion !== version &&
    overview.comparisonSummary?.version === comparisonVersion &&
    overview.comparisonSummary.validationTargetYear === evidenceYear;
}
