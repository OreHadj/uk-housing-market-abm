// Author: Max Stoddard
import { useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import type { ValidationMetricSummary, ValidationOverviewPayload } from '../../shared/types';
import { EChart } from '../components/EChart';
import {
  API_RETRY_DELAY_MS,
  fetchValidationOverview,
  fetchVersions,
  isRetryableApiError
} from '../lib/api';
import {
  buildVersionLabelState,
  formatVersionOptionLabel,
  getLatestStableVersion
} from '../lib/versionLabels';

const DEFAULT_VALIDATION_TARGET_YEAR = 2024;
export const TRACKED_VALIDATION_SERIES_NAME = 'Models tested against 2024 UK evidence';
export const REFERENCE_VALIDATION_SERIES_NAME = '2011-calibrated models tested against 2011 UK evidence';

export const VALIDATION_POLICY_THEMES = [
  {
    id: 'activity',
    title: 'Market activity and lending',
    metricIds: [
      'core_mortgageApprovals',
      'core_housingTransactions',
      'core_advancesToFTB',
      'core_advancesToHM',
      'core_advancesToBTL'
    ]
  },
  {
    id: 'credit',
    title: 'Credit and affordability',
    metricIds: ['core_debtToIncome', 'core_ooDebtToIncome', 'core_priceToIncome', 'core_interestRateSpread']
  },
  {
    id: 'prices',
    title: 'Prices and cycles',
    metricIds: ['core_housePriceGrowth', 'core_hpiMean', 'core_hpiStd', 'core_hpiCyclePeriod']
  },
  {
    id: 'tenure',
    title: 'Tenure and rental market',
    metricIds: ['rpi_mean', 'household_owning_share', 'household_renting_share', 'core_rentalYield']
  },
  {
    id: 'distribution',
    title: 'Distributional realism',
    metricIds: ['income_distribution_jsd', 'housing_wealth_distribution_jsd', 'financial_wealth_distribution_jsd']
  }
] as const;

function formatNumber(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return 'Unsupported';
  return value.toLocaleString('en-GB', { maximumFractionDigits: digits });
}

function withUnits(value: number | null, units: string, digits = 2): string {
  const formatted = formatNumber(value, digits);
  return formatted === 'Unsupported' || !units ? formatted : `${formatted} ${units}`;
}

function formatBand(metric: ValidationMetricSummary): string {
  return metric.targetBand
    ? `${withUnits(metric.targetBand.lower, metric.units)} to ${withUnits(metric.targetBand.upper, metric.units)}`
    : 'Unsupported';
}

function formatInsideRate(value: number | null): string {
  return value === null ? 'Unsupported' : `${formatNumber(value * 100, 1)}%`;
}

function formatLoss(value: number | null): string {
  return value === null ? 'Unsupported' : formatNumber(value, 4);
}

function formatDelta(value: number | null): string {
  if (value === null) return 'Unsupported';
  return `${value > 0 ? '+' : ''}${formatNumber(value, 4)}`;
}

function formatDeltaPercent(value: number | null): string {
  if (value === null) return 'Unsupported';
  return `${value > 0 ? '+' : ''}${formatNumber(value, 1)}%`;
}

export interface ValidationRangePositions {
  targetStart: number | null;
  targetEnd: number | null;
  iqrStart: number;
  iqrEnd: number;
  mean: number;
  source: number | null;
}

export function calculateValidationRangePositions(metric: ValidationMetricSummary): ValidationRangePositions {
  const rawValues = [metric.seedMean, metric.p25, metric.p75];
  if (metric.targetBand) rawValues.push(metric.targetBand.lower, metric.targetBand.upper);
  if (metric.sourceValue !== null) rawValues.push(metric.sourceValue);
  const finite = rawValues.filter(Number.isFinite);
  let lower = Math.min(...finite);
  let upper = Math.max(...finite);
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
    lower = 0;
    upper = 1;
  }
  const span = upper - lower;
  const padding = span > 0 ? span * 0.1 : Math.max(Math.abs(lower) * 0.1, 1);
  lower -= padding;
  upper += padding;
  const position = (value: number) => Math.max(0, Math.min(100, ((value - lower) / (upper - lower)) * 100));
  return {
    targetStart: metric.targetBand ? position(metric.targetBand.lower) : null,
    targetEnd: metric.targetBand ? position(metric.targetBand.upper) : null,
    iqrStart: position(Math.min(metric.p25, metric.p75)),
    iqrEnd: position(Math.max(metric.p25, metric.p75)),
    mean: position(metric.seedMean),
    source: metric.sourceValue === null ? null : position(metric.sourceValue)
  };
}

