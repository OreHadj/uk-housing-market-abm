import fs from 'node:fs';
import path from 'node:path';
import type {
  ValidationCompositeTrendPayload,
  ValidationMetricComparisonPoint,
  ValidationReferenceLine,
  ValidationMetricSummary,
  ValidationOverviewPayload,
  ValidationVersionSummary
} from '../../shared/types';
import { compareVersions } from './versioning';
import { resolveRuntimePaths, type RuntimePathInput } from './runtimePaths';

const DEFAULT_VALIDATION_TARGET_YEAR = 2024;
const V0_REFERENCE_OVERLAY_NAME = 'v0-2011';
const VALIDATION_REFERENCE_VERSIONS = ['v0', 'v0o2', 'v0o7'] as const;
const VALIDATION_REFERENCE_VERSION_SET = new Set<string>(VALIDATION_REFERENCE_VERSIONS);
const V0_REFERENCE_HPI_STD_BAND_NOTE =
  'Intentionally benchmarked to the same official UK IndexSA population std over 2005-01 through 2024-12 used by the tracked 2024 view; this 2011 reference summary only changes the displayed comparison window.';
const V0_REFERENCE_HPI_CYCLE_BAND_NOTE =
  'Still 2011-anchored: derived from the tracked official-source UK HPI history through 2011-12 using the locked 12-month moving-average, log-detrend, FFT peak-search method over 60..240 months.';
const VERSION_ID_PATTERN = /^v\d+(?:\.\d+)*(?:o+|o\d+)?$/i;

function assertObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, message: string): string {
  if (typeof value !== 'string') {
    throw new Error(message);
  }
  return value;
}

function assertStringOrNull(value: unknown, message: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return assertString(value, message);
}

function assertNumber(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(message);
  }
  return value;
}

function assertNumberOrNull(value: unknown, message: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return assertNumber(value, message);
}

function assertNumberArray(value: unknown, message: string): number[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error(message);
  }
  return value;
}

function resolveValidationTargetYear(value: unknown, message: string): number {
  if (value === undefined || value === null) {
    return DEFAULT_VALIDATION_TARGET_YEAR;
  }
  return assertNumber(value, message);
}

function normalizeTrackedValidationTargetYear(version: string, validationTargetYear: number): number {
  // Legacy v0 payloads can still carry the old 2011 comparator year at the top level.
  // The dashboard keeps the tracked summary timeline on the current 2024 evidence and
  // expects any separate historical comparator to arrive via referenceLine instead.
  if (version === 'v0' && validationTargetYear !== DEFAULT_VALIDATION_TARGET_YEAR) {
    return DEFAULT_VALIDATION_TARGET_YEAR;
  }
  return validationTargetYear;
}

function parseReferenceLine(
  value: unknown,
  filePath: string,
  fallback: Pick<ValidationReferenceLine, 'version' | 'label' | 'description' | 'overallCompositeLoss' | 'validationTargetYear'>
): ValidationReferenceLine | null {
  if (value === undefined || value === null) {
    return null;
  }

  const objectValue = assertObject(value, `${filePath}.referenceLine must be an object`);
  return {
    version:
      objectValue.version === undefined || objectValue.version === null
        ? fallback.version
        : assertString(objectValue.version, `${filePath}.referenceLine.version must be a string`),
    label:
      objectValue.label === undefined || objectValue.label === null
        ? fallback.label
        : assertString(objectValue.label, `${filePath}.referenceLine.label must be a string`),
    description: assertStringOrNull(
      objectValue.description === undefined ? fallback.description : objectValue.description,
      `${filePath}.referenceLine.description must be a string or null`
    ),
    overallCompositeLoss:
      objectValue.overallCompositeLoss === undefined || objectValue.overallCompositeLoss === null
        ? fallback.overallCompositeLoss
        : assertNumber(
            objectValue.overallCompositeLoss,
            `${filePath}.referenceLine.overallCompositeLoss must be a number`
          ),
    validationTargetYear:
      objectValue.validationTargetYear === undefined || objectValue.validationTargetYear === null
        ? fallback.validationTargetYear
        : assertNumber(
            objectValue.validationTargetYear,
            `${filePath}.referenceLine.validationTargetYear must be a number`
          )
  };
}

