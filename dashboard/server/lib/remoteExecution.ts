// Author: Max Stoddard
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DescribeInstancesCommand,
  EC2Client,
  type InstanceStateName
} from '@aws-sdk/client-ec2';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import {
  CancelCommandCommand,
  DescribeInstanceInformationCommand,
  GetCommandInvocationCommand,
  SendCommandCommand,
  SSMClient,
  type CommandInvocationStatus,
  type PingStatus
} from '@aws-sdk/client-ssm';
import type {
  ExperimentJobLogsPayload,
  ExperimentJobDeleteResponse,
  ExperimentJobsPayload,
  ExperimentJobSummary,
  ModelRunJob,
  ModelRunJobClearResponse,
  ModelRunJobLogsPayload,
  ModelRunJobsPayload,
  ModelRunOptionsPayload,
  ModelRunSubmitRequest,
  ModelRunSubmitResponse,
  ModelRunWarning,
  RemoteExecutionStatus,
  LendingDistributionComparePayload,
  LendingDistributionPayload,
  ResultsComparePayload,
  ResultsFileManifestEntry,
  ResultsFileType,
  ResultsRunDetail,
  ResultsRunSummary,
  ResultsSeriesPayload,
  SensitivityExperimentChartsPayload,
  SensitivityExperimentCreateRequest,
  SensitivityExperimentDetailPayload,
  SensitivityExperimentListPayload,
  SensitivityExperimentLogsPayload,
  SensitivityExperimentMetadata,
  SensitivityExperimentResultsPayload,
  SensitivityExperimentSubmitResponse,
  SensitivityExperimentSummary,
  ExperimentProgressSnapshot
} from '../../shared/types';
import { prepareModelRunSubmission } from './modelRuns';
import {
  getResultsCompare,
  getResultsRunDetail,
  getResultsRunFiles,
  getResultsSeries,
  REQUIRED_RESULTS_PARSE_FILE_NAMES,
  resolveResultsFileType,
  SALE_TRANSACTIONS_FILE_NAME
} from './results';
import { getLendingDistribution, getLendingDistributionCompare } from './lendingDistribution';
import {
  prepareSensitivityExperimentSubmission,
  type PreparedSensitivityExperimentSubmission
} from './sensitivityRuns';
import {
  createRemoteResultArchive,
  type ResultArchive
} from './resultDownloads';
import type { RuntimePaths, RuntimePathInput } from './runtimePaths';

/** Beyond the required parse set: the loan-level file and the config the caps are read from. */
const LENDING_WORKSPACE_FILE_NAMES = [SALE_TRANSACTIONS_FILE_NAME, 'config.properties'];

const INDEX_KEY = 'experiments/remote-job-index/index.json';
const SOURCE_MANIFEST_KEY = 'tmp/github-actions/source/current-deploy.json';
const REQUEST_PREFIX = 'tmp/dashboard-remote/requests';
const SSM_DOCUMENT_NAME = 'AWS-RunShellScript';
const REMOTE_LOG_GROUP = '/aws/ssm/uk-housing-market-abm-remote-experiments';
const COMMAND_TIMEOUT_SECONDS = 24 * 60 * 60;
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'canceled']);
const DEFAULT_MANUAL_RESULT_RUN_ID = 'default';
const REMOTE_JOB_INDEX_UNAVAILABLE_MESSAGE =
  'Remote experiment execution is temporarily unavailable because the remote job index cannot be read.';

type RemoteJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
type RemoteJobType = 'manual' | 'sensitivity';

export interface RemoteExecutionConfig {
  region: string;
  runnerInstanceId: string;
  artifactsBucket: string;
  maxActiveRemoteRuns: number;
}

interface SourceDeployManifest {
  commit: string;
  bundleKey: string;
  createdAt?: string;
}

interface RemoteJobRecord {
  schemaVersion: 1;
  jobRef: string;
  type: RemoteJobType;
  id: string;
  title?: string;
  status: RemoteJobStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  baseline: string;
  runId?: string;
  seedsPerPoint?: number;
  seeds?: number[];
  maxWorkers?: number;
  outputPath: string;
  configPath: string;
  artifactS3Prefix: string;
  requestKey: string;
  sourceCommit: string;
  sourceBundleKey: string;
  ssmCommandId?: string;
  failureReason?: string;
  warnings: ModelRunWarning[];
  sensitivityMetadata?: SensitivityExperimentMetadata;
}

interface RemoteJobIndex {
  schemaVersion: 1;
  updatedAt: string;
  jobs: RemoteJobRecord[];
}

interface RemoteRunRequest {
  schemaVersion: 1;
  jobRef: string;
  type: RemoteJobType;
  createdAt: string;
  sourceCommit: string;
  sourceBundleKey: string;
  artifactS3Prefix: string;
  payload: ModelRunSubmitRequest | SensitivityExperimentCreateRequest;
  preparedSensitivity?: {
    experimentId: string;
  };
}

export class RemoteExecutionUnavailableError extends Error {
  constructor(message = REMOTE_JOB_INDEX_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = 'RemoteExecutionUnavailableError';
  }
}

function isAccessDeniedError(error: unknown): boolean {
  const details = error as { name?: string; Code?: string; '$metadata'?: { httpStatusCode?: number } };
  return details.name === 'AccessDenied' || details.Code === 'AccessDenied' || details.$metadata?.httpStatusCode === 403;
}

export interface RemoteAwsAdapter {
  getRunnerStatus(instanceId: string): Promise<RemoteExecutionStatus>;
  getSourceDeployManifest(bucket: string): Promise<SourceDeployManifest>;
  putJson(bucket: string, key: string, value: unknown): Promise<void>;
  getJson<T>(bucket: string, key: string): Promise<T | null>;
  getBytes(bucket: string, key: string): Promise<Buffer | null>;
  getText(bucket: string, key: string): Promise<string | null>;
  listObjects(bucket: string, prefix: string): Promise<Array<{
    key: string;
    sizeBytes: number;
    modifiedAt: string | null;
  }>>;
  sendRunCommand(input: {
    instanceId: string;
    bucket: string;
    region: string;
    requestKey: string;
    jobRef: string;
  }): Promise<string>;
  getCommandInvocation(instanceId: string, commandId: string): Promise<{
    status: CommandInvocationStatus | string;
    stdout: string;
    stderr: string;
  } | null>;
  cancelCommand(instanceId: string, commandId: string): Promise<void>;
  deleteObjects(bucket: string, keys: string[]): Promise<void>;
}

function envValue(name: string): string {
  return process.env[name]?.trim() ?? '';
}

export function getExecutionBackendFromEnv(): 'local_maven' | 'aws_ssm' {
  return envValue('DASHBOARD_EXECUTION_BACKEND').toLowerCase() === 'aws_ssm' ? 'aws_ssm' : 'local_maven';
}

export function createRemoteExecutionConfigFromEnv(): RemoteExecutionConfig | null {
  if (getExecutionBackendFromEnv() !== 'aws_ssm') {
    return null;
  }

  const region = envValue('AWS_REGION') || envValue('AWS_DEFAULT_REGION') || 'eu-west-2';
  const runnerInstanceId = envValue('AWS_RUNNER_INSTANCE_ID');
  const artifactsBucket = envValue('AWS_ARTIFACTS_BUCKET');
  const rawMaxActive = Number.parseInt(envValue('DASHBOARD_MAX_ACTIVE_REMOTE_RUNS') || '1', 10);

  if (!runnerInstanceId || !artifactsBucket) {
    return null;
  }

  return {
    region,
    runnerInstanceId,
    artifactsBucket,
    maxActiveRemoteRuns: Number.isFinite(rawMaxActive) && rawMaxActive > 0 ? rawMaxActive : 1
  };
}

function isoNow(): string {
  return new Date().toISOString();
}

function isActive(status: RemoteJobStatus): boolean {
  return status === 'queued' || status === 'running';
}

function isDefaultManualResultRunId(runId: string): boolean {
  return runId.trim().toLowerCase() === DEFAULT_MANUAL_RESULT_RUN_ID;
}

function sanitizeS3Segment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._=-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return sanitized || 'run';
}

