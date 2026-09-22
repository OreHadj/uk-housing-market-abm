import type { ValidationOverviewPayload } from '../../../shared/types';

type ContextOverview = Pick<ValidationOverviewPayload,
  'selectedVersion' | 'selectedValidationTargetYear' | 'availableValidationTargetYearsByVersion'
> & {
  selectedSummary: Pick<ValidationOverviewPayload['selectedSummary'], 'version' | 'validationTargetYear'>;
};

export function modelInformationCalibrationVersion(
  requested: string,
  available: readonly string[],
  defaultVersion: string
): string {
  const version = requested.trim();
  if (version && !available.includes(version)) {
    throw new Error(`Calibration evidence is unavailable for ${version}. Exit the demo to choose an available model.`);
  }
  return version || defaultVersion;
}

/** Resolve evidence for this exact model; only an unspecified year may use a supported default. */
export async function loadModelInformationValidationContext(
  version: string,
  requestedYear: number | undefined,
  loadOverview: (version: string, year?: number) => Promise<ContextOverview>
): Promise<{ version: string; evidenceYear: number }> {
  if (requestedYear !== undefined && (!Number.isInteger(requestedYear) || requestedYear <= 0)) {
    throw new Error('The requested evidence year is invalid. Exit the demo to choose an available year.');
  }
  let response = await loadOverview(version, requestedYear);
  const responseMatches = (candidate: ContextOverview) => {
    const year = candidate.selectedValidationTargetYear;
    return candidate.selectedVersion === version && candidate.selectedSummary.version === version &&
      candidate.selectedSummary.validationTargetYear === year &&
      (candidate.availableValidationTargetYearsByVersion[version] ?? []).includes(year) &&
      (requestedYear === undefined || year === requestedYear);
  };
  if (requestedYear === undefined && !responseMatches(response)) {
    // Some endpoints may choose another model for their default year. The metadata
    // allows one explicit retry with evidence supported by the original model.
    const years = (response.availableValidationTargetYearsByVersion[version] ?? [])
      .filter((year) => Number.isInteger(year) && year > 0);
    const supportedYear = years.includes(2024) ? 2024 : years[0];
    if (supportedYear !== undefined) response = await loadOverview(version, supportedYear);
  }
  if (!responseMatches(response)) {
    throw new Error(`Validation evidence is unavailable for ${version}${requestedYear ? ` in ${requestedYear}` : ''}. Exit the demo to choose an available model and year.`);
  }
  return { version, evidenceYear: response.selectedValidationTargetYear };
}
