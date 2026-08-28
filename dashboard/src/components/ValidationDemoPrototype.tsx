import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

export const VALIDATION_DEMO_QUERY_VALUE = 'validation';
export const VALIDATION_DEMO_SESSION_KEY = 'validation-demo-progress-v1';
export const VALIDATION_DEMO_COMPLETION_EVENT = 'validation-demo:complete';

export const VALIDATION_DEMO_TARGETS = {
  primaryModel: 'validation-primary-model',
  compareToggle: 'validation-compare-toggle',
  statusLegend: 'validation-status-legend',
  sortModels: 'validation-sort-models',
  comparisonModel: 'validation-comparison-model',
  comparisonResults: 'validation-comparison-results',
  summaryCard: 'validation-summary-card',
  outcomeComparisons: 'validation-outcome-comparisons',
  representativeTheme: 'validation-representative-theme',
  representativeMetric: 'validation-representative-metric',
  sourcesAndProvenance: 'validation-sources-and-provenance',
  methodology: 'validation-methodology'
} as const;

export function validationDemoThemeTargetId(themeId: string): string {
  return `validation-theme-${themeId}`;
}

export function validationDemoMetricTargetId(metricId: string): string {
  return `validation-metric-${metricId}`;
}

export function validationDemoProvenanceTargetId(metricId: string): string {
  return `validation-provenance-${metricId}`;
}

export type ValidationDemoStepId =
  | 'purpose'
  | 'primary-model'
  | 'compare'
  | 'status-legend'
  | 'sort-models'
  | 'comparison-model'
  | 'comparison-results'
  | 'summary-card'
  | 'outcome-comparisons'
  | 'themes'
  | 'representative-metric'
  | 'sources-and-provenance'
  | 'methodology';

export const VALIDATION_DEMO_REQUIRED_ACTION_STEPS = [
  'compare',
  'sort-models',
  'comparison-model',
  'summary-card',
  'outcome-comparisons',
  'themes',
  'representative-metric',
  'sources-and-provenance',
  'methodology'
] as const satisfies readonly ValidationDemoStepId[];

const VALIDATION_DEMO_REQUIRED_ACTION_STEP_SET = new Set<ValidationDemoStepId>(
  VALIDATION_DEMO_REQUIRED_ACTION_STEPS
);

export function isValidationDemoRequiredActionStep(stepId: ValidationDemoStepId): boolean {
  return VALIDATION_DEMO_REQUIRED_ACTION_STEP_SET.has(stepId);
}

export interface ValidationDemoAutoAdvanceGuard {
  stepId: ValidationDemoStepId;
  isSameStepVisit: boolean;
  sawIncompleteDuringVisit: boolean;
  isComplete: boolean;
  advancePendingOrHandled: boolean;
}

export function shouldAutoAdvanceValidationDemoStep({
  stepId,
  isSameStepVisit,
  sawIncompleteDuringVisit,
  isComplete,
  advancePendingOrHandled
}: ValidationDemoAutoAdvanceGuard): boolean {
  return Boolean(
    isValidationDemoRequiredActionStep(stepId) &&
      isSameStepVisit &&
      sawIncompleteDuringVisit &&
      isComplete &&
      !advancePendingOrHandled
  );
}

export interface ValidationDemoStep {
  id: ValidationDemoStepId;
  targetId: (typeof VALIDATION_DEMO_TARGETS)[keyof typeof VALIDATION_DEMO_TARGETS] | null;
  title: string;
  body: string;
}

