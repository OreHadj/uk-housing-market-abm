export type VersionId = string;

export type ParameterGroup =
  | 'Household Demographics & Wealth'
  | 'Government & Tax'
  | 'Housing & Rental Market'
  | 'Purchase & Mortgage'
  | 'Bank & Credit Policy'
  | 'BTL & Investor Behavior';

export type ParameterFormat =
  | 'scalar'
  | 'scalar_pair'
  | 'binned_distribution'
  | 'joint_distribution'
  | 'lognormal_pair'
  | 'power_law_pair'
  | 'gaussian_pair'
  | 'hpa_expectation_line'
  | 'buy_quad';

export type DerivedScalarExpression = 'btl_mixed_probability';

export interface DerivedScalarMeta {
  key: string;
  expression: DerivedScalarExpression;
  sourceConfigKeys: string[];
}

export interface ParameterCardMeta {
  id: string;
  title: string;
  group: ParameterGroup;
  format: ParameterFormat;
  configKeys: string[];
  dataFileConfigKeys?: string[];
  derivedScalars?: DerivedScalarMeta[];
  explanation: string;
}

export interface DataSourceInfo {
  configPathLeft: string;
  configPathRight: string;
  configKeys: string[];
  dataFilesLeft: string[];
  dataFilesRight: string[];
  datasetsLeft: DatasetAttribution[];
  datasetsRight: DatasetAttribution[];
}

export type ValidationStatus = 'complete' | 'in_progress';

export interface MethodVariationNote {
  configParameters: string[];
  improvementSummary: string;
  whyChanged: string;
  methodChosen?: string;
  decisionLogic?: string;
}

export interface ParameterChange {
  configParameter: string;
  datasetSource: string | null;
}

export interface DatasetAttribution {
  tag: string;
  fullName: string;
  year: string;
  edition?: string;
  evidence?: string;
}

export interface VersionChangeOrigin {
  versionId: string;
  description: string;
  updatedDataSources: string[];
  calibrationFiles: string[];
  configParameters: string[];
  parameterChanges: ParameterChange[];
  validationStatus: ValidationStatus;
  methodVariations: MethodVariationNote[];
}

export interface DeltaStat {
  absolute: number;
  percent: number | null;
}

export interface ScalarDatum {
  key: string;
  left: number;
  right: number;
  delta: DeltaStat;
}

export interface BinnedDatum {
  label: string;
  lower: number;
  upper: number;
  left: number;
  right: number;
  delta: number;
}

export interface BinnedSourceDatum {
  label: string;
  lower: number;
  upper: number;
  value: number;
  density: number;
}

export type AxisScaleType = 'linear' | 'log';

export interface AxisMeta {
  edges: number[];
  labels: string[];
  scaleType: AxisScaleType;
}

export interface JointCell {
  xIndex: number;
  yIndex: number;
  value: number;
}

export interface JointPayload {
  xAxis: AxisMeta;
  yAxis: AxisMeta;
  left: JointCell[];
  right: JointCell[];
  delta: JointCell[];
}

export interface CurvePoint {
  x: number;
  y: number;
}

export type VisualPayload =
  | { type: 'scalar'; values: ScalarDatum[] }
  | { type: 'binned_distribution'; bins: BinnedDatum[]; sourceBins?: { left: BinnedSourceDatum[]; right: BinnedSourceDatum[] } }
  | { type: 'joint_distribution'; matrix: JointPayload }
  | {
      type: 'lognormal_pair';
      parameters: ScalarDatum[];
      curveLeft: CurvePoint[];
      curveRight: CurvePoint[];
      median: {
        left: number;
        right: number;
        delta: DeltaStat;
      };
      domain: { min: number; max: number };
    }
  | {
      type: 'power_law_pair';
      parameters: ScalarDatum[];
      curveLeft: CurvePoint[];
      curveRight: CurvePoint[];
      domain: { min: number; max: number };
    }
  | {
      type: 'gaussian_pair';
      parameters: ScalarDatum[];
      logCurveLeft: CurvePoint[];
      logCurveRight: CurvePoint[];
      percentCurveLeft: CurvePoint[];
      percentCurveRight: CurvePoint[];
      logDomain: { min: number; max: number };
      percentDomain: { min: number; max: number };
      percentCap: number;
      percentCapMassLeft: number;
      percentCapMassRight: number;
      logMedian: {
        left: number;
        right: number;
        delta: DeltaStat;
      };
      percentMedian: {
        left: number;
        right: number;
        delta: DeltaStat;
      };
    }
  | {
      type: 'hpa_expectation_line';
      parameters: ScalarDatum[];
      curveLeft: CurvePoint[];
      curveRight: CurvePoint[];
      domain: { min: number; max: number };
      dt: number;
    }
  | {
      type: 'buy_quad';
      parameters: ScalarDatum[];
      budgetLeft: CurvePoint[];
      budgetRight: CurvePoint[];
      multiplierLeft: CurvePoint[];
      multiplierRight: CurvePoint[];
      medianMultiplier: {
        left: number;
        right: number;
        delta: DeltaStat;
      };
      expectedMultiplier: {
        left: number;
        right: number;
        delta: DeltaStat;
      };
      domain: { min: number; max: number };
    };

