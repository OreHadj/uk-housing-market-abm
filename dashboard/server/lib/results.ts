import fs from 'node:fs';
import path from 'node:path';
import type {
  KpiMetricWindowType,
  KpiMetricSummary,
  ResultsCompareWindow,
  ResultsCompareIndicator,
  ResultsComparePayload,
  ResultsCoverageStatus,
  ResultsFileManifestEntry,
  ResultsFileType,
  ResultsIndicatorAvailability,
  ResultsIndicatorMeta,
  ResultsIndicatorScaling,
  ResultsPolicySetting,
  ResultsRunConfiguration,
  ResultsRunConfigurationValue,
  ResultsRunDetail,
  ResultsRunProvenance,
  ResultsRunStatus,
  ResultsRunSummary,
  ResultsSeriesPayload,
  ResultsSeriesPoint,
  ResultsSeriesSource
} from '../../shared/types';
import { computeKpiFromValues } from './stats/kpi';
import {
  formatRuntimePath,
  resolveRuntimePaths,
  type RuntimePathInput,
  type RuntimePaths
} from './runtimePaths';
import { isDashboardManagedRun } from './runOwnership';
import { CENTRAL_BANK_POLICY_KEYS, isBasePolicyId } from '../../shared/policyCatalogue';
import { RUN_MANIFEST_FILE_NAME } from './runManifest';

type CompareWindow = ResultsCompareWindow;
type SmoothWindow = 0 | 3 | 12;
const POST_500_CUTOFF_TICKS = 500;
const SPIN_UP_CUTOFF_TICKS = 200;

interface IndicatorDefinition {
  id: string;
  title: string;
  units: string;
  description: string;
  source: ResultsSeriesSource;
  /**
   * Whether this indicator is already at UK scale, needs scaling here, or is scale-free. Every
   * extensive quantity on the page is presented UK-scaled; mixing raw agent counts with
   * Java-scaled ones is the defect this field exists to close.
   */
  scaling: ResultsIndicatorScaling;
  fileName?: string;
  outputColumn?: string;
  /**
   * A share of modelled households rather than a column of its own: the named output column divided
   * by TotalPopulation, month by month, as a percentage. Shares are scale-free, so they carry
   * `scaling: 'none'` and need no UK_HOUSEHOLDS.
   */
  shareOfHouseholdsColumn?: string;
}

interface OutputRow {
  modelTime: number;
  values: Record<string, number | null>;
}

interface ParsedOutputFile {
  status: Exclude<ResultsCoverageStatus, 'unsupported'>;
  note?: string;
  rowCount: number;
  rows: OutputRow[];
  availableColumns: Set<string>;
  missingRequiredColumns: string[];
}

interface ParsedCoreIndicatorFile {
  status: Exclude<ResultsCoverageStatus, 'unsupported'>;
  note?: string;
  values: Array<number | null>;
  missingValueCount?: number;
}

interface CachedValue<T> {
  sizeBytes: number;
  modifiedMs: number;
  value: T;
}

interface RunDiagnostics {
  summary: ResultsRunSummary;
  detail: ResultsRunDetail;
  manifest: ResultsFileManifestEntry[];
}

export const OUTPUT_FILE_NAME = 'Output-run1.csv';
const PROTECTED_RESULTS_RUN_IDS = new Set(['v0-output', 'v4.0-output']);

/** The controls shown in Step 4 of the manual policy-scenario builder, in creation order. */
const MANUAL_RUN_CONFIGURATION_KEYS = [
  'N_STEPS',
  'N_SIMS',
  'TARGET_POPULATION',
  'ROLLING_WINDOW_SIZE_FOR_CORE_INDICATORS',
  'CUMULATIVE_WEIGHT_BEYOND_YEAR',
  'TIME_TO_START_RECORDING_TRANSACTIONS',
  'recordTransactions',
  'recordNBidUpFrequency',
  'recordCoreIndicators',
  'recordQualityBandPrice',
  'recordHouseholdID',
  'recordEmploymentIncome',
  'recordRentalIncome',
  'recordBankBalance',
  'recordHousingWealth',
  'recordTotalDebt',
  'recordHousingStatus',
  'recordConsumption',
  'recordNHousesOwned',
  'recordAge',
  'recordSavingRate'
] as const;

const CORE_INDICATORS: IndicatorDefinition[] = [
  {
    id: 'core_ooLTV',
    title: 'Owner-occupier LTV, mean above median (%)',
    units: '%',
    description: 'Owner-occupier mortgage loan-to-value, averaged over the loans above the median. Not the mean LTV of all new lending \u2014 the new-lending card carries that.',
    source: 'core_indicator',
    scaling: 'none',
    fileName: 'coreIndicator-ooLTV.csv'
  },
  {
    id: 'core_ooLTI',
    title: 'Owner-occupier LTI, mean above median',
    units: 'ratio',
    description: 'Owner-occupier mortgage loan-to-income, averaged over the loans above the median. Not the mean LTI of all new lending \u2014 the new-lending card carries that.',
    source: 'core_indicator',
    scaling: 'none',
    fileName: 'coreIndicator-ooLTI.csv'
  },
  {
    id: 'core_btlLTV',
    title: 'Buy-to-let LTV, mean (%)',
    units: '%',
    description: 'Buy-to-let mortgage loan-to-value, mean across new buy-to-let lending.',
    source: 'core_indicator',
    scaling: 'none',
    fileName: 'coreIndicator-btlLTV.csv'
  },
  {
    id: 'core_creditGrowth',
    title: 'Household credit growth (12-month)',
    units: '%',
    description: 'Twelve-month nominal growth rate of household credit. The long-run mean sits near zero because the series cycles between booms and busts; read it alongside its spread rather than on its own.',
    source: 'core_indicator',
    scaling: 'none',
    fileName: 'coreIndicator-creditGrowth.csv'
  },
  {
    id: 'core_debtToIncome',
    title: 'Debt to income \u2014 all mortgage debt',
    units: '%',
    description: 'Owner-occupier plus buy-to-let mortgage debt, divided by the annualised net total income of the whole household sector.',
    source: 'core_indicator',
    scaling: 'none',
    fileName: 'coreIndicator-debtToIncome.csv'
  },
  {
    id: 'core_ooDebtToIncome',
    title: 'Debt to income \u2014 owner-occupier debt only',
    units: '%',
    description: 'Owner-occupier mortgage debt only, divided by the same whole-sector annualised net total income. The gap against the all-debt row is buy-to-let credit, not a different population or a different income measure.',
    source: 'core_indicator',
    scaling: 'none',
    fileName: 'coreIndicator-ooDebtToIncome.csv'
  },
  {
    id: 'core_mortgageApprovals',
    title: 'Mortgage approvals (per month)',
    units: 'count/month',
    description: 'New loans approved for house purchase per month, already scaled by the model to the UK household count.',
    source: 'core_indicator',
    scaling: 'model',
    fileName: 'coreIndicator-mortgageApprovals.csv'
  },
  {
    id: 'core_housingTransactions',
    title: 'Housing transactions (per month)',
    units: 'count/month',
    description: 'Houses bought and sold per month, already scaled by the model to the UK household count.',
    source: 'core_indicator',
    scaling: 'model',
    fileName: 'coreIndicator-housingTransactions.csv'
  },
  {
    id: 'core_advancesToFTB',
    title: 'Advances to first-time buyers (per month)',
    units: 'count/month',
    description: 'Advances to first-time buyers per month, already scaled by the model to the UK household count.',
    source: 'core_indicator',
    scaling: 'model',
    fileName: 'coreIndicator-advancesToFTB.csv'
  },
  {
    id: 'core_advancesToBTL',
    title: 'Advances to buy-to-let investors (per month)',
    units: 'count/month',
    description: 'Advances to buy-to-let investors per month, already scaled by the model to the UK household count.',
    source: 'core_indicator',
    scaling: 'model',
    fileName: 'coreIndicator-advancesToBTL.csv'
  },
  {
    id: 'core_advancesToHM',
    title: 'Advances to home movers (per month)',
    units: 'count/month',
    description: 'Advances to home movers per month, already scaled by the model to the UK household count.',
    source: 'core_indicator',
    scaling: 'model',
    fileName: 'coreIndicator-advancesToHM.csv'
  },
  {
    id: 'core_housePriceGrowth',
    title: 'House price growth (quarter on quarter)',
    units: '%',
    description: 'Quarter-on-quarter growth in the sale house price index.',
    source: 'core_indicator',
    scaling: 'none',
    fileName: 'coreIndicator-housePriceGrowth.csv'
  },
  {
    id: 'core_priceToIncome',
    title: 'Price to income (all households, net income)',
    units: 'ratio',
    description: 'Aggregate house price to income ratio across every household in the model, against annualised net total income \u2014 social-housing households included. This is a different statistic from the loan-level price-to-income the paper reports as 4.4, which the new-lending card carries.',
    source: 'core_indicator',
    scaling: 'none',
    fileName: 'coreIndicator-priceToIncome.csv'
  },
  {
    id: 'core_rentalYield',
    title: 'Rental yield',
    units: '%',
    description: 'Average rental yield on the stock of rented housing.',
    source: 'core_indicator',
    scaling: 'none',
    fileName: 'coreIndicator-rentalYield.csv'
  },
  {
    id: 'core_interestRateSpread',
    title: 'Mortgage interest rate spread',
    units: 'percentage points',
    description: 'Spread on new owner-occupier mortgage lending, in percentage points over the base rate.',
    source: 'core_indicator',
    scaling: 'none',
    fileName: 'coreIndicator-interestRateSpread.csv'
  }
];