export function buildValidationScorecard(metrics: ValidationMetricSummary[]) {
  const counts = { pass: 0, warn: 0, fail: 0, unsupported: 0 };
  metrics.forEach((metric) => {
    counts[metric.status] += 1;
  });
  const insideRates = metrics
    .filter((metric) => metric.status !== 'unsupported' && metric.insideRate !== null)
    .map((metric) => metric.insideRate as number);
  const averageInsideRate =
    insideRates.length > 0 ? insideRates.reduce((total, value) => total + value, 0) / insideRates.length : null;
  const largestGaps = metrics
    .filter((metric) => metric.status !== 'unsupported' && metric.metricLoss !== null)
    .sort((left, right) => (right.metricLoss as number) - (left.metricLoss as number))
    .slice(0, 3);
  return { counts, averageInsideRate, largestGaps };
}

function getPathTail(pathValue: string | null): string {
  return pathValue?.split('/').pop() ?? '';
}

export function buildDeduplicatedSourceReferences(metric: ValidationMetricSummary) {
  const references =
    metric.sourceReferences.length > 0
      ? metric.sourceReferences
      : [
          {
            label: metric.sourceLabel,
            sourceDocumentPath: metric.sourceDocumentPath ?? '',
            sourceTextPath: metric.sourceTextPath,
            sourceTable: metric.sourceTable,
            sourcePage: metric.sourcePage,
            sourceIndicatorLabel: metric.sourceIndicatorLabel,
            rawSourceValue: metric.rawSourceValue,
            sourceAsOf: metric.sourceAsOf,
            sourceUnits: metric.sourceUnits,
            notes: metric.bandNotes
          }
        ];
  const seen = new Set<string>();
  return references.flatMap((reference) => {
    const key = [
      reference.sourceDocumentPath,
      reference.sourcePage,
      reference.sourceTable,
      reference.label
    ].join('|');
    if (seen.has(key)) return [];
    seen.add(key);
    const parts = [getPathTail(reference.sourceDocumentPath) || reference.label];
    if (reference.sourcePage !== null) parts.push(`p.${reference.sourcePage}`);
    if (reference.sourceTable) parts.push(reference.sourceTable);
    return [{ key, label: parts.join(' · '), notes: reference.notes }];
  });
}

function lossFamilyDescription(metric: ValidationMetricSummary): string {
  const labels = {
    positive_level: 'Positive level',
    signed_additive: 'Signed additive',
    bounded_low_is_better: 'Bounded low-is-better',
    bounded_share: 'Bounded share',
    diagnostic: 'Diagnostic'
  };
  return metric.lossFamily
    ? `${labels[metric.lossFamily]}${metric.lossTransform ? ` · ${metric.lossTransform.replaceAll('_', ' ')}` : ''}`
    : 'Not applicable';
}

function buildTrendOption(
  overview: ValidationOverviewPayload,
  year: 2024 | 2011,
  formatVersionLabel: (version: string) => string
): EChartsOption | null {
  const points =
    year === 2024
      ? overview.trend.points
      : overview.trend.referencePoints.filter((point) => point.validationTargetYear === 2011);
  if (points.length === 0) return null;
  const seriesName = year === 2024 ? TRACKED_VALIDATION_SERIES_NAME : REFERENCE_VALIDATION_SERIES_NAME;
  return {
    tooltip: {
      trigger: 'item',
      formatter: (raw: unknown) => {
        const item = raw as { name?: string; value?: number };
        return `<strong>${formatVersionLabel(item.name ?? '')}</strong><br/>${year} UK evidence<br/>Validation loss: ${formatNumber(item.value ?? null, 4)}`;
      }
    },
    grid: { left: 62, right: 24, top: 28, bottom: 64, containLabel: true },
    xAxis: {
      type: 'category',
      data: points.map((point) => point.version),
      axisLabel: {
        color: '#50625a',
        formatter: (value: string) => formatVersionLabel(value),
        rotate: points.length > 5 ? 25 : 0
      }
    },
    yAxis: {
      type: 'value',
      name: 'Validation loss — lower is better',
      nameLocation: 'middle',
      nameGap: 48,
      axisLabel: { color: '#50625a' }
    },
    series: [
      {
        type: 'line',
        name: seriesName,
        data: points.map((point) => ({ name: point.version, value: point.overallCompositeLoss })),
        showSymbol: true,
        symbol: year === 2024 ? 'circle' : 'diamond',
        symbolSize: 11,
        cursor: 'pointer',
        lineStyle: { color: year === 2024 ? '#0b7285' : '#6741d9', width: 2.4 },
        itemStyle: {
          color: year === 2024 ? '#0b7285' : '#6741d9',
          borderColor: '#fff',
          borderWidth: 2
        }
      }
    ]
  };
}

