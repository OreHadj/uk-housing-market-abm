#!/usr/bin/env node
// Author: Max Stoddard
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const dashboardRoot = path.join(repoRoot, 'dashboard');
const inputDataRoot = path.join(repoRoot, 'input-data-versions');
const mavenBin = process.env.MAVEN_BIN?.trim() || path.join(repoRoot, process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw');
const defaultOutputRoot = path.join(dashboardRoot, 'release', 'windows', 'resources');
const modelJarName = 'housing-model-1.0-SNAPSHOT-windows-release.jar';
const releaseLayoutVersion = 1;
const releaseInputVersionAllowlist = new Set(['v0o7', 'v0', 'v4.26', 'v5o3']);

// The Calibration page renders campaign provenance from these files. The wider
// calibration-evidence tree is ~61 MB of research output and stays out of the release;
// only the artifacts the dashboard actually reads are shipped (~571 KB).
const releaseCalibrationEvidenceAllowlist = [
  'calibration-evidence/output-grid-smm-v0-2011-carro-3level/OutputGridSmmMetadata.json',
  'calibration-evidence/output-five-parameter-turbo-v0o7/OutputParameterTurboCalibrationSummary.json',
  'calibration-evidence/output-five-parameter-turbo-v0o7/OutputParameterTurboMetadata.json',
  'calibration-evidence/output-five-parameter-turbo-v0o7/README.md',
  'calibration-evidence/output-five-parameter-turbo-v5o3/OutputParameterTurboCalibrationSummary.json',
  'calibration-evidence/output-five-parameter-turbo-v5o3/OutputParameterTurboMetadata.json',
  'calibration-evidence/output-five-parameter-turbo-v5o3/README.md',
  'CALIBRATION_PARAMETER_CHANGELOG.md'
];

function usage() {
  return `Usage: node scripts/windows/assemble-release-resources.mjs [options]

Options:
  --output <path>    Output resources directory. Defaults to dashboard/release/windows/resources.
  --check            Verify an existing resources directory without rebuilding or staging.
  --java-home <path> Java 25 JDK used for jlink.
  --skip-builds      Skip Maven/npm builds before staging resources.
  --help             Show this help.
`;
}

function parseArgs(argv) {
  const options = {
    outputRoot: defaultOutputRoot,
    check: false,
    javaHome: null,
    skipBuilds: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--check') {
      options.check = true;
      continue;
    }
    if (arg === '--skip-builds') {
      options.skipBuilds = true;
      continue;
    }
    if (arg === '--output') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--output requires a path.');
      }
      options.outputRoot = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    if (arg === '--java-home') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--java-home requires a path.');
      }
      options.javaHome = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function fail(message) {
  throw new Error(message);
}

function log(message) {
  console.log(`[release-resources] ${message}`);
}

function run(command, args, cwd) {
  log(`running: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.error) {
    fail(`${command} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${command} exited with status ${result.status ?? 'unknown'}.`);
  }
}

function runCapture(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    shell: process.platform === 'win32'
  });
  if (result.error) {
    fail(`${command} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(' ')} exited with status ${result.status ?? 'unknown'}.\n` +
        `STDOUT:\n${result.stdout ?? ''}\nSTDERR:\n${result.stderr ?? ''}`
    );
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function normalizeRel(filePath) {
  return filePath.split(path.sep).join('/');
}

function assertExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing ${label}: ${filePath}`);
  }
}

function assertFile(filePath, label) {
  assertExists(filePath, label);
  if (!fs.statSync(filePath).isFile()) {
    fail(`${label} is not a file: ${filePath}`);
  }
}

function assertDirectory(dirPath, label) {
  assertExists(dirPath, label);
  if (!fs.statSync(dirPath).isDirectory()) {
    fail(`${label} is not a directory: ${dirPath}`);
  }
}

