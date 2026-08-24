import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type {
  KpiMetricSummary,
  LendingDistributionPayload,
  LendingMetricId,
  ModelRunJob,
  ModelRunJobStatus,
  ResultsCompareWindow,
  ResultsComparePayload,
  ResultsFileManifestEntry,
  ResultsRunDetail,
  ResultsRunProvenance,
  ResultsRunStatus,
  ResultsRunSummary
} from '../../../../shared/types';
import { CollapsibleSection } from '../../../components/CollapsibleSection';
import { EChart } from '../../../components/EChart';
import { LoadingSkeleton, LoadingSkeletonGroup } from '../../../components/LoadingSkeleton';
import { ManualSelectionStatusPills } from '../../../components/ManualSelectionStatusPills';
import {
  API_RETRY_DELAY_MS,
  deleteResultsRun,
  downloadResultsRun,
  fetchLendingDistributionCompare,
  fetchModelRunJobs,
  fetchResultsCompare,
  fetchResultsRunDetail,
  renameResultsRun,
  fetchResultsRunFiles,
  fetchResultsRuns,
  fetchVersions,
  isRetryableApiError
} from '../../../lib/api';
import {
  buildLendingIndicatorAvailability,
  buildLendingKpis,
  buildMatchingBaselineScenarioDraft,
  computeKpiDeltaValue,
  findMatchedManualBaselineRun,
  formatKpiComparisonDelta,
  formatKpiValue,
  formatManualComparisonCalibrationNotice,
  formatManualComparisonMismatchWarning,
  formatManualComparisonOptionAnnotation,
  getManualComparisonFieldDifferences,
  getPolicySettingDifferences,
  groupIndicatorsByPolicyQuestion,
  isMatchedManualBaselineRun,
  isLendingKpiId,
  MANUAL_COMPARISON_CALIBRATION_VERDICT,
  MANUAL_COMPARISON_SETTINGS_VERDICT,
  resolveActiveIndicatorId,
  resolveActiveIndicatorPayload,
  resolveManualRunSelection,
  resolveSelectedIndicatorIds,
  sortKpis
} from '../../../lib/manualResultsView';
import {
  buildManualOverlayOption,
  COMPARISON_RUN_LABEL,
  PRIMARY_RUN_LABEL
} from '../../../lib/manualOverlayChartOption';
import { NewLendingCard, unavailableMessage, type LendingView } from './NewLendingCard';
import { FullRunDetailsDialog } from './FullRunDetailsDialog';
import { buildResultsRunVersionLabelState, extractVersionFromResultsRunId } from '../../../lib/versionLabels';
import { formatModelName, formatModelOptionLabel } from '../../../lib/modelAnchors';
import { summariseRunPolicy } from '../../../../shared/policyCatalogue';
import { CENTRAL_BANK_POLICY_DISPLAY, formatPolicyValue } from '../../../../shared/policyDisplay';
import { buildExperimentsPath } from '../routeState';
import { DEFAULT_EXPERIMENT_ROUTE_STATE } from '../types';
import {
  createScenarioDraftId,
  setActiveScenarioDraftId,
  writeScenarioDraft
} from '../../../lib/scenarioDraft';

const PROTECTED_RESULTS_RUN_IDS = new Set(['v0-output', 'v4.0-output']);
const SHOW_DWELLINGS_PER_HOUSEHOLD = false;
const SHOW_NEW_LENDING_SECTION = false;
const ANALYSIS_CUTOFF_OPTIONS = [0, 500, 1_000, 1_500, 2_000] as const;

type CompareWindow = ResultsCompareWindow;
type SmoothWindow = 0 | 3 | 12;

function compareWindowLabel(window: CompareWindow): string {
  if (window === 'full') return 'Full run';
  if (window === 'tail120') return 'Latest 120 months';
  return `After discarding the first ${Number.parseInt(window.slice(4), 10).toLocaleString('en-GB')} months`;
}

/**
 * Decision 2: rows the dashboard scales say so; the rows Java already scaled do not, because the
 * distinction is only ever a question about where the arithmetic happened, not about the number.
 */
const UK_SCALING_ROW_NOTE =
  'Model household counts are converted into UK-equivalent counts using each run\u2019s configured UK household population. ' +
  'For example, 1,000 out of 10,000 model households becomes approximately 2.64 million out of 26.44 million UK households. ' +
  'This changes only the scale, not the modelled proportion, and does not mean every UK household was individually simulated.';

function formatWholeNumber(value: number): string {
  return value.toLocaleString('en-GB', { maximumFractionDigits: 0 });
}

/** Compact description of a seed set: a single seed, a contiguous run, or an explicit list. */
function describeSeedSet(seeds: number[] | null): string | null {
  if (!seeds || seeds.length === 0) {
    return null;
  }
  if (seeds.length === 1) {
    return `seed ${seeds[0]}`;
  }
  const isContiguous = seeds.every((seed, index) => index === 0 || seed === seeds[index - 1] + 1);
  return isContiguous
    ? `${seeds.length} seeds (${seeds[0]}\u2013${seeds[seeds.length - 1]})`
    : `${seeds.length} seeds (${seeds.join(', ')})`;
}

type SeedOverlap = 'same' | 'overlapping' | 'disjoint' | 'unknown';

/**
 * Runs are Monte Carlo ensembles, so "same seed / different seed" is the wrong question. What
 * matters is how much of the two seed sets is shared: a fully shared set removes the noise, a
 * disjoint one leaves every difference confounded with it.
 */
function compareSeedSets(
  baselineSeeds: number[] | null,
  comparisonSeeds: number[] | null
): { overlap: SeedOverlap; sharedCount: number } {
  if (!baselineSeeds || !comparisonSeeds || baselineSeeds.length === 0 || comparisonSeeds.length === 0) {
    return { overlap: 'unknown', sharedCount: 0 };
  }
  const comparisonSet = new Set(comparisonSeeds);
  const sharedCount = baselineSeeds.filter((seed) => comparisonSet.has(seed)).length;
  if (sharedCount === 0) {
    return { overlap: 'disjoint', sharedCount };
  }
  if (sharedCount === baselineSeeds.length && sharedCount === comparisonSeeds.length) {
    return { overlap: 'same', sharedCount };
  }
  return { overlap: 'overlapping', sharedCount };
}

function describeSeedOverlap(overlap: SeedOverlap, sharedCount: number): string {
  switch (overlap) {
    case 'same':
      return `Same ${sharedCount} seeds`;
    case 'overlapping':
      return `${sharedCount} seeds shared`;
    case 'disjoint':
      return 'No seeds shared';
    default:
      return 'Seed sets not recorded';
  }
}

/**
 * What a run was actually run at, under its own dropdown: the seed set, the step count, and the
 * housing supply per household. The last one is the reason two runs may not be comparable at all
 * — a 25% difference in dwellings per household moves every count regardless of policy.
 */
function RunProvenancePills({
  provenance,
  differsFrom
}: {
  provenance: ResultsRunProvenance | null | undefined;
  differsFrom?: ResultsRunProvenance | null;
}): JSX.Element | null {
  if (!provenance) {
    return null;
  }

  const seedText = describeSeedSet(provenance.seeds);
  const seedNote =
    provenance.seedSource === 'config'
      ? 'Read from config.properties; this run has no dashboard manifest, so a multi-seed ensemble could be under-reported.'
      : undefined;
  const { overlap, sharedCount } = differsFrom
    ? compareSeedSets(provenance.seeds, differsFrom.seeds)
    : { overlap: 'unknown' as SeedOverlap, sharedCount: 0 };
  const stepsDiffer =
    differsFrom !== undefined &&
    differsFrom !== null &&
    provenance.nSteps !== null &&
    differsFrom.nSteps !== null &&
    provenance.nSteps !== differsFrom.nSteps;
  const supplyDiffers =
    differsFrom !== undefined &&
    differsFrom !== null &&
    provenance.dwellingsPerHousehold !== null &&
    differsFrom.dwellingsPerHousehold !== null &&
    Math.abs(provenance.dwellingsPerHousehold - differsFrom.dwellingsPerHousehold) > 0.0005;

  return (
    <span className="run-provenance-pills">
      {seedText && (
        <span className="run-provenance-pill" title={seedNote}>
          {seedText}
          {differsFrom && overlap !== 'unknown' && (
            <span className={`run-provenance-chip ${overlap === 'same' ? '' : 'is-different'}`}>
              {describeSeedOverlap(overlap, sharedCount)}
            </span>
          )}
        </span>
      )}
      {provenance.nSteps !== null && (
        <span className="run-provenance-pill">
          {formatWholeNumber(provenance.nSteps)} steps
          {stepsDiffer && <span className="run-provenance-chip is-different">differs</span>}
        </span>
      )}
      {SHOW_DWELLINGS_PER_HOUSEHOLD && provenance.dwellingsPerHousehold !== null && (
        <span
          className="run-provenance-pill"
          title={
            'UK_DWELLINGS divided by UK_HOUSEHOLDS \u2014 the housing supply the model was run at. '
            + 'Counts from runs with different ratios are not comparable, whatever the policy.'
          }
        >
          {provenance.dwellingsPerHousehold.toFixed(3)} dwellings/household
          {supplyDiffers && <span className="run-provenance-chip is-different">differs</span>}
        </span>
      )}
    </span>
  );
}

