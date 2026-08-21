import fs from 'node:fs';
import path from 'node:path';
import type {
  LendingBand,
  LendingBandGroup,
  LendingBandSeries,
  LendingBorrowerType,
  LendingCap,
  LendingDistributionComparePayload,
  LendingDistributionPayload,
  LendingHistogram,
  LendingHistogramSeries,
  LendingJointGrid,
  LendingJointSeries,
  LendingMetricId,
  LendingQuintile,
  LendingQuintileMatrix,
  LendingSummaryStats,
  LendingUnavailableReason,
  LendingWindowInfo,
  ResultsCompareWindow
} from '../../shared/types';
import { ensureResultsRunPath, resolveResultsRootPath, SALE_TRANSACTIONS_FILE_NAME } from './results';
import type { RuntimePathInput } from './runtimePaths';

const BORROWER_TYPES: LendingBorrowerType[] = ['FTB', 'HM', 'BTL'];
const OWNER_OCCUPIER_TYPES: LendingBorrowerType[] = ['FTB', 'HM'];

const POST_500_CUTOFF_TICKS = 500;
const SPIN_UP_CUTOFF_TICKS = 200;
const TAIL_WINDOW_TICKS = 120;

const RECORDING_START_KEY = 'TIME_TO_START_RECORDING_TRANSACTIONS';
const RECORD_TRANSACTIONS_KEY = 'recordTransactions';

/**
 * Columns read out of SaleTransactions-run1.csv. The file is semicolon-delimited with
 * inconsistent whitespace around the delimiters, so every field is trimmed before use.
 *
 * LTI and DSTI deliberately use gross *employment* income, not gross total income:
 * Bank.getMaxMortgagePrice and Bank.acceptApprovalInPrincipleLetter both test against
 * getMonthlyGrossEmploymentIncome, so total income would measure the borrower against a
 * cap the run never enforced.
 */
const COLUMN_NAMES = {
  modelTime: 'modelTime',
  transactionPrice: 'transactionPrice',
  buyerAge: 'buyerAge',
  employmentIncome: 'buyerMonthlyGrossEmploymentIncome',
  mortgagePrincipal: 'mortgagePrincipal',
  mortgageMonthlyPayment: 'mortgageMonthlyPayment',
  icr: 'ICR',
  firstTimeBuyerMortgage: 'firstTimeBuyerMortgage',
  buyToLetMortgage: 'buyToLetMortgage'
} as const;

const REQUIRED_COLUMNS = Object.values(COLUMN_NAMES);

export interface LendingBandEdges {
  ltv: number[];
  lti: number[];
}

export interface LendingDistributionOptions {
  /**
   * Lower edges of the LTV and LTI tail bands. The last edge opens the top band.
   * Parameterised because the interesting bands move with the policy under test.
   */
  bandEdges?: Partial<LendingBandEdges>;
  highLtvThreshold?: number;
  highLtiThreshold?: number;
  /**
   * Relative tolerance for testing a value against a cap or a bin edge.
   *
   * Ratios are recomputed from two values the model printed to 2 d.p., so a loan written
   * exactly at a hard cap can land a few parts in 10^7 below it. At 0 the comparisons are
   * plain `>=`, which is what the verification oracle was produced with; at 1e-6 loans
   * sitting on a cap are counted as being at it. See docs in getLendingDistribution.
   */
  capTolerance?: number;
}

const DEFAULT_BAND_EDGES: LendingBandEdges = {
  ltv: [75, 80, 85],
  lti: [3.0, 3.35, 4.0]
};

const DEFAULT_HIGH_LTV_THRESHOLD = 75;
const DEFAULT_HIGH_LTI_THRESHOLD = 3.35;
const DEFAULT_CAP_TOLERANCE = 0;

interface HistogramSpec {
  metric: LendingMetricId;
  title: string;
  units: string;
  lowerEdge: number;
  upperEdge: number;
  binWidth: number;
  read: (row: LendingRow) => number;
}

interface LendingRow {
  modelTime: number;
  price: number;
  principal: number;
  monthlyPayment: number;
  employmentIncome: number;
  age: number;
  icr: number;
  borrowerType: LendingBorrowerType;
  ltv: number;
  lti: number;
  dsti: number;
  priceToIncome: number;
}

interface ParsedTransactionFile {
  status: 'supported' | 'empty' | 'error';
  note?: string;
  mortgaged: LendingRow[];
  /** Model times of the cash purchases, kept so the excluded count respects the window. */
  cashModelTimes: number[];
  minModelTime: number | null;
  maxModelTime: number | null;
}

interface CachedValue<T> {
  sizeBytes: number;
  modifiedMs: number;
  value: T;
}

interface TransactionSource {
  seedLabel: string | null;
  filePath: string;
}

interface RunLendingConfig {
  recordingStartModelTime: number | null;
  recordTransactions: boolean | null;
  caps: LendingCap[];
}