const OUTPUT_INDICATORS: IndicatorDefinition[] = [
  {
    id: 'output_nHomeless',
    title: 'Households in social housing',
    units: 'count',
    description:
      'Households with no dwelling of their own in the model. The published calibration deliberately '
      + 'leaves social housing out of the modelled dwelling stock, so this count is the residual of '
      + 'the dwelling-stock constraint \u2014 households minus occupied dwellings \u2014 and stands for '
      + 'the social-rented sector. It is not a flow of households between tenancies: a renter whose '
      + 'tenancy ends bids for a new home in the same step. Scaled to UK households.',
    source: 'output',
    scaling: 'dashboard',
    outputColumn: 'nHomeless'
  },
  {
    id: 'output_nRenting',
    title: 'Households renting privately',
    units: 'count',
    description: 'Households renting from a buy-to-let landlord, scaled to UK households.',
    source: 'output',
    scaling: 'dashboard',
    outputColumn: 'nRenting'
  },
  {
    id: 'output_nOwnerOccupier',
    title: 'Owner-occupier households',
    units: 'count',
    description: 'Households living in a home they own, scaled to UK households.',
    source: 'output',
    scaling: 'dashboard',
    outputColumn: 'nOwnerOccupier'
  },
  {
    id: 'output_nActiveBTL',
    title: 'Active buy-to-let households',
    units: 'count',
    description: 'Households letting at least one property, scaled to UK households.',
    source: 'output',
    scaling: 'dashboard',
    outputColumn: 'nActiveBTL'
  },
  {
    id: 'output_nNonOwner',
    title: 'Non-owner households',
    units: 'count',
    description:
      'Households that own no property \u2014 private renters plus the social-housing residual. Scaled '
      + 'to UK households.',
    source: 'output',
    scaling: 'dashboard',
    outputColumn: 'nNonOwner'
  },
  {
    id: 'output_ownershipRate',
    title: 'Ownership rate',
    units: '%',
    description:
      'Share of households living in a home they own, computed month by month against that '
      + 'month\u2019s modelled households. A share, so it needs no UK scaling.',
    source: 'output',
    scaling: 'none',
    shareOfHouseholdsColumn: 'nOwnerOccupier'
  },
  {
    id: 'output_nonOwnerShare',
    title: 'Non-owner share',
    units: '%',
    description:
      'Share of households that own no property, computed month by month against that month\u2019s '
      + 'modelled households. This is the paper\u2019s ~38%, and it is the non-owner count \u2014 not the '
      + 'private-renting count, which excludes the social-housing residual.',
    source: 'output',
    scaling: 'none',
    shareOfHouseholdsColumn: 'nNonOwner'
  },
  {
    id: 'output_saleHPI',
    title: 'Sale HPI (base = initial calibration)',
    units: 'index',
    description: 'Sale market house price index, based at the model\u2019s initial calibration rather than at any calendar year.',
    source: 'output',
    scaling: 'none',
    outputColumn: 'Sale HPI'
  },
  {
    id: 'output_saleAvSalePrice',
    title: 'Average sale price',
    units: 'GBP',
    description: 'Average completed sale transaction price.',
    source: 'output',
    scaling: 'none',
    outputColumn: 'Sale AvSalePrice'
  },
  {
    id: 'output_saleAvMonthsOnMarket',
    title: 'Average months on market \u2014 sale',
    units: 'months',
    description: 'Average time a sale listing spends on the market, in months.',
    source: 'output',
    scaling: 'none',
    outputColumn: 'Sale AvMonthsOnMarket'
  },
  {
    id: 'output_rentalHPI',
    title: 'Rental HPI (base = initial calibration)',
    units: 'index',
    description: 'Rental market price index, based at the model\u2019s initial calibration rather than at any calendar year.',
    source: 'output',
    scaling: 'none',
    outputColumn: 'Rental HPI'
  },
  {
    id: 'output_rentalAvSalePrice',
    title: 'Average monthly rent',
    units: 'GBP',
    description: 'Average agreed monthly rent on new tenancies.',
    source: 'output',
    scaling: 'none',
    outputColumn: 'Rental AvSalePrice'
  },
  {
    id: 'output_rentalAvMonthsOnMarket',
    title: 'Average months on market \u2014 rental',
    units: 'months',
    description: 'Average time a rental listing spends on the market, in months.',
    source: 'output',
    scaling: 'none',
    outputColumn: 'Rental AvMonthsOnMarket'
  },
  {
    id: 'output_creditStock',
    title: 'Household credit stock',
    units: 'GBP',
    description: 'Total outstanding household mortgage debt, scaled to UK households.',
    source: 'output',
    scaling: 'dashboard',
    outputColumn: 'creditStock'
  },
  {
    id: 'output_interestRate',
    title: 'Mortgage interest rate',
    units: 'rate',
    description: 'Interest rate charged on new mortgages: the base rate plus the bank\u2019s spread. The spread is endogenous \u2014 the bank recalculates it to steer lending back to its target \u2014 so this row is not an exogenous policy input.',
    source: 'output',
    scaling: 'none',
    outputColumn: 'interestRate'
  }
];

/**
 * Modelled households in the given month. Retained by the output parser so dashboard-scaled counts
 * can be divided by it per month, but deliberately kept out of OUTPUT_INDICATORS: adding it there
 * would both make it a visible row and, via REQUIRED_OUTPUT_COLUMNS, fail the whole run when a
 * legacy output file lacks it. Decision 6 asks for a per-row reason instead.
 */
const TOTAL_POPULATION_COLUMN = 'TotalPopulation';

