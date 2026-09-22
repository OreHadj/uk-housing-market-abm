#!/usr/bin/env node
// Compile the real installer hook with electron-builder's installed NSIS template.
// On Windows, execute it against a temporary HKCU key, without installing the app.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installerArguments, nsisInvocation } from './smoke-installed-windows-installer.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const requireElectron = createRequire(path.join(repoRoot, 'dashboard', 'electron', 'package.json'));

function nsisString(value) {
  return `"${value.replace(/\$/g, '$$$$').replace(/"/g, '$\\"')}"`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { ...options, shell: false, encoding: 'utf-8', timeout: 120_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${command} failed (code ${result.status}).\n${result.stdout}\n${result.stderr}`);
}

async function main() {
  const { NSIS_PATH, NsisTargetOptions, nsisTemplatesDir } = requireElectron('app-builder-lib/out/targets/nsis/nsisUtil.js');
  const template = fs.readFileSync(path.join(nsisTemplatesDir, 'assistedInstaller.nsh'), 'utf-8');
  const stockFunction = template.match(/Function instFilesPre\r?\n[\s\S]*?FunctionEnd/)?.[0];
  assert.ok(stockFunction, 'Review the directory hook: electron-builder changed instFilesPre.');
  assert.ok(template.indexOf('!insertmacro customPageAfterChangeDir') < template.indexOf('!insertmacro MUI_PAGE_INSTFILES'), 'Directory hook must run before the install-files page.');
  NsisTargetOptions.resolve({});
  const nsisRoot = await NSIS_PATH();
  const compiler = path.join(nsisRoot, process.platform === 'win32' ? 'Bin/makensis.exe' : process.platform === 'darwin' ? 'mac/makensis' : 'linux/makensis');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'housing installer hook '));
  const executable = path.join(root, 'directory tests.exe');
  const registryKey = `Software\\UKHousingInstallerTests\\${crypto.randomUUID()}`;
  const destinationArgument = 'C:\\Test Apps José 用户 & $data\\UK Housing Model';
  const missingDirectory = path.win32.join(root, 'missing', 'Old');
  const missingSelection = path.win32.join(root, 'missing', 'New');
  const cases = [
    { label: 'new parent folder', previous: '', selected: 'C:\\Test Apps', expected: 'C:\\Test Apps\\UK Housing Model' },
    { label: 'new application folder', previous: '', selected: 'C:\\Test Apps\\UK Housing Model', expected: 'C:\\Test Apps\\UK Housing Model' },
    { label: 'legacy one-click directory', previous: 'C:\\Apps\\uk-housing-model-dashboard', selected: 'C:\\Apps\\uk-housing-model-dashboard', expected: 'C:\\Apps\\uk-housing-model-dashboard' },
    { label: 'existing custom Unicode directory', previous: 'C:\\Modèle 用户\\Housing', selected: 'C:\\Modèle 用户\\Housing', expected: 'C:\\Modèle 用户\\Housing' },
    { label: 'different missing directories', previous: missingDirectory, selected: missingSelection, expected: `${missingSelection}\\UK Housing Model` },
    { label: 'deliberate relocation', previous: 'C:\\Apps\\Housing', selected: 'D:\\New Apps', expected: 'D:\\New Apps\\UK Housing Model' }
  ];
  const checks = cases.map((item, index) => `
  WriteRegStr HKCU \"\${INSTALL_REGISTRY_KEY}\" InstallLocation ${nsisString(item.previous)}
  StrCpy $INSTDIR ${nsisString(item.selected)}
  Call \${MUI_PAGE_CUSTOMFUNCTION_PRE}
  StrCmp $INSTDIR ${nsisString(item.expected)} case_${index}_passed
    DeleteRegKey HKCU \"\${INSTALL_REGISTRY_KEY}\"
    SetErrorLevel ${index + 10}
    Quit
  case_${index}_passed:
`).join('\n');
  const script = `
Unicode true
Name "UK Housing installer directory tests"
OutFile ${nsisString(executable)}
RequestExecutionLevel user
SilentInstall silent
!include LogicLib.nsh
!addincludedir ${nsisString(path.join(nsisTemplatesDir, 'include'))}
!include StrContains.nsh
!define APP_FILENAME "UK Housing Model"
!define INSTALL_REGISTRY_KEY ${nsisString(registryKey)}
!define MUI_PAGE_CUSTOMFUNCTION_PRE instFilesPre
${stockFunction}
!include ${nsisString(path.join(repoRoot, 'dashboard', 'electron', 'installer.nsh'))}
!insertmacro customPageAfterChangeDir
Section
  SetShellVarContext current
  # NSIS consumes /D before exposing CMDLINE, so check its parsed destination.
  StrCmp $INSTDIR ${nsisString(destinationArgument)} arguments_passed
    SetErrorLevel 99
    Quit
  arguments_passed:
${checks}
  DeleteRegKey HKCU "\${INSTALL_REGISTRY_KEY}"
  SetErrorLevel 0
SectionEnd
`;
  try {
    const source = path.join(root, 'directory-tests.nsi');
    fs.writeFileSync(source, script, 'utf-8');
    run(compiler, ['-WX', '-V2', '-INPUTCHARSET', 'UTF8', source], { env: { ...process.env, NSISDIR: nsisRoot } });
    if (process.platform === 'win32') {
      const invocation = nsisInvocation(executable, installerArguments(destinationArgument));
      run(invocation.command, invocation.args, invocation.options);
      console.log(`[installer-directory-hook] passed ${cases.length} directory cases and raw /D argument handling`);
    } else {
      console.log(`[installer-directory-hook] compiled successfully; execution of ${cases.length} cases requires Windows`);
    }
  } catch (error) {
    console.error(`[installer-directory-hook] cases: ${cases.map((item, i) => `${i + 10}=${item.label}`).join(', ')}; 99=argument quoting`);
    throw error;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[installer-directory-hook] ${error.message}`);
  process.exitCode = 1;
});
