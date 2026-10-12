import { useEffect, useRef, useState } from 'react';

/**
 * Renaming a saved run from its Run History card. The run list reloads afterwards, so a name changed
 * by someone else at the same time is picked up too.
 */
export function useRunRename({ rename, onRenamed, onError }: {
  rename: (id: string, title: string) => Promise<unknown>;
  onRenamed: () => Promise<unknown>;
  onError: (message: string) => void;
}) {
  const [renamingId, setRenamingId] = useState('');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const cancel = () => {
    setRenamingId('');
    setDraft('');
  };
  const submit = async () => {
    setSaving(true);
    onError('');
    try {
      await rename(renamingId, draft);
      if (!mounted.current) return;
      cancel();
      await onRenamed();
    } catch (error) {
      if (mounted.current) onError((error as Error).message);
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  return {
    renamingId,
    draft,
    setDraft,
    saving,
    start: (id: string, title: string | null | undefined) => {
      setRenamingId(id);
      setDraft(title ?? '');
    },
    cancel,
    submit,
    /** A run deleted while being renamed leaves the form. */
    forget: (ids: ReadonlySet<string>) => setRenamingId((current) => ids.has(current) ? '' : current)
  };
}

export type RunRenameState = ReturnType<typeof useRunRename>;

export function RunRenameForm({ rename, label, placeholder }: {
  rename: RunRenameState;
  label: string;
  placeholder: string;
}) {
  return (
    <form
      className="run-rename-form"
      onSubmit={(event) => {
        event.preventDefault();
        void rename.submit();
      }}
    >
      <input
        type="text"
        value={rename.draft}
        maxLength={120}
        autoFocus
        aria-label={`Rename ${label}`}
        placeholder={placeholder}
        disabled={rename.saving}
        onChange={(event) => rename.setDraft(event.target.value)}
      />
      <button type="submit" className="run-select-btn" disabled={rename.saving}>
        {rename.saving ? 'Saving...' : 'Save'}
      </button>
      <button type="button" className="table-toggle" disabled={rename.saving} onClick={rename.cancel}>
        Cancel
      </button>
    </form>
  );
}
