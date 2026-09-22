import type { ExperimentDemoChapter, ExperimentDemoLaunchMode, ExperimentDemoProgressEvent, ExperimentDemoStepProgressEvent } from '../experimentDemo';

/** Steps bind the shared coach to the current builder's pages and actual controls. */
export interface CreationDemoStep<StepId extends string = string> {
  id: StepId;
  chapter: ExperimentDemoChapter;
  kind: 'info' | 'action';
  targetId: string | null;
  additionalTargetIds?: readonly string[];
  wizardStep: number;
  title: string;
  body: string;
  bullets?: readonly string[];
  interactive?: boolean;
  actionHint?: string;
  completionNote?: string;
}

export interface ExperimentDemoChapterContext {
  active: boolean;
  paused: boolean;
  journeyId: string;
  draftId: string;
  mode: ExperimentDemoLaunchMode;
  savedStepId: string;
  committedValues: Readonly<Record<string, string>>;
  /** Each creation chapter can explicitly submit one real practice run. */
  policyRun?: PolicyPracticeRun;
  allowPolicySubmission?: boolean;
  onPolicyRunChange?: (run: PolicyPracticeRun | undefined) => void;
  sensitivityRun?: ExperimentPracticeRun;
  allowSensitivitySubmission?: boolean;
  onSensitivityRunChange?: (run: ExperimentPracticeRun | undefined) => void;
  onViewSubmittedRun?: () => void;
  ready: boolean;
  loading: boolean;
  error: string;
  onRetryLoad: () => void;
  onCommit: (field: 'name' | 'bankRate', value: string) => void;
  onProgress: (event: ExperimentDemoStepProgressEvent) => void;
  onChapterComplete: (event: ExperimentDemoProgressEvent) => void;
  onContinueToSensitivity: () => void;
  onExploreResults?: () => void;
  onFinish: () => void;
  /** Return to editing keeps the practice draft and the submission guard. */
  onPause: () => void;
  onExit: () => void;
}

export interface ExperimentPracticeRun {
  status: 'submitting' | 'submitted';
  /** Unique title is persisted before submission so a refresh can recover the accepted job. */
  title: string;
  /** Result selection ID, either a policy run ID or sensitivity experiment ID. */
  runId?: string;
  jobRef?: string;
}

export type PolicyPracticeRun = ExperimentPracticeRun;

export type ExperimentDemoCoordinator = Omit<ExperimentDemoChapterContext, 'ready' | 'loading' | 'error' | 'onRetryLoad'>;

export interface GuidedCreationDemoProps<StepId extends string = string> extends ExperimentDemoChapterContext {
  chapter: ExperimentDemoChapter;
  label: string;
  /** Last item is the completion card, excluded from the teaching-step count. */
  steps: readonly CreationDemoStep<StepId>[];
  completionStepId: StepId;
  fingerprint: string;
  onRestoreStep: (step: CreationDemoStep<StepId>) => void;
  isStepComplete: (step: CreationDemoStep<StepId>) => boolean;
  /** Return false to keep this stop and show native builder validation feedback. */
  onBeforeAdvance?: (nextStep: CreationDemoStep<StepId>) => boolean;
  feedback?: string;
}

export function committedExperimentDemoText(value: string, wasDeliberatelyEdited: boolean): string {
  return wasDeliberatelyEdited ? value.trim() : '';
}

export function isCommittedExperimentDemoTextComplete(currentValue: string, committedValue: string, commitRevision = 1): boolean {
  return Boolean(commitRevision > 0 && committedValue && currentValue.trim() === committedValue);
}