const parsedTransactionCache = new Map<string, CachedValue<ParsedTransactionFile>>();
const TRANSACTION_CACHE_MAX_ENTRIES =
  (process.env.NODE_ENV?.trim().toLowerCase() ?? '') === 'production' ? 0 : 4;

function setBoundedCacheValue<T>(
  cache: Map<string, CachedValue<T>>,
  key: string,
  value: CachedValue<T>,
  maxEntries: number
): void {
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

/** Shares are display values; four decimals is well past what any axis or label shows. */
function roundShare(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

function safeNumber(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSemicolonRow(line: string): string[] {
  return line.split(';').map((token) => token.trim());
}

/**
 * True when `value` is at or above `threshold`, allowing `tolerance` (relative to the
 * threshold) of slack so a loan written exactly at a cap is not pushed below it by the
 * rounding in the recorded price and principal.
 */
function atOrAbove(value: number, threshold: number, tolerance: number): boolean {
  if (tolerance <= 0) {
    return value >= threshold;
  }
  return value >= threshold - tolerance * Math.max(1, Math.abs(threshold));
}

function isAbove(value: number, threshold: number, tolerance: number): boolean {
  if (tolerance <= 0) {
    return value > threshold;
  }
  return value > threshold - tolerance * Math.max(1, Math.abs(threshold));
}

/**
 * Bin index for `value`, snapping to a bin edge that the value sits within `tolerance` of
 * so that mass bunched on a cap lands in one bin instead of straddling two.
 */
function binIndexOf(value: number, lowerEdge: number, binWidth: number, tolerance: number): number {
  const position = (value - lowerEdge) / binWidth;
  if (tolerance > 0) {
    const nearestEdge = Math.round(position);
    if (Math.abs(position - nearestEdge) <= tolerance * Math.max(1, Math.abs(position))) {
      return nearestEdge;
    }
  }
  return Math.floor(position);
}

function resolveBorrowerType(isFirstTimeBuyer: boolean, isBuyToLet: boolean): LendingBorrowerType {
  if (isBuyToLet) {
    return 'BTL';
  }
  return isFirstTimeBuyer ? 'FTB' : 'HM';
}

function parseTransactionFile(filePath: string): ParsedTransactionFile {
  const empty: ParsedTransactionFile = {
    status: 'empty',
    mortgaged: [],
    cashModelTimes: [],
    minModelTime: null,
    maxModelTime: null
  };

  try {
    const contents = fs.readFileSync(filePath, 'utf-8');
    const lines = contents.split(/\r?\n/);
    let headerIndex = -1;
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].trim().length > 0) {
        headerIndex = index;
        break;
      }
    }
    if (headerIndex === -1) {
      return { ...empty, note: 'File is empty.' };
    }

    const header = parseSemicolonRow(lines[headerIndex]);
    const columnIndex = new Map<string, number>();
    header.forEach((columnName, index) => {
      if (!columnIndex.has(columnName)) {
        columnIndex.set(columnName, index);
      }
    });

    const missingColumns = REQUIRED_COLUMNS.filter((columnName) => !columnIndex.has(columnName));
    if (missingColumns.length > 0) {
      return {
        ...empty,
        status: 'error',
        note: `Missing column(s) in transaction header: ${missingColumns.join(', ')}.`
      };
    }

    const at = (tokens: string[], columnName: string): string => tokens[columnIndex.get(columnName) as number] ?? '';

    const mortgaged: LendingRow[] = [];
    const cashModelTimes: number[] = [];
    let minModelTime: number | null = null;
    let maxModelTime: number | null = null;
    let malformedRowCount = 0;

    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim().length === 0) {
        continue;
      }
      const tokens = parseSemicolonRow(line);
      const modelTime = safeNumber(at(tokens, COLUMN_NAMES.modelTime));
      const price = safeNumber(at(tokens, COLUMN_NAMES.transactionPrice));
      const principal = safeNumber(at(tokens, COLUMN_NAMES.mortgagePrincipal));
      if (modelTime === null || price === null || principal === null) {
        malformedRowCount += 1;
        continue;
      }

      minModelTime = minModelTime === null ? modelTime : Math.min(minModelTime, modelTime);
      maxModelTime = maxModelTime === null ? modelTime : Math.max(maxModelTime, modelTime);

      // Cash purchases carry no mortgage and are excluded from every ratio, but they are a
      // substantive share of transactions so the count is reported alongside.
      if (!(principal > 0) || !(price > 0)) {
        cashModelTimes.push(modelTime);
        continue;
      }

      const employmentIncome = safeNumber(at(tokens, COLUMN_NAMES.employmentIncome));
      const monthlyPayment = safeNumber(at(tokens, COLUMN_NAMES.mortgageMonthlyPayment));
      const age = safeNumber(at(tokens, COLUMN_NAMES.buyerAge));
      const icr = safeNumber(at(tokens, COLUMN_NAMES.icr));
      const borrowerType = resolveBorrowerType(
        at(tokens, COLUMN_NAMES.firstTimeBuyerMortgage) === 'true',
        at(tokens, COLUMN_NAMES.buyToLetMortgage) === 'true'
      );

      const annualIncome = employmentIncome === null ? null : employmentIncome * 12;
      mortgaged.push({
        modelTime,
        price,
        principal,
        monthlyPayment: monthlyPayment ?? Number.NaN,
        employmentIncome: employmentIncome ?? Number.NaN,
        age: age ?? Number.NaN,
        icr: icr ?? Number.NaN,
        borrowerType,
        // Written as 100 * principal / price rather than principal / price * 100: at a hard
        // cap the two orders disagree for a handful of loans, and this is the order the
        // published figures were produced with.
        ltv: (100 * principal) / price,
        lti: annualIncome && annualIncome > 0 ? principal / annualIncome : Number.NaN,
        dsti:
          monthlyPayment !== null && employmentIncome !== null && employmentIncome > 0
            ? monthlyPayment / employmentIncome
            : Number.NaN,
        priceToIncome: annualIncome && annualIncome > 0 ? price / annualIncome : Number.NaN
      });
    }

    if (mortgaged.length === 0 && cashModelTimes.length === 0) {
      return { ...empty, note: 'Transaction file has a header but no data rows.' };
    }

    return {
      status: 'supported',
      note: malformedRowCount > 0 ? `Skipped ${malformedRowCount} malformed row(s).` : undefined,
      mortgaged,
      cashModelTimes,
      minModelTime,
      maxModelTime
    };
  } catch (error) {
    return { ...empty, status: 'error', note: `Could not read transaction file: ${(error as Error).message}` };
  }
}