export const VALIDATION_DEMO_STEPS = [
  {
    id: 'purpose',
    targetId: null,
    title: 'What validation is for',
    body: 'Validation checks whether a model reproduces independent UK housing evidence. Use this page to see which outcomes pass, warn, or fail, how consistent they are across random seeds, and whether one model version performs better than another.'
  },
  {
    id: 'primary-model',
    targetId: VALIDATION_DEMO_TARGETS.primaryModel,
    title: 'Inspect one model',
    body: 'With Compare off, the Primary model controls every result below. Choose a model here when you want to assess that version on its own.'
  },
  {
    id: 'compare',
    targetId: VALIDATION_DEMO_TARGETS.compareToggle,
    title: 'Compare two models',
    body: 'Turn on Compare to enable Model 2. Both versions are tested against the same evidence, so their results can be read side by side.'
  },
  {
    id: 'status-legend',
    targetId: VALIDATION_DEMO_TARGETS.statusLegend,
    title: 'Read pass, warn, and fail',
    body: 'Pass, warn, and fail combine two tests: how close the seed mean is to the target band, and how consistently ten fixed seeds land inside it. A close average can still warn when runs are unsteady.'
  },
  {
    id: 'sort-models',
    targetId: VALIDATION_DEMO_TARGETS.sortModels,
    title: 'Sort models by evidence fit',
    body: 'Choose a metric to reorder both model lists by absolute distance from its empirical target. This makes the closest-fitting model for one outcome easy to find; it does not rank overall validation quality.'
  },
  {
    id: 'comparison-model',
    targetId: VALIDATION_DEMO_TARGETS.comparisonModel,
    title: 'Choose a comparison model',
    body: 'Choose a Model 2 that is different from the primary model. The tour waits for that model’s comparison summary, so the side-by-side evidence below always matches your request.'
  },
  {
    id: 'comparison-results',
    targetId: VALIDATION_DEMO_TARGETS.comparisonResults,
    title: 'Read the side-by-side results',
    body: 'Results now pair Model 1 with Model 2. Scorecards, theme bars, and metric rows show both versions. Validation tells you which version fits the evidence better; Calibration explains why their parameter settings differ.'
  },
  {
    id: 'summary-card',
    targetId: VALIDATION_DEMO_TARGETS.summaryCard,
    title: 'Open the summary card',
    body: 'Open the Summary card. It brings together comparative validation loss, pass, warn, and fail counts, consistency across seeds, where error is concentrated, and the largest gaps or model differences. Gap buttons jump to a metric, but you do not need to use them now.'
  },
  {
    id: 'outcome-comparisons',
    targetId: VALIDATION_DEMO_TARGETS.outcomeComparisons,
    title: 'Open outcome comparisons',
    body: 'Open Outcome comparisons to read each result against its empirical target and target band. Rows show the simulated mean, how many seeds land in band, status, and loss for each model.'
  },
  {
    id: 'themes',
    targetId: VALIDATION_DEMO_TARGETS.representativeTheme,
    title: 'Explore the five evidence themes',
    body: 'The disclosures cover Market activity and lending; Credit and affordability; Prices and cycles; Tenure and rental market; and Distributional realism. The last compares distribution shape and loss because it has no single scalar target. Open the highlighted representative theme.'
  },
  {
    id: 'representative-metric',
    targetId: VALIDATION_DEMO_TARGETS.representativeMetric,
    title: 'Inspect a representative metric',
    body: 'Select Details for this representative metric. The table shows its target and band, simulated mean and IQR, seeds in band, status and loss; the detail panel adds the loss family and source provenance.'
  },
  {
    id: 'sources-and-provenance',
    targetId: VALIDATION_DEMO_TARGETS.sourcesAndProvenance,
    title: 'Check sources and provenance',
    body: 'Open Sources and provenance. This audit trail identifies the empirical source and references, the loss or additive scales used for scoring, and any notes that explain how the target band was set.'
  },
  {
    id: 'methodology',
    targetId: VALIDATION_DEMO_TARGETS.methodology,
    title: 'Review the validation method',
    body: 'Open Validation methodology for the fixed protocol, evidence, status rules, and loss calculation. Comparative validation loss helps rank fit; it is not a probability, confidence interval, or hypothesis-test statistic.'
  }
] as const satisfies readonly ValidationDemoStep[];

export const VALIDATION_DEMO_COMPLETION = {
  title: 'Validation walkthrough complete',
  body: 'You compared two model versions and traced the evidence from headline scores through a representative metric’s sources and scoring method.'
} as const;

const DEFAULT_VALIDATION_COMPLETION_DETAIL = { demo: VALIDATION_DEMO_QUERY_VALUE } as const;

export interface ValidationDemoRuntimeState {
  primaryVersion: string;
  isCompareChecked: boolean;
  sortMetricId: string;
  requestedComparisonVersion: string;
  loadedComparisonVersion: string;
  isComparisonLoading: boolean;
  comparisonError: string;
  isSummaryOpen: boolean;
  isOutcomeComparisonsOpen: boolean;
  isRepresentativeThemeOpen: boolean;
  isRepresentativeMetricOpen: boolean;
  isRepresentativeProvenanceOpen: boolean;
  isMethodologyOpen: boolean;
}

export interface ValidationDemoProgress {
  version: 1;
  stepId: ValidationDemoStepId;
  primaryVersion: string;
  isCompareChecked: boolean;
  sortMetricId: string;
  comparisonVersion: string;
  isSummaryOpen: boolean;
  isOutcomeComparisonsOpen: boolean;
  representativeThemeId: string;
  isRepresentativeThemeOpen: boolean;
  representativeMetricId: string;
  isRepresentativeMetricOpen: boolean;
  isRepresentativeProvenanceOpen: boolean;
  isMethodologyOpen: boolean;
}

export type ValidationDemoTargetState = 'not-required' | 'locating' | 'ready' | 'missing';

export function isValidationDemoRequested(searchParams: URLSearchParams): boolean {
  return searchParams.get('demo') === VALIDATION_DEMO_QUERY_VALUE;
}

export function isValidationComparisonReady(state: ValidationDemoRuntimeState): boolean {
  return Boolean(
    state.requestedComparisonVersion &&
      state.requestedComparisonVersion !== state.primaryVersion &&
      state.loadedComparisonVersion === state.requestedComparisonVersion &&
      !state.isComparisonLoading &&
      !state.comparisonError
  );
}

