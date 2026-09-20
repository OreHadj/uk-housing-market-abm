/** Running (or stopping) jobs stay visible; only waiting jobs belong in the disclosure. */
export function getResultsQueueRows<T extends { status: string }>(items: T[], expanded: boolean) {
  const preview = items.find((item) => item.status !== 'queued') ?? items[0] ?? null;
  const remaining = items.filter((item) => item !== preview);
  return {
    preview,
    waitingCount: remaining.filter((item) => item.status === 'queued').length,
    visibleRemaining: remaining.filter((item) => item.status !== 'queued' || expanded)
  };
}