/**
 * The social-housing row is a residual of the dwelling-stock constraint, so what it means depends on
 * the run's dwellings-per-household ratio: below 1 it stands for the social-rented sector, at or
 * above 1 the residual all but vanishes and the row is measuring something else.
 */
function socialHousingRunNote(dwellingsPerHousehold: number | null): string | null {
  if (dwellingsPerHousehold === null) {
    return null;
  }
  const ratio = dwellingsPerHousehold.toFixed(3);
  return dwellingsPerHousehold < 1
    ? ` This run has ${ratio} dwellings per household, so a standing residual is expected.`
    : ` This run has ${ratio} dwellings per household \u2014 dwellings are not scarce, so the residual nearly disappears and this row is not comparable with a run calibrated below 1.`;
}
type ManifestTarget = 'baseline' | 'comparison';
type ManualResultsMode = 'single' | 'compare';

function getRunModelVersion(
  run: Pick<ResultsRunSummary, 'runId'> & { configuration?: ResultsRunDetail['configuration'] }
): string | null {
  return run.configuration?.modelVersion ?? extractVersionFromResultsRunId(run.runId);
}

function getRunPrimaryLabel(run: Pick<ResultsRunSummary, 'runId' | 'title'>): string {
  const title = run.title?.trim();
  if (title) return title;
  const version = getRunModelVersion(run);
  return version ? formatModelName(version) : run.runId;
}

function formatRunOptionLabel(run: ResultsRunSummary): string {
  return getRunPrimaryLabel(run);
}

function formatRunActionLabel(run: ResultsRunSummary): string {
  const label = getRunPrimaryLabel(run);
  return label === run.runId ? label : `${label} (${run.runId})`;
}

interface ManualResultsViewProps {
  canWrite: boolean;
  canDownloadResults: boolean;
  canDeleteResults: boolean;
  deleteKeyRequired: boolean;
  authEnabled: boolean;
  requestedBaselineRunId: string;
  requestedComparisonRunId: string;
  onManualSelectionChange: (selection: { baselineRunId: string; comparisonRunId: string }) => void;
  sidebarSubtitle: string;
}

function isProtectedResultsRun(runId: string): boolean {
  return PROTECTED_RESULTS_RUN_IDS.has(runId.trim());
}

/**
 * Deliberately neutral. Colouring a delta green or red asserts a polarity, and for most of these
 * indicators none exists: whether a higher rental yield, or a faster house price rise, is good
 * depends entirely on who is asking. The direction arrow beside it states the fact; the colour was
 * stating an opinion the model cannot support. Per-indicator polarity is a separate decision.
 */
function deltaClassName(): string {
  return 'neutral';
}

function deltaDirection(value: number | null): { symbol: string; label: string } {
  if (value === null || !Number.isFinite(value) || Math.abs(value) < 1e-12) {
    return { symbol: '\u2014', label: 'No difference between primary run and comparison run' };
  }
  return value > 0
    ? { symbol: '\u2191', label: 'Primary run is higher than comparison run' }
    : { symbol: '\u2193', label: 'Primary run is lower than comparison run' };
}

const QUEUE_STATUS_META: Record<ModelRunJobStatus, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'status-pill partial' },
  running: { label: 'In progress', className: 'status-pill partial' },
  succeeded: { label: 'Completed successfully', className: 'status-pill complete' },
  failed: { label: 'Failed', className: 'status-pill invalid' },
  canceled: { label: 'Canceled', className: 'coverage-pill unsupported' }
};

function formatQueueTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}


function statusClass(status: ResultsRunStatus): string {
  switch (status) {
    case 'complete':
      return 'status-pill complete';
    case 'partial':
      return 'status-pill partial';
    default:
      return 'status-pill invalid';
  }
}

function coverageClass(status: ResultsFileManifestEntry['coverageStatus']): string {
  switch (status) {
    case 'supported':
      return 'coverage-pill supported';
    case 'empty':
      return 'coverage-pill empty';
    case 'error':
      return 'coverage-pill error';
    default:
      return 'coverage-pill unsupported';
  }
}