/**
 * Every column the parser keeps: the indicator columns, the numerators of the derived household
 * shares, and the scaling denominator. Only the first group is required — a run missing a share
 * numerator loses that row with a reason, not the whole run.
 */
const RETAINED_OUTPUT_COLUMNS = new Set<string>([
  ...OUTPUT_INDICATORS.map((indicator) => indicator.outputColumn).filter(
    (columnName): columnName is string => columnName !== undefined
  ),
  ...OUTPUT_INDICATORS.map((indicator) => indicator.shareOfHouseholdsColumn).filter(
    (columnName): columnName is string => columnName !== undefined
  ),
  TOTAL_POPULATION_COLUMN
]);

const ALL_INDICATORS: IndicatorDefinition[] = [...CORE_INDICATORS, ...OUTPUT_INDICATORS];
const INDICATOR_BY_ID = new Map(ALL_INDICATORS.map((indicator) => [indicator.id, indicator]));
const REQUIRED_CORE_FILES = new Set(CORE_INDICATORS.map((indicator) => indicator.fileName as string));
const REQUIRED_OUTPUT_COLUMNS = new Set(
  OUTPUT_INDICATORS.map((indicator) => indicator.outputColumn).filter(
    (columnName): columnName is string => columnName !== undefined
  )
);
const REQUIRED_PARSE_TARGET_COUNT = REQUIRED_CORE_FILES.size + 1;
export const RUN_CONFIG_FILE_NAME = 'config.properties';
/**
 * Everything a run folder must contain for the results parsers to produce a full page. config is in
 * the set because UK_HOUSEHOLDS lives there, and without it the scaled count rows go unavailable —
 * so a remote workspace that skipped it would silently lose five indicators.
 */
export const REQUIRED_RESULTS_PARSE_FILE_NAMES = [
  OUTPUT_FILE_NAME,
  RUN_CONFIG_FILE_NAME,
  ...REQUIRED_CORE_FILES
];
const EXPECTED_FULL_OUTPUT_ROW_COUNT = 2001;

/** The loan-level sale file, parsed for the new-lending distributions (lendingDistribution.ts). */
export const SALE_TRANSACTIONS_FILE_NAME = 'SaleTransactions-run1.csv';

const TRANSACTION_FILES = new Set([
  SALE_TRANSACTIONS_FILE_NAME,
  'RentalTransactions-run1.csv',
  'NBidUpFrequency-run1.csv'
]);

const MICRO_SNAPSHOT_FILES = new Set([
  'HouseholdID-run1.csv',
  'MonthlyGrossEmploymentIncome-run1.csv',
  'MonthlyGrossRentalIncome-run1.csv',
  'BankBalance-run1.csv',
  'HousingWealth-run1.csv',
  'NHousesOwned-run1.csv',
  'Age-run1.csv',
  'SavingRate-run1.csv',
  'TotalDebt-run1.csv',
  'HousingStatus-run1.csv',
  'NonHousingConsumption-run1.csv'
]);
const MICRO_SNAPSHOT_FILE_PATTERNS = [
  /^TotalDebt-run\d+\.csv$/,
  /^HousingStatus-run\d+\.csv$/,
  /^NonHousingConsumption-run\d+\.csv$/
];

const parsedOutputCache = new Map<string, CachedValue<ParsedOutputFile>>();
const parsedCoreCache = new Map<string, CachedValue<ParsedCoreIndicatorFile>>();
/**
 * config.properties is read once per indicator while scaling, so it is cached even in production —
 * unlike the row caches above, which hold megabytes. Entries are still validated against mtime and
 * size, so a rewritten config is picked up on the next read.
 */
const runConfigCache = new Map<string, CachedValue<Map<string, number>>>();
const RUN_CONFIG_CACHE_MAX_ENTRIES = 8;
const OUTPUT_CACHE_MAX_ENTRIES = (process.env.NODE_ENV?.trim().toLowerCase() ?? '') === 'production' ? 0 : 2;
const CORE_CACHE_MAX_ENTRIES = (process.env.NODE_ENV?.trim().toLowerCase() ?? '') === 'production' ? 0 : 16;

function setBoundedCacheValue<T>(cache: Map<string, CachedValue<T>>, key: string, value: CachedValue<T>, maxEntries: number): void {
  if (maxEntries <= 0) {
    return;
  }
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    cache.delete(oldestKey);
  }
}

/** Exported for lendingDistribution.ts, which resolves the same run folders. */
export function resolveResultsRootPath(pathsInput: RuntimePathInput): string {
  return resolveResultsRoot(pathsInput);
}

function resolveResultsRoot(pathsInput: RuntimePathInput): string {
  const paths = resolveRuntimePaths(pathsInput);
  return paths.resultsRoot;
}

function toIsoTime(value: Date): string {
  return value.toISOString();
}

