import assert from 'node:assert/strict';
import { RemoteExecutionManager, type RemoteAwsAdapter } from '../server/lib/remoteExecution.js';

// An in-memory SSM/S3 double: no cloud requests, model processes or filesystem artifacts.
function createHarness(type: 'manual' | 'sensitivity', delayedStatus: string | null = 'Cancelling') {
  const jobRef = `${type}:target`;
  let commandStatus: string | null = 'InProgress';
  let cancelCalls = 0;
  let launches = 0;
  let deleteCalls = 0;
  const record = (id: string, status: 'running' | 'queued') => ({
    schemaVersion: 1, jobRef: `${type}:${id}`, type, id, title: id, status,
    createdAt: '2026-09-19T12:00:00Z', baseline: 'v-test',
    ...(status === 'running' ? { ssmCommandId: 'active-command' } : {}),
    ...(type === 'manual' ? { runId: id } : {}),
    outputPath: '', configPath: '', artifactS3Prefix: `experiments/${type}/${id}/`,
    requestKey: `tmp/dashboard-remote/requests/${id}.json`, sourceCommit: 'fixture', sourceBundleKey: 'fixture', warnings: []
  });
  let index: unknown = { schemaVersion: 1, updatedAt: '', jobs: [record('target', 'running'), record('waiting', 'queued')] };
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected adapter call'); };
  const adapter: RemoteAwsAdapter = {
    getRunnerStatus: unexpected,
    getSourceDeployManifest: unexpected,
    getJson: async <T>() => structuredClone(index) as T,
    putJson: async (_bucket, _key, value) => { index = structuredClone(value); },
    getBytes: unexpected,
    getText: unexpected,
    listObjects: async (_bucket, prefix) => [{ key: `${prefix}results.csv`, sizeBytes: 10, modifiedAt: null }],
    getCommandInvocation: async (_instance, command) => command === 'active-command'
      ? commandStatus === null ? null : { status: commandStatus, stdout: '', stderr: '' }
      : { status: 'InProgress', stdout: '', stderr: '' },
    cancelCommand: async (_instance, command) => {
      assert.equal(command, 'active-command');
      cancelCalls += 1;
      commandStatus = delayedStatus;
    },
    sendRunCommand: async () => { launches += 1; return 'next-command'; },
    deleteObjects: async (_bucket, keys) => {
      assert.deepEqual(keys, ['tmp/dashboard-remote/requests/target.json', `experiments/${type}/target/results.csv`]);
      deleteCalls += 1;
    }
  };
  const manager = new RemoteExecutionManager({
    region: 'eu-west-2', runnerInstanceId: 'fake-instance', artifactsBucket: 'fake-bucket', maxActiveRemoteRuns: 1
  }, adapter);
  return {
    manager, jobRef,
    finish: () => { commandStatus = 'Cancelled'; },
    counts: () => ({ cancelCalls, launches, deleteCalls })
  };
}

for (const type of ['manual', 'sensitivity'] as const) {
  for (const status of ['Cancelling', 'InProgress', null]) {
    const test = createHarness(type, status);
    const canceled = await test.manager.cancelExperimentJob(test.jobRef);
    assert.equal(canceled.job.status, 'running', 'Sending cancellation is not proof of process termination');
    assert.equal(canceled.job.endedAt, undefined);
    await assert.rejects(() => test.manager.deleteExperimentJob(test.jobRef), /Only finished remote experiment jobs/);
    assert.deepEqual(test.counts(), { cancelCalls: 1, launches: 0, deleteCalls: 0 });
    test.finish();
    const stopped = (await test.manager.listExperimentJobs()).jobs.find((job) => job.jobRef === test.jobRef);
    assert.equal(stopped?.status, 'canceled');
    assert.ok(stopped?.endedAt);
    assert.equal(test.counts().launches, 1, 'Only release the queue slot once the stopped status is confirmed');
    assert.equal((await test.manager.deleteExperimentJob(test.jobRef)).deleted, true);
    assert.equal(test.counts().deleteCalls, 1);
  }

  const immediate = createHarness(type, 'Cancelled');
  assert.equal((await immediate.manager.cancelExperimentJob(immediate.jobRef)).job.status, 'canceled');
  assert.equal((await immediate.manager.deleteExperimentJob(immediate.jobRef)).deleted, true);

  const queued = createHarness(type);
  const queuedResult = await queued.manager.cancelExperimentJob(`${type}:waiting`);
  assert.equal(queuedResult.job.status, 'canceled');
  assert.deepEqual(queued.counts(), { cancelCalls: 0, launches: 0, deleteCalls: 0 }, 'Queued runs need no SSM cancel or dispatch');
}

console.log('Remote cancellation tests passed.');