function assertSafeOutputRoot(outputRoot) {
  const resolvedOutput = path.resolve(outputRoot);
  const protectedRoots = [
    path.parse(resolvedOutput).root,
    os.homedir(),
    os.tmpdir(),
    repoRoot,
    dashboardRoot,
    inputDataRoot,
    path.join(repoRoot, 'src'),
    path.join(repoRoot, 'docs'),
    path.join(repoRoot, 'scripts'),
    path.join(repoRoot, 'Results'),
    path.join(repoRoot, 'tmp'),
    path.join(repoRoot, 'private-datasets')
  ].map((item) => path.resolve(item));

  for (const protectedRoot of protectedRoots) {
    if (resolvedOutput === protectedRoot) {
      fail(`Refusing to use protected output directory: ${resolvedOutput}`);
    }
    const protectedRelative = path.relative(resolvedOutput, protectedRoot);
    if (protectedRelative && !protectedRelative.startsWith('..') && !path.isAbsolute(protectedRelative)) {
      fail(`Refusing to use output directory that contains protected path ${protectedRoot}: ${resolvedOutput}`);
    }
  }
}

function removeAndCreateOutputRoot(outputRoot) {
  assertSafeOutputRoot(outputRoot);
  fs.rmSync(outputRoot, { recursive: true, force: true });
  ensureDir(outputRoot);
}

function copyFile(source, destination) {
  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);
}

function copyDirectory(source, destination) {
  assertDirectory(source, 'source directory');
  fs.cpSync(source, destination, { recursive: true });
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function listFiles(root) {
  const files = [];
  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
      } else {
        fail(`Unsupported non-file release resource entry: ${absolutePath}`);
      }
    }
  }
  walk(root);
  return files;
}

function parseVersionParts(version) {
  const normalized = version.replace(/^v/i, '').toLowerCase();
  const numberedSuffixMatch = normalized.match(/o(\d+)$/u);
  const suffixMatch = numberedSuffixMatch ? null : normalized.match(/o+$/u);
  const suffixRank = numberedSuffixMatch ? 2 + Number.parseInt(numberedSuffixMatch[1] ?? '0', 10) : suffixMatch?.[0].length ?? 0;
  const numeric = numberedSuffixMatch
    ? normalized.slice(0, numberedSuffixMatch.index ?? normalized.length)
    : suffixRank > 0
      ? normalized.slice(0, -suffixRank)
      : normalized;
  return numeric.split('.').map((part) => Number.parseInt(part, 10)).concat(suffixRank);
}

function compareVersions(left, right) {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < maxLength; i += 1) {
    const leftPart = leftParts[i] ?? 0;
    const rightPart = rightParts[i] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }
  if (leftParts.length !== rightParts.length) {
    return leftParts.length - rightParts.length;
  }
  return left.localeCompare(right);
}

function listCanonicalVersions(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^v\d+(?:\.\d+)*(?:o+|o\d+)?$/i.test(name))
    .filter((name) => name !== 'v1')
    .filter((name) => fs.existsSync(path.join(root, name, 'config.properties')))
    .sort(compareVersions);
}