function parseSourceReference(value: unknown, index: number) {
  const objectValue = assertObject(value, `sourceReferences[${index}] must be an object`);
  return {
    label: assertString(objectValue.label, `sourceReferences[${index}].label must be a string`),
    sourceDocumentPath: assertString(
      objectValue.sourceDocumentPath,
      `sourceReferences[${index}].sourceDocumentPath must be a string`
    ),
    sourceTextPath: assertStringOrNull(
      objectValue.sourceTextPath,
      `sourceReferences[${index}].sourceTextPath must be a string or null`
    ),
    sourceTable: assertStringOrNull(
      objectValue.sourceTable,
      `sourceReferences[${index}].sourceTable must be a string or null`
    ),
    sourcePage: assertNumberOrNull(
      objectValue.sourcePage,
      `sourceReferences[${index}].sourcePage must be a number or null`
    ),
    sourceIndicatorLabel: assertStringOrNull(
      objectValue.sourceIndicatorLabel,
      `sourceReferences[${index}].sourceIndicatorLabel must be a string or null`
    ),
    rawSourceValue: assertNumberOrNull(
      objectValue.rawSourceValue,
      `sourceReferences[${index}].rawSourceValue must be a number or null`
    ),
    sourceAsOf: assertStringOrNull(
      objectValue.sourceAsOf,
      `sourceReferences[${index}].sourceAsOf must be a string or null`
    ),
    sourceUnits: assertStringOrNull(
      objectValue.sourceUnits,
      `sourceReferences[${index}].sourceUnits must be a string or null`
    ),
    notes: assertStringOrNull(objectValue.notes, `sourceReferences[${index}].notes must be a string or null`)
  };
}

function parseMetricWeight(value: unknown, index: number): number {
  if (value === undefined) {
    return 1;
  }
  return assertNumber(value, `metrics[${index}].metricWeight must be a number`);
}