export interface CompareResult {
  id: string;
  title: string;
  group: ParameterGroup;
  format: ParameterFormat;
  unchanged: boolean;
  sourceInfo: DataSourceInfo;
  explanation: string;
  leftVersion: VersionId;
  rightVersion: VersionId;
  changeOriginsInRange: VersionChangeOrigin[];
  visualPayload: VisualPayload;
}

export interface CompareResponse {
  left: VersionId;
  right: VersionId;
  items: CompareResult[];
}

export interface HomePreviewItem {
  id: string;
  title: string;
  rightVersion: VersionId;
  visualPayload: VisualPayload;
}

export type ValidationMetricStatus = 'pass' | 'warn' | 'fail' | 'unsupported';
export type ValidationMetricRequirement = 'required' | 'diagnostic';
export type ValidationMetricMappingStatus = 'exact_match' | 'derived_match' | 'unsupported';
export type ValidationLossFamily =
  | 'positive_level'
  | 'signed_additive'
  | 'bounded_low_is_better'
  | 'bounded_share'
  | 'diagnostic';
export type ValidationLossScaleBasis =
  | 'source_value'
  | 'target_band_midpoint'
  | 'target_band_upper'
  | 'target_band_lower_abs'
  | 'target_band_upper_abs'
  | 'target_band_half_width'
  | 'target_band_width'
  | 'bounded_share_domain_width'
  | 'metric_floor'
  | 'not_applicable';

export interface ValidationReferenceLine {
  version: string;
  label: string;
  description: string | null;
  overallCompositeLoss: number;
  validationTargetYear: number;
}

export interface ValidationTargetBand {
  lower: number;
  upper: number;
}

export interface ValidationSourceReference {
  label: string;
  sourceDocumentPath: string;
  sourceTextPath: string | null;
  sourceTable: string | null;
  sourcePage: number | null;
  sourceIndicatorLabel: string | null;
  rawSourceValue: number | null;
  sourceAsOf: string | null;
  sourceUnits: string | null;
  notes: string | null;
}

export interface ValidationMetricSummary {
  metricId: string;
  label: string;
  status: ValidationMetricStatus;
  requirement: ValidationMetricRequirement;
  units: string;
  sourceLabel: string;
  sourceIndicatorLabel: string | null;
  sourceDocumentPath: string | null;
  sourceTextPath: string | null;
  sourceTable: string | null;
  sourcePage: number | null;
  rawSourceValue: number | null;
  sourceValue: number | null;
  sourceAsOf: string | null;
  sourceUnits: string | null;
  comparisonUnits: string | null;
  mappingStatus: ValidationMetricMappingStatus | null;
  bandMethod: string | null;
  bandNotes: string | null;
  sourceReferences: ValidationSourceReference[];
  targetBand: ValidationTargetBand | null;
  seedMean: number;
  p25: number;
  p75: number;
  insideRate: number | null;
  lossFamily: ValidationLossFamily | null;
  lossTransform: string | null;
  lossScale: number | null;
  lossScaleBasis: ValidationLossScaleBasis | null;
  additiveScale: number | null;
  additiveScaleBasis: ValidationLossScaleBasis | null;
  normalizedDistance: number | null;
  normalizedIqr: number | null;
  distanceComponent: number | null;
  spreadComponent: number | null;
  levelComponent: number | null;
  insideRateComponent: number | null;
  metricLoss: number | null;
  lossDeltaVsReference2011: number | null;
  lossDeltaPercentVsReference2011: number | null;
  metricWeight: number;
}