function getCachedParsedTransactions(filePath: string): ParsedTransactionFile {
  const fileStats = fs.statSync(filePath);
  const cached = parsedTransactionCache.get(filePath);
  if (
    TRANSACTION_CACHE_MAX_ENTRIES > 0 &&
    cached &&
    cached.modifiedMs === fileStats.mtimeMs &&
    cached.sizeBytes === fileStats.size
  ) {
    parsedTransactionCache.delete(filePath);
    parsedTransactionCache.set(filePath, cached);
    return cached.value;
  }

  const parsed = parseTransactionFile(filePath);
  setBoundedCacheValue(
    parsedTransactionCache,
    filePath,
    { modifiedMs: fileStats.mtimeMs, sizeBytes: fileStats.size, value: parsed },
    TRANSACTION_CACHE_MAX_ENTRIES
  );
  return parsed;
}

/**
 * Multi-seed runs have no transaction file at the run root: aggregateManualOutputs only
 * merges Output-run1.csv and the coreIndicator files up from the seed folders. Fall back to
 * the per-seed copies and pool them, which is also the right way to build a distribution
 * from an ensemble.
 */
function resolveTransactionSources(runPath: string): TransactionSource[] {
  const rootFilePath = path.join(runPath, SALE_TRANSACTIONS_FILE_NAME);
  if (fs.existsSync(rootFilePath)) {
    return [{ seedLabel: null, filePath: rootFilePath }];
  }

  const seedsRoot = path.join(runPath, 'seeds');
  if (!fs.existsSync(seedsRoot) || !fs.statSync(seedsRoot).isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(seedsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ seedLabel: entry.name, filePath: path.join(seedsRoot, entry.name, SALE_TRANSACTIONS_FILE_NAME) }))
    .filter((source) => fs.existsSync(source.filePath))
    .sort((left, right) => (left.seedLabel as string).localeCompare(right.seedLabel as string));
}

function readConfigValues(runPath: string): Map<string, string> {
  const candidatePaths = [path.join(runPath, 'config.properties')];
  const seedsRoot = path.join(runPath, 'seeds');
  if (fs.existsSync(seedsRoot) && fs.statSync(seedsRoot).isDirectory()) {
    for (const entry of fs.readdirSync(seedsRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) {
        candidatePaths.push(path.join(seedsRoot, entry.name, 'config.properties'));
      }
    }
  }

  for (const candidatePath of candidatePaths) {
    let contents: string;
    try {
      contents = fs.readFileSync(candidatePath, 'utf-8');
    } catch {
      continue;
    }
    const values = new Map<string, string>();
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('#') || line.startsWith('!')) {
        continue;
      }
      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) {
        continue;
      }
      values.set(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
    }
    if (values.size > 0) {
      return values;
    }
  }

  return new Map<string, string>();
}