export function isValidationDemoStepComplete(
  stepId: ValidationDemoStepId,
  state: ValidationDemoRuntimeState
): boolean {
  switch (stepId) {
    case 'compare':
      return state.isCompareChecked;
    case 'sort-models':
      return Boolean(state.sortMetricId);
    case 'comparison-model':
    case 'comparison-results':
      return isValidationComparisonReady(state);
    case 'summary-card':
      return state.isSummaryOpen;
    case 'outcome-comparisons':
      return state.isOutcomeComparisonsOpen;
    case 'themes':
      return state.isRepresentativeThemeOpen;
    case 'representative-metric':
      return state.isRepresentativeMetricOpen;
    case 'sources-and-provenance':
      return state.isRepresentativeProvenanceOpen;
    case 'methodology':
      return state.isMethodologyOpen;
    default:
      return true;
  }
}

export function getValidationDemoTargetState(
  step: ValidationDemoStep,
  target: Element | null
): ValidationDemoTargetState {
  if (!step.targetId) return 'not-required';
  return target ? 'ready' : 'missing';
}

export function resolveValidationDemoResumeStep(
  savedStepId: ValidationDemoStepId,
  state: ValidationDemoRuntimeState
): ValidationDemoStepId {
  const savedIndex = VALIDATION_DEMO_STEPS.findIndex((step) => step.id === savedStepId);
  const desiredIndex = savedIndex >= 0 ? savedIndex : 0;

  if (desiredIndex >= 3 && !state.isCompareChecked) return 'compare';
  if (desiredIndex >= 5 && !state.sortMetricId) return 'sort-models';
  if (desiredIndex >= 6 && !isValidationComparisonReady(state)) return 'comparison-model';
  if (desiredIndex >= 8 && !state.isSummaryOpen) return 'summary-card';
  if (desiredIndex >= 9 && !state.isOutcomeComparisonsOpen) return 'outcome-comparisons';
  if (desiredIndex >= 10 && !state.isRepresentativeThemeOpen) return 'themes';
  if (desiredIndex >= 11 && !state.isRepresentativeMetricOpen) return 'representative-metric';
  if (desiredIndex >= 12 && !state.isRepresentativeProvenanceOpen) return 'sources-and-provenance';
  return VALIDATION_DEMO_STEPS[desiredIndex]?.id ?? 'purpose';
}

function isStepId(value: unknown): value is ValidationDemoStepId {
  return typeof value === 'string' && VALIDATION_DEMO_STEPS.some((step) => step.id === value);
}

export function readValidationDemoProgress(
  storageKey = VALIDATION_DEMO_SESSION_KEY
): ValidationDemoProgress | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ValidationDemoProgress>;
    if (value.version !== 1 || !isStepId(value.stepId)) return null;
    return {
      version: 1,
      stepId: value.stepId,
      primaryVersion: typeof value.primaryVersion === 'string' ? value.primaryVersion : '',
      isCompareChecked: value.isCompareChecked === true,
      sortMetricId: typeof value.sortMetricId === 'string' ? value.sortMetricId : '',
      comparisonVersion: typeof value.comparisonVersion === 'string' ? value.comparisonVersion : '',
      isSummaryOpen: value.isSummaryOpen === true,
      isOutcomeComparisonsOpen: value.isOutcomeComparisonsOpen === true,
      representativeThemeId: typeof value.representativeThemeId === 'string' ? value.representativeThemeId : '',
      isRepresentativeThemeOpen: value.isRepresentativeThemeOpen === true,
      representativeMetricId: typeof value.representativeMetricId === 'string' ? value.representativeMetricId : '',
      isRepresentativeMetricOpen: value.isRepresentativeMetricOpen === true,
      isRepresentativeProvenanceOpen: value.isRepresentativeProvenanceOpen === true,
      isMethodologyOpen: value.isMethodologyOpen === true
    };
  } catch {
    return null;
  }
}

function writeValidationDemoProgress(
  progress: ValidationDemoProgress,
  storageKey = VALIDATION_DEMO_SESSION_KEY
): void {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(progress));
  } catch {
    // The walkthrough remains usable when storage is blocked or full.
  }
}

export function clearValidationDemoProgress(storageKey = VALIDATION_DEMO_SESSION_KEY): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Finishing the walkthrough must not fail because storage is unavailable.
  }
}

interface ValidationDemoPrototypeProps extends ValidationDemoRuntimeState {
  active: boolean;
  ready: boolean;
  progressStorageKey?: string;
  startComplete?: boolean;
  progressLabel?: string;
  announcementLabel?: string;
  numberStepsInProgressLabel?: boolean;
  completion?: { title: string; body: string };
  completionEventName?: string;
  completionEventDetail?: Record<string, unknown>;
  purposeBackLabel?: string;
  onPurposeBack?: () => void;
  finishLabel?: string;
  pauseLabel?: string;
  pausePrompt?: string;
  representativeThemeId: string;
  representativeMetricId: string;
  onRetryComparison: () => void;
  onPause: () => void;
  onFinish: () => void;
  onExitToHome: () => void;
}

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

interface ElementSize {
  width: number;
  height: number;
}

interface DemoActionState {
  complete: boolean;
  message: string;
  tone?: 'complete' | 'waiting' | 'error';
}

