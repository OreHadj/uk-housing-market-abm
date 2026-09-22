import { useMemo } from 'react';
import {
  committedExperimentDemoText,
  isCommittedExperimentDemoTextComplete,
  type CreationDemoStep,
  type ExperimentDemoChapterContext,
  type ExperimentDemoCoordinator,
  type ExperimentPracticeRun
} from '../lib/guidedDemos/creation';
import { GuidedCreationDemo } from './GuidedCreationDemo';
import { SENSITIVITY_PRACTICE_SETTINGS } from '../lib/sensitivityPractice';

export const SENSITIVITY_EXPERIMENT_DEMO_TARGETS = {
  stepper: 'sensitivity-stepper',
  name: 'sensitivity-name',
  continueButton: 'sensitivity-continue',
  instrument: 'sensitivity-instrument',
  range: 'sensitivity-range',
  sampleCount: 'sensitivity-sample-count',
  updatedPreview: 'sensitivity-updated-preview',
  actualValues: 'sensitivity-actual-values',
  testedValues: 'sensitivity-tested-values',
  liveSummary: 'sensitivity-live-summary',
  model: 'sensitivity-model',
  baseline: 'sensitivity-baseline',
  runSettings: 'sensitivity-run-settings',
  seedsWorkload: 'sensitivity-seeds-workload',
  fixedRecording: 'sensitivity-fixed-recording',
  review: 'sensitivity-review',
  reviewSamples: 'sensitivity-review-samples',
  totalExecutions: 'sensitivity-total-executions',
  startBoundary: 'sensitivity-start-boundary'
} as const;

export type SensitivityExperimentDemoStepId =
  | 'sensitivity-name'
  | 'sensitivity-instrument'
  | 'sensitivity-tested-values'
  | 'sensitivity-model'
  | 'sensitivity-baseline'
  | 'sensitivity-run-recording'
  | 'sensitivity-review'
  | 'sensitivity-submit'
  | 'sensitivity-complete';

const practice = SENSITIVITY_PRACTICE_SETTINGS;

export const SENSITIVITY_EXPERIMENT_DEMO_STEPS = [
  {
    id: 'sensitivity-name', chapter: 'sensitivity', kind: 'action', interactive: true,
    targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.name, wizardStep: 0,
    title: 'Name it',
    body: '',
    bullets: ['Names identify saved analyses in Results.', 'For example, “LTI threshold comparison”.'],
    actionHint: 'Enter a name to continue.',
    completionNote: 'Your analysis name is saved in this practice draft.'
  },
  {
    id: 'sensitivity-instrument', chapter: 'sensitivity', kind: 'info',
    targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.instrument, wizardStep: 1,
    title: 'Choose the policy instrument',
    body: '',
    bullets: [
      'Sensitivity analysis tests one instrument at different values.',
      'This LTI threshold applies to first-time buyers and home movers.',
      'Some loans may exceed this threshold. Other policy settings stay fixed.'
    ]
  },
  {
    id: 'sensitivity-tested-values', chapter: 'sensitivity', kind: 'info', interactive: true,
    targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.testedValues, wizardStep: 1,
    title: 'Set the range and steps',
    body: '',
    bullets: [
      'Min and Max set the range.',
      'Sample count sets the number of evenly spaced values. Keep 3 for this practice.',
      'The preview lists every setting, including the baseline. Keep the baseline inside the range.'
    ]
  },
  {
    id: 'sensitivity-model', chapter: 'sensitivity', kind: 'info',
    targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.model, wizardStep: 2,
    title: 'Choose the model',
    body: '',
    bullets: [
      'The model version defines the calibrated economy.',
      'Every tested setting uses this model.',
      'For more information about the model, use the blue boxes to visit the dedicated pages.'
    ]
  },
  {
    id: 'sensitivity-baseline', chapter: 'sensitivity', kind: 'info',
    targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.baseline, wizardStep: 2,
    title: 'Choose the baseline policy',
    body: '',
    bullets: [
      'Baseline policy supplies every policy value you are not varying.',
      'Its unchanged configuration is included as the comparison point.',
      'Policy defaults are separate from the model version.'
    ]
  },
  {
    id: 'sensitivity-run-recording', chapter: 'sensitivity', kind: 'info',
    targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.runSettings, wizardStep: 3,
    title: 'Check run and recording',
    body: '',
    bullets: [
      'Each setting uses 1,000 households and 600 model months.',
      'One seed per setting keeps practice short. More seeds test consistency across random draws.',
      'Core indicators are saved for comparison. Transaction and household exports stay off to keep files small.'
    ]
  },
  {
    id: 'sensitivity-review', chapter: 'sensitivity', kind: 'info',
    targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.review, wizardStep: 4,
    title: 'Review before starting',
    body: '',
    bullets: [
      'Check the instrument, tested values, model and baseline.',
      'Three settings with one seed each give three simulations.',
      'Start queues this small analysis and opens its Report.'
    ]
  },
  {
    id: 'sensitivity-submit', chapter: 'sensitivity', kind: 'action', interactive: true,
    targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.startBoundary, wizardStep: 4,
    title: 'Start your sensitivity analysis',
    body: '',
    bullets: ['Start queues a real analysis with these settings.', 'Its Report opens when submission is accepted. The demo ends here.'],
    actionHint: 'Select Start sensitivity analysis.',
    completionNote: 'Analysis submitted. Its Report is ready to open.'
  },
  {
    id: 'sensitivity-complete', chapter: 'sensitivity', kind: 'info', targetId: null, wizardStep: 4,
    title: 'Sensitivity analysis guide complete',
    body: '',
    bullets: ['Your practice analysis has been submitted.', 'View your run to open its Report. Finish keeps the saved results.']
  }
] as const satisfies readonly CreationDemoStep<SensitivityExperimentDemoStepId>[];