function parseMetricSummary(value: unknown, index: number): ValidationMetricSummary {
  const objectValue = assertObject(value, `metrics[${index}] must be an object`);
  const rawTargetBand = objectValue.targetBand;
  const rawSourceReferences = objectValue.sourceReferences;
  const targetBand =
    rawTargetBand === null
      ? null
      : {
          lower: assertNumber(assertObject(rawTargetBand, `metrics[${index}].targetBand must be an object`).lower, `metrics[${index}].targetBand.lower must be a number`),
          upper: assertNumber(assertObject(rawTargetBand, `metrics[${index}].targetBand must be an object`).upper, `metrics[${index}].targetBand.upper must be a number`)
        };

  return {
    metricId: assertString(objectValue.metricId, `metrics[${index}].metricId must be a string`),
    label: assertString(objectValue.label, `metrics[${index}].label must be a string`),
    status: assertString(objectValue.status, `metrics[${index}].status must be a string`) as ValidationMetricSummary['status'],
    requirement: assertString(
      objectValue.requirement,
      `metrics[${index}].requirement must be a string`
    ) as ValidationMetricSummary['requirement'],
    units: assertString(objectValue.units, `metrics[${index}].units must be a string`),
    sourceLabel: assertString(objectValue.sourceLabel, `metrics[${index}].sourceLabel must be a string`),
    sourceIndicatorLabel: assertStringOrNull(
      objectValue.sourceIndicatorLabel,
      `metrics[${index}].sourceIndicatorLabel must be a string or null`
    ),
    sourceDocumentPath: assertStringOrNull(
      objectValue.sourceDocumentPath,
      `metrics[${index}].sourceDocumentPath must be a string or null`
    ),
    sourceTextPath: assertStringOrNull(
      objectValue.sourceTextPath,
      `metrics[${index}].sourceTextPath must be a string or null`
    ),
    sourceTable: assertStringOrNull(objectValue.sourceTable, `metrics[${index}].sourceTable must be a string or null`),
    sourcePage: assertNumberOrNull(objectValue.sourcePage, `metrics[${index}].sourcePage must be a number or null`),
    rawSourceValue: assertNumberOrNull(
      objectValue.rawSourceValue,
      `metrics[${index}].rawSourceValue must be a number or null`
    ),
    sourceValue: assertNumberOrNull(objectValue.sourceValue, `metrics[${index}].sourceValue must be a number or null`),
    sourceAsOf: assertStringOrNull(objectValue.sourceAsOf, `metrics[${index}].sourceAsOf must be a string or null`),
    sourceUnits: assertStringOrNull(objectValue.sourceUnits, `metrics[${index}].sourceUnits must be a string or null`),
    comparisonUnits: assertStringOrNull(
      objectValue.comparisonUnits,
      `metrics[${index}].comparisonUnits must be a string or null`
    ),
    mappingStatus: assertStringOrNull(
      objectValue.mappingStatus,
      `metrics[${index}].mappingStatus must be a string or null`
    ) as ValidationMetricSummary['mappingStatus'],
    bandMethod: assertStringOrNull(objectValue.bandMethod, `metrics[${index}].bandMethod must be a string or null`),
    bandNotes: assertStringOrNull(objectValue.bandNotes, `metrics[${index}].bandNotes must be a string or null`),
    sourceReferences: Array.isArray(rawSourceReferences)
      ? rawSourceReferences.map((item, sourceIndex) => parseSourceReference(item, sourceIndex))
      : [],
    targetBand,
    seedMean: assertNumber(objectValue.seedMean, `metrics[${index}].seedMean must be a number`),
    p25: assertNumber(objectValue.p25, `metrics[${index}].p25 must be a number`),
    p75: assertNumber(objectValue.p75, `metrics[${index}].p75 must be a number`),
    insideRate: assertNumberOrNull(objectValue.insideRate, `metrics[${index}].insideRate must be a number or null`),
    lossFamily: assertStringOrNull(
      objectValue.lossFamily,
      `metrics[${index}].lossFamily must be a string or null`
    ) as ValidationMetricSummary['lossFamily'],
    lossTransform: assertStringOrNull(
      objectValue.lossTransform,
      `metrics[${index}].lossTransform must be a string or null`
    ),
    lossScale: assertNumberOrNull(objectValue.lossScale, `metrics[${index}].lossScale must be a number or null`),
    lossScaleBasis: assertStringOrNull(
      objectValue.lossScaleBasis,
      `metrics[${index}].lossScaleBasis must be a string or null`
    ) as ValidationMetricSummary['lossScaleBasis'],
    additiveScale: assertNumberOrNull(
      objectValue.additiveScale,
      `metrics[${index}].additiveScale must be a number or null`
    ),
    additiveScaleBasis: assertStringOrNull(
      objectValue.additiveScaleBasis,
      `metrics[${index}].additiveScaleBasis must be a string or null`
    ) as ValidationMetricSummary['additiveScaleBasis'],
    normalizedDistance: assertNumberOrNull(
      objectValue.normalizedDistance,
      `metrics[${index}].normalizedDistance must be a number or null`
    ),
    normalizedIqr: assertNumberOrNull(objectValue.normalizedIqr, `metrics[${index}].normalizedIqr must be a number or null`),
    distanceComponent: assertNumberOrNull(
      objectValue.distanceComponent,
      `metrics[${index}].distanceComponent must be a number or null`
    ),
    spreadComponent: assertNumberOrNull(
      objectValue.spreadComponent,
      `metrics[${index}].spreadComponent must be a number or null`
    ),
    levelComponent: assertNumberOrNull(
      objectValue.levelComponent,
      `metrics[${index}].levelComponent must be a number or null`
    ),
    insideRateComponent: assertNumberOrNull(
      objectValue.insideRateComponent,
      `metrics[${index}].insideRateComponent must be a number or null`
    ),
    metricLoss: assertNumberOrNull(objectValue.metricLoss, `metrics[${index}].metricLoss must be a number or null`),
    lossDeltaVsReference2011: assertNumberOrNull(
      objectValue.lossDeltaVsReference2011,
      `metrics[${index}].lossDeltaVsReference2011 must be a number or null`
    ),
    lossDeltaPercentVsReference2011: assertNumberOrNull(
      objectValue.lossDeltaPercentVsReference2011,
      `metrics[${index}].lossDeltaPercentVsReference2011 must be a number or null`
    ),
    metricWeight: parseMetricWeight(objectValue.metricWeight, index)
  };
}

