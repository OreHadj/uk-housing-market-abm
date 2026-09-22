import {
  type CSSProperties,
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type {
  ExperimentDemoChapter,
  ExperimentDemoLaunchMode,
  ExperimentDemoProgressEvent,
  ExperimentDemoStepProgressEvent
} from '../lib/experimentDemo';
import { DemoShading } from './DemoShading';

export type ExperimentDemoStepKind = 'info' | 'action' | 'inspect';

export interface ExperimentDemoStep<StepId extends string = string> {
  id: StepId;
  chapter: ExperimentDemoChapter;
  kind: ExperimentDemoStepKind;
  targetId: string | null;
  title: string;
  body: string;
  wizardStep: number;
  actionHint?: string;
  waitHint?: string;
  alreadyCompleteLabel?: string;
  nextLabel?: string;
  reveals?: string;
  pairedActionId?: StepId;
}

export interface ExperimentDemoActionAdvanceGuard {
  kind: ExperimentDemoStepKind;
  isSameStepVisit: boolean;
  sawIncompleteDuringVisit: boolean;
  isComplete: boolean;
  advancePendingOrHandled: boolean;
}

export interface ExperimentDemoContractViolation {
  stepId: string;
  message: string;
}

export interface ExperimentDemoChapterContext {
  active: boolean;
  paused: boolean;
  journeyId: string;
  draftId: string;
  mode: ExperimentDemoLaunchMode;
  savedStepId: string;
  ready: boolean;
  loading: boolean;
  error: string;
  onRetryLoad: () => void;
  onProgress: (event: ExperimentDemoStepProgressEvent) => void;
  onChapterComplete: (event: ExperimentDemoProgressEvent) => void;
  onContinueToSensitivity: () => void;
  onFinish: () => void;
  onPause: () => void;
  onExit: () => void;
}

export type ExperimentDemoCoordinator = Omit<
  ExperimentDemoChapterContext,
  'ready' | 'loading' | 'error' | 'onRetryLoad'
>;

export function shouldAutoAdvanceExperimentDemoAction({
  kind,
  isSameStepVisit,
  sawIncompleteDuringVisit,
  isComplete,
  advancePendingOrHandled
}: ExperimentDemoActionAdvanceGuard): boolean {
  return Boolean(
    kind === 'action' &&
      isSameStepVisit &&
      sawIncompleteDuringVisit &&
      isComplete &&
      !advancePendingOrHandled
  );
}

/** Semantic checks used by tests and by future chapters that extend the same tour engine. */
export function experimentDemoStepContractViolations(
  steps: readonly ExperimentDemoStep[]
): ExperimentDemoContractViolation[] {
  const violations: ExperimentDemoContractViolation[] = [];
  const targetOwners = new Map<string, string>();

  steps.forEach((step, index) => {
    if (step.targetId) {
      const owner = targetOwners.get(step.targetId);
      // A native Continue control is intentionally reused across wizard pages. Other targets should
      // identify one semantic control/content region each.
      if (owner && !step.targetId.endsWith('-continue')) {
        violations.push({ stepId: step.id, message: `Target ${step.targetId} is also used by ${owner}.` });
      } else {
        targetOwners.set(step.targetId, step.id);
      }
    }
    if (!step.reveals) return;
    const next = steps[index + 1];
    if (!next || next.kind !== 'inspect') {
      violations.push({ stepId: step.id, message: 'A revealing action must be followed by an inspection step.' });
      return;
    }
    if (next.pairedActionId !== step.id) {
      violations.push({ stepId: step.id, message: 'The following inspection step must name its paired action.' });
    }
    if (next.targetId !== step.reveals || next.targetId === step.targetId) {
      violations.push({ stepId: step.id, message: 'Action and revealed-content targets must be distinct.' });
    }
  });
  return violations;
}

interface ExperimentDemoOverlayProps<StepId extends string> {
  active: boolean;
  chapter: ExperimentDemoChapter;
  journeyId: string;
  draftId: string;
  ready: boolean;
  loading: boolean;
  error: string;
  steps: readonly ExperimentDemoStep<StepId>[];
  savedStepId: string;
  fingerprint: string;
  completionStepId: StepId;
  completionPrimaryLabel: string;
  onCompletionPrimary: () => void;
  onRetryLoad: () => void;
  onPause: () => void;
  onExit: () => void;
  onProgress: (event: ExperimentDemoStepProgressEvent) => void;
  onStepEntered: (step: ExperimentDemoStep<StepId>) => void;
  isStepComplete: (step: ExperimentDemoStep<StepId>) => boolean;
  canAdvanceStep?: (step: ExperimentDemoStep<StepId>) => boolean;
  actionError?: string;
  actionErrorTargetId?: string | null;
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

interface AutoAdvanceSnapshot<StepId extends string> {
  stepId: StepId;
  stepIndex: number;
  isComplete: boolean;
  isVisible: boolean;
}

type TargetState = 'not-required' | 'locating' | 'ready' | 'missing';

const TARGET_PADDING = 10;
const NARROW_COACH_BREAKPOINT = 720;
const TARGET_RETRY_MS = 3000;
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]:not([aria-disabled="true"])',
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

function buildCoachPosition(spotlight: SpotlightGeometry, coachSize: ElementSize): CSSProperties {
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
  const left = clamp(
    (spotlight.viewportWidth - width) / 2,
    margin,
    spotlight.viewportWidth - width - margin
  );
  if (spotlight.viewportHeight - spotlight.bottom >= height + gap + margin) {
    return { left, top: spotlight.bottom + gap };
  }
  if (spotlight.top >= height + gap + margin) {
    return { left, top: spotlight.top - height - gap };
  }
  return {
    left: spotlight.left > spotlight.viewportWidth / 2
      ? margin
      : spotlight.viewportWidth - width - margin,
    top: margin
  };
}

function elementIsVisible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden]')) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const bounds = element.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0 && element.getClientRects().length > 0;
}

function visibleFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root || !elementIsVisible(root)) return [];
  const elements: HTMLElement[] = [];
  if (root.matches(FOCUSABLE_SELECTOR) || root.hasAttribute('tabindex')) elements.push(root);
  elements.push(...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return elements.filter(elementIsVisible);
}

function findDemoTarget(targetId: string, layer: HTMLElement | null): HTMLElement | null {
  const modal = layer?.closest<HTMLElement>('.scenario-create-modal') ?? document;
  const matches = Array.from(
    modal.querySelectorAll<HTMLElement>('[data-experiment-demo-target]')
  ).filter((element) => element.dataset.experimentDemoTarget === targetId && elementIsVisible(element));
  return matches.length === 1 ? matches[0] : null;
}

function scrollModalToTarget(
  target: HTMLElement,
  coachHeight: number,
  prefersReducedMotion: boolean
): HTMLElement | null {
  const scrollContainer = target.closest<HTMLElement>('.scenario-create-modal-body');
  if (!scrollContainer) {
    target.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'center',
      inline: 'center'
    });
    return null;
  }

  const targetBounds = target.getBoundingClientRect();
  const containerBounds = scrollContainer.getBoundingClientRect();
  const reservedCoachHeight = window.innerWidth <= NARROW_COACH_BREAKPOINT
    ? Math.min(coachHeight + 28, scrollContainer.clientHeight * 0.48)
    : 0;
  const visibleHeight = Math.max(80, scrollContainer.clientHeight - reservedCoachHeight);
  const desiredTop = containerBounds.top + Math.max(8, (visibleHeight - targetBounds.height) / 2);
  scrollContainer.scrollBy({
    top: targetBounds.top - desiredTop,
    behavior: prefersReducedMotion ? 'auto' : 'smooth'
  });
  return scrollContainer;
}

function focusTargetOrCoach(
  step: ExperimentDemoStep,
  target: HTMLElement,
  primaryActionRef: MutableRefObject<HTMLButtonElement | null>
): void {
  if (step.kind !== 'inspect') {
    const control = visibleFocusableElements(target)[0];
    if (control) {
      control.focus({ preventScroll: true });
      return;
    }
  }
  if (
    (target instanceof HTMLButtonElement || target instanceof HTMLInputElement || target instanceof HTMLSelectElement) &&
    target.disabled
  ) {
    primaryActionRef.current?.focus({ preventScroll: true });
    return;
  }
  if (target.matches('[tabindex], button, input, select, textarea, summary, [href]')) {
    target.focus({ preventScroll: true });
  } else {
    primaryActionRef.current?.focus({ preventScroll: true });
  }
}

