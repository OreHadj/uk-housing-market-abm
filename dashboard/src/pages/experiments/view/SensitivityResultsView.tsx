import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type {
  KpiMetricKey,
  SensitivityExperimentChartsPayload,
  SensitivityExperimentMetadata,
  SensitivityExperimentResultsPayload,
  SensitivityExperimentSummary,
  SensitivityIndicatorPointMetric
} from '../../../../shared/types';
import type { EChartsOption } from 'echarts';
import { CollapsibleSection } from '../../../components/CollapsibleSection';
import { EChart } from '../../../components/EChart';
import {
  API_RETRY_DELAY_MS,
  deleteSensitivityExperiment,
  downloadSensitivityExperiment,
  fetchSensitivityExperiment,
  fetchSensitivityExperimentCharts,
  fetchSensitivityExperimentResults,
  fetchSensitivityExperiments,
  isRetryableApiError
} from '../../../lib/api';
import { KPI_LABELS, SELECTABLE_KPI_KEYS } from '../../../lib/kpiLabels';
import {
  buildDeltaTrendOption,
  buildSensitivityTornadoOption
} from '../../../lib/sensitivityChartOptions';
import { BASE_POLICY_OPTIONS, CENTRAL_BANK_POLICY_KEYS } from '../../../../shared/policyCatalogue';
import { CENTRAL_BANK_POLICY_DISPLAY, formatPolicyValue } from '../../../../shared/policyDisplay';
import { formatModelOptionLabel } from '../../../lib/modelAnchors';
import { buildExperimentsPath } from '../routeState';
import { DEFAULT_EXPERIMENT_ROUTE_STATE } from '../types';
import { ResultsQueue } from './ResultsQueue';
import { sensitivityResultsQueueItem } from '../../../lib/resultsQueue';
import { useStopAndDeleteExperiment } from './useStopAndDeleteExperiment';
import { useResultsTopNavigation } from './useResultsTopNavigation';
import { useRunHistoryDeletion } from './useRunHistoryDeletion';
import { RunHistoryCheckbox, RunHistorySelectionToolbar } from './RunHistorySelection';
import { SensitivityReportView } from './sensitivity-report/SensitivityReportView';
import { formatReportSetting, getReportWindowLabel, reportPolicyUnit } from './sensitivity-report/reportModel';
import { SensitivityResultsHeader } from '../../sensitivity-report2/SensitivityResultsHeader';
import { readSensitivityDetailedState, updateReportQuery } from '../../../lib/reportUrlState';

const KPI_OPTIONS = SELECTABLE_KPI_KEYS.map((key) => ({ key, ...KPI_LABELS[key] }));

interface SensitivityResultsViewProps {
  presentation?: 'report' | 'detailed';
  presentationControls?: ReactNode;
  canWrite: boolean;
  canDownloadResults: boolean;
  canDeleteResults: boolean;
  deleteKeyRequired: boolean;
  authEnabled: boolean;
  requestedExperimentId: string;
  preferCompletedRun?: boolean;
  queueInitiallyExpanded?: boolean;
  onSelectedExperimentIdChange: (experimentId: string) => void;
  sidebarSubtitle: string;
}

function statusClass(status: SensitivityExperimentSummary['status']): string {
  switch (status) {
    case 'succeeded':
      return 'status-pill complete';
    case 'running':
      return 'status-pill partial';
    case 'queued':
    case 'canceled':
      return 'coverage-pill unsupported';
    default:
      return 'status-pill invalid';
  }
}

function formatStatus(status: SensitivityExperimentSummary['status']): string {
  return status.replace('_', ' ');
}

function formatQueueTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function isFinishedStatus(status: SensitivityExperimentSummary['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}

function formatMetric(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }
  return value.toLocaleString('en-GB', { maximumFractionDigits: 6 });
}

function formatSignedPercent(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }
  return `${value >= 0 ? '+' : ''}${value.toLocaleString('en-GB', { maximumFractionDigits: 6 })}%`;
}

function formatBasePolicyLabel(basePolicy: SensitivityExperimentSummary['basePolicy']): string {
  return basePolicy ? `${basePolicy} baseline policy` : 'Not recorded';
}

/**
 * The setup a completed sweep actually ran with, in the same terms the run-setup form's live summary
 * used when it was created — so what you read afterwards matches what you chose.
 *
 * Values are shown in their display unit (85%, 4.5x income) rather than the raw stored fraction the
 * setup form prints, so this card does not disagree with the settings table directly beneath it.
 */
