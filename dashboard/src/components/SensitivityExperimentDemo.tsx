import { useCallback, useMemo, useRef } from 'react';
import type { ExperimentDemoProgressEvent } from '../lib/experimentDemo';
import {
  ExperimentDemoOverlay,
  type ExperimentDemoChapterContext,
  type ExperimentDemoCoordinator,
  type ExperimentDemoStep
} from './ExperimentDemoOverlay';
import {
  committedExperimentDemoText,
  isCommittedExperimentDemoTextComplete
} from './PolicyExperimentDemo';

export const SENSITIVITY_EXPERIMENT_DEMO_TARGETS = {
  stepper: 'sensitivity-stepper',
  name: 'sensitivity-name',
  continueButton: 'sensitivity-continue',
  instrument: 'sensitivity-instrument',
  range: 'sensitivity-range',
  sampleCount: 'sensitivity-sample-count',
  updatedPreview: 'sensitivity-updated-preview',
  actualValues: 'sensitivity-actual-values',
  liveSummary: 'sensitivity-live-summary',
  model: 'sensitivity-model',
  baseline: 'sensitivity-baseline',
  runSettings: 'sensitivity-run-settings',
  fixedRecording: 'sensitivity-fixed-recording',
  reviewSamples: 'sensitivity-review-samples',
  totalExecutions: 'sensitivity-total-executions',
  startBoundary: 'sensitivity-start-boundary'
} as const;

export type SensitivityExperimentDemoStepId =
  | 'sensitivity-purpose'
  | 'sensitivity-orientation'
  | 'sensitivity-name'
  | 'sensitivity-continue-sweep'
  | 'sensitivity-instrument'
  | 'sensitivity-edit-range'
  | 'sensitivity-inspect-preview'
  | 'sensitivity-change-samples'
  | 'sensitivity-inspect-values'
  | 'sensitivity-live-summary'
  | 'sensitivity-continue-model'
  | 'sensitivity-model'
  | 'sensitivity-baseline'
  | 'sensitivity-continue-run'
  | 'sensitivity-workload'
  | 'sensitivity-recording'
  | 'sensitivity-continue-review'
  | 'sensitivity-review-samples'
  | 'sensitivity-review-total'
  | 'sensitivity-start-boundary'
  | 'sensitivity-complete';

