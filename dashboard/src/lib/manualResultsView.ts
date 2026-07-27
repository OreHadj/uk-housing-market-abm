import type {
  KpiMetricKey,
  KpiMetricSummary,
  ResultsCompareIndicator,
  ResultsIndicatorAvailability,
  ResultsRunSummary
} from '../../shared/types';

export const DEFAULT_MANUAL_BASELINE_RUN_ID = 'v0-output';
const DEFAULT_MANUAL_OVERLAY_INDICATOR_ID = 'core_ooLTI';
const KPI_BASELINE_EPSILON = 1e-12;
const KPI_DELTA_DECIMALS = 2;

export type PolicyIndicatorGroupId =
  | 'credit_access'
  | 'borrower_risk'
  | 'housing_market'
  | 'rental_spillovers'
  | 'tenure_distribution'
  | 'balance_sheet'
  | 'other';

export interface GroupedIndicatorSection {
  id: PolicyIndicatorGroupId;
  title: string;
  items: ResultsIndicatorAvailability[];
}

export interface ManualRunSelection {
  baselineRunId: string;
  comparisonRunId: string;
}

export interface KpiDetailRow {
  key: KpiMetricKey;
  label: string;
  units: 'dynamic' | 'ratio';
}

export const KPI_DETAIL_ROWS: KpiDetailRow[] = [
  { key: 'mean', label: 'Mean (month)', units: 'dynamic' },
  { key: 'cv', label: 'CV (month)', units: 'ratio' },
  { key: 'range', label: 'Month Range (month)', units: 'dynamic' }
];

const POLICY_INDICATOR_GROUPS: Array<{
  id: PolicyIndicatorGroupId;
  title: string;
  indicatorIds: string[];
}> = [
  {
    id: 'credit_access',
    title: 'Credit access',
    indicatorIds: ['core_mortgageApprovals', 'core_advancesToFTB', 'core_advancesToHM', 'core_advancesToBTL']
  },
  {
    id: 'borrower_risk',
    title: 'Borrower risk',
    indicatorIds: [
      'core_ooLTV',
      'core_ooLTI',
      'core_btlLTV',
      'core_debtToIncome',
      'core_ooDebtToIncome',
      'core_creditGrowth',
      'core_priceToIncome',
      'core_interestRateSpread'
    ]
  },
  {
    id: 'housing_market',
    title: 'Housing market',
    indicatorIds: [
      'core_housingTransactions',
      'core_housePriceGrowth',
      'output_saleHPI',
      'output_saleAvSalePrice',
      'output_saleAvMonthsOnMarket'
    ]
  },
  {
    id: 'rental_spillovers',
    title: 'Rental spillovers',
    indicatorIds: [
      'core_rentalYield',
      'output_rentalHPI',
      'output_rentalAvSalePrice',
      'output_rentalAvMonthsOnMarket'
    ]
  },
  {
    id: 'tenure_distribution',
    title: 'Tenure and distribution',
    indicatorIds: ['output_nHomeless', 'output_nRenting', 'output_nOwnerOccupier', 'output_nActiveBTL']
  },
  {
    id: 'balance_sheet',
    title: 'Balance sheet',
    indicatorIds: ['output_creditStock', 'output_interestRate']
  }
];

const INDICATOR_GROUP_BY_ID = new Map(
  POLICY_INDICATOR_GROUPS.flatMap((group) => group.indicatorIds.map((indicatorId) => [indicatorId, group.id] as const))
);

export const HEADLINE_KPI_IDS = [
  'core_mortgageApprovals',
  'core_housingTransactions',
  'output_saleAvSalePrice',
  'core_ooLTV',
  'core_ooLTI',
  'core_debtToIncome',
  'output_rentalAvSalePrice',
  'core_rentalYield'
] as const;

export function groupIndicatorsByPolicyQuestion(
  indicators: ResultsIndicatorAvailability[]
): GroupedIndicatorSection[] {
  const groups: GroupedIndicatorSection[] = POLICY_INDICATOR_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    items: []
  }));
  const otherGroup: GroupedIndicatorSection = { id: 'other', title: 'Other indicators', items: [] };

  for (const indicator of indicators) {
    const groupId = INDICATOR_GROUP_BY_ID.get(indicator.id);
    const group = groups.find((entry) => entry.id === groupId) ?? otherGroup;
    group.items.push(indicator);
  }

  return [...groups, otherGroup].filter((group) => group.items.length > 0);
}

export function resolveSelectedIndicatorIds(
  indicators: ResultsIndicatorAvailability[],
  current: string[]
): string[] {
  const availableIds = indicators.filter((indicator) => indicator.available).map((indicator) => indicator.id);
  const availableSet = new Set(availableIds);
  const filtered = current.filter((id) => availableSet.has(id));
  return filtered.length > 0 ? filtered : availableIds;
}

