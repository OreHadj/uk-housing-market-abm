import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  KpiMetricKey,
  SensitivityExperimentChartsPayload,
  SensitivityExperimentMetadata,
  SensitivityExperimentResultsPayload,
  SensitivityExperimentSummary,
  SensitivityIndicatorPointMetric
} from '../../../../shared/types';
import type { EChartsOption } from 'echarts';
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
import { buildDeltaTrendOption } from '../../../lib/sensitivityChartOptions';
import { buildExperimentsPath } from '../routeState';
import { DEFAULT_EXPERIMENT_ROUTE_STATE } from '../types';

const KPI_OPTIONS = SELECTABLE_KPI_KEYS.map((key) => ({ key, ...KPI_LABELS[key] }));

interface SensitivityResultsViewProps {
  canWrite: boolean;
  canDownloadResults: boolean;
  canDeleteResults: boolean;
  deleteKeyRequired: boolean;
  authEnabled: boolean;
  requestedExperimentId: string;
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

function formatPointValue(value: number | null, valuesByKey?: Record<string, number>): string {
  if (value !== null) {
    return formatMetric(value);
  }
  const values = Object.values(valuesByKey ?? {}).filter((item) => Number.isFinite(item));
  if (values.length === 0) {
    return 'baseline policy values';
  }
  return `baseline policy values (${values.map((item) => formatMetric(item)).join(', ')})`;
}

function isComparableBar(bar: SensitivityExperimentChartsPayload['tornado'][number], kpi: KpiMetricKey): boolean {
  const value = bar.maxAbsDeltaByKpi[kpi];
  return value !== null && Number.isFinite(value);
}

function buildTornadoOption(bars: SensitivityExperimentChartsPayload['tornado'], kpi: KpiMetricKey): EChartsOption {
  const sorted = [...bars].sort((left, right) => {
    const leftValue = left.maxAbsDeltaByKpi[kpi] ?? Number.NEGATIVE_INFINITY;
    const rightValue = right.maxAbsDeltaByKpi[kpi] ?? Number.NEGATIVE_INFINITY;
    return rightValue - leftValue;
  });

  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: unknown) => {
        if (typeof value !== 'number' || Number.isNaN(value)) {
          return 'n/a';
        }
        return `${value.toLocaleString('en-GB', { maximumFractionDigits: 6 })}%`;
      }
    },
    grid: {
      left: 80,
      right: 24,
      top: 20,
      bottom: 160
    },
    xAxis: {
      type: 'category',
      axisLabel: {
        interval: 0,
        rotate: 45
      },
      data: sorted.map((item) => item.title)
    },
    yAxis: {
      type: 'value',
      name: `Max |% diff ${KPI_LABELS[kpi]?.short ?? kpi}|`,
      nameGap: 42,
      nameLocation: 'middle'
    },
    series: [
      {
        type: 'bar',
        data: sorted.map((item) => item.maxAbsDeltaByKpi[kpi]),
        itemStyle: {
          color: '#0b7285'
        }
      }
    ]
  };
}

