// Author: Max Stoddard
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { checkRuntimeDependencies, type RuntimeDependencyStatus } from './lib/runtimeDeps';
import { createRuntimePathsFromEnv, type RuntimePaths } from './lib/runtimePaths';
import { seedDemoExamples } from './lib/demoExamples';
import type { ModelLauncher } from './lib/modelLauncher';
import {
  createRemoteExecutionConfigFromEnv,
  getExecutionBackendFromEnv,
  RemoteExecutionManager
} from './lib/remoteExecution';
import { shutdownModelRunProcesses } from './lib/modelRuns';
import { createPersistentLoggers, type RotatingLogOptions, type RotatingLogWriter } from './lib/logs/persistentLogs';
import { shutdownSensitivityRunProcesses } from './lib/sensitivityRuns';
import {
  createDeleteKeyAuthControllerFromEnv,
  createDesktopWriteAuthController,
  createWriteAuthControllerFromEnv,
  getWriteAuthConfigurationError,
  resolveDashboardWriteAccess,
  type DeleteKeyAuthController,
  type WriteAuthController
} from './lib/writeAuth';
import { registerPublicRoutes } from './routes/publicRoutes';
import type { RouteContext, RuntimePolicy } from './routes/routeContext';

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 8787;
const MODEL_RUNS_DISABLED_REASON_CONFIG =
  'Model execution is disabled in this environment.';
const MODEL_RUNS_DISABLED_REASON_RUNTIME =
  'Model execution is unavailable because Java/Maven are missing in this API runtime. Deploy API with Docker runtime (Java+Maven) or install dependencies.';
const EXPERIMENTS_DISABLED_REASON =
  'Experiments are not available in this environment.';

type DashboardViewMode = 'dev' | 'preview_desktop' | 'preview_cloud';

export interface DashboardStaticServingOptions {
  enabled?: boolean;
  root?: string;
}

export interface StartDashboardServerOptions {
  dashboardRoot?: string;
  repoRoot?: string;
  host?: string;
  port?: number;
  runtimePaths?: RuntimePaths;
  writeAuth?: WriteAuthController;
  deleteKeyAuth?: DeleteKeyAuthController;
  desktopAuthToken?: string;
  launcher?: ModelLauncher;
  remoteExecution?: RemoteExecutionManager;
  corsOrigin?: string;
  modelRunsConfigured?: boolean;
  isDevRuntime?: boolean;
  memoryLoggingEnabled?: boolean;
  logRotation?: RotatingLogOptions;
  staticServing?: DashboardStaticServingOptions;
  logStartup?: boolean;
}

export interface DashboardServerHandle {
  app: express.Express;
  server: http.Server;
  host: string;
  port: number;
  url: string;
  shutdown: () => Promise<void>;
}

