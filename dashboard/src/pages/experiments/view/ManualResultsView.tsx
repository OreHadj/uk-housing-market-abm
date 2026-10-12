import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
  ResultsRunSummary
} from '../../../../shared/types';
import { CollapsibleSection } from '../../../components/CollapsibleSection';
import { EChart } from '../../../components/EChart';
import { LoadingSkeleton, LoadingSkeletonGroup } from '../../../components/LoadingSkeleton';
import { PolicyRanAs } from '../../../components/PolicyRanAs';
import { ManualSelectionStatusPills } from '../../../components/ManualSelectionStatusPills';
import { RunPicker, type RunPickerOption } from '../../../components/RunPicker';
import {
  API_RETRY_DELAY_MS,
  downloadResultsRun,
  fetchLendingDistributionCompare,
  fetchModelRunJobs,
  fetchResultsCompare,
  fetchResultsRunDetail,
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
import { PolicyReportContext, PolicyReportView } from './PolicyReportView';
import { getRunModelVersion, getRunPrimaryLabel } from '../../run-history/runHistoryDisplay';
import { PolicyDetailedHeader } from '../../report2/PolicyDetailedHeader';
import { POLICY_REPORT_INDICATORS } from '../../../lib/policyReport';
import { ResultsQueue } from './ResultsQueue';
import { manualResultsQueueItem } from '../../../lib/resultsQueue';
import { readPolicyAnalysisWindow, updateReportQuery } from '../../../lib/reportUrlState';
import { useStopAndDeleteExperiment } from './useStopAndDeleteExperiment';
import { buildResultsRunVersionLabelState } from '../../../lib/versionLabels';
import { formatModelOptionLabel } from '../../../lib/modelAnchors';
import { isPracticeRunTitle } from '../../../lib/runSearch';
import { summariseRunPolicy } from '../../../../shared/policyCatalogue';
import { CENTRAL_BANK_POLICY_DISPLAY, formatPolicyValue } from '../../../../shared/policyDisplay';
import { buildExperimentsPath } from '../routeState';
import { DEFAULT_EXPERIMENT_ROUTE_STATE } from '../types';
import {
  createScenarioDraftId,
  setActiveScenarioDraftId,
  writeScenarioDraft
} from '../../../lib/scenarioDraft';

const SHOW_DWELLINGS_PER_HOUSEHOLD = false;
const SHOW_NEW_LENDING_SECTION = false;
const SHOW_LENDING_DERIVED_INDICATORS = false;
const ANALYSIS_CUTOFF_OPTIONS = [0, 500, 1_000, 1_500, 2_000] as const;
const POLICY_REPORT_INDICATOR_IDS = POLICY_REPORT_INDICATORS.map((indicator) => indicator.id);

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

function runPickerOption(run: ResultsRunSummary, note?: string): RunPickerOption {
  return {
    value: run.runId,
    name: getRunPrimaryLabel(run),
    note,
    modelVersion: getRunModelVersion(run),
    isExample: run.isExample === true,
    isPractice: isPracticeRunTitle(run.title)
  };
}

function formatRunActionLabel(run: ResultsRunSummary): string {
  const label = getRunPrimaryLabel(run);
  return label === run.runId ? label : `${label} (${run.runId})`;
}

interface ManualResultsViewProps {
  presentation?: 'report' | 'detailed';
  presentationControls?: ReactNode;
  canWrite: boolean;
  canDownloadResults: boolean;
  canDeleteResults: boolean;
  deleteKeyRequired: boolean;
  authEnabled: boolean;
  requestedBaselineRunId: string;
  requestedComparisonRunId: string;
  requestedJobRef?: string;
  queueInitiallyExpanded?: boolean;
  onManualSelectionChange: (selection: { baselineRunId: string; comparisonRunId: string; comparisonNoneFor: string; jobRef?: string }) => void;
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
  presentation = 'detailed',
  presentationControls,
  canWrite,
  canDownloadResults,
  canDeleteResults,
  deleteKeyRequired,
  authEnabled,
  requestedBaselineRunId,
  requestedComparisonRunId,
  requestedJobRef = '',
  queueInitiallyExpanded = false,
  onManualSelectionChange
}: ManualResultsViewProps) {
  const navigate = useNavigate();
  const [pageSearch, setPageSearch] = useSearchParams();
  const isGuidedPolicy = pageSearch.get('demo') === 'policy-results';
  const guidedTrendId = isGuidedPolicy ? pageSearch.get('policyTrend') ?? '' : '';
  const guidedPolicyResultsOpen = isGuidedPolicy && pageSearch.get('policyResults') === 'open';
  const isAlignedDetailed = presentation === 'detailed' && Boolean(presentationControls);
  const [runs, setRuns] = useState<ResultsRunSummary[]>([]);
  const [loadedBaselineDetail, setBaselineDetail] = useState<ResultsRunDetail | null>(null);
  const [loadedComparisonDetail, setComparisonDetail] = useState<ResultsRunDetail | null>(null);
  const [manifest, setManifest] = useState<ResultsFileManifestEntry[]>([]);
  const [selectedIndicatorIds, setSelectedIndicatorIds] = useState<string[]>([]);
  const [activeIndicatorId, setActiveIndicatorId] = useState<string>(guidedTrendId);
  const [isTrendModalOpen, setIsTrendModalOpen] = useState<boolean>(false);
  const [runDetailsTarget, setRunDetailsTarget] = useState<ManifestTarget | null>(null);
  const [expandedPolicyGroupIds, setExpandedPolicyGroupIds] = useState<string[]>([]);
  const [loadedComparePayload, setComparePayload] = useState<ResultsComparePayload | null>(null);
  const compareWindow = readPolicyAnalysisWindow(pageSearch);
  const analysisCutoffMonths = compareWindow === 'full' ? 0 : Number.parseInt(compareWindow.slice(4), 10);
  const setAnalysisCutoffMonths = (months: number) => setPageSearch((current) => updateReportQuery(current, {
    window: months === 0 ? 'full' : `post${months}`
  }), { replace: true });
  const [smoothWindow, setSmoothWindow] = useState<SmoothWindow>(12);
  // Report means and lines use the same recorded monthly data. Keep Detailed's smoothing choice.
  const effectiveSmoothWindow = presentation === 'report' ? 0 : smoothWindow;
  const requestedIndicatorIds = presentation === 'report' ? POLICY_REPORT_INDICATOR_IDS : selectedIndicatorIds;
  const [showBaselineTrend, setShowBaselineTrend] = useState<boolean>(true);
  const [showComparisonTrend, setShowComparisonTrend] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>('');
  const [compareError, setCompareError] = useState<string>('');
  const [isLoadingRuns, setIsLoadingRuns] = useState<boolean>(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [isLoadingCompare, setIsLoadingCompare] = useState<boolean>(false);
  const [isLoadingManifest, setIsLoadingManifest] = useState<boolean>(false);
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
  const [isPolicyResultsExpanded, setIsPolicyResultsExpanded] = useState<boolean>(guidedPolicyResultsOpen);
  const [isLendingExpanded, setIsLendingExpanded] = useState<boolean>(false);
  const [isQueueExpanded, setIsQueueExpanded] = useState<boolean>(queueInitiallyExpanded);
  // The opt-out belongs to this run and survives presentation changes, refresh and navigation.
  const comparisonDefaultOptOutRunId = pageSearch.get('comparisonNoneFor') ?? '';
  const requestedJobId = requestedJobRef.startsWith('manual:') ? requestedJobRef.slice('manual:'.length) : '';
  const removedJobIds = useRef(new Set<string>());
  const removedRunIds = useRef(new Set<string>());
  const stopDeletion = useStopAndDeleteExperiment({
    canWrite, canDeleteResults, deleteKeyRequired,
    onDeleted: ({ jobRef, id, runId }) => {
      removedJobIds.current.add(id);
      if (runId) removedRunIds.current.add(runId);
      setRunJobs((current) => current.filter((job) => job.jobId !== id));
      setRuns((current) => current.filter((run) => run.runId !== runId));
      if (jobRef === requestedJobRef || runId === requestedBaselineRunId || runId === requestedComparisonRunId) {
        onManualSelectionChange({
          baselineRunId: requestedBaselineRunId === runId ? '' : requestedBaselineRunId,
          comparisonRunId: requestedComparisonRunId === runId ? '' : requestedComparisonRunId,
          comparisonNoneFor: requestedComparisonRunId === runId ? requestedBaselineRunId : comparisonDefaultOptOutRunId
        });
      }
    }
  });
  const requestedJob = runJobs.find((job) => requestedJobId
    ? job.jobId === requestedJobId
    : Boolean(requestedBaselineRunId) && job.runId === requestedBaselineRunId);
  const requestedRunId = requestedBaselineRunId || requestedJob?.runId || '';
  const requestedJobPending = (Boolean(requestedJobId) && !requestedJob)
    || requestedJob?.status === 'queued' || requestedJob?.status === 'running';

  // A run's output folder is created when it is queued, so an in-progress run appears in the
  // results listing with no parsed output (0 MB, "invalid"). Keep those out of the run pickers —
  // they belong in the Queue until they finish — so only runs that actually completed are offered.
  const activeRunIds = useMemo(
    () => {
      const ids = new Set(
        runJobs
          .filter((job) => job.status === 'queued' || job.status === 'running' || stopDeletion.pending?.jobRef === `manual:${job.jobId}`)
          .map((job) => job.runId)
          .filter(Boolean)
      );
      // The results directory may arrive before the first jobs response. Preserve the submitted
      // run's queued identity instead of treating its empty directory as completed output.
      if (requestedJobPending && requestedRunId) ids.add(requestedRunId);
      return ids;
    },
    [requestedRunId, requestedJobPending, runJobs, stopDeletion.pending?.jobRef]
  );
  const historyRuns = useMemo(() => runs.filter((run) => !activeRunIds.has(run.runId)), [runs, activeRunIds]);
  const awaitingRequestedResult = requestedJob?.status === 'succeeded' &&
    !historyRuns.some((run) => run.runId === requestedRunId);
  const selectedRunPending = requestedJobPending || activeRunIds.has(requestedRunId) || awaitingRequestedResult;
  const comparisonDefaultOptOut = Boolean(comparisonDefaultOptOutRunId) &&
    (comparisonDefaultOptOutRunId === requestedRunId || comparisonDefaultOptOutRunId === requestedJobRef);

  const resolvedSelection = useMemo(
    () => isGuidedPolicy || selectedRunPending || (requestedRunId && isLoadingRuns)
      ? { baselineRunId: requestedRunId, comparisonRunId: requestedComparisonRunId === requestedRunId ? '' : requestedComparisonRunId }
      : resolveManualRunSelection(historyRuns, requestedRunId, requestedComparisonRunId, {
        defaultToMatchedBaseline: !comparisonDefaultOptOut
      }),
    [comparisonDefaultOptOut, historyRuns, isGuidedPolicy, requestedRunId, requestedComparisonRunId, selectedRunPending, isLoadingRuns]
  );
  const baselineRunId = resolvedSelection.baselineRunId;
  const comparisonRunId = resolvedSelection.comparisonRunId;
  const mode: ManualResultsMode = comparisonRunId ? 'compare' : 'single';
  const selectedRunIds = useMemo(
    () => (baselineRunId && !selectedRunPending ? (comparisonRunId ? [baselineRunId, comparisonRunId] : [baselineRunId]) : []),
    [baselineRunId, comparisonRunId, selectedRunPending]
  );
  // Never label the previous run's cached details or chart as the newly selected run.
  const baselineDetail = !selectedRunPending && loadedBaselineDetail?.runId === baselineRunId ? loadedBaselineDetail : null;
  const comparisonDetail = !selectedRunPending && loadedComparisonDetail?.runId === comparisonRunId ? loadedComparisonDetail : null;
  const comparePayload = loadedComparePayload?.runIds.length === selectedRunIds.length &&
    loadedComparePayload.runIds.every((runId, index) => runId === selectedRunIds[index]) &&
    loadedComparePayload.window === compareWindow &&
    loadedComparePayload.smoothWindow === effectiveSmoothWindow &&
    requestedIndicatorIds.every((id) => loadedComparePayload.indicatorIds.includes(id))
    ? loadedComparePayload : null;
  const manifestRunId = selectedRunPending ? '' : manifestTarget === 'comparison' && comparisonRunId ? comparisonRunId : baselineRunId;
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
    // loaded, a genuinely-missing id falls back to a default run instead of an empty one. An
    // accepted job keeps its requested result id until the job and its finished output arrive.
    if (isLoadingRuns || selectedRunPending) {
      return;
    }
    if (
      requestedBaselineRunId === baselineRunId &&
      requestedComparisonRunId === comparisonRunId &&
      (!requestedJobId || requestedJob?.status !== 'succeeded')
    ) {
      return;
    }

    onManualSelectionChange({
      baselineRunId,
      comparisonRunId,
      comparisonNoneFor: !comparisonRunId && baselineRunId === requestedRunId && comparisonDefaultOptOut ? baselineRunId : ''
    });
  }, [
    baselineRunId,
    comparisonRunId,
    isLoadingRuns,
    selectedRunPending,
    requestedJobId,
    requestedJob?.status,
    requestedRunId,
    comparisonDefaultOptOut,
    onManualSelectionChange,
    requestedBaselineRunId,
    requestedComparisonRunId
  ]);

  const runsRequestId = useRef(0);
  const loadRuns = useCallback(async (isCurrent: () => boolean = () => true) => {
    const requestId = ++runsRequestId.current;
    setLoadError('');
    setIsLoadingRuns(true);

    try {
      const runsPayload = (await fetchResultsRuns()).filter((run) => !removedRunIds.current.has(run.runId));
      if (isCurrent() && requestId === runsRequestId.current) setRuns(runsPayload);
      return runsPayload;
    } finally {
      if (isCurrent() && requestId === runsRequestId.current) setIsLoadingRuns(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

    const loadRunsWithRetry = async () => {
      try {
        await loadRuns(() => !cancelled);
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

  // Changing the selected run must not discard observed job transitions or a pending refresh.
  const historyRequestedJobId = useRef(requestedJobId);
  const historyRequestedRunId = useRef(requestedRunId);
  useEffect(() => {
    historyRequestedJobId.current = requestedJobId;
    historyRequestedRunId.current = requestedRunId;
  }, [requestedJobId, requestedRunId]);

  useEffect(() => {
    let cancelled = false;
    let previousStatuses: Map<string, ModelRunJobStatus> | undefined;
    const pendingCompletedRunIds = new Set<string>();
    let polling = false;

    const pollActiveRuns = async () => {
      if (cancelled || polling) return;
      polling = true;
      try {
        const jobs = (await fetchModelRunJobs()).filter((job) => !removedJobIds.current.has(job.jobId));
        if (cancelled) {
          return;
        }
        setRunJobs(jobs);
        const statuses = new Map(jobs.map((job) => [job.jobId, job.status]));
        const finishedJobs = jobs.filter((job) =>
          job.status !== 'queued' && job.status !== 'running' &&
          previousStatuses?.get(job.jobId) !== job.status &&
          (previousStatuses !== undefined || (job.status === 'succeeded' && (historyRequestedJobId.current
            ? job.jobId === historyRequestedJobId.current
            : Boolean(historyRequestedRunId.current) && job.runId === historyRequestedRunId.current)))
        );
        const removedActiveJob = previousStatuses !== undefined && [...previousStatuses].some(([jobId, status]) =>
          (status === 'queued' || status === 'running') && !statuses.has(jobId)
        );
        for (const job of finishedJobs) {
          if (job.status === 'succeeded' && job.runId) pendingCompletedRunIds.add(job.runId);
        }
        for (const runId of pendingCompletedRunIds) {
          if (removedRunIds.current.has(runId)) pendingCompletedRunIds.delete(runId);
        }
        if (finishedJobs.length || removedActiveJob || pendingCompletedRunIds.size) {
          // Every completed job can add history while other work continues. Output listing can
          // lag completion, so keep retrying missing successful runs (including the submitted run).
          const refreshedRuns = await loadRuns(() => !cancelled);
          if (cancelled) return;
          for (const run of refreshedRuns) pendingCompletedRunIds.delete(run.runId);
        }
        previousStatuses = statuses;
      } catch {
        // Model runs may be unavailable (e.g. cloud/preview); ignore polling errors.
      } finally {
        polling = false;
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
    if (!comparisonRunId || selectedRunPending) {
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
  }, [comparisonRunId, selectedRunPending]);

  useEffect(() => {
    if (!baselineRunId || selectedRunPending) {
      setBaselineDetail(null);
      setIsLoadingDetail(false);
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
  }, [baselineRunId, selectedRunPending]);

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
      setIsLoadingCompare(false);
      return;
    }

    let cancelled = false;
    setIsLoadingCompare(true);
    setCompareError('');

    void fetchResultsCompare(selectedRunIds, requestedIndicatorIds, compareWindow, effectiveSmoothWindow)
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
  }, [compareWindow, requestedIndicatorIds, selectedRunIds, effectiveSmoothWindow]);

  useEffect(() => {
    if (!SHOW_NEW_LENDING_SECTION && !SHOW_LENDING_DERIVED_INDICATORS) return;
    if (selectedRunIds.length === 0) {
      setLendingBaseline(null);
      setLendingComparison(null);
      setLendingError('');
      setIsLoadingLending(false);
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

  const baselineSummary = baselineRunId ? runById.get(baselineRunId) ?? null : null;
  const comparisonSummary = comparisonRunId ? runById.get(comparisonRunId) ?? null : null;
  const selectedRunName = baselineDetail ? getRunPrimaryLabel(baselineDetail) : baselineSummary ? getRunPrimaryLabel(baselineSummary) : requestedJob?.title || baselineRunId || requestedBaselineRunId || (selectedRunPending ? 'Checking submitted run…' : 'Select a policy run');
  const comparisonRunName = comparisonDetail ? getRunPrimaryLabel(comparisonDetail) : comparisonSummary ? getRunPrimaryLabel(comparisonSummary) : comparisonRunId;
  const detailedTitle = comparisonRunId ? `${selectedRunName} vs ${comparisonRunName}` : selectedRunName;
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
    () => (SHOW_LENDING_DERIVED_INDICATORS && lendingBaseline
      ? buildLendingIndicatorAvailability(lendingBaseline, lendingUnavailableNote)
      : []),
    [lendingBaseline, lendingUnavailableNote]
  );
  const lendingKpis = useMemo(
    () => (SHOW_LENDING_DERIVED_INDICATORS && lendingBaseline
      ? buildLendingKpis(lendingBaseline, kpiWindowType)
      : []),
    [kpiWindowType, lendingBaseline]
  );
  const lendingComparisonKpis = useMemo(
    () => (SHOW_LENDING_DERIVED_INDICATORS && lendingComparison
      ? buildLendingKpis(lendingComparison, kpiWindowType)
      : []),
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
  const showKpiSkeleton = (isLoadingDetail || isLoadingCompare) && sortedKpis.length === 0;
  const showKpiRefreshing = (isLoadingDetail || isLoadingCompare) && sortedKpis.length > 0;
  const showOverlaySkeleton = isLoadingCompare && overlayIndicators.length === 0 && selectedIndicatorIds.length > 0;
  const showOverlayRefreshing = isLoadingCompare && overlayIndicators.length > 0;
  const showManifestSkeleton = isLoadingManifest && manifest.length === 0;
  const showManifestRefreshing = isLoadingManifest && manifest.length > 0;

  useEffect(() => {
    setActiveIndicatorId((current) => resolveActiveIndicatorId(selectedIndicatorIds, overlayIndicators, current));
  }, [overlayIndicators, selectedIndicatorIds]);

  const closeTrendModal = useCallback(() => {
    setIsTrendModalOpen(false);
    if (isGuidedPolicy) setPageSearch((current) => {
      const next = new URLSearchParams(current);
      next.delete('policyTrend');
      return next;
    }, { replace: true });
  }, [isGuidedPolicy, setPageSearch]);

  useEffect(() => {
    if (!isTrendModalOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeTrendModal();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [closeTrendModal, isTrendModalOpen]);

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

  useEffect(() => {
    setIsTrendModalOpen(false);
  }, [presentation]);

  useEffect(() => {
    if (!isGuidedPolicy) return;
    setIsPolicyResultsExpanded(guidedPolicyResultsOpen);
  }, [guidedPolicyResultsOpen, isGuidedPolicy]);

  useEffect(() => {
    if (!isGuidedPolicy || presentation !== 'detailed') return;
    if (!guidedTrendId) { setIsTrendModalOpen(false); return; }
    if (!baselineDetail?.indicators.some((indicator) => indicator.id === guidedTrendId)) return;
    setSelectedIndicatorIds((current) => current.includes(guidedTrendId) ? current : [...current, guidedTrendId]);
    setActiveIndicatorId(guidedTrendId);
    setIsTrendModalOpen(true);
  }, [baselineDetail, guidedTrendId, isGuidedPolicy, presentation]);

  const updateSelection = useCallback(
    (nextBaselineRunId: string, nextComparisonRunId: string, comparisonNoneFor = '') => {
      onManualSelectionChange({
        baselineRunId: nextBaselineRunId,
        comparisonRunId:
          nextComparisonRunId && nextComparisonRunId !== nextBaselineRunId ? nextComparisonRunId : '',
        comparisonNoneFor,
        // Editing a comparison must keep the accepted identity while its first jobs response
        // is pending. A primary selection change or completed handoff retires the reference.
        ...(selectedRunPending && nextBaselineRunId === requestedRunId && requestedJobRef ? { jobRef: requestedJobRef } : {})
      });
    },
    [onManualSelectionChange, selectedRunPending, requestedRunId, requestedJobRef]
  );

  const setComparisonSelection = useCallback(
    (runId: string) => {
      updateSelection(baselineRunId, runId, runId ? '' : baselineRunId);
    },
    [baselineRunId, updateSelection]
  );

  const setBaselineSelection = (runId: string) => {
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
    if (isGuidedPolicy) setPageSearch((current) => {
      const next = new URLSearchParams(current);
      next.set('policyTrend', indicatorId);
      return next;
    }, { replace: true });
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

  // Queue = pending work only (queued/running). Finished runs are managed on the Run History page.
  const queueItems = runJobs.filter((job) => job.status === 'queued' || job.status === 'running' || stopDeletion.pending?.jobRef === `manual:${job.jobId}`);
  const loadingRequestedJob = Boolean(requestedJobId) && !requestedJob;
  const runPickers = (
    <div className="comparison-run-pickers results-run-pickers">
      <label>
      <span>{isAlignedDetailed ? 'Selected policy run' : 'Primary run'}</span>
      <RunPicker
        label={isAlignedDetailed ? 'Selected policy run' : 'Primary run'}
        value={baselineRunId}
        options={historyRuns.map((run) => runPickerOption(run))}
        disabled={historyRuns.length === 0}
        onChange={setBaselineSelection}
        placeholder={selectedRunName}
        missingLabel={selectedRunName}
      />
      {!isAlignedDetailed && baselineSummary && (
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
      <span>{isAlignedDetailed ? 'Comparison baseline' : 'Comparison run'}</span>
      <RunPicker
        label={isAlignedDetailed ? 'Comparison baseline' : 'Comparison run'}
        value={comparisonRunId}
        options={historyRuns
          .filter((run) => run.runId !== baselineRunId)
          .map((run) => runPickerOption(run, baselineSummary
            ? formatManualComparisonOptionAnnotation(getManualComparisonFieldDifferences(baselineSummary, run)) || undefined
            : undefined))}
        disabled={!baselineRunId || historyRuns.length < 2}
        onChange={setComparisonSelection}
        noneLabel="No comparison run"
        clearLabel="Clear comparison run"
        missingLabel={comparisonRunName}
      />
      {!isAlignedDetailed && (comparisonSummary ? (
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
      ))}
      </label>
    </div>
  );

  return (
    <section className={`results-layout manual-results-layout${isAlignedDetailed ? ' policy-detailed-layout' : ''}`}>
      {isAlignedDetailed && <PolicyDetailedHeader
        title={detailedTitle}
        runPickers={runPickers}
        presentationControls={presentationControls}
        printDisabled={isLoadingRuns || isLoadingDetail || isLoadingCompare || !baselineDetail}
        analysisWindowControl={<label><span>Analysis window</span><select aria-label="Analysis window" value={analysisCutoffMonths} onChange={(event) => setAnalysisCutoffMonths(Number.parseInt(event.target.value, 10))}>{ANALYSIS_CUTOFF_OPTIONS.map((months) => <option key={months} value={months}>{months === 0 ? 'Full run' : `After month ${months.toLocaleString('en-GB')}`}</option>)}</select></label>}
      />}
      {loadError && <p className="error-banner">{loadError}</p>}
      <div className="results-main results-main-full">
          <ResultsQueue
            items={queueItems.map(manualResultsQueueItem)}
            expanded={isQueueExpanded} onExpandedChange={setIsQueueExpanded}
            canCancel={canWrite && canDeleteResults} stopDeletion={stopDeletion}
            loadingSubmitted={loadingRequestedJob}
          />
          {selectedRunPending && <p className="info-banner" role="status">{selectedRunName} — results will load automatically when this run finishes.</p>}

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
              {!isAlignedDetailed && runPickers}
              {isAlignedDetailed && <div className="policy-detailed-provenance">
                {baselineSummary && <div><strong>Selected policy run</strong><ManualSelectionStatusPills status={baselineSummary.status} versionLabelState={baselineVersionLabelState} /><RunProvenancePills provenance={baselineSummary.provenance} /></div>}
                {comparisonSummary && <div><strong>Comparison baseline</strong><ManualSelectionStatusPills status={comparisonSummary.status} versionLabelState={comparisonVersionLabelState} /><RunProvenancePills provenance={comparisonSummary.provenance} differsFrom={baselineSummary?.provenance ?? null} /></div>}
              </div>}

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
                          No baseline run exists with the same seeds, steps and housing calibration (UK households and dwellings).
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

            {presentation === 'report' && baselineDetail && (
              <PolicyReportContext primary={baselineDetail} comparison={comparisonDetail} comparisonRunId={comparisonRunId} />
            )}

            {presentation === 'detailed' && baselineDetail && policySettings.length > 0 && (
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
                          const comparisonSetting = comparisonDetail?.policySettings.find(
                            (item) => item.key === setting.key
                          );
                          const comparisonValue = comparisonSetting?.value;
                          const differs = changedPolicyKeys.has(setting.key);
                          return (
                            <tr key={setting.key} className={differs ? 'policy-settings-row-changed' : undefined}>
                              <th scope="row" title={setting.key}>
                                {display?.label ?? setting.key}
                                {differs && <span className="policy-settings-changed-chip">changed</span>}
                              </th>
                              <td>
                                {format(setting.value)}
                                {differs && <PolicyRanAs settingKey={setting.key} ranAs={setting.ranAs} />}
                              </td>
                              {comparisonDetail && (
                                <td>
                                  {comparisonValue === undefined ? 'Not recorded' : format(comparisonValue)}
                                  {differs && <PolicyRanAs settingKey={setting.key} ranAs={comparisonSetting?.ranAs} />}
                                </td>
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

            {presentation === 'detailed' && scalingConvention && <p className="results-scaling-convention">{scalingConvention}</p>}

            <div className="results-analysis-window">
              <p
                className="results-analysis-window-intro"
                title="A longer warm-up can reduce sensitivity to the model's starting state, but leaves fewer months for analysis."
              >
                <strong>Warm-up period</strong> — we suggest discarding at least the first 500 months, since the model starts from an artificial state and takes time to settle. In the paper, 2,000 months are discarded when 10,000 steps are used.
              </p>
              <div className="results-analysis-window-control">
                {!isAlignedDetailed && <label>
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
                </label>}
                {isAlignedDetailed && <span>{compareWindowLabel(compareWindow)}</span>}
                {presentation === 'detailed' && <span aria-live="polite">· {formatWholeNumber(remainingAnalysisMonths)} months remain</span>}
                <span>· applies to this page</span>
              </div>
            </div>
          </article>

          {presentation === 'report' ? (
            <PolicyReportView
              payload={comparePayload}
              primary={baselineDetail}
              comparison={comparisonDetail}
              primaryRunId={baselineRunId}
              comparisonRunId={comparisonRunId}
              windowLabel={compareWindowLabel(compareWindow)}
              isLoading={isLoadingRuns || isLoadingDetail || isLoadingCompare || Boolean(baselineRunId && !comparePayload && !compareError)}
              error={compareError}
            />
          ) : (
          <CollapsibleSection
            className="results-card manual-results-aggregate-card"
            title="Policy results"
            description="Monthly means over the selected analysis window. Open any series to inspect its path through time."
            defaultOpen={false}
            open={isGuidedPolicy ? guidedPolicyResultsOpen : isPolicyResultsExpanded}
            onOpenChange={(open) => {
              setIsPolicyResultsExpanded(open);
              if (isGuidedPolicy) setPageSearch((current) => {
                const next = new URLSearchParams(current);
                if (open) next.set('policyResults', 'open');
                else next.delete('policyResults');
                return next;
              }, { replace: true });
            }}
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
                        {mode === 'compare' && <th scope="col">Primary vs comparison</th>}
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
                                            data-guided-target={kpi.indicatorId === 'core_mortgageApprovals' ? 'policy-mortgage-approvals-trend' : undefined}
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
          )}

          {presentation === 'detailed' && isTrendModalOpen && (
            <div
              className={`trend-modal-backdrop${isGuidedPolicy ? ' is-guided' : ''}`}
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  closeTrendModal();
                }
              }}
            >
              <section
                className="trend-modal"
                data-indicator-id={activeIndicatorId}
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
                    onClick={closeTrendModal}
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