function stripInlineComment(value) {
  const index = value.indexOf(' #');
  return index >= 0 ? value.slice(0, index) : value;
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function extractDataReferences(configPath) {
  const references = [];
  const lines = fs.readFileSync(configPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const match = /^\s*(DATA_[A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const key = match[1];
    const rawValue = match[2];
    const value = unquote(stripInlineComment(rawValue).trim());
    const fileName = path.basename(value);
    if (!fileName) {
      fail(`DATA_* entry ${key} has no runtime file value in ${configPath}`);
    }
    references.push({ key, value, fileName });
  }
  if (references.length === 0) {
    fail(`No DATA_* runtime file references found in ${configPath}`);
  }
  return references;
}

function copyJsonFiles(sourceDir, destinationDir) {
  assertDirectory(sourceDir, 'release-data JSON source directory');
  const jsonFiles = fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));
  if (jsonFiles.length === 0) {
    fail(`No JSON files found under ${sourceDir}`);
  }
  for (const fileName of jsonFiles) {
    copyFile(path.join(sourceDir, fileName), path.join(destinationDir, fileName));
  }
}

function assembleReleaseData(outputRoot) {
  const releaseDataRoot = path.join(outputRoot, 'release-data');
  const releaseInputRoot = path.join(releaseDataRoot, 'input-data-versions');
  ensureDir(releaseInputRoot);

  const versions = listCanonicalVersions(inputDataRoot).filter((version) => releaseInputVersionAllowlist.has(version));
  if (versions.length === 0) {
    fail(`No allowlisted canonical input-data version folders found under ${inputDataRoot}`);
  }

  for (const version of releaseInputVersionAllowlist) {
    if (!versions.includes(version)) {
      fail(`Allowlisted input-data version is missing or invalid: ${version}`);
    }
  }

  for (const version of versions) {
    const sourceVersionRoot = path.join(inputDataRoot, version);
    const destinationVersionRoot = path.join(releaseInputRoot, version);
    const sourceConfigPath = path.join(sourceVersionRoot, 'config.properties');
    copyFile(sourceConfigPath, path.join(destinationVersionRoot, 'config.properties'));

    const copied = new Set(['config.properties']);
    for (const reference of extractDataReferences(sourceConfigPath)) {
      const sourceDataFile = path.join(sourceVersionRoot, reference.fileName);
      if (!fs.existsSync(sourceDataFile) || !fs.statSync(sourceDataFile).isFile()) {
        fail(
          `Missing runtime data file for ${reference.key} in ${sourceConfigPath}: ` +
            `${reference.value} -> ${sourceDataFile}`
        );
      }
      if (!copied.has(reference.fileName)) {
        copyFile(sourceDataFile, path.join(destinationVersionRoot, reference.fileName));
        copied.add(reference.fileName);
      }
    }
  }

  copyFile(
    path.join(inputDataRoot, 'dashboard-input-version-history.json'),
    path.join(releaseInputRoot, 'dashboard-input-version-history.json')
  );
  copyJsonFiles(
    path.join(inputDataRoot, 'validation'),
    path.join(releaseInputRoot, 'validation')
  );
  copyJsonFiles(
    path.join(inputDataRoot, 'validation-overlays'),
    path.join(releaseInputRoot, 'validation-overlays')
  );

  for (const relativePath of releaseCalibrationEvidenceAllowlist) {
    const sourcePath = path.join(inputDataRoot, relativePath);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      fail(`Missing calibration provenance file for release-data: ${sourcePath}`);
    }
    copyFile(sourcePath, path.join(releaseInputRoot, relativePath));
  }

  return writeReleaseDataManifest(releaseDataRoot);
}

function releaseDataManifestFilePaths(releaseDataRoot) {
  const manifestPaths = new Set(['release-data-manifest.json', 'release-data.sha256']);
  return listFiles(releaseDataRoot)
    .map((filePath) => normalizeRel(path.relative(releaseDataRoot, filePath)))
    .filter((relativePath) => !manifestPaths.has(relativePath))
    .sort((left, right) => left.localeCompare(right));
}

function buildReleaseDataManifest(releaseDataRoot) {
  const files = releaseDataManifestFilePaths(releaseDataRoot).map((relativePath) => {
    const filePath = path.join(releaseDataRoot, relativePath);
    return {
      path: relativePath,
      sizeBytes: fs.statSync(filePath).size,
      sha256: sha256File(filePath)
    };
  });
  const aggregateInput = `${files.map((entry) => `${entry.sha256}  ${entry.path}`).join('\n')}\n`;
  return {
    manifestVersion: 1,
    root: 'release-data',
    aggregateSha256: sha256Buffer(Buffer.from(aggregateInput, 'utf-8')),
    files
  };
}

function writeReleaseDataManifest(releaseDataRoot) {
  const manifest = buildReleaseDataManifest(releaseDataRoot);
  writeJson(path.join(releaseDataRoot, 'release-data-manifest.json'), manifest);
  fs.writeFileSync(
    path.join(releaseDataRoot, 'release-data.sha256'),
    `${manifest.aggregateSha256}  release-data\n`,
    'utf-8'
  );
  return manifest;
}