export interface SensitivityExperimentDemoState {
  currentWizardStep: number;
  currentName: string;
  minValue: string;
  maxValue: string;
  sampleCount: string;
  baselineValues: readonly number[];
  sampleValues: readonly string[];
  selectedInstrument: string;
  selectedModel: string;
  selectedBaselinePolicy: string;
  seedsPerPoint: number | null;
  runMonths?: string;
  householdCount?: string;
  sensitivityRun?: ExperimentPracticeRun;
}

export interface SensitivityExperimentDemoProps extends ExperimentDemoChapterContext, SensitivityExperimentDemoState {
  actionError: string;
  actionErrorTargetId: string | null;
  onRestoreStep: (step: CreationDemoStep<SensitivityExperimentDemoStepId>) => void;
  onBeforeAdvance: (nextStep: CreationDemoStep<SensitivityExperimentDemoStepId>) => boolean;
}

export function sensitivityExperimentDemoRangeFingerprint(min: string, max: string): string {
  return `${min.trim()}\u0000${max.trim()}`;
}

export function sensitivityExperimentDemoPreviewFingerprint(values: readonly string[]): string {
  return values.join('\u0000');
}

export function isSensitivityExperimentDemoSweepValid(state: Pick<SensitivityExperimentDemoState, 'minValue' | 'maxValue' | 'sampleCount' | 'baselineValues' | 'sampleValues'>): boolean {
  const min = Number.parseFloat(state.minValue);
  const max = Number.parseFloat(state.maxValue);
  const count = Number.parseFloat(state.sampleCount);
  return Boolean(Number.isFinite(min) && Number.isFinite(max) && min < max && Number.isInteger(count) && count >= 2 &&
    state.baselineValues.length > 0 && state.baselineValues.every((value) => Number.isFinite(value) && value >= min && value <= max) && state.sampleValues.length > 0);
}

export function isSensitivityExperimentDemoStepComplete(
  stepId: SensitivityExperimentDemoStepId,
  state: { currentName: string; committedName: string; sensitivityRun?: ExperimentPracticeRun }
): boolean {
  if (stepId === 'sensitivity-submit') return state.sensitivityRun?.status === 'submitted';
  return stepId !== 'sensitivity-name' || isCommittedExperimentDemoTextComplete(state.currentName, state.committedName);
}

