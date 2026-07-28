import { Link } from 'react-router-dom';
import type { ExperimentJobSummary } from '../../../shared/types';

function statusClass(status: ExperimentJobSummary['status']): string {
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

function formatStatus(status: ExperimentJobSummary['status']): string {
  return status.replace('_', ' ');
}

function typeLabel(type: ExperimentJobSummary['type']): string {
  return type === 'manual' ? 'Policy scenario' : 'Policy sensitivity';
}

function isFinishedStatus(status: ExperimentJobSummary['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}

interface ExperimentQueueCardProps {
  jobs: ExperimentJobSummary[];
  workspaceType: ExperimentJobSummary['type'];
  isLoading: boolean;
  selectedJobRef: string;
  onSelectJobRef: (jobRef: string) => void;
  executionDisabled: boolean;
  authEnabled: boolean;
  canDownloadResults: boolean;
  canDeleteResults: boolean;
  downloadingJobRef: string;
  deletingJobRef: string;
  onOpenResults: (job: ExperimentJobSummary) => void;
  onCancelJob: (jobRef: string) => void;
  onDownloadJob: (job: ExperimentJobSummary) => void;
  onDeleteJob: (job: ExperimentJobSummary) => void;
}

export function ExperimentQueueCard({
  jobs,
  workspaceType,
  isLoading,
  selectedJobRef,
  onSelectJobRef,
  executionDisabled,
  authEnabled,
  canDownloadResults,
  canDeleteResults,
  downloadingJobRef,
  deletingJobRef,
  onOpenResults,
  onCancelJob,
  onDownloadJob,
  onDeleteJob
}: ExperimentQueueCardProps) {
  return (
    <article className="results-card">
      <h3>{workspaceType === 'manual' ? 'Policy scenario runs' : 'Policy sensitivity history'}</h3>
      {isLoading ? (
        <p className="loading-banner">Loading experiment jobs...</p>
      ) : jobs.length === 0 ? (
        <p className="info-banner">
          {workspaceType === 'manual' ? 'No policy scenario runs submitted yet.' : 'No policy sweeps submitted yet.'}
        </p>
      ) : (
        <ul className="job-list">
          {jobs.map((job) => {
            const canOpenResults =
              job.status === 'succeeded' &&
              (job.type === 'sensitivity' || Boolean(job.runId));
            return (
            <li key={job.jobRef} className={`job-item ${selectedJobRef === job.jobRef ? 'focused' : ''}`}>
              <button
                type="button"
                className="run-focus-btn"
                onClick={() => canOpenResults ? onOpenResults(job) : onSelectJobRef(job.jobRef)}
              >
                {canOpenResults ? 'View results' : selectedJobRef === job.jobRef ? 'Viewing logs' : 'View logs'}
              </button>
              <strong>{job.title}</strong>
              <p>
                {typeLabel(job.type)} • {job.id}
              </p>
              {job.baseline && <p>Baseline: {job.baseline}</p>}
              <p>
                <span className={statusClass(job.status)}>{formatStatus(job.status)}</span>
              </p>
              <p>{job.createdAt}</p>

              {(job.status === 'queued' || job.status === 'running') && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={executionDisabled}
                  onClick={() => onCancelJob(job.jobRef)}
                >
                  Cancel
                </button>
              )}

              {isFinishedStatus(job.status) && (
                <div className="job-actions-row">
                  {job.status === 'succeeded' && (
                    !canDownloadResults ? (
                      authEnabled ? (
                        <Link
                          className="summary-link-inline"
                          to={`/login?next=${encodeURIComponent(job.type === 'manual' ? '/scenarios' : '/sensitivity')}`}
                        >
                          Login to Download
                        </Link>
                      ) : (
                        <button type="button" className="summary-link-inline summary-button-inline" disabled>
                          Download Unavailable
                        </button>
                      )
                    ) : (
                      <button
                        type="button"
                        className="summary-link-inline summary-button-inline queue-download-button"
                        disabled={downloadingJobRef === job.jobRef}
                        onClick={() => onDownloadJob(job)}
                      >
                        {downloadingJobRef === job.jobRef ? 'Downloading...' : 'Download Results'}
                      </button>
                    )
                  )}
                  <button
                    type="button"
                    className="danger-button"
                    disabled={!canDeleteResults || deletingJobRef === job.jobRef}
                    onClick={() => onDeleteJob(job)}
                    title={!canDeleteResults ? 'Delete access is unavailable in this environment.' : undefined}
                  >
                    {deletingJobRef === job.jobRef ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