function validateReleaseDataAllowlist(releaseDataRoot) {
  const inputVersionsRoot = path.join(releaseDataRoot, 'input-data-versions');
  assertDirectory(inputVersionsRoot, 'release-data input-data-versions root');
  const allowedTopLevel = new Set([
    'input-data-versions',
    'release-data-manifest.json',
    'release-data.sha256'
  ]);

  for (const entry of fs.readdirSync(releaseDataRoot, { withFileTypes: true })) {
    if (!allowedTopLevel.has(entry.name)) {
      fail(`Unexpected top-level release-data entry: ${entry.name}`);
    }
  }

  const disallowedParts = new Set([
    'private-datasets',
    'Results',
    'tmp',
    'node_modules',
    'dist',
    'dist-server',
    'validation-sources',
    'agents'
  ]);
  // calibration-evidence is not denied outright: the dashboard reads a handful of provenance
  // artifacts from it. Anything outside that allowlist is still rejected.
  const allowedCalibrationEvidence = new Set(
    releaseCalibrationEvidenceAllowlist.map((entry) => `input-data-versions/${entry}`)
  );
  const disallowedBasenames = [/^AGENTS?\.md$/i, /^AGENT.*\.md$/i, /^CLAUDE\.md$/i, /^PROMPT\.md$/i, /^\.env/i];

  for (const filePath of listFiles(releaseDataRoot)) {
    const relativePath = normalizeRel(path.relative(releaseDataRoot, filePath));
    const parts = relativePath.split('/');
    if (parts.some((part) => disallowedParts.has(part))) {
      fail(`Disallowed path found in release-data: ${relativePath}`);
    }
    if (parts.includes('calibration-evidence') && !allowedCalibrationEvidence.has(relativePath)) {
      fail(`Non-allowlisted calibration-evidence file found in release-data: ${relativePath}`);
    }
    const baseName = path.basename(relativePath);
    if (disallowedBasenames.some((pattern) => pattern.test(baseName))) {
      fail(`Disallowed operational/local file found in release-data: ${relativePath}`);
    }
  }

  const versionDirs = fs.readdirSync(inputVersionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^v\d+(?:\.\d+)*(?:o+|o\d+)?$/i.test(name));
  if (versionDirs.includes('v1')) {
    fail('release-data must not include the non-canonical v1 input-data folder.');
  }
  const disallowedVersionDirs = versionDirs.filter((version) => !releaseInputVersionAllowlist.has(version));
  if (disallowedVersionDirs.length > 0) {
    fail(`release-data includes non-allowlisted input-data versions: ${disallowedVersionDirs.join(', ')}`);
  }
}

function validateReleaseDataConfigs(releaseDataRoot) {
  const releaseInputRoot = path.join(releaseDataRoot, 'input-data-versions');
  const versions = listCanonicalVersions(releaseInputRoot);
  if (versions.length === 0) {
    fail(`No canonical release-data version folders found under ${releaseInputRoot}`);
  }
  for (const version of versions) {
    const versionRoot = path.join(releaseInputRoot, version);
    const configPath = path.join(versionRoot, 'config.properties');
    for (const reference of extractDataReferences(configPath)) {
      const filePath = path.join(versionRoot, reference.fileName);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        fail(`release-data config ${configPath} references missing ${reference.key} file: ${filePath}`);
      }
    }
  }
}

function validateReleaseDataManifest(releaseDataRoot) {
  const manifestPath = path.join(releaseDataRoot, 'release-data-manifest.json');
  const checksumPath = path.join(releaseDataRoot, 'release-data.sha256');
  assertFile(manifestPath, 'release-data manifest');
  assertFile(checksumPath, 'release-data checksum');

  const expected = buildReleaseDataManifest(releaseDataRoot);
  const actual = readJson(manifestPath);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`release-data manifest is stale or incorrect: ${manifestPath}`);
  }
  const expectedChecksum = `${expected.aggregateSha256}  release-data\n`;
  const actualChecksum = fs.readFileSync(checksumPath, 'utf-8');
  if (actualChecksum !== expectedChecksum) {
    fail(`release-data checksum is stale or incorrect: ${checksumPath}`);
  }
  return expected;
}

function validateReleaseData(releaseDataRoot) {
  validateReleaseDataAllowlist(releaseDataRoot);
  validateReleaseDataConfigs(releaseDataRoot);
  return validateReleaseDataManifest(releaseDataRoot);
}

function parseJavaMajorVersion(versionOutput) {
  const quotedVersionMatch = /version\s+"([^"]+)"/i.exec(versionOutput);
  const rawVersion = quotedVersionMatch?.[1] ?? (/^(?:openjdk|java)\s+([0-9][^\s]*)/i.exec(versionOutput)?.[1] ?? '');
  if (!rawVersion) {
    return null;
  }
  if (rawVersion.startsWith('1.')) {
    const legacyMajor = Number.parseInt(rawVersion.split('.')[1] ?? '', 10);
    return Number.isFinite(legacyMajor) ? legacyMajor : null;
  }
  const major = Number.parseInt(rawVersion.split('.')[0] ?? '', 10);
  return Number.isFinite(major) ? major : null;
}

