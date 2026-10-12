import { useEffect, useRef } from 'react';
import type { RunHistoryDeletionSelection } from './useRunHistoryDeletion';

export function RunHistorySelectionToolbar({ selection, selectAllLabel = 'Select all' }: {
  selection: RunHistoryDeletionSelection;
  selectAllLabel?: string;
}) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selection.someSelected;
  }, [selection.someSelected]);
  return <div className="run-history-selection-toolbar" role="group" aria-label="Run history selection" aria-busy={selection.isDeleting}>
    <label className="run-history-select-all">
      <input
        ref={selectAllRef}
        type="checkbox"
        checked={selection.allSelected}
        aria-checked={selection.someSelected ? 'mixed' : selection.allSelected}
        disabled={selection.isDeleting || selection.selectableCount === 0}
        onChange={(event) => selection.selectAll(event.target.checked)}
      />
      <span>{selectAllLabel}</span>
    </label>
    <span className="run-history-selection-count" role="status">{selection.selectedCount} selected</span>
    <button
      type="button"
      className="danger-button run-history-trash-button"
      disabled={selection.isDeleting || selection.selectedCount === 0}
      onClick={() => void selection.deleteSelected()}
      aria-label={selection.isDeleting ? 'Deleting selected runs' : `Delete ${selection.selectedCount} selected ${selection.selectedCount === 1 ? 'run' : 'runs'}`}
      title={selection.selectedCount ? 'Delete selected runs' : 'Select runs to delete'}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7" />
      </svg>
      {selection.isDeleting ? 'Deleting…' : 'Delete selected'}
    </button>
  </div>;
}

/** Deletes one run from the top right of its card. */
export function RunHistoryDeleteButton({ label, disabled = false, onDelete }: {
  label: string;
  disabled?: boolean;
  onDelete: () => void;
}) {
  return <button
    type="button"
    className="run-history-delete"
    disabled={disabled}
    onClick={onDelete}
    aria-label={`Delete ${label}`}
    title="Delete run"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7" />
    </svg>
  </button>;
}

export function RunHistoryCheckbox({ label, checked, disabled = false, disabledReason, onChange }: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onChange: (checked: boolean) => void;
}) {
  return <label className="run-history-checkbox" title={disabledReason}>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={`Select ${label} for deletion${disabledReason ? `. ${disabledReason}` : ''}`}
      onChange={(event) => onChange(event.target.checked)}
    />
  </label>;
}