function safeNumber(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const CORE_INDICATOR_NUMERIC_TOKEN_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const CORE_INDICATOR_MISSING_TOKENS = new Set([
  'nan',
  '+nan',
  '-nan',
  'infinity',
  '+infinity',
  '-infinity'
]);

type CoreIndicatorTokenParseResult =
  | { kind: 'number'; value: number }
  | { kind: 'missing' }
  | { kind: 'malformed'; token: string };

function parseCoreIndicatorToken(token: string): CoreIndicatorTokenParseResult {
  if (CORE_INDICATOR_MISSING_TOKENS.has(token.toLowerCase())) {
    return { kind: 'missing' };
  }

  if (!CORE_INDICATOR_NUMERIC_TOKEN_PATTERN.test(token)) {
    return { kind: 'malformed', token };
  }

  const value = Number(token);
  if (!Number.isFinite(value)) {
    return { kind: 'missing' };
  }

  return { kind: 'number', value };
}

function parseSemicolonRow(line: string): string[] {
  return line.split(';').map((token) => token.trim());
}

function readNonEmptyLines(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function smoothSeries(points: ResultsSeriesPoint[], window: SmoothWindow): ResultsSeriesPoint[] {
  if (window === 0) {
    return points;
  }

  return points.map((point, index) => {
    const start = Math.max(0, index - window + 1);
    const values = points
      .slice(start, index + 1)
      .map((entry) => entry.value)
      .filter((value): value is number => value !== null);
    if (values.length === 0) {
      return { modelTime: point.modelTime, value: null };
    }
    const total = values.reduce((sum, value) => sum + value, 0);
    return { modelTime: point.modelTime, value: total / values.length };
  });
}

function normalizeSmoothWindow(rawWindow: number | undefined): SmoothWindow {
  if (rawWindow === 3 || rawWindow === 12) {
    return rawWindow;
  }
  return 0;
}

function normalizeWindow(rawWindow: string | undefined): CompareWindow {
  if (
    rawWindow === 'post200' ||
    rawWindow === 'post500' ||
    rawWindow === 'post1000' ||
    rawWindow === 'post1500' ||
    rawWindow === 'post2000' ||
    rawWindow === 'tail120' ||
    rawWindow === 'full'
  ) {
    return rawWindow;
  }
  return 'post500';
}

function parseCoreIndicatorFile(filePath: string): ParsedCoreIndicatorFile {
  try {
    const lines = readNonEmptyLines(filePath);
    if (lines.length === 0) {
      return { status: 'empty', note: 'File is empty.', values: [] };
    }

    const tokens = parseSemicolonRow(lines[0]).filter((token) => token.length > 0);
    if (tokens.length === 0) {
      return { status: 'empty', note: 'File contains no numeric tokens.', values: [] };
    }

    const values: Array<number | null> = [];
    let missingValueCount = 0;
    for (const token of tokens) {
      const parsed = parseCoreIndicatorToken(token);
      if (parsed.kind === 'malformed') {
        return {
          status: 'error',
          note: `Core indicator contains malformed token: ${parsed.token}`,
          values: []
        };
      }
      if (parsed.kind === 'missing') {
        missingValueCount += 1;
        values.push(null);
      } else {
        values.push(parsed.value);
      }
    }

    if (missingValueCount > 0) {
      return {
        status: 'supported',
        note: `${missingValueCount} missing core indicator value${missingValueCount === 1 ? '' : 's'}.`,
        values,
        missingValueCount
      };
    }

    return { status: 'supported', values, missingValueCount: 0 };
  } catch (error) {
    return { status: 'error', note: `Failed to parse core indicator: ${(error as Error).message}`, values: [] };
  }
}

function parseOutputFile(filePath: string): ParsedOutputFile {
  try {
    const lines = readNonEmptyLines(filePath);
    if (lines.length === 0) {
      return {
        status: 'empty',
        note: 'File is empty.',
        rowCount: 0,
        rows: [],
        availableColumns: new Set<string>(),
        missingRequiredColumns: []
      };
    }

    if (lines.length < 2) {
      return {
        status: 'error',
        note: 'Output file has header but no data rows.',
        rowCount: 0,
        rows: [],
        availableColumns: new Set<string>(),
        missingRequiredColumns: []
      };
    }

    const header = parseSemicolonRow(lines[0]);
    const headerIndex = new Map<string, number>();
    header.forEach((columnName, index) => {
      if (!headerIndex.has(columnName)) {
        headerIndex.set(columnName, index);
      }
    });

    if (!headerIndex.has('Model time')) {
      return {
        status: 'error',
        note: 'Missing "Model time" column in output header.',
        rowCount: 0,
        rows: [],
        availableColumns: new Set<string>(),
        missingRequiredColumns: []
      };
    }

    const availableColumns = new Set<string>();
    const rows: OutputRow[] = [];
    const modelTimeIndex = headerIndex.get('Model time') as number;
    const outputColumns = [...RETAINED_OUTPUT_COLUMNS];

    for (const columnName of outputColumns) {
      if (headerIndex.has(columnName)) {
        availableColumns.add(columnName);
      }
    }
    const missingRequiredColumns = [...REQUIRED_OUTPUT_COLUMNS].filter(
      (columnName) => !availableColumns.has(columnName)
    );

    for (const line of lines.slice(1)) {
      const tokens = parseSemicolonRow(line);
      const modelTimeToken = tokens[modelTimeIndex] ?? '';
      const modelTime = Number.parseInt(modelTimeToken, 10);
      if (!Number.isFinite(modelTime)) {
        continue;
      }

      const values: Record<string, number | null> = {};
      for (const columnName of outputColumns) {
        const index = headerIndex.get(columnName);
        if (index === undefined) {
          continue;
        }
        values[columnName] = safeNumber(tokens[index] ?? '');
      }

      rows.push({ modelTime, values });
    }

    if (rows.length === 0) {
      return {
        status: 'error',
        note: 'No parseable output rows found.',
        rowCount: 0,
        rows: [],
        availableColumns,
        missingRequiredColumns
      };
    }

    if (missingRequiredColumns.length > 0) {
      return {
        status: 'error',
        note: `Missing required output columns: ${missingRequiredColumns.join(', ')}`,
        rowCount: rows.length,
        rows,
        availableColumns,
        missingRequiredColumns
      };
    }

    return {
      status: 'supported',
      rowCount: rows.length,
      rows,
      availableColumns,
      missingRequiredColumns
    };
  } catch (error) {
    return {
      status: 'error',
      note: `Failed to parse output file: ${(error as Error).message}`,
      rowCount: 0,
      rows: [],
      availableColumns: new Set<string>(),
      missingRequiredColumns: []
    };
  }
}

function getFileStats(filePath: string): fs.Stats {
  return fs.statSync(filePath);
}

function getCachedParsedOutput(filePath: string): ParsedOutputFile {
  const fileStats = getFileStats(filePath);
  const cached = parsedOutputCache.get(filePath);
  if (OUTPUT_CACHE_MAX_ENTRIES > 0 && cached && cached.modifiedMs === fileStats.mtimeMs && cached.sizeBytes === fileStats.size) {
    parsedOutputCache.delete(filePath);
    parsedOutputCache.set(filePath, cached);
    return cached.value;
  }

  const parsed = parseOutputFile(filePath);
  setBoundedCacheValue(parsedOutputCache, filePath, {
    modifiedMs: fileStats.mtimeMs,
    sizeBytes: fileStats.size,
    value: parsed
  }, OUTPUT_CACHE_MAX_ENTRIES);
  return parsed;
}

function getCachedParsedCore(filePath: string): ParsedCoreIndicatorFile {
  const fileStats = getFileStats(filePath);
  const cached = parsedCoreCache.get(filePath);
  if (CORE_CACHE_MAX_ENTRIES > 0 && cached && cached.modifiedMs === fileStats.mtimeMs && cached.sizeBytes === fileStats.size) {
    parsedCoreCache.delete(filePath);
    parsedCoreCache.set(filePath, cached);
    return cached.value;
  }

  const parsed = parseCoreIndicatorFile(filePath);
  setBoundedCacheValue(parsedCoreCache, filePath, {
    modifiedMs: fileStats.mtimeMs,
    sizeBytes: fileStats.size,
    value: parsed
  }, CORE_CACHE_MAX_ENTRIES);
  return parsed;
}

function toIndicatorMeta(indicator: IndicatorDefinition): ResultsIndicatorMeta {
  return {
    id: indicator.id,
    title: indicator.title,
    units: indicator.units,
    description: indicator.description,
    source: indicator.source,
    scaling: indicator.scaling
  };
}

export function resolveResultsFileType(fileName: string): ResultsFileType {
  if (fileName === OUTPUT_FILE_NAME) {
    return 'output';
  }
  if (fileName.startsWith('coreIndicator-') && fileName.endsWith('.csv')) {
    return 'core_indicator';
  }
  if (TRANSACTION_FILES.has(fileName)) {
    return 'transaction';
  }
  if (MICRO_SNAPSHOT_FILES.has(fileName) || MICRO_SNAPSHOT_FILE_PATTERNS.some((pattern) => pattern.test(fileName))) {
    return 'micro_snapshot';
  }
  if (fileName === 'config.properties') {
    return 'config';
  }
  return 'other';
}

function resolveFileCoverage(
  runPath: string,
  fileName: string,
  fileType: ResultsFileType,
  sizeBytes: number
): { status: ResultsCoverageStatus; note?: string } {
  if (fileType === 'output') {
    const parsed = getCachedParsedOutput(path.join(runPath, fileName));
    return { status: parsed.status, note: parsed.note };
  }

  if (fileType === 'core_indicator') {
    const parsed = getCachedParsedCore(path.join(runPath, fileName));
    return { status: parsed.status, note: parsed.note };
  }

  if (sizeBytes === 0) {
    return { status: 'empty', note: 'File is empty.' };
  }

  if (fileName === SALE_TRANSACTIONS_FILE_NAME) {
    // Parsed for the new-lending distributions. Not parsed here: the manifest is built for
    // every run on every listing, and this file is ~8 MB.
    return { status: 'supported', note: 'Charted in New lending.' };
  }

  if (fileType === 'transaction' || fileType === 'micro_snapshot') {
    return { status: 'unsupported', note: 'Manifest only (not charted).' };
  }

  return { status: 'unsupported' };
}

function computeFolderSizeAndFileCount(runPath: string): { sizeBytes: number; fileCount: number } {
  const entries = fs.readdirSync(runPath, { withFileTypes: true });
  let totalSize = 0;
  let fileCount = 0;

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const filePath = path.join(runPath, entry.name);
    const stats = fs.statSync(filePath);
    totalSize += stats.size;
    fileCount += 1;
  }

  return { sizeBytes: totalSize, fileCount };
}

function listRunDirectories(resultsRoot: string): string[] {
  if (!fs.existsSync(resultsRoot)) {
    return [];
  }

  return fs
    .readdirSync(resultsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'experiments')
    .map((entry) => entry.name);
}

/** Exported for lendingDistribution.ts; validates the run id and returns its folder. */
export function ensureResultsRunPath(resultsRoot: string, runId: string): string {
  return ensureRunExists(resultsRoot, runId);
}

function ensureRunExists(resultsRoot: string, runId: string): string {
  const normalizedRunId = runId.trim();
  if (!normalizedRunId || normalizedRunId.includes('/') || normalizedRunId.includes('\\')) {
    throw new Error(`Unknown run: ${runId}`);
  }

  const knownRunIds = new Set(listRunDirectories(resultsRoot));
  if (!knownRunIds.has(normalizedRunId)) {
    throw new Error(`Unknown run: ${runId}`);
  }

  const runPath = path.join(resultsRoot, normalizedRunId);
  if (!fs.existsSync(runPath) || !fs.statSync(runPath).isDirectory()) {
    throw new Error(`Unknown run: ${runId}`);
  }

  return runPath;
}

function getCoreParseStatus(runPath: string, fileName: string): ParsedCoreIndicatorFile {
  const filePath = path.join(runPath, fileName);
  if (!fs.existsSync(filePath)) {
    return { status: 'error', note: 'Required core indicator file is missing.', values: [] };
  }
  return getCachedParsedCore(filePath);
}

function getOutputParseStatus(runPath: string): ParsedOutputFile {
  const filePath = path.join(runPath, OUTPUT_FILE_NAME);
  if (!fs.existsSync(filePath)) {
    return {
      status: 'error',
      note: 'Required Output-run1.csv is missing.',
      rowCount: 0,
      rows: [],
      availableColumns: new Set<string>(),
      missingRequiredColumns: []
    };
  }
  return getCachedParsedOutput(filePath);
}

function buildManifest(paths: RuntimePaths, runPath: string): ResultsFileManifestEntry[] {
  const entries = fs.readdirSync(runPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(runPath, entry.name);
      const stats = fs.statSync(filePath);
      const fileType = resolveResultsFileType(entry.name);
      const coverage = resolveFileCoverage(runPath, entry.name, fileType, stats.size);
      return {
        fileName: entry.name,
        filePath: formatRuntimePath(paths, filePath),
        sizeBytes: stats.size,
        modifiedAt: toIsoTime(stats.mtime),
        fileType,
        coverageStatus: coverage.status,
        note: coverage.note
      } satisfies ResultsFileManifestEntry;
    });

  files.sort((left, right) => left.fileName.localeCompare(right.fileName));
  return files;
}

