import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  KpiMetricSummary,
  ModelRunJob,
  ModelRunJobStatus,
  ResultsCompareWindow,
  ResultsComparePayload,
  ResultsFileManifestEntry,
  ResultsRunDetail,
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
  fetchModelRunJobs,
  fetchResultsCompare,
  fetchResultsRunDetail,
  fetchResultsRunFiles,
  fetchResultsRuns,
  fetchVersions,
  isRetryableApiError
} from '../../../lib/api';
import {
  HEADLINE_KPI_IDS,
  KPI_DETAIL_ROWS,
  computeKpiDeltaValue,
  formatKpiComparisonDelta,
  formatKpiDeltaValue,
  formatKpiValue,
  getKpiComparisonDeltaLabel,
  getKpiMetricValue,
  groupIndicatorsByPolicyQuestion,
  resolveActiveIndicatorId,
  resolveActiveIndicatorPayload,
  resolveManualRunSelection,
  resolveSelectedIndicatorIds,
  sortKpis
} from '../../../lib/manualResultsView';
import { buildManualOverlayOption } from '../../../lib/manualOverlayChartOption';
import { buildResultsRunVersionLabelState } from '../../../lib/versionLabels';
import { buildExperimentsPath } from '../routeState';
import { DEFAULT_EXPERIMENT_ROUTE_STATE } from '../types';

const PROTECTED_RESULTS_RUN_IDS = new Set(['v0-output', 'v4.0-output']);

type CompareWindow = ResultsCompareWindow;
type SmoothWindow = 0 | 3 | 12;
type ManifestTarget = 'baseline' | 'comparison';
type ManualResultsMode = 'single' | 'compare';

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

