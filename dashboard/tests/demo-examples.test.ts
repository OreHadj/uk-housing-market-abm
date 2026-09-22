import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_EXAMPLE_IDS, DEMO_EXAMPLE_SET_VERSION, DEMO_MODEL_VERSION } from '../shared/demoExamples';
import { DEMO_EXAMPLE_MARKER, isInstalledDemoExample, seedDemoExamples } from '../server/lib/demoExamples';
import { createDevelopmentRuntimePaths, createDesktopRuntimePaths, createRuntimePathsFromEnv } from '../server/lib/runtimePaths';
import { getModelRunOptions } from '../server/lib/modelRuns';
import { getResultsRunDetail, getResultsRuns } from '../server/lib/results';
import { getSensitivityExperiment, listSensitivityExperiments } from '../server/lib/sensitivityRuns';
import {
  applyPolicyRunBuilderDefaults, buildDefaultSensitivityRange, getDefaultExperimentBasePolicy,
  normalizeSensitivityFormValues, parseFormValue, toInitialFormValues
} from '../src/lib/experimentRunDefaults';
import { DEFAULT_SENSITIVITY_POLICY_PACKAGE_ID } from '../shared/policyCatalogue';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-demo-examples-'));
const paths = { ...createDevelopmentRuntimePaths(repoRoot), resultsRoot: path.join(fixture, 'results') };
try {
  assert.equal(paths.demoExamplesRoot, path.join(repoRoot, 'dashboard/demo-examples'));
  const desktop = createDesktopRuntimePaths({ appResourcesRoot: path.join(fixture, 'resources'), electronUserDataRoot: path.join(fixture, 'user') });
  assert.equal(desktop.demoExamplesRoot, path.join(fixture, 'resources/release-data/demo-examples'));
  const previousOverride = process.env.DASHBOARD_DEMO_EXAMPLES_ROOT;
  process.env.DASHBOARD_DEMO_EXAMPLES_ROOT = path.join(fixture, 'override');
  try { assert.equal(createRuntimePathsFromEnv(repoRoot).demoExamplesRoot, path.join(fixture, 'override')); }
  finally {
    if (previousOverride === undefined) delete process.env.DASHBOARD_DEMO_EXAMPLES_ROOT;
    else process.env.DASHBOARD_DEMO_EXAMPLES_ROOT = previousOverride;
  }

  const index = JSON.parse(fs.readFileSync(path.join(paths.demoExamplesRoot, 'index.json'), 'utf8'));
  assert.equal(index.exampleSetVersion, DEMO_EXAMPLE_SET_VERSION);
  assert.deepEqual(index.examples.map((entry: { id: string }) => entry.id).sort(), Object.values(DEMO_EXAMPLE_IDS).sort());
  let size = 0;
  for (const entry of fs.readdirSync(paths.demoExamplesRoot, { recursive: true, withFileTypes: true })) {
    assert(!entry.isSymbolicLink());
    assert(!['seeds', '.dashboard-managed-run.json'].includes(entry.name));
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    size += fs.statSync(file).size;
    assert(!/\/(?:Users|home)\/|[A-Za-z]:\\(?:Users|Documents)/.test(fs.readFileSync(file, 'utf8')), `Personal path in ${file}`);
  }
  assert(size > 0 && size < 10_000_000, `Example bundle must remain under 10 MB: ${size}`);
  const first = seedDemoExamples(paths);
  assert.equal(first.installed.length, 3);
  assert.equal(seedDemoExamples(paths).installed.length, 0);
  assert.equal(getResultsRuns(paths).filter((run) => run.isExample).length, 2);
  assert.equal(listSensitivityExperiments(paths).experiments.filter((run) => run.isExample).length, 1);

  const options = getModelRunOptions(paths, DEMO_MODEL_VERSION, true);
  assert.equal(options.defaultBaseline, DEMO_MODEL_VERSION);
  const basePolicy = options.basePolicies.find((entry) => entry.id === getDefaultExperimentBasePolicy(options))!;
  assert.equal(basePolicy.id, '2024');
  const initial = toInitialFormValues(options.parameters, basePolicy);
  const policyDefaults = applyPolicyRunBuilderDefaults(options.parameters, initial);
  for (const runId of [DEMO_EXAMPLE_IDS.policyRunId, DEMO_EXAMPLE_IDS.baselineRunId]) {
    const detail = getResultsRunDetail(paths, runId);
    assert.equal(detail.status, 'complete');
    assert.equal(detail.configuration.modelVersion, DEMO_MODEL_VERSION);
    assert.equal(detail.configuration.basePolicy, basePolicy.id);
    assert.deepEqual(detail.provenance.seeds, [1, 2, 3, 4, 5, 6, 7, 8]);
    for (const definition of options.parameters.filter((entry) => entry.key !== 'SEED')) {
      const actual = definition.group === 'Central Bank policy'
        ? detail.policySettings.find((entry) => entry.key === definition.key)?.value
        : detail.configuration.parameterValues[definition.key];
      // Saved examples retain their original recording choice as new policy defaults evolve.
      if (definition.key === 'recordTransactions') {
        assert.equal(actual, false, `${runId}: bundled examples keep transaction recording off`);
        continue;
      }
      const expected = runId === DEMO_EXAMPLE_IDS.policyRunId && definition.key === 'CENTRAL_BANK_INITIAL_BASE_RATE'
        ? 0.0610833333 : parseFormValue(definition, policyDefaults[definition.key]);
      assert.equal(actual, expected, `${runId}: ${definition.key}`);
    }
  }

  const sweep = getSensitivityExperiment(paths, DEMO_EXAMPLE_IDS.sensitivityExperimentId).experiment;
  const sweepDefaults = normalizeSensitivityFormValues(options.parameters, initial);
  assert.equal(sweep.baseline, DEMO_MODEL_VERSION);
  assert.equal(sweep.basePolicy, basePolicy.id);
  assert.equal(sweep.parameter.packageId, DEFAULT_SENSITIVITY_POLICY_PACKAGE_ID);
  const instrument = options.sensitivityPolicyPackages.find((entry) => entry.id === sweep.parameter.packageId)!;
  const range = buildDefaultSensitivityRange(instrument, basePolicy);
  assert.equal(sweep.parameter.min, Number(range.min));
  assert.equal(sweep.parameter.max, Number(range.max));
  assert.equal(sweep.parameter.sampleCount, 5);
  assert.deepEqual(sweep.sampledPoints.map((entry) => entry.value), [4, 4.25, 4.5, 4.75, 5]);
  assert.deepEqual(sweep.seeds, [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const definition of options.parameters.filter((entry) => entry.group === 'General model control' && entry.key !== 'SEED' && entry.key !== 'TIME_TO_START_RECORDING_TRANSACTIONS')) {
    assert.equal(sweep.generalOverrides?.[definition.key] ?? definition.defaultValue, parseFormValue(definition, sweepDefaults[definition.key]), `Sweep ${definition.key}`);
  }

  const installedRun = path.join(paths.resultsRoot, DEMO_EXAMPLE_IDS.policyRunId);
  const markerFile = path.join(installedRun, DEMO_EXAMPLE_MARKER);
  const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  fs.writeFileSync(markerFile, JSON.stringify({ ...marker, exampleSetVersion: 0 }));
  fs.writeFileSync(path.join(installedRun, 'stale.txt'), 'stale');
  assert(seedDemoExamples(paths).installed.includes(DEMO_EXAMPLE_IDS.policyRunId));
  assert(!fs.existsSync(path.join(installedRun, 'stale.txt')));
  assert(isInstalledDemoExample(paths, 'run', DEMO_EXAMPLE_IDS.policyRunId));

  const collisionPaths = { ...paths, resultsRoot: path.join(fixture, 'collision') };
  const collision = path.join(collisionPaths.resultsRoot, DEMO_EXAMPLE_IDS.policyRunId);
  fs.mkdirSync(collision, { recursive: true });
  fs.writeFileSync(path.join(collision, 'personal.txt'), 'preserve exactly');
  const warnings: string[] = [];
  assert(seedDemoExamples(collisionPaths, (message) => warnings.push(message)).skipped.includes(DEMO_EXAMPLE_IDS.policyRunId));
  assert.deepEqual(fs.readdirSync(collision), ['personal.txt']);
  assert.equal(fs.readFileSync(path.join(collision, 'personal.txt'), 'utf8'), 'preserve exactly');
  assert(!isInstalledDemoExample(collisionPaths, 'run', DEMO_EXAMPLE_IDS.policyRunId));
  assert(warnings.some((message) => message.includes('unmarked')));

  const missing = { ...paths, resultsRoot: path.join(fixture, 'missing-results'), demoExamplesRoot: path.join(fixture, 'missing-bundle') };
  assert.equal(seedDemoExamples(missing, () => {}).installed.length, 0);
  assert.deepEqual(getResultsRuns(missing), []);
  assert.deepEqual(listSensitivityExperiments(missing).experiments, []);
  console.log(`demo-examples: defaults, all IDs, ${size} bytes, seeding, stale replacement, collision preservation and missing bundle passed.`);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
