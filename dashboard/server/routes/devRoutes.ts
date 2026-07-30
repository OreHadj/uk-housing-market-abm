import type express from 'express';
import { pipeline } from 'node:stream/promises';
import {
  createManualResultArchive,
  createSensitivityResultArchive,
  type ResultArchive,
} from '../lib/resultDownloads';
import { RemoteExecutionUnavailableError } from '../lib/remoteExecution';
import {
  deleteResultsRun,
  getResultsCompare,
  getResultsRunDetail,
  getResultsRunFiles,
  getResultsRuns,
  getResultsSeries,
  renameResultsRun
} from '../lib/results';
import {
  cancelModelRunJob,
  clearModelRunJob,
  getModelRunJob,
  getModelRunJobLogs,
  getModelRunOptions,
  getResultsStorageSummary,
  listModelRunJobs,
  submitModelRun
} from '../lib/modelRuns';
import { cancelExperimentJob, deleteExperimentJob, getExperimentJobLogs, listExperimentJobs } from '../lib/experimentJobs';
import {
  cancelSensitivityExperiment,
  deleteSensitivityExperiment,
  getActiveSensitivityExperimentId,
  getSensitivityExperiment,
  getSensitivityExperimentCharts,
  getSensitivityExperimentLogs,
  getSensitivityExperimentResults,
  hasActiveSensitivityExperiment,
  listSensitivityExperiments,
  submitSensitivityExperiment
} from '../lib/sensitivityRuns';
import type { RouteContext } from './routeContext';

const MODEL_RUNS_DISABLED_REASON_CONFIG =
  'Model execution is disabled in this environment.';
const FINISHED_EXPERIMENT_STATUSES = new Set(['succeeded', 'failed', 'canceled']);

