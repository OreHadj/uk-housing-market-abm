// Author: Max Stoddard
import path from 'node:path';

export type RuntimeMode = 'development' | 'desktop';

export interface RuntimePaths {
  mode: RuntimeMode;
  repoRoot: string;
  dataRoot: string;
  resultsRoot: string;
  demoExamplesRoot: string;
  tempRoot: string;
  logsRoot: string;
  appResourcesRoot?: string;
  electronUserDataRoot?: string;
}

export interface DesktopRuntimePathOptions {
  appResourcesRoot: string;
  electronUserDataRoot: string;
  repoRoot?: string;
}

export type RuntimePathInput = RuntimePaths | string;

function resolveRoot(root: string): string {
  return path.resolve(root);
}

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function isRuntimePaths(value: RuntimePathInput): value is RuntimePaths {
  return typeof value === 'object' && value !== null && 'dataRoot' in value && 'resultsRoot' in value;
}

function applyRootOverrides(paths: RuntimePaths): RuntimePaths {
  return {
    ...paths,
    dataRoot: resolveRoot(envValue('DASHBOARD_DATA_ROOT') ?? paths.dataRoot),
    resultsRoot: resolveRoot(envValue('DASHBOARD_RESULTS_ROOT') ?? paths.resultsRoot),
    demoExamplesRoot: resolveRoot(envValue('DASHBOARD_DEMO_EXAMPLES_ROOT') ?? paths.demoExamplesRoot),
    tempRoot: resolveRoot(envValue('DASHBOARD_TEMP_ROOT') ?? paths.tempRoot),
    logsRoot: resolveRoot(envValue('DASHBOARD_LOGS_ROOT') ?? paths.logsRoot)
  };
}

function isPathInsideOrEqual(root: string, candidate: string): boolean {
  const relative = path.relative(resolveRoot(root), resolveRoot(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function createDevelopmentRuntimePaths(repoRoot: string): RuntimePaths {
  const normalizedRepoRoot = resolveRoot(repoRoot);
  return {
    mode: 'development',
    repoRoot: normalizedRepoRoot,
    dataRoot: path.join(normalizedRepoRoot, 'input-data-versions'),
    resultsRoot: path.join(normalizedRepoRoot, 'Results'),
    demoExamplesRoot: path.join(normalizedRepoRoot, 'dashboard', 'demo-examples'),
    tempRoot: path.join(normalizedRepoRoot, 'tmp'),
    logsRoot: path.join(normalizedRepoRoot, 'tmp', 'dashboard-logs')
  };
}

export function assertDesktopWritablePathsOutsideResources(paths: RuntimePaths): void {
  if (paths.mode !== 'desktop' || !paths.appResourcesRoot) {
    return;
  }

  const writableRoots = [
    { label: 'resultsRoot', root: paths.resultsRoot },
    { label: 'tempRoot', root: paths.tempRoot },
    { label: 'logsRoot', root: paths.logsRoot }
  ];

  for (const { label, root } of writableRoots) {
    if (isPathInsideOrEqual(paths.appResourcesRoot, root)) {
      throw new Error(`Desktop ${label} must not point under app resources: ${root}`);
    }
  }
}

export function createDesktopRuntimePaths(options: DesktopRuntimePathOptions): RuntimePaths {
  const appResourcesRoot = resolveRoot(options.appResourcesRoot);
  const electronUserDataRoot = resolveRoot(options.electronUserDataRoot);
  const paths: RuntimePaths = {
    mode: 'desktop',
    repoRoot: resolveRoot(options.repoRoot ?? appResourcesRoot),
    dataRoot: path.join(appResourcesRoot, 'release-data', 'input-data-versions'),
    resultsRoot: path.join(electronUserDataRoot, 'Results'),
    demoExamplesRoot: path.join(appResourcesRoot, 'release-data', 'demo-examples'),
    tempRoot: path.join(electronUserDataRoot, 'tmp'),
    logsRoot: path.join(electronUserDataRoot, 'logs'),
    appResourcesRoot,
    electronUserDataRoot
  };

  assertDesktopWritablePathsOutsideResources(paths);
  return paths;
}

export function createRuntimePathsFromEnv(repoRoot: string): RuntimePaths {
  const mode = envValue('DASHBOARD_RUNTIME_MODE')?.toLowerCase();
  if (mode === 'desktop') {
    const appResourcesRoot = envValue('DASHBOARD_APP_RESOURCES_ROOT');
    const electronUserDataRoot = envValue('DASHBOARD_ELECTRON_USER_DATA_ROOT');
    if (!appResourcesRoot || !electronUserDataRoot) {
      throw new Error(
        'DASHBOARD_RUNTIME_MODE=desktop requires DASHBOARD_APP_RESOURCES_ROOT and DASHBOARD_ELECTRON_USER_DATA_ROOT.'
      );
    }
    const paths = applyRootOverrides(createDesktopRuntimePaths({ appResourcesRoot, electronUserDataRoot, repoRoot }));
    assertDesktopWritablePathsOutsideResources(paths);
    return paths;
  }

  return applyRootOverrides(createDevelopmentRuntimePaths(repoRoot));
}

export function resolveRuntimePaths(input: RuntimePathInput): RuntimePaths {
  return isRuntimePaths(input) ? input : createDevelopmentRuntimePaths(input);
}

function relativeIfInside(root: string, label: string, absolutePath: string): string | null {
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return relative === '' ? label : path.join(label, relative).replace(/\\/g, '/');
}

export function formatRuntimePath(paths: RuntimePaths, absolutePath: string): string {
  const normalized = resolveRoot(absolutePath);
  const mappings = [
    { root: paths.logsRoot, label: paths.mode === 'development' ? 'tmp/dashboard-logs' : 'logs' },
    { root: paths.dataRoot, label: 'input-data-versions' },
    { root: paths.resultsRoot, label: 'Results' },
    { root: paths.tempRoot, label: 'tmp' }
  ];

  for (const mapping of mappings) {
    const relative = relativeIfInside(mapping.root, mapping.label, normalized);
    if (relative) {
      return relative;
    }
  }

  const repoRelative = relativeIfInside(paths.repoRoot, '', normalized);
  return repoRelative && repoRelative.length > 0 ? repoRelative : normalized.replace(/\\/g, '/');
}
