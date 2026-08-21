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
  keyMetadata: ParameterKeyMetadata[];
}

export type ParameterDerivation =
  | 'empirically estimated'
  | 'postulated'
  | 'policy-set'
  | 'technical/user-set'
  | 'output-calibrated';

export interface ParameterKeyMetadata {
  key: string;
  label: string;
  unit: string;
  valueType: 'number' | 'distribution' | 'curve' | 'file';
  derivation: ParameterDerivation;
  description: string;
  sourceYear: string;
}

export interface CalibrationModelIdentity {
  version: string;
  name: string;
  dataVintage: string;
  fitVintage: string;
  method: string;
  inheritance: string | null;
}

export interface CalibrationParameterRecord {
  key: string;
  name: string;
  value: number;
  lower: number | null;
  upper: number | null;
  priorLower: number | null;
  priorUpper: number | null;
  meaning: string;
  calibrationReason: string;
  increaseEffect: string;
  decreaseEffect: string;
}

interface CalibrationCampaignBase {
  kind: 'refitted' | 'original' | 'inherited' | 'unavailable';
  evidenceYear: number | null;
  provenance: string[];
}

export interface RefittedCalibrationCampaign extends CalibrationCampaignBase {
  kind: 'refitted';
  evidenceYear: number;
  startingVersion: string;
  method: string;
  tunedParameterCount: number;
  targetOutcomeCount: number;
  objective: string | null;
  targetGroups: { name: string; indicators: string[]; count: number }[];
  baselineLoss: number;
  selectedLoss: number;
  absoluteImprovement: number;
  passedChecks: boolean;
  selected: boolean;
  guardrail: string | null;
  seeds: number[] | null;
  simulationSteps: number | null;
  analysisWindow: { start: number; end: number } | null;
  optimisationSettings: string[];
  artifactPath: string;
}

export interface OriginalCalibrationCampaign extends CalibrationCampaignBase {
  kind: 'original';
  method: string;
  status: 'Original published configuration';
}

export interface InheritedCalibrationCampaign extends CalibrationCampaignBase {
  kind: 'inherited';
  sourceVersion: string;
  parametersUnchanged: true;
}

export interface UnavailableCalibrationCampaign extends CalibrationCampaignBase {
  kind: 'unavailable';
}

export type CalibrationCampaign =
  | RefittedCalibrationCampaign
  | OriginalCalibrationCampaign
  | InheritedCalibrationCampaign
  | UnavailableCalibrationCampaign;

export interface CalibrationModelOverview {
  identity: CalibrationModelIdentity;
  campaign: CalibrationCampaign;
  parameters: CalibrationParameterRecord[];
}

