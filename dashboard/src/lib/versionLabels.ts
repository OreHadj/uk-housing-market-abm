// Author: Max Stoddard
//
// Whether a snapshot is still being validated. Model *naming* lives in `modelAnchors`; this module
// only resolves a results run id back to the snapshot that produced it.
export interface VersionLabelState {
  version: string;
  isInProgress: boolean;
}

const RESULTS_RUN_VERSION_PATTERN = /^(v\d+(?:\.\d+)*(?:o+|o\d+)?)-output$/i;

export function buildVersionLabelState(version: string, inProgressVersions: ReadonlySet<string>): VersionLabelState {
  return { version, isInProgress: inProgressVersions.has(version) };
}

export function extractVersionFromResultsRunId(runId: string): string {
  const match = RESULTS_RUN_VERSION_PATTERN.exec(runId.trim());
  return match?.[1] ?? '';
}

export function buildResultsRunVersionLabelState(
  runId: string,
  versions: readonly string[],
  inProgressVersions: readonly string[]
): VersionLabelState | null {
  const version = extractVersionFromResultsRunId(runId);
  if (!version || versions.length === 0 || !versions.includes(version)) {
    return null;
  }

  return buildVersionLabelState(version, new Set(inProgressVersions));
}
