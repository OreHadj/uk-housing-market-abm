import assert from 'node:assert/strict';
import type { ExperimentJobsPayload, ExperimentJobSummary } from '../shared/types.js';
import { ApiRequestError } from '../src/lib/api.js';
import { stopAndDeleteExperiment } from '../src/lib/stopAndDeleteExperiment.js';

const locks: ExperimentJobsPayload['locks'] = {
  manualSubmissionLocked: false, sensitivitySubmissionLocked: false,
  activeManualJobRef: null, activeSensitivityJobRef: null
};

for (const type of ['manual', 'sensitivity'] as const) {
  const job: ExperimentJobSummary = {
    jobRef: `${type}:target`, type, id: 'target', title: 'My run', status: 'running', createdAt: '2026-09-19T12:00:00Z'
  };
  const deleted = { jobRef: job.jobRef, type, id: job.id, deleted: true };
  const events: string[] = [];
  let polls = 0;
  const result = await stopAndDeleteExperiment(job.jobRef, {
    deleteKey: 'test-delete-key',
    cancel: async (ref) => { assert.equal(ref, job.jobRef); events.push('cancel'); return { job }; },
    loadJobs: async () => {
      events.push('poll');
      polls += 1;
      return {
        locks,
        jobs: [
          { ...job, jobRef: `${type}:other`, id: 'other', status: 'canceled' },
          { ...job, status: polls < 2 ? 'running' : 'canceled' }
        ]
      };
    },
    wait: async () => { events.push('wait'); },
    onStopped: () => { events.push('stopped'); },
    remove: async (ref, key) => {
      assert.equal(ref, job.jobRef, 'Delete only the requested job');
      assert.equal(key, 'test-delete-key');
      assert.equal(polls, 2, 'Another finished job cannot authorize deletion of the selected running job');
      events.push('delete');
      return deleted;
    }
  });
  assert.deepEqual(result, deleted);
  assert.deepEqual(events, ['cancel', 'wait', 'poll', 'wait', 'poll', 'stopped', 'delete']);

  for (const status of ['canceled', 'failed', 'succeeded'] as const) {
    let deletes = 0;
    await stopAndDeleteExperiment(job.jobRef, {
      cancel: async () => ({ job: { ...job, status } }),
      loadJobs: async () => { throw new Error('A confirmed stopped job needs no extra poll'); },
      remove: async () => { deletes += 1; return deleted; }
    });
    assert.equal(deletes, 1, 'Queued cancellation and races with completion can delete immediately after confirmation');
  }

  let unsafeDeletes = 0;
  const remove = async () => { unsafeDeletes += 1; return deleted; };
  await assert.rejects(() => stopAndDeleteExperiment(job.jobRef, {
    cancel: async () => { throw new Error('Permission denied'); }, remove
  }), /No deletion was attempted.*Permission denied/);
  await assert.rejects(() => stopAndDeleteExperiment(job.jobRef, {
    cancel: async () => ({ job: { ...job, jobRef: `${type}:wrong`, status: 'canceled' } }), remove
  }), /different run/);
  await assert.rejects(() => stopAndDeleteExperiment(job.jobRef, {
    cancel: async () => ({ job }),
    loadJobs: async () => ({ jobs: [job], locks }),
    wait: async () => {}, maxPolls: 2, remove
  }), /Nothing was deleted/);
  await assert.rejects(() => stopAndDeleteExperiment(job.jobRef, {
    cancel: async () => ({ job }),
    loadJobs: async () => ({ jobs: [], locks }),
    wait: async () => {}, remove
  }), /No deletion was attempted/);
  await assert.rejects(() => stopAndDeleteExperiment(job.jobRef, {
    cancel: async () => ({ job }),
    loadJobs: async () => { throw new Error('Status unavailable'); },
    wait: async () => {}, remove
  }), /No deletion was attempted.*Status unavailable/);
  assert.equal(unsafeDeletes, 0, 'Unconfirmed cancellation must never reach the deletion API');

  let transientPolls = 0;
  await stopAndDeleteExperiment(job.jobRef, {
    cancel: async () => ({ job }),
    loadJobs: async () => {
      if (++transientPolls === 1) throw new ApiRequestError('Temporary network error', true, 503);
      return { jobs: [{ ...job, status: 'canceled' }], locks };
    },
    wait: async () => {}, remove: async () => deleted
  });
  assert.equal(transientPolls, 2, 'Transient read errors may recover without sending a second cancel request');

  await assert.rejects(() => stopAndDeleteExperiment(job.jobRef, {
    cancel: async () => ({ job: { ...job, status: 'canceled' } }),
    remove: async () => { throw new Error('Wrong delete key'); }
  }), /The run has stopped, but could not be deleted.*Wrong delete key/);
  await assert.rejects(() => stopAndDeleteExperiment(job.jobRef, {
    cancel: async () => ({ job: { ...job, status: 'canceled' } }),
    remove: async () => ({ ...deleted, deleted: false })
  }), /did not confirm deletion/);
}

console.log('Stop and delete experiment tests passed.');
