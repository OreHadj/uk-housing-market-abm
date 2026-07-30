import type express from 'express';
import { compareParameters, getInProgressVersions, getParameterCatalog, getValidationOverview, getVersions } from '../lib/service';
import { resolveDashboardWriteAccess } from '../lib/writeAuth';
import type { RouteContext } from './routeContext';

export function registerPublicRoutes(app: express.Express, context: RouteContext): void {
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/runtime-deps', context.withMemoryLogging('runtime-deps', async (req, res) => {
    const deps = context.getRuntimeDependencies();
    const policy = context.resolveRuntimePolicy(req);
    const remoteExecution = context.remoteExecution ? await context.remoteExecution.getStatus() : undefined;
    res.json({
      java: deps.java.available,
      maven: deps.maven.available,
      javaBin: deps.javaBin,
      mavenBin: deps.mavenBin,
      runtimePaths: {
        mode: context.runtimePaths.mode,
        dataRoot: context.runtimePaths.dataRoot,
        resultsRoot: context.runtimePaths.resultsRoot,
        tempRoot: context.runtimePaths.tempRoot,
        logsRoot: context.runtimePaths.logsRoot,
        diagnostics: deps.runtimePaths ?? null
      },
      modelArtifact: deps.modelArtifact,
      modelRunsConfigured: policy.modelRunsConfigured,
      modelRunsEnabled: policy.modelRunsEnabled,
      modelRunsDisabledReason: policy.modelRunsDisabledReason,
      ...(remoteExecution ? { remoteExecution } : {}),
      versionInfo: {
        java: deps.java.versionOutput || null,
        maven: deps.maven.versionOutput || null,
        javaVendor: deps.java.vendor ?? null,
        javaMajorVersion: deps.java.majorVersion ?? null,
        javaError: deps.java.error ?? null,
        mavenError: deps.maven.error ?? null
      }
    });
  }));

  app.get('/api/auth/status', context.withMemoryLogging('auth-status', async (req, res) => {
    const policy = context.resolveRuntimePolicy(req);
    const access = resolveDashboardWriteAccess(
      context.writeAuth,
      req.get('authorization'),
      policy.modelRunsEnabled,
      policy.devBypassActive
    );
    const cloudDownloadLoginRequired = context.runtimePaths.mode !== 'desktop' && !policy.downloadBypassActive;
    const canDownloadResults =
      policy.downloadBypassActive || ((!cloudDownloadLoginRequired || context.writeAuth.authEnabled) && access.canWrite);
    const deleteKeyRequired = policy.deleteKeyRequired;
    const canDeleteResults = deleteKeyRequired ? context.deleteKeyAuth.configured : access.canWrite;
    const remoteExecution = context.remoteExecution ? await context.remoteExecution.getStatus() : undefined;
    res.json({
      authEnabled: access.authEnabled,
      canWrite: access.canWrite,
      canDownloadResults,
      canDeleteResults,
      deleteKeyRequired,
      authMisconfigured: access.authMisconfigured,
      modelRunsEnabled: policy.modelRunsEnabled,
      modelRunsConfigured: policy.modelRunsConfigured,
      modelRunsDisabledReason: policy.modelRunsDisabledReason,
      ...(remoteExecution ? { remoteExecution } : {})
    });
  }));

  app.get('/api/versions', context.withMemoryLogging('versions', (_req, res) => {
    try {
      const versions = getVersions(context.runtimePaths);
      const inProgressVersions = getInProgressVersions(context.runtimePaths);
      res.json({ versions, inProgressVersions });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  }));

  app.get('/api/validation-overview', context.withMemoryLogging('validation-overview', (req, res) => {
    try {
      const version = String(req.query.version ?? '').trim();
      const targetYearParam = Number.parseInt(String(req.query.validationTargetYear ?? '').trim(), 10);
      const validationTargetYear = [2011, 2024].includes(targetYearParam) ? targetYearParam : undefined;
      const comparisonVersion = String(req.query.comparisonVersion ?? '').trim();
      res.json(
        getValidationOverview(
          context.runtimePaths,
          version || undefined,
          validationTargetYear,
          comparisonVersion || undefined
        )
      );
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  }));

  app.get('/api/parameter-catalog', context.withMemoryLogging('parameter-catalog', (_req, res) => {
    res.json({ items: getParameterCatalog() });
  }));

  app.get('/api/compare', context.withMemoryLogging('compare', (req, res) => {
    const left = String(req.query.left ?? '');
    const right = String(req.query.right ?? '');
    const idsParam = String(req.query.ids ?? '');
    const provenanceScopeParam = String(req.query.provenanceScope ?? 'range');

    if (!left || !right) {
      res.status(400).json({ error: 'left and right query parameters are required' });
      return;
    }

    const ids = idsParam
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const provenanceScope = provenanceScopeParam === 'through_right' ? 'through_right' : 'range';

    try {
      const payload = compareParameters(context.runtimePaths, left, right, ids, provenanceScope);
      res.json(payload);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  }));
}
