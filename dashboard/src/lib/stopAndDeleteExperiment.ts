import type { ExperimentJobDeleteResponse, ExperimentJobSummary } from '../../shared/types';
import { cancelExperimentJob, deleteExperimentJob, fetchExperimentJobs, isRetryableApiError } from './api';

interface StopAndDeleteOptions {
  deleteKey?: string;
  onStopped?: () => void;
  cancel?: typeof cancelExperimentJob;
  loadJobs?: typeof fetchExperimentJobs;
  remove?: typeof deleteExperimentJob;
  wait?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPolls?: number;
}

function isFinished(job: ExperimentJobSummary): boolean {
  return job.status === 'succeeded' || job.status === 'failed' || job.status === 'canceled';
}

/** Cancel first; delete only after the API confirms that this particular job has stopped. */
export async function stopAndDeleteExperiment(jobRef: string, {
  deleteKey,
  onStopped,
  cancel = cancelExperimentJob,
  loadJobs = fetchExperimentJobs,
  remove = deleteExperimentJob,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  pollIntervalMs = 1000,
  maxPolls = 120
}: StopAndDeleteOptions = {}): Promise<ExperimentJobDeleteResponse> {
  let job: ExperimentJobSummary;
  try {
    ({ job } = await cancel(jobRef));
    if (job.jobRef !== jobRef) throw new Error('The server returned a different run.');
  } catch (error) {
    throw new Error(`Could not confirm the stop request. No deletion was attempted. ${(error as Error).message}`);
  }

  for (let poll = 0; !isFinished(job) && poll < maxPolls; poll += 1) {
    await wait(pollIntervalMs);
    try {
      const payload = await loadJobs();
      const current = payload.jobs.find((item) => item.jobRef === jobRef);
      if (!current) throw new Error('The run is no longer in the job list. Refresh Results to check its state.');
      job = current;
    } catch (error) {
      if (isRetryableApiError(error)) continue;
      throw new Error(`Stop requested, but its status could not be confirmed. No deletion was attempted. ${(error as Error).message}`);
    }
  }

  if (!isFinished(job)) {
    throw new Error('Stop requested, but the run has not confirmed it has stopped. Nothing was deleted. Retry once it finishes stopping.');
  }

  onStopped?.();
  try {
    const result = await remove(jobRef, deleteKey);
    if (!result.deleted || result.jobRef !== jobRef) throw new Error('The server did not confirm deletion.');
    return result;
  } catch (error) {
    throw new Error(`The run has stopped, but could not be deleted. ${(error as Error).message}`);
  }
}