function contentDispositionFileName(fileName: string): string {
  const quoted = fileName.replace(/["\\]/g, '_');
  return `attachment; filename="${quoted}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

async function sendResultArchive(res: express.Response, archive: ResultArchive): Promise<void> {
  res.setHeader('Content-Type', archive.contentType);
  res.setHeader('Content-Disposition', contentDispositionFileName(archive.fileName));
  await pipeline(archive.stream, res);
}

function isDefaultResultsRunId(runId: string): boolean {
  return runId.trim().toLowerCase() === 'default';
}

function normalizeQueryValues(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeQueryValues(entry));
  }
  return [];
}

export function parseResultsCompareQueryValues(
  query: express.Request['query'],
  repeatedName: string,
  legacyName: string
): string[] {
  const repeatedValues = normalizeQueryValues(query[repeatedName]);
  if (repeatedValues.length > 0) {
    return repeatedValues;
  }
  return normalizeQueryValues(query[legacyName])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function resolveLocalResultsReadRunId(
  paths: Parameters<typeof getResultsRuns>[0],
  runId: string
): string {
  const normalizedRunId = runId.trim();
  if (!isDefaultResultsRunId(normalizedRunId)) {
    return normalizedRunId;
  }

  const resolvedRunId = getResultsRuns(paths)[0]?.runId;
  if (!resolvedRunId) {
    throw new Error('No local manual result runs are available.');
  }
  return resolvedRunId;
}

function resolveLocalResultsReadRunIds(
  paths: Parameters<typeof getResultsRuns>[0],
  runIds: string[]
): string[] {
  const resolvedRunIds: string[] = [];
  for (const runId of runIds) {
    const resolvedRunId = resolveLocalResultsReadRunId(paths, runId);
    if (!resolvedRunIds.includes(resolvedRunId)) {
      resolvedRunIds.push(resolvedRunId);
    }
  }
  return resolvedRunIds;
}

export function registerDevRoutes(app: express.Express, context: RouteContext): void {
  app.post('/api/auth/login', (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }

    const policy = context.resolveRuntimePolicy(req);
    if (policy.writeAuthConfigurationError) {
      res.status(503).json({ error: policy.writeAuthConfigurationError });
      return;
    }

    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const result = context.writeAuth.login(username, password);
    if (!result.ok) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }
    res.json(result);
  });

  app.post('/api/auth/logout', (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    const access = context.writeAuth.resolveAccess(req.get('authorization'));
    context.writeAuth.logout(access.token);
    res.json({ ok: true });
  });

  app.get('/api/results/runs', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.listRemoteManualResultRuns());
        return;
      }
      const runs = getResultsRuns(context.runtimePaths);
      res.json({ runs });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/results/storage', (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    try {
      res.json(getResultsStorageSummary(context.runtimePaths));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/results/runs/:runId', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.getRemoteManualResultDetail(String(req.params.runId ?? '')));
        return;
      }
      const runId = resolveLocalResultsReadRunId(context.runtimePaths, String(req.params.runId ?? ''));
      const detail = getResultsRunDetail(context.runtimePaths, runId);
      res.json(detail);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/results/runs/:runId/files', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.getRemoteManualResultFiles(String(req.params.runId ?? '')));
        return;
      }
      const runId = resolveLocalResultsReadRunId(context.runtimePaths, String(req.params.runId ?? ''));
      const files = getResultsRunFiles(context.runtimePaths, runId);
      res.json({ runId, files });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/results/runs/:runId/download', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    if (!context.requireDownloadAccess(req, res)) {
      return;
    }
    try {
      const runId = String(req.params.runId ?? '');
      const archive = context.remoteExecution
        ? await context.remoteExecution.getRemoteManualResultArchive(runId)
        : createManualResultArchive(context.runtimePaths, runId);
      await sendResultArchive(res, archive);
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error as Error);
        return;
      }
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/results/runs/:runId/title', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    if (!context.requireWriteAccess(req, res)) {
      return;
    }

    try {
      const title = typeof req.body?.title === 'string' ? req.body.title : '';
      if (context.remoteExecution) {
        res.status(501).json({ error: 'Renaming runs is not supported for remotely executed results.' });
        return;
      }
      res.json(renameResultsRun(context.runtimePaths, String(req.params.runId ?? ''), title));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.delete('/api/results/runs/:runId', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    if (!context.requireDeleteAccess(req, res)) {
      return;
    }

    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.deleteRemoteManualResultRun(String(req.params.runId ?? '')));
        return;
      }
      const payload = deleteResultsRun(context.runtimePaths, String(req.params.runId ?? ''));
      res.json(payload);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/results/runs/:runId/series', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    const runId = String(req.params.runId ?? '');
    const indicator = String(req.query.indicator ?? '');
    if (!indicator) {
      res.status(400).json({ error: 'indicator query parameter is required' });
      return;
    }

    const rawSmoothWindow = Number.parseInt(String(req.query.smoothWindow ?? '0'), 10);
    const smoothWindow = Number.isFinite(rawSmoothWindow) ? rawSmoothWindow : 0;

    try {
      if (context.remoteExecution) {
        const payload = await context.remoteExecution.getRemoteManualResultSeries(runId, indicator, smoothWindow);
        res.json(payload);
        return;
      }
      const resolvedRunId = resolveLocalResultsReadRunId(context.runtimePaths, runId);
      const payload = getResultsSeries(context.runtimePaths, resolvedRunId, indicator, smoothWindow);
      res.json(payload);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/results/compare', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    const runIds = parseResultsCompareQueryValues(req.query, 'runId', 'runIds');
    const indicatorIds = parseResultsCompareQueryValues(req.query, 'indicatorId', 'indicatorIds');
    const window = String(req.query.window ?? 'post500');
    const rawSmoothWindow = Number.parseInt(String(req.query.smoothWindow ?? '0'), 10);
    const smoothWindow = Number.isFinite(rawSmoothWindow) ? rawSmoothWindow : 0;

    try {
      if (context.remoteExecution) {
        const payload = await context.remoteExecution.getRemoteManualResultCompare(runIds, indicatorIds, window, smoothWindow);
        res.json(payload);
        return;
      }
      const resolvedRunIds = resolveLocalResultsReadRunIds(context.runtimePaths, runIds);
      const payload = getResultsCompare(context.runtimePaths, resolvedRunIds, indicatorIds, window, smoothWindow);
      res.json(payload);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/model-runs/options', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    try {
      const policy = context.resolveRuntimePolicy(req);
      const baseline = String(req.query.baseline ?? '').trim() || undefined;
      const payload = getModelRunOptions(context.runtimePaths, baseline, policy.modelRunsEnabled);
      res.json(context.remoteExecution ? await context.remoteExecution.decorateModelRunOptions(payload) : payload);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/model-runs', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    const policy = context.resolveRuntimePolicy(req);
    if (!policy.modelRunsEnabled) {
      res.status(403).json({ error: policy.modelRunsDisabledReason ?? MODEL_RUNS_DISABLED_REASON_CONFIG });
      return;
    }
    if (!context.requireWriteAccess(req, res)) {
      return;
    }

    if (hasActiveSensitivityExperiment(context.runtimePaths)) {
      const experimentId = getActiveSensitivityExperimentId(context.runtimePaths);
      res.status(409).json({
        error: `Cannot queue manual runs while sensitivity experiment ${experimentId ?? ''} is active.`.trim()
      });
      return;
    }

    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.submitModelRun(context.runtimePaths, req.body));
        return;
      }
      const payload = submitModelRun(context.runtimePaths, req.body, {
        ignoreStorageCap: policy.devBypassActive,
        launcher: context.launcher,
        logSink: context.modelLogSink
      });
      res.json(payload);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/model-runs/jobs', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    const policy = context.resolveRuntimePolicy(req);
    if (!policy.modelRunsEnabled) {
      res.status(403).json({ error: policy.modelRunsDisabledReason ?? MODEL_RUNS_DISABLED_REASON_CONFIG });
      return;
    }

    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.listModelRunJobs());
        return;
      }
      res.json({ jobs: listModelRunJobs() });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/model-runs/jobs/:jobId', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    const policy = context.resolveRuntimePolicy(req);
    if (!policy.modelRunsEnabled) {
      res.status(403).json({ error: policy.modelRunsDisabledReason ?? MODEL_RUNS_DISABLED_REASON_CONFIG });
      return;
    }

    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.getModelRunJob(String(req.params.jobId ?? '')));
        return;
      }
      res.json(getModelRunJob(String(req.params.jobId ?? '')));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/model-runs/jobs/:jobId/cancel', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    const policy = context.resolveRuntimePolicy(req);
    if (!policy.modelRunsEnabled) {
      res.status(403).json({ error: policy.modelRunsDisabledReason ?? MODEL_RUNS_DISABLED_REASON_CONFIG });
      return;
    }
    if (!context.requireWriteAccess(req, res)) {
      return;
    }

    try {
      if (context.remoteExecution) {
        const jobId = String(req.params.jobId ?? '');
        await context.remoteExecution.cancelExperimentJob(`manual:${jobId}`);
        res.json(await context.remoteExecution.getModelRunJob(jobId));
        return;
      }
      res.json(cancelModelRunJob(context.runtimePaths, String(req.params.jobId ?? '')));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.delete('/api/model-runs/jobs/:jobId', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    const policy = context.resolveRuntimePolicy(req);
    if (!policy.modelRunsEnabled) {
      res.status(403).json({ error: policy.modelRunsDisabledReason ?? MODEL_RUNS_DISABLED_REASON_CONFIG });
      return;
    }
    if (!context.requireWriteAccess(req, res)) {
      return;
    }

    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.clearModelRunJob(String(req.params.jobId ?? '')));
        return;
      }
      res.json(clearModelRunJob(String(req.params.jobId ?? '')));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/model-runs/jobs/:jobId/logs', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    const policy = context.resolveRuntimePolicy(req);
    if (!policy.modelRunsEnabled) {
      res.status(403).json({ error: policy.modelRunsDisabledReason ?? MODEL_RUNS_DISABLED_REASON_CONFIG });
      return;
    }

    const cursorRaw = Number.parseInt(String(req.query.cursor ?? '0'), 10);
    const limitRaw = Number.parseInt(String(req.query.limit ?? '200'), 10);

    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.getModelRunJobLogs(
          String(req.params.jobId ?? ''),
          Number.isFinite(cursorRaw) ? cursorRaw : undefined,
          Number.isFinite(limitRaw) ? limitRaw : undefined
        ));
        return;
      }
      const payload = getModelRunJobLogs(
        String(req.params.jobId ?? ''),
        Number.isFinite(cursorRaw) ? cursorRaw : undefined,
        Number.isFinite(limitRaw) ? limitRaw : undefined
      );
      res.json(payload);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/experiments/sensitivity', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.listSensitivityExperiments());
        return;
      }
      res.json(listSensitivityExperiments(context.runtimePaths));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/experiments/sensitivity', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    const policy = context.resolveRuntimePolicy(req);
    if (!policy.modelRunsEnabled) {
      res.status(403).json({ error: policy.modelRunsDisabledReason ?? MODEL_RUNS_DISABLED_REASON_CONFIG });
      return;
    }
    if (!context.requireWriteAccess(req, res)) {
      return;
    }

    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.submitSensitivityExperiment(context.runtimePaths, req.body));
        return;
      }
      const payload = submitSensitivityExperiment(context.runtimePaths, req.body, {
        launcher: context.launcher,
        logSink: context.modelLogSink,
        rawLogSink: context.modelLogSink
      });
      res.json(payload);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/experiments/sensitivity/:experimentId', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.getSensitivityExperiment(String(req.params.experimentId ?? '')));
        return;
      }
      res.json(getSensitivityExperiment(context.runtimePaths, String(req.params.experimentId ?? '')));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.delete('/api/experiments/sensitivity/:experimentId', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    if (!context.requireDeleteAccess(req, res)) {
      return;
    }

    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.deleteSensitivityExperiment(String(req.params.experimentId ?? '')));
        return;
      }
      res.json(deleteSensitivityExperiment(context.runtimePaths, String(req.params.experimentId ?? '')));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/experiments/sensitivity/:experimentId/results', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.getSensitivityExperimentResults(String(req.params.experimentId ?? '')));
        return;
      }
      res.json(getSensitivityExperimentResults(context.runtimePaths, String(req.params.experimentId ?? '')));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/experiments/sensitivity/:experimentId/charts', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.getSensitivityExperimentCharts(String(req.params.experimentId ?? '')));
        return;
      }
      res.json(getSensitivityExperimentCharts(context.runtimePaths, String(req.params.experimentId ?? '')));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/experiments/sensitivity/:experimentId/download', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    if (!context.requireDownloadAccess(req, res)) {
      return;
    }
    try {
      const experimentId = String(req.params.experimentId ?? '');
      if (context.remoteExecution) {
        await sendResultArchive(res, await context.remoteExecution.getSensitivityExperimentArchive(experimentId));
        return;
      }

      const detail = getSensitivityExperiment(context.runtimePaths, experimentId).experiment;
      if (!FINISHED_EXPERIMENT_STATUSES.has(detail.status)) {
        res.status(400).json({ error: `Sensitivity experiment is not finished yet: ${experimentId}` });
        return;
      }
      await sendResultArchive(res, createSensitivityResultArchive(context.runtimePaths, experimentId));
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error as Error);
        return;
      }
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/experiments/sensitivity/:experimentId/logs', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    const cursorRaw = Number.parseInt(String(req.query.cursor ?? '0'), 10);
    const limitRaw = Number.parseInt(String(req.query.limit ?? '200'), 10);

    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.getSensitivityExperimentLogs(
          String(req.params.experimentId ?? ''),
          Number.isFinite(cursorRaw) ? cursorRaw : undefined,
          Number.isFinite(limitRaw) ? limitRaw : undefined
        ));
        return;
      }
      const payload = getSensitivityExperimentLogs(
        context.runtimePaths,
        String(req.params.experimentId ?? ''),
        Number.isFinite(cursorRaw) ? cursorRaw : undefined,
        Number.isFinite(limitRaw) ? limitRaw : undefined
      );
      res.json(payload);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/experiments/sensitivity/:experimentId/cancel', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    const policy = context.resolveRuntimePolicy(req);
    if (!policy.modelRunsEnabled) {
      res.status(403).json({ error: policy.modelRunsDisabledReason ?? MODEL_RUNS_DISABLED_REASON_CONFIG });
      return;
    }
    if (!context.requireWriteAccess(req, res)) {
      return;
    }

    try {
      if (context.remoteExecution) {
        const experimentId = String(req.params.experimentId ?? '');
        await context.remoteExecution.cancelExperimentJob(`sensitivity:${experimentId}`);
        res.json(await context.remoteExecution.getSensitivityExperiment(experimentId));
        return;
      }
      res.json(cancelSensitivityExperiment(context.runtimePaths, String(req.params.experimentId ?? '')));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/experiments/jobs', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.listExperimentJobs());
        return;
      }
      res.json(listExperimentJobs(context.runtimePaths));
    } catch (error) {
      if (error instanceof RemoteExecutionUnavailableError) {
        res.status(503).json({ error: error.message });
        return;
      }
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get('/api/experiments/jobs/:jobRef/logs', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    const cursorRaw = Number.parseInt(String(req.query.cursor ?? '0'), 10);
    const limitRaw = Number.parseInt(String(req.query.limit ?? '200'), 10);

    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.getExperimentJobLogs(
          String(req.params.jobRef ?? ''),
          Number.isFinite(cursorRaw) ? cursorRaw : undefined,
          Number.isFinite(limitRaw) ? limitRaw : undefined
        ));
        return;
      }
      const payload = getExperimentJobLogs(
        context.runtimePaths,
        String(req.params.jobRef ?? ''),
        Number.isFinite(cursorRaw) ? cursorRaw : undefined,
        Number.isFinite(limitRaw) ? limitRaw : undefined
      );
      res.json(payload);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/experiments/jobs/:jobRef/cancel', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    const policy = context.resolveRuntimePolicy(req);
    if (!policy.modelRunsEnabled) {
      res.status(403).json({ error: policy.modelRunsDisabledReason ?? MODEL_RUNS_DISABLED_REASON_CONFIG });
      return;
    }
    if (!context.requireWriteAccess(req, res)) {
      return;
    }

    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.cancelExperimentJob(String(req.params.jobRef ?? '')));
        return;
      }
      res.json(cancelExperimentJob(context.runtimePaths, String(req.params.jobRef ?? '')));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.delete('/api/experiments/jobs/:jobRef', async (req, res) => {
    if (!context.requireExperimentsFeature(req, res)) {
      return;
    }
    if (!context.requireDeleteAccess(req, res)) {
      return;
    }

    try {
      if (context.remoteExecution) {
        res.json(await context.remoteExecution.deleteExperimentJob(String(req.params.jobRef ?? '')));
        return;
      }
      res.json(deleteExperimentJob(context.runtimePaths, String(req.params.jobRef ?? '')));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
}
