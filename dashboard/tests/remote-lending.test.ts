import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getLendingDistribution } from '../server/lib/lendingDistribution.js';
import { RemoteExecutionManager, type RemoteAwsAdapter } from '../server/lib/remoteExecution.js';
import { createDevelopmentRuntimePaths } from '../server/lib/runtimePaths.js';

const saleFile = 'SaleTransactions-run1.csv';
const header = 'modelTime;transactionPrice;buyerAge;buyerMonthlyGrossEmploymentIncome;mortgagePrincipal;mortgageMonthlyPayment;ICR;firstTimeBuyerMortgage;buyToLetMortgage';
const ftb = '1000;200000;30;2500;120000;750;NaN;true;false';
const homeMover = '1100;300000;45;5000;150000;1500;NaN;false;false';
const transactions = (...rows: string[]) => Buffer.from([header, ...rows].join('\n'));
const config = Buffer.from([
  'recordTransactions = true',
  'TIME_TO_START_RECORDING_TRANSACTIONS = 1000',
  'BANK_LTV_HARD_MAX_FTB = 0.9'
].join('\n'));

const filesByRun = new Map<string, Map<string, Buffer>>([
  ['single', new Map([
    ['config.properties', config],
    [saleFile, transactions(ftb)],
    // A copied seed file must not count again when the root transaction file exists.
    [`seeds/seed-1/${saleFile}`, transactions(ftb)]
  ])],
  ['multiple', new Map([
    // No root config: exercise the parser's per-seed configuration fallback too.
    ['seeds/seed-1/config.properties', config],
    ['seeds/seed-2/config.properties', config],
    [`seeds/seed-1/${saleFile}`, transactions(ftb)],
    [`seeds/seed-2/${saleFile}`, transactions(homeMover)]
  ])],
  ['missing', new Map([['config.properties', config]])]
]);
const records = [...filesByRun.keys()].map((runId) => ({
  schemaVersion: 1, jobRef: `manual:${runId}`, type: 'manual', id: runId, runId,
  status: 'succeeded', createdAt: '2026-09-22T12:00:00Z', baseline: 'fixture',
  outputPath: '', configPath: '', artifactS3Prefix: `experiments/manual/${runId}/`,
  requestKey: `tmp/dashboard-remote/requests/${runId}.json`,
  sourceCommit: 'fixture', sourceBundleKey: 'fixture', warnings: []
}));
const prefixFor = (runId: string) => `experiments/manual/${runId}/Results/${runId}/`;
const objects = new Map<string, Buffer>();
const requestedKeys: string[] = [];
const unwantedNames = [
  `other/seed-1/${saleFile}`,
  `seeds/${saleFile}`,
  `seeds/seed-1/deeper/${saleFile}`,
  'seeds/seed-1/Output-run1.csv',
  'seeds/seed-1/private.txt',
  `seeds/../${saleFile}`,
  `seeds/./${saleFile}`,
  `seeds//${saleFile}`,
  `seeds/seed-1/../../${saleFile}`,
  `seeds/..\\outside/${saleFile}`,
  `seeds/C:outside/${saleFile}`,
  `seeds/seed-1/${saleFile}/`,
  `/${saleFile}`
];

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-lending-test-'));
const localPaths = createDevelopmentRuntimePaths(fixtureRoot);
try {
  for (const [runId, files] of filesByRun) {
    for (const [name, bytes] of files) {
      objects.set(prefixFor(runId) + name, bytes);
      const localPath = path.join(localPaths.resultsRoot, runId, name);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, bytes);
    }
  }
  for (const name of unwantedNames) {
    objects.set(prefixFor('multiple') + name, transactions(ftb));
  }

  // Fully isolated adapter: any unexpected cloud operation fails the test.
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected adapter call'); };
  const adapter: RemoteAwsAdapter = {
    getRunnerStatus: unexpected,
    getSourceDeployManifest: unexpected,
    putJson: unexpected,
    getJson: async <T>(_bucket: string, key: string) => {
      assert.equal(key, 'experiments/remote-job-index/index.json');
      return structuredClone({ schemaVersion: 1, updatedAt: '', jobs: records }) as T;
    },
    getBytes: async (_bucket, key) => {
      requestedKeys.push(key);
      return objects.get(key) ?? null;
    },
    getText: unexpected,
    listObjects: async (_bucket, prefix) => [
      ...[...objects].filter(([key]) => key.startsWith(prefix)).map(([key, bytes]) => ({
        key, sizeBytes: bytes.length, modifiedAt: null
      })),
      // An adapter returning a key outside its prefix must not cause a download.
      { key: prefix.replace('experiments/', 'unrequested/') + saleFile, sizeBytes: 100, modifiedAt: null }
    ],
    sendRunCommand: unexpected,
    getCommandInvocation: unexpected,
    cancelCommand: unexpected,
    deleteObjects: unexpected
  };
  const manager = new RemoteExecutionManager({
    region: 'fixture', runnerInstanceId: 'fixture', artifactsBucket: 'fixture', maxActiveRemoteRuns: 1
  }, adapter);

  for (const runId of filesByRun.keys()) {
    const local = getLendingDistribution(localPaths, runId, 'full');
    const remote = await manager.getRemoteManualResultLending(runId, 'full');
    assert.deepEqual(remote, local, `${runId}: cloud and local lending distributions must agree`);
    if (runId === 'multiple') {
      assert.equal(remote.available, true);
      assert.equal(remote.counts.mortgaged, 2);
      assert.equal(remote.seedCount, 2);
      assert.deepEqual(remote.seedLabels, ['seed-1', 'seed-2']);
      assert.equal(remote.window.recordingStartModelTime, 1000);
      assert.equal(remote.caps.find((cap) => cap.borrowerType === 'FTB' && cap.metric === 'ltv')?.value, 90);
    } else if (runId === 'single') {
      assert.equal(remote.available, true);
      assert.equal(remote.counts.mortgaged, 1);
      assert.equal(remote.seedCount, 1);
    } else {
      assert.equal(remote.available, false);
      assert.equal(remote.unavailableReason, 'no_transaction_file');
    }
  }

  const comparison = await manager.getRemoteManualResultLendingCompare(['single', 'multiple'], 'full');
  assert.deepEqual(comparison.runIds, ['single', 'multiple']);
  assert.deepEqual(comparison.runs.map((run) => run.counts.mortgaged), [1, 2]);

  const expectedKeys = [...filesByRun].flatMap(([runId, files]) => [...files.keys()].map((name) => prefixFor(runId) + name));
  assert.deepEqual([...new Set(requestedKeys)].sort(), expectedKeys.sort(), 'Only permitted root and seed files are downloaded');

  requestedKeys.length = 0;
  const manifest = await manager.getRemoteManualResultFiles('single');
  assert.deepEqual(manifest.files.map((file) => file.fileName).sort(), [saleFile, 'config.properties'].sort());
  await manager.getRemoteManualResultFiles('multiple');
  assert.equal(requestedKeys.some((key) => key.includes('/seeds/')), false, 'Normal file manifests do not load per-seed data');

  console.log('Remote lending tests passed: single seed, multiple seeds, comparison, missing data, path filtering and manifest scope.');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
