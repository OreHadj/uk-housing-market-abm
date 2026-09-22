#!/usr/bin/env node
// Author: Max Stoddard
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const dashboardRoot = path.join(repoRoot, 'dashboard');
const defaultInstallerRoot = path.join(dashboardRoot, 'release', 'windows', 'installer');
const packageJson = JSON.parse(fs.readFileSync(path.join(dashboardRoot, 'package.json'), 'utf-8'));
const productName = 'UK Housing Model';
const defaultTimeoutMs = 300_000;
const modelJarName = 'housing-model-1.0-SNAPSHOT-windows-release.jar';

// Same UUID v5 derivation as electron-builder 26.8.1 NsisTarget. Keep appId stable.
const guidBytes = crypto.createHash('sha1')
  .update(Buffer.from('50e065bc313411e69bab38c9862bdaf3', 'hex'))
  .update('uk.housing.model.dashboard').digest().subarray(0, 16);
guidBytes[6] = (guidBytes[6] & 0x0f) | 0x50;
guidBytes[8] = (guidBytes[8] & 0x3f) | 0x80;
const guidHex = guidBytes.toString('hex');
export const installationRegistryKey = `Software\\${guidHex.slice(0, 8)}-${guidHex.slice(8, 12)}-${guidHex.slice(12, 16)}-${guidHex.slice(16, 20)}-${guidHex.slice(20)}`;

function usage() {
  return `Usage: node scripts/windows/smoke-installed-windows-installer.mjs [options]

Options:
  --installer <path>           Candidate installer EXE. Defaults to the current release artifact.
  --install-dir <path>         New, absolute Windows application directory (optional).
  --previous-installer <path>  Install this older EXE first to test a real upgrade.
  --timeout-ms <number>        Per-process timeout. Defaults to ${defaultTimeoutMs}.
  --help                      Show this help.

Installs for the current user, runs bundled Java, reinstalls/upgrades without /D,
checks shortcuts and data preservation, then uninstalls. Use a disposable Windows
user or VM with no existing installation. Existing user data is never removed;
only this test's own temporary files are cleaned after success.
`;
}

export function parseArgs(argv) {
  const options = {
    installerPath: path.join(defaultInstallerRoot, `UK-Housing-Model-${packageJson.version}-Setup.exe`),
    installDir: null,
    previousInstaller: null,
    help: false,
    timeoutMs: defaultTimeoutMs
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--installer') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--installer requires a path.');
      }
      options.installerPath = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      const value = Number(argv[i + 1]);
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error('--timeout-ms requires a positive integer.');
      }
      options.timeoutMs = value;
      i += 1;
      continue;
    }
    if (arg === '--install-dir' || arg === '--previous-installer') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a path.`);
      }
      if (arg === '--install-dir') {
        options.installDir = validateInstallDir(value);
      } else {
        options.previousInstaller = path.resolve(value);
      }
      i += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

export function validateInstallDir(value) {
  if (!/^[a-z]:[\\/]/i.test(value) || /["<>|?*\x00-\x1f]/.test(value) || value.slice(2).includes(':')) {
    throw new Error('--install-dir must be an absolute local Windows directory without invalid filename characters.');
  }
  const normalized = path.win32.normalize(value);
  if (normalized === path.win32.parse(normalized).root || /[. ](?:[\\/]|$)/.test(normalized)) {
    throw new Error('--install-dir must name a dedicated application folder, not a drive root or ambiguous Windows path.');
  }
  return normalized.replace(/\\$/, '');
}

export function installerArguments(installDir = null) {
  return ['/S', '/currentuser', ...(installDir ? [`/D=${validateInstallDir(installDir)}`] : [])];
}

export function nsisInvocation(command, args) {
  if (/["\x00-\x1f]/.test(command)) {
    throw new Error('Invalid NSIS executable path.');
  }
  // /D= and _?= must be unquoted and last, including when their values contain
  // spaces. Bypass Node's argument quoting, but explicitly quote argv[0].
  // No shell interprets the path, so characters such as & and $ remain literal.
  return { command, args, options: { shell: false, windowsVerbatimArguments: true, argv0: `"${command}"` } };
}

function log(message) {
  console.log(`[installed-installer-smoke] ${message}`);
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

function sanitizedWindowsPath() {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  return [
    path.join(systemRoot, 'System32'),
    systemRoot
  ].join(path.delimiter);
}

function runChecked(command, args, options) {
  const result = spawnSync(command, args, {
    ...options,
    shell: false,
    encoding: 'utf-8',
    windowsHide: true
  });
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(`${command} ${args.join(' ')} timed out after ${options.timeout}ms.`);
    }
    throw new Error(`${command} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited with status ${result.status ?? 'unknown'}.\n` +
        `STDOUT:\n${result.stdout ?? ''}\nSTDERR:\n${result.stderr ?? ''}`
    );
  }
  return result;
}

function runNsis(command, args, timeout) {
  const invocation = nsisInvocation(command, args);
  return runChecked(invocation.command, invocation.args, { ...invocation.options, timeout });
}

function psLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function readPowerShellJson(script) {
  const source = `$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n${script}`;
  const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = runChecked(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { timeout: 30_000 });
  return JSON.parse(result.stdout.trim().replace(/^\uFEFF/, ''));
}

function registeredInstallations() {
  return readPowerShellJson(`
