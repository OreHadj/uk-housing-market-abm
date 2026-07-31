import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { CompareResponse, ParameterCardMeta, ParameterGroup } from '../../shared/types';
import { API_RETRY_DELAY_MS, fetchCatalog, fetchCompare, fetchVersions, isRetryableApiError } from '../lib/api';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { CompareCard } from '../components/CompareCard';
import { GroupedCheckboxSections } from '../components/GroupedCheckboxSections';
import { LoadingSkeleton, LoadingSkeletonGroup } from '../components/LoadingSkeleton';
import { buildModelOptions, formatModelName, getDefaultModelVersion } from '../lib/modelAnchors';
import { readScenarioDraft, updateScenarioDraftModel } from '../lib/scenarioDraft';

const GROUP_ORDER: ParameterGroup[] = [
  'Bank & Credit Policy',
  'Purchase & Mortgage',
  'BTL & Investor Behavior',
  'Housing & Rental Market',
  'Household Demographics & Wealth',
  'Government & Tax'
];
const DEFAULT_OPEN_COMPARE_CARD_IDS = new Set<string>([
  'central_bank_base_rate',
  'central_bank_ltv_limits',
  'central_bank_lti_soft_limits',
  'central_bank_affordability_icr'
]);
const DEFAULT_OPEN_COMPARE_GROUPS = new Set<ParameterGroup>([
  'Bank & Credit Policy'
]);
const HISTORICAL_EVIDENCE_VERSIONS = new Set(['v0', 'v0o2', 'v0o7']);

function formatOverviewDataset(dataset: CompareResponse['items'][number]['sourceInfo']['datasetsRight'][number]): string {
  return `${dataset.fullName} (${dataset.year}${dataset.edition ? `, ${dataset.edition}` : ''})`;
}

type ChangeFilter = 'all' | 'updated' | 'unchanged';
type ViewMode = 'single' | 'compare';

function getDefaultDisplayVersion(versions: string[], inProgressVersions: string[]): string {
  return getDefaultModelVersion(versions, inProgressVersions) || (versions[versions.length - 1] ?? '');
}

function getOriginalDisplayVersion(versions: string[]): string {
  return versions.includes('v0') ? 'v0' : (versions[0] ?? '');
}

function groupCatalog(catalog: ParameterCardMeta[]) {
  const grouped = new Map<string, ParameterCardMeta[]>();
  for (const item of catalog) {
    const current = grouped.get(item.group) ?? [];
    current.push(item);
    grouped.set(item.group, current);
  }
  return grouped;
}

function isUpdated(item: CompareResponse['items'][number], mode: ViewMode): boolean {
  if (mode === 'single') {
    return item.changeOriginsInRange.length > 0;
  }
  return !item.unchanged;
}

function groupCompareItems(compareData: CompareResponse | null, filter: ChangeFilter, mode: ViewMode) {
  const grouped = new Map<ParameterGroup, CompareResponse['items']>();
  if (!compareData) {
    return grouped;
  }

  for (const item of compareData.items) {
    const updated = isUpdated(item, mode);
    const include = filter === 'all' || (filter === 'updated' ? updated : !updated);
    if (!include) {
      continue;
    }

    const current = grouped.get(item.group) ?? [];
    current.push(item);
    grouped.set(item.group, current);
  }

  return grouped;
}

