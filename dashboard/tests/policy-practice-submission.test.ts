import assert from 'node:assert/strict';
import { ApiRequestError } from '../src/lib/api.js';
import type { ExperimentJobSummary, ModelRunSubmitRequest, ModelRunSubmitResponse } from '../shared/types.js';
import type { ExperimentDemoCoordinator, PolicyPracticeRun } from '../src/lib/guidedDemos/creation.js';
import {
  isExperimentDemoSubmissionBlocked,
  isPolicyPracticeIdentity,
  isPolicyPracticeSubmissionAllowed,
  isDefinitivePolicyPracticeRejection,
  recoverPolicyPracticeRun,
  submitPolicyPracticeRun,
  type ExperimentRunController
} from '../src/pages/experiments/run/useExperimentRunController.js';
import { ManualRunSetupPanel } from '../src/pages/experiments/run/ManualRunSetupPanel.js';

const noop = () => {};
const draftId = 'experiment-demo-policy-v2-submission-fixture';
const context: ExperimentDemoCoordinator = {
  active: true, paused: false, journeyId: 'experiment-demo-submission-fixture', draftId, mode: 'policy',
  savedStepId: 'policy-submit', committedValues: {}, allowPolicySubmission: true,
  onPolicyRunChange: noop, onCommit: noop, onProgress: noop, onChapterComplete: noop,
  onContinueToSensitivity: noop, onFinish: noop, onPause: noop, onExit: noop
};
assert.equal(isPolicyPracticeIdentity('manual', draftId, context), true);
assert.equal(isPolicyPracticeSubmissionAllowed('manual', draftId, context), true);
for (const changes of [
  { active: false }, { paused: true }, { allowPolicySubmission: false }, { savedStepId: 'policy-review' },
  { mode: 'sensitivity' as const }, { journeyId: 'invalid' }, { draftId: 'ordinary' },
  { onPolicyRunChange: undefined }, { policyRun: { status: 'submitting' as const, title: 'pending' } },
  { policyRun: { status: 'submitted' as const, title: 'accepted', jobRef: 'manual:one' } }
]) assert.equal(isPolicyPracticeSubmissionAllowed('manual', draftId, { ...context, ...changes }), false, JSON.stringify(changes));
assert.equal(isPolicyPracticeSubmissionAllowed('sensitivity', draftId, context), false);
assert.equal(isPolicyPracticeSubmissionAllowed('manual', 'ordinary', { ...context, draftId: 'ordinary' }), false);
assert.equal(isPolicyPracticeSubmissionAllowed('manual', draftId, undefined), false);
assert.equal(isExperimentDemoSubmissionBlocked('manual', true), true, 'Legacy callers still block practice');
assert.equal(isExperimentDemoSubmissionBlocked('manual', true, true), false);
assert.equal(isExperimentDemoSubmissionBlocked('sensitivity', true, true), true, 'The policy exception never enables sensitivity');
assert.equal(isExperimentDemoSubmissionBlocked('manual', false), false, 'Ordinary creation is unchanged');

const payload: ModelRunSubmitRequest = {
  baseline: 'v0o7', basePolicy: '2011', title: 'Edited practice name', maxWorkers: 1, confirmWarnings: true,
  overrides: { BANK_RATE: 0.045, N_STEPS: 600, N_SIMS: 1, TARGET_POPULATION: 1000, recordTransactions: false }
};
const original = structuredClone(payload);
const accepted: ModelRunSubmitResponse = {
  accepted: true, warnings: [], job: {
    jobId: 'practice-fixture-job', runId: 'practice-fixture-run', baseline: 'v0o7', status: 'queued',
    createdAt: '2026-09-22T00:00:00Z', outputPath: '/isolated/not-created', configPath: '/isolated/not-created/config.properties'
  }
};
const state: { current: PolicyPracticeRun | undefined } = { current: undefined };
const events: string[] = [];
let sent: ModelRunSubmitRequest | undefined;
let sends = 0;
const response = await submitPolicyPracticeRun({
  payload, draftId, state,
  onChange: (run) => events.push(run?.status ?? 'cleared'),
  submit: async (request) => {
    sends += 1;
    events.push('POST');
    assert.equal(state.current?.status, 'submitting');
    assert.deepEqual(events, ['submitting', 'POST'], 'Pending state must be persisted before POST');
    sent = request;
    return accepted;
  }
});
events.push('accepted-callback');
assert.equal(response, accepted);
assert.deepEqual(events, ['submitting', 'POST', 'submitted', 'accepted-callback'], 'Accepted identity is persisted before Results handoff');
assert.deepEqual(payload, original, 'Submission does not modify the practice draft title or edited values');
assert.deepEqual(sent?.overrides, payload.overrides, 'Current policy and recording edits are submitted unchanged');
assert.equal(sent?.maxWorkers, 1);
assert.equal(sent?.confirmWarnings, false, 'Practice never authorises overwrite, even if a caller requests confirmation');
assert.notEqual(sent?.title, payload.title, 'Only the outgoing title has the practice-specific suffix');
assert.equal(state.current?.title, sent?.title);
assert.equal(state.current?.runId, accepted.job?.runId);
assert.equal(state.current?.jobRef, `manual:${accepted.job?.jobId}`);
await assert.rejects(submitPolicyPracticeRun({ payload, draftId, state, onChange: noop, submit: async () => { sends += 1; return accepted; } }), /already been sent/);
assert.equal(sends, 1, 'A second call cannot submit the same practice');

