// Author: Max Stoddard
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ModelLauncher } from './modelLauncher';
import { checkJavaRuntime } from './runtimeDeps';
import type { RuntimePaths } from './runtimePaths';

export const RUN_MANIFEST_FILE_NAME = 'dashboard-run-manifest.json';

const MANIFEST_SCHEMA_VERSION = 1;
const DASHBOARD_PACKAGE_RELATIVE_PATH = path.join('dashboard', 'package.json');

export interface RunManifestFileHash {
  algorithm: 'sha256';
  value: string;
}

export interface RunManifestDirectoryHash extends RunManifestFileHash {
  fileCount: number;
}

export interface RunManifestJavaRuntime {
  javaBin: string;
  available: boolean;
  vendor: string | null;
  version: string | null;
  majorVersion: number | null;
  error: string | null;
}

export interface RunManifestModelArtifact {
  path: string | null;
  sha256: string | null;
  available: boolean;
  error: string | null;
}

export interface RunManifestInputData {
  dataRoot: string;
  baselineSnapshot: string;
  baselineSnapshotHash: RunManifestDirectoryHash | null;
  dashboardHistoryHash: RunManifestFileHash | null;
}

export interface RunManifestEnvironment {
  appVersion: string | null;
  releaseChannel: string;
  buildCommitSha: string | null;
}

export interface RunManifestLauncher {
  mode: ModelLauncher['mode'];
  commandTemplate: string;
  mavenBin?: string;
  javaExe?: string;
  modelJar?: string;
}

export interface ManualRunManifest {
  schemaVersion: number;
  manifestType: 'manual-run';
  generatedAt: string;
  updatedAt: string;
  environment: RunManifestEnvironment;
  launcher: RunManifestLauncher;
  javaRuntime: RunManifestJavaRuntime;
  modelArtifact: RunManifestModelArtifact;
  inputData: RunManifestInputData;
  run: {
    jobId: string;
    runId: string;
    title: string | null;
    status: string;
    createdAt: string;
    startedAt: string | null;
    endedAt: string | null;
    outputPath: string;
    configPath: string;
    generatedConfigHash: RunManifestFileHash | null;
    seed: number | null;
    seedsPerPoint: number | null;
    seeds: number[];
    basePolicy: string | null;
    maxWorkers: number | null;
    overriddenParameters: Record<string, number | boolean>;
    outputHash: RunManifestDirectoryHash | null;
    exitCode: number | null;
    signal: string | null;
  };
}

export interface SensitivityRunManifestPoint {
  pointId: string;
  value: number | null;
  label: string;
  valuesByKey?: Record<string, number>;
  isBaseline: boolean;
  status: string | null;
  runId: string;
  outputPath: string | null;
  generatedConfigHash: RunManifestFileHash | null;
  seed: number | null;
  overriddenParameters: Record<string, number | boolean>;
  outputHash: RunManifestDirectoryHash | null;
}

export interface SensitivityRunManifest {
  schemaVersion: number;
  manifestType: 'sensitivity-experiment';
  generatedAt: string;
  updatedAt: string;
  environment: RunManifestEnvironment;
  launcher: RunManifestLauncher;
  javaRuntime: RunManifestJavaRuntime;
  modelArtifact: RunManifestModelArtifact;
  inputData: RunManifestInputData;
  experiment: {
    experimentId: string;
    title: string | null;
    baseline: string;
    basePolicy: string | null;
    status: string;
    createdAt: string;
    startedAt: string | null;
    endedAt: string | null;
    seedsPerPoint: number | null;
    seeds: number[];
    maxWorkers: number | null;
    generalOverrides: Record<string, number | boolean>;
    parameter: {
      key: string;
      title: string;
      description: string;
      packageId?: string;
      parameterKeys?: string[];
      baselineValue: number | null;
      baselineValuesByKey?: Record<string, number>;
      min: number;
      max: number;
      sampleCount: number;
    };
    summaryHash: RunManifestFileHash | null;
    points: SensitivityRunManifestPoint[];
  };
}

export function hashFile(filePath: string): RunManifestFileHash | null {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }

  return {
    algorithm: 'sha256',
    value: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
  };
}

export function hashJson(value: unknown): RunManifestFileHash {
  return {
    algorithm: 'sha256',
    value: crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
  };
}

