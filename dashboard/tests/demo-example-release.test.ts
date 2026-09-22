import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const assemblerUrl = pathToFileURL(path.join(repoRoot, 'scripts/windows/assemble-release-resources.mjs')).href;
const { assembleReleaseData, validateReleaseData } = await import(assemblerUrl);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-demo-release-'));

try {
  assembleReleaseData(stage);
  const root = path.join(stage, 'release-data');
  const manifest = validateReleaseData(root);
  const examples = path.join(root, 'demo-examples');
  const source = path.join(repoRoot, 'dashboard/demo-examples');
  const files = fs.readdirSync(examples, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  let bytes = 0;
  for (const entry of files) {
    const file = path.join(entry.parentPath, entry.name);
    const relative = path.relative(examples, file);
    assert(!relative.split(path.sep).includes('Results'));
    assert.deepEqual(fs.readFileSync(file), fs.readFileSync(path.join(source, relative)), `Staged file differs: ${relative}`);
    const content = fs.readFileSync(file, 'utf8');
    assert(!/\/(?:Users|home)\/|[A-Za-z]:\\(?:Users|Documents)/.test(content), `Personal path in ${relative}`);
    bytes += fs.statSync(file).size;
  }
  assert(bytes > 0 && bytes < 10_000_000);
  assert(fs.readFileSync(path.join(repoRoot, '.dockerignore'), 'utf8').includes('!dashboard/demo-examples/**'));
  // The existing release-data prohibition remains in force for accidentally bundled user results.
  fs.mkdirSync(path.join(examples, 'Results'));
  fs.writeFileSync(path.join(examples, 'Results', 'unexpected.csv'), 'private output');
  assert.throws(() => validateReleaseData(root), /Disallowed path/);
  console.log(`demo-example-release: staged ${files.length} example files (${bytes} bytes); allowlist, hashes and personal-path checks passed (${manifest.aggregateSha256}).`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