function Read-InstallLocation($hive) {
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, [Microsoft.Win32.RegistryView]::Registry64)
  try {
    $key = $base.OpenSubKey(${psLiteral(installationRegistryKey)})
    if ($null -eq $key) { return $null }
    try { return $key.GetValue('InstallLocation') } finally { $key.Dispose() }
  } finally { $base.Dispose() }
}
@{ currentUser = (Read-InstallLocation 'CurrentUser'); allUsers = (Read-InstallLocation 'LocalMachine') } | ConvertTo-Json -Compress
`);
}

export function sameWindowsPath(left, right) {
  return path.win32.normalize(left).replace(/\\$/, '').toLowerCase() === path.win32.normalize(right).replace(/\\$/, '').toLowerCase();
}

function installedDirectory(expected = null) {
  const state = registeredInstallations();
  if (!state.currentUser || state.allUsers) {
    throw new Error(`Expected only a per-user installation, found ${JSON.stringify(state)}.`);
  }
  if (expected && !sameWindowsPath(state.currentUser, expected)) {
    throw new Error(`Installation directory changed: expected ${expected}, found ${state.currentUser}.`);
  }
  assertFile(path.join(state.currentUser, `${productName}.exe`), 'registered installed executable');
  return state.currentUser;
}

function assertShortcuts(installDir, removed = false) {
  const links = readPowerShellJson(`
