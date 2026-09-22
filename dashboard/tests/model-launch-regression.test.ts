// Author: Max Stoddard
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPackagedModelLauncher,
  getConfiguredMavenBin,
  normalizeMavenRuntimeClasspath,
  spawnCommand,
  type ModelLauncher,
  type ModelLaunchRequest
} from '../server/lib/modelLauncher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const snapshot = 'v4.19';
const modelJar = path.join(repoRoot, 'target', 'housing-model-1.0-SNAPSHOT-windows-release.jar');
const expectedOutputFiles = ['Output-run1.csv', 'config.properties'];

interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function runCommand(command: string, args: string[], cwd: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, { cwd, shell: false });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', reject);
    child.on('close', (exitCode, signal) => {
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
}

async function runCheckedCommand(command: string, args: string[], cwd: string): Promise<ProcessResult> {
  const result = await runCommand(command, args, cwd);
  assert.equal(
    result.exitCode,
    0,
    `${command} ${args.join(' ')} failed with signal ${result.signal ?? 'none'}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
  );
  return result;
}

function copyPublicSnapshotCsvs(dataRoot: string): void {
  const sourceRoot = path.join(repoRoot, 'input-data-versions', snapshot);
  fs.mkdirSync(dataRoot, { recursive: true });
  for (const fileName of fs.readdirSync(sourceRoot)) {
    if (fileName.endsWith('.csv')) {
      fs.copyFileSync(path.join(sourceRoot, fileName), path.join(dataRoot, fileName));
    }
  }
}

function stripInlineComment(value: string): string {
  const index = value.indexOf(' #');
  return index >= 0 ? value.slice(0, index) : value;
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function writeDeterministicConfig(configPath: string, dataRoot: string): void {
  const sourceConfig = path.join(repoRoot, 'input-data-versions', snapshot, 'config.properties');
  const overrides = new Map<string, string>([
    ['SEED', '1'],
    ['N_STEPS', '0'],
    ['N_SIMS', '1'],
    ['TARGET_POPULATION', '100'],
    ['TIME_TO_START_RECORDING_TRANSACTIONS', '0'],
    ['recordTransactions', 'false'],
    ['recordNBidUpFrequency', 'false'],
    ['recordCoreIndicators', 'false'],
    ['recordQualityBandPrice', 'false'],
    ['recordHouseholdID', 'false'],
    ['recordEmploymentIncome', 'false'],
    ['recordRentalIncome', 'false'],
    ['recordBankBalance', 'false'],
    ['recordHousingWealth', 'false'],
    ['recordTotalDebt', 'false'],
    ['recordHousingStatus', 'false'],
    ['recordConsumption', 'false'],
    ['recordNHousesOwned', 'false'],
    ['recordAge', 'false'],
    ['recordSavingRate', 'false'],
    ['enableBTLAmortizingMortgageMode', 'false'],
    ['enableBTLDownpaymentLognormal', 'false'],
    ['enableBTLAlternativeReturn', 'false']
  ]);
  const seenOverrides = new Set<string>();
  const rewritten = fs.readFileSync(sourceConfig, 'utf-8').split(/\r?\n/).map((line) => {
    const match = /^(\s*)([A-Za-z0-9_]+)(\s*=\s*)(.*)$/.exec(line);
    if (!match) {
      return line;
    }

    const [, leading, key, separator, rawValue] = match;
    const overrideValue = overrides.get(key);
    if (overrideValue !== undefined) {
      seenOverrides.add(key);
      return `${leading}${key}${separator}${overrideValue}`;
    }

    if (key.startsWith('DATA_')) {
      const fileName = path.basename(unquote(stripInlineComment(rawValue).trim()));
      const dataPath = path.join(dataRoot, fileName);
      assert.ok(fs.existsSync(dataPath), `Missing copied public data file for ${key}: ${dataPath}`);
      return `${leading}${key}${separator}"${dataPath.replace(/\\/g, '/')}"`;
    }

    return line;
  });

  for (const key of overrides.keys()) {
    assert.ok(seenOverrides.has(key), `Missing config override key: ${key}`);
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${rewritten.join('\n')}\n`, 'utf-8');
}

function hashFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function outputManifest(outputPath: string): Map<string, string> {
  const manifest = new Map<string, string>();
  for (const fileName of fs.readdirSync(outputPath).sort()) {
    const filePath = path.join(outputPath, fileName);
    if (fs.statSync(filePath).isFile()) {
      manifest.set(fileName, hashFile(filePath));
    }
  }
  return manifest;
}

function formatManifest(manifest: Map<string, string>): string {
  return [...manifest.entries()].map(([fileName, hash]) => `${hash}  ${fileName}`).join('\n');
}

function assertManifestsEqual(left: Map<string, string>, right: Map<string, string>): void {
  assert.deepEqual(
    [...left.keys()],
    expectedOutputFiles,
    `Unexpected classpath baseline output files:\n${formatManifest(left)}`
  );
  assert.deepEqual(
    [...right.keys()],
    expectedOutputFiles,
    `Unexpected packaged output files:\n${formatManifest(right)}`
  );
  assert.deepEqual(
    Object.fromEntries(right),
    Object.fromEntries(left),
    `Classpath baseline and packaged outputs diverged.\n\nBaseline:\n${formatManifest(left)}\n\nPackaged:\n${formatManifest(right)}`
  );
}

function assertCopiedConfigMatches(configPath: string, outputPath: string): void {
  const copiedConfigPath = path.join(outputPath, 'config.properties');
  assert.equal(hashFile(copiedConfigPath), hashFile(configPath), `Copied config mismatch at ${copiedConfigPath}`);
}

function assertGeneratedDataPaths(configText: string, dataRoot: string): void {
  const normalizedDataRoot = dataRoot.replace(/\\/g, '/');
  const dataLines = configText.split(/\r?\n/).filter((line) => /^\s*DATA_[A-Z0-9_]+\s*=/.test(line));
  assert.ok(dataLines.length > 0, 'Expected generated config to include explicit DATA_* paths');
  for (const line of dataLines) {
    const match = /^\s*(DATA_[A-Z0-9_]+)\s*=\s*"([^"]+)"\s*$/.exec(line);
    assert.ok(match, `Expected DATA_* path to be quoted without trailing inline text: ${line}`);
    const [, key, configValue] = match;
    assert.ok(
      configValue.startsWith(`${normalizedDataRoot}/`),
      `Expected ${key} to point under configured data root: ${configValue}`
    );
    assert.equal(configValue.includes('\\'), false, `Expected ${key} to use forward slashes`);
    assert.ok(fs.existsSync(configValue), `Expected ${key} file to exist: ${configValue}`);
  }
}