function utcDateFragment(date: Date): string {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toLines(text: string | null): string[] {
  if (!text) {
    return [];
  }
  return text.split(/\r?\n/).filter((line) => line.length > 0);
}

function sliceLogLines(lines: string[], cursor = 0, limit = 200) {
  const safeCursor = Number.isFinite(cursor) && cursor > 0 ? Math.floor(cursor) : 0;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 1000) : 200;
  const selected = lines.slice(safeCursor, safeCursor + safeLimit);
  const nextCursor = safeCursor + selected.length;
  return {
    cursor: safeCursor,
    nextCursor,
    lines: selected,
    hasMore: nextCursor < lines.length,
    truncated: false
  };
}

interface RemoteLogPayload {
  lines: string[];
  progress?: ExperimentProgressSnapshot;
}

const PROGRESS_LOG_PREFIX = '[progress] ';

function isExperimentProgressSnapshot(value: unknown): value is ExperimentProgressSnapshot {
  const candidate = value as Partial<ExperimentProgressSnapshot> | null;
  return Boolean(
    candidate &&
      (candidate.kind === 'sensitivity' || candidate.kind === 'manual') &&
      typeof candidate.totalRuns === 'number' &&
      typeof candidate.percentComplete === 'number' &&
      typeof candidate.updatedAt === 'string'
  );
}

function parseProgressLogLine(line: string): ExperimentProgressSnapshot | null {
  if (!line.startsWith(PROGRESS_LOG_PREFIX)) {
    return null;
  }
  try {
    const parsed = JSON.parse(line.slice(PROGRESS_LOG_PREFIX.length)) as unknown;
    return isExperimentProgressSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeRemoteSensitivityLogLine(job: RemoteJobRecord, line: string): string | null {
  if (line.startsWith(PROGRESS_LOG_PREFIX)) {
    return null;
  }
  const jobPrefix = `[sensitivity:${job.id}] `;
  if (line.startsWith(jobPrefix)) {
    return line.slice(jobPrefix.length);
  }
  if (line.startsWith('[system] ') || line.startsWith('[stderr] ')) {
    return line;
  }
  return null;
}

function createRemoteSensitivityLogPayload(job: RemoteJobRecord, rawLines: string[]): RemoteLogPayload {
  let progress: ExperimentProgressSnapshot | undefined;
  const lines = [`[system] Remote job ${job.jobRef} status=${job.status}`];

  for (const line of rawLines) {
    const parsedProgress = parseProgressLogLine(line);
    if (parsedProgress) {
      progress = {
        ...parsedProgress,
        status: job.status
      };
      continue;
    }

    const normalized = normalizeRemoteSensitivityLogLine(job, line);
    if (normalized) {
      lines.push(normalized);
    }
  }

  return {
    lines,
    ...(progress ? { progress } : {})
  };
}

function createRemoteManualLogPayload(job: RemoteJobRecord, rawLines: string[]): RemoteLogPayload {
  let progress: ExperimentProgressSnapshot | undefined;
  const lines = [`[system] Remote job ${job.jobRef} status=${job.status}`];

  for (const line of rawLines) {
    const parsedProgress = parseProgressLogLine(line);
    if (parsedProgress) {
      progress = {
        ...parsedProgress,
        status: job.status
      };
      continue;
    }
    lines.push(line);
  }

  return {
    lines,
    ...(progress ? { progress } : {})
  };
}

function normalizeRemoteManualSsmLogLine(streamName: 'stdout' | 'stderr', line: string): string {
  return line.startsWith(PROGRESS_LOG_PREFIX) ? line : `[${streamName}] ${line}`;
}

function mapSsmStatus(status: string): RemoteJobStatus {
  if (status === 'Success') {
    return 'succeeded';
  }
  if (status === 'Cancelled' || status === 'Cancelling') {
    return 'canceled';
  }
  if (
    status === 'Failed' ||
    status === 'TimedOut' ||
    status === 'ExecutionTimedOut' ||
    status === 'DeliveryTimedOut' ||
    status === 'Undeliverable' ||
    status === 'Terminated'
  ) {
    return 'failed';
  }
  return 'running';
}

function normalizePositiveInteger(value: number | null | undefined): number | null {
  if (!Number.isFinite(value) || value === null || value === undefined) {
    return null;
  }
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : null;
}

function runnerVCpusFromCpuOptions(cpuOptions: { CoreCount?: number; ThreadsPerCore?: number } | undefined): number | null {
  const coreCount = normalizePositiveInteger(cpuOptions?.CoreCount);
  const threadsPerCore = normalizePositiveInteger(cpuOptions?.ThreadsPerCore);
  if (!coreCount || !threadsPerCore) {
    return null;
  }
  return coreCount * threadsPerCore;
}

function workerCapFromStatus(status: RemoteExecutionStatus): number {
  return normalizePositiveInteger(status.runnerVCpus) ?? 1;
}

function capPayloadMaxWorkers<T extends { maxWorkers?: number }>(
  payload: T,
  workerCap: number
): T {
  const cappedWorkerCap = Math.max(1, Math.trunc(workerCap));
  if (payload.maxWorkers === undefined || payload.maxWorkers === null) {
    return {
      ...payload,
      maxWorkers: cappedWorkerCap
    };
  }

  return {
    ...payload,
    maxWorkers: Math.min(payload.maxWorkers, cappedWorkerCap)
  };
}

function streamBodyToBuffer(body: unknown): Promise<Buffer> {
  const maybeTransform = body as { transformToByteArray?: () => Promise<Uint8Array> } | null;
  if (maybeTransform?.transformToByteArray) {
    return maybeTransform.transformToByteArray().then((bytes) => Buffer.from(bytes));
  }

  const readable = body as AsyncIterable<Uint8Array> | null;
  if (!readable) {
    return Promise.resolve(Buffer.alloc(0));
  }

  return (async () => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of readable) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  })();
}

export class AwsSdkRemoteAdapter implements RemoteAwsAdapter {
  private readonly ec2: EC2Client;
  private readonly ssm: SSMClient;
  private readonly s3: S3Client;

  constructor(region: string) {
    this.ec2 = new EC2Client({ region });
    this.ssm = new SSMClient({ region });
    this.s3 = new S3Client({ region });
  }