export interface ValidationVersionSummary {
  schemaVersion: number;
  version: string;
  generatedAt: string;
  validationTargetYear: number;
  referenceLine: ValidationReferenceLine | null;
  seeds: number[];
  window: {
    startIndex: number;
    endIndex: number;
  };
  overallCompositeLoss: number;
  metrics: ValidationMetricSummary[];
}

export interface ValidationCompositeTrendPoint {
  version: string;
  validationTargetYear: number;
  overallCompositeLoss: number;
}

export interface ValidationCompositeTrendPayload {
  points: ValidationCompositeTrendPoint[];
  referenceLine: ValidationReferenceLine | null;
  referencePoints: ValidationReferenceLine[];
}

/**
 * Compact per-metric projection used to rank and compare models without shipping every
 * version's full summary. Always scoped to one evidence year — mixing eras is meaningless.
 */
export interface ValidationMetricComparisonPoint {
  metricId: string;
  status: ValidationMetricStatus;
  metricLoss: number | null;
  seedMean: number;
  sourceValue: number | null;
}

export interface ValidationOverviewPayload {
  availableVersions: string[];
  selectedVersion: string;
  selectedValidationTargetYear: number;
  availableValidationTargetYearsByVersion: Record<string, number[]>;
  trend: ValidationCompositeTrendPayload;
  selectedSummary: ValidationVersionSummary;
  /** Keyed by version; only versions scored against `selectedValidationTargetYear` appear. */
  metricsByVersion: Record<string, ValidationMetricComparisonPoint[]>;
  /** Second model for compare mode. Null when none requested, or when it has no summary for this year. */
  comparisonSummary: ValidationVersionSummary | null;
}

export type ResultsRunStatus = 'complete' | 'partial' | 'invalid';

export type ResultsFileType =
  | 'output'
  | 'core_indicator'
  | 'transaction'
  | 'micro_snapshot'
  | 'config'
  | 'other';

export type ResultsCoverageStatus = 'supported' | 'empty' | 'unsupported' | 'error';

export type ResultsSeriesSource = 'core_indicator' | 'output';

export interface ResultsIndicatorMeta {
  id: string;
  title: string;
  units: string;
  description: string;
  source: ResultsSeriesSource;
}

export type KpiMetricKey = 'mean' | 'cv' | 'annualisedTrend' | 'range';
export type KpiMetricWindowType = 'post_500' | 'post_200' | 'tail_120' | 'full';
export type ResultsCompareWindow = 'post500' | 'post200' | 'tail120' | 'full';

export interface KpiMetricValues {
  mean: number | null;
  cv: number | null;
  annualisedTrend: number | null;
  range: number | null;
}

export interface KpiMetricSummary {
  indicatorId: string;
  title: string;
  units: string;
  windowType: KpiMetricWindowType;
  mean: number | null;
  cv: number | null;
  annualisedTrend: number | null;
  range: number | null;
}

export interface ResultsCoverageSummary {
  requiredCount: number;
  supportedCount: number;
  emptyCount: number;
  errorCount: number;
}

/** One Central Bank policy setting, as recorded in a completed run's config.properties. */
export interface ResultsPolicySetting {
  key: string;
  value: number;
}

export interface ResultsRunSummary {
  runId: string;
  /** Scenario name given when the run was created; null for runs with no readable manifest. */
  title: string | null;
  path: string;
  modifiedAt: string;
  createdAt: string;
  sizeBytes: number;
  fileCount: number;
  status: ResultsRunStatus;
  configAvailable: boolean;
  parseCoverage: ResultsCoverageSummary;
  /** Empty when the run predates policy recording, or its config could not be read. */
  policySettings: ResultsPolicySetting[];
}