export interface CalibrationOverviewResponse {
  primary: CalibrationModelOverview;
  comparison: CalibrationModelOverview | null;
  sameEvidenceProfile: boolean;
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

/**
 * New-lending distributions, derived from a completed run's SaleTransactions-run1.csv.
 *
 * The aggregate indicators above report monthly means; these report the shape of the
 * loan-level distribution behind them, which is what a flow limit actually acts on.
 */

export type LendingBorrowerType = 'FTB' | 'HM' | 'BTL';

export type LendingMetricId = 'ltv' | 'lti' | 'dsti' | 'priceToIncome' | 'buyerAge';

export type LendingUnavailableReason =
  | 'no_transaction_file'
  | 'recording_disabled'
  | 'empty_file'
  | 'parse_error'
  | 'no_rows_in_window';

export interface LendingHistogramBin {
  lowerEdge: number;
  upperEdge: number;
  count: number;
  /** Share of its own borrower-type series, in percent. */
  share: number;
}

export interface LendingHistogramSeries {
  borrowerType: LendingBorrowerType;
  count: number;
  /** Rows above the top edge, folded into the last bin. */
  overflowCount: number;
  bins: LendingHistogramBin[];
}

export interface LendingHistogram {
  metric: LendingMetricId;
  title: string;
  units: string;
  binWidth: number;
  lowerEdge: number;
  upperEdge: number;
  seriesByBorrowerType: LendingHistogramSeries[];
}

export interface LendingBand {
  id: string;
  label: string;
  lowerEdge: number;
  /** null for the open-ended top band. */
  upperEdge: number | null;
}

export interface LendingBandShare {
  bandId: string;
  count: number;
  /** Share of its own borrower-type series, in percent. */
  share: number;
}

export interface LendingBandSeries {
  borrowerType: LendingBorrowerType;
  count: number;
  bands: LendingBandShare[];
}

export interface LendingBandGroup {
  metric: 'ltv' | 'lti';
  title: string;
  units: string;
  bands: LendingBand[];
  seriesByBorrowerType: LendingBandSeries[];
}

export interface LendingQuintileTypeCell {
  borrowerType: LendingBorrowerType;
  highLtvCount: number;
  highLtiCount: number;
  /** Share of all high-LTV lending in the pool, in percent. */
  highLtvShareOfAll: number;
  highLtiShareOfAll: number;
}

export interface LendingQuintile {
  quintile: number;
  transactionCount: number;
  priceLowerBound: number | null;
  priceUpperBound: number | null;
  highLtvCount: number;
  highLtiCount: number;
  highLtvShareOfAll: number;
  highLtiShareOfAll: number;
  byBorrowerType: LendingQuintileTypeCell[];
}

export interface LendingQuintileMatrix {
  /** The four cut points of transactionPrice over the owner-occupier mortgaged pool. */
  cutPoints: number[];
  poolCount: number;
  /** High-LTV is tested inclusively (>=); high-LTI exclusively (>), matching the paper. */
  highLtvThreshold: number;
  highLtiThreshold: number;
  totalHighLtvCount: number;
  totalHighLtiCount: number;
  quintiles: LendingQuintile[];
}

export interface LendingJointCell {
  ltvBin: number;
  ltiBin: number;
  count: number;
  /** Share of its own borrower-type series, in percent. */
  share: number;
}

export interface LendingJointSeries {
  borrowerType: LendingBorrowerType;
  count: number;
  /** Sparse: only non-empty cells are emitted. */
  cells: LendingJointCell[];
}

export interface LendingJointGrid {
  ltvEdges: number[];
  ltiEdges: number[];
  seriesByBorrowerType: LendingJointSeries[];
}

export interface LendingBorrowerTypeCount {
  borrowerType: LendingBorrowerType;
  count: number;
}

export interface LendingCounts {
  transactions: number;
  mortgaged: number;
  /** Cash purchases (no mortgage principal), excluded from every ratio below. */
  cashExcluded: number;
  byBorrowerType: LendingBorrowerTypeCount[];
}

export interface LendingSummaryStats {
  borrowerType: LendingBorrowerType;
  count: number;
  meanLtv: number | null;
  medianLtv: number | null;
  meanLti: number | null;
  medianLti: number | null;
  meanDsti: number | null;
  /** BTL only; NaN for owner-occupiers in the source file. */
  meanIcr: number | null;
}

export interface LendingWindowInfo {
  requested: ResultsCompareWindow;
  /** What was actually used: transactions are only recorded from a configured model time. */
  effective: ResultsCompareWindow;
  clamped: boolean;
  startModelTime: number | null;
  endModelTime: number | null;
  /** TIME_TO_START_RECORDING_TRANSACTIONS, as read from the run's config.properties. */
  recordingStartModelTime: number | null;
  dataStartModelTime: number | null;
  dataEndModelTime: number | null;
}

export interface LendingCap {
  borrowerType: LendingBorrowerType;
  metric: 'ltv' | 'lti' | 'dsti' | 'icr';
  /** In the metric's own units: percent for LTV, a ratio otherwise. */
  value: number;
  units: string;
  /** Which limit binds — the tighter of the Central Bank and the private bank limit. */
  source: 'central_bank' | 'bank' | 'both';
  /** Soft limits are flow limits: a capped share of new lending may exceed them. */
  binding: 'hard' | 'soft';
}

export interface LendingDistributionPayload {
  runId: string;
  available: boolean;
  unavailableReason?: LendingUnavailableReason;
  note?: string;
  window: LendingWindowInfo;
  counts: LendingCounts;
  /** Number of transaction files pooled; seedLabels is empty when read from the run root. */
  seedCount: number;
  seedLabels: string[];
  caps: LendingCap[];
  summaryByBorrowerType: LendingSummaryStats[];
  histograms: LendingHistogram[];
  bandGroups: LendingBandGroup[];
  quintiles: LendingQuintileMatrix | null;
  joint: LendingJointGrid | null;
  /** Relative tolerance used when testing a value against a cap or bin edge. */
  capTolerance: number;
}

export interface LendingDistributionComparePayload {
  runIds: string[];
  window: ResultsCompareWindow;
  runs: LendingDistributionPayload[];
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