export function hashDirectory(
  directoryPath: string,
  excludedRelativePaths = new Set<string>()
): RunManifestDirectoryHash | null {
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    return null;
  }

  const files: string[] = [];
  const stack = [''];
  while (stack.length > 0) {
    const relativeDir = stack.pop() as string;
    const absoluteDir = path.join(directoryPath, relativeDir);
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name)
    );

    for (const entry of entries) {
      const relativePath = path.join(relativeDir, entry.name).replace(/\\/g, '/');
      if (excludedRelativePaths.has(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  const hash = crypto.createHash('sha256');
  for (const relativePath of files.sort()) {
    const absolutePath = path.join(directoryPath, relativePath);
    const fileHash = hashFile(absolutePath);
    const sizeBytes = fs.statSync(absolutePath).size;
    hash.update(relativePath);
    hash.update('\0');
    hash.update(fileHash?.value ?? '');
    hash.update('\0');
    hash.update(String(sizeBytes));
    hash.update('\0');
  }

  return {
    algorithm: 'sha256',
    value: hash.digest('hex'),
    fileCount: files.length
  };
}

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function readDashboardPackageVersion(repoRoot: string): string | null {
  const packagePath = path.join(repoRoot, DASHBOARD_PACKAGE_RELATIVE_PATH);
  if (!fs.existsSync(packagePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf-8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

function resolveBuildCommitSha(repoRoot: string): string | null {
  const configured = envValue('DASHBOARD_BUILD_COMMIT_SHA');
  if (configured) {
    return configured;
  }

  const result = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf-8' });
  if (result.status !== 0 || result.error) {
    return null;
  }
  const sha = result.stdout.trim();
  return sha.length > 0 ? sha : null;
}

function buildEnvironment(paths: RuntimePaths): RunManifestEnvironment {
  return {
    appVersion: envValue('DASHBOARD_APP_VERSION') ?? readDashboardPackageVersion(paths.repoRoot),
    releaseChannel: envValue('DASHBOARD_RELEASE_CHANNEL') ?? paths.mode,
    buildCommitSha: resolveBuildCommitSha(paths.repoRoot)
  };
}

function buildLauncher(launcher: ModelLauncher): RunManifestLauncher {
  return {
    mode: launcher.metadata.mode,
    commandTemplate: launcher.metadata.commandTemplate,
    ...(launcher.metadata.mavenBin ? { mavenBin: launcher.metadata.mavenBin } : {}),
    ...(launcher.metadata.javaExe ? { javaExe: launcher.metadata.javaExe } : {}),
    ...(launcher.metadata.modelJar ? { modelJar: launcher.metadata.modelJar } : {})
  };
}

function firstVersionLine(versionOutput: string): string | null {
  return versionOutput.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

function buildJavaRuntime(launcher: ModelLauncher): RunManifestJavaRuntime {
  const javaBin = launcher.metadata.javaExe ?? process.env.DASHBOARD_JAVA_BIN?.trim() ?? 'java';
  const status = checkJavaRuntime(javaBin);
  const firstLine = firstVersionLine(status.versionOutput);
  return {
    javaBin,
    available: status.available,
    vendor: status.vendor ?? null,
    version: firstLine,
    majorVersion: status.majorVersion ?? null,
    error: status.error ?? null
  };
}

function buildModelArtifact(launcher: ModelLauncher): RunManifestModelArtifact {
  const modelJar = launcher.metadata.modelJar ?? null;
  if (!modelJar) {
    return {
      path: null,
      sha256: null,
      available: false,
      error: launcher.mode === 'maven' ? 'Maven launcher does not use a packaged model jar.' : 'Model jar path is not configured.'
    };
  }

  const hash = hashFile(modelJar);
  return {
    path: modelJar,
    sha256: hash?.value ?? null,
    available: Boolean(hash),
    error: hash ? null : `Model artifact is missing or unreadable: ${modelJar}`
  };
}

function buildInputData(paths: RuntimePaths, baselineSnapshot: string): RunManifestInputData {
  const baselineRoot = path.join(paths.dataRoot, baselineSnapshot);
  return {
    dataRoot: paths.dataRoot,
    baselineSnapshot,
    baselineSnapshotHash: hashDirectory(baselineRoot),
    dashboardHistoryHash: hashFile(path.join(paths.dataRoot, 'dashboard-input-version-history.json'))
  };
}

export function buildManualRunManifest(input: {
  paths: RuntimePaths;
  launcher: ModelLauncher;
  job: {
    jobId: string;
    runId: string;
    title?: string;
    baseline: string;
    status: string;
    createdAt: string;
    startedAt?: string;
    endedAt?: string;
    exitCode?: number | null;
    signal?: string | null;
  };
  configPath: string;
  outputPath: string;
  seed: number | null;
  seedsPerPoint?: number | null;
  seeds?: number[];
  basePolicy?: string | null;
  maxWorkers?: number | null;
  overriddenParameters: Record<string, number | boolean>;
  outputHash: RunManifestDirectoryHash | null;
}): ManualRunManifest {
  const now = new Date().toISOString();
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    manifestType: 'manual-run',
    generatedAt: input.job.createdAt,
    updatedAt: now,
    environment: buildEnvironment(input.paths),
    launcher: buildLauncher(input.launcher),
    javaRuntime: buildJavaRuntime(input.launcher),
    modelArtifact: buildModelArtifact(input.launcher),
    inputData: buildInputData(input.paths, input.job.baseline),
    run: {
      jobId: input.job.jobId,
      runId: input.job.runId,
      title: input.job.title ?? null,
      status: input.job.status,
      createdAt: input.job.createdAt,
      startedAt: input.job.startedAt ?? null,
      endedAt: input.job.endedAt ?? null,
      outputPath: input.outputPath,
      configPath: input.configPath,
      generatedConfigHash: hashFile(input.configPath),
      seed: input.seed,
      seedsPerPoint: input.seedsPerPoint ?? null,
      seeds: input.seeds ?? [],
      basePolicy: input.basePolicy ?? null,
      maxWorkers: input.maxWorkers ?? null,
      overriddenParameters: input.overriddenParameters,
      outputHash: input.outputHash,
      exitCode: input.job.exitCode ?? null,
      signal: input.job.signal ?? null
    }
  };
}

export function writeManualRunManifest(input: Parameters<typeof buildManualRunManifest>[0]): void {
  fs.mkdirSync(input.outputPath, { recursive: true });
  fs.writeFileSync(
    path.join(input.outputPath, RUN_MANIFEST_FILE_NAME),
    `${JSON.stringify(buildManualRunManifest(input), null, 2)}\n`,
    'utf-8'
  );
}

export function buildSensitivityRunManifest(input: {
  paths: RuntimePaths;
  launcher: ModelLauncher;
  experiment: {
    experimentId: string;
    title?: string;
    baseline: string;
    basePolicy?: string | null;
    status: string;
    createdAt: string;
    startedAt?: string;
    endedAt?: string;
    seedsPerPoint?: number | null;
    seeds?: number[];
    maxWorkers?: number | null;
    generalOverrides?: Record<string, number | boolean>;
    parameter: {
      key: string;
      title: string;
      description: string;
      packageId?: string;
      parameterKeys?: string[];
      baselineValue: number | null;
      baselineValuesByKey?: Record<string, number>;
      min: number;
      max: number;
      sampleCount: number;
    };
  };
  summaryPayload: unknown;
  points: SensitivityRunManifestPoint[];
}): SensitivityRunManifest {
  const now = new Date().toISOString();
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    manifestType: 'sensitivity-experiment',
    generatedAt: input.experiment.createdAt,
    updatedAt: now,
    environment: buildEnvironment(input.paths),
    launcher: buildLauncher(input.launcher),
    javaRuntime: buildJavaRuntime(input.launcher),
    modelArtifact: buildModelArtifact(input.launcher),
    inputData: buildInputData(input.paths, input.experiment.baseline),
    experiment: {
      experimentId: input.experiment.experimentId,
      title: input.experiment.title ?? null,
      baseline: input.experiment.baseline,
      basePolicy: input.experiment.basePolicy ?? null,
      status: input.experiment.status,
      createdAt: input.experiment.createdAt,
      startedAt: input.experiment.startedAt ?? null,
      endedAt: input.experiment.endedAt ?? null,
      seedsPerPoint: input.experiment.seedsPerPoint ?? null,
      seeds: input.experiment.seeds ?? [],
      maxWorkers: input.experiment.maxWorkers ?? null,
      generalOverrides: input.experiment.generalOverrides ?? {},
      parameter: input.experiment.parameter,
      summaryHash: hashJson(input.summaryPayload),
      points: input.points
    }
  };
}

export function writeSensitivityRunManifest(
  outputDir: string,
  input: Parameters<typeof buildSensitivityRunManifest>[0]
): void {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, RUN_MANIFEST_FILE_NAME),
    `${JSON.stringify(buildSensitivityRunManifest(input), null, 2)}\n`,
    'utf-8'
  );
}