export interface ResultsIndicatorAvailability extends ResultsIndicatorMeta {
  available: boolean;
  coverageStatus: ResultsCoverageStatus;
  note?: string;
}

export interface ResultsRunDetail extends ResultsRunSummary {
  indicators: ResultsIndicatorAvailability[];
  kpiSummary: KpiMetricSummary[];
}

export interface ResultsFileManifestEntry {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  modifiedAt: string;
  fileType: ResultsFileType;
  coverageStatus: ResultsCoverageStatus;
  note?: string;
}

export interface ResultsSeriesPoint {
  modelTime: number;
  value: number | null;
}

export interface ResultsSeriesPayload {
  runId: string;
  indicator: ResultsIndicatorMeta;
  smoothWindow: 0 | 3 | 12;
  points: ResultsSeriesPoint[];
}

export interface ResultsCompareSeries {
  runId: string;
  points: ResultsSeriesPoint[];
}

export interface ResultsCompareIndicator {
  indicator: ResultsIndicatorMeta;
  seriesByRun: ResultsCompareSeries[];
}

export interface ResultsCompareKpiSummary {
  runId: string;
  kpiSummary: KpiMetricSummary[];
}

export interface ResultsComparePayload {
  runIds: string[];
  indicatorIds: string[];
  smoothWindow: 0 | 3 | 12;
  window: ResultsCompareWindow;
  indicators: ResultsCompareIndicator[];
  kpiSummaryByRun: ResultsCompareKpiSummary[];
}

export interface ResultsStorageSummary {
  usedBytes: number;
  capBytes: number;
}

export interface AuthStatusPayload {
  authEnabled: boolean;
  canWrite: boolean;
  canDownloadResults: boolean;
  canDeleteResults: boolean;
  deleteKeyRequired: boolean;
  authMisconfigured: boolean;
  modelRunsEnabled: boolean;
  modelRunsConfigured: boolean;
  modelRunsDisabledReason: string | null;
  remoteExecution?: RemoteExecutionStatus;
}

export type ExperimentExecutionBackend = 'local_maven' | 'aws_ssm';

export interface RemoteExecutionStatus {
  backend: ExperimentExecutionBackend;
  configured: boolean;
  available: boolean;
  runnerInstanceId: string | null;
  runnerState: string | null;
  ssmPingStatus: string | null;
  runnerVCpus: number | null;
  reason: string | null;
  checkedAt: string;
}

export interface AuthLoginRequest {
  username: string;
  password: string;
}

export interface AuthLoginResponse {
  ok: boolean;
  token?: string;
  canWrite: boolean;
}

export interface AuthLogoutResponse {
  ok: boolean;
}

export type ModelRunSnapshotStatus = 'stable' | 'in_progress';
export type ModelRunParameterType = 'integer' | 'number' | 'boolean';
export type ModelRunParameterGroup = 'General model control' | 'Central Bank policy';
export type ModelRunJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
export type BasePolicyId = '2011' | '2024';

export interface ModelRunSnapshotOption {
  version: string;
  status: ModelRunSnapshotStatus;
  /**
   * Which era of real-world evidence this snapshot was scored against
   * (`w3` = 2011 Wave 3, `r8` = 2024 Round 8). Null when the history file has no entry.
   */
  evidenceYear: 2011 | 2024 | null;
  /**
   * True when the five unmeasurable behavioural parameters were fitted for this version
   * (the `o`-suffixed versions). False for input/data snapshots, which inherit them.
   */
  outputCalibrated: boolean;
}

export interface ModelRunParameterDefinition {
  key: string;
  title: string;
  description: string;
  group: ModelRunParameterGroup;
  type: ModelRunParameterType;
  defaultValue: number | boolean;
}

export interface BasePolicyOption {
  id: BasePolicyId;
  title: string;
  summary: string;
  values: Record<string, number>;
}

export interface SensitivityPolicyPackageDefinition {
  id: string;
  title: string;
  description: string;
  parameterKeys: string[];
  type: Extract<ModelRunParameterType, 'integer' | 'number'>;
}

export interface ModelRunWarning {
  code: string;
  message: string;
  severity: 'warning';
}