  async getRunnerStatus(instanceId: string): Promise<RemoteExecutionStatus> {
    const checkedAt = isoNow();
    try {
      const [instanceResult, ssmResult] = await Promise.all([
        this.ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] })),
        this.ssm.send(new DescribeInstanceInformationCommand({
          Filters: [{ Key: 'InstanceIds', Values: [instanceId] }]
        }))
      ]);

      const instance = instanceResult.Reservations?.flatMap((reservation) => reservation.Instances ?? [])[0];
      const runnerState = (instance?.State?.Name ?? null) as InstanceStateName | null;
      const ssmPingStatus = (ssmResult.InstanceInformationList?.[0]?.PingStatus ?? null) as PingStatus | null;
      const runnerVCpus = runnerVCpusFromCpuOptions(instance?.CpuOptions);
      const available = runnerState === 'running' && ssmPingStatus === 'Online';
      const reason = available
        ? null
        : runnerState !== 'running'
          ? `EC2 runner is ${runnerState ?? 'unknown'}.`
          : `SSM runner status is ${ssmPingStatus ?? 'unknown'}.`;

      return {
        backend: 'aws_ssm',
        configured: true,
        available,
        runnerInstanceId: instanceId,
        runnerState,
        ssmPingStatus,
        runnerVCpus,
        reason,
        checkedAt
      };
    } catch (error) {
      return {
        backend: 'aws_ssm',
        configured: true,
        available: false,
        runnerInstanceId: instanceId,
        runnerState: null,
        ssmPingStatus: null,
        runnerVCpus: null,
        reason: (error as Error).message,
        checkedAt
      };
    }
  }

  async getSourceDeployManifest(bucket: string): Promise<SourceDeployManifest> {
    const manifest = await this.getJson<SourceDeployManifest>(bucket, SOURCE_MANIFEST_KEY);
    if (!manifest?.commit || !manifest.bundleKey) {
      throw new Error(`Missing deploy source manifest at s3://${bucket}/${SOURCE_MANIFEST_KEY}.`);
    }
    return manifest;
  }

  async putJson(bucket: string, key: string, value: unknown): Promise<void> {
    await this.s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: `${JSON.stringify(value, null, 2)}\n`,
      ContentType: 'application/json',
      ServerSideEncryption: 'AES256'
    }));
  }

  async getJson<T>(bucket: string, key: string): Promise<T | null> {
    const text = await this.getText(bucket, key);
    return text ? (JSON.parse(text) as T) : null;
  }

  async getBytes(bucket: string, key: string): Promise<Buffer | null> {
    try {
      const result = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return await streamBodyToBuffer(result.Body);
    } catch (error) {
      if (error instanceof NoSuchKey || (error as { name?: string }).name === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }

  async getText(bucket: string, key: string): Promise<string | null> {
    const bytes = await this.getBytes(bucket, key);
    return bytes === null ? null : bytes.toString('utf-8');
  }

  async listObjects(bucket: string, prefix: string): Promise<Array<{
    key: string;
    sizeBytes: number;
    modifiedAt: string | null;
  }>> {
    const objects: Array<{ key: string; sizeBytes: number; modifiedAt: string | null }> = [];
    let continuationToken: string | undefined;
    do {
      const result = await this.s3.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      }));
      for (const object of result.Contents ?? []) {
        if (!object.Key) {
          continue;
        }
        objects.push({
          key: object.Key,
          sizeBytes: object.Size ?? 0,
          modifiedAt: object.LastModified?.toISOString() ?? null
        });
      }
      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);
    return objects;
  }

  async sendRunCommand(input: {
    instanceId: string;
    bucket: string;
    region: string;
    requestKey: string;
    jobRef: string;
  }): Promise<string> {
    const script = buildRemoteRunnerScript(input);
    const result = await this.ssm.send(new SendCommandCommand({
      InstanceIds: [input.instanceId],
      DocumentName: SSM_DOCUMENT_NAME,
      Comment: `uk-housing-dashboard ${input.jobRef}`.slice(0, 100),
      TimeoutSeconds: COMMAND_TIMEOUT_SECONDS,
      CloudWatchOutputConfig: {
        CloudWatchLogGroupName: REMOTE_LOG_GROUP,
        CloudWatchOutputEnabled: true
      },
      Parameters: {
        commands: [script]
      }
    }));
    const commandId = result.Command?.CommandId;
    if (!commandId) {
      throw new Error('SSM send-command did not return a command id.');
    }
    return commandId;
  }

  async getCommandInvocation(instanceId: string, commandId: string): Promise<{
    status: CommandInvocationStatus | string;
    stdout: string;
    stderr: string;
  } | null> {
    try {
      const result = await this.ssm.send(new GetCommandInvocationCommand({
        CommandId: commandId,
        InstanceId: instanceId
      }));
      return {
        status: result.Status ?? 'Pending',
        stdout: result.StandardOutputContent ?? '',
        stderr: result.StandardErrorContent ?? ''
      };
    } catch (error) {
      if ((error as { name?: string }).name === 'InvocationDoesNotExist') {
        return null;
      }
      throw error;
    }
  }

  async cancelCommand(instanceId: string, commandId: string): Promise<void> {
    await this.ssm.send(new CancelCommandCommand({
      CommandId: commandId,
      InstanceIds: [instanceId]
    }));
  }

  async deleteObjects(bucket: string, keys: string[]): Promise<void> {
    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    for (let start = 0; start < uniqueKeys.length; start += 1000) {
      const batch = uniqueKeys.slice(start, start + 1000);
      if (batch.length === 0) {
        continue;
      }
      await this.s3.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map((Key) => ({ Key })),
          Quiet: true
        }
      }));
    }
  }
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildRemoteRunnerScript(input: {
  instanceId: string;
  bucket: string;
  region: string;
  requestKey: string;
  jobRef: string;
}): string {
  const bucket = shellSingleQuote(input.bucket);
  const region = shellSingleQuote(input.region);
  const requestKey = shellSingleQuote(input.requestKey);
  const jobRef = shellSingleQuote(input.jobRef);

  return `exec /bin/bash <<'REMOTE_RUNNER_SCRIPT'
set -euo pipefail
BUCKET=${bucket}
REGION=${region}
REQUEST_KEY=${requestKey}
JOB_REF=${jobRef}
export HOME="\${HOME:-/var/tmp/uk-housing-dashboard-ssm}"
activate_node_runtime() {
  is_node_22_or_newer() {
    command -v node >/dev/null 2>&1 || return 1
    local major
    major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null)" || return 1
    case "$major" in
      ''|*[!0-9]*) return 1 ;;
    esac
    [ "$major" -ge 22 ]
  }

  if is_node_22_or_newer && command -v npm >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
    NPM_BIN="$(command -v npm)"
    export NODE_BIN NPM_BIN
    echo "[remote] node=$("$NODE_BIN" --version) npm=$("$NPM_BIN" --version)"
    return 0
  fi

  for nvm_dir in "\${NVM_DIR:-}" "$HOME/.nvm" /home/ubuntu/.nvm /home/ssm-user/.nvm /root/.nvm; do
    [ -n "$nvm_dir" ] || continue
    [ -s "$nvm_dir/nvm.sh" ] || continue
    export NVM_DIR="$nvm_dir"
    . "$NVM_DIR/nvm.sh"
    if command -v nvm >/dev/null 2>&1; then
      nvm use 22 >/dev/null 2>&1 || nvm use default >/dev/null 2>&1 || true
    fi
    if is_node_22_or_newer && command -v npm >/dev/null 2>&1; then
      NODE_BIN="$(command -v node)"
      NPM_BIN="$(command -v npm)"
      export NODE_BIN NPM_BIN
      echo "[remote] node=$("$NODE_BIN" --version) npm=$("$NPM_BIN" --version) nvm=$NVM_DIR"
      return 0
    fi
  done

  echo "[remote] Node.js 22+ and npm are required; checked PATH, NVM_DIR, $HOME/.nvm, /home/ubuntu/.nvm, /home/ssm-user/.nvm, and /root/.nvm." >&2
  return 127
}
activate_node_runtime
activate_java_runtime() {
  is_java_25_or_newer() {
    command -v java >/dev/null 2>&1 || return 1
    local version major
    version="$(java -version 2>&1 | awk -F '"' '/version/ { print $2; exit }')" || return 1
    major="\${version%%.*}"
    case "$major" in
      ''|*[!0-9]*) return 1 ;;
    esac
    [ "$major" -ge 25 ]
  }

  if [ -n "\${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
    export PATH="$JAVA_HOME/bin:$PATH"
  fi
  if is_java_25_or_newer; then
    JAVA_BIN="$(command -v java)"
    JAVA_HOME="\${JAVA_HOME:-$(cd "$(dirname "$JAVA_BIN")/.." && pwd)}"
    export JAVA_HOME PATH
    echo "[remote] java=$("$JAVA_BIN" -version 2>&1 | head -n 1) JAVA_HOME=$JAVA_HOME"
    return 0
  fi

  for sdkman_dir in "\${SDKMAN_DIR:-}" "$HOME/.sdkman" /home/ubuntu/.sdkman /home/ssm-user/.sdkman /root/.sdkman; do
    [ -n "$sdkman_dir" ] || continue
    [ -s "$sdkman_dir/bin/sdkman-init.sh" ] || continue
    export SDKMAN_DIR="$sdkman_dir"
    set +u
    . "$SDKMAN_DIR/bin/sdkman-init.sh"
    set -u
    if is_java_25_or_newer; then
      JAVA_BIN="$(command -v java)"
      JAVA_HOME="\${JAVA_HOME:-$(cd "$(dirname "$JAVA_BIN")/.." && pwd)}"
      export JAVA_HOME PATH
      echo "[remote] java=$("$JAVA_BIN" -version 2>&1 | head -n 1) JAVA_HOME=$JAVA_HOME SDKMAN_DIR=$SDKMAN_DIR"
      return 0
    fi
  done

  for java_home in /home/ubuntu/.sdkman/candidates/java/current /home/ubuntu/.sdkman/candidates/java/25* /home/ssm-user/.sdkman/candidates/java/current /root/.sdkman/candidates/java/current; do
    [ -x "$java_home/bin/java" ] || continue
    export JAVA_HOME="$java_home"
    export PATH="$JAVA_HOME/bin:$PATH"
    if is_java_25_or_newer; then
      echo "[remote] java=$("$JAVA_HOME/bin/java" -version 2>&1 | head -n 1) JAVA_HOME=$JAVA_HOME"
      return 0
    fi
  done

  echo "[remote] Java 25+ is required; checked PATH, JAVA_HOME, SDKMAN_DIR, $HOME/.sdkman, /home/ubuntu/.sdkman, /home/ssm-user/.sdkman, and /root/.sdkman." >&2
  return 1
}
activate_java_runtime
RUN_SEGMENT="$("$NODE_BIN" -e 'const value = process.argv[1] || "run"; const sanitized = value.trim().replace(/[^A-Za-z0-9._=-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "run"; process.stdout.write(sanitized);' "$JOB_REF")"
RUN_BASE="$HOME/remote-runs"
RUN_ROOT="$RUN_BASE/$RUN_SEGMENT"
REQUEST_JSON="$RUN_ROOT/request.json"
SOURCE_DIR="$RUN_ROOT/source"
ARTIFACT_DIR="$RUN_ROOT/artifact"
mkdir -p "$RUN_ROOT" "$ARTIFACT_DIR/logs"
exec > >(tee -a "$ARTIFACT_DIR/logs/ssm-command.log") 2>&1
echo "[remote] job=$JOB_REF request=s3://$BUCKET/$REQUEST_KEY"
LIVE_LOG_SYNC_PID=""
cleanup_failure() {
  status=$?
  if [ -n "$LIVE_LOG_SYNC_PID" ]; then
    kill "$LIVE_LOG_SYNC_PID" >/dev/null 2>&1 || true
    wait "$LIVE_LOG_SYNC_PID" >/dev/null 2>&1 || true
  fi
  if [ "$status" -ne 0 ]; then
    "$NODE_BIN" - "$ARTIFACT_DIR/remote-status.json" "$JOB_REF" "$status" <<'NODE' || true
const fs = require('node:fs');
const [path, jobRef, status] = process.argv.slice(2);
fs.mkdirSync(require('node:path').dirname(path), { recursive: true });
fs.writeFileSync(path, JSON.stringify({
  schemaVersion: 1,
  jobRef,
  status: 'failed',
  exitCode: Number(status),
  endedAt: new Date().toISOString()
}, null, 2) + '\\n');
NODE
    if [ -f "$REQUEST_JSON" ]; then
      PREFIX="$("$NODE_BIN" -e "const fs=require('node:fs'); const r=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(r.artifactS3Prefix || '');" "$REQUEST_JSON" || true)"
      if [ -n "$PREFIX" ]; then
        aws s3 sync "$ARTIFACT_DIR/" "s3://$BUCKET/$PREFIX" --region "$REGION" --only-show-errors || true
      fi
    fi
  fi
  exit "$status"
}
trap cleanup_failure EXIT
aws s3 cp "s3://$BUCKET/$REQUEST_KEY" "$REQUEST_JSON" --region "$REGION" --only-show-errors
BUNDLE_KEY="$("$NODE_BIN" -e "const fs=require('node:fs'); const r=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(r.sourceBundleKey);" "$REQUEST_JSON")"
SOURCE_COMMIT="$("$NODE_BIN" -e "const fs=require('node:fs'); const r=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(r.sourceCommit);" "$REQUEST_JSON")"
ARTIFACT_PREFIX="$("$NODE_BIN" -e "const fs=require('node:fs'); const r=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(r.artifactS3Prefix);" "$REQUEST_JSON")"
aws s3 cp "s3://$BUCKET/$BUNDLE_KEY" "$RUN_ROOT/source.bundle" --region "$REGION" --only-show-errors
rm -rf "$SOURCE_DIR"
git clone "$RUN_ROOT/source.bundle" "$SOURCE_DIR"
cd "$SOURCE_DIR"
git checkout --detach "$SOURCE_COMMIT"
git status --short > "$ARTIFACT_DIR/logs/source-status.txt"
cd "$SOURCE_DIR/dashboard"
"$NPM_BIN" ci --include=dev
upload_remote_runner_log() {
  if [ -f "$ARTIFACT_DIR/logs/remote-runner.log" ]; then
    aws s3 cp "$ARTIFACT_DIR/logs/remote-runner.log" "s3://$BUCKET/$ARTIFACT_PREFIX/logs/remote-runner.log" --region "$REGION" --only-show-errors || true
  fi
}
sync_remote_runner_log() {
  while true; do
    upload_remote_runner_log
    sleep 15
  done
}
sync_remote_runner_log &
LIVE_LOG_SYNC_PID="$!"
set +e
"$NODE_BIN" --import tsx/esm server/remoteRunnerCli.ts --request "$REQUEST_JSON" --run-root "$RUN_ROOT/work" --artifact-root "$ARTIFACT_DIR"
REMOTE_RUNNER_STATUS=$?
set -e
kill "$LIVE_LOG_SYNC_PID" >/dev/null 2>&1 || true
wait "$LIVE_LOG_SYNC_PID" >/dev/null 2>&1 || true
LIVE_LOG_SYNC_PID=""
upload_remote_runner_log
if [ "$REMOTE_RUNNER_STATUS" -ne 0 ]; then
  exit "$REMOTE_RUNNER_STATUS"
fi
find "$ARTIFACT_DIR" -type f ! -name output-manifest.sha256 -print0 | sort -z | xargs -0 sha256sum > "$ARTIFACT_DIR/output-manifest.sha256"
aws s3 sync "$ARTIFACT_DIR/" "s3://$BUCKET/$ARTIFACT_PREFIX" --region "$REGION" --only-show-errors
trap - EXIT
echo "[remote] completed job=$JOB_REF prefix=s3://$BUCKET/$ARTIFACT_PREFIX"
REMOTE_RUNNER_SCRIPT
`;
}

