import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  MODEL_EVIDENCE_CALIBRATION_COMPLETION_EVENT,
  MODEL_EVIDENCE_CALIBRATION_SESSION_KEY,
  MODEL_EVIDENCE_DEMO_QUERY_VALUE
} from '../lib/modelEvidenceDemo';

export const CALIBRATION_DEMO_TARGETS = {
  primaryModel: 'calibration-primary-model',
  compareToggle: 'calibration-compare-toggle',
  comparisonModel: 'calibration-comparison-model',
  behaviouralOrigin: 'calibration-behavioural-origin',
  fittedParameters: 'calibration-fitted-parameters',
  otherAssumptions: 'calibration-other-assumptions'
} as const;

export function calibrationDemoParameterTargetId(parameterKey: string): string {
  return `calibration-parameter-${parameterKey}`;
}

export function calibrationDemoAssumptionGroupTargetId(groupId: string): string {
  return `calibration-assumption-group-${groupId}`;
}

export function calibrationDemoAssumptionTargetId(itemId: string): string {
  return `calibration-assumption-${itemId}`;
}

export type CalibrationDemoStepId =
  | 'purpose'
  | 'primary-model'
  | 'compare'
  | 'comparison-model'
  | 'behavioural-origin'
  | 'fitted-parameters'
  | 'representative-parameter'
  | 'other-assumptions'
  | 'assumption-group'
  | 'assumption-row';

export const CALIBRATION_DEMO_REQUIRED_ACTION_STEPS = [
  'compare',
  'comparison-model',
  'behavioural-origin',
  'fitted-parameters',
  'representative-parameter',
  'other-assumptions',
  'assumption-group'
] as const satisfies readonly CalibrationDemoStepId[];

const REQUIRED_ACTION_STEP_SET = new Set<CalibrationDemoStepId>(
  CALIBRATION_DEMO_REQUIRED_ACTION_STEPS
);

export function isCalibrationDemoRequiredActionStep(stepId: CalibrationDemoStepId): boolean {
  return REQUIRED_ACTION_STEP_SET.has(stepId);
}

export interface CalibrationDemoStep {
  id: CalibrationDemoStepId;
  targetId: string | null;
  title: string;
  body: string;
}

export const CALIBRATION_DEMO_STEPS = [
  {
    id: 'purpose',
    targetId: null,
    title: 'What calibration is for',
    body: 'Calibration documents how each model version was configured: which behavioural parameters were fitted to model outcomes, what values were selected, and which measured, policy-set, technical, or postulated assumptions supply the rest of the model.'
  },
  {
    id: 'primary-model',
    targetId: CALIBRATION_DEMO_TARGETS.primaryModel,
    title: 'Inspect one model',
    body: 'With Compare off, the Primary model determines every section below. Choose a version here to inspect its behavioural fit, five fitted values, other assumptions, and evidence on its own. You do not need to change it for this walkthrough.'
  },
  {
    id: 'compare',
    targetId: CALIBRATION_DEMO_TARGETS.compareToggle,
    title: 'Compare two configurations',
    body: 'Turn on Compare to enable Model 2. This changes the sections below from one configuration to a side-by-side view; it does not run a simulation.'
  },
  {
    id: 'comparison-model',
    targetId: CALIBRATION_DEMO_TARGETS.comparisonModel,
    title: 'Choose a comparison model',
    body: 'Choose a Model 2 different from the Primary model. Calibration will compare both the fitted behavioural values and the remaining assumptions. The walkthrough waits until the selected pair is fully loaded before continuing.'
  },
  {
    id: 'behavioural-origin',
    targetId: CALIBRATION_DEMO_TARGETS.behaviouralOrigin,
    title: 'Trace the behavioural fit',
    body: 'Open this section to see where Model 1’s five behavioural values came from. It shows whether they were refitted, originally published, inherited, or lack a detailed record. In comparison mode it still describes only the Primary model; a notice flags different fit-evidence years.'
  },
  {
    id: 'fitted-parameters',
    targetId: CALIBRATION_DEMO_TARGETS.fittedParameters,
    title: 'Understand the five fitted behaviours',
    body: 'This section is open by default because it contains five latent decision parameters: two rent-versus-buy settings, two buy-to-let settings, and market-price memory. In comparison mode its header counts changes, and each row shows both values, their difference, and the tested range.'
  },
  {
    id: 'representative-parameter',
    targetId: null,
    title: 'Inspect one fitted parameter',
    body: 'Open the highlighted parameter. The closed row gives Model 1 and Model 2 values, their absolute difference, and the tested range. The detail explains behavioural meaning, why calibration is needed, and the likely effect of increasing or decreasing it.'
  },
  {
    id: 'other-assumptions',
    targetId: CALIBRATION_DEMO_TARGETS.otherAssumptions,
    title: 'Open the other model assumptions',
    body: 'Open Other model assumptions. These inputs sit outside the five fitted behaviours. They may be empirically estimated, postulated, policy-set, technical/user-set, or output-calibrated; the table records their values and evidence. In comparison mode the section summary counts changed assumptions.'
  },
  {
    id: 'assumption-group',
    targetId: null,
    title: 'Browse assumptions by system',
    body: 'The disclosures organise assumptions into Household Demographics & Wealth; Government & Tax; Housing & Rental Market; Purchase & Mortgage; Bank & Credit Policy; and BTL & Investor Behavior. Open the highlighted group to continue.'
  },
  {
    id: 'assumption-row',
    targetId: null,
    title: 'Read an assumption row',
    body: 'Each row shows the assumption and configuration key, Model 1 and Model 2 values, derivation basis, and source evidence. Changed or Unchanged marks a comparison. Distribution and curve rows offer View heatmap, View distribution, or View chart for a full visualisation.'
  }
] as const satisfies readonly CalibrationDemoStep[];