function clearRunFromParserCaches(runPath: string): void {
  for (const cacheKey of parsedOutputCache.keys()) {
    if (cacheKey.startsWith(`${runPath}${path.sep}`)) {
      parsedOutputCache.delete(cacheKey);
    }
  }
  for (const cacheKey of parsedCoreCache.keys()) {
    if (cacheKey.startsWith(`${runPath}${path.sep}`)) {
      parsedCoreCache.delete(cacheKey);
    }
  }
  for (const cacheKey of runConfigCache.keys()) {
    if (cacheKey.startsWith(`${runPath}${path.sep}`)) {
      runConfigCache.delete(cacheKey);
    }
  }
}

function computeRunStatusAndCoverage(runPath: string): {
  status: ResultsRunStatus;
  coverage: {
    requiredCount: number;
    supportedCount: number;
    emptyCount: number;
    errorCount: number;
  };
} {
  const output = getOutputParseStatus(runPath);
  const coreStatuses = CORE_INDICATORS.map((indicator) =>
    getCoreParseStatus(runPath, indicator.fileName as string)
  );

  const requiredStatuses: Array<Exclude<ResultsCoverageStatus, 'unsupported'>> = [
    output.status,
    ...coreStatuses.map((status) => status.status)
  ];

  const supportedCount = requiredStatuses.filter((status) => status === 'supported').length;
  const emptyCount = requiredStatuses.filter((status) => status === 'empty').length;
  const errorCount = requiredStatuses.filter((status) => status === 'error').length;

  const hasMissingRequiredFiles =
    !fs.existsSync(path.join(runPath, OUTPUT_FILE_NAME)) ||
    CORE_INDICATORS.some((indicator) => !fs.existsSync(path.join(runPath, indicator.fileName as string)));

  let status: ResultsRunStatus = 'complete';
  if (hasMissingRequiredFiles) {
    status = 'invalid';
  } else if (
    output.status !== 'supported' ||
    output.rowCount < EXPECTED_FULL_OUTPUT_ROW_COUNT ||
    coreStatuses.some((coreStatus) => coreStatus.status !== 'supported')
  ) {
    status = 'partial';
  }

  return {
    status,
    coverage: {
      requiredCount: REQUIRED_PARSE_TARGET_COUNT,
      supportedCount,
      emptyCount,
      errorCount
    }
  };
}

function toSeriesPointsFromCore(values: Array<number | null>): ResultsSeriesPoint[] {
  return values.map((value, index) => ({ modelTime: index, value }));
}

/**
 * Scaling is applied here, per month, before any aggregation. It cannot be pushed downstream: the
 * factor varies month to month (modelled households drift), so mean(v_t x k_t) != mean(v_t) x mean(k),
 * and computeKpi derives cv and range from these same points. Scaling only the mean later would leave
 * the three inconsistent, and the trend chart inconsistent with the row it was opened from.
 */
function toSeriesPointsFromOutput(
  rows: OutputRow[],
  columnName: string,
  ukHouseholds: number | null
): ResultsSeriesPoint[] {
  return rows.map((row) => {
    const value = row.values[columnName] ?? null;
    if (value === null || ukHouseholds === null) {
      return { modelTime: row.modelTime, value };
    }
    const modelHouseholds = row.values[TOTAL_POPULATION_COLUMN] ?? null;
    if (modelHouseholds === null || modelHouseholds <= 0) {
      return { modelTime: row.modelTime, value: null };
    }
    return { modelTime: row.modelTime, value: value * (ukHouseholds / modelHouseholds) };
  });
}

/** A share of that month's modelled households, in percent. Scale-free by construction. */
function toSharePointsFromOutput(rows: OutputRow[], numeratorColumn: string): ResultsSeriesPoint[] {
  return rows.map((row) => {
    const numerator = row.values[numeratorColumn] ?? null;
    const modelHouseholds = row.values[TOTAL_POPULATION_COLUMN] ?? null;
    if (numerator === null || modelHouseholds === null || modelHouseholds <= 0) {
      return { modelTime: row.modelTime, value: null };
    }
    return { modelTime: row.modelTime, value: (numerator / modelHouseholds) * 100 };
  });
}

