import type {
  BasePolicyId,
  KpiMetricKey,
  KpiMetricSummary,
  KpiMetricWindowType,
  LendingBandGroup,
  LendingBorrowerType,
  LendingDistributionPayload,
  ResultsCompareIndicator,
  ResultsIndicatorAvailability,
  ResultsIndicatorScaling,
  ResultsPolicySetting,
  ResultsRunConfigurationValue,
  ResultsRunSummary
} from '../../shared/types';
import type { ScenarioDraftV1 } from './scenarioDraft';
import { extractVersionFromResultsRunId } from './versionLabels';
import {
  CENTRAL_BANK_POLICY_KEYS,
  getBasePolicyOption,
  summariseRunPolicy
} from '../../shared/policyCatalogue';

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

export type ManualComparisonMatchFieldKey =
  | 'N_STEPS'
  | 'N_SIMS'
  | 'CALIBRATION_VINTAGE';

type ManualComparisonMatchField = {
  key: ManualComparisonMatchFieldKey;
  label: string;
  reason: string;
  source: 'parameter' | 'calibration';
  valueKey?: 'N_STEPS' | 'N_SIMS';
  format: 'integer' | 'calibration';
};

/**
 * The warning allow-list is deliberately limited to run setup: horizon, seed depth, and the paired
 * household/dwelling calibration. Behavioural parameters and policy levers can differ intentionally.
 * TIME_TO_START_RECORDING_TRANSACTIONS, CUMULATIVE_WEIGHT_BEYOND_YEAR, TARGET_POPULATION,
 * ROLLING_WINDOW_SIZE_FOR_CORE_INDICATORS, and MODEL_VERSION were removed for that reason. The
 * CENTRAL_BANK_* fields remain exclusively in base-policy qualification and policy-detail diffing.
 */
export const MANUAL_COMPARISON_MATCH_FIELDS = [
  {
    key: 'N_STEPS',
    label: 'N_STEPS',
    reason: 'simulation duration',
    source: 'parameter',
    valueKey: 'N_STEPS',
    format: 'integer'
  },
  {
    key: 'N_SIMS',
    label: 'N_SIMS',
    reason: 'simulation repetitions and paired seed set',
    source: 'parameter',
    valueKey: 'N_SIMS',
    format: 'integer'
  },
  {
    key: 'CALIBRATION_VINTAGE',
    label: 'Housing market calibration (UK_HOUSEHOLDS and UK_DWELLINGS)',
    reason: 'housing-supply calibration',
    source: 'calibration',
    format: 'calibration'
  }
] as const satisfies readonly ManualComparisonMatchField[];

export interface ManualCalibrationValue {
  ukHouseholds: number | null;
  ukDwellings: number | null;
}

type ManualComparisonFieldValue = ResultsRunConfigurationValue | ManualCalibrationValue | null;

export interface ManualComparisonFieldDifference {
  field: (typeof MANUAL_COMPARISON_MATCH_FIELDS)[number];
  primaryValue: ManualComparisonFieldValue;
  comparisonValue: ManualComparisonFieldValue;
}

export interface PolicySettingDifference {
  key: string;
  primaryValue: number | null;
  comparisonValue: number | null;
}

export interface ManualComparisonDisclosureRow {
  key: string;
  label: string;
  primaryValue: string;
  comparisonValue: string;
}

export const MANUAL_COMPARISON_SETTINGS_VERDICT = 'Different run settings';
export const MANUAL_COMPARISON_CALIBRATION_VERDICT = 'Different calibration';

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

function readManualComparisonField(
  run: ResultsRunSummary,
  field: (typeof MANUAL_COMPARISON_MATCH_FIELDS)[number]
): ManualComparisonFieldValue {
  if (field.source === 'calibration') {
    return {
      ukHouseholds: run.provenance.ukHouseholds,
      ukDwellings: run.provenance.ukDwellings
    };
  }
  return run.configuration?.parameterValues[field.valueKey] ?? null;
}

function isManualCalibrationValue(value: ManualComparisonFieldValue): value is ManualCalibrationValue {
  return typeof value === 'object' && value !== null;
}