export const CALIBRATION_DEMO_COMPLETION = {
  title: 'Calibration walkthrough complete',
  body: 'You compared two model configurations, traced the Primary model’s behavioural fit, inspected one fitted parameter, and learned how the remaining assumptions record values, derivation, and evidence. Continue to Validation to test model outputs against independent UK evidence.'
} as const;

export interface CalibrationDemoRuntimeState {
  primaryVersion: string;
  comparisonVersion: string;
  isCompareChecked: boolean;
  requestedPrimaryVersion: string;
  requestedComparisonVersion: string;
  completedPrimaryVersion: string;
  completedComparisonVersion: string;
  overviewPrimaryVersion: string;
  overviewComparisonVersion: string;
  compareResponsePrimaryVersion: string;
  compareResponseComparisonVersion: string;
  isComparisonLoading: boolean;
  isComparisonWaiting: boolean;
  comparisonError: string;
  hasAtLeastTwoModels: boolean;
  isBehaviouralOriginOpen: boolean;
  isFittedParametersOpen: boolean;
  representativeParameterKey: string;
  isRepresentativeParameterOpen: boolean;
  hasOtherAssumptions: boolean;
  isOtherAssumptionsOpen: boolean;
  representativeAssumptionGroupId: string;
  isRepresentativeAssumptionGroupOpen: boolean;
  representativeAssumptionId: string;
}

export interface CalibrationDemoProgress {
  version: 1;
  stepId: CalibrationDemoStepId;
  primaryVersion: string;
  isCompareChecked: boolean;
  comparisonVersion: string;
  isBehaviouralOriginOpen: boolean;
  isFittedParametersOpen: boolean;
  representativeParameterKey: string;
  isRepresentativeParameterOpen: boolean;
  isOtherAssumptionsOpen: boolean;
  representativeAssumptionGroupId: string;
  isRepresentativeAssumptionGroupOpen: boolean;
  representativeAssumptionId: string;
}

export function isCalibrationComparisonReady(state: CalibrationDemoRuntimeState): boolean {
  return Boolean(
    state.isCompareChecked &&
      state.requestedPrimaryVersion &&
      state.requestedComparisonVersion &&
      state.requestedPrimaryVersion !== state.requestedComparisonVersion &&
      state.primaryVersion === state.requestedPrimaryVersion &&
      state.comparisonVersion === state.requestedComparisonVersion &&
      state.completedPrimaryVersion === state.requestedPrimaryVersion &&
      state.completedComparisonVersion === state.requestedComparisonVersion &&
      state.overviewPrimaryVersion === state.requestedPrimaryVersion &&
      state.overviewComparisonVersion === state.requestedComparisonVersion &&
      state.compareResponsePrimaryVersion === state.requestedPrimaryVersion &&
      state.compareResponseComparisonVersion === state.requestedComparisonVersion &&
      !state.isComparisonLoading &&
      !state.isComparisonWaiting &&
      !state.comparisonError
  );
}

export function isCalibrationDemoStepComplete(
  stepId: CalibrationDemoStepId,
  state: CalibrationDemoRuntimeState
): boolean {
  switch (stepId) {
    case 'compare':
      return state.isCompareChecked;
    case 'comparison-model':
      return isCalibrationComparisonReady(state);
    case 'behavioural-origin':
      return state.isBehaviouralOriginOpen;
    case 'fitted-parameters':
      return !state.representativeParameterKey || state.isFittedParametersOpen;
    case 'representative-parameter':
      return !state.representativeParameterKey || state.isRepresentativeParameterOpen;
    case 'other-assumptions':
      return !state.hasOtherAssumptions || state.isOtherAssumptionsOpen;
    case 'assumption-group':
      return !state.representativeAssumptionGroupId || state.isRepresentativeAssumptionGroupOpen;
    default:
      return true;
  }
}

export function shouldAutoAdvanceCalibrationDemoStep({
  stepId,
  isSameStepVisit,
  sawIncompleteDuringVisit,
  isComplete,
  advancePendingOrHandled
}: {
  stepId: CalibrationDemoStepId;
  isSameStepVisit: boolean;
  sawIncompleteDuringVisit: boolean;
  isComplete: boolean;
  advancePendingOrHandled: boolean;
}): boolean {
  return Boolean(
    isCalibrationDemoRequiredActionStep(stepId) &&
      isSameStepVisit &&
      sawIncompleteDuringVisit &&
      isComplete &&
      !advancePendingOrHandled
  );
}

function isStepId(value: unknown): value is CalibrationDemoStepId {
  return typeof value === 'string' && CALIBRATION_DEMO_STEPS.some((step) => step.id === value);
}

