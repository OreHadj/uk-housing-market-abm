/**
 * Single source of truth for how model versions are named and offered in the UI.
 *
 * `input-data-versions/` holds ~58 snapshot folders, but almost all of them are intermediate steps
 * in the 2024 recalibration — including "source-confirmed" versions where no number changed. Only
 * four answer a question an analyst actually asks, so only those four are offered for selection.
 *
 * The version id encodes neither of the two things that matter: which data the model was built
 * from, and which evidence its five unmeasurable behavioural parameters were fitted to (the `o`
 * suffix marks that a fit happened, not what it targeted). Both are stated explicitly here rather
 * than inferred from the id or looked up in the history file.
 */

export interface ModelAnchor {
  version: string;
  /** User-facing name. Leads the option label; the id follows in brackets for reproducibility. */
  name: string;
  /** The two axes the version id hides, shown under the selector. */
  subtitle: string;
  /** Era of the input data the model was calibrated from. */
  dataYear: 2011 | 2024;
  /** Era of the evidence the five behavioural parameters were fitted to. */
  fitYear: 2011 | 2024;
}

/**
 * Ordered as the analytical progression: the original model, what refitting its behaviour buys,
 * what updating the data buys, and what doing both buys.
 */
export const MODEL_ANCHORS: readonly ModelAnchor[] = [
  {
    version: 'v0',
    name: 'Original 2011 model',
    subtitle: '2011 data · behaviour fitted to 2011 evidence',
    dataYear: 2011,
    fitYear: 2011
  },
  {
    version: 'v0o7',
    name: 'Refitted 2011 model',
    subtitle: '2011 data · behaviour refitted to 2011 evidence (TuRBO)',
    dataYear: 2011,
    fitYear: 2011
  },
  {
    version: 'v4.26',
    name: '2024 data model',
    subtitle: '2024 data · behaviour still fitted to 2011 evidence',
    dataYear: 2024,
    fitYear: 2011
  },
  {
    version: 'v5o3',
    name: 'Refitted 2024 model',
    subtitle: '2024 data · behaviour refitted to 2024 evidence (TuRBO)',
    dataYear: 2024,
    fitYear: 2024
  }
];

const ANCHOR_BY_VERSION = new Map(MODEL_ANCHORS.map((anchor) => [anchor.version, anchor]));

const OFF_ANCHOR_SUBTITLE = 'Historical calibration step';

export interface ModelOption {
  version: string;
  label: string;
  subtitle: string;
  isAnchor: boolean;
}

export function getModelAnchor(version: string): ModelAnchor | undefined {
  return ANCHOR_BY_VERSION.get(version.trim());
}

export function isModelAnchor(version: string): boolean {
  return ANCHOR_BY_VERSION.has(version.trim());
}

/** Anchor name where one exists, otherwise the bare version id. Safe for chart axes and titles. */
export function formatModelName(version: string): string {
  return getModelAnchor(version)?.name ?? version;
}

export function formatModelSubtitle(version: string): string {
  return getModelAnchor(version)?.subtitle ?? OFF_ANCHOR_SUBTITLE;
}

/**
 * Option text for a selector. Anchors lead with the name and keep the id in brackets, so what is
 * actually being run is never hidden behind a friendly name. Everything else stays a bare id with
 * a note that it is provenance rather than a recommended choice.
 */
export function formatModelOptionLabel(version: string, options?: { isInProgress?: boolean }): string {
  const anchor = getModelAnchor(version);
  const base = anchor ? `${anchor.name} (${version})` : `${version} — ${OFF_ANCHOR_SUBTITLE.toLowerCase()}`;
  return options?.isInProgress ? `${base} (In progress)` : base;
}

/**
 * The version to show when nothing was requested: the newest anchor the data root actually has,
 * skipping any still being validated. Falls back to the newest available version so a data root
 * with no anchors still lands somewhere sensible.
 */
export function getDefaultModelVersion(
  availableVersions: readonly string[],
  inProgressVersions: readonly string[] = []
): string {
  const available = new Set(availableVersions);
  const inProgress = new Set(inProgressVersions);
  for (let index = MODEL_ANCHORS.length - 1; index >= 0; index -= 1) {
    const version = MODEL_ANCHORS[index]?.version ?? '';
    if (available.has(version) && !inProgress.has(version)) {
      return version;
    }
  }

  for (let index = availableVersions.length - 1; index >= 0; index -= 1) {
    const version = availableVersions[index] ?? '';
    if (version && !inProgress.has(version)) {
      return version;
    }
  }

  return '';
}

/**
 * The four anchors present in `availableVersions`, plus `selectedVersion` when it is one of the
 * intermediate steps. That extra entry is what keeps existing deep links — `?left=v4.19` and the
 * like — rendering correctly without putting the other 54 folders back in the dropdown.
 */
export function buildModelOptions(
  availableVersions: readonly string[],
  selectedVersion?: string,
  inProgressVersions: ReadonlySet<string> = new Set()
): ModelOption[] {
  const available = new Set(availableVersions);
  const toOption = (version: string): ModelOption => ({
    version,
    label: formatModelOptionLabel(version, { isInProgress: inProgressVersions.has(version) }),
    subtitle: formatModelSubtitle(version),
    isAnchor: isModelAnchor(version)
  });

  const anchors = MODEL_ANCHORS.filter((anchor) => available.has(anchor.version)).map((anchor) => toOption(anchor.version));

  // A data root without any anchor (an older snapshot set, or a test fixture) would otherwise
  // render an empty selector, so fall back to offering everything it does have.
  if (anchors.length === 0) {
    return availableVersions.map(toOption);
  }

  const selected = selectedVersion?.trim() ?? '';
  if (selected && !isModelAnchor(selected) && available.has(selected)) {
    return [...anchors, toOption(selected)];
  }

  return anchors;
}
