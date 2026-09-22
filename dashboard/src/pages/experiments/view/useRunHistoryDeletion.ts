import { useEffect, useRef, useState } from 'react';
import { deleteRunHistorySelection, type RunHistoryItem } from '../../../lib/runHistoryDeletion';

interface RunHistoryDeletionOptions {
  items: readonly RunHistoryItem[];
  canDelete: boolean;
  deleteKeyRequired: boolean;
  deleteItem: (id: string, key?: string) => Promise<unknown>;
  onDeleted: (ids: string[]) => void | Promise<void>;
}

export function useRunHistoryDeletion(options: RunHistoryDeletionOptions) {
  const { items, canDelete } = options;
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const mounted = useRef(false);
  const latest = useRef(options);
  latest.current = options;
  const eligibleIds = new Set(canDelete ? items.map((item) => item.id) : []);
  const selectedIds = new Set([...checkedIds].filter((id) => eligibleIds.has(id)));
  const eligibleKey = JSON.stringify([...eligibleIds].sort());

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const eligible = new Set<string>(JSON.parse(eligibleKey));
    setCheckedIds((current) => {
      const next = new Set([...current].filter((id) => eligible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [eligibleKey]);

  const toggle = (id: string, checked: boolean) => {
    if (busy.current || !canDelete || !eligibleIds.has(id)) return;
    setCheckedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const selectAll = (checked: boolean) => {
    if (busy.current || !canDelete) return;
    setCheckedIds(checked ? new Set(eligibleIds) : new Set());
  };
  const deleteSelected = async () => {
    if (busy.current || !canDelete || !selectedIds.size) return;
    busy.current = true;
    setIsDeleting(true);
    setError('');
    try {
      const result = await deleteRunHistorySelection({
        ...latest.current,
        selectedIds,
        confirm: (message) => window.confirm(message),
        promptDeleteKey: () => window.prompt('Enter the private delete key to delete remote experiment results.'),
        canDeleteItem: (id) => latest.current.canDelete && latest.current.items.some((item) => item.id === id)
      });
      if (!mounted.current || result.cancelled) return;
      const deletedIds = new Set(result.deletedIds);
      setCheckedIds((current) => new Set([...current].filter((id) => !deletedIds.has(id))));
      const failureText = result.failures.length
        ? `Could not delete ${result.failures.length} ${result.failures.length === 1 ? 'run' : 'runs'}: ${result.failures.map((failure) => `${failure.label}: ${failure.message}`).join('; ')}`
        : '';
      setError(failureText);
      if (result.deletedIds.length) {
        try {
          await latest.current.onDeleted(result.deletedIds);
        } catch (cause) {
          if (mounted.current) setError([failureText, `Runs were deleted, but the history could not refresh: ${cause instanceof Error ? cause.message : String(cause)}`].filter(Boolean).join(' '));
        }
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busy.current = false;
      if (mounted.current) setIsDeleting(false);
    }
  };

  return {
    selectedIds, selectedCount: selectedIds.size, selectableCount: eligibleIds.size,
    allSelected: eligibleIds.size > 0 && selectedIds.size === eligibleIds.size,
    someSelected: selectedIds.size > 0 && selectedIds.size < eligibleIds.size,
    isDeleting, error, toggle, selectAll, deleteSelected
  };
}

export type RunHistoryDeletionSelection = ReturnType<typeof useRunHistoryDeletion>;