export function readCalibrationDemoProgress(
  storageKey = MODEL_EVIDENCE_CALIBRATION_SESSION_KEY
): CalibrationDemoProgress | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CalibrationDemoProgress>;
    if (value.version !== 1 || !isStepId(value.stepId)) return null;
    return {
      version: 1,
      stepId: value.stepId,
      primaryVersion: typeof value.primaryVersion === 'string' ? value.primaryVersion : '',
      isCompareChecked: value.isCompareChecked === true,
      comparisonVersion: typeof value.comparisonVersion === 'string' ? value.comparisonVersion : '',
      isBehaviouralOriginOpen: value.isBehaviouralOriginOpen === true,
      isFittedParametersOpen: value.isFittedParametersOpen !== false,
      representativeParameterKey: typeof value.representativeParameterKey === 'string'
        ? value.representativeParameterKey
        : '',
      isRepresentativeParameterOpen: value.isRepresentativeParameterOpen === true,
      isOtherAssumptionsOpen: value.isOtherAssumptionsOpen === true,
      representativeAssumptionGroupId: typeof value.representativeAssumptionGroupId === 'string'
        ? value.representativeAssumptionGroupId
        : '',
      isRepresentativeAssumptionGroupOpen: value.isRepresentativeAssumptionGroupOpen === true,
      representativeAssumptionId: typeof value.representativeAssumptionId === 'string'
        ? value.representativeAssumptionId
        : ''
    };
  } catch {
    return null;
  }
}

export function writeCalibrationDemoProgress(
  progress: CalibrationDemoProgress,
  storageKey = MODEL_EVIDENCE_CALIBRATION_SESSION_KEY
): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(progress));
  } catch {
    // The active walkthrough remains usable without persistence.
  }
}

export function clearCalibrationDemoProgress(
  storageKey = MODEL_EVIDENCE_CALIBRATION_SESSION_KEY
): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Completion is still valid when storage is unavailable.
  }
}

export function resolveCalibrationDemoResumeStep(
  savedStepId: CalibrationDemoStepId,
  state: CalibrationDemoRuntimeState
): CalibrationDemoStepId {
  const savedIndex = CALIBRATION_DEMO_STEPS.findIndex((step) => step.id === savedStepId);
  const desiredIndex = savedIndex >= 0 ? savedIndex : 0;
  if (desiredIndex >= 3 && !state.isCompareChecked) return 'compare';
  if (desiredIndex >= 4 && !isCalibrationComparisonReady(state)) return 'comparison-model';
  if (desiredIndex >= 5 && !state.isBehaviouralOriginOpen) return 'behavioural-origin';
  if (desiredIndex >= 6 && state.representativeParameterKey && !state.isFittedParametersOpen) {
    return 'fitted-parameters';
  }
  if (desiredIndex >= 7 && state.representativeParameterKey && !state.isRepresentativeParameterOpen) {
    return 'representative-parameter';
  }
  if (desiredIndex >= 8 && state.hasOtherAssumptions && !state.isOtherAssumptionsOpen) {
    return 'other-assumptions';
  }
  if (
    desiredIndex >= 9 &&
    state.representativeAssumptionGroupId &&
    !state.isRepresentativeAssumptionGroupOpen
  ) {
    return 'assumption-group';
  }
  return CALIBRATION_DEMO_STEPS[desiredIndex]?.id ?? 'purpose';
}

interface CalibrationDemoPrototypeProps extends CalibrationDemoRuntimeState {
  active: boolean;
  ready: boolean;
  startComplete: boolean;
  journeyId: string;
  initialLoading: boolean;
  initialWaiting: boolean;
  initialError: string;
  onRetryLoad: () => void;
  onRetryComparison: () => void;
  onPause: () => void;
  onContinueToValidation: () => void;
  onExitToHome: () => void;
}

type TargetState = 'not-required' | 'locating' | 'ready' | 'missing';

interface SpotlightGeometry {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}

interface AutoAdvanceSnapshot {
  stepId: CalibrationDemoStepId | null;
  stepIndex: number;
  isComplete: boolean;
  active: boolean;
  walkthroughComplete: boolean;
}

const TARGET_PADDING = 10;
const NARROW_COACH_BREAKPOINT = 720;
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function measureSpotlight(target: HTMLElement): SpotlightGeometry {
  const bounds = target.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const left = clamp(bounds.left - TARGET_PADDING, 0, viewportWidth);
  const top = clamp(bounds.top - TARGET_PADDING, 0, viewportHeight);
  const right = clamp(bounds.right + TARGET_PADDING, 0, viewportWidth);
  const bottom = clamp(bounds.bottom + TARGET_PADDING, 0, viewportHeight);
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    viewportWidth,
    viewportHeight
  };
}

function buildScrimStyles(spotlight: SpotlightGeometry | null): CSSProperties[] {
  if (!spotlight) return [{ inset: 0 }];
  return [
    { left: 0, top: 0, width: spotlight.viewportWidth, height: spotlight.top },
    { left: 0, top: spotlight.top, width: spotlight.left, height: spotlight.height },
    {
      left: spotlight.right,
      top: spotlight.top,
      width: Math.max(0, spotlight.viewportWidth - spotlight.right),
      height: spotlight.height
    },
    {
      left: 0,
      top: spotlight.bottom,
      width: spotlight.viewportWidth,
      height: Math.max(0, spotlight.viewportHeight - spotlight.bottom)
    }
  ];
}