function manualComparisonValuesMatch(
  field: (typeof MANUAL_COMPARISON_MATCH_FIELDS)[number],
  primaryValue: ManualComparisonFieldValue,
  comparisonValue: ManualComparisonFieldValue
): boolean {
  if (field.source === 'calibration') {
    return Boolean(
      isManualCalibrationValue(primaryValue) &&
        isManualCalibrationValue(comparisonValue) &&
        primaryValue.ukHouseholds !== null &&
        primaryValue.ukDwellings !== null &&
        comparisonValue.ukHouseholds !== null &&
        comparisonValue.ukDwellings !== null &&
        primaryValue.ukHouseholds === comparisonValue.ukHouseholds &&
        primaryValue.ukDwellings === comparisonValue.ukDwellings
    );
  }
  return primaryValue !== null && comparisonValue !== null && primaryValue === comparisonValue;
}

/** Missing metadata is itself a mismatch: an automatic comparison must be provably matched. */
export function getManualComparisonFieldDifferences(
  primary: ResultsRunSummary,
  comparison: ResultsRunSummary
): ManualComparisonFieldDifference[] {
  return MANUAL_COMPARISON_MATCH_FIELDS.flatMap((field) => {
    const primaryValue = readManualComparisonField(primary, field);
    const comparisonValue = readManualComparisonField(comparison, field);
    if (manualComparisonValuesMatch(field, primaryValue, comparisonValue)) {
      return [];
    }
    return [{ field, primaryValue, comparisonValue }];
  });
}

const POLICY_VALUE_EPSILON = 1e-9;

function policyValuesMatch(primaryValue: number | null, comparisonValue: number | null): boolean {
  return (
    primaryValue !== null &&
    comparisonValue !== null &&
    Math.abs(primaryValue - comparisonValue) < POLICY_VALUE_EPSILON
  );
}

/** Shared by the policy-settings chips and by base-policy qualification. */
export function getPolicySettingDifferences(
  primarySettings: ReadonlyArray<ResultsPolicySetting>,
  comparisonSettings: ReadonlyArray<ResultsPolicySetting>
): PolicySettingDifference[] {
  const primaryByKey = new Map(primarySettings.map((setting) => [setting.key, setting.value]));
  const comparisonByKey = new Map(comparisonSettings.map((setting) => [setting.key, setting.value]));
  const keys = [...new Set([...primaryByKey.keys(), ...comparisonByKey.keys()])];
  return keys.flatMap((key) => {
    const primaryValue = primaryByKey.get(key) ?? null;
    const comparisonValue = comparisonByKey.get(key) ?? null;
    return policyValuesMatch(primaryValue, comparisonValue)
      ? []
      : [{ key, primaryValue, comparisonValue }];
  });
}

function hasCompletePolicySettings(run: ResultsRunSummary): boolean {
  const keys = new Set(run.policySettings.map((setting) => setting.key));
  return CENTRAL_BANK_POLICY_KEYS.every((key) => keys.has(key));
}

export function resolveRunBasePolicyId(run: ResultsRunSummary): BasePolicyId | null {
  if (run.configuration?.basePolicy) {
    return run.configuration.basePolicy;
  }
  return hasCompletePolicySettings(run) ? summariseRunPolicy(run.policySettings).basePolicyId : null;
}

function isUnchangedBasePolicyRun(run: ResultsRunSummary, basePolicyId: BasePolicyId): boolean {
  if (!hasCompletePolicySettings(run)) {
    return false;
  }
  if (run.configuration?.basePolicy && run.configuration.basePolicy !== basePolicyId) {
    return false;
  }
  const basePolicySettings = Object.entries(getBasePolicyOption(basePolicyId).values).map(([key, value]) => ({
    key,
    value
  }));
  return getPolicySettingDifferences(run.policySettings, basePolicySettings).length === 0;
}

export function isMatchedManualBaselineRun(
  primary: ResultsRunSummary,
  candidate: ResultsRunSummary
): boolean {
  if (primary.runId === candidate.runId) {
    return false;
  }
  const primaryBasePolicyId = resolveRunBasePolicyId(primary);
  return Boolean(
    primaryBasePolicyId &&
      isUnchangedBasePolicyRun(candidate, primaryBasePolicyId) &&
      getManualComparisonFieldDifferences(primary, candidate).length === 0
  );
}

export function getManualBaselinePolicyDifferences(
  primary: ResultsRunSummary,
  comparison: ResultsRunSummary
): { basePolicyId: BasePolicyId; differences: PolicySettingDifference[] } | null {
  const basePolicyId = resolveRunBasePolicyId(primary);
  if (!basePolicyId) {
    return null;
  }
  const basePolicySettings = Object.entries(getBasePolicyOption(basePolicyId).values).map(([key, value]) => ({
    key,
    value
  }));
  return {
    basePolicyId,
    differences: getPolicySettingDifferences(basePolicySettings, comparison.policySettings)
  };
}

