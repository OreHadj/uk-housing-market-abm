import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  createPolicyExperimentDemoProgress,
  readPolicyExperimentDemoProgress,
  writePolicyExperimentDemoProgress,
  type PolicyExperimentDemoStageId
} from '../lib/policyExperimentDemo';

export const POLICY_EXPERIMENT_DEMO_TARGETS = {
  scenarioName: 'policy-scenario-name',
  continueButton: 'policy-builder-continue'
} as const;

export interface PolicyExperimentDemoStage {
  id: PolicyExperimentDemoStageId;
  targetId: (typeof POLICY_EXPERIMENT_DEMO_TARGETS)[keyof typeof POLICY_EXPERIMENT_DEMO_TARGETS] | null;
  title: string;
  body: string;
}

export const POLICY_EXPERIMENT_DEMO_STAGES = [
  {
    id: 'introduction',
    targetId: null,
    title: 'Create experiments',
    body: 'Experiment creation turns a policy question into a reproducible model run. This first preview shows how a policy scenario is named and how the guide reacts to real actions. Nothing will be submitted.'
  },
  {
    id: 'scenario-name',
    targetId: POLICY_EXPERIMENT_DEMO_TARGETS.scenarioName,
    title: 'Name the policy scenario',
    body: 'Enter a clear name you will recognise in Results, then press Enter or click outside the field. The walkthrough will continue automatically.'
  },
  {
    id: 'continue',
    targetId: POLICY_EXPERIMENT_DEMO_TARGETS.continueButton,
    title: 'Move through the builder',
    body: 'The five sections separate the scenario question, model evidence, policy settings, technical details and final review. Select the page’s Continue button to move to Model version.'
  },
  {
    id: 'complete',
    targetId: null,
    title: 'Prototype complete',
    body: 'This preview tested the overlay, spotlight and action-driven advancement. No experiment was submitted, and the rest of the creation walkthrough has not been built yet.'
  }
] as const satisfies readonly PolicyExperimentDemoStage[];

export interface PolicyExperimentDemoContext {
  active: boolean;
  draftId: string;
  ready: boolean;
  loading: boolean;
  error: string;
  onRetryLoad: () => void;
  onPrototypeComplete: () => void;
  onExit: () => void;
}

export type PolicyExperimentDemoCoordinator = Omit<
  PolicyExperimentDemoContext,
  'ready' | 'loading' | 'error' | 'onRetryLoad'
>;

export interface PolicyExperimentDemoAutoAdvanceGuard {
  stageId: PolicyExperimentDemoStageId;
  isSameStageVisit: boolean;
  sawIncompleteDuringVisit: boolean;
  isComplete: boolean;
  advancePendingOrHandled: boolean;
}

export function isPolicyExperimentDemoActionStage(stageId: PolicyExperimentDemoStageId): boolean {
  return stageId === 'scenario-name' || stageId === 'continue';
}

export function shouldAutoAdvancePolicyExperimentDemoStage({
  stageId,
  isSameStageVisit,
  sawIncompleteDuringVisit,
  isComplete,
  advancePendingOrHandled
}: PolicyExperimentDemoAutoAdvanceGuard): boolean {
  return Boolean(
    isPolicyExperimentDemoActionStage(stageId) &&
      isSameStageVisit &&
      sawIncompleteDuringVisit &&
      isComplete &&
      !advancePendingOrHandled
  );
}

export function committedPolicyExperimentDemoName(value: string, wasDeliberatelyEdited: boolean): string {
  return wasDeliberatelyEdited ? value.trim() : '';
}

export function isPolicyExperimentDemoNameComplete(
  currentName: string,
  committedName: string,
  commitRevision: number
): boolean {
  return Boolean(
    commitRevision > 0 &&
      committedName &&
      currentName.trim() === committedName
  );
}