function getRawSeriesForIndicator(runPath: string, indicatorId: string): {
  indicator: IndicatorDefinition;
  points: ResultsSeriesPoint[];
  coverageStatus: ResultsCoverageStatus;
  note?: string;
} {
  const indicator = INDICATOR_BY_ID.get(indicatorId);
  if (!indicator) {
    throw new Error(`Unknown indicator id: ${indicatorId}`);
  }

  if (indicator.source === 'core_indicator') {
    const parsed = getCoreParseStatus(runPath, indicator.fileName as string);
    if (parsed.status !== 'supported') {
      return {
        indicator,
        points: [],
        coverageStatus: parsed.status,
        note: parsed.note
      };
    }

    return {
      indicator,
      points: toSeriesPointsFromCore(parsed.values),
      coverageStatus: 'supported',
      note: parsed.note
    };
  }

  const parsedOutput = getOutputParseStatus(runPath);
  if (parsedOutput.status !== 'supported') {
    return {
      indicator,
      points: [],
      coverageStatus: parsedOutput.status,
      note: parsedOutput.note
    };
  }

  if (indicator.shareOfHouseholdsColumn) {
    const numeratorColumn = indicator.shareOfHouseholdsColumn;
    const missing = [numeratorColumn, TOTAL_POPULATION_COLUMN].filter(
      (name) => !parsedOutput.availableColumns.has(name)
    );
    if (missing.length > 0) {
      return {
        indicator,
        points: [],
        coverageStatus: 'error',
        note: `${OUTPUT_FILE_NAME} is missing ${missing.join(' and ')}, so this share cannot be computed.`
      };
    }
    return {
      indicator,
      points: toSharePointsFromOutput(parsedOutput.rows, numeratorColumn),
      coverageStatus: 'supported'
    };
  }

  const columnName = indicator.outputColumn as string;
  if (!parsedOutput.availableColumns.has(columnName)) {
    return {
      indicator,
      points: [],
      coverageStatus: 'error',
      note: `Missing output column: ${columnName}`
    };
  }

  // Decision 6: no silent fallback. A count that cannot be scaled is reported unavailable with the
  // reason, rather than being shown at agent scale next to figures that are already at UK scale.
  let ukHouseholds: number | null = null;
  if (indicator.scaling === 'dashboard') {
    if (!parsedOutput.availableColumns.has(TOTAL_POPULATION_COLUMN)) {
      return {
        indicator,
        points: [],
        coverageStatus: 'error',
        note: `${OUTPUT_FILE_NAME} has no ${TOTAL_POPULATION_COLUMN} column, so this count cannot be scaled to UK households.`
      };
    }
    ukHouseholds = getRunProvenance(runPath).ukHouseholds;
    if (ukHouseholds === null || ukHouseholds <= 0) {
      return {
        indicator,
        points: [],
        coverageStatus: 'error',
        note: 'UK_HOUSEHOLDS is not recorded in this run\'s config.properties, so this count cannot be scaled to UK households.'
      };
    }
  }

  return {
    indicator,
    points: toSeriesPointsFromOutput(parsedOutput.rows, columnName, ukHouseholds),
    coverageStatus: 'supported'
  };
}

function isPointSeriesAvailable(points: ResultsSeriesPoint[]): boolean {
  return points.some((point) => point.value !== null);
}

function toKpiWindowType(window: CompareWindow): KpiMetricWindowType {
  switch (window) {
    case 'post500':
      return 'post_500';
    case 'post200':
      return 'post_200';
    case 'post1000':
      return 'post_1000';
    case 'post1500':
      return 'post_1500';
    case 'post2000':
      return 'post_2000';
    case 'tail120':
      return 'tail_120';
    default:
      return 'full';
  }
}

function emptyKpi(indicator: IndicatorDefinition, window: CompareWindow): KpiMetricSummary {
  return {
    indicatorId: indicator.id,
    title: indicator.title,
    units: indicator.units,
    scaling: indicator.scaling,
    windowType: toKpiWindowType(window),
    mean: null,
    cv: null,
    annualisedTrend: null,
    range: null
  };
}

function computeKpi(points: ResultsSeriesPoint[], indicator: IndicatorDefinition, window: CompareWindow): KpiMetricSummary {
  const windowPoints = applyCompareWindow(points, window);
  const windowValues = windowPoints
    .map((point) => point.value)
    .filter((value): value is number => value !== null);
  const kpi = computeKpiFromValues(windowValues);

  return {
    indicatorId: indicator.id,
    title: indicator.title,
    units: indicator.units,
    scaling: indicator.scaling,
    windowType: toKpiWindowType(window),
    mean: kpi.mean,
    cv: kpi.cv,
    annualisedTrend: kpi.annualisedTrend,
    range: kpi.range
  };
}

function applyCompareWindow(points: ResultsSeriesPoint[], window: CompareWindow): ResultsSeriesPoint[] {
  if (window === 'full') {
    return points;
  }
  if (window === 'tail120') {
    return points.slice(Math.max(0, points.length - 120));
  }
  const cutoff = window === 'post500'
    ? POST_500_CUTOFF_TICKS
    : window === 'post200'
      ? SPIN_UP_CUTOFF_TICKS
      : Number.parseInt(window.slice(4), 10);
  return points.filter((point) => point.modelTime >= cutoff);
}

function alignSeriesByModelTime(seriesByRun: Array<{ runId: string; points: ResultsSeriesPoint[] }>) {
  const allTimes = new Set<number>();
  for (const runSeries of seriesByRun) {
    for (const point of runSeries.points) {
      allTimes.add(point.modelTime);
    }
  }

  const modelTimes = [...allTimes].sort((left, right) => left - right);
  return seriesByRun.map((runSeries) => {
    const valueByTime = new Map(runSeries.points.map((point) => [point.modelTime, point.value]));
    return {
      runId: runSeries.runId,
      points: modelTimes.map((modelTime) => ({
        modelTime,
        value: valueByTime.has(modelTime) ? (valueByTime.get(modelTime) as number | null) : null
      }))
    };
  });
}

/**
 * Reads the Central Bank policy a completed run was executed with, straight from the
 * config.properties written into its results folder. This is the only record of the policy behind a
 * result, so it is read back from the run itself rather than reconstructed from the request that
 * created it. Returns an empty list when the file is missing or unreadable (older or external runs).
 */
/** Reads the scenario name recorded in a run manifest. Legacy/external runs may have none. */
const MAX_RUN_TITLE_LENGTH = 120;

function readRunTitle(runPath: string): string | null {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(runPath, RUN_MANIFEST_FILE_NAME), 'utf-8')) as {
      run?: { title?: unknown };
    };
    const title = manifest.run?.title;
    if (typeof title !== 'string') return null;
    const trimmedTitle = title.trim();
    return trimmedTitle === '' ? null : trimmedTitle;
  } catch {
    return null;
  }
}

function parseRunConfigurationValue(rawValue: string): ResultsRunConfigurationValue {
  const withoutComment = rawValue.replace(/\s+#.*$/, '').trim();
  const unquoted =
    (withoutComment.startsWith('"') && withoutComment.endsWith('"')) ||
    (withoutComment.startsWith("'") && withoutComment.endsWith("'"))
      ? withoutComment.slice(1, -1)
      : withoutComment;
  if (unquoted === 'true') return true;
  if (unquoted === 'false') return false;
  const numeric = Number(unquoted);
  return unquoted !== '' && Number.isFinite(numeric) ? numeric : unquoted;
}

function readRunConfigurationValues(configPath: string): Record<string, ResultsRunConfigurationValue> {
  let contents: string;
  try {
    contents = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return {};
  }

  const allowedKeys = new Set<string>(MANUAL_RUN_CONFIGURATION_KEYS);
  const values: Record<string, ResultsRunConfigurationValue> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!allowedKeys.has(key)) continue;
    values[key] = parseRunConfigurationValue(line.slice(separatorIndex + 1));
  }
  return values;
}

