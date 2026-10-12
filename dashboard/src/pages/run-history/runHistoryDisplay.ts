import type {
  ModelRunJobStatus,
  ResultsRunDetail,
  ResultsRunStatus,
  ResultsRunSummary,
  SensitivityExperimentSummary
} from '../../../shared/types';
import { summariseRunPolicy } from '../../../shared/policyCatalogue';
import { formatModelName } from '../../lib/modelAnchors';
import { extractVersionFromResultsRunId } from '../../lib/versionLabels';

/** Shared by Run History and the results views, so a run reads the same everywhere. */

const PROTECTED_RESULTS_RUN_IDS = new Set(['v0-output', 'v4.0-output']);

export function isProtectedResultsRun(runId: string): boolean {
  return PROTECTED_RESULTS_RUN_IDS.has(runId.trim());
}

export function getRunModelVersion(
  run: Pick<ResultsRunSummary, 'runId'> & { configuration?: ResultsRunDetail['configuration'] }
): string | null {
  return run.configuration?.modelVersion ?? extractVersionFromResultsRunId(run.runId);
}

export function getRunPrimaryLabel(run: Pick<ResultsRunSummary, 'runId' | 'title'>): string {
  const title = run.title?.trim();
  if (title) return title;
  const version = getRunModelVersion(run);
  return version ? formatModelName(version) : run.runId;
}

export function resultsRunStatusClass(status: ResultsRunStatus): string {
  switch (status) {
    case 'complete':
      return 'status-pill complete';
    case 'partial':
      return 'status-pill partial';
    default:
      return 'status-pill invalid';
  }
}

export const MODEL_RUN_JOB_STATUS_META: Record<ModelRunJobStatus, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'status-pill partial' },
  running: { label: 'In progress', className: 'status-pill partial' },
  succeeded: { label: 'Completed successfully', className: 'status-pill complete' },
  failed: { label: 'Failed', className: 'status-pill invalid' },
  canceled: { label: 'Canceled', className: 'coverage-pill unsupported' }
};

export function formatQueueTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

/**
 * A run's full recorded policy, plus which settings deviate from the baseline it matches. Shown in
 * full on every run so a run stays identifiable when its name is missing or unclear.
 */
export function describeRunPolicy(run: ResultsRunSummary): { heading: string; changedKeys: Set<string> } | null {
  if (run.policySettings.length === 0) {
    return null;
  }
  const summary = summariseRunPolicy(run.policySettings);
  const changedKeys = new Set(summary.deviations.map((deviation) => deviation.key));
  const heading = summary.basePolicyTitle
    ? summary.deviations.length === 0
      ? `${summary.basePolicyTitle}, unchanged`
      : `${summary.basePolicyTitle} · ${summary.deviations.length} changed`
    : `${run.policySettings.length} Central Bank settings`;
  return { heading, changedKeys };
}

export function sensitivityStatusClass(status: SensitivityExperimentSummary['status']): string {
  switch (status) {
    case 'succeeded':
      return 'status-pill complete';
    case 'running':
      return 'status-pill partial';
    case 'queued':
    case 'canceled':
      return 'coverage-pill unsupported';
    default:
      return 'status-pill invalid';
  }
}

export function formatSensitivityStatus(status: SensitivityExperimentSummary['status']): string {
  return status.replace('_', ' ');
}

export function isFinishedSensitivityStatus(status: SensitivityExperimentSummary['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}

export function formatBasePolicyLabel(basePolicy: SensitivityExperimentSummary['basePolicy']): string {
  return basePolicy ? `${basePolicy} baseline policy` : 'Not recorded';
}
