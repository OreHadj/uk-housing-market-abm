import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  groupRunHistory,
  isRunHistoryGroupOpen,
  shownRunHistory,
  type RunHistorySearchItem
} from '../../lib/runSearch';

type GroupChoices = Record<string, { practice?: boolean; examples?: boolean }>;

/**
 * Run History's search, kept in the URL (`q`) so Back and refresh restore it, plus the open state of
 * the Practice runs and Examples groups. A viewer's own open or close choice belongs to the search
 * it was made under, so a new search can open the groups that hold its matches.
 */
export function useRunHistorySearch<T extends RunHistorySearchItem>(items: readonly T[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const setQuery = useCallback((next: string) => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next) params.set('q', next);
      else params.delete('q');
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  const groups = groupRunHistory(items, query);
  const [choices, setChoices] = useState<GroupChoices>({});
  const choiceKey = query.trim().toLocaleLowerCase();
  const choice = choices[choiceKey] ?? {};
  const practiceOpen = isRunHistoryGroupOpen(groups, 'practice', query, choice.practice);
  const examplesOpen = isRunHistoryGroupOpen(groups, 'examples', query, choice.examples);
  const shown = shownRunHistory(groups, { practice: practiceOpen, examples: examplesOpen });
  const choose = (group: 'practice' | 'examples', open: boolean) =>
    setChoices((current) => ({ ...current, [choiceKey]: { ...current[choiceKey], [group]: open } }));

  return {
    query,
    setQuery,
    groups,
    shown,
    matchCount: groups.main.length + groups.practice.length + groups.examples.length,
    practiceOpen,
    examplesOpen,
    togglePractice: () => choose('practice', !practiceOpen),
    toggleExamples: () => choose('examples', !examplesOpen)
  };
}
