/** Shared presentation contract; routing and practice state stay in coordinators. */
export type GuidedDemoId = 'dashboard-overview' | 'policy-results' | 'sensitivity-results' | 'model-information';

export interface GuidedTourStep {
  id: string;
  title: string;
  body: string;
  bullets?: readonly string[];
  kind: 'info' | 'action';
  target: string | null;
  /** Align the target once on step entry, even when it is already visible. */
  scrollOnEnter?: 'start' | 'center';
  interactive?: boolean;
  additionalInteractiveTargets?: readonly string[];
  actionHint?: string;
  completionNote?: string;
  completionBullets?: readonly string[];
  unavailableBody: string;
}

export type GuidedCompletionCheck =
  | { kind: 'query'; key: string; value: string }
  | { kind: 'selector'; selector: string };

export interface GuidedDemoStep extends GuidedTourStep {
  path: string;
  query: Readonly<Record<string, string>>;
  /** Restrict restoration to controls offered by this step when other context must stay fixed. */
  restoreQueryKeys?: readonly string[];
  nextLabel?: string;
  completion?: GuidedCompletionCheck;
}

export interface GuidedDemoDefinition {
  id: GuidedDemoId;
  label: string;
  description: string;
  duration: string;
  startHere?: boolean;
  /** Finish on the final highlighted page without a separate completion screen. */
  finishOnLastStep?: boolean;
  requiredRunIds: readonly string[];
  requiredExperimentIds: readonly string[];
  steps: readonly GuidedDemoStep[];
  completion: { title: string; body: string; bullets?: readonly string[] };
}

export interface GuidedTourAction {
  id: string;
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export interface GuidedTourOverlayProps {
  active?: boolean;
  demoLabel: string;
  step: GuidedTourStep;
  stepIndex: number;
  stepCount: number;
  isComplete: boolean;
  onBack: () => void;
  onNext: () => void;
  onExit: () => void;
  showExit?: boolean;
  nextLabel?: string;
  completionActions?: readonly GuidedTourAction[];
  availability?: 'ready' | 'loading' | 'missing';
  onChooseAnotherDemo?: () => void;
  loadingTitle?: string;
  loadingBody?: string;
  unavailableTitle?: string;
  unavailableBody?: string;
  feedback?: string;
}

/** Frozen handoff seam for the later creation migration; no new creation flow yet. */
export interface GuidedPracticeHandoff {
  from: 'policy' | 'sensitivity';
  journey: string;
  onExploreResults: () => void;
  onReturnToPractice: () => void;
  onReturnToEditing: () => void;
  onFinish: () => void;
}