export function ManualResultsView({
  canWrite,
  canDownloadResults,
  canDeleteResults,
  deleteKeyRequired,
  authEnabled,
  requestedBaselineRunId,
  requestedComparisonRunId,
  onManualSelectionChange,
  sidebarSubtitle
}: ManualResultsViewProps) {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<ResultsRunSummary[]>([]);
  const [baselineDetail, setBaselineDetail] = useState<ResultsRunDetail | null>(null);
  const [comparisonDetail, setComparisonDetail] = useState<ResultsRunDetail | null>(null);
  // Which run the detail panel describes. Set on hover *and* focus so the panel is reachable by
  // keyboard, and cleared when the pointer leaves the list so it falls back to the selected run.
  const [previewRunId, setPreviewRunId] = useState<string>('');
  const [renamingRunId, setRenamingRunId] = useState<string>('');
  const [renameDraft, setRenameDraft] = useState<string>('');
  const [isSavingRename, setIsSavingRename] = useState<boolean>(false);
  const [manifest, setManifest] = useState<ResultsFileManifestEntry[]>([]);
  const [selectedIndicatorIds, setSelectedIndicatorIds] = useState<string[]>([]);
  const [activeIndicatorId, setActiveIndicatorId] = useState<string>('');
  const [isTrendModalOpen, setIsTrendModalOpen] = useState<boolean>(false);
  const [runDetailsTarget, setRunDetailsTarget] = useState<ManifestTarget | null>(null);
  const [expandedPolicyGroupIds, setExpandedPolicyGroupIds] = useState<string[]>([]);
  const [comparePayload, setComparePayload] = useState<ResultsComparePayload | null>(null);
  const [analysisCutoffMonths, setAnalysisCutoffMonths] = useState<number>(500);
  const compareWindow: CompareWindow = analysisCutoffMonths === 0
    ? 'full'
    : `post${analysisCutoffMonths}` as CompareWindow;
  const [smoothWindow, setSmoothWindow] = useState<SmoothWindow>(12);
  const [showBaselineTrend, setShowBaselineTrend] = useState<boolean>(true);
  const [showComparisonTrend, setShowComparisonTrend] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>('');
  const [compareError, setCompareError] = useState<string>('');
  const [isLoadingRuns, setIsLoadingRuns] = useState<boolean>(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [isLoadingCompare, setIsLoadingCompare] = useState<boolean>(false);
  const [isLoadingManifest, setIsLoadingManifest] = useState<boolean>(false);
  const [isDeletingRunId, setIsDeletingRunId] = useState<string>('');
  const [isDownloadingRunId, setIsDownloadingRunId] = useState<string>('');
  const [manifestTarget, setManifestTarget] = useState<ManifestTarget>('baseline');
  const [versions, setVersions] = useState<string[]>([]);
  const [inProgressVersions, setInProgressVersions] = useState<string[]>([]);
  const [runJobs, setRunJobs] = useState<ModelRunJob[]>([]);
  const [lendingBaseline, setLendingBaseline] = useState<LendingDistributionPayload | null>(null);
  const [lendingComparison, setLendingComparison] = useState<LendingDistributionPayload | null>(null);
  const [isLoadingLending, setIsLoadingLending] = useState<boolean>(false);
  const [lendingError, setLendingError] = useState<string>('');
  const [lendingView, setLendingView] = useState<LendingView>('distribution');
  const [lendingMetric, setLendingMetric] = useState<LendingMetricId>('ltv');
  const [isHistoryExpanded, setIsHistoryExpanded] = useState<boolean>(false);
  const [isLendingExpanded, setIsLendingExpanded] = useState<boolean>(false);
  const [isQueueExpanded, setIsQueueExpanded] = useState<boolean>(false);
  // Clearing the comparison is an explicit user choice for this primary run. Keep that choice
  // locally so the URL's absent comparison id is not immediately reinterpreted as "choose default".
  const [comparisonDefaultOptOutRunId, setComparisonDefaultOptOutRunId] = useState<string>('');

  // A run's output folder is created when it is queued, so an in-progress run appears in the
  // results listing with no parsed output (0 MB, "invalid"). Keep those out of Run History — they
  // belong in the Queue until they finish — so History only shows runs that actually completed.
  const activeRunIds = useMemo(
    () =>
      new Set(
        runJobs
          .filter((job) => job.status === 'queued' || job.status === 'running')
          .map((job) => job.runId)
          .filter(Boolean)
      ),
    [runJobs]
  );
  const historyRuns = useMemo(() => runs.filter((run) => !activeRunIds.has(run.runId)), [runs, activeRunIds]);

  const resolvedSelection = useMemo(
    () =>
      resolveManualRunSelection(historyRuns, requestedBaselineRunId, requestedComparisonRunId, {
        defaultToMatchedBaseline: comparisonDefaultOptOutRunId !== requestedBaselineRunId
      }),
    [comparisonDefaultOptOutRunId, historyRuns, requestedBaselineRunId, requestedComparisonRunId]
  );
  const baselineRunId = resolvedSelection.baselineRunId;
  const comparisonRunId = resolvedSelection.comparisonRunId;
  const mode: ManualResultsMode = comparisonRunId ? 'compare' : 'single';
  const selectedRunIds = useMemo(
    () => (baselineRunId ? (comparisonRunId ? [baselineRunId, comparisonRunId] : [baselineRunId]) : []),
    [baselineRunId, comparisonRunId]
  );
  const manifestRunId = manifestTarget === 'comparison' && comparisonRunId ? comparisonRunId : baselineRunId;
  const manifestTargetLabel = manifestTarget === 'comparison' && comparisonRunId
    ? COMPARISON_RUN_LABEL
    : PRIMARY_RUN_LABEL;
  const baselineVersionLabelState = useMemo(
    () => buildResultsRunVersionLabelState(baselineRunId, versions, inProgressVersions),
    [baselineRunId, inProgressVersions, versions]
  );
  const comparisonVersionLabelState = useMemo(
    () => buildResultsRunVersionLabelState(comparisonRunId, versions, inProgressVersions),
    [comparisonRunId, inProgressVersions, versions]
  );
  useEffect(() => {
    // Don't canonicalise the URL selection until the runs list has loaded. While it is still
    // loading, `runs` is empty and resolveManualRunSelection() returns an empty selection, which
    // would strip a requested baselineRunId out of the URL and bounce the user straight back out
    // of the results view — the "View results" button appears to do nothing. Once runs have
    // loaded, a genuinely-missing id falls back to a default run instead of an empty one, so it is
    // safe to write the resolved selection back.
    if (isLoadingRuns) {
      return;
    }
    if (
      requestedBaselineRunId === baselineRunId &&
      requestedComparisonRunId === comparisonRunId
    ) {
      return;
    }

    onManualSelectionChange({
      baselineRunId,
      comparisonRunId
    });
  }, [
    baselineRunId,
    comparisonRunId,
    isLoadingRuns,
    onManualSelectionChange,
    requestedBaselineRunId,
    requestedComparisonRunId
  ]);

  const loadRuns = useCallback(async () => {
    setLoadError('');
    setIsLoadingRuns(true);

    try {
      const runsPayload = await fetchResultsRuns();
      setRuns(runsPayload);
    } finally {
      setIsLoadingRuns(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

    const loadRunsWithRetry = async () => {
      try {
        await loadRuns();
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (isRetryableApiError(error)) {
          retryTimer = window.setTimeout(() => {
            void loadRunsWithRetry();
          }, API_RETRY_DELAY_MS);
          return;
        }
        setLoadError((error as Error).message);
      }
    };

    void loadRunsWithRetry();

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [loadRuns]);

  useEffect(() => {
    let cancelled = false;
    let previousActive = false;

    const pollActiveRuns = async () => {
      try {
        const jobs = await fetchModelRunJobs();
        if (cancelled) {
          return;
        }
        setRunJobs(jobs);
        const active = jobs.some((job) => job.status === 'queued' || job.status === 'running');
        if (previousActive && !active) {
          // A run just finished — refresh the completed-runs list so it appears in the picker.
          void loadRuns();
        }
        previousActive = active;
      } catch {
        // Model runs may be unavailable (e.g. cloud/preview); ignore polling errors.
      }
    };

    void pollActiveRuns();
    const timer = window.setInterval(() => {
      void pollActiveRuns();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadRuns]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

    const loadVersions = async () => {
      try {
        const payload = await fetchVersions();
        if (cancelled) {
          return;
        }
        setVersions(payload.versions);
        setInProgressVersions(payload.inProgressVersions);
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (isRetryableApiError(error)) {
          retryTimer = window.setTimeout(() => {
            void loadVersions();
          }, API_RETRY_DELAY_MS);
        }
      }
    };

    void loadVersions();

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, []);

  useEffect(() => {
    if (!comparisonRunId && manifestTarget === 'comparison') {
      setManifestTarget('baseline');
    }
  }, [comparisonRunId, manifestTarget]);

  useEffect(() => {
    // The comparison run's policy is fetched separately from its results so the policy block can
    // show both sides of a comparison; without it the block would silently describe only the
    // baseline while the page header says "Comparing runs".
    if (!comparisonRunId) {
      setComparisonDetail(null);
      return;
    }

    let cancelled = false;
    void fetchResultsRunDetail(comparisonRunId)
      .then((payload) => {
        if (!cancelled) {
          setComparisonDetail(payload);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setComparisonDetail(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [comparisonRunId]);

  useEffect(() => {
    if (!baselineRunId) {
      setBaselineDetail(null);
      return;
    }

    let cancelled = false;
    setIsLoadingDetail(true);
    setLoadError('');

    void fetchResultsRunDetail(baselineRunId)
      .then((baselinePayload) => {
        if (cancelled) {
          return;
        }
        setBaselineDetail(baselinePayload);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setLoadError((error as Error).message);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingDetail(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [baselineRunId]);

  useEffect(() => {
    if (!manifestRunId) {
      setManifest([]);
      return;
    }

    let cancelled = false;
    setIsLoadingManifest(true);
    setLoadError('');

    void fetchResultsRunFiles(manifestRunId)
      .then((files) => {
        if (!cancelled) {
          setManifest(files);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError((error as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingManifest(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [manifestRunId]);

  useEffect(() => {
    if (!baselineDetail) {
      setSelectedIndicatorIds([]);
      return;
    }

    setSelectedIndicatorIds((current) => resolveSelectedIndicatorIds(baselineDetail.indicators, current));
  }, [baselineDetail]);

  useEffect(() => {
    if (selectedRunIds.length === 0) {
      setComparePayload(null);
      setCompareError('');
      return;
    }

    let cancelled = false;
    setIsLoadingCompare(true);
    setCompareError('');

    void fetchResultsCompare(selectedRunIds, selectedIndicatorIds, compareWindow, smoothWindow)
      .then((payload) => {
        if (!cancelled) {
          setComparePayload(payload);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setComparePayload(null);
          setCompareError((error as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingCompare(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [compareWindow, selectedIndicatorIds, selectedRunIds, smoothWindow]);

  useEffect(() => {
    if (selectedRunIds.length === 0) {
      setLendingBaseline(null);
      setLendingComparison(null);
      setLendingError('');
      return;
    }

    let cancelled = false;
    setIsLoadingLending(true);
    setLendingError('');

    void fetchLendingDistributionCompare(selectedRunIds, compareWindow)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setLendingBaseline(payload.runs.find((run) => run.runId === selectedRunIds[0]) ?? null);
        setLendingComparison(
          selectedRunIds.length > 1
            ? payload.runs.find((run) => run.runId === selectedRunIds[1]) ?? null
            : null
        );
      })
      .catch((error) => {
        if (!cancelled) {
          setLendingBaseline(null);
          setLendingComparison(null);
          setLendingError((error as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingLending(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [compareWindow, selectedRunIds]);

  const runById = useMemo(() => new Map(historyRuns.map((run) => [run.runId, run])), [historyRuns]);
  // Runs are identified by an opaque timestamped id; the scenario name is what a reader recognises.
  // Fall back to the id whenever a run carries no title so nothing is ever unlabelled.
  const runLabel = (runId: string) => {
    const run = runById.get(runId);
    return run ? getRunPrimaryLabel(run) : runId;
  };

  const submitRename = async (runId: string) => {
    setIsSavingRename(true);
    setLoadError('');
    try {
      await renameResultsRun(runId, renameDraft);
      setRenamingRunId('');
      setRenameDraft('');
      await loadRuns();
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setIsSavingRename(false);
    }
  };

  /**
   * A run's full recorded policy, plus which settings deviate from the baseline it matches. Shown in
   * full on every run so a run stays identifiable when its name is missing or unclear.
   */
  const describeRunPolicy = (run: ResultsRunSummary) => {
    if (run.policySettings.length === 0) {
      return null;
    }
    const summary = summariseRunPolicy(run.policySettings);
    const changedKeys = new Set(summary.deviations.map((deviation) => deviation.key));
    const heading = summary.basePolicyTitle
      ? summary.deviations.length === 0
        ? `${summary.basePolicyTitle}, unchanged`
        : `${summary.basePolicyTitle} \u00b7 ${summary.deviations.length} changed`
      : `${run.policySettings.length} Central Bank settings`;
    return { heading, changedKeys };
  };
  const baselineSummary = baselineRunId ? runById.get(baselineRunId) ?? null : null;
  const comparisonSummary = comparisonRunId ? runById.get(comparisonRunId) ?? null : null;
  const matchedBaselineSummary = useMemo(
    () => (baselineRunId ? findMatchedManualBaselineRun(historyRuns, baselineRunId) : null),
    [baselineRunId, historyRuns]
  );
  const comparisonIsMatched = Boolean(
    baselineSummary && comparisonSummary && isMatchedManualBaselineRun(baselineSummary, comparisonSummary)
  );
  const comparisonFieldDifferences = useMemo(
    () =>
      baselineSummary && comparisonSummary
        ? getManualComparisonFieldDifferences(baselineSummary, comparisonSummary)
        : [],
    [baselineSummary, comparisonSummary]
  );
  const comparisonMismatchWarning = useMemo(
    () =>
      baselineSummary && comparisonSummary
        ? formatManualComparisonMismatchWarning(comparisonFieldDifferences)
        : null,
    [baselineSummary, comparisonFieldDifferences, comparisonSummary]
  );
  const comparisonCalibrationNotice = useMemo(
    () =>
      baselineSummary && comparisonSummary
        ? formatManualComparisonCalibrationNotice(comparisonFieldDifferences)
        : null,
    [baselineSummary, comparisonFieldDifferences, comparisonSummary]
  );
  const showMatchedBaselineSwitch = Boolean(
    comparisonSummary && matchedBaselineSummary && !comparisonIsMatched
  );
  const matchingBaselineDraft = useMemo(
    () => (baselineSummary ? buildMatchingBaselineScenarioDraft(baselineSummary) : null),
    [baselineSummary]
  );
  const matchingBaselineSteps = matchingBaselineDraft
    ? Number.parseInt(String(matchingBaselineDraft.formValues.N_STEPS ?? ''), 10)
    : null;
  const matchingBaselineSeeds = matchingBaselineDraft
    ? Number.parseInt(String(matchingBaselineDraft.formValues.N_SIMS ?? ''), 10)
    : null;
  const configuredSteps = baselineSummary?.configuration?.parameterValues.N_STEPS;
  const totalSimulationMonths = Math.max(
    0,
    Math.floor(
      typeof configuredSteps === 'number'
        ? configuredSteps
        : baselineSummary?.provenance.nSteps ?? 0
    )
  );
  const remainingAnalysisMonths = Math.max(0, totalSimulationMonths - analysisCutoffMonths);
  const availableIndicators = useMemo(() => baselineDetail?.indicators ?? [], [baselineDetail]);

  const policySettings = baselineDetail?.policySettings ?? [];
  // Collapsed, the disclosure is only worth opening if it says something. A plain count does that for
  // a single run; for a comparison the useful headline is how many settings actually differ.
  const changedPolicyKeys = useMemo(() => {
    if (!comparisonDetail) return new Set<string>();
    return new Set(
      getPolicySettingDifferences(policySettings, comparisonDetail.policySettings).map(
        (difference) => difference.key
      )
    );
  }, [comparisonDetail, policySettings]);
  const changedPolicyCount = changedPolicyKeys.size;

  const policySettingsSummary = comparisonDetail
    ? `${changedPolicyCount} of ${policySettings.length} settings differ`
    : `${policySettings.length} Central Bank settings`;
  const runDetailsRun =
    runDetailsTarget === 'comparison'
      ? comparisonDetail
      : runDetailsTarget === 'baseline'
        ? baselineDetail
        : null;
  const baselineCompareKpis = useMemo(
    () => comparePayload?.kpiSummaryByRun.find((entry) => entry.runId === baselineRunId)?.kpiSummary ?? [],
    [baselineRunId, comparePayload]
  );
  const comparisonCompareKpis = useMemo(
    () => comparePayload?.kpiSummaryByRun.find((entry) => entry.runId === comparisonRunId)?.kpiSummary ?? [],
    [comparisonRunId, comparePayload]
  );
  // The loan-level rows come from the transaction file rather than the aggregate catalog, so they
  // are merged in here rather than served as indicators. They are only offered once a lending
  // payload has loaded: a run with transaction recording off gets the rows with the reason, and a
  // run still loading gets no placeholder rows at all.
  const kpiWindowType = comparePayload?.kpiSummaryByRun[0]?.kpiSummary[0]?.windowType ?? 'post_500';
  const lendingUnavailableNote = useMemo(
    () => (lendingBaseline ? unavailableMessage(lendingBaseline) : ''),
    [lendingBaseline]
  );
  const lendingIndicators = useMemo(
    () => (lendingBaseline ? buildLendingIndicatorAvailability(lendingBaseline, lendingUnavailableNote) : []),
    [lendingBaseline, lendingUnavailableNote]
  );
  const lendingKpis = useMemo(
    () => (lendingBaseline ? buildLendingKpis(lendingBaseline, kpiWindowType) : []),
    [kpiWindowType, lendingBaseline]
  );
  const lendingComparisonKpis = useMemo(
    () => (lendingComparison ? buildLendingKpis(lendingComparison, kpiWindowType) : []),
    [kpiWindowType, lendingComparison]
  );

  const sortedKpis = useMemo(() => sortKpis(baselineCompareKpis), [baselineCompareKpis]);
  const comparisonKpiById = useMemo(
    () => new Map([...comparisonCompareKpis, ...lendingComparisonKpis].map((kpi) => [kpi.indicatorId, kpi])),
    [comparisonCompareKpis, lendingComparisonKpis]
  );
  const groupedKpis = useMemo(() => {
    const kpiById = new Map([...sortedKpis, ...lendingKpis].map((kpi) => [kpi.indicatorId, kpi]));
    return groupIndicatorsByPolicyQuestion([...availableIndicators, ...lendingIndicators])
      .map((section) => ({
        id: section.id,
        title: section.title,
        items: section.items
          .map((indicator) => kpiById.get(indicator.id))
          .filter((kpi): kpi is KpiMetricSummary => Boolean(kpi))
      }))
      .filter((section) => section.items.length > 0);
  }, [availableIndicators, lendingIndicators, lendingKpis, sortedKpis]);
  const policyGroupIds = useMemo(() => groupedKpis.map((section) => section.id), [groupedKpis]);
  // Decision 6: a row that cannot be scaled says why, instead of silently falling back to a different
  // denominator or showing an agent-scale count beside UK-scale ones.
  const indicatorDescriptionById = useMemo(() => {
    const provenance = baselineSummary?.provenance ?? baselineDetail?.provenance ?? null;
    const socialHousingNote = socialHousingRunNote(provenance?.dwellingsPerHousehold ?? null);
    return new Map(
      [...availableIndicators, ...lendingIndicators].map((indicator) => [
        indicator.id,
        indicator.id === 'output_nHomeless' && socialHousingNote
          ? `${indicator.description}${socialHousingNote}`
          : indicator.description
      ])
    );
  }, [availableIndicators, baselineDetail, baselineSummary, lendingIndicators]);
  const unavailableReasonById = useMemo(() => {
    const reasons = new Map<string, string>();
    for (const indicator of [...availableIndicators, ...lendingIndicators]) {
      if (!indicator.available && indicator.note) {
        reasons.set(indicator.id, indicator.note);
      }
    }
    return reasons;
  }, [availableIndicators, lendingIndicators]);
  const scalingConvention = useMemo(() => {
    const provenance = baselineSummary?.provenance ?? baselineDetail?.provenance ?? null;
    if (!provenance || provenance.ukHouseholds === null) {
      return null;
    }
    const factor =
      provenance.meanScaleFactor === null
        ? null
        : `about \u00d7${formatWholeNumber(provenance.meanScaleFactor)} on average`;
    return `Counts and stocks are shown at UK scale: each month\u2019s value is multiplied by ${formatWholeNumber(
      provenance.ukHouseholds
    )} UK households and divided by that month\u2019s modelled households${
      provenance.meanModelHouseholds === null ? '' : ` (mean ${formatWholeNumber(provenance.meanModelHouseholds)})`
    }${factor ? `, ${factor}` : ''}. Ratios, rates, prices, indices and durations are unaffected.`;
  }, [baselineDetail, baselineSummary]);
  const allPolicyGroupsExpanded =
    policyGroupIds.length > 0 && policyGroupIds.every((groupId) => expandedPolicyGroupIds.includes(groupId));
  const allPolicyGroupsCollapsed = policyGroupIds.every(
    (groupId) => !expandedPolicyGroupIds.includes(groupId)
  );
  const overlayIndicators = comparePayload?.indicators ?? [];
  const activeIndicatorPayload = useMemo(
    () => resolveActiveIndicatorPayload(overlayIndicators, selectedIndicatorIds, activeIndicatorId),
    [activeIndicatorId, overlayIndicators, selectedIndicatorIds]
  );
  const showRunsSkeleton = isLoadingRuns && runs.length === 0;
  const showRunsRefreshing = isLoadingRuns && runs.length > 0;
  const showKpiSkeleton = (isLoadingDetail || isLoadingCompare) && sortedKpis.length === 0;
  const showKpiRefreshing = (isLoadingDetail || isLoadingCompare) && sortedKpis.length > 0;
  const showOverlaySkeleton = isLoadingCompare && overlayIndicators.length === 0 && selectedIndicatorIds.length > 0;
  const showOverlayRefreshing = isLoadingCompare && overlayIndicators.length > 0;
  const showManifestSkeleton = isLoadingManifest && manifest.length === 0;
  const showManifestRefreshing = isLoadingManifest && manifest.length > 0;

  useEffect(() => {
    setActiveIndicatorId((current) => resolveActiveIndicatorId(selectedIndicatorIds, overlayIndicators, current));
  }, [overlayIndicators, selectedIndicatorIds]);

  useEffect(() => {
    if (!isTrendModalOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsTrendModalOpen(false);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isTrendModalOpen]);

  useEffect(() => {
    if (!runDetailsTarget) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRunDetailsTarget(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [runDetailsTarget]);

  useEffect(() => {
    setRunDetailsTarget(null);
  }, [baselineRunId, comparisonRunId]);

  const updateSelection = useCallback(
    (nextBaselineRunId: string, nextComparisonRunId: string) => {
      onManualSelectionChange({
        baselineRunId: nextBaselineRunId,
        comparisonRunId:
          nextComparisonRunId && nextComparisonRunId !== nextBaselineRunId ? nextComparisonRunId : ''
      });
    },
    [onManualSelectionChange]
  );

  const setComparisonSelection = useCallback(
    (runId: string) => {
      setComparisonDefaultOptOutRunId(runId ? '' : baselineRunId);
      updateSelection(baselineRunId, runId);
    },
    [baselineRunId, updateSelection]
  );

  const setBaselineSelection = (runId: string) => {
    // Deliberately leaves Run History open: selecting a run is often the first of several
    // comparisons, and collapsing the list would throw away the user's place in it.
    setComparisonDefaultOptOutRunId('');
    updateSelection(runId, '');
  };

  const openMatchingBaselineBuilder = () => {
    if (!matchingBaselineDraft) {
      setLoadError('This run does not record enough setup detail to pre-fill a matching baseline.');
      return;
    }
    const draftId = createScenarioDraftId();
    writeScenarioDraft(draftId, matchingBaselineDraft);
    setActiveScenarioDraftId(draftId);
    const params = new URLSearchParams({
      draft: draftId,
      baseline: matchingBaselineDraft.calibratedModel
    });
    navigate(`/scenarios/new?${params.toString()}`);
  };

  const toggleComparisonSelection = (runId: string) => {
    if (!baselineRunId || runId === baselineRunId) {
      return;
    }

    setComparisonSelection(comparisonRunId === runId ? '' : runId);
  };

  // The KPI table reports a mean; the distribution is where a flow limit actually shows up. These
  // two views sit in the same column and would otherwise never meet.
  const LENDING_METRIC_BY_INDICATOR: Record<string, LendingMetricId> = {
    core_ooLTV: 'ltv',
    core_btlLTV: 'ltv',
    core_ooLTI: 'lti',
    lending_ooMeanLtv: 'ltv',
    lending_ooMeanLti: 'lti',
    lending_ftbHighLtv: 'ltv',
    lending_hmHighLtv: 'ltv',
    lending_ftbHighLti: 'lti',
    lending_hmHighLti: 'lti'
  };

  const viewLendingDistribution = (indicatorId: string) => {
    const metric = LENDING_METRIC_BY_INDICATOR[indicatorId];
    if (!metric) {
      return;
    }
    setLendingMetric(metric);
    setLendingView('distribution');
    // The section is collapsible, so opening it is part of jumping to it.
    setIsLendingExpanded(true);
    window.requestAnimationFrame(() => {
      document.getElementById('new-lending-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const viewIndicatorTrend = (indicatorId: string) => {
    if (!selectedIndicatorIds.includes(indicatorId)) {
      setSelectedIndicatorIds((current) => [...current, indicatorId]);
    }
    setActiveIndicatorId(indicatorId);
    setShowBaselineTrend(true);
    setShowComparisonTrend(true);
    setIsTrendModalOpen(true);
  };

  const deleteRun = async (runId: string) => {
    if (!canDeleteResults) {
      return;
    }
    if (isProtectedResultsRun(runId)) {
      setLoadError(`Run "${runId}" is protected and cannot be deleted from experiments.`);
      return;
    }
    const confirmed = window.confirm(`Delete run "${runId}"? This permanently removes its Results folder.`);
    if (!confirmed) {
      return;
    }

    const deleteKey = deleteKeyRequired ? window.prompt('Enter the private delete key to delete remote experiment results.') : undefined;
    if (deleteKeyRequired && !deleteKey) {
      return;
    }

    setLoadError('');
    setIsDeletingRunId(runId);
    try {
      await deleteResultsRun(runId, deleteKey ?? undefined);
      await loadRuns();
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setIsDeletingRunId('');
    }
  };

  const downloadRun = async (runId: string) => {
    if (!runId || !canDownloadResults) {
      return;
    }

    setLoadError('');
    setIsDownloadingRunId(runId);
    try {
      await downloadResultsRun(runId);
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setIsDownloadingRunId('');
    }
  };

  const loginPath = `/login?next=${encodeURIComponent(
    buildExperimentsPath({
      ...DEFAULT_EXPERIMENT_ROUTE_STATE,
      type: 'manual',
      mode: 'view',
      baselineRunId,
      comparisonRunId
    })
  )}`;

  const renderDownloadAction = (runId: string, label: string) => {
    if (!runId) {
      return null;
    }
    if (!canDownloadResults) {
      if (!authEnabled) {
        return (
          <button type="button" className="summary-link-inline summary-button-inline" disabled>
            Raw File Download Unavailable
          </button>
        );
      }
      return (
        <Link className="summary-link-inline" to={loginPath}>
          Login to Download Raw Files
        </Link>
      );
    }
    return (
      <button
        type="button"
        className="summary-link-inline summary-button-inline"
        title="Download this run's complete raw output directory as a compressed archive."
        disabled={isDownloadingRunId === runId}
        onClick={() => void downloadRun(runId)}
      >
        {isDownloadingRunId === runId ? 'Downloading...' : label}
      </button>
    );
  };

  // Queue = pending work only (queued/running). Run History = every finished run: the completed
  // runs on disk plus failed/cancelled jobs from this session (which have no saved results).
  const queueItems = runJobs.filter((job) => job.status === 'queued' || job.status === 'running');
  const failedHistoryJobs = runJobs.filter((job) => job.status === 'failed' || job.status === 'canceled');
  const queuePreviewJob = queueItems.find((job) => job.status === 'running') ?? queueItems[0] ?? null;
  const remainingQueueItems = queuePreviewJob
    ? queueItems.filter((job) => job.jobId !== queuePreviewJob.jobId)
    : queueItems;
  const historyPreviewRun = baselineSummary ?? historyRuns[0] ?? null;
  const finishedRunCount = historyRuns.length + failedHistoryJobs.length;

  return (
    <section className="results-layout manual-results-layout">
      {loadError && <p className="error-banner">{loadError}</p>}
      <div className="results-main results-main-full">
          {queueItems.length > 0 && (
          <article className="results-card run-queue-card">
            <div className="disclosure-preview-head">
              <div className="disclosure-preview-title">
                <h3>Queue</h3>
                <p>
                  {remainingQueueItems.length} {remainingQueueItems.length === 1 ? 'run' : 'runs'} waiting
                </p>
              </div>
              <button
                type="button"
                className="disclosure-preview-toggle"
                aria-expanded={isQueueExpanded}
                onClick={() => setIsQueueExpanded((current) => !current)}
                disabled={remainingQueueItems.length === 0}
              >
                {isQueueExpanded ? '▾ Hide' : '▸ Queue'}
              </button>
            </div>

            {queuePreviewJob ? (
              <div className="run-preview-card is-static">
                <span className="run-preview-title">
                  {queuePreviewJob.title || queuePreviewJob.runId || queuePreviewJob.jobId}
                </span>
                <span className="run-preview-meta">
                  <span className={QUEUE_STATUS_META[queuePreviewJob.status].className}>
                    {QUEUE_STATUS_META[queuePreviewJob.status].label}
                  </span>
                  <span>{formatQueueTimestamp(queuePreviewJob.createdAt)}</span>
                </span>
              </div>
            ) : (
              <p className="info-banner">No runs in progress.</p>
            )}

            {isQueueExpanded && remainingQueueItems.length > 0 && (
              <ul className="job-list run-queue-list">
                {remainingQueueItems.map((job) => (
                  <li key={job.jobId} className="job-item">
                    <strong>{job.title || job.runId || job.jobId}</strong>
                    <p>
                      <span className={QUEUE_STATUS_META[job.status].className}>{QUEUE_STATUS_META[job.status].label}</span>
                    </p>
                    {job.baseline && <p>Model {job.baseline}</p>}
                    <p>{formatQueueTimestamp(job.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </article>
          )}

          <article className="results-card manual-results-summary-card">
            <div
              className={`comparison-control-strip ${
                comparisonCalibrationNotice ||
                comparisonMismatchWarning ||
                showMatchedBaselineSwitch ||
                (baselineSummary && !matchedBaselineSummary)
                  ? 'has-guidance'
                  : ''
              }`}
            >
              <div className="comparison-run-pickers">
                <label>
                <span>Primary run</span>
                <select
                  value={baselineRunId}
                  disabled={historyRuns.length === 0}
                  onChange={(event) => setBaselineSelection(event.target.value)}
                >
                  {historyRuns.map((run) => (
                    <option key={run.runId} value={run.runId}>
                      {formatRunOptionLabel(run)}
                    </option>
                  ))}
                </select>
                {baselineSummary && (
                  <>
                    <ManualSelectionStatusPills
                      status={baselineSummary.status}
                      versionLabelState={baselineVersionLabelState}
                    />
                    <RunProvenancePills provenance={baselineSummary.provenance} />
                  </>
                )}
                </label>
                <label>
                <span>Comparison run</span>
                <select
                  value={comparisonRunId}
                  disabled={!baselineRunId || historyRuns.length < 2}
                  onChange={(event) => setComparisonSelection(event.target.value)}
                >
                  <option value="">No comparison run</option>
                  {historyRuns
                    .filter((run) => run.runId !== baselineRunId)
                    .map((run) => {
                      const annotation = baselineSummary
                        ? formatManualComparisonOptionAnnotation(
                            getManualComparisonFieldDifferences(baselineSummary, run)
                          )
                        : '';
                      return (
                        <option key={run.runId} value={run.runId}>
                          {formatRunOptionLabel(run)}
                          {annotation ? ` — ${annotation}` : ''}
                        </option>
                      );
                    })}
                </select>
                {comparisonSummary ? (
                  <>
                    <ManualSelectionStatusPills
                      status={comparisonSummary.status}
                      versionLabelState={comparisonVersionLabelState}
                    />
                    <RunProvenancePills
                      provenance={comparisonSummary.provenance}
                      differsFrom={baselineSummary?.provenance ?? null}
                    />
                  </>
                ) : (
                  <small>Select a run to compare values and graph lines.</small>
                )}
                </label>
              </div>

              {(comparisonCalibrationNotice ||
                comparisonMismatchWarning ||
                showMatchedBaselineSwitch ||
                (baselineSummary && !matchedBaselineSummary)) && (
                <div className="comparison-selection-guidance">
                  {comparisonCalibrationNotice && (
                    <div className="comparison-calibration-note" role="note">
                      <p>
                        <strong>{MANUAL_COMPARISON_CALIBRATION_VERDICT}.</strong>{' '}
                        {comparisonCalibrationNotice}
                      </p>
                    </div>
                  )}

                  {comparisonMismatchWarning && (
                    <div className="warning-banner comparison-mismatch-warning" role="alert">
                      <p>
                        <strong>{MANUAL_COMPARISON_SETTINGS_VERDICT}.</strong>{' '}
                        {comparisonMismatchWarning}
                      </p>
                    </div>
                  )}

                  {showMatchedBaselineSwitch && matchedBaselineSummary && (
                    <div className="comparison-match-suggestion">
                      <button
                        type="button"
                        className="summary-link-inline summary-button-inline comparison-match-switch"
                        onClick={() => setComparisonSelection(matchedBaselineSummary.runId)}
                      >
                        Use {formatRunActionLabel(matchedBaselineSummary)} instead
                      </button>
                    </div>
                  )}

                  {baselineSummary && !matchedBaselineSummary && (
                    <div className="comparison-create-baseline-message">
                      <p>
                        <strong>
                          No baseline run exists with the same seeds, steps, and calibration model.
                        </strong>{' '}
                        {matchingBaselineDraft && matchingBaselineSteps !== null && matchingBaselineSeeds !== null
                          ? `For a better comparison, we suggest using “${formatModelOptionLabel(matchingBaselineDraft.calibratedModel)}” with ${formatWholeNumber(matchingBaselineSteps)} steps and ${formatWholeNumber(matchingBaselineSeeds)} ${matchingBaselineSeeds === 1 ? 'seed' : 'seeds'}.`
                          : 'For a better comparison, we suggest creating a run with the same model, steps, and seeds.'}
                      </p>
                      <button
                        type="button"
                        className="primary-button comparison-create-baseline-action"
                        disabled={!canWrite || !matchingBaselineDraft}
                        onClick={openMatchingBaselineBuilder}
                      >
                        Create matching run
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {baselineDetail && policySettings.length > 0 && (
              <section className="run-policy-details">
                <div className="run-policy-details-head">
                  <h3>Policy settings used</h3>
                  <p className="run-policy-details-summary">{policySettingsSummary}</p>
                </div>
                <ul className="run-policy-provenance" aria-label="Policy run provenance">
                  {[baselineDetail, ...(comparisonDetail ? [comparisonDetail] : [])].map((run) => {
                    const referencePolicy =
                      run.configuration.basePolicy ?? summariseRunPolicy(run.policySettings).basePolicyId;
                    return (
                      <li key={run.runId}>
                        <strong>
                          {run.runId === baselineDetail.runId ? PRIMARY_RUN_LABEL : COMPARISON_RUN_LABEL}: {runLabel(run.runId)}
                        </strong>
                        <span>model {getRunModelVersion(run) ?? 'not recorded'}</span>
                        <span>{referencePolicy ? `${referencePolicy} policy` : 'reference policy not recorded'}</span>
                      </li>
                    );
                  })}
                </ul>

                <div className="policy-settings-table-wrap">
                    <table className="policy-settings-table">
                      <thead>
                        <tr>
                          <th>Setting</th>
                          <th>{PRIMARY_RUN_LABEL}: {runLabel(baselineDetail.runId)}</th>
                          {comparisonDetail && (
                            <th>{COMPARISON_RUN_LABEL}: {runLabel(comparisonDetail.runId)}</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {policySettings.map((setting) => {
                          const display = CENTRAL_BANK_POLICY_DISPLAY[setting.key];
                          const format = (value: number) =>
                            display ? formatPolicyValue(value, display.unit) : String(value);
                          const comparisonValue = comparisonDetail?.policySettings.find(
                            (item) => item.key === setting.key
                          )?.value;
                          const differs = changedPolicyKeys.has(setting.key);
                          return (
                            <tr key={setting.key} className={differs ? 'policy-settings-row-changed' : undefined}>
                              <th scope="row" title={setting.key}>
                                {display?.label ?? setting.key}
                                {differs && <span className="policy-settings-changed-chip">changed</span>}
                              </th>
                              <td>{format(setting.value)}</td>
                              {comparisonDetail && (
                                <td>{comparisonValue === undefined ? 'Not recorded' : format(comparisonValue)}</td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                </div>
              </section>
            )}

            {runDetailsRun && (
              <FullRunDetailsDialog run={runDetailsRun} onClose={() => setRunDetailsTarget(null)} />
            )}

            <div className="summary-links">
              {baselineDetail && (
                <button
                  type="button"
                  className="summary-link-inline summary-button-inline"
                  aria-haspopup="dialog"
                  onClick={() => setRunDetailsTarget('baseline')}
                >
                  {comparisonDetail ? 'View primary run details' : 'View full run details'}
                </button>
              )}
              {comparisonDetail && (
                <button
                  type="button"
                  className="summary-link-inline summary-button-inline"
                  aria-haspopup="dialog"
                  onClick={() => setRunDetailsTarget('comparison')}
                >
                  View comparison run details
                </button>
              )}
              {renderDownloadAction(
                baselineRunId,
                comparisonRunId ? 'Download primary run raw files' : 'Download raw run files'
              )}
              {comparisonRunId && renderDownloadAction(comparisonRunId, 'Download comparison run raw files')}
            </div>

            {scalingConvention && <p className="results-scaling-convention">{scalingConvention}</p>}

            <div className="results-analysis-window">
              <p
                className="results-analysis-window-intro"
                title="A longer warm-up can reduce sensitivity to the model's starting state, but leaves fewer months for analysis."
              >
                <strong>Warm-up period</strong> — we suggest discarding at least the first 500 months, since the model starts from an artificial state and takes time to settle. In the paper, 2,000 months are discarded when 10,000 steps are used.
              </p>
              <div className="results-analysis-window-control">
                <label>
                  <span>Discard the first</span>
                  <select
                    value={analysisCutoffMonths}
                    onChange={(event) => {
                      setAnalysisCutoffMonths(Number.parseInt(event.target.value, 10));
                    }}
                  >
                    {ANALYSIS_CUTOFF_OPTIONS.map((months) => (
                      <option key={months} value={months}>{months.toLocaleString('en-GB')}</option>
                    ))}
                  </select>
                  <span>months</span>
                </label>
                <span aria-live="polite">· {formatWholeNumber(remainingAnalysisMonths)} months remain</span>
                <span>· applies to this page</span>
              </div>
            </div>
          </article>

          <CollapsibleSection
            className="results-card manual-results-aggregate-card"
            title="Policy results"
            description="Monthly means over the selected analysis window. Open any series to inspect its path through time."
            defaultOpen={false}
          >
            {showKpiRefreshing && (
              <LoadingSkeleton
                as="span"
                className="loading-skeleton-pill section-loading-row"
                ariaLabel="Refreshing policy results"
              />
            )}
            {showKpiSkeleton ? (
              <LoadingSkeletonGroup
                className="kpi-grid"
                count={4}
                itemClassName="loading-skeleton-card kpi-card-skeleton"
                ariaLabel="Loading policy results"
              />
            ) : (
              <div className="policy-results-sections">
                <div className="policy-results-sections-head">
                  <div className="policy-results-expansion-controls" aria-label="Policy result section controls">
                    <button
                      type="button"
                      onClick={() => setExpandedPolicyGroupIds(policyGroupIds)}
                      disabled={allPolicyGroupsExpanded}
                    >
                      Expand all
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedPolicyGroupIds([])}
                      disabled={allPolicyGroupsCollapsed}
                    >
                      Collapse all
                    </button>
                  </div>
                </div>
                <div className="policy-results-table-wrap">
                  <table className={`policy-results-table ${mode === 'compare' ? 'is-comparison' : ''}`}>
                    <colgroup>
                      <col className="policy-results-indicator-column" />
                      <col className="policy-results-value-column" />
                      {mode === 'compare' && <col className="policy-results-value-column" />}
                      {mode === 'compare' && <col className="policy-results-value-column" />}
                      <col className="policy-results-value-column" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">Indicator</th>
                        <th scope="col">{mode === 'compare' ? PRIMARY_RUN_LABEL : 'Mean for a single run'}</th>
                        {mode === 'compare' && <th scope="col">{COMPARISON_RUN_LABEL}</th>}
                        {mode === 'compare' && (
                          <th scope="col">
                            Delta: {PRIMARY_RUN_LABEL} − {COMPARISON_RUN_LABEL} ({comparisonIsMatched ? 'matched' : 'unmatched'})
                          </th>
                        )}
                        <th scope="col">Trend</th>
                      </tr>
                    </thead>
                    {groupedKpis.map((section) => {
                      const isExpanded = expandedPolicyGroupIds.includes(section.id);
                      return (
                        <tbody
                          key={section.id}
                          id={`policy-results-${section.id}`}
                          className="policy-results-group"
                        >
                          <tr className="policy-results-group-row">
                            <th colSpan={mode === 'compare' ? 5 : 3} scope="rowgroup">
                              <button
                                type="button"
                                className="policy-results-group-toggle"
                                aria-expanded={isExpanded}
                                aria-controls={`policy-results-${section.id}`}
                                onClick={() =>
                                  setExpandedPolicyGroupIds((current) =>
                                    current.includes(section.id)
                                      ? current.filter((groupId) => groupId !== section.id)
                                      : [...current, section.id]
                                  )
                                }
                              >
                                <span aria-hidden="true" className="policy-results-chevron" />
                                <strong>{section.title}</strong>
                                <small>{section.items.length} indicators</small>
                              </button>
                            </th>
                          </tr>
                          {isExpanded && (
                            <>
                              {section.items.map((kpi) => {
                                const comparisonKpi = comparisonKpiById.get(kpi.indicatorId) ?? null;
                                const delta = computeKpiDeltaValue(
                                  kpi.mean,
                                  comparisonKpi?.mean ?? null,
                                  kpi.units
                                );
                                const direction = deltaDirection(delta);
                                const unavailableReason = unavailableReasonById.get(kpi.indicatorId);
                                return (
                                  <tr key={kpi.indicatorId}>
                                    <th scope="row">
                                      <span title={indicatorDescriptionById.get(kpi.indicatorId)}>{kpi.title}</span>
                                      {kpi.scaling === 'dashboard' && (
                                        <span
                                          className="policy-results-scaled-chip"
                                          tabIndex={0}
                                          aria-describedby={`uk-scaling-tooltip-${kpi.indicatorId}`}
                                        >
                                          UK-scaled
                                          <span
                                            id={`uk-scaling-tooltip-${kpi.indicatorId}`}
                                            role="tooltip"
                                            className="policy-results-scaled-tooltip"
                                          >
                                            <strong>What UK-scaled means</strong>
                                            <span>{UK_SCALING_ROW_NOTE}</span>
                                          </span>
                                        </span>
                                      )}
                                    </th>
                                    <td title={unavailableReason}>
                                      {unavailableReason && kpi.mean === null
                                        ? 'Unavailable'
                                        : formatKpiValue(kpi.mean, kpi.units, kpi.scaling)}
                                    </td>
                                    {mode === 'compare' && (
                                      <td>{formatKpiValue(comparisonKpi?.mean ?? null, kpi.units, kpi.scaling)}</td>
                                    )}
                                    {mode === 'compare' && (
                                      <td className={deltaClassName()}>
                                        <span className="policy-results-change-direction" aria-label={direction.label}>
                                          {direction.symbol}
                                        </span>{' '}
                                        {formatKpiComparisonDelta(
                                          kpi.mean,
                                          comparisonKpi?.mean ?? null,
                                          kpi.units,
                                          kpi.scaling
                                        )}
                                      </td>
                                    )}
                                    <td>
                                      <div className="policy-row-actions">
                                        {/* Loan-level rows are pooled over the window, not a monthly
                                            series, so there is no path through time to open. */}
                                        {!isLendingKpiId(kpi.indicatorId) && (
                                          <button
                                            type="button"
                                            className="policy-trend-link"
                                            onClick={() => viewIndicatorTrend(kpi.indicatorId)}
                                          >
                                            View trend
                                          </button>
                                        )}
                                        {SHOW_NEW_LENDING_SECTION && LENDING_METRIC_BY_INDICATOR[kpi.indicatorId] && (
                                          <button
                                            type="button"
                                            className="policy-trend-link"
                                            onClick={() => viewLendingDistribution(kpi.indicatorId)}
                                          >
                                            Distribution
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </>
                          )}
                        </tbody>
                      );
                    })}
                  </table>
                </div>
              </div>
            )}
          </CollapsibleSection>

          {isTrendModalOpen && (
            <div
              className="trend-modal-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setIsTrendModalOpen(false);
                }
              }}
            >
              <section
                className="trend-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="trend-modal-title"
              >
                <div className="trend-modal-head">
                  <div>
                    <p className="trend-modal-eyebrow">Time series</p>
                    <h3 id="trend-modal-title">
                      {activeIndicatorPayload?.indicator.title ?? 'Loading indicator'}
                    </h3>
                  </div>
                  <button
                    type="button"
                    className="trend-modal-close"
                    aria-label="Close trend chart"
                    onClick={() => setIsTrendModalOpen(false)}
                  >
                    ×
                  </button>
                </div>
                <div className="trend-modal-layout">
                  <aside className="trend-modal-settings" aria-label="Trend chart settings">
                    <h4>Settings</h4>
                    <p className="trend-modal-window-note">
                      <span>Analysis window</span>
                      <strong>{compareWindowLabel(compareWindow)}</strong>
                      <small>Set above the results table, because it applies to the whole page.</small>
                    </p>
                    <label>
                      <span>Smoothing</span>
                      <select
                        value={String(smoothWindow)}
                        onChange={(event) => setSmoothWindow(Number.parseInt(event.target.value, 10) as SmoothWindow)}
                      >
                        <option value="0">Raw monthly</option>
                        <option value="3">3-month average</option>
                        <option value="12">12-month average</option>
                      </select>
                      <small>Changes this graph only.</small>
                    </label>
                    <div className="trend-modal-reading-note">
                      <strong>Reading the chart</strong>
                      <span>Dotted lines show each selected run&apos;s mean.</span>
                    </div>
                  </aside>
                  <div className="trend-modal-visual">
                    {showOverlaySkeleton || showOverlayRefreshing ? (
                      <LoadingSkeleton
                        className="trend-modal-chart-skeleton"
                        ariaLabel="Loading trend chart"
                      />
                    ) : compareError ? (
                      <p className="error-banner">{compareError}</p>
                    ) : !activeIndicatorPayload ? (
                      <p className="info-banner">No trend data is available for this indicator.</p>
                    ) : (
                      <EChart
                        option={buildManualOverlayOption(
                          activeIndicatorPayload,
                          baselineRunId,
                          comparisonRunId,
                          {
                            [PRIMARY_RUN_LABEL]: showBaselineTrend,
                            [COMPARISON_RUN_LABEL]: showComparisonTrend
                          }
                        )}
                        className="trend-modal-chart"
                        onLegendSelectionChange={(selected) => {
                          setShowBaselineTrend(selected[PRIMARY_RUN_LABEL] ?? showBaselineTrend);
                          setShowComparisonTrend(selected[COMPARISON_RUN_LABEL] ?? showComparisonTrend);
                        }}
                      />
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}

          {SHOW_NEW_LENDING_SECTION && (
            <NewLendingCard
              baseline={lendingBaseline}
              comparison={lendingComparison}
              isLoading={isLoadingLending}
              error={lendingError}
              activeView={lendingView}
              onViewChange={setLendingView}
              activeMetric={lendingMetric}
              onMetricChange={setLendingMetric}
              open={isLendingExpanded}
              onOpenChange={setIsLendingExpanded}
            />
          )}

          <CollapsibleSection
            className="results-card run-history-card"
            title="Run History"
            description={sidebarSubtitle}
            summary={`${finishedRunCount} finished ${finishedRunCount === 1 ? 'run' : 'runs'}`}
            open={isHistoryExpanded}
            onOpenChange={setIsHistoryExpanded}
          >
            {historyPreviewRun ? (
              <button
                type="button"
                className={`run-preview-card ${historyPreviewRun.runId === baselineRunId ? 'is-active' : ''}`}
                onClick={() => setBaselineSelection(historyPreviewRun.runId)}
              >
                <span className="run-preview-title">{getRunPrimaryLabel(historyPreviewRun)}</span>
                <span className="run-preview-meta">
                  <span className={statusClass(historyPreviewRun.status)}>{historyPreviewRun.status}</span>
                  <span className="run-preview-action">
                    {historyPreviewRun.runId === baselineRunId ? 'Viewing' : 'View'}
                  </span>
                </span>
              </button>
            ) : (
              <p className="info-banner">No completed runs yet.</p>
            )}

            <div className="disclosure-expanded-list">
                {showRunsRefreshing && (
                  <LoadingSkeleton
                    as="span"
                    className="loading-skeleton-pill section-loading-row"
                    ariaLabel="Refreshing runs"
                  />
                )}
                {showRunsSkeleton ? (
                  <LoadingSkeletonGroup
                    className="run-list-skeleton"
                    count={4}
                    itemClassName="loading-skeleton-card run-item-skeleton"
                    ariaLabel="Loading runs"
                  />
                ) : (
                  <div className="run-history-split" onMouseLeave={() => setPreviewRunId('')}>
                  <ul className="run-list">
                    {historyRuns.map((run) => {
                      const isBaselineSelected = baselineRunId === run.runId;
                      const isComparisonSelected = comparisonRunId === run.runId;
                      return (
                        <li
                          key={run.runId}
                          className={[
                            'run-item',
                            isBaselineSelected ? 'selected-baseline' : '',
                            isComparisonSelected ? 'selected-comparison' : '',
                            previewRunId === run.runId ? 'is-previewed' : ''
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onMouseEnter={() => setPreviewRunId(run.runId)}
                          onFocus={() => setPreviewRunId(run.runId)}
                        >
                          <div className="run-item-head">
                            <div className="run-item-name">
                              {renamingRunId === run.runId ? (
                                <form
                                  className="run-rename-form"
                                  onSubmit={(event) => {
                                    event.preventDefault();
                                    void submitRename(run.runId);
                                  }}
                                >
                                  <input
                                    type="text"
                                    value={renameDraft}
                                    maxLength={120}
                                    autoFocus
                                    aria-label={`Rename ${run.title ?? run.runId}`}
                                    placeholder="Scenario name"
                                    disabled={isSavingRename}
                                    onChange={(event) => setRenameDraft(event.target.value)}
                                  />
                                  <button type="submit" className="run-select-btn" disabled={isSavingRename}>
                                    {isSavingRename ? 'Saving...' : 'Save'}
                                  </button>
                                  <button
                                    type="button"
                                    className="table-toggle"
                                    disabled={isSavingRename}
                                    onClick={() => {
                                      setRenamingRunId('');
                                      setRenameDraft('');
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </form>
                              ) : (
                                <strong>{getRunPrimaryLabel(run)}</strong>
                              )}
                            </div>
                            <div className="run-role-chips">
                              {isBaselineSelected && <span className="run-role-chip">Primary run</span>}
                              {isComparisonSelected && <span className="run-role-chip comparison">Comparison run</span>}
                            </div>
                          </div>

                          <div className="manual-run-action-row">
                            <button
                              type="button"
                              className={`run-select-btn ${isBaselineSelected ? 'active' : ''}`}
                              onClick={() => setBaselineSelection(run.runId)}
                            >
                              {isBaselineSelected ? 'Primary run selected' : 'Set as primary run'}
                            </button>
                            <button
                              type="button"
                              className={`run-select-btn ${isComparisonSelected ? 'active' : ''}`}
                              onClick={() => toggleComparisonSelection(run.runId)}
                              disabled={!baselineRunId || isBaselineSelected}
                            >
                              {isComparisonSelected ? 'Clear comparison run' : 'Set as comparison run'}
                            </button>
                            {canWrite && renamingRunId !== run.runId && (
                              <button
                                type="button"
                                className="table-toggle"
                                onClick={() => {
                                  setRenamingRunId(run.runId);
                                  setRenameDraft(run.title ?? '');
                                }}
                              >
                                Rename
                              </button>
                            )}
                          </div>

                          <div className="run-meta">
                            <span className={statusClass(run.status)}>{run.status}</span>
                          </div>
                          {canDeleteResults && (
                            <button
                              type="button"
                              className="danger-button"
                              disabled={isDeletingRunId === run.runId || isProtectedResultsRun(run.runId)}
                              onClick={() => void deleteRun(run.runId)}
                              title={isProtectedResultsRun(run.runId) ? 'Protected run cannot be deleted.' : undefined}
                            >
                              {isProtectedResultsRun(run.runId)
                                ? 'Protected'
                                : isDeletingRunId === run.runId
                                  ? 'Deleting...'
                                  : 'Delete'}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {(() => {
                    const detailRun = runById.get(previewRunId) ?? runById.get(baselineRunId) ?? historyRuns[0] ?? null;
                    if (!detailRun) {
                      return null;
                    }
                    const policy = describeRunPolicy(detailRun);
                    return (
                      <div className="run-history-preview" aria-live="polite">
                        <p className="run-history-preview-eyebrow">
                          {previewRunId === detailRun.runId ? 'Hovered run' : 'Selected run'}
                        </p>
                        <h4>{getRunPrimaryLabel(detailRun)}</h4>
                        <p className="run-item-id"><strong>Run ID:</strong> {detailRun.runId}</p>
                        <div className="run-meta">
                          <span className={statusClass(detailRun.status)}>{detailRun.status}</span>
                          <span>{(detailRun.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
                          <span>
                            Coverage {detailRun.parseCoverage.supportedCount}/{detailRun.parseCoverage.requiredCount}
                          </span>
                        </div>
                        {policy ? (
                          <div className="run-item-policy">
                            <p className="run-item-policy-head">{policy.heading}</p>
                            <dl className="run-item-policy-list">
                              {detailRun.policySettings.map((setting) => {
                                const display = CENTRAL_BANK_POLICY_DISPLAY[setting.key];
                                const isChanged = policy.changedKeys.has(setting.key);
                                return (
                                  <div
                                    key={setting.key}
                                    className={isChanged ? 'is-changed' : undefined}
                                    title={setting.key}
                                  >
                                    <dt>{display?.label ?? setting.key}</dt>
                                    <dd>
                                      {display ? formatPolicyValue(setting.value, display.unit) : String(setting.value)}
                                    </dd>
                                  </div>
                                );
                              })}
                            </dl>
                          </div>
                        ) : (
                          <p className="info-banner">No policy settings recorded for this run.</p>
                        )}
                      </div>
                    );
                  })()}
                  </div>
                )}
                {failedHistoryJobs.length > 0 && (
                  <ul className="run-list run-history-failed-list">
                    {failedHistoryJobs.map((job) => (
                      <li key={job.jobId} className="run-item run-item-failed">
                        <div className="run-item-head">
                          <strong>{job.title || job.runId || job.jobId}</strong>
                          <span className={QUEUE_STATUS_META[job.status].className}>
                            {QUEUE_STATUS_META[job.status].label}
                          </span>
                        </div>
                        <p className="run-queue-failure">
                          This run {job.status === 'canceled' ? 'was cancelled' : 'failed'} — no results.
                          {job.signal
                            ? ` Stopped by signal ${job.signal}.`
                            : job.exitCode != null
                              ? ` Exit code ${job.exitCode}.`
                              : ''}
                        </p>
                        <p>{formatQueueTimestamp(job.createdAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
          </CollapsibleSection>

          <article className="results-card manual-results-files-card">
            <CollapsibleSection
              title="File Manifest"
              defaultOpen={false}
              summary={`${manifestTargetLabel}${manifestRunId ? ` · Run ID: ${manifestRunId}` : ''}`}
              className="manual-results-disclosure"
              bodyClassName="manual-results-disclosure-body"
            >
              {mode === 'compare' && comparisonRunId && (
                <div className="manual-manifest-switcher">
                  <button
                    type="button"
                    className={`filter-pill ${manifestTarget === 'baseline' ? 'active' : ''}`}
                    onClick={() => setManifestTarget('baseline')}
                  >
                    Primary run
                  </button>
                  <button
                    type="button"
                    className={`filter-pill ${manifestTarget === 'comparison' ? 'active' : ''}`}
                    onClick={() => setManifestTarget('comparison')}
                  >
                    Comparison run
                  </button>
                </div>
              )}
              <p>
                Showing {manifestTargetLabel.toLowerCase()} manifest.{' '}
                <strong>Run ID: {manifestRunId || 'no run selected'}</strong>
              </p>
              {showManifestRefreshing && (
                <LoadingSkeleton
                  as="span"
                  className="loading-skeleton-pill section-loading-row"
                  ariaLabel="Refreshing file manifest"
                />
              )}
              {showManifestSkeleton ? (
                <LoadingSkeletonGroup
                  className="manifest-skeleton"
                  count={6}
                  itemClassName="manifest-skeleton-row"
                  ariaLabel="Loading file manifest"
                />
              ) : (
                <div className="manifest-table-wrap">
                  <table className="manifest-table">
                    <thead>
                      <tr>
                        <th>File</th>
                        <th>Type</th>
                        <th>Size</th>
                        <th>Coverage</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manifest.map((file) => (
                        <tr key={file.filePath}>
                          <td>{file.fileName}</td>
                          <td>{file.fileType}</td>
                          <td>{(file.sizeBytes / 1024 / 1024).toFixed(2)} MB</td>
                          <td>
                            <span className={coverageClass(file.coverageStatus)}>{file.coverageStatus}</span>
                          </td>
                          <td>{file.note ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CollapsibleSection>
          </article>
      </div>
    </section>
  );
}
