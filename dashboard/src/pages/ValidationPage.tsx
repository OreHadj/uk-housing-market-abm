// Author: Max Stoddard
import { useEffect, useMemo, useState } from 'react';
// import type { EChartsOption } from 'echarts'; // Retained for the temporarily hidden trend chart below.
import { Link, useSearchParams } from 'react-router-dom';
import type {
  ValidationMetricComparisonPoint,
  ValidationMetricStatus,
  ValidationMetricSummary,
  ValidationOverviewPayload
} from '../../shared/types';
// import { EChart } from '../components/EChart'; // Retained for the temporarily hidden trend chart below.
import {
  API_RETRY_DELAY_MS,
  fetchValidationOverview,
  fetchVersions,
  isRetryableApiError
} from '../lib/api';
import {
  buildModelOptions,
  formatModelName,
  formatModelSubtitle
} from '../lib/modelAnchors';
import { BASELINE_COLOR, COMPARISON_COLOR } from '../lib/manualOverlayChartOption';
import { readScenarioDraft, updateScenarioDraftModel } from '../lib/scenarioDraft';

const DEFAULT_VALIDATION_TARGET_YEAR = 2024;

/** Setup forms that can hand off to Validation and be returned to with a chosen model. */
const RETURN_DESTINATIONS: Record<string, { path: string; noun: string }> = {
  scenario: { path: '/scenarios/new', noun: 'scenario' },
  sensitivity: { path: '/sensitivity/new', noun: 'sensitivity analysis' }
};
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

/**
 * `sourceValue`, `seedMean` and the target band are expressed in `comparisonUnits`
 * (e.g. 62.86 "thousand count/month"), while `units` describes the raw model scale.
 * Rendering the raw units against a rescaled value understates figures by 1000x.
 */
function displayUnits(metric: ValidationMetricSummary): string {
  return metric.comparisonUnits || metric.units || '';
}