interface RemoteRunObject {
  key: string;
  relativeName: string;
  sizeBytes: number;
  modifiedAt: string | null;
  fileType: ResultsFileType;
}

interface RemoteResultsWorkspace {
  tempRoot: string;
  runtimePaths: RuntimePaths;
  objectsByRunId: Map<string, RemoteRunObject[]>;
}

export class RemoteExecutionManager {
  private readonly config: RemoteExecutionConfig;
  private readonly adapter: RemoteAwsAdapter;

  constructor(config: RemoteExecutionConfig, adapter?: RemoteAwsAdapter) {
    this.config = config;
    this.adapter = adapter ?? new AwsSdkRemoteAdapter(config.region);
  }

  async getStatus(): Promise<RemoteExecutionStatus> {
    return this.adapter.getRunnerStatus(this.config.runnerInstanceId);
  }

  async decorateModelRunOptions(options: ModelRunOptionsPayload): Promise<ModelRunOptionsPayload> {
    const status = await this.getStatus();
    const sensitivityMaxWorkersCap = workerCapFromStatus(status);
    return {
      ...options,
      executionEnabled: status.available,
      executionDisabledReason: status.available ? null : status.reason,
      executionBackend: 'aws_ssm',
      remoteExecution: status,
      sensitivityMaxWorkersCap
    };
  }

  async submitModelRun(
    pathsInput: RuntimePathInput,
    payload: ModelRunSubmitRequest
  ): Promise<ModelRunSubmitResponse> {
    const status = await this.getStatus();
    if (!status.available) {
      throw new Error(status.reason ?? 'EC2 experiment runner is unavailable.');
    }
    const cappedPayload = capPayloadMaxWorkers(payload, workerCapFromStatus(status));
    const preparedResult = prepareModelRunSubmission(pathsInput, cappedPayload, { ignoreStorageCap: true });
    if (!preparedResult.accepted) {
      return preparedResult;
    }

    const prepared = preparedResult.prepared;
    const now = new Date();
    const jobRef = `manual:${prepared.jobId}`;
    const artifactS3Prefix = `experiments/manual/${utcDateFragment(now)}/${sanitizeS3Segment(prepared.runId)}/`;
    const requestKey = `${REQUEST_PREFIX}/${sanitizeS3Segment(jobRef)}.json`;
    const source = await this.adapter.getSourceDeployManifest(this.config.artifactsBucket);

    const job: RemoteJobRecord = {
      schemaVersion: 1,
      jobRef,
      type: 'manual',
      id: prepared.jobId,
      title: prepared.title,
      status: 'queued',
      createdAt: now.toISOString(),
      baseline: prepared.baseline,
      runId: prepared.runId,
      seedsPerPoint: prepared.seedsPerPoint,
      seeds: prepared.seeds,
      maxWorkers: prepared.maxWorkers,
      outputPath: `s3://${this.config.artifactsBucket}/${artifactS3Prefix}Results/${prepared.runId}`,
      configPath: `s3://${this.config.artifactsBucket}/${artifactS3Prefix}request.json`,
      artifactS3Prefix,
      requestKey,
      sourceCommit: source.commit,
      sourceBundleKey: source.bundleKey,
      warnings: prepared.warnings
    };

    await this.dispatchRemoteJob(job, cappedPayload);
    return {
      accepted: true,
      warnings: prepared.warnings,
      job: this.toModelRunJob(job)
    };
  }