interface PolicyExperimentDemoPrototypeProps extends PolicyExperimentDemoContext {
  currentWizardStep: number;
  currentName: string;
  committedName: string;
  nameCommitRevision: number;
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

interface AutoAdvanceSnapshot {
  stageId: PolicyExperimentDemoStageId;
  stageIndex: number;
  isComplete: boolean;
  isVisible: boolean;
}

type TargetState = 'not-required' | 'locating' | 'ready' | 'missing';

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

function visibleFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  const elements: HTMLElement[] = [];
  if (root.matches(FOCUSABLE_SELECTOR)) elements.push(root);
  elements.push(...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return elements.filter(
    (element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true'
  );
}

function findDemoTarget(targetId: string, layer: HTMLElement | null): HTMLElement | null {
  const modal = layer?.closest<HTMLElement>('.scenario-create-modal') ?? document;
  return Array.from(
    modal.querySelectorAll<HTMLElement>('[data-policy-experiment-demo-target]')
  ).find((element) => element.dataset.policyExperimentDemoTarget === targetId) ?? null;
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

export function isPolicyExperimentDemoStageComplete(
  stageId: PolicyExperimentDemoStageId,
  currentWizardStep: number,
  currentName: string,
  committedName: string,
  nameCommitRevision: number
): boolean {
  if (stageId === 'scenario-name') {
    return isPolicyExperimentDemoNameComplete(currentName, committedName, nameCommitRevision);
  }
  if (stageId === 'continue') return currentWizardStep === 1;
  return true;
}

export function PolicyExperimentDemoPrototype({
  active,
  draftId,
  ready,
  loading,
  error,
  onRetryLoad,
  onPrototypeComplete,
  onExit,
  currentWizardStep,
  currentName,
  committedName,
  nameCommitRevision
}: PolicyExperimentDemoPrototypeProps) {
  const [stageIndex, setStageIndex] = useState(0);
  const [targetState, setTargetState] = useState<TargetState>('not-required');
  const [spotlight, setSpotlight] = useState<SpotlightGeometry | null>(null);
  const [coachSize, setCoachSize] = useState<ElementSize>({ width: 0, height: 0 });
  const [retryCount, setRetryCount] = useState(0);
  const layerRef = useRef<HTMLDivElement>(null);
  const coachRef = useRef<HTMLElement>(null);
  const coachSizeRef = useRef<ElementSize>({ width: 0, height: 0 });
  const targetRef = useRef<HTMLElement | null>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const initializedDraftRef = useRef('');
  const observedStageRef = useRef<PolicyExperimentDemoStageId | null>(null);
  const sawIncompleteDuringVisitRef = useRef(false);
  const autoAdvanceHandledRef = useRef(false);
  const autoAdvanceFrameRef = useRef<number | null>(null);
  const autoAdvanceVisitRef = useRef(0);
  const latestSnapshotRef = useRef<AutoAdvanceSnapshot>({
    stageId: 'introduction',
    stageIndex: 0,
    isComplete: true,
    isVisible: false
  });

  const currentStage = POLICY_EXPERIMENT_DEMO_STAGES[stageIndex] ?? POLICY_EXPERIMENT_DEMO_STAGES[0];
  const isVisible = active && Boolean(draftId);
  const isCurrentStageComplete = isPolicyExperimentDemoStageComplete(
    currentStage.id,
    currentWizardStep,
    currentName,
    committedName,
    nameCommitRevision
  );
  latestSnapshotRef.current = {
    stageId: currentStage.id,
    stageIndex,
    isComplete: isCurrentStageComplete,
    isVisible: isVisible && ready
  };

  const updateSpotlight = useCallback(() => {
    setSpotlight(targetRef.current ? measureSpotlight(targetRef.current) : null);
  }, []);

  const goToStage = useCallback((nextStageIndex: number) => {
    const nextStage = POLICY_EXPERIMENT_DEMO_STAGES[nextStageIndex];
    if (!nextStage || !draftId) return;
    writePolicyExperimentDemoProgress(createPolicyExperimentDemoProgress(draftId, nextStage.id));
    targetRef.current = null;
    setSpotlight(null);
    setTargetState(nextStage.targetId ? 'locating' : 'not-required');
    setStageIndex(nextStageIndex);
    if (nextStage.id === 'complete') onPrototypeComplete();
  }, [draftId, onPrototypeComplete]);

  useEffect(() => {
    if (!isVisible || !ready || initializedDraftRef.current === draftId) return;
    const saved = readPolicyExperimentDemoProgress();
    const savedIndex = saved?.draftId === draftId
      ? POLICY_EXPERIMENT_DEMO_STAGES.findIndex((stage) => stage.id === saved.stageId)
      : -1;
    const nextIndex = savedIndex >= 0 ? savedIndex : 0;
    initializedDraftRef.current = draftId;
    setStageIndex(nextIndex);
    if (savedIndex < 0) {
      writePolicyExperimentDemoProgress(createPolicyExperimentDemoProgress(draftId));
    }
  }, [draftId, isVisible, ready]);

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
  }, [currentStage.id, error, isVisible, loading, targetState]);

  useEffect(() => {
    if (!isVisible || !ready) {
      targetRef.current = null;
      setSpotlight(null);
      setTargetState('not-required');
      return;
    }

    if (!currentStage.targetId) {
      targetRef.current = null;
      setSpotlight(null);
      setTargetState('not-required');
      const focusFrame = window.requestAnimationFrame(() => primaryActionRef.current?.focus());
      return () => window.cancelAnimationFrame(focusFrame);
    }

    let cancelled = false;
    let focusFrame = 0;
    let scrollContainer: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    setTargetState('locating');
    setSpotlight(null);
    targetRef.current = null;

    const locateFrame = window.requestAnimationFrame(() => {
      const target = findDemoTarget(currentStage.targetId!, layerRef.current);
      if (cancelled) return;
      if (!target) {
        setTargetState('missing');
        focusFrame = window.requestAnimationFrame(() => primaryActionRef.current?.focus());
        return;
      }

      targetRef.current = target;
      setTargetState('ready');
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      scrollContainer = scrollModalToTarget(target, coachSizeRef.current.height, prefersReducedMotion);
      const measureAfterScroll = () => {
        if (cancelled) return;
        updateSpotlight();
        target.focus({ preventScroll: true });
      };
      focusFrame = window.requestAnimationFrame(measureAfterScroll);
      window.addEventListener('resize', updateSpotlight);
      window.addEventListener('scroll', updateSpotlight, true);
      scrollContainer?.addEventListener('scroll', updateSpotlight);
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
      scrollContainer?.removeEventListener('scroll', updateSpotlight);
      resizeObserver?.disconnect();
      targetRef.current = null;
    };
  }, [currentStage, isVisible, ready, retryCount, updateSpotlight]);

  useEffect(() => {
    const cancelPendingAdvance = () => {
      if (autoAdvanceFrameRef.current === null) return;
      window.cancelAnimationFrame(autoAdvanceFrameRef.current);
      autoAdvanceFrameRef.current = null;
    };

    if (!isVisible || !ready) {
      cancelPendingAdvance();
      observedStageRef.current = null;
      sawIncompleteDuringVisitRef.current = false;
      autoAdvanceHandledRef.current = false;
      return;
    }

    const isSameStageVisit = observedStageRef.current === currentStage.id;
    if (!isSameStageVisit) {
      cancelPendingAdvance();
      observedStageRef.current = currentStage.id;
      sawIncompleteDuringVisitRef.current = !isCurrentStageComplete;
      autoAdvanceHandledRef.current = false;
      autoAdvanceVisitRef.current += 1;
      return;
    }
    if (!isCurrentStageComplete) {
      cancelPendingAdvance();
      sawIncompleteDuringVisitRef.current = true;
      return;
    }
    if (!shouldAutoAdvancePolicyExperimentDemoStage({
      stageId: currentStage.id,
      isSameStageVisit,
      sawIncompleteDuringVisit: sawIncompleteDuringVisitRef.current,
      isComplete: isCurrentStageComplete,
      advancePendingOrHandled:
        autoAdvanceFrameRef.current !== null || autoAdvanceHandledRef.current
    })) return;

    const scheduledStageId = currentStage.id;
    const scheduledStageIndex = stageIndex;
    const scheduledVisit = autoAdvanceVisitRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (autoAdvanceFrameRef.current !== frame) return;
      autoAdvanceFrameRef.current = null;
      const latest = latestSnapshotRef.current;
      if (
        autoAdvanceHandledRef.current ||
        autoAdvanceVisitRef.current !== scheduledVisit ||
        latest.stageId !== scheduledStageId ||
        latest.stageIndex !== scheduledStageIndex ||
        !latest.isVisible ||
        !latest.isComplete
      ) return;

      autoAdvanceHandledRef.current = true;
      goToStage(scheduledStageIndex + 1);
    });
    autoAdvanceFrameRef.current = frame;

    return () => {
      if (autoAdvanceFrameRef.current !== frame) return;
      window.cancelAnimationFrame(frame);
      autoAdvanceFrameRef.current = null;
    };
  }, [currentStage.id, goToStage, isCurrentStageComplete, isVisible, ready, stageIndex]);

