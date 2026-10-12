import { useState, type MouseEvent } from 'react';

/**
 * Which run the detail panel describes. Clicking a card selects it, and the panel stays on that run
 * while the pointer moves over other cards; clicking it again releases it. With nothing selected,
 * the panel follows the hovered or focused card (focus keeps it reachable by keyboard), falling back
 * to the newest shown run once the pointer leaves the list.
 */
export function useRunPreview(shownIds: readonly string[]) {
  const [selectedId, setSelectedId] = useState('');
  const [hoveredId, setHoveredId] = useState('');
  // A selected run that a search hides, or that was deleted, no longer holds the panel.
  const selected = shownIds.includes(selectedId) ? selectedId : '';
  const hovered = shownIds.includes(hoveredId) ? hoveredId : '';
  return {
    selectedId: selected,
    /** The card drawn as the one the panel describes. */
    highlightedId: selected || hovered,
    detailId: selected || hovered || shownIds[0] || '',
    hover: setHoveredId,
    clearHover: () => setHoveredId(''),
    clickCard: (event: MouseEvent<HTMLElement>, id: string) => {
      // The card's own controls (tick box, links, buttons, rename form) keep their own job.
      if ((event.target as Element).closest('a, button, input, label, select, textarea, form')) return;
      setSelectedId((current) => current === id ? '' : id);
    },
    forget: (ids: ReadonlySet<string>) => {
      setSelectedId((current) => ids.has(current) ? '' : current);
      setHoveredId((current) => ids.has(current) ? '' : current);
    }
  };
}
