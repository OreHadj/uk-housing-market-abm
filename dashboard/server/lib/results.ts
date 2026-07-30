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
  ResultsPolicySetting,
  ResultsRunDetail,
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
import { CENTRAL_BANK_POLICY_KEYS } from '../../shared/policyCatalogue';
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
  fileName?: string;
  outputColumn?: string;
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

const CORE_INDICATORS: IndicatorDefinition[] = [
  {
    id: 'core_ooLTV',
    title: 'Owner-Occupier LTV (Mean Above Median)',
    units: '%',
    description: 'Owner-occupier mortgage LTV ratio (mean above median).',
    source: 'core_indicator',
    fileName: 'coreIndicator-ooLTV.csv'
  },
  {
    id: 'core_ooLTI',
    title: 'Owner-Occupier LTI (Mean Above Median)',
    units: 'ratio',
    description: 'Owner-occupier mortgage LTI ratio (mean above median).',
    source: 'core_indicator',
    fileName: 'coreIndicator-ooLTI.csv'
  },
  {
    id: 'core_btlLTV',
    title: 'BTL LTV (Mean)',
    units: '%',
    description: 'Buy-to-let mortgage LTV ratio (mean).',
    source: 'core_indicator',
    fileName: 'coreIndicator-btlLTV.csv'
  },
  {
    id: 'core_creditGrowth',
    title: 'Household Credit Growth',
    units: '%',
    description: 'Twelve-month nominal growth rate of household credit.',
    source: 'core_indicator',
    fileName: 'coreIndicator-creditGrowth.csv'
  },
  {
    id: 'core_debtToIncome',
    title: 'Mortgage Debt to Income',
    units: '%',
    description: 'Total mortgage debt divided by annualized household income.',
    source: 'core_indicator',
    fileName: 'coreIndicator-debtToIncome.csv'
  },
  {
    id: 'core_ooDebtToIncome',
    title: 'Owner-Occupier Debt to Income',
    units: '%',
    description: 'Owner-occupier mortgage debt divided by annualized household income.',
    source: 'core_indicator',
    fileName: 'coreIndicator-ooDebtToIncome.csv'
  },
  {
    id: 'core_mortgageApprovals',
    title: 'Mortgage Approvals',
    units: 'count/month',
    description: 'Monthly mortgage approvals scaled to UK household count.',
    source: 'core_indicator',
    fileName: 'coreIndicator-mortgageApprovals.csv'
  },
  {
    id: 'core_housingTransactions',
    title: 'Housing Transactions',
    units: 'count/month',
    description: 'Monthly housing transactions scaled to UK household count.',
    source: 'core_indicator',
    fileName: 'coreIndicator-housingTransactions.csv'
  },
  {
    id: 'core_advancesToFTB',
    title: 'Advances to FTB',
    units: 'count/month',
    description: 'Monthly advances to first-time buyers.',
    source: 'core_indicator',
    fileName: 'coreIndicator-advancesToFTB.csv'
  },
  {
    id: 'core_advancesToBTL',
    title: 'Advances to BTL',
    units: 'count/month',
    description: 'Monthly advances to buy-to-let borrowers.',
    source: 'core_indicator',
    fileName: 'coreIndicator-advancesToBTL.csv'
  },
  {
    id: 'core_advancesToHM',
    title: 'Advances to Home Movers',
    units: 'count/month',
    description: 'Monthly advances to home movers.',
    source: 'core_indicator',
    fileName: 'coreIndicator-advancesToHM.csv'
  },
  {
    id: 'core_housePriceGrowth',
    title: 'House Price Growth (QoQ)',
    units: '%',
    description: 'Quarter-on-quarter growth in house price index.',
    source: 'core_indicator',
    fileName: 'coreIndicator-housePriceGrowth.csv'
  },
  {
    id: 'core_priceToIncome',
    title: 'Price to Income',
    units: 'ratio',
    description: 'House price to household disposable income ratio.',
    source: 'core_indicator',
    fileName: 'coreIndicator-priceToIncome.csv'
  },
  {
    id: 'core_rentalYield',
    title: 'Rental Yield',
    units: '%',
    description: 'Average stock rental yield.',
    source: 'core_indicator',
    fileName: 'coreIndicator-rentalYield.csv'
  },
  {
    id: 'core_interestRateSpread',
    title: 'Interest Rate Spread',
    units: 'percentage points',
    description: 'Spread on new owner-occupier mortgage lending.',
    source: 'core_indicator',
    fileName: 'coreIndicator-interestRateSpread.csv'
  }
];

