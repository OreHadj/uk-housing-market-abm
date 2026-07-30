import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  KpiMetricValues,
  ModelRunParameterDefinition,
  ModelRunWarning,
  SensitivityDeltaTrendSeries,
  SensitivityExperimentChartsPayload,
  SensitivityExperimentCreateRequest,
  SensitivityExperimentDeleteResponse,
  SensitivityExperimentDetailPayload,
  SensitivityExperimentListPayload,
  SensitivityExperimentLogsPayload,
  SensitivityExperimentMetadata,
  SensitivityExperimentResultsPayload,
  SensitivityExperimentStatus,
  SensitivityExperimentSubmitResponse,
  SensitivityExperimentSummary,
  SensitivityIndicatorPointMetric,
  SensitivityPointResult,
  SensitivitySeedRunResult,
  SensitivitySamplePoint,
  SensitivitySampleSlot,
  SensitivityTornadoBar,
  BasePolicyId,
  SensitivityPolicyPackageDefinition,
  ExperimentProgressSnapshot
} from '../../shared/types';
import { getModelRunOptions, listModelRunJobs } from './modelRuns';
import {
  getBasePolicyOption,
  getDefaultBasePolicyId,
  getSensitivityPolicyPackageById,
  getSingletonSensitivityPolicyPackage,
  isBasePolicyId
} from '../../shared/policyCatalogue';
import {
  appendLogLine,
  readLogSlice,
  type LogBufferState,
  type LogLineSink
} from './logs/logBuffer';
import {
  createMavenModelLauncher,
  type ModelLauncher,
  type ModelLauncherCommand
} from './modelLauncher';
import {
  resolveRuntimePaths,
  type RuntimePathInput,
  type RuntimePaths
} from './runtimePaths';
import {
  formatSensitivitySampleLabel,
  normalizeSensitivitySampleValue
} from '../../shared/sensitivitySampling';
import {
  hashDirectory,
  hashFile,
  writeSensitivityRunManifest,
  type SensitivityRunManifestPoint
} from './runManifest';
import { buildEmptyKpiValues, computePost200Kpi } from './stats/kpi';
import {
  buildSeeds,
  createProgressSnapshot as createSeededProgressSnapshot,
  createSeededProgressState,
  defaultWorkerCount,
  finishProgressTask as finishSeededProgressTask,
  formatProgressBrief,
  parseMaxWorkers,
  parseSeedCount as parseSeedCountValue,
  publishProgress as publishSeededProgress,
  runSeededModelProcess,
  runSeededWorkerPool,
  seededTaskId,
  startProgressTask as startSeededProgressTask,
  updateProgressEnded as updateSeededProgressEnded,
  updateProgressStarted as updateSeededProgressStarted,
  type SeededProgressState,
  type SeededProgressTask,
  type SeededRunStatus
} from './seededExperimentRunner';

const EXPERIMENTS_DIR = path.join('experiments', 'sensitivity');
const TMP_EXPERIMENT_RUNS_DIR = 'dashboard-sensitivity-runs';
const SUMMARY_FILE_NAME = 'summary.json';
const METADATA_FILE_NAME = 'metadata.json';
const CANCEL_KILL_TIMEOUT_MS = 10_000;
const MAX_LOG_LINES = 10_000;
const TERMINAL_STATUSES = new Set<SensitivityExperimentStatus>(['succeeded', 'failed', 'canceled']);
const KPI_KEYS = ['mean', 'cv', 'annualisedTrend', 'range'] as const;
const SENSITIVITY_RESULTS_WINDOW_TYPE = 'post_200' as const;
const BASELINE_EPSILON = 1e-12;
// A percentage difference is only meaningful when the baseline sits far enough from zero.
// Growth-rate indicators (credit growth, quarterly house-price growth) oscillate around zero,
// so an economically trivial absolute change becomes a headline percentage and dominates the
// tornado ranking. Judge "far enough from zero" against the series' own P95-P5 spread, which
// keeps the test scale-free across indicators measured in counts, ratios and percentages.
const MIN_BASELINE_TO_SPREAD_RATIO = 0.05;

interface PolicyBindingValues {
  bankInitialRate: number | null;
  bankLtvHardMaxFtb: number | null;
  bankLtvHardMaxHm: number | null;
  bankLtvHardMaxBtl: number | null;
  bankLtiHardMaxFtb: number | null;
  bankLtiHardMaxHm: number | null;
  bankAffordabilityHardMax: number | null;
  bankIcrHardMin: number | null;
}

interface PersistedSummary {
  results: SensitivityExperimentResultsPayload;
  charts: SensitivityExperimentChartsPayload;
}

type SpawnModelRunFn = (
  repoRoot: string,
  configPath: string,
  outputPath: string
) => ChildProcessWithoutNullStreams;

interface SubmitSensitivityExperimentOptions {
  launcher?: ModelLauncher;
  logSink?: LogLineSink;
  rawLogSink?: LogLineSink;
  progressSink?: (progress: ExperimentProgressSnapshot) => void;
  now?: Date;
  forcedExperimentId?: string;
}

interface ExperimentRecord {
  runtimePaths: RuntimePaths;
  metadata: SensitivityExperimentMetadata;
  results: SensitivityExperimentResultsPayload;
  charts: SensitivityExperimentChartsPayload;
  logBuffer: LogBufferState;
  progress: SeededProgressState;
  rawLogSink?: LogLineSink;
  progressSink?: (progress: ExperimentProgressSnapshot) => void;
  lastProgressSinkAtMs: number;
  launcher: ModelLauncher;
  manifestPoints: SensitivityRunManifestPoint[];
  normalizedGeneralOverrides: Map<string, string>;
  activeProcesses: Set<ChildProcessWithoutNullStreams>;
  killTimer?: NodeJS.Timeout;
  cancelRequested: boolean;
}

interface RepoState {
  loaded: boolean;
  experimentsById: Map<string, ExperimentRecord>;
  order: string[];
  activeExperimentId: string | null;
}

interface IndicatorDef {
  id: string;
  title: string;
  units: string;
  fileName: string;
}

interface LegacySensitivityIndicatorPointMetric {
  indicatorId: string;
  title: string;
  units: string;
  tail120Mean?: number | null;
  deltaFromBaseline?: number | null;
}

interface LegacySensitivityTornadoBar {
  indicatorId: string;
  title: string;
  units: string;
  maxAbsDelta?: number | null;
}

interface LegacySensitivityDeltaTrendPoint {
  parameterValue: number;
  delta?: number | null;
}

interface LegacySensitivityDeltaTrendSeries {
  indicatorId: string;
  title: string;
  units: string;
  points: LegacySensitivityDeltaTrendPoint[];
}

interface LegacySensitivityExperimentChartsPayload {
  experimentId: string;
  parameter: SensitivityExperimentMetadata['parameter'];
  tornado: LegacySensitivityTornadoBar[];
  deltaTrend: LegacySensitivityDeltaTrendSeries[];
}

interface LegacySensitivityExperimentResultsPayload {
  experimentId: string;
  baselinePointId: string | null;
  points: Array<Omit<SensitivityPointResult, 'indicatorMetrics'> & { indicatorMetrics: LegacySensitivityIndicatorPointMetric[] }>;
}

interface LegacyPersistedSummary {
  results: LegacySensitivityExperimentResultsPayload;
  charts: LegacySensitivityExperimentChartsPayload;
}

const POLICY_CORE_INDICATORS: IndicatorDef[] = [
  {
    id: 'core_ooLTV',
    title: 'Owner-Occupier LTV (Mean Above Median)',
    units: '%',
    fileName: 'coreIndicator-ooLTV.csv'
  },
  {
    id: 'core_ooLTI',
    title: 'Owner-Occupier LTI (Mean Above Median)',
    units: 'ratio',
    fileName: 'coreIndicator-ooLTI.csv'
  },
  {
    id: 'core_btlLTV',
    title: 'BTL LTV (Mean)',
    units: '%',
    fileName: 'coreIndicator-btlLTV.csv'
  },
  {
    id: 'core_creditGrowth',
    title: 'Household Credit Growth',
    units: '%',
    fileName: 'coreIndicator-creditGrowth.csv'
  },
  {
    id: 'core_debtToIncome',
    title: 'Mortgage Debt to Income',
    units: '%',
    fileName: 'coreIndicator-debtToIncome.csv'
  },
  {
    id: 'core_ooDebtToIncome',
    title: 'Owner-Occupier Debt to Income',
    units: '%',
    fileName: 'coreIndicator-ooDebtToIncome.csv'
  },
  {
    id: 'core_mortgageApprovals',
    title: 'Mortgage Approvals',
    units: 'count/month',
    fileName: 'coreIndicator-mortgageApprovals.csv'
  },
  {
    id: 'core_housingTransactions',
    title: 'Housing Transactions',
    units: 'count/month',
    fileName: 'coreIndicator-housingTransactions.csv'
  },
  {
    id: 'core_advancesToFTB',
    title: 'Advances to FTB',
    units: 'count/month',
    fileName: 'coreIndicator-advancesToFTB.csv'
  },
  {
    id: 'core_advancesToBTL',
    title: 'Advances to BTL',
    units: 'count/month',
    fileName: 'coreIndicator-advancesToBTL.csv'
  },
  {
    id: 'core_advancesToHM',
    title: 'Advances to Home Movers',
    units: 'count/month',
    fileName: 'coreIndicator-advancesToHM.csv'
  },
  {
    id: 'core_housePriceGrowth',
    title: 'House Price Growth (QoQ)',
    units: '%',
    fileName: 'coreIndicator-housePriceGrowth.csv'
  },
  {
    id: 'core_priceToIncome',
    title: 'Price to Income',
    units: 'ratio',
    fileName: 'coreIndicator-priceToIncome.csv'
  },
  {
    id: 'core_rentalYield',
    title: 'Rental Yield',
    units: '%',
    fileName: 'coreIndicator-rentalYield.csv'
  },
  {
    id: 'core_interestRateSpread',
    title: 'Interest Rate Spread',
    units: 'percentage points',
    fileName: 'coreIndicator-interestRateSpread.csv'
  }
];

const repoStates = new Map<string, RepoState>();
const defaultSensitivityLauncher = createMavenModelLauncher();
let sensitivityLauncherOverrideForTests: ModelLauncher | null = null;

function createSpawnFunctionLauncher(spawnFn: SpawnModelRunFn): ModelLauncher {
  return {
    mode: 'maven',
    metadata: {
      mode: 'maven',
      commandTemplate: 'test model launcher'
    },
    buildCommand: (request): ModelLauncherCommand => ({
      command: 'test-model-launcher',
      args: [request.configPath, request.outputPath],
      options: {
        cwd: request.repoRoot
      },
      commandTemplate: 'test model launcher'
    }),
    launch: (request) => spawnFn(request.repoRoot, request.configPath, request.outputPath)
  };
}

function resolveSensitivityLauncher(launcher: ModelLauncher | undefined): ModelLauncher {
  return launcher ?? sensitivityLauncherOverrideForTests ?? defaultSensitivityLauncher;
}