export interface ModelRunJob {
  jobId: string;
  runId: string;
  title?: string;
  baseline: string;
  status: ModelRunJobStatus;
  backend?: ExperimentExecutionBackend;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  seedsPerPoint?: number;
  seeds?: number[];
  maxWorkers?: number;
  outputPath: string;
  configPath: string;
  exitCode?: number | null;
  signal?: string | null;
}

export interface ModelRunOptionsPayload {
  executionEnabled: boolean;
  executionDisabledReason?: string | null;
  executionBackend?: ExperimentExecutionBackend;
  remoteExecution?: RemoteExecutionStatus;
  sensitivityMaxWorkersCap?: number;
  snapshots: ModelRunSnapshotOption[];
  defaultBaseline: string;
  requestedBaseline: string;
  parameters: ModelRunParameterDefinition[];
  basePolicies: BasePolicyOption[];
  defaultBasePolicy: BasePolicyId;
  sensitivityPolicyPackages: SensitivityPolicyPackageDefinition[];
}

export interface ModelRunSubmitRequest {
  baseline: string;
  basePolicy?: BasePolicyId;
  title?: string;
  overrides: Record<string, number | boolean>;
  maxWorkers?: number;
  confirmWarnings?: boolean;
}

export interface ModelRunSubmitResponse {
  accepted: boolean;
  warnings: ModelRunWarning[];
  job?: ModelRunJob;
}

export interface ModelRunJobsPayload {
  jobs: ModelRunJob[];
}

export interface ModelRunJobClearResponse {
  jobId: string;
  cleared: boolean;
}

export interface ModelRunJobLogsPayload {
  jobId: string;
  cursor: number;
  nextCursor: number;
  lines: string[];
  hasMore: boolean;
  done: boolean;
  truncated: boolean;
  progress?: ExperimentProgressSnapshot;
}

export interface ResultsRunDeleteResponse {
  runId: string;
  deleted: boolean;
}

export type SensitivityExperimentStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
export type SensitivitySampleSlot = string;

export interface SensitivitySamplePoint {
  pointId: string;
  value: number | null;
  label: string;
  valuesByKey?: Record<string, number>;
  slotLabels: SensitivitySampleSlot[];
  isBaseline: boolean;
}

export interface SensitivityExperimentParameterSelection {
  key: string;
  title: string;
  description: string;
  type: Extract<ModelRunParameterType, 'integer' | 'number'>;
  packageId?: string;
  parameterKeys?: string[];
  baselineValue: number | null;
  baselineValuesByKey?: Record<string, number>;
  min: number;
  max: number;
  sampleCount: number;
}

export interface SensitivityExperimentCreateRequest {
  baseline: string;
  basePolicy?: BasePolicyId;
  title?: string;
  parameterKey?: string;
  policyPackageId?: string;
  min: number;
  max: number;
  sampleCount?: number;
  overrides?: Record<string, number | boolean>;
  maxWorkers?: number;
  confirmWarnings?: boolean;
}

export interface SensitivityExperimentSummary {
  experimentId: string;
  title?: string;
  baseline: string;
  basePolicy?: BasePolicyId;
  status: SensitivityExperimentStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  seedsPerPoint?: number;
  seeds?: number[];
  maxWorkers?: number;
  generalOverrides?: Record<string, number | boolean>;
  parameter: SensitivityExperimentParameterSelection;
}

export interface SensitivityExperimentWarningSummary {
  byPoint: Record<string, string[]>;
}

export interface SensitivityExperimentMetadata extends SensitivityExperimentSummary {
  warnings: ModelRunWarning[];
  warningSummary: SensitivityExperimentWarningSummary;
  failureReason?: string;
  canceledByUser?: boolean;
  sampledPoints: SensitivitySamplePoint[];
  collapsedSlots: Record<SensitivitySampleSlot, string>;
  runCommand: {
    mode?: 'maven' | 'packaged';
    mavenBin?: string;
    javaExe?: string;
    modelJar?: string;
    commandTemplate: string;
  };
}

export interface SensitivityIndicatorPointMetric {
  indicatorId: string;
  title: string;
  units: string;
  kpi: KpiMetricValues;
  deltaFromBaseline: KpiMetricValues;
}

