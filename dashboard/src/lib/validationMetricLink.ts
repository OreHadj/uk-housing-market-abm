/** A metric link is meaningful only when the selected evidence actually contains that metric. */
export function readValidationMetricLink(params: URLSearchParams, availableMetricIds: readonly string[]): string | null {
  const metricId = params.get('metric')?.trim();
  return metricId && availableMetricIds.includes(metricId) ? metricId : null;
}

/** Distinguish the same metric in different model/evidence views without reapplying on every render. */
export function validationMetricLinkKey(metricId: string, version: string, evidenceYear: number): string {
  return JSON.stringify([version, evidenceYear, metricId]);
}
