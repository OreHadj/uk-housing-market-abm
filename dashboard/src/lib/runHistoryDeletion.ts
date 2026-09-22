export interface RunHistoryItem {
  id: string;
  label: string;
}

export interface RunHistoryDeleteResult {
  deletedIds: string[];
  failures: { id: string; label: string; message: string }[];
  cancelled: boolean;
}

/** Only the selected, eligible snapshot is authorized by this confirmation. */
export async function deleteRunHistorySelection({
  items, selectedIds, canDelete, deleteKeyRequired, confirm, promptDeleteKey, deleteItem, canDeleteItem
}: {
  items: readonly RunHistoryItem[];
  selectedIds: ReadonlySet<string>;
  canDelete: boolean;
  deleteKeyRequired: boolean;
  confirm: (message: string) => boolean;
  promptDeleteKey: () => string | null;
  deleteItem: (id: string, key?: string) => Promise<unknown>;
  canDeleteItem?: (id: string) => boolean;
}): Promise<RunHistoryDeleteResult> {
  const result: RunHistoryDeleteResult = { deletedIds: [], failures: [], cancelled: false };
  if (!canDelete) return result;
  const targets = [...new Map(items.filter((item) => selectedIds.has(item.id)).map((item) => [item.id, item])).values()];
  if (!targets.length) return result;
  const names = targets.slice(0, 8).map((item) => item.label === item.id ? item.id : `${item.label} (${item.id})`).join('\n');
  const remaining = targets.length > 8 ? `\n…and ${targets.length - 8} more.` : '';
  if (!confirm(`Delete ${targets.length} selected ${targets.length === 1 ? 'run' : 'runs'}?\n\n${names}${remaining}\n\nThis permanently removes their results.`)) {
    result.cancelled = true;
    return result;
  }
  const deleteKey = deleteKeyRequired ? promptDeleteKey() : undefined;
  if (deleteKeyRequired && !deleteKey?.trim()) {
    result.cancelled = true;
    return result;
  }
  // Sequential requests keep remote deletion load bounded and make partial failures retryable.
  for (const item of targets) {
    try {
      if (canDeleteItem && !canDeleteItem(item.id)) throw new Error('This run is no longer available for deletion.');
      await deleteItem(item.id, deleteKey ?? undefined);
      result.deletedIds.push(item.id);
    } catch (cause) {
      result.failures.push({
        ...item,
        message: cause instanceof Error ? cause.message : String(cause)
      });
    }
  }
  return result;
}