export function findMatchedManualBaselineRun(
  runs: ResultsRunSummary[],
  primaryRunId: string
): ResultsRunSummary | null {
  const primary = runs.find((run) => run.runId === primaryRunId);
  if (!primary) {
    return null;
  }
  let best: ResultsRunSummary | null = null;
  for (const candidate of runs) {
    if (!isMatchedManualBaselineRun(primary, candidate)) {
      continue;
    }
    if (!best || runCreatedTime(candidate) > runCreatedTime(best)) {
      best = candidate;
    }
  }
  return best;
}

function formatManualComparisonFieldValue(
  value: ManualComparisonFieldValue,
  format: (typeof MANUAL_COMPARISON_MATCH_FIELDS)[number]['format']
): string {
  if (format === 'calibration') {
    if (!isManualCalibrationValue(value)) {
      return 'not recorded';
    }
    const households = value.ukHouseholds === null
      ? 'households not recorded'
      : `${value.ukHouseholds.toLocaleString('en-GB')} households`;
    const dwellings = value.ukDwellings === null
      ? 'dwellings not recorded'
      : `${value.ukDwellings.toLocaleString('en-GB')} dwellings`;
    return `${households} · ${dwellings}`;
  }
  if (value === null) {
    return 'not recorded';
  }
  if (format === 'integer' && typeof value === 'number') {
    return value.toLocaleString('en-GB', { maximumFractionDigits: 0 });
  }
  return String(value);
}

function formatCount(value: ManualComparisonFieldValue, singular: string, plural: string): string {
  if (typeof value !== 'number') {
    return `${plural} not recorded`;
  }
  return `${value.toLocaleString('en-GB')} ${value === 1 ? singular : plural}`;
}

function calibrationVintage(value: ManualComparisonFieldValue): string {
  if (!isManualCalibrationValue(value)) {
    return 'an unrecorded calibration';
  }
  if (value.ukHouseholds === 26_442_100 && value.ukDwellings === 22_626_000) {
    return 'the 2011 calibration';
  }
  if (value.ukHouseholds === 28_609_000 && value.ukDwellings === 30_676_974) {
    return 'the 2024 calibration';
  }
  if (value.ukHouseholds === null || value.ukDwellings === null) {
    return 'an unrecorded calibration';
  }
  return `${value.ukHouseholds.toLocaleString('en-GB')} households and ${value.ukDwellings.toLocaleString('en-GB')} dwellings`;
}

export function formatManualComparisonMismatchWarning(
  differences: ManualComparisonFieldDifference[]
): string | null {
  const steps = differences.find((difference) => difference.field.key === 'N_STEPS');
  const seeds = differences.find((difference) => difference.field.key === 'N_SIMS');
  if (!steps && !seeds) {
    return null;
  }

  const comparisonParts = [
    steps ? formatCount(steps.comparisonValue, 'step', 'steps') : null,
    seeds ? formatCount(seeds.comparisonValue, 'seed', 'seeds') : null
  ].filter((value): value is string => Boolean(value));
  const primaryParts = [
    steps ? formatCount(steps.primaryValue, 'step', 'steps') : null,
    seeds ? formatCount(seeds.primaryValue, 'seed', 'seeds') : null
  ].filter((value): value is string => Boolean(value));
  const advice = steps && seeds
    ? 'We advise using the same number of steps; the results with fewer seeds could be noisier.'
    : steps
      ? 'We advise comparing runs with the same number of steps.'
      : 'The results with fewer seeds could be noisier.';
  return `The comparison run used ${comparisonParts.join(' and ')}; the primary run used ${primaryParts.join(' and ')}. ${advice}`;
}

/** Visible calibration explanation, kept separate from run-setup advice. */
export function formatManualComparisonCalibrationNotice(
  differences: ManualComparisonFieldDifference[]
): string | null {
  const calibration = differences.find((difference) => difference.field.key === 'CALIBRATION_VINTAGE');
  if (!calibration) {
    return null;
  }
  return `The comparison run uses ${calibrationVintage(calibration.comparisonValue)} and the primary run uses ${calibrationVintage(calibration.primaryValue)}, which changes housing supply as well as policy. The difference below reflects both.`;
}

/** The dropdown stays compact; only calibration vintage is useful before selection. */
export function formatManualComparisonOptionAnnotation(
  differences: ManualComparisonFieldDifference[]
): string {
  const calibration = differences.find(
    (difference) => difference.field.key === 'CALIBRATION_VINTAGE'
  );
  if (!calibration) {
    return '';
  }
  return calibrationVintage(calibration.comparisonValue).replace(/^the /, '');
}

