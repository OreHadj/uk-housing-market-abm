import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  compareParameters,
  getHomePreview,
  getInProgressVersions,
  getParameterCatalog,
  getValidationOverview,
  getVersions
} from '../server/lib/service.js';
import { readValidationSummary } from '../server/lib/validationSummaries.js';
import {
  deleteResultsRun,
  getResultsCompare,
  getResultsRunDetail,
  getResultsRunFiles,
  getResultsRuns,
  getResultsSeries
} from '../server/lib/results.js';
import {
  __resetModelRunManagerForTests,
  __setModelRunSpawnForTests,
  cancelModelRunJob,
  clearModelRunJob,
  getModelRunJobLogs,
  getModelRunOptions,
  getResultsStorageSummary,
  listModelRunJobs,
  submitModelRun
} from '../server/lib/modelRuns.js';
import {
  __resetSensitivityRunsForTests,
  __setSensitivityRunSpawnForTests,
  cancelSensitivityExperiment,
  deleteSensitivityExperiment,
  getSensitivityExperiment,
  getSensitivityExperimentCharts,
  getSensitivityExperimentLogs,
  getSensitivityExperimentResults,
  hasActiveSensitivityExperiment,
  listSensitivityExperiments,
  submitSensitivityExperiment
} from '../server/lib/sensitivityRuns.js';
import {
  buildMavenModelLaunchCommand,
  buildPackagedModelLaunchCommand,
  createMavenModelLauncher,
  createPackagedModelLauncher,
  type ModelLauncher,
  type ModelLauncherMode,
  type ModelLaunchRequest
} from '../server/lib/modelLauncher.js';
import { startDashboardServer } from '../server/dashboardServer.js';
import { cancelExperimentJob, deleteExperimentJob, getExperimentJobLogs, listExperimentJobs } from '../server/lib/experimentJobs.js';
import {
  parseResultsCompareQueryValues,
  resolveLocalResultsReadRunId
} from '../server/routes/devRoutes.js';
import { getConfigPath, parseConfigFile, readNumericCsvRows, resolveConfigDataFilePath } from '../server/lib/io.js';
import {
  assertDesktopWritablePathsOutsideResources,
  createDesktopRuntimePaths,
  createDevelopmentRuntimePaths,
  type RuntimePaths
} from '../server/lib/runtimePaths.js';
import { checkRuntimeDependencies, parseJavaMajorVersion } from '../server/lib/runtimeDeps.js';
import { exportDesktopSupportBundle } from '../server/lib/supportBundle.js';
import {
  RUN_MANIFEST_FILE_NAME,
  type ManualRunManifest,
  type SensitivityRunManifest
} from '../server/lib/runManifest.js';
import {
  isDashboardManagedRun,
  writeDashboardManagedRunMarker
} from '../server/lib/runOwnership.js';
import {
  createDeleteKeyAuthController,
  createDesktopWriteAuthController,
  createWriteAuthController,
  getWriteAuthConfigurationError,
  resolveDashboardWriteAccess
} from '../server/lib/writeAuth.js';
import { appendLogLine, type LogBufferState } from '../server/lib/logs/logBuffer.js';
import { createRotatingLogWriter } from '../server/lib/logs/persistentLogs.js';
import {
  RemoteExecutionManager,
  RemoteExecutionUnavailableError,
  buildRemoteRunnerScript,
  type RemoteAwsAdapter,
  type RemoteExecutionConfig
} from '../server/lib/remoteExecution.js';
import { loadDashboardInputVersionHistory } from '../server/lib/dashboardInputVersionHistory.js';
import { compareVersions, listVersions, parseVersionParts } from '../server/lib/versioning.js';
import { assertAxisSpecComplete, getAxisSpec } from '../src/lib/chartAxes.js';
import { binnedOption } from '../src/lib/compareChartOptions.js';
import {
  buildExperimentSearchParams,
  normaliseExperimentRouteState,
  parseExperimentRouteState
} from '../src/pages/experiments/routeState.js';
import {
  classifyDesktopWindowOpenTarget,
  deriveTrustedDashboardOrigin,
  shouldBlockDashboardNavigation,
  validateTrustedDesktopIpcSender,
  type DesktopFrameLike
} from '../shared/desktopSecurity.js';
import { DEFAULT_SENSITIVITY_POLICY_PACKAGE_ID } from '../shared/policyCatalogue.js';
import {
  KPI_DETAIL_ROWS,
  computeKpiDeltaValue,
  computeKpiPercentDelta,
  formatKpiDeltaValue,
  formatKpiValue,
  getKpiMetricValue,
  getKpiDeltaLabel,
  groupIndicatorsBySource,
  resolveActiveIndicatorId,
  resolveActiveIndicatorPayload,
  resolveManualRunSelection,
  resolveSelectedIndicatorIds
} from '../src/lib/manualResultsView.js';
import { ManualSelectionStatusPills } from '../src/components/ManualSelectionStatusPills.js';
import { buildManualOverlayOption } from '../src/lib/manualOverlayChartOption.js';
import {
  buildResultsRunVersionLabelState,
  buildVersionLabelState,
  extractVersionFromResultsRunId,
  formatCalibrationVersionTitleLabel,
  formatVersionOptionLabel,
  getLatestStableVersion
} from '../src/lib/versionLabels.js';
import {
  formatExperimentModelOption,
  orderExperimentModelOptions
} from '../src/lib/experimentVersionOptions.js';
import { buildResultsCompareSearchParams } from '../src/lib/api.js';
import { ManualRunSetupCard } from '../src/pages/run-experiments/ManualRunSetupCard.js';
import { SensitivitySetupCard } from '../src/pages/run-experiments/SensitivitySetupCard.js';
import { assertSettingHelpCopy } from '../src/pages/run-experiments/settingHelp.js';
import {
  DEFAULT_EXPERIMENT_BASE_POLICY_ID,
  buildDefaultSensitivityRange,
  buildGeneralModelControlOverridesFromForm,
  toInitialFormValues
} from '../src/lib/experimentRunDefaults.js';
import { buildDeltaTrendOption } from '../src/lib/sensitivityChartOptions.js';
import { computeKpiFromValues, selectPost200Window } from '../server/lib/stats/kpi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
let currentSmokeStep = 'initialising smoke test';

function markSmokeStep(step: string): void {
  currentSmokeStep = step;
  console.log(`[smoke] ${step}`);
}

process.on('exit', (code) => {
  if (code !== 0) {
    console.error(`[smoke] process exited with code ${code} near: ${currentSmokeStep}`);
  }
});
process.on('uncaughtException', (error) => {
  console.error(`[smoke] uncaught exception near: ${currentSmokeStep}`);
  console.error(error);
  process.exitCode = 1;
});
process.on('unhandledRejection', (reason) => {
  console.error(`[smoke] unhandled rejection near: ${currentSmokeStep}`);
  console.error(reason);
  process.exitCode = 1;
});

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function sumBinnedDensityMass(rows: number[][]): number {
  return sum(rows.map((row) => (row[1] - row[0]) * row[2]));
}

function assertClose(actual: number, expected: number, tolerance: number, message: string): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
}

function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function gaussianPercentDensity(percent: number, mu: number, sigma: number): number {
  const denominator = percent * sigma * Math.sqrt(2 * Math.PI);
  const exponent = -((Math.log(percent) - mu) ** 2) / (2 * sigma ** 2);
  return Math.exp(exponent) / denominator;
}

function waitForAsyncTick(ms = 0): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out while waiting for asynchronous condition.');
    }
    await waitForAsyncTick(10);
  }
}

async function waitForModelRunStatus(
  jobId: string | undefined,
  expectedStatus: 'succeeded' | 'failed' | 'canceled',
  label: string,
  timeoutMs = 10000
) {
  const resolvedJobId = jobId ?? '';
  const start = Date.now();
  while (true) {
    const job = listModelRunJobs().find((item) => item.jobId === resolvedJobId);
    if (job?.status === expectedStatus) {
      assert.equal(job.status, expectedStatus, label);
      return job;
    }
    const unexpectedStatus = job && !['queued', 'running', expectedStatus].includes(job.status);
    const timedOut = Date.now() - start > timeoutMs;
    if (unexpectedStatus || timedOut) {
      const logs = resolvedJobId ? getModelRunJobLogs(resolvedJobId, 0, 200).lines.join('\n') : '';
      const message = unexpectedStatus
        ? `${label} ended with status ${job.status} before ${expectedStatus}.`
        : `${label} timed out waiting for ${expectedStatus}; latest status was ${job?.status ?? 'missing'}.`;
      const detail = `${message}${logs ? `\n${logs}` : ''}`;
      console.error(`[smoke] ${detail}`);
      throw new Error(detail);
    }
    await waitForAsyncTick(10);
  }
}

async function waitForSensitivityStatus(
  paths: RuntimePaths | string,
  experimentId: string,
  expectedStatus: 'succeeded' | 'failed' | 'canceled',
  label: string,
  timeoutMs = 10000
) {
  const start = Date.now();
  while (true) {
    const detail = getSensitivityExperiment(paths, experimentId).experiment;
    if (detail.status === expectedStatus) {
      assert.equal(detail.status, expectedStatus, label);
      return detail;
    }
    const unexpectedStatus = !['queued', 'running', expectedStatus].includes(detail.status);
    const timedOut = Date.now() - start > timeoutMs;
    if (unexpectedStatus || timedOut) {
      const logs = getSensitivityExperimentLogs(paths, experimentId, 0, 200).lines.join('\n');
      const message = unexpectedStatus
        ? `${label} ended with status ${detail.status} before ${expectedStatus}.`
        : `${label} timed out waiting for ${expectedStatus}; latest status was ${detail.status}.`;
      const diagnostic = `${message}${logs ? `\n${logs}` : ''}`;
      console.error(`[smoke] ${diagnostic}`);
      throw new Error(diagnostic);
    }
    await waitForAsyncTick(10);
  }
}

async function fetchText(url: string, init?: Parameters<typeof fetch>[1]): Promise<{
  status: number;
  contentType: string;
  text: string;
}> {
  const response = await fetch(url, init);
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    text: await response.text()
  };
}

async function fetchBuffer(url: string, init?: Parameters<typeof fetch>[1]): Promise<{
  status: number;
  contentType: string;
  contentDisposition: string;
  buffer: Buffer;
}> {
  const response = await fetch(url, init);
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    contentDisposition: response.headers.get('content-disposition') ?? '',
    buffer: Buffer.from(await response.arrayBuffer())
  };
}

async function readArchiveText(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return zlib.gunzipSync(Buffer.concat(chunks)).toString('latin1');
}

async function readArchiveEntries(stream: AsyncIterable<Uint8Array>): Promise<Map<string, Buffer>> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  const tar = zlib.gunzipSync(Buffer.concat(chunks));
  const entries = new Map<string, Buffer>();
  let offset = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const name = header.subarray(0, 100).toString('utf-8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf-8').replace(/\0.*$/, '');
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0/g, '').trim();
    const size = Number.parseInt(sizeText || '0', 8);
    const entryName = prefix ? `${prefix}/${name}` : name;
    const contentStart = offset + 512;
    entries.set(entryName, Buffer.from(tar.subarray(contentStart, contentStart + size)));
    offset = contentStart + Math.ceil(size / 512) * 512;
  }

  return entries;
}

const kpiStats = computeKpiFromValues([1, 2, 3, 4, 5]);
assertClose(kpiStats.mean ?? NaN, 3, 1e-9, 'Expected KPI mean to be correct');
assertClose(kpiStats.annualisedTrend ?? NaN, 12, 1e-9, 'Expected annualised trend to be monthly OLS slope x12');
assertClose(kpiStats.range ?? NaN, 3.6, 1e-9, 'Expected KPI range to be p95-p5 with linear interpolation');
assertClose(kpiStats.cv ?? NaN, Math.sqrt(2) / 3, 1e-9, 'Expected KPI CV to use stdev/abs(mean)');

const kpiZeroMean = computeKpiFromValues([-1, 1]);
assert.equal(kpiZeroMean.cv, null, 'Expected KPI CV to be null when mean is near zero');

const kpiSmallWindow = computeKpiFromValues([1, 2]);
assertClose(kpiSmallWindow.range ?? NaN, 0.9, 1e-9, 'Expected KPI percentile interpolation for small window');

const indexedValues = Array.from({ length: 205 }, (_value, index) => index);
assert.deepEqual(
  selectPost200Window(indexedValues),
  [200, 201, 202, 203, 204],
  'Expected post-200 KPI selection to discard values before model time 200'
);

const groupedIndicators = groupIndicatorsBySource([
  {
    id: 'core-price',
    title: 'Core price',
    units: 'GBP',
    description: '',
    source: 'core_indicator',
    available: true,
    coverageStatus: 'supported'
  },
  {
    id: 'output-sales',
    title: 'Output sales',
    units: 'count',
    description: '',
    source: 'output',
    available: true,
    coverageStatus: 'supported'
  }
]);
assert.deepEqual(
  groupedIndicators.map((group) => ({ id: group.id, ids: group.items.map((item) => item.id) })),
  [
    { id: 'core_indicator', ids: ['core-price'] },
    { id: 'output', ids: ['output-sales'] }
  ],
  'Expected manual results indicators to group by core_indicator and output'
);

const resolvedDefaultIndicators = resolveSelectedIndicatorIds(
  [
    {
      id: 'core-price',
      title: 'Core price',
      units: 'GBP',
      description: '',
      source: 'core_indicator',
      available: true,
      coverageStatus: 'supported'
    },
    {
      id: 'output-sales',
      title: 'Output sales',
      units: 'count',
      description: '',
      source: 'output',
      available: true,
      coverageStatus: 'supported'
    },
    {
      id: 'hidden',
      title: 'Hidden',
      units: 'count',
      description: '',
      source: 'output',
      available: false,
      coverageStatus: 'unsupported'
    }
  ],
  []
);
assert.deepEqual(
  resolvedDefaultIndicators,
  ['core-price', 'output-sales'],
  'Expected manual results to default-select all available indicators'
);

assert.equal(
  resolveActiveIndicatorId(
    ['core_ooLTI', 'core-price', 'output-sales'],
    [
      {
        indicator: {
          id: 'core_ooLTI',
          title: 'Owner-Occupier LTI (Mean Above Median)',
          units: 'ratio',
          description: '',
          source: 'core_indicator'
        },
        seriesByRun: []
      },
      {
        indicator: {
          id: 'core-price',
          title: 'Core price',
          units: 'GBP',
          description: '',
          source: 'core_indicator'
        },
        seriesByRun: []
      },
      {
        indicator: {
          id: 'output-sales',
          title: 'Output sales',
          units: 'count',
          description: '',
          source: 'output'
        },
        seriesByRun: []
      }
    ],
    ''
  ),
  'core_ooLTI',
  'Expected manual results to default the active overlay indicator to owner-occupier LTI when available'
);

assert.equal(
  resolveActiveIndicatorId(
    ['core_ooLTI', 'output-sales'],
    [
      {
        indicator: {
          id: 'core_ooLTI',
          title: 'Owner-Occupier LTI (Mean Above Median)',
          units: 'ratio',
          description: '',
          source: 'core_indicator'
        },
        seriesByRun: []
      },
      {
        indicator: {
          id: 'output-sales',
          title: 'Output sales',
          units: 'count',
          description: '',
          source: 'output'
        },
        seriesByRun: []
      }
    ],
    'output-sales'
  ),
  'output-sales',
  'Expected active overlay selection to preserve the current indicator when it remains enabled'
);

assert.equal(
  resolveActiveIndicatorId(
    ['output-sales'],
    [
      {
        indicator: {
          id: 'output-sales',
          title: 'Output sales',
          units: 'count',
          description: '',
          source: 'output'
        },
        seriesByRun: []
      }
    ],
    'core-price'
  ),
  'output-sales',
  'Expected active overlay selection to fall back when the previous indicator is no longer enabled'
);

assert.equal(
  resolveActiveIndicatorId([], [], ''),
  '',
  'Expected active overlay selection to return an empty value when no indicators are selectable'
);

const staleActiveOverlayPayload = resolveActiveIndicatorPayload(
  [
    {
      indicator: {
        id: 'core-price',
        title: 'Core price',
        units: 'GBP',
        description: '',
        source: 'core_indicator'
      },
      seriesByRun: []
    },
    {
      indicator: {
        id: 'output-sales',
        title: 'Output sales',
        units: 'count',
        description: '',
        source: 'output'
      },
      seriesByRun: []
    }
  ],
  ['core-price', 'output-sales'],
  'stale-indicator'
);
assert.equal(
  staleActiveOverlayPayload?.indicator.id,
  'core-price',
  'Expected overlay payload resolution to fall back when the active indicator state is stale'
);

const manualSelectionRuns = [
  {
    runId: 'v4.1-output',
    path: 'Results/v4.1-output',
    modifiedAt: '2026-03-09T00:00:00.000Z',
    createdAt: '2026-03-09T00:00:00.000Z',
    sizeBytes: 1,
    fileCount: 1,
    status: 'complete' as const,
    configAvailable: true,
    parseCoverage: {
      requiredCount: 1,
      supportedCount: 1,
      emptyCount: 0,
      errorCount: 0
    }
  },
  {
    runId: 'v4.0-output',
    path: 'Results/v4.0-output',
    modifiedAt: '2026-03-08T00:00:00.000Z',
    createdAt: '2026-03-08T00:00:00.000Z',
    sizeBytes: 1,
    fileCount: 1,
    status: 'complete' as const,
    configAvailable: true,
    parseCoverage: {
      requiredCount: 1,
      supportedCount: 1,
      emptyCount: 0,
      errorCount: 0
    }
  },
  {
    runId: 'v0-output',
    path: 'Results/v0-output',
    modifiedAt: '2026-03-07T00:00:00.000Z',
    createdAt: '2026-03-07T00:00:00.000Z',
    sizeBytes: 1,
    fileCount: 1,
    status: 'complete' as const,
    configAvailable: true,
    parseCoverage: {
      requiredCount: 1,
      supportedCount: 1,
      emptyCount: 0,
      errorCount: 0
    }
  }
];

assert.deepEqual(
  resolveManualRunSelection(manualSelectionRuns, '', ''),
  {
    baselineRunId: 'v0-output',
    comparisonRunId: 'v4.0-output'
  },
  'Expected manual results default selection to prefer v0-output baseline and v4.0-output comparison'
);

assert.deepEqual(
  resolveManualRunSelection(manualSelectionRuns, 'missing-run', 'v4.1-output'),
  {
    baselineRunId: 'v0-output',
    comparisonRunId: ''
  },
  'Expected invalid explicit baseline selection to fall back to the preferred baseline and clear comparison'
);

assert.equal(
  extractVersionFromResultsRunId('v4.0-output'),
  'v4.0',
  'Expected canonical results run ids to map back to their calibration version'
);

assert.equal(
  extractVersionFromResultsRunId('v0o2-output'),
  'v0o2',
  'Expected numbered output-calibration result ids to map back to their calibration version'
);

assert.equal(
  extractVersionFromResultsRunId('policy-demo-v4.0-output'),
  '',
  'Expected non-canonical results run ids not to resolve to calibration versions'
);

const manualRunVersions = ['v0', 'v4.0', 'v4.1'];
const manualRunInProgressVersions = ['v4.1'];

const originalRunLabelState = buildResultsRunVersionLabelState(
  'v0-output',
  manualRunVersions,
  manualRunInProgressVersions
);
assert.equal(originalRunLabelState?.isOriginal, true, 'Expected v0-output to resolve to the Original label state');

const latestRunLabelState = buildResultsRunVersionLabelState(
  'v4.0-output',
  manualRunVersions,
  manualRunInProgressVersions
);
assert.equal(
  latestRunLabelState?.isLatest,
  true,
  'Expected v4.0-output to resolve to Latest when the newer v4.1 snapshot is still in progress'
);

const inProgressRunLabelState = buildResultsRunVersionLabelState(
  'v4.1-output',
  manualRunVersions,
  manualRunInProgressVersions
);
assert.equal(
  inProgressRunLabelState?.isLatest,
  false,
  'Expected in-progress v4.1-output not to resolve to the Latest label state'
);

assert.equal(
  buildResultsRunVersionLabelState('fixture-complete-output', manualRunVersions, manualRunInProgressVersions),
  null,
  'Expected custom run ids not to render Original/Latest labels'
);

const singleOverlayOption = buildManualOverlayOption(
  {
    indicator: {
      id: 'core_housePrice',
      title: 'House price',
      units: 'GBP',
      description: '',
      source: 'core_indicator'
    },
    seriesByRun: [
      {
        runId: 'v0-output',
        points: [
          { modelTime: 200, value: 100 },
          { modelTime: 201, value: 200 },
          { modelTime: 202, value: null },
          { modelTime: 203, value: 300 }
        ]
      }
    ]
  },
  'v0-output',
  ''
);
const singleOverlaySeries = (singleOverlayOption.series as Array<Record<string, any>>) ?? [];
assert.equal(singleOverlaySeries.length, 1, 'Expected single-run overlay to include one plotted series');
assert.equal(singleOverlaySeries[0]?.lineStyle?.color, '#0b7285', 'Expected baseline overlay series to use the baseline color');
assert.equal(
  singleOverlaySeries[0]?.markLine?.data?.[0]?.yAxis,
  200,
  'Expected overlay mean lines to average only the visible non-null points'
);
assert.equal(
  singleOverlaySeries[0]?.markLine?.lineStyle?.type,
  'dotted',
  'Expected overlay mean reference lines to use a dotted style'
);

const compareOverlayOption = buildManualOverlayOption(
  {
    indicator: {
      id: 'core_mortgageApprovals',
      title: 'Mortgage approvals',
      units: 'count/month',
      description: '',
      source: 'core_indicator'
    },
    seriesByRun: [
      {
        runId: 'v0-output',
        points: [
          { modelTime: 200, value: 10 },
          { modelTime: 201, value: 20 }
        ]
      },
      {
        runId: 'v4.0-output',
        points: [
          { modelTime: 200, value: 30 },
          { modelTime: 201, value: 40 }
        ]
      }
    ]
  },
  'v0-output',
  'v4.0-output'
);
const compareOverlaySeries = (compareOverlayOption.series as Array<Record<string, any>>) ?? [];
assert.equal(compareOverlaySeries.length, 2, 'Expected compare overlay to include both plotted series');
assert.equal(compareOverlaySeries[0]?.name, 'Baseline', 'Expected baseline overlay series to use the baseline role label');
assert.equal(compareOverlaySeries[1]?.name, 'Comparison', 'Expected comparison overlay series to use the comparison role label');
assert.equal(compareOverlaySeries[1]?.lineStyle?.color, '#18958b', 'Expected comparison overlay series to use the comparison color');
assert.equal(compareOverlaySeries[0]?.markLine?.data?.[0]?.yAxis, 15, 'Expected baseline overlay mean to be computed from displayed data');
assert.equal(compareOverlaySeries[1]?.markLine?.data?.[0]?.yAxis, 35, 'Expected comparison overlay mean to be computed from displayed data');
assert.equal(compareOverlaySeries[1]?.markLine?.lineStyle?.type, 'dotted', 'Expected comparison overlay mean line to use the dotted style');

const gapOnlyOverlayOption = buildManualOverlayOption(
  {
    indicator: {
      id: 'core_mortgageApprovals',
      title: 'Mortgage approvals',
      units: 'count/month',
      description: '',
      source: 'core_indicator'
    },
    seriesByRun: [
      {
        runId: 'v0-output',
        points: [
          { modelTime: 200, value: 10 },
          { modelTime: 201, value: 20 }
        ]
      },
      {
        runId: 'v4.0-output',
        points: [
          { modelTime: 200, value: null },
          { modelTime: 201, value: null }
        ]
      }
    ]
  },
  'v0-output',
  'v4.0-output'
);
const gapOnlyOverlaySeries = (gapOnlyOverlayOption.series as Array<Record<string, any>>) ?? [];
assert.equal(gapOnlyOverlaySeries.length, 2, 'Expected gap-only overlay payload to still include both plotted series');
assert.equal(gapOnlyOverlaySeries[0]?.markLine?.data?.[0]?.yAxis, 15, 'Expected gap-only overlay baseline mean to still render');
assert.equal(gapOnlyOverlaySeries[1]?.markLine, undefined, 'Expected gap-only overlay series not to render a mean line');

const deltaTrendOption = buildDeltaTrendOption(
  {
    indicatorId: 'core_ooLTI',
    title: 'Owner-Occupier LTI',
    units: 'ratio',
    points: [
      { parameterValue: 4, deltaByKpi: { mean: 10, cv: null, annualisedTrend: null, range: 2 } },
      { parameterValue: 4.5, deltaByKpi: { mean: 12, cv: null, annualisedTrend: null, range: 3 } },
      { parameterValue: 5, deltaByKpi: { mean: 14, cv: null, annualisedTrend: null, range: 4 } }
    ]
  },
  'Soft max LTI FTB + HM',
  'mean'
) as { xAxis: { min: number; max: number; scale?: boolean }; yAxis: { min: number; max: number; scale?: boolean } };
assert.equal(deltaTrendOption.xAxis.scale, true, 'Expected delta trend x axis to use data scaling');
assert.equal(deltaTrendOption.yAxis.scale, true, 'Expected delta trend y axis to use data scaling');
assert.ok(deltaTrendOption.xAxis.min < 4 && deltaTrendOption.xAxis.max > 5, 'Expected delta trend x axis to pad data domain');
assert.ok(
  deltaTrendOption.yAxis.min > 0 && deltaTrendOption.yAxis.max > 14,
  'Expected delta trend y axis to span positive data without forcing zero'
);

const latestManualStatusMarkup = renderToStaticMarkup(
  createElement(ManualSelectionStatusPills, {
    status: 'complete',
    versionLabelState: latestRunLabelState
  })
);

assert.ok(
  latestManualStatusMarkup.includes('manual-selection-status-pills'),
  'Expected manual results summary status pills to render in a grouped container'
);

assert.ok(
  latestManualStatusMarkup.includes('>complete<') && latestManualStatusMarkup.includes('>Latest<'),
  'Expected the manual results summary status pills to render the Latest tag alongside the completion status'
);

const originalManualStatusMarkup = renderToStaticMarkup(
  createElement(ManualSelectionStatusPills, {
    status: 'complete',
    versionLabelState: originalRunLabelState
  })
);

assert.ok(
  originalManualStatusMarkup.includes('>complete<') && originalManualStatusMarkup.includes('>Original<'),
  'Expected the manual results summary status pills to render the Original tag alongside the completion status'
);

assert.equal(
  computeKpiPercentDelta(100, 125),
  25,
  'Expected KPI percent deltas to compute relative to the baseline run'
);

assert.equal(
  computeKpiPercentDelta(0, 125),
  null,
  'Expected KPI percent deltas to be null when the baseline magnitude is too small'
);

assert.equal(
  computeKpiPercentDelta(100, null),
  null,
  'Expected KPI percent deltas to be null when either side is missing'
);

assert.deepEqual(
  KPI_DETAIL_ROWS.map((row) => row.key),
  ['mean', 'cv', 'range'],
  'Expected manual results KPI detail tables to omit trend while preserving supported aggregate metrics'
);

assert.equal(
  getKpiMetricValue(
    {
      indicatorId: 'house-price',
      title: 'Average house price',
      units: 'GBP',
      windowType: 'tail_120',
      mean: 200000,
      cv: 0.12,
      annualisedTrend: 3500,
      range: 50000
    },
    'mean'
  ),
  200000,
  'Expected KPI metric lookup to expose mean values for the manual results detail tables'
);

assert.equal(formatKpiValue(1.33, '%'), '1.33%', 'Expected percent KPI values to show an explicit percent suffix');

assert.equal(formatKpiValue(4.5, 'ratio'), '4.5x', 'Expected ratio KPI values to show an x suffix');

assert.equal(formatKpiValue(0.035, 'rate'), '3.5%', 'Expected rate KPI values to render as human percentages');

assert.equal(getKpiDeltaLabel('%'), 'pp delta', 'Expected percent-like KPI rows to use percentage-point delta labels');

assertClose(
  computeKpiDeltaValue(-0.96, 1.33, '%') ?? NaN,
  2.29,
  1e-9,
  'Expected House Price Growth deltas to be computed in percentage points'
);

assert.equal(
  formatKpiDeltaValue(computeKpiDeltaValue(-0.96, 1.33, '%'), '%'),
  '+2.29 pp',
  'Expected percent-like KPI deltas to render in percentage points'
);

assert.equal(
  computeKpiDeltaValue(100, 125, 'count'),
  25,
  'Expected non-percent KPI deltas to remain relative percent changes'
);

assert.equal(
  formatKpiDeltaValue(computeKpiDeltaValue(100, 125, 'count'), 'count'),
  '+25.00%',
  'Expected non-percent KPI deltas to keep percent formatting'
);

const defaultExperimentRouteState = parseExperimentRouteState(new URLSearchParams(''));
assert.deepEqual(
  defaultExperimentRouteState,
  {
    type: 'sensitivity',
    mode: 'run',
    baselineRunId: '',
    comparisonRunId: '',
    experimentId: '',
    jobRef: '',
    follow: false
  },
  'Expected empty experiment query params to default to sensitivity run setup.'
);

const invalidExperimentRouteState = parseExperimentRouteState(
  new URLSearchParams('type=invalid&mode=wat&runId=abc&experimentId=exp-1&jobRef=manual:job-1')
);
assert.deepEqual(
  invalidExperimentRouteState,
  {
    type: 'sensitivity',
    mode: 'run',
    baselineRunId: '',
    comparisonRunId: '',
    experimentId: '',
    jobRef: 'manual:job-1',
    follow: false
  },
  'Expected invalid route selectors to fall back to sensitivity run setup while preserving run-mode job focus.'
);

const cleanedViewState = normaliseExperimentRouteState({
  type: 'sensitivity',
  mode: 'view',
  baselineRunId: 'run-1',
  comparisonRunId: 'run-2',
  experimentId: 'exp:42',
  jobRef: 'sensitivity:exp:42'
});
assert.deepEqual(
  cleanedViewState,
  {
    type: 'sensitivity',
    mode: 'view',
    baselineRunId: '',
    comparisonRunId: '',
    experimentId: 'exp:42',
    jobRef: '',
    follow: false
  },
  'Expected sensitivity view state to keep only experimentId.'
);

const cleanedManualViewState = normaliseExperimentRouteState({
  type: 'manual',
  mode: 'view',
  baselineRunId: 'v0-output',
  comparisonRunId: 'v0-output',
  experimentId: 'exp:42',
  jobRef: 'manual:job-1'
});
assert.deepEqual(
  cleanedManualViewState,
  {
    type: 'manual',
    mode: 'view',
    baselineRunId: 'v0-output',
    comparisonRunId: '',
    experimentId: '',
    jobRef: '',
    follow: false
  },
  'Expected manual view state to drop duplicate comparison ids and incompatible params.'
);

const defaultManualViewState = parseExperimentRouteState(
  new URLSearchParams('type=manual&mode=view&baselineRunId=default&comparisonRunId=default')
);
assert.deepEqual(
  defaultManualViewState,
  {
    type: 'manual',
    mode: 'view',
    baselineRunId: '',
    comparisonRunId: '',
    experimentId: '',
    jobRef: '',
    follow: false
  },
  'Expected legacy default manual run ids to normalize to an unset manual selection.'
);

const legacyDefaultManualRunState = parseExperimentRouteState(
  new URLSearchParams('type=manual&mode=view&runId=default')
);
assert.equal(
  legacyDefaultManualRunState.baselineRunId,
  '',
  'Expected legacy runId=default manual links not to preserve default as a real run id.'
);

const encodedExperimentQuery = buildExperimentSearchParams(cleanedViewState).toString();
assert.equal(
  encodedExperimentQuery,
  'type=sensitivity&mode=view&experimentId=exp%3A42',
  'Expected deterministic encoding for experiment route deep links.'
);

const encodedManualExperimentQuery = buildExperimentSearchParams({
  type: 'manual',
  mode: 'view',
  baselineRunId: 'v0-output',
  comparisonRunId: 'v4.0-output',
  experimentId: '',
  jobRef: '',
  follow: false
}).toString();
assert.equal(
  encodedManualExperimentQuery,
  'type=manual&mode=view&baselineRunId=v0-output&comparisonRunId=v4.0-output',
  'Expected deterministic encoding for manual baseline/comparison deep links.'
);

const encodedDefaultManualExperimentQuery = buildExperimentSearchParams({
  type: 'manual',
  mode: 'view',
  baselineRunId: 'default',
  comparisonRunId: '',
  experimentId: '',
  jobRef: '',
  follow: false
}).toString();
assert.equal(
  encodedDefaultManualExperimentQuery,
  'type=manual&mode=view',
  'Expected regenerated manual links to omit legacy default run ids.'
);

const commaContainingManualRunId = 'Optimised 2011 model, default, 20-seed v0o7';
const compareSearchParams = buildResultsCompareSearchParams(
  [commaContainingManualRunId],
  ['core_btlLTV'],
  'tail120',
  12
);
assert.deepEqual(
  compareSearchParams.getAll('runId'),
  [commaContainingManualRunId],
  'Expected compare query params to preserve comma-containing run ids as repeated values.'
);
assert.equal(
  compareSearchParams.has('runIds'),
  false,
  'Expected compare query params not to use legacy comma-delimited runIds.'
);
assert.deepEqual(
  compareSearchParams.getAll('indicatorId'),
  ['core_btlLTV'],
  'Expected compare query params to encode indicators as repeated values.'
);
const post500CompareSearchParams = buildResultsCompareSearchParams(
  ['fixture-complete-output'],
  ['core_btlLTV'],
  'post500',
  0
);
assert.equal(
  post500CompareSearchParams.get('window'),
  'post500',
  'Expected compare query params to encode the post500 window.'
);
assert.deepEqual(
  parseResultsCompareQueryValues({ runId: commaContainingManualRunId }, 'runId', 'runIds'),
  [commaContainingManualRunId],
  'Expected repeated compare query parsing to preserve commas inside run ids.'
);
assert.deepEqual(
  parseResultsCompareQueryValues({ runIds: 'legacy-left,legacy-right' }, 'runId', 'runIds'),
  ['legacy-left', 'legacy-right'],
  'Expected legacy comma-delimited compare query parsing to remain supported.'
);

function writeSizedFile(filePath: string, sizeBytes: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.alloc(sizeBytes, 0));
}

class FakeModelProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  private rejectSigterm = false;

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    if (signal === 'SIGTERM' && this.rejectSigterm) {
      return false;
    }
    setTimeout(() => {
      this.emit('close', signal === 'SIGTERM' ? null : 1, signal);
    }, 0);
    return true;
  }

  disableSigtermDelivery(): void {
    this.rejectSigterm = true;
  }

  emitStdout(line: string): void {
    this.stdout.write(`${line}\n`);
  }

  emitStderr(line: string): void {
    this.stderr.write(`${line}\n`);
  }

  succeed(): void {
    this.emit('close', 0, null);
  }

  fail(): void {
    this.emit('close', 1, null);
  }
}

function createFakeLauncher(
  mode: ModelLauncherMode,
  launch: (request: ModelLaunchRequest) => FakeModelProcess
): ModelLauncher {
  return {
    mode,
    metadata: {
      mode,
      commandTemplate: `fake ${mode} launcher`,
      ...(mode === 'maven'
        ? { mavenBin: 'fake-mvn' }
        : { javaExe: 'fake-java', modelJar: 'fake-model.jar' })
    },
    buildCommand: (request) => ({
      command: mode === 'maven' ? 'fake-mvn' : 'fake-java',
      args: mode === 'maven'
        ? ['compile', 'exec:java']
        : ['-jar', 'fake-model.jar', '-configFile', request.configPath, '-outputFolder', request.outputPath, '-dev'],
      options: mode === 'maven'
        ? { cwd: request.repoRoot }
        : { cwd: request.repoRoot, shell: false },
      commandTemplate: `fake ${mode} launcher`
    }),
    launch: (request) => launch(request) as never
  };
}

const launcherSmokeRequest: ModelLaunchRequest = {
  repoRoot: '/repo root',
  configPath: '/tmp/config path/config.properties',
  outputPath: '/tmp/output path'
};
const mavenLauncher = createMavenModelLauncher('mvn-fixture', 'java-fixture');
const mavenCommand = buildMavenModelLaunchCommand('mvn-fixture', launcherSmokeRequest, {
  javaExe: 'java-fixture',
  classpath: '<prepared-classpath>'
});
assert.deepEqual(
  mavenLauncher.buildCommand(launcherSmokeRequest),
  mavenCommand,
  'Expected Maven launcher to use the shared Maven command builder'
);
assert.equal(mavenCommand.command, 'java-fixture', 'Expected Maven launcher child command to use Java after preparation');
assert.deepEqual(
  mavenCommand.args.slice(0, 3),
  ['-cp', '<prepared-classpath>', 'housing.Model'],
  'Expected Maven launcher to use prepared Java classpath execution'
);
assert.ok(
  mavenCommand.args.includes('/tmp/config path/config.properties') && mavenCommand.args.includes('/tmp/output path'),
  'Expected Maven launcher to pass explicit config/output paths as Java arguments'
);
assert.equal(mavenCommand.options.cwd, launcherSmokeRequest.repoRoot, 'Expected Maven launcher to run from repo root');

const apcRequest: ModelLaunchRequest = {
  ...launcherSmokeRequest,
  javaOptions: ['-XX:ActiveProcessorCount=1']
};
const apcMavenCommand = buildMavenModelLaunchCommand('mvn-fixture', apcRequest, {
  javaExe: 'java-fixture',
  classpath: 'prepared-classpath'
});
assert.deepEqual(
  apcMavenCommand.args.slice(0, 4),
  ['-XX:ActiveProcessorCount=1', '-cp', 'prepared-classpath', 'housing.Model'],
  'Expected Maven launches to pass JVM options before -cp'
);
const apcPackagedCommand = buildPackagedModelLaunchCommand('java-fixture', '/tmp/model.jar', apcRequest);
assert.deepEqual(
  apcPackagedCommand.args.slice(0, 3),
  ['-XX:ActiveProcessorCount=1', '-jar', '/tmp/model.jar'],
  'Expected packaged launches to pass JVM options before -jar'
);

const packagedLauncher = createPackagedModelLauncher('/runtime/bin/java', '/app/model.jar');
const packagedCommand = buildPackagedModelLaunchCommand('/runtime/bin/java', '/app/model.jar', launcherSmokeRequest);
assert.deepEqual(
  packagedLauncher.buildCommand(launcherSmokeRequest),
  packagedCommand,
  'Expected packaged launcher to use the shared packaged command builder'
);
assert.equal(packagedCommand.command, '/runtime/bin/java', 'Expected packaged launcher to use bundled Java executable');
assert.deepEqual(
  packagedCommand.args,
  [
    '-jar',
    '/app/model.jar',
    '-configFile',
    launcherSmokeRequest.configPath,
    '-outputFolder',
    launcherSmokeRequest.outputPath,
    '-dev'
  ],
  'Expected packaged launcher to pass Java args as separate array entries'
);
assert.equal(packagedCommand.options.shell, false, 'Expected packaged launcher to disable shell execution');
assert.equal(packagedCommand.options.cwd, launcherSmokeRequest.repoRoot, 'Expected packaged launcher cwd to be repo root');

const runtimePathFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-runtime-defaults-'));
try {
  const developmentPaths = createDevelopmentRuntimePaths(runtimePathFixtureRoot);
  assert.equal(
    developmentPaths.dataRoot,
    path.join(runtimePathFixtureRoot, 'input-data-versions'),
    'Expected development runtime data root to use the repo input-data-versions folder'
  );
  assert.equal(
    developmentPaths.resultsRoot,
    path.join(runtimePathFixtureRoot, 'Results'),
    'Expected development runtime results root to preserve the repo Results folder'
  );
  assert.equal(
    developmentPaths.tempRoot,
    path.join(runtimePathFixtureRoot, 'tmp'),
    'Expected development runtime temp root to preserve the repo tmp folder'
  );
  assert.equal(
    developmentPaths.logsRoot,
    path.join(runtimePathFixtureRoot, 'tmp', 'dashboard-logs'),
    'Expected development runtime logs root to default under repo tmp'
  );

  const desktopPaths = createDesktopRuntimePaths({
    appResourcesRoot: path.join(runtimePathFixtureRoot, 'resources'),
    electronUserDataRoot: path.join(runtimePathFixtureRoot, 'user data'),
    repoRoot: path.join(runtimePathFixtureRoot, 'repo cwd')
  });
  assert.equal(
    desktopPaths.dataRoot,
    path.join(runtimePathFixtureRoot, 'resources', 'release-data', 'input-data-versions'),
    'Expected desktop data root to come from packaged release data'
  );
  assert.equal(
    desktopPaths.resultsRoot,
    path.join(runtimePathFixtureRoot, 'user data', 'Results'),
    'Expected desktop results root to live under Electron userData'
  );
  assert.equal(
    desktopPaths.tempRoot,
    path.join(runtimePathFixtureRoot, 'user data', 'tmp'),
    'Expected desktop temp root to live under Electron userData'
  );
  assert.equal(
    desktopPaths.logsRoot,
    path.join(runtimePathFixtureRoot, 'user data', 'logs'),
    'Expected desktop logs root to live under Electron userData'
  );
  assert.throws(
    () =>
      assertDesktopWritablePathsOutsideResources({
        ...desktopPaths,
        resultsRoot: path.join(desktopPaths.appResourcesRoot ?? '', 'Results')
      }),
    /must not point under app resources/,
    'Expected desktop writable paths under app resources to be rejected'
  );
} finally {
  fs.rmSync(runtimePathFixtureRoot, { recursive: true, force: true });
}

assert.equal(
  parseJavaMajorVersion('openjdk version "25.0.1" 2026-01-21'),
  25,
  'Expected Java major parser to support modern Java versions'
);
assert.equal(
  parseJavaMajorVersion('java version "1.8.0_402"'),
  8,
  'Expected Java major parser to support legacy 1.x Java versions'
);

const runtimeDiagnosticsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-runtime-diagnostics-'));
try {
  const fileBackedRoot = path.join(runtimeDiagnosticsRoot, 'not-a-directory');
  fs.writeFileSync(fileBackedRoot, 'not a directory', 'utf-8');
  const diagnosticPaths: RuntimePaths = {
    ...createDevelopmentRuntimePaths(runtimeDiagnosticsRoot),
    dataRoot: path.join(runtimeDiagnosticsRoot, 'missing-release-data'),
    resultsRoot: fileBackedRoot,
    tempRoot: fileBackedRoot,
    logsRoot: fileBackedRoot
  };
  const diagnostics = checkRuntimeDependencies({
    runtimePaths: diagnosticPaths,
    javaBin: path.join(runtimeDiagnosticsRoot, 'missing-runtime', 'bin', 'java.exe'),
    mavenBin: path.join(runtimeDiagnosticsRoot, 'missing-mvn'),
    modelJar: path.join(runtimeDiagnosticsRoot, 'missing-model.jar')
  });
  assert.equal(diagnostics.java.available, false, 'Expected missing configured Java runtime to be reported');
  assert.ok(diagnostics.java.error, 'Expected missing configured Java runtime to include an error');
  assert.equal(diagnostics.maven.available, false, 'Expected missing Maven to be reported without throwing');
  assert.equal(diagnostics.modelArtifact.exists, false, 'Expected missing model artifact to be reported');
  assert.ok(diagnostics.modelArtifact.error?.includes('missing'), 'Expected missing model artifact error to be clear');
  assert.equal(diagnostics.runtimePaths?.dataRoot.exists, false, 'Expected missing data root to be reported');
  assert.equal(diagnostics.runtimePaths?.resultsRoot.writable, false, 'Expected unwritable results root to be reported');
  assert.equal(diagnostics.runtimePaths?.tempRoot.writable, false, 'Expected unwritable temp root to be reported');
  assert.equal(diagnostics.runtimePaths?.logsRoot.writable, false, 'Expected unwritable logs root to be reported');
} finally {
  fs.rmSync(runtimeDiagnosticsRoot, { recursive: true, force: true });
}

const supportBundleFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-support-bundle-'));
try {
  const supportBundlePaths = createDesktopRuntimePaths({
    appResourcesRoot: path.join(supportBundleFixtureRoot, 'resources'),
    electronUserDataRoot: path.join(supportBundleFixtureRoot, 'user data'),
    repoRoot: path.join(supportBundleFixtureRoot, 'repo')
  });
  fs.mkdirSync(supportBundlePaths.appResourcesRoot ?? '', { recursive: true });
  fs.mkdirSync(supportBundlePaths.logsRoot, { recursive: true });
  fs.mkdirSync(supportBundlePaths.resultsRoot, { recursive: true });
  fs.writeFileSync(
    path.join(supportBundlePaths.appResourcesRoot ?? '', 'release-manifest.json'),
    JSON.stringify({ app: { version: '0.1.0-test' }, releaseData: { sha256: 'release-data-hash' } }),
    'utf-8'
  );
  fs.writeFileSync(path.join(supportBundlePaths.logsRoot, 'app.log'), 'app startup\n', 'utf-8');
  fs.writeFileSync(path.join(supportBundlePaths.logsRoot, 'server.log'), 'server diagnostics\n', 'utf-8');
  fs.writeFileSync(path.join(supportBundlePaths.logsRoot, 'model.log'), 'model run line\n', 'utf-8');
  fs.writeFileSync(path.join(supportBundlePaths.resultsRoot, 'do-not-copy.csv'), 'private result payload\n', 'utf-8');

  const supportBundle = exportDesktopSupportBundle({
    runtimePaths: supportBundlePaths,
    runtimeDiagnostics: {
      java: true,
      modelArtifact: { exists: true },
      runtimePaths: { mode: 'desktop' }
    },
    generatedAt: new Date('2026-05-11T12:34:56.789Z'),
    maxLogBytes: 1024
  });
  assert.ok(fs.existsSync(supportBundle.bundlePath), 'Expected support bundle folder to be created');
  assert.deepEqual(
    supportBundle.files,
    ['logs/app.log', 'logs/model.log', 'logs/server.log', 'metadata.json', 'release-manifest.json', 'runtime-diagnostics.json'],
    'Expected support bundle to include only manifest, diagnostics, metadata, and recent logs'
  );
  assert.ok(
    fs.readFileSync(path.join(supportBundle.bundlePath, 'release-manifest.json'), 'utf-8').includes('0.1.0-test'),
    'Expected support bundle to copy the packaged release manifest'
  );
  assert.ok(
    fs.readFileSync(path.join(supportBundle.bundlePath, 'runtime-diagnostics.json'), 'utf-8').includes('modelArtifact'),
    'Expected support bundle to include runtime diagnostics'
  );
  assert.ok(
    fs.readFileSync(path.join(supportBundle.bundlePath, 'logs', 'model.log'), 'utf-8').includes('model run line'),
    'Expected support bundle to include recent model logs'
  );
  assert.equal(
    fs.existsSync(path.join(supportBundle.bundlePath, 'Results')),
    false,
    'Support bundle must not copy results payloads'
  );
  assert.equal(
    fs.existsSync(path.join(supportBundle.bundlePath, 'private-datasets')),
    false,
    'Support bundle must not copy private dataset material'
  );
} finally {
  fs.rmSync(supportBundleFixtureRoot, { recursive: true, force: true });
}

const expectedIds = [
  'income_given_age_joint',
  'wealth_given_income_joint',
  'age_distribution',
  'uk_housing_stock_totals',
  'household_consumption_fractions',
  'btl_probability_bins',
  'btl_probability_multiplier',
  'national_insurance_rates',
  'income_tax_rates',
  'government_allowance_support',
  'house_price_lognormal',
  'rental_price_lognormal',
  'desired_rent_power',
  'rent_purchase_choice',
  'hpa_expectation_params',
  'hpa_lookback_years',
  'hold_period_years',
  'initial_sale_markup_distribution',
  'price_reduction_probabilities',
  'sale_reduction_gaussian',
  'tenancy_length_range',
  'initial_rent_markup_distribution',
  'rent_reduction_gaussian',
  'days_under_offer',
  'bidup_multiplier',
  'rent_gross_yield',
  'market_average_price_decay',
  'mortgage_duration_years',
  'downpayment_ftb_lognormal',
  'downpayment_oo_lognormal',
  'downpayment_btl_lognormal',
  'downpayment_btl_profile',
  'buy_quad',
  'bank_rate_credit_response',
  'central_bank_base_rate',
  'bank_ltv_limits',
  'central_bank_ltv_limits',
  'bank_lti_limits',
  'central_bank_lti_soft_limits',
  'bank_affordability_icr_limits',
  'central_bank_affordability_icr_limits',
  'bank_age_limit',
  'btl_strategy_split',
  'btl_choice_intensity'
];

const unchangedNewlyAddedIds = [
  'initial_sale_markup_distribution',
  'price_reduction_probabilities',
  'sale_reduction_gaussian',
  'initial_rent_markup_distribution',
  'rent_reduction_gaussian',
  'bidup_multiplier',
  'downpayment_btl_profile',
  'bank_lti_limits',
] as const;

const RESULTS_ROW_COUNT = 2001;

const RESULTS_CORE_FILE_NAMES = [
  'coreIndicator-ooLTV.csv',
  'coreIndicator-ooLTI.csv',
  'coreIndicator-btlLTV.csv',
  'coreIndicator-creditGrowth.csv',
  'coreIndicator-debtToIncome.csv',
  'coreIndicator-ooDebtToIncome.csv',
  'coreIndicator-mortgageApprovals.csv',
  'coreIndicator-housingTransactions.csv',
  'coreIndicator-advancesToFTB.csv',
  'coreIndicator-advancesToBTL.csv',
  'coreIndicator-advancesToHM.csv',
  'coreIndicator-housePriceGrowth.csv',
  'coreIndicator-priceToIncome.csv',
  'coreIndicator-rentalYield.csv',
  'coreIndicator-interestRateSpread.csv'
] as const;

const RESULTS_OUTPUT_COLUMNS = [
  'Model time',
  'nHomeless',
  'nRenting',
  'nOwnerOccupier',
  'nActiveBTL',
  'Sale HPI',
  'Sale AvSalePrice',
  'Sale AvMonthsOnMarket',
  'Rental HPI',
  'Rental AvSalePrice',
  'Rental AvMonthsOnMarket',
  'creditStock',
  'interestRate'
] as const;

interface ResultsFixtureRunIds {
  complete: string;
  commaName: string;
  emptyOutput: string;
  sparseCore: string;
  mixedNanCore: string;
  allNanCore: string;
  malformedCore: string;
  noConfig: string;
}

interface ResultsFixtureContext {
  root: string;
  runIds: ResultsFixtureRunIds;
}

interface ResultsFixtureRunOptions {
  runId: string;
  outputMode: 'full' | 'empty';
  includeConfig: boolean;
  includeTransactionFile: boolean;
  microSnapshotFiles?: string[];
  emptyCoreFiles?: Set<string>;
  coreFileOverrides?: Partial<Record<(typeof RESULTS_CORE_FILE_NAMES)[number], string>>;
  modifiedAtMs: number;
}

function buildOutputCsv(rowCount: number): string {
  const lines = [RESULTS_OUTPUT_COLUMNS.join(';')];
  for (let modelTime = 0; modelTime < rowCount; modelTime += 1) {
    lines.push(
      [
        String(modelTime),
        String(90 + (modelTime % 13)),
        String(800 + modelTime),
        String(700 + (modelTime % 17)),
        String(120 + (modelTime % 7)),
        String(100 + (modelTime % 37)),
        String(220000 + modelTime * 25),
        (2 + (modelTime % 12) / 10).toFixed(2),
        String(95 + (modelTime % 31)),
        (1250 + modelTime * 0.45).toFixed(2),
        (1 + (modelTime % 8) / 10).toFixed(2),
        String(1_000_000 + modelTime * 1200),
        (0.01 + (modelTime % 24) / 10_000).toFixed(4)
      ].join(';')
    );
  }
  return `${lines.join('\n')}\n`;
}

function buildCoreCsv(seed: number, rowCount: number): string {
  const values: string[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    values.push(String(seed + (index % 9) + index * 0.01));
  }
  return `${values.join(';')}\n`;
}

function buildCoreCsvFromTokens(tokens: string[]): string {
  return `${tokens.join(';')}\n`;
}

function buildMixedNonFiniteCoreCsv(rowCount: number): string {
  const missingMarkers = new Map([
    [5, 'NaN'],
    [6, '+NaN'],
    [7, '-NaN'],
    [1985, 'Infinity'],
    [1990, '+Infinity'],
    [1995, '-Infinity']
  ]);
  return buildCoreCsvFromTokens(
    Array.from({ length: rowCount }, (_value, index) => missingMarkers.get(index) ?? String(50 + index))
  );
}

function writeSensitivityCoreOutputs(outputPath: string, parameterValue: number): void {
  fs.mkdirSync(outputPath, { recursive: true });
  for (let index = 0; index < RESULTS_CORE_FILE_NAMES.length; index += 1) {
    const base = parameterValue * 10_000 + (index + 1) * 10;
    const values: string[] = [];
    for (let offset = 0; offset < 240; offset += 1) {
      values.push(String(base + offset * 0.01));
    }
    fs.writeFileSync(path.join(outputPath, RESULTS_CORE_FILE_NAMES[index]), `${values.join(';')}\n`, 'utf-8');
  }
}

function writeResultsFixtureRun(resultsRoot: string, options: ResultsFixtureRunOptions): void {
  const runPath = path.join(resultsRoot, options.runId);
  fs.mkdirSync(runPath, { recursive: true });

  if (options.outputMode === 'full') {
    fs.writeFileSync(path.join(runPath, 'Output-run1.csv'), buildOutputCsv(RESULTS_ROW_COUNT), 'utf-8');
  } else {
    fs.writeFileSync(path.join(runPath, 'Output-run1.csv'), '', 'utf-8');
  }

  for (let index = 0; index < RESULTS_CORE_FILE_NAMES.length; index += 1) {
    const fileName = RESULTS_CORE_FILE_NAMES[index];
    const content =
      options.coreFileOverrides?.[fileName] ??
      (options.emptyCoreFiles?.has(fileName) === true ? '' : buildCoreCsv((index + 1) * 100, RESULTS_ROW_COUNT));
    fs.writeFileSync(path.join(runPath, fileName), content, 'utf-8');
  }

  if (options.includeConfig) {
    fs.writeFileSync(path.join(runPath, 'config.properties'), 'SEED=42\n', 'utf-8');
  }

  if (options.includeTransactionFile) {
    fs.writeFileSync(path.join(runPath, 'RentalTransactions-run1.csv'), 'modelTime;price\n0;1000\n', 'utf-8');
  }

  for (const fileName of options.microSnapshotFiles ?? []) {
    fs.writeFileSync(path.join(runPath, fileName), 'modelTime;value\n0;1\n', 'utf-8');
  }

  const modifiedAt = new Date(options.modifiedAtMs);
  fs.utimesSync(runPath, modifiedAt, modifiedAt);
}

function createResultsFixtureRepo(): ResultsFixtureContext {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-results-smoke-'));
  const resultsRoot = path.join(root, 'Results');
  fs.mkdirSync(resultsRoot, { recursive: true });

  const runIds: ResultsFixtureRunIds = {
    complete: 'fixture-complete-output',
    commaName: 'Optimised 2011 model, default, 20-seed v0o7',
    emptyOutput: 'fixture-empty-output',
    sparseCore: 'fixture-sparse-core-output',
    mixedNanCore: 'fixture-mixed-nan-core-output',
    allNanCore: 'fixture-all-nan-core-output',
    malformedCore: 'fixture-malformed-core-output',
    noConfig: 'fixture-no-config-output'
  };

  const baseTime = Date.now();
  writeResultsFixtureRun(resultsRoot, {
    runId: runIds.complete,
    outputMode: 'full',
    includeConfig: true,
    includeTransactionFile: true,
    microSnapshotFiles: [
      'TotalDebt-run2.csv',
      'HousingStatus-run2.csv',
      'NonHousingConsumption-run2.csv'
    ],
    modifiedAtMs: baseTime + 4000
  });
  writeResultsFixtureRun(resultsRoot, {
    runId: runIds.commaName,
    outputMode: 'full',
    includeConfig: true,
    includeTransactionFile: false,
    modifiedAtMs: baseTime + 3500
  });
  writeResultsFixtureRun(resultsRoot, {
    runId: runIds.noConfig,
    outputMode: 'full',
    includeConfig: false,
    includeTransactionFile: false,
    modifiedAtMs: baseTime + 3000
  });
  writeResultsFixtureRun(resultsRoot, {
    runId: runIds.emptyOutput,
    outputMode: 'empty',
    includeConfig: true,
    includeTransactionFile: false,
    modifiedAtMs: baseTime + 2000
  });
  writeResultsFixtureRun(resultsRoot, {
    runId: runIds.sparseCore,
    outputMode: 'full',
    includeConfig: true,
    includeTransactionFile: false,
    emptyCoreFiles: new Set(['coreIndicator-mortgageApprovals.csv']),
    modifiedAtMs: baseTime + 1000
  });
  writeResultsFixtureRun(resultsRoot, {
    runId: runIds.mixedNanCore,
    outputMode: 'full',
    includeConfig: true,
    includeTransactionFile: false,
    coreFileOverrides: {
      'coreIndicator-btlLTV.csv': buildMixedNonFiniteCoreCsv(RESULTS_ROW_COUNT)
    },
    modifiedAtMs: baseTime + 500
  });
  writeResultsFixtureRun(resultsRoot, {
    runId: runIds.allNanCore,
    outputMode: 'full',
    includeConfig: true,
    includeTransactionFile: false,
    coreFileOverrides: {
      'coreIndicator-btlLTV.csv': buildCoreCsvFromTokens(Array.from({ length: RESULTS_ROW_COUNT }, () => 'NaN'))
    },
    modifiedAtMs: baseTime + 400
  });
  writeResultsFixtureRun(resultsRoot, {
    runId: runIds.malformedCore,
    outputMode: 'full',
    includeConfig: true,
    includeTransactionFile: false,
    coreFileOverrides: {
      'coreIndicator-btlLTV.csv': buildCoreCsvFromTokens(
        Array.from({ length: RESULTS_ROW_COUNT }, (_value, index) => (index === 17 ? 'abc' : String(75 + index)))
      )
    },
    modifiedAtMs: baseTime + 300
  });

  return { root, runIds };
}

function writeSensitivityDownloadFixture(root: string, experimentId: string): void {
  const experimentRoot = path.join(root, 'Results', 'experiments', 'sensitivity', experimentId);
  fs.mkdirSync(experimentRoot, { recursive: true });
  const parameter = {
    key: 'CENTRAL_BANK_INITIAL_BASE_RATE',
    title: 'Central bank base rate',
    description: 'Fixture sensitivity parameter.',
    type: 'number' as const,
    baselineValue: 0.01,
    min: 0,
    max: 0.02,
    sampleCount: 2
  };
  fs.writeFileSync(
    path.join(experimentRoot, 'metadata.json'),
    JSON.stringify({
      experimentId,
      title: 'download fixture',
      baseline: 'v1.0',
      status: 'succeeded',
      createdAt: '2026-05-11T00:00:00.000Z',
      startedAt: '2026-05-11T00:00:01.000Z',
      endedAt: '2026-05-11T00:00:02.000Z',
      seedsPerPoint: 1,
      seeds: [1],
      maxWorkers: 1,
      generalOverrides: {},
      parameter,
      warnings: [],
      warningSummary: { byPoint: {} },
      sampledPoints: [],
      collapsedSlots: {},
      runCommand: {
        mode: 'maven',
        commandTemplate: 'fixture'
      }
    }, null, 2),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(experimentRoot, 'summary.json'),
    JSON.stringify({
      results: {
        experimentId,
        baselinePointId: null,
        points: []
      },
      charts: {
        experimentId,
        parameter,
        windowType: 'tail_120',
        tornado: [],
        deltaTrend: []
      }
    }, null, 2),
    'utf-8'
  );
  fs.writeFileSync(path.join(experimentRoot, 'download-fixture.csv'), 'value\n1\n', 'utf-8');
}

function buildModelRunConfigText(baseSeed: number): string {
  return `SEED = ${baseSeed}
N_STEPS = 2000
N_SIMS = 1
TARGET_POPULATION = 10000
TIME_TO_START_RECORDING_TRANSACTIONS = 1000
ROLLING_WINDOW_SIZE_FOR_CORE_INDICATORS = 6
CUMULATIVE_WEIGHT_BEYOND_YEAR = 0.25
recordTransactions = true
recordNBidUpFrequency = false
recordCoreIndicators = true
recordQualityBandPrice = false
recordHouseholdID = true
recordEmploymentIncome = true
recordRentalIncome = true
recordBankBalance = true
recordHousingWealth = true
recordTotalDebt = false
recordHousingStatus = false
recordConsumption = false
recordNHousesOwned = true
recordAge = true
recordSavingRate = false
CENTRAL_BANK_INITIAL_BASE_RATE = 0.005
CENTRAL_BANK_LTV_HARD_MAX_FTB = 0.95
CENTRAL_BANK_LTV_HARD_MAX_HM = 0.9
CENTRAL_BANK_LTV_HARD_MAX_BTL = 0.8
CENTRAL_BANK_LTI_SOFT_MAX_FTB = 5.4
CENTRAL_BANK_LTI_SOFT_MAX_HM = 5.6
CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_FTB = 0.15
CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_HM = 0.15
CENTRAL_BANK_LTI_MONTHS_TO_CHECK = 12
CENTRAL_BANK_AFFORDABILITY_HARD_MAX = 0.4
CENTRAL_BANK_ICR_HARD_MIN = 1.2
BANK_INITIAL_RATE = 0.035
BANK_LTV_HARD_MAX_FTB = 0.9
BANK_LTV_HARD_MAX_HM = 0.9
BANK_LTV_HARD_MAX_BTL = 0.75
BANK_LTI_HARD_MAX_FTB = 5.4
BANK_LTI_HARD_MAX_HM = 5.6
BANK_AFFORDABILITY_HARD_MAX = 0.4
BANK_ICR_HARD_MIN = 1.2
DATA_AGE_DISTRIBUTION = "src/main/resources/Age.csv"
DATA_INCOME_GIVEN_AGE = "src/main/resources/Income.csv"
`;
}

function writeModelRunFixtureInputData(inputDataRoot: string): void {
  fs.mkdirSync(inputDataRoot, { recursive: true });
  const baselines = ['v0', 'v0oo', 'v0o2', 'v0o7', 'v1.0', 'v1.1', 'v5o3'];
  baselines.forEach((baseline, index) => {
    const baselinePath = path.join(inputDataRoot, baseline);
    fs.mkdirSync(baselinePath, { recursive: true });
    fs.writeFileSync(path.join(baselinePath, 'config.properties'), buildModelRunConfigText(index + 1), 'utf-8');
    fs.writeFileSync(path.join(baselinePath, 'Age.csv'), '0,10,0.1\n', 'utf-8');
    fs.writeFileSync(path.join(baselinePath, 'Income.csv'), '0,10,0.1\n', 'utf-8');
  });

  const dashboardInputVersionHistory = {
    author: 'smoke-test',
    schema_version: 1,
    description: 'fixture',
    entries: [
      {
        version_id: 'v1.1',
        snapshot_folder: 'v1.1',
        validation_dataset: 'R8',
        description: 'fixture in-progress snapshot',
        updated_data_sources: [],
        calibration_files: [],
        config_parameters: [],
        parameter_changes: [],
        method_variations: [],
        validation: {
          status: 'in_progress',
          income_diff_pct: null,
          housing_wealth_diff_pct: null,
          financial_wealth_diff_pct: null
        }
      }
    ]
  };

  fs.writeFileSync(
    path.join(inputDataRoot, 'dashboard-input-version-history.json'),
    JSON.stringify(dashboardInputVersionHistory, null, 2),
    'utf-8'
  );
}

function createModelRunFixtureRepo(prefix = 'dashboard-model-runs-smoke-'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const inputDataRoot = path.join(root, 'input-data-versions');
  const resultsRoot = path.join(root, 'Results');
  writeModelRunFixtureInputData(inputDataRoot);
  fs.mkdirSync(resultsRoot, { recursive: true });
  return root;
}

class FakeRemoteAwsAdapter implements RemoteAwsAdapter {
  runnerState = 'stopped';
  ssmPingStatus = 'Offline';
  runnerVCpus: number | null = 2;
  denyRemoteJobIndexRead = false;
  readonly objects = new Map<string, Buffer>();
  readonly commands: Array<{ commandId: string; script: string; requestKey: string; jobRef: string }> = [];
  readonly commandStatuses = new Map<string, string>();

  constructor(private readonly sourceManifest = { commit: 'remote-fixture-commit', bundleKey: 'tmp/github-actions/source/remote-fixture.bundle' }) {
    this.objects.set(
      'fixture-bucket/tmp/github-actions/source/current-deploy.json',
      Buffer.from(JSON.stringify(sourceManifest), 'utf-8')
    );
  }

  async getRunnerStatus(instanceId: string) {
    const available = this.runnerState === 'running' && this.ssmPingStatus === 'Online';
    return {
      backend: 'aws_ssm' as const,
      configured: true,
      available,
      runnerInstanceId: instanceId,
      runnerState: this.runnerState,
      ssmPingStatus: this.ssmPingStatus,
      runnerVCpus: this.runnerVCpus,
      reason: available ? null : `EC2 runner is ${this.runnerState}.`,
      checkedAt: new Date().toISOString()
    };
  }

  async getSourceDeployManifest() {
    return this.sourceManifest;
  }

  async putJson(bucket: string, key: string, value: unknown): Promise<void> {
    this.objects.set(`${bucket}/${key}`, Buffer.from(JSON.stringify(value), 'utf-8'));
  }

  async getJson<T>(bucket: string, key: string): Promise<T | null> {
    const value = await this.getText(bucket, key);
    return value ? (JSON.parse(value) as T) : null;
  }

  async getBytes(bucket: string, key: string): Promise<Buffer | null> {
    if (this.denyRemoteJobIndexRead && key === 'experiments/remote-job-index/index.json') {
      const error = new Error('raw AWS AccessDenied fixture: arn:aws:sts::fixture:assumed-role/example');
      error.name = 'AccessDenied';
      throw error;
    }
    const value = this.objects.get(`${bucket}/${key}`);
    return value ? Buffer.from(value) : null;
  }

  async getText(bucket: string, key: string): Promise<string | null> {
    const value = await this.getBytes(bucket, key);
    return value ? value.toString('utf-8') : null;
  }

  async listObjects(bucket: string, prefix: string): Promise<Array<{ key: string; sizeBytes: number; modifiedAt: string | null }>> {
    const bucketPrefix = `${bucket}/${prefix}`;
    return [...this.objects.entries()]
      .filter(([key]) => key.startsWith(bucketPrefix))
      .map(([key, value]) => ({
        key: key.slice(bucket.length + 1),
        sizeBytes: value.length,
        modifiedAt: new Date('2026-05-11T00:00:00.000Z').toISOString()
      }));
  }

  async sendRunCommand(input: {
    instanceId: string;
    bucket: string;
    region: string;
    requestKey: string;
    jobRef: string;
  }): Promise<string> {
    const commandId = `command-${this.commands.length + 1}`;
    this.commands.push({
      commandId,
      script: buildRemoteRunnerScript(input),
      requestKey: input.requestKey,
      jobRef: input.jobRef
    });
    this.commandStatuses.set(commandId, 'InProgress');
    return commandId;
  }

  async getCommandInvocation(_instanceId: string, commandId: string): Promise<{ status: string; stdout: string; stderr: string } | null> {
    const command = this.commands.find((item) => item.commandId === commandId);
    if (command?.jobRef.startsWith('sensitivity:')) {
      const experimentId = command.jobRef.slice('sensitivity:'.length);
      return {
        status: this.commandStatuses.get(commandId) ?? 'InProgress',
        stdout: [
          `[sensitivity:${experimentId}] [system] Worker 1/2 started point 0 (point-0) seed-1; progress 0.0/2 (0.0%), completed 0/2, active workers 1/2, throughput pending, ETA pending, finish pending`,
          `[progress] ${JSON.stringify({
            kind: 'sensitivity',
            status: 'running',
            totalRuns: 2,
            completedRuns: 0,
            failedRuns: 0,
            canceledRuns: 0,
            activeRuns: 1,
            totalWorkers: 2,
            activeWorkers: 1,
            completedRunEquivalents: 0.5,
            percentComplete: 25,
            throughputRunsPerMinute: 1.5,
            completedRunsPerMinute: 0,
            etaSeconds: 60,
            estimatedFinishAt: '2026-05-11T00:01:00.000Z',
            elapsedSeconds: 20,
            startedAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:20.000Z'
          })}`,
          'Simulation: 1, time: 500',
          'remote stdout fixture'
        ].join('\n'),
        stderr: ''
      };
    }
    return {
      status: this.commandStatuses.get(commandId) ?? 'InProgress',
      stdout: [
        `[progress] ${JSON.stringify({
          kind: 'manual',
          status: 'running',
          totalRuns: 3,
          completedRuns: 1,
          failedRuns: 0,
          canceledRuns: 0,
          activeRuns: 2,
          totalWorkers: 2,
          activeWorkers: 2,
          completedRunEquivalents: 1.5,
          percentComplete: 50,
          throughputRunsPerMinute: 3,
          completedRunsPerMinute: 2,
          etaSeconds: 30,
          estimatedFinishAt: '2026-05-11T00:00:50.000Z',
          elapsedSeconds: 30,
          startedAt: '2026-05-11T00:00:00.000Z',
          updatedAt: '2026-05-11T00:00:20.000Z'
        })}`,
        'Simulation: 1, time: 500',
        'remote stdout fixture'
      ].join('\n'),
      stderr: ''
    };
  }

  async cancelCommand(_instanceId: string, commandId: string): Promise<void> {
    this.commandStatuses.set(commandId, 'Cancelled');
  }

  async deleteObjects(bucket: string, keys: string[]): Promise<void> {
    for (const key of keys) {
      this.objects.delete(`${bucket}/${key}`);
    }
  }
}

function uploadCompleteRemoteManualResult(
  adapter: FakeRemoteAwsAdapter,
  bucket: string,
  runPrefix: string,
  options: {
    outputOffset?: number;
    includeExtraArtifact?: boolean;
  } = {}
): void {
  const outputOffset = options.outputOffset ?? 0;
  const outputCsv = buildOutputCsv(RESULTS_ROW_COUNT)
    .split('\n')
    .map((line, index) => {
      if (index === 0 || line.trim().length === 0 || outputOffset === 0) {
        return line;
      }
      const tokens = line.split(';');
      return tokens
        .map((token, tokenIndex) => {
          if (tokenIndex === 0) {
            return token;
          }
          const numeric = Number.parseFloat(token);
          return Number.isFinite(numeric) ? String(numeric + outputOffset) : token;
        })
        .join(';');
    })
    .join('\n');

  adapter.objects.set(`${bucket}/${runPrefix}/Output-run1.csv`, Buffer.from(outputCsv, 'utf-8'));
  adapter.objects.set(`${bucket}/${runPrefix}/config.properties`, Buffer.from('SEED=1\n', 'utf-8'));
  for (let index = 0; index < RESULTS_CORE_FILE_NAMES.length; index += 1) {
    const fileName = RESULTS_CORE_FILE_NAMES[index];
    adapter.objects.set(
      `${bucket}/${runPrefix}/${fileName}`,
      Buffer.from(buildCoreCsv((index + 1) * 100 + outputOffset, RESULTS_ROW_COUNT), 'utf-8')
    );
  }
  if (options.includeExtraArtifact) {
    adapter.objects.set(
      `${bucket}/${runPrefix}/RentalTransactions-run1.csv`,
      Buffer.from('modelTime;price\n0;1000\n', 'utf-8')
    );
  }
}

const remoteFixtureRoot = createModelRunFixtureRepo('dashboard-remote-execution-smoke-');
try {
  const remoteConfig: RemoteExecutionConfig = {
    region: 'eu-west-2',
    runnerInstanceId: 'i-remote-fixture',
    artifactsBucket: 'fixture-bucket',
    maxActiveRemoteRuns: 1
  };
  const remoteAdapter = new FakeRemoteAwsAdapter();
  const remoteManager = new RemoteExecutionManager(remoteConfig, remoteAdapter);
  remoteAdapter.denyRemoteJobIndexRead = true;
  await assert.rejects(
    () => remoteManager.listExperimentJobs(),
    (error: unknown) => error instanceof RemoteExecutionUnavailableError &&
      !error.message.includes('arn:aws:sts::fixture'),
    'Expected remote job index AccessDenied errors to be sanitized'
  );
  remoteAdapter.denyRemoteJobIndexRead = false;
  const remoteOptions = getModelRunOptions(remoteFixtureRoot, 'v1.0', true);
  const unavailableOptions = await remoteManager.decorateModelRunOptions(remoteOptions);
  assert.equal(unavailableOptions.executionEnabled, false, 'Expected stopped remote runner to disable execution options');
  assert.equal(unavailableOptions.executionBackend, 'aws_ssm', 'Expected remote options to identify AWS SSM backend');
  assert.equal(unavailableOptions.remoteExecution?.runnerVCpus, 2, 'Expected remote status to expose runner vCPUs');
  assert.equal(unavailableOptions.sensitivityMaxWorkersCap, 2, 'Expected remote options to cap sensitivity workers by runner vCPUs');
  assert.ok(
    unavailableOptions.executionDisabledReason?.includes('stopped'),
    'Expected stopped remote runner reason to be surfaced in options'
  );
  await assert.rejects(
    () => remoteManager.submitModelRun(remoteFixtureRoot, {
      baseline: 'v1.0',
      title: 'remote stopped fixture',
      overrides: {},
      confirmWarnings: true
    }),
    /stopped/,
    'Expected stopped remote runner to reject submissions before SSM dispatch'
  );

  remoteAdapter.runnerState = 'running';
  remoteAdapter.ssmPingStatus = 'Online';
  const availableOptions = await remoteManager.decorateModelRunOptions(remoteOptions);
  assert.equal(availableOptions.executionEnabled, true, 'Expected running SSM-ready runner to enable execution options');
  assert.equal(availableOptions.remoteExecution?.runnerVCpus, 2, 'Expected running remote status to preserve runner vCPUs');
  assert.equal(availableOptions.sensitivityMaxWorkersCap, 2, 'Expected running remote options to cap sensitivity workers by runner vCPUs');

  const manualSubmit = await remoteManager.submitModelRun(remoteFixtureRoot, {
    baseline: 'v1.0',
    title: 'remote manual fixture',
    overrides: { N_SIMS: 3 },
    maxWorkers: 20,
    confirmWarnings: true
  });
  assert.equal(manualSubmit.accepted, true, 'Expected remote manual run to be accepted');
  assert.equal(manualSubmit.job?.maxWorkers, 2, 'Expected remote manual metadata to cap maxWorkers by runner vCPUs');
  assert.equal(remoteAdapter.commands.length, 1, 'Expected remote manual submit to dispatch one SSM command');
  const manualCommand = remoteAdapter.commands[0];
  assert.ok(
    manualCommand?.script.startsWith("exec /bin/bash <<'REMOTE_RUNNER_SCRIPT'\n"),
    'Expected SSM command to explicitly execute the remote runner script with Bash'
  );
  assert.notEqual(
    manualCommand?.script.split('\n')[0],
    'set -euo pipefail',
    'Expected Bash-only strict mode not to be interpreted by the SSM default shell'
  );
  const manualScript = manualCommand?.script ?? '';
  assert.ok(
    manualScript.includes('export HOME="${HOME:-/var/tmp/uk-housing-dashboard-ssm}"'),
    'Expected remote runner to set a safe HOME when SSM leaves HOME unset'
  );
  assert.ok(
    manualScript.includes('activate_node_runtime'),
    'Expected remote runner to activate Node before using node or npm'
  );
  assert.ok(
    manualScript.includes('/home/ubuntu/.nvm'),
    'Expected remote runner to search the Ubuntu nvm install used by the EC2 runner'
  );
  assert.ok(
    manualScript.includes('activate_java_runtime'),
    'Expected remote runner to activate Java before invoking the Maven wrapper'
  );
  assert.ok(
    manualScript.includes('/home/ubuntu/.sdkman'),
    'Expected remote runner to search the Ubuntu SDKMAN install used by the EC2 runner'
  );
  assert.ok(
    manualScript.includes('set +u\n    . "$SDKMAN_DIR/bin/sdkman-init.sh"\n    set -u'),
    'Expected remote runner to source SDKMAN with nounset disabled because SDKMAN reads optional variables'
  );
  const nodeActivationCallIndex = manualScript.indexOf('\nactivate_node_runtime\nactivate_java_runtime()');
  const javaActivationCallIndex = manualScript.indexOf('\nactivate_java_runtime\nRUN_SEGMENT=');
  assert.ok(
    nodeActivationCallIndex > 0 &&
      javaActivationCallIndex > nodeActivationCallIndex &&
      manualScript.indexOf('cleanup_failure()') > javaActivationCallIndex,
    'Expected remote runner to activate Node and Java before registering cleanup logic that writes failure status'
  );
  assert.ok(
    javaActivationCallIndex > 0 &&
      manualScript.indexOf('"$NODE_BIN" --import tsx/esm server/remoteRunnerCli.ts') >
        javaActivationCallIndex,
    'Expected remote runner to activate Java before starting the TypeScript runner that invokes Maven'
  );
  assert.ok(
    manualScript.includes('RUN_BASE="$HOME/remote-runs"'),
    'Expected remote runner working directory to use the safe HOME value'
  );
  assert.ok(
    manualScript.includes('RUN_SEGMENT="$("$NODE_BIN" -e'),
    'Expected remote runner to sanitize job refs before using them in filesystem paths'
  );
  assert.ok(
    manualScript.includes('RUN_ROOT="$RUN_BASE/$RUN_SEGMENT"'),
    'Expected remote runner working directory to avoid raw job refs because colons break Java classpaths'
  );
  assert.equal(
    manualScript.includes('RUN_ROOT="$RUN_BASE/$JOB_REF"'),
    false,
    'Expected remote runner working directory not to include raw job refs'
  );
  assert.equal(
    manualScript.includes('RUN_ROOT="$HOME/remote-runs/$JOB_REF"'),
    false,
    'Expected remote runner working directory not to depend on HOME under set -u'
  );
  assert.ok(
    manualScript.includes('"$NODE_BIN" - "$ARTIFACT_DIR/remote-status.json"'),
    'Expected failure status writer to use the activated Node binary'
  );
  assert.ok(
    manualScript.includes('BUNDLE_KEY="$("$NODE_BIN" -e'),
    'Expected request JSON parsing to use the activated Node binary'
  );
  assert.ok(
    manualScript.includes('"$NPM_BIN" ci --include=dev'),
    'Expected dependency installation to use the activated npm binary'
  );
  assert.ok(
    manualScript.includes('"$NODE_BIN" --import tsx/esm server/remoteRunnerCli.ts'),
    'Expected fixed SSM command to call the remote runner CLI with the activated Node binary'
  );
  assert.equal(manualCommand?.requestKey.includes(':'), false, 'Expected remote request S3 keys to be sanitized');
  assert.ok(
    manualScript.includes('aws s3 sync "$ARTIFACT_DIR/"'),
    'Expected fixed SSM command to sync only the artifact directory'
  );
  assert.ok(
    manualScript.includes('sync_remote_runner_log &') &&
      manualScript.includes('aws s3 cp "$ARTIFACT_DIR/logs/remote-runner.log"'),
    'Expected SSM command to sync the remote runner log while the job is still running'
  );
  assert.equal(
    manualScript.includes('aws s3 sync "$SOURCE_DIR"'),
    false,
    'Expected fixed SSM command not to sync the source checkout'
  );
  assert.equal(
    manualScript.includes('private-datasets'),
    false,
    'Expected fixed SSM command not to reference private dataset paths'
  );
  assert.equal(
    manualScript.includes('/agents'),
    false,
    'Expected fixed SSM command not to sync operational agent paths'
  );
  assert.ok(
    remoteAdapter.objects.has(`fixture-bucket/${manualCommand?.requestKey ?? ''}`),
    'Expected remote submit to persist a request JSON to S3 before dispatch'
  );
  const manualRequest = JSON.parse(
    remoteAdapter.objects.get(`fixture-bucket/${manualCommand?.requestKey ?? ''}`)?.toString('utf-8') ?? '{}'
  ) as { artifactS3Prefix?: string; payload?: Record<string, unknown> };
  const manualArtifactPrefix = manualRequest.artifactS3Prefix ?? '';
  assert.ok(manualArtifactPrefix, 'Expected remote manual request to include an artifact prefix');
  assert.equal(
    manualRequest.payload?.maxWorkers,
    2,
    'Expected remote manual request payload to cap maxWorkers by runner vCPUs'
  );
  const liveManualLogs = await remoteManager.getExperimentJobLogs(`manual:${manualSubmit.job?.jobId ?? ''}`, 0, 20);
  assert.equal(liveManualLogs.progress?.percentComplete, 50, 'Expected remote SSM manual logs to expose progress');
  assert.ok(
    liveManualLogs.lines.every((line) => !line.includes('[progress]') && !line.includes('"percentComplete"')),
    'Expected remote SSM manual logs to consume raw progress JSON as structured progress'
  );
  assert.ok(
    liveManualLogs.lines.some((line) => line.includes('remote stdout fixture')),
    'Expected remote logs endpoint to expose SSM output while artifacts are not yet synced'
  );
  assert.ok(
    liveManualLogs.lines.some((line) => line.includes('Simulation: 1, time: 500')),
    'Expected remote SSM manual logs to preserve Java simulation-time stdout'
  );
  const liveManualModelLogs = await remoteManager.getModelRunJobLogs(manualSubmit.job?.jobId ?? '', 0, 20);
  assert.equal(
    liveManualModelLogs.progress?.percentComplete,
    50,
    'Expected remote manual model-run logs endpoint to expose SSM fallback progress'
  );
  remoteAdapter.objects.set(
    `fixture-bucket/${manualArtifactPrefix}logs/remote-runner.log`,
    Buffer.from([
      `[manual:${manualSubmit.job?.jobId ?? ''}] [system] Worker 2/2 running seed-2; progress 2.0/3 (66.7%), completed 2/3, active workers 1/2, throughput 3.00/min, ETA 20s, finish pending`,
      `[progress] ${JSON.stringify({
        kind: 'manual',
        status: 'running',
        totalRuns: 3,
        completedRuns: 2,
        failedRuns: 0,
        canceledRuns: 0,
        activeRuns: 1,
        totalWorkers: 2,
        activeWorkers: 1,
        completedRunEquivalents: 2,
        percentComplete: 66.6666666667,
        throughputRunsPerMinute: 3,
        completedRunsPerMinute: 3,
        etaSeconds: 20,
        estimatedFinishAt: '2026-05-11T00:00:50.000Z',
        elapsedSeconds: 40,
        startedAt: '2026-05-11T00:00:00.000Z',
        updatedAt: '2026-05-11T00:00:40.000Z'
      })}`,
      `[manual:${manualSubmit.job?.jobId ?? ''}] [stdout] live remote-runner artifact fixture`
    ].join('\n'), 'utf-8')
  );
  const liveManualArtifactLogs = await remoteManager.getExperimentJobLogs(`manual:${manualSubmit.job?.jobId ?? ''}`, 0, 20);
  assert.equal(
    Math.round(liveManualArtifactLogs.progress?.percentComplete ?? 0),
    67,
    'Expected running remote manual jobs to expose progress from live S3 remote-runner logs'
  );
  assert.ok(
    liveManualArtifactLogs.lines.some((line) => line.includes('live remote-runner artifact fixture')),
    'Expected running remote manual jobs to expose live S3 remote-runner log lines before completion'
  );
  remoteAdapter.commandStatuses.set(manualCommand?.commandId ?? '', 'Success');
  const remoteRunPrefix = manualSubmit.job?.outputPath.replace('s3://fixture-bucket/', '') ?? '';
  const remoteManualBinaryFixture = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x61, 0xc3, 0x28, 0x0a]);
  uploadCompleteRemoteManualResult(remoteAdapter, 'fixture-bucket', remoteRunPrefix, { includeExtraArtifact: true });
  remoteAdapter.objects.set(`fixture-bucket/${remoteRunPrefix}/binary-output.bin`, remoteManualBinaryFixture);
  const manualJobs = await remoteManager.listModelRunJobs();
  assert.equal(manualJobs.jobs[0]?.status, 'succeeded', 'Expected SSM Success to refresh remote manual job status');

  const comparisonRunId = 'remote-comparison-output';
  const comparisonArtifactPrefix = 'experiments/manual/2099-01-01/remote-comparison/';
  const comparisonRunPrefix = `${comparisonArtifactPrefix}Results/${comparisonRunId}`;
  uploadCompleteRemoteManualResult(remoteAdapter, 'fixture-bucket', comparisonRunPrefix, { outputOffset: 25 });
  const remoteIndex = JSON.parse(
    remoteAdapter.objects.get('fixture-bucket/experiments/remote-job-index/index.json')?.toString('utf-8') ?? '{}'
  ) as { jobs: Array<Record<string, unknown>>; updatedAt: string };
  const comparisonJob = {
    ...(remoteIndex.jobs[0] ?? {}),
    jobRef: `manual:${comparisonRunId}`,
    type: 'manual',
    id: comparisonRunId,
    title: 'remote comparison fixture',
    status: 'succeeded',
    createdAt: '2026-05-11T00:01:00.000Z',
    startedAt: '2026-05-11T00:01:01.000Z',
    endedAt: '2026-05-11T00:01:02.000Z',
    runId: comparisonRunId,
    outputPath: `s3://fixture-bucket/${comparisonRunPrefix}`,
    configPath: `s3://fixture-bucket/${comparisonRunPrefix}/config.properties`,
    artifactS3Prefix: comparisonArtifactPrefix,
    requestKey: `${comparisonArtifactPrefix}request.json`
  };
  remoteIndex.jobs.push(comparisonJob);
  remoteIndex.updatedAt = '2026-05-11T00:01:02.000Z';
  remoteAdapter.objects.set(
    'fixture-bucket/experiments/remote-job-index/index.json',
    Buffer.from(JSON.stringify(remoteIndex), 'utf-8')
  );

  const remoteManualResults = await remoteManager.listRemoteManualResultRuns();
  assert.equal(
    remoteManualResults.runs.some((run) => run.runId === manualSubmit.job?.runId && run.path.startsWith('s3://fixture-bucket/')),
    true,
    'Expected remote manual results list to expose S3-backed run artifacts'
  );
  const defaultRemoteRunId = remoteManualResults.runs[0]?.runId ?? '';
  const remoteDefaultDetail = await remoteManager.getRemoteManualResultDetail('default');
  assert.equal(
    remoteDefaultDetail.runId,
    defaultRemoteRunId,
    'Expected remote default manual detail reads to resolve to the first listed manual result'
  );
  const remoteDefaultCompare = await remoteManager.getRemoteManualResultCompare(
    ['default'],
    ['core_btlLTV'],
    'tail120',
    0
  );
  assert.equal(
    remoteDefaultCompare.runIds[0],
    defaultRemoteRunId,
    'Expected remote default manual compare reads to resolve to the first listed manual result'
  );
  assert.equal(
    remoteDefaultCompare.indicators[0]?.seriesByRun[0]?.points.length,
    120,
    'Expected remote default manual compare reads to expose overlay points'
  );
  const remoteManualSummary = remoteManualResults.runs.find((run) => run.runId === manualSubmit.job?.runId);
  assert.equal(remoteManualSummary?.status, 'complete', 'Expected complete remote manual artifacts to parse as complete');
  assert.deepEqual(
    remoteManualSummary?.parseCoverage,
    {
      requiredCount: 16,
      supportedCount: 16,
      emptyCount: 0,
      errorCount: 0
    },
    'Expected remote manual results list to expose parsed coverage for S3 artifacts'
  );
  const remoteManualFiles = await remoteManager.getRemoteManualResultFiles(manualSubmit.job?.runId ?? '');
  assert.equal(
    remoteManualFiles.files.some((file) => file.fileName === 'Output-run1.csv' && file.filePath.startsWith('s3://fixture-bucket/')),
    true,
    'Expected remote manual result files endpoint to expose S3 object paths'
  );
  assert.equal(
    remoteManualFiles.files.find((file) => file.fileName === 'Output-run1.csv')?.coverageStatus,
    'supported',
    'Expected remote Output-run1.csv to be parsed as supported'
  );
  assert.equal(
    remoteManualFiles.files.find((file) => file.fileName === 'coreIndicator-btlLTV.csv')?.coverageStatus,
    'supported',
    'Expected remote core indicators to be parsed as supported'
  );
  assert.equal(
    remoteManualFiles.files.find((file) => file.fileName === 'RentalTransactions-run1.csv')?.coverageStatus,
    'unsupported',
    'Expected remote non-charted CSV artifacts to remain unsupported'
  );
  const remoteManualDetail = await remoteManager.getRemoteManualResultDetail(manualSubmit.job?.runId ?? '');
  assert.equal(
    remoteManualDetail.indicators.find((indicator) => indicator.id === 'core_btlLTV')?.available,
    true,
    'Expected parsed remote core indicators to be available for visualization'
  );
  assert.ok(
    (remoteManualDetail.kpiSummary.find((kpi) => kpi.indicatorId === 'core_btlLTV')?.mean ?? null) !== null,
    'Expected parsed remote results to expose KPI summaries'
  );
  const remoteCoreSeries = await remoteManager.getRemoteManualResultSeries(manualSubmit.job?.runId ?? '', 'core_btlLTV', 0);
  assert.equal(remoteCoreSeries.points.length, RESULTS_ROW_COUNT, 'Expected remote core series to expose parsed points');
  const remoteOutputSeries = await remoteManager.getRemoteManualResultSeries(manualSubmit.job?.runId ?? '', 'output_nHomeless', 0);
  assert.equal(remoteOutputSeries.points[0]?.value, 90, 'Expected remote output series to parse Output-run1.csv values');
  const remoteCompare = await remoteManager.getRemoteManualResultCompare(
    [manualSubmit.job?.runId ?? '', comparisonRunId],
    ['core_btlLTV'],
    'tail120',
    0
  );
  assert.equal(remoteCompare.indicators[0]?.seriesByRun.length, 2, 'Expected remote compare to include both S3-backed runs');
  assert.equal(
    remoteCompare.indicators[0]?.seriesByRun[0]?.points.length,
    120,
    'Expected remote compare to apply the requested result window'
  );
  const remoteManualArchiveText = await readArchiveText(
    (await remoteManager.getRemoteManualResultArchive(manualSubmit.job?.runId ?? '')).stream
  );
  assert.ok(
    remoteManualArchiveText.includes('Output-run1.csv') && remoteManualArchiveText.includes('SEED=1'),
    'Expected remote manual result archive to include S3 artifact files'
  );
  const remoteManualArchiveEntries = await readArchiveEntries(
    (await remoteManager.getRemoteManualResultArchive(manualSubmit.job?.runId ?? '')).stream
  );
  const remoteManualBinaryArchiveEntry = [...remoteManualArchiveEntries.entries()]
    .find(([name]) => name.endsWith('/binary-output.bin'));
  assert.deepEqual(
    remoteManualBinaryArchiveEntry?.[1],
    remoteManualBinaryFixture,
    'Expected remote manual result archive to preserve binary S3 artifact bytes'
  );
  await assert.rejects(
    () => remoteManager.deleteRemoteManualResultRun('default'),
    /Unknown remote manual result run: default/,
    'Expected remote manual delete to keep rejecting default instead of deleting the latest run'
  );
  remoteAdapter.objects.set(
    `fixture-bucket/${manualArtifactPrefix}logs/remote-runner.log`,
    Buffer.from([
      `[manual:${manualSubmit.job?.jobId ?? ''}] [system] Worker 2/2 finished seed-3 with status succeeded; progress 3.0/3 (100.0%), completed 3/3, active workers 0/2, throughput 3.00/min, ETA pending, finish pending`,
      `[progress] ${JSON.stringify({
        kind: 'manual',
        status: 'succeeded',
        totalRuns: 3,
        completedRuns: 3,
        failedRuns: 0,
        canceledRuns: 0,
        activeRuns: 0,
        totalWorkers: 2,
        activeWorkers: 0,
        completedRunEquivalents: 3,
        percentComplete: 100,
        throughputRunsPerMinute: 3,
        completedRunsPerMinute: 3,
        etaSeconds: null,
        estimatedFinishAt: null,
        elapsedSeconds: 60,
        startedAt: '2026-05-11T00:00:00.000Z',
        endedAt: '2026-05-11T00:01:00.000Z',
        updatedAt: '2026-05-11T00:01:00.000Z'
      })}`,
      `[manual:${manualSubmit.job?.jobId ?? ''}] [stdout] Simulation: 1, time: 1000`,
      `[manual:${manualSubmit.job?.jobId ?? ''}] [stdout] remote artifact stdout fixture`
    ].join('\n'), 'utf-8')
  );
  const manualLogs = await remoteManager.getExperimentJobLogs(`manual:${manualSubmit.job?.jobId ?? ''}`, 0, 20);
  assert.equal(manualLogs.progress?.percentComplete, 100, 'Expected remote artifact manual logs to expose final progress');
  assert.ok(
    manualLogs.lines.every((line) => !line.includes('[progress]') && !line.includes('"percentComplete"')),
    'Expected remote artifact manual logs to consume raw progress JSON as structured progress'
  );
  assert.ok(
    manualLogs.lines.some((line) => line.includes('Simulation: 1, time: 1000')),
    'Expected remote artifact manual logs to preserve Java simulation-time stdout'
  );
  remoteAdapter.objects.set(
    'fixture-bucket/experiments/manual/2099-01-01/unrelated/keep.txt',
    Buffer.from('keep me', 'utf-8')
  );
  const remoteManualQueueDelete = await remoteManager.deleteExperimentJob(`manual:${manualSubmit.job?.jobId ?? ''}`);
  assert.equal(remoteManualQueueDelete.deleted, true, 'Expected unified remote manual queue delete to report success');
  assert.equal(remoteManualQueueDelete.runId, manualSubmit.job?.runId, 'Expected remote queue delete to preserve runId');
  assert.equal(
    remoteAdapter.objects.has(`fixture-bucket/${manualCommand?.requestKey ?? ''}`),
    false,
    'Expected remote manual delete to remove the request object'
  );
  assert.equal(
    [...remoteAdapter.objects.keys()].some((key) => key.startsWith(`fixture-bucket/${remoteRunPrefix}`)),
    false,
    'Expected remote manual delete to remove current artifact objects'
  );
  assert.equal(
    remoteAdapter.objects.has('fixture-bucket/experiments/manual/2099-01-01/unrelated/keep.txt'),
    true,
    'Expected remote manual delete to leave unrelated S3 objects intact'
  );
  await assert.rejects(
    () => remoteManager.getRemoteManualResultFiles(manualSubmit.job?.runId ?? ''),
    /Unknown remote manual result run/,
    'Expected deleted remote manual result to be removed from the index'
  );

  const sensitivitySubmit = await remoteManager.submitSensitivityExperiment(remoteFixtureRoot, {
    baseline: 'v1.0',
    title: 'remote sensitivity fixture',
    parameterKey: 'CENTRAL_BANK_INITIAL_BASE_RATE',
    min: 0,
    max: 1,
    sampleCount: 2,
    overrides: { N_SIMS: 1 },
    maxWorkers: 20,
    confirmWarnings: true
  });
  assert.equal(sensitivitySubmit.accepted, true, 'Expected remote sensitivity experiment to be accepted');
  assert.equal(
    sensitivitySubmit.experiment?.maxWorkers,
    2,
    'Expected remote sensitivity metadata to cap maxWorkers by runner vCPUs'
  );
  assert.equal(remoteAdapter.commands.length, 2, 'Expected remote sensitivity submit to dispatch one SSM command');
  const sensitivityExperimentId = sensitivitySubmit.experiment?.experimentId ?? '';
  const sensitivityParameter = sensitivitySubmit.experiment?.parameter;
  assert.ok(sensitivityParameter, 'Expected remote sensitivity submit response to include parameter metadata');
  const sensitivityCommand = remoteAdapter.commands[1];
  const sensitivityRequest = JSON.parse(
    remoteAdapter.objects.get(`fixture-bucket/${sensitivityCommand?.requestKey ?? ''}`)?.toString('utf-8') ?? '{}'
  ) as {
    artifactS3Prefix?: string;
    preparedSensitivity?: { experimentId?: string };
    payload?: Record<string, unknown>;
  };
  assert.equal(
    sensitivityRequest.preparedSensitivity?.experimentId,
    sensitivityExperimentId,
    'Expected remote sensitivity request to carry the API-prepared experiment id'
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(sensitivityRequest.payload ?? {}, 'experimentId'),
    false,
    'Expected public sensitivity payload not to carry a client-supplied experiment id'
  );
  assert.equal(
    sensitivityRequest.payload?.maxWorkers,
    2,
    'Expected remote sensitivity request payload to cap maxWorkers by runner vCPUs'
  );
  const remoteJobs = await remoteManager.listExperimentJobs();
  assert.ok(
    remoteJobs.jobs.some((job) => job.jobRef === `sensitivity:${sensitivityExperimentId}`),
    'Expected unified remote job list to include sensitivity jobs'
  );
  assert.equal(
    remoteJobs.locks.manualSubmissionLocked,
    true,
    'Expected active remote sensitivity job to lock manual submission'
  );
  const remoteSensitivityLogs = await remoteManager.getExperimentJobLogs(`sensitivity:${sensitivityExperimentId}`, 0, 20);
  assert.equal(remoteSensitivityLogs.progress?.percentComplete, 25, 'Expected remote SSM sensitivity logs to expose progress');
  assert.ok(
    remoteSensitivityLogs.lines.some((line) => line.includes('Worker 1/2 started point')),
    'Expected remote SSM sensitivity logs to expose summarized worker lifecycle lines'
  );
  assert.ok(
    remoteSensitivityLogs.lines.every((line) => !line.includes('Simulation: 1, time') && !line.includes('remote stdout fixture')),
    'Expected remote SSM sensitivity logs to filter raw JVM and shell stdout noise'
  );
  const sensitivityArtifactPrefix = sensitivityRequest.artifactS3Prefix ?? '';
  remoteAdapter.objects.set(
    `fixture-bucket/${sensitivityArtifactPrefix}logs/remote-runner.log`,
    Buffer.from([
      '[system] Remote runner starting sensitivity fixture',
      `[sensitivity:${sensitivityExperimentId}] [system] Worker 2/2 started point 1 (point-1) seed-1; progress 1.0/2 (50.0%), completed 1/2, active workers 1/2, throughput 3.00/min, ETA 20s, finish pending`,
      `[progress] ${JSON.stringify({
        kind: 'sensitivity',
        status: 'running',
        totalRuns: 2,
        completedRuns: 1,
        failedRuns: 0,
        canceledRuns: 0,
        activeRuns: 1,
        totalWorkers: 2,
        activeWorkers: 1,
        completedRunEquivalents: 1,
        percentComplete: 50,
        throughputRunsPerMinute: 3,
        completedRunsPerMinute: 3,
        etaSeconds: 20,
        estimatedFinishAt: '2026-05-11T00:00:41.000Z',
        elapsedSeconds: 20,
        startedAt: '2026-05-11T00:00:01.000Z',
        updatedAt: '2026-05-11T00:00:21.000Z'
      })}`,
      'Simulation: 1, time: 750'
    ].join('\n'), 'utf-8')
  );
  const liveSensitivityArtifactLogs = await remoteManager.getExperimentJobLogs(`sensitivity:${sensitivityExperimentId}`, 0, 20);
  assert.equal(
    liveSensitivityArtifactLogs.progress?.percentComplete,
    50,
    'Expected running remote sensitivity jobs to expose progress from live S3 remote-runner logs'
  );
  assert.ok(
    liveSensitivityArtifactLogs.lines.some((line) => line.includes('Worker 2/2 started point')),
    'Expected running remote sensitivity jobs to expose summarized live S3 worker lines'
  );
  assert.ok(
    liveSensitivityArtifactLogs.lines.every((line) => !line.includes('Simulation: 1, time')),
    'Expected running remote sensitivity live S3 logs to filter raw JVM progress lines'
  );
  await assert.rejects(
    () => remoteManager.deleteExperimentJob(`sensitivity:${sensitivityExperimentId}`),
    /Only finished remote experiment jobs can be deleted/,
    'Expected active remote sensitivity jobs to be protected from deletion'
  );
  const canceled = await remoteManager.cancelExperimentJob(`sensitivity:${sensitivityExperimentId}`);
  assert.equal(canceled.job.status, 'canceled', 'Expected remote cancel to map to canceled job status');
  const sensitivityResultPrefix = `${sensitivityArtifactPrefix}Results/experiments/sensitivity/${sensitivityExperimentId}/`;
  const remoteSensitivityMetadata = {
    ...(sensitivitySubmit.experiment ?? {}),
    experimentId: sensitivityExperimentId,
    parameter: sensitivityParameter,
    status: 'succeeded',
    startedAt: '2026-05-11T00:00:01.000Z',
    endedAt: '2026-05-11T00:00:02.000Z',
    warnings: [],
    warningSummary: { byPoint: {} },
    sampledPoints: [],
    collapsedSlots: {},
    runCommand: {
      mode: 'maven',
      commandTemplate: 'remote fixture'
    }
  };
  remoteAdapter.objects.set(
    `fixture-bucket/${sensitivityResultPrefix}metadata.json`,
    Buffer.from(JSON.stringify(remoteSensitivityMetadata), 'utf-8')
  );
  remoteAdapter.objects.set(
    `fixture-bucket/${sensitivityResultPrefix}summary.json`,
    Buffer.from(JSON.stringify({
      results: {
        experimentId: sensitivityExperimentId,
        baselinePointId: null,
        points: []
      },
      charts: {
        experimentId: sensitivityExperimentId,
        parameter: remoteSensitivityMetadata.parameter,
        windowType: 'tail_120',
        tornado: [],
        deltaTrend: []
      }
    }), 'utf-8')
  );
  remoteAdapter.objects.set(
    `fixture-bucket/${sensitivityResultPrefix}${RUN_MANIFEST_FILE_NAME}`,
    Buffer.from(JSON.stringify({
      schemaVersion: 1,
      manifestType: 'sensitivity-experiment',
      experiment: { experimentId: sensitivityExperimentId }
    }), 'utf-8')
  );
  remoteAdapter.objects.set(
    `fixture-bucket/${sensitivityResultPrefix}remote-sensitivity-fixture.csv`,
    Buffer.from('value\n1\n', 'utf-8')
  );
  remoteAdapter.objects.set(
    `fixture-bucket/${sensitivityArtifactPrefix}logs/remote-runner.log`,
    Buffer.from([
      '[system] Remote runner starting sensitivity fixture',
      `[sensitivity:${sensitivityExperimentId}] [system] Worker 2/2 finished point 1 (point-1) seed-1 with status succeeded; progress 2.0/2 (100.0%), completed 2/2, active workers 0/2, throughput 3.00/min, ETA pending, finish pending`,
      `[progress] ${JSON.stringify({
        kind: 'sensitivity',
        status: 'succeeded',
        totalRuns: 2,
        completedRuns: 2,
        failedRuns: 0,
        canceledRuns: 0,
        activeRuns: 0,
        totalWorkers: 2,
        activeWorkers: 0,
        completedRunEquivalents: 2,
        percentComplete: 100,
        throughputRunsPerMinute: 3,
        completedRunsPerMinute: 3,
        etaSeconds: null,
        estimatedFinishAt: null,
        elapsedSeconds: 40,
        startedAt: '2026-05-11T00:00:01.000Z',
        endedAt: '2026-05-11T00:00:41.000Z',
        updatedAt: '2026-05-11T00:00:41.000Z'
      })}`,
      'Simulation: 1, time: 1000'
    ].join('\n'), 'utf-8')
  );
  const remoteArtifactLogs = await remoteManager.getExperimentJobLogs(`sensitivity:${sensitivityExperimentId}`, 0, 20);
  assert.equal(remoteArtifactLogs.progress?.percentComplete, 100, 'Expected remote artifact sensitivity logs to expose final progress');
  assert.ok(
    remoteArtifactLogs.lines.some((line) => line.includes('Worker 2/2 finished point')),
    'Expected remote artifact sensitivity logs to expose summarized worker finish lines'
  );
  assert.ok(
    remoteArtifactLogs.lines.every((line) => !line.includes('Simulation: 1, time')),
    'Expected remote artifact sensitivity logs to filter raw JVM progress lines'
  );
  const remoteSensitivityDetail = await remoteManager.getSensitivityExperiment(sensitivityExperimentId);
  assert.equal(
    remoteSensitivityDetail.experiment.experimentId,
    sensitivityExperimentId,
    'Expected remote sensitivity detail to use the API-prepared experiment id'
  );
  const remoteSensitivityResults = await remoteManager.getSensitivityExperimentResults(sensitivityExperimentId);
  assert.equal(
    remoteSensitivityResults.experimentId,
    sensitivityExperimentId,
    'Expected remote sensitivity results to use the API-prepared experiment id'
  );
  const remoteSensitivityCharts = await remoteManager.getSensitivityExperimentCharts(sensitivityExperimentId);
  assert.equal(
    remoteSensitivityCharts.experimentId,
    sensitivityExperimentId,
    'Expected remote sensitivity charts to use the API-prepared experiment id'
  );
  const remoteSensitivityArchiveText = await readArchiveText(
    (await remoteManager.getSensitivityExperimentArchive(sensitivityExperimentId)).stream
  );
  assert.ok(
    remoteSensitivityArchiveText.includes('metadata.json')
      && remoteSensitivityArchiveText.includes('summary.json')
      && remoteSensitivityArchiveText.includes(RUN_MANIFEST_FILE_NAME)
      && remoteSensitivityArchiveText.includes('remote-sensitivity-fixture.csv'),
    'Expected remote sensitivity archive to read artifacts from the API-prepared experiment id prefix'
  );
  const remoteSensitivityDelete = await remoteManager.deleteSensitivityExperiment(sensitivityExperimentId);
  assert.equal(remoteSensitivityDelete.deleted, true, 'Expected remote sensitivity delete to report success');
  assert.equal(
    remoteAdapter.objects.has(`fixture-bucket/${sensitivityCommand?.requestKey ?? ''}`),
    false,
    'Expected remote sensitivity delete to remove the request object'
  );
  assert.equal(
    [...remoteAdapter.objects.keys()].some((key) => key.startsWith(`fixture-bucket/${sensitivityArtifactPrefix}`)),
    false,
    'Expected remote sensitivity delete to remove current artifact objects'
  );
  await assert.rejects(
    () => remoteManager.getSensitivityExperiment(sensitivityExperimentId),
    /Unknown sensitivity experiment/,
    'Expected deleted remote sensitivity experiment to be removed from the index'
  );

  const remoteApiSubmit = await remoteManager.submitModelRun(remoteFixtureRoot, {
    baseline: 'v1.0',
    title: 'remote API delete fixture',
    overrides: {},
    confirmWarnings: true
  });
  const remoteApiCommand = remoteAdapter.commands[2];
  remoteAdapter.commandStatuses.set(remoteApiCommand?.commandId ?? '', 'Success');
  const remoteApiRunPrefix = remoteApiSubmit.job?.outputPath.replace('s3://fixture-bucket/', '') ?? '';
  remoteAdapter.objects.set(`fixture-bucket/${remoteApiRunPrefix}/config.properties`, Buffer.from('SEED=1\n', 'utf-8'));

  let missingDeleteKeyServer: Awaited<ReturnType<typeof startDashboardServer>> | null = null;
  try {
    missingDeleteKeyServer = await startDashboardServer({
      dashboardRoot: path.join(repoRoot, 'dashboard'),
      repoRoot: remoteFixtureRoot,
      runtimePaths: createDevelopmentRuntimePaths(remoteFixtureRoot),
      host: '127.0.0.1',
      port: 0,
      writeAuth: createWriteAuthController('writer', 'secret'),
      deleteKeyAuth: createDeleteKeyAuthController(undefined),
      remoteExecution: remoteManager,
      modelRunsConfigured: true,
      isDevRuntime: false,
      staticServing: { enabled: false },
      logStartup: false
    });
    const missingDeleteKeyResponse = await fetchText(
      `${missingDeleteKeyServer.url}/api/results/runs/${encodeURIComponent(remoteApiSubmit.job?.runId ?? '')}`,
      { method: 'DELETE' }
    );
    assert.equal(
      missingDeleteKeyResponse.status,
      503,
      'Expected remote delete to fail closed when DASHBOARD_DELETE_KEY is not configured'
    );
  } finally {
    if (missingDeleteKeyServer) {
      await missingDeleteKeyServer.shutdown();
    }
  }

  let remoteDeleteServer: Awaited<ReturnType<typeof startDashboardServer>> | null = null;
  try {
    remoteDeleteServer = await startDashboardServer({
      dashboardRoot: path.join(repoRoot, 'dashboard'),
      repoRoot: remoteFixtureRoot,
      runtimePaths: createDevelopmentRuntimePaths(remoteFixtureRoot),
      host: '127.0.0.1',
      port: 0,
      writeAuth: createWriteAuthController('writer', 'secret'),
      deleteKeyAuth: createDeleteKeyAuthController('delete-secret'),
      remoteExecution: remoteManager,
      modelRunsConfigured: true,
      isDevRuntime: false,
      staticServing: { enabled: false },
      logStartup: false
    });
    const remoteDeleteAuthStatus = JSON.parse((await fetchText(`${remoteDeleteServer.url}/api/auth/status`)).text) as {
      canDeleteResults?: boolean;
      deleteKeyRequired?: boolean;
    };
    assert.equal(remoteDeleteAuthStatus.canDeleteResults, true, 'Expected auth status to expose remote delete availability');
    assert.equal(remoteDeleteAuthStatus.deleteKeyRequired, true, 'Expected auth status to flag delete-key requirement');
    const noDeleteKeyResponse = await fetchText(
      `${remoteDeleteServer.url}/api/results/runs/${encodeURIComponent(remoteApiSubmit.job?.runId ?? '')}`,
      { method: 'DELETE' }
    );
    assert.equal(noDeleteKeyResponse.status, 403, 'Expected remote delete without private key to be rejected');
    const loginResponse = await fetchText(`${remoteDeleteServer.url}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username: 'writer', password: 'secret' })
    });
    const loginPayload = JSON.parse(loginResponse.text) as { token?: string };
    const writeTokenDeleteResponse = await fetchText(
      `${remoteDeleteServer.url}/api/results/runs/${encodeURIComponent(remoteApiSubmit.job?.runId ?? '')}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${loginPayload.token ?? ''}`
        }
      }
    );
    assert.equal(writeTokenDeleteResponse.status, 403, 'Expected write login not to authorize remote deletion');
    const validDeleteResponse = await fetchText(
      `${remoteDeleteServer.url}/api/results/runs/${encodeURIComponent(remoteApiSubmit.job?.runId ?? '')}`,
      {
        method: 'DELETE',
        headers: {
          'X-Dashboard-Delete-Key': 'delete-secret'
        }
      }
    );
    assert.equal(validDeleteResponse.status, 200, 'Expected remote delete with private key to succeed');
    assert.equal(
      remoteAdapter.objects.has(`fixture-bucket/${remoteApiCommand?.requestKey ?? ''}`),
      false,
      'Expected remote API delete to remove the request object'
    );
  } finally {
    if (remoteDeleteServer) {
      await remoteDeleteServer.shutdown();
    }
  }

  const previewCloudDeleteSubmit = await remoteManager.submitModelRun(remoteFixtureRoot, {
    baseline: 'v1.0',
    title: 'remote preview cloud delete fixture',
    overrides: {},
    confirmWarnings: true
  });
  const previewCloudDeleteCommand = remoteAdapter.commands[remoteAdapter.commands.length - 1];
  remoteAdapter.commandStatuses.set(previewCloudDeleteCommand?.commandId ?? '', 'Success');
  const previewCloudDeleteRunPrefix = previewCloudDeleteSubmit.job?.outputPath.replace('s3://fixture-bucket/', '') ?? '';
  remoteAdapter.objects.set(`fixture-bucket/${previewCloudDeleteRunPrefix}/config.properties`, Buffer.from('SEED=1\n', 'utf-8'));

  const devDeleteSubmit = await remoteManager.submitModelRun(remoteFixtureRoot, {
    baseline: 'v1.0',
    title: 'remote dev delete fixture',
    overrides: {},
    confirmWarnings: true
  });
  const devDeleteCommand = remoteAdapter.commands[remoteAdapter.commands.length - 1];
  remoteAdapter.commandStatuses.set(devDeleteCommand?.commandId ?? '', 'Success');
  const devDeleteRunPrefix = devDeleteSubmit.job?.outputPath.replace('s3://fixture-bucket/', '') ?? '';
  remoteAdapter.objects.set(`fixture-bucket/${devDeleteRunPrefix}/config.properties`, Buffer.from('SEED=1\n', 'utf-8'));

  let previewDeleteServer: Awaited<ReturnType<typeof startDashboardServer>> | null = null;
  try {
    previewDeleteServer = await startDashboardServer({
      dashboardRoot: path.join(repoRoot, 'dashboard'),
      repoRoot: remoteFixtureRoot,
      runtimePaths: createDevelopmentRuntimePaths(remoteFixtureRoot),
      host: '127.0.0.1',
      port: 0,
      writeAuth: createWriteAuthController('writer', 'secret'),
      deleteKeyAuth: createDeleteKeyAuthController('delete-secret'),
      remoteExecution: remoteManager,
      modelRunsConfigured: true,
      isDevRuntime: true,
      staticServing: { enabled: false },
      logStartup: false
    });
    const devAuthStatus = JSON.parse((await fetchText(`${previewDeleteServer.url}/api/auth/status`, {
      headers: {
        'X-Dashboard-View-Mode': 'dev'
      }
    })).text) as {
      canDeleteResults?: boolean;
      deleteKeyRequired?: boolean;
    };
    assert.equal(devAuthStatus.deleteKeyRequired, false, 'Expected dev mode not to require the remote delete key');
    assert.equal(devAuthStatus.canDeleteResults, true, 'Expected dev mode delete access to use the existing dev write path');

    const previewDesktopDeleteKeyResponse = await fetchText(
      `${previewDeleteServer.url}/api/results/runs/${encodeURIComponent(previewCloudDeleteSubmit.job?.runId ?? '')}`,
      {
        method: 'DELETE',
        headers: {
          'X-Dashboard-View-Mode': 'preview_desktop',
          'X-Dashboard-Delete-Key': 'delete-secret'
        }
      }
    );
    assert.equal(
      previewDesktopDeleteKeyResponse.status,
      403,
      'Expected preview desktop mode not to accept the cloud delete key'
    );

    const previewCloudNoDeleteKeyResponse = await fetchText(
      `${previewDeleteServer.url}/api/results/runs/${encodeURIComponent(previewCloudDeleteSubmit.job?.runId ?? '')}`,
      {
        method: 'DELETE',
        headers: {
          'X-Dashboard-View-Mode': 'preview_cloud'
        }
      }
    );
    assert.equal(
      previewCloudNoDeleteKeyResponse.status,
      403,
      'Expected preview cloud deletion without private key to be rejected'
    );

    const previewCloudDeleteKeyResponse = await fetchText(
      `${previewDeleteServer.url}/api/results/runs/${encodeURIComponent(previewCloudDeleteSubmit.job?.runId ?? '')}`,
      {
        method: 'DELETE',
        headers: {
          'X-Dashboard-View-Mode': 'preview_cloud',
          'X-Dashboard-Delete-Key': 'delete-secret'
        }
      }
    );
    assert.equal(previewCloudDeleteKeyResponse.status, 200, 'Expected preview cloud mode to accept the private delete key');

    const devDeleteResponse = await fetchText(
      `${previewDeleteServer.url}/api/results/runs/${encodeURIComponent(devDeleteSubmit.job?.runId ?? '')}`,
      {
        method: 'DELETE',
        headers: {
          'X-Dashboard-View-Mode': 'dev'
        }
      }
    );
    assert.equal(devDeleteResponse.status, 200, 'Expected dev mode deletion to use dev write access without the delete key');
  } finally {
    if (previewDeleteServer) {
      await previewDeleteServer.shutdown();
    }
  }
} finally {
  fs.rmSync(remoteFixtureRoot, { recursive: true, force: true });
}

function createDesktopRuntimeFixture(prefix = 'dashboard-runtime-paths-smoke-'): {
  root: string;
  appResourcesRoot: string;
  electronUserDataRoot: string;
  paths: RuntimePaths;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const appResourcesRoot = path.join(root, 'App Resources');
  const electronUserDataRoot = path.join(root, 'Electron User Data');
  const paths = createDesktopRuntimePaths({
    appResourcesRoot,
    electronUserDataRoot,
    repoRoot: path.join(root, 'repo cwd')
  });
  writeModelRunFixtureInputData(paths.dataRoot);
  fs.mkdirSync(paths.resultsRoot, { recursive: true });
  fs.mkdirSync(paths.tempRoot, { recursive: true });
  fs.mkdirSync(paths.logsRoot, { recursive: true });
  return { root, appResourcesRoot, electronUserDataRoot, paths };
}

function assertGeneratedDataPathsAreWindowsSafe(configText: string, baselineDirPath: string, label: string): void {
  const expectedRoot = baselineDirPath.replace(/\\/g, '/');
  for (const key of ['DATA_AGE_DISTRIBUTION', 'DATA_INCOME_GIVEN_AGE']) {
    const match = new RegExp(`^${key}\\s*=\\s*"([^"]+)"$`, 'm').exec(configText);
    assert.ok(match, `Expected ${label} generated config to quote ${key}`);
    const configValue = match[1] ?? '';
    assert.ok(
      configValue.startsWith(`${expectedRoot}/`),
      `Expected ${label} ${key} to point under the configured data root: ${configValue}`
    );
    assert.equal(configValue.includes('\\'), false, `Expected ${label} ${key} to use forward slashes`);
    assert.ok(fs.existsSync(configValue), `Expected ${label} ${key} file to exist: ${configValue}`);
  }
}

const catalog = getParameterCatalog();
assert.deepEqual(
  catalog.map((item) => item.id),
  expectedIds,
  'Catalog should contain exactly all tracked calibrated parameter cards'
);

assertAxisSpecComplete(expectedIds);
for (const id of expectedIds) {
  const spec = getAxisSpec(id);
  const labels = [
    spec.scalar.xTitle,
    spec.scalar.yTitle,
    spec.binned.xTitle,
    spec.binned.yTitle,
    spec.binned.yDeltaTitle,
    spec.joint.xTitle,
    spec.joint.yTitle,
    spec.joint.legendTitle,
    spec.curve.xTitle,
    spec.curve.yTitle,
    spec.buyBudget.xTitle,
    spec.buyBudget.yTitle,
    spec.buyMultiplier.xTitle,
    spec.buyMultiplier.yTitle
  ];
  for (const label of labels) {
    assert.ok(/\(.+\)/.test(label), `Axis label should include unit marker: ${id} -> ${label}`);
    assert.ok(!label.toLowerCase().includes('native units'), `Axis label should not use native units placeholder: ${id}`);
  }
}

const versions = getVersions(repoRoot);
assert.ok(versions.length > 0, 'Expected at least one version folder');
assert.ok(!versions.includes('v1'), 'v1 should be excluded after cleanup');
assert.equal(versions[0], 'v0', 'Oldest version should be v0');
assert.deepEqual(parseVersionParts('v0oo'), [0, 2], 'Repeated output suffixes should count in version sorting');
assert.deepEqual(parseVersionParts('v0o1'), [0, 3], 'Numbered output suffixes should sort after legacy oo campaigns');
assert.deepEqual(parseVersionParts('v0o2'), [0, 4], 'Numbered output suffixes should preserve campaign order');
assert.deepEqual(parseVersionParts('v4.14oo'), [4, 14, 2], 'Dotted repeated output suffixes should count in version sorting');
assert.ok(compareVersions('v0o', 'v0oo') < 0, 'v0o should sort before v0oo');
assert.ok(compareVersions('v0oo', 'v0o1') < 0, 'v0oo should sort before v0o1');
assert.ok(compareVersions('v0o1', 'v0o2') < 0, 'v0o1 should sort before v0o2');
assert.ok(compareVersions('v4.14o', 'v4.14oo') < 0, 'v4.14o should sort before v4.14oo');
assert.deepEqual(listVersions(path.join(repoRoot, 'input-data-versions')), versions, 'Version service should expose raw sorted version folders');
for (const version of ['v0o', 'v0oo', 'v4.14oo']) {
  assert.ok(versions.includes(version), `Expected ${version} to be listed as a snapshot version`);
}
const inProgressVersions = getInProgressVersions(repoRoot);
assert.ok(
  inProgressVersions.every((version) => versions.includes(version)),
  'In-progress versions should resolve to discovered snapshot folders'
);
assert.ok(!inProgressVersions.includes('v4.0'), 'Expected v4.0 to be reported as a stable snapshot');
assert.ok(!inProgressVersions.includes('v4.1'), 'Expected v4.1 to be reported as a stable snapshot after validation refresh');
const latestStableVersion = getLatestStableVersion(versions, inProgressVersions);
const expectedLatestStableVersion = [...versions].reverse().find((version) => !inProgressVersions.includes(version)) ?? '';
assert.equal(latestStableVersion, expectedLatestStableVersion, 'Expected latest stable version helper to return newest non-progress snapshot');
assert.notEqual(latestStableVersion, '', 'Expected at least one stable version to exist');
const originalVersionState = buildVersionLabelState('v0', latestStableVersion, new Set(inProgressVersions));
assert.ok(originalVersionState.isOriginal, 'Expected v0 to be labelled as original');
assert.equal(
  formatVersionOptionLabel('v0', originalVersionState),
  'Original 2011 model (Original)',
  'Expected v0 select label to use the standard original model name'
);
const combinedLabelState = buildVersionLabelState('v0', 'v0', new Set<string>());
assert.equal(
  formatVersionOptionLabel('v0', combinedLabelState),
  'Original 2011 model (Latest, Original)',
  'Expected combined labels to preserve Latest then Original ordering'
);
assert.equal(
  formatVersionOptionLabel('v0o', buildVersionLabelState('v0o', latestStableVersion, new Set(inProgressVersions))),
  'v0o',
  'Expected v0o select labels to remain a raw legacy version label'
);
assert.equal(
  formatVersionOptionLabel('v0o2', buildVersionLabelState('v0o2', latestStableVersion, new Set(inProgressVersions))),
  'v0o2',
  'Expected v0o2 select labels to remain a raw historical 2011 branch'
);
assert.equal(
  formatVersionOptionLabel('v0o7', buildVersionLabelState('v0o7', latestStableVersion, new Set(inProgressVersions))),
  'Optimised 2011 model',
  'Expected v0o7 select labels to use the standard optimised model name'
);
assert.equal(
  formatVersionOptionLabel('v0oo', buildVersionLabelState('v0oo', latestStableVersion, new Set(inProgressVersions))),
  'v0oo',
  'Expected v0oo select labels to remain a raw historical 2011 branch'
);
assert.equal(
  formatVersionOptionLabel('v0o6', buildVersionLabelState('v0o6', latestStableVersion, new Set(inProgressVersions))),
  'v0o6',
  'Expected v0o6 select labels to remain a raw historical 2011 branch'
);
assert.equal(
  formatVersionOptionLabel('v1.0', buildVersionLabelState('v1.0', latestStableVersion, new Set(inProgressVersions))),
  '2024 model v1.0',
  'Expected v1.0 select labels to identify the 2024 model family'
);
assert.equal(
  formatVersionOptionLabel('v4.4', buildVersionLabelState('v4.4', latestStableVersion, new Set(inProgressVersions))),
  '2024 model v4.4',
  'Expected v4.4 select labels to remain a standard 2024 model'
);
assert.equal(
  formatVersionOptionLabel('v5o3', buildVersionLabelState('v5o3', latestStableVersion, new Set(inProgressVersions))),
  latestStableVersion === 'v5o3' ? 'Optimised 2024 model v5o3 (Latest)' : 'Optimised 2024 model v5o3',
  'Expected v5o3 select labels to identify the optimised 2024 model'
);
const latestVersionState = buildVersionLabelState(latestStableVersion, latestStableVersion, new Set(inProgressVersions));
assert.ok(latestVersionState.isLatest, 'Expected latest stable version to be labelled as latest');
assert.ok(!latestVersionState.isInProgress, 'Expected latest stable version to exclude the in-progress label');
assert.equal(
  formatVersionOptionLabel(latestStableVersion, latestVersionState),
  latestStableVersion === 'v5o3'
    ? 'Optimised 2024 model v5o3 (Latest)'
    : `Latest 2024 model ${latestStableVersion} (Latest)`,
  'Expected latest stable select label to include Latest'
);
assert.equal(
  formatCalibrationVersionTitleLabel('v0', originalVersionState),
  'Original 2011 model',
  'Expected v0 calibration titles to use the name without the raw version id'
);
assert.equal(
  formatCalibrationVersionTitleLabel('v0oo', buildVersionLabelState('v0oo', latestStableVersion, new Set(inProgressVersions))),
  'v0oo',
  'Expected v0oo calibration titles to remain a raw historical 2011 branch'
);
assert.equal(
  formatCalibrationVersionTitleLabel('v4.4', buildVersionLabelState('v4.4', latestStableVersion, new Set(inProgressVersions))),
  '2024 model v4.4',
  'Expected v4.4 calibration titles to remain a standard 2024 model'
);
assert.equal(
  formatCalibrationVersionTitleLabel('v5o3', buildVersionLabelState('v5o3', latestStableVersion, new Set(inProgressVersions))),
  'Optimised 2024 model',
  'Expected v5o3 calibration titles to identify the optimised 2024 model'
);
assert.equal(
  formatCalibrationVersionTitleLabel(latestStableVersion, latestVersionState),
  latestStableVersion === 'v5o3' ? 'Optimised 2024 model' : 'Latest 2024 model',
  'Expected latest calibration titles to use the name without the raw version id'
);
const inProgressVersion = inProgressVersions.find((version) => version !== 'v0');
if (inProgressVersion) {
  const inProgressState = buildVersionLabelState(inProgressVersion, latestStableVersion, new Set(inProgressVersions));
  assert.ok(inProgressState.isInProgress, 'Expected in-progress snapshot to be labelled in progress');
  assert.ok(!inProgressState.isLatest, 'Expected in-progress snapshot not to be labelled latest');
  assert.equal(
    formatVersionOptionLabel(inProgressVersion, inProgressState),
    `2024 model ${inProgressVersion} (In progress)`,
    'Expected in-progress select label to exclude Latest'
  );
}
const latestVersion = versions[versions.length - 1];
const packagedVersionAllowlist = ['v0o7', 'v0', 'v4.26', 'v5o3'];
const dockerIgnore = fs.readFileSync(path.join(repoRoot, '.dockerignore'), 'utf-8');
const releaseResourceScript = fs.readFileSync(path.join(repoRoot, 'scripts/windows/assemble-release-resources.mjs'), 'utf-8');
for (const version of packagedVersionAllowlist) {
  assert.ok(dockerIgnore.includes(`!input-data-versions/${version}/**`), `Expected Docker context to include ${version}`);
  assert.ok(releaseResourceScript.includes(`'${version}'`), `Expected desktop release resources to include ${version}`);
}
assert.ok(
  dockerIgnore.includes('input-data-versions/v[0-9]*/') && !dockerIgnore.includes('!input-data-versions/v0o/**'),
  'Expected Docker context to exclude non-allowlisted version folders by default'
);

const desktopDataFixture = createDesktopRuntimeFixture('dashboard-data-runtime-smoke-');
try {
  assert.deepEqual(
    getVersions(desktopDataFixture.paths),
    ['v0', 'v0oo', 'v0o2', 'v0o7', 'v1.0', 'v1.1', 'v5o3'],
    'Expected version discovery to read from the configured runtime data root'
  );
  assert.deepEqual(
    getInProgressVersions(desktopDataFixture.paths),
    ['v1.1'],
    'Expected in-progress discovery to read dashboard history from the configured runtime data root'
  );
  assert.equal(
    loadDashboardInputVersionHistory(desktopDataFixture.paths)[0]?.snapshot_folder,
    'v1.1',
    'Expected dashboard input history to load from the runtime data root'
  );
  assert.equal(
    getModelRunOptions(desktopDataFixture.paths, undefined, true).defaultBaseline,
    'v0o7',
    'Expected model-run options to use runtime data root baselines without falling back to repo data'
  );
  assert.equal(
    getHomePreview(desktopDataFixture.paths, 'v1.0', ['age_distribution']).items.length,
    1,
    'Expected home preview to read fixture data from the configured data root'
  );
  assert.equal(
    compareParameters(desktopDataFixture.paths, 'v1.0', 'v1.1', ['age_distribution']).items.length,
    1,
    'Expected compare service to read fixture data from the configured data root'
  );
} finally {
  fs.rmSync(desktopDataFixture.root, { recursive: true, force: true });
}

const homePreview = getHomePreview(repoRoot, latestVersion, [
  'wealth_given_income_joint',
  'house_price_lognormal',
  'downpayment_oo_lognormal',
  'btl_probability_bins'
]);
assert.equal(homePreview.version, latestVersion, 'Expected home preview payload to report the requested version');
assert.equal(homePreview.items.length, 4, 'Expected home preview payload to include the requested items only');
assert.deepEqual(
  homePreview.items.map((item) => item.id),
  ['wealth_given_income_joint', 'house_price_lognormal', 'downpayment_oo_lognormal', 'btl_probability_bins'],
  'Expected home preview payload to preserve requested item order'
);
assert.ok(
  homePreview.items.every((item) => !('sourceInfo' in item) && !('changeOriginsInRange' in item)),
  'Expected home preview payload to exclude compare-page provenance and source metadata'
);
const homePreviewLognormal = homePreview.items.find((item) => item.id === 'house_price_lognormal');
assert.ok(homePreviewLognormal, 'Expected house_price_lognormal in home preview payload');
assert.ok(
  homePreviewLognormal?.visualPayload.type === 'lognormal_pair',
  'Expected house_price_lognormal preview payload to use lognormal_pair type'
);
if (homePreviewLognormal?.visualPayload.type === 'lognormal_pair') {
  const scaleRight = homePreviewLognormal.visualPayload.parameters.find((row) => row.key === 'HOUSE_PRICES_SCALE')?.right;
  assert.ok(scaleRight !== undefined, 'Expected house-price scale parameter in preview payload');
  assertClose(
    homePreviewLognormal.visualPayload.median.right,
    Math.exp(Number(scaleRight)),
    1e-12,
    'Expected lognormal preview median.right to equal exp(HOUSE_PRICES_SCALE)'
  );
}

const dashboardInputVersionHistory = loadDashboardInputVersionHistory(repoRoot);
assert.ok(
  dashboardInputVersionHistory.length > 0,
  'Expected at least one dashboard input version history entry'
);
for (const entry of dashboardInputVersionHistory) {
  assert.ok(Array.isArray(entry.calibration_files), 'calibration_files should be present for every version entry');
  assert.ok(Array.isArray(entry.config_parameters), 'config_parameters should be present for every version entry');
  assert.ok(Array.isArray(entry.parameter_changes), 'parameter_changes should be present for every version entry');
  for (const parameterChange of entry.parameter_changes) {
    assert.equal(typeof parameterChange.config_parameter, 'string', 'parameter_changes.config_parameter should be a string');
    assert.ok(
      parameterChange.dataset_source === null || typeof parameterChange.dataset_source === 'string',
      'parameter_changes.dataset_source should be string or null'
    );
  }
  assert.ok(Array.isArray(entry.method_variations), 'method_variations should be present for every version entry');
}
const v10Note = dashboardInputVersionHistory.find((entry) => entry.version_id === 'v1.0');
assert.ok(v10Note, 'Expected v1.0 note entry');
assert.ok(
  v10Note?.parameter_changes.some(
    (change) =>
      change.config_parameter === 'DATA_INCOME_GIVEN_AGE' &&
      change.dataset_source === 'src/main/resources/AgeGrossIncomeJointDist.csv'
  ),
  'Expected v1.0 parameter_changes to include DATA_INCOME_GIVEN_AGE dataset source'
);
const v38Note = dashboardInputVersionHistory.find((entry) => entry.version_id === 'v4.0');
assert.ok(v38Note, 'Expected v4.0 note entry');
assert.equal(v38Note?.validation.status, 'complete', 'v4.0 validation should be complete');
assert.equal(v38Note?.validation.income_diff_pct, 7.192856, 'v4.0 income diff should match released value');
assert.equal(v38Note?.validation.housing_wealth_diff_pct, 12.534289, 'v4.0 housing diff should match released value');
assert.equal(v38Note?.validation.financial_wealth_diff_pct, 13.438086, 'v4.0 financial diff should match released value');

const validationOverview = getValidationOverview(repoRoot, 'v4.1');
assert.equal(validationOverview.selectedVersion, 'v4.1');
assert.equal(validationOverview.selectedValidationTargetYear, 2024);
assert.ok(validationOverview.trend.points.length > 0);
assert.ok(validationOverview.selectedSummary.metrics.some((metric) => metric.metricId === 'core_mortgageApprovals'));
assert.equal(
  validationOverview.selectedSummary.validationTargetYear,
  2024,
  'Selected non-v0 validation summaries should default the target year to 2024 when metadata is absent'
);
assert.equal(
  Object.prototype.hasOwnProperty.call(validationOverview.selectedSummary, 'familySummaries'),
  false,
  'Validation overview should no longer expose family summaries in the dashboard payload'
);
assert.ok(
  validationOverview.trend.points.some((point) => point.version === 'v0' && point.validationTargetYear === 2024),
  'Validation overview trend should keep v0 on the tracked 2024 summary'
);
assert.ok(
  validationOverview.trend.points.some((point) => point.version === 'v4.1' && point.validationTargetYear === 2024),
  'Validation overview trend should keep later versions on 2024 targets by default'
);
const validationOverviewVersionPattern = /^v\d+(?:\.\d+)*(?:o+|o\d+)?$/i;
assert.deepEqual(
  validationOverview.trend.points.map((point) => point.version),
  validationOverview.availableVersions,
  'Validation overview trend should use the same filtered versions exposed to the selector'
);
assert.ok(
  validationOverview.availableVersions.every(
    (version) =>
      version === 'v0' ||
      version === 'v0o2' ||
      version === 'v0o7' ||
      (validationOverviewVersionPattern.test(version) && compareVersions(version, 'v1.0') >= 0)
  ),
  'Validation overview should only expose v0, selected v0-family comparison branches, and v1.0+ versions'
);
for (const version of ['v0o', 'v0oo', 'v0o1', 'v0o3', 'v0o6', 'v0o3-hpi-i00-m034']) {
  assert.ok(
    !validationOverview.availableVersions.includes(version),
    `Validation overview should exclude non-promoted pre-v1.0 version ${version}`
  );
  assert.throws(
    () => getValidationOverview(repoRoot, version),
    /Unknown validation summary version/,
    `Validation overview should reject removed pre-v1.0 version ${version}`
  );
}
const originalValidationOverview = getValidationOverview(repoRoot, 'v0');
assert.equal(
  originalValidationOverview.selectedSummary.validationTargetYear,
  2024,
  'Selecting v0 should keep the metric table on the tracked 2024 summary'
);
assert.deepEqual(
  originalValidationOverview.availableValidationTargetYearsByVersion.v0,
  [2024, 2011],
  'Original v0 should expose both the 2024 validation and matching 2011 overlay'
);
assert.deepEqual(
  originalValidationOverview.availableValidationTargetYearsByVersion.v0o2,
  [2024, 2011],
  'v0o2 should expose both the 2024 validation and matching 2011 overlay'
);
assert.deepEqual(
  originalValidationOverview.availableValidationTargetYearsByVersion.v0o7,
  [2024, 2011],
  'v0o7 should expose both the 2024 validation and matching 2011 overlay'
);
assert.deepEqual(
  validationOverview.availableValidationTargetYearsByVersion['v4.1'],
  [2024],
  'v1.0+ validation versions should expose only the 2024 validation'
);
const referenceValidationOverview = getValidationOverview(repoRoot, 'v0', 2011);
assert.equal(referenceValidationOverview.selectedVersion, 'v0');
assert.equal(referenceValidationOverview.selectedValidationTargetYear, 2011);
assert.equal(
  referenceValidationOverview.selectedSummary.version,
  'v0',
  'Selecting the 2011 validation year should keep the selected version stable'
);
assert.equal(
  referenceValidationOverview.selectedSummary.validationTargetYear,
  2011,
  'Selecting the 2011 validation year should surface the matching overlay table'
);
const historicalReferenceValidationOverview = getValidationOverview(repoRoot, 'v0o2', 2011);
assert.equal(historicalReferenceValidationOverview.selectedVersion, 'v0o2');
assert.equal(historicalReferenceValidationOverview.selectedSummary.version, 'v0o2');
assert.equal(
  historicalReferenceValidationOverview.selectedSummary.validationTargetYear,
  2011,
  'Selecting v0o2 with 2011 should return the v0o2-specific 2011 overlay metrics'
);
const turboReferenceValidationOverview = getValidationOverview(repoRoot, 'v0o7', 2011);
assert.equal(turboReferenceValidationOverview.selectedVersion, 'v0o7');
assert.equal(turboReferenceValidationOverview.selectedSummary.version, 'v0o7');
assert.equal(
  turboReferenceValidationOverview.selectedSummary.validationTargetYear,
  2011,
  'Selecting v0o7 with 2011 should return the v0o7-specific 2011 overlay metrics'
);
const unsupportedReferenceRequestOverview = getValidationOverview(repoRoot, 'v4.1', 2011);
assert.equal(unsupportedReferenceRequestOverview.selectedVersion, 'v4.1');
assert.equal(
  unsupportedReferenceRequestOverview.selectedValidationTargetYear,
  2024,
  'Requesting 2011 for an unsupported version should fall back to the 2024 validation year'
);
assert.equal(
  referenceValidationOverview.selectedSummary.metrics.find((metric) => metric.metricId === 'core_hpiStd')?.bandNotes,
  'Intentionally benchmarked to the same official UK IndexSA population std over 2005-01 through 2024-12 used by the tracked 2024 view; this 2011 reference summary only changes the displayed comparison window.',
  'The 2011 validation reference summary should explain that core_hpiStd stays benchmarked to the 2024 std window'
);
assert.equal(
  referenceValidationOverview.selectedSummary.metrics.find((metric) => metric.metricId === 'core_hpiCyclePeriod')?.bandNotes,
  'Still 2011-anchored: derived from the tracked official-source UK HPI history through 2011-12 using the locked 12-month moving-average, log-detrend, FFT peak-search method over 60..240 months.',
  'The 2011 validation reference summary should explain that core_hpiCyclePeriod remains 2011-anchored'
);
assert.ok(
  referenceValidationOverview.trend.points.some((point) => point.version === 'v4.1' && point.validationTargetYear === 2024),
  'Selecting a 2011 validation year should keep the trend chart on the tracked 2024 timeline'
);
assert.deepEqual(
  validationOverview.trend.referencePoints.map((point) => point.version),
  ['v0', 'v0o2', 'v0o7'],
  'Validation overview should expose sparse v0, v0o2, and v0o7 2011 reference points'
);
assert.ok(
  validationOverview.trend.referencePoints.every(
    (point) => point.validationTargetYear === 2011 && Number.isFinite(point.overallCompositeLoss)
  ),
  'Validation overview 2011 reference points should expose finite 2011 losses'
);
assert.equal(
  readValidationSummary(repoRoot, 'v0').validationTargetYear,
  2024,
  'Validation parser should normalise legacy v0 tracked summaries onto the 2024 timeline'
);

const versionOrder = new Map(versions.map((version, index) => [version, index]));
for (let index = 1; index < validationOverview.trend.points.length; index += 1) {
  const previousVersion = validationOverview.trend.points[index - 1]?.version ?? '';
  const currentVersion = validationOverview.trend.points[index]?.version ?? '';
  const previousRank = versionOrder.get(previousVersion);
  const currentRank = versionOrder.get(currentVersion);
  assert.ok(previousRank !== undefined && currentRank !== undefined, 'Validation trend points should map to known versions');
  assert.ok(previousRank < currentRank, 'Validation trend points should be sorted by version');
}

const validationSummaryDir = path.join(repoRoot, 'input-data-versions', 'validation');
const expectedTrendVersions = fs
  .readdirSync(validationSummaryDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
  .map((entry) => entry.name.replace(/\.json$/u, ''))
  .filter((version) => validationOverview.availableVersions.includes(version))
  .sort((left, right) => (versionOrder.get(left) ?? -1) - (versionOrder.get(right) ?? -1));
assert.deepEqual(
  validationOverview.trend.points.map((point) => point.version),
  expectedTrendVersions,
  'Validation overview trend versions should match filtered tracked validation summaries'
);

assert.ok(
  validationOverview.trend.points.every(
    (point) => typeof point.overallCompositeLoss === 'number' && Number.isFinite(point.overallCompositeLoss)
  ),
  'Validation overview trend should expose numeric composite losses for every tracked summary'
);

const approvalsMetric = validationOverview.selectedSummary.metrics.find(
  (metric) => metric.metricId === 'core_mortgageApprovals'
);
const referenceApprovalsMetric = referenceValidationOverview.selectedSummary.metrics.find(
  (metric) => metric.metricId === 'core_mortgageApprovals'
);
assert.ok(approvalsMetric, 'Validation overview should include the mortgage approvals metric');
assert.ok(referenceApprovalsMetric, 'Reference validation overview should include the mortgage approvals metric');
assert.ok(
  approvalsMetric?.targetBand && approvalsMetric.targetBand.lower < approvalsMetric.targetBand.upper,
  'Mortgage approvals should expose a valid target band'
);
assert.ok(
  approvalsMetric?.insideRate !== null && approvalsMetric.insideRate !== undefined,
  'Mortgage approvals should expose an inside-rate summary'
);
assert.equal(approvalsMetric?.metricWeight, 1, 'Mortgage approvals should expose the raw metric weight');
const expectedApprovalsLossDelta =
  (approvalsMetric?.metricLoss ?? NaN) - (referenceApprovalsMetric?.metricLoss ?? NaN);
const expectedApprovalsLossDeltaPercent =
  referenceApprovalsMetric?.metricLoss === 0
    ? expectedApprovalsLossDelta === 0
      ? 0
      : null
    : (expectedApprovalsLossDelta / (referenceApprovalsMetric?.metricLoss ?? NaN)) * 100;
assertClose(
  approvalsMetric?.lossDeltaVsReference2011 ?? NaN,
  expectedApprovalsLossDelta,
  1e-12,
  'Mortgage approvals should expose the signed loss delta versus the v0-2011 reference'
);
if (expectedApprovalsLossDeltaPercent === null) {
  assert.equal(
    approvalsMetric?.lossDeltaPercentVsReference2011 ?? null,
    null,
    'Mortgage approvals should expose null percent loss delta when the v0-2011 reference loss is zero'
  );
} else {
  assertClose(
    approvalsMetric?.lossDeltaPercentVsReference2011 ?? NaN,
    expectedApprovalsLossDeltaPercent,
    1e-12,
    'Mortgage approvals should expose the percent loss delta versus the v0-2011 reference'
  );
}
assert.equal(
  Object.prototype.hasOwnProperty.call(approvalsMetric ?? {}, 'familyId'),
  false,
  'Validation overview metrics should no longer expose family ids in the dashboard payload'
);
assert.ok(
  validationOverview.selectedSummary.metrics.every(
    (metric) => typeof metric.metricWeight === 'number' && Number.isFinite(metric.metricWeight)
  ),
  'Validation overview should expose numeric metric weights for every validation metric'
);
assert.ok(
  validationOverview.selectedSummary.metrics.every((metric) =>
    Object.prototype.hasOwnProperty.call(metric, 'lossDeltaVsReference2011')
  ),
  'Validation overview should expose a per-metric loss delta versus the v0-2011 reference summary'
);
assert.ok(
  validationOverview.selectedSummary.metrics.every((metric) =>
    Object.prototype.hasOwnProperty.call(metric, 'lossDeltaPercentVsReference2011')
  ),
  'Validation overview should expose a per-metric percent loss delta versus the v0-2011 reference summary'
);
assert.ok(
  referenceValidationOverview.selectedSummary.metrics.every(
    (metric) => metric.lossDeltaVsReference2011 === 0 || metric.lossDeltaVsReference2011 === null
  ),
  'Reference validation mode should expose zero loss deltas when the selected table is the v0-2011 baseline'
);
assert.ok(
  referenceValidationOverview.selectedSummary.metrics.every(
    (metric) => metric.lossDeltaPercentVsReference2011 === 0 || metric.lossDeltaPercentVsReference2011 === null
  ),
  'Reference validation mode should expose zero percent loss deltas when the selected table is the v0-2011 baseline'
);

const validationSummaryFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'validation-summary-'));
const validationSummaryFixtureDir = path.join(validationSummaryFixtureRoot, 'input-data-versions', 'validation');
const validationOverlayFixtureDir = path.join(validationSummaryFixtureRoot, 'input-data-versions', 'validation-overlays');
fs.mkdirSync(validationSummaryFixtureDir, { recursive: true });
fs.mkdirSync(validationOverlayFixtureDir, { recursive: true });
fs.writeFileSync(
  path.join(validationSummaryFixtureDir, 'v-modern.json'),
  JSON.stringify(
    {
      schemaVersion: 4,
      version: 'v-modern',
      generatedAt: '2026-04-14T00:00:00Z',
      seeds: [1, 2, 3, 4, 5, 6, 7, 8],
      window: { startIndex: 200, endIndex: 2000 },
      overallCompositeLoss: 0.5,
      metrics: [
        {
          metricId: 'core_advancesToBTL',
          label: 'Advances to BTL',
          status: 'fail',
          requirement: 'required',
          units: 'count/month',
          sourceLabel: 'UK Finance BTL Mortgage Market Update 2024 (Q1-Q4)',
          sourceIndicatorLabel: 'House purchase BTL loans, annual sum of 2024 quarterly counts',
          sourceDocumentPath: 'input-data-versions/validation-sources/2024/ukf/Buy to let Mortgage Market Update Q4.pdf',
          sourceTextPath: 'input-data-versions/validation-sources/2024/ukf/btl-mortgage-market-update-2024-validation-evidence.txt',
          sourceTable: '2024 house-purchase BTL counts aggregated from Q1-Q4 summary panels',
          sourcePage: 2,
          rawSourceValue: 62055,
          sourceValue: 5.17125,
          sourceAsOf: '2024 annualized monthly mean',
          sourceUnits: 'count/year',
          comparisonUnits: 'thousand count/month',
          mappingStatus: 'derived_match',
          bandMethod: 'fixed_plus_minus_15pct_around_official_monthly_mean',
          bandNotes: 'Quarterly house-purchase counts converted to a monthly mean.',
          sourceReferences: [
            {
              label: 'UK Finance BTL Mortgage Market Update Q1 2024',
              sourceDocumentPath: 'input-data-versions/validation-sources/2024/ukf/Buy to let Mortgage Market Update Q1.pdf',
              sourceTextPath: 'input-data-versions/validation-sources/2024/ukf/btl-mortgage-market-update-2024-validation-evidence.txt',
              sourceTable: 'Latest 2024 Q1 summary panel',
              sourcePage: 2,
              sourceIndicatorLabel: 'House purchase',
              rawSourceValue: 12422,
              sourceAsOf: 'Q1 2024',
              sourceUnits: 'count/quarter',
              notes: 'Quarterly house-purchase BTL count used in the 2024 annual sum.'
            }
          ],
          targetBand: { lower: 4.396, upper: 5.947 },
          seedMean: 9.0,
          p25: 8.8,
          p75: 9.2,
          insideRate: 0,
          lossFamily: 'positive_level',
          lossTransform: 'log_ratio_to_target_band',
          lossScale: null,
          lossScaleBasis: 'not_applicable',
          additiveScale: null,
          additiveScaleBasis: 'not_applicable',
          normalizedDistance: 0.414657051,
          normalizedIqr: 0.04445176257,
          distanceComponent: 0.414657051,
          spreadComponent: 0.01111294064,
          levelComponent: 0,
          insideRateComponent: 0.5,
          metricLoss: 1.5,
          metricWeight: 1
        }
      ]
    },
    null,
    2
  )
);
fs.writeFileSync(
  path.join(validationSummaryFixtureDir, 'v-legacy.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      version: 'v-legacy',
      generatedAt: '2026-04-14T00:00:00Z',
      seeds: [1, 2, 3, 4, 5, 6, 7, 8],
      window: { startIndex: 200, endIndex: 2000 },
      overallCompositeLoss: 0.5,
      metrics: [
        {
          metricId: 'core_mortgageApprovals',
          label: 'Mortgage Approvals',
          status: 'fail',
          requirement: 'required',
          units: 'count/month',
          sourceLabel: 'Bank of England FPC core indicators, June 2024',
          targetBand: { lower: 57, upper: 63 },
          seedMean: 50,
          p25: 49,
          p75: 51,
          insideRate: 0,
          normalizedDistance: 1.0,
          normalizedIqr: 0.1,
          metricLoss: 1.5
        }
      ]
    },
    null,
    2
  )
);
fs.writeFileSync(
  path.join(validationSummaryFixtureDir, 'v0.json'),
  JSON.stringify(
    {
      schemaVersion: 3,
      version: 'v0',
      validationTargetYear: 2011,
      generatedAt: '2026-04-14T00:00:00Z',
      seeds: [1, 2, 3, 4, 5, 6, 7, 8],
      window: { startIndex: 200, endIndex: 2000 },
      overallCompositeLoss: 0.5,
      metrics: [
        {
          metricId: 'core_mortgageApprovals',
          label: 'Mortgage Approvals',
          status: 'fail',
          requirement: 'required',
          units: 'count/month',
          sourceLabel: 'Bank of England FPC core indicators, June 2024',
          targetBand: { lower: 57, upper: 63 },
          seedMean: 50,
          p25: 49,
          p75: 51,
          insideRate: 0,
          normalizedDistance: 1.0,
          normalizedIqr: 0.1,
          metricLoss: 1.5
        }
      ]
    },
    null,
    2
  )
);
fs.writeFileSync(
  path.join(validationOverlayFixtureDir, 'v0-2011.json'),
  JSON.stringify(
    {
      schemaVersion: 3,
      version: 'v0',
      validationTargetYear: 2011,
      generatedAt: '2026-04-14T00:00:00Z',
      seeds: [1],
      window: { startIndex: 200, endIndex: 2000 },
      overallCompositeLoss: 0.8,
      metrics: [
        {
          metricId: 'core_mortgageApprovals',
          label: 'Mortgage Approvals',
          status: 'fail',
          requirement: 'required',
          units: 'count/month',
          sourceLabel: '2011 overlay',
          targetBand: { lower: 42, upper: 53 },
          seedMean: 50,
          p25: 50,
          p75: 50,
          insideRate: 1,
          normalizedDistance: 0,
          normalizedIqr: 0,
          metricLoss: 0
        },
        {
          metricId: 'core_housingTransactions',
          label: 'Housing Transactions',
          status: 'fail',
          requirement: 'required',
          units: 'count/month',
          sourceLabel: '2011 overlay',
          targetBand: { lower: 68, upper: 78 },
          seedMean: 74,
          p25: 73,
          p75: 75,
          insideRate: 1,
          normalizedDistance: 0,
          normalizedIqr: 0.02,
          metricLoss: 0.5
        }
      ]
    },
    null,
    2
  )
);
fs.writeFileSync(
  path.join(validationSummaryFixtureDir, 'v4.0.json'),
  JSON.stringify(
    {
      schemaVersion: 3,
      version: 'v4.0',
      generatedAt: '2026-04-14T00:00:00Z',
      seeds: [1, 2, 3, 4, 5, 6, 7, 8],
      window: { startIndex: 200, endIndex: 2000 },
      overallCompositeLoss: 0.4,
      metrics: [
        {
          metricId: 'core_mortgageApprovals',
          label: 'Mortgage Approvals',
          status: 'pass',
          requirement: 'required',
          units: 'count/month',
          sourceLabel: 'Bank of England FPC core indicators, June 2024',
          targetBand: { lower: 57, upper: 63 },
          seedMean: 60,
          p25: 58,
          p75: 62,
          insideRate: 1,
          normalizedDistance: 0.0,
          normalizedIqr: 0.05,
          metricLoss: 0.05
        },
        {
          metricId: 'core_housingTransactions',
          label: 'Housing Transactions',
          status: 'warn',
          requirement: 'required',
          units: 'count/month',
          sourceLabel: 'Bank of England FPC core indicators, June 2024',
          targetBand: { lower: 84, upper: 100 },
          seedMean: 90,
          p25: 88,
          p75: 92,
          insideRate: 0.5,
          normalizedDistance: 0.1,
          normalizedIqr: 0.05,
          metricLoss: 0.2
        }
      ]
    },
    null,
    2
  )
);
const modernSummary = readValidationSummary(validationSummaryFixtureRoot, 'v-modern');
assert.equal(modernSummary.validationTargetYear, 2024, 'Validation parser should default missing target years to 2024');
assert.equal(modernSummary.metrics[0]?.sourceReferences.length ?? 0, 1, 'Validation parser should preserve source references');
assert.equal(modernSummary.metrics[0]?.lossFamily, 'positive_level', 'Validation parser should expose loss family');
assert.equal(modernSummary.metrics[0]?.lossTransform, 'log_ratio_to_target_band', 'Validation parser should expose loss transform');
assert.equal(modernSummary.metrics[0]?.lossScaleBasis, 'not_applicable', 'Validation parser should expose loss scale basis');
assert.equal(modernSummary.metrics[0]?.lossScale, null, 'Validation parser should expose null loss scales for log-ratio metrics');
assert.equal(modernSummary.metrics[0]?.distanceComponent, 0.414657051, 'Validation parser should expose loss components');
assert.equal(modernSummary.metrics[0]?.metricWeight, 1, 'Validation parser should expose raw metric weights');
assert.equal(
  modernSummary.metrics[0]?.lossDeltaVsReference2011 ?? null,
  null,
  'Validation parser should default missing loss deltas to null'
);
assert.equal(
  modernSummary.metrics[0]?.lossDeltaPercentVsReference2011 ?? null,
  null,
  'Validation parser should default missing percent loss deltas to null'
);
assert.equal(
  Object.prototype.hasOwnProperty.call(modernSummary.metrics[0] ?? {}, 'familyId'),
  false,
  'Validation parser should ignore removed metric family ids'
);
assert.equal(
  Object.prototype.hasOwnProperty.call(modernSummary, 'familySummaries'),
  false,
  'Validation parser should ignore removed family summaries'
);
assert.equal(
  modernSummary.metrics[0]?.sourceReferences[0]?.sourceDocumentPath,
  'input-data-versions/validation-sources/2024/ukf/Buy to let Mortgage Market Update Q1.pdf',
  'Validation parser should expose source reference document paths'
);
const legacySummary = readValidationSummary(validationSummaryFixtureRoot, 'v-legacy');
assert.equal(
  legacySummary.validationTargetYear,
  2024,
  'Legacy validation summaries should default missing top-level target years to 2024'
);
assert.equal(legacySummary.metrics[0]?.sourceReferences.length ?? 0, 0, 'Validation parser should default missing source references to an empty list');
assert.equal(legacySummary.metrics[0]?.sourceIndicatorLabel ?? null, null, 'Legacy validation summaries should parse without source detail fields');
assert.equal(legacySummary.metrics[0]?.metricWeight, 1, 'Legacy validation summaries should default missing metric weights to 1');
assert.equal(
  legacySummary.metrics[0]?.lossDeltaVsReference2011 ?? null,
  null,
  'Legacy validation summaries should default missing loss deltas to null'
);
assert.equal(
  legacySummary.metrics[0]?.lossDeltaPercentVsReference2011 ?? null,
  null,
  'Legacy validation summaries should default missing percent loss deltas to null'
);
const originalFixtureSummary = readValidationSummary(validationSummaryFixtureRoot, 'v0');
assert.equal(
  originalFixtureSummary.validationTargetYear,
  2024,
  'Validation parser should keep legacy v0 tracked summaries on the ordinary 2024 timeline'
);
assert.equal(
  originalFixtureSummary.referenceLine,
  null,
  'Tracked v0 summaries should not need to embed the separate 2011 comparator payload'
);
const overviewWithReferenceLine = getValidationOverview(validationSummaryFixtureRoot, 'v4.0');
assert.equal(overviewWithReferenceLine.selectedValidationTargetYear, 2024);
assert.equal(
  overviewWithReferenceLine.trend.points.find((point) => point.version === 'v0')?.overallCompositeLoss,
  0.5,
  'Validation overview should keep the tracked v0 point on its own 2024 summary value'
);
assert.equal(
  overviewWithReferenceLine.trend.points.find((point) => point.version === 'v0')?.validationTargetYear,
  2024,
  'Validation overview should keep the tracked v0 point on the 2024 summary timeline'
);
assert.equal(
  overviewWithReferenceLine.trend.referenceLine?.overallCompositeLoss,
  0.8,
  'Validation overview should source the dashed comparator from the separate referenceLine artifact'
);
assert.equal(
  overviewWithReferenceLine.trend.referenceLine?.validationTargetYear,
  2011,
  'Validation overview should keep the dashed comparator on the 2011 reference timeline'
);
assert.deepEqual(
  overviewWithReferenceLine.trend.referencePoints.map((point) => point.version),
  ['v0'],
  'Validation overview should expose available sparse 2011 reference points keyed to tracked versions'
);
assert.deepEqual(
  overviewWithReferenceLine.availableValidationTargetYearsByVersion.v0,
  [2024, 2011],
  'Validation overview should expose 2011 as a selectable validation year only when an overlay exists'
);
assert.deepEqual(
  overviewWithReferenceLine.availableValidationTargetYearsByVersion['v4.0'],
  [2024],
  'Validation overview should not expose 2011 for versions without a matching overlay'
);
assert.equal(
  overviewWithReferenceLine.selectedSummary.metrics.find((metric) => metric.metricId === 'core_mortgageApprovals')
    ?.lossDeltaVsReference2011,
  0.05,
  'Tracked validation summaries should expose positive signed loss deltas when they score worse than v0-2011'
);
assert.equal(
  overviewWithReferenceLine.selectedSummary.metrics.find((metric) => metric.metricId === 'core_mortgageApprovals')
    ?.lossDeltaPercentVsReference2011,
  null,
  'Tracked validation summaries should expose null percent loss deltas when the v0-2011 reference loss is zero'
);
assert.equal(
  overviewWithReferenceLine.selectedSummary.metrics.find((metric) => metric.metricId === 'core_housingTransactions')
    ?.lossDeltaVsReference2011,
  -0.3,
  'Tracked validation summaries should expose negative signed loss deltas when they score better than v0-2011'
);
assertClose(
  overviewWithReferenceLine.selectedSummary.metrics.find((metric) => metric.metricId === 'core_housingTransactions')
    ?.lossDeltaPercentVsReference2011 ?? NaN,
  -60,
  1e-12,
  'Tracked validation summaries should expose percent loss deltas against non-zero v0-2011 reference losses'
);
const referenceOverviewWithDeltas = getValidationOverview(validationSummaryFixtureRoot, 'v0', 2011);
assert.equal(referenceOverviewWithDeltas.selectedVersion, 'v0');
assert.equal(referenceOverviewWithDeltas.selectedValidationTargetYear, 2011);
assert.ok(
  referenceOverviewWithDeltas.selectedSummary.metrics.every((metric) => metric.lossDeltaVsReference2011 === 0),
  'Selecting the v0 2011 validation year should expose zero deltas for every supported v0-2011 baseline metric'
);
assert.ok(
  referenceOverviewWithDeltas.selectedSummary.metrics.every((metric) => metric.lossDeltaPercentVsReference2011 === 0),
  'Selecting the v0 2011 validation year should expose zero percent deltas for every supported v0-2011 baseline metric'
);
const unsupportedFixtureReferenceRequest = getValidationOverview(validationSummaryFixtureRoot, 'v4.0', 2011);
assert.equal(
  unsupportedFixtureReferenceRequest.selectedValidationTargetYear,
  2024,
  'Validation overview should fall back to 2024 when 2011 is requested for a version without an overlay'
);

const rangeAtSameVersion = compareParameters(repoRoot, 'v4.0', 'v4.0', ['national_insurance_rates'], 'range');
const throughRightAtSameVersion = compareParameters(repoRoot, 'v4.0', 'v4.0', ['national_insurance_rates'], 'through_right');
assert.equal(
  rangeAtSameVersion.items[0]?.changeOriginsInRange.length ?? 0,
  0,
  'range provenance scope should be empty when left and right are the same version'
);
assert.ok(
  (throughRightAtSameVersion.items[0]?.changeOriginsInRange.length ?? 0) > 0,
  'through_right provenance scope should include historical updates through the selected version'
);
assert.ok(
  throughRightAtSameVersion.items[0]?.changeOriginsInRange.some((origin) => origin.versionId === 'v2.0'),
  'through_right provenance should include NI update origin v2.0'
);

const singleBuyQuad = compareParameters(repoRoot, 'v4.0', 'v4.0', ['buy_quad'], 'through_right').items[0];
const buyQuadV38Origin = singleBuyQuad?.changeOriginsInRange.find((origin) => origin.versionId === 'v4.0');
assert.ok(buyQuadV38Origin, 'Expected buy_quad provenance to include v4.0 origin in through_right scope');
assert.ok(singleBuyQuad && singleBuyQuad.visualPayload.type === 'buy_quad', 'Expected buy_quad payload to use buy_quad type');
if (singleBuyQuad && singleBuyQuad.visualPayload.type === 'buy_quad') {
  const muRow = singleBuyQuad.visualPayload.parameters.find((row) => row.key === 'BUY_MU');
  assert.ok(muRow, 'Expected BUY_MU row in buy_quad parameters');
  assert.ok(
    Number.isFinite(singleBuyQuad.visualPayload.medianMultiplier.left) &&
      singleBuyQuad.visualPayload.medianMultiplier.left > 0,
    'Expected buy_quad medianMultiplier.left to be a positive finite number'
  );
  assert.ok(
    Number.isFinite(singleBuyQuad.visualPayload.medianMultiplier.right) &&
      singleBuyQuad.visualPayload.medianMultiplier.right > 0,
    'Expected buy_quad medianMultiplier.right to be a positive finite number'
  );
  assertClose(
    singleBuyQuad.visualPayload.medianMultiplier.right,
    Math.exp(Number(muRow?.right ?? Number.NaN)),
    1e-12,
    'Expected buy_quad medianMultiplier.right to match exp(BUY_MU)'
  );
}
assert.ok(
  (buyQuadV38Origin?.methodVariations.length ?? 0) > 0,
  'Expected buy_quad v4.0 provenance to include method variation notes'
);
assert.ok(
  buyQuadV38Origin?.methodVariations.some((variation) =>
    variation.configParameters.some((parameter) => parameter.startsWith('BUY_'))
  ),
  'Expected at least one method variation scoped to BUY_* parameters'
);
assert.ok(
  buyQuadV38Origin?.parameterChanges.every(
    (change) => !change.configParameter.startsWith('BUY_') || change.datasetSource === null
  ),
  'Expected v4.0 BUY_* parameter changes to have null dataset_source'
);

const compare = compareParameters(repoRoot, 'v0', versions[versions.length - 1], [
  'mortgage_duration_years',
  'house_price_lognormal',
  'desired_rent_power',
  'buy_quad',
  'income_given_age_joint',
  'national_insurance_rates',
  'income_tax_rates',
  'wealth_given_income_joint',
  'age_distribution'
]);

assert.equal(compare.left, 'v0');
assert.equal(compare.items.length, 9);

const formatSet = new Set(compare.items.map((item) => item.format));
assert.ok(formatSet.has('scalar'));
assert.ok(formatSet.has('lognormal_pair'));
assert.ok(formatSet.has('power_law_pair'));
assert.ok(formatSet.has('buy_quad'));
assert.ok(formatSet.has('joint_distribution'));
assert.ok(formatSet.has('binned_distribution'));

const unchangedCards = compareParameters(repoRoot, 'v0', latestVersion, [...unchangedNewlyAddedIds], 'range');
assert.equal(
  unchangedCards.items.length,
  unchangedNewlyAddedIds.length,
  'Expected all unchanged newly added cards in compare payload'
);
for (const item of unchangedCards.items) {
  assert.equal(item.unchanged, true, `Expected newly added card ${item.id} to remain unchanged across versions`);
}

const householdConsumptionCompare = compareParameters(
  repoRoot,
  'v0',
  latestVersion,
  ['household_consumption_fractions'],
  'range'
);
assert.equal(householdConsumptionCompare.items.length, 1, 'Expected household_consumption_fractions compare payload');
assert.equal(
  householdConsumptionCompare.items[0]?.unchanged,
  false,
  'Expected household_consumption_fractions to differ from v0 once the v4.12 LCFS promotion is included'
);
assert.ok(
  householdConsumptionCompare.items[0]?.changeOriginsInRange.some((origin) => origin.versionId === 'v4.12'),
  'Expected household_consumption_fractions provenance to include the v4.12 LCFS promotion'
);

const hpaExpectationCompare = compareParameters(repoRoot, 'v0', latestVersion, ['hpa_expectation_params'], 'range');
assert.equal(hpaExpectationCompare.items.length, 1, 'Expected hpa_expectation_params compare payload');
assert.equal(
  hpaExpectationCompare.items[0]?.unchanged,
  false,
  'Expected hpa_expectation_params to differ from v0 once the v4.2 HPA promotion is included'
);
assert.ok(
  hpaExpectationCompare.items[0]?.changeOriginsInRange.some((origin) => origin.versionId === 'v4.2'),
  'Expected hpa_expectation_params provenance to include the v4.2 HPA promotion'
);
assert.ok(
  hpaExpectationCompare.items[0]?.changeOriginsInRange.some(
    (origin) => origin.versionId === 'v4.2' && origin.validationStatus === 'complete'
  ),
  'Expected hpa_expectation_params provenance to show v4.2 as validation-complete'
);

const bankLtvCompare = compareParameters(repoRoot, 'v0', latestVersion, ['bank_ltv_limits'], 'range');
assert.equal(bankLtvCompare.items.length, 1, 'Expected bank_ltv_limits compare payload');
assert.equal(
  bankLtvCompare.items[0]?.unchanged,
  false,
  'Expected bank_ltv_limits to change in the latest version due to v4.1 cap alignment'
);
assert.ok(
  bankLtvCompare.items[0]?.changeOriginsInRange.some(
    (origin) => origin.versionId === 'v4.1' && origin.validationStatus === 'complete'
  ),
  'Expected bank_ltv_limits provenance to show the v4.1 alignment as validation-complete'
);

const saleMarkup = unchangedCards.items.find((item) => item.id === 'initial_sale_markup_distribution');
assert.ok(
  saleMarkup && saleMarkup.visualPayload.type === 'binned_distribution',
  'Expected initial_sale_markup_distribution card with binned payload'
);
if (saleMarkup && saleMarkup.visualPayload.type === 'binned_distribution') {
  assert.ok(
    saleMarkup.visualPayload.bins.every((bin) => Math.abs(bin.delta) <= 1e-12),
    'Sale mark-up bins should have zero delta across versions'
  );
}

const rentMarkup = unchangedCards.items.find((item) => item.id === 'initial_rent_markup_distribution');
assert.ok(
  rentMarkup && rentMarkup.visualPayload.type === 'binned_distribution',
  'Expected initial_rent_markup_distribution card with binned payload'
);
if (rentMarkup && rentMarkup.visualPayload.type === 'binned_distribution') {
  assert.ok(
    rentMarkup.visualPayload.bins.every((bin) => Math.abs(bin.delta) <= 1e-12),
    'Rent mark-up bins should have zero delta across versions'
  );
}

const unchangedSingleWithProvenance = compareParameters(
  repoRoot,
  latestVersion,
  latestVersion,
  [...unchangedNewlyAddedIds],
  'through_right'
);
for (const item of unchangedSingleWithProvenance.items) {
  assert.equal(
    item.changeOriginsInRange.length,
    0,
    `Expected no provenance origins for newly added card ${item.id} in through_right scope`
  );
}

const reshapedCards = compareParameters(repoRoot, 'v0', latestVersion, [
  'price_reduction_probabilities',
  'sale_reduction_gaussian',
  'rent_reduction_gaussian',
  'hpa_expectation_params'
]);

const priceReductionProbabilities = reshapedCards.items.find((item) => item.id === 'price_reduction_probabilities');
assert.ok(priceReductionProbabilities, 'Expected price_reduction_probabilities card');
assert.equal(priceReductionProbabilities?.format, 'scalar_pair');
assert.deepEqual(priceReductionProbabilities?.sourceInfo.configKeys, ['P_SALE_PRICE_REDUCE', 'P_RENT_PRICE_REDUCE']);

const saleReductionGaussian = reshapedCards.items.find((item) => item.id === 'sale_reduction_gaussian');
assert.ok(saleReductionGaussian, 'Expected sale_reduction_gaussian card');
assert.equal(saleReductionGaussian?.format, 'gaussian_pair');
assert.ok(
  saleReductionGaussian?.visualPayload.type === 'gaussian_pair',
  'Expected gaussian_pair payload for sale_reduction_gaussian'
);
if (saleReductionGaussian?.visualPayload.type === 'gaussian_pair') {
  assert.equal(saleReductionGaussian.visualPayload.percentDomain.max, 50, 'Sale gaussian percent domain max should be 50');
  assert.ok(
    Number.isFinite(saleReductionGaussian.visualPayload.percentCapMassLeft) &&
      saleReductionGaussian.visualPayload.percentCapMassLeft >= 0 &&
      saleReductionGaussian.visualPayload.percentCapMassLeft <= 1,
    'Sale gaussian left cap mass should be a finite probability in [0, 1]'
  );
  assert.ok(
    Number.isFinite(saleReductionGaussian.visualPayload.percentCapMassRight) &&
      saleReductionGaussian.visualPayload.percentCapMassRight >= 0 &&
      saleReductionGaussian.visualPayload.percentCapMassRight <= 1,
    'Sale gaussian right cap mass should be a finite probability in [0, 1]'
  );
  assert.ok(
    saleReductionGaussian.visualPayload.logDomain.min < saleReductionGaussian.visualPayload.logDomain.max,
    'Sale gaussian log domain should be increasing'
  );
  assert.ok(
    saleReductionGaussian.visualPayload.percentDomain.min < saleReductionGaussian.visualPayload.percentDomain.max,
    'Sale gaussian percent domain should be increasing'
  );
  assert.ok(
    saleReductionGaussian.visualPayload.logCurveRight.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.y >= 0
    ),
    'Sale gaussian log curve should contain finite non-negative densities'
  );
  assert.ok(
    saleReductionGaussian.visualPayload.percentCurveRight.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.y >= 0 && point.x > 0 && point.x <= 50
    ),
    'Sale gaussian percent curve should contain finite non-negative densities within (0, 50]'
  );

  const muLeft = saleReductionGaussian.visualPayload.parameters.find((row) => row.key === 'REDUCTION_MU')?.left;
  const muRight = saleReductionGaussian.visualPayload.parameters.find((row) => row.key === 'REDUCTION_MU')?.right;
  const sigmaRight = saleReductionGaussian.visualPayload.parameters.find((row) => row.key === 'REDUCTION_SIGMA')?.right;
  assert.ok(muLeft !== undefined, 'Expected sale reduction mu in left parameters');
  assert.ok(muRight !== undefined, 'Expected sale reduction mu in parameters');
  assert.ok(sigmaRight !== undefined && sigmaRight > 0, 'Expected positive sale reduction sigma in parameters');
  assertClose(
    saleReductionGaussian.visualPayload.logMedian.left,
    Number(muLeft),
    1e-12,
    'Expected sale gaussian logMedian.left to match REDUCTION_MU'
  );
  assertClose(
    saleReductionGaussian.visualPayload.logMedian.right,
    Number(muRight),
    1e-12,
    'Expected sale gaussian logMedian.right to match REDUCTION_MU'
  );
  assertClose(
    saleReductionGaussian.visualPayload.percentMedian.left,
    Math.exp(Number(muLeft)),
    1e-12,
    'Expected sale gaussian percentMedian.left to equal exp(REDUCTION_MU)'
  );
  assertClose(
    saleReductionGaussian.visualPayload.percentMedian.right,
    Math.exp(Number(muRight)),
    1e-12,
    'Expected sale gaussian percentMedian.right to equal exp(REDUCTION_MU)'
  );
  const sample = saleReductionGaussian.visualPayload.percentCurveRight[
    Math.floor(saleReductionGaussian.visualPayload.percentCurveRight.length / 2)
  ];
  assert.ok(sample, 'Expected sample point for sale percent curve');
  const expectedDensity = gaussianPercentDensity(sample.x, muRight as number, sigmaRight as number);
  assertClose(sample.y, expectedDensity, 1e-12, 'Sale percent curve should match transformed Gaussian density');
}

const rentReductionGaussian = reshapedCards.items.find((item) => item.id === 'rent_reduction_gaussian');
assert.ok(rentReductionGaussian, 'Expected rent_reduction_gaussian card');
assert.equal(rentReductionGaussian?.format, 'gaussian_pair');
assert.ok(
  rentReductionGaussian?.visualPayload.type === 'gaussian_pair',
  'Expected gaussian_pair payload for rent_reduction_gaussian'
);
if (rentReductionGaussian?.visualPayload.type === 'gaussian_pair') {
  assert.equal(rentReductionGaussian.visualPayload.percentDomain.max, 50, 'Rent gaussian percent domain max should be 50');
  assert.ok(
    Number.isFinite(rentReductionGaussian.visualPayload.percentCapMassLeft) &&
      rentReductionGaussian.visualPayload.percentCapMassLeft >= 0 &&
      rentReductionGaussian.visualPayload.percentCapMassLeft <= 1,
    'Rent gaussian left cap mass should be a finite probability in [0, 1]'
  );
  assert.ok(
    Number.isFinite(rentReductionGaussian.visualPayload.percentCapMassRight) &&
      rentReductionGaussian.visualPayload.percentCapMassRight >= 0 &&
      rentReductionGaussian.visualPayload.percentCapMassRight <= 1,
    'Rent gaussian right cap mass should be a finite probability in [0, 1]'
  );
  assert.ok(
    rentReductionGaussian.visualPayload.logCurveRight.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.y >= 0
    ),
    'Rent gaussian log curve should contain finite non-negative densities'
  );
  assert.ok(
    rentReductionGaussian.visualPayload.percentCurveRight.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.y >= 0 && point.x > 0 && point.x <= 50
    ),
    'Rent gaussian percent curve should contain finite non-negative densities within (0, 50]'
  );

  const muLeft = rentReductionGaussian.visualPayload.parameters.find((row) => row.key === 'RENT_REDUCTION_MU')?.left;
  const muRight = rentReductionGaussian.visualPayload.parameters.find((row) => row.key === 'RENT_REDUCTION_MU')?.right;
  const sigmaRight = rentReductionGaussian.visualPayload.parameters.find((row) => row.key === 'RENT_REDUCTION_SIGMA')?.right;
  assert.ok(muLeft !== undefined, 'Expected rent reduction mu in left parameters');
  assert.ok(muRight !== undefined, 'Expected rent reduction mu in parameters');
  assert.ok(sigmaRight !== undefined && sigmaRight > 0, 'Expected positive rent reduction sigma in parameters');
  assertClose(
    rentReductionGaussian.visualPayload.logMedian.left,
    Number(muLeft),
    1e-12,
    'Expected rent gaussian logMedian.left to match RENT_REDUCTION_MU'
  );
  assertClose(
    rentReductionGaussian.visualPayload.logMedian.right,
    Number(muRight),
    1e-12,
    'Expected rent gaussian logMedian.right to match RENT_REDUCTION_MU'
  );
  assertClose(
    rentReductionGaussian.visualPayload.percentMedian.left,
    Math.exp(Number(muLeft)),
    1e-12,
    'Expected rent gaussian percentMedian.left to equal exp(RENT_REDUCTION_MU)'
  );
  assertClose(
    rentReductionGaussian.visualPayload.percentMedian.right,
    Math.exp(Number(muRight)),
    1e-12,
    'Expected rent gaussian percentMedian.right to equal exp(RENT_REDUCTION_MU)'
  );
  const sample = rentReductionGaussian.visualPayload.percentCurveRight[
    Math.floor(rentReductionGaussian.visualPayload.percentCurveRight.length / 2)
  ];
  assert.ok(sample, 'Expected sample point for rent percent curve');
  const expectedDensity = gaussianPercentDensity(sample.x, muRight as number, sigmaRight as number);
  assertClose(sample.y, expectedDensity, 1e-12, 'Rent percent curve should match transformed Gaussian density');
}

const hpaExpectation = reshapedCards.items.find((item) => item.id === 'hpa_expectation_params');
assert.ok(hpaExpectation, 'Expected hpa_expectation_params card');
assert.equal(hpaExpectation?.format, 'hpa_expectation_line');
assert.ok(
  hpaExpectation?.visualPayload.type === 'hpa_expectation_line',
  'Expected hpa_expectation_line payload for hpa_expectation_params'
);
if (hpaExpectation?.visualPayload.type === 'hpa_expectation_line') {
  assert.equal(hpaExpectation.visualPayload.domain.min, -0.2, 'HPA domain min should be -0.2');
  assert.equal(hpaExpectation.visualPayload.domain.max, 0.2, 'HPA domain max should be 0.2');
  assert.equal(hpaExpectation.visualPayload.dt, 1, 'HPA expectation DT should equal 1');

  const factorRight = hpaExpectation.visualPayload.parameters.find((row) => row.key === 'HPA_EXPECTATION_FACTOR')?.right;
  const constRight = hpaExpectation.visualPayload.parameters.find((row) => row.key === 'HPA_EXPECTATION_CONST')?.right;
  assert.ok(factorRight !== undefined, 'Expected HPA factor in parameters');
  assert.ok(constRight !== undefined, 'Expected HPA const in parameters');

  const sample = hpaExpectation.visualPayload.curveRight[Math.floor(hpaExpectation.visualPayload.curveRight.length / 2)];
  assert.ok(sample, 'Expected mid-point sample for HPA curve');
  const expected = (factorRight as number) * sample.x + (constRight as number);
  assertClose(sample.y, expected, 1e-12, 'HPA curve should satisfy y = factor*x + const');
}

for (const item of compare.items) {
  assert.equal(item.leftVersion, 'v0');
  assert.ok(item.sourceInfo.configPathLeft.endsWith('config.properties'));
  assert.ok(item.sourceInfo.configPathRight.endsWith('config.properties'));
  assert.ok(Array.isArray(item.sourceInfo.datasetsLeft), 'datasetsLeft should be present on every compare item');
  assert.ok(Array.isArray(item.sourceInfo.datasetsRight), 'datasetsRight should be present on every compare item');
  assert.ok(Array.isArray(item.changeOriginsInRange), 'changeOriginsInRange should be present on every compare item');
  for (const origin of item.changeOriginsInRange) {
    assert.ok(Array.isArray(origin.parameterChanges), 'parameterChanges should be present on every provenance origin');
    assert.ok(!('validationDataset' in origin), 'validationDataset should not be exposed on compare origins');
  }
}

const ageDist = compare.items.find((item) => item.id === 'age_distribution');
assert.ok(ageDist && ageDist.visualPayload.type === 'binned_distribution');
if (ageDist && ageDist.visualPayload.type === 'binned_distribution') {
  const leftConfig = parseConfigFile(getConfigPath(repoRoot, 'v0'));
  const rightConfig = parseConfigFile(getConfigPath(repoRoot, compare.right));
  const leftRows = readNumericCsvRows(
    resolveConfigDataFilePath(repoRoot, 'v0', leftConfig.get('DATA_AGE_DISTRIBUTION') ?? '')
  );
  const rightRows = readNumericCsvRows(
    resolveConfigDataFilePath(repoRoot, compare.right, rightConfig.get('DATA_AGE_DISTRIBUTION') ?? '')
  );

  const rawLeftMass = sumBinnedDensityMass(leftRows);
  const rawRightMass = sumBinnedDensityMass(rightRows);
  const rebinnedLeftMass = sum(ageDist.visualPayload.bins.map((bin) => bin.left));
  const rebinnedRightMass = sum(ageDist.visualPayload.bins.map((bin) => bin.right));

  assertClose(rebinnedLeftMass, rawLeftMass, 1e-8, '1D density rebin should preserve left mass');
  assertClose(rebinnedRightMass, rawRightMass, 1e-8, '1D density rebin should preserve right mass');
}

const ageDistV411 = compareParameters(repoRoot, 'v0', 'v4.11', ['age_distribution']).items[0];
assert.ok(ageDistV411 && ageDistV411.visualPayload.type === 'binned_distribution');
if (ageDistV411 && ageDistV411.visualPayload.type === 'binned_distribution') {
  const leftConfig = parseConfigFile(getConfigPath(repoRoot, 'v0'));
  const rightConfig = parseConfigFile(getConfigPath(repoRoot, 'v4.11'));
  const leftRows = readNumericCsvRows(
    resolveConfigDataFilePath(repoRoot, 'v0', leftConfig.get('DATA_AGE_DISTRIBUTION') ?? '')
  );
  const rightRows = readNumericCsvRows(
    resolveConfigDataFilePath(repoRoot, 'v4.11', rightConfig.get('DATA_AGE_DISTRIBUTION') ?? '')
  );
  const sourceBins = ageDistV411.visualPayload.sourceBins;
  assert.ok(sourceBins, 'Expected source bins for age_distribution');
  assert.equal(sourceBins.left.length, 8, 'Expected v0 source age distribution to keep 8 bins');
  assert.equal(sourceBins.right.length, 15, 'Expected v4.11 source age distribution to keep 15 bins');
  assert.equal(sourceBins.left.length, leftRows.length, 'Expected v0 source bins to match raw CSV rows');
  assert.equal(sourceBins.right.length, rightRows.length, 'Expected v4.11 source bins to match raw CSV rows');
  assert.equal(sourceBins.left[0]?.lower, 15, 'Expected v0 first age bin lower edge to be preserved');
  assert.equal(sourceBins.left[0]?.upper, 25, 'Expected v0 first age bin upper edge to be preserved');
  assert.equal(sourceBins.right[0]?.lower, 16, 'Expected v4.11 first age bin lower edge to be preserved');
  assert.equal(sourceBins.right[0]?.upper, 20, 'Expected v4.11 first age bin upper edge to be preserved');

  const rawLeftMass = sumBinnedDensityMass(leftRows);
  const rawRightMass = sumBinnedDensityMass(rightRows);
  const rebinnedLeftMass = sum(ageDistV411.visualPayload.bins.map((bin) => bin.left));
  const rebinnedRightMass = sum(ageDistV411.visualPayload.bins.map((bin) => bin.right));
  assertClose(rebinnedLeftMass, rawLeftMass, 1e-8, 'v4.11 age compare should preserve left mass');
  assertClose(rebinnedRightMass, rawRightMass, 1e-8, 'v4.11 age compare should preserve right mass');

  const option = binnedOption(
    ageDistV411,
    'Age band (years)',
    'Household share (-)',
    'Share delta (-)',
    { leftLabel: 'v0 original', rightLabel: 'v4.11 latest' }
  );
  const xAxis = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis;
  assert.equal((xAxis as any)?.type, 'value', 'Unequal source bins should use a numeric x-axis');
  const series = Array.isArray(option.series) ? option.series : [];
  assert.ok(series.every((entry: any) => entry.type === 'custom'), 'Unequal source bins should use interval series');
  assert.equal((series[0] as any)?.data?.length, 8, 'Left interval series should use v0 source bins');
  assert.equal((series[1] as any)?.data?.length, 15, 'Right interval series should use v4.11 source bins');
}

const incomeAgeV40 = compareParameters(repoRoot, 'v0', 'v4.0', ['income_given_age_joint']);
const incomeAge = incomeAgeV40.items.find((item) => item.id === 'income_given_age_joint');
assert.ok(incomeAge && incomeAge.visualPayload.type === 'joint_distribution');
if (incomeAge && incomeAge.visualPayload.type === 'joint_distribution') {
  const xLabels = incomeAge.visualPayload.matrix.xAxis.labels;
  assert.ok(xLabels.includes('75-85'), 'Expected shared age x-bin 75-85');
  assert.ok(xLabels.includes('85-95'), 'Expected shared age x-bin 85-95');
  assert.ok(!xLabels.includes('75-95'), 'Expected no merged 75-95 x-bin in shared grid');

  const leftConfig = parseConfigFile(getConfigPath(repoRoot, 'v0'));
  const rightConfig = parseConfigFile(getConfigPath(repoRoot, 'v4.0'));
  const leftRows = readNumericCsvRows(
    resolveConfigDataFilePath(repoRoot, 'v0', leftConfig.get('DATA_INCOME_GIVEN_AGE') ?? '')
  );
  const rightRows = readNumericCsvRows(
    resolveConfigDataFilePath(repoRoot, 'v4.0', rightConfig.get('DATA_INCOME_GIVEN_AGE') ?? '')
  );

  const rawLeftMass = sum(leftRows.map((row) => row[4]));
  const rawRightMass = sum(rightRows.map((row) => row[4]));
  const rebinnedLeftMass = sum(incomeAge.visualPayload.matrix.left.map((cell) => cell.value));
  const rebinnedRightMass = sum(incomeAge.visualPayload.matrix.right.map((cell) => cell.value));

  assertClose(rebinnedLeftMass, rawLeftMass, 1e-7, '2D rebin should preserve left mass');
  assertClose(rebinnedRightMass, rawRightMass, 1e-7, '2D rebin should preserve right mass');
}

const wealthIncome = compare.items.find((item) => item.id === 'wealth_given_income_joint');
assert.ok(wealthIncome && wealthIncome.visualPayload.type === 'joint_distribution');
if (wealthIncome && wealthIncome.visualPayload.type === 'joint_distribution') {
  assert.ok(
    wealthIncome.visualPayload.matrix.xAxis.labels.some((label) => label.includes('£')),
    'Expected clean level-space labels on wealth/income x axis'
  );
  assert.ok(
    wealthIncome.visualPayload.matrix.yAxis.labels.some((label) => label.includes('£')),
    'Expected clean level-space labels on wealth/income y axis'
  );
}

const niRates = compare.items.find((item) => item.id === 'national_insurance_rates');
assert.ok(niRates && niRates.visualPayload.type === 'binned_distribution', 'Expected NI rates card in compare payload');
if (niRates && niRates.visualPayload.type === 'binned_distribution') {
  assert.equal(niRates.unchanged, false, 'NI thresholds/rates should be changed between v0 and v4.0');
  assert.ok(
    niRates.visualPayload.bins.some((bin) => Math.abs(bin.delta) > 1e-12),
    'At least one NI step-rate bracket should have non-zero delta'
  );
  assert.ok(
    niRates.changeOriginsInRange.some((origin) => origin.versionId === 'v2.0'),
    'NI card provenance should include v2.0'
  );
}

const buyQuad = compare.items.find((item) => item.id === 'buy_quad');
assert.ok(buyQuad, 'Expected buy_quad card');
assert.ok(
  buyQuad?.changeOriginsInRange.some((origin) => origin.versionId === 'v4.0' && origin.validationStatus === 'complete'),
  'buy_quad provenance should include v4.0 as complete'
);
assert.ok(buyQuad && buyQuad.visualPayload.type === 'buy_quad', 'Expected buy_quad card to return buy_quad payload');
if (buyQuad && buyQuad.visualPayload.type === 'buy_quad') {
  assert.ok(
    Number.isFinite(buyQuad.visualPayload.medianMultiplier.left) && buyQuad.visualPayload.medianMultiplier.left > 0,
    'Expected compare buy_quad medianMultiplier.left to be positive and finite'
  );
  assert.ok(
    Number.isFinite(buyQuad.visualPayload.medianMultiplier.right) && buyQuad.visualPayload.medianMultiplier.right > 0,
    'Expected compare buy_quad medianMultiplier.right to be positive and finite'
  );
}

const btlStrategySplit = compareParameters(repoRoot, 'v0', latestVersion, ['btl_strategy_split'], 'range').items[0];
assert.ok(btlStrategySplit, 'Expected btl_strategy_split card');
assert.ok(
  btlStrategySplit.visualPayload.type === 'scalar',
  'Expected btl_strategy_split to use scalar visual payload'
);
if (btlStrategySplit.visualPayload.type === 'scalar') {
  const strategyRows = btlStrategySplit.visualPayload.values;
  assert.deepEqual(
    strategyRows.map((row) => row.key),
    ['BTL_P_INCOME_DRIVEN', 'BTL_P_CAPITAL_DRIVEN', 'BTL_P_MIXED'],
    'Expected BTL strategy split to include configured strategy shares plus derived mixed share'
  );

  const incomeDriven = strategyRows.find((row) => row.key === 'BTL_P_INCOME_DRIVEN');
  const capitalDriven = strategyRows.find((row) => row.key === 'BTL_P_CAPITAL_DRIVEN');
  const mixedDriven = strategyRows.find((row) => row.key === 'BTL_P_MIXED');
  assert.ok(incomeDriven, 'Expected BTL income-driven row');
  assert.ok(capitalDriven, 'Expected BTL capital-driven row');
  assert.ok(mixedDriven, 'Expected derived BTL mixed row');
  assertClose(
    mixedDriven?.left ?? Number.NaN,
    1 - (incomeDriven?.left ?? Number.NaN) - (capitalDriven?.left ?? Number.NaN),
    1e-12,
    'BTL_P_MIXED left value should be residual strategy probability'
  );
  assertClose(
    mixedDriven?.right ?? Number.NaN,
    1 - (incomeDriven?.right ?? Number.NaN) - (capitalDriven?.right ?? Number.NaN),
    1e-12,
    'BTL_P_MIXED right value should be residual strategy probability'
  );
  assert.equal(
    btlStrategySplit.sourceInfo.configKeys.includes('BTL_P_MIXED'),
    false,
    'Derived BTL_P_MIXED should not be reported as a physical config key'
  );
}

const newlyCoveredCalibrationIds = [
  'central_bank_base_rate',
  'central_bank_ltv_limits',
  'central_bank_lti_soft_limits',
  'central_bank_affordability_icr_limits',
  'bank_age_limit',
  'hpa_lookback_years',
  'days_under_offer',
  'downpayment_btl_lognormal',
  'rent_purchase_choice',
  'btl_probability_multiplier',
  'btl_choice_intensity'
] as const;

const newlyCoveredCalibration = compareParameters(
  repoRoot,
  'v0',
  latestVersion,
  [...newlyCoveredCalibrationIds],
  'range'
);
assert.equal(
  newlyCoveredCalibration.items.length,
  newlyCoveredCalibrationIds.length,
  'Expected all newly covered calibration cards in compare payload'
);

for (const item of newlyCoveredCalibration.items) {
  if (item.id === 'downpayment_btl_lognormal') {
    assert.equal(item.visualPayload.type, 'lognormal_pair', 'Expected BTL down-payment scale/shape to use lognormal payload');
  } else {
    assert.equal(item.visualPayload.type, 'scalar', `Expected ${item.id} to use scalar payload`);
  }
}

const centralBankBaseRate = newlyCoveredCalibration.items.find((item) => item.id === 'central_bank_base_rate');
assert.ok(
  centralBankBaseRate?.changeOriginsInRange.some((origin) => origin.versionId === 'v4.3'),
  'Expected central_bank_base_rate provenance to include BoE base-rate calibration'
);

const centralBankLtv = newlyCoveredCalibration.items.find((item) => item.id === 'central_bank_ltv_limits');
assert.ok(
  centralBankLtv?.changeOriginsInRange.some((origin) => origin.versionId === 'v4.1'),
  'Expected central_bank_ltv_limits provenance to include v4.1 policy alignment'
);

const centralBankLtiSoft = newlyCoveredCalibration.items.find((item) => item.id === 'central_bank_lti_soft_limits');
assert.ok(
  centralBankLtiSoft?.changeOriginsInRange.some((origin) => origin.versionId === 'v4.16'),
  'Expected central_bank_lti_soft_limits provenance to include v4.16 BoE LTI source alignment'
);

const centralBankAffordabilityIcr = newlyCoveredCalibration.items.find(
  (item) => item.id === 'central_bank_affordability_icr_limits'
);
assert.ok(
  centralBankAffordabilityIcr?.changeOriginsInRange.some((origin) => origin.versionId === 'v4.17'),
  'Expected central_bank_affordability_icr_limits provenance to include v4.17 affordability alignment'
);
assert.ok(
  centralBankAffordabilityIcr?.changeOriginsInRange.some((origin) => origin.versionId === 'v4.18'),
  'Expected central_bank_affordability_icr_limits provenance to include v4.18 ICR alignment'
);

const bankAgeLimit = newlyCoveredCalibration.items.find((item) => item.id === 'bank_age_limit');
assert.ok(
  bankAgeLimit?.changeOriginsInRange.some((origin) => origin.versionId === 'v4.9'),
  'Expected bank_age_limit provenance to include v4.9 lender-age calibration'
);

const hpaLookback = newlyCoveredCalibration.items.find((item) => item.id === 'hpa_lookback_years');
assert.ok(
  hpaLookback?.changeOriginsInRange.some((origin) => origin.versionId === 'v4.14oo'),
  'Expected hpa_lookback_years provenance to include v4.14oo status confirmation'
);

const noHistoryCards = ['days_under_offer', 'downpayment_btl_lognormal'] as const;
for (const id of noHistoryCards) {
  const item = newlyCoveredCalibration.items.find((candidate) => candidate.id === id);
  assert.ok(item, `Expected ${id} compare item`);
  assert.equal(
    item?.changeOriginsInRange.length,
    0,
    `Expected ${id} to be valid but have no tracked update metadata in selected scope`
  );
}

const rentPurchaseChoice = newlyCoveredCalibration.items.find((item) => item.id === 'rent_purchase_choice');
assert.ok(
  rentPurchaseChoice?.changeOriginsInRange.some((origin) => origin.versionId === 'v5o3'),
  'Expected rent_purchase_choice provenance to include latest output calibration'
);

const btlProbabilityMultiplier = newlyCoveredCalibration.items.find((item) => item.id === 'btl_probability_multiplier');
assert.ok(
  btlProbabilityMultiplier?.changeOriginsInRange.some((origin) => origin.versionId === 'v5o3'),
  'Expected btl_probability_multiplier provenance to include latest output calibration'
);

const btlChoiceIntensity = newlyCoveredCalibration.items.find((item) => item.id === 'btl_choice_intensity');
assert.ok(
  btlChoiceIntensity?.changeOriginsInRange.some((origin) => origin.versionId === 'v5o3'),
  'Expected btl_choice_intensity provenance to include latest output calibration'
);

const unchangedSingleSource = compareParameters(repoRoot, latestVersion, latestVersion, ['uk_housing_stock_totals'], 'through_right')
  .items[0];
assert.ok(unchangedSingleSource, 'Expected uk_housing_stock_totals in single compare payload');
assert.ok(unchangedSingleSource.unchanged, 'Expected uk_housing_stock_totals to be unchanged at same-version compare');
assert.ok(
  unchangedSingleSource.sourceInfo.datasetsRight.length > 0,
  'Expected unchanged single-version card to include source dataset attribution'
);

const wasSingle = compareParameters(repoRoot, 'v4.0', 'v4.0', ['age_distribution'], 'through_right').items[0];
assert.ok(wasSingle, 'Expected age_distribution card in single payload');
const wasDataset = wasSingle?.sourceInfo.datasetsRight.find((dataset) => dataset.tag === 'was');
assert.ok(wasDataset, 'Expected WAS dataset attribution for age_distribution');
assert.equal(wasDataset?.fullName, 'Wealth and Assets Survey', 'Expected WAS full name');
assert.equal(wasDataset?.year, '2022', 'Expected WAS Round 8 year to resolve to 2022');
assert.equal(wasDataset?.edition, 'Round 8', 'Expected WAS edition to resolve to Round 8');

const nmgCompare = compareParameters(repoRoot, 'v1.3', 'v4.0', ['rental_price_lognormal'], 'range').items[0];
assert.ok(nmgCompare, 'Expected rental_price_lognormal card in compare payload');
const nmgLeft = nmgCompare?.sourceInfo.datasetsLeft.find((dataset) => dataset.tag === 'nmg');
const nmgRight = nmgCompare?.sourceInfo.datasetsRight.find((dataset) => dataset.tag === 'nmg');
assert.ok(nmgLeft, 'Expected left-side NMG attribution');
assert.ok(nmgRight, 'Expected right-side NMG attribution');
assert.notEqual(nmgLeft?.year, nmgRight?.year, 'Expected NMG attribution year to vary by version side (left vs right)');
assert.equal(nmgLeft?.year, '2016', 'Expected v1.3 NMG year to be 2016 for rental-price keys');
assert.equal(nmgRight?.year, '2024', 'Expected v4.0 NMG year to be 2024 for rental-price keys');

const fixture = createResultsFixtureRepo();
try {
  const resultsRuns = getResultsRuns(fixture.root);
  assert.equal(resultsRuns.length, 8, 'Expected only synthetic fixture runs to be discovered');
  for (let index = 1; index < resultsRuns.length; index += 1) {
    const prev = Date.parse(resultsRuns[index - 1]?.modifiedAt ?? '');
    const current = Date.parse(resultsRuns[index]?.modifiedAt ?? '');
    assert.ok(prev >= current, 'Expected runs to be sorted by modifiedAt descending');
  }
  const defaultLocalRunId = resolveLocalResultsReadRunId(fixture.root, 'default');
  assert.equal(
    defaultLocalRunId,
    resultsRuns[0]?.runId,
    'Expected local default manual reads to resolve to the first listed results run'
  );
  assert.equal(
    getResultsRunDetail(fixture.root, defaultLocalRunId).runId,
    resultsRuns[0]?.runId,
    'Expected local default manual detail reads to reach a real results run'
  );
  const localDefaultCompare = getResultsCompare(
    fixture.root,
    [defaultLocalRunId],
    ['core_mortgageApprovals'],
    'tail120',
    0
  );
  assert.equal(
    localDefaultCompare.indicators[0]?.seriesByRun[0]?.points.length,
    120,
    'Expected local default manual compare reads to expose overlay points'
  );
  assert.equal(
    resolveLocalResultsReadRunId(fixture.root, fixture.runIds.complete),
    fixture.runIds.complete,
    'Expected local read run-id resolution to preserve explicit real run ids'
  );
  const commaNameCompare = getResultsCompare(
    fixture.root,
    [fixture.runIds.commaName],
    ['core_mortgageApprovals'],
    'tail120',
    0
  );
  assert.equal(
    commaNameCompare.runIds[0],
    fixture.runIds.commaName,
    'Expected local compare payloads to preserve run ids containing commas'
  );
  assert.equal(
    commaNameCompare.indicators[0]?.seriesByRun[0]?.points.length,
    120,
    'Expected local compare to expose overlay points for run ids containing commas'
  );

  const fullRun = resultsRuns.find((run) => run.runId === fixture.runIds.complete);
  assert.ok(fullRun, 'Expected complete fixture run in discovery results');
  assert.equal(fullRun?.status, 'complete', 'Expected complete fixture run to be classified as complete');

  const emptyRun = resultsRuns.find((run) => run.runId === fixture.runIds.emptyOutput);
  assert.ok(emptyRun, 'Expected empty-output fixture run in discovery results');
  assert.equal(emptyRun?.status, 'partial', 'Expected empty-output fixture run to be classified as partial');

  const sparseRun = resultsRuns.find((run) => run.runId === fixture.runIds.sparseCore);
  assert.ok(sparseRun, 'Expected sparse-core fixture run in discovery results');
  assert.equal(sparseRun?.status, 'partial', 'Expected sparse-core fixture run to be classified as partial');

  const runDetail = getResultsRunDetail(fixture.root, fixture.runIds.complete);
  assert.equal(runDetail.kpiSummary.length, 27, 'Expected KPI summary metrics for all 27 indicators');
  assert.equal(runDetail.indicators.length, 27, 'Expected 27 total indicator definitions (15 core + 12 output)');
  assert.ok(runDetail.configAvailable, 'Expected complete fixture run to report config.properties availability');
  const firstKpi = runDetail.kpiSummary[0];
  assert.ok(firstKpi, 'Expected KPI summary entry');
  assert.equal(Object.prototype.hasOwnProperty.call(firstKpi, 'mean'), true, 'Expected KPI payload to include mean');
  assert.equal(Object.prototype.hasOwnProperty.call(firstKpi, 'cv'), true, 'Expected KPI payload to include cv');
  assert.equal(
    Object.prototype.hasOwnProperty.call(firstKpi, 'annualisedTrend'),
    true,
    'Expected KPI payload to include annualisedTrend'
  );
  assert.equal(Object.prototype.hasOwnProperty.call(firstKpi, 'range'), true, 'Expected KPI payload to include range');
  assert.equal(
    Object.prototype.hasOwnProperty.call(firstKpi, 'latest'),
    false,
    'Expected legacy latest KPI field to be removed'
  );
  assert.ok(
    runDetail.indicators.some((indicator) => indicator.id === 'output_interestRate' && indicator.available),
    'Expected output interest rate indicator to be available on complete fixture run'
  );
  assert.ok(
    runDetail.kpiSummary.some((kpi) => kpi.indicatorId === 'output_interestRate'),
    'Expected KPI summary to include output indicators such as output interest rate'
  );
  const numericBtlKpi = runDetail.kpiSummary.find((kpi) => kpi.indicatorId === 'core_btlLTV');
  assert.equal(
    typeof numericBtlKpi?.mean,
    'number',
    'Expected all-numeric BTL LTV core indicator to produce a finite mean KPI'
  );

  const scenarioDetail = getResultsRunDetail(fixture.root, fixture.runIds.noConfig);
  assert.equal(
    scenarioDetail.configAvailable,
    false,
    'Expected no-config fixture run to report configAvailable=false'
  );

  const manifestFull = getResultsRunFiles(fixture.root, fixture.runIds.complete);
  assert.ok(
    manifestFull.some(
      (file) => file.fileName === 'Output-run1.csv' && file.coverageStatus === 'supported'
    ),
    'Expected Output-run1.csv to be marked supported in manifest'
  );
  const numericBtlManifest = manifestFull.find((file) => file.fileName === 'coreIndicator-btlLTV.csv');
  assert.equal(
    numericBtlManifest?.coverageStatus,
    'supported',
    'Expected all-numeric BTL LTV core indicator to remain supported'
  );
  assert.equal(
    numericBtlManifest?.note,
    undefined,
    'Expected all-numeric BTL LTV core indicator to have no missing-value note'
  );
  assert.ok(
    manifestFull.some(
      (file) =>
        file.fileName === 'RentalTransactions-run1.csv' &&
        file.coverageStatus === 'unsupported' &&
        file.note?.includes('Manifest only (not charted)')
    ),
    'Expected heavy transaction files to be manifest-only (not charted)'
  );
  for (const fileName of ['TotalDebt-run2.csv', 'HousingStatus-run2.csv', 'NonHousingConsumption-run2.csv']) {
    const manifestEntry = manifestFull.find((file) => file.fileName === fileName);
    assert.equal(manifestEntry?.fileType, 'micro_snapshot', `Expected ${fileName} to be recognized as a micro snapshot`);
    assert.equal(
      manifestEntry?.coverageStatus,
      'unsupported',
      `Expected ${fileName} micro snapshot to remain manifest-only`
    );
  }

  const manifestEmpty = getResultsRunFiles(fixture.root, fixture.runIds.emptyOutput);
  assert.ok(
    manifestEmpty.some((file) => file.fileName === 'Output-run1.csv' && file.coverageStatus === 'empty'),
    'Expected empty Output-run1.csv to be marked empty in manifest'
  );

  const missingMicroManifest = getResultsRunFiles(fixture.root, fixture.runIds.noConfig);
  assert.ok(
    !missingMicroManifest.some((file) => file.fileName === 'BankBalance-run1.csv'),
    'Expected manifest to tolerate runs missing optional micro snapshot files'
  );

  const mixedNanRun = resultsRuns.find((run) => run.runId === fixture.runIds.mixedNanCore);
  assert.ok(mixedNanRun, 'Expected mixed-NaN fixture run in discovery results');
  assert.equal(mixedNanRun?.status, 'complete', 'Expected mixed-NaN core run to remain complete');
  const mixedNanDetail = getResultsRunDetail(fixture.root, fixture.runIds.mixedNanCore);
  const mixedNanIndicator = mixedNanDetail.indicators.find((indicator) => indicator.id === 'core_btlLTV');
  assert.equal(
    mixedNanIndicator?.coverageStatus,
    'supported',
    'Expected mixed-NaN BTL LTV indicator to parse as supported'
  );
  assert.ok(
    mixedNanIndicator?.note?.includes('6 missing core indicator values'),
    'Expected mixed-NaN BTL LTV indicator to report missing-value count'
  );
  const mixedNanManifest = getResultsRunFiles(fixture.root, fixture.runIds.mixedNanCore).find(
    (file) => file.fileName === 'coreIndicator-btlLTV.csv'
  );
  assert.equal(
    mixedNanManifest?.coverageStatus,
    'supported',
    'Expected mixed-NaN BTL LTV manifest entry to remain supported'
  );
  assert.ok(
    mixedNanManifest?.note?.includes('6 missing core indicator values'),
    'Expected mixed-NaN BTL LTV manifest entry to report missing-value count'
  );
  const mixedNanSeries = getResultsSeries(fixture.root, fixture.runIds.mixedNanCore, 'core_btlLTV', 0);
  assert.equal(mixedNanSeries.points[5]?.value, null, 'Expected NaN core token to become a null point');
  assert.equal(mixedNanSeries.points[6]?.value, null, 'Expected +NaN core token to become a null point');
  assert.equal(mixedNanSeries.points[7]?.value, null, 'Expected -NaN core token to become a null point');
  assert.equal(mixedNanSeries.points[1985]?.value, null, 'Expected Infinity core token to become a null point');
  assert.equal(mixedNanSeries.points[1990]?.value, null, 'Expected +Infinity core token to become a null point');
  assert.equal(mixedNanSeries.points[1995]?.value, null, 'Expected -Infinity core token to become a null point');
  assert.equal(
    mixedNanSeries.points[1986]?.value,
    2036,
    'Expected finite BTL LTV values around NaN tokens to parse normally'
  );
  const mixedNanKpi = mixedNanDetail.kpiSummary.find((kpi) => kpi.indicatorId === 'core_btlLTV');
  const mixedNanTailFiniteValues = Array.from({ length: 120 }, (_value, offset) => RESULTS_ROW_COUNT - 120 + offset)
    .filter((modelTime) => modelTime !== 1985 && modelTime !== 1990 && modelTime !== 1995)
    .map((modelTime) => 50 + modelTime);
  const expectedMixedNanKpi = computeKpiFromValues(mixedNanTailFiniteValues);
  assertClose(
    mixedNanKpi?.mean ?? NaN,
    expectedMixedNanKpi.mean ?? NaN,
    1e-9,
    'Expected mixed-NaN BTL LTV mean KPI to ignore null points'
  );
  assertClose(
    mixedNanKpi?.annualisedTrend ?? NaN,
    expectedMixedNanKpi.annualisedTrend ?? NaN,
    1e-9,
    'Expected mixed-NaN BTL LTV trend KPI to ignore null points'
  );

  const allNanRun = resultsRuns.find((run) => run.runId === fixture.runIds.allNanCore);
  assert.ok(allNanRun, 'Expected all-NaN fixture run in discovery results');
  assert.equal(allNanRun?.status, 'complete', 'Expected all-NaN core run to remain complete');
  const allNanDetail = getResultsRunDetail(fixture.root, fixture.runIds.allNanCore);
  const allNanIndicator = allNanDetail.indicators.find((indicator) => indicator.id === 'core_btlLTV');
  assert.equal(
    allNanIndicator?.coverageStatus,
    'supported',
    'Expected all-NaN BTL LTV indicator to parse as supported'
  );
  assert.equal(allNanIndicator?.available, false, 'Expected all-NaN BTL LTV indicator to be unavailable for charting');
  assert.ok(
    allNanIndicator?.note?.includes(`${RESULTS_ROW_COUNT} missing core indicator values`),
    'Expected all-NaN BTL LTV indicator to report all missing values'
  );
  const allNanKpi = allNanDetail.kpiSummary.find((kpi) => kpi.indicatorId === 'core_btlLTV');
  assert.deepEqual(
    {
      mean: allNanKpi?.mean,
      cv: allNanKpi?.cv,
      annualisedTrend: allNanKpi?.annualisedTrend,
      range: allNanKpi?.range
    },
    { mean: null, cv: null, annualisedTrend: null, range: null },
    'Expected all-NaN BTL LTV KPI fields to be null'
  );
  const allNanSeries = getResultsSeries(fixture.root, fixture.runIds.allNanCore, 'core_btlLTV', 0);
  assert.ok(
    allNanSeries.points.every((point) => point.value === null),
    'Expected all-NaN BTL LTV series points to be null'
  );

  const malformedRun = resultsRuns.find((run) => run.runId === fixture.runIds.malformedCore);
  assert.ok(malformedRun, 'Expected malformed-token fixture run in discovery results');
  assert.equal(malformedRun?.status, 'partial', 'Expected malformed-token core run to be classified as partial');
  assert.equal(malformedRun?.parseCoverage.errorCount, 1, 'Expected malformed-token run to count one parse error');
  const malformedManifest = getResultsRunFiles(fixture.root, fixture.runIds.malformedCore).find(
    (file) => file.fileName === 'coreIndicator-btlLTV.csv'
  );
  assert.equal(
    malformedManifest?.coverageStatus,
    'error',
    'Expected malformed BTL LTV manifest entry to remain a parse error'
  );
  assert.ok(
    malformedManifest?.note?.includes('abc'),
    'Expected malformed BTL LTV manifest entry to report the malformed token'
  );
  const malformedDetail = getResultsRunDetail(fixture.root, fixture.runIds.malformedCore);
  const malformedIndicator = malformedDetail.indicators.find((indicator) => indicator.id === 'core_btlLTV');
  assert.equal(
    malformedIndicator?.coverageStatus,
    'error',
    'Expected malformed BTL LTV indicator coverage to be error'
  );
  const malformedKpi = malformedDetail.kpiSummary.find((kpi) => kpi.indicatorId === 'core_btlLTV');
  assert.deepEqual(
    {
      mean: malformedKpi?.mean,
      cv: malformedKpi?.cv,
      annualisedTrend: malformedKpi?.annualisedTrend,
      range: malformedKpi?.range
    },
    { mean: null, cv: null, annualisedTrend: null, range: null },
    'Expected malformed BTL LTV KPI fields to stay null'
  );

  const rawSeries = getResultsSeries(fixture.root, fixture.runIds.complete, 'core_mortgageApprovals', 0);
  const smoothedSeries = getResultsSeries(fixture.root, fixture.runIds.complete, 'core_mortgageApprovals', 12);
  assert.equal(rawSeries.points.length, 2001, 'Expected full run to expose 2001 model-time points');
  assert.equal(smoothedSeries.points.length, rawSeries.points.length, 'Smoothing should preserve point count');
  assert.ok(
    smoothedSeries.points.some((point, index) => point.value !== rawSeries.points[index]?.value),
    'Expected smoothing to modify at least one time point'
  );

  const singleRunCompare = getResultsCompare(
    fixture.root,
    [fixture.runIds.complete],
    ['core_mortgageApprovals'],
    'tail120',
    0
  );
  assert.equal(singleRunCompare.runIds.length, 1, 'Expected compare payload to support single-run manual mode');
  assert.equal(
    singleRunCompare.indicators[0]?.seriesByRun.length,
    1,
    'Expected single-run compare payload to include exactly one aligned series'
  );

  const overlayCompare = getResultsCompare(
    fixture.root,
    [fixture.runIds.complete, fixture.runIds.sparseCore],
    ['core_mortgageApprovals'],
    'tail120',
    0
  );
  assert.equal(overlayCompare.indicators.length, 1, 'Expected single-indicator compare payload');
  const leftSeries = overlayCompare.indicators[0]?.seriesByRun.find((series) => series.runId === fixture.runIds.complete);
  const rightSeries = overlayCompare.indicators[0]?.seriesByRun.find((series) => series.runId === fixture.runIds.sparseCore);
  assert.ok(leftSeries && rightSeries, 'Expected aligned compare series for both selected runs');
  assert.equal(
    leftSeries?.points.length,
    rightSeries?.points.length,
    'Expected compare payload to align series on shared modelTime axis'
  );
  assert.ok(
    rightSeries?.points.every((point) => point.value === null),
    'Expected sparse core run to render as gap-only aligned series'
  );

  const postSpinUpCompare = getResultsCompare(
    fixture.root,
    [fixture.runIds.complete, fixture.runIds.sparseCore],
    ['core_mortgageApprovals'],
    'post200',
    0
  );
  const postSpinUpSeries = postSpinUpCompare.indicators[0]?.seriesByRun.find(
    (series) => series.runId === fixture.runIds.complete
  );
  assert.ok(postSpinUpSeries, 'Expected post200 compare series for complete run');
  assert.ok(
    postSpinUpSeries?.points.every((point) => point.modelTime >= 200),
    'Expected post200 compare window to exclude pre-spin-up ticks'
  );

  const post500Compare = getResultsCompare(
    fixture.root,
    [fixture.runIds.complete, fixture.runIds.commaName],
    ['core_mortgageApprovals'],
    'post500',
    0
  );
  const post500Series = post500Compare.indicators[0]?.seriesByRun.find(
    (series) => series.runId === fixture.runIds.complete
  );
  assert.ok(post500Series, 'Expected post500 compare series for complete run');
  assert.ok(
    post500Series?.points.every((point) => point.modelTime >= 500),
    'Expected post500 compare window to exclude the first 500 model ticks'
  );
  assert.equal(
    post500Compare.kpiSummaryByRun.length,
    2,
    'Expected compare payload to include KPI summaries for each selected run'
  );
  const post500Kpi = post500Compare.kpiSummaryByRun
    .find((entry) => entry.runId === fixture.runIds.complete)
    ?.kpiSummary.find((kpi) => kpi.indicatorId === 'core_mortgageApprovals');
  assert.equal(post500Kpi?.windowType, 'post_500', 'Expected post500 compare KPIs to identify their window');
  assert.ok(post500Kpi?.mean !== null, 'Expected post500 compare KPI mean to be populated');

  const fullCompare = getResultsCompare(
    fixture.root,
    [fixture.runIds.complete],
    ['core_mortgageApprovals'],
    'full',
    0
  );
  const post200Kpi = postSpinUpCompare.kpiSummaryByRun
    .find((entry) => entry.runId === fixture.runIds.complete)
    ?.kpiSummary.find((kpi) => kpi.indicatorId === 'core_mortgageApprovals');
  const tail120Kpi = overlayCompare.kpiSummaryByRun
    .find((entry) => entry.runId === fixture.runIds.complete)
    ?.kpiSummary.find((kpi) => kpi.indicatorId === 'core_mortgageApprovals');
  const fullKpi = fullCompare.kpiSummaryByRun
    .find((entry) => entry.runId === fixture.runIds.complete)
    ?.kpiSummary.find((kpi) => kpi.indicatorId === 'core_mortgageApprovals');
  assert.notEqual(post500Kpi?.mean, post200Kpi?.mean, 'Expected post500 and post200 KPI means to differ');
  assert.notEqual(post500Kpi?.mean, tail120Kpi?.mean, 'Expected post500 and tail120 KPI means to differ');
  assert.notEqual(post500Kpi?.mean, fullKpi?.mean, 'Expected post500 and full KPI means to differ');

  const smoothedPost500Compare = getResultsCompare(
    fixture.root,
    [fixture.runIds.complete],
    ['core_mortgageApprovals'],
    'post500',
    12
  );
  const smoothedPost500Kpi = smoothedPost500Compare.kpiSummaryByRun
    .find((entry) => entry.runId === fixture.runIds.complete)
    ?.kpiSummary.find((kpi) => kpi.indicatorId === 'core_mortgageApprovals');
  assert.deepEqual(
    {
      mean: smoothedPost500Kpi?.mean,
      cv: smoothedPost500Kpi?.cv,
      annualisedTrend: smoothedPost500Kpi?.annualisedTrend,
      range: smoothedPost500Kpi?.range
    },
    {
      mean: post500Kpi?.mean,
      cv: post500Kpi?.cv,
      annualisedTrend: post500Kpi?.annualisedTrend,
      range: post500Kpi?.range
    },
    'Expected smoothing to leave aggregate KPI values unchanged'
  );

  assert.throws(
    () =>
      getResultsCompare(
        fixture.root,
        ['r1', 'r2', 'r3'],
        ['core_mortgageApprovals'],
        'tail120',
        0
      ),
    /maximum of 2 runIds/,
    'Expected compare endpoint guardrail for more than two selected runs'
  );

  assert.throws(
    () => getResultsRunDetail(fixture.root, '..'),
    /Unknown run: \.\./,
    'Expected traversal-style run ids to be rejected'
  );

  assert.throws(
    () => deleteResultsRun(fixture.root, fixture.runIds.noConfig),
    /not marked as a dashboard-managed run/,
    'Expected unmarked result folders to be non-deletable from the dashboard'
  );

  writeDashboardManagedRunMarker(path.join(fixture.root, 'Results', fixture.runIds.noConfig), {
    jobId: 'job-results-delete-fixture',
    runId: fixture.runIds.noConfig,
    baseline: 'v1.0',
    title: null,
    createdAt: new Date().toISOString()
  });

  const deleted = deleteResultsRun(fixture.root, fixture.runIds.noConfig);
  assert.equal(deleted.deleted, true, 'Expected delete results API to report success');
  assert.equal(deleted.runId, fixture.runIds.noConfig, 'Expected delete payload to return the deleted runId');
  assert.ok(
    !getResultsRuns(fixture.root).some((run) => run.runId === fixture.runIds.noConfig),
    'Expected deleted run to be removed from run inventory'
  );
  assert.throws(
    () => deleteResultsRun(fixture.root, '..'),
    /Unknown run: \.\./,
    'Expected traversal-style run ids to be rejected for run deletion'
  );
  for (const protectedRunId of ['v0-output', 'v4.0-output']) {
    assert.throws(
      () => deleteResultsRun(fixture.root, protectedRunId),
      /protected/,
      `Expected baseline run ${protectedRunId} to be protected from deletion`
    );
  }

  const sensitivityDownloadExperimentId = 'sensitivity-download-fixture';
  writeSensitivityDownloadFixture(fixture.root, sensitivityDownloadExperimentId);
  __resetSensitivityRunsForTests();
  let downloadServer: Awaited<ReturnType<typeof startDashboardServer>> | null = null;
  try {
    downloadServer = await startDashboardServer({
      dashboardRoot: path.join(repoRoot, 'dashboard'),
      repoRoot: fixture.root,
      runtimePaths: createDevelopmentRuntimePaths(fixture.root),
      host: '127.0.0.1',
      port: 0,
      modelRunsConfigured: false,
      isDevRuntime: true,
      staticServing: { enabled: false },
      logStartup: false
    });

    const manualArchive = await fetchBuffer(
      `${downloadServer.url}/api/results/runs/${encodeURIComponent(fixture.runIds.complete)}/download`,
      {
        headers: {
          'X-Dashboard-View-Mode': 'dev'
        }
      }
    );
    assert.equal(manualArchive.status, 200, 'Expected manual result download endpoint to return an archive');
    assert.ok(manualArchive.contentType.includes('application/gzip'), 'Expected manual download to be gzip content');
    assert.ok(
      manualArchive.contentDisposition.includes(`${fixture.runIds.complete}.tar.gz`),
      'Expected manual download to include an attachment filename'
    );
    const manualArchiveText = zlib.gunzipSync(manualArchive.buffer).toString('latin1');
    assert.ok(
      manualArchiveText.includes('Output-run1.csv') && manualArchiveText.includes('config.properties'),
      'Expected manual result archive to include result files'
    );

    const sensitivityArchive = await fetchBuffer(
      `${downloadServer.url}/api/experiments/sensitivity/${encodeURIComponent(sensitivityDownloadExperimentId)}/download`,
      {
        headers: {
          'X-Dashboard-View-Mode': 'dev'
        }
      }
    );
    assert.equal(sensitivityArchive.status, 200, 'Expected sensitivity result download endpoint to return an archive');
    const sensitivityArchiveText = zlib.gunzipSync(sensitivityArchive.buffer).toString('latin1');
    assert.ok(
      sensitivityArchiveText.includes('download-fixture.csv') && sensitivityArchiveText.includes('metadata.json'),
      'Expected sensitivity result archive to include experiment files'
    );

    const desktopPreviewManualArchive = await fetchBuffer(
      `${downloadServer.url}/api/results/runs/${encodeURIComponent(fixture.runIds.complete)}/download`,
      {
        headers: {
          'X-Dashboard-View-Mode': 'preview_desktop'
        }
      }
    );
    assert.equal(
      desktopPreviewManualArchive.status,
      200,
      'Expected local desktop preview to allow manual result downloads without credentials'
    );

    const desktopPreviewSensitivityArchive = await fetchBuffer(
      `${downloadServer.url}/api/experiments/sensitivity/${encodeURIComponent(sensitivityDownloadExperimentId)}/download`,
      {
        headers: {
          'X-Dashboard-View-Mode': 'preview_desktop'
        }
      }
    );
    assert.equal(
      desktopPreviewSensitivityArchive.status,
      200,
      'Expected local desktop preview to allow sensitivity result downloads without credentials'
    );

    const cloudPreviewDownload = await fetchText(
      `${downloadServer.url}/api/results/runs/${encodeURIComponent(fixture.runIds.complete)}/download`,
      {
        headers: {
          'X-Dashboard-View-Mode': 'preview_cloud'
        }
      }
    );
    assert.equal(
      cloudPreviewDownload.status,
      503,
      'Expected cloud preview result downloads to require configured credentials'
    );

    const missingDownload = await fetchText(`${downloadServer.url}/api/results/runs/not-found/download`);
    assert.equal(missingDownload.status, 400, 'Expected unknown run download to be rejected');
    const traversalDownload = await fetchText(`${downloadServer.url}/api/results/runs/%2E%2E/download`);
    assert.ok(
      traversalDownload.status === 400 || traversalDownload.status === 404,
      'Expected traversal-style run download to be rejected'
    );
  } finally {
    if (downloadServer) {
      await downloadServer.shutdown();
    }
  }

  let missingCredentialDownloadServer: Awaited<ReturnType<typeof startDashboardServer>> | null = null;
  try {
    missingCredentialDownloadServer = await startDashboardServer({
      dashboardRoot: path.join(repoRoot, 'dashboard'),
      repoRoot: fixture.root,
      runtimePaths: createDevelopmentRuntimePaths(fixture.root),
      host: '127.0.0.1',
      port: 0,
      modelRunsConfigured: false,
      isDevRuntime: false,
      staticServing: { enabled: false },
      logStartup: false
    });
    const missingCredentialDownload = await fetchText(
      `${missingCredentialDownloadServer.url}/api/results/runs/${encodeURIComponent(fixture.runIds.complete)}/download`
    );
    assert.equal(
      missingCredentialDownload.status,
      503,
      'Expected cloud-style result download to fail closed when credentials are not configured'
    );
    const spoofedDesktopPreviewDownload = await fetchText(
      `${missingCredentialDownloadServer.url}/api/results/runs/${encodeURIComponent(fixture.runIds.complete)}/download`,
      {
        headers: {
          'X-Dashboard-View-Mode': 'preview_desktop'
        }
      }
    );
    assert.equal(
      spoofedDesktopPreviewDownload.status,
      503,
      'Expected production cloud result downloads to ignore spoofed desktop preview headers'
    );
  } finally {
    if (missingCredentialDownloadServer) {
      await missingCredentialDownloadServer.shutdown();
    }
  }

  let authenticatedDownloadServer: Awaited<ReturnType<typeof startDashboardServer>> | null = null;
  try {
    authenticatedDownloadServer = await startDashboardServer({
      dashboardRoot: path.join(repoRoot, 'dashboard'),
      repoRoot: fixture.root,
      runtimePaths: createDevelopmentRuntimePaths(fixture.root),
      host: '127.0.0.1',
      port: 0,
      writeAuth: createWriteAuthController('writer', 'secret'),
      modelRunsConfigured: false,
      isDevRuntime: false,
      staticServing: { enabled: false },
      logStartup: false
    });
    const unauthenticatedDownload = await fetchText(
      `${authenticatedDownloadServer.url}/api/results/runs/${encodeURIComponent(fixture.runIds.complete)}/download`
    );
    assert.equal(
      unauthenticatedDownload.status,
      403,
      'Expected cloud-style result download to require login when credentials are configured'
    );
    const loginResponse = await fetchText(`${authenticatedDownloadServer.url}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username: 'writer', password: 'secret' })
    });
    const loginPayload = JSON.parse(loginResponse.text) as { token?: string };
    assert.ok(loginPayload.token, 'Expected cloud-style login to issue a download-capable token');
    const authenticatedDownload = await fetchBuffer(
      `${authenticatedDownloadServer.url}/api/results/runs/${encodeURIComponent(fixture.runIds.complete)}/download`,
      {
        headers: {
          Authorization: `Bearer ${loginPayload.token}`
        }
      }
    );
    assert.equal(authenticatedDownload.status, 200, 'Expected logged-in cloud-style result download to succeed');
  } finally {
    if (authenticatedDownloadServer) {
      await authenticatedDownloadServer.shutdown();
    }
  }
} finally {
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

const modelRunFixtureRoot = createModelRunFixtureRepo();
const spawnedProcesses: FakeModelProcess[] = [];
const originalDashboardAppVersion = process.env.DASHBOARD_APP_VERSION;
const originalDashboardReleaseChannel = process.env.DASHBOARD_RELEASE_CHANNEL;
const originalDashboardBuildCommitSha = process.env.DASHBOARD_BUILD_COMMIT_SHA;

try {
  process.env.DASHBOARD_APP_VERSION = '0.1.0-test';
  process.env.DASHBOARD_RELEASE_CHANNEL = 'smoke-test';
  process.env.DASHBOARD_BUILD_COMMIT_SHA = '0123456789abcdef0123456789abcdef01234567';
  __resetModelRunManagerForTests();
  __setModelRunSpawnForTests(() => {
    const fakeProcess = new FakeModelProcess();
    spawnedProcesses.push(fakeProcess);
    return fakeProcess as never;
  });

  const runOptions = getModelRunOptions(modelRunFixtureRoot, undefined, true);
  assert.equal(runOptions.executionEnabled, true, 'Expected execution flag to be forwarded by options payload');
  const disabledRunOptions = getModelRunOptions(modelRunFixtureRoot, undefined, false);
  assert.equal(disabledRunOptions.executionEnabled, false, 'Expected options payload to preserve disabled execution mode');
  assert.equal(runOptions.parameters.length, 33, 'Expected all 33 USER SET parameters in options payload');
  for (const key of ['recordTotalDebt', 'recordHousingStatus', 'recordConsumption']) {
    const parameter = runOptions.parameters.find((item) => item.key === key);
    assert.equal(parameter?.type, 'boolean', `Expected ${key} to be exposed as a boolean run option`);
    assert.equal(parameter?.defaultValue, false, `Expected ${key} to default to false`);
  }
  assert.equal(runOptions.defaultBaseline, 'v0o7', 'Expected optimised 2011 baseline to be the experiment default');
  assert.equal(runOptions.requestedBaseline, 'v0o7', 'Expected requested baseline default to optimised 2011 snapshot');
  assert.ok(
    runOptions.snapshots.some((snapshot) => snapshot.version === 'v1.1' && snapshot.status === 'in_progress'),
    'Expected in-progress snapshot status in options payload'
  );
  const orderedExperimentSnapshots = orderExperimentModelOptions(runOptions.snapshots);
 const promotedExperimentSnapshots = orderExperimentModelOptions([
    { version: 'v1.0', status: 'stable' },
    { version: 'v5o3', status: 'stable' },
    { version: 'v0o7', status: 'stable' },
    { version: 'v0o2', status: 'stable' },
    { version: 'v0oo', status: 'stable' },
    { version: 'v0', status: 'stable' }
  ]);
  assert.deepEqual(
    promotedExperimentSnapshots.slice(0, 3).map((snapshot) => snapshot.version),
    ['v0o7', 'v0', 'v5o3'],
    'Expected experiment model options to prefer v0o7 and v5o3 as the optimised era snapshots'
  );
  assert.deepEqual(
    orderedExperimentSnapshots.slice(0, 3).map((snapshot) => snapshot.version),
    ['v0o7', 'v0', 'v5o3'],
    'Expected experiment model options to prioritise optimised 2011, 2011, then optimised 2024 model'
  );
  assert.deepEqual(
    orderedExperimentSnapshots.slice(0, 4).map((snapshot) => formatExperimentModelOption(snapshot, orderedExperimentSnapshots)),
    [
      'Optimised 2011 model (Stable, v0o7)',
      'Original 2011 model (Stable, v0)',
      'Optimised 2024 model (Beta, v5o3)',
      '2024 model v1.1 (Beta, In progress)'
    ],
    'Expected canonical experiment model option labels to include version ids inside lifecycle badges'
  );
  assert.equal(
    formatExperimentModelOption({ version: 'v4.4', status: 'stable' }, [{ version: 'v4.4', status: 'stable' }]),
    'Latest 2024 model (Beta, v4.4)',
    'Expected non-optimised 2024 experiment labels to keep latest lifecycle wording when applicable'
  );

  assertSettingHelpCopy();
  const policyParameters = runOptions.parameters.filter((parameter) => parameter.group === 'Central Bank policy');
  markSmokeStep('checking experiment setup option metadata');
  const centralBankPolicyKeys = policyParameters.map((parameter) => parameter.key);
  assert.deepEqual(
    runOptions.basePolicies.map((policy) => policy.id),
    ['2011', '2024'],
    'Expected run options to expose the supported base policies'
  );
  const defaultExperimentPolicy = runOptions.basePolicies.find((policy) => policy.id === DEFAULT_EXPERIMENT_BASE_POLICY_ID) ?? null;
  assert.ok(defaultExperimentPolicy, 'Expected dashboard experiment setup to have a 2024 default policy option');
  assert.equal(runOptions.defaultBasePolicy, '2011', 'Expected legacy calibration snapshots to default to 2011 policy');
  assert.equal(
    getModelRunOptions(modelRunFixtureRoot, 'v1.0', true).defaultBasePolicy,
    '2024',
    'Expected non-legacy calibration snapshots to default to 2024 policy'
  );
  assert.deepEqual(
    runOptions.sensitivityPolicyPackages
      .filter((policyPackage) => policyPackage.parameterKeys.length === 1)
      .map((policyPackage) => policyPackage.parameterKeys[0])
      .sort(),
    [...centralBankPolicyKeys].sort(),
    'Expected every old central-bank policy parameter to exist as a singleton sensitivity package'
  );
  assert.ok(
    runOptions.sensitivityPolicyPackages.some(
      (policyPackage) =>
        policyPackage.id === 'owner_occupier_lti_soft_max' &&
        policyPackage.parameterKeys.includes('CENTRAL_BANK_LTI_SOFT_MAX_FTB') &&
        policyPackage.parameterKeys.includes('CENTRAL_BANK_LTI_SOFT_MAX_HM')
    ),
    'Expected paired FTB + HM soft LTI package to be available'
  );
  assert.ok(
    runOptions.sensitivityPolicyPackages.some(
      (policyPackage) =>
        policyPackage.id === 'owner_occupier_lti_quota' &&
        policyPackage.parameterKeys.includes('CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_FTB') &&
        policyPackage.parameterKeys.includes('CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_HM')
    ),
    'Expected paired FTB + HM LTI quota package to be available'
  );
  assert.ok(
    runOptions.sensitivityPolicyPackages.some(
      (policyPackage) =>
        policyPackage.id === 'owner_occupier_ltv_hard_max' &&
        policyPackage.parameterKeys.includes('CENTRAL_BANK_LTV_HARD_MAX_FTB') &&
        policyPackage.parameterKeys.includes('CENTRAL_BANK_LTV_HARD_MAX_HM')
    ),
    'Expected paired FTB + HM hard LTV package to be available'
  );
  const selectedSensitivityPackage =
    runOptions.sensitivityPolicyPackages.find((policyPackage) => policyPackage.id === DEFAULT_SENSITIVITY_POLICY_PACKAGE_ID) ?? null;
  assert.deepEqual(
    selectedSensitivityPackage?.parameterKeys,
    ['CENTRAL_BANK_LTI_SOFT_MAX_FTB', 'CENTRAL_BANK_LTI_SOFT_MAX_HM'],
    'Expected sensitivity setup to default to the paired FTB + HM soft LTI package'
  );
  assert.ok(selectedSensitivityPackage, 'Expected default sensitivity package to be available for range checks');
  const defaultExperimentFormValues = toInitialFormValues(runOptions.parameters, defaultExperimentPolicy);
  const recordBooleanKeys = runOptions.parameters
    .filter((parameter) => parameter.type === 'boolean' && parameter.key.startsWith('record'))
    .map((parameter) => parameter.key);
  assert.equal(defaultExperimentFormValues.recordCoreIndicators, true, 'Expected core indicators to stay enabled by default');
  for (const key of recordBooleanKeys.filter((recordKey) => recordKey !== 'recordCoreIndicators')) {
    assert.equal(defaultExperimentFormValues[key], false, `Expected ${key} to be disabled by default`);
  }
  assert.deepEqual(
    buildDefaultSensitivityRange(selectedSensitivityPackage, defaultExperimentPolicy),
    { min: '4', max: '5' },
    'Expected default paired soft-LTI sensitivity range to use 4..5 under 2024 policy'
  );
  const sensitivitySeedOneOverrides = buildGeneralModelControlOverridesFromForm(runOptions.parameters, {
    ...defaultExperimentFormValues,
    N_SIMS: '1'
  });
  assert.equal(sensitivitySeedOneOverrides.N_SIMS, 1, 'Expected sensitivity submit overrides to include N_SIMS=1');
  const noop = () => {};
  markSmokeStep('rendering experiment setup controls');
  const manualSetupMarkup = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ManualRunSetupCard, {
        executionDisabled: false,
        isLoadingOptions: false,
        selectedBaseline: runOptions.requestedBaseline,
        onBaselineChange: noop,
        basePolicies: runOptions.basePolicies,
        basePolicy: DEFAULT_EXPERIMENT_BASE_POLICY_ID,
        onBasePolicyChange: noop,
        snapshots: runOptions.snapshots,
        title: '',
        onTitleChange: noop,
        parameters: runOptions.parameters,
        policyParameters,
        formValues: defaultExperimentFormValues,
        onFormValueChange: noop,
        maxWorkers: '1',
        onMaxWorkersChange: noop,
        warnings: [],
        isSubmitting: false,
        manualSubmissionLockedBySensitivity: false,
        lockMessage: null,
        onSubmit: noop
      })
    )
  );
  const sensitivitySetupMarkup = renderToStaticMarkup(
    createElement(SensitivitySetupCard, {
      executionDisabled: false,
      isLoadingOptions: false,
      selectedBaseline: runOptions.requestedBaseline,
      onBaselineChange: noop,
      snapshots: runOptions.snapshots,
      basePolicies: runOptions.basePolicies,
      basePolicy: DEFAULT_EXPERIMENT_BASE_POLICY_ID,
      onBasePolicyChange: noop,
      policyPackages: runOptions.sensitivityPolicyPackages,
      policyPackageId: selectedSensitivityPackage?.id ?? '',
      onPolicyPackageChange: noop,
      minValue: '4',
      maxValue: '5',
      onMinValueChange: noop,
      onMaxValueChange: noop,
      sampleCount: '5',
      onSampleCountChange: noop,
      parameters: runOptions.parameters,
      formValues: defaultExperimentFormValues,
      onFormValueChange: noop,
      maxWorkers: '2',
      onMaxWorkersChange: noop,
      title: '',
      onTitleChange: noop,
      selectedPackage: selectedSensitivityPackage,
      warnings: [],
      isSubmitting: false,
      isCanceling: false,
      sensitivitySubmissionLockedByManual: false,
      lockMessage: null,
      hasActiveSensitivityJob: false,
      onSubmit: noop,
      onCancelActive: noop
    })
  );
  assert.ok(
    manualSetupMarkup.includes('setting-info-trigger') && sensitivitySetupMarkup.includes('setting-info-trigger'),
    'Expected manual and sensitivity setup controls to render shared info indicators'
  );
  assert.ok(
    visibleText(manualSetupMarkup).includes('Initial base rate') &&
      visibleText(sensitivitySetupMarkup).includes('Sensitivity policy package') &&
      visibleText(sensitivitySetupMarkup).includes('Base policy'),
    'Expected experiment setup controls to keep user-facing labels visible'
  );
  assert.equal(
    /CENTRAL_BANK_|<small>SEED<\/small>|<small>N_STEPS<\/small>/.test(
      `${visibleText(manualSetupMarkup)} ${visibleText(sensitivitySetupMarkup)}`
    ),
    false,
    'Expected experiment setup visible text to hide implementation parameter keys'
  );

  markSmokeStep('checking manual results storage cap handling');
  const optionsForInProgress = getModelRunOptions(modelRunFixtureRoot, 'v1.1', true);
  assert.equal(optionsForInProgress.requestedBaseline, 'v1.1', 'Expected baseline override selection to be honored');

  const originalResultsCapMb = process.env.DASHBOARD_RESULTS_CAP_MB;
  try {
    process.env.DASHBOARD_RESULTS_CAP_MB = '2';

    const protectedRunPath = path.join(modelRunFixtureRoot, 'Results', 'v0-output');
    fs.mkdirSync(protectedRunPath, { recursive: true });
    writeSizedFile(path.join(protectedRunPath, 'protected.bin'), 1024 * 1024);

    const storageBefore = getResultsStorageSummary(modelRunFixtureRoot);
    assert.equal(storageBefore.capBytes, 2 * 1024 * 1024, 'Expected storage summary to reflect DASHBOARD_RESULTS_CAP_MB');
    assert.ok(storageBefore.usedBytes >= 1024 * 1024, 'Expected storage summary used bytes to include baseline fixture files');

    const overCapSubmit = submitModelRun(modelRunFixtureRoot, {
      baseline: 'v1.0',
      title: 'cap-overflow-visible',
      overrides: {},
      confirmWarnings: true
    });
    assert.equal(overCapSubmit.accepted, true, 'Expected run submission to be accepted while still under cap');
    assert.equal(spawnedProcesses.length, 1, 'Expected accepted run to start immediately');

    const overCapOutputPath = path.join(modelRunFixtureRoot, overCapSubmit.job?.outputPath ?? '');
    writeSizedFile(path.join(overCapOutputPath, 'overflow.bin'), 1200 * 1024);

    spawnedProcesses[spawnedProcesses.length - 1]?.succeed();
    await waitForModelRunStatus(
      overCapSubmit.job?.jobId,
      'succeeded',
      'Expected run to finish successfully when crossing cap'
    );
    assert.ok(fs.existsSync(overCapOutputPath), 'Expected over-cap completed run output folder to remain visible');

    const storageAfter = getResultsStorageSummary(modelRunFixtureRoot);
    assert.ok(storageAfter.usedBytes > storageAfter.capBytes, 'Expected storage usage to exceed cap after completed run');
    assert.throws(
      () =>
        submitModelRun(modelRunFixtureRoot, {
          baseline: 'v1.0',
          title: 'blocked-after-over-cap',
          overrides: {},
          confirmWarnings: true
        }),
      /Results storage cap reached/,
      'Expected submission to fail when Results storage is at or above configured cap'
    );
    assert.ok(
      fs.existsSync(overCapOutputPath),
      'Expected strict cap mode to keep completed over-cap run output visible'
    );

    const bypassOverCapSubmit = submitModelRun(
      modelRunFixtureRoot,
      {
        baseline: 'v1.0',
        title: 'allowed-over-cap-dev-bypass',
        overrides: {},
        confirmWarnings: true
      },
      { ignoreStorageCap: true }
    );
    assert.equal(
      bypassOverCapSubmit.accepted,
      true,
      'Expected bypass mode to allow submission even when Results storage is above cap'
    );
    assert.equal(spawnedProcesses.length, 2, 'Expected bypass over-cap submit to start a second process');
    spawnedProcesses[spawnedProcesses.length - 1]?.succeed();
    await waitForModelRunStatus(
      bypassOverCapSubmit.job?.jobId,
      'succeeded',
      'Expected bypass over-cap job to complete successfully'
    );
    clearModelRunJob(bypassOverCapSubmit.job?.jobId ?? '');
    clearModelRunJob(overCapSubmit.job?.jobId ?? '');
  } finally {
    if (originalResultsCapMb === undefined) {
      delete process.env.DASHBOARD_RESULTS_CAP_MB;
    } else {
      process.env.DASHBOARD_RESULTS_CAP_MB = originalResultsCapMb;
    }
  }
  __resetModelRunManagerForTests();
  spawnedProcesses.length = 0;
  __setModelRunSpawnForTests(() => {
    const fakeProcess = new FakeModelProcess();
    spawnedProcesses.push(fakeProcess);
    return fakeProcess as never;
  });

  const warningResponse = submitModelRun(modelRunFixtureRoot, {
    baseline: 'v1.0',
    title: 'warning-check',
    overrides: { N_STEPS: 5001 },
    confirmWarnings: false
  });
  assert.equal(warningResponse.accepted, false, 'Expected submit to request explicit warning confirmation');
  assert.ok((warningResponse.warnings?.length ?? 0) > 0, 'Expected warning payload when confirmation is missing');
  assert.equal(listModelRunJobs().length, 0, 'Expected warning-only submit not to enqueue a job');

  markSmokeStep('checking cross-era manual base-policy config');
  __resetModelRunManagerForTests();
  let crossEraManualConfig = new Map<string, string>();
  const crossEraManualLauncher = createFakeLauncher('packaged', (request) => {
    crossEraManualConfig = parseConfigFile(request.configPath);
    fs.mkdirSync(request.outputPath, { recursive: true });
    fs.writeFileSync(path.join(request.outputPath, 'Output-run1.csv'), 'Model time;nRenting\n0;1\n', 'utf-8');
    const process = new FakeModelProcess();
    setTimeout(() => {
      process.succeed();
    }, 0);
    return process;
  });
  const crossEraManualSubmit = submitModelRun(
    modelRunFixtureRoot,
    {
      baseline: 'v0',
      basePolicy: '2024',
      title: '2011-model-2024-policy',
      overrides: {},
      confirmWarnings: true
    },
    { launcher: crossEraManualLauncher }
  );
  assert.equal(crossEraManualSubmit.accepted, true, 'Expected 2011 model with 2024 base policy to be accepted');
  await waitForModelRunStatus(
    crossEraManualSubmit.job?.jobId,
    'succeeded',
    'Expected 2011 model with 2024 base policy to complete'
  );
  const originalV0Config = parseConfigFile(path.join(modelRunFixtureRoot, 'input-data-versions', 'v0', 'config.properties'));
  const policy2024 = runOptions.basePolicies.find((policy) => policy.id === '2024');
  assert.ok(policy2024, 'Expected 2024 base policy option in run options');
  for (const [key, value] of Object.entries(policy2024?.values ?? {})) {
    assertClose(
      Number.parseFloat(crossEraManualConfig.get(key) ?? 'NaN'),
      value,
      1e-12,
      `Expected ${key} to use the 2024 base policy value`
    );
  }
  for (const [key, value] of originalV0Config) {
    if (key.startsWith('CENTRAL_BANK_') || key.startsWith('DATA_') || key === 'SEED') {
      continue;
    }
    assert.equal(
      crossEraManualConfig.get(key),
      value,
      `Expected non-policy key ${key} to stay on the selected 2011 calibration snapshot`
    );
  }
  assert.equal(crossEraManualConfig.get('SEED'), '1', 'Expected manual seeded runs to pin the first seed to 1');

  __resetModelRunManagerForTests();
  spawnedProcesses.length = 0;
  __setModelRunSpawnForTests(() => {
    const fakeProcess = new FakeModelProcess();
    spawnedProcesses.push(fakeProcess);
    return fakeProcess as never;
  });

  markSmokeStep('checking manual run queue lifecycle');
  const manualPersistentLogPaths = createDevelopmentRuntimePaths(modelRunFixtureRoot);
  const manualPersistentModelLog = createRotatingLogWriter(manualPersistentLogPaths.logsRoot, 'model');
  const firstSubmit = submitModelRun(
    manualPersistentLogPaths,
    {
      baseline: 'v1.0',
      title: 'first-run',
      overrides: { N_STEPS: 5001 },
      confirmWarnings: true
    },
    { logSink: (line) => manualPersistentModelLog.writeLine(line) }
  );
  assert.equal(firstSubmit.accepted, true, 'Expected confirmed warning submit to enqueue run');
  assert.ok(firstSubmit.job, 'Expected accepted submit to include job payload');
  assert.equal(firstSubmit.job?.runId, 'first-run v1.0', 'Expected run title to determine output folder name');
  assert.equal(spawnedProcesses.length, 1, 'Expected first accepted submit to start runner immediately');

  const secondSubmit = submitModelRun(modelRunFixtureRoot, {
    baseline: 'v1.0',
    title: 'second-run',
    overrides: {},
    confirmWarnings: true
  });
  assert.equal(secondSubmit.accepted, true, 'Expected second submit to be accepted into queue');
  const queuedJob = listModelRunJobs().find((job) => job.jobId === secondSubmit.job?.jobId);
  assert.equal(queuedJob?.status, 'queued', 'Expected second job to queue while first run is active');

  spawnedProcesses[0]?.emitStdout('sim line');
  spawnedProcesses[0]?.emitStderr('warn line');
  await waitForAsyncTick();
  const firstLogs = getModelRunJobLogs(firstSubmit.job?.jobId ?? '', 0, 50);
  assert.ok(firstLogs.lines.some((line) => line.includes('sim line')), 'Expected stdout log line in polling payload');
  assert.ok(firstLogs.lines.some((line) => line.includes('warn line')), 'Expected stderr log line in polling payload');
  const manualPersistentModelLogText = fs.readFileSync(
    path.join(manualPersistentLogPaths.logsRoot, 'model.log'),
    'utf-8'
  );
  assert.ok(
    manualPersistentModelLogText.includes(`[manual:${firstSubmit.job?.jobId}] [stdout] sim line`),
    'Expected manual stdout line to be persisted under logsRoot/model.log'
  );
  assert.ok(
    manualPersistentModelLogText.includes(`[manual:${firstSubmit.job?.jobId}] [stderr] warn line`),
    'Expected manual stderr line to be persisted under logsRoot/model.log'
  );

  cancelModelRunJob(modelRunFixtureRoot, secondSubmit.job?.jobId ?? '');
  const canceledQueuedJob = listModelRunJobs().find((job) => job.jobId === secondSubmit.job?.jobId);
  assert.equal(canceledQueuedJob?.status, 'canceled', 'Expected queued cancel to mark job as canceled');

  spawnedProcesses[0]?.succeed();
  const completedFirstJob = await waitForModelRunStatus(
    firstSubmit.job?.jobId,
    'succeeded',
    'Expected first job to complete successfully'
  );
  assert.ok(
    completedFirstJob && fs.existsSync(path.join(modelRunFixtureRoot, completedFirstJob.outputPath)),
    'Expected successful run output folder to persist'
  );

  const warningCoreIndicatorsOff = submitModelRun(modelRunFixtureRoot, {
    baseline: 'v1.0',
    title: 'core-off-warning',
    overrides: { recordCoreIndicators: false },
    confirmWarnings: false
  });
  assert.equal(warningCoreIndicatorsOff.accepted, false, 'Expected submit to block until warnings are confirmed');
  assert.ok(
    warningCoreIndicatorsOff.warnings.some((warning) => warning.code === 'core_indicators_disabled'),
    'Expected warning when recordCoreIndicators is disabled'
  );

  const unmarkedRunFolder = path.join(modelRunFixtureRoot, 'Results', 'unmarked-overwrite v1.0');
  fs.mkdirSync(unmarkedRunFolder, { recursive: true });
  fs.writeFileSync(path.join(unmarkedRunFolder, 'Output-run1.csv'), 'Model time;nRenting\n0;1\n', 'utf-8');
  assert.throws(
    () =>
      submitModelRun(modelRunFixtureRoot, {
        baseline: 'v1.0',
        title: 'unmarked-overwrite',
        overrides: {},
        confirmWarnings: true
      }),
    /not marked as a dashboard-managed run/,
    'Expected unmarked existing output folder to block manual submit even when warnings are confirmed'
  );

  const preexistingRunFolder = path.join(modelRunFixtureRoot, 'Results', 'overwrite-case v1.0');
  fs.mkdirSync(preexistingRunFolder, { recursive: true });
  fs.writeFileSync(path.join(preexistingRunFolder, 'Output-run1.csv'), 'Model time;nRenting\n0;1\n', 'utf-8');
  writeDashboardManagedRunMarker(preexistingRunFolder, {
    jobId: 'job-overwrite-fixture',
    runId: 'overwrite-case v1.0',
    baseline: 'v1.0',
    title: 'overwrite-case',
    createdAt: new Date().toISOString()
  });

  const overwriteWarning = submitModelRun(modelRunFixtureRoot, {
    baseline: 'v1.0',
    title: 'overwrite-case',
    overrides: {},
    confirmWarnings: false
  });
  assert.equal(overwriteWarning.accepted, false, 'Expected overwrite warning to require explicit confirmation');
  assert.ok(
    overwriteWarning.warnings.some((warning) => warning.code === 'output_folder_exists'),
    'Expected overwrite warning when output folder already exists'
  );

  const overwriteSubmit = submitModelRun(modelRunFixtureRoot, {
    baseline: 'v1.0',
    title: 'overwrite-case',
    overrides: {},
    confirmWarnings: true
  });
  assert.equal(overwriteSubmit.accepted, true, 'Expected overwrite-confirmed submit to enqueue run');
  assert.equal(spawnedProcesses.length, 2, 'Expected overwrite-confirmed run to start immediately');
  assert.throws(
    () =>
      submitModelRun(modelRunFixtureRoot, {
        baseline: 'v1.0',
        title: 'overwrite-case',
        overrides: {},
        confirmWarnings: true
      }),
    /already targeting output folder/,
    'Expected active output-folder collision to be rejected'
  );
  assert.throws(
    () => clearModelRunJob(overwriteSubmit.job?.jobId ?? ''),
    /Only finished jobs can be cleared/,
    'Expected running jobs to be non-clearable'
  );
  spawnedProcesses[1]?.succeed();
  const overwriteCompleted = await waitForModelRunStatus(
    overwriteSubmit.job?.jobId,
    'succeeded',
    'Expected overwrite-confirmed run to complete successfully'
  );

  const thirdSubmit = submitModelRun(modelRunFixtureRoot, {
    baseline: 'v1.0',
    title: 'cancel-running',
    overrides: {},
    confirmWarnings: true
  });
  assert.equal(thirdSubmit.accepted, true, 'Expected third submit accepted');
  assert.equal(spawnedProcesses.length, 3, 'Expected third submit to start another process after previous completion');
  assert.throws(
    () => deleteExperimentJob(modelRunFixtureRoot, `manual:${thirdSubmit.job?.jobId ?? ''}`),
    /Only finished manual experiment jobs can be deleted/,
    'Expected running manual jobs to be protected from unified queue deletion'
  );
  cancelModelRunJob(modelRunFixtureRoot, thirdSubmit.job?.jobId ?? '');
  const canceledRunningJob = await waitForModelRunStatus(
    thirdSubmit.job?.jobId,
    'canceled',
    'Expected running cancel to transition to canceled'
  );
  assert.ok(
    canceledRunningJob && !fs.existsSync(path.join(modelRunFixtureRoot, canceledRunningJob.outputPath)),
    'Expected canceled running job output folder to be removed'
  );

  const lateCancelSubmit = submitModelRun(modelRunFixtureRoot, {
    baseline: 'v1.0',
    title: 'late-cancel-race',
    overrides: {},
    confirmWarnings: true
  });
  assert.equal(lateCancelSubmit.accepted, true, 'Expected late-cancel race submit to be accepted');
  const lateCancelProcess = spawnedProcesses[spawnedProcesses.length - 1];
  assert.ok(lateCancelProcess, 'Expected late-cancel race submit to spawn a process');
  lateCancelProcess?.disableSigtermDelivery();
  cancelModelRunJob(modelRunFixtureRoot, lateCancelSubmit.job?.jobId ?? '');
  lateCancelProcess?.succeed();
  const lateCancelCompleted = await waitForModelRunStatus(
    lateCancelSubmit.job?.jobId,
    'canceled',
    'Expected cancellation intent to win even when SIGTERM delivery fails'
  );
  assert.ok(
    lateCancelCompleted && !fs.existsSync(path.join(modelRunFixtureRoot, lateCancelCompleted.outputPath)),
    'Expected canceled run output folder to be removed when cancel signal is not delivered'
  );

  const cancelBeforeSeedLaunches: ModelLaunchRequest[] = [];
  const cancelBeforeSeedLauncher: ModelLauncher = {
    ...createFakeLauncher('packaged', (request) => {
      cancelBeforeSeedLaunches.push(request);
      return new FakeModelProcess();
    }),
    prepare: () => {
      const runningJob = listModelRunJobs().find(
        (job) => job.title === 'cancel-before-seed-launch' && job.status === 'running'
      );
      assert.ok(runningJob, 'Expected prepare hook to observe the running manual job before seed launch');
      cancelModelRunJob(modelRunFixtureRoot, runningJob.jobId);
    }
  };
  const cancelBeforeSeedSubmit = submitModelRun(
    modelRunFixtureRoot,
    {
      baseline: 'v1.0',
      title: 'cancel-before-seed-launch',
      overrides: { N_SIMS: 3 },
      maxWorkers: 2,
      confirmWarnings: true
    },
    { launcher: cancelBeforeSeedLauncher }
  );
  assert.equal(cancelBeforeSeedSubmit.accepted, true, 'Expected pre-seed cancel submit to be accepted');
  await waitForModelRunStatus(
    cancelBeforeSeedSubmit.job?.jobId,
    'canceled',
    'Expected pre-seed cancel job to finish canceled'
  );
  assert.equal(
    cancelBeforeSeedLaunches.length,
    0,
    'Expected cancel during prepare to stop all manual seed child launches'
  );
  const cancelBeforeSeedJob = listModelRunJobs().find((job) => job.jobId === cancelBeforeSeedSubmit.job?.jobId);
  assert.equal(cancelBeforeSeedJob?.status, 'canceled', 'Expected pre-seed cancel job to finish canceled');
  assert.ok(
    cancelBeforeSeedJob && !fs.existsSync(path.join(modelRunFixtureRoot, cancelBeforeSeedJob.outputPath)),
    'Expected pre-seed canceled job output folder to be removed'
  );
  const cancelBeforeSeedLogs = getModelRunJobLogs(cancelBeforeSeedSubmit.job?.jobId ?? '', 0, 100);
  assert.ok(
    cancelBeforeSeedLogs.lines.some((line) =>
      line.includes('Cancel requested while no model process is active; cancellation intent recorded')
    ),
    'Expected pre-seed cancellation to log that cancellation intent was recorded without an active process'
  );

  const firstOutputPath = completedFirstJob?.outputPath;
  clearModelRunJob(firstSubmit.job?.jobId ?? '');
  assert.ok(
    !listModelRunJobs().some((job) => job.jobId === firstSubmit.job?.jobId),
    'Expected clear job action to remove finished job from queue history'
  );
  assert.ok(
    firstOutputPath && fs.existsSync(path.join(modelRunFixtureRoot, firstOutputPath)),
    'Expected clear job action not to delete successful run outputs'
  );
  const overwriteOutputPath = overwriteCompleted?.outputPath ?? '';
  const deletedManualQueueJob = deleteExperimentJob(modelRunFixtureRoot, `manual:${overwriteSubmit.job?.jobId ?? ''}`);
  assert.equal(deletedManualQueueJob.deleted, true, 'Expected unified queue delete to report manual success');
  assert.ok(
    !listModelRunJobs().some((job) => job.jobId === overwriteSubmit.job?.jobId),
    'Expected unified queue delete to clear finished manual job history'
  );
  assert.ok(
    overwriteOutputPath && !fs.existsSync(path.join(modelRunFixtureRoot, overwriteOutputPath)),
    'Expected unified queue delete to remove managed manual run output'
  );

  __resetModelRunManagerForTests();
  __setModelRunSpawnForTests(() => new FakeModelProcess() as never);
  const untitledSubmit = submitModelRun(modelRunFixtureRoot, {
    baseline: 'v1.0',
    title: '   ',
    overrides: {},
    confirmWarnings: true
  });
  assert.equal(untitledSubmit.accepted, true, 'Expected untitled submit to be accepted with fallback folder naming');
  assert.match(
    untitledSubmit.job?.runId ?? '',
    /^run-\d{8}T\d{6}Z v1\.0$/,
    'Expected untitled submit to use run-<timestamp> <baseline> output folder naming'
  );

  __resetModelRunManagerForTests();
  __setModelRunSpawnForTests(() => new FakeModelProcess() as never);
  for (let index = 0; index < 10; index += 1) {
    const response = submitModelRun(modelRunFixtureRoot, {
      baseline: 'v1.0',
      title: `queue-fill-${index + 1}`,
      overrides: {},
      confirmWarnings: true
    });
    assert.equal(response.accepted, true, 'Expected queue fill submissions to succeed before cap');
  }
  assert.throws(
    () =>
      submitModelRun(modelRunFixtureRoot, {
        baseline: 'v1.0',
        overrides: {},
        confirmWarnings: true
      }),
    /capacity reached/,
    'Expected queue cap guardrail to reject submissions above limit'
  );

  __resetModelRunManagerForTests();
  spawnedProcesses.length = 0;
  const manualInjectedLaunches: ModelLaunchRequest[] = [];
  const manualInjectedLauncher = createFakeLauncher('packaged', (request) => {
    manualInjectedLaunches.push(request);
    fs.mkdirSync(request.outputPath, { recursive: true });
    fs.writeFileSync(path.join(request.outputPath, 'Output-run1.csv'), 'Model time;nRenting\n0;1\n', 'utf-8');
    const process = new FakeModelProcess();
    spawnedProcesses.push(process);
    return process;
  });
  const injectedManualSubmit = submitModelRun(
    modelRunFixtureRoot,
    {
      baseline: 'v1.0',
      title: 'injected-launcher',
      overrides: {},
      confirmWarnings: true
    },
    { launcher: manualInjectedLauncher }
  );
  assert.equal(injectedManualSubmit.accepted, true, 'Expected manual submit to accept an injected launcher');
  assert.equal(manualInjectedLaunches.length, 1, 'Expected injected manual launcher to run immediately');
  assert.equal(
    manualInjectedLaunches[0]?.configPath.endsWith('config.properties'),
    true,
    'Expected manual injected launcher to receive an explicit generated config path'
  );
  assert.equal(
    manualInjectedLaunches[0]?.outputPath.includes(path.join('dashboard-model-runs', injectedManualSubmit.job?.jobId ?? '', 'seed-1', 'output')),
    true,
    'Expected manual injected launcher to receive a seed-scoped output folder'
  );
  spawnedProcesses[0]?.succeed();
  const injectedManualJob = await waitForModelRunStatus(
    injectedManualSubmit.job?.jobId,
    'succeeded',
    'Expected injected manual launcher job to complete normally'
  );
  const injectedManualManifestPath = path.join(
    modelRunFixtureRoot,
    injectedManualJob?.outputPath ?? '',
    RUN_MANIFEST_FILE_NAME
  );
  assert.ok(fs.existsSync(injectedManualManifestPath), 'Expected successful manual run to persist a run manifest');
  const injectedManualManifest = JSON.parse(fs.readFileSync(injectedManualManifestPath, 'utf-8')) as ManualRunManifest;
  assert.equal(injectedManualManifest.manifestType, 'manual-run', 'Expected manual manifest type');
  assert.equal(injectedManualManifest.environment.appVersion, '0.1.0-test', 'Expected manifest to record app version');
  assert.equal(injectedManualManifest.environment.releaseChannel, 'smoke-test', 'Expected manifest to record release channel');
  assert.equal(
    injectedManualManifest.environment.buildCommitSha,
    '0123456789abcdef0123456789abcdef01234567',
    'Expected manifest to record build commit SHA'
  );
  assert.equal(injectedManualManifest.launcher.mode, 'packaged', 'Expected manual manifest to record launcher mode');
  assert.ok(
    isDashboardManagedRun(path.join(modelRunFixtureRoot, injectedManualJob?.outputPath ?? ''), 'injected-launcher v1.0'),
    'Expected dashboard-managed marker to match the manual run id after launch'
  );
  assert.equal(injectedManualManifest.run.seed, 1, 'Expected manual manifest to record the first deterministic seed');
  assert.deepEqual(injectedManualManifest.run.seeds, [1], 'Expected manual manifest to record the deterministic seed block');
  assert.equal(
    injectedManualManifest.run.overriddenParameters.SEED,
    1,
    'Expected manual manifest to record deterministic seed parameters'
  );
  assert.ok(
    injectedManualManifest.run.generatedConfigHash?.value,
    'Expected manual manifest to hash the generated config'
  );
  assert.ok(
    injectedManualManifest.inputData.baselineSnapshotHash?.value,
    'Expected manual manifest to hash the selected baseline snapshot'
  );
  assert.ok(
    (injectedManualManifest.run.outputHash?.fileCount ?? 0) >= 1,
    'Expected manual manifest to hash persisted run output files'
  );

  __resetModelRunManagerForTests();
  const multiSeedManualLaunches: Array<{ config: Map<string, string>; outputPath: string }> = [];
  let multiSeedManualActive = 0;
  let multiSeedManualPeakActive = 0;
  const multiSeedManualLauncher = createFakeLauncher('packaged', (request) => {
    const config = parseConfigFile(request.configPath);
    multiSeedManualLaunches.push({ config, outputPath: request.outputPath });
    multiSeedManualActive += 1;
    multiSeedManualPeakActive = Math.max(multiSeedManualPeakActive, multiSeedManualActive);
    const seed = Number.parseInt(config.get('SEED') ?? '0', 10);
    fs.mkdirSync(request.outputPath, { recursive: true });
    fs.writeFileSync(
      path.join(request.outputPath, 'Output-run1.csv'),
      `Model time;nRenting\n0;${10 + seed}\n1;${20 + seed}\n`,
      'utf-8'
    );
    writeSensitivityCoreOutputs(request.outputPath, seed);
    const process = new FakeModelProcess();
    setTimeout(() => {
      multiSeedManualActive -= 1;
      process.succeed();
    }, 0);
    return process;
  });
  const multiSeedManualSubmit = submitModelRun(
    modelRunFixtureRoot,
    {
      baseline: 'v1.0',
      title: 'manual-multi-seed-workers',
      overrides: { N_SIMS: 3 },
      maxWorkers: 2,
      confirmWarnings: true
    },
    { launcher: multiSeedManualLauncher }
  );
  assert.equal(multiSeedManualSubmit.accepted, true, 'Expected multi-seed manual submit to be accepted');
  await waitForModelRunStatus(
    multiSeedManualSubmit.job?.jobId,
    'succeeded',
    'Expected multi-seed manual job to complete successfully'
  );
  assert.equal(multiSeedManualLaunches.length, 3, 'Expected manual N_SIMS=3 to launch three seed child runs');
  assert.ok(multiSeedManualPeakActive <= 2, 'Expected manual maxWorkers to cap concurrent seed child runs');
  assert.deepEqual(
    multiSeedManualLaunches.map((launch) => Number.parseInt(launch.config.get('SEED') ?? '0', 10)).sort(),
    [1, 2, 3],
    'Expected manual seeds to expand from fixed starting seed 1'
  );
  assert.ok(
    multiSeedManualLaunches.every((launch) => launch.config.get('N_SIMS') === '1'),
    'Expected each manual seed child config to force N_SIMS=1'
  );
  const multiSeedManualJob = listModelRunJobs().find((job) => job.jobId === multiSeedManualSubmit.job?.jobId);
  assert.equal(multiSeedManualJob?.seedsPerPoint, 3, 'Expected manual metadata to record requested seed count');
  assert.deepEqual(multiSeedManualJob?.seeds, [1, 2, 3], 'Expected manual metadata to record expanded seeds');
  assert.equal(multiSeedManualJob?.maxWorkers, 2, 'Expected manual metadata to record effective max workers');
  const multiSeedRunPath = path.join(modelRunFixtureRoot, multiSeedManualJob?.outputPath ?? '');
  assert.ok(
    fs.existsSync(path.join(multiSeedRunPath, 'seeds', 'seed-1', 'Output-run1.csv')),
    'Expected manual raw per-seed outputs to be retained under the aggregate run folder'
  );
  assert.equal(
    fs.readFileSync(path.join(multiSeedRunPath, 'Output-run1.csv'), 'utf-8').trim(),
    'Model time;nRenting\n0;12\n1;22',
    'Expected manual aggregate Output-run1.csv to average seed outputs'
  );
  const multiSeedRunDetail = getResultsRunDetail(modelRunFixtureRoot, multiSeedManualJob?.runId ?? '');
  assert.equal(multiSeedRunDetail.status, 'partial', 'Expected aggregated manual run to remain parseable as a partial result');
} finally {
  if (originalDashboardAppVersion === undefined) {
    delete process.env.DASHBOARD_APP_VERSION;
  } else {
    process.env.DASHBOARD_APP_VERSION = originalDashboardAppVersion;
  }
  if (originalDashboardReleaseChannel === undefined) {
    delete process.env.DASHBOARD_RELEASE_CHANNEL;
  } else {
    process.env.DASHBOARD_RELEASE_CHANNEL = originalDashboardReleaseChannel;
  }
  if (originalDashboardBuildCommitSha === undefined) {
    delete process.env.DASHBOARD_BUILD_COMMIT_SHA;
  } else {
    process.env.DASHBOARD_BUILD_COMMIT_SHA = originalDashboardBuildCommitSha;
  }
  __resetModelRunManagerForTests();
  fs.rmSync(modelRunFixtureRoot, { recursive: true, force: true });
}

markSmokeStep('checking desktop manual runtime paths');
const desktopManualFixture = createDesktopRuntimeFixture('dashboard-manual-runtime-smoke-');

try {
  __resetModelRunManagerForTests();
  const desktopManualLaunches: ModelLaunchRequest[] = [];
  let desktopGeneratedConfigText = '';
  const desktopManualLauncher = createFakeLauncher('packaged', (request) => {
    desktopManualLaunches.push(request);
    desktopGeneratedConfigText = fs.readFileSync(request.configPath, 'utf-8');
    const process = new FakeModelProcess();
    setTimeout(() => {
      process.succeed();
    }, 0);
    return process;
  });
  const desktopManualSubmit = submitModelRun(
    desktopManualFixture.paths,
    {
      baseline: 'v1.0',
      basePolicy: '2011',
      title: 'desktop-runtime-paths',
      overrides: {},
      confirmWarnings: true
    },
    { launcher: desktopManualLauncher }
  );
  assert.equal(desktopManualSubmit.accepted, true, 'Expected desktop runtime manual run submit to be accepted');
  assert.equal(desktopManualLaunches.length, 1, 'Expected desktop runtime manual run to launch once');
  assert.ok(
    desktopManualLaunches[0]?.configPath.startsWith(desktopManualFixture.paths.tempRoot),
    'Expected desktop manual generated config to live under tempRoot'
  );
  assert.ok(
    desktopManualLaunches[0]?.outputPath.startsWith(desktopManualFixture.paths.tempRoot),
    'Expected desktop manual child output to live under tempRoot before aggregation'
  );
  assertGeneratedDataPathsAreWindowsSafe(
    desktopGeneratedConfigText,
    path.join(desktopManualFixture.paths.dataRoot, 'v1.0'),
    'desktop manual run'
  );
  await waitForModelRunStatus(
    desktopManualSubmit.job?.jobId,
    'succeeded',
    'Expected desktop runtime manual run to complete successfully'
  );
  assert.ok(
    fs.existsSync(path.join(desktopManualFixture.paths.resultsRoot, desktopManualSubmit.job?.runId ?? '')),
    'Expected desktop manual aggregate output to live under resultsRoot after completion'
  );
  assert.equal(
    fs.existsSync(path.join(desktopManualFixture.appResourcesRoot, 'Results')),
    false,
    'Expected desktop manual run not to write Results under app resources'
  );
  assert.equal(
    fs.existsSync(path.join(desktopManualFixture.appResourcesRoot, 'tmp')),
    false,
    'Expected desktop manual run not to write tmp under app resources'
  );
} finally {
  __resetModelRunManagerForTests();
  fs.rmSync(desktopManualFixture.root, { recursive: true, force: true });
}

markSmokeStep('checking Windows-safe manual run paths');
const windowsPathModelRunFixtureRoot = createModelRunFixtureRepo('dashboard model-runs modèle 用户-');

try {
  markSmokeStep('resetting Windows-safe manual run manager');
  __resetModelRunManagerForTests();
  const windowsPathLaunches: ModelLaunchRequest[] = [];
  let generatedConfigText = '';
  const windowsPathLauncher = createFakeLauncher('packaged', (request) => {
    markSmokeStep('launching Windows-safe manual run process');
    windowsPathLaunches.push(request);
    generatedConfigText = fs.readFileSync(request.configPath, 'utf-8');
    fs.mkdirSync(request.outputPath, { recursive: true });
    fs.writeFileSync(path.join(request.outputPath, 'Output-run1.csv'), 'Model time;nRenting\n0;1\n', 'utf-8');
    const process = new FakeModelProcess();
    setTimeout(() => {
      process.succeed();
    }, 0);
    return process;
  });
  markSmokeStep('submitting Windows-safe manual run');
  const windowsPathSubmit = submitModelRun(
    windowsPathModelRunFixtureRoot,
    {
      baseline: 'v1.0',
      title: 'windows-safe-paths',
      overrides: {},
      confirmWarnings: true
    },
    { launcher: windowsPathLauncher }
  );
  markSmokeStep('asserting Windows-safe manual run submit response');
  assert.equal(windowsPathSubmit.accepted, true, 'Expected path-safety manual run submit to be accepted');
  assert.equal(windowsPathLaunches.length, 1, 'Expected path-safety manual run to launch once');
  markSmokeStep('asserting Windows-safe manual run generated paths');
  assert.ok(
    windowsPathLaunches[0]?.configPath.includes('dashboard model-runs modèle 用户-'),
    'Expected manual generated config path to include spaces and non-ASCII path segments'
  );
  assert.ok(
    windowsPathLaunches[0]?.outputPath.includes('dashboard model-runs modèle 用户-'),
    'Expected manual output path to include spaces and non-ASCII path segments'
  );
  assertGeneratedDataPathsAreWindowsSafe(
    generatedConfigText,
    path.join(windowsPathModelRunFixtureRoot, 'input-data-versions', 'v1.0'),
    'manual run'
  );
  markSmokeStep('waiting for Windows-safe manual run completion');
  await waitForModelRunStatus(
    windowsPathSubmit.job?.jobId,
    'succeeded',
    'Expected path-safety manual run to complete successfully'
  );
} finally {
  markSmokeStep('cleaning Windows-safe manual run fixture');
  __resetModelRunManagerForTests();
  fs.rmSync(windowsPathModelRunFixtureRoot, { recursive: true, force: true });
}

markSmokeStep('checking Windows-safe sensitivity run paths');
const windowsPathSensitivityFixtureRoot = createModelRunFixtureRepo('dashboard sensitivity modèle 用户-');

try {
  __resetModelRunManagerForTests();
  __resetSensitivityRunsForTests();
  const generatedConfigTexts: string[] = [];
  const windowsPathSensitivityLauncher = createFakeLauncher('packaged', (request) => {
    generatedConfigTexts.push(fs.readFileSync(request.configPath, 'utf-8'));
    assert.ok(
      request.configPath.includes('dashboard sensitivity modèle 用户-'),
      'Expected sensitivity generated config path to include spaces and non-ASCII path segments'
    );
    assert.ok(
      request.outputPath.includes('dashboard sensitivity modèle 用户-'),
      'Expected sensitivity output path to include spaces and non-ASCII path segments'
    );
    const config = parseConfigFile(request.configPath);
    const baseRate = Number.parseFloat(config.get('CENTRAL_BANK_INITIAL_BASE_RATE') ?? '0');
    writeSensitivityCoreOutputs(request.outputPath, baseRate);
    const process = new FakeModelProcess();
    setTimeout(() => {
      process.succeed();
    }, 0);
    return process;
  });
  const windowsPathSensitivitySubmit = submitSensitivityExperiment(
    windowsPathSensitivityFixtureRoot,
    {
      baseline: 'v1.0',
      basePolicy: '2011',
      title: 'windows-safe-paths',
      parameterKey: 'CENTRAL_BANK_INITIAL_BASE_RATE',
      min: 0.004,
      max: 0.006,
      confirmWarnings: true
    },
    { launcher: windowsPathSensitivityLauncher }
  );
  assert.equal(
    windowsPathSensitivitySubmit.accepted,
    true,
    'Expected path-safety sensitivity submit to be accepted'
  );
  const windowsPathSensitivityExperimentId = windowsPathSensitivitySubmit.experiment?.experimentId ?? '';
  markSmokeStep('waiting for Windows-safe sensitivity run completion');
  await waitForSensitivityStatus(
    windowsPathSensitivityFixtureRoot,
    windowsPathSensitivityExperimentId,
    'succeeded',
    'Expected path-safety sensitivity run to complete successfully'
  );
  assert.equal(generatedConfigTexts.length, 25, 'Expected path-safety sensitivity run to generate one config per point/seed run');
  for (const configText of generatedConfigTexts) {
    assertGeneratedDataPathsAreWindowsSafe(
      configText,
      path.join(windowsPathSensitivityFixtureRoot, 'input-data-versions', 'v1.0'),
      'sensitivity run'
    );
  }
} finally {
  __resetSensitivityRunsForTests();
  __resetModelRunManagerForTests();
  fs.rmSync(windowsPathSensitivityFixtureRoot, { recursive: true, force: true });
}

markSmokeStep('checking desktop sensitivity runtime paths');
const desktopSensitivityFixture = createDesktopRuntimeFixture('dashboard-sensitivity-runtime-smoke-');

try {
  __resetModelRunManagerForTests();
  __resetSensitivityRunsForTests();
  const desktopSensitivityLaunches: ModelLaunchRequest[] = [];
  const desktopSensitivityConfigs: string[] = [];
  const desktopSensitivityLauncher = createFakeLauncher('packaged', (request) => {
    desktopSensitivityLaunches.push(request);
    desktopSensitivityConfigs.push(fs.readFileSync(request.configPath, 'utf-8'));
    assert.ok(
      request.configPath.startsWith(desktopSensitivityFixture.paths.tempRoot),
      'Expected desktop sensitivity config path to live under tempRoot'
    );
    assert.ok(
      request.outputPath.startsWith(desktopSensitivityFixture.paths.tempRoot),
      'Expected summary-only desktop sensitivity output path to live under tempRoot'
    );
    const config = parseConfigFile(request.configPath);
    const baseRate = Number.parseFloat(config.get('CENTRAL_BANK_INITIAL_BASE_RATE') ?? '0');
    writeSensitivityCoreOutputs(request.outputPath, baseRate);
    const process = new FakeModelProcess();
    setTimeout(() => {
      process.succeed();
    }, 0);
    return process;
  });
  const desktopSensitivitySubmit = submitSensitivityExperiment(
    desktopSensitivityFixture.paths,
    {
      baseline: 'v1.0',
      basePolicy: '2011',
      title: 'desktop-runtime-paths',
      parameterKey: 'CENTRAL_BANK_INITIAL_BASE_RATE',
      min: 0.004,
      max: 0.006,
      confirmWarnings: true
    },
    { launcher: desktopSensitivityLauncher }
  );
  assert.equal(desktopSensitivitySubmit.accepted, true, 'Expected desktop sensitivity submit to be accepted');
  const desktopSensitivityExperimentId = desktopSensitivitySubmit.experiment?.experimentId ?? '';
  await waitUntil(() => {
    const detail = getSensitivityExperiment(
      desktopSensitivityFixture.paths,
      desktopSensitivityExperimentId
    ).experiment;
    return detail.status === 'succeeded';
  });
  assert.equal(desktopSensitivityLaunches.length, 25, 'Expected desktop sensitivity run to launch one process per point/seed run');
  for (const configText of desktopSensitivityConfigs) {
    assertGeneratedDataPathsAreWindowsSafe(
      configText,
      path.join(desktopSensitivityFixture.paths.dataRoot, 'v1.0'),
      'desktop sensitivity run'
    );
  }
  const desktopSensitivityResults = getSensitivityExperimentResults(
    desktopSensitivityFixture.paths,
    desktopSensitivityExperimentId
  );
  assert.ok(
    desktopSensitivityResults.points.every((point) => point.outputPath === null),
    'Expected desktop sensitivity runs to keep summary results only'
  );
  assert.equal(
    fs.existsSync(path.join(desktopSensitivityFixture.appResourcesRoot, 'Results')),
    false,
    'Expected desktop sensitivity run not to write Results under app resources'
  );
  assert.equal(
    fs.existsSync(path.join(desktopSensitivityFixture.appResourcesRoot, 'tmp')),
    false,
    'Expected desktop sensitivity run not to write tmp under app resources'
  );
} finally {
  __resetSensitivityRunsForTests();
  __resetModelRunManagerForTests();
  fs.rmSync(desktopSensitivityFixture.root, { recursive: true, force: true });
}

const seedWarningFixtureRoot = createModelRunFixtureRepo();
try {
  __resetSensitivityRunsForTests();
  const seedWarningRunOptions = getModelRunOptions(seedWarningFixtureRoot, 'v1.0', true);
  const seedWarningPolicy =
    seedWarningRunOptions.basePolicies.find((policy) => policy.id === DEFAULT_EXPERIMENT_BASE_POLICY_ID) ?? null;
  const seedWarningFormValues = toInitialFormValues(seedWarningRunOptions.parameters, seedWarningPolicy);
  const seedWarningOverrides = buildGeneralModelControlOverridesFromForm(seedWarningRunOptions.parameters, {
    ...seedWarningFormValues,
    N_SIMS: '1'
  });
  __setSensitivityRunSpawnForTests((_repoRoot, configPath, outputPath) => {
    const config = parseConfigFile(configPath);
    const softMaxFtb = Number.parseFloat(config.get('CENTRAL_BANK_LTI_SOFT_MAX_FTB') ?? '0');
    writeSensitivityCoreOutputs(outputPath, softMaxFtb);
    const process = new FakeModelProcess();
    setTimeout(() => {
      process.succeed();
    }, 0);
    return process as never;
  });
  const seedOneSubmit = submitSensitivityExperiment(seedWarningFixtureRoot, {
    baseline: 'v1.0',
    basePolicy: DEFAULT_EXPERIMENT_BASE_POLICY_ID,
    policyPackageId: DEFAULT_SENSITIVITY_POLICY_PACKAGE_ID,
    min: 4,
    max: 5,
    overrides: seedWarningOverrides,
    confirmWarnings: false
  });
  assert.equal(seedOneSubmit.accepted, true, 'Expected N_SIMS=1 sensitivity submit to be accepted without seed warning');
  assert.ok(
    seedOneSubmit.warnings.every((warning) => warning.code !== 'multiple_simulations'),
    'Expected N_SIMS=1 sensitivity submit not to warn about five seeds per sampled point'
  );
} finally {
  __resetSensitivityRunsForTests();
}

const sensitivityFixtureRoot = createModelRunFixtureRepo();
const sensitivityProcesses: FakeModelProcess[] = [];

try {
  __resetModelRunManagerForTests();
  __resetSensitivityRunsForTests();
  __setSensitivityRunSpawnForTests((_repoRoot, configPath, outputPath) => {
    const config = parseConfigFile(configPath);
    const baseRate = Number.parseFloat(config.get('CENTRAL_BANK_INITIAL_BASE_RATE') ?? '0');
    writeSensitivityCoreOutputs(outputPath, baseRate);
    const process = new FakeModelProcess();
    sensitivityProcesses.push(process);
    setTimeout(() => {
      process.emitStdout('Simulation: 1, time: 100');
      process.emitStdout(`running point ${baseRate}`);
      process.emitStderr(`warn point ${baseRate}`);
      process.succeed();
    }, 0);
    return process as never;
  });

  const warningSubmit = submitSensitivityExperiment(sensitivityFixtureRoot, {
    baseline: 'v1.0',
    basePolicy: '2011',
    parameterKey: 'CENTRAL_BANK_INITIAL_BASE_RATE',
    min: 0.004,
    max: 0.006,
    overrides: { TARGET_POPULATION: 20_000 },
    confirmWarnings: false
  });
  assert.equal(warningSubmit.accepted, false, 'Expected sensitivity submit to require warning confirmation');
  assert.ok((warningSubmit.warnings.length ?? 0) > 0, 'Expected warning payload for high target population points');

  const policyWarningCases = [
    {
      parameterKey: 'CENTRAL_BANK_INITIAL_BASE_RATE',
      min: 0.004,
      max: 0.006,
      expectedCode: 'central_bank_base_rate_below_bank_initial_rate'
    },
    {
      parameterKey: 'CENTRAL_BANK_LTV_HARD_MAX_FTB',
      min: 0.9,
      max: 1,
      expectedCode: 'central_bank_upper_limit_non_binding'
    },
    {
      parameterKey: 'CENTRAL_BANK_LTV_HARD_MAX_HM',
      min: 0.85,
      max: 0.95,
      expectedCode: 'central_bank_upper_limit_non_binding'
    },
    {
      parameterKey: 'CENTRAL_BANK_LTV_HARD_MAX_BTL',
      min: 0.75,
      max: 0.85,
      expectedCode: 'central_bank_upper_limit_non_binding'
    },
    {
      parameterKey: 'CENTRAL_BANK_LTI_SOFT_MAX_FTB',
      min: 5,
      max: 5.8,
      expectedCode: 'central_bank_lti_soft_limit_non_binding'
    },
    {
      parameterKey: 'CENTRAL_BANK_LTI_SOFT_MAX_HM',
      min: 5.2,
      max: 6,
      expectedCode: 'central_bank_lti_soft_limit_non_binding'
    },
    {
      parameterKey: 'CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_FTB',
      min: 0.1,
      max: 0.2,
      expectedCode: 'central_bank_lti_quota_inactive'
    },
    {
      parameterKey: 'CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_HM',
      min: 0.1,
      max: 0.2,
      expectedCode: 'central_bank_lti_quota_inactive'
    },
    {
      parameterKey: 'CENTRAL_BANK_LTI_MONTHS_TO_CHECK',
      min: 11,
      max: 13,
      expectedCode: 'central_bank_lti_window_inactive'
    },
    {
      parameterKey: 'CENTRAL_BANK_AFFORDABILITY_HARD_MAX',
      min: 0.3,
      max: 0.5,
      expectedCode: 'central_bank_upper_limit_non_binding'
    },
    {
      parameterKey: 'CENTRAL_BANK_ICR_HARD_MIN',
      min: 1,
      max: 1.4,
      expectedCode: 'central_bank_lower_limit_non_binding'
    }
  ];

  for (const testCase of policyWarningCases) {
    const response = submitSensitivityExperiment(sensitivityFixtureRoot, {
      baseline: 'v1.0',
      basePolicy: '2011',
      parameterKey: testCase.parameterKey,
      min: testCase.min,
      max: testCase.max,
      overrides: { N_SIMS: 1 },
      confirmWarnings: false
    });
    assert.equal(response.accepted, false, `Expected ${testCase.parameterKey} to require warning confirmation`);
    assert.ok(
      response.warnings.some((warning) => warning.code === testCase.expectedCode),
      `Expected ${testCase.parameterKey} to emit ${testCase.expectedCode}`
    );
  }

  const sensitivityPersistentLogPaths = createDevelopmentRuntimePaths(sensitivityFixtureRoot);
  const sensitivityPersistentModelLog = createRotatingLogWriter(sensitivityPersistentLogPaths.logsRoot, 'model');
  const successSubmit = submitSensitivityExperiment(
    sensitivityPersistentLogPaths,
    {
      baseline: 'v1.0',
      basePolicy: '2011',
      title: 'base-rate-sweep',
      parameterKey: 'CENTRAL_BANK_INITIAL_BASE_RATE',
      min: 0.004,
      max: 0.006,
      confirmWarnings: true
    },
    { logSink: (line) => sensitivityPersistentModelLog.writeLine(line) }
  );
  assert.equal(successSubmit.accepted, true, 'Expected sensitivity submit to start experiment');
  const successExperimentId = successSubmit.experiment?.experimentId ?? '';
  assert.ok(successExperimentId.length > 0, 'Expected started sensitivity experiment id');
  assert.match(
    successExperimentId,
    /^sensitivity-\d{8}T\d{6}Z-[0-9a-f]{8}$/,
    'Expected default local sensitivity submissions to keep generating experiment ids'
  );

  await waitUntil(() => {
    const detail = getSensitivityExperiment(sensitivityFixtureRoot, successExperimentId).experiment;
    return detail.status === 'succeeded';
  });

  const successDetail = getSensitivityExperiment(sensitivityFixtureRoot, successExperimentId).experiment;
  assert.equal(successDetail.status, 'succeeded', 'Expected sensitivity experiment to finish as succeeded');
  assert.equal(successDetail.sampledPoints.length, 5, 'Expected five sampled points for non-integer sweep');
  assert.equal(successDetail.parameter.sampleCount, 5, 'Expected default sensitivity sample count to be recorded');
  assert.deepEqual(successDetail.seeds, [1, 2, 3, 4, 5], 'Expected default sensitivity experiment to expand five seeds from seed 1');
  assert.equal(successDetail.seedsPerPoint, 5, 'Expected default sensitivity experiment to run five seeds per point');
  assert.equal(
    hasActiveSensitivityExperiment(sensitivityFixtureRoot),
    false,
    'Expected no active sensitivity experiment after completion'
  );

  const successResults = getSensitivityExperimentResults(sensitivityFixtureRoot, successExperimentId);
  assert.equal(successResults.points.length, 5, 'Expected five point results in summary payload');
  assert.ok(
    successResults.points.every((point) => point.status === 'succeeded'),
    'Expected all points to succeed for deterministic sensitivity fixture'
  );
  assert.ok(
    successResults.points.every((point) => point.outputPath === null),
    'Expected summary-only sensitivity run to avoid retained point outputs'
  );
  assert.ok(
    !fs.existsSync(path.join(sensitivityFixtureRoot, 'Results', 'experiments', 'sensitivity', successExperimentId, 'points')),
    'Expected summary-only sensitivity run not to retain points folder'
  );
  const successManifestPath = path.join(
    sensitivityFixtureRoot,
    'Results',
    'experiments',
    'sensitivity',
    successExperimentId,
    RUN_MANIFEST_FILE_NAME
  );
  assert.ok(fs.existsSync(successManifestPath), 'Expected sensitivity experiment to persist a run manifest');
  const successManifest = JSON.parse(fs.readFileSync(successManifestPath, 'utf-8')) as SensitivityRunManifest;
  assert.equal(successManifest.manifestType, 'sensitivity-experiment', 'Expected sensitivity manifest type');
  assert.equal(successManifest.experiment.status, 'succeeded', 'Expected sensitivity manifest to record final status');
  assert.equal(successManifest.experiment.basePolicy, '2011', 'Expected sensitivity manifest to record base policy');
  assert.equal(
    successManifest.experiment.parameter.key,
    'CENTRAL_BANK_INITIAL_BASE_RATE',
    'Expected singleton-package sensitivity manifest to keep the legacy parameter key'
  );
  assert.equal(
    successManifest.experiment.parameter.packageId,
    'central_bank_initial_base_rate',
    'Expected sensitivity manifest to preserve package metadata'
  );
  assert.deepEqual(
    successManifest.experiment.parameter.parameterKeys,
    ['CENTRAL_BANK_INITIAL_BASE_RATE'],
    'Expected sensitivity manifest to preserve package parameter keys'
  );
  assert.equal(successManifest.experiment.parameter.sampleCount, 5, 'Expected sensitivity manifest to record sample count');
  assert.equal(successManifest.experiment.points.length, 25, 'Expected sensitivity manifest to record every sampled point/seed run');
  assert.deepEqual(successManifest.experiment.seeds, [1, 2, 3, 4, 5], 'Expected sensitivity manifest to record forced seeds');
  assert.ok(
    successManifest.experiment.points.every((point) => point.generatedConfigHash?.value),
    'Expected sensitivity manifest to preserve each temporary generated-config hash'
  );
  assert.ok(
    successManifest.experiment.points.every((point) => point.overriddenParameters.SEED === point.seed),
    'Expected sensitivity manifest to record each forced seed override'
  );
  assert.ok(
    successManifest.experiment.points.every((point) => point.overriddenParameters.N_SIMS === 1),
    'Expected sensitivity manifest to record one Java simulation per independent seed run'
  );
  assert.ok(
    successManifest.experiment.points.every(
      (point) => typeof point.valuesByKey?.CENTRAL_BANK_INITIAL_BASE_RATE === 'number'
    ),
    'Expected sensitivity manifest to record key-specific point overrides'
  );
  assert.ok(
    successManifest.experiment.points.every((point) => point.outputHash?.value),
    'Expected sensitivity manifest to hash each point output before summary-only cleanup'
  );
  assert.ok(successManifest.experiment.summaryHash?.value, 'Expected sensitivity manifest to hash the summary payload');
  const firstPointMetric = successResults.points[0]?.indicatorMetrics[0];
  assert.ok(firstPointMetric, 'Expected indicator KPI metrics to be present for sensitivity points');
  assert.equal(
    Object.prototype.hasOwnProperty.call(firstPointMetric, 'kpi'),
    true,
    'Expected sensitivity metrics to include KPI bundle'
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(firstPointMetric, 'deltaFromBaseline'),
    true,
    'Expected sensitivity metrics to include KPI-keyed deltas'
  );
  const baselinePoint = successResults.points.find((point) => point.isBaseline) ?? null;
  const comparisonPoint = successResults.points.find((point) => !point.isBaseline) ?? null;
  const baselineMetric = baselinePoint?.indicatorMetrics.find((metric) => metric.indicatorId === firstPointMetric.indicatorId) ?? null;
  const comparisonMetric = comparisonPoint?.indicatorMetrics.find((metric) => metric.indicatorId === firstPointMetric.indicatorId) ?? null;
  const baselineMean = baselineMetric?.kpi.mean ?? null;
  const comparisonMean = comparisonMetric?.kpi.mean ?? null;
  const observedPercentDiff = comparisonMetric?.deltaFromBaseline.mean ?? null;
  if (baselineMean === null || comparisonMean === null || observedPercentDiff === null) {
    throw new Error('Expected baseline and comparison KPI means with a computed % diff for at least one indicator');
  }
  const expectedPercentDiff = ((comparisonMean - baselineMean) / baselineMean) * 100;
  assertClose(
    observedPercentDiff,
    expectedPercentDiff,
    1e-9,
    'Expected KPI delta to be stored as percent difference from baseline'
  );
  assertClose(
    baselineMean,
    62.195,
    1e-9,
    'Expected sensitivity KPI means to use core indicator values from model time 200 onward'
  );

  const successCharts = getSensitivityExperimentCharts(sensitivityFixtureRoot, successExperimentId);
  assert.ok(successCharts.tornado.length > 0, 'Expected tornado chart payload to include indicators');
  assert.equal(successCharts.windowType, 'post_200', 'Expected sensitivity charts payload to include post_200 window');
  assert.equal(
    Object.prototype.hasOwnProperty.call(successCharts.tornado[0] ?? {}, 'maxAbsDeltaByKpi'),
    true,
    'Expected tornado payload to include KPI-keyed max deltas'
  );
  assert.ok(
    successCharts.deltaTrend.every((series) => series.points.length > 0),
    'Expected delta-trend payload to include points for each policy indicator'
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(successCharts.deltaTrend[0]?.points[0] ?? {}, 'deltaByKpi'),
    true,
    'Expected delta trend points to include KPI-keyed signed % differences'
  );
  assert.equal(
    typeof successCharts.tornado[0]?.maxAbsDeltaByKpi.mean,
    'number',
    'Expected tornado mean basis value to be computed'
  );
  assert.equal(
    typeof successCharts.tornado[0]?.maxAbsDeltaByKpi.range,
    'number',
    'Expected tornado range basis value to be computed'
  );

  const logsPayload = getSensitivityExperimentLogs(sensitivityFixtureRoot, successExperimentId, 0, 200);
  assert.ok(
    logsPayload.lines.some((line) => line.includes('[system]')),
    'Expected sensitivity logs to include lifecycle system markers'
  );
  assert.ok(
    logsPayload.lines.some((line) => /Worker \d+\/\d+ started point/.test(line)),
    'Expected sensitivity logs to include summarized worker start lines'
  );
  assert.ok(
    logsPayload.lines.some((line) => line.includes('finished point') && line.includes('throughput')),
    'Expected sensitivity logs to include summarized worker finish lines with throughput'
  );
  assert.ok(
    logsPayload.lines.every((line) => !line.includes('Simulation: 1, time:') && !line.includes('[stdout]') && !line.includes('[stderr]')),
    'Expected sensitivity live logs to hide raw JVM stdout and stderr lines'
  );
  assert.equal(logsPayload.progress?.totalRuns, 25, 'Expected sensitivity logs payload to expose total run progress');
  assert.equal(logsPayload.progress?.completedRuns, 25, 'Expected final sensitivity progress to count all completed runs');
  assert.equal(
    logsPayload.progress?.percentComplete,
    100,
    'Expected final sensitivity progress to reach 100%'
  );
  const sensitivityPersistentModelLogText = fs.readFileSync(
    path.join(sensitivityPersistentLogPaths.logsRoot, 'model.log'),
    'utf-8'
  );
  assert.ok(
    sensitivityPersistentModelLogText.includes(`[sensitivity:${successExperimentId}] [system]`),
    'Expected sensitivity system lifecycle lines to be persisted under logsRoot/model.log'
  );
  assert.ok(
    sensitivityPersistentModelLogText.includes(`[sensitivity:${successExperimentId}] [raw:stdout] running point`),
    'Expected sensitivity raw stdout lines to be persisted under logsRoot/model.log'
  );
  assert.ok(
    sensitivityPersistentModelLogText.includes(`[sensitivity:${successExperimentId}] [raw:stderr] warn point`),
    'Expected sensitivity raw stderr lines to be persisted under logsRoot/model.log'
  );
  assert.ok(
    sensitivityPersistentModelLogText.includes(`[sensitivity:${successExperimentId}] [raw:stdout] Simulation: 1, time: 100`),
    'Expected raw JVM progress lines to be retained only in persistent logs'
  );

  const liveProgressProcesses: FakeModelProcess[] = [];
  const liveProgressLauncher = createFakeLauncher('maven', (request) => {
    const config = parseConfigFile(request.configPath);
    const baseRate = Number.parseFloat(config.get('CENTRAL_BANK_INITIAL_BASE_RATE') ?? '0');
    writeSensitivityCoreOutputs(request.outputPath, baseRate);
    const process = new FakeModelProcess();
    liveProgressProcesses.push(process);
    return process;
  });
  const liveProgressSubmit = submitSensitivityExperiment(
    sensitivityFixtureRoot,
    {
      baseline: 'v1.0',
      basePolicy: '2011',
      title: 'live-progress-fixture',
      parameterKey: 'CENTRAL_BANK_INITIAL_BASE_RATE',
      min: 0.004,
      max: 0.006,
      sampleCount: 2,
      overrides: { N_SIMS: 1, N_STEPS: 1000 },
      maxWorkers: 1,
      confirmWarnings: true
    },
    { launcher: liveProgressLauncher }
  );
  assert.equal(liveProgressSubmit.accepted, true, 'Expected live-progress sensitivity submit to be accepted');
  const liveProgressExperimentId = liveProgressSubmit.experiment?.experimentId ?? '';
  await waitUntil(() => liveProgressProcesses.length === 1);
  liveProgressProcesses[0]?.emitStdout('Simulation: 1, time: 500');
  liveProgressProcesses[0]?.emitStdout('raw output that should stay hidden');
  await waitForAsyncTick();
  const liveProgressLogs = getSensitivityExperimentLogs(sensitivityFixtureRoot, liveProgressExperimentId, 0, 200);
  assert.ok(
    (liveProgressLogs.progress?.percentComplete ?? 0) > 0 && (liveProgressLogs.progress?.percentComplete ?? 100) < 100,
    'Expected parsed JVM model-time ticks to advance progress before the task finishes'
  );
  assert.ok(
    liveProgressLogs.lines.some((line) => line.includes('Worker 1/1 started point')),
    'Expected in-progress logs to identify the active worker'
  );
  assert.ok(
    liveProgressLogs.lines.every(
      (line) => !line.includes('Simulation: 1, time: 500') && !line.includes('raw output that should stay hidden')
    ),
    'Expected in-progress Live Logs to hide raw JVM output'
  );
  cancelSensitivityExperiment(sensitivityFixtureRoot, liveProgressExperimentId);
  await waitUntil(() => {
    const detail = getSensitivityExperiment(sensitivityFixtureRoot, liveProgressExperimentId).experiment;
    return detail.status === 'canceled';
  });

  const forcedExperimentId = 'sensitivity-20260511T000000Z-abcdef12';
  const forcedSubmit = submitSensitivityExperiment(
    sensitivityFixtureRoot,
    {
      baseline: 'v1.0',
      basePolicy: '2011',
      title: 'forced-id-sweep',
      parameterKey: 'CENTRAL_BANK_INITIAL_BASE_RATE',
      min: 0.004,
      max: 0.006,
      overrides: { N_SIMS: 1 },
      sampleCount: 2,
      confirmWarnings: true
    },
    { forcedExperimentId }
  );
  assert.equal(forcedSubmit.accepted, true, 'Expected forced-id sensitivity submit to start experiment');
  assert.equal(
    forcedSubmit.experiment?.experimentId,
    forcedExperimentId,
    'Expected internal forced sensitivity id to be used for the submitted experiment'
  );
  await waitUntil(() => {
    const detail = getSensitivityExperiment(sensitivityFixtureRoot, forcedExperimentId).experiment;
    return detail.status === 'succeeded';
  });
  const forcedExperimentRoot = path.join(
    sensitivityFixtureRoot,
    'Results',
    'experiments',
    'sensitivity',
    forcedExperimentId
  );
  const forcedMetadata = JSON.parse(
    fs.readFileSync(path.join(forcedExperimentRoot, 'metadata.json'), 'utf-8')
  );
  const forcedSummary = JSON.parse(
    fs.readFileSync(path.join(forcedExperimentRoot, 'summary.json'), 'utf-8')
  );
  const forcedManifest = JSON.parse(
    fs.readFileSync(path.join(forcedExperimentRoot, RUN_MANIFEST_FILE_NAME), 'utf-8')
  ) as SensitivityRunManifest;
  assert.equal(forcedMetadata.experimentId, forcedExperimentId, 'Expected metadata.json to use forced experiment id');
  assert.equal(forcedSummary.results.experimentId, forcedExperimentId, 'Expected summary.json to use forced experiment id');
  assert.equal(
    forcedManifest.experiment.experimentId,
    forcedExperimentId,
    'Expected run manifest to use forced experiment id'
  );

  const midpointRaceLaunches: ModelLaunchRequest[] = [];
  const midpointRaceConfigPaths = new Set<string>();
  const midpointRaceOutputPaths = new Set<string>();
  const midpointRaceLauncher = createFakeLauncher('packaged', (request) => {
    assert.equal(
      midpointRaceConfigPaths.has(request.configPath),
      false,
      `Expected sensitivity config path to be unique per point/seed run: ${request.configPath}`
    );
    assert.equal(
      midpointRaceOutputPaths.has(request.outputPath),
      false,
      `Expected sensitivity output path to be unique per point/seed run: ${request.outputPath}`
    );
    midpointRaceLaunches.push(request);
    midpointRaceConfigPaths.add(request.configPath);
    midpointRaceOutputPaths.add(request.outputPath);
    const config = parseConfigFile(request.configPath);
    const baseRate = Number.parseFloat(config.get('CENTRAL_BANK_INITIAL_BASE_RATE') ?? '0');
    writeSensitivityCoreOutputs(request.outputPath, baseRate);
    const process = new FakeModelProcess();
    setTimeout(() => {
      process.succeed();
    }, 0);
    return process;
  });
  const midpointRaceSubmit = submitSensitivityExperiment(
    sensitivityFixtureRoot,
    {
      baseline: 'v1.0',
      basePolicy: '2011',
      title: 'midpoint-dedup-race',
      parameterKey: 'CENTRAL_BANK_INITIAL_BASE_RATE',
      min: 0.0045,
      max: 0.0055,
      confirmWarnings: true
    },
    { launcher: midpointRaceLauncher }
  );
  assert.equal(midpointRaceSubmit.accepted, true, 'Expected midpoint dedupe sensitivity submit to be accepted');
  const midpointRaceExperimentId = midpointRaceSubmit.experiment?.experimentId ?? '';
  await waitUntil(() => {
    const detail = getSensitivityExperiment(sensitivityFixtureRoot, midpointRaceExperimentId).experiment;
    return detail.status === 'succeeded';
  });
  const midpointRaceDetail = getSensitivityExperiment(sensitivityFixtureRoot, midpointRaceExperimentId).experiment;
  assert.equal(
    midpointRaceDetail.sampledPoints.length,
    5,
    'Expected float-normalized midpoint baseline to collapse into five sampled points'
  );
  assert.equal(
    new Set(midpointRaceDetail.sampledPoints.map((point) => point.pointId)).size,
    midpointRaceDetail.sampledPoints.length,
    'Expected every sampled point id to be unique after float normalization'
  );
  assert.deepEqual(
    midpointRaceDetail.sampledPoints.map((point) => point.label),
    ['0.0045', '0.00475', '0.005', '0.00525', '0.0055'],
    'Expected midpoint sweep labels to omit binary floating-point artifacts'
  );
  assert.equal(
    midpointRaceDetail.collapsedSlots.sample_3,
    'point-0.005',
    'Expected normalized midpoint sample to use the canonical 0.005 point id'
  );
  assert.equal(
    midpointRaceDetail.collapsedSlots.baseline,
    midpointRaceDetail.collapsedSlots.sample_3,
    'Expected baseline slot to collapse into the normalized midpoint sample'
  );
  assert.equal(midpointRaceLaunches.length, 25, 'Expected five sampled points times five default seeds');
  assert.equal(
    midpointRaceConfigPaths.size,
    midpointRaceLaunches.length,
    'Expected every launched midpoint config path to be unique'
  );
  assert.equal(
    midpointRaceOutputPaths.size,
    midpointRaceLaunches.length,
    'Expected every launched midpoint output path to be unique'
  );

  const twoPointSubmit = submitSensitivityExperiment(sensitivityFixtureRoot, {
    baseline: 'v1.0',
    basePolicy: '2011',
    title: 'two-point-grid-with-baseline',
    parameterKey: 'CENTRAL_BANK_INITIAL_BASE_RATE',
    min: 0.004,
    max: 0.006,
    sampleCount: 2,
    confirmWarnings: true
  });
  assert.equal(twoPointSubmit.accepted, true, 'Expected two-point sensitivity submit to be accepted');
  const twoPointExperimentId = twoPointSubmit.experiment?.experimentId ?? '';
  await waitUntil(() => {
    const detail = getSensitivityExperiment(sensitivityFixtureRoot, twoPointExperimentId).experiment;
    return detail.status === 'succeeded';
  });
  const twoPointDetail = getSensitivityExperiment(sensitivityFixtureRoot, twoPointExperimentId).experiment;
  assert.equal(twoPointDetail.parameter.sampleCount, 2, 'Expected requested sample count to persist in metadata');
  assert.deepEqual(
    twoPointDetail.sampledPoints.map((point) => point.label),
    ['0.004', '0.006', '0.005'],
    'Expected two-point grid to run min, max, and the added off-grid baseline point'
  );
  assert.equal(twoPointDetail.collapsedSlots.min, 'point-0.004', 'Expected min slot to point at the minimum sample');
  assert.equal(twoPointDetail.collapsedSlots.max, 'point-0.006', 'Expected max slot to point at the maximum sample');
  assert.equal(twoPointDetail.collapsedSlots.baseline, 'point-0.005', 'Expected baseline slot to point at the added baseline sample');

  const injectedSensitivityLaunches: ModelLaunchRequest[] = [];
  const injectedSensitivityLauncher = createFakeLauncher('packaged', (request) => {
    injectedSensitivityLaunches.push(request);
    const config = parseConfigFile(request.configPath);
    const baseRate = Number.parseFloat(config.get('CENTRAL_BANK_INITIAL_BASE_RATE') ?? '0');
    writeSensitivityCoreOutputs(request.outputPath, baseRate);
    const process = new FakeModelProcess();
    sensitivityProcesses.push(process);
    setTimeout(() => {
      process.succeed();
    }, 0);
    return process;
  });
  const injectedSensitivitySubmit = submitSensitivityExperiment(
    sensitivityFixtureRoot,
    {
      baseline: 'v1.0',
      basePolicy: '2011',
      title: 'injected-packaged-launcher',
      parameterKey: 'CENTRAL_BANK_INITIAL_BASE_RATE',
      min: 0.004,
      max: 0.006,
      confirmWarnings: true
    },
    { launcher: injectedSensitivityLauncher }
  );
  assert.equal(
    injectedSensitivitySubmit.accepted,
    true,
    'Expected sensitivity submit to accept an injected launcher'
  );
  const injectedSensitivityExperimentId = injectedSensitivitySubmit.experiment?.experimentId ?? '';
  await waitUntil(() => {
    const detail = getSensitivityExperiment(sensitivityFixtureRoot, injectedSensitivityExperimentId).experiment;
    return detail.status === 'succeeded';
  });
  const injectedSensitivityDetail = getSensitivityExperiment(
    sensitivityFixtureRoot,
    injectedSensitivityExperimentId
  ).experiment;
  assert.equal(
    injectedSensitivityDetail.runCommand.mode,
    'packaged',
    'Expected injected sensitivity launcher mode to persist in metadata'
  );
  assert.equal(
    injectedSensitivityDetail.runCommand.commandTemplate,
    'fake packaged launcher',
    'Expected injected sensitivity launcher command template to persist in metadata'
  );
  assert.equal(
    injectedSensitivityLaunches.length,
    25,
    'Expected injected sensitivity launcher to run once per sampled point/seed run'
  );
  assert.ok(
    injectedSensitivityLaunches.every((request) => request.configPath.endsWith('config.properties') && request.outputPath),
    'Expected injected sensitivity launches to receive explicit config and output paths'
  );

  assert.throws(
    () =>
      submitSensitivityExperiment(sensitivityFixtureRoot, {
        baseline: 'v1.0',
        title: 'retain-outputs',
        parameterKey: 'CENTRAL_BANK_INITIAL_BASE_RATE',
        min: 0.004,
        max: 0.006,
        retainFullOutput: true,
        confirmWarnings: true
      } as never),
    /retainFullOutput is no longer supported/,
    'Expected removed full-output sensitivity API option to be rejected'
  );

  const multiSeedLaunches: Array<{ config: Map<string, string>; outputPath: string }> = [];
  let multiSeedActive = 0;
  let multiSeedPeakActive = 0;
  const multiSeedLauncher = createFakeLauncher('packaged', (request) => {
    const config = parseConfigFile(request.configPath);
    multiSeedLaunches.push({ config, outputPath: request.outputPath });
    multiSeedActive += 1;
    multiSeedPeakActive = Math.max(multiSeedPeakActive, multiSeedActive);
    const baseRate = Number.parseFloat(config.get('CENTRAL_BANK_INITIAL_BASE_RATE') ?? '0');
    const seed = Number.parseInt(config.get('SEED') ?? '0', 10);
    writeSensitivityCoreOutputs(request.outputPath, baseRate + seed * 0.00001);
    const process = new FakeModelProcess();
    setTimeout(() => {
      multiSeedActive -= 1;
      process.succeed();
    }, 0);
    return process;
  });
  const multiSeedSubmit = submitSensitivityExperiment(
    sensitivityFixtureRoot,
    {
      baseline: 'v1.0',
      basePolicy: '2011',
      title: 'multi-seed-workers',
      parameterKey: 'CENTRAL_BANK_INITIAL_BASE_RATE',
      min: 0.004,
      max: 0.006,
      overrides: { N_SIMS: 3, TARGET_POPULATION: 12_000 },
      maxWorkers: 2,
      confirmWarnings: true
    },
    { launcher: multiSeedLauncher }
  );
  assert.equal(multiSeedSubmit.accepted, true, 'Expected multi-seed sensitivity submit to be accepted');
  const multiSeedExperimentId = multiSeedSubmit.experiment?.experimentId ?? '';
  await waitUntil(() => {
    const detail = getSensitivityExperiment(sensitivityFixtureRoot, multiSeedExperimentId).experiment;
    return detail.status === 'succeeded';
  });
  assert.equal(multiSeedLaunches.length, 15, 'Expected five sampled points times three seeds');
  assert.ok(multiSeedPeakActive <= 2, 'Expected maxWorkers to cap concurrent sensitivity child runs');
  assert.deepEqual(
    [...new Set(multiSeedLaunches.map((launch) => Number.parseInt(launch.config.get('SEED') ?? '0', 10)))].sort(),
    [1, 2, 3],
    'Expected sensitivity seeds to expand from fixed starting seed 1'
  );
  assert.ok(
    multiSeedLaunches.every((launch) => launch.config.get('N_SIMS') === '1'),
    'Expected each independent seed child config to force N_SIMS=1'
  );
  const multiSeedDetail = getSensitivityExperiment(sensitivityFixtureRoot, multiSeedExperimentId).experiment;
  assert.equal(multiSeedDetail.seedsPerPoint, 3, 'Expected metadata to record requested seeds per point');
  assert.deepEqual(multiSeedDetail.seeds, [1, 2, 3], 'Expected metadata to record expanded seeds');
  assert.equal(multiSeedDetail.maxWorkers, 2, 'Expected metadata to record effective max workers');
  assert.equal(multiSeedDetail.generalOverrides?.N_SIMS, 3, 'Expected metadata to retain user seed-count override');
  const multiSeedResults = getSensitivityExperimentResults(sensitivityFixtureRoot, multiSeedExperimentId);
  assert.ok(
    multiSeedResults.points.every((point) => point.seedResults?.length === 3),
    'Expected per-point results to retain per-seed run metadata'
  );
  for (const point of multiSeedResults.points) {
    const aggregatedMetric = point.indicatorMetrics.find((metric) => metric.indicatorId === 'core_interestRateSpread');
    if (!aggregatedMetric) {
      throw new Error(`Expected aggregated interest-rate spread metric for ${point.pointId}`);
    }
    const seedMetrics = (point.seedResults ?? []).map((seedResult) => {
      const seedMetric = seedResult.indicatorMetrics.find((metric) => metric.indicatorId === 'core_interestRateSpread');
      if (!seedMetric) {
        throw new Error(`Expected seed interest-rate spread metric for ${point.pointId} seed ${seedResult.seed}`);
      }
      return seedMetric;
    });
    assert.equal(seedMetrics.length, 3, `Expected three seed metrics for ${point.pointId}`);
    assert.ok(
      point.seedResults?.every((seedResult) => seedResult.outputPath === null),
      `Expected summary-only seed metadata for ${point.pointId}`
    );
    for (const key of ['mean', 'cv', 'range'] as const) {
      const values = seedMetrics
        .map((metric) => metric.kpi[key])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const observed = aggregatedMetric.kpi[key];
      if (observed === null) {
        throw new Error(`Expected aggregated ${key} KPI for ${point.pointId}`);
      }
      assertClose(
        observed,
        sum(values) / values.length,
        1e-12,
        `Expected ${key} KPI for ${point.pointId} to average across successful seeds`
      );
    }
  }
  const multiSeedManifest = JSON.parse(
    fs.readFileSync(
      path.join(
        sensitivityFixtureRoot,
        'Results',
        'experiments',
        'sensitivity',
        multiSeedExperimentId,
        RUN_MANIFEST_FILE_NAME
      ),
      'utf-8'
    )
  ) as SensitivityRunManifest;
  assert.equal(multiSeedManifest.experiment.points.length, 15, 'Expected manifest to include every point/seed child run');
  assert.deepEqual(multiSeedManifest.experiment.seeds, [1, 2, 3], 'Expected manifest to persist expanded seeds');

  const duplicateSubmit = submitSensitivityExperiment(sensitivityFixtureRoot, {
    baseline: 'v1.0',
    parameterKey: 'CENTRAL_BANK_LTI_MONTHS_TO_CHECK',
    min: 11.6,
    max: 12.4,
    confirmWarnings: true
  });
  assert.equal(duplicateSubmit.accepted, true, 'Expected integer duplicate-range sweep to be accepted');
  const duplicateExperimentId = duplicateSubmit.experiment?.experimentId ?? '';
  await waitUntil(() => {
    const detail = getSensitivityExperiment(sensitivityFixtureRoot, duplicateExperimentId).experiment;
    return detail.status === 'succeeded';
  });
  const duplicateDetail = getSensitivityExperiment(sensitivityFixtureRoot, duplicateExperimentId).experiment;
  assert.equal(duplicateDetail.sampledPoints.length, 1, 'Expected rounded duplicate points to collapse into one sample');
  assert.equal(
    duplicateDetail.collapsedSlots.min,
    duplicateDetail.collapsedSlots.max,
    'Expected collapsed slot mapping to point at a single sampled point'
  );

  const pairedPackageConfigs: Array<Map<string, string>> = [];
  const pairedPackageLauncher = createFakeLauncher('packaged', (request) => {
    const config = parseConfigFile(request.configPath);
    pairedPackageConfigs.push(config);
    const softMaxFtb = Number.parseFloat(config.get('CENTRAL_BANK_LTI_SOFT_MAX_FTB') ?? '0');
    writeSensitivityCoreOutputs(request.outputPath, softMaxFtb);
    const process = new FakeModelProcess();
    setTimeout(() => {
      process.succeed();
    }, 0);
    return process;
  });
  const pairedPackageSubmit = submitSensitivityExperiment(
    sensitivityFixtureRoot,
    {
      baseline: 'v1.0',
      basePolicy: '2011',
      policyPackageId: 'owner_occupier_lti_soft_max',
      min: 5,
      max: 5.8,
      sampleCount: 2,
      overrides: { N_SIMS: 1 },
      confirmWarnings: true
    },
    { launcher: pairedPackageLauncher }
  );
  assert.equal(pairedPackageSubmit.accepted, true, 'Expected paired soft-LTI package sweep to be accepted');
  const pairedPackageExperimentId = pairedPackageSubmit.experiment?.experimentId ?? '';
  await waitUntil(() => {
    const detail = getSensitivityExperiment(sensitivityFixtureRoot, pairedPackageExperimentId).experiment;
    return detail.status === 'succeeded';
  });
  const pairedPackageDetail = getSensitivityExperiment(sensitivityFixtureRoot, pairedPackageExperimentId).experiment;
  assert.equal(pairedPackageDetail.parameter.key, 'owner_occupier_lti_soft_max', 'Expected package id in metadata key');
  assert.equal(
    pairedPackageDetail.parameter.baselineValue,
    null,
    'Expected paired package baseline scalar to be null when true base values differ'
  );
  assert.deepEqual(
    pairedPackageDetail.parameter.parameterKeys,
    ['CENTRAL_BANK_LTI_SOFT_MAX_FTB', 'CENTRAL_BANK_LTI_SOFT_MAX_HM'],
    'Expected paired package metadata to include both policy keys'
  );
  assert.deepEqual(
    pairedPackageDetail.parameter.baselineValuesByKey,
    {
      CENTRAL_BANK_LTI_SOFT_MAX_FTB: 5.4,
      CENTRAL_BANK_LTI_SOFT_MAX_HM: 5.6
    },
    'Expected paired package baseline to preserve key-specific 2011 values'
  );
  const pairedBaselinePoint = pairedPackageDetail.sampledPoints.find((point) => point.isBaseline);
  assert.equal(pairedBaselinePoint?.value, null, 'Expected paired baseline point scalar value to be null');
  assert.deepEqual(
    pairedBaselinePoint?.valuesByKey,
    {
      CENTRAL_BANK_LTI_SOFT_MAX_FTB: 5.4,
      CENTRAL_BANK_LTI_SOFT_MAX_HM: 5.6
    },
    'Expected paired baseline point to keep true key-specific values'
  );
  assert.ok(
    pairedPackageConfigs.some(
      (config) =>
        config.get('CENTRAL_BANK_LTI_SOFT_MAX_FTB') === '5.4' &&
        config.get('CENTRAL_BANK_LTI_SOFT_MAX_HM') === '5.6'
    ),
    'Expected paired baseline child config to keep distinct base values'
  );
  assert.deepEqual(
    pairedPackageConfigs
      .filter((config) => config.get('CENTRAL_BANK_LTI_SOFT_MAX_FTB') === config.get('CENTRAL_BANK_LTI_SOFT_MAX_HM'))
      .map((config) => config.get('CENTRAL_BANK_LTI_SOFT_MAX_FTB'))
      .sort(),
    ['5', '5.8'],
    'Expected paired sampled points to apply the shared sampled value to both keys'
  );

  assert.throws(
    () =>
      submitSensitivityExperiment(sensitivityFixtureRoot, {
        baseline: 'v1.0',
        parameterKey: 'TARGET_POPULATION',
        min: 0,
        max: 20_000,
        confirmWarnings: true
      }),
    /Unsupported sensitivity parameter|Central Bank policy/,
    'Expected non-policy sensitivity parameter to be rejected'
  );

  assert.throws(
    () =>
      submitSensitivityExperiment(sensitivityFixtureRoot, {
        baseline: 'v1.0',
        basePolicy: '2011',
        parameterKey: 'CENTRAL_BANK_INITIAL_BASE_RATE',
        min: 0.004,
        max: 0.006,
        overrides: { SEED: 5 },
        confirmWarnings: true
      }),
    /SEED is fixed/,
    'Expected sensitivity override payload to reject user-provided seeds'
  );

  assert.throws(
    () =>
      submitSensitivityExperiment(sensitivityFixtureRoot, {
        baseline: 'v1.0',
        parameterKey: 'CENTRAL_BANK_INITIAL_BASE_RATE',
        min: 0.006,
        max: 0.007,
        confirmWarnings: true
      }),
    /must be within/,
    'Expected sensitivity range to require baseline inclusion'
  );

  __resetSensitivityRunsForTests();
  __setSensitivityRunSpawnForTests((_repoRoot, configPath, outputPath) => {
    const config = parseConfigFile(configPath);
    const baseRate = Number.parseFloat(config.get('CENTRAL_BANK_INITIAL_BASE_RATE') ?? '0');
    writeSensitivityCoreOutputs(outputPath, baseRate);
    const process = new FakeModelProcess();
    sensitivityProcesses.push(process);
    return process as never;
  });

  const cancelSubmit = submitSensitivityExperiment(sensitivityFixtureRoot, {
    baseline: 'v1.0',
    basePolicy: '2011',
    parameterKey: 'CENTRAL_BANK_INITIAL_BASE_RATE',
    min: 0.004,
    max: 0.006,
    confirmWarnings: true
  });
  assert.equal(cancelSubmit.accepted, true, 'Expected cancel target sensitivity submit to be accepted');
  const cancelExperimentId = cancelSubmit.experiment?.experimentId ?? '';
  await waitUntil(() => sensitivityProcesses.length > 0);
  assert.throws(
    () => deleteSensitivityExperiment(sensitivityFixtureRoot, cancelExperimentId),
    /Only finished sensitivity experiments can be deleted/,
    'Expected active sensitivity experiments to be protected from deletion'
  );
  assert.throws(
    () => deleteExperimentJob(sensitivityFixtureRoot, `sensitivity:${cancelExperimentId}`),
    /Only finished sensitivity experiment jobs can be deleted/,
    'Expected active sensitivity experiments to be protected from unified queue deletion'
  );
  cancelSensitivityExperiment(sensitivityFixtureRoot, cancelExperimentId);
  await waitUntil(() => {
    const detail = getSensitivityExperiment(sensitivityFixtureRoot, cancelExperimentId).experiment;
    return detail.status === 'canceled';
  });
  const canceledDetail = getSensitivityExperiment(sensitivityFixtureRoot, cancelExperimentId).experiment;
  assert.equal(canceledDetail.status, 'canceled', 'Expected canceled sensitivity experiment status');

  __resetModelRunManagerForTests();
  __setModelRunSpawnForTests(() => {
    const process = new FakeModelProcess();
    return process as never;
  });
  const lockedManualSubmit = submitModelRun(sensitivityFixtureRoot, {
    baseline: 'v1.0',
    title: 'manual-lock',
    overrides: {},
    confirmWarnings: true
  });
  assert.equal(lockedManualSubmit.accepted, true, 'Expected manual queue submit to seed unified job lock test');
  const lockedManualJobId = lockedManualSubmit.job?.jobId ?? '';
  const unifiedJobs = listExperimentJobs(sensitivityFixtureRoot);
  assert.ok(
    unifiedJobs.jobs.some((job) => job.jobRef === `manual:${lockedManualJobId}`),
    'Expected unified job list to include manual job entry'
  );
  assert.ok(
    unifiedJobs.jobs.some((job) => job.jobRef === `sensitivity:${successExperimentId}`),
    'Expected unified job list to include sensitivity job entry'
  );
  assert.equal(
    unifiedJobs.locks.sensitivitySubmissionLocked,
    true,
    'Expected unified locks to block sensitivity submission when manual queue is active'
  );
  const unifiedSensitivityLogs = getExperimentJobLogs(
    sensitivityFixtureRoot,
    `sensitivity:${cancelExperimentId}`,
    0,
    200
  );
  assert.ok(unifiedSensitivityLogs.lines.length > 0, 'Expected unified logs endpoint to return sensitivity logs');
  assert.throws(
    () =>
      submitSensitivityExperiment(sensitivityFixtureRoot, {
        baseline: 'v1.0',
        parameterKey: 'CENTRAL_BANK_INITIAL_BASE_RATE',
        min: 0.004,
        max: 0.006,
        confirmWarnings: true
      }),
    /manual model runs are queued or running/,
    'Expected sensitivity submission to be blocked while manual run queue is active'
  );
  cancelExperimentJob(sensitivityFixtureRoot, `manual:${lockedManualJobId}`);
  await waitUntil(() => {
    const job = listExperimentJobs(sensitivityFixtureRoot).jobs.find((item) => item.jobRef === `manual:${lockedManualJobId}`);
    return job?.status === 'canceled';
  });
  const deletedCanceledSensitivityJob = deleteExperimentJob(sensitivityFixtureRoot, `sensitivity:${cancelExperimentId}`);
  assert.equal(deletedCanceledSensitivityJob.deleted, true, 'Expected unified queue delete to remove canceled sensitivity jobs');
  assert.ok(
    !listExperimentJobs(sensitivityFixtureRoot).jobs.some((job) => job.jobRef === `sensitivity:${cancelExperimentId}`),
    'Expected deleted sensitivity queue job to be removed from unified history'
  );
  assert.ok(
    !fs.existsSync(path.join(sensitivityFixtureRoot, 'Results', 'experiments', 'sensitivity', cancelExperimentId)),
    'Expected unified sensitivity queue delete to remove artifacts'
  );

  __resetModelRunManagerForTests();
  __resetSensitivityRunsForTests();
  const experimentsAfterReload = listSensitivityExperiments(sensitivityFixtureRoot).experiments;
  assert.ok(
    experimentsAfterReload.some((experiment) => experiment.experimentId === successExperimentId),
    'Expected persisted completed sensitivity experiment to reload from disk'
  );
  const deletedSensitivityExperiment = deleteSensitivityExperiment(sensitivityFixtureRoot, duplicateExperimentId);
  assert.equal(deletedSensitivityExperiment.deleted, true, 'Expected sensitivity delete API to report success');
  assert.equal(
    deletedSensitivityExperiment.experimentId,
    duplicateExperimentId,
    'Expected sensitivity delete payload to return the deleted experiment id'
  );
  assert.ok(
    !listSensitivityExperiments(sensitivityFixtureRoot).experiments.some(
      (experiment) => experiment.experimentId === duplicateExperimentId
    ),
    'Expected deleted sensitivity experiment to be removed from experiment history'
  );
  assert.ok(
    !fs.existsSync(path.join(sensitivityFixtureRoot, 'Results', 'experiments', 'sensitivity', duplicateExperimentId)),
    'Expected deleted sensitivity experiment artifacts to be removed from Results'
  );
  assert.throws(
    () => getSensitivityExperiment(sensitivityFixtureRoot, duplicateExperimentId),
    /Unknown sensitivity experiment/,
    'Expected deleted sensitivity experiment detail to be unavailable'
  );
  assert.throws(
    () => getSensitivityExperimentResults(sensitivityFixtureRoot, duplicateExperimentId),
    /Unknown sensitivity experiment/,
    'Expected deleted sensitivity experiment results to be unavailable'
  );
  assert.throws(
    () => getSensitivityExperimentCharts(sensitivityFixtureRoot, duplicateExperimentId),
    /Unknown sensitivity experiment/,
    'Expected deleted sensitivity experiment charts to be unavailable'
  );
  assert.throws(
    () => deleteSensitivityExperiment(sensitivityFixtureRoot, 'missing-sensitivity-experiment'),
    /Unknown sensitivity experiment/,
    'Expected deleting an unknown sensitivity experiment to fail'
  );

  const legacyExperimentId = 'sensitivity-legacy-schema-fixture';
  const legacyRoot = path.join(
    sensitivityFixtureRoot,
    'Results',
    'experiments',
    'sensitivity',
    legacyExperimentId
  );
  fs.mkdirSync(legacyRoot, { recursive: true });
  fs.writeFileSync(
    path.join(legacyRoot, 'metadata.json'),
    JSON.stringify(
      {
        experimentId: legacyExperimentId,
        baseline: 'v1.0',
        status: 'succeeded',
        createdAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        retainFullOutput: false,
        parameter: {
          key: 'CENTRAL_BANK_INITIAL_BASE_RATE',
          title: 'Initial base rate',
          description: 'fixture',
          type: 'number',
          baselineValue: 0.005,
          min: 0.004,
          max: 0.006
        },
        warnings: [],
        warningSummary: { byPoint: {} },
        sampledPoints: [
          { pointId: 'point-0.005', value: 0.005, label: '0.005', slotLabels: ['baseline'], isBaseline: true }
        ],
        collapsedSlots: {
          min: 'point-0.005',
          mid_lower: 'point-0.005',
          baseline: 'point-0.005',
          mid_upper: 'point-0.005',
          max: 'point-0.005'
        },
        runCommand: {
          mavenBin: 'mvn',
          commandTemplate: 'fixture'
        }
      },
      null,
      2
    ),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(legacyRoot, 'summary.json'),
    JSON.stringify(
      {
        results: {
          experimentId: legacyExperimentId,
          baselinePointId: 'point-0.005',
          points: [
            {
              pointId: 'point-0.005',
              value: 0.005,
              label: '0.005',
              slotLabels: ['baseline'],
              isBaseline: true,
              status: 'succeeded',
              runId: 'legacy-run',
              outputPath: null,
              indicatorMetrics: [
                {
                  indicatorId: 'core_ooLTV',
                  title: 'Owner-Occupier LTV (Mean Above Median)',
                  units: '%',
                  tail120Mean: 1.23,
                  deltaFromBaseline: 0
                }
              ]
            }
          ]
        },
        charts: {
          experimentId: legacyExperimentId,
          parameter: {
            key: 'CENTRAL_BANK_INITIAL_BASE_RATE',
            title: 'Initial base rate',
            description: 'fixture',
            type: 'number',
            baselineValue: 0.005,
            min: 0.004,
            max: 0.006
          },
          tornado: [
            {
              indicatorId: 'core_ooLTV',
              title: 'Owner-Occupier LTV (Mean Above Median)',
              units: '%',
              maxAbsDelta: 0
            }
          ],
          deltaTrend: [
            {
              indicatorId: 'core_ooLTV',
              title: 'Owner-Occupier LTV (Mean Above Median)',
              units: '%',
              points: [{ parameterValue: 0.005, delta: 0 }]
            }
          ]
        }
      },
      null,
      2
    ),
    'utf-8'
  );

  __resetSensitivityRunsForTests();
  const legacyResults = getSensitivityExperimentResults(sensitivityFixtureRoot, legacyExperimentId);
  const legacyMetric = legacyResults.points[0]?.indicatorMetrics[0];
  assert.equal(legacyMetric?.kpi.mean, 1.23, 'Expected legacy mean metric to migrate into KPI mean');
  assert.equal(legacyMetric?.kpi.cv, null, 'Expected legacy summary migration to default unsupported KPI keys to null');
  const legacyCharts = getSensitivityExperimentCharts(sensitivityFixtureRoot, legacyExperimentId);
  assert.equal(
    Object.prototype.hasOwnProperty.call(legacyCharts.tornado[0] ?? {}, 'maxAbsDeltaByKpi'),
    true,
    'Expected legacy tornado payload to migrate to KPI-keyed shape on read'
  );

  const interruptedExperimentId = 'sensitivity-interrupted-fixture';
  const interruptedRoot = path.join(
    sensitivityFixtureRoot,
    'Results',
    'experiments',
    'sensitivity',
    interruptedExperimentId
  );
  fs.mkdirSync(interruptedRoot, { recursive: true });
  fs.writeFileSync(
    path.join(interruptedRoot, 'metadata.json'),
    JSON.stringify(
      {
        experimentId: interruptedExperimentId,
        baseline: 'v1.0',
        status: 'running',
        createdAt: new Date().toISOString(),
        retainFullOutput: false,
        parameter: {
          key: 'CENTRAL_BANK_INITIAL_BASE_RATE',
          title: 'Initial base rate',
          description: 'fixture',
          type: 'number',
          baselineValue: 0.005,
          min: 0.004,
          max: 0.006
        },
        warnings: [],
        warningSummary: { byPoint: {} },
        sampledPoints: [],
        collapsedSlots: {
          min: 'point-0',
          mid_lower: 'point-0',
          baseline: 'point-0',
          mid_upper: 'point-0',
          max: 'point-0'
        },
        runCommand: {
          mavenBin: 'mvn',
          commandTemplate: 'fixture'
        }
      },
      null,
      2
    ),
    'utf-8'
  );

  __resetSensitivityRunsForTests();
  const restartedDetail = getSensitivityExperiment(sensitivityFixtureRoot, interruptedExperimentId).experiment;
  assert.equal(
    restartedDetail.status,
    'failed',
    'Expected non-terminal sensitivity experiment to be marked failed after restart reload'
  );
  assert.equal(
    restartedDetail.failureReason,
    'interrupted_on_restart',
    'Expected restart interruption failure reason to be persisted'
  );
} finally {
  __resetSensitivityRunsForTests();
  __resetModelRunManagerForTests();
  fs.rmSync(sensitivityFixtureRoot, { recursive: true, force: true });
}

const writeAuthDisabled = createWriteAuthController(undefined, undefined);
const disabledStatus = writeAuthDisabled.resolveAccess(undefined);
assert.equal(disabledStatus.authEnabled, false, 'Expected auth to be disabled when credentials are unset');
assert.equal(disabledStatus.canWrite, true, 'Expected local write access when auth is disabled');

const misconfiguredAuthStatus = resolveDashboardWriteAccess(writeAuthDisabled, undefined, true);
assert.equal(
  misconfiguredAuthStatus.authEnabled,
  true,
  'Expected model-runs-enabled auth misconfiguration to report auth-enabled read-only mode'
);
assert.equal(
  misconfiguredAuthStatus.canWrite,
  false,
  'Expected model-runs-enabled auth misconfiguration to block write access'
);
assert.equal(
  misconfiguredAuthStatus.authMisconfigured,
  true,
  'Expected auth misconfiguration status to be surfaced for UI and API handling'
);
const misconfiguredLoginError = getWriteAuthConfigurationError(writeAuthDisabled, true);
assert.ok(
  misconfiguredLoginError?.includes('DASHBOARD_WRITE_USERNAME'),
  'Expected auth misconfiguration to surface actionable login-blocking configuration error'
);
const devBypassAuthStatus = resolveDashboardWriteAccess(writeAuthDisabled, undefined, true, true);
assert.equal(devBypassAuthStatus.authEnabled, false, 'Expected dev bypass mode to disable auth lockout presentation');
assert.equal(devBypassAuthStatus.canWrite, true, 'Expected dev bypass mode to grant write access');
assert.equal(devBypassAuthStatus.authMisconfigured, false, 'Expected dev bypass mode to clear misconfiguration state');
assert.equal(
  getWriteAuthConfigurationError(writeAuthDisabled, true, true),
  null,
  'Expected dev bypass mode to suppress write-auth misconfiguration errors'
);

const writeAuthEnabled = createWriteAuthController('writer', 'secret');
const enabledStatusWithoutToken = writeAuthEnabled.resolveAccess(undefined);
assert.equal(enabledStatusWithoutToken.authEnabled, true, 'Expected auth to be enabled when credentials are configured');
assert.equal(enabledStatusWithoutToken.canWrite, false, 'Expected write access to require login in auth-enabled mode');

const badLogin = writeAuthEnabled.login('writer', 'incorrect');
assert.equal(badLogin.ok, false, 'Expected login to fail for invalid credentials');

const goodLogin = writeAuthEnabled.login('writer', 'secret');
assert.equal(goodLogin.ok, true, 'Expected login to succeed for valid credentials');
assert.ok(goodLogin.token, 'Expected successful login to issue a token');

const enabledStatusWithToken = writeAuthEnabled.resolveAccess(`Bearer ${goodLogin.token}`);
assert.equal(enabledStatusWithToken.canWrite, true, 'Expected bearer token to grant write access');
writeAuthEnabled.logout(goodLogin.token ?? null);
const afterLogoutStatus = writeAuthEnabled.resolveAccess(`Bearer ${goodLogin.token}`);
assert.equal(afterLogoutStatus.canWrite, false, 'Expected logout to revoke write access token');

const deleteKeyDisabled = createDeleteKeyAuthController(undefined);
assert.equal(deleteKeyDisabled.configured, false, 'Expected delete key auth to be disabled when key is unset');
assert.equal(deleteKeyDisabled.resolveAccess('delete-secret').canDelete, false, 'Expected unset delete key auth to reject deletes');
const deleteKeyEnabled = createDeleteKeyAuthController('delete-secret');
assert.equal(deleteKeyEnabled.configured, true, 'Expected delete key auth to report configured state');
assert.equal(deleteKeyEnabled.resolveAccess(undefined).canDelete, false, 'Expected missing delete key header to be rejected');
assert.equal(deleteKeyEnabled.resolveAccess('wrong-secret').canDelete, false, 'Expected incorrect delete key to be rejected');
assert.equal(deleteKeyEnabled.resolveAccess('delete-secret').canDelete, true, 'Expected matching delete key to authorize deletes');

assert.throws(
  () => createDesktopWriteAuthController('   '),
  /Desktop write auth token/,
  'Expected desktop auth to fail closed when the startup token is empty'
);
const desktopWriteAuth = createDesktopWriteAuthController('desktop-session-token');
assert.equal(desktopWriteAuth.login('writer', 'secret').ok, false, 'Expected desktop auth not to accept static credentials');
assert.equal(desktopWriteAuth.resolveAccess(undefined).canWrite, false, 'Expected desktop auth to reject missing bearer token');
assert.equal(
  desktopWriteAuth.resolveAccess('Bearer wrong-token').canWrite,
  false,
  'Expected desktop auth to reject the wrong bearer token'
);
assert.equal(
  desktopWriteAuth.resolveAccess('Bearer desktop-session-token').canWrite,
  true,
  'Expected desktop auth to accept the configured bearer token'
);

const sinkedLogLines: string[] = [];
const sinkedLogBuffer: LogBufferState = {
  logLines: [],
  logStart: 0,
  partialLine: '',
  sink: (line) => sinkedLogLines.push(line)
};
appendLogLine(sinkedLogBuffer, 'first persisted line', 1);
appendLogLine(sinkedLogBuffer, 'second persisted line', 1);
assert.deepEqual(sinkedLogBuffer.logLines, ['second persisted line'], 'Expected memory log buffer to keep its line cap');
assert.deepEqual(
  sinkedLogLines,
  ['first persisted line', 'second persisted line'],
  'Expected persistent sink to receive all appended lines despite memory truncation'
);

const rotationFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-log-rotation-'));
try {
  const rotatingWriter = createRotatingLogWriter(rotationFixtureRoot, 'app', { maxBytes: 120, maxFiles: 3 });
  for (let index = 0; index < 6; index += 1) {
    rotatingWriter.writeLine(`rotation-line-${index} ${'x'.repeat(60)}`);
  }
  const rotatedFiles = fs
    .readdirSync(rotationFixtureRoot)
    .filter((fileName) => fileName.startsWith('app.log'))
    .sort();
  assert.ok(rotatedFiles.length <= 3, 'Expected rotating writer to keep file count bounded');
  assert.ok(rotatedFiles.includes('app.log'), 'Expected rotating writer to keep an active log file');
  assert.ok(!rotatedFiles.includes('app.log.3'), 'Expected rotating writer to remove files beyond maxFiles');
  const combinedRotationText = rotatedFiles
    .map((fileName) => fs.readFileSync(path.join(rotationFixtureRoot, fileName), 'utf-8'))
    .join('\n');
  assert.ok(combinedRotationText.includes('rotation-line-5'), 'Expected newest rotated log line to be retained');
  assert.ok(!combinedRotationText.includes('rotation-line-0'), 'Expected oldest rotated log line to be removed');
} finally {
  fs.rmSync(rotationFixtureRoot, { recursive: true, force: true });
}

let lifecycleServer: Awaited<ReturnType<typeof startDashboardServer>> | null = null;
try {
  lifecycleServer = await startDashboardServer({
    dashboardRoot: path.join(repoRoot, 'dashboard'),
    repoRoot,
    runtimePaths: createDevelopmentRuntimePaths(repoRoot),
    host: '127.0.0.1',
    port: 0,
    modelRunsConfigured: false,
    isDevRuntime: false,
    staticServing: { enabled: false },
    logStartup: false
  });

  assert.ok(lifecycleServer.port > 0, 'Constructible server should report the actual random local port');
  assert.equal(lifecycleServer.host, '127.0.0.1', 'Constructible server should preserve the configured host');
  assert.equal(
    lifecycleServer.url,
    `http://127.0.0.1:${lifecycleServer.port}`,
    'Constructible server should expose a same-origin URL'
  );
  const healthResponse = await fetchText(`${lifecycleServer.url}/healthz`);
  assert.equal(healthResponse.status, 200, 'Constructible server should serve /healthz');
  assert.equal(healthResponse.text, '{"ok":true}', 'Constructible server should serve the public health payload');
} finally {
  if (lifecycleServer) {
    await lifecycleServer.shutdown();
    assert.equal(lifecycleServer.server.listening, false, 'Constructible shutdown handle should close the HTTP server');
  }
}

const desktopAuthFailureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-desktop-auth-failure-'));
try {
  const authFailureRuntimePaths = createDesktopRuntimePaths({
    appResourcesRoot: path.join(desktopAuthFailureRoot, 'resources'),
    electronUserDataRoot: path.join(desktopAuthFailureRoot, 'userData'),
    repoRoot
  });
  await assert.rejects(
    () =>
      startDashboardServer({
        dashboardRoot: path.join(repoRoot, 'dashboard'),
        repoRoot,
        runtimePaths: authFailureRuntimePaths,
        modelRunsConfigured: false,
        staticServing: { enabled: false },
        logStartup: false
      }),
    /Desktop write auth token/,
    'Expected desktop server startup to reject a missing per-session auth token before listening'
  );
  await assert.rejects(
    () =>
      startDashboardServer({
        dashboardRoot: path.join(repoRoot, 'dashboard'),
        repoRoot,
        runtimePaths: authFailureRuntimePaths,
        desktopAuthToken: '   ',
        modelRunsConfigured: false,
        staticServing: { enabled: false },
        logStartup: false
      }),
    /Desktop write auth token/,
    'Expected desktop server startup to reject an empty per-session auth token before listening'
  );
} finally {
  fs.rmSync(desktopAuthFailureRoot, { recursive: true, force: true });
}

const staticFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-static-fixture-'));
const desktopResourcesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-desktop-resources-'));
const desktopUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-desktop-user-data-'));
let staticServer: Awaited<ReturnType<typeof startDashboardServer>> | null = null;
try {
  fs.mkdirSync(path.join(staticFixtureRoot, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(staticFixtureRoot, 'index.html'),
    '<!doctype html><html><body><main id="root">Desktop fixture shell</main><script src="/assets/app.js"></script></body></html>',
    'utf-8'
  );
  fs.writeFileSync(path.join(staticFixtureRoot, 'assets', 'app.js'), 'window.__desktopFixture = true;', 'utf-8');

  staticServer = await startDashboardServer({
    dashboardRoot: path.join(repoRoot, 'dashboard'),
    repoRoot,
    runtimePaths: createDesktopRuntimePaths({
      appResourcesRoot: desktopResourcesRoot,
      electronUserDataRoot: desktopUserDataRoot,
      repoRoot
    }),
    desktopAuthToken: 'desktop-session-token',
    modelRunsConfigured: false,
    isDevRuntime: true,
    staticServing: {
      enabled: true,
      root: staticFixtureRoot
    }
  });
  assert.equal(staticServer.host, '127.0.0.1', 'Desktop server should default to loopback-only binding');
  assert.ok(staticServer.port > 0, 'Desktop server should default to a random available local port');

  const rootStaticResponse = await fetchText(`${staticServer.url}/`);
  assert.equal(rootStaticResponse.status, 200, 'Desktop static server should serve the built dashboard root');
  assert.ok(
    rootStaticResponse.text.includes('Desktop fixture shell'),
    'Desktop static server should return index.html for the root path'
  );

  const assetResponse = await fetchText(`${staticServer.url}/assets/app.js`);
  assert.equal(assetResponse.status, 200, 'Desktop static server should serve built asset paths');
  assert.ok(assetResponse.text.includes('__desktopFixture'), 'Desktop static server should serve asset contents');

  const spaFallbackResponse = await fetchText(`${staticServer.url}/experiments/manual/deep-link`, {
    headers: { Accept: 'text/html' }
  });
  assert.equal(spaFallbackResponse.status, 200, 'Desktop static server should support deep SPA links');
  assert.ok(
    spaFallbackResponse.text.includes('Desktop fixture shell'),
    'Desktop static server should fall back to index.html for non-API deep links'
  );

  const runtimeDepsResponse = await fetchText(`${staticServer.url}/api/runtime-deps`);
  assert.equal(runtimeDepsResponse.status, 200, 'Desktop static server should preserve API routes');
  assert.ok(
    runtimeDepsResponse.contentType.includes('application/json'),
    'Desktop API routes should remain JSON under same-origin static serving'
  );
  assert.ok(
    runtimeDepsResponse.text.includes('"mode":"desktop"'),
    'Desktop API routes should use the configured desktop runtime paths'
  );
  const appLogPath = path.join(desktopUserDataRoot, 'logs', 'app.log');
  const serverLogPath = path.join(desktopUserDataRoot, 'logs', 'server.log');
  assert.ok(fs.existsSync(appLogPath), 'Desktop server startup should create app.log under logsRoot');
  assert.ok(fs.existsSync(serverLogPath), 'Desktop server startup should create server.log under logsRoot');
  assert.ok(
    fs.readFileSync(appLogPath, 'utf-8').includes('dashboard server listening'),
    'Desktop app log should include lifecycle listening marker'
  );
  assert.ok(
    fs.readFileSync(serverLogPath, 'utf-8').includes('[runtime-paths] mode=desktop'),
    'Desktop server log should include startup runtime diagnostics'
  );

  const missingAuthStatusResponse = await fetchText(`${staticServer.url}/api/auth/status`);
  assert.equal(missingAuthStatusResponse.status, 200, 'Desktop auth status should remain a read-only API route');
  assert.equal(
    JSON.parse(missingAuthStatusResponse.text).canWrite,
    false,
    'Desktop auth status should reject missing bearer tokens even when isDevRuntime is true'
  );
  const wrongAuthStatusResponse = await fetchText(`${staticServer.url}/api/auth/status`, {
    headers: { Authorization: 'Bearer wrong-token' }
  });
  assert.equal(
    JSON.parse(wrongAuthStatusResponse.text).canWrite,
    false,
    'Desktop auth status should reject wrong bearer tokens'
  );
  const goodAuthStatusResponse = await fetchText(`${staticServer.url}/api/auth/status`, {
    headers: { Authorization: 'Bearer desktop-session-token' }
  });
  assert.equal(
    JSON.parse(goodAuthStatusResponse.text).canWrite,
    true,
    'Desktop auth status should accept the configured bearer token'
  );

  const missingProtectedWriteResponse = await fetchText(`${staticServer.url}/api/results/runs/not-found`, {
    method: 'DELETE'
  });
  assert.equal(missingProtectedWriteResponse.status, 403, 'Desktop write route should reject a missing bearer token');
  const wrongProtectedWriteResponse = await fetchText(`${staticServer.url}/api/results/runs/not-found`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer wrong-token' }
  });
  assert.equal(wrongProtectedWriteResponse.status, 403, 'Desktop write route should reject the wrong bearer token');
  const goodProtectedWriteResponse = await fetchText(`${staticServer.url}/api/results/runs/not-found`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer desktop-session-token' }
  });
  assert.notEqual(
    goodProtectedWriteResponse.status,
    403,
    'Desktop write route should reach route logic with the configured bearer token'
  );

  const missingApiResponse = await fetchText(`${staticServer.url}/api/not-a-static-route`, {
    headers: { Accept: 'text/html' }
  });
  assert.equal(missingApiResponse.status, 404, 'Unknown API routes should not be served by the SPA fallback');
  assert.ok(
    !missingApiResponse.text.includes('Desktop fixture shell'),
    'Unknown API routes should not fall through to index.html'
  );
} finally {
  if (staticServer) {
    await staticServer.shutdown();
  }
  fs.rmSync(staticFixtureRoot, { recursive: true, force: true });
  fs.rmSync(desktopResourcesRoot, { recursive: true, force: true });
  fs.rmSync(desktopUserDataRoot, { recursive: true, force: true });
}

const packagedRuntimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-packaged-runtime-policy-'));
const previousMavenBin = process.env.DASHBOARD_MAVEN_BIN;
let packagedPolicyServer: Awaited<ReturnType<typeof startDashboardServer>> | null = null;
try {
  const fakeJavaBin = path.join(packagedRuntimeRoot, process.platform === 'win32' ? 'java.cmd' : 'java');
  const fakeModelJar = path.join(packagedRuntimeRoot, 'housing-model-1.0-SNAPSHOT-windows-release.jar');
  fs.writeFileSync(
    fakeJavaBin,
    process.platform === 'win32'
      ? '@echo off\r\necho openjdk version "25.0.1" 1>&2\r\n'
      : '#!/usr/bin/env sh\necho "openjdk version \\"25.0.1\\"" >&2\n',
    'utf-8'
  );
  if (process.platform !== 'win32') {
    fs.chmodSync(fakeJavaBin, 0o755);
  }
  fs.writeFileSync(fakeModelJar, 'fake packaged model jar for runtime policy smoke test', 'utf-8');
  process.env.DASHBOARD_MAVEN_BIN = path.join(packagedRuntimeRoot, 'missing-mvn');

  packagedPolicyServer = await startDashboardServer({
    dashboardRoot: path.join(repoRoot, 'dashboard'),
    repoRoot,
    runtimePaths: createDesktopRuntimePaths({
      appResourcesRoot: path.join(packagedRuntimeRoot, 'resources'),
      electronUserDataRoot: path.join(packagedRuntimeRoot, 'userData'),
      repoRoot
    }),
    desktopAuthToken: 'desktop-session-token',
    launcher: createPackagedModelLauncher(fakeJavaBin, fakeModelJar),
    modelRunsConfigured: true,
    isDevRuntime: false,
    staticServing: { enabled: false },
    logStartup: false
  });

  const packagedAuthStatus = JSON.parse(
    (
      await fetchText(`${packagedPolicyServer.url}/api/auth/status`, {
        headers: { Authorization: 'Bearer desktop-session-token' }
      })
    ).text
  ) as { modelRunsEnabled: boolean; canWrite: boolean };
  assert.equal(
    packagedAuthStatus.modelRunsEnabled,
    true,
    'Packaged desktop launcher should enable model runs without requiring Maven'
  );
  assert.equal(packagedAuthStatus.canWrite, true, 'Packaged desktop auth should accept the Electron session token');

  const packagedRuntimeDeps = JSON.parse((await fetchText(`${packagedPolicyServer.url}/api/runtime-deps`)).text) as {
    maven: boolean;
    modelRunsEnabled: boolean;
  };
  assert.equal(packagedRuntimeDeps.maven, false, 'Packaged runtime policy smoke fixture should simulate missing Maven');
  assert.equal(
    packagedRuntimeDeps.modelRunsEnabled,
    true,
    'Runtime diagnostics should report packaged model runs enabled when Java and the model jar are available'
  );
} finally {
  if (packagedPolicyServer) {
    await packagedPolicyServer.shutdown();
  }
  if (previousMavenBin === undefined) {
    delete process.env.DASHBOARD_MAVEN_BIN;
  } else {
    process.env.DASHBOARD_MAVEN_BIN = previousMavenBin;
  }
  fs.rmSync(packagedRuntimeRoot, { recursive: true, force: true });
}

const compareCardSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/src/components/CompareCard.tsx'), 'utf-8');
assert.ok(
  !compareCardSource.includes('Validation dataset'),
  'Compare card should not render Validation dataset field'
);

const manualResultsViewSource = fs.readFileSync(
  path.resolve(repoRoot, 'dashboard/src/pages/experiments/view/ManualResultsView.tsx'),
  'utf-8'
);
assert.ok(
  manualResultsViewSource.includes("dotted lines show each selected run&apos;s mean over the"),
  'Manual results overlay help copy should explain the dotted mean reference lines'
);
assert.ok(
  manualResultsViewSource.includes('window.confirm') &&
    manualResultsViewSource.includes('window.prompt') &&
    manualResultsViewSource.includes('deleteResultsRun(runId, deleteKey'),
  'Manual results deletion should confirm and prompt for remote delete key before calling the delete API'
);

const sensitivityResultsViewSource = fs.readFileSync(
  path.resolve(repoRoot, 'dashboard/src/pages/experiments/view/SensitivityResultsView.tsx'),
  'utf-8'
);
assert.ok(
  sensitivityResultsViewSource.includes('window.confirm') &&
    sensitivityResultsViewSource.includes('window.prompt') &&
    sensitivityResultsViewSource.includes('deleteSensitivityExperiment'),
  'Sensitivity results deletion should confirm and prompt for remote delete key before calling the delete API'
);

const experimentQueueCardSource = fs.readFileSync(
  path.resolve(repoRoot, 'dashboard/src/pages/run-experiments/ExperimentQueueCard.tsx'),
  'utf-8'
);
assert.ok(
  experimentQueueCardSource.includes('onDeleteJob') &&
    experimentQueueCardSource.includes('danger-button') &&
    experimentQueueCardSource.includes('isFinishedStatus(job.status)'),
  'Experiment queue should render delete actions only for finished jobs'
);
assert.ok(
  experimentQueueCardSource.includes('className="summary-link-inline summary-button-inline queue-download-button"'),
  'Experiment queue download button should use the same inline summary styling as result links'
);

const experimentRunModeSource = fs.readFileSync(
  path.resolve(repoRoot, 'dashboard/src/pages/experiments/run/ExperimentRunMode.tsx'),
  'utf-8'
);
assert.ok(
  experimentRunModeSource.includes('window.prompt') &&
    experimentRunModeSource.includes('deleteExperimentJob(job.jobRef, deleteKey'),
  'Experiment queue deletion should prompt for the remote delete key per delete'
);

const appSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/src/App.tsx'), 'utf-8');
assert.ok(
  appSource.includes('const experimentsVisible = true;'),
  'App should expose experiments in dev, production, and preview views'
);
assert.ok(
  appSource.includes("from './pages/ValidationPage'"),
  'App should import the validation page when dev-only validation is available'
);
assert.ok(
  appSource.includes('const validationVisible = true;'),
  'App should expose validation as a main page in the four-page structure'
);
assert.ok(
  appSource.includes('VIEW_MODE_OPTIONS') &&
    appSource.includes('Preview desktop') &&
    appSource.includes('Preview cloud') &&
    appSource.includes('dashboard.viewMode'),
  'App should expose a persisted dev-only runtime view selector'
);
assert.ok(
  appSource.includes('<NavLink to="/calibration">Calibration</NavLink>'),
  'App should label the calibration route as Calibration in the header'
);
assert.ok(
  appSource.includes('{validationVisible && <NavLink to="/validation">Validation</NavLink>}'),
  'App should only render the validation nav item when validation is visible'
);
assert.ok(
  appSource.includes('{validationVisible && <Route path="/validation" element={<ValidationPage />} />}'),
  'App should only register the validation route when validation is visible'
);
assert.ok(
  appSource.includes("{experimentsVisible && <NavLink to=\"/results?type=manual&mode=view\">Results</NavLink>}"),
  'App should label the experiments workspace as the Results tab in the header'
);
assert.ok(
  appSource.includes("{experimentsVisible && (\n              <Route\n                path=\"/results\""),
  'App should register the experiments route from the always-enabled experiments visibility flag'
);
assert.ok(
  appSource.includes('await desktopApi.getApiAuthToken()') &&
    appSource.includes('setApiAuthToken(token)') &&
    appSource.includes('void refreshAuthStatus();'),
  'App should initialise the Electron-provided auth token before refreshing auth status'
);
assert.ok(
  appSource.includes('desktopApi.openResultsFolder') &&
    appSource.includes('desktopApi.openLogsFolder') &&
    appSource.includes('desktopApiInput.exportSupportBundle') &&
    appSource.includes('Support Bundle'),
  'App should expose desktop results, logs, and support-bundle actions when Electron preload is available'
);
assert.ok(
  appSource.includes("const browserAuthControlsVisible = !isDesktopRuntime && viewMode !== 'preview_desktop';") &&
    appSource.includes('browserAuthControlsVisible && authStatus.authEnabled'),
  'Desktop mode and desktop preview should not render browser login/logout controls'
);

const validationPageSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/src/pages/ValidationPage.tsx'), 'utf-8');
const eChartSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/src/components/EChart.tsx'), 'utf-8');
const publicRoutesSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/server/routes/publicRoutes.ts'), 'utf-8');
const serviceSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/server/lib/service.ts'), 'utf-8');
const apiSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/src/lib/api.ts'), 'utf-8');
const validationVersionSelectorIndex = validationPageSource.indexOf('<span>Version</span>');
const validationYearSelectorIndex = validationPageSource.indexOf('<span>Validation Year</span>');
assert.ok(
  !validationPageSource.includes('three_lines'),
  'Validation page should no longer support the three-line mode'
);
assert.ok(
  validationPageSource.includes('validation-mode-row') &&
    validationVersionSelectorIndex >= 0 &&
    validationYearSelectorIndex > validationVersionSelectorIndex,
  'Validation page should render Version as the leftmost selector before Validation Year'
);
assert.ok(
  !validationPageSource.includes('Summary view') && !validationPageSource.includes('reference_2011'),
  'Validation page should remove the old tracked/reference summary view toggle'
);
assert.ok(
  validationPageSource.includes('Validation Loss Across Versions'),
  'Validation page should render the plain-English validation trend heading'
);
assert.ok(
  validationPageSource.includes('tracked 2024 timeline') &&
    validationPageSource.includes('historical <code>v0o2</code> and optimised TuRBO <code>v0o7</code>') &&
    validationPageSource.includes('Other pre-<code>v1.0</code>') &&
    validationPageSource.includes('selected version'),
  'Validation page should explain that validation only promotes v0, selected v0-family branches, and v1.0+ versions'
);
assert.ok(
  validationPageSource.includes('core_hpiStd') &&
    validationPageSource.includes('core_hpiCyclePeriod') &&
    validationPageSource.includes('2011-anchored'),
  'Validation page should explain the 2011 HPI benchmark split between core_hpiStd and core_hpiCyclePeriod'
);
assert.ok(
  !validationPageSource.includes('Validation Categories'),
  'Validation page should remove the validation categories section'
);
assert.ok(
  validationPageSource.includes('<h3>Validation Results by Metric</h3>') &&
    !validationPageSource.includes('Validation Results by Metric for'),
  'Validation page should render the renamed metric results section'
);
assert.ok(
  validationPageSource.includes('selectedValidationTargetYear'),
  'Validation page should render the selected validation target year in the metric results copy'
);
assert.ok(
  validationPageSource.includes('family-aware distance') &&
    validationPageSource.includes('log-ratio for positive levels') &&
    validationPageSource.includes('bounded-domain-normalized percentage-point distance for tenure shares') &&
    validationPageSource.includes('bounded low-is-better scoring') &&
    validationPageSource.includes('for JSD') &&
    validationPageSource.includes('Target bands still') &&
    validationPageSource.includes('determine pass, warn, and fail status'),
  'Validation page should explain the family-aware validation loss calculation'
);
assert.ok(
  validationPageSource.includes('The line chart is a secondary overview'),
  'Validation page should explain that the chart is a secondary decision aid'
);
assert.ok(
  validationPageSource.includes('referenceLineLabel') &&
    validationPageSource.includes('referencePointsByVersion') &&
    validationPageSource.includes('2024 validation') &&
    validationPageSource.includes('2011 validation (v0, v0o2, v0o7)') &&
    validationPageSource.includes('Tracked summary:') &&
    !validationPageSource.includes('Dashed comparator:'),
  'Validation page tooltip should distinguish tracked and selected v0-family 2011 validation series'
);
assert.ok(
  !validationPageSource.includes('Click to filter the table'),
  'Validation page should remove the family-card table filters'
);
assert.ok(
  !validationPageSource.includes('Family weight'),
  'Validation page should remove validation family weight copy'
);
assert.ok(
  validationPageSource.includes('Search metrics'),
  'Validation page should render metric table search controls'
);
assert.ok(
  validationPageSource.includes('Sort by'),
  'Validation page should render metric table sort controls'
);
assert.ok(
  validationPageSource.includes('Loss delta vs v0 2011') &&
    validationPageSource.includes('lossDeltaVsReference2011'),
  'Validation page should render the signed loss-delta column versus v0 2011'
);
assert.ok(
  validationPageSource.includes('Loss delta % vs v0 2011') &&
    validationPageSource.includes('lossDeltaPercentVsReference2011'),
  'Validation page should render the percent loss-delta column versus v0 2011'
);
assert.ok(
  validationPageSource.includes('Target value') &&
    validationPageSource.includes('formatTargetValue') &&
    validationPageSource.includes('Acceptance range') &&
    validationPageSource.includes('formatAcceptanceRange'),
  'Validation page should render target value and acceptance range columns'
);
assert.ok(
  !validationPageSource.includes('<th>Status</th>') &&
    !validationPageSource.includes('Status severity') &&
    !validationPageSource.includes('Search by metric, status, or source'),
  'Validation page should remove table status display, sorting, and search copy'
);
assert.ok(
  !validationPageSource.includes('Show all categories'),
  'Validation page should remove family filter reset controls'
);
assert.ok(
  validationPageSource.includes('Provenance & sources'),
  'Validation page should keep metric sources collapsed behind a disclosure'
);
assert.ok(
  validationPageSource.includes('validation-source-panel'),
  'Validation page should render a dedicated provenance panel when expanded'
);
assert.ok(
  validationPageSource.includes('validation-metric-cell'),
  'Validation page should stack the metric name and provenance controls vertically within the metric cell'
);
assert.ok(
  !validationPageSource.includes('validation-metric-meta'),
  'Validation page should not render metric-id descriptors under the main metric names'
);
assert.ok(
  validationPageSource.includes('metricLoss'),
  'Validation page should render each metric loss from the validation payload'
);
assert.ok(
  !validationPageSource.includes('selectedFamilyIds'),
  'Validation page should stop tracking validation family filters'
);
assert.ok(
  validationPageSource.includes('metricSearch'),
  'Validation page should track the metric search term'
);
assert.ok(
  validationPageSource.includes('sortMode'),
  'Validation page should track the selected metric sort mode'
);
assert.ok(
  validationPageSource.includes("const DEFAULT_SORT_MODE: ValidationSortMode = 'highest_loss';"),
  'Validation page should default the metric table to highest loss first'
);
assert.ok(
  validationPageSource.includes('openMetricIds'),
  'Validation page should track row-level provenance disclosure state'
);
assert.ok(
  validationPageSource.includes('Seeds in band'),
  'Validation page should render inside-band uncertainty copy'
);
assert.ok(
  validationPageSource.includes('Sim. IQR'),
  'Validation page should render simulation IQR uncertainty labels'
);
assert.ok(
  validationPageSource.includes('Sim. mean'),
  'Validation page should render simulation mean labels'
);
assert.ok(
  validationPageSource.includes('Weight'),
  'Validation page should render the metric weight column'
);
assert.ok(
  validationPageSource.includes('validation-source-label'),
  'Validation page should render inline source labels for validation metrics'
);
assert.ok(
  validationPageSource.includes('formatLossFamily') &&
    validationPageSource.includes('Loss family:') &&
    validationPageSource.includes('Additive scale'),
  'Validation page should render concise loss family and transform audit details'
);
assert.ok(
  validationPageSource.includes('sourceReferences'),
  'Validation page should render structured source references when available'
);
assert.ok(
  validationPageSource.includes('metricWeight'),
  'Validation page should render each metric weight from the validation payload'
);
assert.ok(
  validationPageSource.includes('<span>Version</span>') &&
    validationPageSource.includes('<span>Validation Year</span>') &&
    validationPageSource.includes('availableValidationTargetYears.map'),
  'Validation page should always render the version selector and derive validation-year options from the selected version'
);
assert.ok(
  validationPageSource.includes('fetchVersions') &&
    validationPageSource.includes('buildVersionLabelState') &&
    validationPageSource.includes('formatVersionOptionLabel') &&
    validationPageSource.includes('getLatestStableVersion'),
  'Validation page should reuse shared calibration version label helpers for the metric-card version selector'
);
assert.ok(
  validationPageSource.includes('{formatValidationVersionOptionLabel(version)}'),
  'Validation page should render formatted user-facing labels in the metric-card version selector'
);
assert.ok(
  validationPageSource.includes('orderValidationVersionOptions') &&
    validationPageSource.includes('getCanonicalValidationVersionRank') &&
    validationPageSource.includes('orderedValidationVersions.map') &&
    validationPageSource.includes("label.startsWith('Optimised 2011 model')") &&
    validationPageSource.includes("label.startsWith('Original 2011 model')") &&
    validationPageSource.includes("label.startsWith('Optimised 2024 model')") &&
    validationPageSource.includes("label.startsWith('Latest 2024 model')"),
  'Validation page should pin canonically named versions to the top of the metric-card version selector'
);
assert.ok(
  !validationPageSource.includes('lossWeight'),
  'Validation page should stop rendering lossWeight fields'
);
assert.ok(
  !validationPageSource.includes('familySummaries'),
  'Validation page should stop depending on family summaries'
);
assert.ok(
  !validationPageSource.includes('familyId'),
  'Validation page should stop depending on metric family ids'
);
assert.ok(
  validationPageSource.includes('selectedVersion'),
  'Validation page should track the selected version'
);
assert.ok(
  !validationPageSource.includes("formatter: 'Selected'"),
  'Validation page should not render the selected chart label inside the marker icon'
);
assert.ok(
  validationPageSource.includes("position: 'top'"),
  'Validation page should position the selected chart label above the marker'
);
assert.ok(
  validationPageSource.includes('handleChartClick') &&
    validationPageSource.includes('Click a 2024 validation point') &&
    validationPageSource.includes('TRACKED_VALIDATION_SERIES_NAME') &&
    validationPageSource.includes('V0_REFERENCE_SERIES_NAME') &&
    validationPageSource.includes('selectVersionAndValidationYear') &&
    validationPageSource.includes('onClick={handleChartClick}'),
  'Validation page should wire chart point clicks to 2024 and 2011 version-year selection'
);
assert.ok(
  eChartSource.includes('onClick?: (params: unknown) => void;') &&
    eChartSource.includes("instance.on('click', clickHandler)") &&
    eChartSource.includes("instance.off('click', clickHandler)"),
  'EChart should expose an optional click handler and attach it to the ECharts instance'
);
assert.ok(
  apiSource.includes("/api/validation-overview") && apiSource.includes("validationTargetYear"),
  'API client should fetch the validation overview payload with an explicit validation target year'
);
assert.ok(
  publicRoutesSource.includes("/api/validation-overview") && publicRoutesSource.includes("req.query.validationTargetYear"),
  'Public routes should expose the validation overview endpoint and accept the validation target year query parameter'
);
assert.ok(
  !serviceSource.includes('entry.validation.income_diff_pct'),
  'Validation overview should not derive page data from legacy version-notes diffs'
);

const comparePageSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/src/pages/ComparePage.tsx'), 'utf-8');
assert.ok(
  comparePageSource.includes("const DEFAULT_OPEN_COMPARE_CARD_IDS = new Set<string>([") &&
    comparePageSource.includes("'house_price_lognormal'") &&
    comparePageSource.includes("'wealth_given_income_joint'") &&
    comparePageSource.includes("'downpayment_ftb_lognormal'"),
  'Compare page should default-open the requested house price, wealth, and FTB down-payment cards'
);
assert.ok(
  comparePageSource.includes("const DEFAULT_OPEN_COMPARE_GROUPS = new Set<ParameterGroup>([") &&
    comparePageSource.includes("'Housing & Rental Market'") &&
    comparePageSource.includes("'Household Demographics & Wealth'") &&
    comparePageSource.includes("'Purchase & Mortgage'"),
  'Compare page should open the groups containing the requested default cards'
);
assert.ok(
  comparePageSource.includes('defaultExpanded={DEFAULT_OPEN_COMPARE_CARD_IDS.has(item.id)}'),
  'Compare page should drive default card expansion from the configured default-open ids'
);

assert.ok(
  compareCardSource.includes('const [isMoreInfoOpen, setIsMoreInfoOpen] = useState<boolean>(false);'),
  'Compare card should keep provenance and sources collapsed by default'
);
assert.ok(
  appSource.includes("{experimentsVisible && (\n              <Route\n                path=\"/login\""),
  'App should register the experiments login route from the always-enabled experiments visibility flag'
);

const homePageSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/src/pages/HomePage.tsx'), 'utf-8');
assert.ok(
  !homePageSource.includes('fetchGitStats'),
  'Home page should no longer fetch git stats'
);
assert.ok(
  !homePageSource.includes('Lines of Code Written'),
  'Home page should no longer render git stats cards'
);
assert.ok(
  !homePageSource.includes('Just Launched'),
  'Home page should no longer render the launch badge'
);
// The remade Home page is a minimal task-first launchpad: a one-line intro plus the Default Run
// button, with no preview chart or author/portfolio material.
assert.ok(
  homePageSource.includes('A UK housing-market simulator for testing central-bank (macroprudential) policy.'),
  'Home page should open with the plain-English statement of what the tool is'
);
assert.ok(
  homePageSource.includes('onStartDefaultRun') &&
    homePageSource.includes('buildDefaultRunSubmitRequest') &&
    homePageSource.includes('className="primary-button default-run-button"'),
  'Home page should provide a prominent Default Run button wired to the default-run submit path'
);
assert.ok(
  homePageSource.includes("buildExperimentsPath({ ...DEFAULT_EXPERIMENT_ROUTE_STATE, type: 'manual', mode: 'view' })"),
  'Home Default Run should queue the run and route to the Results view, not the run-configuration form'
);
assert.ok(
  !homePageSource.includes('fetchHomePreview') &&
    !homePageSource.includes('contribution-highlights') &&
    !homePageSource.includes('hero-card') &&
    !homePageSource.includes('home-about'),
  'Home page should drop the preview chart and the About/portfolio material'
);

const serverIndexSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/server/index.ts'), 'utf-8');
const dashboardServerSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/server/dashboardServer.ts'), 'utf-8');
assert.ok(
  serverIndexSource.includes("import { runDashboardServerFromEnv } from './dashboardServer';") &&
    serverIndexSource.includes('void runDashboardServerFromEnv().catch'),
  'Server index should remain a thin compiled CLI entrypoint'
);
assert.ok(
  !serverIndexSource.includes('express()') && !serverIndexSource.includes('.listen('),
  'Server index should not construct or listen on the Express server directly'
);
assert.ok(
  dashboardServerSource.includes('export async function startDashboardServer'),
  'Constructible server module should export the Electron-owned startup API'
);
assert.ok(
  dashboardServerSource.includes("const EXPERIMENTS_DISABLED_REASON =\n  'Experiments are not available in this environment.';"),
  'Server should define a stable experiments-disabled error message'
);
assert.ok(
  dashboardServerSource.includes('const requireExperimentsFeature = (req: express.Request, res: express.Response): boolean => {'),
  'Server should centralize experiments feature gating'
);
assert.ok(
  dashboardServerSource.includes("import { registerPublicRoutes } from './routes/publicRoutes';"),
  'Server should register public routes through a dedicated module'
);
assert.ok(
  dashboardServerSource.includes("const { registerDevRoutes } = await import('./routes/devRoutes');") &&
    dashboardServerSource.includes('registerDevRoutes(app, routeContext);') &&
    !dashboardServerSource.includes('if (isDevRuntime) {\n    const { registerDevRoutes } = await import'),
  'Server should register experiment/model-run routes in every runtime'
);
assert.ok(
  dashboardServerSource.includes("envValue('DASHBOARD_LOG_MEMORY').toLowerCase() === 'true'"),
  'Server should support optional request-level memory logging'
);
assert.ok(
  dashboardServerSource.includes('registerStaticServing(app, staticRoot);') &&
    dashboardServerSource.includes("req.path.startsWith('/api/')"),
  'Constructible server should keep desktop static serving behind API routes'
);
assert.ok(
  dashboardServerSource.includes("const isDevRuntime = options.isDevRuntime ?? (envValue('NODE_ENV').toLowerCase() !== 'production');") &&
    dashboardServerSource.includes("input.runtimePaths.mode !== 'desktop' && input.isDevRuntime && viewMode === 'dev'") &&
    dashboardServerSource.includes("viewMode === 'dev' || viewMode === 'preview_desktop'"),
  'Dev write bypass should stay dev-only while local desktop preview can bypass download credentials'
);

assert.ok(
  publicRoutesSource.includes("app.get('/api/home-preview'"),
  'Public routes should expose the lightweight home preview endpoint'
);
assert.ok(
  !publicRoutesSource.includes("/api/git-stats"),
  'Public routes should not expose git stats'
);
assert.ok(
  publicRoutesSource.includes('getHomePreview(context.runtimePaths, version, HOME_PREVIEW_PARAMETER_IDS)'),
  'Public routes should serve the home preview from the lightweight service function'
);

const devRoutesSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/server/routes/devRoutes.ts'), 'utf-8');
const routeContextSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/server/routes/routeContext.ts'), 'utf-8');
assert.ok(
  devRoutesSource.includes("app.get('/api/model-runs/options'"),
  'Dev routes should contain model-run endpoints'
);
assert.ok(
  devRoutesSource.includes("app.get('/api/results/runs'"),
  'Dev routes should contain results-management endpoints'
);
assert.ok(
  devRoutesSource.includes("if (!context.requireExperimentsFeature(req, res)) {"),
  'Experiment routes should still use the centralized experiments feature guard'
);
assert.ok(
  routeContextSource.includes('launcher?: ModelLauncher') &&
    devRoutesSource.includes('launcher: context.launcher'),
  'Experiment routes should accept the configured constructible-server launcher'
);

assert.ok(
  !apiSource.includes('fetchGitStats'),
  'Client API should no longer expose fetchGitStats'
);
assert.ok(
  apiSource.includes("buildApiUrl('/api/home-preview')"),
  'Client API should expose the lightweight home preview fetcher'
);

const resultsSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/server/lib/results.ts'), 'utf-8');
assert.ok(
  resultsSource.includes("const OUTPUT_CACHE_MAX_ENTRIES = (process.env.NODE_ENV?.trim().toLowerCase() ?? '') === 'production' ? 0 : 2;"),
  'Results parsing should disable the output cache in production'
);

const packageSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/package.json'), 'utf-8');
const packageJson = JSON.parse(packageSource) as {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
assert.ok(
  packageSource.includes("\"start:server\": \"node dist-server/server/index.js\""),
  'Production server should run compiled JavaScript instead of tsx'
);
assert.equal(
  packageJson.devDependencies?.electron,
  undefined,
  'Root dashboard package should not install Electron in public API/static builds'
);
assert.equal(
  packageJson.scripts.build,
  'npm run typecheck && npm run build:client && npm run build:server',
  'Root dashboard build should remain public-API safe and not build Electron by default'
);
assert.equal(
  packageJson.scripts['build:desktop'],
  'npm run typecheck && npm run build:client && npm --prefix electron run build',
  'Desktop build should compile the renderer and isolated Electron package'
);
assert.equal(
  packageJson.scripts['release:installer'],
  'npm run release:installer:signed',
  'Default installer release script should keep using the signed release path'
);
assert.equal(
  packageJson.scripts['release:installer:signed'],
  'npm run release:resources && npm --prefix electron run release:installer:signed && node ../scripts/windows/write-installer-release-manifest.mjs --signing-mode signed',
  'Signed installer release script should assemble resources before building and validating signed metadata'
);
assert.equal(
  packageJson.scripts['release:installer:unsigned'],
  'npm run release:resources && npm --prefix electron run release:installer:unsigned && node ../scripts/windows/write-installer-release-manifest.mjs --signing-mode unsigned',
  'Unsigned installer release script should explicitly request unsigned metadata'
);
assert.equal(
  packageJson.scripts['release:installer:check'],
  'npm run release:installer:check:signed',
  'Default installer release check should keep using the signed release validation path'
);
assert.equal(
  packageJson.scripts['release:installer:check:signed'],
  'npm run release:resources:check && node ../scripts/windows/write-installer-release-manifest.mjs --check --signing-mode signed',
  'Signed installer release check should validate resources and signed installer release artifacts'
);
assert.equal(
  packageJson.scripts['release:installer:check:unsigned'],
  'npm run release:resources:check && node ../scripts/windows/write-installer-release-manifest.mjs --check --signing-mode unsigned',
  'Unsigned installer release check should validate resources and unsigned installer release artifacts'
);

const electronPackageSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/electron/package.json'), 'utf-8');
const electronPackageJson = JSON.parse(electronPackageSource) as {
  main: string;
  scripts: Record<string, string>;
  devDependencies?: Record<string, string>;
};
assert.equal(electronPackageJson.main, 'dist/electron/main.js', 'Electron package should point to the compiled main process');
assert.ok(electronPackageJson.devDependencies?.electron, 'Electron dependency should live in the isolated Electron package');
assert.ok(
  electronPackageJson.devDependencies?.['electron-builder'],
  'Electron Builder dependency should live in the isolated Electron package'
);
assert.equal(
  electronPackageJson.scripts['release:installer'],
  'npm run release:installer:signed',
  'Electron package default installer build should keep using the signed release path'
);
assert.equal(
  electronPackageJson.scripts['release:installer:signed'],
  'electron-builder --config electron-builder.yml --win nsis --x64 --publish never',
  'Electron package should build the signed offline NSIS Windows installer target'
);
assert.equal(
  electronPackageJson.scripts['release:installer:unsigned'],
  'electron-builder --config electron-builder-unsigned.yml --win nsis --x64 --publish never',
  'Electron package should expose an explicit unsigned offline NSIS Windows installer target'
);

const electronBuilderConfig = fs.readFileSync(path.resolve(repoRoot, 'dashboard/electron/electron-builder.yml'), 'utf-8');
assert.ok(electronBuilderConfig.includes('appId: uk.housing.model.dashboard'), 'Installer should use a stable appId');
assert.ok(electronBuilderConfig.includes('productName: UK Housing Model'), 'Installer should use the desktop product name');
assert.ok(electronBuilderConfig.includes('asar: false'), 'Installer should keep app files unpacked for v1 path compatibility');
assert.ok(electronBuilderConfig.includes('forceCodeSigning: true'), 'Installer builds should require code signing');
assert.ok(electronBuilderConfig.includes('target: nsis'), 'Installer should use the offline NSIS target');
assert.ok(
  electronBuilderConfig.includes('signAndEditExecutable: true'),
  'Installer builds should sign and edit the Windows executable'
);
assert.ok(
  !electronBuilderConfig.includes('forceCodeSigning: false') &&
    !electronBuilderConfig.includes('signAndEditExecutable: false'),
  'Installer builds should not allow unsigned Windows executables'
);
assert.ok(!electronBuilderConfig.includes('nsis-web'), 'Installer should not use nsis-web for the offline v1 package');
assert.ok(
  electronBuilderConfig.includes('from: ../release/windows/resources/release-data'),
  'Installer should package the validated Phase 10 release-data directory'
);
assert.ok(
  electronBuilderConfig.includes('deleteAppDataOnUninstall: false'),
  'Installer updates/uninstalls should not delete Electron userData by default'
);

const unsignedElectronBuilderConfig = fs.readFileSync(
  path.resolve(repoRoot, 'dashboard/electron/electron-builder-unsigned.yml'),
  'utf-8'
);
assert.ok(
  unsignedElectronBuilderConfig.includes('forceCodeSigning: false') &&
    unsignedElectronBuilderConfig.includes('signAndEditExecutable: false'),
  'Unsigned installer builds should explicitly disable Electron Builder code signing'
);
assert.ok(
  !unsignedElectronBuilderConfig.includes('forceCodeSigning: true') &&
    !unsignedElectronBuilderConfig.includes('signAndEditExecutable: true'),
  'Unsigned installer config should not inherit signed executable requirements'
);
assert.ok(
  unsignedElectronBuilderConfig.includes('target: nsis') && !unsignedElectronBuilderConfig.includes('nsis-web'),
  'Unsigned installer should use the same offline NSIS target'
);

const installerManifestSource = fs.readFileSync(
  path.resolve(repoRoot, 'scripts/windows/write-installer-release-manifest.mjs'),
  'utf-8'
);
assert.ok(
  installerManifestSource.includes('Get-AuthenticodeSignature'),
  'Installer release metadata should verify the Windows Authenticode signature'
);
assert.ok(
  installerManifestSource.includes("const signed = options.signingMode === 'signed';") &&
    installerManifestSource.includes('signed,') &&
    installerManifestSource.includes('signature: signed ? signature : null'),
  'Installer release metadata should record signed installer status and signer metadata'
);
assert.ok(
  installerManifestSource.includes("signingMode: 'signed'") &&
    installerManifestSource.includes("--signing-mode requires signed or unsigned") &&
    installerManifestSource.includes("options.signingMode === 'signed'"),
  'Installer release metadata should support explicit signed and unsigned modes'
);
assert.ok(
  installerManifestSource.includes('unsignedReason') &&
    installerManifestSource.includes('Unsigned installer release manifest must include an unsigned reason.'),
  'Installer release metadata should record why explicitly unsigned installers are unsigned'
);

const windowsReleaseWorkflowSource = fs.readFileSync(
  path.resolve(repoRoot, '.github/workflows/windows-release.yml'),
  'utf-8'
);
assert.ok(
  windowsReleaseWorkflowSource.includes('Resolve Windows signing mode') &&
    windowsReleaseWorkflowSource.includes('secrets.WIN_CSC_LINK') &&
    windowsReleaseWorkflowSource.includes('secrets.WIN_CSC_KEY_PASSWORD') &&
    windowsReleaseWorkflowSource.includes('Write-Warning') &&
    windowsReleaseWorkflowSource.includes('signing_mode=unsigned') &&
    windowsReleaseWorkflowSource.includes('GITHUB_STEP_SUMMARY'),
  'Windows release workflow should warn and select unsigned mode when code-signing secrets are missing'
);
assert.ok(
  !windowsReleaseWorkflowSource.includes('WIN_CSC_LINK secret is required to code sign the Windows installer.') &&
    !windowsReleaseWorkflowSource.includes('WIN_CSC_KEY_PASSWORD secret is required to code sign the Windows installer.'),
  'Windows release workflow should not fail solely because code-signing secrets are missing'
);
assert.ok(
  windowsReleaseWorkflowSource.includes('Build signed Windows installer') &&
    windowsReleaseWorkflowSource.includes("steps.signing-mode.outputs.signing_mode == 'signed'") &&
    windowsReleaseWorkflowSource.includes('WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}') &&
    windowsReleaseWorkflowSource.includes('WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}'),
  'Windows release workflow should pass signing secrets only to the installer build step'
);
assert.ok(
  windowsReleaseWorkflowSource.includes('Build unsigned Windows installer') &&
    windowsReleaseWorkflowSource.includes("steps.signing-mode.outputs.signing_mode == 'unsigned'") &&
    windowsReleaseWorkflowSource.includes('INSTALLER_UNSIGNED_REASON: ${{ steps.signing-mode.outputs.unsigned_reason }}') &&
    windowsReleaseWorkflowSource.includes('npm run release:installer:unsigned'),
  'Windows release workflow should build an unsigned installer explicitly when signing secrets are missing'
);
assert.ok(
  windowsReleaseWorkflowSource.includes('release:installer:check:${{ steps.signing-mode.outputs.signing_mode }}'),
  'Windows release workflow should validate installer metadata using the selected signing mode'
);
assert.ok(
  windowsReleaseWorkflowSource.includes('packages the model as a user-friendly Windows desktop app') &&
    windowsReleaseWorkflowSource.includes('Installation on Windows:') &&
    windowsReleaseWorkflowSource.includes('Run the installer') &&
    windowsReleaseWorkflowSource.includes('Start Menu or desktop shortcut'),
  'Windows release notes should focus on the signed desktop app and high-level installation'
);
assert.ok(
  windowsReleaseWorkflowSource.includes('code-signed Electron app for Windows') &&
    windowsReleaseWorkflowSource.includes('unsigned Electron app for Windows') &&
    windowsReleaseWorkflowSource.includes('The installer was not code-signed because') &&
    windowsReleaseWorkflowSource.includes('body_path: ${{ steps.release-notes.outputs.path }}'),
  'Windows release notes should conditionally describe signed and unsigned installer status'
);
assert.ok(
  !windowsReleaseWorkflowSource.includes('Draft unsigned') &&
    !windowsReleaseWorkflowSource.includes('Included scope:') &&
    !windowsReleaseWorkflowSource.includes('Not included:') &&
    !windowsReleaseWorkflowSource.includes('AWS resources'),
  'Windows release notes should not use old unsigned, draft, scope, or AWS wording'
);

function createDesktopMainFrame(origin: string, url: string): DesktopFrameLike {
  const frame: {
    detached: boolean;
    origin: string;
    parent: DesktopFrameLike | null;
    top: DesktopFrameLike | null;
    url: string;
    isDestroyed: () => boolean;
  } = {
    detached: false,
    origin,
    parent: null,
    top: null,
    url,
    isDestroyed: () => false
  };
  frame.top = frame;
  return frame;
}

const desktopTrustedOrigin = deriveTrustedDashboardOrigin('http://127.0.0.1:49152/');
const desktopTrustedMainFrame = createDesktopMainFrame(desktopTrustedOrigin, `${desktopTrustedOrigin}/results`);
assert.equal(desktopTrustedOrigin, 'http://127.0.0.1:49152', 'Desktop origin helper should derive the exact origin');
assert.equal(
  validateTrustedDesktopIpcSender({
    trustedOrigin: desktopTrustedOrigin,
    mainWindowWebContentsId: 10,
    senderWebContentsId: 10,
    senderFrame: desktopTrustedMainFrame
  }).ok,
  true,
  'Trusted desktop IPC sender should pass origin and main-frame validation'
);
assert.match(
  validateTrustedDesktopIpcSender({
    trustedOrigin: desktopTrustedOrigin,
    mainWindowWebContentsId: 10,
    senderWebContentsId: 10,
    senderFrame: createDesktopMainFrame('https://example.com', 'https://example.com/')
  }).reason ?? '',
  /origin/,
  'Wrong-origin desktop IPC sender should be rejected'
);
assert.match(
  validateTrustedDesktopIpcSender({
    trustedOrigin: desktopTrustedOrigin,
    mainWindowWebContentsId: 10,
    senderWebContentsId: 10,
    senderFrame: {
      detached: false,
      origin: desktopTrustedOrigin,
      parent: desktopTrustedMainFrame,
      top: desktopTrustedMainFrame,
      url: `${desktopTrustedOrigin}/embedded`,
      isDestroyed: () => false
    }
  }).reason ?? '',
  /main frame/,
  'Child-frame desktop IPC sender should be rejected'
);
assert.match(
  validateTrustedDesktopIpcSender({
    trustedOrigin: desktopTrustedOrigin,
    mainWindowWebContentsId: 10,
    senderWebContentsId: 11,
    senderFrame: desktopTrustedMainFrame
  }).reason ?? '',
  /main dashboard window/,
  'Wrong-window desktop IPC sender should be rejected'
);
assert.equal(
  shouldBlockDashboardNavigation({ url: `${desktopTrustedOrigin}/calibration`, isMainFrame: true }, desktopTrustedOrigin),
  false,
  'Same-origin dashboard navigation should be allowed'
);
assert.equal(
  shouldBlockDashboardNavigation({ url: 'https://example.com/', isMainFrame: true }, desktopTrustedOrigin),
  true,
  'Non-dashboard main-frame navigation should be blocked'
);
assert.equal(
  shouldBlockDashboardNavigation({ url: 'https://example.com/frame', isMainFrame: false }, desktopTrustedOrigin),
  false,
  'Subframe navigation should not be blocked by the main-frame navigation guard'
);
assert.deepEqual(
  classifyDesktopWindowOpenTarget('https://example.com/docs?q=1'),
  { action: 'deny', openExternalUrl: 'https://example.com/docs?q=1' },
  'HTTPS window-open targets should be denied in Electron and externalized'
);
assert.deepEqual(
  classifyDesktopWindowOpenTarget(`${desktopTrustedOrigin}/calibration`),
  { action: 'deny' },
  'Dashboard window-open targets should be denied instead of inheriting preload access'
);
assert.deepEqual(
  classifyDesktopWindowOpenTarget('javascript:alert(1)'),
  { action: 'deny' },
  'Unsafe window-open targets should be denied without externalization'
);
assert.deepEqual(
  classifyDesktopWindowOpenTarget('https://user:secret@example.com/docs'),
  { action: 'deny' },
  'Credential-bearing HTTPS window-open targets should be denied without externalization'
);

const electronMainSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/electron/main.ts'), 'utf-8');
assert.ok(
  electronMainSource.includes('randomBytes(32).toString') &&
    electronMainSource.includes('desktopAuthToken') &&
    electronMainSource.includes('startDashboardServer({'),
  'Electron main should generate a per-session token and own server startup'
);
assert.ok(
  electronMainSource.includes("const desktopProductName = 'UK Housing Model'") &&
    electronMainSource.includes('app.setName(desktopProductName)') &&
    electronMainSource.includes("app.setPath('userData', path.join(app.getPath('appData'), desktopProductName))"),
  'Electron main should keep installed userData under the stable product name'
);
assert.ok(
  electronMainSource.includes('createPackagedModelLauncher(javaExe, modelJar)') &&
    electronMainSource.includes('modelRunsConfigured: true') &&
    electronMainSource.includes('isDevRuntime: false'),
  'Electron main should start the constructible server with packaged launcher configuration'
);
assert.ok(
  electronMainSource.includes('openFolder(runtimePaths.resultsRoot)') &&
    electronMainSource.includes('openFolder(runtimePaths.logsRoot)') &&
    electronMainSource.includes('shell.openPath(folderPath)'),
  'Electron main should expose safe results/logs folder actions'
);
assert.ok(
  electronMainSource.includes('exportDesktopSupportBundle({') &&
    electronMainSource.includes("new URL('/api/runtime-deps', serverHandle.url)") &&
    electronMainSource.includes("ipcMain.handle('uk-housing-desktop:export-support-bundle'"),
  'Electron main should expose a trusted support-bundle export action with runtime diagnostics'
);
assert.ok(
  electronMainSource.includes('trustedDashboardOrigin = new URL(serverHandle.url).origin'),
  'Electron main should derive and store the exact trusted dashboard origin after server startup'
);
assert.equal(
  electronMainSource.match(/assertTrustedDesktopIpcEvent\(event\);/g)?.length,
  4,
  'Every desktop IPC handler should validate the trusted sender before returning data or opening folders'
);
assert.ok(
  electronMainSource.includes("mainWindow.webContents.on('will-navigate'") &&
    electronMainSource.includes('shouldBlockDashboardNavigation') &&
    electronMainSource.includes('event.preventDefault()'),
  'Electron main should block main-frame navigation away from the trusted dashboard origin'
);
assert.ok(
  electronMainSource.includes('setWindowOpenHandler') &&
    electronMainSource.includes('classifyDesktopWindowOpenTarget') &&
    electronMainSource.includes('shell.openExternal') &&
    electronMainSource.includes('return { action: decision.action }'),
  'Electron main should deny child Electron windows and safely externalize allowed HTTPS targets'
);
assert.ok(
  electronMainSource.includes('await serverHandle.shutdown()'),
  'Electron shutdown should stop the owned dashboard server'
);

const electronPreloadSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/electron/preload.ts'), 'utf-8');
assert.ok(
  electronPreloadSource.includes("contextBridge.exposeInMainWorld('ukHousingDesktop'") &&
    electronPreloadSource.includes('getApiAuthToken') &&
    electronPreloadSource.includes('openResultsFolder') &&
    electronPreloadSource.includes('openLogsFolder') &&
    electronPreloadSource.includes('exportSupportBundle'),
  'Electron preload should expose a narrow desktop API'
);

const viteEnvSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/src/vite-env.d.ts'), 'utf-8');
assert.ok(
  viteEnvSource.includes('exportSupportBundle') &&
    viteEnvSource.includes('UkHousingDesktopSupportBundleExportResult'),
  'Renderer desktop API typings should include support-bundle export'
);

const dashboardReadmeSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/README.md'), 'utf-8');
assert.ok(
  dashboardReadmeSource.includes('Runtime target compatibility:') &&
    dashboardReadmeSource.includes('| Dev mode | Repo-shaped local workflow') &&
    dashboardReadmeSource.includes('| Cloud mode | Lightweight public API/container path') &&
    dashboardReadmeSource.includes('| Desktop mode | Electron-owned local server'),
  'Dashboard README should document dev, cloud, and desktop runtime targets together'
);
assert.ok(
  dashboardReadmeSource.includes('DASHBOARD_EXECUTION_BACKEND=aws_ssm') &&
    dashboardReadmeSource.includes('/healthz') &&
    dashboardReadmeSource.includes('/api/runtime-deps') &&
    dashboardReadmeSource.includes('The API does not start EC2 instances'),
  'Runtime matrix should document cloud remote execution gating and read-route availability'
);
assert.ok(
  dashboardReadmeSource.includes('Packaged launcher for dashboard-managed manual and sensitivity runs') &&
    dashboardReadmeSource.includes('Per-session bearer token') &&
    dashboardReadmeSource.includes('release data stays allowlisted and separate from cloud credentials/resources'),
  'Runtime matrix should describe implemented desktop runtime boundaries'
);

const windowsReleaseDocPath = path.resolve(repoRoot, 'docs/windows/recommended-release-setup.md');
if (fs.existsSync(windowsReleaseDocPath)) {
  const windowsReleaseDocSource = fs.readFileSync(windowsReleaseDocPath, 'utf-8');
  assert.ok(
    windowsReleaseDocSource.includes('It is not a statement of current repo capability') &&
      windowsReleaseDocSource.includes('The original baseline was a developer-oriented runtime without an Electron shell') &&
      windowsReleaseDocSource.includes('phase-by-phase capability changes as they land') &&
      windowsReleaseDocSource.includes('Public cloud compatibility'),
    'Windows release docs should distinguish the original baseline from completed release phases'
  );
}

const dockerignoreSource = fs.readFileSync(path.resolve(repoRoot, '.dockerignore'), 'utf-8');
const dockerfileSource = fs.readFileSync(path.resolve(repoRoot, 'dashboard/Dockerfile.api'), 'utf-8');
assert.ok(
  dockerfileSource.includes('RUN npm run build:server'),
  'Docker API image should build compiled server output'
);
assert.ok(
  !dockerfileSource.includes('openjdk-17-jdk'),
  'Docker API image should no longer install Java'
);
assert.ok(
  dockerfileSource.includes('FROM node:22-alpine') &&
    !dockerfileSource.includes('maven') &&
    !dockerfileSource.includes('git') &&
    !dockerfileSource.includes('private-datasets') &&
    !dockerfileSource.includes('Results'),
  'Docker API image should stay Node-only and avoid model execution/private/generated payloads'
);
assert.ok(
  dockerignoreSource.includes('*') &&
    dockerignoreSource.includes('!dashboard/server/**') &&
    dockerignoreSource.includes('!dashboard/shared/**') &&
    dockerignoreSource.includes('!input-data-versions/**') &&
    !dockerignoreSource.includes('!private-datasets') &&
    !dockerignoreSource.includes('!Results'),
  'Docker build context should remain allowlisted away from private datasets and generated Results'
);

console.log('Smoke tests passed.');