/** Reads the actual creation choices without guessing them from a user-editable run name. */
function getRunConfiguration(runPath: string): ResultsRunConfiguration {
  let modelVersion: string | null = null;
  let basePolicy: ResultsRunConfiguration['basePolicy'] = null;
  let maxWorkers: number | null = null;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(runPath, RUN_MANIFEST_FILE_NAME), 'utf-8')) as {
      manifestType?: unknown;
      inputData?: { baselineSnapshot?: unknown };
      run?: { basePolicy?: unknown; maxWorkers?: unknown };
    };
    if (manifest.manifestType === 'manual-run') {
      const baseline = manifest.inputData?.baselineSnapshot;
      if (typeof baseline === 'string' && baseline.trim() !== '') {
        modelVersion = baseline.trim();
      }
      const recordedBasePolicy = manifest.run?.basePolicy;
      if (typeof recordedBasePolicy === 'string' && isBasePolicyId(recordedBasePolicy)) {
        basePolicy = recordedBasePolicy;
      }
      const workers = manifest.run?.maxWorkers;
      if (typeof workers === 'number' && Number.isFinite(workers) && workers > 0) {
        maxWorkers = Math.trunc(workers);
      }
    }
  } catch {
    // Legacy and externally supplied runs may have a config but no dashboard manifest.
  }

  return {
    modelVersion,
    basePolicy,
    maxWorkers,
    parameterValues: readRunConfigurationValues(path.join(runPath, RUN_CONFIG_FILE_NAME))
  };
}

/**
 * Every numeric `KEY = value` line in a run's config.properties. The Central Bank policy block and
 * the scaling constants (UK_HOUSEHOLDS, UK_DWELLINGS, TARGET_POPULATION, SEED, N_STEPS) are both
 * read from this one map, so the run's own record is the single source for what it was run with.
 */
function parseRunConfigNumbers(configPath: string): Map<string, number> {
  let contents: string;
  try {
    contents = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return new Map();
  }

  const values = new Map<string, number>();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const parsed = Number.parseFloat(line.slice(separatorIndex + 1).trim());
    if (Number.isFinite(parsed)) {
      values.set(key, parsed);
    }
  }

  return values;
}

function getRunConfigNumbers(runPath: string): Map<string, number> {
  const configPath = path.join(runPath, RUN_CONFIG_FILE_NAME);
  let fileStats: fs.Stats;
  try {
    fileStats = getFileStats(configPath);
  } catch {
    return new Map();
  }

  const cached = runConfigCache.get(configPath);
  if (cached && cached.modifiedMs === fileStats.mtimeMs && cached.sizeBytes === fileStats.size) {
    runConfigCache.delete(configPath);
    runConfigCache.set(configPath, cached);
    return cached.value;
  }

  const parsed = parseRunConfigNumbers(configPath);
  setBoundedCacheValue(runConfigCache, configPath, {
    modifiedMs: fileStats.mtimeMs,
    sizeBytes: fileStats.size,
    value: parsed
  }, RUN_CONFIG_CACHE_MAX_ENTRIES);
  return parsed;
}

/** Mean modelled households over the whole run. Stated as the scaling denominator, never applied. */
function computeMeanModelHouseholds(runPath: string): number | null {
  const parsedOutput = getOutputParseStatus(runPath);
  if (parsedOutput.status !== 'supported' || !parsedOutput.availableColumns.has(TOTAL_POPULATION_COLUMN)) {
    return null;
  }
  const populations = parsedOutput.rows
    .map((row) => row.values[TOTAL_POPULATION_COLUMN] ?? null)
    .filter((value): value is number => value !== null && value > 0);
  if (populations.length === 0) {
    return null;
  }
  return populations.reduce((total, value) => total + value, 0) / populations.length;
}

/**
 * The seed set a run actually covers. The manifest is authoritative because run-root CSVs of a
 * multi-seed run are the seed mean, while its config.properties still says `SEED = 1` — reading
 * config alone would describe a ten-seed ensemble as a single seed.
 */
function readRunSeeds(
  runPath: string,
  configValues: Map<string, number>
): { seeds: number[] | null; seedSource: 'manifest' | 'config' | null } {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(runPath, RUN_MANIFEST_FILE_NAME), 'utf-8')) as {
      run?: { seeds?: unknown; seed?: unknown };
    };
    const manifestSeeds = manifest.run?.seeds;
    if (Array.isArray(manifestSeeds)) {
      const seeds = manifestSeeds.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      if (seeds.length > 0) {
        return { seeds: [...seeds].sort((left, right) => left - right), seedSource: 'manifest' };
      }
    }
    const manifestSeed = manifest.run?.seed;
    if (typeof manifestSeed === 'number' && Number.isFinite(manifestSeed)) {
      return { seeds: [manifestSeed], seedSource: 'manifest' };
    }
  } catch {
    // No manifest, or an unreadable one: fall through to the config, as legacy runs require.
  }

  const configSeed = configValues.get('SEED');
  if (configSeed !== undefined && Number.isFinite(configSeed)) {
    return { seeds: [configSeed], seedSource: 'config' };
  }
  return { seeds: null, seedSource: null };
}

function getRunProvenance(runPath: string): ResultsRunProvenance {
  const values = getRunConfigNumbers(runPath);
  const read = (key: string): number | null => (values.has(key) ? (values.get(key) as number) : null);

  const ukHouseholds = read('UK_HOUSEHOLDS');
  const ukDwellings = read('UK_DWELLINGS');
  const meanModelHouseholds = computeMeanModelHouseholds(runPath);

  return {
    ukHouseholds,
    ukDwellings,
    dwellingsPerHousehold:
      ukDwellings !== null && ukHouseholds !== null && ukHouseholds > 0 ? ukDwellings / ukHouseholds : null,
    targetPopulation: read('TARGET_POPULATION'),
    meanModelHouseholds,
    meanScaleFactor:
      ukHouseholds !== null && meanModelHouseholds !== null && meanModelHouseholds > 0
        ? ukHouseholds / meanModelHouseholds
        : null,
    nSteps: read('N_STEPS'),
    ...readRunSeeds(runPath, values)
  };
}

function readCentralBankPolicySettings(configPath: string): ResultsPolicySetting[] {
  const values = parseRunConfigNumbers(configPath);

  // Emit in catalogue order so the block reads the same way for every run, not in file order.
  return CENTRAL_BANK_POLICY_KEYS.filter((key) => values.has(key)).map((key) => ({
    key,
    value: values.get(key) as number
  }));
}

function buildRunDiagnostics(pathsInput: RuntimePathInput, runId: string): RunDiagnostics {
  const paths = resolveRuntimePaths(pathsInput);
  const resultsRoot = resolveResultsRoot(paths);
  const runPath = ensureRunExists(resultsRoot, runId);
  const runStats = fs.statSync(runPath);
  const { sizeBytes, fileCount } = computeFolderSizeAndFileCount(runPath);
  const { status, coverage } = computeRunStatusAndCoverage(runPath);
  const manifest = buildManifest(paths, runPath);
  const configPath = path.join(runPath, 'config.properties');
  const configAvailable = fs.existsSync(configPath);
  const policySettings = readCentralBankPolicySettings(configPath);
  const title = readRunTitle(runPath);
  const configuration = getRunConfiguration(runPath);

  const indicators: ResultsIndicatorAvailability[] = ALL_INDICATORS.map((indicator) => {
    const series = getRawSeriesForIndicator(runPath, indicator.id);
    return {
      ...toIndicatorMeta(indicator),
      available: series.coverageStatus === 'supported' && isPointSeriesAvailable(series.points),
      coverageStatus: series.coverageStatus,
      note: series.note
    };
  });

  const kpiSummary: KpiMetricSummary[] = ALL_INDICATORS.map((indicator) => {
    const series = getRawSeriesForIndicator(runPath, indicator.id);
    if (series.coverageStatus !== 'supported') {
      return emptyKpi(indicator, 'tail120');
    }
    return computeKpi(series.points, indicator, 'tail120');
  });

  const summary: ResultsRunSummary = {
    runId,
    title,
    path: formatRuntimePath(paths, runPath),
    modifiedAt: toIsoTime(runStats.mtime),
    createdAt: toIsoTime(runStats.birthtime),
    sizeBytes,
    fileCount,
    status,
    configAvailable,
    parseCoverage: coverage,
    policySettings,
    provenance: getRunProvenance(runPath),
    configuration
  };

  const detail: ResultsRunDetail = {
    ...summary,
    configuration,
    indicators,
    kpiSummary
  };

  return { summary, detail, manifest };
}