export function ExperimentDemoOverlay<StepId extends string>({
  active,
  chapter,
  journeyId,
  draftId,
  ready,
  loading,
  error,
  steps,
  savedStepId,
  fingerprint,
  completionStepId,
  completionPrimaryLabel,
  onCompletionPrimary,
  onRetryLoad,
  onPause,
  onExit,
  onProgress,
  onStepEntered,
  isStepComplete,
  canAdvanceStep = () => true,
  actionError = '',
  actionErrorTargetId = null
}: ExperimentDemoOverlayProps<StepId>) {
  const savedIndex = steps.findIndex((step) => step.id === savedStepId);
  const [stepIndex, setStepIndex] = useState(savedIndex >= 0 ? savedIndex : 0);
  const [targetState, setTargetState] = useState<TargetState>('not-required');
  const [spotlight, setSpotlight] = useState<SpotlightGeometry | null>(null);
  const [coachSize, setCoachSize] = useState<ElementSize>({ width: 0, height: 0 });
  const [retryCount, setRetryCount] = useState(0);
  const [, setActionVisitRevision] = useState(0);
  const layerRef = useRef<HTMLDivElement>(null);
  const coachRef = useRef<HTMLElement>(null);
  const coachSizeRef = useRef<ElementSize>({ width: 0, height: 0 });
  const targetRef = useRef<HTMLElement | null>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const initializedJourneyRef = useRef('');
  const observedStepRef = useRef<StepId | null>(null);
  const sawIncompleteDuringVisitRef = useRef(false);
  const autoAdvanceHandledRef = useRef(false);
  const autoAdvanceFrameRef = useRef<number | null>(null);
  const autoAdvanceVisitRef = useRef(0);
  const currentStep = steps[stepIndex] ?? steps[0];
  const effectiveTargetId = currentStep.kind === 'action' && actionError && actionErrorTargetId
    ? actionErrorTargetId
    : currentStep.targetId;
  const isVisible = active && Boolean(journeyId) && Boolean(draftId);
  const isCurrentStepComplete = isStepComplete(currentStep);
  const canAdvanceCurrentStep = canAdvanceStep(currentStep);
  const latestSnapshotRef = useRef<AutoAdvanceSnapshot<StepId>>({
    stepId: currentStep.id,
    stepIndex,
    isComplete: isCurrentStepComplete,
    isVisible: false
  });
  latestSnapshotRef.current = {
    stepId: currentStep.id,
    stepIndex,
    isComplete: isCurrentStepComplete,
    isVisible: isVisible && ready
  };

  const progressEvent = useCallback((step: ExperimentDemoStep<StepId>): ExperimentDemoStepProgressEvent => ({
    journeyId,
    chapter,
    draftId,
    stepId: step.id,
    fingerprint
  }), [chapter, draftId, fingerprint, journeyId]);

  const goToStep = useCallback((nextIndex: number) => {
    const nextStep = steps[nextIndex];
    if (!nextStep || !draftId || !journeyId) return;
    onProgress(progressEvent(nextStep));
    targetRef.current = null;
    setSpotlight(null);
    setTargetState(nextStep.targetId ? 'locating' : 'not-required');
    setStepIndex(nextIndex);
  }, [draftId, journeyId, onProgress, progressEvent, steps]);

  useEffect(() => {
    if (!isVisible || !ready) return;
    const journeyKey = `${journeyId}:${draftId}`;
    if (initializedJourneyRef.current === journeyKey) return;
    const restoredIndex = steps.findIndex((step) => step.id === savedStepId);
    initializedJourneyRef.current = journeyKey;
    setStepIndex(restoredIndex >= 0 ? restoredIndex : 0);
    if (restoredIndex < 0) onProgress(progressEvent(steps[0]));
  }, [draftId, isVisible, journeyId, onProgress, progressEvent, ready, savedStepId, steps]);

  useEffect(() => {
    if (!isVisible || !ready) return;
    onProgress(progressEvent(currentStep));
  }, [currentStep, fingerprint, isVisible, onProgress, progressEvent, ready]);

  useEffect(() => {
    if (!isVisible || !ready) return;
    onStepEntered(currentStep);
  }, [currentStep, isVisible, onStepEntered, ready]);

  const updateSpotlight = useCallback(() => {
    const target = targetRef.current;
    if (!target || !elementIsVisible(target)) return;
    setSpotlight(measureSpotlight(target));
  }, []);

  useEffect(() => {
    if (!isVisible || !coachRef.current || typeof ResizeObserver === 'undefined') return;
    const coach = coachRef.current;
    const updateCoachSize = () => {
      const bounds = coach.getBoundingClientRect();
      const nextSize = { width: bounds.width, height: bounds.height };
      coachSizeRef.current = nextSize;
      setCoachSize(nextSize);
    };
    updateCoachSize();
    const observer = new ResizeObserver(updateCoachSize);
    observer.observe(coach);
    return () => observer.disconnect();
  }, [currentStep.id, error, isVisible, loading, targetState]);

  useEffect(() => {
    if (!isVisible || !ready) {
      targetRef.current = null;
      setSpotlight(null);
      setTargetState('not-required');
      return;
    }

    if (!effectiveTargetId) {
      targetRef.current = null;
      setSpotlight(null);
      setTargetState('not-required');
      const focusFrame = window.requestAnimationFrame(() => primaryActionRef.current?.focus());
      return () => window.cancelAnimationFrame(focusFrame);
    }

    let cancelled = false;
    let locateFrame = 0;
    let focusFrame = 0;
    let settleTimer = 0;
    let scrollContainer: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    const startedAt = performance.now();
    setTargetState('locating');
    setSpotlight(null);
    targetRef.current = null;

    const finishLocation = (target: HTMLElement) => {
      if (cancelled || targetRef.current) return;
      targetRef.current = target;
      setTargetState('ready');
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      scrollContainer = scrollModalToTarget(target, coachSizeRef.current.height, prefersReducedMotion);
      const measureAndFocus = () => {
        if (cancelled || !elementIsVisible(target)) return;
        updateSpotlight();
        focusTargetOrCoach(currentStep, target, primaryActionRef);
      };
      focusFrame = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(measureAndFocus);
      });
      if (!prefersReducedMotion) settleTimer = window.setTimeout(updateSpotlight, 240);
      window.addEventListener('resize', updateSpotlight);
      window.addEventListener('scroll', updateSpotlight, true);
      scrollContainer?.addEventListener('scroll', updateSpotlight);
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(updateSpotlight);
        resizeObserver.observe(target);
      }
    };

    const locate = () => {
      if (cancelled || targetRef.current) return;
      const target = findDemoTarget(effectiveTargetId, layerRef.current);
      if (target) {
        finishLocation(target);
        return;
      }
      if (performance.now() - startedAt >= TARGET_RETRY_MS) {
        setTargetState('missing');
        focusFrame = window.requestAnimationFrame(() => primaryActionRef.current?.focus());
        return;
      }
      locateFrame = window.requestAnimationFrame(locate);
    };

    const modalBody = layerRef.current?.closest<HTMLElement>('.scenario-create-modal')
      ?.querySelector<HTMLElement>('.scenario-create-modal-body');
    if (modalBody && typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(() => {
        if (!targetRef.current) {
          locate();
          return;
        }
        if (!elementIsVisible(targetRef.current)) {
          setRetryCount((current) => current + 1);
          return;
        }
        updateSpotlight();
      });
      mutationObserver.observe(modalBody, { childList: true, subtree: true, attributes: true });
    }
    locateFrame = window.requestAnimationFrame(locate);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(locateFrame);
      window.cancelAnimationFrame(focusFrame);
      window.clearTimeout(settleTimer);
      window.removeEventListener('resize', updateSpotlight);
      window.removeEventListener('scroll', updateSpotlight, true);
      scrollContainer?.removeEventListener('scroll', updateSpotlight);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      targetRef.current = null;
    };
  }, [currentStep, effectiveTargetId, isVisible, ready, retryCount, updateSpotlight]);

  useEffect(() => {
    const cancelPendingAdvance = () => {
      if (autoAdvanceFrameRef.current === null) return;
      window.cancelAnimationFrame(autoAdvanceFrameRef.current);
      autoAdvanceFrameRef.current = null;
    };

    if (!isVisible || !ready) {
      cancelPendingAdvance();
      observedStepRef.current = null;
      sawIncompleteDuringVisitRef.current = false;
      autoAdvanceHandledRef.current = false;
      return;
    }

    const isSameStepVisit = observedStepRef.current === currentStep.id;
    if (!isSameStepVisit) {
      cancelPendingAdvance();
      observedStepRef.current = currentStep.id;
      sawIncompleteDuringVisitRef.current = !isCurrentStepComplete;
      autoAdvanceHandledRef.current = false;
      autoAdvanceVisitRef.current += 1;
      // Refs drive the exactly-once guard, while this single follow-up render guarantees that an
      // action already complete on entry exposes its deliberate Continue/View contents control.
      setActionVisitRevision((current) => current + 1);
      return;
    }
    if (!isCurrentStepComplete) {
      cancelPendingAdvance();
      sawIncompleteDuringVisitRef.current = true;
      return;
    }
    if (!shouldAutoAdvanceExperimentDemoAction({
      kind: currentStep.kind,
      isSameStepVisit,
      sawIncompleteDuringVisit: sawIncompleteDuringVisitRef.current,
      isComplete: isCurrentStepComplete,
      advancePendingOrHandled:
        autoAdvanceFrameRef.current !== null || autoAdvanceHandledRef.current
    })) return;

    const scheduledStepId = currentStep.id;
    const scheduledStepIndex = stepIndex;
    const scheduledVisit = autoAdvanceVisitRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (autoAdvanceFrameRef.current !== frame) return;
      autoAdvanceFrameRef.current = null;
      const latest = latestSnapshotRef.current;
      if (
        autoAdvanceHandledRef.current ||
        autoAdvanceVisitRef.current !== scheduledVisit ||
        latest.stepId !== scheduledStepId ||
        latest.stepIndex !== scheduledStepIndex ||
        !latest.isVisible ||
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
  }, [currentStep.id, currentStep.kind, goToStep, isCurrentStepComplete, isVisible, ready, stepIndex]);

  useEffect(() => {
    if (!isVisible) return;
    const allowedFocusElements = () => [
      ...(targetState === 'ready' ? visibleFocusableElements(targetRef.current) : []),
      ...visibleFocusableElements(coachRef.current)
    ];
    const preferredFocus = () => currentStep.kind === 'action' && targetState === 'ready'
      ? visibleFocusableElements(targetRef.current)[0] ?? primaryActionRef.current
      : primaryActionRef.current;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.repeat) {
        event.preventDefault();
        onPause();
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
  }, [currentStep.kind, isVisible, onPause, targetState]);

  const scrimStyles = useMemo(
    () => buildScrimStyles(targetState === 'ready' ? spotlight : null),
    [spotlight, targetState]
  );

  if (!isVisible) return null;

  const targeted = Boolean(ready && effectiveTargetId);
  const isNarrowTargetedStep = Boolean(
    targeted && spotlight && spotlight.viewportWidth <= NARROW_COACH_BREAKPOINT
  );
  const coachPosition = targeted && spotlight && !isNarrowTargetedStep
    ? buildCoachPosition(spotlight, coachSize)
    : undefined;
  const scrimKinds = scrimStyles.length === 1
    ? ['full']
    : ['top', 'left', 'right', 'bottom'];
  const chapterLabel = chapter === 'policy' ? 'Policy scenario' : 'Sensitivity analysis';
  const announcement = ready
    ? `${chapterLabel} demo, step ${stepIndex + 1} of ${steps.length}: ${currentStep.title}`
    : error
      ? `The ${chapterLabel} demo could not finish loading.`
      : `Preparing the ${chapterLabel} demo.`;
  const isCompletionStep = currentStep.id === completionStepId;
  const showAlreadyCompleteAction = currentStep.kind === 'action' &&
    isCurrentStepComplete &&
    observedStepRef.current === currentStep.id &&
    !sawIncompleteDuringVisitRef.current;

  return (
    <div
      ref={layerRef}
      className="validation-demo-layer experiment-demo-layer"
      data-experiment-demo-chapter={chapter}
      data-experiment-demo-state={ready ? currentStep.id : 'loading'}
    >
      <DemoShading holes={targetState === 'ready' && spotlight ? [spotlight] : []} />
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
        className={`validation-demo-coach experiment-demo-coach${isNarrowTargetedStep ? ' is-bottom-sheet' : ''}${!targeted || targetState !== 'ready' ? ' is-centred' : ''}`}
        style={coachPosition}
        role="dialog"
        aria-labelledby="experiment-demo-title"
        aria-describedby="experiment-demo-body"
        aria-busy={!ready && loading ? 'true' : undefined}
      >
        {!ready ? (
          <>
            <p className="validation-demo-progress">Experiment demo · {chapterLabel}</p>
            <h2 id="experiment-demo-title">{error ? 'This chapter isn’t ready' : 'Preparing the chapter'}</h2>
            <p id="experiment-demo-body">{error || `Loading the ${chapterLabel} builder, draft and options.`}</p>
            <div className="validation-demo-actions">
              {error && (
                <button ref={primaryActionRef} type="button" className="primary-button" onClick={onRetryLoad}>
                  Retry
                </button>
              )}
              <button
                ref={error ? undefined : primaryActionRef}
                type="button"
                className="secondary-button"
                onClick={onExit}
              >
                End demo
              </button>
            </div>
          </>
        ) : targetState === 'missing' ? (
          <>
            <p className="validation-demo-progress">Experiment demo · {chapterLabel} · step unavailable</p>
            <h2 id="experiment-demo-title">This step isn’t ready</h2>
            <p id="experiment-demo-body">
              The required builder control is still unavailable. Retry after the page finishes laying out.
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
              <button type="button" className="secondary-button" onClick={onPause}>Pause demo</button>
              <button type="button" className="secondary-button" onClick={onExit}>End demo</button>
            </div>
          </>
        ) : (
          <>
            <p className="validation-demo-progress">
              Experiment demo · {chapterLabel} · step {stepIndex + 1} of {steps.length}
            </p>
            <h2 id="experiment-demo-title">{currentStep.title}</h2>
            <p id="experiment-demo-body">{currentStep.body}</p>
            {currentStep.kind === 'action' && !showAlreadyCompleteAction && (
              <p className={`validation-demo-action-state ${actionError ? 'is-error' : 'is-waiting'}`} aria-live="polite">
                {actionError || currentStep.actionHint || 'Complete the highlighted action to continue.'}
              </p>
            )}
            {currentStep.kind !== 'action' && !canAdvanceCurrentStep && (
              <p className="validation-demo-action-state is-waiting" aria-live="polite">
                {currentStep.waitHint || 'Wait for the highlighted content to finish updating.'}
              </p>
            )}
            {showAlreadyCompleteAction && (
              <p className="validation-demo-action-state is-complete" aria-live="polite">
                This action is already complete. Continue deliberately when you are ready.
              </p>
            )}
            <div className="validation-demo-actions">
              {stepIndex > 0 && !isCompletionStep && (
                <button type="button" className="secondary-button" onClick={() => goToStep(stepIndex - 1)}>
                  Back
                </button>
              )}
              {isCompletionStep ? (
                <button ref={primaryActionRef} type="button" className="primary-button" onClick={onCompletionPrimary}>
                  {completionPrimaryLabel}
                </button>
              ) : currentStep.kind !== 'action' ? (
                <button
                  ref={primaryActionRef}
                  type="button"
                  className="primary-button"
                  disabled={!canAdvanceCurrentStep}
                  onClick={() => goToStep(stepIndex + 1)}
                >
                  {currentStep.nextLabel ?? (stepIndex === 0 ? 'Start chapter' : 'Next')}
                </button>
              ) : showAlreadyCompleteAction ? (
                <button ref={primaryActionRef} type="button" className="primary-button" onClick={() => goToStep(stepIndex + 1)}>
                  {currentStep.alreadyCompleteLabel ?? (currentStep.reveals ? 'View contents' : 'Continue')}
                </button>
              ) : null}
              <button type="button" className="secondary-button" onClick={onPause}>Pause demo</button>
              <button type="button" className="secondary-button" onClick={onExit}>End demo</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
