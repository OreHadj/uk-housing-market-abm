// Author: Max Stoddard
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { startDashboardServer, type DashboardServerHandle } from '../server/dashboardServer';
import { createPackagedModelLauncher } from '../server/lib/modelLauncher';
import { createDesktopRuntimePaths, type RuntimePaths } from '../server/lib/runtimePaths';
import { exportDesktopSupportBundle } from '../server/lib/supportBundle';
import {
  assertTrustedDesktopIpcSender,
  classifyDesktopWindowOpenTarget,
  shouldBlockDashboardNavigation
} from './security';

interface DesktopFolderOpenResult {
  ok: boolean;
  error?: string;
}

interface DesktopSupportBundleExportResult {
  ok: boolean;
  path?: string;
  files?: string[];
  error?: string;
}

const electronPackageRoot = path.resolve(__dirname, '..', '..');
const dashboardRoot = path.resolve(electronPackageRoot, '..');
const repoRoot = path.resolve(dashboardRoot, '..');
const desktopProductName = 'UK Housing Model';
const desktopAuthToken = randomBytes(32).toString('hex');

let mainWindow: BrowserWindow | null = null;
let serverHandle: DashboardServerHandle | null = null;
let runtimePaths: RuntimePaths | null = null;
let trustedDashboardOrigin: string | null = null;
let shutdownStarted = false;
let quitAfterShutdown = false;

app.setName(desktopProductName);
app.setPath('userData', path.join(app.getPath('appData'), desktopProductName));

