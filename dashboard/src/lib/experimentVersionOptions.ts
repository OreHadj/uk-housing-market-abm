// Author: Max Stoddard
import type { ModelRunSnapshotOption } from '../../shared/types';

const OPTIMISED_2011_VERSION = 'v0o7';
const OPTIMISED_2024_VERSION = 'v5o3';
const LEGACY_2011_VERSION_IDS = ['v0o', 'v0oo', 'v0o1', 'v0o2', 'v0o3', 'v0o6', OPTIMISED_2011_VERSION] as const;
const ORIGINAL_2011_VERSION = 'v0';
const LEGACY_2011_VERSIONS = new Set([...LEGACY_2011_VERSION_IDS, ORIGINAL_2011_VERSION]);

function statusSuffix(snapshot: ModelRunSnapshotOption): string {
  return snapshot.status === 'in_progress' ? ', In progress' : '';
}

export function orderExperimentModelOptions(snapshots: readonly ModelRunSnapshotOption[]): ModelRunSnapshotOption[] {
  const byVersion = new Map(snapshots.map((snapshot) => [snapshot.version, snapshot]));
  const optimised2011Version = byVersion.has(OPTIMISED_2011_VERSION) ? OPTIMISED_2011_VERSION : undefined;
  const optimised2024Version = byVersion.has(OPTIMISED_2024_VERSION) ? OPTIMISED_2024_VERSION : undefined;
  const fallbackLatest2024 =
    snapshots.find((snapshot) => !LEGACY_2011_VERSIONS.has(snapshot.version) && snapshot.status !== 'in_progress') ??
    snapshots.find((snapshot) => !LEGACY_2011_VERSIONS.has(snapshot.version));
  const preferredVersions = [optimised2011Version, ORIGINAL_2011_VERSION, optimised2024Version ?? fallbackLatest2024?.version].filter(
    (version): version is string => Boolean(version)
  );
  const preferredSet = new Set(preferredVersions);

  return [
    ...preferredVersions.map((version) => byVersion.get(version)).filter((snapshot): snapshot is ModelRunSnapshotOption => Boolean(snapshot)),
    ...snapshots.filter((snapshot) => !preferredSet.has(snapshot.version))
  ];
}

/**
 * Short statement of what a snapshot was tuned against. Output calibrations were fitted to a
 * specific evidence year; input/data snapshots inherit whatever fit came before them.
 */
export function formatEvidenceNote(
  snapshot: Pick<ModelRunSnapshotOption, 'version' | 'evidenceYear' | 'outputCalibrated'>
): string {
  if (snapshot.version === ORIGINAL_2011_VERSION) {
    return 'Original 2011 model';
  }
  if (snapshot.evidenceYear === null) {
    return snapshot.outputCalibrated ? 'Output-calibrated' : 'Data version';
  }
  return snapshot.outputCalibrated
    ? `Optimised for ${snapshot.evidenceYear} evidence`
    : `${snapshot.evidenceYear} data version, inherits an earlier calibration`;
}

export function formatExperimentModelOption(snapshot: ModelRunSnapshotOption, snapshots: readonly ModelRunSnapshotOption[]): string {
  void snapshots;
  const releaseState = LEGACY_2011_VERSIONS.has(snapshot.version) ? 'Stable' : `Beta${statusSuffix(snapshot)}`;
  // The version id always leads, so what is actually being run is never hidden behind a friendly
  // name, and every option states the evidence era it was tuned against rather than only some.
  return `${snapshot.version} — ${formatEvidenceNote(snapshot)} (${releaseState})`;
}
