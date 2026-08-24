// Author: Max Stoddard
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
// import type { EChartsOption } from 'echarts'; // Retained for the temporarily hidden trend chart below.
import { Link, useSearchParams } from 'react-router-dom';
import type {
  ValidationMetricComparisonPoint,
  ValidationMetricStatus,
  ValidationMetricSummary,
  ValidationOverviewPayload,
  ValidationVersionSummary
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
  getDefaultModelVersion,
  formatModelName,
  formatModelSubtitle
} from '../lib/modelAnchors';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { EvidenceReturnPanel } from '../components/EvidenceReturnPanel';
import { BASELINE_COLOR, COMPARISON_COLOR } from '../lib/manualOverlayChartOption';
import { readScenarioDraft, updateScenarioDraftModel } from '../lib/scenarioDraft';
import { readSensitivityDraft, updateSensitivityDraftModel } from '../lib/sensitivityDraft';

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

function formatFixedNumber(value: number | null, digits: number): string {
  if (value === null || !Number.isFinite(value)) return 'Unsupported';
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

/**
 * `sourceValue`, `seedMean` and the target band are expressed in `comparisonUnits`
 * (e.g. 62.86 "thousand count/month"), while `units` describes the raw model scale.
 * Rendering the raw units against a rescaled value understates figures by 1000x.
 */
function displayUnits(metric: ValidationMetricSummary): string {
  return metric.comparisonUnits || metric.units || '';
}

function metricValueDigits(metric: ValidationMetricSummary, column: 'target' | 'simulation'): number {
  if (column === 'simulation') return 3;
  const units = displayUnits(metric).toLowerCase();
  return metric.lossFamily === 'bounded_low_is_better' || units === 'ratio' || units === 'rebased index' ? 3 : 2;
}

function formatMetricValue(
  metric: ValidationMetricSummary,
  value: number | null,
  column: 'target' | 'simulation'
): string {
  return formatFixedNumber(value, metricValueDigits(metric, column));
}

function formatTargetBand(metric: ValidationMetricSummary): string {
  return metric.targetBand
    ? `${formatMetricValue(metric, metric.targetBand.lower, 'target')}–${formatMetricValue(metric, metric.targetBand.upper, 'target')}`
    : 'Unsupported';
}

function formatSimulatedIqr(metric: ValidationMetricSummary): string {
  return `${formatMetricValue(metric, metric.p25, 'simulation')}–${formatMetricValue(metric, metric.p75, 'simulation')}`;
}

function formatInsideRate(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'Unsupported' : `${formatFixedNumber(value * 100, 1)}%`;
}

function formatLoss(value: number | null): string {
  return formatFixedNumber(value, 4);
}

function formatModelWithVersion(version: string): string {
  const name = formatModelName(version);
  return name === version ? version : `${name} (${version})`;
}

export function formatValidationScorecardValue(
  primary: string | number,
  comparison?: string | number | null
): string {
  return comparison === null || comparison === undefined ? String(primary) : `${primary} vs ${comparison}`;
}

export function formatValidationSnapshotProtocol(
  summary: Pick<ValidationVersionSummary, 'seeds' | 'window'>
): string {
  const seedCount = summary.seeds.length;
  return `${seedCount} ${seedCount === 1 ? 'seed' : 'seeds'}, aggregation window steps ${formatNumber(
    summary.window.startIndex,
    0
  )}–${formatNumber(summary.window.endIndex, 0)}`;
}

const WIDE_BAND_DEVIATION = 25;
const NARROW_BAND_DEVIATION = 5;

function toDeviationPercent(value: number, source: number): number {
  return ((value - source) / Math.abs(source)) * 100;
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
  return metric.lossFamily ? labels[metric.lossFamily] : 'Not applicable';
}

function lossTransformDescription(metric: ValidationMetricSummary): string | null {
  if (!metric.lossTransform) return null;
  const description = metric.lossTransform.replaceAll('_', ' ');
  return `${description.charAt(0).toUpperCase()}${description.slice(1)}`;
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
  return `${percent > 0 ? '+' : percent < 0 ? '−' : ''}${formatFixedNumber(Math.abs(percent), 1)}%`;
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
 * What pass / warn / fail / unsupported actually mean, stated once for the whole page — the words
 * appear on the scorecard counts and on every metric row in the section tables.
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

/**
 * The collapsed summary for a theme: what its metrics scored, most severe first. This is what makes
 * a collapsed theme worth reading rather than just something to click open.
 */
export function describeThemeStatuses(metrics: Pick<ValidationMetricSummary, 'status'>[]): string {
  if (metrics.length === 0) {
    return 'No metrics';
  }
  const order: ValidationMetricStatus[] = ['fail', 'warn', 'pass', 'unsupported'];
  return order
    .map((status) => ({ status, count: metrics.filter((metric) => metric.status === status).length }))
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.count}/${metrics.length} ${entry.status}`)
    .join(' \u00b7 ');
}

export function findValidationThemeId(metricId: string): string | null {
  return VALIDATION_POLICY_THEMES.find((theme) =>
    theme.metricIds.some((themeMetricId) => themeMetricId === metricId)
  )?.id ?? null;
}

/**
 * Only analytically meaningful rankings are sortable. Ranking metrics by the magnitude of an
 * empirical quantity carries no analytic meaning, and sorting a range is ambiguous between its
 * lower bound and its width.
 */
export type ValidationMetricSortKey = 'metric' | 'offTarget' | 'insideRate' | 'loss';

export type ValidationMetricSortDirection = 'ascending' | 'descending';

export interface ValidationMetricSort {
  key: ValidationMetricSortKey;
  direction: ValidationMetricSortDirection;
}

export const DEFAULT_VALIDATION_METRIC_SORT: ValidationMetricSort = {
  key: 'loss',
  direction: 'descending'
};

function numericSortValues(metric: ValidationMetricSummary, key: Exclude<ValidationMetricSortKey, 'metric'>): (number | null)[] {
  switch (key) {
    case 'offTarget': return [metricDeviationPercent(metric)];
    case 'insideRate': return [metric.insideRate];
    case 'loss': return [metric.metricLoss];
  }
}

function compareNumericValues(
  left: number | null,
  right: number | null,
  direction: ValidationMetricSortDirection
): number {
  const hasLeft = left !== null && Number.isFinite(left);
  const hasRight = right !== null && Number.isFinite(right);
  if (!hasLeft && !hasRight) return 0;
  if (!hasLeft) return 1;
  if (!hasRight) return -1;
  const difference = (left as number) - (right as number);
  return direction === 'ascending' ? difference : -difference;
}

/** Stable, section-local ordering used by every validation metric table. */
export function sortValidationMetrics(
  metrics: readonly ValidationMetricSummary[],
  sort: ValidationMetricSort = DEFAULT_VALIDATION_METRIC_SORT
): ValidationMetricSummary[] {
  return metrics
    .map((metric, originalIndex) => ({ metric, originalIndex }))
    .sort((left, right) => {
      let comparison = 0;
      if (sort.key === 'metric') {
        comparison = left.metric.label.localeCompare(right.metric.label, 'en-GB', { sensitivity: 'base' });
        if (sort.direction === 'descending') comparison = -comparison;
      } else {
        const leftValues = numericSortValues(left.metric, sort.key);
        const rightValues = numericSortValues(right.metric, sort.key);
        for (let index = 0; index < Math.max(leftValues.length, rightValues.length); index += 1) {
          comparison = compareNumericValues(leftValues[index] ?? null, rightValues[index] ?? null, sort.direction);
          if (comparison !== 0) break;
        }
      }
      return comparison || left.originalIndex - right.originalIndex;
    })
    .map(({ metric }) => metric);
}

function SortableMetricHeader({
  label,
  sortKey,
  sort,
  numeric = false,
  unit,
  onSort
}: {
  label: string;
  sortKey: ValidationMetricSortKey;
  sort: ValidationMetricSort;
  numeric?: boolean;
  unit?: string | null;
  onSort: (key: ValidationMetricSortKey) => void;
}) {
  const isSorted = sort.key === sortKey;
  const nextDirection: ValidationMetricSortDirection = isSorted && sort.direction === 'ascending' ? 'descending' : 'ascending';
  return (
    <th
      scope="col"
      className={numeric ? 'validation-numeric' : undefined}
      aria-sort={isSorted ? sort.direction : undefined}
    >
      <button
        type="button"
        className="validation-sort-button"
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${label}, ${nextDirection}`}
      >
        <span className="validation-sort-label">
          <span>{label}</span>
          {unit && <small>{unit}</small>}
        </span>
        <span className="validation-sort-indicator" aria-hidden="true">
          {isSorted ? (sort.direction === 'ascending' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );
}

function ModelValues({
  primary,
  comparison,
  versionLabels
}: {
  primary: ReactNode;
  comparison?: ReactNode;
  versionLabels?: { selected: string; comparison: string };
}) {
  if (comparison === undefined || !versionLabels) return <>{primary}</>;
  return (
    <span className="validation-model-values">
      <span><small>{versionLabels.selected}</small><span>{primary}</span></span>
      <span><small>{versionLabels.comparison}</small><span>{comparison}</span></span>
    </span>
  );
}

export function hasMetricProvenance(metric: ValidationMetricSummary): boolean {
  return Boolean(
    metric.sourceLabel.trim() ||
    metric.sourceReferences.length > 0 ||
    metric.sourceDocumentPath ||
    metric.sourceTextPath ||
    metric.bandNotes
  );
}

export interface ValidationMetricDetailState {
  metric: ValidationMetricSummary;
  trigger: HTMLButtonElement | null;
  showBandNote: boolean;
}

export const VALIDATION_METRIC_DETAILS_PANEL_ID = 'validation-metric-details-panel';

export function ValidationMetricDetailsPanel({
  detail,
  onClose
}: {
  detail: ValidationMetricDetailState;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const headingId = `validation-metric-details-heading-${detail.metric.metricId}`;
  const deviationPercent = metricDeviationPercent(detail.metric);
  const bandNote = detail.showBandNote ? buildBandWidthNote(detail.metric, deviationPercent) : null;

  const closeAndRestoreFocus = () => {
    onClose();
    window.requestAnimationFrame(() => {
      if (detail.trigger?.isConnected) detail.trigger.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, [detail.metric.metricId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeAndRestoreFocus();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || panelRef.current?.contains(target) || detail.trigger?.contains(target)) return;
      // A different row's click replaces this panel; its click handler owns the new focus target.
      if (target instanceof Element && target.closest('[data-validation-detail-trigger]')) return;
      closeAndRestoreFocus();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  });

  return (
    <aside
      ref={panelRef}
      id={VALIDATION_METRIC_DETAILS_PANEL_ID}
      className="validation-metric-details-panel"
      role="dialog"
      aria-labelledby={headingId}
      tabIndex={-1}
    >
      <div className="validation-metric-details-head">
        <h3 id={headingId}>{detail.metric.label}</h3>
        <button
          type="button"
          className="validation-metric-details-close"
          aria-label={`Close details for ${detail.metric.label}`}
          onClick={closeAndRestoreFocus}
        >
          ×
        </button>
      </div>
      <div className="validation-metric-detail">
        <dl>
          <div className="validation-loss-family-detail">
            <dt>Loss family</dt>
            <dd>
              <strong>{lossFamilyDescription(detail.metric)}</strong>
              {lossTransformDescription(detail.metric) && (
                <small><span>Transform</span>{lossTransformDescription(detail.metric)}</small>
              )}
            </dd>
          </div>
        </dl>
        <section className="validation-source-section" aria-label="Sources and provenance">
          <h5>Sources and provenance</h5>
          <div className="validation-source-panel">
            <strong>{detail.metric.sourceLabel}</strong>
            {buildDeduplicatedSourceReferences(detail.metric).map((reference) => (
              <span key={reference.key} title={reference.notes ?? undefined}>{reference.label}</span>
            ))}
            {detail.metric.lossScale !== null && <span>Loss scale: {formatNumber(detail.metric.lossScale, 4)} ({detail.metric.lossScaleBasis?.replaceAll('_', ' ')})</span>}
            {detail.metric.additiveScale !== null && <span>Additive scale: {formatNumber(detail.metric.additiveScale, 4)} ({detail.metric.additiveScaleBasis?.replaceAll('_', ' ')})</span>}
            {detail.metric.bandNotes && <span>{detail.metric.bandNotes}</span>}
          </div>
        </section>
        {bandNote && <p className="validation-band-note">{bandNote}</p>}
      </div>
    </aside>
  );
}

export function ValidationMetricTable({
  themeTitle,
  metrics,
  comparisonMetrics,
  versionLabels,
  activeMetricId = null,
  onOpenDetails,
  onCloseDetails
}: {
  themeTitle: string;
  metrics: readonly ValidationMetricSummary[];
  comparisonMetrics?: ReadonlyMap<string, ValidationMetricSummary>;
  versionLabels?: { selected: string; comparison: string };
  activeMetricId?: string | null;
  onOpenDetails?: (metric: ValidationMetricSummary, trigger: HTMLButtonElement) => void;
  onCloseDetails?: () => void;
}) {
  const [sort, setSort] = useState<ValidationMetricSort>(DEFAULT_VALIDATION_METRIC_SORT);
  const sortedMetrics = useMemo(() => sortValidationMetrics(metrics, sort), [metrics, sort]);
  const unitLabels = new Set(metrics.map((metric) => displayUnits(metric) || 'Unitless'));
  const sharedUnit = unitLabels.size === 1 ? unitLabels.values().next().value as string : null;

  const handleSort = (key: ValidationMetricSortKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'ascending' ? 'descending' : 'ascending'
    }));
  };

  return (
    <div
      className="validation-table-scroll"
      role="region"
      aria-label={`${themeTitle} validation metrics table`}
      tabIndex={0}
    >
      <table className="validation-metrics-table">
        <caption className="visually-hidden">{themeTitle}</caption>
        <thead>
          <tr>
            <SortableMetricHeader label="Metric" sortKey="metric" sort={sort} unit={sharedUnit} onSort={handleSort} />
            <th scope="col">Status</th>
            <th scope="col" className="validation-numeric">Target</th>
            <th scope="col" className="validation-numeric">Target band</th>
            <th scope="col" className="validation-numeric">Simulated mean</th>
            <th scope="col" className="validation-numeric">Simulated IQR</th>
            <SortableMetricHeader label="Off target" sortKey="offTarget" sort={sort} numeric onSort={handleSort} />
            <SortableMetricHeader label="Seeds in band" sortKey="insideRate" sort={sort} numeric onSort={handleSort} />
            <SortableMetricHeader label="Loss" sortKey="loss" sort={sort} numeric onSort={handleSort} />
            <th scope="col" className="validation-detail-column"><span className="visually-hidden">Details</span></th>
          </tr>
        </thead>
        <tbody>
          {sortedMetrics.map((metric) => {
            const comparisonMetric = comparisonMetrics?.get(metric.metricId);
            const isOpen = activeMetricId === metric.metricId;
            const metricLabelId = `validation-metric-label-${metric.metricId}`;
            const deviationPercent = metricDeviationPercent(metric);
            const comparisonDeviationPercent = comparisonMetric ? metricDeviationPercent(comparisonMetric) : null;
            return (
              <tr
                key={metric.metricId}
                id={`validation-metric-${metric.metricId}`}
                className={`validation-metric-row validation-metric-${metric.status}`}
              >
                  <th scope="row" id={metricLabelId} className="validation-metric-name-cell">
                    <strong>{metric.label}</strong>
                    {!sharedUnit && <small>{displayUnits(metric) || 'Unitless'}</small>}
                  </th>
                  <td className="validation-status-cell">
                    <ModelValues
                      primary={<span className={`validation-status-pill validation-status-${metric.status}`}>{metric.status}</span>}
                      comparison={comparisonMetric ? <span className={`validation-status-pill validation-status-${comparisonMetric.status}`}>{comparisonMetric.status}</span> : undefined}
                      versionLabels={versionLabels}
                    />
                  </td>
                  <td className="validation-numeric">{formatMetricValue(metric, metric.sourceValue, 'target')}</td>
                  <td className="validation-numeric">{formatTargetBand(metric)}</td>
                  <td className="validation-numeric">
                    <ModelValues
                      primary={formatMetricValue(metric, metric.seedMean, 'simulation')}
                      comparison={comparisonMetric ? formatMetricValue(comparisonMetric, comparisonMetric.seedMean, 'simulation') : undefined}
                      versionLabels={versionLabels}
                    />
                  </td>
                  <td className="validation-numeric">{formatSimulatedIqr(metric)}</td>
                  <td className="validation-numeric">
                    <ModelValues
                      primary={formatDeviation(deviationPercent)}
                      comparison={comparisonMetric ? formatDeviation(comparisonDeviationPercent) : undefined}
                      versionLabels={versionLabels}
                    />
                  </td>
                  <td className="validation-numeric">
                    <ModelValues
                      primary={formatInsideRate(metric.insideRate)}
                      comparison={comparisonMetric ? formatInsideRate(comparisonMetric.insideRate) : undefined}
                      versionLabels={versionLabels}
                    />
                  </td>
                  <td className="validation-numeric">
                    <ModelValues
                      primary={formatLoss(metric.metricLoss)}
                      comparison={comparisonMetric ? formatLoss(comparisonMetric.metricLoss) : undefined}
                      versionLabels={versionLabels}
                    />
                  </td>
                  <td className="validation-detail-column">
                    {hasMetricProvenance(metric) && (
                      <button
                        type="button"
                        className="validation-detail-toggle"
                        data-validation-detail-trigger
                        aria-haspopup="dialog"
                        aria-expanded={isOpen}
                        aria-controls={VALIDATION_METRIC_DETAILS_PANEL_ID}
                        aria-label={`${isOpen ? 'Close' : 'Open'} details for ${metric.label}`}
                        onClick={(event) => {
                          if (isOpen) onCloseDetails?.();
                          else onOpenDetails?.(metric, event.currentTarget);
                        }}
                      >
                        Details
                      </button>
                    )}
                  </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function resolveValidationModelsForEvidenceYear(
  overview: Pick<
    ValidationOverviewPayload,
    'availableVersions' | 'availableValidationTargetYearsByVersion'
  > | null,
  selectedVersion: string,
  comparisonVersion: string,
  evidenceYear: number,
  inProgressVersions: readonly string[] = []
) {
  const eligibleVersions = (overview?.availableVersions ?? []).filter((version) =>
    (overview?.availableValidationTargetYearsByVersion[version] ?? []).includes(evidenceYear)
  );
  const nextSelectedVersion = eligibleVersions.includes(selectedVersion)
    ? selectedVersion
    : getDefaultModelVersion(eligibleVersions, inProgressVersions);
  const nextComparisonVersion =
    comparisonVersion !== nextSelectedVersion && eligibleVersions.includes(comparisonVersion)
      ? comparisonVersion
      : '';
  return {
    eligibleVersions,
    selectedVersion: nextSelectedVersion,
    comparisonVersion: nextComparisonVersion
  };
}

export function ValidationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedVersion = searchParams.get('version')?.trim() ?? '';
  const requestedEvidenceYear = Number(searchParams.get('evidenceYear'));
  // Only offered when the analyst arrived from a setup form, so this reads as a return trip
  // rather than an unexplained call to action for someone browsing validation on its own.
  const returnSource = searchParams.get('from')?.trim() ?? '';
  const draftId = searchParams.get('draft')?.trim() ?? '';
  const isScenarioContext = returnSource === 'scenario' && Boolean(draftId && readScenarioDraft(draftId));
  const isSensitivityContext = returnSource === 'sensitivity' && Boolean(draftId && readSensitivityDraft(draftId));
  const returnDestination = isScenarioContext
    ? RETURN_DESTINATIONS.scenario
    : isSensitivityContext
      ? RETURN_DESTINATIONS.sensitivity
      : null;
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
  const [isOutcomeComparisonsOpen, setIsOutcomeComparisonsOpen] = useState(false);
  const [openValidationThemeIds, setOpenValidationThemeIds] = useState<Set<string>>(() => new Set());
  const [pendingMetricDiagnosticId, setPendingMetricDiagnosticId] = useState<string | null>(null);
  const [activeValidationDetail, setActiveValidationDetail] = useState<ValidationMetricDetailState | null>(null);

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
        const requestedYearSelection = resolveValidationModelsForEvidenceYear(
          response,
          selectedVersion,
          comparisonVersion,
          selectedValidationTargetYear,
          versions.inProgressVersions
        );
        if (
          response.selectedValidationTargetYear !== selectedValidationTargetYear &&
          requestedYearSelection.eligibleVersions.length > 0 &&
          requestedYearSelection.selectedVersion !== response.selectedVersion
        ) {
          setSelectionNotice(
            'That model is unavailable for the selected evidence year. Showing an eligible validated model.'
          );
          setSelectedVersion(requestedYearSelection.selectedVersion);
          setComparisonVersion(requestedYearSelection.comparisonVersion);
          setInProgressVersions(versions.inProgressVersions);
          return;
        }
        const requestedCombinationChanged =
          (selectedVersion.length > 0 && response.selectedVersion !== selectedVersion) ||
          response.selectedValidationTargetYear !== selectedValidationTargetYear;
        setSelectionNotice(requestedCombinationChanged
          ? 'That model and evidence-year combination is unavailable. Showing the nearest available validation evidence.'
          : '');
        setOverview(response);
        setSelectedVersion(response.selectedVersion);
        setSelectedValidationTargetYear(response.selectedValidationTargetYear);
        const resolvedComparison = resolveValidationModelsForEvidenceYear(
          response,
          response.selectedVersion,
          comparisonVersion,
          response.selectedValidationTargetYear,
          versions.inProgressVersions
        ).comparisonVersion;
        if (resolvedComparison !== comparisonVersion) setComparisonVersion(resolvedComparison);
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

  useEffect(() => {
    if (!pendingMetricDiagnosticId || !isOutcomeComparisonsOpen) return;
    const themeId = findValidationThemeId(pendingMetricDiagnosticId);
    if (!themeId || !openValidationThemeIds.has(themeId)) return;

    const row = document.getElementById(`validation-metric-${pendingMetricDiagnosticId}`);
    setPendingMetricDiagnosticId(null);
    if (!row) return;
    const trigger = row.querySelector<HTMLButtonElement>('[data-validation-detail-trigger]');
    if (!trigger) return;
    if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    trigger.focus({ preventScroll: true });
  }, [isOutcomeComparisonsOpen, openValidationThemeIds, pendingMetricDiagnosticId]);

  const summary = overview?.selectedSummary ?? null;
  const inProgressSet = useMemo(() => new Set(inProgressVersions), [inProgressVersions]);
  const versionLabel = (version: string) => formatModelName(version);
  const eligibleVersions = useMemo(
    () => resolveValidationModelsForEvidenceYear(
      overview,
      selectedVersion,
      comparisonVersion,
      selectedValidationTargetYear,
      inProgressVersions
    ).eligibleVersions,
    [comparisonVersion, inProgressVersions, overview, selectedValidationTargetYear, selectedVersion]
  );
  // The main 2024 view stays limited to named models, while the compact 2011 reference catalogue
  // includes every eligible overlay (notably v0o2, which is intentionally not a named anchor).
  const orderedVersions = useMemo(
    () => {
      if (selectedValidationTargetYear === 2011) return eligibleVersions;
      const versions = buildModelOptions(eligibleVersions, selectedVersion, inProgressSet).map((option) => option.version);
      if (comparisonVersion && eligibleVersions.includes(comparisonVersion) && !versions.includes(comparisonVersion)) {
        versions.push(comparisonVersion);
      }
      return versions;
    },
    [comparisonVersion, eligibleVersions, inProgressSet, selectedValidationTargetYear, selectedVersion]
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
  const evidenceContext = isScenarioContext
    ? `&from=scenario&draft=${encodeURIComponent(draftId)}&scenarioStep=model-version`
    : isSensitivityContext
      ? `&from=sensitivity&draft=${encodeURIComponent(draftId)}&sensitivityStep=model-baseline`
      : '';
  const returnHref = isScenarioContext
    ? `${RETURN_DESTINATIONS.scenario.path}?draft=${encodeURIComponent(draftId)}&step=model-version`
    : `${RETURN_DESTINATIONS.sensitivity.path}?draft=${encodeURIComponent(draftId)}&step=model-baseline`;
  const calibrationPageHref = comparisonVersion
    ? `/model-evidence?view=calibration&mode=compare&left=${encodeURIComponent(selectedVersion)}&right=${encodeURIComponent(comparisonVersion)}${evidenceContext}`
    : `/model-evidence?view=calibration&mode=single&version=${encodeURIComponent(selectedVersion)}${evidenceContext}`;

  const openValidationDetails = (metric: ValidationMetricSummary, trigger: HTMLButtonElement) => {
    setActiveValidationDetail({ metric, trigger, showBandNote: !comparisonSummary });
  };
  const closeValidationDetails = () => setActiveValidationDetail(null);

  const selectVersionAndValidationYear = (version: string, year: number) => {
    setSelectedVersion(version);
    setSelectedValidationTargetYear(year);
  };
  const handleVersionChange = (version: string) => {
    if (version === comparisonVersion) setComparisonVersion('');
    selectVersionAndValidationYear(version, selectedValidationTargetYear);
  };
  const handleEvidenceYearChange = (year: number) => {
    const resolved = resolveValidationModelsForEvidenceYear(
      overview,
      selectedVersion,
      comparisonVersion,
      year,
      inProgressVersions
    );
    setSelectedVersion(resolved.selectedVersion);
    setComparisonVersion(resolved.comparisonVersion);
    setSelectedValidationTargetYear(year);
  };
  // const handleChartClick = (year: 2024 | 2011) => (raw: unknown) => {
  //   const point = raw as { name?: string };
  //   if (point?.name) selectVersionAndValidationYear(point.name, year);
  // };
  const openMetricDiagnostic = (metricId: string) => {
    const themeId = findValidationThemeId(metricId);
    if (!themeId) return;
    setIsOutcomeComparisonsOpen(true);
    setOpenValidationThemeIds((current) => current.has(themeId) ? current : new Set(current).add(themeId));
    setPendingMetricDiagnosticId(metricId);
  };
  const handleValidationThemeOpenChange = (themeId: string, open: boolean) => {
    setOpenValidationThemeIds((current) => {
      if (current.has(themeId) === open) return current;
      const next = new Set(current);
      if (open) next.add(themeId);
      else next.delete(themeId);
      return next;
    });
  };

  return (
    <section className="validation-layout">
      {selectedVersion && returnDestination && (
        <EvidenceReturnPanel
          className="validation-return-bar"
          message={`You are checking validation evidence for an unfinished ${returnDestination.noun}.`}
          returnHref={returnHref}
          versions={pickerVersions}
          currentVersion={selectedVersion}
          inProgressVersions={inProgressSet}
          onChooseModel={(version) => {
            if (isScenarioContext) updateScenarioDraftModel(draftId, version);
            else updateSensitivityDraftModel(draftId, version);
          }}
        />
      )}
      <article className="results-card validation-introduction">
        <div className="validation-introduction-top">
          <div className="validation-introduction-copy">
            <h2>Validation</h2>
            <p>Compare the selected model with independent UK evidence, see which outcomes are credible or problematic, and check whether results hold across random seeds.</p>
            <p className="validation-protocol-note">
              {summary && <>This displayed validation snapshot uses {formatValidationSnapshotProtocol(summary)}. </>}
              {comparisonSummary && <>The comparison snapshot uses {formatValidationSnapshotProtocol(comparisonSummary)}. </>}
              Runs launched on the Experiments page do not update these validation results.
            </p>
            <p className="validation-evidence-statement">
              {selectedValidationTargetYear === 2011 ? (
                <>Showing the <strong>2011 reference evidence overlay</strong>. This is a historical reference view, not a continuation of the 2024 validation evidence.</>
              ) : (
                <>The selected model is validated against <strong>2024 evidence</strong>.</>
              )}
            </p>
          </div>
          <ValidationStatusLegend />
        </div>

        <div className="validation-model-picker-toolbar">
          <label className="validation-selector validation-evidence-year-selector">
            <span>Evidence year</span>
            <select
              value={selectedValidationTargetYear}
              onChange={(event) => handleEvidenceYearChange(Number(event.target.value))}
            >
              <option value={2024}>2024 evidence</option>
              <option value={2011}>2011 reference evidence</option>
            </select>
          </label>
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
        <p className="validation-calibration-guidance">
          If you want to understand the difference between two models, visit the{' '}
          <Link to={calibrationPageHref}>calibration page</Link>.
        </p>
      </article>

      {selectionNotice && <p className="info-banner">{selectionNotice}</p>}
      {error && <p className="error-banner">Unable to load validation results: {error}</p>}
      {isWaitingForApi && <p className="waiting-banner">Waiting for the API. Retrying every 2 seconds…</p>}
      {isLoading && !summary && <p className="loading-banner">Loading validation overview…</p>}

      {summary && (
        <>
          <CollapsibleSection
            className="results-card validation-summary-card"
            title="Summary card"
            description="Overall validation results, strongest areas, and the largest gaps."
            summary={comparisonSummary
              ? `${summary.version} compared with ${comparisonSummary.version}`
              : `${versionLabel(summary.version)} · ${summary.validationTargetYear} evidence`}
            defaultOpen={false}
          >
            <div className="validation-overview-header">
              <div>
                <h3>
                  {comparisonSummary
                    ? `${summary.version} compared with ${comparisonSummary.version}`
                    : `${versionLabel(summary.version)} scorecard`}
                </h3>
                <p>
                  {summary.validationTargetYear} UK evidence · {summary.version}: {formatValidationSnapshotProtocol(summary)}
                  {comparisonSummary && <> · {comparisonSummary.version}: {formatValidationSnapshotProtocol(comparisonSummary)}</>}
                </p>
              </div>
            </div>
            <div className="kpi-grid validation-scorecard-grid">
              <div className="kpi-card validation-composite-card">
                <span>Comparative validation loss — lower is better</span>
                <strong>
                  {formatValidationScorecardValue(
                    formatNumber(summary.overallCompositeLoss, 4),
                    comparisonSummary ? formatNumber(comparisonSummary.overallCompositeLoss, 4) : null
                  )}
                </strong>
                <small>Unweighted mean of {summary.metrics.length} metric losses.</small>
              </div>
              {(['pass', 'warn', 'fail', 'unsupported'] as const).map((status) => (
                <div className={`kpi-card validation-count-card validation-metric-${status}`} key={status}>
                  <span>{status}</span>
                  <strong>
                    {formatValidationScorecardValue(
                      scorecard.counts[status],
                      comparisonSummary ? comparisonScorecard.counts[status] : null
                    )}
                  </strong>
                  <small>metrics</small>
                </div>
              ))}
              <div className="kpi-card">
                <span>Average seeds inside target bands</span>
                <strong>
                  {formatValidationScorecardValue(
                    formatInsideRate(scorecard.averageInsideRate),
                    comparisonSummary ? formatInsideRate(comparisonScorecard.averageInsideRate) : null
                  )}
                </strong>
                <small>Unsupported metrics excluded</small>
              </div>
            </div>
            <div className="validation-loss-decomposition">
              <h4>Where this model&rsquo;s error sits</h4>
              <p className="validation-card-subtitle validation-decomposition-description">
                Each theme&rsquo;s share of the total metric loss. A <strong>smaller</strong> share means this model version fits
                the {selectedValidationTargetYear}{selectedValidationTargetYear === 2011 ? ' reference' : ''} evidence better for that group of indicators.
              </p>
              {comparisonSummary && (
                <div className="validation-decomposition-legend" aria-label="Theme loss bar colours">
                  <span>
                    <span className="validation-decomposition-swatch" style={{ background: BASELINE_COLOR }} aria-hidden="true" />
                    {formatModelWithVersion(summary.version)}
                  </span>
                  <span>
                    <span className="validation-decomposition-swatch" style={{ background: COMPARISON_COLOR }} aria-hidden="true" />
                    {formatModelWithVersion(comparisonSummary.version)}
                  </span>
                </div>
              )}
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
          </CollapsibleSection>

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

          <CollapsibleSection
            className="results-card validation-outcome-diagnostics"
            title="Outcome comparisons"
            description="A closer look at how each model outcome compares with UK evidence."
            summary={`${summary.metrics.length} metrics across ${VALIDATION_POLICY_THEMES.length} themes`}
            open={isOutcomeComparisonsOpen}
            onOpenChange={setIsOutcomeComparisonsOpen}
          >
            <div className="validation-overview-header">
              <div>
                <p>
                  Sort by metric name, off-target distance, seeds in band, or loss within a theme. Each table starts
                  with the highest-loss metric first. Open Details to see its loss family and source provenance. Lower
                  loss is better.
                </p>
              </div>
            </div>
            {VALIDATION_POLICY_THEMES.map((theme) => {
              const metricMap = new Map(summary.metrics.map((metric) => [metric.metricId, metric]));
              const metrics = theme.metricIds.flatMap((metricId) => {
                const metric = metricMap.get(metricId);
                return metric ? [metric] : [];
              });
              // Every JSD metric lives in this one theme, so the shape-only explanation belongs to the
              // theme rather than to a sub-group nested inside each of them.
              const isShapeTheme =
                metrics.length > 0 && metrics.every((metric) => metricDeviationPercent(metric) === null);
              return (
                <CollapsibleSection
                  key={theme.id}
                  className="validation-theme"
                  title={theme.title}
                  summary={describeThemeStatuses(metrics)}
                  open={openValidationThemeIds.has(theme.id)}
                  onOpenChange={(open) => handleValidationThemeOpenChange(theme.id, open)}
                >
                  {metrics.length === 0 && <p className="info-banner">No metrics available for this theme.</p>}
                  {isShapeTheme && (
                    <p className="validation-card-subtitle">
                      Scored by how closely the whole simulated distribution matches the empirical one, so there
                      is no single target to be off by. Compare these by loss.
                    </p>
                  )}
                  {metrics.length > 0 && (
                    <ValidationMetricTable
                      themeTitle={theme.title}
                      metrics={metrics}
                      comparisonMetrics={comparisonMetricById}
                      versionLabels={comparisonSummary ? { selected: summary.version, comparison: comparisonSummary.version } : undefined}
                      activeMetricId={activeValidationDetail?.metric.metricId}
                      onOpenDetails={openValidationDetails}
                      onCloseDetails={closeValidationDetails}
                    />
                  )}
                </CollapsibleSection>
              );
            })}
          </CollapsibleSection>

          <CollapsibleSection
            className="results-card validation-audit-disclosure"
            title="Validation methodology"
            description="How the model is tested, which evidence is used, and how results are scored."
            summary="Protocol, evidence, and loss calculation"
            defaultOpen={false}
          >
            <p>Validation asks how far the multi-seed model summary sits from an empirical target and whether seed outcomes consistently fall inside its target band.</p>
            <h3>How validation loss is calculated</h3>
            <p>Positive levels use log-ratio distance; signed metrics use robust additive distance; tenure shares use bounded-domain-normalised percentage-point distance; and JSD uses bounded low-is-better scoring. Spread and seeds outside the band also contribute. Target bands determine pass, warning, and fail status.</p>
            <p>The weighted composite aggregates metric losses for comparative ranking. Its family-specific scales, transforms, distance, spread, and inside-band components are retained in the payload and metric audit detail; it is not a probability, confidence interval, or hypothesis-test statistic.</p>
          </CollapsibleSection>
        </>
      )}
      {activeValidationDetail && (
        <ValidationMetricDetailsPanel detail={activeValidationDetail} onClose={closeValidationDetails} />
      )}
    </section>
  );
}