function deltaClassName(value: number | null): string {
  if (value === null || !Number.isFinite(value) || Math.abs(value) < 1e-12) {
    return 'neutral';
  }
  return value > 0 ? 'positive' : 'negative';
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
  canDownloadResults,
  canDeleteResults,
  deleteKeyRequired,
  authEnabled,
  requestedBaselineRunId,
  requestedComparisonRunId,
  onManualSelectionChange,
  sidebarSubtitle
}: ManualResultsViewProps) {
  const [runs, setRuns] = useState<ResultsRunSummary[]>([]);
  const [baselineDetail, setBaselineDetail] = useState<ResultsRunDetail | null>(null);
  const [manifest, setManifest] = useState<ResultsFileManifestEntry[]>([]);
  const [selectedIndicatorIds, setSelectedIndicatorIds] = useState<string[]>([]);
  const [activeIndicatorId, setActiveIndicatorId] = useState<string>('');
  const [isTrendModalOpen, setIsTrendModalOpen] = useState<boolean>(false);
  const [expandedPolicyGroupIds, setExpandedPolicyGroupIds] = useState<string[]>(['credit_access']);
  const [isComparisonPickerOpen, setIsComparisonPickerOpen] = useState<boolean>(
    Boolean(requestedComparisonRunId)
  );
  const [showAllKpiDetails, setShowAllKpiDetails] = useState<boolean>(false);
  const [comparePayload, setComparePayload] = useState<ResultsComparePayload | null>(null);
  const [compareWindow, setCompareWindow] = useState<CompareWindow>('post500');
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
  const [isHistoryExpanded, setIsHistoryExpanded] = useState<boolean>(false);
  const [isQueueExpanded, setIsQueueExpanded] = useState<boolean>(false);

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
    () => resolveManualRunSelection(historyRuns, requestedBaselineRunId, requestedComparisonRunId),
    [historyRuns, requestedBaselineRunId, requestedComparisonRunId]
  );
  const baselineRunId = resolvedSelection.baselineRunId;
  const comparisonRunId = resolvedSelection.comparisonRunId;
  const mode: ManualResultsMode = comparisonRunId ? 'compare' : 'single';
  const selectedRunIds = useMemo(
    () => (baselineRunId ? (comparisonRunId ? [baselineRunId, comparisonRunId] : [baselineRunId]) : []),
    [baselineRunId, comparisonRunId]
  );
  const manifestRunId = manifestTarget === 'comparison' && comparisonRunId ? comparisonRunId : baselineRunId;
  const manifestTargetLabel = manifestTarget === 'comparison' && comparisonRunId ? 'Comparison' : 'Baseline';
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
    if (comparisonRunId) {
      setIsComparisonPickerOpen(true);
    }
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

  const runById = useMemo(() => new Map(historyRuns.map((run) => [run.runId, run])), [historyRuns]);
  const baselineSummary = baselineRunId ? runById.get(baselineRunId) ?? null : null;
  const comparisonSummary = comparisonRunId ? runById.get(comparisonRunId) ?? null : null;
  const availableIndicators = useMemo(() => baselineDetail?.indicators ?? [], [baselineDetail]);
  const baselineCompareKpis = useMemo(
    () => comparePayload?.kpiSummaryByRun.find((entry) => entry.runId === baselineRunId)?.kpiSummary ?? [],
    [baselineRunId, comparePayload]
  );
  const comparisonCompareKpis = useMemo(
    () => comparePayload?.kpiSummaryByRun.find((entry) => entry.runId === comparisonRunId)?.kpiSummary ?? [],
    [comparisonRunId, comparePayload]
  );
  const sortedKpis = useMemo(() => sortKpis(baselineCompareKpis), [baselineCompareKpis]);
  const headlineKpis = useMemo(() => {
    const kpiById = new Map(sortedKpis.map((kpi) => [kpi.indicatorId, kpi]));
    return HEADLINE_KPI_IDS.map((indicatorId) => kpiById.get(indicatorId)).filter(
      (kpi): kpi is KpiMetricSummary => Boolean(kpi)
    );
  }, [sortedKpis]);
  const comparisonKpiById = useMemo(
    () => new Map(comparisonCompareKpis.map((kpi) => [kpi.indicatorId, kpi])),
    [comparisonCompareKpis]
  );
  const groupedKpis = useMemo(() => {
    const kpiById = new Map(sortedKpis.map((kpi) => [kpi.indicatorId, kpi]));
    return groupIndicatorsByPolicyQuestion(availableIndicators)
      .map((section) => ({
        id: section.id,
        title: section.title,
        items: section.items
          .map((indicator) => kpiById.get(indicator.id))
          .filter((kpi): kpi is KpiMetricSummary => Boolean(kpi))
      }))
      .filter((section) => section.items.length > 0);
  }, [availableIndicators, sortedKpis]);
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

  const setBaselineSelection = (runId: string) => {
    updateSelection(runId, comparisonRunId === runId ? '' : comparisonRunId);
    setIsHistoryExpanded(false);
  };

  const toggleComparisonSelection = (runId: string) => {
    if (!baselineRunId || runId === baselineRunId) {
      return;
    }

    updateSelection(baselineRunId, comparisonRunId === runId ? '' : runId);
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
            Download Unavailable
          </button>
        );
      }
      return (
        <Link className="summary-link-inline" to={loginPath}>
          Login to Download
        </Link>
      );
    }
    return (
      <button
        type="button"
        className="summary-link-inline summary-button-inline"
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

      <div className={`results-top-row ${queueItems.length === 0 ? 'results-top-row-single' : ''}`}>
        <article className="results-card run-history-card">
          <div className="disclosure-preview-head">
            <div className="disclosure-preview-title">
              <h3>Run History</h3>
              <p>{finishedRunCount} finished {finishedRunCount === 1 ? 'run' : 'runs'}</p>
            </div>
            <button
              type="button"
              className="disclosure-preview-toggle"
              aria-expanded={isHistoryExpanded}
              onClick={() => setIsHistoryExpanded((current) => !current)}
            >
              {isHistoryExpanded ? '▾ Hide' : '▸ All runs'}
            </button>
          </div>

          {historyPreviewRun ? (
            <button
              type="button"
              className={`run-preview-card ${historyPreviewRun.runId === baselineRunId ? 'is-active' : ''}`}
              onClick={() => setBaselineSelection(historyPreviewRun.runId)}
            >
              <span className="run-preview-title">{historyPreviewRun.runId}</span>
              <span className="run-preview-meta">
                <span className={statusClass(historyPreviewRun.status)}>{historyPreviewRun.status}</span>
                <span>{(historyPreviewRun.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
                <span className="run-preview-action">
                  {historyPreviewRun.runId === baselineRunId ? 'Viewing' : 'View'}
                </span>
              </span>
            </button>
          ) : (
            <p className="info-banner">No completed runs yet.</p>
          )}

          {isHistoryExpanded && (
            <div className="disclosure-expanded-list">
              <p>{sidebarSubtitle}</p>
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
                          isComparisonSelected ? 'selected-comparison' : ''
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <div className="run-item-head">
                          <strong>{run.runId}</strong>
                          <div className="run-role-chips">
                            {isBaselineSelected && <span className="run-role-chip">Baseline</span>}
                            {isComparisonSelected && <span className="run-role-chip comparison">Comparison</span>}
                          </div>
                        </div>

                        <div className="manual-run-action-row">
                          <button
                            type="button"
                            className={`run-select-btn ${isBaselineSelected ? 'active' : ''}`}
                            onClick={() => setBaselineSelection(run.runId)}
                          >
                            {isBaselineSelected ? 'Baseline selected' : 'Set baseline'}
                          </button>
                          <button
                            type="button"
                            className={`run-select-btn ${isComparisonSelected ? 'active' : ''}`}
                            onClick={() => toggleComparisonSelection(run.runId)}
                            disabled={!baselineRunId || isBaselineSelected}
                          >
                            {isComparisonSelected ? 'Clear comparison' : 'Set comparison'}
                          </button>
                        </div>

                        <div className="run-meta">
                          <span className={statusClass(run.status)}>{run.status}</span>
                          <span>{(run.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
                        </div>
                        <p>
                          Coverage: {run.parseCoverage.supportedCount}/{run.parseCoverage.requiredCount} supported
                        </p>
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
          )}
        </article>

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
                  {job.baseline && <p>Model version: {job.baseline}</p>}
                  <p>{formatQueueTimestamp(job.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </article>
        )}
      </div>

      <div className="results-main results-main-full">
          <article className="results-card manual-results-summary-card">
            <div className="results-card-head">
              <h2>Policy run</h2>
              <span className="manual-results-mode-pill">{mode === 'compare' ? 'Comparing runs' : 'Single run'}</span>
            </div>
            <p>
              Choose the completed policy run whose results you want to inspect.
            </p>

            <div className="comparison-run-pickers">
              <label>
                <span>Selected policy run</span>
                <select
                  value={baselineRunId}
                  disabled={historyRuns.length === 0}
                  onChange={(event) => setBaselineSelection(event.target.value)}
                >
                  {historyRuns.map((run) => (
                    <option key={run.runId} value={run.runId}>{run.runId}</option>
                  ))}
                </select>
                {baselineSummary && (
                  <ManualSelectionStatusPills
                    status={baselineSummary.status}
                    versionLabelState={baselineVersionLabelState}
                  />
                )}
              </label>
              {isComparisonPickerOpen && (
                <label>
                  <span>Compare with</span>
                  <select
                    value={comparisonRunId}
                    disabled={!baselineRunId || historyRuns.length < 2}
                    onChange={(event) => updateSelection(baselineRunId, event.target.value)}
                  >
                    <option value="">Choose a run</option>
                    {historyRuns
                      .filter((run) => run.runId !== baselineRunId)
                      .map((run) => (
                        <option key={run.runId} value={run.runId}>{run.runId}</option>
                      ))}
                  </select>
                  {comparisonSummary ? (
                    <ManualSelectionStatusPills
                      status={comparisonSummary.status}
                      versionLabelState={comparisonVersionLabelState}
                    />
                  ) : (
                    <small>Select a run to compare values and graph lines.</small>
                  )}
                </label>
              )}
            </div>
            <label className="comparison-enable-toggle">
              <input
                type="checkbox"
                checked={isComparisonPickerOpen}
                disabled={!baselineRunId || historyRuns.length < 2}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setIsComparisonPickerOpen(enabled);
                  if (!enabled && comparisonRunId) {
                    updateSelection(baselineRunId, '');
                  }
                }}
              />
              <span>Compare with another run</span>
            </label>

            <div className="summary-links">
              <Link
                className="summary-link-inline"
                to={buildExperimentsPath({
                  ...DEFAULT_EXPERIMENT_ROUTE_STATE,
                  type: 'sensitivity',
                  mode: 'view'
                })}
              >
                Open Policy Sensitivity
              </Link>
              {renderDownloadAction(baselineRunId, 'Download Baseline Results')}
              {comparisonRunId && renderDownloadAction(comparisonRunId, 'Download Comparison Results')}
            </div>

            <p>Analysis-window and smoothing controls are available when a trend chart is opened.</p>
          </article>

          <article className="results-card manual-results-aggregate-card">
            <div className="aggregate-results-head">
              <div>
                <h3>Policy impact summary</h3>
                <p>
                  {showAllKpiDetails
                    ? 'Headline cards show mean, CV and range over the selected analysis window.'
                    : 'Headline outcomes are followed by every available result, grouped by policy question. Seed uncertainty intervals are not calculated in this view.'}
                </p>
              </div>
              <div className="aggregate-results-actions">
                <button
                  type="button"
                  className="table-toggle aggregate-results-toggle"
                  aria-pressed={showAllKpiDetails}
                  onClick={() => setShowAllKpiDetails((current) => !current)}
                >
                  {showAllKpiDetails ? 'Hide details' : 'More details'}
                </button>
              </div>
            </div>
            {showKpiRefreshing && (
              <LoadingSkeleton
                as="span"
                className="loading-skeleton-pill section-loading-row"
                ariaLabel="Refreshing aggregate results"
              />
            )}
            {showKpiSkeleton ? (
              <LoadingSkeletonGroup
                className="kpi-grid"
                count={4}
                itemClassName="loading-skeleton-card kpi-card-skeleton"
                ariaLabel="Loading aggregate results"
              />
            ) : (
              <div
                id="aggregate-results-grid"
                className={['kpi-grid', showAllKpiDetails ? 'kpi-grid-detailed' : ''].filter(Boolean).join(' ')}
              >
                {headlineKpis.map((kpi) => {
                  const comparisonKpi = comparisonKpiById.get(kpi.indicatorId) ?? null;
                  const meanDelta = computeKpiDeltaValue(kpi.mean, comparisonKpi?.mean ?? null, kpi.units);
                  return (
                    <div key={kpi.indicatorId} className="kpi-card">
                      <p className="kpi-title">{kpi.title}</p>
                      {!showAllKpiDetails ? (
                        mode === 'single' ? (
                          <p className="kpi-value">Mean (month): {formatKpiValue(kpi.mean, kpi.units)}</p>
                        ) : (
                          <div className="manual-kpi-compare-grid">
                            <p>
                              <span>Baseline</span>
                              {formatKpiValue(kpi.mean, kpi.units)}
                            </p>
                            <p>
                              <span>Comparison</span>
                              {formatKpiValue(comparisonKpi?.mean ?? null, kpi.units)}
                            </p>
                            <p className={`manual-kpi-delta ${deltaClassName(meanDelta)}`}>
                              <span>{getKpiComparisonDeltaLabel(kpi.units)}</span>
                              {formatKpiComparisonDelta(kpi.mean, comparisonKpi?.mean ?? null, kpi.units)}
                            </p>
                          </div>
                        )
                      ) : (
                        <div className="manual-kpi-detail-table-wrap">
                          {mode === 'single' ? (
                            <table className="manual-kpi-detail-table single">
                              <thead>
                                <tr>
                                  <th>Metric</th>
                                  <th>Value</th>
                                </tr>
                              </thead>
                              <tbody>
                                {KPI_DETAIL_ROWS.map((row) => {
                                  const value = getKpiMetricValue(kpi, row.key);
                                  const units = row.units === 'dynamic' ? kpi.units : row.units;
                                  return (
                                    <tr key={row.key}>
                                      <td>{row.label}</td>
                                      <td>{formatKpiValue(value, units)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          ) : (
                            <table className="manual-kpi-detail-table compare">
                              <thead>
                                <tr>
                                  <th>Metric</th>
                                  <th>Baseline</th>
                                  <th>Comparison</th>
                                  <th>Delta</th>
                                </tr>
                              </thead>
                              <tbody>
                                {KPI_DETAIL_ROWS.map((row) => {
                                  const baselineValue = getKpiMetricValue(kpi, row.key);
                                  const comparisonValue = getKpiMetricValue(comparisonKpi, row.key);
                                  const units = row.units === 'dynamic' ? kpi.units : row.units;
                                  const delta = computeKpiDeltaValue(baselineValue, comparisonValue, units);
                                  const formattedDelta =
                                    row.units === 'dynamic'
                                      ? formatKpiComparisonDelta(baselineValue, comparisonValue, units)
                                      : formatKpiDeltaValue(delta, units);
                                  return (
                                    <tr key={row.key}>
                                      <td>{row.label}</td>
                                      <td>{formatKpiValue(baselineValue, units)}</td>
                                      <td>{formatKpiValue(comparisonValue, units)}</td>
                                      <td className={deltaClassName(delta)}>{formattedDelta}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!showKpiSkeleton && (
              <div className="policy-results-sections">
                <div className="policy-results-sections-head">
                  <h3>All policy results</h3>
                  <p>Monthly means over the selected analysis window. Open any series to inspect its path through time.</p>
                </div>
                {groupedKpis.map((section) => (
                  <section key={section.id} className="policy-results-group">
                    <button
                      type="button"
                      className="policy-results-group-toggle"
                      aria-expanded={expandedPolicyGroupIds.includes(section.id)}
                      aria-controls={`policy-results-${section.id}`}
                      onClick={() =>
                        setExpandedPolicyGroupIds((current) =>
                          current.includes(section.id)
                            ? current.filter((groupId) => groupId !== section.id)
                            : [...current, section.id]
                        )
                      }
                    >
                      <span>
                        <strong>{section.title}</strong>
                        <small>{section.items.length} indicators</small>
                      </span>
                      <span aria-hidden="true" className="policy-results-chevron">
                        {expandedPolicyGroupIds.includes(section.id) ? '−' : '+'}
                      </span>
                    </button>
                    {expandedPolicyGroupIds.includes(section.id) && (
                      <div id={`policy-results-${section.id}`} className="policy-results-table-wrap">
                        <table className="policy-results-table">
                          <thead>
                            <tr>
                              <th>Indicator</th>
                              <th>{mode === 'compare' ? 'Baseline' : 'Mean'}</th>
                              {mode === 'compare' && <th>Comparison</th>}
                              {mode === 'compare' && <th>Change</th>}
                              <th><span className="visually-hidden">Action</span></th>
                            </tr>
                          </thead>
                          <tbody>
                            {section.items.map((kpi) => {
                              const comparisonKpi = comparisonKpiById.get(kpi.indicatorId) ?? null;
                              const delta = computeKpiDeltaValue(kpi.mean, comparisonKpi?.mean ?? null, kpi.units);
                              return (
                                <tr key={kpi.indicatorId}>
                                  <th scope="row">{kpi.title}</th>
                                  <td>{formatKpiValue(kpi.mean, kpi.units)}</td>
                                  {mode === 'compare' && (
                                    <td>{formatKpiValue(comparisonKpi?.mean ?? null, kpi.units)}</td>
                                  )}
                                  {mode === 'compare' && (
                                    <td className={deltaClassName(delta)}>
                                      {formatKpiComparisonDelta(kpi.mean, comparisonKpi?.mean ?? null, kpi.units)}
                                    </td>
                                  )}
                                  <td>
                                    <button
                                      type="button"
                                      className="policy-trend-link"
                                      onClick={() => viewIndicatorTrend(kpi.indicatorId)}
                                    >
                                      View trend
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                ))}
              </div>
            )}
          </article>

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
                    <label>
                      <span>Analysis window</span>
                      <select
                        value={compareWindow}
                        onChange={(event) => setCompareWindow(event.target.value as CompareWindow)}
                      >
                        <option value="post500">After month 500</option>
                        <option value="post200">After month 200</option>
                        <option value="tail120">Latest 120 months</option>
                        <option value="full">Full run</option>
                      </select>
                      <small>Also updates the means in the results tables.</small>
                    </label>
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
                            Baseline: showBaselineTrend,
                            Comparison: showComparisonTrend
                          }
                        )}
                        className="trend-modal-chart"
                        onLegendSelectionChange={(selected) => {
                          setShowBaselineTrend(selected.Baseline ?? showBaselineTrend);
                          setShowComparisonTrend(selected.Comparison ?? showComparisonTrend);
                        }}
                      />
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}

          <article className="results-card manual-results-files-card">
            <CollapsibleSection
              title="File Manifest"
              defaultOpen={false}
              summary={`${manifestTargetLabel}${manifestRunId ? ` · ${manifestRunId}` : ''}`}
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
                    Baseline
                  </button>
                  <button
                    type="button"
                    className={`filter-pill ${manifestTarget === 'comparison' ? 'active' : ''}`}
                    onClick={() => setManifestTarget('comparison')}
                  >
                    Comparison
                  </button>
                </div>
              )}
              <p>
                Showing {manifestTargetLabel.toLowerCase()} manifest for <strong>{manifestRunId || 'no run selected'}</strong>.
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