export function resolveActiveIndicatorId(
  selectedIndicatorIds: string[],
  compareIndicators: ResultsCompareIndicator[],
  current: string
): string {
  const compareIds = compareIndicators.map((indicatorPayload) => indicatorPayload.indicator.id);
  const selectableIds = compareIds.length > 0 ? compareIds : selectedIndicatorIds;
  if (selectableIds.length === 0) {
    return '';
  }
  if (selectableIds.includes(current)) {
    return current;
  }
  if (selectableIds.includes(DEFAULT_MANUAL_OVERLAY_INDICATOR_ID)) {
    return DEFAULT_MANUAL_OVERLAY_INDICATOR_ID;
  }
  return selectableIds[0];
}

export function resolveActiveIndicatorPayload(
  compareIndicators: ResultsCompareIndicator[],
  selectedIndicatorIds: string[],
  current: string
): ResultsCompareIndicator | null {
  const resolvedIndicatorId = resolveActiveIndicatorId(selectedIndicatorIds, compareIndicators, current);
  return (
    compareIndicators.find((indicatorPayload) => indicatorPayload.indicator.id === current) ??
    compareIndicators.find((indicatorPayload) => indicatorPayload.indicator.id === resolvedIndicatorId) ??
    compareIndicators[0] ??
    null
  );
}

export function sortKpis(kpis: KpiMetricSummary[]): KpiMetricSummary[] {
  return [...kpis].sort((left, right) => left.title.localeCompare(right.title));
}

function findPreferredRunId(
  runs: ResultsRunSummary[],
  preferredRunId: string,
  excludeRunId = ''
): string {
  const matched = runs.find((run) => run.runId === preferredRunId && run.runId !== excludeRunId);
  return matched?.runId ?? '';
}

function findFirstDistinctRunId(runs: ResultsRunSummary[], excludeRunId = ''): string {
  return runs.find((run) => run.runId !== excludeRunId)?.runId ?? '';
}

export function resolveManualRunSelection(
  runs: ResultsRunSummary[],
  requestedBaselineRunId: string,
  requestedComparisonRunId: string
): ManualRunSelection {
  if (runs.length === 0) {
    return {
      baselineRunId: '',
      comparisonRunId: ''
    };
  }

  const availableRunIds = new Set(runs.map((run) => run.runId));
  const hasRequestedBaseline = requestedBaselineRunId.trim().length > 0;
  const hasRequestedComparison = requestedComparisonRunId.trim().length > 0;
  const requestedBaseline = availableRunIds.has(requestedBaselineRunId) ? requestedBaselineRunId : '';
  const requestedComparison = availableRunIds.has(requestedComparisonRunId) ? requestedComparisonRunId : '';

  if (requestedBaseline) {
    return {
      baselineRunId: requestedBaseline,
      comparisonRunId: requestedComparison && requestedComparison !== requestedBaseline ? requestedComparison : ''
    };
  }

  if (hasRequestedBaseline || hasRequestedComparison) {
    return {
      baselineRunId:
        findPreferredRunId(runs, DEFAULT_MANUAL_BASELINE_RUN_ID) || findFirstDistinctRunId(runs),
      comparisonRunId: ''
    };
  }

  const baselineRunId =
    findPreferredRunId(runs, DEFAULT_MANUAL_BASELINE_RUN_ID) || findFirstDistinctRunId(runs);
  return {
    baselineRunId,
    comparisonRunId: ''
  };
}

export function computeKpiPercentDelta(
  baselineValue: number | null,
  comparisonValue: number | null
): number | null {
  if (
    baselineValue === null ||
    comparisonValue === null ||
    !Number.isFinite(baselineValue) ||
    !Number.isFinite(comparisonValue) ||
    Math.abs(baselineValue) < KPI_BASELINE_EPSILON
  ) {
    return null;
  }

  return ((comparisonValue - baselineValue) / baselineValue) * 100;
}

export function getKpiMetricValue(kpi: KpiMetricSummary | null, key: KpiMetricKey): number | null {
  return kpi ? kpi[key] : null;
}

function isPointDeltaUnit(units: string): boolean {
  return units === '%' || units === 'rate' || units === 'percentage points';
}

function formatSignedFixed(value: number, suffix: string): string {
  const normalizedValue = Math.abs(value) < KPI_BASELINE_EPSILON ? 0 : value;
  const sign = normalizedValue >= 0 ? '+' : '';
  return `${sign}${normalizedValue.toLocaleString('en-GB', {
    minimumFractionDigits: KPI_DELTA_DECIMALS,
    maximumFractionDigits: KPI_DELTA_DECIMALS
  })}${suffix}`;
}