interface AutoAdvanceSnapshot {
  stepId: ValidationDemoStepId | null;
  stepIndex: number;
  isComplete: boolean;
  isVisible: boolean;
  isWalkthroughComplete: boolean;
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
  coachSize: ElementSize
): CSSProperties {
  const margin = 16;
  const gap = 22;
  const width = Math.min(coachSize.width || 420, spotlight.viewportWidth - margin * 2);
  const height = Math.min(coachSize.height || 300, spotlight.viewportHeight - margin * 2);
  const topAlongTarget = clamp(spotlight.top, margin, spotlight.viewportHeight - height - margin);

  if (spotlight.viewportWidth - spotlight.right >= width + gap + margin) {
    return { left: spotlight.right + gap, top: topAlongTarget };
  }

  if (spotlight.left >= width + gap + margin) {
    return { left: spotlight.left - width - gap, top: topAlongTarget };
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

function findTarget(targetId: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-validation-demo-target]'))
    .find((element) => element.dataset.validationDemoTarget === targetId) ?? null;
}

function resolveTargetId(
  step: ValidationDemoStep | null,
  representativeThemeId: string,
  representativeMetricId: string
): string | null {
  if (!step?.targetId) return null;
  if (step.id === 'themes') return validationDemoThemeTargetId(representativeThemeId);
  if (step.id === 'representative-metric') return validationDemoMetricTargetId(representativeMetricId);
  if (step.id === 'sources-and-provenance') return validationDemoProvenanceTargetId(representativeMetricId);
  return step.targetId;
}

function focusTargetControl(stepId: ValidationDemoStepId, target: HTMLElement): HTMLElement | null {
  if (stepId === 'compare') return target.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (stepId === 'sort-models') return target.querySelector<HTMLSelectElement>('select');
  if (stepId === 'comparison-model') {
    return target.querySelector<HTMLInputElement>('input[type="radio"]:checked:not([disabled])')
      ?? target.querySelector<HTMLInputElement>('input[type="radio"]:not([disabled])');
  }
  if (
    stepId === 'summary-card' ||
    stepId === 'outcome-comparisons' ||
    stepId === 'themes' ||
    stepId === 'representative-metric' ||
    stepId === 'sources-and-provenance' ||
    stepId === 'methodology'
  ) {
    return target.matches(FOCUSABLE_SELECTOR) ? target : visibleFocusableElements(target)[0] ?? null;
  }
  return null;
}

function actionStateForStep(
  stepId: ValidationDemoStepId,
  state: ValidationDemoRuntimeState
): DemoActionState | null {
  switch (stepId) {
    case 'compare':
      return state.isCompareChecked
        ? { complete: true, message: 'Compare is on.', tone: 'complete' }
        : { complete: false, message: 'Required: turn on Compare.' };
    case 'sort-models':
      return state.sortMetricId
        ? { complete: true, message: 'The model choices are now ranked by the selected metric.', tone: 'complete' }
        : { complete: false, message: 'Required: choose any metric from Sort models by.' };
    case 'comparison-model':
      if (state.comparisonError) {
        return { complete: false, message: state.comparisonError, tone: 'error' };
      }
      if (state.isComparisonLoading || (
        state.requestedComparisonVersion && state.loadedComparisonVersion !== state.requestedComparisonVersion
      )) {
        return { complete: false, message: 'Loading the matching comparison summary…', tone: 'waiting' };
      }
      return isValidationComparisonReady(state)
        ? { complete: true, message: 'The requested comparison results are ready.', tone: 'complete' }
        : { complete: false, message: 'Required: choose an available model other than the primary model.' };
    case 'comparison-results':
      return isValidationComparisonReady(state)
        ? null
        : { complete: false, message: 'The comparison changed. Return to Model 2 and wait for matching results.' };
    case 'summary-card':
      return state.isSummaryOpen
        ? { complete: true, message: 'Summary card is open.', tone: 'complete' }
        : { complete: false, message: 'Required: open the real Summary card disclosure.' };
    case 'outcome-comparisons':
      return state.isOutcomeComparisonsOpen
        ? { complete: true, message: 'Outcome comparisons are open.', tone: 'complete' }
        : { complete: false, message: 'Required: open the real Outcome comparisons disclosure.' };
    case 'themes':
      return state.isRepresentativeThemeOpen
        ? { complete: true, message: 'The representative theme is open.', tone: 'complete' }
        : { complete: false, message: 'Required: open the highlighted theme disclosure.' };
    case 'representative-metric':
      return state.isRepresentativeMetricOpen
        ? { complete: true, message: 'The metric detail is open.', tone: 'complete' }
        : { complete: false, message: 'Required: select Details for the highlighted metric.' };
    case 'sources-and-provenance':
      return state.isRepresentativeProvenanceOpen
        ? { complete: true, message: 'Sources and provenance are open.', tone: 'complete' }
        : { complete: false, message: 'Required: open Sources and provenance.' };
    case 'methodology':
      return state.isMethodologyOpen
        ? { complete: true, message: 'Validation methodology is open.', tone: 'complete' }
        : { complete: false, message: 'Required: open the real Validation methodology disclosure.' };
    default:
      return null;
  }
}

function createProgress(
  stepId: ValidationDemoStepId,
  state: ValidationDemoRuntimeState,
  representativeThemeId: string,
  representativeMetricId: string
): ValidationDemoProgress {
  return {
    version: 1,
    stepId,
    primaryVersion: state.primaryVersion,
    isCompareChecked: state.isCompareChecked,
    sortMetricId: state.sortMetricId,
    comparisonVersion: state.requestedComparisonVersion,
    isSummaryOpen: state.isSummaryOpen,
    isOutcomeComparisonsOpen: state.isOutcomeComparisonsOpen,
    representativeThemeId,
    isRepresentativeThemeOpen: state.isRepresentativeThemeOpen,
    representativeMetricId,
    isRepresentativeMetricOpen: state.isRepresentativeMetricOpen,
    isRepresentativeProvenanceOpen: state.isRepresentativeProvenanceOpen,
    isMethodologyOpen: state.isMethodologyOpen
  };
}

export function ValidationDemoPrototype({
  active,
  ready,
  progressStorageKey = VALIDATION_DEMO_SESSION_KEY,
  startComplete = false,
  progressLabel = 'Validation demo',
  announcementLabel = 'Validation demo',
  numberStepsInProgressLabel = false,
  completion = VALIDATION_DEMO_COMPLETION,
  completionEventName = VALIDATION_DEMO_COMPLETION_EVENT,
  completionEventDetail = DEFAULT_VALIDATION_COMPLETION_DETAIL,
  purposeBackLabel,
  onPurposeBack,
  finishLabel = 'Finish and inspect page',
  pauseLabel = 'Exit demo',
  pausePrompt = 'Pause the Validation demo and keep your progress for this tab?',
  primaryVersion,
  isCompareChecked,
  sortMetricId,
  requestedComparisonVersion,
  loadedComparisonVersion,
  isComparisonLoading,
  comparisonError,
  isSummaryOpen,
  isOutcomeComparisonsOpen,
  representativeThemeId,
  isRepresentativeThemeOpen,
  representativeMetricId,
  isRepresentativeMetricOpen,
  isRepresentativeProvenanceOpen,
  isMethodologyOpen,
  onRetryComparison,
  onPause,
  onFinish,
  onExitToHome
}: ValidationDemoPrototypeProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [isWalkthroughComplete, setIsWalkthroughComplete] = useState(startComplete);
  const [isResumed, setIsResumed] = useState(false);
  const [targetState, setTargetState] = useState<ValidationDemoTargetState>('not-required');
  const [spotlight, setSpotlight] = useState<SpotlightGeometry | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [coachSize, setCoachSize] = useState<ElementSize>({ width: 420, height: 300 });
  const coachRef = useRef<HTMLElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const observedAutoAdvanceStepRef = useRef<ValidationDemoStepId | null>(null);
  const sawIncompleteDuringVisitRef = useRef(false);
  const autoAdvanceFrameRef = useRef<number | null>(null);
  const autoAdvanceHandledRef = useRef(false);
  const autoAdvanceVisitRef = useRef(0);
  const latestAutoAdvanceSnapshotRef = useRef<AutoAdvanceSnapshot>({
    stepId: null,
    stepIndex: 0,
    isComplete: false,
    isVisible: false,
    isWalkthroughComplete: false
  });
  const wasVisibleRef = useRef(false);
  const pendingResumeStepRef = useRef<ValidationDemoStepId | null>(null);
  const completionAnnouncedRef = useRef(startComplete);

  const runtimeState = useMemo<ValidationDemoRuntimeState>(() => ({
    primaryVersion,
    isCompareChecked,
    sortMetricId,
    requestedComparisonVersion,
    loadedComparisonVersion,
    isComparisonLoading,
    comparisonError,
    isSummaryOpen,
    isOutcomeComparisonsOpen,
    isRepresentativeThemeOpen,
    isRepresentativeMetricOpen,
    isRepresentativeProvenanceOpen,
    isMethodologyOpen
  }), [
    comparisonError,
    isCompareChecked,
    isComparisonLoading,
    isMethodologyOpen,
    isOutcomeComparisonsOpen,
    isRepresentativeMetricOpen,
    isRepresentativeProvenanceOpen,
    isRepresentativeThemeOpen,
    isSummaryOpen,
    loadedComparisonVersion,
    primaryVersion,
    requestedComparisonVersion,
    sortMetricId
  ]);

  const currentStep = isWalkthroughComplete ? null : VALIDATION_DEMO_STEPS[stepIndex] ?? VALIDATION_DEMO_STEPS[0];
  const resolvedTargetId = resolveTargetId(currentStep, representativeThemeId, representativeMetricId);
  const isVisible = active && ready;
  const isStepComplete = currentStep ? isValidationDemoStepComplete(currentStep.id, runtimeState) : true;
  const stepActionState = currentStep ? actionStateForStep(currentStep.id, runtimeState) : null;
  const isRequiredActionStep = currentStep
    ? isValidationDemoRequiredActionStep(currentStep.id)
    : false;
  latestAutoAdvanceSnapshotRef.current = {
    stepId: currentStep?.id ?? null,
    stepIndex,
    isComplete: isStepComplete,
    isVisible,
    isWalkthroughComplete
  };

  const updateSpotlight = useCallback(() => {
    const target = targetRef.current;
    if (!target) {
      setSpotlight(null);
      return;
    }
    setSpotlight(measureSpotlight(target));
  }, []);

  useEffect(() => {
    if (isVisible && !wasVisibleRef.current) {
      const saved = startComplete ? null : readValidationDemoProgress(progressStorageKey);
      const resumeStepId = saved ? resolveValidationDemoResumeStep(saved.stepId, runtimeState) : 'purpose';
      const resumeIndex = VALIDATION_DEMO_STEPS.findIndex((step) => step.id === resumeStepId);
      setStepIndex(Math.max(0, resumeIndex));
      setIsWalkthroughComplete(startComplete);
      setIsResumed(Boolean(!startComplete && saved && resumeStepId !== 'purpose'));
      setRetryCount(0);
      completionAnnouncedRef.current = startComplete;
      pendingResumeStepRef.current = startComplete ? null : resumeStepId;
    }
    wasVisibleRef.current = isVisible;
  }, [isVisible, progressStorageKey, runtimeState, startComplete]);

  useEffect(() => {
    if (!isVisible || !currentStep || isWalkthroughComplete) return;
    if (pendingResumeStepRef.current) {
      if (currentStep.id !== pendingResumeStepRef.current) return;
      pendingResumeStepRef.current = null;
      return;
    }
    writeValidationDemoProgress(
      createProgress(currentStep.id, runtimeState, representativeThemeId, representativeMetricId),
      progressStorageKey
    );
  }, [
    currentStep,
    isVisible,
    isWalkthroughComplete,
    representativeMetricId,
    representativeThemeId,
    runtimeState,
    progressStorageKey
  ]);

  useEffect(() => {
    if (!isVisible) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      const previousFocus = previousFocusRef.current;
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
    };
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible || !coachRef.current || typeof ResizeObserver === 'undefined') return;

    const coach = coachRef.current;
    const updateCoachSize = () => {
      const bounds = coach.getBoundingClientRect();
      setCoachSize({ width: bounds.width, height: bounds.height });
    };
    updateCoachSize();
    const observer = new ResizeObserver(updateCoachSize);
    observer.observe(coach);
    return () => observer.disconnect();
  }, [currentStep?.id, isWalkthroughComplete, isVisible, targetState]);

  useEffect(() => {
    if (!isVisible) {
      targetRef.current = null;
      setSpotlight(null);
      setTargetState('not-required');
      return;
    }

    if (!currentStep || !resolvedTargetId) {
      targetRef.current = null;
      setSpotlight(null);
      setTargetState('not-required');
      const focusFrame = window.requestAnimationFrame(() => primaryActionRef.current?.focus());
      return () => window.cancelAnimationFrame(focusFrame);
    }

    let cancelled = false;
    let focusFrame = 0;
    let resizeObserver: ResizeObserver | null = null;
    setTargetState('locating');
    setSpotlight(null);
    targetRef.current = null;

    const locateFrame = window.requestAnimationFrame(() => {
      const target = findTarget(resolvedTargetId);
      if (cancelled) return;

      const nextTargetState = getValidationDemoTargetState(currentStep, target);
      setTargetState(nextTargetState);
      if (!target) {
        focusFrame = window.requestAnimationFrame(() => primaryActionRef.current?.focus());
        return;
      }

      targetRef.current = target;
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: window.innerWidth <= NARROW_COACH_BREAKPOINT ? 'start' : 'center',
        inline: 'center'
      });

      const measureAfterScroll = () => {
        if (cancelled) return;
        if (window.innerWidth <= NARROW_COACH_BREAKPOINT && coachRef.current) {
          const targetBounds = target.getBoundingClientRect();
          const coachBounds = coachRef.current.getBoundingClientRect();
          const availableBottom = window.innerHeight - coachBounds.height - 24;
          if (targetBounds.bottom > availableBottom && targetBounds.height < availableBottom - 16) {
            window.scrollBy({
              top: targetBounds.bottom - availableBottom,
              behavior: prefersReducedMotion ? 'auto' : 'smooth'
            });
          }
        }
        updateSpotlight();
        const targetControl = focusTargetControl(currentStep.id, target);
        if (targetControl) targetControl.focus({ preventScroll: true });
        else primaryActionRef.current?.focus({ preventScroll: true });
      };

      focusFrame = window.requestAnimationFrame(measureAfterScroll);
      window.addEventListener('resize', updateSpotlight);
      window.addEventListener('scroll', updateSpotlight, true);
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(updateSpotlight);
        resizeObserver.observe(target);
      }
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(locateFrame);
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('resize', updateSpotlight);
      window.removeEventListener('scroll', updateSpotlight, true);
      resizeObserver?.disconnect();
      targetRef.current = null;
    };
  }, [currentStep, isVisible, resolvedTargetId, retryCount, updateSpotlight]);

  useEffect(() => {
    if (!isVisible || targetState !== 'ready') return;
    const frame = window.requestAnimationFrame(updateSpotlight);
    return () => window.cancelAnimationFrame(frame);
  }, [isCompareChecked, isStepComplete, isVisible, targetState, updateSpotlight]);

  const persistCurrentStep = useCallback(() => {
    if (!currentStep) return;
    writeValidationDemoProgress(
      createProgress(currentStep.id, runtimeState, representativeThemeId, representativeMetricId),
      progressStorageKey
    );
  }, [currentStep, progressStorageKey, representativeMetricId, representativeThemeId, runtimeState]);

  const pauseWalkthrough = useCallback(() => {
    persistCurrentStep();
    onPause();
  }, [onPause, persistCurrentStep]);

  const returnToPreviousPart = useCallback(() => {
    persistCurrentStep();
    onPurposeBack?.();
  }, [onPurposeBack, persistCurrentStep]);

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
    clearValidationDemoProgress(progressStorageKey);
    if (!completionAnnouncedRef.current) {
      completionAnnouncedRef.current = true;
      window.dispatchEvent(new CustomEvent(completionEventName, {
        detail: completionEventDetail
      }));
    }
    setIsWalkthroughComplete(true);
  }, [completionEventDetail, completionEventName, progressStorageKey]);

  useEffect(() => {
    const cancelPendingAdvance = () => {
      if (autoAdvanceFrameRef.current === null) return;
      window.cancelAnimationFrame(autoAdvanceFrameRef.current);
      autoAdvanceFrameRef.current = null;
    };

    if (!isVisible || !currentStep || isWalkthroughComplete) {
      cancelPendingAdvance();
      observedAutoAdvanceStepRef.current = null;
      sawIncompleteDuringVisitRef.current = false;
      autoAdvanceHandledRef.current = false;
      return;
    }

    const isSameStepVisit = observedAutoAdvanceStepRef.current === currentStep.id;
    if (!isSameStepVisit) {
      cancelPendingAdvance();
      observedAutoAdvanceStepRef.current = currentStep.id;
      sawIncompleteDuringVisitRef.current = !isStepComplete;
      autoAdvanceHandledRef.current = false;
      autoAdvanceVisitRef.current += 1;
      return;
    }

    if (!isStepComplete) {
      cancelPendingAdvance();
      sawIncompleteDuringVisitRef.current = true;
      return;
    }

    if (!shouldAutoAdvanceValidationDemoStep({
      stepId: currentStep.id,
      isSameStepVisit,
      sawIncompleteDuringVisit: sawIncompleteDuringVisitRef.current,
      isComplete: isStepComplete,
      advancePendingOrHandled:
        autoAdvanceFrameRef.current !== null || autoAdvanceHandledRef.current
    })) {
      return;
    }

    const scheduledStepId = currentStep.id;
    const scheduledStepIndex = stepIndex;
    const scheduledVisit = autoAdvanceVisitRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (autoAdvanceFrameRef.current !== frame) return;
      autoAdvanceFrameRef.current = null;

      const latest = latestAutoAdvanceSnapshotRef.current;
      if (
        autoAdvanceHandledRef.current ||
        autoAdvanceVisitRef.current !== scheduledVisit ||
        latest.stepId !== scheduledStepId ||
        latest.stepIndex !== scheduledStepIndex ||
        !latest.isVisible ||
        latest.isWalkthroughComplete ||
        !latest.isComplete
      ) {
        return;
      }

      autoAdvanceHandledRef.current = true;
      if (scheduledStepIndex === VALIDATION_DEMO_STEPS.length - 1) showCompletion();
      else goToStep(scheduledStepIndex + 1);
    });
    autoAdvanceFrameRef.current = frame;

    return () => {
      if (autoAdvanceFrameRef.current !== frame) return;
      window.cancelAnimationFrame(frame);
      autoAdvanceFrameRef.current = null;
    };
  }, [
    currentStep,
    goToStep,
    isStepComplete,
    isVisible,
    isWalkthroughComplete,
    showCompletion,
    stepIndex
  ]);

  useEffect(() => {
    if (!isVisible) return;

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
        if (window.confirm(pausePrompt)) pauseWalkthrough();
        return;
      }

      if (event.key !== 'Tab') return;
      const allowed = allowedFocusElements();
      if (allowed.length === 0) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      const activeElement = document.activeElement;
      const currentIndex = allowed.findIndex((element) => element === activeElement);
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
  }, [currentStep, isVisible, pausePrompt, pauseWalkthrough, targetState]);

  const scrimStyles = useMemo(
    () => buildScrimStyles(targetState === 'ready' ? spotlight : null),
    [spotlight, targetState]
  );

  if (!isVisible) return null;

  const isNarrowTargetedStep = Boolean(
    resolvedTargetId && spotlight && spotlight.viewportWidth <= NARROW_COACH_BREAKPOINT
  );
  const coachPosition = resolvedTargetId && spotlight && !isNarrowTargetedStep
    ? buildCoachPosition(spotlight, coachSize)
    : undefined;
  const announcement = isWalkthroughComplete
    ? completion.title
    : currentStep
      ? `${announcementLabel}, step ${stepIndex + 1} of ${VALIDATION_DEMO_STEPS.length}: ${currentStep.title}`
      : announcementLabel;
  const scrimKinds = scrimStyles.length === 1
    ? ['full']
    : ['top', 'left', 'right', 'bottom'];

  return (
    <div
      className="validation-demo-layer"
      data-validation-demo-state={isWalkthroughComplete ? 'complete' : currentStep?.id}
    >
      {scrimStyles.map((style, index) => (
        <div
          className={`validation-demo-scrim is-${scrimKinds[index]}`}
          style={style}
          role="presentation"
          key={scrimKinds[index]}
        />
      ))}
      {targetState === 'ready' && spotlight && (
        <div
          className="validation-demo-spotlight"
          style={{
            left: spotlight.left,
            top: spotlight.top,
            width: spotlight.width,
            height: spotlight.height
          }}
          aria-hidden="true"
        />
      )}

      <p className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</p>
      <section
        ref={coachRef}
        className={`validation-demo-coach${isNarrowTargetedStep ? ' is-bottom-sheet' : ''}${!resolvedTargetId || targetState !== 'ready' ? ' is-centred' : ''}`}
        style={coachPosition}
        role="dialog"
        aria-labelledby="validation-demo-coach-title"
        aria-describedby="validation-demo-coach-body"
        aria-busy={currentStep?.id === 'comparison-model' && isComparisonLoading ? 'true' : undefined}
      >
        {targetState === 'missing' && currentStep ? (
          <>
            <p className="validation-demo-progress">{progressLabel} · step unavailable</p>
            <h2 id="validation-demo-coach-title">This demo step isn’t ready</h2>
            <p id="validation-demo-coach-body">
              The highlighted Validation control could not be found. Retry after the page has finished loading.
            </p>
            <div className="validation-demo-actions">
              <button
                ref={primaryActionRef}
                type="button"
                className="primary-button"
                onClick={() => setRetryCount((current) => current + 1)}
              >
                Retry
              </button>
              <button type="button" className="secondary-button" onClick={pauseWalkthrough}>{pauseLabel}</button>
            </div>
          </>
        ) : isWalkthroughComplete ? (
          <>
            <p className="validation-demo-progress">{progressLabel}</p>
            <h2 id="validation-demo-coach-title">{completion.title}</h2>
            <p id="validation-demo-coach-body">{completion.body}</p>
            <div className="validation-demo-actions">
              <button ref={primaryActionRef} type="button" className="primary-button" onClick={onFinish}>
                {finishLabel}
              </button>
              <button type="button" className="secondary-button" onClick={onExitToHome}>Exit to Home</button>
            </div>
          </>
        ) : currentStep ? (
          <>
            <p className="validation-demo-progress">
              {progressLabel}{isResumed ? ' · resumed' : ''} · {numberStepsInProgressLabel ? 'step ' : ''}{stepIndex + 1} of {VALIDATION_DEMO_STEPS.length}
            </p>
            <h2 id="validation-demo-coach-title">{currentStep.title}</h2>
            <p id="validation-demo-coach-body">{currentStep.body}</p>
            {stepActionState && (
              <p
                className={`validation-demo-action-state${stepActionState.tone ? ` is-${stepActionState.tone}` : ''}`}
                aria-live="polite"
              >
                {stepActionState.message}
              </p>
            )}
            <div className="validation-demo-actions">
              {currentStep.id !== 'purpose' && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => goToStep(Math.max(0, stepIndex - 1))}
                >
                  Back
                </button>
              )}
              {currentStep.id === 'purpose' ? (
                <>
                  <button ref={primaryActionRef} type="button" className="primary-button" onClick={() => goToStep(1)}>
                    Start demo
                  </button>
                  {onPurposeBack && purposeBackLabel && (
                    <button type="button" className="secondary-button" onClick={returnToPreviousPart}>
                      {purposeBackLabel}
                    </button>
                  )}
                </>
              ) : (
                <button
                  ref={primaryActionRef}
                  type="button"
                  className="primary-button"
                  disabled={!isStepComplete}
                  onClick={() => {
                    if (stepIndex === VALIDATION_DEMO_STEPS.length - 1) showCompletion();
                    else goToStep(stepIndex + 1);
                  }}
                >
                  {isRequiredActionStep ? 'Continue' : 'Next'}
                </button>
              )}
              {currentStep.id === 'comparison-model' && comparisonError && (
                <button type="button" className="secondary-button" onClick={onRetryComparison}>
                  Retry comparison
                </button>
              )}
              <button type="button" className="secondary-button" onClick={pauseWalkthrough}>{pauseLabel}</button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