export function ComparePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [versions, setVersions] = useState<string[]>([]);
  const [inProgressVersions, setInProgressVersions] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<ParameterCardMeta[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [left, setLeft] = useState<string>('');
  const [right, setRight] = useState<string>('');
  const [mode, setMode] = useState<ViewMode>('single');
  const [search, setSearch] = useState<string>('');
  const [compareData, setCompareData] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string>('');
  const [isBootstrapping, setIsBootstrapping] = useState<boolean>(true);
  const [isBootstrapReady, setIsBootstrapReady] = useState<boolean>(false);
  const [isWaitingForApi, setIsWaitingForApi] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>('all');
  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>({});
  const scenarioDraftId = searchParams.get('from') === 'scenario' ? searchParams.get('draft')?.trim() ?? '' : '';
  const hasScenarioContext = Boolean(scenarioDraftId && readScenarioDraft(scenarioDraftId));
  const scenarioReturnStep = searchParams.get('scenarioStep') === 'model-version' ? '&step=model-version' : '';

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

    const load = async () => {
      setError('');
      setIsBootstrapping(true);
      setIsWaitingForApi(false);

      try {
        const [versionsPayload, catalogList] = await Promise.all([fetchVersions(), fetchCatalog()]);
        if (cancelled) {
          return;
        }

        const versionList = versionsPayload.versions;
        const defaultDisplayVersion = getDefaultDisplayVersion(versionList, versionsPayload.inProgressVersions);
        const currentParams = new URLSearchParams(window.location.search);
        const requestedModeRaw = currentParams.get('mode')?.trim() ?? '';
        const hasRequestedMode = requestedModeRaw.length > 0;
        const requestedMode: ViewMode = hasRequestedMode
          ? requestedModeRaw === 'compare'
            ? 'compare'
            : 'single'
          : 'single';
        const requestedVersionRaw = currentParams.get('version')?.trim() ?? '';
        const requestedVersion = versionList.includes(requestedVersionRaw) ? requestedVersionRaw : '';
        const singleVersion = requestedVersion || defaultDisplayVersion;
        const defaultCompareLeftVersion = getOriginalDisplayVersion(versionList);
        const requestedLeft = currentParams.get('left')?.trim() ?? '';
        const requestedRight = currentParams.get('right')?.trim() ?? '';
        const compareLeftVersion = versionList.includes(requestedLeft) ? requestedLeft : defaultCompareLeftVersion;
        const compareRightVersion = versionList.includes(requestedRight)
          ? requestedRight
          : requestedVersion || defaultDisplayVersion;

        setVersions(versionList);
        setInProgressVersions(versionsPayload.inProgressVersions);
        setCatalog(catalogList);
        setSelectedIds(catalogList.map((item) => item.id));
        setMode(requestedMode);
        setSelectedVersion(singleVersion);
        setLeft(compareLeftVersion);
        setRight(compareRightVersion);
        setIsBootstrapReady(true);
        setIsBootstrapping(false);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        if (isRetryableApiError(loadError)) {
          setIsWaitingForApi(true);
          setIsBootstrapReady(false);
          setIsBootstrapping(false);
          retryTimer = window.setTimeout(() => {
            void load();
          }, API_RETRY_DELAY_MS);
          return;
        }

        setError((loadError as Error).message);
        setIsBootstrapReady(false);
        setIsBootstrapping(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, []);

  useEffect(() => {
    if (!isBootstrapReady) return;
    const next = new URLSearchParams(searchParams);
    next.set('mode', mode);
    if (mode === 'single') {
      if (selectedVersion) next.set('version', selectedVersion);
      next.delete('left');
      next.delete('right');
    } else {
      if (left) next.set('left', left);
      if (right) next.set('right', right);
      next.delete('version');
    }
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [isBootstrapReady, left, mode, right, searchParams, selectedVersion, setSearchParams]);

  useEffect(() => {
    if (mode === 'compare') {
      if (!left && versions.length > 0) {
        setLeft(versions[0]);
      }
      if (!right && versions.length > 0) {
        setRight(getDefaultDisplayVersion(versions, inProgressVersions));
      }
    }
  }, [mode, left, right, versions, inProgressVersions]);

  useEffect(() => {
    if (!isBootstrapReady) {
      setCompareData(null);
      return;
    }

    let cancelled = false;
    let retryTimer: number | undefined;

    const run = async () => {
      if (selectedIds.length === 0) {
        setCompareData(null);
        setIsWaitingForApi(false);
        return;
      }

      if (mode === 'single') {
        if (!selectedVersion) {
          setCompareData(null);
          setIsWaitingForApi(false);
          return;
        }

        setIsLoading(true);
        setIsWaitingForApi(false);
        setError('');
        try {
          const payload = await fetchCompare(selectedVersion, selectedVersion, selectedIds, 'through_right');
          if (cancelled) {
            return;
          }
          setCompareData(payload);
        } catch (loadError) {
          if (cancelled) {
            return;
          }
          if (isRetryableApiError(loadError)) {
            setIsWaitingForApi(true);
            retryTimer = window.setTimeout(() => {
              void run();
            }, API_RETRY_DELAY_MS);
            return;
          }
          setIsWaitingForApi(false);
          setError((loadError as Error).message);
        } finally {
          if (!cancelled) {
            setIsLoading(false);
          }
        }
        return;
      }

      if (!left || !right) {
        setCompareData(null);
        setIsWaitingForApi(false);
        return;
      }

      setIsLoading(true);
      setIsWaitingForApi(false);
      setError('');
      try {
        const payload = await fetchCompare(left, right, selectedIds, 'range');
        if (cancelled) {
          return;
        }
        setCompareData(payload);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        if (isRetryableApiError(loadError)) {
          setIsWaitingForApi(true);
          retryTimer = window.setTimeout(() => {
            void run();
          }, API_RETRY_DELAY_MS);
          return;
        }
        setIsWaitingForApi(false);
        setError((loadError as Error).message);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [isBootstrapReady, mode, left, right, selectedVersion, selectedIds]);

  const filteredCatalog = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return catalog;
    }
    return catalog.filter(
      (item) =>
        item.title.toLowerCase().includes(term) ||
        item.id.toLowerCase().includes(term) ||
        item.configKeys.some((key) => key.toLowerCase().includes(term))
    );
  }, [catalog, search]);

  const setupGrouped = useMemo(() => groupCatalog(filteredCatalog), [filteredCatalog]);
  const setupSections = useMemo(
    () =>
      [...setupGrouped.entries()].map(([groupName, entries]) => ({
        id: groupName,
        title: groupName,
        items: entries.map((entry) => ({
          id: entry.id,
          label: entry.title,
          checked: selectedIds.includes(entry.id)
        }))
      })),
    [selectedIds, setupGrouped]
  );

  const groupedResults = useMemo(() => groupCompareItems(compareData, changeFilter, mode), [compareData, changeFilter, mode]);

  const sectionCounts = useMemo(() => {
    const counts = new Map<ParameterGroup, { updated: number; unchanged: number }>();
    if (!compareData) {
      return counts;
    }
    for (const item of compareData.items) {
      const current = counts.get(item.group) ?? { updated: 0, unchanged: 0 };
      if (isUpdated(item, mode)) {
        current.updated += 1;
      } else {
        current.unchanged += 1;
      }
      counts.set(item.group, current);
    }
    return counts;
  }, [compareData, mode]);

  useEffect(() => {
    if (!compareData) {
      return;
    }

    setSectionOpen((current) => {
      if (Object.keys(current).length === 0) {
        const seeded: Record<string, boolean> = {};
        for (const groupName of GROUP_ORDER) {
          seeded[groupName] = DEFAULT_OPEN_COMPARE_GROUPS.has(groupName);
        }
        return seeded;
      }

      let changed = false;
      const nextState = { ...current };
      for (const groupName of GROUP_ORDER) {
        if (!(groupName in nextState)) {
          nextState[groupName] = false;
          changed = true;
        }
      }
      return changed ? nextState : current;
    });
  }, [compareData]);

  const toggleId = (id: string) => {
    setSelectedIds((current) => {
      if (current.includes(id)) {
        return current.filter((value) => value !== id);
      }
      return [...current, id];
    });
  };

  const toggleAll = () => {
    if (selectedIds.length === catalog.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(catalog.map((item) => item.id));
    }
  };

  const shownCount = compareData
    ? compareData.items.filter((item) =>
        changeFilter === 'all' ? true : changeFilter === 'updated' ? isUpdated(item, mode) : !isUpdated(item, mode)
      ).length
    : 0;

  const hasComparedItems = (compareData?.items.length ?? 0) > 0;
  const isLoadingWithoutData = isBootstrapping || (isLoading && !hasComparedItems);
  const isRefreshingComparedItems = isLoading && hasComparedItems;
  const inProgressSet = useMemo(() => new Set(inProgressVersions), [inProgressVersions]);
  const titleText =
    mode === 'single'
      ? selectedVersion
        ? `Model parameters at ${formatModelName(selectedVersion)}`
        : ''
      : left && right
        ? `${formatModelName(left)} vs ${formatModelName(right)}`
        : '';
  const isTitleLoading = isBootstrapping || titleText.length === 0;
  // Only the four named models are offered; the selected version is passed so a deep link to an
  // intermediate calibration step still renders as an option instead of silently resetting.
  const singleVersionOptions = useMemo(
    () => buildModelOptions(versions, selectedVersion, inProgressSet),
    [versions, selectedVersion, inProgressSet]
  );
  const leftVersionOptions = useMemo(() => buildModelOptions(versions, left, inProgressSet), [versions, left, inProgressSet]);
  const rightVersionOptions = useMemo(() => buildModelOptions(versions, right, inProgressSet), [versions, right, inProgressSet]);
  const renderVersionTags = (prefix: string, version: string) =>
    inProgressSet.has(version)
      ? [
          <span key={`${prefix}-${version}-in-progress`} className="status-pill-in-progress">
            {`${prefix} ${version} in progress`}
          </span>
        ]
      : [];
  const selectedVersionTags =
    mode === 'single'
      ? renderVersionTags('Version', selectedVersion)
      : [...renderVersionTags('Left', left), ...renderVersionTags('Right', right)];
  const overviewItems = compareData?.items ?? [];
  const documentedDatasets = useMemo(() => {
    const unique = new Set<string>();
    for (const item of overviewItems) {
      const datasets = mode === 'single'
        ? item.sourceInfo.datasetsRight
        : [...item.sourceInfo.datasetsLeft, ...item.sourceInfo.datasetsRight];
      for (const dataset of datasets) unique.add(formatOverviewDataset(dataset));
    }
    return [...unique].sort();
  }, [mode, overviewItems]);
  const evidenceYears = useMemo(() => {
    const years = new Set<string>();
    for (const dataset of documentedDatasets) {
      for (const match of dataset.matchAll(/\b(?:19|20)\d{2}\b/g)) years.add(match[0]);
    }
    return [...years].sort();
  }, [documentedDatasets]);
  const validationVersion = mode === 'single' ? selectedVersion : right;
  const validationEvidenceYear = HISTORICAL_EVIDENCE_VERSIONS.has(validationVersion) ? 2011 : 2024;
  const evidenceContext = hasScenarioContext ? `&from=scenario&draft=${encodeURIComponent(scenarioDraftId)}&scenarioStep=model-version` : '';

  return (
    <section className="calibration-layout">
      {hasScenarioContext && validationVersion && (
        <aside className="evidence-context-banner">
          <p>You are checking calibration evidence for an unfinished policy scenario.{mode === 'compare' ? ' The To model is the candidate used by the return action.' : ''}</p>
          <div>
            <Link className="secondary-button" to={`/scenarios/new?draft=${encodeURIComponent(scenarioDraftId)}${scenarioReturnStep}`}>Return without changing model</Link>
            <Link className="primary-button" onClick={() => updateScenarioDraftModel(scenarioDraftId, validationVersion)} to={`/scenarios/new?draft=${encodeURIComponent(scenarioDraftId)}${scenarioReturnStep}`}>
              Use {formatModelName(validationVersion)} and return to scenario
            </Link>
          </div>
        </aside>
      )}
      <div className="calibration-controls results-card" aria-label="Calibration view controls">
        <div>
          <span className="control-label">View</span>
          <div className="mode-switch-row">
            <button
              type="button"
              className={`filter-pill ${mode === 'single' ? 'active' : ''}`}
              onClick={() => setMode('single')}
            >
              Single version
            </button>
            <button
              type="button"
              className={`filter-pill ${mode === 'compare' ? 'active' : ''}`}
              onClick={() => setMode('compare')}
            >
              Compare versions
            </button>
          </div>
        </div>

        {mode === 'single' ? (
            <label htmlFor="single-version"><span className="control-label">Model</span>
              <select id="single-version" value={selectedVersion} onChange={(event) => setSelectedVersion(event.target.value)}>
                {singleVersionOptions.map((option) => (
                  <option key={option.version} value={option.version}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label htmlFor="left-version"><span className="control-label">From model</span>
              <select id="left-version" value={left} onChange={(event) => setLeft(event.target.value)}>
                {leftVersionOptions.map((option) => (
                  <option key={option.version} value={option.version}>
                    {option.label}
                  </option>
                ))}
              </select>
              </label>

              <label htmlFor="right-version"><span className="control-label">To model</span>
              <select id="right-version" value={right} onChange={(event) => setRight(event.target.value)}>
                {rightVersionOptions.map((option) => (
                  <option key={option.version} value={option.version}>
                    {option.label}
                  </option>
                ))}
              </select>
              </label>
            </>
          )}
      </div>

      <div className="compare-results">
        <section className="summary-panel calibration-introduction">
          <div>
            <h2>Calibration assumptions</h2>
            <p>
              The model combines inputs measured directly from UK data with behavioural parameters that cannot be
              observed directly. Household demographics and incomes, for example, can be set using published
              statistics, whereas parameters influencing decisions such as whether to rent or buy must be estimated
              through calibration. This page documents the values used in the selected model version and the evidence
              supporting them.
            </p>
          </div>
          {validationVersion && (
            <Link className="secondary-button calibration-validation-link" to={`/validation?version=${encodeURIComponent(validationVersion)}&evidenceYear=${validationEvidenceYear}${evidenceContext}`}>
              View validation evidence
            </Link>
          )}
        </section>

        <CollapsibleSection
          title="Filter assumptions"
          defaultOpen={false}
          summary={`${selectedIds.length} of ${catalog.length} selected`}
          className="calibration-filter-disclosure"
          bodyClassName="calibration-filter-body"
        >
          <label htmlFor="search-params">Find parameters</label>
          <input
            id="search-params"
            placeholder="Search title or key"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
            <button type="button" className="secondary-button" onClick={toggleAll}>
              {selectedIds.length === catalog.length ? 'Clear all' : 'Select all'}
            </button>

            <GroupedCheckboxSections sections={setupSections} onToggle={toggleId} />
        </CollapsibleSection>

        <header className="results-head">
          <h2>
            {isTitleLoading ? (
              <LoadingSkeleton as="span" className="loading-skeleton-line compare-title-skeleton" ariaLabel="Loading selected versions" />
            ) : (
              titleText
            )}
          </h2>
          {selectedVersionTags.length > 0 && (
            <div className="results-version-tags">
              {selectedVersionTags}
            </div>
          )}
          <p>{mode === 'single' ? 'Charts show the assumptions used by this model. Plain-language notes explain their economic and policy relevance.' : 'Compare exact assumptions, deltas, and provenance across any two historical versions.'}</p>

          {mode === 'single' && compareData && (
            <div className="calibration-overview-grid">
              <div><span>Status</span><strong>{inProgressSet.has(selectedVersion) ? 'In progress' : 'Stable'}</strong></div>
              <div><span>Calibrated areas</span><strong>{overviewItems.length}</strong></div>
              <div><span>Economic themes</span><strong>{GROUP_ORDER.length}</strong></div>
              <div><span>Documented datasets</span><strong>{documentedDatasets.length}</strong></div>
              <div className="calibration-overview-wide"><span>Evidence-year coverage</span><strong>{evidenceYears.length ? evidenceYears.join(', ') : 'Not documented'}</strong></div>
            </div>
          )}
          {mode === 'single' && (
            <p className="calibration-validation-note"><strong>Calibration is not validation.</strong> Calibration sets model assumptions from documented evidence; Validation separately tests simulated outcomes against independent evidence. Dataset coverage is descriptive, not a confidence or validation score.</p>
          )}

          {mode === 'compare' && <div className="change-filter-row">
            <span>Filter:</span>
            <button
              type="button"
              className={`filter-pill ${changeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setChangeFilter('all')}
            >
              All
            </button>
            <button
              type="button"
              className={`filter-pill ${changeFilter === 'updated' ? 'active' : ''}`}
              onClick={() => setChangeFilter('updated')}
            >
              Updated
            </button>
            <button
              type="button"
              className={`filter-pill ${changeFilter === 'unchanged' ? 'active' : ''}`}
              onClick={() => setChangeFilter('unchanged')}
            >
              No change
            </button>
            <strong>
              {isLoadingWithoutData ? (
                <LoadingSkeleton as="span" className="loading-skeleton-line compare-count-skeleton" ariaLabel="Loading filtered count" />
              ) : (
                shownCount
              )}
            </strong>
          </div>}
          {isRefreshingComparedItems && (
            <LoadingSkeleton as="span" className="loading-skeleton-pill compare-refresh-pill" ariaLabel="Refreshing parameter comparison" />
          )}
        </header>

        {error && <p className="error-banner">{error}</p>}
        {isWaitingForApi && (
          <p className="waiting-banner">Waiting for API to become available. Retrying every 2 seconds...</p>
        )}

        {!isBootstrapping && !isLoading && (selectedIds.length === 0 || compareData?.items.length === 0) && (
          <p className="info-banner">No parameters selected.</p>
        )}

        {isLoadingWithoutData ? (
          <LoadingSkeletonGroup
            className="cards-stack-skeleton"
            count={4}
            itemClassName="loading-skeleton-card result-group-skeleton"
            ariaLabel="Loading parameter groups"
          />
        ) : (
          <div className="cards-stack">
            {GROUP_ORDER.filter((group) => (groupedResults.get(group)?.length ?? 0) > 0).map((groupName) => {
              const items = groupedResults.get(groupName) ?? [];
              const counts = sectionCounts.get(groupName) ?? { updated: 0, unchanged: 0 };
              const open = sectionOpen[groupName] ?? false;

              return (
                <section className="result-group" key={groupName}>
                  <button
                    type="button"
                    className="result-group-header"
                    onClick={() =>
                      setSectionOpen((current) => ({
                        ...current,
                        [groupName]: !open
                      }))
                    }
                  >
                    <span className="result-group-title">
                      {open ? '▾' : '▸'} {groupName}
                    </span>
                    {mode === 'compare' && <span className="result-group-counts">
                      <span className="unchanged">No change: {counts.unchanged}</span>
                      <span className="updated">Updated: {counts.updated}</span>
                    </span>}
                  </button>

                  {open && (
                    <div className="result-group-body">
                      {items.map((item) => (
                        <CompareCard
                          key={item.id}
                          item={item}
                          mode={mode}
                          inProgressVersions={inProgressVersions}
                          defaultExpanded={DEFAULT_OPEN_COMPARE_CARD_IDS.has(item.id)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
