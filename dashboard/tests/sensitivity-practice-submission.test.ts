import assert from 'node:assert/strict';
import { ApiRequestError } from '../src/lib/api.js';
import type { ExperimentJobSummary, SensitivityExperimentCreateRequest, SensitivityExperimentSubmitResponse } from '../shared/types.js';
import type { ExperimentDemoCoordinator, ExperimentPracticeRun } from '../src/lib/guidedDemos/creation.js';
import { applySensitivityPracticeDefaults, validateSensitivityPracticeSize } from '../src/lib/sensitivityPractice.js';
import {
  buildSensitivityPracticeResultsHref, createExperimentDemoProgress, parseExperimentDemoProgress,
  updateSensitivityPracticeRun
} from '../src/lib/experimentDemo.js';
import {
  isExperimentDemoSubmissionBlocked, isSensitivityPracticeSubmissionAllowed,
  recoverSensitivityPracticeRun, submitSensitivityPracticeRun
} from '../src/pages/experiments/run/useExperimentRunController.js';

const noop = () => {};
const progress = createExperimentDemoProgress('sensitivity', 'experiment-demo-sensitivity-submission-test');
const draftId = progress.sensitivity.draftId;
const context: ExperimentDemoCoordinator = {
  active: true, paused: false, journeyId: progress.journeyId, draftId, mode: 'sensitivity',
  savedStepId: 'sensitivity-submit', committedValues: {}, allowSensitivitySubmission: true,
  onSensitivityRunChange: noop, onCommit: noop, onProgress: noop, onChapterComplete: noop,
  onContinueToSensitivity: noop, onFinish: noop, onPause: noop, onExit: noop
};
assert.equal(progress.sensitivity.stepId, 'sensitivity-name');
assert.equal(isSensitivityPracticeSubmissionAllowed('sensitivity', draftId, context), true);
for (const changes of [
  { active: false }, { paused: true }, { allowSensitivitySubmission: false }, { savedStepId: 'sensitivity-review' },
  { mode: 'policy' as const }, { journeyId: 'invalid' }, { draftId: 'ordinary' },
  { onSensitivityRunChange: undefined }, { sensitivityRun: { status: 'submitting' as const, title: 'pending' } },
  { sensitivityRun: { status: 'submitted' as const, title: 'accepted', runId: 'one', jobRef: 'sensitivity:one' } }
]) assert.equal(isSensitivityPracticeSubmissionAllowed('sensitivity', draftId, { ...context, ...changes }), false, JSON.stringify(changes));
assert.equal(isSensitivityPracticeSubmissionAllowed('manual', draftId, context), false);
assert.equal(isSensitivityPracticeSubmissionAllowed('sensitivity', draftId, undefined), false);
assert.equal(isExperimentDemoSubmissionBlocked('sensitivity', true, true), true, 'The policy exception cannot start sensitivity');
assert.equal(isExperimentDemoSubmissionBlocked('sensitivity', true, false, true), false);

const values = applySensitivityPracticeDefaults([], { TARGET_POPULATION: '10000', N_STEPS: '2000', N_SIMS: '8' });
assert.equal(validateSensitivityPracticeSize(values, '3', '1'), null);
for (const change of [{ N_STEPS: '2000' }, { N_SIMS: '8' }, { TARGET_POPULATION: '10000' }] as Record<string, string>[]) {
  assert.match(validateSensitivityPracticeSize({ ...values, ...change }, '3', '1') ?? '', /Keep this practice small/);
}
assert.match(validateSensitivityPracticeSize(values, '20', '1') ?? '', /Use 3 samples/);
assert.match(validateSensitivityPracticeSize(values, '3', '4') ?? '', /1 worker/);
const payload: SensitivityExperimentCreateRequest = {
  baseline: 'v0o7', basePolicy: '2024', title: 'LTI practice', policyPackageId: 'owner_occupier_lti_soft_max',
  min: 4, max: 5, sampleCount: 3, maxWorkers: 1,
  overrides: { TARGET_POPULATION: 1000, N_STEPS: 600, N_SIMS: 1, recordCoreIndicators: true, recordTransactions: false }
};
const accepted: SensitivityExperimentSubmitResponse = {
  accepted: true, warnings: [], experiment: {
    experimentId: 'sensitivity-fixture', baseline: 'v0o7', basePolicy: '2024', status: 'queued', createdAt: '2026-09-22T00:00:00Z',
    parameter: { key: 'CENTRAL_BANK_LTI_SOFT_MAX_FTB', title: 'LTI threshold', description: '', type: 'number', baselineValue: 4.5, min: 4, max: 5, sampleCount: 3 }
  }
};
const event = { journeyId: progress.journeyId, chapter: 'sensitivity' as const, draftId };
let persisted = progress;
const events: string[] = [];
const state: { current: ExperimentPracticeRun | undefined } = { current: undefined };
let posts = 0;
await submitSensitivityPracticeRun({ payload, draftId, state,
  onChange: run => {
    events.push(run?.status ?? 'cleared');
    persisted = updateSensitivityPracticeRun(persisted, { ...event, run });
    assert.deepEqual(parseExperimentDemoProgress(JSON.stringify(persisted))?.sensitivity.submission, run);
  },
  submit: async request => {
    events.push('POST'); posts += 1;
    assert.equal(persisted.sensitivity.submission?.status, 'submitting');
    assert.notEqual(request.title, payload.title);
    assert.deepEqual(request.overrides, payload.overrides);
    return accepted;
  }
});
assert.deepEqual(events, ['submitting', 'POST', 'submitted']);
assert.equal(persisted.phase, 'complete');
assert.equal(persisted.sensitivity.stepId, 'sensitivity-complete');
assert.equal(state.current?.runId, 'sensitivity-fixture');
assert.equal(state.current?.jobRef, 'sensitivity:sensitivity-fixture');
await assert.rejects(submitSensitivityPracticeRun({ payload, draftId, state, onChange: noop, submit: async () => { posts += 1; return accepted; } }), /already been sent/);
assert.equal(posts, 1);
assert.equal(updateSensitivityPracticeRun(persisted, { ...event, run: undefined }), persisted);
assert.equal(updateSensitivityPracticeRun(progress, { ...event, draftId: 'stale', run: state.current }), progress);
const url = new URL(buildSensitivityPracticeResultsHref(state.current!.runId!, state.current!.jobRef!), 'http://local');
assert.equal(url.searchParams.get('presentation'), 'report');
assert.equal(url.searchParams.get('experimentId'), 'sensitivity-fixture');
assert.equal(url.searchParams.has('practice'), false);
assert.equal(url.searchParams.has('journey'), false);
assert.equal(url.searchParams.get('resultsDemo'), 'sensitivity-results');