function numericConfigValue(values: Map<string, string>, key: string): number | null {
  const raw = values.get(key);
  if (raw === undefined) {
    return null;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The cap a borrower actually faces is the tighter of the Central Bank limit and the
 * lender's own limit. Reporting the Central Bank value alone would draw the BTL LTV cap at
 * 80% for the shipped runs when the binding limit — and the visible bunching — is at the
 * lender's 75%.
 */
function resolveCap(
  values: Map<string, string>,
  borrowerType: LendingBorrowerType,
  metric: LendingCap['metric'],
  centralBankKey: string,
  bankKey: string,
  scale: number,
  units: string,
  centralBankBinding: LendingCap['binding']
): LendingCap | null {
  const centralBankValue = numericConfigValue(values, centralBankKey);
  const bankValue = numericConfigValue(values, bankKey);
  if (centralBankValue === null && bankValue === null) {
    return null;
  }

  let value: number;
  let source: LendingCap['source'];
  let binding: LendingCap['binding'];
  if (centralBankValue === null) {
    value = bankValue as number;
    source = 'bank';
    binding = 'hard';
  } else if (bankValue === null) {
    value = centralBankValue;
    source = 'central_bank';
    binding = centralBankBinding;
  } else if (centralBankValue < bankValue) {
    value = centralBankValue;
    source = 'central_bank';
    binding = centralBankBinding;
  } else if (bankValue < centralBankValue) {
    value = bankValue;
    source = 'bank';
    binding = 'hard';
  } else {
    value = bankValue;
    source = 'both';
    // When the two coincide the lender's hard limit is what stops the loan being written.
    binding = 'hard';
  }

  return { borrowerType, metric, value: value * scale, units, source, binding };
}

function readRunLendingConfig(runPath: string): RunLendingConfig {
  const values = readConfigValues(runPath);
  const recordTransactionsRaw = values.get(RECORD_TRANSACTIONS_KEY)?.toLowerCase();

  const caps = [
    resolveCap(values, 'FTB', 'ltv', 'CENTRAL_BANK_LTV_HARD_MAX_FTB', 'BANK_LTV_HARD_MAX_FTB', 100, '%', 'hard'),
    resolveCap(values, 'HM', 'ltv', 'CENTRAL_BANK_LTV_HARD_MAX_HM', 'BANK_LTV_HARD_MAX_HM', 100, '%', 'hard'),
    resolveCap(values, 'BTL', 'ltv', 'CENTRAL_BANK_LTV_HARD_MAX_BTL', 'BANK_LTV_HARD_MAX_BTL', 100, '%', 'hard'),
    resolveCap(values, 'FTB', 'lti', 'CENTRAL_BANK_LTI_SOFT_MAX_FTB', 'BANK_LTI_HARD_MAX_FTB', 1, 'ratio', 'soft'),
    resolveCap(values, 'HM', 'lti', 'CENTRAL_BANK_LTI_SOFT_MAX_HM', 'BANK_LTI_HARD_MAX_HM', 1, 'ratio', 'soft'),
    resolveCap(values, 'FTB', 'dsti', 'CENTRAL_BANK_AFFORDABILITY_HARD_MAX', 'BANK_AFFORDABILITY_HARD_MAX', 1, 'ratio', 'hard'),
    resolveCap(values, 'HM', 'dsti', 'CENTRAL_BANK_AFFORDABILITY_HARD_MAX', 'BANK_AFFORDABILITY_HARD_MAX', 1, 'ratio', 'hard')
  ].filter((cap): cap is LendingCap => cap !== null);

  return {
    recordingStartModelTime: numericConfigValue(values, RECORDING_START_KEY),
    recordTransactions:
      recordTransactionsRaw === undefined ? null : recordTransactionsRaw === 'true',
    caps
  };
}

export function normalizeLendingWindow(rawWindow: string | undefined): ResultsCompareWindow {
  if (rawWindow === 'post200' || rawWindow === 'tail120' || rawWindow === 'full') {
    return rawWindow;
  }
  return 'post500';
}

/**
 * Transactions are only recorded from TIME_TO_START_RECORDING_TRANSACTIONS onwards, so a
 * requested spin-up cutoff below that point does nothing. The requested window is clamped to
 * what the data can support and both are reported, so the UI can say which one it used.
 */
function resolveWindow(
  requested: ResultsCompareWindow,
  dataStart: number | null,
  dataEnd: number | null,
  recordingStart: number | null
): LendingWindowInfo {
  const base: LendingWindowInfo = {
    requested,
    effective: requested,
    clamped: false,
    startModelTime: null,
    endModelTime: null,
    recordingStartModelTime: recordingStart,
    dataStartModelTime: dataStart,
    dataEndModelTime: dataEnd
  };

  if (dataStart === null || dataEnd === null) {
    return base;
  }

  if (requested === 'tail120') {
    const start = Math.max(dataStart, dataEnd - (TAIL_WINDOW_TICKS - 1));
    return {
      ...base,
      effective: start <= dataStart ? 'full' : 'tail120',
      clamped: start <= dataStart,
      startModelTime: start,
      endModelTime: dataEnd
    };
  }

  const requestedCutoff =
    requested === 'post500' ? POST_500_CUTOFF_TICKS : requested === 'post200' ? SPIN_UP_CUTOFF_TICKS : dataStart;
  const start = Math.max(dataStart, requestedCutoff);
  const clamped = requested !== 'full' && requestedCutoff <= dataStart;
  return {
    ...base,
    effective: clamped ? 'full' : requested,
    clamped,
    startModelTime: start,
    endModelTime: dataEnd
  };
}

function meanOf(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function buildSummaryStats(rowsByType: Map<LendingBorrowerType, LendingRow[]>): LendingSummaryStats[] {
  return BORROWER_TYPES.map((borrowerType) => {
    const rows = rowsByType.get(borrowerType) ?? [];
    const finite = (read: (row: LendingRow) => number): number[] =>
      rows.map(read).filter((value) => Number.isFinite(value));
    const ltv = finite((row) => row.ltv);
    const lti = finite((row) => row.lti);
    return {
      borrowerType,
      count: rows.length,
      meanLtv: meanOf(ltv),
      medianLtv: medianOf(ltv),
      meanLti: meanOf(lti),
      medianLti: medianOf(lti),
      meanDsti: meanOf(finite((row) => row.dsti)),
      meanIcr: meanOf(finite((row) => row.icr))
    } satisfies LendingSummaryStats;
  });
}

function buildHistogramSpecs(): HistogramSpec[] {
  return [
    {
      metric: 'ltv',
      title: 'Loan-to-value',
      units: '%',
      lowerEdge: 0,
      upperEdge: 100,
      binWidth: 1,
      read: (row) => row.ltv
    },
    {
      metric: 'lti',
      title: 'Loan-to-income',
      units: 'ratio',
      lowerEdge: 0,
      upperEdge: 10,
      binWidth: 0.1,
      read: (row) => row.lti
    },
    {
      metric: 'dsti',
      title: 'Debt-service-to-income',
      units: 'ratio',
      lowerEdge: 0,
      upperEdge: 1,
      binWidth: 0.01,
      read: (row) => row.dsti
    },
    {
      metric: 'priceToIncome',
      title: 'House-price-to-income',
      units: 'ratio',
      lowerEdge: 0,
      upperEdge: 20,
      binWidth: 0.2,
      read: (row) => row.priceToIncome
    },
    {
      metric: 'buyerAge',
      title: 'Borrower age',
      units: 'years',
      lowerEdge: 18,
      upperEdge: 100,
      binWidth: 1,
      read: (row) => row.age
    }
  ];
}

function buildHistogram(spec: HistogramSpec, rowsByType: Map<LendingBorrowerType, LendingRow[]>, capTolerance: number): LendingHistogram {
  const binCount = Math.round((spec.upperEdge - spec.lowerEdge) / spec.binWidth);
  const seriesByBorrowerType: LendingHistogramSeries[] = BORROWER_TYPES.map((borrowerType) => {
    const counts = new Array<number>(binCount).fill(0);
    let total = 0;
    let overflowCount = 0;

    for (const row of rowsByType.get(borrowerType) ?? []) {
      const value = spec.read(row);
      if (!Number.isFinite(value)) {
        continue;
      }
      let index = binIndexOf(value, spec.lowerEdge, spec.binWidth, capTolerance);
      if (index >= binCount) {
        overflowCount += 1;
        index = binCount - 1;
      } else if (index < 0) {
        index = 0;
      }
      counts[index] += 1;
      total += 1;
    }

    return {
      borrowerType,
      count: total,
      overflowCount,
      bins: counts.map((count, index) => ({
        lowerEdge: spec.lowerEdge + index * spec.binWidth,
        upperEdge: spec.lowerEdge + (index + 1) * spec.binWidth,
        count,
        share: total > 0 ? roundShare((100 * count) / total) : 0
      }))
    } satisfies LendingHistogramSeries;
  });

  return {
    metric: spec.metric,
    title: spec.title,
    units: spec.units,
    binWidth: spec.binWidth,
    lowerEdge: spec.lowerEdge,
    upperEdge: spec.upperEdge,
    seriesByBorrowerType
  };
}

function formatBandLabel(lowerEdge: number, upperEdge: number | null, units: string): string {
  const suffix = units === '%' ? '%' : '';
  if (upperEdge === null) {
    return `${lowerEdge}${suffix}+`;
  }
  return `${lowerEdge}–${upperEdge}${suffix}`;
}

function buildBands(edges: number[], units: string): LendingBand[] {
  const sortedEdges = [...edges].sort((left, right) => left - right);
  return sortedEdges.map((lowerEdge, index) => {
    const upperEdge = index === sortedEdges.length - 1 ? null : sortedEdges[index + 1];
    return {
      id: `${lowerEdge}`,
      label: formatBandLabel(lowerEdge, upperEdge, units),
      lowerEdge,
      upperEdge
    } satisfies LendingBand;
  });
}

function buildBandGroup(
  metric: 'ltv' | 'lti',
  title: string,
  units: string,
  edges: number[],
  rowsByType: Map<LendingBorrowerType, LendingRow[]>,
  read: (row: LendingRow) => number,
  capTolerance: number
): LendingBandGroup {
  const bands = buildBands(edges, units);
  const seriesByBorrowerType: LendingBandSeries[] = BORROWER_TYPES.map((borrowerType) => {
    const rows = rowsByType.get(borrowerType) ?? [];
    const counts = new Array<number>(bands.length).fill(0);
    let total = 0;

    for (const row of rows) {
      const value = read(row);
      if (!Number.isFinite(value)) {
        continue;
      }
      total += 1;
      for (let index = bands.length - 1; index >= 0; index -= 1) {
        const band = bands[index];
        if (atOrAbove(value, band.lowerEdge, capTolerance)) {
          if (band.upperEdge === null || !atOrAbove(value, band.upperEdge, capTolerance)) {
            counts[index] += 1;
          }
          break;
        }
      }
    }

    return {
      borrowerType,
      count: total,
      bands: bands.map((band, index) => ({
        bandId: band.id,
        count: counts[index],
        share: total > 0 ? roundShare((100 * counts[index]) / total) : 0
      }))
    } satisfies LendingBandSeries;
  });

  return { metric, title, units, bands, seriesByBorrowerType };
}

/**
 * Quintile cut points of transaction price over the owner-occupier mortgaged pool, taken as
 * the k*N/5-th smallest price (1-indexed nearest-rank). A transaction belongs to the lowest
 * quintile whose cut point it does not exceed.
 */
function computeQuintileCutPoints(prices: number[]): number[] {
  const sorted = [...prices].sort((left, right) => left - right);
  const total = sorted.length;
  if (total === 0) {
    return [];
  }
  return [1, 2, 3, 4].map((k) => {
    const rank = Math.max(1, Math.min(total, Math.floor((total * k) / 5)));
    return sorted[rank - 1];
  });
}

function quintileOf(price: number, cutPoints: number[]): number {
  let index = 0;
  while (index < cutPoints.length && price > cutPoints[index]) {
    index += 1;
  }
  return index;
}

function buildQuintileMatrix(
  ownerOccupierRows: LendingRow[],
  highLtvThreshold: number,
  highLtiThreshold: number,
  capTolerance: number
): LendingQuintileMatrix | null {
  if (ownerOccupierRows.length === 0) {
    return null;
  }

  const cutPoints = computeQuintileCutPoints(ownerOccupierRows.map((row) => row.price));
  const quintileCount = 5;
  const transactionCounts = new Array<number>(quintileCount).fill(0);
  const highLtvCounts = new Array<number>(quintileCount).fill(0);
  const highLtiCounts = new Array<number>(quintileCount).fill(0);
  const highLtvByType = new Map<LendingBorrowerType, number[]>();
  const highLtiByType = new Map<LendingBorrowerType, number[]>();
  for (const borrowerType of OWNER_OCCUPIER_TYPES) {
    highLtvByType.set(borrowerType, new Array<number>(quintileCount).fill(0));
    highLtiByType.set(borrowerType, new Array<number>(quintileCount).fill(0));
  }

  let totalHighLtv = 0;
  let totalHighLti = 0;
  const priceLowerBounds = new Array<number | null>(quintileCount).fill(null);
  const priceUpperBounds = new Array<number | null>(quintileCount).fill(null);

  for (const row of ownerOccupierRows) {
    const quintileIndex = quintileOf(row.price, cutPoints);
    transactionCounts[quintileIndex] += 1;
    const lower = priceLowerBounds[quintileIndex];
    const upper = priceUpperBounds[quintileIndex];
    priceLowerBounds[quintileIndex] = lower === null ? row.price : Math.min(lower, row.price);
    priceUpperBounds[quintileIndex] = upper === null ? row.price : Math.max(upper, row.price);

    if (Number.isFinite(row.ltv) && atOrAbove(row.ltv, highLtvThreshold, capTolerance)) {
      highLtvCounts[quintileIndex] += 1;
      totalHighLtv += 1;
      (highLtvByType.get(row.borrowerType) as number[])[quintileIndex] += 1;
    }
    if (Number.isFinite(row.lti) && isAbove(row.lti, highLtiThreshold, capTolerance)) {
      highLtiCounts[quintileIndex] += 1;
      totalHighLti += 1;
      (highLtiByType.get(row.borrowerType) as number[])[quintileIndex] += 1;
    }
  }

  const quintiles: LendingQuintile[] = [];
  for (let index = 0; index < quintileCount; index += 1) {
    quintiles.push({
      quintile: index + 1,
      transactionCount: transactionCounts[index],
      priceLowerBound: priceLowerBounds[index],
      priceUpperBound: priceUpperBounds[index],
      highLtvCount: highLtvCounts[index],
      highLtiCount: highLtiCounts[index],
      highLtvShareOfAll: totalHighLtv > 0 ? roundShare((100 * highLtvCounts[index]) / totalHighLtv) : 0,
      highLtiShareOfAll: totalHighLti > 0 ? roundShare((100 * highLtiCounts[index]) / totalHighLti) : 0,
      byBorrowerType: OWNER_OCCUPIER_TYPES.map((borrowerType) => {
        const ltvCount = (highLtvByType.get(borrowerType) as number[])[index];
        const ltiCount = (highLtiByType.get(borrowerType) as number[])[index];
        return {
          borrowerType,
          highLtvCount: ltvCount,
          highLtiCount: ltiCount,
          highLtvShareOfAll: totalHighLtv > 0 ? roundShare((100 * ltvCount) / totalHighLtv) : 0,
          highLtiShareOfAll: totalHighLti > 0 ? roundShare((100 * ltiCount) / totalHighLti) : 0
        };
      })
    });
  }

  return {
    cutPoints,
    poolCount: ownerOccupierRows.length,
    highLtvThreshold,
    highLtiThreshold,
    totalHighLtvCount: totalHighLtv,
    totalHighLtiCount: totalHighLti,
    quintiles
  };
}

const JOINT_LTV_LOWER = 0;
const JOINT_LTV_UPPER = 100;
const JOINT_LTV_BIN_WIDTH = 5;
const JOINT_LTI_LOWER = 0;
const JOINT_LTI_UPPER = 6;
const JOINT_LTI_BIN_WIDTH = 0.25;

function buildEdges(lowerEdge: number, upperEdge: number, binWidth: number): number[] {
  const edges: number[] = [];
  const binCount = Math.round((upperEdge - lowerEdge) / binWidth);
  for (let index = 0; index <= binCount; index += 1) {
    edges.push(lowerEdge + index * binWidth);
  }
  return edges;
}

function buildJointGrid(rowsByType: Map<LendingBorrowerType, LendingRow[]>, capTolerance: number): LendingJointGrid {
  const ltvEdges = buildEdges(JOINT_LTV_LOWER, JOINT_LTV_UPPER, JOINT_LTV_BIN_WIDTH);
  const ltiEdges = buildEdges(JOINT_LTI_LOWER, JOINT_LTI_UPPER, JOINT_LTI_BIN_WIDTH);
  const ltvBinCount = ltvEdges.length - 1;
  const ltiBinCount = ltiEdges.length - 1;

  const seriesByBorrowerType: LendingJointSeries[] = BORROWER_TYPES.map((borrowerType) => {
    const cellCounts = new Map<string, number>();
    let total = 0;

    for (const row of rowsByType.get(borrowerType) ?? []) {
      if (!Number.isFinite(row.ltv) || !Number.isFinite(row.lti)) {
        continue;
      }
      const ltvBin = Math.min(
        ltvBinCount - 1,
        Math.max(0, binIndexOf(row.ltv, JOINT_LTV_LOWER, JOINT_LTV_BIN_WIDTH, capTolerance))
      );
      const ltiBin = Math.min(
        ltiBinCount - 1,
        Math.max(0, binIndexOf(row.lti, JOINT_LTI_LOWER, JOINT_LTI_BIN_WIDTH, capTolerance))
      );
      const key = `${ltvBin}:${ltiBin}`;
      cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
      total += 1;
    }

    // Sparse: most of the grid is empty, and the payload is sent on every window switch.
    const cells = [...cellCounts.entries()]
      .map(([key, count]) => {
        const [ltvBin, ltiBin] = key.split(':').map((part) => Number.parseInt(part, 10));
        return { ltvBin, ltiBin, count, share: total > 0 ? roundShare((100 * count) / total) : 0 };
      })
      .sort((left, right) => left.ltvBin - right.ltvBin || left.ltiBin - right.ltiBin);

    return { borrowerType, count: total, cells } satisfies LendingJointSeries;
  });

  return { ltvEdges, ltiEdges, seriesByBorrowerType };
}

function emptyPayload(
  runId: string,
  requested: ResultsCompareWindow,
  reason: LendingUnavailableReason,
  note: string,
  config: RunLendingConfig,
  capTolerance: number
): LendingDistributionPayload {
  return {
    runId,
    available: false,
    unavailableReason: reason,
    note,
    window: resolveWindow(requested, null, null, config.recordingStartModelTime),
    counts: {
      transactions: 0,
      mortgaged: 0,
      cashExcluded: 0,
      byBorrowerType: BORROWER_TYPES.map((borrowerType) => ({ borrowerType, count: 0 }))
    },
    seedCount: 0,
    seedLabels: [],
    caps: config.caps,
    summaryByBorrowerType: [],
    histograms: [],
    bandGroups: [],
    quintiles: null,
    joint: null,
    capTolerance
  };
}

export function getLendingDistribution(
  pathsInput: RuntimePathInput,
  runId: string,
  requestedWindow: string | undefined,
  options: LendingDistributionOptions = {}
): LendingDistributionPayload {
  const resultsRoot = resolveResultsRootPath(pathsInput);
  const runPath = ensureResultsRunPath(resultsRoot, runId);
  const window = normalizeLendingWindow(requestedWindow);
  const capTolerance = options.capTolerance ?? DEFAULT_CAP_TOLERANCE;
  const highLtvThreshold = options.highLtvThreshold ?? DEFAULT_HIGH_LTV_THRESHOLD;
  const highLtiThreshold = options.highLtiThreshold ?? DEFAULT_HIGH_LTI_THRESHOLD;
  const bandEdges: LendingBandEdges = {
    ltv: options.bandEdges?.ltv ?? DEFAULT_BAND_EDGES.ltv,
    lti: options.bandEdges?.lti ?? DEFAULT_BAND_EDGES.lti
  };

  const config = readRunLendingConfig(runPath);
  const sources = resolveTransactionSources(runPath);

  if (sources.length === 0) {
    const reason: LendingUnavailableReason =
      config.recordTransactions === false ? 'recording_disabled' : 'no_transaction_file';
    const note =
      config.recordTransactions === false
        ? 'This run was configured with recordTransactions = false, so no loan-level file was written.'
        : `${SALE_TRANSACTIONS_FILE_NAME} is not present in this run folder.`;
    return emptyPayload(runId, window, reason, note, config, capTolerance);
  }

  const parsedFiles = sources.map((source) => ({ source, parsed: getCachedParsedTransactions(source.filePath) }));
  const failed = parsedFiles.find((entry) => entry.parsed.status === 'error');
  if (failed) {
    return emptyPayload(
      runId,
      window,
      'parse_error',
      failed.parsed.note ?? 'Transaction file could not be parsed.',
      config,
      capTolerance
    );
  }

  const pooledMortgaged = parsedFiles.flatMap((entry) => entry.parsed.mortgaged);
  const pooledCashModelTimes = parsedFiles.flatMap((entry) => entry.parsed.cashModelTimes);
  const seedLabels = sources
    .map((source) => source.seedLabel)
    .filter((label): label is string => label !== null);

  if (pooledMortgaged.length === 0 && pooledCashModelTimes.length === 0) {
    return emptyPayload(
      runId,
      window,
      'empty_file',
      parsedFiles[0]?.parsed.note ?? 'Transaction file contains no rows.',
      config,
      capTolerance
    );
  }

  const allModelTimes = [...pooledMortgaged.map((row) => row.modelTime), ...pooledCashModelTimes];
  const dataStart = Math.min(...allModelTimes);
  const dataEnd = Math.max(...allModelTimes);
  const windowInfo = resolveWindow(window, dataStart, dataEnd, config.recordingStartModelTime);
  const windowStart = windowInfo.startModelTime ?? dataStart;
  const windowEnd = windowInfo.endModelTime ?? dataEnd;
  const inWindow = (modelTime: number): boolean => modelTime >= windowStart && modelTime <= windowEnd;

  const mortgaged = pooledMortgaged.filter((row) => inWindow(row.modelTime));
  const cashExcluded = pooledCashModelTimes.filter(inWindow).length;

  const rowsByType = new Map<LendingBorrowerType, LendingRow[]>(
    BORROWER_TYPES.map((borrowerType) => [borrowerType, [] as LendingRow[]])
  );
  for (const row of mortgaged) {
    (rowsByType.get(row.borrowerType) as LendingRow[]).push(row);
  }

  const counts = {
    transactions: mortgaged.length + cashExcluded,
    mortgaged: mortgaged.length,
    cashExcluded,
    byBorrowerType: BORROWER_TYPES.map((borrowerType) => ({
      borrowerType,
      count: (rowsByType.get(borrowerType) as LendingRow[]).length
    }))
  };

  if (mortgaged.length === 0) {
    return {
      ...emptyPayload(runId, window, 'no_rows_in_window', 'No mortgaged transactions fall inside this window.', config, capTolerance),
      window: windowInfo,
      counts,
      seedCount: sources.length,
      seedLabels
    };
  }

  const ownerOccupierRows = mortgaged.filter((row) => row.borrowerType !== 'BTL');

  return {
    runId,
    available: true,
    window: windowInfo,
    counts,
    seedCount: sources.length,
    seedLabels,
    caps: config.caps,
    summaryByBorrowerType: buildSummaryStats(rowsByType),
    histograms: buildHistogramSpecs().map((spec) => buildHistogram(spec, rowsByType, capTolerance)),
    bandGroups: [
      buildBandGroup('ltv', 'Loan-to-value', '%', bandEdges.ltv, rowsByType, (row) => row.ltv, capTolerance),
      buildBandGroup('lti', 'Loan-to-income', 'ratio', bandEdges.lti, rowsByType, (row) => row.lti, capTolerance)
    ],
    quintiles: buildQuintileMatrix(ownerOccupierRows, highLtvThreshold, highLtiThreshold, capTolerance),
    joint: buildJointGrid(rowsByType, capTolerance),
    capTolerance
  };
}

export function getLendingDistributionCompare(
  pathsInput: RuntimePathInput,
  runIds: string[],
  requestedWindow: string | undefined,
  options: LendingDistributionOptions = {}
): LendingDistributionComparePayload {
  if (runIds.length === 0) {
    throw new Error('At least one runId is required.');
  }
  if (runIds.length > 2) {
    throw new Error('A maximum of 2 runIds can be compared at once.');
  }

  const window = normalizeLendingWindow(requestedWindow);
  return {
    runIds,
    window,
    runs: runIds.map((runId) => getLendingDistribution(pathsInput, runId, window, options))
  };
}

export function __resetLendingDistributionCacheForTests(): void {
  parsedTransactionCache.clear();
}
