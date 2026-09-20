import { useEffect, useState } from 'react';
import type { ExperimentProgressSnapshot } from '../../../shared/types';
import { fetchExperimentJobLogs, isRetryableApiError } from '../../lib/api';

const MAX_LOG_LINES = 10_000;

interface ExperimentLogState {
  jobRef: string;
  lines: string[];
  progress: ExperimentProgressSnapshot | null;
  error: string;
}

function initialState(jobRef: string): ExperimentLogState {
  return { jobRef, lines: [], progress: null, error: '' };
}

export function watchExperimentLogs({
  jobRef,
  onUpdate,
  progressOnly = false,
  loadLogs = fetchExperimentJobLogs,
  pollIntervalMs = progressOnly ? 3000 : 1500
}: {
  jobRef: string;
  onUpdate: (state: ExperimentLogState) => void;
  progressOnly?: boolean;
  loadLogs?: typeof fetchExperimentJobLogs;
  pollIntervalMs?: number;
}): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cursor = 0;
  let state = initialState(jobRef);
  onUpdate(state);

  const pollLogs = async () => {
    try {
      // Progress is current regardless of the log cursor. A bar needs no log backlog.
      const payload = await loadLogs(jobRef, cursor, progressOnly ? 1 : 200);
      if (cancelled) return;
      if (payload.jobRef !== jobRef) throw new Error('Received progress for a different experiment.');

      cursor = payload.nextCursor;
      state = {
        jobRef,
        progress: payload.progress ?? null,
        lines: progressOnly ? [] : payload.truncated
          ? payload.lines
          : [...state.lines, ...payload.lines].slice(-MAX_LOG_LINES),
        error: ''
      };
      onUpdate(state);

      const status = payload.progress?.status;
      if (payload.done || (progressOnly && (status === 'succeeded' || status === 'failed' || status === 'canceled'))) {
        return;
      }
    } catch (fetchError) {
      if (cancelled) return;
      if (progressOnly || !isRetryableApiError(fetchError)) {
        state = { ...state, error: fetchError instanceof Error ? fetchError.message : 'Unable to refresh progress.' };
        onUpdate(state);
      }
    }

    // Slow requests cannot overlap or overwrite a newer snapshot.
    if (!cancelled) timer = setTimeout(() => void pollLogs(), pollIntervalMs);
  };

  void pollLogs();
  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

export function useExperimentLogs(jobRef: string, enabled: boolean, progressOnly = false): {
  lines: string[];
  progress: ExperimentProgressSnapshot | null;
  error: string;
} {
  const [state, setState] = useState(() => initialState(jobRef));
  useEffect(() => {
    if (!enabled || !jobRef) return;
    return watchExperimentLogs({ jobRef, onUpdate: setState, progressOnly });
  }, [enabled, jobRef, progressOnly]);

  // Never paint the previous job's progress while the new effect is starting.
  return enabled && state.jobRef === jobRef ? state : initialState(jobRef);
}