const pending: ExperimentPracticeRun = { status: 'submitting', title: state.current!.title };
const job: ExperimentJobSummary = { type: 'sensitivity', id: 'sensitivity-fixture', jobRef: 'sensitivity:sensitivity-fixture', title: pending.title, status: 'running', createdAt: '2026-09-22T00:00:00Z' };
assert.deepEqual(recoverSensitivityPracticeRun(pending, [job]), state.current);
assert.equal(recoverSensitivityPracticeRun(pending, [{ ...job, title: payload.title! }]), undefined);
assert.equal(recoverSensitivityPracticeRun(pending, [{ ...job, type: 'manual' }]), undefined);
assert.equal(recoverSensitivityPracticeRun(pending, [{ ...job, jobRef: 'sensitivity:wrong' }]), undefined);
assert.equal(recoverSensitivityPracticeRun(state.current, [job]), undefined);
const refreshed = { current: JSON.parse(JSON.stringify(pending)) as ExperimentPracticeRun | undefined };
await assert.rejects(submitSensitivityPracticeRun({ payload, draftId, state: refreshed, onChange: noop, submit: async () => { posts += 1; return accepted; } }), /already been sent/);
assert.equal(posts, 1);

for (const error of [new ApiRequestError('Network lost', true, null), new ApiRequestError('Proxy error', true, 502), new ApiRequestError('Timeout', true, 408), new SyntaxError('Unreadable')]) {
  const uncertain: { current: ExperimentPracticeRun | undefined } = { current: undefined };
  await assert.rejects(submitSensitivityPracticeRun({ payload, draftId, state: uncertain, onChange: noop, submit: async () => { throw error; } }), /may have been accepted/);
  assert.equal(uncertain.current?.status, 'submitting');
}
const rejected: { current: ExperimentPracticeRun | undefined } = { current: undefined };
await assert.rejects(submitSensitivityPracticeRun({ payload, draftId, state: rejected, onChange: noop, submit: async () => { throw new ApiRequestError('Invalid setting', false, 400); } }), /Invalid setting/);
assert.equal(rejected.current, undefined);
await submitSensitivityPracticeRun({ payload, draftId, state: rejected, onChange: noop, submit: async () => ({ accepted: false, warnings: [] }) });
assert.equal(rejected.current, undefined);
await assert.rejects(submitSensitivityPracticeRun({ payload, draftId, state: rejected, onChange: () => { throw new Error('Storage failed'); }, submit: async () => { posts += 1; return accepted; } }), /Storage failed/);
assert.equal(posts, 1, 'A failed pending-state save prevents POST');
await assert.rejects(submitSensitivityPracticeRun({ payload, draftId, state: rejected, onChange: noop, submit: async () => ({ accepted: true, warnings: [] }) }), /may have been accepted/);
assert.equal((rejected.current as ExperimentPracticeRun | undefined)?.status, 'submitting');
const legacy = { ...progress, sensitivity: { ...progress.sensitivity, stepId: 'sensitivity-purpose' } };
assert.equal(parseExperimentDemoProgress(JSON.stringify(legacy))?.sensitivity.stepId, 'sensitivity-name');
legacy.sensitivity.stepId = 'sensitivity-complete';
assert.equal(parseExperimentDemoProgress(JSON.stringify(legacy))?.sensitivity.stepId, 'sensitivity-review', 'The former dry run completion resumes before real submission');
console.log('Sensitivity practice submission, persistence, recovery, size and Report handoff tests passed.');
