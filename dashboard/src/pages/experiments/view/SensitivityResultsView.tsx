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
import { buildDeltaTrendOption } from '../../../lib/sensitivityChartOptions';
import { BASE_POLICY_OPTIONS, CENTRAL_BANK_POLICY_KEYS } from '../../../../shared/policyCatalogue';
import { CENTRAL_BANK_POLICY_DISPLAY, formatPolicyValue } from '../../../../shared/policyDisplay';
import { formatModelOptionLabel } from '../../../lib/modelAnchors';
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

/**
 * Option text for the run selector. The instrument is what actually distinguishes two sweeps of the
 * same baseline, so it rides along with the name rather than being left to the summary below.
 */
function formatExperimentOptionLabel(experiment: SensitivityExperimentSummary): string {
  const name = experiment.title || experiment.experimentId;
  return `${name} — ${experiment.parameter.title}`;
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

  const sweptPolicy = useMemo(() => describeSweptPolicy(detail), [detail]);
  const sweepSummary = useMemo(() => describeSweepSummary(detail), [detail]);

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

      <article className="results-card sensitivity-summary-card">
        <div className="results-card-head">
          <h2>{selectedExperiment ? selectedExperiment.title || selectedExperiment.experimentId : 'Sensitivity run'}</h2>
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

        <div className="comparison-run-pickers">
          <label>
            <span>Select run to view</span>
            <select
              value={selectedExperimentId}
              disabled={isLoadingHistory || experiments.length === 0}
              onChange={(event) => setSelectedExperimentId(event.target.value)}
            >
              {experiments.length === 0 && <option value="">No sensitivity analyses yet</option>}
              {experiments.map((experiment) => (
                <option key={experiment.experimentId} value={experiment.experimentId}>
                  {formatExperimentOptionLabel(experiment)}
                </option>
              ))}
            </select>
            {selectedExperiment && (
              <span className={statusClass(selectedExperiment.status)}>{formatStatus(selectedExperiment.status)}</span>
            )}
          </label>
        </div>

        {isLoadingHistory ? (
          <p className="loading-banner">Loading experiments...</p>
        ) : experiments.length === 0 ? (
          <p className="info-banner">
            No sensitivity analyses yet. <Link to="/sensitivity/new">Create one to begin.</Link>
          </p>
        ) : isLoadingDetail ? (
          <p className="loading-banner">Loading experiment detail...</p>
        ) : !detail ? (
          <p className="info-banner">Select a sensitivity analysis to view its results.</p>
        ) : (
          <>
            {sweepSummary && (
              <CollapsibleSection
                title="Summary"
                summary={sweepSummary.instrument}
                defaultOpen={false}
                className="run-policy-disclosure sensitivity-run-summary-disclosure"
              >
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
              </CollapsibleSection>
            )}
            {detail.failureReason && <p className="error-banner">Failure reason: {detail.failureReason}</p>}

            {sweptPolicy && (
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
          {charts && (
            <CollapsibleSection
              className="results-card sensitivity-response-card"
              title="Outcome responses"
              description="Which indicators respond most across the tested range, and how the selected one moves."
              defaultOpen={false}
            >
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
                  <h3>Response across policy values</h3>
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
            </CollapsibleSection>
          )}

          {results && (
            <CollapsibleSection
              className="results-card sensitivity-tested-values-card"
              title="Results by tested value"
              summary={selectedIndicatorTitle}
              defaultOpen={false}
            >
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
            </CollapsibleSection>
          )}
      </div>

      <CollapsibleSection
        className="results-card run-history-card sensitivity-run-history-card"
        title="Run History"
        description={sidebarSubtitle}
        summary={`${experiments.length} sensitivity ${experiments.length === 1 ? 'run' : 'runs'}`}
        defaultOpen={false}
      >
        {isLoadingHistory ? (
          <p className="loading-banner">Loading experiments...</p>
        ) : experiments.length === 0 ? (
          <p className="info-banner">No sensitivity analyses yet. Create one to begin.</p>
        ) : (
          <ul className="run-list sensitivity-run-history-list">
            {experiments.map((experiment) => {
              const isSelected = selectedExperimentId === experiment.experimentId;
              const canDeleteExperiment = isFinishedStatus(experiment.status);
              return (
                <li key={experiment.experimentId} className={`run-item ${isSelected ? 'focused' : ''}`}>
                  <div className="run-item-head">
                    <strong>{experiment.title || experiment.experimentId}</strong>
                    {isSelected && <span className="run-role-chip">Viewing</span>}
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
                      onClick={() => setSelectedExperimentId(experiment.experimentId)}
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
      </CollapsibleSection>
    </section>
  );
}
