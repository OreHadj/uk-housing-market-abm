import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  POLICY_EXPERIMENT_DEMO_STAGES,
  PolicyExperimentDemoPrototype,
  committedPolicyExperimentDemoName,
  isPolicyExperimentDemoActionStage,
  isPolicyExperimentDemoNameComplete,
  isPolicyExperimentDemoStageComplete,
  shouldAutoAdvancePolicyExperimentDemoStage
} from '../src/components/PolicyExperimentDemoPrototype.js';
import {
  POLICY_EXPERIMENT_DEMO_DRAFT_PREFIX,
  POLICY_EXPERIMENT_DEMO_LAUNCH_HREF,
  POLICY_EXPERIMENT_DEMO_SESSION_KEY,
  clearPolicyExperimentDemoState,
  createPolicyExperimentDemoProgress,
  isPolicyExperimentDemoDraftId,
  isPolicyExperimentDemoRequested,
  parsePolicyExperimentDemoProgress,
  readPolicyExperimentDemoProgress,
  writePolicyExperimentDemoProgress
} from '../src/lib/policyExperimentDemo.js';
import { scenarioDraftStorageKey } from '../src/lib/scenarioDraft.js';
import { DEMO_CHOICES } from '../src/pages/HomePage.js';
import { isPolicyExperimentDemoSubmissionBlocked } from '../src/pages/experiments/run/useExperimentRunController.js';

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const launchUrl = new URL(POLICY_EXPERIMENT_DEMO_LAUNCH_HREF, 'http://dashboard.local');
assert.equal(launchUrl.pathname, '/scenarios/new');
assert.equal(launchUrl.searchParams.get('demo'), 'experiment');
assert.equal(launchUrl.searchParams.get('segment'), 'policy');
assert.equal(isPolicyExperimentDemoRequested(launchUrl.searchParams), true);
assert.equal(
  DEMO_CHOICES.find((choice) => choice.label === 'Run experiment demo')?.to,
  POLICY_EXPERIMENT_DEMO_LAUNCH_HREF,
  'The existing Home choice should launch the Policy preview'
);

assert.deepEqual(
  POLICY_EXPERIMENT_DEMO_STAGES.map((stage) => stage.id),
  ['introduction', 'scenario-name', 'continue', 'complete']
);
assert.equal(POLICY_EXPERIMENT_DEMO_STAGES[0].title, 'Create experiments');
assert.equal(POLICY_EXPERIMENT_DEMO_STAGES[3].title, 'Prototype complete');
assert.equal(isPolicyExperimentDemoActionStage('introduction'), false);
assert.equal(isPolicyExperimentDemoActionStage('scenario-name'), true);
assert.equal(isPolicyExperimentDemoActionStage('continue'), true);
assert.equal(isPolicyExperimentDemoActionStage('complete'), false);

assert.equal(committedPolicyExperimentDemoName('F', false), '', 'Typing alone is not a commit');
assert.equal(committedPolicyExperimentDemoName('   ', true), '', 'Blank text is never valid');
assert.equal(committedPolicyExperimentDemoName('  First-time buyer test  ', true), 'First-time buyer test');
assert.equal(
  isPolicyExperimentDemoNameComplete('F', '', 0),
  false,
  'The first character must not advance the name step'
);
assert.equal(
  isPolicyExperimentDemoStageComplete('scenario-name', 0, 'First-time buyer test', '', 0),
  false
);
assert.equal(
  isPolicyExperimentDemoStageComplete(
    'scenario-name',
    0,
    'First-time buyer test',
    'First-time buyer test',
    1
  ),
  true,
  'A deliberately committed nonblank name completes the action'
);
assert.equal(isPolicyExperimentDemoStageComplete('continue', 0, '', '', 0), false);
assert.equal(isPolicyExperimentDemoStageComplete('continue', 1, '', '', 0), true);

const eligibleTransition = {
  stageId: 'scenario-name' as const,
  isSameStageVisit: true,
  sawIncompleteDuringVisit: true,
  isComplete: true,
  advancePendingOrHandled: false
};
assert.equal(shouldAutoAdvancePolicyExperimentDemoStage(eligibleTransition), true);
assert.equal(
  shouldAutoAdvancePolicyExperimentDemoStage({ ...eligibleTransition, advancePendingOrHandled: true }),
  false,
  'A pending or handled transition must not run twice'
);
assert.equal(
  shouldAutoAdvancePolicyExperimentDemoStage({ ...eligibleTransition, isSameStageVisit: false }),
  false,
  'A stale event from another visit must not advance'
);
assert.equal(
  shouldAutoAdvancePolicyExperimentDemoStage({ ...eligibleTransition, sawIncompleteDuringVisit: false }),
  false,
  'Returning to an already-completed action must not bounce forward'
);
assert.equal(
  shouldAutoAdvancePolicyExperimentDemoStage({ ...eligibleTransition, isComplete: false }),
  false,
  'A reversed action must cancel advancement'
);
assert.equal(
  shouldAutoAdvancePolicyExperimentDemoStage({ ...eligibleTransition, stageId: 'introduction' }),
  false,
  'Informational stages never auto-advance'
);

