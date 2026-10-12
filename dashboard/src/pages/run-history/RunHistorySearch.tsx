import type { ReactNode } from 'react';
import { SearchIcon } from '../../components/RunPicker';

/** Search box above a Run History list. Matching happens in the browser, by run name only. */
export function RunHistorySearch({ query, matchCount, totalCount, onQueryChange }: {
  query: string;
  matchCount: number;
  totalCount: number;
  onQueryChange: (query: string) => void;
}) {
  return (
    <div className="run-history-search">
      <label className="run-search-field">
        <SearchIcon />
        <span className="visually-hidden">Search runs by name</span>
        <input
          type="search"
          value={query}
          placeholder="Search runs"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      <p className="run-history-search-count" role="status">
        {query.trim()
          ? `Showing ${matchCount} of ${totalCount}`
          : `${totalCount} finished ${totalCount === 1 ? 'run' : 'runs'}`}
      </p>
    </div>
  );
}

/** "▸ Practice runs (6)": a collapsed group at the bottom of a run list. */
export function RunHistoryGroup({ id, label, count, open, onToggle, children }: {
  id: string;
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <li className="run-history-group">
      <button
        type="button"
        className="policy-results-group-toggle run-history-group-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        <span className="policy-results-chevron" aria-hidden="true" />
        <strong>{label} ({count})</strong>
      </button>
      <ul id={id} className="run-list run-history-group-list" hidden={!open}>
        {children}
      </ul>
    </li>
  );
}

export function noRunsMatchMessage(query: string): string {
  return `No runs match “${query.trim()}”.`;
}