function parseJavaVendor(versionOutput) {
  const normalized = versionOutput.toLowerCase();
  if (normalized.includes('temurin')) {
    return 'Eclipse Temurin';
  }
  if (normalized.includes('openjdk')) {
    return 'OpenJDK';
  }
  if (normalized.includes('oracle')) {
    return 'Oracle';
  }
  return versionOutput.split(/\r?\n/)[0]?.trim() || null;
}

function javaExecutablePath(javaHome) {
  return path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
}

function jlinkExecutablePath(javaHome) {
  return path.join(javaHome, 'bin', process.platform === 'win32' ? 'jlink.exe' : 'jlink');
}

function getJavaHomeFromJava(command) {
  const output = runCapture(command, ['-XshowSettings:properties', '-version'], repoRoot);
  const match = /^\s*java\.home\s*=\s*(.+?)\s*$/m.exec(output);
  return match?.[1] ? path.resolve(match[1].trim()) : null;
}

function resolveJavaHome(configuredJavaHome) {
  if (configuredJavaHome) {
    return configuredJavaHome;
  }
  if (process.env.JAVA_HOME?.trim()) {
    return path.resolve(process.env.JAVA_HOME.trim());
  }
  const discovered = getJavaHomeFromJava('java');
  if (discovered) {
    return discovered;
  }
  fail('Could not determine Java home. Pass --java-home <path> for a Java 25 JDK.');
}

function getJavaMetadata(javaBin) {
  const versionOutput = runCapture(javaBin, ['--version'], repoRoot);
  return {
    path: javaBin,
    versionOutput,
    vendor: parseJavaVendor(versionOutput),
    majorVersion: parseJavaMajorVersion(versionOutput)
  };
}

