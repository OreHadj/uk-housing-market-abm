import { DEMO_EXAMPLE_FIGURES, DEMO_MODEL_VERSION } from '../../shared/demoExamples';
import {
  isCommittedExperimentDemoTextComplete,
  type CreationDemoStep,
  type ExperimentDemoChapterContext,
  type ExperimentDemoCoordinator,
  type PolicyPracticeRun
} from '../lib/guidedDemos/creation';
import { formatModelName } from '../lib/modelAnchors';
import { POLICY_PRACTICE_SETTINGS } from '../lib/policyPractice';
import { GuidedCreationDemo } from './GuidedCreationDemo';

export const POLICY_EXPERIMENT_DEMO_TARGETS = {
  stepper: 'policy-stepper',
  name: 'policy-name',
  continueButton: 'policy-continue',
  model: 'policy-model',
  referencePolicy: 'policy-reference-policy',
  bankRateToggle: 'policy-bank-rate-toggle',
  bankRateContent: 'policy-bank-rate-content',
  bankRateInput: 'policy-bank-rate-input',
  ltvToggle: 'policy-ltv-toggle',
  ltvContent: 'policy-ltv-content',
  changedFeedback: 'policy-changed-feedback',
  liveSummary: 'policy-live-summary',
  ltiToggle: 'policy-lti-toggle',
  ltiContent: 'policy-lti-content',
  affordabilityToggle: 'policy-affordability-toggle',
  affordabilityContent: 'policy-affordability-content',
  technicalSettings: 'policy-technical-settings',
  additionalExportsToggle: 'policy-additional-exports-toggle',
  additionalExportsContent: 'policy-additional-exports-content',
  reviewOverview: 'policy-review-overview',
  policyAudit: 'policy-review-audit',
  recordingToggle: 'policy-recording-toggle',
  recordingContent: 'policy-recording-content',
  startBoundary: 'policy-start-boundary'
} as const;

export type PolicyExperimentDemoStepId =
  | 'policy-purpose'
  | 'policy-navigation'
  | 'policy-name'
  | 'policy-model'
  | 'policy-reference-policy'
  | 'policy-change-bank-rate'
  | 'policy-run-settings'
  | 'policy-exports'
  | 'policy-review-overview'
  | 'policy-submit'
  | 'policy-complete';

const configuration = DEMO_EXAMPLE_FIGURES.configuration;
const practice = POLICY_PRACTICE_SETTINGS;

export const POLICY_EXPERIMENT_DEMO_STEPS = [
  {
    id: 'policy-purpose', chapter: 'policy', kind: 'info', targetId: null, wizardStep: 0,
    title: 'Build a policy scenario',
    body: '',
    bullets: [
      'A policy scenario runs one policy configuration.',
      'This guide ends with a real short run.',
      'A baseline run keeps policy unchanged for comparison. Use the same model and run settings.'
    ]
  },
  {
    id: 'policy-navigation', chapter: 'policy', kind: 'info', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.stepper, wizardStep: 0, interactive: true,
    title: 'Move between sections',
    body: '',
    bullets: [
      'Your current section is highlighted.',
      'Normally, click a section to move. Scroll to see more.',
      'In this guide, use Back and Next.'
    ]
  },
  {
    id: 'policy-name', chapter: 'policy', kind: 'action', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.name, wizardStep: 0, interactive: true,
    title: 'Name it',
    body: '',
    bullets: ['Names identify saved runs in Results.', 'For example, “Bank Rate rise”.'],
    actionHint: 'Enter a name to continue.',
    completionNote: 'Your scenario name is saved in this practice draft.'
  },
  {
    id: 'policy-model', chapter: 'policy', kind: 'info', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.model, wizardStep: 1,
    title: 'Choose the model',
    body: '',
    bullets: [
      'The model defines the calibrated economy.',
      `The draft and saved example use the ${formatModelName(DEMO_MODEL_VERSION)}.`,
      'For more information about the model, use the blue boxes to visit the dedicated pages.'
    ]
  },
  {
    id: 'policy-reference-policy', chapter: 'policy', kind: 'info', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.referencePolicy, wizardStep: 2,
    title: 'Choose policy defaults',
    body: '',
    bullets: [
      'Policy defaults are separate from the calibrated model.',
      `The ${configuration.basePolicy} reference year supplies all unchanged policy values.`,
      'Your edits override these defaults. This creates no comparison run.'
    ]
  },
  {
    id: 'policy-change-bank-rate', chapter: 'policy', kind: 'action', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.bankRateContent, wizardStep: 2, interactive: true,
    title: 'Make one policy change',
    body: '',
    bullets: [
      'Unedited settings retain reference values.',
      `Raise Bank Rate by ${configuration.policyBankRateRisePp} percentage point above reference, to about ${configuration.policyBankRate.toFixed(1)}%.`
    ],
    actionHint: 'Raise Bank Rate to enable Next.',
    completionNote: 'Bank Rate changed. Select Next to continue.'
  },
  {
    id: 'policy-run-settings', chapter: 'policy', kind: 'info', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.technicalSettings, wizardStep: 3,
    title: 'Check the run settings',
    body: '',
    bullets: [
      `The run lasts ${practice.months.toLocaleString('en-GB')} model months.`,
      `${practice.seeds} seed demonstrates the workflow, not seed consistency. Seeds use different random draws.`
    ]
  },
  {
    id: 'policy-exports', chapter: 'policy', kind: 'info', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.additionalExportsContent, wizardStep: 3,
    title: 'Choose transaction recording',
    body: '',
    bullets: [
      `Start recording at month ${practice.recordFrom} skips the first ${practice.recordFrom} transaction months. This lets the model settle and keeps files smaller.`,
      'Record transactions enables Lending risk’s High LTV and High LTI charts.',
      'Other exports add files only.'
    ]
  },
  {
    id: 'policy-review-overview', chapter: 'policy', kind: 'info', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.reviewOverview, wizardStep: 4,
    title: 'Review before starting',
    body: '',
    bullets: [
      'Check model, reference policy and your changes.',
      `Run with ${practice.households.toLocaleString('en-GB')} households, ${practice.months.toLocaleString('en-GB')} months and ${practice.seeds} seed.`,
      'Start queues a real run and opens Results.'
    ]
  },
  {
    id: 'policy-submit', chapter: 'policy', kind: 'action', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.startBoundary, wizardStep: 4, interactive: true,
    title: 'Start your policy run',
    body: '',
    bullets: [
      'Start queues a real run with these settings.',
      'Its Report opens when submission is accepted. The demo ends here.'
    ],
    actionHint: 'Select Start policy scenario.',
    completionNote: 'Run submitted. Results shows its progress.'
  },
  {
    id: 'policy-complete', chapter: 'policy', kind: 'info', targetId: null, wizardStep: 4,
    title: 'Policy scenario guide complete',
    body: '',
    bullets: ['Your practice draft is saved. No run has been submitted.', 'Return to editing, explore a saved example, or finish.']
  }
] as const satisfies readonly CreationDemoStep<PolicyExperimentDemoStepId>[];