/** Copy follows editable values; a changed preview never retains the default workload claim. */
export function buildSensitivityCreationSteps(state: SensitivityExperimentDemoState): CreationDemoStep<SensitivityExperimentDemoStepId>[] {
  const count = state.sampleValues.length;
  const total = count && state.seedsPerPoint ? count * state.seedsPerPoint : null;
  return SENSITIVITY_EXPERIMENT_DEMO_STEPS.map((step): CreationDemoStep<SensitivityExperimentDemoStepId> => {
    if (step.id === 'sensitivity-tested-values') {
      return step;
    }
    if (step.id === 'sensitivity-instrument') {
      return state.selectedInstrument === 'owner_occupier_lti_soft_max' ? step : { ...step, bullets: [
        'Sensitivity analysis tests one instrument at different values.',
        'Its description explains which policy parameters move together.',
        'Other policy settings stay at the baseline.'
      ] };
    }
    if (step.id === 'sensitivity-run-recording') {
      const households = Number(state.householdCount ?? practice.households);
      const months = Number(state.runMonths ?? practice.months);
      const valid = Number.isSafeInteger(households) && households > 0 && Number.isSafeInteger(months) && months > 0;
      return { ...step, bullets: [
        valid ? `Each setting uses ${households.toLocaleString('en-GB')} households and ${months.toLocaleString('en-GB')} model months.` : 'Enter valid household and month counts.',
        state.seedsPerPoint === 1 ? step.bullets[1] : 'Seeds repeat each setting with different random draws. Use one seed for this practice.',
        step.bullets[2]
      ] };
    }
    if (step.id === 'sensitivity-review') {
      return { ...step, bullets: [
        step.bullets[0],
        total === null ? 'Check the settings and seed count to calculate the total.' : `${count} settings with ${state.seedsPerPoint} ${state.seedsPerPoint === 1 ? 'seed' : 'seeds'} each give ${total} simulations.`,
        step.bullets[2]
      ] };
    }
    if (step.id === 'sensitivity-submit' && state.sensitivityRun?.status === 'submitting') {
      return { ...step, actionHint: 'Waiting for the queue to accept your analysis.', bullets: ['Your request has been sent.', 'Its Report opens once acceptance is confirmed.'] };
    }
    return step;
  });
}

export function sensitivityExperimentDemoWizardStep(stepId: string): number {
  return SENSITIVITY_EXPERIMENT_DEMO_STEPS.find((step) => step.id === stepId)?.wizardStep ?? 0;
}

export function SensitivityExperimentDemo({ onRestoreStep, onBeforeAdvance, actionError, actionErrorTargetId, ...props }: SensitivityExperimentDemoProps) {
  const steps = buildSensitivityCreationSteps(props).map((step) => actionError && actionErrorTargetId && step.id === props.savedStepId
    ? { ...step, targetId: actionErrorTargetId, interactive: true }
    : step);
  const fingerprint = useMemo(() => JSON.stringify({
    instrument: props.selectedInstrument,
    range: sensitivityExperimentDemoRangeFingerprint(props.minValue, props.maxValue),
    samples: props.sampleCount, seeds: props.seedsPerPoint, months: props.runMonths, households: props.householdCount,
    model: props.selectedModel, baselinePolicy: props.selectedBaselinePolicy
  }), [props.maxValue, props.minValue, props.sampleCount, props.seedsPerPoint, props.runMonths, props.householdCount, props.selectedBaselinePolicy, props.selectedInstrument, props.selectedModel]);
  return <GuidedCreationDemo
    {...props}
    chapter="sensitivity" label="Create a sensitivity analysis"
    steps={steps} completionStepId="sensitivity-complete" fingerprint={fingerprint}
    onRestoreStep={onRestoreStep} onBeforeAdvance={onBeforeAdvance} feedback={actionError}
    isStepComplete={(step) => isSensitivityExperimentDemoStepComplete(step.id, { currentName: props.currentName, committedName: props.committedValues.name ?? '', sensitivityRun: props.sensitivityRun })}
  />;
}

export { committedExperimentDemoText };
export type SensitivityExperimentDemoCoordinator = ExperimentDemoCoordinator;
export type SensitivityExperimentDemoContext = ExperimentDemoChapterContext;