function formatBand(metric: ValidationMetricSummary): string {
  return metric.targetBand
    ? `${withUnits(metric.targetBand.lower, displayUnits(metric))} to ${withUnits(metric.targetBand.upper, displayUnits(metric))}`
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

function formatModelWithVersion(version: string): string {
  const name = formatModelName(version);
  return name === version ? version : `${name} (${version})`;
}

function formatStatusCountDifference(
  status: ValidationMetricStatus,
  selectedCount: number,
  comparisonCount: number
): string {
  const difference = comparisonCount - selectedCount;
  if (difference === 0) return 'Same';
  const noun = status === 'pass' ? 'passes' : status === 'warn' ? 'warnings' : status === 'fail' ? 'failures' : 'unsupported';
  return `${difference > 0 ? '+' : '−'}${Math.abs(difference)} ${noun}`;
}

/**
 * Every metric row is drawn on one shared axis measuring deviation from the empirical
 * target, so a 1.6% miss and a 324% miss are visually distinguishable. The axis is
 * piecewise-linear: fine resolution inside +/-25%, compressed out to the +/-100% limit,
 * with anything beyond that clamped and flagged as an overflow.
 */
export const DEVIATION_AXIS_LIMIT = 100;
export const DEVIATION_AXIS_TICKS = [-100, -25, 0, 25, 100] as const;
const WIDE_BAND_DEVIATION = 25;
const NARROW_BAND_DEVIATION = 5;

function toDeviationPercent(value: number, source: number): number {
  return ((value - source) / Math.abs(source)) * 100;
}

export function deviationToPosition(percent: number): number {
  if (!Number.isFinite(percent)) return 50;
  const magnitude = Math.min(Math.abs(percent), DEVIATION_AXIS_LIMIT);
  const fraction = magnitude <= 25 ? (magnitude / 25) * 0.45 : 0.45 + ((magnitude - 25) / 75) * 0.55;
  return 50 + Math.sign(percent) * fraction * 50;
}

export interface ValidationRangePositions {
  targetStart: number | null;
  targetEnd: number | null;
  iqrStart: number;
  iqrEnd: number;
  mean: number;
  source: number | null;
  deviationPercent: number | null;
  meanOverflow: boolean;
  scaled: boolean;
}

export function calculateValidationRangePositions(metric: ValidationMetricSummary): ValidationRangePositions {
  const source = metric.sourceValue;
  // Distribution-shape metrics (JSD) have no single empirical target, so a percentage
  // deviation is undefined for them. They are rendered in their own sub-group instead.
  if (source === null || !Number.isFinite(source) || source === 0) {
    return {
      targetStart: null,
      targetEnd: null,
      iqrStart: 50,
      iqrEnd: 50,
      mean: 50,
      source: null,
      deviationPercent: null,
      meanOverflow: false,
      scaled: false
    };
  }
  const deviationPercent = toDeviationPercent(metric.seedMean, source);
  const iqrLow = toDeviationPercent(Math.min(metric.p25, metric.p75), source);
  const iqrHigh = toDeviationPercent(Math.max(metric.p25, metric.p75), source);
  return {
    targetStart: metric.targetBand ? deviationToPosition(toDeviationPercent(metric.targetBand.lower, source)) : null,
    targetEnd: metric.targetBand ? deviationToPosition(toDeviationPercent(metric.targetBand.upper, source)) : null,
    iqrStart: deviationToPosition(iqrLow),
    iqrEnd: deviationToPosition(iqrHigh),
    mean: deviationToPosition(deviationPercent),
    source: 50,
    deviationPercent,
    meanOverflow: Math.abs(deviationPercent) > DEVIATION_AXIS_LIMIT,
    scaled: true
  };
}

/**
 * A pass on a metric that sits far from its target, or a fail on one that sits very close,
 * is a property of the band width rather than of model accuracy. Surface it as a caution.
 */
export function buildBandWidthNote(metric: ValidationMetricSummary, deviationPercent: number | null): string | null {
  if (deviationPercent === null || !Number.isFinite(deviationPercent)) return null;
  const magnitude = Math.abs(deviationPercent);
  const direction = deviationPercent < 0 ? 'below' : 'above';
  if (metric.status !== 'fail' && magnitude >= WIDE_BAND_DEVIATION) {
    return `Inside the target band, but ${formatNumber(magnitude, 1)}% ${direction} the empirical target — this band is wide.`;
  }
  if (metric.status === 'fail' && magnitude <= NARROW_BAND_DEVIATION) {
    return `Outside the target band, but only ${formatNumber(magnitude, 1)}% ${direction} the empirical target — this band is narrow.`;
  }
  return null;
}

/** Percentage distance from the empirical target; null where there is no single target (JSD). */
export function metricDeviationPercent(
  point: Pick<ValidationMetricComparisonPoint, 'seedMean' | 'sourceValue'>
): number | null {
  const source = point.sourceValue;
  if (source === null || !Number.isFinite(source) || source === 0) return null;
  return toDeviationPercent(point.seedMean, source);
}

export interface ValidationModelRanking {
  version: string;
  deviationPercent: number | null;
  status: ValidationMetricStatus | null;
  metricLoss: number | null;
}

/**
 * Orders models by how close they sit to one indicator's empirical target. Models with no value
 * for that indicator keep a stable position at the end rather than being dropped, so the picker
 * never silently loses an option.
 */
export function rankVersionsByMetric(
  metricsByVersion: Record<string, ValidationMetricComparisonPoint[]>,
  versions: readonly string[],
  metricId: string
): ValidationModelRanking[] {
  const ranked = versions.map((version) => {
    const point = (metricsByVersion[version] ?? []).find((item) => item.metricId === metricId) ?? null;
    return {
      version,
      deviationPercent: point ? metricDeviationPercent(point) : null,
      status: point?.status ?? null,
      metricLoss: point?.metricLoss ?? null
    };
  });
  return ranked.sort((left, right) => {
    const leftKey = left.deviationPercent === null ? Number.POSITIVE_INFINITY : Math.abs(left.deviationPercent);
    const rightKey = right.deviationPercent === null ? Number.POSITIVE_INFINITY : Math.abs(right.deviationPercent);
    return leftKey - rightKey;
  });
}

export function buildValidationLossDecomposition(metrics: ValidationMetricSummary[]) {
  const byId = new Map(metrics.map((metric) => [metric.metricId, metric]));
  const total = metrics.reduce((sum, metric) => sum + (metric.metricLoss ?? 0), 0);
  const themes = VALIDATION_POLICY_THEMES.map((theme) => {
    const loss = theme.metricIds.reduce((sum, metricId) => sum + (byId.get(metricId)?.metricLoss ?? 0), 0);
    return { id: theme.id, title: theme.title, loss, share: total > 0 ? loss / total : 0 };
  }).sort((left, right) => right.loss - left.loss);
  return { total, themes };
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

/* Retained with the temporarily hidden model-development trend chart.
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
*/

function formatDeviation(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return 'No single target';
  return `${percent > 0 ? '+' : percent < 0 ? '−' : ''}${formatNumber(Math.abs(percent), 1)}%`;
}

export function ValidationModelOptions({
  versions,
  selectedVersion,
  name,
  label,
  rankings = null,
  disabled = false,
  unavailableVersion = '',
  inProgressVersions,
  onChange
}: {
  versions: readonly string[];
  selectedVersion: string;
  name: string;
  label: string;
  rankings?: readonly ValidationModelRanking[] | null;
  disabled?: boolean;
  unavailableVersion?: string;
  inProgressVersions?: ReadonlySet<string>;
  onChange: (version: string) => void;
}) {
  return (
    <div className="validation-model-options" role="radiogroup" aria-label={label} aria-disabled={disabled}>
      {versions.map((version, index) => {
        const ranking = rankings?.find((entry) => entry.version === version) ?? null;
        const isUnavailable = version === unavailableVersion;
        const isDisabled = disabled || isUnavailable;
        const isSelected = version === selectedVersion;
        return (
          <label
            key={version}
            className={`validation-model-option${isSelected ? ' is-selected' : ''}${isDisabled ? ' is-disabled' : ''}`}
          >
            <input
              type="radio"
              name={name}
              value={version}
              checked={isSelected}
              disabled={isDisabled}
              onChange={() => onChange(version)}
            />
            <span className="validation-model-option-copy">
              <span className="validation-model-option-heading">
                {rankings && <span className="validation-model-option-rank" aria-label={`Rank ${index + 1}`}>{index + 1}.</span>}
                <strong>{formatModelName(version)}</strong>
                <span className="validation-model-option-version">{version}</span>
              </span>
              <small>{formatModelSubtitle(version)}</small>
              {(ranking || isUnavailable || inProgressVersions?.has(version)) && (
                <span className="validation-model-option-meta">
                  {ranking && (
                    <span>
                      {ranking.deviationPercent === null
                        ? 'No single target'
                        : `${formatDeviation(ranking.deviationPercent)} from target`}
                    </span>
                  )}
                  {ranking?.status && (
                    <span className={`validation-model-option-status validation-status-${ranking.status}`}>
                      {ranking.status}
                    </span>
                  )}
                  {isUnavailable && <span className="validation-model-option-unavailable">Selected as primary</span>}
                  {inProgressVersions?.has(version) && <span className="validation-model-option-progress">In progress</span>}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * One model's IQR and mean on the shared axis. The axis, ticks, target marker and band are drawn
 * once by `MetricRange` because they are identical for every model scored on the same metric and
 * evidence year — verified: `sourceValue` and `targetBand` do not vary by version.
 */
function MetricSeries({
  positions,
  colour,
  title
}: {
  positions: ValidationRangePositions;
  colour: string;
  title: string;
}) {
  return (
    <>
      <div
        className="validation-iqr"
        style={{
          left: `${positions.iqrStart}%`,
          width: `${Math.max(1, positions.iqrEnd - positions.iqrStart)}%`,
          background: colour,
          borderColor: colour
        }}
      />
      <span
        className={positions.meanOverflow ? 'validation-mean-marker validation-mean-overflow' : 'validation-mean-marker'}
        style={
          positions.meanOverflow
            ? { left: `${positions.mean}%`, borderLeftColor: colour }
            : { left: `${positions.mean}%`, background: colour }
        }
        title={title}
      />
    </>
  );
}

function MetricRange({
  metric,
  positions,
  comparisonPositions,
  comparisonLabel
}: {
  metric: ValidationMetricSummary;
  positions: ValidationRangePositions;
  comparisonPositions?: ValidationRangePositions | null;
  comparisonLabel?: string;
}) {
  if (!positions.scaled) {
    return <div className="validation-range validation-range-unscaled">No single empirical target — compared by distribution shape</div>;
  }
  return (
    <div
      className="validation-range"
      role="img"
      aria-label={`${metric.label}: simulated mean ${formatDeviation(
        positions.deviationPercent
      )} versus the empirical target of ${withUnits(metric.sourceValue, displayUnits(metric))}, target band ${formatBand(metric)}`}
    >
      <div className="validation-range-axis" />
      {DEVIATION_AXIS_TICKS.map((tick) => (
        <span
          key={tick}
          /* Zero is the empirical target itself, so it keeps the source-marker identity. */
          className={tick === 0 ? 'validation-source-marker' : 'validation-axis-tick'}
          style={{ left: `${deviationToPosition(tick)}%` }}
          title={tick === 0 ? 'Empirical target' : `${tick > 0 ? '+' : ''}${tick}% off target`}
        />
      ))}
      {positions.targetStart !== null && positions.targetEnd !== null && (
        <div
          className="validation-target-band"
          style={{ left: `${positions.targetStart}%`, width: `${Math.max(0.6, positions.targetEnd - positions.targetStart)}%` }}
        />
      )}
      <MetricSeries positions={positions} colour={BASELINE_COLOR} title="Simulated mean" />
      {comparisonPositions?.scaled && (
        <MetricSeries
          positions={comparisonPositions}
          colour={COMPARISON_COLOR}
          title={`Simulated mean — ${comparisonLabel ?? 'comparison'}`}
        />
      )}
    </div>
  );
}

/**
 * What pass / warn / fail / unsupported actually mean, stated once for the whole page — the words
 * appear on the scorecard counts, on every metric row, and in the technical table.
 *
 * The rules mirror `classify_metric_status` (scripts/python/validation/model/scoring.py): a status
 * is decided by two things together, how far the seed mean sits from the nearest edge of the target
 * band (measured in band-widths) and what fraction of individual seeds land inside that band. Both
 * conditions must hold, which is why a metric can be centred on its target and still only warn.
 */
const VALIDATION_STATUS_DEFINITIONS: {
  status: ValidationMetricStatus;
  meaning: string;
  rule: string;
}[] = [
  {
    status: 'pass',
    meaning: 'Matches the evidence, and does so consistently.',
    rule: 'Seed mean inside the target band, and at least 75% of seeds inside it.'
  },
  {
    status: 'warn',
    meaning: 'Close to the evidence, or on target but unsteady across seeds.',
    rule: 'Seed mean within half a band-width of the band, and at least 50% of seeds inside it.'
  },
  {
    status: 'fail',
    meaning: 'Neither close enough nor consistent enough to rely on.',
    rule: 'Falls outside both of the limits above.'
  },
  {
    status: 'unsupported',
    meaning: 'Cannot be scored — no target band is published for this metric.',
    rule: 'Carries no weight and is excluded from the composite loss.'
  }
];

function ValidationStatusLegend() {
  return (
    <aside className="validation-status-legend" aria-labelledby="validation-status-legend-heading">
      <h3 id="validation-status-legend-heading">How each metric is scored</h3>
      <dl>
        {VALIDATION_STATUS_DEFINITIONS.map((definition) => (
          <div key={definition.status}>
            <dt>
              <span className={`validation-status-pill validation-status-${definition.status}`}>
                {definition.status}
              </span>
            </dt>
            <dd>
              <strong>{definition.meaning}</strong>
              <span>{definition.rule}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p>
        Target bands vary in width, so a pass can still sit some way from the empirical target. Rows
        say so when that happens.
      </p>
    </aside>
  );
}

function MetricRow({
  metric,
  comparisonMetric,
  versionLabels
}: {
  metric: ValidationMetricSummary;
  comparisonMetric?: ValidationMetricSummary | null;
  versionLabels?: { selected: string; comparison: string };
}) {
  const positions = calculateValidationRangePositions(metric);
  const comparisonPositions = comparisonMetric ? calculateValidationRangePositions(comparisonMetric) : null;
  // Two band-width cautions in one row is noise, so the advisory is single-mode only.
  const bandNote = comparisonMetric ? null : buildBandWidthNote(metric, positions.deviationPercent);
  return (
    <details id={`validation-metric-${metric.metricId}`} className={`validation-metric-row validation-metric-${metric.status}`}>
      <summary>
        <div className="validation-metric-title">
          <strong>{metric.label}</strong>
          <span>{displayUnits(metric) || 'Unitless'}</span>
          {/* In compare mode each model carries its own pill beside its own figure, so a lone pill
              here would read as a verdict on the whole row rather than on the selected model. */}
          {!comparisonMetric && (
            <span className={`validation-status-pill validation-status-${metric.status}`}>{metric.status}</span>
          )}
        </div>
        <MetricRange
          metric={metric}
          positions={positions}
          comparisonPositions={comparisonPositions}
          comparisonLabel={versionLabels?.comparison}
        />
        {comparisonMetric && comparisonPositions ? (
          <div className="validation-row-deviation validation-row-deviation-compare">
            <span className="validation-series-label">
              <em className="validation-series-key validation-series-key-selected" />
              {versionLabels?.selected}
            </span>
            <strong>{formatDeviation(positions.deviationPercent)}</strong>
            <span className={`validation-status-pill validation-status-${metric.status}`}>{metric.status}</span>
            <span className="validation-series-label">
              <em className="validation-series-key validation-series-key-comparison" />
              {versionLabels?.comparison}
            </span>
            <strong>{formatDeviation(comparisonPositions.deviationPercent)}</strong>
            <span className={`validation-status-pill validation-status-${comparisonMetric.status}`}>
              {comparisonMetric.status}
            </span>
          </div>
        ) : (
          <div className="validation-row-deviation">
            <span>Off target</span>
            <strong>{formatDeviation(positions.deviationPercent)}</strong>
          </div>
        )}
        <div className={comparisonMetric ? 'validation-row-loss validation-row-loss-compare' : 'validation-row-loss'}>
          <span>Loss</span>
          <strong>{formatLoss(metric.metricLoss)}</strong>
          {comparisonMetric && <strong>{formatLoss(comparisonMetric.metricLoss)}</strong>}
        </div>
      </summary>
      {bandNote && <p className="validation-band-note">{bandNote}</p>}
      <div className="validation-metric-detail">
        <dl>
          <div><dt>Exact target</dt><dd>{withUnits(metric.sourceValue, displayUnits(metric))}</dd></div>
          <div><dt>Target band</dt><dd>{formatBand(metric)}</dd></div>
          <div><dt>Simulated mean</dt><dd>{withUnits(metric.seedMean, displayUnits(metric), 3)}</dd></div>
          <div><dt>Simulated IQR</dt><dd>{withUnits(metric.p25, displayUnits(metric), 3)} to {withUnits(metric.p75, displayUnits(metric), 3)}</dd></div>
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
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedVersion = searchParams.get('version')?.trim() ?? '';
  const requestedEvidenceYear = Number(searchParams.get('evidenceYear'));
  // Only offered when the analyst arrived from a setup form, so this reads as a return trip
  // rather than an unexplained call to action for someone browsing validation on its own.
  const returnSource = searchParams.get('from')?.trim() ?? '';
  const draftId = returnSource === 'scenario' ? searchParams.get('draft')?.trim() ?? '' : '';
  const isScenarioContext = Boolean(draftId && readScenarioDraft(draftId));
  const scenarioReturnStep = searchParams.get('scenarioStep') === 'model-version' ? '&step=model-version' : '';
  const returnDestination = returnSource === 'scenario'
    ? (isScenarioContext ? RETURN_DESTINATIONS.scenario : null)
    : RETURN_DESTINATIONS[returnSource] ?? null;
  const [overview, setOverview] = useState<ValidationOverviewPayload | null>(null);
  const [selectedVersion, setSelectedVersion] = useState(requestedVersion);
  const [selectedValidationTargetYear, setSelectedValidationTargetYear] = useState(
    Number.isFinite(requestedEvidenceYear) && requestedEvidenceYear > 0
      ? requestedEvidenceYear
      : DEFAULT_VALIDATION_TARGET_YEAR
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isWaitingForApi, setIsWaitingForApi] = useState(false);
  const [error, setError] = useState('');
  const [inProgressVersions, setInProgressVersions] = useState<string[]>([]);
  const [selectionNotice, setSelectionNotice] = useState('');
  // Comparison is a state of this view, not a separate page: picking a second model switches the
  // body into compare mode, exactly as `comparisonRunId` does on the scenario results view.
  const [comparisonVersion, setComparisonVersion] = useState(searchParams.get('comparisonVersion')?.trim() ?? '');
  const [isComparisonPickerOpen, setIsComparisonPickerOpen] = useState(Boolean(comparisonVersion));
  const [sortMetricId, setSortMetricId] = useState('');

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    const load = async () => {
      setIsLoading(true);
      setIsWaitingForApi(false);
      setError('');
      try {
        const [response, versions] = await Promise.all([
          fetchValidationOverview(selectedVersion || undefined, selectedValidationTargetYear, comparisonVersion || undefined),
          fetchVersions()
        ]);
        if (cancelled) return;
        const requestedCombinationChanged =
          (selectedVersion.length > 0 && response.selectedVersion !== selectedVersion) ||
          response.selectedValidationTargetYear !== selectedValidationTargetYear;
        setSelectionNotice(requestedCombinationChanged
          ? 'That model and evidence-year combination is unavailable. Showing the nearest available validation evidence.'
          : '');
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
        if (selectedVersion) {
          setSelectionNotice('That model version has no published validation evidence. Showing the latest available validated model.');
          setSelectedVersion('');
          setSelectedValidationTargetYear(DEFAULT_VALIDATION_TARGET_YEAR);
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
  }, [selectedVersion, selectedValidationTargetYear, comparisonVersion]);

  useEffect(() => {
    if (!overview) return;
    // Preserve params this page does not own (notably `from`, which drives the return-to-setup
    // bar) — rebuilding from scratch silently dropped them as soon as the overview loaded.
    const next = new URLSearchParams(searchParams);
    next.set('version', selectedVersion);
    next.set('evidenceYear', String(selectedValidationTargetYear));
    if (comparisonVersion) next.set('comparisonVersion', comparisonVersion);
    else next.delete('comparisonVersion');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [comparisonVersion, overview, searchParams, selectedValidationTargetYear, selectedVersion, setSearchParams]);

  const summary = overview?.selectedSummary ?? null;
  const inProgressSet = useMemo(() => new Set(inProgressVersions), [inProgressVersions]);
  const versionLabel = (version: string) => formatModelName(version);
  // Selection is limited to the four named models; the trend charts below still plot every
  // version, because that series is the recalibration trajectory rather than a set of choices.
  const orderedVersions = useMemo(
    () => buildModelOptions(overview?.availableVersions ?? [], selectedVersion, inProgressSet).map((option) => option.version),
    [overview, selectedVersion, inProgressSet]
  );
  const scorecard = useMemo(() => buildValidationScorecard(summary?.metrics ?? []), [summary]);
  const decomposition = useMemo(() => buildValidationLossDecomposition(summary?.metrics ?? []), [summary]);
  // Both builders are pure functions of a metrics array, so the second model reuses them as-is.
  const comparisonSummary = overview?.comparisonSummary ?? null;
  const comparisonScorecard = useMemo(
    () => buildValidationScorecard(comparisonSummary?.metrics ?? []),
    [comparisonSummary]
  );
  const comparisonDecomposition = useMemo(
    () => (comparisonSummary ? buildValidationLossDecomposition(comparisonSummary.metrics) : null),
    [comparisonSummary]
  );
  const comparisonMetricById = useMemo(
    () => new Map((comparisonSummary?.metrics ?? []).map((metric) => [metric.metricId, metric])),
    [comparisonSummary]
  );
  const largestComparisonDifferences = useMemo(() => {
    if (!comparisonSummary) return [];
    return summary?.metrics
      .flatMap((metric) => {
        const comparisonMetric = comparisonMetricById.get(metric.metricId);
        if (metric.metricLoss === null || comparisonMetric?.metricLoss === null || comparisonMetric?.metricLoss === undefined) {
          return [];
        }
        return [{ metric, difference: comparisonMetric.metricLoss - metric.metricLoss }];
      })
      .sort((left, right) => Math.abs(right.difference) - Math.abs(left.difference))
      .slice(0, 3) ?? [];
  }, [comparisonMetricById, comparisonSummary, summary]);
  // const chart2024 = useMemo(() => (overview ? buildTrendOption(overview, 2024, versionLabel) : null), [overview]);
  // const chart2011 = useMemo(() => (overview ? buildTrendOption(overview, 2011, versionLabel) : null), [overview]);
  const metricsByVersion = overview?.metricsByVersion ?? {};
  /** Indicator list in theme order, labelled from the selected summary (all models share ids). */
  const sortableMetrics = useMemo(() => {
    const labelById = new Map((summary?.metrics ?? []).map((metric) => [metric.metricId, metric.label]));
    return VALIDATION_POLICY_THEMES.flatMap((theme) =>
      theme.metricIds.flatMap((metricId) => {
        const label = labelById.get(metricId);
        return label ? [{ metricId, label }] : [];
      })
    );
  }, [summary]);
  // Keep every named model visible. The ranking helper places a model with no value for the
  // selected indicator at the end instead of making that row disappear from either column.
  const rankedVersions = useMemo(
    () => (sortMetricId ? rankVersionsByMetric(metricsByVersion, orderedVersions, sortMetricId) : null),
    [sortMetricId, metricsByVersion, orderedVersions]
  );
  const pickerVersions = rankedVersions ? rankedVersions.map((entry) => entry.version) : orderedVersions;
  const evidenceContext = isScenarioContext ? `&from=scenario&draft=${encodeURIComponent(draftId)}&scenarioStep=model-version` : '';
  const calibrationPageHref = comparisonVersion
    ? `/model-evidence?view=calibration&mode=compare&left=${encodeURIComponent(selectedVersion)}&right=${encodeURIComponent(comparisonVersion)}${evidenceContext}`
    : `/model-evidence?view=calibration&mode=single&version=${encodeURIComponent(selectedVersion)}${evidenceContext}`;

  const selectVersionAndValidationYear = (version: string, year: number) => {
    setSelectedVersion(version);
    setSelectedValidationTargetYear(year);
  };
  const handleVersionChange = (version: string) => {
    const years = overview?.availableValidationTargetYearsByVersion[version] ?? [DEFAULT_VALIDATION_TARGET_YEAR];
    if (version === comparisonVersion) setComparisonVersion('');
    selectVersionAndValidationYear(version, years.includes(selectedValidationTargetYear) ? selectedValidationTargetYear : 2024);
  };
  // const handleChartClick = (year: 2024 | 2011) => (raw: unknown) => {
  //   const point = raw as { name?: string };
  //   if (point?.name) selectVersionAndValidationYear(point.name, year);
  // };
  const openMetricDiagnostic = (metricId: string) => {
    const row = document.getElementById(`validation-metric-${metricId}`);
    if (!(row instanceof HTMLDetailsElement)) return;
    row.open = true;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.querySelector('summary')?.focus({ preventScroll: true });
  };

  return (
    <section className="validation-layout">
      {selectedVersion && returnDestination && (
        <div className="validation-return-bar">
          {isScenarioContext ? <>
            <p>You are checking validation evidence for an unfinished policy scenario. Choose whether to keep its current model or use the model selected here.</p>
            <div>
              <Link className="secondary-button" to={`/calibration?mode=single&version=${encodeURIComponent(selectedVersion)}${evidenceContext}`}>View calibration assumptions</Link>
              <Link className="secondary-button" to={`${returnDestination.path}?draft=${encodeURIComponent(draftId)}${scenarioReturnStep}`}>Return without changing model</Link>
              <Link className="primary-button" onClick={() => updateScenarioDraftModel(draftId, selectedVersion)} to={`${returnDestination.path}?draft=${encodeURIComponent(draftId)}${scenarioReturnStep}`}>Use {formatModelName(selectedVersion)} and return to scenario</Link>
            </div>
          </> : <>
            <p>Comparing models for your {returnDestination.noun}. Pick the one whose scores you trust, then take it back to the setup form.</p>
            <Link className="primary-button" to={`${returnDestination.path}?baseline=${encodeURIComponent(selectedVersion)}`}>Use {selectedVersion} and return to setup</Link>
          </>}
        </div>
      )}
      <article className="results-card validation-introduction">
        <div className="validation-introduction-top">
          <div className="validation-introduction-copy">
            <h2>Validation</h2>
            <p>Compare the selected model with independent UK evidence, see which outcomes are credible or problematic, and check whether results hold across random seeds.</p>
            <p className="validation-protocol-note">
              Validation uses a fixed ten-seed, 3,500-step protocol; the first 500 steps are discarded. Runs launched on the Experiments page do not update these validation results.
            </p>
            <p className="validation-evidence-statement">
              The evidence used to validate this model was from <strong>{selectedValidationTargetYear}</strong>.
            </p>
            <p className="validation-calibration-guidance">
              If you want to understand the difference between two models, visit the{' '}
              <Link to={calibrationPageHref}>calibration page</Link>.
            </p>
          </div>
          <ValidationStatusLegend />
        </div>

        <div className="validation-model-picker-toolbar">
          <label className="validation-selector">
            <span>Sort models by</span>
            <select value={sortMetricId} onChange={(event) => setSortMetricId(event.target.value)}>
              <option value="">Version order</option>
              {sortableMetrics.map((metric) => (
                <option key={metric.metricId} value={metric.metricId}>{metric.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="validation-model-columns-scroll">
          <div className="validation-model-columns" aria-label="Validation model selection">
            <section className="validation-model-column" aria-labelledby="validation-primary-model-heading">
              <div className="validation-model-column-heading">
                <div>
                  <span>Model 1</span>
                  <h3 id="validation-primary-model-heading">Primary model</h3>
                </div>
              </div>
              <ValidationModelOptions
                versions={pickerVersions}
                selectedVersion={selectedVersion}
                name="validation-primary-model"
                label="Primary validation model"
                rankings={rankedVersions}
                inProgressVersions={inProgressSet}
                onChange={handleVersionChange}
              />
            </section>

            <section
              className={`validation-model-column validation-model-column-comparison ${isComparisonPickerOpen ? 'is-enabled' : 'is-disabled'}`}
              aria-labelledby="validation-comparison-model-heading"
              aria-disabled={!isComparisonPickerOpen}
            >
              <div className="validation-model-column-heading">
                <div>
                  <span>Model 2</span>
                  <h3 id="validation-comparison-model-heading">Comparison model</h3>
                </div>
                <label className="comparison-enable-toggle validation-comparison-enable-toggle">
                  <input
                    type="checkbox"
                    checked={isComparisonPickerOpen}
                    onChange={(event) => {
                      setIsComparisonPickerOpen(event.target.checked);
                      if (!event.target.checked) setComparisonVersion('');
                    }}
                  />
                  <span>Compare</span>
                </label>
              </div>
              <ValidationModelOptions
                versions={pickerVersions}
                selectedVersion={comparisonVersion}
                name="validation-comparison-model"
                label="Comparison validation model"
                rankings={rankedVersions}
                disabled={!isComparisonPickerOpen}
                unavailableVersion={selectedVersion}
                inProgressVersions={inProgressSet}
                onChange={setComparisonVersion}
              />
              <small className="validation-selector-note">
                {isComparisonPickerOpen
                  ? comparisonVersion ? 'One model selected for comparison.' : 'Choose one model to compare with the primary model.'
                  : 'Check Compare to enable this column.'}
              </small>
            </section>
          </div>
        </div>
      </article>

      {selectionNotice && <p className="info-banner">{selectionNotice}</p>}
      {error && <p className="error-banner">Unable to load validation results: {error}</p>}
      {isWaitingForApi && <p className="waiting-banner">Waiting for the API. Retrying every 2 seconds…</p>}
      {isLoading && !summary && <p className="loading-banner">Loading validation overview…</p>}

      {summary && (
        <>
          <article className="results-card">
            <div className="validation-overview-header">
              <div>
                <h3>
                  {comparisonSummary
                    ? `${summary.version} compared with ${comparisonSummary.version}`
                    : `${versionLabel(summary.version)} scorecard`}
                </h3>
                <p>{summary.validationTargetYear} UK evidence · conclusions across ten fixed seeds</p>
              </div>
            </div>
            {!comparisonSummary && (
              <div className="kpi-grid validation-scorecard-grid">
                <div className="kpi-card validation-composite-card">
                  <span>Comparative validation loss — lower is better</span>
                  <strong>{formatNumber(summary.overallCompositeLoss, 4)}</strong>
                  <small>Unweighted mean of {summary.metrics.length} metric losses — see the breakdown below.</small>
                </div>
                {(['pass', 'warn', 'fail', 'unsupported'] as const).map((status) => (
                  <div className={`kpi-card validation-count-card validation-metric-${status}`} key={status}>
                    <span>{status}</span>
                    <strong>{scorecard.counts[status]}</strong>
                    <small>metrics</small>
                  </div>
                ))}
                <div className="kpi-card">
                  <span>Average seeds inside target bands</span>
                  <strong>{formatInsideRate(scorecard.averageInsideRate)}</strong>
                  <small>Unsupported metrics excluded</small>
                </div>
              </div>
            )}
            {comparisonSummary && (
              <div className="validation-score-comparison-wrap">
                <table className="policy-results-table validation-score-comparison-table">
                  <thead>
                    <tr>
                      <th scope="col">Summary</th>
                      <th scope="col">{formatModelWithVersion(summary.version)}</th>
                      <th scope="col">{formatModelWithVersion(comparisonSummary.version)}</th>
                      <th scope="col">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Validation loss <small>Lower is better</small></th>
                      <td>{formatNumber(summary.overallCompositeLoss, 4)}</td>
                      <td>{formatNumber(comparisonSummary.overallCompositeLoss, 4)}</td>
                      <td>{formatDelta(comparisonSummary.overallCompositeLoss - summary.overallCompositeLoss)}</td>
                    </tr>
                    {(['pass', 'warn', 'fail', 'unsupported'] as const).map((status) => (
                      <tr key={status}>
                        <th scope="row"><span className={`validation-status-pill validation-status-${status}`}>{status}</span></th>
                        <td>{scorecard.counts[status]}</td>
                        <td>{comparisonScorecard.counts[status]}</td>
                        <td>{formatStatusCountDifference(status, scorecard.counts[status], comparisonScorecard.counts[status])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="validation-loss-decomposition">
              <h4>Where this model&rsquo;s error sits</h4>
              <p className="validation-card-subtitle">
                Each theme&rsquo;s share of the total metric loss. A <strong>smaller</strong> share means this model version fits
                the 2024 evidence better for that group of indicators.
              </p>
              <ol className="validation-decomposition-list">
                {decomposition.themes.map((theme) => {
                  const comparisonTheme = comparisonDecomposition?.themes.find((item) => item.id === theme.id) ?? null;
                  return (
                    <li key={theme.id}>
                      <span className="validation-decomposition-title">{theme.title}</span>
                      <span className="validation-decomposition-track">
                        <span
                          className="validation-decomposition-bar"
                          style={{ width: `${Math.max(1, theme.share * 100)}%`, background: BASELINE_COLOR }}
                        />
                        {comparisonTheme && (
                          <span
                            className="validation-decomposition-bar validation-decomposition-bar-comparison"
                            style={{ width: `${Math.max(1, comparisonTheme.share * 100)}%`, background: COMPARISON_COLOR }}
                          />
                        )}
                      </span>
                      <strong>
                        {formatNumber(theme.share * 100, 1)}%
                        {comparisonTheme && <em>{formatNumber(comparisonTheme.share * 100, 1)}%</em>}
                      </strong>
                    </li>
                  );
                })}
              </ol>
              {decomposition.themes.length > 1 && (
                <p className="validation-decomposition-summary">
                  Largest share of error: <strong>{decomposition.themes[0].title}</strong>. Smallest:{' '}
                  <strong>{decomposition.themes[decomposition.themes.length - 1].title}</strong>.
                </p>
              )}
            </div>
            <div className="validation-largest-gaps">
              <h4>{comparisonSummary ? 'Biggest differences between models' : 'Largest validation gaps'}</h4>
              {comparisonSummary && (
                <p className="validation-card-subtitle">
                  How {formatModelWithVersion(comparisonSummary.version)} changes metric loss relative to{' '}
                  {formatModelWithVersion(summary.version)}. Lower loss is better.
                </p>
              )}
              {comparisonSummary ? (
                largestComparisonDifferences.length > 0 ? (
                  <ol>{largestComparisonDifferences.map(({ metric, difference }) => (
                    <li key={metric.metricId}>
                      <button type="button" onClick={() => openMetricDiagnostic(metric.metricId)}>
                        <span>{metric.label}</span>
                        <strong className={difference < 0 ? 'validation-gap-improved' : difference > 0 ? 'validation-gap-worsened' : ''}>
                          {difference < 0 ? 'Improves' : difference > 0 ? 'Worsens' : 'No change'} {difference === 0 ? '' : `${formatLoss(Math.abs(difference))} loss`}
                        </strong>
                      </button>
                    </li>
                  ))}</ol>
                ) : <p>No comparable metric losses are available.</p>
              ) : scorecard.largestGaps.length > 0 ? (
                <ol>{scorecard.largestGaps.map((metric) => (
                  <li key={metric.metricId}>
                    <button type="button" onClick={() => openMetricDiagnostic(metric.metricId)}>
                      <span>{metric.label}</span><strong>{formatLoss(metric.metricLoss)}</strong>
                    </button>
                  </li>
                ))}</ol>
              ) : <p>No supported metric losses are available.</p>}
            </div>
          </article>

          {/*
            Temporarily hidden from the analyst-facing Validation page. The full chart code is
            retained here in case it is later reused as a secondary model-development history view.

          <article className="results-card">
            {selectedValidationTargetYear === 2011 ? (
              <>
                <h3>{REFERENCE_VALIDATION_SERIES_NAME}</h3>
                <p className="validation-card-subtitle">
                  Historical reference points for v0, v0o2, and v0o7. This is not a continuation of the 2024 timeline.
                  Click a point to inspect that model, or switch Evidence year to 2024 for the recalibration trend.
                </p>
                {chart2011 ? <EChart option={chart2011} className="chart validation-chart" onClick={handleChartClick(2011)} /> : <p className="info-banner">No 2011 reference points are available.</p>}
              </>
            ) : (
              <>
                <h3>Models tested against 2024 UK evidence</h3>
                <p className="validation-card-subtitle">Main recalibration trend. Click a point to inspect that model against 2024 evidence.</p>
                {chart2024 ? <EChart option={chart2024} className="chart validation-chart" onClick={handleChartClick(2024)} /> : <p className="info-banner">No 2024 trend is available.</p>}
              </>
            )}
          </article>
          */}

          <article className="results-card">
            <div className="validation-overview-header">
              <div>
                <h3>Outcome diagnostics</h3>
                <p>
                  All metrics share one axis: how far the simulated mean sits from the empirical target, as a
                  percentage. Beyond &plusmn;100% the marker is pinned to the edge and the exact figure is shown.
                </p>
              </div>
            </div>
            <div className="validation-range-legend" aria-label="Range graphic legend">
              <span className="legend-source">Empirical target (0% off)</span>
              <span className="legend-target">Target band</span>
              <span className="legend-iqr">Simulated IQR</span>
              <span className="legend-mean">Simulated mean</span>
            </div>
            {VALIDATION_POLICY_THEMES.map((theme) => {
              const metricMap = new Map(summary.metrics.map((metric) => [metric.metricId, metric]));
              const metrics = theme.metricIds.flatMap((metricId) => {
                const metric = metricMap.get(metricId);
                return metric ? [metric] : [];
              });
              // Metrics with no single empirical target (JSD distribution comparisons) cannot carry a
              // percentage deviation, so they are kept apart rather than shown on an axis that lies about them.
              const scaled = metrics.filter((metric) => calculateValidationRangePositions(metric).scaled);
              const shapeOnly = metrics.filter((metric) => !calculateValidationRangePositions(metric).scaled);
              return (
                <section className="validation-theme" key={theme.id}>
                  <h4>{theme.title}</h4>
                  {metrics.length === 0 && <p className="info-banner">No metrics available for this theme.</p>}
                  {scaled.map((metric) => <MetricRow
                      metric={metric}
                      comparisonMetric={comparisonMetricById.get(metric.metricId) ?? null}
                      versionLabels={comparisonSummary ? { selected: summary.version, comparison: comparisonSummary.version } : undefined}
                      key={metric.metricId}
                    />)}
                  {shapeOnly.length > 0 && (
                    <div className="validation-subgroup">
                      <h5>Distribution shape — no single target value</h5>
                      <p className="validation-card-subtitle">
                        Scored by how closely the whole simulated distribution matches the empirical one, so there
                        is no percentage to be off by. Compare these by loss.
                      </p>
                      {shapeOnly.map((metric) => <MetricRow
                      metric={metric}
                      comparisonMetric={comparisonMetricById.get(metric.metricId) ?? null}
                      versionLabels={comparisonSummary ? { selected: summary.version, comparison: comparisonSummary.version } : undefined}
                      key={metric.metricId}
                    />)}
                    </div>
                  )}
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
                        <span>{displayUnits(metric) || 'Unitless'}</span>
                        <span className={`validation-status-pill validation-status-${metric.status}`}>{metric.status}</span>
                      </div>
                    </td>
                    <td>
                      <div className="validation-table-value">
                        <strong>{withUnits(metric.sourceValue, displayUnits(metric))}</strong>
                        <span>Band: {formatBand(metric)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="validation-table-value">
                        <strong>Mean: {withUnits(metric.seedMean, displayUnits(metric), 3)}</strong>
                        <span>IQR: {withUnits(metric.p25, displayUnits(metric), 3)} to {withUnits(metric.p75, displayUnits(metric), 3)}</span>
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