function envValue(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function getDashboardRootFromCwd(): string {
  return process.cwd();
}

function resolveRepoRoot(dashboardRoot: string, configuredRepoRoot: string | undefined): string {
  return configuredRepoRoot ? path.resolve(configuredRepoRoot) : path.resolve(dashboardRoot, '..');
}

function resolveConfiguredPortFromEnv(): number | undefined {
  const value = process.env.PORT ?? process.env.DASHBOARD_API_PORT;
  return value === undefined ? undefined : Number.parseInt(value, 10);
}

function resolveDashboardViewMode(req: express.Request): DashboardViewMode {
  const viewMode = req.get('X-Dashboard-View-Mode')?.trim().toLowerCase() ?? '';
  if (viewMode === 'preview_desktop') {
    return 'preview_desktop';
  }
  if (viewMode === 'preview_cloud' || viewMode === 'non_dev_preview') {
    return 'preview_cloud';
  }
  return 'dev';
}

function logInfo(message: string, writer?: RotatingLogWriter): void {
  console.log(message);
  writer?.writeLine(`[info] ${message}`);
}

function logError(message: string, writer?: RotatingLogWriter): void {
  console.error(message);
  writer?.writeLine(`[error] ${message}`);
}

function experimentsFeatureEnabled(): boolean {
  return true;
}

function isModelLauncherRuntimeAvailable(
  runtimeDependencies: RuntimeDependencyStatus,
  launcher: ModelLauncher | undefined,
  remoteExecution: RemoteExecutionManager | undefined,
  executionBackend: 'local_maven' | 'aws_ssm'
): boolean {
  if (executionBackend === 'aws_ssm') {
    return Boolean(remoteExecution);
  }
  if (launcher?.mode === 'packaged') {
    return runtimeDependencies.java.available && runtimeDependencies.modelArtifact.exists;
  }
  return runtimeDependencies.java.available && runtimeDependencies.maven.available;
}

function getModelRunsRuntimeUnavailableReason(
  runtimeDependencies: RuntimeDependencyStatus,
  launcher: ModelLauncher | undefined,
  remoteExecution: RemoteExecutionManager | undefined,
  executionBackend: 'local_maven' | 'aws_ssm'
): string {
  if (executionBackend === 'aws_ssm' && !remoteExecution) {
    return 'Remote experiment execution is unavailable because AWS_RUNNER_INSTANCE_ID and AWS_ARTIFACTS_BUCKET are not configured.';
  }
  if (launcher?.mode !== 'packaged') {
    return MODEL_RUNS_DISABLED_REASON_RUNTIME;
  }
  if (!runtimeDependencies.java.available) {
    return `Model execution is unavailable because the packaged Java runtime is missing: ${runtimeDependencies.javaBin}.`;
  }
  if (!runtimeDependencies.modelArtifact.exists) {
    return `Model execution is unavailable because the packaged model artifact is missing: ${
      runtimeDependencies.modelArtifact.path ?? 'not configured'
    }.`;
  }
  return MODEL_RUNS_DISABLED_REASON_RUNTIME;
}

function createCorsMiddleware(corsOrigin: string): express.RequestHandler {
  return (req, res, next) => {
    if (!corsOrigin) {
      next();
      return;
    }

    const requestOrigin = req.get('origin');
    if (requestOrigin && requestOrigin === corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Dashboard-View-Mode,X-Dashboard-Delete-Key');
      res.setHeader('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}

function createMemoryLoggingMiddleware(memoryLoggingEnabled: boolean, serverLog?: RotatingLogWriter) {
  return (label: string, handler: express.RequestHandler): express.RequestHandler => (req, res, next) => {
    const startNs = process.hrtime.bigint();
    const startMemory = memoryLoggingEnabled ? process.memoryUsage() : null;

    if (memoryLoggingEnabled) {
      res.once('finish', () => {
        const endMemory = process.memoryUsage();
        const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
        const rssDeltaMb = (endMemory.rss - (startMemory?.rss ?? 0)) / (1024 * 1024);
        const heapDeltaMb = (endMemory.heapUsed - (startMemory?.heapUsed ?? 0)) / (1024 * 1024);
        logInfo(
          `[memory] ${label} ${req.method} ${req.originalUrl} status=${res.statusCode} ` +
            `durationMs=${elapsedMs.toFixed(1)} rssMb=${(endMemory.rss / (1024 * 1024)).toFixed(1)} ` +
            `heapMb=${(endMemory.heapUsed / (1024 * 1024)).toFixed(1)} ` +
            `rssDeltaMb=${rssDeltaMb.toFixed(1)} heapDeltaMb=${heapDeltaMb.toFixed(1)}`,
          serverLog
        );
      });
    }

    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function createRouteContext(input: {
  repoRoot: string;
  runtimePaths: RuntimePaths;
  modelRunsConfigured: boolean;
  writeAuth: WriteAuthController;
  deleteKeyAuth: DeleteKeyAuthController;
  isDevRuntime: boolean;
  memoryLoggingEnabled: boolean;
  startupRuntimeDependencies: RuntimeDependencyStatus;
  launcher: ModelLauncher | undefined;
  remoteExecution: RemoteExecutionManager | undefined;
  executionBackend: 'local_maven' | 'aws_ssm';
  serverLog?: RotatingLogWriter;
  modelLog?: RotatingLogWriter;
}): RouteContext {
  const runtimeDependencyOptions = {
    runtimePaths: input.runtimePaths,
    javaBin: input.launcher?.metadata.javaExe,
    mavenBin: input.launcher?.metadata.mavenBin,
    modelJar: input.launcher?.metadata.modelJar
  };
  const getRuntimeDependencies = () => checkRuntimeDependencies(runtimeDependencyOptions);
  const resolveRuntimePolicy = (req: express.Request): RuntimePolicy => {
    const viewMode = resolveDashboardViewMode(req);
    const devBypassActive = input.runtimePaths.mode !== 'desktop' && input.isDevRuntime && viewMode === 'dev';
    const downloadBypassActive =
      input.runtimePaths.mode !== 'desktop' &&
      input.isDevRuntime &&
      (viewMode === 'dev' || viewMode === 'preview_desktop');
    const modelRunsConfigured = devBypassActive ? true : input.modelRunsConfigured;
    const launchRuntimeAvailable = isModelLauncherRuntimeAvailable(
      input.startupRuntimeDependencies,
      input.launcher,
      input.remoteExecution,
      input.executionBackend
    );
    const modelRunsEnabled = modelRunsConfigured && launchRuntimeAvailable;
    const modelRunsDisabledReason = modelRunsEnabled
      ? null
      : modelRunsConfigured
        ? getModelRunsRuntimeUnavailableReason(
            input.startupRuntimeDependencies,
            input.launcher,
            input.remoteExecution,
            input.executionBackend
          )
        : MODEL_RUNS_DISABLED_REASON_CONFIG;
    const writeAuthConfigurationError = getWriteAuthConfigurationError(input.writeAuth, modelRunsEnabled, devBypassActive);
    const deleteKeyRequired =
      Boolean(input.remoteExecution) &&
      input.runtimePaths.mode !== 'desktop' &&
      (!input.isDevRuntime || viewMode === 'preview_cloud');

    return {
      viewMode,
      devBypassActive,
      downloadBypassActive,
      modelRunsConfigured,
      modelRunsEnabled,
      modelRunsDisabledReason,
      writeAuthConfigurationError,
      deleteKeyRequired
    };
  };
  const requireWriteAccess = (req: express.Request, res: express.Response): boolean => {
    const policy = resolveRuntimePolicy(req);
    const access = resolveDashboardWriteAccess(
      input.writeAuth,
      req.get('authorization'),
      policy.modelRunsEnabled,
      policy.devBypassActive
    );
    if (access.canWrite) {
      return true;
    }
    if (access.authMisconfigured) {
      res.status(503).json({
        error: policy.writeAuthConfigurationError ?? 'Write access is unavailable due to server configuration.'
      });
      return false;
    }
    res.status(403).json({ error: 'Write access requires login.' });
    return false;
  };
  const requireDownloadAccess = (req: express.Request, res: express.Response): boolean => {
    const policy = resolveRuntimePolicy(req);
    if (policy.downloadBypassActive) {
      return true;
    }
    const cloudLoginRequired = input.runtimePaths.mode !== 'desktop' && !policy.devBypassActive;
    if (cloudLoginRequired && !input.writeAuth.authEnabled) {
      res.status(503).json({
        error: 'Result downloads require configured dashboard credentials. Set DASHBOARD_WRITE_USERNAME and DASHBOARD_WRITE_PASSWORD.'
      });
      return false;
    }

    const access = resolveDashboardWriteAccess(
      input.writeAuth,
      req.get('authorization'),
      policy.modelRunsEnabled,
      policy.devBypassActive
    );
    if (access.canWrite) {
      return true;
    }
    if (access.authMisconfigured) {
      res.status(503).json({
        error: policy.writeAuthConfigurationError ?? 'Download access is unavailable due to server configuration.'
      });
      return false;
    }
    res.status(403).json({ error: 'Result downloads require login.' });
    return false;
  };
  const requireDeleteAccess = (req: express.Request, res: express.Response): boolean => {
    const policy = resolveRuntimePolicy(req);
    if (!policy.deleteKeyRequired) {
      return requireWriteAccess(req, res);
    }

    const access = input.deleteKeyAuth.resolveAccess(req.get('x-dashboard-delete-key'));
    if (!access.configured) {
      res.status(503).json({
        error: 'Remote result deletion requires configured dashboard delete key. Set DASHBOARD_DELETE_KEY.'
      });
      return false;
    }
    if (access.canDelete) {
      return true;
    }

    res.status(403).json({ error: 'Remote result deletion requires the private delete key.' });
    return false;
  };
  const requireExperimentsFeature = (req: express.Request, res: express.Response): boolean => {
    void req;
    if (experimentsFeatureEnabled()) {
      return true;
    }
    res.status(404).json({ error: EXPERIMENTS_DISABLED_REASON });
    return false;
  };

  return {
    repoRoot: input.repoRoot,
    runtimePaths: input.runtimePaths,
    modelRunsConfiguredFromEnv: input.modelRunsConfigured,
    writeAuth: input.writeAuth,
    deleteKeyAuth: input.deleteKeyAuth,
    launcher: input.launcher,
    remoteExecution: input.remoteExecution,
    modelLogSink: input.modelLog ? (line) => input.modelLog?.writeLine(line) : undefined,
    getRuntimeDependencies,
    resolveRuntimePolicy,
    requireDownloadAccess,
    requireDeleteAccess,
    requireWriteAccess,
    requireExperimentsFeature,
    withMemoryLogging: createMemoryLoggingMiddleware(input.memoryLoggingEnabled, input.serverLog)
  };
}

function shouldServeStaticFallback(req: express.Request): boolean {
  if (req.path === '/healthz' || req.path === '/api' || req.path.startsWith('/api/')) {
    return false;
  }
  return Boolean(req.accepts('html'));
}

function registerStaticServing(app: express.Express, staticRoot: string): void {
  const indexPath = path.join(staticRoot, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Desktop static serving requires built dashboard index.html at ${indexPath}`);
  }

  app.use(express.static(staticRoot));
  app.get('*', (req, res, next) => {
    if (!shouldServeStaticFallback(req)) {
      next();
      return;
    }
    res.sendFile(indexPath);
  });
}

function resolveStaticRoot(dashboardRoot: string, options: StartDashboardServerOptions, runtimePaths: RuntimePaths): string | null {
  const staticServing = options.staticServing;
  const enabled = staticServing?.enabled ?? runtimePaths.mode === 'desktop';
  if (!enabled) {
    return null;
  }
  return path.resolve(staticServing?.root ?? path.join(dashboardRoot, 'dist'));
}

function logRuntimeDependencies(
  runtimePaths: RuntimePaths,
  startupRuntimeDependencies: RuntimeDependencyStatus,
  modelRunsConfigured: boolean,
  launcher: ModelLauncher | undefined,
  remoteExecution: RemoteExecutionManager | undefined,
  executionBackend: 'local_maven' | 'aws_ssm',
  serverLog?: RotatingLogWriter
): void {
  logInfo(`[runtime-paths] mode=${runtimePaths.mode}`, serverLog);
  logInfo(`[runtime-paths] dataRoot=${runtimePaths.dataRoot}`, serverLog);
  logInfo(`[runtime-paths] resultsRoot=${runtimePaths.resultsRoot}`, serverLog);
  logInfo(`[runtime-paths] tempRoot=${runtimePaths.tempRoot}`, serverLog);
  logInfo(`[runtime-paths] logsRoot=${runtimePaths.logsRoot}`, serverLog);
  logInfo(`[runtime-deps] java=${startupRuntimeDependencies.java.available ? 'available' : 'missing'}`, serverLog);
  logInfo(`[runtime-deps] java bin=${startupRuntimeDependencies.javaBin}`, serverLog);
  if (startupRuntimeDependencies.java.versionOutput) {
    logInfo(`[runtime-deps] java version: ${startupRuntimeDependencies.java.versionOutput.split('\n')[0]}`, serverLog);
  }
  if (startupRuntimeDependencies.java.majorVersion !== null && startupRuntimeDependencies.java.majorVersion !== undefined) {
    logInfo(`[runtime-deps] java major=${startupRuntimeDependencies.java.majorVersion}`, serverLog);
  }
  if (startupRuntimeDependencies.java.error) {
    logError(`[runtime-deps] java error: ${startupRuntimeDependencies.java.error}`, serverLog);
  }

  if (startupRuntimeDependencies.modelArtifact.path) {
    logInfo(
      `[runtime-deps] model artifact=${startupRuntimeDependencies.modelArtifact.exists ? 'available' : 'missing'} ` +
        `path=${startupRuntimeDependencies.modelArtifact.path}`,
      serverLog
    );
  }
  if (startupRuntimeDependencies.modelArtifact.path && startupRuntimeDependencies.modelArtifact.error) {
    logError(`[runtime-deps] model artifact error: ${startupRuntimeDependencies.modelArtifact.error}`, serverLog);
  }

  logInfo(
    `[runtime-deps] maven=${startupRuntimeDependencies.maven.available ? 'available' : 'missing'} (bin=${startupRuntimeDependencies.mavenBin})`,
    serverLog
  );
  if (startupRuntimeDependencies.maven.versionOutput) {
    logInfo(`[runtime-deps] maven version: ${startupRuntimeDependencies.maven.versionOutput.split('\n')[0]}`, serverLog);
  }
  if (startupRuntimeDependencies.maven.error) {
    logError(`[runtime-deps] maven error: ${startupRuntimeDependencies.maven.error}`, serverLog);
  }

  if (executionBackend === 'aws_ssm') {
    logInfo(`[runtime-deps] experiment backend=aws_ssm configured=${remoteExecution ? 'true' : 'false'}`, serverLog);
  }

  if (modelRunsConfigured && !isModelLauncherRuntimeAvailable(startupRuntimeDependencies, launcher, remoteExecution, executionBackend)) {
    logError(
      `[dashboard-api] ${getModelRunsRuntimeUnavailableReason(
        startupRuntimeDependencies,
        launcher,
        remoteExecution,
        executionBackend
      )}`,
      serverLog
    );
  }
}

function listen(app: express.Express, host: string, port: number): Promise<http.Server> {
  const server = app.listen(port, host);
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
  });
}

function getActualPort(server: http.Server): number {
  const address = server.address();
  if (typeof address === 'object' && address !== null) {
    return (address as AddressInfo).port;
  }
  throw new Error('Dashboard server did not expose a TCP port.');
}

function closeServer(server: http.Server): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function startDashboardServer(options: StartDashboardServerOptions = {}): Promise<DashboardServerHandle> {
  const dashboardRoot = path.resolve(options.dashboardRoot ?? getDashboardRootFromCwd());
  const repoRoot = resolveRepoRoot(dashboardRoot, options.repoRoot);
  const runtimePaths = options.runtimePaths ?? createRuntimePathsFromEnv(repoRoot);
  const host = options.host ?? (runtimePaths.mode === 'desktop' ? '127.0.0.1' : DEFAULT_HOST);
  const port = options.port ?? (runtimePaths.mode === 'desktop' ? 0 : DEFAULT_PORT);
  const corsOrigin = options.corsOrigin ?? envValue('DASHBOARD_CORS_ORIGIN');
  const remoteExecutionConfig = createRemoteExecutionConfigFromEnv();
  const remoteExecution = options.remoteExecution ?? (remoteExecutionConfig ? new RemoteExecutionManager(remoteExecutionConfig) : undefined);
  const executionBackend = remoteExecution ? 'aws_ssm' : getExecutionBackendFromEnv();
  const modelRunsConfigured =
    options.modelRunsConfigured ?? (envValue('DASHBOARD_ENABLE_MODEL_RUNS').toLowerCase() === 'true' || executionBackend === 'aws_ssm');
  const writeAuth =
    runtimePaths.mode === 'desktop'
      ? (() => {
          if (options.writeAuth) {
            throw new Error('Desktop runtime does not accept writeAuth overrides. Pass desktopAuthToken instead.');
          }
          return createDesktopWriteAuthController(options.desktopAuthToken);
        })()
      : (options.writeAuth ?? createWriteAuthControllerFromEnv());
  const deleteKeyAuth = options.deleteKeyAuth ?? createDeleteKeyAuthControllerFromEnv();
  const isDevRuntime = options.isDevRuntime ?? (envValue('NODE_ENV').toLowerCase() !== 'production');
  const memoryLoggingEnabled = options.memoryLoggingEnabled ?? (envValue('DASHBOARD_LOG_MEMORY').toLowerCase() === 'true');
  const loggers = createPersistentLoggers(runtimePaths.logsRoot, options.logRotation);
  seedDemoExamples(runtimePaths, (message) => logInfo(message, loggers.server));
  loggers.app.writeLine(`[lifecycle] dashboard server starting mode=${runtimePaths.mode}`);
  const startupRuntimeDependencies = checkRuntimeDependencies({
    runtimePaths,
    javaBin: options.launcher?.metadata.javaExe,
    mavenBin: options.launcher?.metadata.mavenBin,
    modelJar: options.launcher?.metadata.modelJar
  });
  const staticRoot = resolveStaticRoot(dashboardRoot, options, runtimePaths);

  if (options.logStartup ?? true) {
    logRuntimeDependencies(
      runtimePaths,
      startupRuntimeDependencies,
      modelRunsConfigured,
      options.launcher,
      remoteExecution,
      executionBackend,
      loggers.server
    );
  }

  const app = express();
  app.use(express.json());
  app.use(createCorsMiddleware(corsOrigin));

  const routeContext = createRouteContext({
    repoRoot,
    runtimePaths,
    modelRunsConfigured,
    writeAuth,
    deleteKeyAuth,
    isDevRuntime,
    memoryLoggingEnabled,
    startupRuntimeDependencies,
    launcher: options.launcher,
    remoteExecution,
    executionBackend,
    serverLog: loggers.server,
    modelLog: loggers.model
  });

  registerPublicRoutes(app, routeContext);

  const { registerDevRoutes } = await import('./routes/devRoutes');
  registerDevRoutes(app, routeContext);

  if (staticRoot) {
    registerStaticServing(app, staticRoot);
  }

  const server = await listen(app, host, port);
  const actualPort = getActualPort(server);
  loggers.app.writeLine(`[lifecycle] dashboard server listening host=${host} port=${actualPort}`);

  return {
    app,
    server,
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    shutdown: async () => {
      loggers.app.writeLine('[lifecycle] dashboard server shutdown requested');
      shutdownModelRunProcesses();
      shutdownSensitivityRunProcesses();
      await closeServer(server);
      loggers.app.writeLine('[lifecycle] dashboard server stopped');
    }
  };
}

export async function runDashboardServerFromEnv(): Promise<DashboardServerHandle> {
  const dashboardRoot = getDashboardRootFromCwd();
  const repoRoot = resolveRepoRoot(dashboardRoot, undefined);
  const runtimePaths = createRuntimePathsFromEnv(repoRoot);
  const handle = await startDashboardServer({
    dashboardRoot,
    repoRoot,
    runtimePaths,
    port: resolveConfiguredPortFromEnv()
  });
  console.log(`[dashboard-api] listening on ${handle.host}:${handle.port}`);
  return handle;
}
