import type { ExperimentProgressSnapshot } from '../../../../shared/types';
import { useExperimentLogs } from '../../run-experiments/useExperimentLogs';

export function ExperimentProgressBar({
  progress,
  queued = false,
  error = '',
  label = 'Simulation execution progress'
}: {
  progress: ExperimentProgressSnapshot | null;
  queued?: boolean;
  error?: string;
  label?: string;
}) {
  // Failed/cancelled attempts can contribute 100% to the server's work counter.
  if (progress?.status === 'failed' || progress?.status === 'canceled') {
    return <span role="status">{progress.status === 'failed' ? 'Run failed' : 'Run cancelled'}</span>;
  }
  const percent = queued ? 0 : progress && Number.isFinite(progress.percentComplete)
    ? Math.max(0, Math.min(100, progress.percentComplete))
    : null;
  const percentLabel = percent === null ? 'Starting…' : `${percent.toFixed(1)}%`;

  return (
    <span className="run-preview-meta" style={{ display: 'inline-flex', maxWidth: '100%' }}>
      <span
        className="job-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={queued ? 'Queued, waiting to start' : error ? `Last reported ${percentLabel}. Progress updates unavailable.` : percent === null ? 'Waiting for the first progress update' : percentLabel}
        style={{ width: 'clamp(6rem, 20vw, 16rem)', flexShrink: 0 }}
      >
        <span style={{ width: `${percent ?? 0}%` }} />
      </span>
      <span>{error && percent !== null ? `Last reported ${percentLabel}` : percentLabel}</span>
      {error && <span>Progress updates unavailable. Retrying…</span>}
    </span>
  );
}

/** One bar per queue row; waiting jobs need no progress requests. */
export function ExperimentRunProgress({ jobRef, title, status = 'running' }: { jobRef: string; title: string; status?: 'queued' | 'running' }) {
  const { progress, error } = useExperimentLogs(jobRef, status === 'running', true);
  return <ExperimentProgressBar progress={progress} queued={status === 'queued'} error={error} label={`Simulation execution progress for ${title}`} />;
}
