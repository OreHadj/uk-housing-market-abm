// Author: Max Stoddard
import type { ModelRunSnapshotOption } from '../../shared/types';
import { buildModelOptions, formatModelOptionLabel, formatModelSubtitle } from './modelAnchors';

/**
 * The snapshots a run can be launched against: the four named models, plus whichever version is
 * currently selected if a saved run or deep link points at an intermediate calibration step.
 */
export function orderExperimentModelOptions(
  snapshots: readonly ModelRunSnapshotOption[],
  selectedVersion?: string
): ModelRunSnapshotOption[] {
  const byVersion = new Map(snapshots.map((snapshot) => [snapshot.version, snapshot]));
  const inProgress = new Set(snapshots.filter((snapshot) => snapshot.status === 'in_progress').map((s) => s.version));

  return buildModelOptions(
    snapshots.map((snapshot) => snapshot.version),
    selectedVersion,
    inProgress
  )
    .map((option) => byVersion.get(option.version))
    .filter((snapshot): snapshot is ModelRunSnapshotOption => Boolean(snapshot));
}

/**
 * Short statement of what a snapshot was built from and fitted to — the two things the version id
 * itself does not say.
 */
export function formatEvidenceNote(snapshot: Pick<ModelRunSnapshotOption, 'version'>): string {
  return formatModelSubtitle(snapshot.version);
}

export function formatExperimentModelOption(snapshot: ModelRunSnapshotOption): string {
  return formatModelOptionLabel(snapshot.version, { isInProgress: snapshot.status === 'in_progress' });
}
