// Author: Max Stoddard
import type { ResultsRunStatus } from '../../shared/types';
import type { VersionLabelState } from '../lib/versionLabels';

function statusClass(status: ResultsRunStatus): string {
  switch (status) {
    case 'complete':
      return 'status-pill complete';
    case 'partial':
      return 'status-pill partial';
    default:
      return 'status-pill invalid';
  }
}

interface ManualSelectionStatusPillsProps {
  status: ResultsRunStatus;
  versionLabelState: VersionLabelState | null;
}

export function ManualSelectionStatusPills({ status, versionLabelState }: ManualSelectionStatusPillsProps) {
  // "Latest" and "Original" used to sit here, but both were derived from position in the version
  // list rather than from anything about the model. In-progress is the only real state left.
  return (
    <span className="manual-selection-status-pills">
      <span className={statusClass(status)}>{status}</span>
      {versionLabelState?.isInProgress && <span className="status-pill-in-progress">In progress</span>}
    </span>
  );
}