  async submitSensitivityExperiment(
    pathsInput: RuntimePathInput,
    payload: SensitivityExperimentCreateRequest
  ): Promise<SensitivityExperimentSubmitResponse> {
    const status = await this.getStatus();
    if (!status.available) {
      throw new Error(status.reason ?? 'EC2 experiment runner is unavailable.');
    }
    const cappedPayload = capPayloadMaxWorkers(payload, workerCapFromStatus(status));
    const preparedResult = prepareSensitivityExperimentSubmission(pathsInput, cappedPayload);
    if (!preparedResult.accepted) {
      return preparedResult;
    }

    const prepared = preparedResult.prepared;
    const now = new Date();
    const jobRef = `sensitivity:${prepared.experimentId}`;
    const artifactS3Prefix = `experiments/sensitivity/${utcDateFragment(now)}/${sanitizeS3Segment(prepared.experimentId)}/`;
    const requestKey = `${REQUEST_PREFIX}/${sanitizeS3Segment(jobRef)}.json`;
    const source = await this.adapter.getSourceDeployManifest(this.config.artifactsBucket);
    const metadata = this.toSensitivityMetadata(prepared, now);

    const job: RemoteJobRecord = {
      schemaVersion: 1,
      jobRef,
      type: 'sensitivity',
      id: prepared.experimentId,
      title: prepared.title,
      status: 'queued',
      createdAt: now.toISOString(),
      baseline: prepared.baseline,
      outputPath: `s3://${this.config.artifactsBucket}/${artifactS3Prefix}Results/experiments/sensitivity/${prepared.experimentId}`,
      configPath: `s3://${this.config.artifactsBucket}/${artifactS3Prefix}request.json`,
      artifactS3Prefix,
      requestKey,
      sourceCommit: source.commit,
      sourceBundleKey: source.bundleKey,
      warnings: prepared.warnings,
      sensitivityMetadata: metadata
    };

    await this.dispatchRemoteJob(job, cappedPayload, {
      preparedSensitivity: {
        experimentId: prepared.experimentId
      }
    });
    return {
      accepted: true,
      warnings: prepared.warnings,
      warningSummary: prepared.warningSummary,
      experiment: metadata
    };
  }

  async listModelRunJobs(): Promise<ModelRunJobsPayload> {
    const index = await this.refreshIndex();
    return {
      jobs: index.jobs.filter((job) => job.type === 'manual').map((job) => this.toModelRunJob(job))
    };
  }

  async getModelRunJob(jobId: string): Promise<ModelRunJob> {
    const job = await this.findJob('manual', jobId);
    return this.toModelRunJob(job);
  }

  async getModelRunJobLogs(jobId: string, cursor: number | undefined, limit: number | undefined): Promise<ModelRunJobLogsPayload> {
    const job = await this.findJob('manual', jobId);
    const logPayload = await this.getJobLogPayload(job);
    const slice = sliceLogLines(logPayload.lines, cursor, limit);
    return {
      jobId,
      ...slice,
      done: TERMINAL_STATUSES.has(job.status) && !slice.hasMore,
      ...(logPayload.progress ? { progress: logPayload.progress } : {})
    };
  }

  async clearModelRunJob(jobId: string): Promise<ModelRunJobClearResponse> {
    const index = await this.refreshIndex();
    const job = index.jobs.find((item) => item.type === 'manual' && item.id === jobId);
    if (!job) {
      throw new Error(`Unknown model run job: ${jobId}`);
    }
    if (isActive(job.status)) {
      throw new Error('Only finished jobs can be cleared from the job queue.');
    }
    index.jobs = index.jobs.filter((item) => item.jobRef !== job.jobRef);
    await this.saveIndex(index);
    return { jobId, cleared: true };
  }

  async deleteRemoteManualResultRun(runId: string): Promise<{ runId: string; deleted: boolean }> {
    const normalizedRunId = runId.trim();
    const index = await this.refreshIndex();
    const job = index.jobs.find((item) => item.type === 'manual' && item.runId === normalizedRunId);
    if (!job) {
      throw new Error(`Unknown remote manual result run: ${runId}`);
    }
    await this.deleteRemoteJob(index, job);
    return {
      runId: normalizedRunId,
      deleted: true
    };
  }