export interface PolicyExperimentDemoState {
  currentName: string;
  currentBankRate: string;
  referenceBankRate: number | undefined;
  committedValues: Readonly<Record<string, string>>;
  selectedModel: string;
  selectedReferencePolicy: string;
  runMonths: string;
  seedCount: string;
  householdCount?: string;
  recordingStartMonth?: string;
  recordTransactions?: boolean;
  policyRun?: PolicyPracticeRun;
}

type PolicyCreationCopyState = Pick<PolicyExperimentDemoState,
  'selectedModel' | 'selectedReferencePolicy' | 'referenceBankRate' | 'runMonths' | 'seedCount' |
  'householdCount' | 'recordingStartMonth' | 'recordTransactions' | 'policyRun'>;

function validCount(value: string, minimum = 1): number | null {
  const parsed = Number(value);
  return value.trim() && Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
}

/** Practice edits survive pausing; lesson copy follows the draft rather than restoring defaults. */
export function buildPolicyExperimentDemoSteps(state: PolicyCreationCopyState): readonly CreationDemoStep<PolicyExperimentDemoStepId>[] {
  const months = validCount(state.runMonths);
  const seeds = validCount(state.seedCount);
  const households = validCount(state.householdCount ?? String(practice.households));
  const recordingStart = validCount(state.recordingStartMonth ?? String(practice.recordFrom), 0);
  const suggestedRate = typeof state.referenceBankRate === 'number' && Number.isFinite(state.referenceBankRate)
    ? state.referenceBankRate * 100 + configuration.policyBankRateRisePp : null;
  return POLICY_EXPERIMENT_DEMO_STEPS.map((step) => {
    if (step.id === 'policy-model' && state.selectedModel !== DEMO_MODEL_VERSION) {
      return { ...step, bullets: [
        'The model defines the calibrated economy.',
        `Your draft uses ${formatModelName(state.selectedModel)}. The saved example uses ${formatModelName(DEMO_MODEL_VERSION)}.`,
        'For more information about the model, use the blue boxes to visit the dedicated pages.'
      ] };
    }
    if (step.id === 'policy-change-bank-rate') {
      const suggestion = suggestedRate === null ? '' : `, about ${suggestedRate.toFixed(1)}%`;
      return { ...step, bullets: [
        'Unedited settings retain reference values.',
        `Raise Bank Rate by ${configuration.policyBankRateRisePp} percentage point above reference${suggestion}.`
      ] };
    }
    if (step.id === 'policy-reference-policy') {
      return { ...step, bullets: [
        'Policy defaults are separate from the calibrated model.',
        `The ${state.selectedReferencePolicy} reference year supplies all unchanged policy values.`,
        'Your edits override these defaults. This creates no comparison run.'
      ] };
    }
    if (step.id === 'policy-run-settings') {
      const duration = months === null ? 'Duration needs a valid number of model months.' : `The run lasts ${months.toLocaleString('en-GB')} model months.`;
      const repetitions = seeds === null
        ? 'Seed count is invalid. Seeds repeat simulations with different random draws.'
        : seeds === 1
          ? '1 seed demonstrates the workflow, not seed consistency. Seeds use different random draws.'
          : `${seeds.toLocaleString('en-GB')} seeds repeat the simulation with different random draws, showing how results vary.`;
      return { ...step, bullets: [duration, repetitions] };
    }
    if (step.id === 'policy-exports') {
      const recording = state.recordingStartMonth === undefined ? step.bullets[0]
        : recordingStart === null ? 'Start recording at month needs a valid nonnegative month.'
        : recordingStart === 0 ? 'Start recording at month 0 keeps transactions from the first month.'
        : `Start recording at month ${recordingStart.toLocaleString('en-GB')} skips the first ${recordingStart.toLocaleString('en-GB')} transaction ${recordingStart === 1 ? 'month' : 'months'}. This lets the model settle and keeps files smaller.`;
      return { ...step, bullets: [
        recording,
        state.recordTransactions === false
          ? 'Enable Record transactions for Lending risk’s High LTV and High LTI charts.'
          : 'Record transactions enables Lending risk’s High LTV and High LTI charts.',
        'Other exports add files only.'
      ] };
    }
    if (step.id === 'policy-review-overview') {
      const settings = households === null || months === null || seeds === null
        ? 'Run settings need valid household, duration and seed counts.'
        : `Run with ${households.toLocaleString('en-GB')} households, ${months.toLocaleString('en-GB')} months and ${seeds.toLocaleString('en-GB')} ${seeds === 1 ? 'seed' : 'seeds'}.`;
      return { ...step, bullets: [
        'Check model, reference policy and your changes.',
        settings,
        'Start queues a real run and opens Results.'
      ] };
    }
    if (step.id === 'policy-complete' && state.policyRun) {
      return { ...step, bullets: state.policyRun.status === 'submitted'
        ? ['Your policy scenario was submitted.', 'View your run in Results, or return to the saved draft.']
        : ['Submission is in progress.', 'Your draft is saved. Results opens when submission is accepted.'] };
    }
    return step;
  });
}