export const SENSITIVITY_EXPERIMENT_DEMO_STEPS = [
  {
    id: 'sensitivity-purpose', chapter: 'sensitivity', kind: 'info', targetId: null, wizardStep: 0,
    title: 'Build a sensitivity analysis',
    body: 'A sensitivity analysis varies one policy instrument across a range while every other policy setting stays at a chosen baseline. Repeating each sampled value across several random seeds shows how outcomes respond and whether that response is stable.'
  },
  {
    id: 'sensitivity-orientation', chapter: 'sensitivity', kind: 'info', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.stepper, wizardStep: 0,
    title: 'Five pages for one controlled sweep',
    body: 'The builder moves through Experiment details, Define the sweep, Model and baseline, Run and recording, and Review and start. The live summary keeps the instrument, actual values, seeds, model, workload, and recording contract visible.'
  },
  {
    id: 'sensitivity-name', chapter: 'sensitivity', kind: 'action', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.name, wizardStep: 0,
    title: 'Name the sensitivity analysis',
    body: 'Enter a clear name, then press Enter or click outside the field. Typing alone does not complete this step.',
    actionHint: 'Deliberately edit the name, then commit it with Enter or by leaving the field.'
  },
  {
    id: 'sensitivity-continue-sweep', chapter: 'sensitivity', kind: 'action', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.continueButton, wizardStep: 0,
    title: 'Continue to Define the sweep',
    body: 'Use the real Continue arrow. The builder’s name validation remains authoritative.',
    actionHint: 'Select the highlighted Continue arrow.',
    reveals: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.instrument
  },
  {
    id: 'sensitivity-instrument', chapter: 'sensitivity', kind: 'inspect', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.instrument, wizardStep: 1,
    title: 'Understand the policy instrument',
    body: 'Sensitivity varies one defined instrument or package at a time; every other setting stays at the baseline. The default instrument already supplies a sensible range, so no gratuitous change is required.',
    waitHint: 'Wait for the selected instrument’s matching default range to settle.',
    pairedActionId: 'sensitivity-continue-sweep'
  },
  {
    id: 'sensitivity-edit-range', chapter: 'sensitivity', kind: 'action', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.range, wizardStep: 1,
    title: 'Edit the sweep range',
    body: 'Deliberately change and commit at least one bound. Keep both values numeric, minimum below maximum, the baseline inside the range, and the existing sample count valid. Increasing the maximum slightly is usually safe.',
    actionHint: 'Edit Min or Max, then commit with Enter or by leaving the field.',
    reveals: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.updatedPreview
  },
  {
    id: 'sensitivity-inspect-preview', chapter: 'sensitivity', kind: 'inspect', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.updatedPreview, wizardStep: 1,
    title: 'Inspect the updated preview',
    body: 'The real preview recalculates immediately. Changing the bounds changes the policy values that will actually be tested.',
    pairedActionId: 'sensitivity-edit-range'
  },
  {
    id: 'sensitivity-change-samples', chapter: 'sensitivity', kind: 'action', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.sampleCount, wizardStep: 1,
    title: 'Change the sample count',
    body: 'Commit a different whole number of at least two while keeping the sweep valid. Three requested samples is a useful compact example, but any valid deliberate change works.',
    actionHint: 'Edit Sample count and commit it with Enter or blur.',
    reveals: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.actualValues
  },
  {
    id: 'sensitivity-inspect-values', chapter: 'sensitivity', kind: 'inspect', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.actualValues, wizardStep: 1,
    title: 'Read the actual sampled values',
    body: 'Requested samples include endpoints and numeric packages are evenly spaced. Integer rounding can create duplicates, which are removed. A missing baseline point is added. Actual unique points can therefore differ from the requested count; this displayed list is authoritative.',
    pairedActionId: 'sensitivity-change-samples'
  },
  {
    id: 'sensitivity-live-summary', chapter: 'sensitivity', kind: 'inspect', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.liveSummary, wizardStep: 1,
    title: 'Inspect the live summary',
    body: 'The summary names the varied instrument, baseline policy and values, actual tested values, seeds per point, model, duration, workers, and total executions.'
  },
  {
    id: 'sensitivity-continue-model', chapter: 'sensitivity', kind: 'action', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.continueButton, wizardStep: 1,
    title: 'Continue to Model and baseline',
    body: 'Use the native Continue arrow. If the sweep is invalid, the builder keeps you on the relevant page and explains why.',
    actionHint: 'Select Continue; resolve any native validation message without bypassing it.',
    reveals: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.model
  },
  {
    id: 'sensitivity-model', chapter: 'sensitivity', kind: 'inspect', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.model, wizardStep: 2,
    title: 'Use one model at every sampled point',
    body: 'The same calibrated model runs every sampled point. Its evidence note identifies the version’s evidence context. Calibration and Validation links remain available outside the tour; no detour is required here.',
    waitHint: 'Wait for the newly selected model and its evidence note to finish loading.',
    pairedActionId: 'sensitivity-continue-model'
  },
  {
    id: 'sensitivity-baseline', chapter: 'sensitivity', kind: 'inspect', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.baseline, wizardStep: 2,
    title: 'Keep unswept policy at the baseline',
    body: 'Every unswept instrument retains this baseline-policy value. The swept instrument’s baseline must lie inside the range. Changing baseline can recalculate the default range or invalidate the current one, so this demonstration does not force a change.'
  },
  {
    id: 'sensitivity-continue-run', chapter: 'sensitivity', kind: 'action', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.continueButton, wizardStep: 2,
    title: 'Continue to Run and recording',
    body: 'Use the native Continue arrow. Baseline-inside-range validation remains authoritative.',
    actionHint: 'Select Continue; resolve any native validation message shown by the page.',
    reveals: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.runSettings
  },
  {
    id: 'sensitivity-workload', chapter: 'sensitivity', kind: 'inspect', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.runSettings, wizardStep: 3,
    title: 'Inspect workload settings',
    body: 'Duration controls model steps; seeds repeat each sampled point; workers change concurrency, not execution count. Population and indicator controls affect workload and retained summaries. Total executions equal actual unique points multiplied by seeds per point.',
    pairedActionId: 'sensitivity-continue-run'
  },
  {
    id: 'sensitivity-recording', chapter: 'sensitivity', kind: 'inspect', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.fixedRecording, wizardStep: 3,
    title: 'Inspect fixed recording',
    body: 'Sensitivity retains dashboard outcome summaries. Transaction, bid-up, quality-band, and household-level raw files are unavailable and discarded for every sampled run.'
  },
  {
    id: 'sensitivity-continue-review', chapter: 'sensitivity', kind: 'action', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.continueButton, wizardStep: 3,
    title: 'Continue to Review',
    body: 'Use the real Continue arrow to assemble the final workload audit.',
    actionHint: 'Select the highlighted Continue arrow.',
    reveals: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.reviewSamples
  },
  {
    id: 'sensitivity-review-samples', chapter: 'sensitivity', kind: 'inspect', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.reviewSamples, wizardStep: 4,
    title: 'Review actual samples',
    body: 'Review shows the requested range and count alongside the actual sampled-values list. The actual list—not only the requested count—defines the experiment.',
    pairedActionId: 'sensitivity-continue-review'
  },
  {
    id: 'sensitivity-review-total', chapter: 'sensitivity', kind: 'inspect', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.totalExecutions, wizardStep: 4,
    title: 'Review total executions',
    body: 'This card multiplies actual unique points by seeds per point. It is the clearest single measure of the compute workload; workers only determine how many executions can run concurrently.'
  },
  {
    id: 'sensitivity-start-boundary', chapter: 'sensitivity', kind: 'info', targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.startBoundary, wizardStep: 4,
    title: 'The real Start boundary',
    body: 'Start submits the whole workload and opens Sensitivity Results without another confirmation. An accepted submission clears the draft. The highlighted control is disabled and this demo submits no runs.',
    nextLabel: 'Complete Sensitivity chapter'
  },
  {
    id: 'sensitivity-complete', chapter: 'sensitivity', kind: 'info', targetId: null, wizardStep: 4,
    title: 'Sensitivity analysis chapter complete',
    body: 'You defined and audited a demo-owned sensitivity sweep. No model executions were submitted.'
  }
] as const satisfies readonly ExperimentDemoStep<SensitivityExperimentDemoStepId>[];

