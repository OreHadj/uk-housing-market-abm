import { getResultsQueueRows, type ResultsQueueItem } from '../../../lib/resultsQueue';
import { ExperimentRunProgress } from './ExperimentRunProgress';
import type { useStopAndDeleteExperiment } from './useStopAndDeleteExperiment';

type StopDeletion = ReturnType<typeof useStopAndDeleteExperiment>;

function timestamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

/** The same queue actions and disclosure are used in both Results presentations. */
export function ResultsQueue({ items, expanded, onExpandedChange, canCancel, stopDeletion, loadingSubmitted = false }: {
  items: ResultsQueueItem[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  canCancel: boolean;
  stopDeletion: StopDeletion;
  loadingSubmitted?: boolean;
}) {
  const active = items.filter((job) => job.status === 'queued' || job.status === 'running' || job.jobRef === stopDeletion.pending?.jobRef);
  const { preview, waitingCount, visibleRemaining } = getResultsQueueRows(active, expanded);
  const cancelButton = (job: ResultsQueueItem) => canCancel && (
    <button type="button" className="danger-button" disabled={Boolean(stopDeletion.pending)}
      onClick={() => void stopDeletion.stopAndDelete(job.jobRef, job.title)}>
      {stopDeletion.pending?.jobRef === job.jobRef
        ? stopDeletion.pending.phase === 'stopping' ? 'Stopping…' : 'Deleting…'
        : 'Cancel'}
    </button>
  );
  const progress = (job: ResultsQueueItem) => <>
    <span className="status-pill partial">
      {stopDeletion.pending?.jobRef === job.jobRef
        ? stopDeletion.pending.phase === 'stopping' ? 'Stopping…' : 'Deleting…'
        : job.status === 'running' ? 'In progress' : 'Queued'}
    </span>
    {(job.status === 'queued' || job.status === 'running') && (
      <ExperimentRunProgress key={job.jobRef} jobRef={job.jobRef} title={job.title} status={job.status} />
    )}
  </>;

  return <>
    {stopDeletion.error && (
      <div className="error-banner" role="alert">
        <p>{stopDeletion.error}</p>
        {stopDeletion.retry && <button type="button" className="danger-button" onClick={() => void stopDeletion.retry?.()}>Retry cancellation</button>}
      </div>
    )}
    {stopDeletion.pending && (
      <p className="info-banner" role="status">
        {stopDeletion.pending.phase === 'stopping' ? 'Stopping' : 'Deleting'} run “{stopDeletion.pending.title}”…
      </p>
    )}
    {(preview || loadingSubmitted) && (
      <article className={`results-card run-queue-card${preview?.type === 'sensitivity' ? ' sensitivity-run-queue-card' : ''}`}>
        <div className="disclosure-preview-head">
          <div className="disclosure-preview-title">
            <h3>Queue</h3>
            <p>{waitingCount} other queued {waitingCount === 1 ? 'run' : 'runs'}</p>
          </div>
          <button type="button" className="disclosure-preview-toggle" aria-expanded={expanded}
            onClick={() => onExpandedChange(!expanded)} disabled={waitingCount === 0}>
            {expanded ? '▾ Hide' : '▸ Queue'}
          </button>
        </div>
        {preview ? (
          <div className="run-preview-card is-static" data-job-ref={preview.jobRef}>
            <span className="run-preview-title">{preview.title}</span>
            <span className="run-preview-meta">
              {progress(preview)}
              <span>{timestamp(preview.createdAt)}</span>
              {cancelButton(preview)}
            </span>
            {preview.instrumentTitle && <span className="run-preview-meta"><span>Instrument: {preview.instrumentTitle}</span></span>}
          </div>
        ) : <p className="info-banner" role="status">Loading submitted run...</p>}
        {visibleRemaining.length > 0 && (
          <ul className="job-list run-queue-list">
            {visibleRemaining.map((job) => (
              <li key={job.jobRef} className="job-item" data-job-ref={job.jobRef}>
                <strong>{job.title}</strong>
                <p className="run-preview-meta">{progress(job)}</p>
                {job.instrumentTitle ? <p>Instrument: {job.instrumentTitle}</p> : job.baseline && <p>Model {job.baseline}</p>}
                <p>{timestamp(job.createdAt)}</p>
                <div className="job-actions-row">{cancelButton(job)}</div>
              </li>
            ))}
          </ul>
        )}
      </article>
    )}
  </>;
}