function describeSweepSummary(detail: SensitivityExperimentMetadata | null) {
  if (!detail) {
    return null;
  }
  const sweptKey = detail.parameter.parameterKeys?.[0] ?? detail.parameter.key;
  const unit = CENTRAL_BANK_POLICY_DISPLAY[sweptKey]?.unit ?? null;
  const format = (value: number) =>
    unit ? formatPolicyValue(value, unit) : String(Number(value.toFixed(6)));

  const baselineValues = detail.parameter.baselineValuesByKey
    ? [...new Set(Object.values(detail.parameter.baselineValuesByKey))]
    : detail.parameter.baselineValue !== null && detail.parameter.baselineValue !== undefined
      ? [detail.parameter.baselineValue]
      : [];

  const testedValues = detail.sampledPoints.map((point) => {
    if (point.value !== null) {
      return format(point.value);
    }
    const fromKeys = Object.values(point.valuesByKey ?? {}).find((value) => Number.isFinite(value));
    return fromKeys === undefined ? point.label : format(fromKeys);
  });

  const basePolicyTitle = BASE_POLICY_OPTIONS.find((option) => option.id === detail.basePolicy)?.title ?? null;
  const pointCount = detail.sampledPoints.length;
  const steps = detail.generalOverrides?.N_STEPS;
  const seedCount = detail.seedsPerPoint ?? detail.seeds?.length ?? 1;

  return {
    sentence: `This experiment varies ${detail.parameter.title} across ${pointCount} value${
      pointCount === 1 ? '' : 's'
    }; every other instrument stays at the ${basePolicyTitle ?? 'baseline policy'} value.`,
    instrument: detail.parameter.title,
    basePolicyTitle: basePolicyTitle ?? 'Not recorded',
    baselineValues: baselineValues.length > 0 ? baselineValues.map(format).join(', ') : 'Not recorded',
    testedValues: testedValues.length > 0 ? testedValues.join(', ') : 'Not recorded',
    seedCount,
    seeds: detail.seeds && detail.seeds.length > 0 ? detail.seeds.join(', ') : 'Not recorded',
    modelVersion: formatModelOptionLabel(detail.baseline),
    duration: typeof steps === 'number' ? `${steps.toLocaleString('en-GB')} steps` : 'Not recorded',
    maxWorkers: detail.maxWorkers ?? 1
  };
}

/**
 * A sweep's policy setup: the base policy it ran against, and the settings it varied.
 *
 * A sensitivity run records the base policy id and the swept parameter rather than a full policy
 * snapshot, so the fixed backdrop is read from the same catalogue the run-setup form uses. The
 * result is the eleven Central Bank settings shown for a policy scenario, with the swept ones
 * carrying their tested range instead of a single value.
 */
function describeSweptPolicy(detail: SensitivityExperimentMetadata | null) {
  if (!detail) {
    return null;
  }
  const basePolicy = BASE_POLICY_OPTIONS.find((option) => option.id === detail.basePolicy) ?? null;
  if (!basePolicy) {
    return null;
  }
  const sweptKeys = new Set(
    detail.parameter.parameterKeys && detail.parameter.parameterKeys.length > 0
      ? detail.parameter.parameterKeys
      : [detail.parameter.key]
  );
  const rows = CENTRAL_BANK_POLICY_KEYS.map((key) => {
    const display = CENTRAL_BANK_POLICY_DISPLAY[key];
    const format = (value: number) => (display ? formatPolicyValue(value, display.unit) : String(value));
    const swept = sweptKeys.has(key);
    const baselineValue = detail.parameter.baselineValuesByKey?.[key] ?? detail.parameter.baselineValue;
    return {
      key,
      label: display?.label ?? key,
      swept,
      value: swept
        ? `${format(detail.parameter.min)} → ${format(detail.parameter.max)}`
        : format(basePolicy.values[key]),
      baselineText: swept && baselineValue !== null && baselineValue !== undefined ? format(baselineValue) : null
    };
  });
  return { basePolicy, rows, sweptCount: sweptKeys.size };
}

function isComparableBar(bar: SensitivityExperimentChartsPayload['tornado'][number], kpi: KpiMetricKey): boolean {
  const value = bar.maxAbsDeltaByKpi[kpi];
  return value !== null && Number.isFinite(value);
}

function buildTornadoOption(bars: SensitivityExperimentChartsPayload['tornado'], kpi: KpiMetricKey): EChartsOption {
  return buildSensitivityTornadoOption(bars, kpi);
}

/**
 * Option text for the run selector. The instrument is what actually distinguishes two sweeps of the
 * same baseline, so it rides along with the name rather than being left to the summary below.
 */
function formatExperimentOptionLabel(experiment: SensitivityExperimentSummary): string {
  const name = experiment.title || experiment.experimentId;
  return `${name} — ${experiment.parameter.title}`;
}