export interface SensitivityExperimentDemoState {
  currentWizardStep: number;
  currentName: string;
  committedName: string;
  nameCommitRevision: number;
  minValue: string;
  maxValue: string;
  sampleCount: string;
  baselineValues: readonly number[];
  committedRangeFingerprint: string;
  committedRangePreviewFingerprint: string;
  rangeCommitRevision: number;
  rangeChangedFromEntry: boolean;
  committedSampleCount: string;
  committedSamplePreviewFingerprint: string;
  sampleCommitRevision: number;
  sampleChangedFromEntry: boolean;
  sampleValues: readonly string[];
  instrumentSelectionPending: boolean;
  modelSelectionPending: boolean;
  selectedInstrument: string;
  selectedModel: string;
  selectedBaselinePolicy: string;
}

export interface SensitivityExperimentDemoProps extends ExperimentDemoChapterContext, SensitivityExperimentDemoState {
  actionError: string;
  actionErrorTargetId: string | null;
  onRestoreStep: (step: ExperimentDemoStep<SensitivityExperimentDemoStepId>) => void;
}

export function sensitivityExperimentDemoRangeFingerprint(min: string, max: string): string {
  return `${min.trim()}\u0000${max.trim()}`;
}

export function sensitivityExperimentDemoPreviewFingerprint(values: readonly string[]): string {
  return values.join('\u0000');
}

export function isSensitivityExperimentDemoSweepValid(state: SensitivityExperimentDemoState): boolean {
  const min = Number.parseFloat(state.minValue);
  const max = Number.parseFloat(state.maxValue);
  const count = Number.parseFloat(state.sampleCount);
  return Boolean(
    Number.isFinite(min) &&
      Number.isFinite(max) &&
      min < max &&
      Number.isInteger(count) &&
      count >= 2 &&
      state.baselineValues.length > 0 &&
      state.baselineValues.every((value) => Number.isFinite(value) && value >= min && value <= max) &&
      state.sampleValues.length > 0
  );
}