$shell = New-Object -ComObject WScript.Shell
$folders = @([Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('Programs'))
$links = @($folders | ForEach-Object {
  $link = Join-Path $_ ${psLiteral(`${productName}.lnk`)}
  if (Test-Path -LiteralPath $link) { @{ path = $link; target = $shell.CreateShortcut($link).TargetPath } }
})
ConvertTo-Json -InputObject $links -Compress
`);
  const expectedExe = path.join(installDir, `${productName}.exe`);
  if (removed ? links.length !== 0 : links.length !== 2 || links.some((link) => !sameWindowsPath(link.target, expectedExe))) {
    throw new Error(`Unexpected ${removed ? 'remaining' : 'installed'} shortcuts: ${JSON.stringify(links)}`);
  }
}

function userDataRoot() {
  const appData = process.env.APPDATA;
  if (!appData) {
    throw new Error('APPDATA is not set; cannot locate Electron userData.');
  }
  return path.join(appData, productName);
}

function installedRuntimeEnv() {
  const env = {
    ...process.env,
    PATH: sanitizedWindowsPath()
  };
  // Developer overrides must not conceal a missing installed resource.
  for (const name of Object.keys(env)) {
    if (name.startsWith('DASHBOARD_')) delete env[name];
  }
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.JAVA_HOME;
  delete env.JAVA_TOOL_OPTIONS;
  delete env.JDK_JAVA_OPTIONS;
  delete env._JAVA_OPTIONS;
  return env;
}

function smokeLaunch(installDir, timeoutMs) {
  const installedExe = path.join(installDir, `${productName}.exe`);
  const logsRoot = path.join(userDataRoot(), 'logs');
  const logPaths = ['app.log', 'server.log'].map((name) => path.join(logsRoot, name));
  const offsets = logPaths.map((file) => fs.existsSync(file) ? fs.statSync(file).size : 0);
  const env = { ...installedRuntimeEnv(), DASHBOARD_DESKTOP_SMOKE_QUIT_AFTER_LOAD: 'true' };
  runChecked(installedExe, ['--no-sandbox', '--disable-gpu'], {
    env,
    timeout: timeoutMs
  });
  const [appLogText, serverLogText] = logPaths.map((file, index) => {
    assertFile(file, 'installed application log');
    const bytes = fs.readFileSync(file);
    return bytes.subarray(bytes.length < offsets[index] ? 0 : offsets[index]).toString('utf-8');
  });
  if (!appLogText.includes('[lifecycle] dashboard server listening')) {
    throw new Error('Installed app did not write a fresh server-launch log.');
  }
  for (const expected of [
    '[runtime-paths] mode=desktop',
    `[runtime-paths] dataRoot=${path.join(installDir, 'resources', 'release-data', 'input-data-versions')}`,
    '[runtime-deps] java=available',
    `[runtime-deps] java bin=${path.join(installDir, 'resources', 'java', 'bin', 'java.exe')}`
  ]) {
    if (!serverLogText.includes(expected)) throw new Error(`Installed app log is missing: ${expected}`);
  }
}

export function minimalModelConfig(source, dataRoot) {
  const overrides = new Map([['SEED', '1'], ['N_STEPS', '0'], ['N_SIMS', '1'], ['TARGET_POPULATION', '100']]);
  const seen = new Set();
  const rewritten = source.split(/\r?\n/).map((line) => {
    const match = /^(\s*)([A-Za-z0-9_]+)(\s*=\s*)(.*)$/.exec(line);
    if (!match) return line;
    const [, leading, key, separator, raw] = match;
    if (overrides.has(key)) {
      seen.add(key);
      return `${leading}${key}${separator}${overrides.get(key)}`;
    }
    if (/^record[A-Z]/.test(key)) return `${leading}${key}${separator}false`;
    if (key.startsWith('DATA_')) {
      const value = raw.split(' #')[0].trim().replace(/^(["'])(.*)\1$/, '$2');
      const dataFile = path.join(dataRoot, path.win32.basename(value));
      assertFile(dataFile, `bundled ${key} data`);
      return `${leading}${key}${separator}"${dataFile.replace(/\\/g, '/')}"`;
    }
    return line;
  });
  if (seen.size !== overrides.size) throw new Error('Bundled config is missing required short-run settings.');
  return `${rewritten.join('\n')}\n`;
}

function smokeModel(installDir, scratchRoot, outputRoot, timeout) {
  const resources = path.join(installDir, 'resources');
  const java = path.join(resources, 'java', 'bin', 'java.exe');
  const jar = path.join(resources, 'model', modelJarName);
  const dataRoot = path.join(resources, 'release-data', 'input-data-versions', 'v0');
  assertFile(java, 'bundled Java');
  assertFile(jar, 'bundled model');
  fs.mkdirSync(scratchRoot, { recursive: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  const config = path.join(scratchRoot, 'config.properties');
  fs.writeFileSync(config, minimalModelConfig(fs.readFileSync(path.join(dataRoot, 'config.properties'), 'utf-8'), dataRoot));
  runChecked(java, ['-jar', jar, '-configFile', config, '-outputFolder', outputRoot, '-dev'], {
    cwd: scratchRoot, env: installedRuntimeEnv(), timeout
  });
  const output = path.join(outputRoot, 'Output-run1.csv');
  assertFile(output, 'real bundled model output');
  if (fs.readFileSync(output, 'utf-8').trim().split(/\r?\n/).length < 2) {
    throw new Error('Bundled model did not produce a data row.');
  }
  return output;
}

function preservationSnapshot(files) {
  return files.map((file) => ({ file, bytes: fs.readFileSync(file) }));
}

function assertPreserved(snapshot) {
  for (const { file, bytes } of snapshot) {
    assertFile(file, 'preserved user data');
    if (!fs.readFileSync(file).equals(bytes)) throw new Error(`User data changed: ${file}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (process.platform !== 'win32') {
    log(`skipping installed-app smoke on ${os.platform()}; this check must run on Windows.`);
    return;
  }

  assertFile(options.installerPath, 'Windows installer');
  if (options.previousInstaller) assertFile(options.previousInstaller, 'previous Windows installer');
  const existing = registeredInstallations();
  if (existing.currentUser || existing.allUsers) {
    throw new Error(`Use a disposable Windows user/VM without an existing installation: ${JSON.stringify(existing)}.`);
  }
  if (options.installDir && fs.existsSync(options.installDir)) {
    throw new Error(`Use a new, dedicated smoke-test installation folder: ${options.installDir}`);
  }

  const token = `installer-smoke-${crypto.randomUUID()}`;
  const scratchRoot = path.join(userDataRoot(), 'tmp', token);
  const resultsRoot = path.join(userDataRoot(), 'Results', token);
  const logMarker = path.join(userDataRoot(), 'logs', `${token}.txt`);
  fs.mkdirSync(scratchRoot, { recursive: true });
  fs.mkdirSync(resultsRoot, { recursive: true });
  fs.mkdirSync(path.dirname(logMarker), { recursive: true });
  const markers = [path.join(scratchRoot, 'preserve.txt'), path.join(resultsRoot, 'preserve.txt'), logMarker];
  markers.forEach((file) => fs.writeFileSync(file, token, { flag: 'wx' }));
  log(`test data: ${resultsRoot}`);

  const firstInstaller = options.previousInstaller ?? options.installerPath;
  log(`installing ${firstInstaller}`);
  runNsis(firstInstaller, installerArguments(options.installDir), options.timeoutMs);
  const installDir = installedDirectory(options.installDir);
  log(`registered installation: ${installDir}`);
  assertShortcuts(installDir);
  smokeLaunch(installDir, options.timeoutMs);
  const output = smokeModel(installDir, path.join(scratchRoot, 'before'), path.join(resultsRoot, 'before'), options.timeoutMs);
  const snapshot = preservationSnapshot([...markers, output, path.join(scratchRoot, 'before', 'config.properties')]);

  log(`${options.previousInstaller ? 'upgrading' : 'reinstalling'} without a directory override`);
  runNsis(options.installerPath, installerArguments(), options.timeoutMs);
  installedDirectory(installDir);
  assertShortcuts(installDir);
  assertPreserved(snapshot);
  smokeLaunch(installDir, options.timeoutMs);
  const updatedOutput = smokeModel(installDir, path.join(scratchRoot, 'after'), path.join(resultsRoot, 'after'), options.timeoutMs);
  const uninstallSnapshot = [...snapshot, ...preservationSnapshot([updatedOutput, path.join(scratchRoot, 'after', 'config.properties')])];

  // Copy the uninstaller outside INSTDIR and use _?= to wait for the actual
  // uninstall process, rather than the bootstrap that exits after relaunching.
  const uninstaller = path.join(scratchRoot, 'uninstall.exe');
  fs.copyFileSync(path.join(installDir, `Uninstall ${productName}.exe`), uninstaller);
  log('uninstalling and checking user-data preservation');
  runNsis(uninstaller, ['/S', '/currentuser', `_?=${installDir}`], options.timeoutMs);
  const remaining = registeredInstallations();
  if (remaining.currentUser || remaining.allUsers || fs.existsSync(installDir)) {
    throw new Error(`Uninstall left an installation behind: ${installDir}; ${JSON.stringify(remaining)}`);
  }
  assertShortcuts(installDir, true);
  assertPreserved(uninstallSnapshot);
  // These UUID-named fixtures were created by this invocation, never user data.
  fs.rmSync(scratchRoot, { recursive: true });
  fs.rmSync(resultsRoot, { recursive: true });
  fs.unlinkSync(logMarker);
  log('passed install, bundled model run, upgrade/reinstall, shortcuts and uninstall preservation checks');
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    main();
  } catch (error) {
    console.error(`[installed-installer-smoke] ${(error instanceof Error ? error.message : String(error))}`);
    process.exitCode = 1;
  }
}