function toRunCommandMetadata(launcher: ModelLauncher): SensitivityExperimentMetadata['runCommand'] {
  return {
    mode: launcher.metadata.mode,
    mavenBin: launcher.metadata.mavenBin,
    javaExe: launcher.metadata.javaExe,
    modelJar: launcher.metadata.modelJar,
    commandTemplate: launcher.metadata.commandTemplate
  };
}

function runtimeStateKey(paths: RuntimePaths): string {
  return [paths.dataRoot, paths.resultsRoot, paths.tempRoot].map((value) => path.resolve(value)).join('\0');
}

function getRepoState(pathsInput: RuntimePathInput): RepoState {
  const paths = resolveRuntimePaths(pathsInput);
  const stateKey = runtimeStateKey(paths);
  const current = repoStates.get(stateKey);
  if (current) {
    return current;
  }

  const created: RepoState = {
    loaded: false,
    experimentsById: new Map<string, ExperimentRecord>(),
    order: [],
    activeExperimentId: null
  };
  repoStates.set(stateKey, created);
  return created;
}

function isTerminal(status: SensitivityExperimentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

function formatRunTimestamp(date: Date): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const sec = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}T${hh}${min}${sec}Z`;
}

function sanitizeFragment(value: string): string {
  const withoutReserved = value.replace(/[<>:"/\\|?*]/g, ' ');
  const withoutControlChars = [...withoutReserved]
    .map((character) => (character.charCodeAt(0) < 32 ? ' ' : character))
    .join('');
  return withoutControlChars.replace(/\s+/g, ' ').replace(/\.+$/g, '').trim();
}

function buildExperimentId(date: Date): string {
  return `sensitivity-${formatRunTimestamp(date)}-${randomUUID().slice(0, 8)}`;
}

function validateForcedExperimentId(experimentId: string): string {
  const normalized = experimentId.trim();
  if (!/^sensitivity-\d{8}T\d{6}Z-[0-9a-f]{8}$/.test(normalized)) {
    throw new Error('Forced sensitivity experiment id must match the generated sensitivity id format.');
  }
  return normalized;
}

function metadataPath(pathsInput: RuntimePathInput, experimentId: string): string {
  const paths = resolveRuntimePaths(pathsInput);
  return path.join(paths.resultsRoot, EXPERIMENTS_DIR, experimentId, METADATA_FILE_NAME);
}

function summaryPath(pathsInput: RuntimePathInput, experimentId: string): string {
  const paths = resolveRuntimePaths(pathsInput);
  return path.join(paths.resultsRoot, EXPERIMENTS_DIR, experimentId, SUMMARY_FILE_NAME);
}

function getExperimentOutputDir(pathsInput: RuntimePathInput, experimentId: string): string {
  const paths = resolveRuntimePaths(pathsInput);
  return path.join(paths.resultsRoot, EXPERIMENTS_DIR, experimentId);
}

function writeManifest(pathsInput: RuntimePathInput, record: ExperimentRecord): void {
  const paths = resolveRuntimePaths(pathsInput);
  const summaryPayload: PersistedSummary = {
    results: record.results,
    charts: record.charts
  };
  writeSensitivityRunManifest(getExperimentOutputDir(paths, record.metadata.experimentId), {
    paths,
    launcher: record.launcher,
    experiment: record.metadata,
    summaryPayload,
    points: record.manifestPoints
  });
}

function writeMetadata(pathsInput: RuntimePathInput, metadata: SensitivityExperimentMetadata): void {
  const filePath = metadataPath(pathsInput, metadata.experimentId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
}

function writeSummary(
  pathsInput: RuntimePathInput,
  experimentId: string,
  results: SensitivityExperimentResultsPayload,
  charts: SensitivityExperimentChartsPayload
): void {
  const filePath = summaryPath(pathsInput, experimentId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload: PersistedSummary = { results, charts };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function parseKpiValues(raw: unknown): KpiMetricValues {
  if (!raw || typeof raw !== 'object') {
    return buildEmptyKpiValues();
  }

  const values = raw as Record<string, unknown>;
  const next = buildEmptyKpiValues();
  for (const key of KPI_KEYS) {
    const value = values[key];
    next[key] = typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  return next;
}

function normalizeIndicatorMetric(metric: LegacySensitivityIndicatorPointMetric | SensitivityIndicatorPointMetric): SensitivityIndicatorPointMetric {
  const maybeNew = metric as Partial<SensitivityIndicatorPointMetric>;
  if (maybeNew.kpi) {
    return {
      indicatorId: metric.indicatorId,
      title: metric.title,
      units: metric.units,
      kpi: parseKpiValues(maybeNew.kpi),
      deltaFromBaseline: parseKpiValues(maybeNew.deltaFromBaseline)
    };
  }

  const legacy = metric as LegacySensitivityIndicatorPointMetric;
  return {
    indicatorId: legacy.indicatorId,
    title: legacy.title,
    units: legacy.units,
    kpi: {
      mean: typeof legacy.tail120Mean === 'number' && Number.isFinite(legacy.tail120Mean) ? legacy.tail120Mean : null,
      cv: null,
      annualisedTrend: null,
      range: null
    },
    deltaFromBaseline: {
      mean: typeof legacy.deltaFromBaseline === 'number' && Number.isFinite(legacy.deltaFromBaseline)
        ? legacy.deltaFromBaseline
        : null,
      cv: null,
      annualisedTrend: null,
      range: null
    }
  };
}

function normalizeResultsPayload(experimentId: string, raw: unknown): SensitivityExperimentResultsPayload {
  if (!raw || typeof raw !== 'object') {
    return emptyResults(experimentId);
  }

  const candidate = raw as Partial<LegacySensitivityExperimentResultsPayload>;
  const points = Array.isArray(candidate.points)
    ? candidate.points.map((point) => {
      const seedResults = (point as unknown as { seedResults?: SensitivitySeedRunResult[] }).seedResults;
      return {
        ...point,
        indicatorMetrics: Array.isArray(point.indicatorMetrics)
          ? point.indicatorMetrics.map((metric) => normalizeIndicatorMetric(metric))
          : [],
        seedResults: Array.isArray(seedResults)
          ? seedResults.map((seedResult) => ({
            ...seedResult,
            indicatorMetrics: Array.isArray(seedResult.indicatorMetrics)
              ? seedResult.indicatorMetrics.map((metric) => normalizeIndicatorMetric(metric))
              : []
          }))
          : undefined
      };
    })
    : [];

  return {
    experimentId,
    baselinePointId: typeof candidate.baselinePointId === 'string' ? candidate.baselinePointId : null,
    points: points as SensitivityPointResult[]
  };
}

function normalizeChartsPayload(
  experimentId: string,
  parameter: SensitivityExperimentMetadata['parameter'],
  raw: unknown
): SensitivityExperimentChartsPayload {
  if (!raw || typeof raw !== 'object') {
    return emptyCharts(experimentId, parameter);
  }

  const candidate = raw as Partial<LegacySensitivityExperimentChartsPayload & SensitivityExperimentChartsPayload>;
  const tornado: SensitivityTornadoBar[] = Array.isArray(candidate.tornado)
    ? candidate.tornado.map((entry) => {
      const maybeNew = entry as Partial<SensitivityTornadoBar>;
      if (maybeNew.maxAbsDeltaByKpi) {
        return {
          indicatorId: entry.indicatorId,
          title: entry.title,
          units: entry.units,
          maxAbsDeltaByKpi: parseKpiValues(maybeNew.maxAbsDeltaByKpi)
        };
      }
      const legacyEntry = entry as LegacySensitivityTornadoBar;
      return {
        indicatorId: legacyEntry.indicatorId,
        title: legacyEntry.title,
        units: legacyEntry.units,
        maxAbsDeltaByKpi: {
          mean: typeof legacyEntry.maxAbsDelta === 'number' && Number.isFinite(legacyEntry.maxAbsDelta)
            ? legacyEntry.maxAbsDelta
            : null,
          cv: null,
          annualisedTrend: null,
          range: null
        }
      };
    })
    : [];

  const deltaTrend: SensitivityDeltaTrendSeries[] = Array.isArray(candidate.deltaTrend)
    ? candidate.deltaTrend.map((series) => {
      const points = Array.isArray(series.points)
        ? series.points.map((point) => {
          const maybeNew = point as Partial<SensitivityDeltaTrendSeries['points'][number]>;
          if (maybeNew.deltaByKpi) {
            return {
              parameterValue: typeof point.parameterValue === 'number' && Number.isFinite(point.parameterValue)
                ? point.parameterValue
                : null,
              deltaByKpi: parseKpiValues(maybeNew.deltaByKpi)
            };
          }
          const legacyPoint = point as LegacySensitivityDeltaTrendPoint;
          return {
            parameterValue: Number.isFinite(legacyPoint.parameterValue) ? legacyPoint.parameterValue : null,
            deltaByKpi: {
              mean: typeof legacyPoint.delta === 'number' && Number.isFinite(legacyPoint.delta) ? legacyPoint.delta : null,
              cv: null,
              annualisedTrend: null,
              range: null
            }
          };
        })
        : [];

      return {
        indicatorId: series.indicatorId,
        title: series.title,
        units: series.units,
        points
      };
    })
    : [];

  return {
    experimentId,
    parameter,
    windowType: candidate.windowType === 'post_200' ? 'post_200' : 'tail_120',
    tornado,
    deltaTrend
  };
}

function readSummary(
  pathsInput: RuntimePathInput,
  experimentId: string,
  parameter: SensitivityExperimentMetadata['parameter']
): PersistedSummary | null {
  const filePath = summaryPath(pathsInput, experimentId);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PersistedSummary | LegacyPersistedSummary;
    const results = normalizeResultsPayload(experimentId, parsed.results);
    const charts = normalizeChartsPayload(experimentId, parameter, parsed.charts);
    return { results, charts };
  } catch {
    return null;
  }
}

function emptyResults(experimentId: string): SensitivityExperimentResultsPayload {
  return {
    experimentId,
    baselinePointId: null,
    points: []
  };
}

function emptyCharts(
  experimentId: string,
  parameter: SensitivityExperimentMetadata['parameter']
): SensitivityExperimentChartsPayload {
  return {
    experimentId,
    parameter,
    windowType: SENSITIVITY_RESULTS_WINDOW_TYPE,
    tornado: POLICY_CORE_INDICATORS.map((indicator) => ({
      indicatorId: indicator.id,
      title: indicator.title,
      units: indicator.units,
      maxAbsDeltaByKpi: buildEmptyKpiValues()
    })),
    deltaTrend: POLICY_CORE_INDICATORS.map((indicator) => ({
      indicatorId: indicator.id,
      title: indicator.title,
      units: indicator.units,
      points: []
    }))
  };
}

function createLogBuffer(sink?: LogLineSink): LogBufferState {
  return {
    logLines: [],
    logStart: 0,
    partialLine: '',
    ...(sink ? { sink } : {})
  };
}

function taskId(point: SensitivitySamplePoint, seed: number): string {
  return seededTaskId(point.pointId, seed);
}

function createProgressState(metadata: SensitivityExperimentMetadata): SeededProgressState {
  const seeds = metadata.seeds ?? buildSeeds(metadata.seedsPerPoint ?? 1);
  const tasks = metadata.sampledPoints.flatMap((point) =>
    seeds.map((seed) => ({
      pointId: point.pointId,
      pointLabel: point.label,
      seed,
      taskId: taskId(point, seed)
    }))
  );
  return createSeededProgressState(
    'sensitivity',
    tasks,
    Math.max(1, metadata.maxWorkers ?? defaultWorkerCount(tasks.length)),
    metadata.startedAt,
    metadata.endedAt
  );
}

function hydrateProgressFromResults(progress: SeededProgressState, results: SensitivityExperimentResultsPayload): void {
  for (const point of results.points) {
    for (const seedResult of point.seedResults ?? []) {
      const id = `${point.pointId}\0${seedResult.seed}`;
      const task = progress.tasks.get(id);
      if (!task) {
        continue;
      }
      task.status = seedResult.status;
      task.lastModelTime = task.nSteps;
      task.endedAtMs = progress.endedAtMs ?? progress.updatedAtMs;
    }
  }
}

function createProgressSnapshot(record: ExperimentRecord, nowMs = Date.now()): ExperimentProgressSnapshot {
  return createSeededProgressSnapshot(record, record.metadata.status, nowMs);
}

function publishProgress(record: ExperimentRecord, force = false): void {
  publishSeededProgress(record, record.metadata.status, force);
}

function updateProgressStarted(record: ExperimentRecord): void {
  updateSeededProgressStarted(record, record.metadata.status, record.metadata.startedAt);
}

function startProgressTask(
  record: ExperimentRecord,
  point: SensitivitySamplePoint,
  seed: number,
  workerIndex: number,
  nSteps: number | null
): SeededProgressTask {
  return startSeededProgressTask(
    record,
    {
      pointId: point.pointId,
      pointLabel: point.label,
      seed,
      taskId: taskId(point, seed)
    },
    workerIndex,
    nSteps,
    record.metadata.status
  );
}

function finishProgressTask(
  record: ExperimentRecord,
  id: string,
  status: SensitivitySeedRunResult['status']
): void {
  finishSeededProgressTask(record, id, status as SeededRunStatus, record.metadata.status);
}

function emitRawLogLine(record: ExperimentRecord, streamName: 'stdout' | 'stderr', line: string): void {
  if (!record.rawLogSink) {
    return;
  }
  try {
    record.rawLogSink(`[sensitivity:${record.metadata.experimentId}] [raw:${streamName}] ${line}`);
  } catch {
    // Raw persistent logs must not affect model execution.
  }
}

function asSummary(metadata: SensitivityExperimentMetadata): SensitivityExperimentSummary {
  return {
    experimentId: metadata.experimentId,
    title: metadata.title,
    baseline: metadata.baseline,
    basePolicy: metadata.basePolicy,
    status: metadata.status,
    createdAt: metadata.createdAt,
    startedAt: metadata.startedAt,
    endedAt: metadata.endedAt,
    seedsPerPoint: metadata.seedsPerPoint,
    seeds: metadata.seeds,
    maxWorkers: metadata.maxWorkers,
    generalOverrides: metadata.generalOverrides,
    parameter: metadata.parameter
  };
}

function getSelectedParameterKeys(parameter: SensitivityExperimentMetadata['parameter']): string[] {
  return parameter.parameterKeys && parameter.parameterKeys.length > 0 ? parameter.parameterKeys : [parameter.key];
}

function formatPointValues(point: SensitivitySamplePoint, parameterKeys: readonly string[]): string {
  const values = getPointValuesByKey(point, parameterKeys);
  const commonValue = commonPointValue(values);
  if (commonValue !== null) {
    return String(commonValue);
  }
  return parameterKeys.map((key) => `${key}=${values[key]}`).join(', ');
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function stripInlineComment(value: string): string {
  const index = value.indexOf(' #');
  if (index >= 0) {
    return value.slice(0, index);
  }
  return value;
}

function parseConfigAssignments(configPath: string): Map<string, string> {
  const lines = fs.readFileSync(configPath, 'utf-8').split(/\r?\n/);
  const values = new Map<string, string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(trimmed);
    if (!match) {
      continue;
    }

    const rawValue = stripInlineComment(match[2]).trim();
    values.set(match[1], unquote(rawValue));
  }

  return values;
}

function parseOptionalNumber(values: Map<string, string>, key: string): number | null {
  const rawValue = values.get(key);
  if (rawValue === undefined) {
    return null;
  }
  const parsed = Number.parseFloat(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPolicyBindingValues(pathsInput: RuntimePathInput, baseline: string): PolicyBindingValues {
  const paths = resolveRuntimePaths(pathsInput);
  const configPath = path.join(paths.dataRoot, baseline, 'config.properties');
  const values = parseConfigAssignments(configPath);
  return {
    bankInitialRate: parseOptionalNumber(values, 'BANK_INITIAL_RATE'),
    bankLtvHardMaxFtb: parseOptionalNumber(values, 'BANK_LTV_HARD_MAX_FTB'),
    bankLtvHardMaxHm: parseOptionalNumber(values, 'BANK_LTV_HARD_MAX_HM'),
    bankLtvHardMaxBtl: parseOptionalNumber(values, 'BANK_LTV_HARD_MAX_BTL'),
    bankLtiHardMaxFtb: parseOptionalNumber(values, 'BANK_LTI_HARD_MAX_FTB'),
    bankLtiHardMaxHm: parseOptionalNumber(values, 'BANK_LTI_HARD_MAX_HM'),
    bankAffordabilityHardMax: parseOptionalNumber(values, 'BANK_AFFORDABILITY_HARD_MAX'),
    bankIcrHardMin: parseOptionalNumber(values, 'BANK_ICR_HARD_MIN')
  };
}

function readConfigSeed(configPath: string): number | null {
  const lines = fs.readFileSync(configPath, 'utf-8').split(/\r?\n/);
  const seedLine = lines.find((line) => /^\s*SEED\s*=/.test(line));
  if (!seedLine) {
    return null;
  }
  const match = /^\s*SEED\s*=\s*(.+)$/.exec(seedLine);
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(unquote(stripInlineComment(match[1]).trim()));
  return Number.isFinite(parsed) ? parsed : null;
}

function readConfigPositiveInteger(configPath: string, key: string): number | null {
  const values = parseConfigAssignments(configPath);
  const rawValue = values.get(key);
  if (rawValue === undefined) {
    return null;
  }
  const parsed = Number.parseFloat(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function rewriteConfigForRun(
  baselineConfigPath: string,
  baselineDirPath: string,
  outputConfigPath: string,
  overrides: Map<string, string>
): void {
  const lines = fs.readFileSync(baselineConfigPath, 'utf-8').split(/\r?\n/);
  const seenOverrides = new Set<string>();

  const rewritten = lines.map((line) => {
    const match = /^(\s*)([A-Za-z0-9_]+)(\s*=\s*)(.*)$/.exec(line);
    if (!match) {
      return line;
    }

    const leading = match[1];
    const key = match[2];
    const separator = match[3];
    const rawValue = match[4];

    if (overrides.has(key)) {
      seenOverrides.add(key);
      return `${leading}${key}${separator}${overrides.get(key) as string}`;
    }

    if (key.startsWith('DATA_')) {
      const stripped = stripInlineComment(rawValue).trim();
      const unquoted = unquote(stripped);
      if (!unquoted) {
        return line;
      }
      const fileName = path.basename(unquoted);
      const candidate = path.join(baselineDirPath, fileName);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return `${leading}${key}${separator}"${candidate.replace(/\\/g, '/')}"`;
      }
    }

    return line;
  });

  for (const key of overrides.keys()) {
    if (!seenOverrides.has(key)) {
      throw new Error(`Could not apply override ${key} because it is missing from baseline config.`);
    }
  }

  fs.mkdirSync(path.dirname(outputConfigPath), { recursive: true });
  fs.writeFileSync(outputConfigPath, `${rewritten.join('\n')}\n`, 'utf-8');
}

function maybeNumber(value: number | boolean | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function addPolicyBindingWarnings(
  warnings: ModelRunWarning[],
  valuesByKey: Map<string, number | boolean>,
  parameterKey: string,
  policyBindingValues: PolicyBindingValues
): void {
  switch (parameterKey) {
    case 'CENTRAL_BANK_INITIAL_BASE_RATE': {
      const baseRate = maybeNumber(valuesByKey.get(parameterKey));
      const bankInitialRate = policyBindingValues.bankInitialRate;
      if (baseRate !== null && bankInitialRate !== null && baseRate < bankInitialRate) {
        warnings.push({
          code: 'central_bank_base_rate_below_bank_initial_rate',
          message: `${parameterKey}=${baseRate} is below BANK_INITIAL_RATE=${bankInitialRate}; this usually changes interest-rate spread only unless the base-rate floor becomes binding.`,
          severity: 'warning'
        });
      }
      break;
    }
    case 'CENTRAL_BANK_LTV_HARD_MAX_FTB':
      addUpperLimitWarning(warnings, valuesByKey, parameterKey, policyBindingValues.bankLtvHardMaxFtb, 'BANK_LTV_HARD_MAX_FTB');
      break;
    case 'CENTRAL_BANK_LTV_HARD_MAX_HM':
      addUpperLimitWarning(warnings, valuesByKey, parameterKey, policyBindingValues.bankLtvHardMaxHm, 'BANK_LTV_HARD_MAX_HM');
      break;
    case 'CENTRAL_BANK_LTV_HARD_MAX_BTL':
      addUpperLimitWarning(warnings, valuesByKey, parameterKey, policyBindingValues.bankLtvHardMaxBtl, 'BANK_LTV_HARD_MAX_BTL');
      break;
    case 'CENTRAL_BANK_AFFORDABILITY_HARD_MAX':
      addUpperLimitWarning(
        warnings,
        valuesByKey,
        parameterKey,
        policyBindingValues.bankAffordabilityHardMax,
        'BANK_AFFORDABILITY_HARD_MAX'
      );
      break;
    case 'CENTRAL_BANK_ICR_HARD_MIN':
      addLowerLimitWarning(warnings, valuesByKey, parameterKey, policyBindingValues.bankIcrHardMin, 'BANK_ICR_HARD_MIN');
      break;
    case 'CENTRAL_BANK_LTI_SOFT_MAX_FTB':
      addLtiSoftLimitWarning(warnings, valuesByKey, parameterKey, policyBindingValues.bankLtiHardMaxFtb, 'BANK_LTI_HARD_MAX_FTB');
      break;
    case 'CENTRAL_BANK_LTI_SOFT_MAX_HM':
      addLtiSoftLimitWarning(warnings, valuesByKey, parameterKey, policyBindingValues.bankLtiHardMaxHm, 'BANK_LTI_HARD_MAX_HM');
      break;
    case 'CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_FTB':
      addLtiQuotaWarning(
        warnings,
        valuesByKey,
        'CENTRAL_BANK_LTI_SOFT_MAX_FTB',
        policyBindingValues.bankLtiHardMaxFtb,
        'BANK_LTI_HARD_MAX_FTB',
        parameterKey
      );
      break;
    case 'CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_HM':
      addLtiQuotaWarning(
        warnings,
        valuesByKey,
        'CENTRAL_BANK_LTI_SOFT_MAX_HM',
        policyBindingValues.bankLtiHardMaxHm,
        'BANK_LTI_HARD_MAX_HM',
        parameterKey
      );
      break;
    case 'CENTRAL_BANK_LTI_MONTHS_TO_CHECK':
      addLtiMonthsWarning(warnings, valuesByKey, policyBindingValues);
      break;
    default:
      break;
  }
}

function addUpperLimitWarning(
  warnings: ModelRunWarning[],
  valuesByKey: Map<string, number | boolean>,
  parameterKey: string,
  bankLimit: number | null,
  bankLimitKey: string
): void {
  const value = maybeNumber(valuesByKey.get(parameterKey));
  if (value !== null && bankLimit !== null && value >= bankLimit) {
    warnings.push({
      code: 'central_bank_upper_limit_non_binding',
      message: `${parameterKey}=${value} is not stricter than ${bankLimitKey}=${bankLimit}, so this point is likely non-binding one-at-a-time.`,
      severity: 'warning'
    });
  }
}

function addLowerLimitWarning(
  warnings: ModelRunWarning[],
  valuesByKey: Map<string, number | boolean>,
  parameterKey: string,
  bankLimit: number | null,
  bankLimitKey: string
): void {
  const value = maybeNumber(valuesByKey.get(parameterKey));
  if (value !== null && bankLimit !== null && value <= bankLimit) {
    warnings.push({
      code: 'central_bank_lower_limit_non_binding',
      message: `${parameterKey}=${value} is not stricter than ${bankLimitKey}=${bankLimit}, so this point is likely non-binding one-at-a-time.`,
      severity: 'warning'
    });
  }
}

function addLtiSoftLimitWarning(
  warnings: ModelRunWarning[],
  valuesByKey: Map<string, number | boolean>,
  parameterKey: string,
  bankLimit: number | null,
  bankLimitKey: string
): void {
  const value = maybeNumber(valuesByKey.get(parameterKey));
  if (value !== null && bankLimit !== null && value >= bankLimit) {
    warnings.push({
      code: 'central_bank_lti_soft_limit_non_binding',
      message: `${parameterKey}=${value} is at or above ${bankLimitKey}=${bankLimit}; points below the private hard LTI can still depend on quota use and mortgage demand.`,
      severity: 'warning'
    });
  }
}

function addLtiQuotaWarning(
  warnings: ModelRunWarning[],
  valuesByKey: Map<string, number | boolean>,
  softLimitKey: string,
  bankLimit: number | null,
  bankLimitKey: string,
  parameterKey: string
): void {
  const softLimit = maybeNumber(valuesByKey.get(softLimitKey));
  if (softLimit !== null && bankLimit !== null && softLimit >= bankLimit) {
    warnings.push({
      code: 'central_bank_lti_quota_inactive',
      message: `${parameterKey} is unlikely to affect outputs one-at-a-time because ${softLimitKey}=${softLimit} is not stricter than ${bankLimitKey}=${bankLimit}.`,
      severity: 'warning'
    });
  }
}

function addLtiMonthsWarning(
  warnings: ModelRunWarning[],
  valuesByKey: Map<string, number | boolean>,
  policyBindingValues: PolicyBindingValues
): void {
  const ftbSoftLimit = maybeNumber(valuesByKey.get('CENTRAL_BANK_LTI_SOFT_MAX_FTB'));
  const hmSoftLimit = maybeNumber(valuesByKey.get('CENTRAL_BANK_LTI_SOFT_MAX_HM'));
  const ftbInactive =
    ftbSoftLimit !== null &&
    policyBindingValues.bankLtiHardMaxFtb !== null &&
    ftbSoftLimit >= policyBindingValues.bankLtiHardMaxFtb;
  const hmInactive =
    hmSoftLimit !== null &&
    policyBindingValues.bankLtiHardMaxHm !== null &&
    hmSoftLimit >= policyBindingValues.bankLtiHardMaxHm;

  if (ftbInactive && hmInactive) {
    warnings.push({
      code: 'central_bank_lti_window_inactive',
      message: 'CENTRAL_BANK_LTI_MONTHS_TO_CHECK is unlikely to affect outputs one-at-a-time because both FTB and HM soft LTI limits are not stricter than private hard LTI limits.',
      severity: 'warning'
    });
  }
}

function createWarnings(
  valuesByKey: Map<string, number | boolean>,
  parameterKeys: readonly string[],
  policyBindingValues: PolicyBindingValues
): ModelRunWarning[] {
  const warnings: ModelRunWarning[] = [];
  const nSteps = Number(valuesByKey.get('N_STEPS') ?? 0);
  if (nSteps > 4_000) {
    warnings.push({
      code: 'high_n_steps',
      message: `N_STEPS=${nSteps} can significantly increase runtime and output size.`,
      severity: 'warning'
    });
  }

  const targetPopulation = Number(valuesByKey.get('TARGET_POPULATION') ?? 0);
  if (targetPopulation > 15_000) {
    warnings.push({
      code: 'high_target_population',
      message: `TARGET_POPULATION=${targetPopulation} can increase runtime and memory usage.`,
      severity: 'warning'
    });
  }

  const nSims = Number(valuesByKey.get('N_SIMS') ?? 0);
  if (nSims > 1) {
    warnings.push({
      code: 'multiple_simulations',
      message: `Seeds per sampled point=${nSims} runs multiple independent seed processes and may take much longer.`,
      severity: 'warning'
    });
  }

  if (valuesByKey.get('recordTransactions') === true) {
    warnings.push({
      code: 'record_transactions_enabled',
      message: 'recordTransactions=true can produce very large transaction output files.',
      severity: 'warning'
    });
  }

  const microFlags = [
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
  ];
  const enabledMicroFlags = microFlags.filter((key) => valuesByKey.get(key) === true);
  if (enabledMicroFlags.length >= 4) {
    warnings.push({
      code: 'heavy_microdata_recording',
      message: `Microdata recording is enabled for ${enabledMicroFlags.length} fields and may create heavy output files.`,
      severity: 'warning'
    });
  }

  if (valuesByKey.get('recordCoreIndicators') === false) {
    warnings.push({
      code: 'core_indicators_disabled',
      message: 'recordCoreIndicators=false means very little data will be visible in Model Results.',
      severity: 'warning'
    });
  }

  for (const parameterKey of parameterKeys) {
    addPolicyBindingWarnings(warnings, valuesByKey, parameterKey, policyBindingValues);
  }

  return warnings;
}

function parseNumericSeries(filePath: string): number[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const firstLine = fs
    .readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return [];
  }

  return firstLine
    .split(';')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => Number.parseFloat(token))
    .filter((value) => Number.isFinite(value));
}

function getPointIndicatorKpis(outputPath: string): SensitivityIndicatorPointMetric[] {
  return POLICY_CORE_INDICATORS.map((indicator) => {
    const values = parseNumericSeries(path.join(outputPath, indicator.fileName));
    return {
      indicatorId: indicator.id,
      title: indicator.title,
      units: indicator.units,
      kpi: computePost200Kpi(values),
      deltaFromBaseline: buildEmptyKpiValues()
    };
  });
}

function commonPointValue(valuesByKey: Record<string, number>): number | null {
  const values = Object.values(valuesByKey);
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const [first] = values;
  return values.every((value) => Math.abs(value - first) < BASELINE_EPSILON) ? first : null;
}

function getPointValuesByKey(point: SensitivitySamplePoint, parameterKeys: readonly string[]): Record<string, number> {
  if (point.valuesByKey) {
    return Object.fromEntries(
      parameterKeys.map((key) => {
        const value = Number(point.valuesByKey?.[key]);
        if (!Number.isFinite(value)) {
          throw new Error(`Sensitivity point ${point.pointId} does not have a numeric value for ${key}.`);
        }
        return [key, value];
      })
    );
  }
  if (point.value === null) {
    throw new Error(`Sensitivity point ${point.pointId} does not have key-specific values.`);
  }
  return Object.fromEntries(parameterKeys.map((key) => [key, point.value as number]));
}

function buildSamplePoints(
  min: number,
  max: number,
  baselineValuesByKey: Record<string, number>,
  packageDefinition: SensitivityPolicyPackageDefinition,
  sampleCount: number
): {
  points: SensitivitySamplePoint[];
  collapsedSlots: Record<SensitivitySampleSlot, string>;
} {
  const parameterType = packageDefinition.type;
  const parameterKeys = packageDefinition.parameterKeys;
  const toSharedValues = (value: number): Record<string, number> => {
    const normalized = normalizeSensitivitySampleValue(value, parameterType);
    return Object.fromEntries(parameterKeys.map((key) => [key, normalized]));
  };
  const normalizedBaselineValues = Object.fromEntries(
    parameterKeys.map((key) => [key, normalizeSensitivitySampleValue(baselineValuesByKey[key] ?? Number.NaN, parameterType)])
  );
  const baselineScalar = commonPointValue(normalizedBaselineValues);
  const rawSlots: Array<{
    slot: SensitivitySampleSlot;
    value: number | null;
    label: string;
    valuesByKey: Record<string, number>;
    isBaseline: boolean;
  }> = [];
  const intervalCount = sampleCount - 1;
  for (let index = 0; index < sampleCount; index += 1) {
    const slot = `sample_${index + 1}`;
    const rawValue = index === sampleCount - 1 ? max : min + ((max - min) * index) / intervalCount;
    const value = normalizeSensitivitySampleValue(rawValue, parameterType);
    rawSlots.push({
      slot,
      value,
      label: formatSensitivitySampleLabel(value),
      valuesByKey: toSharedValues(rawValue),
      isBaseline: false
    });
    if (index === 0) {
      rawSlots.push({
        slot: 'min',
        value,
        label: formatSensitivitySampleLabel(value),
        valuesByKey: toSharedValues(rawValue),
        isBaseline: false
      });
    }
    if (index === sampleCount - 1) {
      rawSlots.push({
        slot: 'max',
        value,
        label: formatSensitivitySampleLabel(value),
        valuesByKey: toSharedValues(rawValue),
        isBaseline: false
      });
    }
  }
  rawSlots.push({
    slot: 'baseline',
    value: baselineScalar,
    label: baselineScalar === null ? 'base policy' : formatSensitivitySampleLabel(baselineScalar),
    valuesByKey: normalizedBaselineValues,
    isBaseline: true
  });

  const byValue = new Map<string, SensitivitySamplePoint>();
  const usedPointIds = new Set<string>();
  const collapsedSlots = {} as Record<SensitivitySampleSlot, string>;

  for (const entry of rawSlots) {
    const signature =
      entry.value === null
        ? `baseline:${parameterKeys.map((key) => `${key}=${entry.valuesByKey[key]}`).join('|')}`
        : `value:${entry.label}`;
    const existing = byValue.get(signature);
    if (existing) {
      if (!existing.slotLabels.includes(entry.slot)) {
        existing.slotLabels.push(entry.slot);
      }
      existing.isBaseline = existing.isBaseline || entry.isBaseline;
      collapsedSlots[entry.slot] = existing.pointId;
      continue;
    }

    const safeLabel = entry.label.replace(/[^A-Za-z0-9.-]/g, '_').replace(/^-+/, 'm');
    const basePointId = `point-${safeLabel || '0'}`;
    let pointId = basePointId;
    let suffix = 2;
    while (usedPointIds.has(pointId)) {
      pointId = `${basePointId}-${suffix}`;
      suffix += 1;
    }
    usedPointIds.add(pointId);

    const point: SensitivitySamplePoint = {
      pointId,
      value: entry.value,
      label: entry.label,
      valuesByKey: entry.valuesByKey,
      slotLabels: [entry.slot],
      isBaseline: entry.isBaseline
    };
    byValue.set(signature, point);
    collapsedSlots[entry.slot] = point.pointId;
  }

  return {
    points: [...byValue.values()],
    collapsedSlots
  };
}

function appendLifecycle(record: ExperimentRecord, message: string): void {
  appendLogLine(record.logBuffer, `[system] ${message}`, MAX_LOG_LINES);
}

function ensureLoaded(pathsInput: RuntimePathInput): void {
  const paths = resolveRuntimePaths(pathsInput);
  const state = getRepoState(paths);
  if (state.loaded) {
    return;
  }

  const root = path.join(paths.resultsRoot, EXPERIMENTS_DIR);
  if (!fs.existsSync(root)) {
    state.loaded = true;
    return;
  }

  const entries = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const experimentId of entries) {
    const filePath = metadataPath(paths, experimentId);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    try {
      const metadata = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SensitivityExperimentMetadata;
      if (metadata.experimentId !== experimentId) {
        continue;
      }

      if (!isTerminal(metadata.status)) {
        metadata.status = 'failed';
        metadata.failureReason = 'interrupted_on_restart';
        metadata.endedAt = new Date().toISOString();
        writeMetadata(paths, metadata);
      }

      const persistedSummary = readSummary(paths, experimentId, metadata.parameter);
      const results = persistedSummary?.results ?? emptyResults(experimentId);
      addDeltaAgainstBaseline(results);
      const charts = persistedSummary?.charts ?? buildChartsFromResults(experimentId, metadata.parameter, results);

      const record: ExperimentRecord = {
        runtimePaths: paths,
        metadata,
        results,
        charts,
        logBuffer: createLogBuffer(),
        progress: createProgressState(metadata),
        lastProgressSinkAtMs: 0,
        launcher: defaultSensitivityLauncher,
        manifestPoints: [],
        normalizedGeneralOverrides: new Map(),
        activeProcesses: new Set(),
        cancelRequested: false
      };
      hydrateProgressFromResults(record.progress, results);

      state.experimentsById.set(experimentId, record);
      state.order.push(experimentId);
    } catch {
      // Ignore malformed experiment records.
    }
  }

  state.order.sort((leftId, rightId) => {
    const left = state.experimentsById.get(leftId);
    const right = state.experimentsById.get(rightId);
    if (!left || !right) {
      return 0;
    }
    return Date.parse(left.metadata.createdAt) - Date.parse(right.metadata.createdAt);
  });

  state.loaded = true;
}

function resolveParameterDefinitions(pathsInput: RuntimePathInput, baseline: string): {
  baseline: string;
  parameters: ModelRunParameterDefinition[];
  sensitivityPolicyPackages: SensitivityPolicyPackageDefinition[];
} {
  const options = getModelRunOptions(pathsInput, baseline, true);
  return {
    baseline: options.requestedBaseline,
    parameters: options.parameters,
    sensitivityPolicyPackages: options.sensitivityPolicyPackages
  };
}

function resolveBasePolicyId(baseline: string, rawBasePolicy: BasePolicyId | undefined): BasePolicyId {
  if (rawBasePolicy === undefined) {
    return getDefaultBasePolicyId(baseline);
  }
  if (!isBasePolicyId(rawBasePolicy)) {
    throw new Error(`Unsupported base policy: ${rawBasePolicy}`);
  }
  return rawBasePolicy;
}

function applyBasePolicyValues(
  basePolicy: BasePolicyId,
  parameterDefMap: ReadonlyMap<string, ModelRunParameterDefinition>,
  valuesByKey: Map<string, number | boolean>
): void {
  const policy = getBasePolicyOption(basePolicy);
  for (const [key, value] of Object.entries(policy.values)) {
    if (!parameterDefMap.has(key)) {
      throw new Error(`Base policy ${basePolicy} references unsupported parameter ${key}.`);
    }
    valuesByKey.set(key, value);
  }
}

function resolvePolicyPackage(
  packages: SensitivityPolicyPackageDefinition[],
  payload: SensitivityExperimentCreateRequest
): SensitivityPolicyPackageDefinition {
  const requestedPackageId = payload.policyPackageId?.trim();
  const legacyParameterKey = payload.parameterKey?.trim();

  if (requestedPackageId) {
    const packageDefinition =
      packages.find((item) => item.id === requestedPackageId) ?? getSensitivityPolicyPackageById(requestedPackageId);
    if (!packageDefinition) {
      throw new Error(`Unsupported sensitivity policy package: ${requestedPackageId}`);
    }
    if (legacyParameterKey && !packageDefinition.parameterKeys.includes(legacyParameterKey)) {
      throw new Error(`parameterKey ${legacyParameterKey} is not part of policy package ${requestedPackageId}.`);
    }
    return packageDefinition;
  }

  if (!legacyParameterKey) {
    throw new Error('policyPackageId or parameterKey is required.');
  }

  const singletonPackage =
    packages.find((item) => item.parameterKeys.length === 1 && item.parameterKeys[0] === legacyParameterKey) ??
    getSingletonSensitivityPolicyPackage(legacyParameterKey);
  if (!singletonPackage) {
    throw new Error(`Unsupported sensitivity parameter: ${legacyParameterKey}`);
  }
  return singletonPackage;
}

function buildPackageBaselineValues(
  valuesByKey: ReadonlyMap<string, number | boolean>,
  packageDefinition: SensitivityPolicyPackageDefinition
): Record<string, number> {
  return Object.fromEntries(
    packageDefinition.parameterKeys.map((key) => {
      const value = Number(valuesByKey.get(key));
      if (!Number.isFinite(value)) {
        throw new Error(`Baseline value for ${key} is not numeric.`);
      }
      return [key, value];
    })
  );
}

function assertPackageBaselineWithinRange(
  baselineValuesByKey: Record<string, number>,
  packageDefinition: SensitivityPolicyPackageDefinition,
  min: number,
  max: number
): void {
  const outOfRange = packageDefinition.parameterKeys.filter((key) => {
    const value = baselineValuesByKey[key];
    return value === undefined || value < min || value > max;
  });
  if (outOfRange.length > 0) {
    throw new Error(
      `Base policy values for ${packageDefinition.title} must be within [${min}, ${max}] for sensitivity.`
    );
  }
}

function validatePayload(
  pathsInput: RuntimePathInput,
  payload: SensitivityExperimentCreateRequest
): {
  baseline: string;
  basePolicy: BasePolicyId;
  policyPackage: SensitivityPolicyPackageDefinition;
  min: number;
  max: number;
  baselineValue: number | null;
  baselineValuesByKey: Record<string, number>;
  sampleCount: number;
  samplePoints: SensitivitySamplePoint[];
  collapsedSlots: Record<SensitivitySampleSlot, string>;
  valuesByKey: Map<string, number | boolean>;
  normalizedGeneralOverrides: Map<string, string>;
  generalOverrides: Record<string, number | boolean>;
  seeds: number[];
  maxWorkers: number;
  policyBindingValues: PolicyBindingValues;
} {
  const baseline = payload.baseline?.trim();
  if (!baseline) {
    throw new Error('baseline is required.');
  }

  const min = Number(payload.min);
  const max = Number(payload.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error('Sensitivity min and max must be numeric.');
  }
  if (!(min < max)) {
    throw new Error('Sensitivity min must be strictly less than max.');
  }

  const { parameters, sensitivityPolicyPackages } = resolveParameterDefinitions(pathsInput, baseline);
  const policyPackage = resolvePolicyPackage(sensitivityPolicyPackages, payload);

  const valuesByKey = new Map(parameters.map((item) => [item.key, item.defaultValue]));
  const parameterDefMap = new Map(parameters.map((item) => [item.key, item]));
  for (const key of policyPackage.parameterKeys) {
    const parameter = parameterDefMap.get(key);
    if (!parameter) {
      throw new Error(`Unsupported sensitivity parameter: ${key}`);
    }
    if (parameter.group !== 'Central Bank policy') {
      throw new Error(`Sensitivity parameter must be a Central Bank policy parameter: ${key}`);
    }
    if (parameter.type === 'boolean') {
      throw new Error(`Sensitivity parameter must be numeric: ${key}`);
    }
  }

  const basePolicy = resolveBasePolicyId(baseline, payload.basePolicy);
  applyBasePolicyValues(basePolicy, parameterDefMap, valuesByKey);
  const normalizedGeneralOverrides = new Map<string, string>();
  const generalOverrides: Record<string, number | boolean> = {};

  for (const [key, rawValue] of Object.entries(payload.overrides ?? {})) {
    const definition = parameterDefMap.get(key);
    if (!definition) {
      throw new Error(`Unsupported sensitivity override key: ${key}`);
    }
    if (definition.key === 'SEED') {
      throw new Error('SEED is fixed to 1 for sensitivity experiments and cannot be overridden.');
    }
    if (definition.group !== 'General model control') {
      throw new Error(`Sensitivity overrides are limited to General model control parameters: ${key}`);
    }

    const parsedOverride = normalizeSensitivityOverrideValue(key, rawValue, definition.type);
    normalizedGeneralOverrides.set(key, parsedOverride.serialized);
    valuesByKey.set(key, parsedOverride.typed);
    generalOverrides[key] = parsedOverride.typed;
  }

  if (!normalizedGeneralOverrides.has('N_SIMS')) {
    normalizedGeneralOverrides.set('N_SIMS', '5');
    valuesByKey.set('N_SIMS', 5);
    generalOverrides.N_SIMS = 5;
  }

  const baselineValuesByKey = buildPackageBaselineValues(valuesByKey, policyPackage);
  assertPackageBaselineWithinRange(baselineValuesByKey, policyPackage, min, max);
  const baselineValue = commonPointValue(baselineValuesByKey);

  const sampleCount = parseSampleCount(payload.sampleCount);
  const { points, collapsedSlots } = buildSamplePoints(min, max, baselineValuesByKey, policyPackage, sampleCount);
  if (points.length === 0) {
    throw new Error('No sampled points were produced for this sensitivity range.');
  }

  const seedCount = parseSeedCount(valuesByKey);
  const seeds = buildSeeds(seedCount);
  const maxWorkers = parseMaxWorkers(payload.maxWorkers, points.length * seeds.length);
  const policyBindingValues = readPolicyBindingValues(pathsInput, baseline);

  return {
    baseline,
    basePolicy,
    policyPackage,
    min,
    max,
    baselineValue,
    baselineValuesByKey,
    sampleCount,
    samplePoints: points,
    collapsedSlots,
    valuesByKey,
    normalizedGeneralOverrides,
    generalOverrides,
    seeds,
    maxWorkers,
    policyBindingValues
  };
}

function parseSampleCount(rawValue: unknown): number {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return 5;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 2) {
    throw new Error('sampleCount must be an integer greater than or equal to 2.');
  }
  return parsed;
}

function buildWarnings(
  baseValuesByKey: Map<string, number | boolean>,
  policyPackage: SensitivityPolicyPackageDefinition,
  points: SensitivitySamplePoint[],
  policyBindingValues: PolicyBindingValues
): {
  warnings: ModelRunWarning[];
  warningSummary: SensitivityExperimentMetadata['warningSummary'];
} {
  const warningSummary: SensitivityExperimentMetadata['warningSummary'] = { byPoint: {} };
  const aggregate = new Map<string, { warning: ModelRunWarning; pointLabels: string[] }>();

  for (const point of points) {
    const values = new Map(baseValuesByKey);
    for (const [key, value] of Object.entries(getPointValuesByKey(point, policyPackage.parameterKeys))) {
      values.set(key, value);
    }
    const pointWarnings = createWarnings(values, policyPackage.parameterKeys, policyBindingValues);
    warningSummary.byPoint[point.pointId] = pointWarnings.map((warning) => warning.code);

    for (const warning of pointWarnings) {
      const key = `${warning.code}|${warning.message}`;
      const current = aggregate.get(key);
      if (current) {
        if (!current.pointLabels.includes(point.label)) {
          current.pointLabels.push(point.label);
        }
      } else {
        aggregate.set(key, {
          warning,
          pointLabels: [point.label]
        });
      }
    }
  }

  const warnings = [...aggregate.values()].map(({ warning, pointLabels }) => ({
    ...warning,
    message: `${warning.message} (points: ${pointLabels.join(', ')})`
  }));

  return { warnings, warningSummary };
}

export interface PreparedSensitivityExperimentSubmission {
  experimentId: string;
  title?: string;
  baseline: string;
  basePolicy: BasePolicyId;
  policyPackage: SensitivityPolicyPackageDefinition;
  min: number;
  max: number;
  baselineValue: number | null;
  baselineValuesByKey: Record<string, number>;
  sampleCount: number;
  samplePoints: SensitivitySamplePoint[];
  collapsedSlots: Record<SensitivitySampleSlot, string>;
  normalizedGeneralOverrides: Map<string, string>;
  generalOverrides: Record<string, number | boolean>;
  seeds: number[];
  maxWorkers: number;
  policyBindingValues: PolicyBindingValues;
  warnings: ModelRunWarning[];
  warningSummary: SensitivityExperimentMetadata['warningSummary'];
}

export function prepareSensitivityExperimentSubmission(
  pathsInput: RuntimePathInput,
  payload: SensitivityExperimentCreateRequest,
  options: { now?: Date; forcedExperimentId?: string } = {}
):
  | { accepted: false; warnings: ModelRunWarning[]; warningSummary: SensitivityExperimentMetadata['warningSummary'] }
  | { accepted: true; prepared: PreparedSensitivityExperimentSubmission } {
  const {
    baseline,
    basePolicy,
    policyPackage,
    min,
    max,
    baselineValue,
    baselineValuesByKey,
    sampleCount,
    samplePoints,
    collapsedSlots,
    valuesByKey,
    normalizedGeneralOverrides,
    generalOverrides,
    seeds,
    maxWorkers,
    policyBindingValues
  } = validatePayload(pathsInput, payload);
  const { warnings, warningSummary } = buildWarnings(valuesByKey, policyPackage, samplePoints, policyBindingValues);

  if (warnings.length > 0 && payload.confirmWarnings !== true) {
    return {
      accepted: false,
      warnings,
      warningSummary
    };
  }

  const now = options.now ?? new Date();
  const experimentId = options.forcedExperimentId
    ? validateForcedExperimentId(options.forcedExperimentId)
    : buildExperimentId(now);
  const trimmedTitle = payload.title?.trim();
  const title = trimmedTitle ? sanitizeFragment(trimmedTitle).slice(0, 120) : undefined;

  return {
    accepted: true,
    prepared: {
      experimentId,
      title,
      baseline,
      basePolicy,
      policyPackage,
      min,
      max,
      baselineValue,
      baselineValuesByKey,
      sampleCount,
      samplePoints,
      collapsedSlots,
      normalizedGeneralOverrides,
      generalOverrides,
      seeds,
      maxWorkers,
      policyBindingValues,
      warnings,
      warningSummary
    }
  };
}

function hasActiveManualModelRuns(): boolean {
  return listModelRunJobs().some((job) => job.status === 'queued' || job.status === 'running');
}

function normalizeSensitivityOverrideValue(
  key: string,
  rawValue: number | boolean,
  type: ModelRunParameterDefinition['type']
): { typed: number | boolean; serialized: string } {
  if (type === 'boolean') {
    if (typeof rawValue !== 'boolean') {
      throw new Error(`Override ${key} must be boolean.`);
    }
    return { typed: rawValue, serialized: String(rawValue) };
  }

  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
    throw new Error(`Override ${key} must be numeric.`);
  }

  if (type === 'integer' && !Number.isInteger(rawValue)) {
    throw new Error(`Override ${key} must be an integer.`);
  }

  return { typed: rawValue, serialized: String(rawValue) };
}

function parseSeedCount(valuesByKey: Map<string, number | boolean>): number {
  return parseSeedCountValue(valuesByKey.get('N_SIMS') ?? 1, 'Seeds per sampled point');
}

/**
 * True when the baseline mean is so close to zero, relative to the series' own spread, that a
 * percentage difference against it carries no information. Falls back to the plain epsilon check
 * when no usable spread is available.
 */
function isBaselineMeanNearZero(baseline: KpiMetricValues): boolean {
  const mean = baseline.mean;
  if (mean === null || !Number.isFinite(mean)) {
    return true;
  }
  if (Math.abs(mean) < BASELINE_EPSILON) {
    return true;
  }
  const spread = baseline.range;
  if (spread === null || !Number.isFinite(spread) || spread <= 0) {
    return false;
  }
  return Math.abs(mean) < MIN_BASELINE_TO_SPREAD_RATIO * spread;
}

function computeKpiPercentDiffFromBaseline(current: KpiMetricValues, baseline: KpiMetricValues): KpiMetricValues {
  const percentDiff = buildEmptyKpiValues();
  // `mean` and `cv` both collapse when the baseline mean sits near zero: the first divides by it
  // directly, the second is stdev/|mean|. `range` and `annualisedTrend` never divide by the mean,
  // so they stay comparable and keep only the plain epsilon guard.
  const meanNearZero = isBaselineMeanNearZero(baseline);
  for (const key of KPI_KEYS) {
    const currentValue = current[key];
    const baselineValue = baseline[key];
    const dividesByMean = key === 'mean' || key === 'cv';
    percentDiff[key] =
      currentValue === null ||
      baselineValue === null ||
      Math.abs(baselineValue) < BASELINE_EPSILON ||
      (dividesByMean && meanNearZero)
        ? null
        : ((currentValue - baselineValue) / baselineValue) * 100;
  }
  return percentDiff;
}

function emptyIndicatorMetrics(): SensitivityIndicatorPointMetric[] {
  return POLICY_CORE_INDICATORS.map((indicator) => ({
    indicatorId: indicator.id,
    title: indicator.title,
    units: indicator.units,
    kpi: buildEmptyKpiValues(),
    deltaFromBaseline: buildEmptyKpiValues()
  }));
}

function aggregateMetricValues(seedMetrics: SensitivityIndicatorPointMetric[], indicatorId: string): KpiMetricValues {
  const aggregated = buildEmptyKpiValues();
  for (const key of KPI_KEYS) {
    const values = seedMetrics
      .filter((metric) => metric.indicatorId === indicatorId)
      .map((metric) => metric.kpi[key])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    aggregated[key] = values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  return aggregated;
}

function aggregateSeedMetrics(seedResults: SensitivitySeedRunResult[]): SensitivityIndicatorPointMetric[] {
  const successfulMetrics = seedResults
    .filter((seedResult) => seedResult.status === 'succeeded')
    .flatMap((seedResult) => seedResult.indicatorMetrics);

  if (successfulMetrics.length === 0) {
    return emptyIndicatorMetrics();
  }

  return POLICY_CORE_INDICATORS.map((indicator) => ({
    indicatorId: indicator.id,
    title: indicator.title,
    units: indicator.units,
    kpi: aggregateMetricValues(successfulMetrics, indicator.id),
    deltaFromBaseline: buildEmptyKpiValues()
  }));
}

function pointStatusFromSeeds(seedResults: SensitivitySeedRunResult[]): SensitivityPointResult['status'] {
  if (seedResults.some((seedResult) => seedResult.status === 'canceled')) {
    return 'canceled';
  }
  if (seedResults.some((seedResult) => seedResult.status === 'failed')) {
    return 'failed';
  }
  return 'succeeded';
}

function buildPointResult(
  record: ExperimentRecord,
  point: SensitivitySamplePoint,
  seedResults: SensitivitySeedRunResult[]
): SensitivityPointResult {
  const status = pointStatusFromSeeds(seedResults);
  const failedSeedErrors = seedResults
    .filter((seedResult) => seedResult.error)
    .map((seedResult) => `seed ${seedResult.seed}: ${seedResult.error as string}`);

  return {
    pointId: point.pointId,
    value: point.value,
    label: point.label,
    valuesByKey: point.valuesByKey,
    slotLabels: [...point.slotLabels],
    isBaseline: point.isBaseline,
    status,
    runId: `${record.metadata.experimentId}-${point.pointId}`,
    outputPath: null,
    error: failedSeedErrors.length > 0 ? failedSeedErrors.join('; ').slice(-2_000) : undefined,
    indicatorMetrics: aggregateSeedMetrics(seedResults),
    seedResults
  };
}

async function runSeed(
  pathsInput: RuntimePathInput,
  record: ExperimentRecord,
  point: SensitivitySamplePoint,
  seed: number,
  workerIndex: number
): Promise<SensitivitySeedRunResult> {
  const paths = resolveRuntimePaths(pathsInput);
  const metadata = record.metadata;
  const baselineDirPath = path.join(paths.dataRoot, metadata.baseline);
  const baselineConfigPath = path.join(baselineDirPath, 'config.properties');
  const seedLabel = `seed-${seed}`;
  const seedTempRoot = path.join(paths.tempRoot, TMP_EXPERIMENT_RUNS_DIR, metadata.experimentId, point.pointId, seedLabel);
  const configPath = path.join(seedTempRoot, 'config.properties');

  const outputPath = path.join(seedTempRoot, 'output');

  fs.rmSync(seedTempRoot, { recursive: true, force: true });

  const parameterKeys = getSelectedParameterKeys(metadata.parameter);
  const pointValuesByKey = getPointValuesByKey(point, parameterKeys);
  const overrides = new Map(record.normalizedGeneralOverrides);
  const basePolicyValues = getBasePolicyOption(metadata.basePolicy ?? getDefaultBasePolicyId(metadata.baseline)).values;
  for (const [key, value] of Object.entries(basePolicyValues)) {
    overrides.set(key, String(value));
  }
  for (const [key, value] of Object.entries(pointValuesByKey)) {
    const overrideValue = metadata.parameter.type === 'integer' ? String(Math.round(value)) : String(value);
    overrides.set(key, overrideValue);
  }
  overrides.set('SEED', String(seed));
  overrides.set('N_SIMS', '1');

  rewriteConfigForRun(
    baselineConfigPath,
    baselineDirPath,
    configPath,
    overrides
  );
  const generatedConfigHash = hashFile(configPath);
  const configSeed = readConfigSeed(configPath);
  const nSteps = readConfigPositiveInteger(configPath, 'N_STEPS');

  fs.mkdirSync(outputPath, { recursive: true });

  const runId = `${metadata.experimentId}-${point.pointId}-${seedLabel}`;
  const currentTaskId = taskId(point, seed);
  startProgressTask(record, point, seed, workerIndex, nSteps);
  appendLifecycle(
    record,
    `Worker ${workerIndex}/${record.progress.totalWorkers} started point ${point.label} (${point.pointId}) ${seedLabel} with ${
      metadata.parameter.title
    }=${formatPointValues(
      point,
      parameterKeys
    )}; ${formatProgressBrief(createProgressSnapshot(record))}`
  );

  const executionResult = await runSeededModelProcess({
    paths,
    owner: record,
    configPath,
    outputPath,
    taskId: currentTaskId,
    status: () => record.metadata.status,
    rawLogSink: (streamName, line) => emitRawLogLine(record, streamName, line)
  });

  finishProgressTask(record, currentTaskId, executionResult.status);
  let indicatorMetrics: SensitivityIndicatorPointMetric[] = emptyIndicatorMetrics();

  if (executionResult.status === 'succeeded') {
    indicatorMetrics = getPointIndicatorKpis(outputPath);
  }

  const outputHash = hashDirectory(outputPath);
  const result: SensitivitySeedRunResult = {
    seed,
    status: executionResult.status,
    runId,
    outputPath: null,
    error: executionResult.error,
    indicatorMetrics
  };

  appendLifecycle(
    record,
    `Worker ${workerIndex}/${record.progress.totalWorkers} finished point ${point.label} (${point.pointId}) ${seedLabel} with status ${result.status}; ${formatProgressBrief(
      createProgressSnapshot(record)
    )}${
      result.error ? `: ${result.error}` : ''
    }`
  );

  record.manifestPoints.push({
    pointId: point.pointId,
    value: point.value,
    label: point.label,
    valuesByKey: pointValuesByKey,
    isBaseline: point.isBaseline,
    status: result.status,
    runId,
    outputPath: result.outputPath,
    generatedConfigHash,
    seed: configSeed,
    overriddenParameters: {
      ...(metadata.generalOverrides ?? {}),
      ...basePolicyValues,
      ...pointValuesByKey,
      SEED: seed,
      N_SIMS: 1
    },
    outputHash
  });

  fs.rmSync(outputPath, { recursive: true, force: true });
  fs.rmSync(seedTempRoot, { recursive: true, force: true });

  return result;
}

function addDeltaAgainstBaseline(results: SensitivityExperimentResultsPayload): void {
  const baselinePoint = results.points.find((point) => point.isBaseline && point.status === 'succeeded') ?? null;
  results.baselinePointId = baselinePoint?.pointId ?? null;
  if (!baselinePoint) {
    for (const point of results.points) {
      point.indicatorMetrics = point.indicatorMetrics.map((metric) => ({
        ...metric,
        deltaFromBaseline: buildEmptyKpiValues()
      }));
    }
    return;
  }

  const baselineByIndicator = new Map(
    baselinePoint.indicatorMetrics.map((metric) => [metric.indicatorId, metric.kpi])
  );

  for (const point of results.points) {
    point.indicatorMetrics = point.indicatorMetrics.map((metric) => {
      const baselineKpi = baselineByIndicator.get(metric.indicatorId);
      if (!baselineKpi) {
        return { ...metric, deltaFromBaseline: buildEmptyKpiValues() };
      }

      return {
        ...metric,
        deltaFromBaseline: computeKpiPercentDiffFromBaseline(metric.kpi, baselineKpi)
      };
    });
  }
}

function pointSortValue(point: SensitivityPointResult): number {
  if (point.value !== null) {
    return point.value;
  }
  return commonPointValue(point.valuesByKey ?? {}) ?? Number.NEGATIVE_INFINITY;
}

function buildChartsFromResults(
  experimentId: string,
  parameter: SensitivityExperimentMetadata['parameter'],
  results: SensitivityExperimentResultsPayload
): SensitivityExperimentChartsPayload {
  const nonBaselinePoints = results.points.filter((point) => !point.isBaseline && point.status === 'succeeded');
  const succeededPointsSorted = [...results.points]
    .filter((point) => point.status === 'succeeded')
    .sort((left, right) => pointSortValue(left) - pointSortValue(right));

  const tornado: SensitivityTornadoBar[] = POLICY_CORE_INDICATORS.map((indicator) => {
    const maxAbsDeltaByKpi = buildEmptyKpiValues();

    for (const key of KPI_KEYS) {
      let maxAbs: number | null = null;
      for (const point of nonBaselinePoints) {
        const metric = point.indicatorMetrics.find((item) => item.indicatorId === indicator.id);
        if (!metric) {
          continue;
        }
        const delta = metric.deltaFromBaseline[key];
        if (delta === null) {
          continue;
        }

        const absValue = Math.abs(delta);
        if (maxAbs === null || absValue > maxAbs) {
          maxAbs = absValue;
        }
      }
      maxAbsDeltaByKpi[key] = maxAbs;
    }

    return {
      indicatorId: indicator.id,
      title: indicator.title,
      units: indicator.units,
      maxAbsDeltaByKpi
    };
  });

  const deltaTrend: SensitivityDeltaTrendSeries[] = POLICY_CORE_INDICATORS.map((indicator) => ({
    indicatorId: indicator.id,
    title: indicator.title,
    units: indicator.units,
    points: succeededPointsSorted
      .filter((point) => point.value !== null)
      .map((point) => {
        const metric = point.indicatorMetrics.find((item) => item.indicatorId === indicator.id);
        return {
          parameterValue: point.value,
          deltaByKpi: metric?.deltaFromBaseline ?? buildEmptyKpiValues()
        };
      })
  }));

  return {
    experimentId,
    parameter,
    windowType: SENSITIVITY_RESULTS_WINDOW_TYPE,
    tornado,
    deltaTrend
  };
}

async function runExperiment(pathsInput: RuntimePathInput, record: ExperimentRecord): Promise<void> {
  const paths = resolveRuntimePaths(pathsInput);
  const state = getRepoState(paths);
  const { metadata } = record;

  if (metadata.status === 'canceled' || record.cancelRequested) {
    appendLifecycle(record, `Experiment ${metadata.experimentId} did not start because it was canceled while queued`);
    return;
  }

  metadata.status = 'running';
  metadata.startedAt = new Date().toISOString();
  updateProgressStarted(record);
  writeMetadata(paths, metadata);
  writeManifest(paths, record);
  state.activeExperimentId = metadata.experimentId;
  appendLifecycle(
    record,
    `Experiment ${metadata.experimentId} running with ${record.progress.totalRuns} runs across ${record.progress.totalWorkers} workers; ${formatProgressBrief(
      createProgressSnapshot(record)
    )}`
  );

  const seeds = metadata.seeds ?? buildSeeds(metadata.seedsPerPoint ?? 1);
  const maxWorkers = Math.max(1, metadata.maxWorkers ?? defaultWorkerCount(metadata.sampledPoints.length * seeds.length));
  const pointResultsById = new Map<string, SensitivityPointResult>();
  const seedResultsByPointId = new Map<string, SensitivitySeedRunResult[]>();

  const persistProgress = () => {
    const pointResults = metadata.sampledPoints
      .map((point) => pointResultsById.get(point.pointId))
      .filter((point): point is SensitivityPointResult => Boolean(point));
    record.results = {
      experimentId: metadata.experimentId,
      baselinePointId: null,
      points: pointResults
    };
    addDeltaAgainstBaseline(record.results);
    record.charts = buildChartsFromResults(metadata.experimentId, metadata.parameter, record.results);
    writeSummary(paths, metadata.experimentId, record.results, record.charts);
    writeManifest(paths, record);
  };

  const updatePointResult = (point: SensitivitySamplePoint, seedResult: SensitivitySeedRunResult) => {
    const seedResults = seedResultsByPointId.get(point.pointId) ?? [];
    seedResults.push(seedResult);
    seedResults.sort((left, right) => left.seed - right.seed);
    seedResultsByPointId.set(point.pointId, seedResults);
    pointResultsById.set(point.pointId, buildPointResult(record, point, seedResults));
    persistProgress();
  };

  try {
    record.launcher.prepare?.({ repoRoot: paths.repoRoot });

    const tasks = metadata.sampledPoints.flatMap((point) => seeds.map((seed) => ({ point, seed })));
    await runSeededWorkerPool({
      tasks,
      maxWorkers,
      isCancelRequested: () => record.cancelRequested,
      runTask: (task, workerIndex) => runSeed(paths, record, task.point, task.seed, workerIndex),
      onResult: (task, seedResult) => updatePointResult(task.point, seedResult),
      shouldStopOnResult: (seedResult) => seedResult.status === 'failed' || seedResult.status === 'canceled'
    });

    const pointResults = [...pointResultsById.values()];
    const failedPoint = pointResults.find((pointResult) => pointResult.status === 'failed');
    const canceledPoint = pointResults.find((pointResult) => pointResult.status === 'canceled');

    if (failedPoint) {
      metadata.status = 'failed';
      metadata.failureReason = failedPoint.error ?? 'point_execution_failed';
      appendLifecycle(record, `Experiment failed at point ${failedPoint.pointId}`);
    } else if (record.cancelRequested || canceledPoint) {
      metadata.status = 'canceled';
      metadata.canceledByUser = true;
      appendLifecycle(record, canceledPoint ? `Experiment canceled during point ${canceledPoint.pointId}` : 'Experiment canceled');
    }

    if (metadata.status === 'running') {
      metadata.status = 'succeeded';
    }
  } catch (error) {
    metadata.status = 'failed';
    metadata.failureReason = (error as Error).message;
    appendLifecycle(record, `Experiment failed: ${metadata.failureReason}`);
  } finally {
    metadata.endedAt = new Date().toISOString();
    updateSeededProgressEnded(record, metadata.status, metadata.endedAt);
    writeMetadata(paths, metadata);
    writeSummary(paths, metadata.experimentId, record.results, record.charts);
    writeManifest(paths, record);
    state.activeExperimentId = null;
    record.activeProcesses.clear();
    if (record.killTimer) {
      clearTimeout(record.killTimer);
      record.killTimer = undefined;
    }
    publishProgress(record, true);
    appendLifecycle(
      record,
      `Experiment ${metadata.experimentId} ended with status ${metadata.status}; ${formatProgressBrief(createProgressSnapshot(record))}`
    );
  }
}

export function hasActiveSensitivityExperiment(pathsInput: RuntimePathInput): boolean {
  ensureLoaded(pathsInput);
  const state = getRepoState(pathsInput);
  if (!state.activeExperimentId) {
    return false;
  }

  const record = state.experimentsById.get(state.activeExperimentId);
  return Boolean(record && !isTerminal(record.metadata.status));
}

export function getActiveSensitivityExperimentId(pathsInput: RuntimePathInput): string | null {
  ensureLoaded(pathsInput);
  const state = getRepoState(pathsInput);
  return state.activeExperimentId;
}

export function listSensitivityExperiments(pathsInput: RuntimePathInput): SensitivityExperimentListPayload {
  ensureLoaded(pathsInput);
  const state = getRepoState(pathsInput);
  const experiments = [...state.order]
    .reverse()
    .map((id) => state.experimentsById.get(id))
    .filter((item): item is ExperimentRecord => Boolean(item))
    .map((item) => asSummary(item.metadata));
  return { experiments };
}

export function getSensitivityExperiment(pathsInput: RuntimePathInput, experimentId: string): SensitivityExperimentDetailPayload {
  ensureLoaded(pathsInput);
  const state = getRepoState(pathsInput);
  const record = state.experimentsById.get(experimentId.trim());
  if (!record) {
    throw new Error(`Unknown sensitivity experiment: ${experimentId}`);
  }
  return { experiment: record.metadata };
}

export function deleteSensitivityExperiment(
  pathsInput: RuntimePathInput,
  experimentId: string
): SensitivityExperimentDeleteResponse {
  ensureLoaded(pathsInput);
  const state = getRepoState(pathsInput);
  const normalized = experimentId.trim();
  if (!normalized) {
    throw new Error('experimentId is required.');
  }

  const record = state.experimentsById.get(normalized);
  if (!record) {
    throw new Error(`Unknown sensitivity experiment: ${experimentId}`);
  }

  if (!isTerminal(record.metadata.status)) {
    throw new Error('Only finished sensitivity experiments can be deleted.');
  }

  const outputDir = getExperimentOutputDir(record.runtimePaths, normalized);
  fs.rmSync(outputDir, { recursive: true, force: true });
  state.experimentsById.delete(normalized);
  const orderIndex = state.order.indexOf(normalized);
  if (orderIndex >= 0) {
    state.order.splice(orderIndex, 1);
  }

  return {
    experimentId: normalized,
    deleted: true
  };
}

export function getSensitivityExperimentResults(
  pathsInput: RuntimePathInput,
  experimentId: string
): SensitivityExperimentResultsPayload {
  ensureLoaded(pathsInput);
  const state = getRepoState(pathsInput);
  const record = state.experimentsById.get(experimentId.trim());
  if (!record) {
    throw new Error(`Unknown sensitivity experiment: ${experimentId}`);
  }
  return record.results;
}

export function getSensitivityExperimentCharts(
  pathsInput: RuntimePathInput,
  experimentId: string
): SensitivityExperimentChartsPayload {
  ensureLoaded(pathsInput);
  const state = getRepoState(pathsInput);
  const record = state.experimentsById.get(experimentId.trim());
  if (!record) {
    throw new Error(`Unknown sensitivity experiment: ${experimentId}`);
  }
  return record.charts;
}

export function getSensitivityExperimentLogs(
  pathsInput: RuntimePathInput,
  experimentId: string,
  cursor: number | undefined,
  limit: number | undefined
): SensitivityExperimentLogsPayload {
  ensureLoaded(pathsInput);
  const state = getRepoState(pathsInput);
  const record = state.experimentsById.get(experimentId.trim());
  if (!record) {
    throw new Error(`Unknown sensitivity experiment: ${experimentId}`);
  }

  const slice = readLogSlice(record.logBuffer, cursor, limit);
  return {
    experimentId: record.metadata.experimentId,
    cursor: slice.cursor,
    nextCursor: slice.nextCursor,
    lines: slice.lines,
    hasMore: slice.hasMore,
    done: isTerminal(record.metadata.status) && !slice.hasMore,
    truncated: slice.truncated,
    progress: createProgressSnapshot(record)
  };
}

export function submitSensitivityExperiment(
  pathsInput: RuntimePathInput,
  payload: SensitivityExperimentCreateRequest,
  options: SubmitSensitivityExperimentOptions = {}
): SensitivityExperimentSubmitResponse {
  const paths = resolveRuntimePaths(pathsInput);
  ensureLoaded(paths);
  const state = getRepoState(paths);
  const launcher = resolveSensitivityLauncher(options.launcher);

  if (state.activeExperimentId) {
    const active = state.experimentsById.get(state.activeExperimentId);
    if (active && !isTerminal(active.metadata.status)) {
      throw new Error(`Sensitivity experiment already in progress: ${active.metadata.experimentId}`);
    }
  }

  if (hasActiveManualModelRuns()) {
    throw new Error('Cannot start sensitivity experiment while manual model runs are queued or running.');
  }

  if (Object.prototype.hasOwnProperty.call(payload as unknown as Record<string, unknown>, 'retainFullOutput')) {
    throw new Error('retainFullOutput is no longer supported for sensitivity experiments; use record settings instead.');
  }

  const now = options.now ?? new Date();
  const preparedResult = prepareSensitivityExperimentSubmission(paths, payload, {
    now,
    forcedExperimentId: options.forcedExperimentId
  });
  if (!preparedResult.accepted) {
    return preparedResult;
  }
  const {
    experimentId,
    title,
    baseline,
    basePolicy,
    policyPackage,
    min,
    max,
    baselineValue,
    baselineValuesByKey,
    sampleCount,
    samplePoints,
    collapsedSlots,
    normalizedGeneralOverrides,
    generalOverrides,
    seeds,
    maxWorkers,
    warnings,
    warningSummary
  } = preparedResult.prepared;

  const metadata: SensitivityExperimentMetadata = {
    experimentId,
    title,
    baseline,
    basePolicy,
    status: 'queued',
    createdAt: now.toISOString(),
    seedsPerPoint: seeds.length,
    seeds,
    maxWorkers,
    generalOverrides,
    parameter: {
      key: policyPackage.parameterKeys.length === 1 ? policyPackage.parameterKeys[0] : policyPackage.id,
      packageId: policyPackage.id,
      parameterKeys: [...policyPackage.parameterKeys],
      title: policyPackage.title,
      description: policyPackage.description,
      type: policyPackage.type,
      baselineValue,
      baselineValuesByKey,
      min,
      max,
      sampleCount
    },
    warnings,
    warningSummary,
    sampledPoints: samplePoints,
    collapsedSlots,
    runCommand: toRunCommandMetadata(launcher)
  };

  const record: ExperimentRecord = {
    runtimePaths: paths,
    metadata,
    results: emptyResults(experimentId),
    charts: emptyCharts(experimentId, metadata.parameter),
    logBuffer: createLogBuffer(options.logSink ? (line) => options.logSink?.(`[sensitivity:${experimentId}] ${line}`) : undefined),
    progress: createProgressState(metadata),
    rawLogSink: options.rawLogSink ?? options.logSink,
    progressSink: options.progressSink,
    lastProgressSinkAtMs: 0,
    launcher,
    manifestPoints: [],
    normalizedGeneralOverrides,
    activeProcesses: new Set(),
    cancelRequested: false
  };

  appendLifecycle(record, `Experiment ${experimentId} queued`);
  publishProgress(record, true);

  writeMetadata(paths, metadata);
  writeSummary(paths, experimentId, record.results, record.charts);
  writeManifest(paths, record);

  state.experimentsById.set(experimentId, record);
  state.order.push(experimentId);
  state.activeExperimentId = experimentId;

  queueMicrotask(() => {
    void runExperiment(paths, record);
  });

  return {
    accepted: true,
    warnings,
    warningSummary,
    experiment: asSummary(metadata)
  };
}

export function cancelSensitivityExperiment(
  pathsInput: RuntimePathInput,
  experimentId: string
): SensitivityExperimentDetailPayload {
  ensureLoaded(pathsInput);
  const state = getRepoState(pathsInput);
  const normalized = experimentId.trim();
  if (!normalized) {
    throw new Error('experimentId is required.');
  }

  const record = state.experimentsById.get(normalized);
  if (!record) {
    throw new Error(`Unknown sensitivity experiment: ${experimentId}`);
  }

  if (isTerminal(record.metadata.status)) {
    return { experiment: record.metadata };
  }

  record.cancelRequested = true;
  record.metadata.canceledByUser = true;
  appendLifecycle(record, `Cancel requested for experiment ${record.metadata.experimentId}`);
  publishProgress(record, true);

  if (record.metadata.status === 'queued') {
    record.metadata.status = 'canceled';
    record.metadata.endedAt = new Date().toISOString();
    const endedAtMs = Date.parse(record.metadata.endedAt);
    record.progress.endedAtMs = Number.isFinite(endedAtMs) ? endedAtMs : Date.now();
    writeMetadata(record.runtimePaths, record.metadata);
    writeManifest(record.runtimePaths, record);
    if (state.activeExperimentId === normalized) {
      state.activeExperimentId = null;
    }
    appendLifecycle(record, `Experiment ${record.metadata.experimentId} canceled before start`);
    publishProgress(record, true);
    return { experiment: record.metadata };
  }

  if (record.activeProcesses.size > 0) {
    let deliveredCount = 0;
    for (const process of record.activeProcesses) {
      if (process.kill('SIGTERM')) {
        deliveredCount += 1;
      }
    }
    if (deliveredCount > 0) {
      record.killTimer = setTimeout(() => {
        if (record.activeProcesses.size > 0 && !isTerminal(record.metadata.status)) {
          appendLifecycle(record, `SIGTERM timeout hit for ${record.metadata.experimentId}; sending SIGKILL`);
          for (const process of record.activeProcesses) {
            process.kill('SIGKILL');
          }
        }
      }, CANCEL_KILL_TIMEOUT_MS);
    }
    if (deliveredCount < record.activeProcesses.size) {
      appendLifecycle(record, 'SIGTERM could not be delivered to every active process; waiting for process close');
    }
  }

  return { experiment: record.metadata };
}

export function __setSensitivityRunSpawnForTests(spawnFn: SpawnModelRunFn | null): void {
  sensitivityLauncherOverrideForTests = spawnFn ? createSpawnFunctionLauncher(spawnFn) : null;
}

export function shutdownSensitivityRunProcesses(): void {
  const now = new Date().toISOString();
  for (const state of repoStates.values()) {
    for (const record of state.experimentsById.values()) {
      if (record.killTimer) {
        clearTimeout(record.killTimer);
        record.killTimer = undefined;
      }
      if (record.activeProcesses.size > 0 && !isTerminal(record.metadata.status)) {
        record.cancelRequested = true;
        record.metadata.status = 'canceled';
        record.metadata.canceledByUser = true;
        record.metadata.endedAt = now;
        for (const process of record.activeProcesses) {
          process.kill('SIGKILL');
        }
        record.activeProcesses.clear();
      }
    }
  }
}

export function __resetSensitivityRunsForTests(): void {
  shutdownSensitivityRunProcesses();
  repoStates.clear();
  __setSensitivityRunSpawnForTests(null);
}