function createJavaRuntime(outputRoot, configuredJavaHome) {
  const javaHome = resolveJavaHome(configuredJavaHome);
  const sourceJava = javaExecutablePath(javaHome);
  const sourceJlink = jlinkExecutablePath(javaHome);
  const jmods = path.join(javaHome, 'jmods');
  assertFile(sourceJava, 'Java executable');
  const sourceMetadata = getJavaMetadata(sourceJava);
  if (sourceMetadata.majorVersion !== 25) {
    fail(`Phase 10 requires Java 25 for runtime assembly; found ${sourceMetadata.versionOutput}`);
  }

  const javaOutputRoot = path.join(outputRoot, 'java');
  fs.rmSync(javaOutputRoot, { recursive: true, force: true });
  if (fs.existsSync(jmods)) {
    assertFile(sourceJlink, 'jlink executable');
    assertDirectory(jmods, 'Java JDK jmods directory');
    run(sourceJlink, [
      '--module-path',
      jmods,
      '--add-modules',
      'ALL-MODULE-PATH',
      '--strip-debug',
      '--no-header-files',
      '--no-man-pages',
      '--output',
      javaOutputRoot
    ], repoRoot);
  } else {
    log(`Java JDK jmods directory not found at ${jmods}; staging Java runtime without jlink trimming.`);
    copyDirectory(javaHome, javaOutputRoot);
  }

  const stagedJava = path.join(javaOutputRoot, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  assertFile(stagedJava, 'staged Java executable');
  return getJavaMetadata(stagedJava);
}

function findStagedJava(outputRoot) {
  const candidates = [
    path.join(outputRoot, 'java', 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
    path.join(outputRoot, 'java', 'bin', 'java'),
    path.join(outputRoot, 'java', 'bin', 'java.exe')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

function buildArtifacts(skipBuilds) {
  if (skipBuilds) {
    log('skipping Maven/npm builds by request.');
    return;
  }
  run(mavenBin, ['-q', '-DskipTests', '-Pwindows-release-fat-jar', 'package'], repoRoot);
  run('npm', ['run', 'build'], dashboardRoot);
  run('npm', ['run', 'build:desktop'], dashboardRoot);
}

function assembleAppResources(outputRoot) {
  const appRoot = path.join(outputRoot, 'app');
  copyDirectory(path.join(dashboardRoot, 'dist'), path.join(appRoot, 'dist'));
  copyDirectory(path.join(dashboardRoot, 'dist-server'), path.join(appRoot, 'dist-server'));
  copyDirectory(path.join(dashboardRoot, 'electron', 'dist'), path.join(appRoot, 'electron', 'dist'));
  copyFile(path.join(dashboardRoot, 'package.json'), path.join(appRoot, 'package.json'));
  copyFile(path.join(dashboardRoot, 'package-lock.json'), path.join(appRoot, 'package-lock.json'));
  copyFile(
    path.join(dashboardRoot, 'electron', 'package.json'),
    path.join(appRoot, 'electron', 'package.json')
  );

  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--fund=false'], appRoot);
}

function assembleModelArtifact(outputRoot) {
  const sourceModelJar = path.join(repoRoot, 'target', modelJarName);
  const destinationModelJar = path.join(outputRoot, 'model', modelJarName);
  copyFile(sourceModelJar, destinationModelJar);
  return destinationModelJar;
}

function resolveReleaseCommit() {
  const configuredCommit = process.env.RELEASE_GIT_COMMIT?.trim();
  if (configuredCommit) {
    return configuredCommit;
  }
  return runCapture('git', ['rev-parse', 'HEAD'], repoRoot).trim();
}

function writeReleaseManifest(outputRoot, releaseDataManifest, javaMetadata, modelJarPath) {
  const packageJson = readJson(path.join(dashboardRoot, 'package.json'));
  const commit = resolveReleaseCommit();
  const relativeModelJar = normalizeRel(path.relative(outputRoot, modelJarPath));
  const relativeJava = normalizeRel(path.relative(outputRoot, javaMetadata.path));
  const manifest = {
    manifestVersion: 1,
    resourceLayoutVersion: releaseLayoutVersion,
    generatedAt: new Date().toISOString(),
    app: {
      name: packageJson.name,
      version: packageJson.version
    },
    git: {
      commit
    },
    modelArtifact: {
      path: relativeModelJar,
      sha256: sha256File(modelJarPath)
    },
    javaRuntime: {
      path: relativeJava,
      vendor: javaMetadata.vendor,
      majorVersion: javaMetadata.majorVersion,
      versionOutput: javaMetadata.versionOutput
    },
    releaseData: {
      path: 'release-data',
      manifestPath: 'release-data/release-data-manifest.json',
      checksumPath: 'release-data/release-data.sha256',
      sha256: releaseDataManifest.aggregateSha256,
      fileCount: releaseDataManifest.files.length
    }
  };
  writeJson(path.join(outputRoot, 'release-manifest.json'), manifest);
  return manifest;
}

function validateAppResources(outputRoot) {
  assertFile(path.join(outputRoot, 'app', 'dist', 'index.html'), 'built dashboard index.html');
  assertFile(path.join(outputRoot, 'app', 'dist-server', 'server', 'index.js'), 'compiled dashboard server entrypoint');
  assertFile(path.join(outputRoot, 'app', 'electron', 'dist', 'electron', 'main.js'), 'compiled Electron main process');
  assertFile(path.join(outputRoot, 'app', 'electron', 'dist', 'electron', 'preload.js'), 'compiled Electron preload');
  assertFile(path.join(outputRoot, 'app', 'package.json'), 'staged app package.json');
  assertFile(path.join(outputRoot, 'app', 'package-lock.json'), 'staged app package-lock.json');
  assertDirectory(path.join(outputRoot, 'app', 'node_modules'), 'staged production node_modules');
  assertDirectory(path.join(outputRoot, 'app', 'node_modules', 'express'), 'production dependency express');
  assertDirectory(path.join(outputRoot, 'app', 'node_modules', 'react'), 'production dependency react');
  assertDirectory(path.join(outputRoot, 'app', 'node_modules', 'react-dom'), 'production dependency react-dom');
  if (fs.existsSync(path.join(outputRoot, 'app', 'node_modules', 'typescript'))) {
    fail('Staged app node_modules includes dev dependency typescript.');
  }
  const viteScopeDir = path.join(outputRoot, 'app', 'node_modules', '@vitejs');
  if (fs.existsSync(viteScopeDir) && fs.readdirSync(viteScopeDir).length > 0) {
    fail('Staged app node_modules includes dev dependency @vitejs.');
  }
}

function validateResourceTreeExclusions(outputRoot) {
  const disallowedBasenames = [/^AGENTS?\.md$/i, /^AGENT.*\.md$/i, /^CLAUDE\.md$/i, /^PROMPT\.md$/i, /^\.env/i];
  const disallowedParts = new Set(['private-datasets', 'Results', 'agents']);
  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = normalizeRel(path.relative(outputRoot, absolutePath));
      const parts = relativePath.split('/');
      if (parts.some((part) => disallowedParts.has(part))) {
        fail(`Disallowed path found in assembled resources: ${relativePath}`);
      }
      const baseName = path.basename(relativePath);
      if (disallowedBasenames.some((pattern) => pattern.test(baseName))) {
        fail(`Disallowed operational/local file found in assembled resources: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (!entry.isFile() && !entry.isSymbolicLink()) {
        fail(`Unsupported assembled resource entry: ${relativePath}`);
      }
    }
  }
  walk(outputRoot);
}

function validateReleaseManifest(outputRoot, releaseDataManifest) {
  const manifestPath = path.join(outputRoot, 'release-manifest.json');
  assertFile(manifestPath, 'release manifest');
  const manifest = readJson(manifestPath);
  if (manifest.resourceLayoutVersion !== releaseLayoutVersion) {
    fail(`Unexpected resource layout version in ${manifestPath}`);
  }
  if (manifest.releaseData?.sha256 !== releaseDataManifest.aggregateSha256) {
    fail(`release manifest release-data hash does not match ${manifest.releaseData?.manifestPath}`);
  }
  const modelPath = path.join(outputRoot, manifest.modelArtifact?.path ?? '');
  assertFile(modelPath, 'release manifest model artifact');
  if (manifest.modelArtifact.sha256 !== sha256File(modelPath)) {
    fail(`release manifest model artifact hash does not match staged jar: ${modelPath}`);
  }
  if (manifest.javaRuntime?.majorVersion !== 25) {
    fail(`release manifest Java runtime major version must be 25: ${manifest.javaRuntime?.majorVersion}`);
  }
  const javaPath = path.join(outputRoot, manifest.javaRuntime?.path ?? '');
  assertFile(javaPath, 'release manifest Java executable');
  return manifest;
}

function validateResources(outputRoot) {
  assertDirectory(outputRoot, 'release resources root');
  validateAppResources(outputRoot);
  const releaseDataManifest = validateReleaseData(path.join(outputRoot, 'release-data'));
  validateReleaseManifest(outputRoot, releaseDataManifest);
  validateResourceTreeExclusions(outputRoot);

  const modelJarPath = path.join(outputRoot, 'model', modelJarName);
  assertFile(modelJarPath, 'staged model fat jar');
  const stagedJava = findStagedJava(outputRoot);
  if (!stagedJava) {
    fail(`Missing staged Java executable under ${path.join(outputRoot, 'java', 'bin')}`);
  }
  return releaseDataManifest;
}

function assemble(options) {
  buildArtifacts(options.skipBuilds);
  assertFile(path.join(repoRoot, 'target', modelJarName), 'Windows release fat jar');
  assertFile(path.join(dashboardRoot, 'dist', 'index.html'), 'built dashboard index.html');
  assertFile(path.join(dashboardRoot, 'dist-server', 'server', 'index.js'), 'compiled dashboard server entrypoint');
  assertFile(path.join(dashboardRoot, 'electron', 'dist', 'electron', 'main.js'), 'compiled Electron main process');

  removeAndCreateOutputRoot(options.outputRoot);
  const releaseDataManifest = assembleReleaseData(options.outputRoot);
  const modelJarPath = assembleModelArtifact(options.outputRoot);
  const javaMetadata = createJavaRuntime(options.outputRoot, options.javaHome);
  assembleAppResources(options.outputRoot);
  writeReleaseManifest(options.outputRoot, releaseDataManifest, javaMetadata, modelJarPath);
  validateResources(options.outputRoot);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  options.outputRoot = path.resolve(options.outputRoot);
  if (options.check) {
    validateResources(options.outputRoot);
    log(`validated release resources at ${options.outputRoot}`);
    return;
  }
  assemble(options);
  log(`assembled release resources at ${options.outputRoot}`);
}

try {
  main();
} catch (error) {
  console.error(`[release-resources] ${(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 1;
}