/** Full audited detail for the disclosure; calibration is already one paired conceptual field. */
export function buildManualComparisonDisclosureRows(
  differences: ManualComparisonFieldDifference[]
): ManualComparisonDisclosureRow[] {
  return differences.map((difference) => ({
    key: difference.field.key,
    label: difference.field.label,
    primaryValue: formatManualComparisonFieldValue(difference.primaryValue, difference.field.format),
    comparisonValue: formatManualComparisonFieldValue(difference.comparisonValue, difference.field.format)
  }));
}

/**
 * Produces an ordinary builder draft with only the two matching setup values carried over. The
 * standard builder supplies every other default, including the selected base policy's lever values.
 */
export function buildMatchingBaselineScenarioDraft(primary: ResultsRunSummary): ScenarioDraftV1 | null {
  const configuration = primary.configuration;
  const basePolicy = resolveRunBasePolicyId(primary);
  const modelVersion = configuration?.modelVersion ?? extractVersionFromResultsRunId(primary.runId);
  if (!configuration || !modelVersion || !basePolicy) {
    return null;
  }

  const steps = configuration.parameterValues.N_STEPS;
  const seeds = configuration.parameterValues.N_SIMS;
  if (typeof steps !== 'number' || typeof seeds !== 'number') {
    return null;
  }

  const primaryLabel = primary.title?.trim() || primary.runId;
  return {
    version: 1,
    title: `Matched baseline for ${primaryLabel}`,
    calibratedModel: modelVersion,
    basePolicy,
    formValues: {
      N_STEPS: String(steps),
      N_SIMS: String(seeds)
    },
    maxWorkers: '1',
    lockedParameterKeys: ['N_STEPS', 'N_SIMS']
  };
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
  requestedComparisonRunId: string,
  options: { defaultToMatchedBaseline?: boolean } = {}
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
      comparisonRunId:
        requestedComparison && requestedComparison !== requestedBaseline
          ? requestedComparison
          : !hasRequestedComparison && options.defaultToMatchedBaseline !== false
            ? findMatchedManualBaselineRun(runs, requestedBaseline)?.runId ?? ''
            : ''
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
    comparisonRunId:
      options.defaultToMatchedBaseline === false
        ? ''
        : findMatchedManualBaselineRun(runs, baselineRunId)?.runId ?? ''
  };
}

export function computeKpiPercentDelta(
  primaryValue: number | null,
  comparisonValue: number | null
): number | null {
  if (
    primaryValue === null ||
    comparisonValue === null ||
    !Number.isFinite(primaryValue) ||
    !Number.isFinite(comparisonValue) ||
    Math.abs(comparisonValue) < KPI_BASELINE_EPSILON
  ) {
    return null;
  }

  return ((primaryValue - comparisonValue) / Math.abs(comparisonValue)) * 100;
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
  primaryValue: number | null,
  comparisonValue: number | null,
  units: string
): number | null {
  if (
    primaryValue === null ||
    comparisonValue === null ||
    !Number.isFinite(primaryValue) ||
    !Number.isFinite(comparisonValue)
  ) {
    return null;
  }

  if (units === '%' || units === 'percentage points') {
    return primaryValue - comparisonValue;
  }
  if (units === 'rate') {
    return (primaryValue - comparisonValue) * 100;
  }
  return computeKpiPercentDelta(primaryValue, comparisonValue);
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

function formatRelativeDelta(primaryValue: number, comparisonValue: number): string | null {
  const relativeDelta = computeKpiPercentDelta(primaryValue, comparisonValue);
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
  primaryValue: number | null,
  comparisonValue: number | null,
  units: string,
  scaling?: ResultsIndicatorScaling
): string {
  if (
    primaryValue === null ||
    comparisonValue === null ||
    !Number.isFinite(primaryValue) ||
    !Number.isFinite(comparisonValue)
  ) {
    return 'n/a';
  }

  const absoluteDelta = primaryValue - comparisonValue;
  if (usesCompactFormat(scaling)) {
    const normalizedDelta = Math.abs(absoluteDelta) < KPI_BASELINE_EPSILON ? 0 : absoluteDelta;
    const sign = normalizedDelta >= 0 ? '+' : '-';
    const compact = formatCompactSignificant(Math.abs(normalizedDelta));
    const relativeText = formatRelativeDelta(primaryValue, comparisonValue);
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

  const relativeText = formatRelativeDelta(primaryValue, comparisonValue);
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