  useEffect(() => {
    if (!isVisible) return;

    const allowedFocusElements = () => [
      ...(targetState === 'ready' ? visibleFocusableElements(targetRef.current) : []),
      ...visibleFocusableElements(coachRef.current)
    ];
    const preferredFocus = () => targetState === 'ready'
      ? visibleFocusableElements(targetRef.current)[0] ?? primaryActionRef.current
      : primaryActionRef.current;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.repeat) {
        event.preventDefault();
        if (window.confirm('Exit this Policy creation preview? Your ordinary drafts will be kept.')) {
          onExit();
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
  }, [isVisible, onExit, targetState]);

  const scrimStyles = useMemo(
    () => buildScrimStyles(targetState === 'ready' ? spotlight : null),
    [spotlight, targetState]
  );

  if (!isVisible) return null;

  const targeted = Boolean(ready && currentStage.targetId);
  const isNarrowTargetedStage = Boolean(
    targeted && spotlight && spotlight.viewportWidth <= NARROW_COACH_BREAKPOINT
  );
  const coachPosition = targeted && spotlight && !isNarrowTargetedStage
    ? buildCoachPosition(spotlight, coachSize)
    : undefined;
  const scrimKinds = scrimStyles.length === 1
    ? ['full']
    : ['top', 'left', 'right', 'bottom'];
  const announcement = ready
    ? `Policy creation preview, step ${stageIndex + 1} of ${POLICY_EXPERIMENT_DEMO_STAGES.length}: ${currentStage.title}`
    : error
      ? 'The Policy creation preview could not finish loading.'
      : 'Preparing the Policy creation preview.';

  return (
    <div
      ref={layerRef}
      className="validation-demo-layer policy-experiment-demo-layer"
      data-policy-experiment-demo-state={ready ? currentStage.id : 'loading'}
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
        className={`validation-demo-coach policy-experiment-demo-coach${isNarrowTargetedStage ? ' is-bottom-sheet' : ''}${!targeted || targetState !== 'ready' ? ' is-centred' : ''}`}
        style={coachPosition}
        role="dialog"
        aria-labelledby="policy-experiment-demo-title"
        aria-describedby="policy-experiment-demo-body"
        aria-busy={!ready && loading ? 'true' : undefined}
      >
        {!ready ? (
          <>
            <p className="validation-demo-progress">Experiment demo · Policy preview</p>
            <h2 id="policy-experiment-demo-title">
              {error ? 'This preview isn’t ready' : 'Preparing the preview'}
            </h2>
            <p id="policy-experiment-demo-body">
              {error || 'Loading the Policy builder, draft and experiment options.'}
            </p>
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
                Exit demo
              </button>
            </div>
          </>
        ) : targetState === 'missing' ? (
          <>
            <p className="validation-demo-progress">Experiment demo · Policy preview · step unavailable</p>
            <h2 id="policy-experiment-demo-title">This preview step isn’t ready</h2>
            <p id="policy-experiment-demo-body">
              The required Policy builder control could not be found. Retry after the page has finished loading.
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
              <button type="button" className="secondary-button" onClick={onExit}>Exit demo</button>
            </div>
          </>
        ) : (
          <>
            <p className="validation-demo-progress">
              Experiment demo · Policy preview · step {stageIndex + 1} of {POLICY_EXPERIMENT_DEMO_STAGES.length}
            </p>
            <h2 id="policy-experiment-demo-title">{currentStage.title}</h2>
            <p id="policy-experiment-demo-body">{currentStage.body}</p>
            {currentStage.id === 'scenario-name' && (
              <p className="validation-demo-action-state is-waiting" aria-live="polite">
                Enter a name, then commit it with Enter or by leaving the field.
              </p>
            )}
            {currentStage.id === 'continue' && (
              <p className="validation-demo-action-state is-waiting" aria-live="polite">
                Use the highlighted page control to continue.
              </p>
            )}
            <div className="validation-demo-actions">
              {currentStage.id === 'introduction' && (
                <button ref={primaryActionRef} type="button" className="primary-button" onClick={() => goToStage(1)}>
                  Start preview
                </button>
              )}
              {currentStage.id === 'complete' && (
                <button ref={primaryActionRef} type="button" className="primary-button" onClick={onExit}>
                  Exit preview
                </button>
              )}
              {currentStage.id !== 'complete' && (
                <button
                  ref={currentStage.id === 'introduction' ? undefined : primaryActionRef}
                  type="button"
                  className="secondary-button"
                  onClick={onExit}
                >
                  Exit demo
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