const job: ExperimentJobSummary = {
  type: 'manual', id: 'practice-fixture-job', title: sent!.title!, jobRef: 'manual:practice-fixture-job',
  runId: 'practice-fixture-run', status: 'running', createdAt: '2026-09-22T00:00:00Z'
};
const pending: PolicyPracticeRun = { status: 'submitting', title: job.title };
assert.equal(recoverPolicyPracticeRun(pending, [{ ...job, title: payload.title! }]), undefined);
assert.equal(recoverPolicyPracticeRun(pending, [{ ...job, runId: undefined }]), undefined, 'A queued job without its run ID remains pending until the ID is available');
assert.equal(recoverPolicyPracticeRun(pending, [{ ...job, jobRef: 'manual:' }]), undefined);
assert.equal(recoverPolicyPracticeRun(pending, [{ ...job, type: 'sensitivity', jobRef: 'sensitivity:other' }]), undefined);
assert.deepEqual(recoverPolicyPracticeRun(pending, [job]), {
  status: 'submitted', title: pending.title, jobRef: job.jobRef, runId: job.runId
});
assert.equal(recoverPolicyPracticeRun(state.current, [job]), undefined, 'An accepted record is not handed off repeatedly');
assert.equal(recoverPolicyPracticeRun(pending, [{ ...job, status: 'failed' }])?.status, 'submitted', 'An accepted but failed model job still counts as the submitted practice');
const refreshedState = { current: JSON.parse(JSON.stringify(pending)) as PolicyPracticeRun | undefined };
await assert.rejects(submitPolicyPracticeRun({ payload, draftId, state: refreshedState, onChange: noop, submit: async () => { sends += 1; return accepted; } }), /already been sent/);
assert.equal(sends, 1, 'Pending state restored after refresh cannot automatically repost');

for (const error of [new ApiRequestError('Network lost', true, null), new ApiRequestError('Proxy error', true, 502), new ApiRequestError('Request timeout', true, 408), new SyntaxError('Unreadable response')]) {
  const uncertain: { current: PolicyPracticeRun | undefined } = { current: undefined };
  const changes: (PolicyPracticeRun | undefined)[] = [];
  await assert.rejects(submitPolicyPracticeRun({ payload, draftId, state: uncertain, onChange: (run) => changes.push(run), submit: async () => { throw error; } }), /may have been accepted/);
  assert.equal(uncertain.current?.status, 'submitting', 'Unknown outcomes keep their duplicate-prevention record');
  assert.equal(changes.length, 1);
  assert.equal(isDefinitivePolicyPracticeRejection(error), false);
}
const rejected: { current: PolicyPracticeRun | undefined } = { current: undefined };
const rejectedChanges: (PolicyPracticeRun | undefined)[] = [];
await assert.rejects(submitPolicyPracticeRun({ payload, draftId, state: rejected, onChange: (run) => rejectedChanges.push(run), submit: async () => { throw new ApiRequestError('Invalid setting', false, 400); } }), /Invalid setting/);
assert.equal(rejected.current, undefined, 'A definitive API validation rejection permits an edited retry');
assert.equal(rejectedChanges.at(-1), undefined);
const notAccepted = { accepted: false, warnings: [{ code: 'collision', message: 'Existing run', severity: 'warning' as const }] };
assert.equal(await submitPolicyPracticeRun({ payload, draftId, state: rejected, onChange: noop, submit: async () => notAccepted }), notAccepted);
assert.equal(rejected.current, undefined);
let persistedFailureSends = 0;
await assert.rejects(submitPolicyPracticeRun({ payload, draftId, state: rejected, onChange: () => { throw new Error('Storage failed'); }, submit: async () => { persistedFailureSends += 1; return accepted; } }), /Storage failed/);
assert.equal(persistedFailureSends, 0, 'No request is made if pending-state persistence fails');
const missingJob: { current: PolicyPracticeRun | undefined } = { current: undefined };
await assert.rejects(submitPolicyPracticeRun({ payload, draftId, state: missingJob, onChange: noop, submit: async () => ({ accepted: true, warnings: [] }) }), /may have been accepted/);
assert.equal(missingJob.current?.status, 'submitting');

// The panel is a pure adapter: submission errors stay on the page, while only options failures replace the coach.
const partialController = {
  options: { parameters: [], snapshots: [], basePolicies: [] }, isDraftHydrated: true, isLoadingOptions: false,
  pageError: 'Submission outcome unknown', optionsError: '', executionDisabled: false,
  onSubmitRun: async () => {}, retryOptions: async () => null
} as unknown as ExperimentRunController;
const panel = ManualRunSetupPanel({ controller: partialController, runActionsDisabled: false, experimentDemo: context });
assert.equal(panel.props.policyDemo.error, '');
assert.equal(panel.props.policyDemo.ready, true);
const optionsFailure = ManualRunSetupPanel({ controller: { ...partialController, optionsError: 'Options unavailable' }, runActionsDisabled: true, experimentDemo: context });
assert.equal(optionsFailure.props.policyDemo.error, 'Options unavailable');
console.log('Policy practice submission tests passed.');
