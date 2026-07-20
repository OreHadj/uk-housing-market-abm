import { useEffect, useMemo, useState } from 'react';
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
import { buildDeltaTrendOption } from '../../../lib/sensitivityChartOptions';
import { buildExperimentsPath } from '../routeState';
import { DEFAULT_EXPERIMENT_ROUTE_STATE } from '../types';

const KPI_OPTIONS: Array<{ key: KpiMetricKey; label: string }> = [
  { key: 'mean', label: 'Mean (monthly)' },
  { key: 'cv', label: 'CV (monthly)' },
  { key: 'range', label: 'Range (monthly, P95-P5)' }
];

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
  return basePolicy ? `${basePolicy} base policy` : 'Not recorded';
}

function formatPointValue(value: number | null, valuesByKey?: Record<string, number>): string {
  if (value !== null) {
    return formatMetric(value);
  }
  const values = Object.values(valuesByKey ?? {}).filter((item) => Number.isFinite(item));
  if (values.length === 0) {
    return 'base policy values';
  }
  return `base policy values (${values.map((item) => formatMetric(item)).join(', ')})`;
}

function buildTornadoOption(charts: SensitivityExperimentChartsPayload, kpi: KpiMetricKey): EChartsOption {
  const sorted = [...charts.tornado].sort((left, right) => {
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
      name: `Max |% diff ${KPI_OPTIONS.find((option) => option.key === kpi)?.label ?? kpi}|`,
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
  const [pageError, setPageError] = useState<string>('');

  useEffect(() => {
    if (requestedExperimentId === selectedExperimentId) {
      return;
    }
    onSelectedExperimentIdChange(selectedExperimentId);
  }, [onSelectedExperimentIdChange, requestedExperimentId, selectedExperimentId]);

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
      `Delete sensitivity experiment "${experimentId}"? This permanently removes its Results folder.`
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
        <h2>Sensitivity Results</h2>
        <p>
          Inspect tornado charts, KPI % differences from baseline, and per-point metrics for completed or in-progress sensitivity experiments.
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
            Open Model Runs
          </Link>
          <Link
            className="summary-link-inline"
            to={buildExperimentsPath({
              ...DEFAULT_EXPERIMENT_ROUTE_STATE,
              type: 'sensitivity',
              mode: 'run'
            })}
          >
            Run Sensitivity
          </Link>
        </div>
      </article>

      <div className="results-grid">
        <aside className="results-panel">
          <div className="results-panel-header">
            <h2>Runs</h2>
            <p>{sidebarSubtitle}</p>
          </div>
          {isLoadingHistory ? (
            <p className="loading-banner">Loading experiments...</p>
          ) : experiments.length === 0 ? (
            <p className="info-banner">No sensitivity experiments yet.</p>
          ) : (
            <ul className="run-list">
              {experiments.map((experiment) => {
                const canDeleteExperiment = isFinishedStatus(experiment.status);
                return (
                  <li
                    key={experiment.experimentId}
                    className={`run-item ${selectedExperimentId === experiment.experimentId ? 'focused' : ''}`}
                  >
                    <button
                      type="button"
                      className="run-focus-btn"
                      onClick={() => setSelectedExperimentId(experiment.experimentId)}
                    >
                      {selectedExperimentId === experiment.experimentId ? 'Viewing' : 'View'}
                    </button>
                    <strong>{experiment.title || experiment.experimentId}</strong>
                    <p>Package: {experiment.parameter.title}</p>
                    <p>Base policy: {formatBasePolicyLabel(experiment.basePolicy)}</p>
                    <p>
                      <span className={statusClass(experiment.status)}>{formatStatus(experiment.status)}</span>
                    </p>
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
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <div className="results-main">
          <article className="results-card">
            <div className="results-card-head">
              <h3>Experiment Detail</h3>
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
              <p className="info-banner">Select an experiment to view analytics.</p>
            ) : (
              <div className="sensitivity-detail-grid">
                <p>
                  <strong>Experiment:</strong> {detail.title || detail.experimentId}
                </p>
                <p>
                  <strong>Status:</strong> <span className={statusClass(detail.status)}>{formatStatus(detail.status)}</span>
                </p>
                <p>
                  <strong>Baseline:</strong> {detail.baseline}
                </p>
                <p>
                  <strong>Base policy:</strong> {formatBasePolicyLabel(detail.basePolicy)}
                </p>
                <p>
                  <strong>Package:</strong> {detail.parameter.title}
                </p>
                <p>
                  <strong>Package description:</strong> {detail.parameter.description}
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
                <h3>Tornado + Delta Trend</h3>
                <label>
                  KPI basis
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

              <EChart className="validation-chart" option={buildTornadoOption(charts, selectedKpiKey)} />

              <div className="sensitivity-trend-header">
                <h4>Indicator Delta Trend</h4>
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
              <h3>Per-Point KPI Table {selectedIndicatorTitle ? `(${selectedIndicatorTitle})` : ''}</h3>
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
                        <th>Mean (monthly)</th>
                        <th>% diff Mean (monthly)</th>
                        <th>CV (monthly)</th>
                        <th>% diff CV (monthly)</th>
                        <th>Range (monthly, P95-P5)</th>
                        <th>% diff Range (monthly, P95-P5)</th>
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
                            <td>{formatMetric(values?.kpi.mean ?? null)}</td>
                            <td>{formatSignedPercent(values?.deltaFromBaseline.mean ?? null)}</td>
                            <td>{formatMetric(values?.kpi.cv ?? null)}</td>
                            <td>{formatSignedPercent(values?.deltaFromBaseline.cv ?? null)}</td>
                            <td>{formatMetric(values?.kpi.range ?? null)}</td>
                            <td>{formatSignedPercent(values?.deltaFromBaseline.range ?? null)}</td>
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
      </div>
    </section>
  );
}
