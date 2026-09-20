import { useCallback, useMemo, useRef } from 'react';
import type { ExperimentDemoProgressEvent } from '../lib/experimentDemo';
import {
  ExperimentDemoOverlay,
  type ExperimentDemoChapterContext,
  type ExperimentDemoCoordinator,
  type ExperimentDemoStep
} from './ExperimentDemoOverlay';

export const POLICY_EXPERIMENT_DEMO_TARGETS = {
  stepper: 'policy-stepper',
  name: 'policy-name',
  continueButton: 'policy-continue',
  model: 'policy-model',
  referencePolicy: 'policy-reference-policy',
  bankRateToggle: 'policy-bank-rate-toggle',
  bankRateContent: 'policy-bank-rate-content',
  ltvToggle: 'policy-ltv-toggle',
  ltvContent: 'policy-ltv-content',
  ftbLtvInput: 'policy-ftb-ltv-input',
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
  | 'policy-orientation'
  | 'policy-name'
  | 'policy-continue-model'
  | 'policy-model'
  | 'policy-continue-settings'
  | 'policy-reference'
  | 'policy-open-bank-rate'
  | 'policy-inspect-bank-rate'
  | 'policy-open-ltv'
  | 'policy-inspect-ltv'
  | 'policy-change-ftb-ltv'
  | 'policy-inspect-change'
  | 'policy-inspect-live-summary'
  | 'policy-open-lti'
  | 'policy-inspect-lti'
  | 'policy-open-affordability'
  | 'policy-inspect-affordability'
  | 'policy-continue-technical'
  | 'policy-inspect-technical'
  | 'policy-open-exports'
  | 'policy-inspect-exports'
  | 'policy-continue-review'
  | 'policy-review-overview'
  | 'policy-review-audit'
  | 'policy-open-recording'
  | 'policy-inspect-recording'
  | 'policy-start-boundary'
  | 'policy-complete';

export const POLICY_EXPERIMENT_DEMO_STEPS = [
  {
    id: 'policy-purpose', chapter: 'policy', kind: 'info', targetId: null, wizardStep: 0,
    title: 'Build a policy scenario',
    body: 'A policy scenario tests one edited policy configuration against an unchanged reference. Both runs use the same calibrated model and technical settings, so differences in Results can be attributed to the policy changes you make.'
  },
  {
    id: 'policy-orientation', chapter: 'policy', kind: 'info', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.stepper, wizardStep: 0,
    title: 'Five pages, one auditable scenario',
    body: 'The builder moves through Scenario name, Model version, Policy settings, Technical details, and Review and start. The live summary updates throughout. This demo keeps every edit local and will not submit a run.'
  },
  {
    id: 'policy-name', chapter: 'policy', kind: 'action', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.name, wizardStep: 0,
    title: 'Name the policy scenario',
    body: 'Enter a clear name you will recognise in Results, then press Enter or click outside the field. The walkthrough will continue automatically.',
    actionHint: 'Deliberately edit the name, then commit it with Enter or by leaving the field.'
  },
  {
    id: 'policy-continue-model', chapter: 'policy', kind: 'action', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.continueButton, wizardStep: 0,
    title: 'Continue to Model version',
    body: 'Use the builder’s highlighted Continue arrow. It is the real page control, so the guide advances with the page.',
    actionHint: 'Select the highlighted Continue arrow.',
    reveals: POLICY_EXPERIMENT_DEMO_TARGETS.model
  },
  {
    id: 'policy-model', chapter: 'policy', kind: 'inspect', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.model, wizardStep: 1,
    title: 'One calibrated model for both cases',
    body: 'The selected calibrated model drives both the edited scenario and unchanged reference. Its evidence note identifies input-data and behavioural-fit years. Calibration explains assumptions; Validation shows how closely output matches UK evidence. Those links remain available outside this guided tour.',
    waitHint: 'Wait for the newly selected model and its evidence note to finish loading.',
    pairedActionId: 'policy-continue-model'
  },
  {
    id: 'policy-continue-settings', chapter: 'policy', kind: 'action', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.continueButton, wizardStep: 1,
    title: 'Continue to Policy settings',
    body: 'Use the real Continue arrow to open the policy editor.',
    actionHint: 'Select the highlighted Continue arrow.',
    reveals: POLICY_EXPERIMENT_DEMO_TARGETS.referencePolicy
  },
  {
    id: 'policy-reference', chapter: 'policy', kind: 'inspect', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.referencePolicy, wizardStep: 2,
    title: 'Choose the reference policy separately',
    body: 'Unchanged settings inherit this policy year; it is separate from the selected model. Changing the reference after editing policy values resets those edits, so this demonstration leaves the meaningful default in place.',
    pairedActionId: 'policy-continue-settings'
  },
  {
    id: 'policy-open-bank-rate', chapter: 'policy', kind: 'action', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.bankRateToggle, wizardStep: 2,
    title: 'Open Bank Rate',
    body: 'Open the real Bank Rate disclosure to reveal its inherited control.',
    actionHint: 'Open the highlighted disclosure.',
    alreadyCompleteLabel: 'View contents',
    reveals: POLICY_EXPERIMENT_DEMO_TARGETS.bankRateContent
  },
  {
    id: 'policy-inspect-bank-rate', chapter: 'policy', kind: 'inspect', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.bankRateContent, wizardStep: 2,
    title: 'Inspect Bank Rate',
    body: 'This group contains the central-bank policy rate applied at the start of the run. The interface uses percentage units, and the Reference line shows the inherited policy value.',
    pairedActionId: 'policy-open-bank-rate'
  },
  {
    id: 'policy-open-ltv', chapter: 'policy', kind: 'action', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.ltvToggle, wizardStep: 2,
    title: 'Open LTV limits',
    body: 'Open the Loan-to-value disclosure to see the borrower-specific limits.',
    actionHint: 'Open the highlighted disclosure.',
    alreadyCompleteLabel: 'View contents',
    reveals: POLICY_EXPERIMENT_DEMO_TARGETS.ltvContent
  },
  {
    id: 'policy-inspect-ltv', chapter: 'policy', kind: 'inspect', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.ltvContent, wizardStep: 2,
    title: 'Inspect LTV limits',
    body: 'These are maximum mortgage amounts as a percentage of property value, with separate controls for first-time buyers, home movers, and buy-to-let borrowers.',
    pairedActionId: 'policy-open-ltv'
  },
  {
    id: 'policy-change-ftb-ltv', chapter: 'policy', kind: 'action', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.ftbLtvInput, wizardStep: 2,
    title: 'Change the first-time-buyer LTV',
    body: 'Commit a valid non-negative value different from the reference. If the reference is 95%, try 90%, then press Enter or leave the field.',
    actionHint: 'Edit the highlighted value and commit it with Enter or blur.',
    reveals: POLICY_EXPERIMENT_DEMO_TARGETS.changedFeedback
  },
  {
    id: 'policy-inspect-change', chapter: 'policy', kind: 'inspect', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.changedFeedback, wizardStep: 2,
    title: 'Read the policy change',
    body: 'Changed distinguishes an override from an inherited value. The reference remains visible beside the edited control, and the accordion heading counts how many settings in the group have changed.',
    pairedActionId: 'policy-change-ftb-ltv'
  },
  {
    id: 'policy-inspect-live-summary', chapter: 'policy', kind: 'inspect', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.liveSummary, wizardStep: 2,
    title: 'Read the intervention delta',
    body: 'The live summary reports the reference-to-intervention delta. Results will compare this edited case with the unchanged reference using the same model and run settings.'
  },
  {
    id: 'policy-open-lti', chapter: 'policy', kind: 'action', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.ltiToggle, wizardStep: 2,
    title: 'Open LTI limits',
    body: 'Open the Loan-to-income disclosure to inspect its flow-limit package.',
    actionHint: 'Open the highlighted disclosure.',
    alreadyCompleteLabel: 'View contents',
    reveals: POLICY_EXPERIMENT_DEMO_TARGETS.ltiContent
  },
  {
    id: 'policy-inspect-lti', chapter: 'policy', kind: 'inspect', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.ltiContent, wizardStep: 2,
    title: 'Inspect LTI limits',
    body: 'The controls cover first-time-buyer and home-mover high-LTI thresholds, the maximum shares of lending allowed at or above them, and the rolling assessment window. This demonstration leaves them unchanged.',
    pairedActionId: 'policy-open-lti'
  },
  {
    id: 'policy-open-affordability', chapter: 'policy', kind: 'action', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.affordabilityToggle, wizardStep: 2,
    title: 'Open affordability and BTL requirements',
    body: 'Open the final policy disclosure.',
    actionHint: 'Open the highlighted disclosure.',
    alreadyCompleteLabel: 'View contents',
    reveals: POLICY_EXPERIMENT_DEMO_TARGETS.affordabilityContent
  },
  {
    id: 'policy-inspect-affordability', chapter: 'policy', kind: 'inspect', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.affordabilityContent, wizardStep: 2,
    title: 'Inspect affordability and buy-to-let controls',
    body: 'These controls set the mortgage affordability cap and buy-to-let interest-coverage floor. A nearly 100% affordability cap or zero ICR floor can be effectively non-binding. Unchanged values continue to use the reference policy.',
    pairedActionId: 'policy-open-affordability'
  },
  {
    id: 'policy-continue-technical', chapter: 'policy', kind: 'action', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.continueButton, wizardStep: 2,
    title: 'Continue to Technical details',
    body: 'Use the builder’s Continue arrow to move from policy choices to execution and output settings.',
    actionHint: 'Select the highlighted Continue arrow.',
    reveals: POLICY_EXPERIMENT_DEMO_TARGETS.technicalSettings
  },
  {
    id: 'policy-inspect-technical', chapter: 'policy', kind: 'inspect', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.technicalSettings, wizardStep: 3,
    title: 'Inspect technical run settings',
    body: 'Duration controls model steps. Each seed initializes a sequence of random events; several seeds reveal variability. Workers change concurrency, not experiment size. Population affects workload, while rolling-window and cumulative-weight controls shape retained summaries. These execution/output settings do not change the model or policy.',
    pairedActionId: 'policy-continue-technical'
  },
  {
    id: 'policy-open-exports', chapter: 'policy', kind: 'action', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.additionalExportsToggle, wizardStep: 3,
    title: 'Open Additional data exports',
    body: 'Open the real disclosure without enabling any export.',
    actionHint: 'Open the highlighted disclosure.',
    alreadyCompleteLabel: 'View contents',
    reveals: POLICY_EXPERIMENT_DEMO_TARGETS.additionalExportsContent
  },
  {
    id: 'policy-inspect-exports', chapter: 'policy', kind: 'inspect', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.additionalExportsContent, wizardStep: 3,
    title: 'Inspect optional exports',
    body: 'This section contains transaction, bid-up, quality-band, and household-level files. They can substantially increase output size and are not required for the current dashboard Results charts.',
    pairedActionId: 'policy-open-exports'
  },
  {
    id: 'policy-continue-review', chapter: 'policy', kind: 'action', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.continueButton, wizardStep: 3,
    title: 'Continue to Review',
    body: 'Use the native Continue arrow to assemble the final audit.',
    actionHint: 'Select the highlighted Continue arrow.',
    reveals: POLICY_EXPERIMENT_DEMO_TARGETS.reviewOverview
  },
  {
    id: 'policy-review-overview', chapter: 'policy', kind: 'inspect', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.reviewOverview, wizardStep: 4,
    title: 'Review the overview',
    body: 'The overview brings together the scenario name, calibrated model, reference policy, and changed-setting count.',
    pairedActionId: 'policy-continue-review'
  },
  {
    id: 'policy-review-audit', chapter: 'policy', kind: 'inspect', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.policyAudit, wizardStep: 4,
    title: 'Review the full policy audit',
    body: 'Every supported policy control is listed as Changed or Unchanged. Overrides also retain their reference values, making the intervention auditable before compute starts.'
  },
  {
    id: 'policy-open-recording', chapter: 'policy', kind: 'action', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.recordingToggle, wizardStep: 4,
    title: 'Open Recording configuration',
    body: 'Open the real collapsed Review section.',
    actionHint: 'Open the highlighted disclosure.',
    alreadyCompleteLabel: 'View contents',
    reveals: POLICY_EXPERIMENT_DEMO_TARGETS.recordingContent
  },
  {
    id: 'policy-inspect-recording', chapter: 'policy', kind: 'inspect', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.recordingContent, wizardStep: 4,
    title: 'Inspect Recording configuration',
    body: 'This audit shows which dashboard indicators and optional output files will be retained.',
    pairedActionId: 'policy-open-recording'
  },
  {
    id: 'policy-start-boundary', chapter: 'policy', kind: 'info', targetId: POLICY_EXPERIMENT_DEMO_TARGETS.startBoundary, wizardStep: 4,
    title: 'The real Start boundary',
    body: 'Start submits the scenario and opens Results. Runtime warnings do not require another click; replacing existing results still asks for confirmation. The highlighted control is disabled and this demo submits no runs.',
    nextLabel: 'Complete Policy chapter'
  },
  {
    id: 'policy-complete', chapter: 'policy', kind: 'info', targetId: null, wizardStep: 4,
    title: 'Policy scenario chapter complete',
    body: 'You built and audited a demo-owned policy draft. No model run was submitted.'
  }
] as const satisfies readonly ExperimentDemoStep<PolicyExperimentDemoStepId>[];

export interface PolicyExperimentDemoState {
  currentWizardStep: number;
  currentName: string;
  committedName: string;
  nameCommitRevision: number;
  openPolicyGroups: ReadonlySet<string>;
  currentFtbLtv: string;
  referenceFtbLtv: number | undefined;
  committedFtbLtv: string;
  ftbCommitRevision: number;
  additionalExportsOpen: boolean;
  recordingOpen: boolean;
  modelSelectionPending: boolean;
  selectedModel: string;
  selectedReferencePolicy: string;
}

export interface PolicyExperimentDemoProps extends ExperimentDemoChapterContext, PolicyExperimentDemoState {
  onRestoreStep: (step: ExperimentDemoStep<PolicyExperimentDemoStepId>) => void;
}

export function committedExperimentDemoText(value: string, wasDeliberatelyEdited: boolean): string {
  return wasDeliberatelyEdited ? value.trim() : '';
}

export function isCommittedExperimentDemoTextComplete(
  currentValue: string,
  committedValue: string,
  commitRevision: number
): boolean {
  return Boolean(
    commitRevision > 0 &&
      committedValue &&
      currentValue.trim() === committedValue
  );
}

export function isPolicyExperimentDemoFtbLtvComplete(
  currentValue: string,
  referenceValue: number | undefined,
  committedValue: string,
  commitRevision: number
): boolean {
  const current = Number.parseFloat(currentValue);
  const committed = Number.parseFloat(committedValue);
  return Boolean(
    commitRevision > 0 &&
      Number.isFinite(current) &&
      current >= 0 &&
      Number.isFinite(committed) &&
      Math.abs(current - committed) < 1e-12 &&
      typeof referenceValue === 'number' &&
      Number.isFinite(referenceValue) &&
      Math.abs(current - referenceValue) >= 1e-12
  );
}

export function policyExperimentDemoWizardStep(stepId: string): number {
  return POLICY_EXPERIMENT_DEMO_STEPS.find((step) => step.id === stepId)?.wizardStep ?? 0;
}

export function isPolicyExperimentDemoStepComplete(
  stepId: PolicyExperimentDemoStepId,
  state: PolicyExperimentDemoState
): boolean {
  if (stepId === 'policy-name') {
    return isCommittedExperimentDemoTextComplete(
      state.currentName,
      state.committedName,
      state.nameCommitRevision
    );
  }
  if (stepId === 'policy-continue-model') return state.currentWizardStep === 1;
  if (stepId === 'policy-continue-settings') return state.currentWizardStep === 2;
  if (stepId === 'policy-open-bank-rate') return state.openPolicyGroups.has('bankRate');
  if (stepId === 'policy-open-ltv') return state.openPolicyGroups.has('ltv');
  if (stepId === 'policy-change-ftb-ltv') {
    return isPolicyExperimentDemoFtbLtvComplete(
      state.currentFtbLtv,
      state.referenceFtbLtv,
      state.committedFtbLtv,
      state.ftbCommitRevision
    );
  }
  if (stepId === 'policy-open-lti') return state.openPolicyGroups.has('lti');
  if (stepId === 'policy-open-affordability') return state.openPolicyGroups.has('affordability-and-btl');
  if (stepId === 'policy-continue-technical') return state.currentWizardStep === 3;
  if (stepId === 'policy-open-exports') return state.additionalExportsOpen;
  if (stepId === 'policy-continue-review') return state.currentWizardStep === 4;
  if (stepId === 'policy-open-recording') return state.recordingOpen;
  return true;
}

export function PolicyExperimentDemo({
  onRestoreStep,
  ...props
}: PolicyExperimentDemoProps) {
  const completedJourneyRef = useRef('');
  const state: PolicyExperimentDemoState = props;
  const fingerprint = useMemo(() => JSON.stringify({
    model: props.selectedModel,
    referencePolicy: props.selectedReferencePolicy,
    ftbLtv: props.currentFtbLtv
  }), [props.currentFtbLtv, props.selectedModel, props.selectedReferencePolicy]);

  const handleStepEntered = useCallback((step: ExperimentDemoStep<PolicyExperimentDemoStepId>) => {
    onRestoreStep(step);
    if (step.id !== 'policy-complete' || completedJourneyRef.current === props.journeyId) return;
    completedJourneyRef.current = props.journeyId;
    const event: ExperimentDemoProgressEvent = {
      journeyId: props.journeyId,
      chapter: 'policy',
      draftId: props.draftId
    };
    props.onChapterComplete(event);
  }, [onRestoreStep, props.draftId, props.journeyId, props.onChapterComplete]);

  return (
    <ExperimentDemoOverlay
      active={props.active && !props.paused}
      chapter="policy"
      journeyId={props.journeyId}
      draftId={props.draftId}
      ready={props.ready}
      loading={props.loading}
      error={props.error}
      steps={POLICY_EXPERIMENT_DEMO_STEPS}
      savedStepId={props.savedStepId}
      fingerprint={fingerprint}
      completionStepId="policy-complete"
      completionPrimaryLabel={props.mode === 'both'
        ? 'Continue to Sensitivity analysis'
        : 'Finish and return Home'}
      onCompletionPrimary={props.mode === 'both' ? props.onContinueToSensitivity : props.onFinish}
      onRetryLoad={props.onRetryLoad}
      onPause={props.onPause}
      onExit={props.onExit}
      onProgress={props.onProgress}
      onStepEntered={handleStepEntered}
      isStepComplete={(step) => isPolicyExperimentDemoStepComplete(step.id, state)}
      canAdvanceStep={(step) => step.id !== 'policy-model' || !props.modelSelectionPending}
    />
  );
}

export type PolicyExperimentDemoCoordinator = ExperimentDemoCoordinator;
export type PolicyExperimentDemoContext = ExperimentDemoChapterContext;
