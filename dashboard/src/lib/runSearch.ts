import { MODEL_ANCHORS, formatModelName } from './modelAnchors';

/**
 * Search and grouping rules shared by the Run History page and the run pickers on Results. Kept
 * pure so the rules can be tested directly. Searching only ever happens in the browser: the run
 * list is fetched once per page and filtered here, never once per keystroke.
 */

/** Practice runs from the guided tours are titled "Practice <name> [<id>]" (see policyPracticeRunTitle). */
const PRACTICE_TITLE_PATTERN = /^Practice .+ \[[^\]\s]+\]$/;

export function isPracticeRunTitle(title: string | null | undefined): boolean {
  return PRACTICE_TITLE_PATTERN.test(title?.trim() ?? '');
}

/** Every word typed must appear in the run name, in any order, ignoring case. */
export function runNameMatches(name: string, query: string): boolean {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack = name.toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}

export interface RunHistorySearchItem {
  name: string;
  isExample: boolean;
  isPractice: boolean;
}

export interface RunHistoryGroups<T> {
  main: T[];
  practice: T[];
  examples: T[];
}

/** Matching runs, newest first as given, with practice runs and examples split off for the bottom groups. */
export function groupRunHistory<T extends RunHistorySearchItem>(items: readonly T[], query: string): RunHistoryGroups<T> {
  const matches = items.filter((item) => runNameMatches(item.name, query));
  return {
    main: matches.filter((item) => !item.isExample && !item.isPractice),
    practice: matches.filter((item) => !item.isExample && item.isPractice),
    examples: matches.filter((item) => item.isExample)
  };
}

/**
 * A bottom group opens by itself when there are no other runs to show, or while searching when it
 * holds a match. Otherwise it stays as the viewer last left it, collapsed by default.
 */
export function isRunHistoryGroupOpen(
  groups: RunHistoryGroups<unknown>,
  group: 'practice' | 'examples',
  query: string,
  choice: boolean | undefined
): boolean {
  if (choice !== undefined) return choice;
  if (groups.main.length === 0) return true;
  return Boolean(query.trim()) && groups[group].length > 0;
}

/** Only runs a viewer can see are offered to "Select all shown" and to deletion. */
export function shownRunHistory<T>(groups: RunHistoryGroups<T>, open: { practice: boolean; examples: boolean }): T[] {
  return [
    ...groups.main,
    ...(open.practice ? groups.practice : []),
    ...(open.examples ? groups.examples : [])
  ];
}

export interface RunPickerItem {
  name: string;
  /** Model version id, e.g. "v5o3"; empty or null when the run records none. */
  modelVersion: string | null | undefined;
  isExample: boolean;
  isPractice: boolean;
}

export interface RunPickerGroup<T> {
  id: string;
  label: string;
  items: T[];
}

export const MODEL_NOT_RECORDED_GROUP = 'Model not recorded';

/** Newest analysis first: Refitted 2024, 2024 data, Refitted 2011, Original 2011. */
const ANCHOR_GROUP_ORDER = [...MODEL_ANCHORS].reverse().map((anchor) => anchor.version);

/**
 * The run pickers list runs by model, keeping the caller's newest-first order within each group.
 * Other calibration steps follow the four anchors under their bare id, then runs that record no
 * model, then examples and practice runs. Groups without a match are left out.
 */
export function groupRunsByModel<T extends RunPickerItem>(items: readonly T[], query = ''): RunPickerGroup<T>[] {
  const byModel = new Map<string, T[]>();
  const examples: T[] = [];
  const practice: T[] = [];
  const unrecorded: T[] = [];
  for (const item of items) {
    if (!runNameMatches(item.name, query)) continue;
    const version = item.modelVersion?.trim() ?? '';
    if (item.isExample) examples.push(item);
    else if (item.isPractice) practice.push(item);
    else if (!version) unrecorded.push(item);
    else byModel.set(version, [...(byModel.get(version) ?? []), item]);
  }
  const otherVersions = [...byModel.keys()].filter((version) => !ANCHOR_GROUP_ORDER.includes(version));
  return [
    ...[...ANCHOR_GROUP_ORDER, ...otherVersions].map((version) => ({
      id: `model:${version}`,
      label: formatModelName(version),
      items: byModel.get(version) ?? []
    })),
    { id: 'model:none', label: MODEL_NOT_RECORDED_GROUP, items: unrecorded },
    { id: 'examples', label: 'Examples', items: examples },
    { id: 'practice', label: 'Practice runs', items: practice }
  ].filter((group) => group.items.length > 0);
}