export function SensitivityResultsView({
  presentation = 'detailed',
  presentationControls,
  canWrite,
  canDownloadResults,
  canDeleteResults,
  deleteKeyRequired,
  authEnabled,
  requestedExperimentId,
  preferCompletedRun = false,
  queueInitiallyExpanded = false,
  onSelectedExperimentIdChange,
  sidebarSubtitle
}: SensitivityResultsViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [experiments, setExperiments] = useState<SensitivityExperimentSummary[]>([]);
  // The route is the single selection source. A click and a history refresh cannot fight over it.
  const selectedExperimentId = requestedExperimentId
    || (preferCompletedRun ? experiments.find((experiment) => experiment.status === 'succeeded')?.experimentId : '')
    || experiments[0]?.experimentId || '';
  const { selectionRef, requestScrollToTop } = useResultsTopNavigation();
  const [loadedDetail, setDetail] = useState<SensitivityExperimentMetadata | null>(null);
  const [loadedResults, setResults] = useState<SensitivityExperimentResultsPayload | null>(null);
  const [loadedCharts, setCharts] = useState<SensitivityExperimentChartsPayload | null>(null);
  const detail = loadedDetail?.experimentId === selectedExperimentId ? loadedDetail : null;
  const results = loadedResults?.experimentId === selectedExperimentId ? loadedResults : null;
  const charts = loadedCharts?.experimentId === selectedExperimentId ? loadedCharts : null;
  const detailedState = readSensitivityDetailedState(searchParams, charts?.deltaTrend.map((series) => series.indicatorId) ?? []);
  const selectedIndicatorId = detailedState.indicatorId;
  const selectedKpiKey = detailedState.measure;
  const updateControls = (updates: Record<string, string>) => setSearchParams((current) => updateReportQuery(current, updates), { replace: true });
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [isDownloadingExperiment, setIsDownloadingExperiment] = useState<boolean>(false);
  const [previewExperimentId, setPreviewExperimentId] = useState<string>('');
  const [pageError, setPageError] = useState<string>('');
  const [isQueueExpanded, setIsQueueExpanded] = useState<boolean>(queueInitiallyExpanded);
  const removedExperimentIds = useRef(new Set<string>());
  const stopDeletion = useStopAndDeleteExperiment({
    canWrite, canDeleteResults, deleteKeyRequired,
    onDeleted: ({ id }) => {
      removedExperimentIds.current.add(id);
      setExperiments((current) => current.filter((experiment) => experiment.experimentId !== id));
      if (selectedExperimentId === id) {
        setDetail(null);
        setResults(null);
        setCharts(null);
        onSelectedExperimentIdChange('');
      }
    }
  });
  const activeExperiments = useMemo(
    () => {
      const active = experiments.filter((experiment) => experiment.status === 'queued' || experiment.status === 'running' || stopDeletion.pending?.jobRef === `sensitivity:${experiment.experimentId}`);
      return active;
    },
    [experiments, stopDeletion.pending?.jobRef]
  );
  const selectedExperimentStatus = experiments.find((experiment) => experiment.experimentId === selectedExperimentId)?.status;
  const historyExperiments = useMemo(
    () => experiments.filter((experiment) => isFinishedStatus(experiment.status)
      && stopDeletion.pending?.jobRef !== `sensitivity:${experiment.experimentId}`),
    [experiments, stopDeletion.pending?.jobRef]
  );
  const historyPreviewExperiment = historyExperiments.find((experiment) => experiment.experimentId === selectedExperimentId)
    ?? historyExperiments[0] ?? null;
  const previewExperiment = historyExperiments.find((experiment) => experiment.experimentId === previewExperimentId)
    ?? historyPreviewExperiment;
  const historyDeletionItems = useMemo(
    () => historyExperiments.filter((experiment) => !experiment.isExample).map((experiment) => ({
      id: experiment.experimentId,
      label: experiment.title || experiment.experimentId
    })),
    [historyExperiments]
  );

  useEffect(() => {
    // Fill an absent selection once; never write an older local selection over an explicit URL.
    if (!isLoadingHistory && !requestedExperimentId && selectedExperimentId) {
      onSelectedExperimentIdChange(selectedExperimentId);
    }
  }, [isLoadingHistory, onSelectedExperimentIdChange, requestedExperimentId, selectedExperimentId]);

  const refreshHistory = async () => {
    try {
      const payload = await fetchSensitivityExperiments();
      const availableExperiments = payload.experiments.filter((experiment) => !removedExperimentIds.current.has(experiment.experimentId));
      setExperiments(availableExperiments);
    } catch (error) {
      if (!isRetryableApiError(error)) {
        setPageError((error as Error).message);
      }
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const refreshDetail = async (experimentId: string, isCurrent: () => boolean) => {
    if (!experimentId) {
      setDetail(null);
      setResults(null);
      setCharts(null);
      setIsLoadingDetail(false);
      return;
    }

    setIsLoadingDetail(true);
    try {
      const [detailPayload, resultsPayload, chartsPayload] = await Promise.all([
        fetchSensitivityExperiment(experimentId),
        fetchSensitivityExperimentResults(experimentId),
        fetchSensitivityExperimentCharts(experimentId)
      ]);

      if (!isCurrent() || removedExperimentIds.current.has(experimentId)) return;
      setDetail(detailPayload.experiment);
      setResults(resultsPayload);
      setCharts(chartsPayload);
    } catch (error) {
      if (isCurrent() && !removedExperimentIds.current.has(experimentId) && !isRetryableApiError(error)) {
        setPageError((error as Error).message);
      }
    } finally {
      if (isCurrent()) setIsLoadingDetail(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

    const load = async () => {
      await refreshHistory();
    };

    void load().catch((error: unknown) => {
      if (cancelled) {
        return;
      }
      if (isRetryableApiError(error)) {
        retryTimer = window.setTimeout(() => {
          void load();
        }, API_RETRY_DELAY_MS);
        return;
      }
      setPageError((error as Error).message);
    });

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshHistory();
    }, 3000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshDetail(selectedExperimentId, () => !cancelled);
    return () => { cancelled = true; };
  }, [selectedExperimentId, selectedExperimentStatus]);

  const activeDeltaSeries = useMemo(() => {
    if (!charts || !selectedIndicatorId) {
      return null;
    }
    return charts.deltaTrend.find((series) => series.indicatorId === selectedIndicatorId) ?? null;
  }, [charts, selectedIndicatorId]);

  const selectedIndicatorMetricByPoint = useMemo(() => {
    if (!results || !selectedIndicatorId) {
      return [];
    }

    return results.points.map((point) => {
      const metric = point.indicatorMetrics.find((item) => item.indicatorId === selectedIndicatorId) ?? null;
      return { point, metric };
    });
  }, [results, selectedIndicatorId]);

  const selectedIndicatorTitle = useMemo(() => {
    if (!activeDeltaSeries) {
      return '';
    }
    return activeDeltaSeries.title;
  }, [activeDeltaSeries]);

  const selectedExperiment = useMemo(
    () => experiments.find((experiment) => experiment.experimentId === selectedExperimentId) ?? null,
    [experiments, selectedExperimentId]
  );

  const comparableTornadoBars = useMemo(
    () => (charts ? charts.tornado.filter((bar) => isComparableBar(bar, selectedKpiKey)) : []),
    [charts, selectedKpiKey]
  );

  const incomparableTornadoTitles = useMemo(
    () => (charts ? charts.tornado.filter((bar) => !isComparableBar(bar, selectedKpiKey)).map((bar) => bar.title) : []),
    [charts, selectedKpiKey]
  );

  const downloadSelectedExperiment = async () => {
    if (!selectedExperimentId || !canDownloadResults) {
      return;
    }

    setPageError('');
    setIsDownloadingExperiment(true);
    try {
      await downloadSensitivityExperiment(selectedExperimentId);
    } catch (error) {
      setPageError((error as Error).message);
    } finally {
      setIsDownloadingExperiment(false);
    }
  };

  const historyDeletion = useRunHistoryDeletion({
    items: historyDeletionItems,
    canDelete: canDeleteResults,
    deleteKeyRequired,
    deleteItem: deleteSensitivityExperiment,
    onDeleted: async (ids) => {
      const deletedIds = new Set(ids);
      for (const id of ids) removedExperimentIds.current.add(id);
      setExperiments((current) => current.filter((experiment) => !deletedIds.has(experiment.experimentId)));
      setPreviewExperimentId((current) => deletedIds.has(current) ? '' : current);
      if (deletedIds.has(selectedExperimentId)) {
        onSelectedExperimentIdChange('');
        setDetail(null);
        setResults(null);
        setCharts(null);
      }
      await refreshHistory();
    }
  });

  const sweptPolicy = useMemo(() => describeSweptPolicy(detail), [detail]);
  const sweepSummary = useMemo(() => describeSweepSummary(detail), [detail]);

  const selectExperiment = (experimentId: string) => {
    setPageError('');
    onSelectedExperimentIdChange(experimentId);
  };

  const viewRunResults = (experimentId: string) => {
    if (experimentId !== selectedExperimentId) selectExperiment(experimentId);
    requestScrollToTop();
  };

  const loginPath = `/login?next=${encodeURIComponent(
    buildExperimentsPath({
      ...DEFAULT_EXPERIMENT_ROUTE_STATE,
      type: 'sensitivity',
      mode: 'view',
      experimentId: selectedExperimentId
    })
  )}`;

  const runPicker = (
    <div className="comparison-run-pickers results-run-pickers">
      <label>
        <span>Select run to view</span>
        <select
          ref={selectionRef}
          value={selectedExperimentId}
          disabled={isLoadingHistory || experiments.length === 0}
          onChange={(event) => selectExperiment(event.target.value)}
        >
          {experiments.length === 0 && <option value="">No sensitivity analyses yet</option>}
          {selectedExperimentId && !experiments.some((experiment) => experiment.experimentId === selectedExperimentId) && (
            <option value={selectedExperimentId}>{detail?.title || selectedExperimentId}</option>
          )}
          {experiments.map((experiment) => (
            <option key={experiment.experimentId} value={experiment.experimentId}>
              {formatExperimentOptionLabel(experiment)}
            </option>
          ))}
        </select>
        {!presentationControls && selectedExperiment && (
          <span className="run-preview-meta">
            <span className={statusClass(selectedExperiment.status)}>{formatStatus(selectedExperiment.status)}</span>
          </span>
        )}
      </label>
    </div>
  );

  return (
    <section
      className={`results-layout${presentation === 'report' ? ' sensitivity-results-report' : ''}${presentationControls ? ' sensitivity-presented-layout' : ''}`}
      aria-labelledby={presentationControls ? 'sensitivity-results-title' : undefined}
    >
      {presentationControls && (
        <SensitivityResultsHeader
          title={detail?.title || selectedExperiment?.title || selectedExperimentId || 'Select a sensitivity analysis'}
          presentation={presentation}
          runPicker={runPicker}
          presentationControls={presentationControls}
        />
      )}
      {pageError && <p className="error-banner">{pageError}</p>}
      <ResultsQueue
        items={activeExperiments.map(sensitivityResultsQueueItem)}
        expanded={isQueueExpanded} onExpandedChange={setIsQueueExpanded}
        canCancel={canWrite && canDeleteResults} stopDeletion={stopDeletion}
      />

      <article className="results-card sensitivity-summary-card">
        <div className="results-card-head sensitivity-summary-actions">
          {detail && (
            !canDownloadResults ? (
              authEnabled ? (
                <Link className="summary-link-inline" to={loginPath}>
                  Login to Export Summary
                </Link>
              ) : (
                <button type="button" className="summary-link-inline summary-button-inline" disabled>
                  Summary Export Unavailable
                </button>
              )
            ) : (
              <button
                type="button"
                className="summary-link-inline summary-button-inline"
                title="Export the aggregated experiment summary, metadata, and reproducibility manifest as a compressed archive."
                disabled={isDownloadingExperiment}
                onClick={() => void downloadSelectedExperiment()}
              >
                {isDownloadingExperiment ? 'Exporting...' : 'Export experiment summary'}
              </button>
            )
          )}
        </div>

        {!presentationControls && runPicker}
        {presentationControls && selectedExperiment && (
          <p className="run-preview-meta sensitivity-selection-status">
            <span className={statusClass(selectedExperiment.status)}>{formatStatus(selectedExperiment.status)}</span>
          </p>
        )}

        {isLoadingHistory ? (
          <p className="loading-banner">Loading experiments...</p>
        ) : experiments.length === 0 ? (
          <p className="info-banner">
            No sensitivity analyses yet. <Link to="/sensitivity/new">Create one to begin.</Link>
          </p>
        ) : isLoadingDetail || (selectedExperimentId && !detail && !pageError) ? (
          <p className="loading-banner">Loading experiment detail...</p>
        ) : !detail ? (
          <p className="info-banner">Select a sensitivity analysis to view its results.</p>
        ) : (
          <>
            {sweepSummary && presentation === 'detailed' && (
              <section className="run-policy-details sensitivity-run-summary-details">
                <div className="run-policy-details-head">
                  <h3>Summary</h3>
                  <p className="run-policy-details-summary">{sweepSummary.instrument}</p>
                </div>
                <p className="sensitivity-sweep-sentence">{sweepSummary.sentence}</p>
                <dl className="sensitivity-summary-facts">
                  <div>
                    <dt>Instrument varied</dt>
                    <dd>{sweepSummary.instrument}</dd>
                  </div>
                  <div>
                    <dt>Baseline policy</dt>
                    <dd>{sweepSummary.basePolicyTitle}</dd>
                  </div>
                  <div>
                    <dt>Baseline policy values</dt>
                    <dd>{sweepSummary.baselineValues}</dd>
                  </div>
                  <div>
                    <dt>Values tested</dt>
                    <dd>{sweepSummary.testedValues}</dd>
                  </div>
                  <div>
                    <dt>Monte Carlo runs per point</dt>
                    <dd>{sweepSummary.seedCount}</dd>
                  </div>
                  <div>
                    <dt>Seeds per sampled point</dt>
                    <dd>{sweepSummary.seeds}</dd>
                  </div>
                  <div>
                    <dt>Model version</dt>
                    <dd>{sweepSummary.modelVersion}</dd>
                  </div>
                  <div>
                    <dt>Simulation duration</dt>
                    <dd>{sweepSummary.duration}</dd>
                  </div>
                  <div>
                    <dt>Workers parallelised across</dt>
                    <dd>{sweepSummary.maxWorkers}</dd>
                  </div>
                </dl>
              </section>
            )}
            {detail.failureReason && <p className="error-banner">Failure reason: {detail.failureReason}</p>}

            {sweptPolicy && presentation === 'detailed' && (
              <CollapsibleSection
                title="Policy settings used"
                summary={`${CENTRAL_BANK_POLICY_KEYS.length} Central Bank settings · ${sweptPolicy.sweptCount} varied`}
                defaultOpen={false}
                className="run-policy-disclosure sensitivity-policy-disclosure"
              >
                <div className="policy-settings-table-wrap">
                  <table className="policy-settings-table">
                    <thead>
                      <tr>
                        <th>Setting</th>
                        <th>Value in this analysis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sweptPolicy.rows.map((row) => (
                        <tr key={row.key} className={row.swept ? 'policy-settings-row-changed' : undefined}>
                          <th scope="row" title={row.key}>
                            {row.label}
                            {row.swept && <span className="policy-settings-changed-chip">varied</span>}
                          </th>
                          <td>
                            {row.value}
                            {row.baselineText && (
                              <small className="policy-settings-baseline-note">
                                baseline {row.baselineText}
                              </small>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CollapsibleSection>
            )}
          </>
        )}
      </article>

      <div className="results-main">
        {presentation === 'report' && detail && results && !isLoadingDetail && (
          <SensitivityReportView detail={detail} results={results} windowType={charts?.windowType ?? null} />
        )}
        {presentation === 'detailed' && (charts || results) && (
          <CollapsibleSection
            id="sensitivity-tested-values"
            className="results-card sensitivity-response-card sensitivity-tested-values-card"
            title="Outcome responses and results by tested value"
            description="See which indicators respond most, how the selected outcome moves, and the values behind that response."
            summary={selectedIndicatorTitle}
            open={detailedState.resultsOpen}
            onOpenChange={(open) => updateControls({ sensitivityResults: open ? 'open' : 'closed' })}
          >
            <aside
              className="info-banner sensitivity-interpretation-callout"
              role="note"
              aria-labelledby="sensitivity-interpretation-heading"
            >
              <h3 id="sensitivity-interpretation-heading">How to interpret and use these results</h3>
              <p>
                Sensitivity analysis varies a policy setting or linked package while holding the other settings fixed.
                Choose Mean for the typical monthly level, Volatility for relative temporal variation, or Dispersion
                for the gap between the 95th and 5th temporal percentiles. Each measure is calculated within each seed,
                then averaged across successful seeds with available values. Volatility and Dispersion are not uncertainty across seeds.
              </p>
              <p>Analysis window: {getReportWindowLabel(charts?.windowType ?? null)}. This selects valid observations, not model months.</p>
              <ol>
                <li>
                  <strong>Find the strongest responses.</strong> Use Largest outcome responses to identify which
                  outcomes changed most. Bars show size, not direction.
                </li>
                <li>
                  <strong>Check the direction.</strong> Response across policy values shows percentage differences.
                  For a positive baseline, positive means higher and negative means lower; a negative baseline reverses
                  that interpretation. Compare raw values to establish direction.
                </li>
                <li>
                  <strong>Verify the values.</strong> Use Results by tested value for the exact raw measures and signed
                  percentage differences. A succeeded point may still have pending seeds; use Report to check actual
                  coverage after the experiment finishes. n/a means unavailable, not zero.
                </li>
              </ol>
            </aside>
            {charts && (
              <>
                <div className="sensitivity-trend-header">
                  <div>
                    <h3>Largest outcome responses</h3>
                    <p>
                      Ranks indicators by their largest absolute percentage difference from the baseline policy
                      anywhere in the tested range. Direction is shown in the response chart below.
                    </p>
                  </div>
                  <label>
                    Outcome measure
                    <select
                      aria-label="Outcome measure"
                      value={selectedKpiKey}
                      onChange={(event) => updateControls({ measure: event.target.value })}
                    >
                      {KPI_OPTIONS.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {comparableTornadoBars.length === 0 ? (
                  <p className="info-banner">
                    No indicator has an available percentage comparison with the baseline on this measure.
                    Missing results or a baseline near zero can prevent comparison; check raw values below.
                  </p>
                ) : (
                  <EChart
                    className="validation-chart sensitivity-tornado-chart"
                    style={{ height: `${Math.max(420, comparableTornadoBars.length * 34 + 96)}px` }}
                    option={buildTornadoOption(comparableTornadoBars, selectedKpiKey)}
                  />
                )}

                {incomparableTornadoTitles.length > 0 && (
                  <p className="info-banner">
                    Not ranked ({incomparableTornadoTitles.length}): {incomparableTornadoTitles.join(', ')}.
                    Percentage comparisons are unavailable, for example because the baseline is near zero or data
                    is missing. Compare the raw values in the table below where available.
                  </p>
                )}

                <div className="sensitivity-trend-header">
                  <div>
                    <h3>Response across policy values</h3>
                    <p>
                      Shows the direction and size of the selected outcome&apos;s difference from the baseline policy.
                    </p>
                  </div>
                  <label>
                    Indicator
                    <select
                      aria-label="Indicator"
                      value={selectedIndicatorId}
                      onChange={(event) => updateControls({ indicator: event.target.value })}
                    >
                      {charts.deltaTrend.map((series) => (
                        <option key={series.indicatorId} value={series.indicatorId}>
                          {series.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {activeDeltaSeries ? (
                  <EChart
                    className="validation-chart"
                    option={buildDeltaTrendOption(activeDeltaSeries, charts.parameter.title, selectedKpiKey, reportPolicyUnit(charts.parameter))}
                  />
                ) : (
                  <p className="info-banner">No trend data available.</p>
                )}
              </>
            )}

            {results && (
              <section
                className="sensitivity-tested-values-section"
                aria-labelledby="sensitivity-tested-values-heading"
              >
                <div className="sensitivity-trend-header">
                  <div>
                    <h3 id="sensitivity-tested-values-heading">Results by tested value</h3>
                    <p>{selectedIndicatorTitle}</p>
                  </div>
                </div>
                {selectedIndicatorMetricByPoint.length === 0 ? (
                  <p className="info-banner">No executed points yet.</p>
                ) : (
                  <div className="sensitivity-table-wrap" role="region" aria-label="Results by tested value table" tabIndex={0}>
                    <table className="sensitivity-point-table">
                      <thead>
                        <tr>
                          <th>Point</th>
                          <th>Value</th>
                          <th>Status</th>
                          {SELECTABLE_KPI_KEYS.map((key) => (
                            <Fragment key={key}>
                              <th title={KPI_LABELS[key].label}>
                                {KPI_LABELS[key].short}
                                {key === 'cv' ? ' (dimensionless)' : activeDeltaSeries?.units
                                  ? ` (${key === 'range' && activeDeltaSeries.units === '%' ? 'percentage points' : activeDeltaSeries.units})`
                                  : ''}
                              </th>
                              <th title={`Percentage difference from the baseline policy — ${KPI_LABELS[key].label}`}>
                                % diff {KPI_LABELS[key].short}
                              </th>
                            </Fragment>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedIndicatorMetricByPoint.map(({ point, metric }) => {
                          const values = metric as SensitivityIndicatorPointMetric | null;
                          return (
                            <tr key={point.pointId}>
                              <td>{point.label}</td>
                              <td>{detail ? formatReportSetting(point, detail.parameter) : point.label}</td>
                              <td>
                                <span className={statusClass(point.status)}>{formatStatus(point.status)}</span>
                              </td>
                              {SELECTABLE_KPI_KEYS.map((key) => (
                                <Fragment key={key}>
                                  <td>{formatMetric(values?.kpi[key] ?? null)}</td>
                                  <td>{formatSignedPercent(values?.deltaFromBaseline[key] ?? null)}</td>
                                </Fragment>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </CollapsibleSection>
        )}
      </div>

      <CollapsibleSection
        className="results-card run-history-card sensitivity-run-history-card"
        title="Run History"
        description={sidebarSubtitle}
        summary={`${historyExperiments.length} finished ${historyExperiments.length === 1 ? 'run' : 'runs'}`}
        defaultOpen={false}
      >
        {isLoadingHistory ? (
          <p className="loading-banner">Loading experiments...</p>
        ) : historyPreviewExperiment ? (
          <button
            type="button"
            className={`run-preview-card ${historyPreviewExperiment.experimentId === selectedExperimentId ? 'is-active' : ''}`}
            onClick={() => viewRunResults(historyPreviewExperiment.experimentId)}
          >
            <span className="run-preview-title">{historyPreviewExperiment.title || historyPreviewExperiment.experimentId}</span>
            <span className="run-preview-meta">
              <span className={statusClass(historyPreviewExperiment.status)}>{formatStatus(historyPreviewExperiment.status)}</span>
              <span className="run-preview-action">View results</span>
            </span>
          </button>
        ) : (
          <p className="info-banner">No finished sensitivity runs yet. Active runs appear in the queue.</p>
        )}
        <div className="disclosure-expanded-list">
          {canDeleteResults && historyExperiments.length > 0 && <RunHistorySelectionToolbar selection={historyDeletion} />}
          {historyDeletion.error && <p className="error-banner" role="alert">{historyDeletion.error}</p>}
          {historyExperiments.length > 0 && (
            <div className="run-history-split" onMouseLeave={() => setPreviewExperimentId('')}>
              <ul className="run-list">
                {historyExperiments.map((experiment) => {
                  const isSelected = selectedExperimentId === experiment.experimentId;
                  const label = experiment.title || experiment.experimentId;
                  return (
                    <li
                      key={experiment.experimentId}
                      className={[
                        'run-item',
                        isSelected ? 'selected-baseline' : '',
                        previewExperimentId === experiment.experimentId ? 'is-previewed' : ''
                      ].filter(Boolean).join(' ')}
                      onMouseEnter={() => setPreviewExperimentId(experiment.experimentId)}
                      onFocus={() => setPreviewExperimentId(experiment.experimentId)}
                    >
                      <div className="run-item-head">
                        {canDeleteResults && (
                          <RunHistoryCheckbox
                            label={label}
                            checked={historyDeletion.selectedIds.has(experiment.experimentId)}
                            disabled={historyDeletion.isDeleting || Boolean(experiment.isExample)}
                            disabledReason={experiment.isExample ? 'Bundled example runs cannot be deleted.' : undefined}
                            onChange={(checked) => historyDeletion.toggle(experiment.experimentId, checked)}
                          />
                        )}
                        <div className="run-item-name"><strong>{label}</strong></div>
                        {isSelected && <div className="run-role-chips"><span className="run-role-chip">Viewing</span></div>}
                      </div>
                      <div className="manual-run-action-row">
                        <button
                          type="button"
                          className={`run-select-btn ${isSelected ? 'active' : ''}`}
                          onClick={() => viewRunResults(experiment.experimentId)}
                        >
                          View results
                        </button>
                      </div>
                      <div className="run-meta">
                        <span className={statusClass(experiment.status)}>{formatStatus(experiment.status)}</span>
                        {experiment.isExample && <span>Example</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {previewExperiment && (
                <div className="run-history-preview" aria-live="polite">
                  <p className="run-history-preview-eyebrow">
                    {previewExperimentId === previewExperiment.experimentId ? 'Previewed run'
                      : previewExperiment.experimentId === selectedExperimentId ? 'Selected run' : 'Latest finished run'}
                  </p>
                  <h4>{previewExperiment.title || previewExperiment.experimentId}</h4>
                  <p className="run-item-id"><strong>Run ID:</strong> {previewExperiment.experimentId}</p>
                  <div className="run-meta">
                    <span className={statusClass(previewExperiment.status)}>{formatStatus(previewExperiment.status)}</span>
                    {previewExperiment.isExample && <span>Example</span>}
                  </div>
                  <div className="run-item-policy">
                    <p className="run-item-policy-head">Sensitivity setup</p>
                    <dl className="run-item-policy-list">
                      <div><dt>Instrument</dt><dd>{previewExperiment.parameter.title}</dd></div>
                      <div><dt>Baseline policy</dt><dd>{formatBasePolicyLabel(previewExperiment.basePolicy)}</dd></div>
                      <div><dt>Model</dt><dd>{formatModelOptionLabel(previewExperiment.baseline)}</dd></div>
                      <div><dt>Created</dt><dd>{formatQueueTimestamp(previewExperiment.createdAt)}</dd></div>
                      {previewExperiment.endedAt && (
                        <div><dt>Finished</dt><dd>{formatQueueTimestamp(previewExperiment.endedAt)}</dd></div>
                      )}
                      <div><dt>Requested sample points</dt><dd>{previewExperiment.parameter.sampleCount}</dd></div>
                      {(previewExperiment.seedsPerPoint ?? previewExperiment.seeds?.length) !== undefined && (
                        <div><dt>Seeds per point</dt><dd>{previewExperiment.seedsPerPoint ?? previewExperiment.seeds?.length}</dd></div>
                      )}
                    </dl>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </CollapsibleSection>
    </section>
  );
}