  async listRemoteManualResultRuns(): Promise<{ runs: ResultsRunSummary[] }> {
    const index = await this.refreshIndex();
    const summaries = await Promise.all(
      index.jobs
        .filter((job) => job.type === 'manual' && job.runId)
        .map((job) => this.toRemoteResultsSummary(job))
    );
    summaries.sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt));
    return { runs: summaries };
  }

  async getRemoteManualResultDetail(runId: string): Promise<ResultsRunDetail> {
    const job = await this.findManualJobForReadByRunId(runId);
    const workspace = await this.createRemoteResultsWorkspace([job]);
    try {
      const detail = getResultsRunDetail(workspace.runtimePaths, job.runId ?? job.id);
      const summary = this.mergeRemoteSummary(job, workspace.objectsByRunId.get(job.runId ?? job.id) ?? [], detail);
      return {
        ...detail,
        ...summary
      };
    } finally {
      this.removeRemoteResultsWorkspace(workspace);
    }
  }

  async getRemoteManualResultFiles(runId: string): Promise<{ runId: string; files: ResultsFileManifestEntry[] }> {
    const job = await this.findManualJobForReadByRunId(runId);
    const workspace = await this.createRemoteResultsWorkspace([job]);
    try {
      const normalizedRunId = job.runId ?? job.id;
      return {
        runId: normalizedRunId,
        files: this.mergeRemoteManifest(
          job,
          workspace.objectsByRunId.get(normalizedRunId) ?? [],
          getResultsRunFiles(workspace.runtimePaths, normalizedRunId)
        )
      };
    } finally {
      this.removeRemoteResultsWorkspace(workspace);
    }
  }

  async getRemoteManualResultLending(runId: string, window: string | undefined): Promise<LendingDistributionPayload> {
    const job = await this.findManualJobForReadByRunId(runId);
    const workspace = await this.createRemoteResultsWorkspace([job], LENDING_WORKSPACE_FILE_NAMES);
    try {
      return getLendingDistribution(workspace.runtimePaths, job.runId ?? job.id, window);
    } finally {
      this.removeRemoteResultsWorkspace(workspace);
    }
  }

  async getRemoteManualResultLendingCompare(
    runIds: string[],
    window: string | undefined
  ): Promise<LendingDistributionComparePayload> {
    const jobs: RemoteJobRecord[] = [];
    for (const runId of runIds) {
      const job = await this.findManualJobForReadByRunId(runId);
      const resolvedRunId = job.runId ?? job.id;
      if (!jobs.some((entry) => (entry.runId ?? entry.id) === resolvedRunId)) {
        jobs.push(job);
      }
    }
    const workspace = await this.createRemoteResultsWorkspace(jobs, LENDING_WORKSPACE_FILE_NAMES);
    try {
      return getLendingDistributionCompare(
        workspace.runtimePaths,
        jobs.map((job) => job.runId ?? job.id),
        window
      );
    } finally {
      this.removeRemoteResultsWorkspace(workspace);
    }
  }

  async getRemoteManualResultSeries(
    runId: string,
    indicatorId: string,
    smoothWindow: number | undefined
  ): Promise<ResultsSeriesPayload> {
    const job = await this.findManualJobForReadByRunId(runId);
    const workspace = await this.createRemoteResultsWorkspace([job]);
    try {
      return getResultsSeries(workspace.runtimePaths, job.runId ?? job.id, indicatorId, smoothWindow);
    } finally {
      this.removeRemoteResultsWorkspace(workspace);
    }
  }

  async getRemoteManualResultCompare(
    runIds: string[],
    indicatorIds: string[],
    window: string | undefined,
    smoothWindow: number | undefined
  ): Promise<ResultsComparePayload> {
    const jobs: RemoteJobRecord[] = [];
    for (const runId of runIds) {
      const job = await this.findManualJobForReadByRunId(runId);
      const resolvedRunId = job.runId ?? job.id;
      if (!jobs.some((entry) => (entry.runId ?? entry.id) === resolvedRunId)) {
        jobs.push(job);
      }
    }
    const workspace = await this.createRemoteResultsWorkspace(jobs);
    try {
      return getResultsCompare(
        workspace.runtimePaths,
        jobs.map((job) => job.runId ?? job.id),
        indicatorIds,
        window,
        smoothWindow
      );
    } finally {
      this.removeRemoteResultsWorkspace(workspace);
    }
  }

  async getRemoteManualResultArchive(runId: string): Promise<ResultArchive> {
    const job = await this.findManualJobByRunId(runId);
    if (!TERMINAL_STATUSES.has(job.status)) {
      throw new Error(`Remote manual result is not finished yet: ${runId}`);
    }
    const prefix = this.remoteRunResultsPrefix(job);
    const objects = await this.adapter.listObjects(this.config.artifactsBucket, prefix);
    return createRemoteResultArchive({
      archiveRootName: job.runId ?? job.id,
      fileName: `${job.runId ?? job.id}.tar.gz`,
      prefix,
      objects,
      readObjectBytes: (key) => this.adapter.getBytes(this.config.artifactsBucket, key)
    });
  }

  async listSensitivityExperiments(): Promise<SensitivityExperimentListPayload> {
    const index = await this.refreshIndex();
    return {
      experiments: index.jobs
        .filter((job) => job.type === 'sensitivity')
        .map((job) => this.toSensitivitySummary(job))
    };
  }

  async deleteSensitivityExperiment(experimentId: string): Promise<{ experimentId: string; deleted: boolean }> {
    const normalizedExperimentId = experimentId.trim();
    const index = await this.refreshIndex();
    const job = index.jobs.find((item) => item.type === 'sensitivity' && item.id === normalizedExperimentId);
    if (!job) {
      throw new Error(`Unknown sensitivity experiment: ${experimentId}`);
    }
    await this.deleteRemoteJob(index, job);
    return {
      experimentId: normalizedExperimentId,
      deleted: true
    };
  }

  async getSensitivityExperiment(experimentId: string): Promise<SensitivityExperimentDetailPayload> {
    const job = await this.findJob('sensitivity', experimentId);
    const metadata = await this.getRemoteSensitivityMetadata(job);
    return { experiment: metadata };
  }

  async getSensitivityExperimentResults(experimentId: string): Promise<SensitivityExperimentResultsPayload> {
    const job = await this.findJob('sensitivity', experimentId);
    const summary = await this.adapter.getJson<{ results: SensitivityExperimentResultsPayload }>(
      this.config.artifactsBucket,
      `${job.artifactS3Prefix}Results/experiments/sensitivity/${experimentId}/summary.json`
    );
    return summary?.results ?? {
      experimentId,
      baselinePointId: null,
      points: []
    };
  }

  async getSensitivityExperimentCharts(experimentId: string): Promise<SensitivityExperimentChartsPayload> {
    const job = await this.findJob('sensitivity', experimentId);
    const metadata = await this.getRemoteSensitivityMetadata(job);
    const summary = await this.adapter.getJson<{ charts: SensitivityExperimentChartsPayload }>(
      this.config.artifactsBucket,
      `${job.artifactS3Prefix}Results/experiments/sensitivity/${experimentId}/summary.json`
    );
    return summary?.charts ?? {
      experimentId,
      parameter: metadata.parameter,
      windowType: 'post_200',
      tornado: [],
      deltaTrend: []
    };
  }

  async getSensitivityExperimentArchive(experimentId: string): Promise<ResultArchive> {
    const job = await this.findJob('sensitivity', experimentId);
    if (!TERMINAL_STATUSES.has(job.status)) {
      throw new Error(`Remote sensitivity experiment is not finished yet: ${experimentId}`);
    }
    const prefix = `${job.artifactS3Prefix}Results/experiments/sensitivity/${experimentId}/`;
    const objects = await this.adapter.listObjects(this.config.artifactsBucket, prefix);
    return createRemoteResultArchive({
      archiveRootName: experimentId,
      fileName: `${experimentId}.tar.gz`,
      prefix,
      objects,
      readObjectBytes: (key) => this.adapter.getBytes(this.config.artifactsBucket, key)
    });
  }

  async getSensitivityExperimentLogs(
    experimentId: string,
    cursor: number | undefined,
    limit: number | undefined
  ): Promise<SensitivityExperimentLogsPayload> {
    const job = await this.findJob('sensitivity', experimentId);
    const logPayload = await this.getJobLogPayload(job);
    const slice = sliceLogLines(logPayload.lines, cursor, limit);
    return {
      experimentId,
      ...slice,
      done: TERMINAL_STATUSES.has(job.status) && !slice.hasMore,
      progress: logPayload.progress
    };
  }

  async listExperimentJobs(): Promise<ExperimentJobsPayload> {
    const index = await this.refreshIndex();
    const jobs = index.jobs
      .map((job) => this.toExperimentJobSummary(job))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    const activeManual = jobs.find((job) => job.type === 'manual' && isActive(job.status as RemoteJobStatus)) ?? null;
    const activeSensitivity = jobs.find((job) => job.type === 'sensitivity' && isActive(job.status as RemoteJobStatus)) ?? null;
    return {
      jobs,
      locks: {
        manualSubmissionLocked: false,
        sensitivitySubmissionLocked: false,
        activeManualJobRef: activeManual?.jobRef ?? null,
        activeSensitivityJobRef: activeSensitivity?.jobRef ?? null
      }
    };
  }

  async getExperimentJobLogs(jobRef: string, cursor: number | undefined, limit: number | undefined): Promise<ExperimentJobLogsPayload> {
    const job = await this.findJobByRef(jobRef);
    const logPayload = await this.getJobLogPayload(job);
    const slice = sliceLogLines(logPayload.lines, cursor, limit);
    return {
      jobRef: job.jobRef,
      type: job.type,
      ...slice,
      done: TERMINAL_STATUSES.has(job.status) && !slice.hasMore,
      ...(logPayload.progress ? { progress: logPayload.progress } : {})
    };
  }

  async cancelExperimentJob(jobRef: string): Promise<{ job: ExperimentJobSummary }> {
    const index = await this.refreshIndex();
    const job = index.jobs.find((item) => item.jobRef === jobRef);
    if (!job) {
      throw new Error(`Unknown experiment jobRef: ${jobRef}`);
    }
    if (TERMINAL_STATUSES.has(job.status)) {
      return { job: this.toExperimentJobSummary(job) };
    }
    if (job.ssmCommandId) {
      await this.adapter.cancelCommand(this.config.runnerInstanceId, job.ssmCommandId);
    }
    job.status = 'canceled';
    job.endedAt = isoNow();
    await this.saveIndex(index);
    await this.startQueuedRemoteJobs(index);
    return { job: this.toExperimentJobSummary(job) };
  }

  async deleteExperimentJob(jobRef: string): Promise<ExperimentJobDeleteResponse> {
    const index = await this.refreshIndex();
    const job = index.jobs.find((item) => item.jobRef === jobRef.trim());
    if (!job) {
      throw new Error(`Unknown experiment jobRef: ${jobRef}`);
    }
    await this.deleteRemoteJob(index, job);
    return {
      jobRef: job.jobRef,
      type: job.type,
      id: job.id,
      ...(job.runId ? { runId: job.runId } : {}),
      deleted: true
    };
  }

  private async deleteRemoteJob(index: RemoteJobIndex, job: RemoteJobRecord): Promise<void> {
    if (isActive(job.status)) {
      throw new Error('Only finished remote experiment jobs can be deleted.');
    }
    const expectedArtifactPrefix = job.type === 'manual' ? 'experiments/manual/' : 'experiments/sensitivity/';
    if (!job.artifactS3Prefix.startsWith(expectedArtifactPrefix)) {
      throw new Error(`Refusing to delete unexpected remote artifact prefix: ${job.artifactS3Prefix}`);
    }
    if (!job.requestKey.startsWith(`${REQUEST_PREFIX}/`)) {
      throw new Error(`Refusing to delete unexpected remote request key: ${job.requestKey}`);
    }

    const artifactObjects = await this.adapter.listObjects(this.config.artifactsBucket, job.artifactS3Prefix);
    await this.adapter.deleteObjects(this.config.artifactsBucket, [
      job.requestKey,
      ...artifactObjects.map((object) => object.key)
    ]);
    index.jobs = index.jobs.filter((item) => item.jobRef !== job.jobRef);
    await this.saveIndex(index);
  }

  private async dispatchRemoteJob(
    job: RemoteJobRecord,
    payload: ModelRunSubmitRequest | SensitivityExperimentCreateRequest,
    prepared?: Pick<RemoteRunRequest, 'preparedSensitivity'>
  ): Promise<void> {
    const status = await this.getStatus();
    if (!status.available) {
      throw new Error(status.reason ?? 'EC2 experiment runner is unavailable.');
    }

    const index = await this.refreshIndex();
    const request: RemoteRunRequest = {
      schemaVersion: 1,
      jobRef: job.jobRef,
      type: job.type,
      createdAt: job.createdAt,
      sourceCommit: job.sourceCommit,
      sourceBundleKey: job.sourceBundleKey,
      artifactS3Prefix: job.artifactS3Prefix,
      payload,
      ...(prepared?.preparedSensitivity ? { preparedSensitivity: prepared.preparedSensitivity } : {})
    };
    await this.adapter.putJson(this.config.artifactsBucket, job.requestKey, request);
    index.jobs.push(job);
    await this.saveIndex(index);
    await this.startQueuedRemoteJobs(index);
    if (job.status === 'failed') {
      throw new Error(job.failureReason ?? `Failed to start remote experiment ${job.jobRef}.`);
    }
  }

  private async startQueuedRemoteJobs(index: RemoteJobIndex): Promise<void> {
    let availableSlots = Math.max(
      0,
      this.config.maxActiveRemoteRuns - index.jobs.filter((item) => item.status === 'running').length
    );
    if (availableSlots === 0) {
      return;
    }

    const queuedJobs = index.jobs.filter((item) => item.status === 'queued' && !item.ssmCommandId);
    let changed = false;
    for (const queuedJob of queuedJobs) {
      if (availableSlots === 0) {
        break;
      }
      try {
        const commandId = await this.adapter.sendRunCommand({
          instanceId: this.config.runnerInstanceId,
          bucket: this.config.artifactsBucket,
          region: this.config.region,
          requestKey: queuedJob.requestKey,
          jobRef: queuedJob.jobRef
        });
        queuedJob.ssmCommandId = commandId;
        queuedJob.status = 'running';
        queuedJob.startedAt = isoNow();
        availableSlots -= 1;
      } catch (error) {
        queuedJob.status = 'failed';
        queuedJob.endedAt = isoNow();
        queuedJob.failureReason = (error as Error).message.slice(0, 500);
      }
      changed = true;
    }

    if (changed) {
      await this.saveIndex(index);
    }
  }

  private async loadIndex(): Promise<RemoteJobIndex> {
    let index: RemoteJobIndex | null;
    try {
      index = await this.adapter.getJson<RemoteJobIndex>(this.config.artifactsBucket, INDEX_KEY);
    } catch (error) {
      if (isAccessDeniedError(error)) {
        throw new RemoteExecutionUnavailableError();
      }
      throw error;
    }
    return index ?? {
      schemaVersion: 1,
      updatedAt: isoNow(),
      jobs: []
    };
  }

  private async saveIndex(index: RemoteJobIndex): Promise<void> {
    index.updatedAt = isoNow();
    await this.adapter.putJson(this.config.artifactsBucket, INDEX_KEY, index);
  }

  private async refreshIndex(): Promise<RemoteJobIndex> {
    const index = await this.loadIndex();
    let changed = false;
    for (const job of index.jobs) {
      if (!job.ssmCommandId || TERMINAL_STATUSES.has(job.status)) {
        continue;
      }
      const invocation = await this.adapter.getCommandInvocation(this.config.runnerInstanceId, job.ssmCommandId);
      if (!invocation) {
        continue;
      }
      const nextStatus = mapSsmStatus(invocation.status);
      if (nextStatus !== job.status) {
        job.status = nextStatus;
        changed = true;
      }
      if (TERMINAL_STATUSES.has(nextStatus) && !job.endedAt) {
        job.endedAt = isoNow();
        changed = true;
      }
      if (nextStatus === 'failed' && invocation.stderr && !job.failureReason) {
        job.failureReason = invocation.stderr.split(/\r?\n/).find(Boolean)?.slice(0, 500);
        changed = true;
      }
    }
    if (changed) {
      await this.saveIndex(index);
    }
    await this.startQueuedRemoteJobs(index);
    return index;
  }

  private async findJob(type: RemoteJobType, id: string): Promise<RemoteJobRecord> {
    const index = await this.refreshIndex();
    const job = index.jobs.find((item) => item.type === type && item.id === id.trim());
    if (!job) {
      throw new Error(type === 'manual' ? `Unknown model run job: ${id}` : `Unknown sensitivity experiment: ${id}`);
    }
    return job;
  }

  private async findJobByRef(jobRef: string): Promise<RemoteJobRecord> {
    const index = await this.refreshIndex();
    const job = index.jobs.find((item) => item.jobRef === jobRef.trim());
    if (!job) {
      throw new Error(`Unknown experiment jobRef: ${jobRef}`);
    }
    return job;
  }

  private async findManualJobByRunId(runId: string): Promise<RemoteJobRecord> {
    const normalizedRunId = runId.trim();
    const index = await this.refreshIndex();
    const job = index.jobs.find((item) => item.type === 'manual' && item.runId === normalizedRunId);
    if (!job) {
      throw new Error(`Unknown remote manual result run: ${runId}`);
    }
    return job;
  }

  private async findManualJobForReadByRunId(runId: string): Promise<RemoteJobRecord> {
    if (!isDefaultManualResultRunId(runId)) {
      return this.findManualJobByRunId(runId);
    }

    const runs = await this.listRemoteManualResultRuns();
    const resolvedRunId = runs.runs[0]?.runId;
    if (!resolvedRunId) {
      throw new Error('No remote manual result runs are available.');
    }
    return this.findManualJobByRunId(resolvedRunId);
  }

  private remoteRunResultsPrefix(job: RemoteJobRecord): string {
    return `${job.artifactS3Prefix}Results/${job.runId ?? job.id}/`;
  }

  private async listRemoteRunObjects(job: RemoteJobRecord): Promise<RemoteRunObject[]> {
    const prefix = this.remoteRunResultsPrefix(job);
    const objects = await this.adapter.listObjects(this.config.artifactsBucket, prefix);
    const files: RemoteRunObject[] = [];
    for (const object of objects) {
      const relativeName = object.key.slice(prefix.length);
      if (!relativeName || relativeName.includes('/')) {
        continue;
      }
      const fileType = resolveResultsFileType(relativeName);
      files.push({
        key: object.key,
        relativeName,
        sizeBytes: object.sizeBytes,
        modifiedAt: object.modifiedAt,
        fileType
      });
    }
    return files.sort((left, right) => left.relativeName.localeCompare(right.relativeName));
  }

  private async createRemoteResultsWorkspace(
    jobs: RemoteJobRecord[],
    additionalFileNames: string[] = []
  ): Promise<RemoteResultsWorkspace> {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-remote-results-'));
    const resultsRoot = path.join(tempRoot, 'Results');
    fs.mkdirSync(resultsRoot, { recursive: true });
    const runtimePaths: RuntimePaths = {
      mode: 'development',
      repoRoot: tempRoot,
      dataRoot: path.join(tempRoot, 'input-data-versions'),
      resultsRoot,
      tempRoot: path.join(tempRoot, 'tmp'),
      logsRoot: path.join(tempRoot, 'logs')
    };
    const parseFileNames = new Set(REQUIRED_RESULTS_PARSE_FILE_NAMES);
    const objectsByRunId = new Map<string, RemoteRunObject[]>();

    // Callers that need files beyond the required parse set (the loan-level transaction file
    // and the run config) also need the per-seed copies, which multi-seed runs never merge up
    // to the run root.
    const wantsObject = (relativeName: string): boolean => {
      if (parseFileNames.has(relativeName)) {
        return true;
      }
      if (additionalFileNames.length === 0) {
        return false;
      }
      const baseName = relativeName.split('/').pop() ?? relativeName;
      return additionalFileNames.includes(baseName) && (relativeName === baseName || relativeName.startsWith('seeds/'));
    };

    try {
      for (const job of jobs) {
        const runId = job.runId ?? job.id;
        const runPath = path.join(resultsRoot, runId);
        fs.mkdirSync(runPath, { recursive: true });
        const objects = await this.listRemoteRunObjects(job);
        objectsByRunId.set(runId, objects);
        for (const object of objects) {
          if (!wantsObject(object.relativeName)) {
            continue;
          }
          const bytes = await this.adapter.getBytes(this.config.artifactsBucket, object.key);
          if (!bytes) {
            continue;
          }
          const destinationPath = path.join(runPath, object.relativeName);
          fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
          fs.writeFileSync(destinationPath, bytes);
        }
      }
      return { tempRoot, runtimePaths, objectsByRunId };
    } catch (error) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      throw error;
    }
  }

  private removeRemoteResultsWorkspace(workspace: RemoteResultsWorkspace): void {
    fs.rmSync(workspace.tempRoot, { recursive: true, force: true });
  }

  private mergeRemoteManifest(
    job: RemoteJobRecord,
    objects: RemoteRunObject[],
    parsedManifest: ResultsFileManifestEntry[]
  ): ResultsFileManifestEntry[] {
    const parsedByFileName = new Map(parsedManifest.map((file) => [file.fileName, file]));
    return objects.map((object) => {
      const parsed = parsedByFileName.get(object.relativeName);
      const coverage = parsed
        ? { coverageStatus: parsed.coverageStatus, note: parsed.note }
        : this.resolveRemoteManifestOnlyCoverage(object);
      return {
        fileName: object.relativeName,
        filePath: `s3://${this.config.artifactsBucket}/${object.key}`,
        sizeBytes: object.sizeBytes,
        modifiedAt: object.modifiedAt ?? job.endedAt ?? job.startedAt ?? job.createdAt,
        fileType: object.fileType,
        coverageStatus: coverage.coverageStatus,
        note: coverage.note
      };
    }).sort((left, right) => left.fileName.localeCompare(right.fileName));
  }

  private resolveRemoteManifestOnlyCoverage(
    object: RemoteRunObject
  ): Pick<ResultsFileManifestEntry, 'coverageStatus' | 'note'> {
    if (object.sizeBytes === 0) {
      return { coverageStatus: 'empty', note: 'File is empty.' };
    }
    if (object.fileType === 'transaction' || object.fileType === 'micro_snapshot') {
      return { coverageStatus: 'unsupported', note: 'Manifest only (not charted).' };
    }
    return { coverageStatus: 'unsupported' };
  }

  private mergeRemoteSummary(
    job: RemoteJobRecord,
    objects: RemoteRunObject[],
    parsedSummary: ResultsRunSummary
  ): ResultsRunSummary {
    const modifiedAt = objects
      .map((file) => Date.parse(file.modifiedAt ?? ''))
      .filter(Number.isFinite)
      .sort((left, right) => right - left)[0];
    return {
      ...parsedSummary,
      runId: job.runId ?? job.id,
      path: `s3://${this.config.artifactsBucket}/${this.remoteRunResultsPrefix(job)}`,
      modifiedAt: Number.isFinite(modifiedAt) ? new Date(modifiedAt).toISOString() : (job.endedAt ?? job.startedAt ?? job.createdAt),
      createdAt: job.createdAt,
      sizeBytes: objects.reduce((sum, file) => sum + file.sizeBytes, 0),
      fileCount: objects.length,
      status: job.status === 'succeeded' ? parsedSummary.status : 'invalid',
      configAvailable: objects.some((file) => file.relativeName === 'config.properties')
    };
  }

  private async toRemoteResultsSummary(job: RemoteJobRecord): Promise<ResultsRunSummary> {
    const workspace = await this.createRemoteResultsWorkspace([job]);
    try {
      const runId = job.runId ?? job.id;
      const parsedSummary = getResultsRunDetail(workspace.runtimePaths, runId);
      return this.mergeRemoteSummary(job, workspace.objectsByRunId.get(runId) ?? [], parsedSummary);
    } finally {
      this.removeRemoteResultsWorkspace(workspace);
    }
  }

  private toModelRunJob(job: RemoteJobRecord): ModelRunJob {
    return {
      jobId: job.id,
      runId: job.runId ?? job.id,
      title: job.title,
      baseline: job.baseline,
      status: job.status,
      backend: 'aws_ssm',
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      seedsPerPoint: job.seedsPerPoint,
      seeds: job.seeds,
      maxWorkers: job.maxWorkers,
      outputPath: job.outputPath,
      configPath: job.configPath,
      exitCode: job.status === 'succeeded' ? 0 : null,
      signal: job.status === 'canceled' ? 'SSM_CANCEL' : null
    };
  }

  private toExperimentJobSummary(job: RemoteJobRecord): ExperimentJobSummary {
    return {
      jobRef: job.jobRef,
      type: job.type,
      id: job.id,
      title: job.title || job.runId || job.id,
      status: job.status,
      backend: 'aws_ssm',
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      baseline: job.baseline,
      runId: job.runId
    };
  }

  private toSensitivityMetadata(
    prepared: PreparedSensitivityExperimentSubmission,
    now: Date
  ): SensitivityExperimentMetadata {
    return {
      experimentId: prepared.experimentId,
      title: prepared.title,
      baseline: prepared.baseline,
      basePolicy: prepared.basePolicy,
      status: 'queued',
      createdAt: now.toISOString(),
      seedsPerPoint: prepared.seeds.length,
      seeds: prepared.seeds,
      maxWorkers: prepared.maxWorkers,
      generalOverrides: prepared.generalOverrides,
      parameter: {
        key:
          prepared.policyPackage.parameterKeys.length === 1
            ? prepared.policyPackage.parameterKeys[0]
            : prepared.policyPackage.id,
        packageId: prepared.policyPackage.id,
        parameterKeys: [...prepared.policyPackage.parameterKeys],
        title: prepared.policyPackage.title,
        description: prepared.policyPackage.description,
        type: prepared.policyPackage.type,
        baselineValue: prepared.baselineValue,
        baselineValuesByKey: prepared.baselineValuesByKey,
        min: prepared.min,
        max: prepared.max,
        sampleCount: prepared.sampleCount
      },
      warnings: prepared.warnings,
      warningSummary: prepared.warningSummary,
      sampledPoints: prepared.samplePoints,
      collapsedSlots: prepared.collapsedSlots,
      runCommand: {
        mode: 'maven',
        commandTemplate: 'remote AWS SSM runner using repository Maven wrapper'
      }
    };
  }

  private toSensitivitySummary(job: RemoteJobRecord): SensitivityExperimentSummary {
    const metadata = job.sensitivityMetadata;
    if (!metadata) {
      throw new Error(`Remote sensitivity job is missing metadata: ${job.jobRef}`);
    }
    return {
      ...metadata,
      status: job.status,
      startedAt: job.startedAt,
      endedAt: job.endedAt
    };
  }

  private async getRemoteSensitivityMetadata(job: RemoteJobRecord): Promise<SensitivityExperimentMetadata> {
    if (job.type !== 'sensitivity' || !job.sensitivityMetadata) {
      throw new Error(`Remote job is not a sensitivity experiment: ${job.jobRef}`);
    }
    const stored = await this.adapter.getJson<SensitivityExperimentMetadata>(
      this.config.artifactsBucket,
      `${job.artifactS3Prefix}Results/experiments/sensitivity/${job.id}/metadata.json`
    );
    return {
      ...(stored ?? job.sensitivityMetadata),
      status: job.status,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      failureReason: stored?.failureReason ?? job.failureReason
    };
  }

  private async getJobLogPayload(job: RemoteJobRecord): Promise<RemoteLogPayload> {
    const artifactLog = await this.adapter.getText(this.config.artifactsBucket, `${job.artifactS3Prefix}logs/remote-runner.log`);
    if (artifactLog) {
      const lines = toLines(artifactLog);
      return job.type === 'sensitivity' ? createRemoteSensitivityLogPayload(job, lines) : createRemoteManualLogPayload(job, lines);
    }
    if (!job.ssmCommandId) {
      return { lines: [`[system] Remote job ${job.jobRef} has not been dispatched yet.`] };
    }
    const invocation = await this.adapter.getCommandInvocation(this.config.runnerInstanceId, job.ssmCommandId);
    if (job.type === 'sensitivity') {
      return createRemoteSensitivityLogPayload(job, [
        ...toLines(invocation?.stdout ?? null),
        ...toLines(invocation?.stderr ?? null).map((line) => `[stderr] ${line}`)
      ]);
    }
    return createRemoteManualLogPayload(job, [
      ...toLines(invocation?.stdout ?? null).map((line) => normalizeRemoteManualSsmLogLine('stdout', line)),
      ...toLines(invocation?.stderr ?? null).map((line) => normalizeRemoteManualSsmLogLine('stderr', line))
    ]);
  }
}