export function getResultsIndicatorCatalog(): ResultsIndicatorMeta[] {
  return ALL_INDICATORS.map(toIndicatorMeta);
}

/**
 * Renames a run by rewriting the title in its manifest. The manifest is the run's own record, so the
 * name travels with the results folder rather than living in separate dashboard state. An empty title
 * clears the name, and the run falls back to being identified by its id.
 */
export function renameResultsRun(
  pathsInput: RuntimePathInput,
  runId: string,
  title: string
): { runId: string; title: string | null } {
  const paths = resolveRuntimePaths(pathsInput);
  const resultsRoot = resolveResultsRoot(paths);
  const runPath = ensureRunExists(resultsRoot, runId);
  const manifestPath = path.join(runPath, RUN_MANIFEST_FILE_NAME);

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Run "${runId}" has no dashboard manifest, so it cannot be renamed.`);
  }

  const trimmed = title.trim();
  if (trimmed.length > MAX_RUN_TITLE_LENGTH) {
    throw new Error(`Run name must be ${MAX_RUN_TITLE_LENGTH} characters or fewer.`);
  }

  let manifest: { run?: Record<string, unknown> };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { run?: Record<string, unknown> };
  } catch (error) {
    throw new Error(`Run "${runId}" has an unreadable manifest: ${(error as Error).message}`);
  }
  if (!manifest.run || typeof manifest.run !== 'object') {
    throw new Error(`Run "${runId}" has a manifest with no run record, so it cannot be renamed.`);
  }

  const nextTitle = trimmed === '' ? null : trimmed;
  manifest.run.title = nextTitle;
  (manifest as { updatedAt?: string }).updatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

  return { runId, title: nextTitle };
}

export function getResultsRuns(pathsInput: RuntimePathInput): ResultsRunSummary[] {
  const paths = resolveRuntimePaths(pathsInput);
  const resultsRoot = resolveResultsRoot(paths);
  const runIds = listRunDirectories(resultsRoot);
  const summaries = runIds.map((runId) => buildRunDiagnostics(paths, runId).summary);
  summaries.sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt));
  return summaries;
}

export function getResultsRunDetail(pathsInput: RuntimePathInput, runId: string): ResultsRunDetail {
  return buildRunDiagnostics(pathsInput, runId).detail;
}

export function getResultsRunFiles(pathsInput: RuntimePathInput, runId: string): ResultsFileManifestEntry[] {
  return buildRunDiagnostics(pathsInput, runId).manifest;
}

export function deleteResultsRun(pathsInput: RuntimePathInput, runId: string): { runId: string; deleted: boolean } {
  const resultsRoot = resolveResultsRoot(pathsInput);
  const normalizedRunId = runId.trim();
  if (PROTECTED_RESULTS_RUN_IDS.has(normalizedRunId)) {
    throw new Error(`Run "${normalizedRunId}" is protected and cannot be deleted from Model Results.`);
  }

  const runPath = ensureRunExists(resultsRoot, normalizedRunId);
  if (!isDashboardManagedRun(runPath, normalizedRunId)) {
    throw new Error(
      `Run "${normalizedRunId}" is not marked as a dashboard-managed run and cannot be deleted from Model Results.`
    );
  }

  fs.rmSync(runPath, { recursive: true, force: true });
  clearRunFromParserCaches(runPath);
  return {
    runId: normalizedRunId,
    deleted: true
  };
}

export function getResultsSeries(
  pathsInput: RuntimePathInput,
  runId: string,
  indicatorId: string,
  requestedSmoothWindow: number | undefined
): ResultsSeriesPayload {
  const resultsRoot = resolveResultsRoot(pathsInput);
  const runPath = ensureRunExists(resultsRoot, runId);
  const smoothWindow = normalizeSmoothWindow(requestedSmoothWindow);
  const rawSeries = getRawSeriesForIndicator(runPath, indicatorId);

  if (rawSeries.coverageStatus !== 'supported') {
    throw new Error(rawSeries.note ?? `Indicator ${indicatorId} is unavailable for run ${runId}`);
  }

  return {
    runId,
    indicator: toIndicatorMeta(rawSeries.indicator),
    smoothWindow,
    points: smoothSeries(rawSeries.points, smoothWindow)
  };
}

export function getResultsCompare(
  pathsInput: RuntimePathInput,
  runIds: string[],
  indicatorIds: string[],
  requestedWindow: string | undefined,
  requestedSmoothWindow: number | undefined
): ResultsComparePayload {
  if (runIds.length === 0) {
    throw new Error('At least one runId is required.');
  }
  if (runIds.length > 2) {
    throw new Error('A maximum of 2 runIds can be compared at once.');
  }

  const window = normalizeWindow(requestedWindow);
  const smoothWindow = normalizeSmoothWindow(requestedSmoothWindow);
  const selectedIndicators =
    indicatorIds.length > 0 ? indicatorIds : ALL_INDICATORS.map((indicator) => indicator.id);

  const resultsRoot = resolveResultsRoot(pathsInput);
  const runPaths = new Map(runIds.map((runId) => [runId, ensureRunExists(resultsRoot, runId)]));
  const indicatorPayloads: ResultsCompareIndicator[] = selectedIndicators.map((indicatorId) => {
    const indicatorDefinition = INDICATOR_BY_ID.get(indicatorId);
    if (!indicatorDefinition) {
      throw new Error(`Unknown indicator id: ${indicatorId}`);
    }

    const perRun = runIds.map((runId) => {
      const runPath = runPaths.get(runId) as string;
      const rawSeries = getRawSeriesForIndicator(runPath, indicatorId);
      if (rawSeries.coverageStatus !== 'supported') {
        return { runId, points: [] as ResultsSeriesPoint[] };
      }
      const smoothed = smoothSeries(rawSeries.points, smoothWindow);
      const windowed = applyCompareWindow(smoothed, window);
      return { runId, points: windowed };
    });

    return {
      indicator: toIndicatorMeta(indicatorDefinition),
      seriesByRun: alignSeriesByModelTime(perRun)
    };
  });
  const kpiSummaryByRun = runIds.map((runId) => {
    const runPath = runPaths.get(runId) as string;
    return {
      runId,
      kpiSummary: ALL_INDICATORS.map((indicator) => {
        const rawSeries = getRawSeriesForIndicator(runPath, indicator.id);
        if (rawSeries.coverageStatus !== 'supported') {
          return emptyKpi(indicator, window);
        }
        return computeKpi(rawSeries.points, indicator, window);
      })
    };
  });

  return {
    runIds,
    indicatorIds: selectedIndicators,
    smoothWindow,
    window,
    indicators: indicatorPayloads,
    kpiSummaryByRun
  };
}
