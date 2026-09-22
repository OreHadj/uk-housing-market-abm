import type { ExperimentJobSummary, ExperimentJobType, ModelRunJob, SensitivityExperimentSummary } from '../../shared/types';
import { fetchModelRunJobs, fetchSensitivityExperiments } from './api';

export interface ResultsQueueItem extends ExperimentJobSummary {
  instrumentTitle?: string;
}

export function manualResultsQueueItem(job: ModelRunJob): ResultsQueueItem {
  return {
    ...job, type: 'manual', id: job.jobId, jobRef: `manual:${job.jobId}`,
    title: job.title || job.runId || job.jobId
  };
}

export function sensitivityResultsQueueItem(experiment: SensitivityExperimentSummary): ResultsQueueItem {
  return {
    ...experiment, type: 'sensitivity', id: experiment.experimentId,
    jobRef: `sensitivity:${experiment.experimentId}`,
    title: experiment.title || experiment.experimentId,
    instrumentTitle: experiment.parameter.title
  };
}

/** Running (or stopping) jobs stay visible; only waiting jobs belong in the disclosure. */
export function getResultsQueueRows<T extends { status: string }>(items: T[], expanded: boolean) {
  const preview = items.find((item) => item.status !== 'queued') ?? items[0] ?? null;
  const remaining = items.filter((item) => item !== preview);
  return {
    preview,
    waitingCount: remaining.filter((item) => item.status === 'queued').length,
    visibleRemaining: remaining.filter((item) => item.status !== 'queued' || expanded)
  };
}

export function findSubmittedReportJob(items: ResultsQueueItem[], type: ExperimentJobType, jobRef: string, selectionId: string) {
  return items.find((job) => job.type === type
    && (!jobRef || job.jobRef === jobRef)
    && (selectionId ? (type === 'manual' ? job.runId : job.id) === selectionId : Boolean(jobRef)));
}

export interface ResultsQueueState {
  items: ResultsQueueItem[];
  loading: boolean;
  error: string;
}

export interface ReportExecutionState {
  blocked: boolean;
  selectedJob?: ResultsQueueItem;
  items: ResultsQueueItem[];
  revision: string;
  removedIds: string[];
}

/** Keep the queue available while reading a report, using Detailed's existing list APIs. */
export function watchResultsQueue({ type, onUpdate, pollIntervalMs = 4000, loadJobs = async (kind) => kind === 'manual'
  ? (await fetchModelRunJobs()).map(manualResultsQueueItem)
  : (await fetchSensitivityExperiments()).experiments.map(sensitivityResultsQueueItem)
}: {
  type: ExperimentJobType;
  onUpdate: (state: ResultsQueueState) => void;
  pollIntervalMs?: number;
  loadJobs?: (type: ExperimentJobType) => Promise<ResultsQueueItem[]>;
}): () => void {
  let canceled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let state: ResultsQueueState = { items: [], loading: true, error: '' };
  onUpdate(state);
  const poll = async () => {
    try {
      const items = await loadJobs(type);
      if (canceled) return;
      state = { items: items.filter((job) => job.type === type), loading: false, error: '' };
    } catch {
      if (canceled) return;
      state = { ...state, error: 'Unable to refresh the queue. Reconnecting automatically.' };
    }
    onUpdate(state);
    if (!canceled) timer = setTimeout(() => void poll(), pollIntervalMs);
  };
  void poll();
  return () => { canceled = true; clearTimeout(timer); };
}