export interface SensitivitySeedRunResult {
  seed: number;
  status: 'succeeded' | 'failed' | 'canceled';
  runId: string;
  outputPath: string | null;
  error?: string;
  indicatorMetrics: SensitivityIndicatorPointMetric[];
}

export interface SensitivityPointResult extends SensitivitySamplePoint {
  status: 'succeeded' | 'failed' | 'canceled';
  runId: string;
  outputPath: string | null;
  error?: string;
  indicatorMetrics: SensitivityIndicatorPointMetric[];
  seedResults?: SensitivitySeedRunResult[];
}

export interface SensitivityTornadoBar {
  indicatorId: string;
  title: string;
  units: string;
  maxAbsDeltaByKpi: KpiMetricValues;
}

export interface SensitivityDeltaTrendPoint {
  parameterValue: number | null;
  deltaByKpi: KpiMetricValues;
}

export interface SensitivityDeltaTrendSeries {
  indicatorId: string;
  title: string;
  units: string;
  points: SensitivityDeltaTrendPoint[];
}

export interface SensitivityExperimentResultsPayload {
  experimentId: string;
  baselinePointId: string | null;
  points: SensitivityPointResult[];
}

export interface SensitivityExperimentChartsPayload {
  experimentId: string;
  parameter: SensitivityExperimentParameterSelection;
  windowType: 'tail_120' | 'post_200';
  tornado: SensitivityTornadoBar[];
  deltaTrend: SensitivityDeltaTrendSeries[];
}

export interface SensitivityExperimentDetailPayload {
  experiment: SensitivityExperimentMetadata;
}

export interface SensitivityExperimentDeleteResponse {
  experimentId: string;
  deleted: boolean;
}

export interface SensitivityExperimentListPayload {
  experiments: SensitivityExperimentSummary[];
}

export interface SensitivityExperimentSubmitResponse {
  accepted: boolean;
  warnings: ModelRunWarning[];
  warningSummary?: SensitivityExperimentWarningSummary;
  experiment?: SensitivityExperimentSummary;
}

export interface ExperimentProgressSnapshot {
  kind: ExperimentJobType;
  status: ExperimentJobStatus;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  canceledRuns: number;
  activeRuns: number;
  totalWorkers: number;
  activeWorkers: number;
  completedRunEquivalents: number;
  percentComplete: number;
  throughputRunsPerMinute: number | null;
  completedRunsPerMinute: number | null;
  etaSeconds: number | null;
  estimatedFinishAt: string | null;
  elapsedSeconds: number;
  startedAt?: string;
  endedAt?: string;
  updatedAt: string;
}

export interface SensitivityExperimentLogsPayload {
  experimentId: string;
  cursor: number;
  nextCursor: number;
  lines: string[];
  hasMore: boolean;
  done: boolean;
  truncated: boolean;
  progress?: ExperimentProgressSnapshot;
}

export type ExperimentJobType = 'manual' | 'sensitivity';
export type ExperimentJobStatus = ModelRunJobStatus | SensitivityExperimentStatus;

export interface ExperimentJobSummary {
  jobRef: string;
  type: ExperimentJobType;
  id: string;
  title: string;
  status: ExperimentJobStatus;
  backend?: ExperimentExecutionBackend;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  baseline?: string;
  runId?: string;
}

export interface ExperimentExecutionLocks {
  manualSubmissionLocked: boolean;
  sensitivitySubmissionLocked: boolean;
  activeManualJobRef: string | null;
  activeSensitivityJobRef: string | null;
}

export interface ExperimentJobsPayload {
  jobs: ExperimentJobSummary[];
  locks: ExperimentExecutionLocks;
}

export interface ExperimentJobLogsPayload {
  jobRef: string;
  type: ExperimentJobType;
  cursor: number;
  nextCursor: number;
  lines: string[];
  hasMore: boolean;
  done: boolean;
  truncated: boolean;
  progress?: ExperimentProgressSnapshot;
}

export interface ExperimentJobCancelResponse {
  job: ExperimentJobSummary;
}

export interface ExperimentJobDeleteResponse {
  jobRef: string;
  type: ExperimentJobType;
  id: string;
  runId?: string;
  deleted: boolean;
}