export function SensitivityResultsView({
  canDownloadResults,
  canDeleteResults,
  deleteKeyRequired,
  authEnabled,
  requestedExperimentId,
  onSelectedExperimentIdChange,
  sidebarSubtitle
}: SensitivityResultsViewProps) {
  const [experiments, setExperiments] = useState<SensitivityExperimentSummary[]>([]);
  const [selectedExperimentId, setSelectedExperimentId] = useState<string>('');
  const [detail, setDetail] = useState<SensitivityExperimentMetadata | null>(null);
  const [results, setResults] = useState<SensitivityExperimentResultsPayload | null>(null);
  const [charts, setCharts] = useState<SensitivityExperimentChartsPayload | null>(null);
  const [selectedIndicatorId, setSelectedIndicatorId] = useState<string>('');
  const [selectedKpiKey, setSelectedKpiKey] = useState<KpiMetricKey>('mean');
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [isDownloadingExperiment, setIsDownloadingExperiment] = useState<boolean>(false);
  const [isDeletingExperimentId, setIsDeletingExperimentId] = useState<string>('');
  const [isRunPickerOpen, setIsRunPickerOpen] = useState<boolean>(false);
  const [pageError, setPageError] = useState<string>('');

  useEffect(() => {
    if (!isRunPickerOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsRunPickerOpen(false);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isRunPickerOpen]);

  useEffect(() => {
    // Wait for the experiment list to load before syncing the selection back to the URL. On mount
    // selectedExperimentId is '' while a requested experimentId may be present in the URL; writing
    // that empty selection back would strip experimentId out of the URL and bounce the user out of
    // the results view before the experiment list has loaded (the "View results" button appears to
    // do nothing). Once history has loaded, the effect below resolves the requested id.
    if (isLoadingHistory) {
      return;
    }
    if (requestedExperimentId === selectedExperimentId) {
      return;
    }
    onSelectedExperimentIdChange(selectedExperimentId);
  }, [isLoadingHistory, onSelectedExperimentIdChange, requestedExperimentId, selectedExperimentId]);

  const refreshHistory = async () => {
    try {
      const payload = await fetchSensitivityExperiments();
      setExperiments(payload.experiments);
      setSelectedExperimentId((current) => {
        if (current && payload.experiments.some((item) => item.experimentId === current)) {
          return current;
        }
        return payload.experiments[0]?.experimentId ?? '';
      });
    } catch (error) {
      if (!isRetryableApiError(error)) {
        setPageError((error as Error).message);
      }
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const refreshDetail = async (experimentId: string) => {
    if (!experimentId) {
      setDetail(null);
      setResults(null);
      setCharts(null);
      return;
    }

    setIsLoadingDetail(true);
    try {
      const [detailPayload, resultsPayload, chartsPayload] = await Promise.all([
        fetchSensitivityExperiment(experimentId),
        fetchSensitivityExperimentResults(experimentId),
        fetchSensitivityExperimentCharts(experimentId)
      ]);

      setDetail(detailPayload.experiment);
      setResults(resultsPayload);
      setCharts(chartsPayload);
      setSelectedIndicatorId((current) => {
        if (current && chartsPayload.deltaTrend.some((series) => series.indicatorId === current)) {
          return current;
        }
        return chartsPayload.deltaTrend[0]?.indicatorId ?? '';
      });
    } catch (error) {
      if (!isRetryableApiError(error)) {
        setPageError((error as Error).message);
      }
    } finally {
      setIsLoadingDetail(false);
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
    if (!requestedExperimentId || experiments.length === 0) {
      return;
    }

    if (!experiments.some((experiment) => experiment.experimentId === requestedExperimentId)) {
      return;
    }

    setSelectedExperimentId(requestedExperimentId);
  }, [experiments, requestedExperimentId]);

  useEffect(() => {
    void refreshDetail(selectedExperimentId);
  }, [selectedExperimentId]);

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

  const deleteExperiment = async (experimentId: string) => {
    if (!canDeleteResults) {
      return;
    }

    const confirmed = window.confirm(
      `Delete policy sensitivity experiment "${experimentId}"? This permanently removes its Results folder.`
    );
    if (!confirmed) {
      return;
    }

    const deleteKey = deleteKeyRequired ? window.prompt('Enter the private delete key to delete remote experiment results.') : undefined;
    if (deleteKeyRequired && !deleteKey) {
      return;
    }

    setPageError('');
    setIsDeletingExperimentId(experimentId);
    try {
      await deleteSensitivityExperiment(experimentId, deleteKey ?? undefined);
      if (selectedExperimentId === experimentId) {
        setSelectedExperimentId('');
        setDetail(null);
        setResults(null);
        setCharts(null);
      }
      await refreshHistory();
    } catch (error) {
      setPageError((error as Error).message);
    } finally {
      setIsDeletingExperimentId('');
    }
  };

  const loginPath = `/login?next=${encodeURIComponent(
    buildExperimentsPath({
      ...DEFAULT_EXPERIMENT_ROUTE_STATE,
      type: 'sensitivity',
      mode: 'view',
      experimentId: selectedExperimentId
    })
  )}`;

  return (
    <section className="results-layout">
      {pageError && <p className="error-banner">{pageError}</p>}

      <article className="results-card">
        <h2>Sensitivity analysis</h2>
        <p>
          See how housing, mortgage, and rental outcomes respond as one policy instrument changes. Each tested value
          is compared with the selected baseline policy.
        </p>
        <div className="summary-links">
          <Link
            className="summary-link-inline"
            to={buildExperimentsPath({
              ...DEFAULT_EXPERIMENT_ROUTE_STATE,
              type: 'manual',
              mode: 'view'
            })}
          >
            Open Scenarios
          </Link>
          <Link
            className="summary-link-inline"
            to="/sensitivity/new"
          >
            New sensitivity analysis
          </Link>
        </div>
      </article>

      <article className="results-card run-history-card sensitivity-run-history-card">
        <div className="disclosure-preview-head">
          <div className="disclosure-preview-title">
            <h3>Run History</h3>
            <p>{experiments.length} sensitivity {experiments.length === 1 ? 'run' : 'runs'}</p>
          </div>
          <button
            type="button"
            className="disclosure-preview-toggle"
            disabled={isLoadingHistory || experiments.length === 0}
            aria-haspopup="dialog"
            aria-expanded={isRunPickerOpen}
            onClick={() => setIsRunPickerOpen(true)}
          >
            Select run
          </button>
        </div>

        {isLoadingHistory ? (
          <p className="loading-banner">Loading experiments...</p>
        ) : selectedExperiment ? (
          <button
            type="button"
            className="run-preview-card is-active"
            aria-haspopup="dialog"
            onClick={() => setIsRunPickerOpen(true)}
          >
            <span className="run-preview-title">{selectedExperiment.title || selectedExperiment.experimentId}</span>
            <span className="run-preview-meta">
              <span className={statusClass(selectedExperiment.status)}>{formatStatus(selectedExperiment.status)}</span>
              <span>{selectedExperiment.parameter.title}</span>
              <span className="run-preview-action">Change run</span>
            </span>
          </button>
        ) : (
          <p className="info-banner">No sensitivity analyses yet. Create one to begin.</p>
        )}
      </article>

      <div
        hidden={!isRunPickerOpen}
        className="scenario-create-modal-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setIsRunPickerOpen(false);
          }
        }}
      >
        <section
          className="scenario-create-modal sensitivity-run-picker-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sensitivity-run-picker-title"
        >
          <div className="scenario-create-modal-head">
            <div>
              <p className="trend-modal-eyebrow">Run history</p>
              <h2 id="sensitivity-run-picker-title">Select a sensitivity run</h2>
              <p>Choose one analysis to inspect. Sensitivity runs are viewed individually, not compared.</p>
            </div>
            <button
              type="button"
              className="trend-modal-close"
              aria-label="Close sensitivity run selection"
              onClick={() => setIsRunPickerOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="scenario-create-modal-body">
            <p className="sensitivity-run-picker-subtitle">{sidebarSubtitle}</p>
            {experiments.length === 0 ? (
              <p className="info-banner">No sensitivity analyses yet.</p>
            ) : (
              <ul className="run-list sensitivity-run-picker-list">
                {experiments.map((experiment) => {
                  const isSelected = selectedExperimentId === experiment.experimentId;
                  const canDeleteExperiment = isFinishedStatus(experiment.status);
                  return (
                    <li
                      key={experiment.experimentId}
                      className={`run-item ${isSelected ? 'focused' : ''}`}
                    >
                      <div className="run-item-head">
                        <strong>{experiment.title || experiment.experimentId}</strong>
                        {isSelected && <span className="run-role-chip">Selected</span>}
                      </div>
                      <p>Instrument: {experiment.parameter.title}</p>
                      <p>Baseline policy: {formatBasePolicyLabel(experiment.basePolicy)}</p>
                      <p>
                        <span className={statusClass(experiment.status)}>{formatStatus(experiment.status)}</span>
                      </p>
                      <div className="manual-run-action-row">
                        <button
                          type="button"
                          className={`run-select-btn ${isSelected ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedExperimentId(experiment.experimentId);
                            setIsRunPickerOpen(false);
                          }}
                        >
                          {isSelected ? 'Viewing this run' : 'View run'}
                        </button>
                        {canDeleteResults && (
                          <button
                            type="button"
                            className="danger-button"
                            disabled={isDeletingExperimentId === experiment.experimentId || !canDeleteExperiment}
                            onClick={() => void deleteExperiment(experiment.experimentId)}
                            title={!canDeleteExperiment ? 'Cancel or wait for this experiment to finish before deleting.' : undefined}
                          >
                            {isDeletingExperimentId === experiment.experimentId ? 'Deleting...' : 'Delete'}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      <div className="results-main">
          <article className="results-card">
            <div className="results-card-head">
              <h3>Analysis details</h3>
              {detail && (
                !canDownloadResults ? (
                  authEnabled ? (
                    <Link className="summary-link-inline" to={loginPath}>
                      Login to Download
                    </Link>
                  ) : (
                    <button type="button" className="summary-link-inline summary-button-inline" disabled>
                      Download Unavailable
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    className="summary-link-inline summary-button-inline"
                    disabled={isDownloadingExperiment}
                    onClick={() => void downloadSelectedExperiment()}
                  >
                    {isDownloadingExperiment ? 'Downloading...' : 'Download Results'}
                  </button>
                )
              )}
            </div>
            {isLoadingDetail ? (
              <p className="loading-banner">Loading experiment detail...</p>
            ) : !detail ? (
              <p className="info-banner">Select a sensitivity analysis to view its results.</p>
            ) : (
              <div className="sensitivity-detail-grid">
                <p>
                  <strong>Experiment:</strong> {detail.title || detail.experimentId}
                </p>
                <p>
                  <strong>Status:</strong> <span className={statusClass(detail.status)}>{formatStatus(detail.status)}</span>
                </p>
                <p>
                  <strong>Calibration vintage:</strong> {detail.baseline}
                </p>
                <p>
                  <strong>Baseline policy:</strong> {formatBasePolicyLabel(detail.basePolicy)}
                </p>
                <p>
                  <strong>Instrument:</strong> {detail.parameter.title}
                </p>
                <p>
                  <strong>Instrument description:</strong> {detail.parameter.description}
                </p>
                <p>
                  <strong>Range:</strong> {detail.parameter.min} to {detail.parameter.max}
                </p>
                <p>
                  <strong>Seeds:</strong> {detail.seeds?.join(', ') || detail.seedsPerPoint || 1}
                </p>
                <p>
                  <strong>Max workers:</strong> {detail.maxWorkers ?? 1}
                </p>
                {detail.failureReason && <p className="error-banner">Failure reason: {detail.failureReason}</p>}
              </div>
            )}
          </article>

          {charts && (
            <article className="results-card">
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
                    value={selectedKpiKey}
                    onChange={(event) => setSelectedKpiKey(event.target.value as KpiMetricKey)}
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
                  No indicator can be compared with the baseline policy on this measure. The baseline policy values
                  sit too close to zero for a percentage difference to be meaningful.
                </p>
              ) : (
                <EChart className="validation-chart" option={buildTornadoOption(comparableTornadoBars, selectedKpiKey)} />
              )}

              {incomparableTornadoTitles.length > 0 && (
                <p className="info-banner">
                  Not ranked ({incomparableTornadoTitles.length}): {incomparableTornadoTitles.join(', ')}. The
                  baseline policy value for these sits near zero relative to their own variation, so a percentage
                  difference would be dominated by the denominator rather than by the policy. Compare them on the raw
                  values in the table below instead.
                </p>
              )}

              <div className="sensitivity-trend-header">
                <div>
                  <h4>Response across policy values</h4>
                  <p>Shows the direction and size of the selected outcome&apos;s difference from the baseline policy.</p>
                </div>
                <label>
                  Indicator
                  <select
                    value={selectedIndicatorId}
                    onChange={(event) => setSelectedIndicatorId(event.target.value)}
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
                  option={buildDeltaTrendOption(activeDeltaSeries, charts.parameter.title, selectedKpiKey)}
                />
              ) : (
                <p className="info-banner">No trend data available.</p>
              )}
            </article>
          )}

          {results && (
            <article className="results-card">
              <h3>Results by tested value {selectedIndicatorTitle ? `(${selectedIndicatorTitle})` : ''}</h3>
              {selectedIndicatorMetricByPoint.length === 0 ? (
                <p className="info-banner">No executed points yet.</p>
              ) : (
                <div className="sensitivity-table-wrap">
                  <table className="sensitivity-point-table">
                    <thead>
                      <tr>
                        <th>Point</th>
                        <th>Value</th>
                        <th>Status</th>
                        {SELECTABLE_KPI_KEYS.map((key) => (
                          <Fragment key={key}>
                            <th title={KPI_LABELS[key].label}>{KPI_LABELS[key].short}</th>
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
                            <td>{formatPointValue(point.value, point.valuesByKey)}</td>
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
            </article>
          )}
      </div>
    </section>
  );
}