async function runLauncher(launcher: ModelLauncher, request: ModelLaunchRequest): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = launcher.launch(request);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', reject);
    child.on('close', (exitCode, signal) => {
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
}

async function runCheckedLauncher(launcher: ModelLauncher, request: ModelLaunchRequest): Promise<ProcessResult> {
  const command = launcher.buildCommand(request);
  const result = await runLauncher(launcher, request);
  assert.equal(
    result.exitCode,
    0,
    `${launcher.mode} launcher failed with signal ${result.signal ?? 'none'}\nCommand: ${command.command} ${command.args.join(' ')}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
  );
  return result;
}

async function resolveRuntimeClasspath(): Promise<string> {
  const result = await runCheckedCommand(
    getConfiguredMavenBin(repoRoot),
    ['-q', '-Dexec.classpathScope=runtime', '-Dexec.executable=echo', '-Dexec.args=%classpath', 'exec:exec'],
    repoRoot
  );
  const classpath = result.stdout.trim().split(/\r?\n/).at(-1)?.trim();
  assert.ok(classpath, `Expected Maven to resolve a runtime classpath.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return normalizeMavenRuntimeClasspath(repoRoot, classpath);
}

function resolveJavaExe(): string {
  const javaBin = process.platform === 'win32' ? 'java.exe' : 'java';
  return process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', javaBin) : 'java';
}

const useUnicodePaths = process.platform !== 'win32';
const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), useUnicodePaths ? 'uk housing release modèle 用户-' : 'uk housing release path spaces-')
);
const dataRoot = path.join(tempRoot, 'release data', useUnicodePaths ? `${snapshot} données` : `${snapshot} data`);
const configPath = path.join(tempRoot, useUnicodePaths ? 'config dir José' : 'config dir Jose', 'config.properties');
const baselineOutput = path.join(tempRoot, useUnicodePaths ? 'classpath output Résultats' : 'classpath output Results');
const packagedOutput = path.join(tempRoot, useUnicodePaths ? 'jar output 東京' : 'jar output Tokyo');

try {
  copyPublicSnapshotCsvs(dataRoot);
  writeDeterministicConfig(configPath, dataRoot);

  const generatedConfig = fs.readFileSync(configPath, 'utf-8');
  assert.ok(generatedConfig.includes('SEED = 1'), 'Expected generated config to pin SEED=1');
  assert.ok(generatedConfig.includes('N_STEPS = 0'), 'Expected generated config to pin a short run');
  assertGeneratedDataPaths(generatedConfig, dataRoot);

  await runCheckedCommand(getConfiguredMavenBin(repoRoot), ['-q', '-DskipTests', '-Pwindows-release-fat-jar', 'package'], repoRoot);
  assert.ok(fs.existsSync(modelJar), `Expected Windows release fat jar to exist: ${modelJar}`);

  const javaExe = resolveJavaExe();
  const runtimeClasspath = await resolveRuntimeClasspath();
  await runCheckedCommand(
    javaExe,
    ['-cp', runtimeClasspath, 'housing.Model', '-configFile', configPath, '-outputFolder', baselineOutput, '-dev'],
    repoRoot
  );
  await runCheckedLauncher(createPackagedModelLauncher(javaExe, modelJar), {
    repoRoot,
    configPath,
    outputPath: packagedOutput
  });

  assertCopiedConfigMatches(configPath, baselineOutput);
  assertCopiedConfigMatches(configPath, packagedOutput);
  assertManifestsEqual(outputManifest(baselineOutput), outputManifest(packagedOutput));

  const outputRows = fs.readFileSync(path.join(baselineOutput, 'Output-run1.csv'), 'utf-8').trimEnd().split(/\r?\n/);
  assert.equal(outputRows.length, 2, 'Expected short deterministic run to write header plus one output row');
} finally {
  if (process.env.KEEP_RELEASE_LAUNCH_TEST_ARTIFACTS !== '1') {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`Kept release launch regression artifacts at ${tempRoot}`);
  }
}
