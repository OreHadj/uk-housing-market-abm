import { useEffect, useRef, useState } from 'react';
import type { ExperimentJobDeleteResponse } from '../../../../shared/types';
import { stopAndDeleteExperiment } from '../../../lib/stopAndDeleteExperiment';

interface PendingDeletion {
  jobRef: string;
  title: string;
  phase: 'stopping' | 'deleting';
}

export function useStopAndDeleteExperiment({
  canWrite,
  canDeleteResults,
  deleteKeyRequired,
  onDeleted
}: {
  canWrite: boolean;
  canDeleteResults: boolean;
  deleteKeyRequired: boolean;
  onDeleted: (result: ExperimentJobDeleteResponse) => void;
}) {
  const [pending, setPending] = useState<PendingDeletion | null>(null);
  const [error, setError] = useState('');
  const [retryTarget, setRetryTarget] = useState<{ jobRef: string; title: string } | null>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  const onDeletedRef = useRef(onDeleted);
  onDeletedRef.current = onDeleted;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const stopAndDelete = async (jobRef: string, title: string) => {
    if (!canWrite || !canDeleteResults || busy.current) return;
    if (!window.confirm(`Cancel run "${title}"? This cancels queued or running work and permanently removes its results.`)) return;
    const deleteKey = deleteKeyRequired
      ? window.prompt('Enter the private delete key to delete remote experiment results.')
      : undefined;
    if (deleteKeyRequired && !deleteKey) return;

    busy.current = true;
    setError('');
    setRetryTarget(null);
    setPending({ jobRef, title, phase: 'stopping' });
    try {
      // Keep the requested operation alive during in-app navigation, but never update an old view.
      const result = await stopAndDeleteExperiment(jobRef, {
        deleteKey: deleteKey ?? undefined,
        onStopped: () => {
          if (mounted.current) setPending({ jobRef, title, phase: 'deleting' });
        }
      });
      if (mounted.current) onDeletedRef.current(result);
    } catch (cause) {
      if (mounted.current) {
        setError(`Run "${title}": ${(cause as Error).message}`);
        setRetryTarget({ jobRef, title });
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  };

  return {
    pending, error, stopAndDelete,
    retry: retryTarget ? () => stopAndDelete(retryTarget.jobRef, retryTarget.title) : null
  };
}