export function formatKpiValue(value: number | null, units: string): string {
  if (value === null || !Number.isFinite(value)) {
    return 'n/a';
  }

  if (units === 'GBP') {
    return `£${value.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
  }
  if (units === '%') {
    return `${value.toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`;
  }
  if (units === 'rate') {
    return `${(value * 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`;
  }
  if (units === 'percentage points') {
    return `${value.toLocaleString('en-GB', { maximumFractionDigits: 2 })} pp`;
  }
  if (units === 'ratio') {
    return `${value.toLocaleString('en-GB', { maximumFractionDigits: 3 })}x`;
  }
  if (units === 'count' || units === 'count/month') {
    return value.toLocaleString('en-GB', { maximumFractionDigits: 0 });
  }
  return value.toLocaleString('en-GB', { maximumFractionDigits: 3 });
}

export function computeKpiDeltaValue(
  baselineValue: number | null,
  comparisonValue: number | null,
  units: string
): number | null {
  if (
    baselineValue === null ||
    comparisonValue === null ||
    !Number.isFinite(baselineValue) ||
    !Number.isFinite(comparisonValue)
  ) {
    return null;
  }

  if (units === '%' || units === 'percentage points') {
    return comparisonValue - baselineValue;
  }
  if (units === 'rate') {
    return (comparisonValue - baselineValue) * 100;
  }
  return computeKpiPercentDelta(baselineValue, comparisonValue);
}

export function getKpiDeltaLabel(units: string): string {
  return isPointDeltaUnit(units) ? 'pp delta' : '% delta';
}

export function formatKpiDeltaValue(value: number | null, units: string): string {
  if (value === null || !Number.isFinite(value)) {
    return 'n/a';
  }

  if (isPointDeltaUnit(units)) {
    return formatSignedFixed(value, ' pp');
  }
  return formatSignedFixed(value, '%');
}

function formatRelativeDelta(baselineValue: number, comparisonValue: number): string | null {
  const relativeDelta = computeKpiPercentDelta(baselineValue, comparisonValue);
  return relativeDelta === null ? null : formatSignedFixed(relativeDelta, '%');
}

export function getKpiComparisonDeltaLabel(units: string): string {
  if (isPointDeltaUnit(units)) {
    return 'pp change';
  }
  if (units === 'ratio') {
    return 'ratio change';
  }
  if (units === 'count' || units === 'count/month') {
    return 'count change';
  }
  if (units === 'GBP') {
    return '£ change';
  }
  if (units === 'index') {
    return 'index change';
  }
  return '% change';
}

export function formatKpiComparisonDelta(
  baselineValue: number | null,
  comparisonValue: number | null,
  units: string
): string {
  if (
    baselineValue === null ||
    comparisonValue === null ||
    !Number.isFinite(baselineValue) ||
    !Number.isFinite(comparisonValue)
  ) {
    return 'n/a';
  }

  const absoluteDelta = comparisonValue - baselineValue;
  if (units === '%') {
    return formatSignedFixed(absoluteDelta, ' pp');
  }
  if (units === 'rate') {
    return formatSignedFixed(absoluteDelta * 100, ' pp');
  }
  if (units === 'percentage points') {
    return formatSignedFixed(absoluteDelta, ' pp');
  }

  const relativeText = formatRelativeDelta(baselineValue, comparisonValue);
  const suffix = relativeText ? ` (${relativeText})` : '';
  if (units === 'ratio') {
    return `${formatSignedFixed(absoluteDelta, 'x')}${suffix}`;
  }
  if (units === 'count' || units === 'count/month') {
    const normalizedDelta = Math.abs(absoluteDelta) < KPI_BASELINE_EPSILON ? 0 : absoluteDelta;
    const sign = normalizedDelta >= 0 ? '+' : '';
    return `${sign}${normalizedDelta.toLocaleString('en-GB', { maximumFractionDigits: 0 })}${suffix}`;
  }
  if (units === 'GBP') {
    const normalizedDelta = Math.abs(absoluteDelta) < KPI_BASELINE_EPSILON ? 0 : absoluteDelta;
    const sign = normalizedDelta >= 0 ? '+' : '-';
    return `${sign}£${Math.abs(normalizedDelta).toLocaleString('en-GB', { maximumFractionDigits: 0 })}${suffix}`;
  }
  if (units === 'index') {
    return `${formatSignedFixed(absoluteDelta, ' points')}${suffix}`;
  }
  return relativeText ?? 'n/a';
}
