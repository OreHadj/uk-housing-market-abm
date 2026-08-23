import type {
  KpiMetricKey,
  KpiMetricSummary,
  KpiMetricWindowType,
  LendingBandGroup,
  LendingBorrowerType,
  LendingDistributionPayload,
  ResultsCompareIndicator,
  ResultsIndicatorAvailability,
  ResultsIndicatorScaling,
  ResultsRunSummary
} from '../../shared/types';

const DEFAULT_MANUAL_OVERLAY_INDICATOR_ID = 'core_ooLTI';
const KPI_BASELINE_EPSILON = 1e-12;
const KPI_DELTA_DECIMALS = 2;

export type PolicyIndicatorGroupId =
  | 'credit_access'
  | 'borrower_risk'
  | 'housing_market'
  | 'rental_spillovers'
  | 'tenure_distribution'
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
    // The stock of credit and the rate charged on it belong with the flow of new lending, not in a
    // group of their own: a policy that changes access changes all three together.
    id: 'credit_access',
    title: 'Credit access',
    indicatorIds: [
      'core_mortgageApprovals',
      'core_advancesToFTB',
      'core_advancesToHM',
      'core_advancesToBTL',
      'output_creditStock',
      'output_interestRate'
    ]
  },
  {
    // The loan-level mean LTV and LTI lead, because they are what "LTV" and "LTI" mean to a reader.
    // The core-indicator rows they replace are means *above the median*; they stay available under
    // Other indicators for anyone who wants that particular statistic.
    id: 'borrower_risk',
    title: 'Borrower risk',
    indicatorIds: [
      'lending_ooMeanLtv',
      'lending_ooMeanLti',
      'lending_ftbHighLtv',
      'lending_hmHighLtv',
      'lending_ftbHighLti',
      'lending_hmHighLti',
      'core_btlLTV',
      'core_debtToIncome',
      'core_ooDebtToIncome',
      'core_creditGrowth',
      'core_interestRateSpread'
    ]
  },
  {
    // Price to income sits here rather than under borrower risk: it is a market-level affordability
    // ratio across all households, not a property of a borrower or a loan.
    id: 'housing_market',
    title: 'Housing market',
    indicatorIds: [
      'core_housingTransactions',
      'core_housePriceGrowth',
      'output_saleHPI',
      'output_saleAvSalePrice',
      'core_priceToIncome',
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
    indicatorIds: [
      'output_ownershipRate',
      'output_nonOwnerShare',
      'output_nOwnerOccupier',
      'output_nRenting',
      'output_nHomeless',
      'output_nNonOwner',
      'output_nActiveBTL'
    ]
  },
];

const INDICATOR_GROUP_BY_ID = new Map(
  POLICY_INDICATOR_GROUPS.flatMap((group) => group.indicatorIds.map((indicatorId) => [indicatorId, group.id] as const))
);

/**
 * Rank within a group, so a group reads in the order declared above rather than in the order the
 * backend catalog happens to list its columns. Anything unplaced sorts to the end.
 */