export interface PolicyExperimentDemoProps extends ExperimentDemoChapterContext, PolicyExperimentDemoState {
  onRestoreStep: (step: CreationDemoStep<PolicyExperimentDemoStepId>) => void;
  onBeforeAdvance?: (nextStep: CreationDemoStep<PolicyExperimentDemoStepId>) => boolean;
}

/** Both values are stored fractions; the real control displays them as percentages. */
export function isPolicyExperimentDemoBankRateComplete(
  currentValue: string,
  referenceValue: number | undefined,
  committedValue: string
): boolean {
  const current = Number(currentValue);
  const committed = Number(committedValue);
  return Boolean(
    currentValue.trim() && committedValue.trim() &&
    Number.isFinite(current) && Number.isFinite(committed) &&
    typeof referenceValue === 'number' && Number.isFinite(referenceValue) &&
    current > referenceValue && Math.abs(current - committed) < 1e-12
  );
}

export function policyExperimentDemoWizardStep(stepId: string): number {
  return POLICY_EXPERIMENT_DEMO_STEPS.find((step) => step.id === stepId)?.wizardStep ?? 0;
}

export function isPolicyExperimentDemoStepComplete(stepId: PolicyExperimentDemoStepId, state: PolicyExperimentDemoState): boolean {
  if (stepId === 'policy-name') return isCommittedExperimentDemoTextComplete(state.currentName, state.committedValues.name ?? '');
  if (stepId === 'policy-change-bank-rate') {
    return isPolicyExperimentDemoBankRateComplete(state.currentBankRate, state.referenceBankRate, state.committedValues.bankRate ?? '');
  }
  if (stepId === 'policy-submit') return state.policyRun?.status === 'submitted';
  return true;
}

export function PolicyExperimentDemo(props: PolicyExperimentDemoProps) {
  const fingerprint = JSON.stringify({
    model: props.selectedModel, referencePolicy: props.selectedReferencePolicy,
    name: props.currentName, bankRate: props.currentBankRate, committedValues: props.committedValues,
    runMonths: props.runMonths, seedCount: props.seedCount,
    householdCount: props.householdCount, recordingStartMonth: props.recordingStartMonth,
    recordTransactions: props.recordTransactions, policyRun: props.policyRun
  });
  return (
    <GuidedCreationDemo
      {...props}
      chapter="policy"
      label="Create a policy scenario"
      steps={buildPolicyExperimentDemoSteps(props)}
      completionStepId="policy-complete"
      fingerprint={fingerprint}
      isStepComplete={(step) => isPolicyExperimentDemoStepComplete(step.id, props)}
    />
  );
}

// Compatibility exports while older callers migrate to the neutral helpers.
export { committedExperimentDemoText, isCommittedExperimentDemoTextComplete } from '../lib/guidedDemos/creation';
export type PolicyExperimentDemoCoordinator = ExperimentDemoCoordinator;
export type PolicyExperimentDemoContext = ExperimentDemoChapterContext;