function configuredPath(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function resolveAppResourcesRoot(): string {
  return configuredPath('DASHBOARD_APP_RESOURCES_ROOT') ?? (app.isPackaged ? process.resourcesPath : repoRoot);
}

function resolveJavaExecutable(resourcesRoot: string): string {
  const configured = configuredPath('DASHBOARD_PACKAGED_JAVA_EXE') ?? configuredPath('DASHBOARD_JAVA_BIN');
  if (configured) {
    return configured;
  }
  return path.join(resourcesRoot, 'java', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
}

function resolveModelJar(resourcesRoot: string): string {
  return (
    configuredPath('DASHBOARD_MODEL_JAR') ??
    path.join(resourcesRoot, 'model', 'housing-model-1.0-SNAPSHOT-windows-release.jar')
  );
}

function resolveStaticRoot(): string {
  return configuredPath('DASHBOARD_STATIC_ROOT') ?? path.join(dashboardRoot, 'dist');
}

function shouldQuitAfterLoadForSmoke(): boolean {
  return process.env.DASHBOARD_DESKTOP_SMOKE_QUIT_AFTER_LOAD?.trim().toLowerCase() === 'true';
}

if (shouldQuitAfterLoadForSmoke()) {
  app.disableHardwareAcceleration();
}

function createDesktopPaths(resourcesRoot: string): RuntimePaths {
  const configuredResourcesRoot = configuredPath('DASHBOARD_APP_RESOURCES_ROOT');
  const paths = createDesktopRuntimePaths({
    appResourcesRoot: resourcesRoot,
    electronUserDataRoot: app.getPath('userData'),
    repoRoot
  });
  const configuredExamplesRoot = configuredPath('DASHBOARD_DEMO_EXAMPLES_ROOT');
  if (configuredExamplesRoot) paths.demoExamplesRoot = configuredExamplesRoot;

  if (!app.isPackaged && !configuredResourcesRoot && !configuredPath('DASHBOARD_DATA_ROOT')) {
    return {
      ...paths,
      dataRoot: path.join(repoRoot, 'input-data-versions'),
      demoExamplesRoot: configuredExamplesRoot ?? path.join(repoRoot, 'dashboard', 'demo-examples')
    };
  }

  return paths;
}

async function openFolder(folderPath: string): Promise<DesktopFolderOpenResult> {
  try {
    fs.mkdirSync(folderPath, { recursive: true });
    const error = await shell.openPath(folderPath);
    return error ? { ok: false, error } : { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

async function fetchRuntimeDiagnostics(): Promise<unknown> {
  if (!serverHandle) {
    throw new Error('Desktop dashboard server is not running.');
  }
  const response = await fetch(new URL('/api/runtime-deps', serverHandle.url));
  if (!response.ok) {
    throw new Error(`Runtime diagnostics request failed with status ${response.status}.`);
  }
  return response.json();
}

async function exportSupportBundle(): Promise<DesktopSupportBundleExportResult> {
  try {
    if (!runtimePaths) {
      return { ok: false, error: 'Desktop runtime paths are not initialised.' };
    }
    const runtimeDiagnostics = await fetchRuntimeDiagnostics();
    const bundle = exportDesktopSupportBundle({
      runtimePaths,
      runtimeDiagnostics
    });
    return {
      ok: true,
      path: bundle.bundlePath,
      files: bundle.files
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

function assertTrustedDesktopIpcEvent(event: IpcMainInvokeEvent): void {
  assertTrustedDesktopIpcSender({
    trustedOrigin: trustedDashboardOrigin,
    mainWindowWebContentsId: mainWindow?.webContents.id ?? null,
    senderWebContentsId: event.sender.id,
    senderFrame: event.senderFrame
  });
}

function registerDesktopIpc(): void {
  ipcMain.handle('uk-housing-desktop:get-app-version', (event: IpcMainInvokeEvent) => {
    assertTrustedDesktopIpcEvent(event);
    return app.getVersion();
  });
  ipcMain.handle('uk-housing-desktop:get-api-auth-token', (event: IpcMainInvokeEvent) => {
    assertTrustedDesktopIpcEvent(event);
    return desktopAuthToken;
  });
  ipcMain.handle('uk-housing-desktop:open-results-folder', (event: IpcMainInvokeEvent) => {
    assertTrustedDesktopIpcEvent(event);
    if (!runtimePaths) {
      return { ok: false, error: 'Desktop runtime paths are not initialised.' };
    }
    return openFolder(runtimePaths.resultsRoot);
  });
  ipcMain.handle('uk-housing-desktop:open-logs-folder', (event: IpcMainInvokeEvent) => {
    assertTrustedDesktopIpcEvent(event);
    if (!runtimePaths) {
      return { ok: false, error: 'Desktop runtime paths are not initialised.' };
    }
    return openFolder(runtimePaths.logsRoot);
  });
  ipcMain.handle('uk-housing-desktop:export-support-bundle', (event: IpcMainInvokeEvent) => {
    assertTrustedDesktopIpcEvent(event);
    return exportSupportBundle();
  });
}

async function createMainWindow(url: string, trustedOrigin: string): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.webContents.on('will-navigate', (event) => {
    if (shouldBlockDashboardNavigation({ url: event.url, isMainFrame: event.isMainFrame }, trustedOrigin)) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    const decision = classifyDesktopWindowOpenTarget(details.url);
    if (decision.openExternalUrl) {
      void shell.openExternal(decision.openExternalUrl).catch((error: unknown) => {
        console.error('[desktop] failed to open external URL:', error);
      });
    }
    return { action: decision.action };
  });

  await mainWindow.loadURL(url);
  if (shouldQuitAfterLoadForSmoke()) {
    setTimeout(() => {
      app.quit();
    }, 250);
  }
}

async function shutdownDesktopServer(): Promise<void> {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  if (serverHandle) {
    await serverHandle.shutdown();
    serverHandle = null;
  }
}

async function startDesktopApp(): Promise<void> {
  const resourcesRoot = resolveAppResourcesRoot();
  runtimePaths = createDesktopPaths(resourcesRoot);
  const javaExe = resolveJavaExecutable(resourcesRoot);
  const modelJar = resolveModelJar(resourcesRoot);
  const launcher = createPackagedModelLauncher(javaExe, modelJar);

  serverHandle = await startDashboardServer({
    dashboardRoot,
    repoRoot,
    runtimePaths,
    desktopAuthToken,
    launcher,
    modelRunsConfigured: true,
    isDevRuntime: false,
    staticServing: {
      enabled: true,
      root: resolveStaticRoot()
    }
  });

  trustedDashboardOrigin = new URL(serverHandle.url).origin;
  await createMainWindow(serverHandle.url, trustedDashboardOrigin);
}

registerDesktopIpc();

app.on('before-quit', (event) => {
  if (quitAfterShutdown) {
    return;
  }
  event.preventDefault();
  void shutdownDesktopServer().finally(() => {
    quitAfterShutdown = true;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!mainWindow && serverHandle && trustedDashboardOrigin) {
    void createMainWindow(serverHandle.url, trustedDashboardOrigin);
  }
});

void app.whenReady().then(startDesktopApp).catch((error) => {
  console.error('[desktop] failed to start:', error);
  app.exit(1);
});