function MetricRange({ metric }: { metric: ValidationMetricSummary }) {
  const positions = calculateValidationRangePositions(metric);
  return (
    <div
      className="validation-range"
      role="img"
      aria-label={`${metric.label}: empirical target band ${formatBand(metric)}, simulated IQR ${withUnits(
        metric.p25,
        metric.units
      )} to ${withUnits(metric.p75, metric.units)}, simulated mean ${withUnits(metric.seedMean, metric.units)}`}
    >
      <div className="validation-range-axis" />
      {positions.targetStart !== null && positions.targetEnd !== null && (
        <div
          className="validation-target-band"
          style={{ left: `${positions.targetStart}%`, width: `${positions.targetEnd - positions.targetStart}%` }}
        />
      )}
      <div
        className="validation-iqr"
        style={{ left: `${positions.iqrStart}%`, width: `${Math.max(1, positions.iqrEnd - positions.iqrStart)}%` }}
      />
      <span className="validation-mean-marker" style={{ left: `${positions.mean}%` }} title="Simulated mean" />
      {positions.source !== null && (
        <span className="validation-source-marker" style={{ left: `${positions.source}%` }} title="Empirical target" />
      )}
    </div>
  );
}

function MetricRow({ metric }: { metric: ValidationMetricSummary }) {
  return (
    <details className={`validation-metric-row validation-metric-${metric.status}`}>
      <summary>
        <div className="validation-metric-title">
          <strong>{metric.label}</strong>
          <span>{metric.units || 'Unitless'}</span>
          <span className={`validation-status-pill validation-status-${metric.status}`}>{metric.status}</span>
        </div>
        <MetricRange metric={metric} />
        <div className="validation-robustness">
          <span>Seeds in band</span>
          <strong>{formatInsideRate(metric.insideRate)}</strong>
          <progress max={1} value={metric.insideRate ?? 0} aria-label="Seeds inside target band" />
        </div>
        <div className="validation-row-loss">
          <span>Loss</span>
          <strong>{formatLoss(metric.metricLoss)}</strong>
        </div>
      </summary>
      <div className="validation-metric-detail">
        <dl>
          <div><dt>Exact target</dt><dd>{withUnits(metric.sourceValue, metric.units)}</dd></div>
          <div><dt>Target band</dt><dd>{formatBand(metric)}</dd></div>
          <div><dt>Simulated mean</dt><dd>{withUnits(metric.seedMean, metric.units, 3)}</dd></div>
          <div><dt>Simulated IQR</dt><dd>{withUnits(metric.p25, metric.units, 3)} to {withUnits(metric.p75, metric.units, 3)}</dd></div>
          <div><dt>Seeds inside band</dt><dd>{formatInsideRate(metric.insideRate)}</dd></div>
          <div><dt>Metric loss · weight</dt><dd>{formatLoss(metric.metricLoss)} · {formatNumber(metric.metricWeight, 4)}</dd></div>
          <div><dt>Secondary cross-year comparison</dt><dd>{formatDelta(metric.lossDeltaVsReference2011)} ({formatDeltaPercent(metric.lossDeltaPercentVsReference2011)}) loss change versus original 2011 benchmark</dd></div>
          <div><dt>Loss family</dt><dd>{lossFamilyDescription(metric)}</dd></div>
        </dl>
        <details className="validation-source-disclosure">
          <summary>Sources and provenance</summary>
          <div className="validation-source-panel">
            <strong>{metric.sourceLabel}</strong>
            {buildDeduplicatedSourceReferences(metric).map((reference) => (
              <span key={reference.key} title={reference.notes ?? undefined}>{reference.label}</span>
            ))}
            {metric.lossScale !== null && <span>Loss scale: {formatNumber(metric.lossScale, 4)} ({metric.lossScaleBasis?.replaceAll('_', ' ')})</span>}
            {metric.additiveScale !== null && <span>Additive scale: {formatNumber(metric.additiveScale, 4)} ({metric.additiveScaleBasis?.replaceAll('_', ' ')})</span>}
            {metric.bandNotes && <span>{metric.bandNotes}</span>}
          </div>
        </details>
      </div>
    </details>
  );
}