const demoDraftId = `${POLICY_EXPERIMENT_DEMO_DRAFT_PREFIX}test-draft`;
const realDraftId = 'ordinary-policy-draft';
assert.equal(isPolicyExperimentDemoDraftId(demoDraftId), true);
assert.equal(isPolicyExperimentDemoDraftId(realDraftId), false);
const storage = new MemoryStorage();
storage.setItem('scenario-draft:v1:active', realDraftId);
storage.setItem(scenarioDraftStorageKey(realDraftId), '{"ordinary":true}');
storage.setItem(scenarioDraftStorageKey(demoDraftId), '{"demo":true}');
const progress = createPolicyExperimentDemoProgress(demoDraftId, 'continue');
writePolicyExperimentDemoProgress(progress, storage);
assert.deepEqual(readPolicyExperimentDemoProgress(storage), progress);
assert.deepEqual(parsePolicyExperimentDemoProgress(JSON.stringify(progress)), progress);
assert.equal(parsePolicyExperimentDemoProgress('{broken'), null);
assert.equal(parsePolicyExperimentDemoProgress(JSON.stringify({ ...progress, draftId: realDraftId })), null);
clearPolicyExperimentDemoState(demoDraftId, storage);
assert.equal(storage.getItem(POLICY_EXPERIMENT_DEMO_SESSION_KEY), null);
assert.equal(storage.getItem(scenarioDraftStorageKey(demoDraftId)), null);
assert.equal(storage.getItem('scenario-draft:v1:active'), realDraftId);
assert.equal(storage.getItem(scenarioDraftStorageKey(realDraftId)), '{"ordinary":true}');

const prototypeProps = {
  active: true,
  draftId: demoDraftId,
  ready: true,
  loading: false,
  error: '',
  onRetryLoad: () => {},
  onPrototypeComplete: () => {},
  onExit: () => {},
  currentWizardStep: 0,
  currentName: '',
  committedName: '',
  nameCommitRevision: 0
};
const introductionMarkup = renderToStaticMarkup(
  createElement(PolicyExperimentDemoPrototype, prototypeProps)
);
assert.ok(introductionMarkup.includes('Create experiments'));
assert.ok(introductionMarkup.includes('Start preview'));
assert.equal(introductionMarkup.includes('>Next<'), false);
assert.ok(introductionMarkup.includes('role="dialog"'));
assert.equal(introductionMarkup.includes('aria-modal'), false, 'The coach must not nest a second aria-modal');

const loadingMarkup = renderToStaticMarkup(
  createElement(PolicyExperimentDemoPrototype, { ...prototypeProps, ready: false, loading: true })
);
assert.ok(loadingMarkup.includes('Preparing the preview'));
assert.equal(loadingMarkup.includes('Create experiments'), false, 'The introduction waits for hydration and options');

assert.equal(isPolicyExperimentDemoSubmissionBlocked('manual', true), true);
assert.equal(isPolicyExperimentDemoSubmissionBlocked('manual', false), false);
assert.equal(isPolicyExperimentDemoSubmissionBlocked('sensitivity', true), false);

const homeSource = fs.readFileSync(new URL('../src/pages/HomePage.tsx', import.meta.url), 'utf8');
const pageSource = fs.readFileSync(new URL('../src/pages/ExperimentsPage.tsx', import.meta.url), 'utf8');
const cardSource = fs.readFileSync(
  new URL('../src/pages/run-experiments/ManualRunSetupCard.tsx', import.meta.url),
  'utf8'
);
const controllerSource = fs.readFileSync(
  new URL('../src/pages/experiments/run/useExperimentRunController.ts', import.meta.url),
  'utf8'
);
const demoSource = fs.readFileSync(
  new URL('../src/components/PolicyExperimentDemoPrototype.tsx', import.meta.url),
  'utf8'
);

assert.ok(homeSource.includes('to: POLICY_EXPERIMENT_DEMO_LAUNCH_HREF'));
assert.ok(pageSource.includes('if (isPolicyDemo)'));
assert.ok(pageSource.includes('createPolicyExperimentDemoDraftId()'));
assert.ok(pageSource.includes('clearPolicyExperimentDemoState(effectiveDraftId)'));
assert.ok(cardSource.includes('data-policy-experiment-demo-target='));
assert.ok(cardSource.includes('disabled={isPolicyDemoActive}'));
assert.ok(cardSource.includes("event.key !== 'Enter'"));
assert.ok(cardSource.includes('onBlur={(event) => commitDemoName(event.currentTarget.value)}'));
assert.ok(demoSource.includes("closest<HTMLElement>('.scenario-create-modal-body')"));
assert.ok(demoSource.includes('window.requestAnimationFrame'));
assert.ok(demoSource.includes('latestSnapshotRef.current'));

const manualSubmitSource = controllerSource.slice(controllerSource.indexOf('const onSubmitRun'));
assert.ok(manualSubmitSource.includes('isPolicyExperimentDemoSubmissionBlocked(activeType, policyDemoActive)'));
assert.ok(
  manualSubmitSource.indexOf('isPolicyExperimentDemoSubmissionBlocked(activeType, policyDemoActive)') <
    manualSubmitSource.indexOf('submitModelRun(payload)'),
  'The hard demo guard must run before the policy submission API can be called'
);

console.log('Policy experiment demo prototype tests passed.');