const INDICATOR_RANK_BY_ID = new Map(
  POLICY_INDICATOR_GROUPS.flatMap((group) =>
    group.indicatorIds.map((indicatorId, index) => [indicatorId, index] as const)
  )
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

/**
 * Loan-level rows, lifted out of the new-lending distributions and shown alongside the aggregate
 * indicators. These are the mean LTV and LTI of new lending and the paper's high-LTV / high-LTI
 * shares by buyer type — the numbers a reader expects when they see "LTV" on a results page. The
 * core-indicator rows next to them are a mean *above the median*, which is a different statistic.
 *
 * Nothing is re-aggregated here: lendingDistribution.ts already computes all of it per borrower
 * type, and this only pools first-time buyers with home movers to get an owner-occupier figure.
 */
export const LENDING_KPI_DEFINITIONS: Array<{
  id: string;
  title: string;
  units: string;
  description: string;
}> = [
  {
    id: 'lending_ooMeanLtv',
    title: 'Mean LTV, new owner-occupier lending',
    units: '%',
    description:
      'Mortgage principal over transaction price, averaged over every new owner-occupier loan in the window. Cash purchases are excluded.'
  },
  {
    id: 'lending_ooMeanLti',
    title: 'Mean LTI, new owner-occupier lending',
    units: 'ratio',
    description:
      'Mortgage principal over annual gross employment income, averaged over every new owner-occupier loan in the window \u2014 the income measure the bank actually enforces against.'
  },
  {
    id: 'lending_ftbHighLtv',
    title: 'First-time buyers at high LTV',
    units: '%',
    description: 'Share of first-time buyer lending at or above the high-LTV cut.'
  },
  {
    id: 'lending_hmHighLtv',
    title: 'Home movers at high LTV',
    units: '%',
    description: 'Share of home-mover lending at or above the high-LTV cut.'
  },
  {
    id: 'lending_ftbHighLti',
    title: 'First-time buyers at high LTI',
    units: '%',
    description: 'Share of first-time buyer lending at or above the high-LTI cut.'
  },
  {
    id: 'lending_hmHighLti',
    title: 'Home movers at high LTI',
    units: '%',
    description: 'Share of home-mover lending at or above the high-LTI cut.'
  }
];

const LENDING_KPI_IDS = new Set(LENDING_KPI_DEFINITIONS.map((definition) => definition.id));

export function isLendingKpiId(indicatorId: string): boolean {
  return LENDING_KPI_IDS.has(indicatorId);
}

/** Count-weighted pool of first-time buyers and home movers: the owner-occupier figure. */
function poolOwnerOccupier(
  payload: LendingDistributionPayload,
  read: (borrowerType: LendingBorrowerType) => number | null
): number | null {
  let weighted = 0;
  let total = 0;
  for (const summary of payload.summaryByBorrowerType) {
    if (summary.borrowerType === 'BTL') {
      continue;
    }
    const value = read(summary.borrowerType);
    if (value === null || !Number.isFinite(value) || summary.count === 0) {
      continue;
    }
    weighted += value * summary.count;
    total += summary.count;
  }
  return total === 0 ? null : weighted / total;
}

/**
 * First-time buyers and home movers pooled. This is the owner-occupier line the paper's Table 3
 * reports against (mean LTV 65.8%, mean LTI 2.84, price to income 4.4); neither buyer type on its
 * own reproduces those numbers.
 */
export function pooledOwnerOccupierLending(payload: LendingDistributionPayload | null): {
  count: number;
  meanLtv: number | null;
  meanLti: number | null;
  meanPriceToIncome: number | null;
} | null {
  if (!payload || !payload.available) {
    return null;
  }
  const summaryOf = (borrowerType: LendingBorrowerType) =>
    payload.summaryByBorrowerType.find((entry) => entry.borrowerType === borrowerType) ?? null;
  const count = payload.summaryByBorrowerType
    .filter((entry) => entry.borrowerType !== 'BTL')
    .reduce((total, entry) => total + entry.count, 0);
  if (count === 0) {
    return null;
  }
  return {
    count,
    meanLtv: poolOwnerOccupier(payload, (type) => summaryOf(type)?.meanLtv ?? null),
    meanLti: poolOwnerOccupier(payload, (type) => summaryOf(type)?.meanLti ?? null),
    meanPriceToIncome: poolOwnerOccupier(payload, (type) => summaryOf(type)?.meanPriceToIncome ?? null)
  };
}

/** Share of a borrower type's lending in the risk tail: every band at or above the high cut. */
function tailShare(group: LendingBandGroup | undefined, borrowerType: LendingBorrowerType): number | null {
  if (!group) {
    return null;
  }
  const series = group.seriesByBorrowerType.find((entry) => entry.borrowerType === borrowerType);
  if (!series || series.count === 0) {
    return null;
  }
  const bandById = new Map(group.bands.map((band) => [band.id, band]));
  return series.bands
    .filter((share) => (bandById.get(share.bandId)?.lowerEdge ?? -Infinity) >= group.highThreshold)
    .reduce((total, share) => total + share.share, 0);
}

function lendingKpiValues(payload: LendingDistributionPayload | null): Map<string, number | null> {
  const values = new Map<string, number | null>(LENDING_KPI_DEFINITIONS.map((entry) => [entry.id, null]));
  if (!payload || !payload.available) {
    return values;
  }
  const ltvGroup = payload.bandGroups.find((group) => group.metric === 'ltv');
  const ltiGroup = payload.bandGroups.find((group) => group.metric === 'lti');

  const pooled = pooledOwnerOccupierLending(payload);
  values.set('lending_ooMeanLtv', pooled?.meanLtv ?? null);
  values.set('lending_ooMeanLti', pooled?.meanLti ?? null);
  values.set('lending_ftbHighLtv', tailShare(ltvGroup, 'FTB'));
  values.set('lending_hmHighLtv', tailShare(ltvGroup, 'HM'));
  values.set('lending_ftbHighLti', tailShare(ltiGroup, 'FTB'));
  values.set('lending_hmHighLti', tailShare(ltiGroup, 'HM'));
  return values;
}

/** Row labels state the actual cut, which is configurable rather than fixed at 75% / 3.35. */
function lendingKpiTitle(
  definition: (typeof LENDING_KPI_DEFINITIONS)[number],
  payload: LendingDistributionPayload | null
): string {
  const threshold = (metric: 'ltv' | 'lti') =>
    payload?.bandGroups.find((group) => group.metric === metric)?.highThreshold ?? null;
  if (definition.id.endsWith('HighLtv')) {
    const cut = threshold('ltv');
    return cut === null ? definition.title : `${definition.title} (\u2265 ${cut}%)`;
  }
  if (definition.id.endsWith('HighLti')) {
    const cut = threshold('lti');
    return cut === null ? definition.title : `${definition.title} (\u2265 ${cut})`;
  }
  return definition.title;
}

export function buildLendingKpis(
  payload: LendingDistributionPayload | null,
  windowType: KpiMetricWindowType
): KpiMetricSummary[] {
  const values = lendingKpiValues(payload);
  return LENDING_KPI_DEFINITIONS.map((definition) => ({
    indicatorId: definition.id,
    title: lendingKpiTitle(definition, payload),
    units: definition.units,
    scaling: 'none' as const,
    windowType,
    mean: values.get(definition.id) ?? null,
    // Loan-level statistics are pooled over the window, not a monthly series, so there is no
    // month-to-month dispersion to report here.
    cv: null,
    annualisedTrend: null,
    range: null
  }));
}

export function buildLendingIndicatorAvailability(
  payload: LendingDistributionPayload | null,
  unavailableNote: string
): ResultsIndicatorAvailability[] {
  const isAvailable = Boolean(payload?.available);
  return LENDING_KPI_DEFINITIONS.map((definition) => ({
    id: definition.id,
    title: lendingKpiTitle(definition, payload),
    units: definition.units,
    description: definition.description,
    source: 'output' as const,
    scaling: 'none' as const,
    available: isAvailable,
    coverageStatus: isAvailable ? ('supported' as const) : ('unsupported' as const),
    note: isAvailable ? undefined : unavailableNote
  }));
}

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

  for (const group of groups) {
    group.items.sort(
      (left, right) =>
        (INDICATOR_RANK_BY_ID.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (INDICATOR_RANK_BY_ID.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    );
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

function findFirstDistinctRunId(runs: ResultsRunSummary[], excludeRunId = ''): string {
  return runs.find((run) => run.runId !== excludeRunId)?.runId ?? '';
}

/** Creation time, falling back to last-modified when the filesystem gives no usable birth time. */
function runCreatedTime(run: ResultsRunSummary): number {
  const created = Date.parse(run.createdAt);
  if (Number.isFinite(created) && created > 0) {
    return created;
  }
  const modified = Date.parse(run.modifiedAt);
  return Number.isFinite(modified) ? modified : Number.NEGATIVE_INFINITY;
}

/**
 * The page opens on the newest run rather than a named one. Hardcoding a default meant the page
 * opened on a run from a different calibration vintage than anything the user had just produced,
 * with counts that are not comparable to it (a 25% difference in dwellings per household). Any
 * particular run, that one included, stays selectable from the dropdown.
 */
function findMostRecentRunId(runs: ResultsRunSummary[], excludeRunId = ''): string {
  let bestRunId = '';
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const run of runs) {
    if (run.runId === excludeRunId) {
      continue;
    }
    const time = runCreatedTime(run);
    if (bestRunId === '' || time > bestTime) {
      bestRunId = run.runId;
      bestTime = time;
    }
  }
  return bestRunId;
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
        findMostRecentRunId(runs) || findFirstDistinctRunId(runs),
      comparisonRunId: ''
    };
  }

  const baselineRunId =
    findMostRecentRunId(runs) || findFirstDistinctRunId(runs);
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

/**
 * Three significant figures, compacted. Counts scaled to UK households run to eight or nine digits
 * and a credit stock to twelve; a fully grouped `784,116,738,522` is unreadable and implies a
 * precision the model does not have.
 */
function formatCompactSignificant(value: number): string {
  const magnitude = Math.abs(value);
  const [divisor, suffix] =
    magnitude >= 1e12
      ? [1e12, 'tn']
      : magnitude >= 1e9
        ? [1e9, 'bn']
        : magnitude >= 1e6
          ? [1e6, 'm']
          : magnitude >= 1e3
            ? [1e3, 'k']
            : [1, ''];
  return `${Number((value / divisor).toPrecision(3))}${suffix}`;
}

/** Decision 7: compact formatting for the rows the dashboard scales, which are the very large ones. */
function usesCompactFormat(scaling: ResultsIndicatorScaling | undefined): boolean {
  return scaling === 'dashboard';
}

export function formatKpiValue(
  value: number | null,
  units: string,
  scaling?: ResultsIndicatorScaling
): string {
  if (value === null || !Number.isFinite(value)) {
    return 'n/a';
  }

  if (usesCompactFormat(scaling)) {
    const compact = formatCompactSignificant(value);
    return units === 'GBP' ? `£${compact}` : compact;
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
    // The spread moves in hundredths of a point; a bare "3 pp" hides its whole range.
    return `${value.toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })} pp`;
  }
  if (units === 'ratio') {
    return `${value.toLocaleString('en-GB', { maximumFractionDigits: 3 })}x`;
  }
  if (units === 'months') {
    return `${value.toLocaleString('en-GB', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    })} months`;
  }
  if (units === 'index') {
    return value.toLocaleString('en-GB', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    });
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
  units: string,
  scaling?: ResultsIndicatorScaling
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
  if (usesCompactFormat(scaling)) {
    const normalizedDelta = Math.abs(absoluteDelta) < KPI_BASELINE_EPSILON ? 0 : absoluteDelta;
    const sign = normalizedDelta >= 0 ? '+' : '-';
    const compact = formatCompactSignificant(Math.abs(normalizedDelta));
    const relativeText = formatRelativeDelta(baselineValue, comparisonValue);
    const suffix = relativeText ? ` (${relativeText})` : '';
    return `${sign}${units === 'GBP' ? '£' : ''}${compact}${suffix}`;
  }

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