export function ValidationPage() {
  const [overview, setOverview] = useState<ValidationOverviewPayload | null>(null);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [selectedValidationTargetYear, setSelectedValidationTargetYear] = useState(DEFAULT_VALIDATION_TARGET_YEAR);
  const [isLoading, setIsLoading] = useState(true);
  const [isWaitingForApi, setIsWaitingForApi] = useState(false);
  const [error, setError] = useState('');
  const [inProgressVersions, setInProgressVersions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    const load = async () => {
      setIsLoading(true);
      setIsWaitingForApi(false);
      setError('');
      try {
        const [response, versions] = await Promise.all([
          fetchValidationOverview(selectedVersion || undefined, selectedValidationTargetYear),
          fetchVersions()
        ]);
        if (cancelled) return;
        setOverview(response);
        setSelectedVersion(response.selectedVersion);
        setSelectedValidationTargetYear(response.selectedValidationTargetYear);
        setInProgressVersions(versions.inProgressVersions);
      } catch (loadError) {
        if (cancelled) return;
        if (isRetryableApiError(loadError)) {
          setIsWaitingForApi(true);
          retryTimer = window.setTimeout(() => void load(), API_RETRY_DELAY_MS);
          return;
        }
        setError((loadError as Error).message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [selectedVersion, selectedValidationTargetYear]);

  const summary = overview?.selectedSummary ?? null;
  const latestStableVersion = useMemo(
    () => getLatestStableVersion(overview?.availableVersions ?? [], inProgressVersions),
    [overview, inProgressVersions]
  );
  const inProgressSet = useMemo(() => new Set(inProgressVersions), [inProgressVersions]);
  const versionLabel = (version: string) =>
    formatVersionOptionLabel(version, buildVersionLabelState(version, latestStableVersion, inProgressSet));
  const orderedVersions = [...(overview?.availableVersions ?? [])].sort((left, right) =>
    versionLabel(left).localeCompare(versionLabel(right))
  );
  const scorecard = useMemo(() => buildValidationScorecard(summary?.metrics ?? []), [summary]);
  const chart2024 = useMemo(
    () => (overview ? buildTrendOption(overview, 2024, versionLabel) : null),
    [overview, latestStableVersion, inProgressVersions]
  );
  const chart2011 = useMemo(
    () => (overview ? buildTrendOption(overview, 2011, versionLabel) : null),
    [overview, latestStableVersion, inProgressVersions]
  );
  const availableYears =
    overview?.availableValidationTargetYearsByVersion[selectedVersion] ?? [DEFAULT_VALIDATION_TARGET_YEAR];

  const selectVersionAndValidationYear = (version: string, year: number) => {
    setSelectedVersion(version);
    setSelectedValidationTargetYear(year);
  };
  const handleVersionChange = (version: string) => {
    const years = overview?.availableValidationTargetYearsByVersion[version] ?? [DEFAULT_VALIDATION_TARGET_YEAR];
    selectVersionAndValidationYear(version, years.includes(selectedValidationTargetYear) ? selectedValidationTargetYear : 2024);
  };
  const handleChartClick = (year: 2024 | 2011) => (raw: unknown) => {
    const point = raw as { name?: string };
    if (point?.name) selectVersionAndValidationYear(point.name, year);
  };

  return (
    <section className="validation-layout">
      <article className="results-card validation-introduction">
        <h2>Validation</h2>
        <p>Compare the selected model with independent UK evidence, see which outcomes are credible or problematic, and check whether results hold across random seeds.</p>
        <p className="validation-protocol-note">
          Validation uses a fixed ten-seed, 3,500-step protocol; the first 500 steps are discarded. Runs launched on the Experiments page do not update these validation results.
        </p>
        <div className="validation-page-selectors">
          <label className="validation-selector">
            <span>Model version</span>
            <select value={selectedVersion} onChange={(event) => handleVersionChange(event.target.value)}>
              {orderedVersions.map((version) => <option key={version} value={version}>{versionLabel(version)}</option>)}
            </select>
          </label>
          <label className="validation-selector">
            <span>Evidence year</span>
            <select value={selectedValidationTargetYear} onChange={(event) => setSelectedValidationTargetYear(Number(event.target.value))}>
              {availableYears.map((year) => <option key={year} value={year}>{year} UK evidence</option>)}
            </select>
          </label>
        </div>
      </article>

      {error && <p className="error-banner">Unable to load validation results: {error}</p>}
      {isWaitingForApi && <p className="waiting-banner">Waiting for the API. Retrying every 2 seconds…</p>}
      {isLoading && !summary && <p className="loading-banner">Loading validation overview…</p>}

      {summary && (
        <>
          <article className="results-card">
            <div className="validation-overview-header">
              <div>
                <h3>{versionLabel(summary.version)} scorecard</h3>
                <p>{summary.validationTargetYear} UK evidence · conclusions across ten fixed seeds</p>
              </div>
            </div>
            <div className="kpi-grid validation-scorecard-grid">
              <div className="kpi-card validation-composite-card">
                <span>Comparative validation loss — lower is better</span>
                <strong>{formatNumber(summary.overallCompositeLoss, 4)}</strong>
                <small>Composite loss has no standalone statistical interpretation.</small>
              </div>
              {(['pass', 'warn', 'fail', 'unsupported'] as const).map((status) => (
                <div className={`kpi-card validation-count-card validation-metric-${status}`} key={status}>
                  <span>{status}</span><strong>{scorecard.counts[status]}</strong><small>metrics</small>
                </div>
              ))}
              <div className="kpi-card">
                <span>Average seeds inside target bands</span>
                <strong>{formatInsideRate(scorecard.averageInsideRate)}</strong>
                <small>Unsupported metrics excluded</small>
              </div>
            </div>
            <div className="validation-largest-gaps">
              <h4>Largest validation gaps</h4>
              {scorecard.largestGaps.length > 0 ? (
                <ol>{scorecard.largestGaps.map((metric) => <li key={metric.metricId}><span>{metric.label}</span><strong>{formatLoss(metric.metricLoss)}</strong></li>)}</ol>
              ) : <p>No supported metric losses are available.</p>}
            </div>
          </article>

          <div className="validation-trend-grid">
            <article className="results-card">
              <h3>Models tested against 2024 UK evidence</h3>
              <p className="validation-card-subtitle">Main recalibration trend. Click a point to inspect that model against 2024 evidence.</p>
              {chart2024 ? <EChart option={chart2024} className="chart validation-chart" onClick={handleChartClick(2024)} /> : <p className="info-banner">No 2024 trend is available.</p>}
            </article>
            <article className="results-card">
              <h3>2011-calibrated models tested against 2011 UK evidence</h3>
              <p className="validation-card-subtitle">Separate historical reference points for v0, v0o2, and v0o7. This is not a continuation of the 2024 timeline.</p>
              {chart2011 ? <EChart option={chart2011} className="chart validation-chart" onClick={handleChartClick(2011)} /> : <p className="info-banner">No 2011 reference points are available.</p>}
            </article>
          </div>

          <article className="results-card">
            <div className="validation-overview-header">
              <div><h3>Outcome diagnostics</h3><p>Each metric uses its own scale so target evidence and seed variation remain legible.</p></div>
            </div>
            <div className="validation-range-legend" aria-label="Range graphic legend">
              <span className="legend-target">Empirical target band</span>
              <span className="legend-iqr">Simulated IQR</span>
              <span className="legend-mean">Simulated mean</span>
              <span className="legend-source">Single empirical target</span>
            </div>
            {VALIDATION_POLICY_THEMES.map((theme) => {
              const metricMap = new Map(summary.metrics.map((metric) => [metric.metricId, metric]));
              const metrics = theme.metricIds.flatMap((metricId) => {
                const metric = metricMap.get(metricId);
                return metric ? [metric] : [];
              });
              return (
                <section className="validation-theme" key={theme.id}>
                  <h4>{theme.title}</h4>
                  {metrics.length > 0 ? metrics.map((metric) => <MetricRow metric={metric} key={metric.metricId} />) : <p className="info-banner">No metrics available for this theme.</p>}
                </section>
              );
            })}
          </article>

          <details className="results-card validation-audit-disclosure">
            <summary><h3>Technical results table</h3><span>Exact comparison values</span></summary>
            <p className="validation-card-subtitle">A compact audit view of empirical targets, simulated outcomes, seed robustness, and metric loss.</p>
            <div className="validation-table-wrap">
              <table className="validation-metrics-table">
                <thead><tr><th>Metric</th><th>Empirical target</th><th>Simulation</th><th>Seeds in band</th><th>Loss</th><th>Details</th></tr></thead>
                <tbody>{summary.metrics.map((metric) => (
                  <tr key={metric.metricId}>
                    <td>
                      <div className="validation-table-primary">
                        <strong>{metric.label}</strong>
                        <span>{metric.units || 'Unitless'}</span>
                        <span className={`validation-status-pill validation-status-${metric.status}`}>{metric.status}</span>
                      </div>
                    </td>
                    <td>
                      <div className="validation-table-value">
                        <strong>{withUnits(metric.sourceValue, metric.units)}</strong>
                        <span>Band: {formatBand(metric)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="validation-table-value">
                        <strong>Mean: {withUnits(metric.seedMean, metric.units, 3)}</strong>
                        <span>IQR: {withUnits(metric.p25, metric.units, 3)} to {withUnits(metric.p75, metric.units, 3)}</span>
                      </div>
                    </td>
                    <td>{formatInsideRate(metric.insideRate)}</td>
                    <td className="validation-loss-cell">{formatLoss(metric.metricLoss)}</td>
                    <td>
                      <details className="validation-table-detail-disclosure">
                        <summary>View details</summary>
                        <div className="validation-table-detail-panel">
                          <dl>
                            <div><dt>Metric weight</dt><dd>{formatNumber(metric.metricWeight, 4)}</dd></div>
                            <div><dt>Loss change vs original 2011 benchmark</dt><dd>{formatDelta(metric.lossDeltaVsReference2011)}</dd></div>
                            <div><dt>Loss family</dt><dd>{lossFamilyDescription(metric)}</dd></div>
                          </dl>
                          <details className="validation-source-disclosure validation-table-source-disclosure">
                            <summary>Sources and provenance</summary>
                            <div className="validation-source-panel">
                              <strong>{metric.sourceLabel}</strong>
                              {buildDeduplicatedSourceReferences(metric).map((reference) => (
                                <span key={reference.key} title={reference.notes ?? undefined}>{reference.label}</span>
                              ))}
                            </div>
                          </details>
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </details>

          <details className="results-card validation-audit-disclosure">
            <summary><h3>Validation methodology</h3><span>Protocol, evidence, and loss calculation</span></summary>
            <p>Validation asks how far the multi-seed model summary sits from an empirical target and whether seed outcomes consistently fall inside its target band.</p>
            <details className="validation-loss-method">
              <summary>How validation loss is calculated</summary>
              <p>Positive levels use log-ratio distance; signed metrics use robust additive distance; tenure shares use bounded-domain-normalised percentage-point distance; and JSD uses bounded low-is-better scoring. Spread and seeds outside the band also contribute. Target bands determine pass, warning, and fail status.</p>
              <p>The weighted composite aggregates metric losses for comparative ranking. Its family-specific scales, transforms, distance, spread, and inside-band components are retained in the payload and metric audit detail; it is not a probability, confidence interval, or hypothesis-test statistic.</p>
            </details>
          </details>
        </>
      )}
    </section>
  );
}