export function isSensitivityExperimentDemoStepComplete(
  stepId: SensitivityExperimentDemoStepId,
  state: SensitivityExperimentDemoState
): boolean {
  if (stepId === 'sensitivity-name') {
    return isCommittedExperimentDemoTextComplete(
      state.currentName,
      state.committedName,
      state.nameCommitRevision
    );
  }
  if (stepId === 'sensitivity-continue-sweep') return state.currentWizardStep === 1;
  if (stepId === 'sensitivity-edit-range') {
    return Boolean(
      state.rangeCommitRevision > 0 &&
        state.rangeChangedFromEntry &&
        isSensitivityExperimentDemoSweepValid(state) &&
        state.committedRangeFingerprint === sensitivityExperimentDemoRangeFingerprint(state.minValue, state.maxValue) &&
        state.committedRangePreviewFingerprint === sensitivityExperimentDemoPreviewFingerprint(state.sampleValues)
    );
  }
  if (stepId === 'sensitivity-change-samples') {
    const currentCount = Number.parseFloat(state.sampleCount);
    return Boolean(
      state.sampleCommitRevision > 0 &&
        state.sampleChangedFromEntry &&
        isSensitivityExperimentDemoSweepValid(state) &&
        Number.isInteger(currentCount) &&
        currentCount >= 2 &&
        state.committedSampleCount === state.sampleCount.trim() &&
        state.committedSamplePreviewFingerprint === sensitivityExperimentDemoPreviewFingerprint(state.sampleValues)
    );
  }
  if (stepId === 'sensitivity-continue-model') return state.currentWizardStep === 2;
  if (stepId === 'sensitivity-continue-run') return state.currentWizardStep === 3;
  if (stepId === 'sensitivity-continue-review') return state.currentWizardStep === 4;
  return true;
}

export function sensitivityExperimentDemoWizardStep(stepId: string): number {
  return SENSITIVITY_EXPERIMENT_DEMO_STEPS.find((step) => step.id === stepId)?.wizardStep ?? 0;
}

export function SensitivityExperimentDemo({
  onRestoreStep,
  actionError,
  actionErrorTargetId,
  ...props
}: SensitivityExperimentDemoProps) {
  const completedJourneyRef = useRef('');
  const state: SensitivityExperimentDemoState = props;
  const fingerprint = useMemo(() => JSON.stringify({
    instrument: props.selectedInstrument,
    range: sensitivityExperimentDemoRangeFingerprint(props.minValue, props.maxValue),
    samples: props.sampleCount,
    model: props.selectedModel,
    baselinePolicy: props.selectedBaselinePolicy
  }), [
    props.maxValue,
    props.minValue,
    props.sampleCount,
    props.selectedBaselinePolicy,
    props.selectedInstrument,
    props.selectedModel
  ]);

  const handleStepEntered = useCallback((step: ExperimentDemoStep<SensitivityExperimentDemoStepId>) => {
    onRestoreStep(step);
    if (step.id !== 'sensitivity-complete' || completedJourneyRef.current === props.journeyId) return;
    completedJourneyRef.current = props.journeyId;
    const event: ExperimentDemoProgressEvent = {
      journeyId: props.journeyId,
      chapter: 'sensitivity',
      draftId: props.draftId
    };
    props.onChapterComplete(event);
  }, [onRestoreStep, props.draftId, props.journeyId, props.onChapterComplete]);

  return (
    <ExperimentDemoOverlay
      active={props.active && !props.paused}
      chapter="sensitivity"
      journeyId={props.journeyId}
      draftId={props.draftId}
      ready={props.ready}
      loading={props.loading}
      error={props.error}
      steps={SENSITIVITY_EXPERIMENT_DEMO_STEPS}
      savedStepId={props.savedStepId}
      fingerprint={fingerprint}
      completionStepId="sensitivity-complete"
      completionPrimaryLabel="Finish and return Home"
      onCompletionPrimary={props.onFinish}
      onRetryLoad={props.onRetryLoad}
      onPause={props.onPause}
      onExit={props.onExit}
      onProgress={props.onProgress}
      onStepEntered={handleStepEntered}
      isStepComplete={(step) => isSensitivityExperimentDemoStepComplete(step.id, state)}
      canAdvanceStep={(step) => {
        if (step.id === 'sensitivity-instrument') return !props.instrumentSelectionPending;
        if (step.id === 'sensitivity-model') return !props.modelSelectionPending;
        return true;
      }}
      actionError={actionError}
      actionErrorTargetId={actionErrorTargetId}
    />
  );
}

export { committedExperimentDemoText };
export type SensitivityExperimentDemoCoordinator = ExperimentDemoCoordinator;
export type SensitivityExperimentDemoContext = ExperimentDemoChapterContext;
