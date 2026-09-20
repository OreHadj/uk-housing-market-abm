import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  installerArguments,
  minimalModelConfig,
  nsisInvocation,
  parseArgs,
  sameWindowsPath,
  validateInstallDir
} from '../smoke-installed-windows-installer.mjs';
import { validateBuilderConfig } from '../write-installer-release-manifest.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'housing installer modèle 用户-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('NSIS receives an unquoted, final /D argument and a quoted executable without a shell', () => {
  const exe = 'C:\\Downloads\\UK Housing Model Setup.exe';
  const destination = 'D:\\Research José 用户 & $data\\UK Housing Model';
  const invocation = nsisInvocation(exe, installerArguments(destination));
  assert.equal(invocation.command, exe);
  assert.deepEqual(invocation.args, ['/S', '/currentuser', `/D=${destination}`]);
  assert.deepEqual(invocation.options, { shell: false, windowsVerbatimArguments: true, argv0: `"${exe}"` });
  assert.deepEqual(installerArguments(), ['/S', '/currentuser'], 'Upgrade must use the registered directory, without /D');
});

test('the smoke test refuses roots, relative paths and malformed destinations', () => {
  for (const destination of ['C:\\', 'C:/', 'C:relative', 'relative', '\\\\server\\share', 'C:\\Apps\\bad"name', 'C:\\Apps\\bad\nname', 'C:\\Apps\\bad.', 'C:\\Apps\\bad ', 'C:\\Apps\\bad:stream']) {
    assert.throws(() => validateInstallDir(destination), /--install-dir/, destination);
  }
  assert.equal(validateInstallDir('D:/Apps/UK Housing Model/'), 'D:\\Apps\\UK Housing Model');
  assert.throws(() => nsisInvocation('C:\\bad"setup.exe', []), /Invalid NSIS/);
});

test('smoke CLI exposes explicit custom and previous installer paths', () => {
  const options = parseArgs(['--install-dir', 'D:\\Apps\\UK Housing Model', '--previous-installer', 'old.exe', '--timeout-ms', '1234']);
  assert.equal(options.installDir, 'D:\\Apps\\UK Housing Model');
  assert.equal(options.previousInstaller, path.resolve('old.exe'));
  assert.equal(options.timeoutMs, 1234);
  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs(['--install-dir']), /requires a path/);
  assert.throws(() => parseArgs(['--previous-installer', '--help']), /requires a path/);
  assert.throws(() => parseArgs(['--timeout-ms', '12garbage']), /positive integer/);
  assert.throws(() => parseArgs(['--timeout-ms', '1.5']), /positive integer/);
});

test('registered directory comparisons follow Windows separators and case', () => {
  assert.ok(sameWindowsPath('C:\\Apps\\Modèle 用户\\', 'c:/apps/modèle 用户'));
  assert.ok(!sameWindowsPath('C:\\Apps\\uk-housing-model-dashboard', 'C:\\Apps\\uk-housing-model-dashboard\\UK Housing Model'));
});

test('real model smoke config uses installed data, Unicode and bounded run settings', (t) => {
  const root = fixture(t);
  const csv = path.join(root, 'income data.csv');
  fs.writeFileSync(csv, 'value\n1\n');
  const source = [
    'SEED = 99', 'N_STEPS = 3500', 'N_SIMS = 10', 'TARGET_POPULATION = 10000',
    'recordTransactions = true', 'OTHER_SETTING = 0.5',
    'DATA_INCOME = "C:\\old\\income data.csv" # previous installation'
  ].join('\n');
  const config = minimalModelConfig(source, root);
  for (const line of ['SEED = 1', 'N_STEPS = 0', 'N_SIMS = 1', 'TARGET_POPULATION = 100', 'recordTransactions = false', 'OTHER_SETTING = 0.5']) {
    assert.ok(config.includes(line), line);
  }
  assert.ok(config.includes(`DATA_INCOME = "${csv.replace(/\\/g, '/')}"`));
  assert.ok(!config.includes('C:\\old'));
  assert.throws(() => minimalModelConfig('SEED = 1', root), /missing required/);
  fs.unlinkSync(csv);
  assert.throws(() => minimalModelConfig(source, root), /Missing bundled DATA_INCOME/);
});

test('packaging validation checks both signing configurations and the upgrade hook', (t) => {
  const root = fixture(t);
  const names = ['electron-builder.yml', 'electron-builder-unsigned.yml', 'installer.nsh'];
  for (const name of names) fs.copyFileSync(path.join(repoRoot, 'dashboard', 'electron', name), path.join(root, name));
  validateBuilderConfig(root);
  for (const name of names.slice(0, 2)) {
    const target = path.join(root, name);
    const source = fs.readFileSync(target, 'utf-8');
    for (const setting of ['oneClick: false', 'allowToChangeInstallationDirectory: true', 'selectPerMachineByDefault: false', 'deleteAppDataOnUninstall: false']) {
      fs.writeFileSync(target, source.replace(setting, `# ${setting}`));
      assert.throws(() => validateBuilderConfig(root), /missing required setting/, `${name}: ${setting}`);
    }
    fs.writeFileSync(target, source);
  }
  fs.unlinkSync(path.join(root, 'installer.nsh'));
  assert.throws(() => validateBuilderConfig(root), /directory-retention hook/);
});