function buildCoachPosition(
  spotlight: SpotlightGeometry,
  coachSize: { width: number; height: number }
): CSSProperties {
  const margin = 16;
  const gap = 22;
  const width = Math.min(coachSize.width || 420, spotlight.viewportWidth - margin * 2);
  const height = Math.min(coachSize.height || 300, spotlight.viewportHeight - margin * 2);
  const top = clamp(spotlight.top, margin, spotlight.viewportHeight - height - margin);
  if (spotlight.viewportWidth - spotlight.right >= width + gap + margin) {
    return { left: spotlight.right + gap, top };
  }
  if (spotlight.left >= width + gap + margin) {
    return { left: spotlight.left - width - gap, top };
  }
  const left = clamp((spotlight.viewportWidth - width) / 2, margin, spotlight.viewportWidth - width - margin);
  if (spotlight.viewportHeight - spotlight.bottom >= height + gap + margin) {
    return { left, top: spotlight.bottom + gap };
  }
  if (spotlight.top >= height + gap + margin) {
    return { left, top: spotlight.top - height - gap };
  }
  return {
    left: spotlight.left > spotlight.viewportWidth / 2 ? margin : spotlight.viewportWidth - width - margin,
    top: margin
  };
}

function visibleFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  const elements: HTMLElement[] = [];
  if (root.matches(FOCUSABLE_SELECTOR)) elements.push(root);
  elements.push(...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return elements.filter(
    (element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true'
  );
}

function resolveTargetId(step: CalibrationDemoStep | null, state: CalibrationDemoRuntimeState): string | null {
  if (!step) return null;
  if (step.id === 'fitted-parameters' && !state.representativeParameterKey) return null;
  if (step.id === 'representative-parameter') {
    return state.representativeParameterKey
      ? calibrationDemoParameterTargetId(state.representativeParameterKey)
      : null;
  }
  if (step.id === 'other-assumptions' && !state.hasOtherAssumptions) return null;
  if (step.id === 'assumption-group') {
    return state.representativeAssumptionGroupId
      ? calibrationDemoAssumptionGroupTargetId(state.representativeAssumptionGroupId)
      : null;
  }
  if (step.id === 'assumption-row') {
    return state.representativeAssumptionId
      ? calibrationDemoAssumptionTargetId(state.representativeAssumptionId)
      : null;
  }
  return step.targetId;
}

function findTarget(targetId: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-calibration-demo-target]'))
    .find((element) => element.dataset.calibrationDemoTarget === targetId) ?? null;
}

function focusTargetControl(stepId: CalibrationDemoStepId, target: HTMLElement): HTMLElement | null {
  if (stepId === 'compare') return target.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (stepId === 'comparison-model') {
    return target.querySelector<HTMLInputElement>('input[value="v4.26"]:not([disabled])')
      ?? target.querySelector<HTMLInputElement>('input[type="radio"]:checked:not([disabled])')
      ?? target.querySelector<HTMLInputElement>('input[type="radio"]:not([disabled])');
  }
  if (
    stepId === 'behavioural-origin' ||
    stepId === 'fitted-parameters' ||
    stepId === 'representative-parameter' ||
    stepId === 'other-assumptions' ||
    stepId === 'assumption-group'
  ) {
    return target.matches(FOCUSABLE_SELECTOR) ? target : visibleFocusableElements(target)[0] ?? null;
  }
  return null;
}

function actionMessage(stepId: CalibrationDemoStepId, state: CalibrationDemoRuntimeState): {
  message: string;
  tone?: 'complete' | 'waiting' | 'error';
} | null {
  switch (stepId) {
    case 'compare':
      if (!state.hasAtLeastTwoModels) {
        return { message: 'At least two usable models are required for this comparison.', tone: 'error' };
      }
      return state.isCompareChecked
        ? { message: 'Compare is on.', tone: 'complete' }
        : { message: 'Required: turn on Compare.' };
    case 'comparison-model':
      if (state.comparisonError) return { message: state.comparisonError, tone: 'error' };
      if (state.isComparisonLoading || state.isComparisonWaiting) {
        return { message: 'Loading the selected calibration comparison…', tone: 'waiting' };
      }
      return isCalibrationComparisonReady(state)
        ? { message: 'The selected model pair is ready.', tone: 'complete' }
        : { message: 'Required: choose an available model other than Model 1.' };
    case 'behavioural-origin':
      return state.isBehaviouralOriginOpen
        ? { message: 'The behavioural-fit section is open.', tone: 'complete' }
        : { message: 'Required: open the behavioural-fit section.' };
    case 'fitted-parameters':
      if (!state.representativeParameterKey) {
        return { message: 'No fitted parameters are available for this model. Continue to the next explanation.' };
      }
      return state.isFittedParametersOpen
        ? { message: 'The fitted-parameter section is open.', tone: 'complete' }
        : { message: 'Required: reopen the fitted-parameter section.' };
    case 'representative-parameter':
      if (!state.representativeParameterKey) {
        return { message: 'No fitted parameter detail is available. Continue to the remaining assumptions.' };
      }
      return state.isRepresentativeParameterOpen
        ? { message: 'The highlighted fitted parameter is open.', tone: 'complete' }
        : { message: 'Required: open the highlighted fitted parameter.' };
    case 'other-assumptions':
      if (!state.hasOtherAssumptions) {
        return { message: 'No other assumptions are available for this model pair. Continue to finish Calibration.' };
      }
      return state.isOtherAssumptionsOpen
        ? { message: 'Other model assumptions are open.', tone: 'complete' }
        : { message: 'Required: open Other model assumptions.' };
    case 'assumption-group':
      if (!state.representativeAssumptionGroupId) {
        return { message: 'No populated assumption group is available. Continue to the final explanation.' };
      }
      return state.isRepresentativeAssumptionGroupOpen
        ? { message: 'The highlighted assumption group is open.', tone: 'complete' }
        : { message: 'Required: open the highlighted assumption group.' };
    default:
      return null;
  }
}