function parseValidationSummary(
  filePath: string,
  { normalizeTrackedTimeline = true }: { normalizeTrackedTimeline?: boolean } = {}
): ValidationVersionSummary {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
  const value = assertObject(raw, `${filePath} must contain a JSON object`);
  const windowValue = assertObject(value.window, `${filePath}.window must be an object`);
  const version = assertString(value.version, `${filePath}.version must be a string`);
  const overallCompositeLoss = assertNumber(
    value.overallCompositeLoss,
    `${filePath}.overallCompositeLoss must be a number`
  );
  const rawValidationTargetYear = resolveValidationTargetYear(
    value.validationTargetYear,
    `${filePath}.validationTargetYear must be a number`
  );
  const validationTargetYear = normalizeTrackedTimeline
    ? normalizeTrackedValidationTargetYear(version, rawValidationTargetYear)
    : rawValidationTargetYear;
  if (!Array.isArray(value.metrics)) {
    throw new Error(`${filePath}.metrics must be an array`);
  }
  return {
    schemaVersion: assertNumber(value.schemaVersion, `${filePath}.schemaVersion must be a number`),
    version,
    generatedAt: assertString(value.generatedAt, `${filePath}.generatedAt must be a string`),
    validationTargetYear,
    referenceLine: parseReferenceLine(value.referenceLine, filePath, {
      version,
      label: version === 'v0' ? 'Original v0 calibration' : `${version} validation reference`,
      description: version === 'v0' ? `Original ${version} calibration loss against ${rawValidationTargetYear} evidence.` : null,
      overallCompositeLoss,
      validationTargetYear: rawValidationTargetYear
    }),
    seeds: assertNumberArray(value.seeds, `${filePath}.seeds must be a number array`),
    window: {
      startIndex: assertNumber(windowValue.startIndex, `${filePath}.window.startIndex must be a number`),
      endIndex: assertNumber(windowValue.endIndex, `${filePath}.window.endIndex must be a number`)
    },
    overallCompositeLoss,
    metrics: value.metrics.map((item, index) => parseMetricSummary(item, index))
  };
}

export function listValidationSummaryVersions(pathsInput: RuntimePathInput): string[] {
  const paths = resolveRuntimePaths(pathsInput);
  const validationDir = path.join(paths.dataRoot, 'validation');
  if (!fs.existsSync(validationDir)) {
    return [];
  }

  return fs
    .readdirSync(validationDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.replace(/\.json$/u, ''))
    .sort(compareVersions);
}

function isValidationOverviewVersion(version: string): boolean {
  return (
    version === 'v0' ||
    version === 'v0o2' ||
    version === 'v0o7' ||
    (VERSION_ID_PATTERN.test(version) && compareVersions(version, 'v1.0') >= 0)
  );
}

export function readValidationSummary(pathsInput: RuntimePathInput, version: string): ValidationVersionSummary {
  const paths = resolveRuntimePaths(pathsInput);
  const filePath = path.join(paths.dataRoot, 'validation', `${version}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing validation summary for ${version}`);
  }
  return parseValidationSummary(filePath, { normalizeTrackedTimeline: true });
}