const OUTPUT_INDICATORS: IndicatorDefinition[] = [
  {
    id: 'output_nHomeless',
    title: 'Homeless Households',
    units: 'count',
    description: 'Total homeless households.',
    source: 'output',
    outputColumn: 'nHomeless'
  },
  {
    id: 'output_nRenting',
    title: 'Renting Households',
    units: 'count',
    description: 'Total renting households.',
    source: 'output',
    outputColumn: 'nRenting'
  },
  {
    id: 'output_nOwnerOccupier',
    title: 'Owner-Occupier Households',
    units: 'count',
    description: 'Total owner-occupier households.',
    source: 'output',
    outputColumn: 'nOwnerOccupier'
  },
  {
    id: 'output_nActiveBTL',
    title: 'Active BTL Households',
    units: 'count',
    description: 'Total active buy-to-let households.',
    source: 'output',
    outputColumn: 'nActiveBTL'
  },
  {
    id: 'output_saleHPI',
    title: 'Sale HPI',
    units: 'index',
    description: 'Sale market house price index.',
    source: 'output',
    outputColumn: 'Sale HPI'
  },
  {
    id: 'output_saleAvSalePrice',
    title: 'Sale Average Sale Price',
    units: 'GBP',
    description: 'Average sale transaction price.',
    source: 'output',
    outputColumn: 'Sale AvSalePrice'
  },
  {
    id: 'output_saleAvMonthsOnMarket',
    title: 'Sale Average Months on Market',
    units: 'months',
    description: 'Average sale listing months on market.',
    source: 'output',
    outputColumn: 'Sale AvMonthsOnMarket'
  },
  {
    id: 'output_rentalHPI',
    title: 'Rental HPI',
    units: 'index',
    description: 'Rental market house price index.',
    source: 'output',
    outputColumn: 'Rental HPI'
  },
  {
    id: 'output_rentalAvSalePrice',
    title: 'Rental Average Transaction Price',
    units: 'GBP',
    description: 'Average rental transaction price.',
    source: 'output',
    outputColumn: 'Rental AvSalePrice'
  },
  {
    id: 'output_rentalAvMonthsOnMarket',
    title: 'Rental Average Months on Market',
    units: 'months',
    description: 'Average rental listing months on market.',
    source: 'output',
    outputColumn: 'Rental AvMonthsOnMarket'
  },
  {
    id: 'output_creditStock',
    title: 'Credit Stock',
    units: 'GBP',
    description: 'Total household credit stock.',
    source: 'output',
    outputColumn: 'creditStock'
  },
  {
    id: 'output_interestRate',
    title: 'Interest Rate',
    units: 'rate',
    description: 'Model interest rate.',
    source: 'output',
    outputColumn: 'interestRate'
  }
];

const ALL_INDICATORS: IndicatorDefinition[] = [...CORE_INDICATORS, ...OUTPUT_INDICATORS];
const INDICATOR_BY_ID = new Map(ALL_INDICATORS.map((indicator) => [indicator.id, indicator]));
const REQUIRED_CORE_FILES = new Set(CORE_INDICATORS.map((indicator) => indicator.fileName as string));
const REQUIRED_OUTPUT_COLUMNS = new Set(
  OUTPUT_INDICATORS.map((indicator) => indicator.outputColumn as string)
);
const REQUIRED_PARSE_TARGET_COUNT = REQUIRED_CORE_FILES.size + 1;
export const REQUIRED_RESULTS_PARSE_FILE_NAMES = [OUTPUT_FILE_NAME, ...REQUIRED_CORE_FILES];
const EXPECTED_FULL_OUTPUT_ROW_COUNT = 2001;

const TRANSACTION_FILES = new Set([
  'SaleTransactions-run1.csv',
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
  if (rawWindow === 'post500') {
    return 'post500';
  }
  if (rawWindow === 'full') {
    return 'full';
  }
  if (rawWindow === 'tail120') {
    return 'tail120';
  }
  if (rawWindow === 'post200') {
    return 'post200';
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
    const outputColumns = OUTPUT_INDICATORS.map((indicator) => indicator.outputColumn as string);

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
    source: indicator.source
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

function toSeriesPointsFromOutput(rows: OutputRow[], columnName: string): ResultsSeriesPoint[] {
  return rows.map((row) => ({
    modelTime: row.modelTime,
    value: row.values[columnName] ?? null
  }));
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

  const columnName = indicator.outputColumn as string;
  if (!parsedOutput.availableColumns.has(columnName)) {
    return {
      indicator,
      points: [],
      coverageStatus: 'error',
      note: `Missing output column: ${columnName}`
    };
  }

  return {
    indicator,
    points: toSeriesPointsFromOutput(parsedOutput.rows, columnName),
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
  if (window === 'post500') {
    return points.filter((point) => point.modelTime >= POST_500_CUTOFF_TICKS);
  }
  if (window === 'post200') {
    return points.filter((point) => point.modelTime >= SPIN_UP_CUTOFF_TICKS);
  }
  return points.slice(Math.max(0, points.length - 120));
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
/**
 * Reads the scenario name a run was created with from its manifest. The name is the only record of
 * intent behind a run — the policy table says what was set, the title says why — so it is surfaced
 * wherever runs are listed. Returns null for runs with no manifest (older or externally produced).
 */
function readRunTitle(runPath: string): string | null {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(runPath, RUN_MANIFEST_FILE_NAME), 'utf-8')) as {
      run?: { title?: unknown };
    };
    const title = manifest.run?.title;
    if (typeof title !== 'string') {
      return null;
    }
    const trimmed = title.trim();
    return trimmed === '' ? null : trimmed;
  } catch {
    return null;
  }
}

function readCentralBankPolicySettings(configPath: string): ResultsPolicySetting[] {
  let contents: string;
  try {
    contents = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return [];
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
    parseCoverage: coverage
  };

  const detail: ResultsRunDetail = {
    ...summary,
    indicators,
    kpiSummary,
    policySettings
  };

  return { summary, detail, manifest };
}

export function getResultsIndicatorCatalog(): ResultsIndicatorMeta[] {
  return ALL_INDICATORS.map(toIndicatorMeta);
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