function createProgress(
  stepId: CalibrationDemoStepId,
  state: CalibrationDemoRuntimeState
): CalibrationDemoProgress {
  return {
    version: 1,
    stepId,
    primaryVersion: state.primaryVersion,
    isCompareChecked: state.isCompareChecked,
    comparisonVersion: state.comparisonVersion,
    isBehaviouralOriginOpen: state.isBehaviouralOriginOpen,
    isFittedParametersOpen: state.isFittedParametersOpen,
    representativeParameterKey: state.representativeParameterKey,
    isRepresentativeParameterOpen: state.isRepresentativeParameterOpen,
    isOtherAssumptionsOpen: state.isOtherAssumptionsOpen,
    representativeAssumptionGroupId: state.representativeAssumptionGroupId,
    isRepresentativeAssumptionGroupOpen: state.isRepresentativeAssumptionGroupOpen,
    representativeAssumptionId: state.representativeAssumptionId
  };
}

export function CalibrationDemoPrototype(props: CalibrationDemoPrototypeProps) {
  const {
    active,
    ready,
    startComplete,
    journeyId,
    initialLoading,
    initialWaiting,
    initialError,
    onRetryLoad,
    onRetryComparison,
    onPause,
    onContinueToValidation,
    onExitToHome
  } = props;
  const runtimeState = useMemo<CalibrationDemoRuntimeState>(() => ({
    primaryVersion: props.primaryVersion,
    comparisonVersion: props.comparisonVersion,
    isCompareChecked: props.isCompareChecked,
    requestedPrimaryVersion: props.requestedPrimaryVersion,
    requestedComparisonVersion: props.requestedComparisonVersion,
    completedPrimaryVersion: props.completedPrimaryVersion,
    completedComparisonVersion: props.completedComparisonVersion,
    overviewPrimaryVersion: props.overviewPrimaryVersion,
    overviewComparisonVersion: props.overviewComparisonVersion,
    compareResponsePrimaryVersion: props.compareResponsePrimaryVersion,
    compareResponseComparisonVersion: props.compareResponseComparisonVersion,
    isComparisonLoading: props.isComparisonLoading,
    isComparisonWaiting: props.isComparisonWaiting,
    comparisonError: props.comparisonError,
    hasAtLeastTwoModels: props.hasAtLeastTwoModels,
    isBehaviouralOriginOpen: props.isBehaviouralOriginOpen,
    isFittedParametersOpen: props.isFittedParametersOpen,
    representativeParameterKey: props.representativeParameterKey,
    isRepresentativeParameterOpen: props.isRepresentativeParameterOpen,
    hasOtherAssumptions: props.hasOtherAssumptions,
    isOtherAssumptionsOpen: props.isOtherAssumptionsOpen,
    representativeAssumptionGroupId: props.representativeAssumptionGroupId,
    isRepresentativeAssumptionGroupOpen: props.isRepresentativeAssumptionGroupOpen,
    representativeAssumptionId: props.representativeAssumptionId
  }), [props]);
  const [stepIndex, setStepIndex] = useState(0);
  const [walkthroughComplete, setWalkthroughComplete] = useState(startComplete);
  const [isResumed, setIsResumed] = useState(false);
  const [targetState, setTargetState] = useState<TargetState>('not-required');
  const [spotlight, setSpotlight] = useState<SpotlightGeometry | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [coachSize, setCoachSize] = useState({ width: 420, height: 300 });
  const coachRef = useRef<HTMLElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const initializedRef = useRef(false);
  const pendingResumeStepRef = useRef<CalibrationDemoStepId | null>(null);
  const observedStepRef = useRef<CalibrationDemoStepId | null>(null);
  const sawIncompleteRef = useRef(false);
  const autoAdvanceFrameRef = useRef<number | null>(null);
  const autoAdvanceHandledRef = useRef(false);
  const visitRef = useRef(0);
  const completionAnnouncedRef = useRef(startComplete);
  const latestSnapshotRef = useRef<AutoAdvanceSnapshot>({
    stepId: null,
    stepIndex: 0,
    isComplete: false,
    active: false,
    walkthroughComplete: false
  });

  const currentStep = ready && !walkthroughComplete
    ? CALIBRATION_DEMO_STEPS[stepIndex] ?? CALIBRATION_DEMO_STEPS[0]
    : null;
  const isStepComplete = currentStep
    ? isCalibrationDemoStepComplete(currentStep.id, runtimeState)
    : true;
  const resolvedTargetId = resolveTargetId(currentStep, runtimeState);
  const isRequiredAction = currentStep
    ? isCalibrationDemoRequiredActionStep(currentStep.id)
    : false;
  const currentActionMessage = currentStep ? actionMessage(currentStep.id, runtimeState) : null;
  latestSnapshotRef.current = {
    stepId: currentStep?.id ?? null,
    stepIndex,
    isComplete: isStepComplete,
    active,
    walkthroughComplete
  };

  useEffect(() => {
    if (!active) {
      initializedRef.current = false;
      return;
    }
    if (startComplete) {
      initializedRef.current = true;
      completionAnnouncedRef.current = true;
      setWalkthroughComplete(true);
      return;
    }
    if (!ready || initializedRef.current) return;
    const saved = readCalibrationDemoProgress();
    const resumeStepId = saved
      ? resolveCalibrationDemoResumeStep(saved.stepId, runtimeState)
      : 'purpose';
    const resumeIndex = CALIBRATION_DEMO_STEPS.findIndex((step) => step.id === resumeStepId);
    setStepIndex(Math.max(0, resumeIndex));
    setWalkthroughComplete(false);
    setIsResumed(Boolean(saved && resumeStepId !== 'purpose'));
    setRetryCount(0);
    completionAnnouncedRef.current = false;
    pendingResumeStepRef.current = resumeStepId;
    initializedRef.current = true;
  }, [active, ready, runtimeState, startComplete]);

  useEffect(() => {
    if (!active || !ready || !currentStep || walkthroughComplete || !initializedRef.current) return;
    if (pendingResumeStepRef.current) {
      if (pendingResumeStepRef.current !== currentStep.id) return;
      pendingResumeStepRef.current = null;
      return;
    }
    writeCalibrationDemoProgress(createProgress(currentStep.id, runtimeState));
  }, [active, currentStep, ready, runtimeState, walkthroughComplete]);

  useEffect(() => {
    if (!active) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      const previousFocus = previousFocusRef.current;
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
    };
  }, [active]);

  useEffect(() => {
    if (!active || !coachRef.current || typeof ResizeObserver === 'undefined') return;
    const coach = coachRef.current;
    const update = () => {
      const bounds = coach.getBoundingClientRect();
      setCoachSize({ width: bounds.width, height: bounds.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(coach);
    return () => observer.disconnect();
  }, [active, currentStep?.id, targetState, walkthroughComplete]);

  const updateSpotlight = useCallback(() => {
    if (!targetRef.current) {
      setSpotlight(null);
      return;
    }
    setSpotlight(measureSpotlight(targetRef.current));
  }, []);

  useEffect(() => {
    if (!active || !ready || walkthroughComplete) {
      targetRef.current = null;
      setSpotlight(null);
      setTargetState('not-required');
      return;
    }
    if (!currentStep || !resolvedTargetId) {
      targetRef.current = null;
      setSpotlight(null);
      setTargetState('not-required');
      const frame = window.requestAnimationFrame(() => primaryActionRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }

    let cancelled = false;
    let focusFrame = 0;
    let observer: ResizeObserver | null = null;
    setTargetState('locating');
    setSpotlight(null);
    targetRef.current = null;
    const locateFrame = window.requestAnimationFrame(() => {
      const target = findTarget(resolvedTargetId);
      if (cancelled) return;
      setTargetState(target ? 'ready' : 'missing');
      if (!target) {
        focusFrame = window.requestAnimationFrame(() => primaryActionRef.current?.focus());
        return;
      }
      targetRef.current = target;
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: window.innerWidth <= NARROW_COACH_BREAKPOINT ? 'start' : 'center',
        inline: 'center'
      });
      const measureFrame = () => {
        if (cancelled) return;
        if (window.innerWidth <= NARROW_COACH_BREAKPOINT && coachRef.current) {
          const targetBounds = target.getBoundingClientRect();
          const coachBounds = coachRef.current.getBoundingClientRect();
          const availableBottom = window.innerHeight - coachBounds.height - 24;
          if (targetBounds.bottom > availableBottom && targetBounds.height < availableBottom - 16) {
            window.scrollBy({
              top: targetBounds.bottom - availableBottom,
              behavior: reducedMotion ? 'auto' : 'smooth'
            });
          }
        }
        updateSpotlight();
        const control = focusTargetControl(currentStep.id, target);
        if (control) control.focus({ preventScroll: true });
        else primaryActionRef.current?.focus({ preventScroll: true });
      };
      focusFrame = window.requestAnimationFrame(measureFrame);
      window.addEventListener('resize', updateSpotlight);
      window.addEventListener('scroll', updateSpotlight, true);
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(updateSpotlight);
        observer.observe(target);
      }
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(locateFrame);
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('resize', updateSpotlight);
      window.removeEventListener('scroll', updateSpotlight, true);
      observer?.disconnect();
      targetRef.current = null;
    };
  }, [active, currentStep, ready, resolvedTargetId, retryCount, updateSpotlight, walkthroughComplete]);

  useEffect(() => {
    if (!active || targetState !== 'ready') return;
    const frame = window.requestAnimationFrame(updateSpotlight);
    return () => window.cancelAnimationFrame(frame);
  }, [active, isStepComplete, runtimeState, targetState, updateSpotlight]);

  const persistCurrentStep = useCallback(() => {
    if (!currentStep) return;
    writeCalibrationDemoProgress(createProgress(currentStep.id, runtimeState));
  }, [currentStep, runtimeState]);

  const pauseWalkthrough = useCallback(() => {
    persistCurrentStep();
    onPause();
  }, [onPause, persistCurrentStep]);

  const goToStep = useCallback((nextStepIndex: number) => {
    targetRef.current = null;
    setSpotlight(null);
    setTargetState(nextStepIndex === 0 ? 'not-required' : 'locating');
    setStepIndex(nextStepIndex);
  }, []);

  const showCompletion = useCallback(() => {
    targetRef.current = null;
    setSpotlight(null);
    setTargetState('not-required');
    clearCalibrationDemoProgress();
    if (!completionAnnouncedRef.current) {
      completionAnnouncedRef.current = true;
      window.dispatchEvent(new CustomEvent(MODEL_EVIDENCE_CALIBRATION_COMPLETION_EVENT, {
        detail: {
          demo: MODEL_EVIDENCE_DEMO_QUERY_VALUE,
          journeyId,
          phase: 'calibration',
          primaryVersion: runtimeState.primaryVersion,
          comparisonVersion: runtimeState.comparisonVersion
        }
      }));
    }
    setWalkthroughComplete(true);
  }, [journeyId, runtimeState.comparisonVersion, runtimeState.primaryVersion]);

  useEffect(() => {
    const cancelPending = () => {
      if (autoAdvanceFrameRef.current === null) return;
      window.cancelAnimationFrame(autoAdvanceFrameRef.current);
      autoAdvanceFrameRef.current = null;
    };
    if (!active || !ready || !currentStep || walkthroughComplete) {
      cancelPending();
      observedStepRef.current = null;
      sawIncompleteRef.current = false;
      autoAdvanceHandledRef.current = false;
      return;
    }
    const sameVisit = observedStepRef.current === currentStep.id;
    if (!sameVisit) {
      cancelPending();
      observedStepRef.current = currentStep.id;
      sawIncompleteRef.current = !isStepComplete;
      autoAdvanceHandledRef.current = false;
      visitRef.current += 1;
      return;
    }
    if (!isStepComplete) {
      cancelPending();
      sawIncompleteRef.current = true;
      return;
    }
    if (!shouldAutoAdvanceCalibrationDemoStep({
      stepId: currentStep.id,
      isSameStepVisit: sameVisit,
      sawIncompleteDuringVisit: sawIncompleteRef.current,
      isComplete: isStepComplete,
      advancePendingOrHandled:
        autoAdvanceFrameRef.current !== null || autoAdvanceHandledRef.current
    })) return;

    const scheduledStepId = currentStep.id;
    const scheduledStepIndex = stepIndex;
    const scheduledVisit = visitRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (autoAdvanceFrameRef.current !== frame) return;
      autoAdvanceFrameRef.current = null;
      const latest = latestSnapshotRef.current;
      if (
        autoAdvanceHandledRef.current ||
        visitRef.current !== scheduledVisit ||
        latest.stepId !== scheduledStepId ||
        latest.stepIndex !== scheduledStepIndex ||
        !latest.active ||
        latest.walkthroughComplete ||
        !latest.isComplete
      ) return;
      autoAdvanceHandledRef.current = true;
      goToStep(scheduledStepIndex + 1);
    });
    autoAdvanceFrameRef.current = frame;
    return () => {
      if (autoAdvanceFrameRef.current !== frame) return;
      window.cancelAnimationFrame(frame);
      autoAdvanceFrameRef.current = null;
    };
  }, [active, currentStep, goToStep, isStepComplete, ready, stepIndex, walkthroughComplete]);

  useEffect(() => {
    if (!active) return;
    const allowedFocusElements = () => {
      const targetElements = targetState === 'ready' ? visibleFocusableElements(targetRef.current) : [];
      return [...targetElements, ...visibleFocusableElements(coachRef.current)];
    };
    const preferredFocus = () => {
      if (currentStep && targetState === 'ready' && targetRef.current) {
        return focusTargetControl(currentStep.id, targetRef.current) ?? primaryActionRef.current;
      }
      return primaryActionRef.current;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.repeat) {
        event.preventDefault();
        if (window.confirm('Pause the Model evidence demo and keep your progress for this tab?')) {
          pauseWalkthrough();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const allowed = allowedFocusElements();
      if (allowed.length === 0) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const currentIndex = allowed.findIndex((element) => element === document.activeElement);
      const nextIndex = event.shiftKey
        ? currentIndex <= 0 ? allowed.length - 1 : currentIndex - 1
        : currentIndex < 0 || currentIndex === allowed.length - 1 ? 0 : currentIndex + 1;
      allowed[nextIndex]?.focus();
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (allowedFocusElements().includes(event.target)) return;
      preferredFocus()?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', handleFocusIn, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', handleFocusIn, true);
    };
  }, [active, currentStep, pauseWalkthrough, targetState]);

  if (!active) return null;

  const scrimStyles = buildScrimStyles(targetState === 'ready' ? spotlight : null);
  const scrimKinds = scrimStyles.length === 1 ? ['full'] : ['top', 'left', 'right', 'bottom'];
  const narrowTarget = Boolean(resolvedTargetId && spotlight && spotlight.viewportWidth <= NARROW_COACH_BREAKPOINT);
  const coachPosition = resolvedTargetId && spotlight && !narrowTarget
    ? buildCoachPosition(spotlight, coachSize)
    : undefined;
  const announcement = walkthroughComplete
    ? CALIBRATION_DEMO_COMPLETION.title
    : currentStep
      ? `Model evidence demo, Calibration, Part 1 of 2, step ${stepIndex + 1} of ${CALIBRATION_DEMO_STEPS.length}: ${currentStep.title}`
      : initialError ? 'Calibration walkthrough could not be loaded' : 'Loading Calibration walkthrough';

  return <div
    className="validation-demo-layer calibration-demo-layer"
    data-calibration-demo-state={walkthroughComplete ? 'complete' : currentStep?.id ?? 'loading'}
  >
    {scrimStyles.map((style, index) => <div
      className={`validation-demo-scrim is-${scrimKinds[index]}`}
      style={style}
      role="presentation"
      key={scrimKinds[index]}
    />)}
    {targetState === 'ready' && spotlight && <div
      className="validation-demo-spotlight"
      style={{ left: spotlight.left, top: spotlight.top, width: spotlight.width, height: spotlight.height }}
      aria-hidden="true"
    />}
    <p className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</p>
    <section
      ref={coachRef}
      className={`validation-demo-coach${narrowTarget ? ' is-bottom-sheet' : ''}${!resolvedTargetId || targetState !== 'ready' ? ' is-centred' : ''}`}
      style={coachPosition}
      role="dialog"
      aria-labelledby="calibration-demo-coach-title"
      aria-describedby="calibration-demo-coach-body"
      aria-busy={initialLoading || initialWaiting || (currentStep?.id === 'comparison-model' && props.isComparisonLoading) ? 'true' : undefined}
    >
      {!ready && !walkthroughComplete ? <>
        <p className="validation-demo-progress">Model evidence demo · Calibration · Part 1 of 2</p>
        <h2 id="calibration-demo-coach-title">
          {initialError ? 'Calibration could not be loaded' : 'Preparing the Calibration walkthrough'}
        </h2>
        <p id="calibration-demo-coach-body">
          {initialError
            ? `The Calibration evidence is not ready: ${initialError}`
            : initialWaiting
              ? 'Waiting for the API. The page will retry automatically.'
              : 'Loading model versions, parameter evidence, and the selected configuration.'}
        </p>
        <div className="validation-demo-actions">
          {initialError && <button ref={primaryActionRef} type="button" className="primary-button" onClick={onRetryLoad}>Retry</button>}
          <button ref={initialError ? undefined : primaryActionRef} type="button" className="secondary-button" onClick={pauseWalkthrough}>Pause demo</button>
          <button type="button" className="secondary-button" onClick={onExitToHome}>Exit to Home</button>
        </div>
      </> : targetState === 'missing' && currentStep ? <>
        <p className="validation-demo-progress">Model evidence demo · Calibration · step unavailable</p>
        <h2 id="calibration-demo-coach-title">This demo step isn’t ready</h2>
        <p id="calibration-demo-coach-body">The highlighted Calibration control could not be found. Retry after the page has finished loading.</p>
        <div className="validation-demo-actions">
          <button ref={primaryActionRef} type="button" className="primary-button" onClick={() => setRetryCount((current) => current + 1)}>Retry</button>
          <button type="button" className="secondary-button" onClick={pauseWalkthrough}>Pause demo</button>
          <button type="button" className="secondary-button" onClick={onExitToHome}>Exit to Home</button>
        </div>
      </> : walkthroughComplete ? <>
        <p className="validation-demo-progress">Model evidence demo · Calibration · Part 1 of 2</p>
        <h2 id="calibration-demo-coach-title">{CALIBRATION_DEMO_COMPLETION.title}</h2>
        <p id="calibration-demo-coach-body">{CALIBRATION_DEMO_COMPLETION.body}</p>
        <div className="validation-demo-actions">
          <button ref={primaryActionRef} type="button" className="primary-button" onClick={onContinueToValidation}>Continue to Validation demo</button>
          <button type="button" className="secondary-button" onClick={() => {
            setWalkthroughComplete(false);
            goToStep(CALIBRATION_DEMO_STEPS.length - 1);
          }}>Back</button>
          <button type="button" className="secondary-button" onClick={pauseWalkthrough}>Pause demo</button>
          <button type="button" className="secondary-button" onClick={onExitToHome}>Exit to Home</button>
        </div>
      </> : currentStep ? <>
        <p className="validation-demo-progress">
          Model evidence demo · Calibration · Part 1 of 2{isResumed ? ' · resumed' : ''} · step {stepIndex + 1} of {CALIBRATION_DEMO_STEPS.length}
        </p>
        <h2 id="calibration-demo-coach-title">{currentStep.title}</h2>
        <p id="calibration-demo-coach-body">{currentStep.body}</p>
        {currentStep.id === 'behavioural-origin' && <p className="validation-demo-supporting-note">
          Technical campaign details contain optimiser settings, artifact paths, and source records; availability depends on the selected model.
        </p>}
        {currentActionMessage && <p
          className={`validation-demo-action-state${currentActionMessage.tone ? ` is-${currentActionMessage.tone}` : ''}`}
          aria-live="polite"
        >{currentActionMessage.message}</p>}
        <div className="validation-demo-actions">
          {currentStep.id !== 'purpose' && <button type="button" className="secondary-button" onClick={() => goToStep(Math.max(0, stepIndex - 1))}>Back</button>}
          {currentStep.id === 'purpose' ? <button ref={primaryActionRef} type="button" className="primary-button" onClick={() => goToStep(1)}>Start demo</button> : <button
            ref={primaryActionRef}
            type="button"
            className="primary-button"
            disabled={!isStepComplete}
            onClick={() => {
              if (stepIndex === CALIBRATION_DEMO_STEPS.length - 1) showCompletion();
              else goToStep(stepIndex + 1);
            }}
          >{isRequiredAction ? 'Continue' : 'Next'}</button>}
          {currentStep.id === 'comparison-model' && props.comparisonError && <button type="button" className="secondary-button" onClick={onRetryComparison}>Retry comparison</button>}
          <button type="button" className="secondary-button" onClick={pauseWalkthrough}>Pause demo</button>
          <button type="button" className="secondary-button" onClick={onExitToHome}>Exit to Home</button>
        </div>
      </> : null}
    </section>
  </div>;
}