function readValidationOverlay(pathsInput: RuntimePathInput, overlayName: string): ValidationVersionSummary | null {
  const paths = resolveRuntimePaths(pathsInput);
  const filePath = path.join(paths.dataRoot, 'validation-overlays', `${overlayName}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return parseValidationSummary(filePath, { normalizeTrackedTimeline: false });
}

function referenceOverlayName(version: string): string {
  return `${version}-2011`;
}

function decorate2011ReferenceSummary(summary: ValidationVersionSummary): ValidationVersionSummary {
  const metrics = summary.metrics.map((metric) => {
    if (metric.metricId === 'core_hpiStd') {
      return {
        ...metric,
        bandNotes: V0_REFERENCE_HPI_STD_BAND_NOTE
      };
    }
    if (metric.metricId === 'core_hpiCyclePeriod') {
      return {
        ...metric,
        bandNotes: V0_REFERENCE_HPI_CYCLE_BAND_NOTE
      };
    }
    return metric;
  });
  return {
    ...summary,
    metrics
  };
}

function readValidationReferenceSummary(pathsInput: RuntimePathInput, version = 'v0'): ValidationVersionSummary | null {
  const summary = readValidationOverlay(pathsInput, referenceOverlayName(version));
  if (!summary) {
    return null;
  }
  return decorate2011ReferenceSummary(summary);
}

function hasValidationReferenceSummary(pathsInput: RuntimePathInput, version: string): boolean {
  if (!VALIDATION_REFERENCE_VERSION_SET.has(version)) {
    return false;
  }
  const paths = resolveRuntimePaths(pathsInput);
  return fs.existsSync(path.join(paths.dataRoot, 'validation-overlays', `${referenceOverlayName(version)}.json`));
}

function buildAvailableValidationTargetYearsByVersion(
  pathsInput: RuntimePathInput,
  availableVersions: string[]
): Record<string, number[]> {
  const yearsByVersion: Record<string, number[]> = {};
  for (const version of availableVersions) {
    yearsByVersion[version] = hasValidationReferenceSummary(pathsInput, version)
      ? [DEFAULT_VALIDATION_TARGET_YEAR, 2011]
      : [DEFAULT_VALIDATION_TARGET_YEAR];
  }
  return yearsByVersion;
}

function resolveRequestedValidationTargetYear(
  requestedValidationTargetYear: number | undefined,
  selectedVersion: string,
  availableValidationTargetYearsByVersion: Record<string, number[]>
): number {
  const availableYears = availableValidationTargetYearsByVersion[selectedVersion] ?? [DEFAULT_VALIDATION_TARGET_YEAR];
  if (requestedValidationTargetYear !== undefined && availableYears.includes(requestedValidationTargetYear)) {
    return requestedValidationTargetYear;
  }
  return DEFAULT_VALIDATION_TARGET_YEAR;
}

function readValidationReferencePoints(pathsInput: RuntimePathInput, availableVersions: string[]): ValidationReferenceLine[] {
  const availableVersionSet = new Set(availableVersions);
  return VALIDATION_REFERENCE_VERSIONS.flatMap((version) => {
    if (!availableVersionSet.has(version)) {
      return [];
    }
    const summary = readValidationOverlay(pathsInput, referenceOverlayName(version));
    if (!summary) {
      return [];
    }
    return [
      {
        version: summary.version,
        label: `${summary.version} 2011 validation`,
        description: `${summary.version} validation loss rescored against the 2011 reference profile.`,
        overallCompositeLoss: summary.overallCompositeLoss,
        validationTargetYear: summary.validationTargetYear
      }
    ];
  });
}

function addLossDeltaVsReference2011(
  summary: ValidationVersionSummary,
  referenceSummary: ValidationVersionSummary | null
): ValidationVersionSummary {
  if (!referenceSummary) {
    return {
      ...summary,
      metrics: summary.metrics.map((metric) => ({
        ...metric,
        lossDeltaVsReference2011: null,
        lossDeltaPercentVsReference2011: null
      }))
    };
  }

  const referenceMetricsById = new Map(referenceSummary.metrics.map((metric) => [metric.metricId, metric]));
  return {
    ...summary,
    metrics: summary.metrics.map((metric) => {
      const referenceMetric = referenceMetricsById.get(metric.metricId);
      const lossDelta =
        metric.metricLoss === null || referenceMetric?.metricLoss === null || !referenceMetric
          ? null
          : metric.metricLoss - referenceMetric.metricLoss;
      const lossDeltaPercent =
        lossDelta === null || !referenceMetric || referenceMetric.metricLoss === null
          ? null
          : referenceMetric.metricLoss === 0
            ? lossDelta === 0
              ? 0
              : null
            : (lossDelta / referenceMetric.metricLoss) * 100;
      return {
        ...metric,
        lossDeltaVsReference2011: lossDelta,
        lossDeltaPercentVsReference2011: lossDeltaPercent
      };
    })
  };
}

export function getValidationOverview(
  pathsInput: RuntimePathInput,
  requestedVersion?: string,
  requestedValidationTargetYear?: number,
  requestedComparisonVersion?: string
): ValidationOverviewPayload {
  const paths = resolveRuntimePaths(pathsInput);
  const availableVersions = listValidationSummaryVersions(paths).filter(isValidationOverviewVersion);
  if (availableVersions.length === 0) {
    throw new Error('No tracked validation summaries are available');
  }

  const selectedVersion = requestedVersion?.trim() ? requestedVersion : availableVersions[availableVersions.length - 1];
  if (!selectedVersion || !availableVersions.includes(selectedVersion)) {
    throw new Error(`Unknown validation summary version: ${requestedVersion ?? ''}`);
  }

  const summaries = availableVersions.map((version) => readValidationSummary(paths, version));
  const selectedSummary = summaries.find((summary) => summary.version === selectedVersion);
  if (!selectedSummary) {
    throw new Error(`Missing selected validation summary for ${selectedVersion}`);
  }

  const availableValidationTargetYearsByVersion = buildAvailableValidationTargetYearsByVersion(paths, availableVersions);
  const selectedValidationTargetYear = resolveRequestedValidationTargetYear(
    requestedValidationTargetYear,
    selectedVersion,
    availableValidationTargetYearsByVersion
  );
  const baselineReferenceSummary = readValidationReferenceSummary(paths);
  const referenceLine =
    (baselineReferenceSummary
        ? {
          version: V0_REFERENCE_OVERLAY_NAME,
          label: 'Original v0 calibration',
          description:
            'Original v0 calibration loss against 2011 evidence, rescored from the tracked 8-seed v0 validation outputs.',
          overallCompositeLoss: baselineReferenceSummary.overallCompositeLoss,
          validationTargetYear: baselineReferenceSummary.validationTargetYear
        }
      : null) ??
    summaries.find((summary) => summary.referenceLine)?.referenceLine ??
    null;
  const trend: ValidationCompositeTrendPayload = {
    points: summaries.map((summary) => ({
      version: summary.version,
      validationTargetYear: summary.validationTargetYear,
      overallCompositeLoss: summary.overallCompositeLoss
    })),
    referenceLine,
    referencePoints: readValidationReferencePoints(paths, availableVersions)
  };
  const selectedSummaryForYear =
    selectedValidationTargetYear === 2011
      ? (readValidationReferenceSummary(paths, selectedVersion) as ValidationVersionSummary)
      : selectedSummary;
  const selectedSummaryView = addLossDeltaVsReference2011(
    selectedSummaryForYear,
    baselineReferenceSummary
  );

  // Every version's summary is already in memory above, so the cross-version projection costs no
  // extra IO for 2024. Scope it to the selected evidence year: 2024 comes from the tracked
  // summaries, 2011 only from the versions that have a reference overlay.
  const metricsByVersion: Record<string, ValidationMetricComparisonPoint[]> = {};
  for (const version of availableVersions) {
    if (!(availableValidationTargetYearsByVersion[version] ?? []).includes(selectedValidationTargetYear)) {
      continue;
    }
    const sourceSummary =
      selectedValidationTargetYear === 2011
        ? readValidationReferenceSummary(paths, version)
        : summaries.find((summary) => summary.version === version) ?? null;
    if (!sourceSummary) {
      continue;
    }
    metricsByVersion[version] = sourceSummary.metrics.map((metric) => ({
      metricId: metric.metricId,
      status: metric.status,
      metricLoss: metric.metricLoss,
      seedMean: metric.seedMean,
      sourceValue: metric.sourceValue
    }));
  }

  // Rendering a second model in the single-mode format needs the full summary (target band, IQR,
  // labels), not the compact ranking projection. An unknown or wrong-era comparison resolves to
  // null so the page falls back to single mode instead of erroring.
  const comparisonVersion = requestedComparisonVersion?.trim() ?? '';
  const comparisonSummary =
    comparisonVersion &&
    comparisonVersion !== selectedVersion &&
    availableVersions.includes(comparisonVersion) &&
    (availableValidationTargetYearsByVersion[comparisonVersion] ?? []).includes(selectedValidationTargetYear)
      ? selectedValidationTargetYear === 2011
        ? readValidationReferenceSummary(paths, comparisonVersion)
        : summaries.find((summary) => summary.version === comparisonVersion) ?? null
      : null;

  return {
    availableVersions,
    selectedVersion,
    selectedValidationTargetYear,
    availableValidationTargetYearsByVersion,
    trend,
    selectedSummary: selectedSummaryView,
    metricsByVersion,
    comparisonSummary
  };
}
