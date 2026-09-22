import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { DemoShading } from './DemoShading';
import type { GuidedTourOverlayProps } from '../lib/guidedDemos/types';
import {
  GUIDED_TOUR_PADDING,
  GUIDED_TOUR_TARGET_TIMEOUT_MS,
  guidedTourCoachPlacement,
  guidedTourScrims,
  guidedTourSpotlight,
  guidedTourTargetLayoutKey,
  guidedTourTargetTop,
  type GuidedTourRectangle,
  type GuidedTourSize
} from '../lib/guidedTourGeometry';

export type GuidedTourTargetState = 'not-required' | 'locating' | 'ready' | 'missing';

export function guidedTourCanAdvance(
  kind: 'info' | 'action',
  isComplete: boolean,
  availability: 'ready' | 'loading' | 'missing',
  targetState: GuidedTourTargetState
): boolean {
  return availability === 'ready' && (targetState === 'missing' || kind === 'info' || isComplete);
}

export function guidedTourNextFocusIndex(length: number, currentIndex: number, backwards: boolean): number {
  if (!length) return -1;
  return backwards
    ? currentIndex <= 0 ? length - 1 : currentIndex - 1
    : currentIndex < 0 || currentIndex >= length - 1 ? 0 : currentIndex + 1;
}

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert]')) return false;
  const style = window.getComputedStyle(element);
  const bounds = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' &&
    bounds.width > 0 && bounds.height > 0 && element.getClientRects().length > 0;
}

function findTarget(selector: string | null): HTMLElement | null {
  if (!selector) return null;
  try {
    const matches = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(isVisible);
    return matches.length === 1 ? matches[0] : null;
  } catch {
    return null;
  }
}

function focusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root || !isVisible(root)) return [];
  return [
    ...(root.matches(FOCUSABLE) ? [root] : []),
    ...root.querySelectorAll<HTMLElement>(FOCUSABLE)
  ].filter((element) => isVisible(element) && !element.matches(':disabled, [aria-disabled="true"]') && element.tabIndex >= 0);
}

function boundsOf(element: HTMLElement): GuidedTourRectangle {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
}

/** Measure the natural or constrained coach without committing a transient width. */
function measureCoach(coach: HTMLElement | null, width?: number): GuidedTourSize {
  if (!coach) return { width: 352, height: 280 };
  const previousWidth = coach.style.width;
  coach.style.width = width === undefined ? '' : `${width}px`;
  const size = boundsOf(coach);
  coach.style.width = previousWidth;
  return { width: size.width, height: size.height };
}

function scrollOffsetOf(element: HTMLElement): { left: number; top: number } {
  const offset = { left: window.scrollX, top: window.scrollY };
  let ancestor = element.parentElement;
  while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
    offset.left += ancestor.scrollLeft;
    offset.top += ancestor.scrollTop;
    ancestor = ancestor.parentElement;
  }
  return offset;
}

function scrollTarget(target: HTMLElement, top: number, reducedMotion: boolean): (() => void) | undefined {
  let scrollContainer = target.parentElement;
  while (scrollContainer && scrollContainer !== document.body) {
    const style = window.getComputedStyle(scrollContainer);
    if (/(auto|scroll)/.test(style.overflowY) && scrollContainer.scrollHeight > scrollContainer.clientHeight) break;
    scrollContainer = scrollContainer.parentElement;
  }
  const change = target.getBoundingClientRect().top - top;
  if (Math.abs(change) < 1) return;
  const scroller = scrollContainer && scrollContainer !== document.body ? scrollContainer : window;
  scroller.scrollBy({ top: change, behavior: reducedMotion ? 'instant' : 'smooth' });
  return () => scroller.scrollBy({ top: 0, behavior: 'instant' });
}

interface Layout {
  key: string;
  state: GuidedTourTargetState;
  spotlight: GuidedTourRectangle | null;
  holes: GuidedTourRectangle[];
  viewport: GuidedTourSize;
  coach: CSSProperties;
  bottomSheet: boolean;
}

/** Controlled presentation only: completing a real page action never advances the guide. */
export function GuidedTourOverlay({
  active = true, demoLabel, step, stepIndex, stepCount, isComplete,
  onBack, onNext, onExit, showExit = true, nextLabel = 'Next', completionActions,
  availability = 'ready', onChooseAnotherDemo, loadingTitle, loadingBody, unavailableTitle, unavailableBody, feedback
}: GuidedTourOverlayProps) {
  const titleId = useId();
  const bodyId = useId();
  const layerRef = useRef<HTMLDivElement>(null);
  const coachRef = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const stepKey = `${step.id}:${stepIndex}:${step.target ?? ''}:${availability}`;
  const extraSelectors = JSON.stringify(step.additionalInteractiveTargets ?? []);
  const currentRef = useRef({ step, availability, onExit });
  currentRef.current = { step, availability, onExit };
  // Keep the last geometry during a step handoff; readiness still belongs to the new step.
  const currentLayout = layout;
  const targetState = layout?.key === stepKey ? layout.state : step.target ? 'locating' : 'not-required';
  const interactive = Boolean(step.interactive && availability === 'ready');

  useEffect(() => {
    if (!active) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const interactiveRegions = () => {
      const current = currentRef.current;
      if (!current.step.interactive || current.availability !== 'ready') return [];
      return [findTarget(current.step.target), ...(current.step.additionalInteractiveTargets ?? []).map(findTarget)]
        .filter((element): element is HTMLElement => Boolean(element));
    };
    const allowedRegions = () => [coachRef.current, ...interactiveRegions()]
      .filter((element): element is HTMLElement => Boolean(element));
    const isAllowed = (target: EventTarget | null) => target instanceof Node &&
      allowedRegions().some((region) => region.contains(target));
    const allowedFocus = () => [...new Set([
      ...interactiveRegions().flatMap(focusableElements), ...focusableElements(coachRef.current)
    ])];
    const focusCoach = () => coachRef.current?.focus({ preventScroll: true });
    const trapFocus = (event: FocusEvent) => {
      if (!isAllowed(event.target)) focusCoach();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) currentRef.current.onExit();
      } else if (event.key === 'Tab') {
        const elements = allowedFocus();
        const index = guidedTourNextFocusIndex(elements.length, elements.indexOf(document.activeElement as HTMLElement), event.shiftKey);
        event.preventDefault();
        event.stopImmediatePropagation();
        (elements[index] ?? coachRef.current)?.focus({ preventScroll: true });
      } else if (!isAllowed(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const blockInteraction = (event: Event) => {
      if (isAllowed(event.target)) return;
      // Keep viewport scrolling available; activation outside the allowed regions is still blocked.
      const touch = event.type.startsWith('touch') || ('pointerType' in event && event.pointerType === 'touch');
      if (!touch) event.preventDefault();
      event.stopImmediatePropagation();
    };
    const blockedEvents = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'dragstart', 'drop', 'submit', 'touchstart', 'touchend'];
    document.addEventListener('keydown', handleKey, true);
    document.addEventListener('focusin', trapFocus, true);
    blockedEvents.forEach((name) => document.addEventListener(name, blockInteraction, { capture: true, passive: false }));
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      document.removeEventListener('focusin', trapFocus, true);
      blockedEvents.forEach((name) => document.removeEventListener(name, blockInteraction, true));
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [active]);

  useLayoutEffect(() => {
    if (!active) return;
    let stopped = false;
    let frame = 0;
    let missingTimer = 0;
    let timedOut = false;
    let locatedTarget: HTMLElement | null = null;
    let initialFocusDone = false;
    let entryScrollPending = true;
    let needsScroll = true;
    let cancelScroll: (() => void) | undefined;
    let scrollPlacement: ReturnType<typeof guidedTourCoachPlacement> | null = null;
    let scrollSettleTimer = 0;
    let lastCoachSize = '';
    let lastTargetLayout = '';
    const extraTargets: string[] = JSON.parse(extraSelectors);
    coachRef.current?.focus({ preventScroll: true });

    const schedule = () => {
      if (!stopped && !frame) frame = window.requestAnimationFrame(measure);
    };
    const settleScroll = () => {
      window.clearTimeout(scrollSettleTimer);
      scrollSettleTimer = window.setTimeout(() => {
        scrollPlacement = null;
        schedule();
      }, 120);
    };
    const scrolled = () => {
      if (scrollPlacement) settleScroll();
      schedule();
    };
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    const measure = () => {
      frame = 0;
      if (stopped) return;
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const coach = coachRef.current;
      const measuredCoach = measureCoach(coach);
      const coachSizeKey = `${measuredCoach.width}:${measuredCoach.height}`;
      if (lastCoachSize && coachSizeKey !== lastCoachSize) needsScroll = true;
      lastCoachSize = coachSizeKey;
      const target = availability === 'ready' ? findTarget(step.target) : null;
      const regions = interactive ? extraTargets.map(findTarget).filter((element): element is HTMLElement => Boolean(element)) : [];
      if (target !== locatedTarget) {
        if (locatedTarget) resizeObserver?.unobserve(locatedTarget);
        locatedTarget = target;
        needsScroll = true;
        if (target) resizeObserver?.observe(target);
      }
      const targetBounds = target ? boundsOf(target) : null;
      if (target && targetBounds) {
        const targetLayout = guidedTourTargetLayoutKey(targetBounds, scrollOffsetOf(target));
        if (targetLayout !== lastTargetLayout) needsScroll = true;
        lastTargetLayout = targetLayout;
      }
      const spotlight = targetBounds ? guidedTourSpotlight(targetBounds, viewport) : null;
      const regionBounds = regions.map(boundsOf);
      const placeCoach = (bounds: GuidedTourRectangle | null, obstacles: GuidedTourRectangle[]) => {
        const visibleTarget = bounds ? guidedTourSpotlight(bounds, viewport) : null;
        let placement = guidedTourCoachPlacement(visibleTarget, viewport, measuredCoach, obstacles);
        if (placement.width < measuredCoach.width) {
          // Wrapping increases height in a narrow side gutter. Measure that actual
          // height before choosing its top edge, while retaining the natural width
          // for the next layout pass so the coach can expand when space returns.
          placement = guidedTourCoachPlacement(visibleTarget, viewport, measureCoach(coach, placement.width), obstacles);
        }
        return placement;
      };
      let placement = scrollPlacement ?? placeCoach(targetBounds, regionBounds);
      if (target && targetBounds && needsScroll) {
        needsScroll = false;
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const top = guidedTourTargetTop(targetBounds, viewport, entryScrollPending ? step.scrollOnEnter : undefined);
        entryScrollPending = false;
        // Reserve room for the coach at the destination, then perform one scroll.
        const intendedTarget = { ...targetBounds, top };
        const intendedRegions = regionBounds.map((region) => ({ ...region, top: region.top + top - targetBounds.top }));
        const intendedPlacement = placeCoach(intendedTarget, intendedRegions);
        const destination = intendedPlacement.targetTop === null ? top : intendedPlacement.targetTop + GUIDED_TOUR_PADDING;
        cancelScroll?.();
        cancelScroll = scrollTarget(target, destination, reducedMotion);
        if (cancelScroll) {
          // Hold the destination position during scrolling so the coach cannot flip sides mid-move.
          scrollPlacement = placeCoach({ ...targetBounds, top: destination },
            regionBounds.map((region) => ({ ...region, top: region.top + destination - targetBounds.top })));
          placement = scrollPlacement;
          settleScroll();
        } else {
          scrollPlacement = null;
          window.clearTimeout(scrollSettleTimer);
        }
      }
      const state: GuidedTourTargetState = !step.target || availability !== 'ready'
        ? 'not-required' : target ? 'ready' : timedOut ? 'missing' : 'locating';
      if (!target && step.target && availability === 'ready' && !missingTimer && !timedOut) {
        missingTimer = window.setTimeout(() => { timedOut = true; schedule(); }, GUIDED_TOUR_TARGET_TIMEOUT_MS);
      } else if (target && missingTimer) {
        window.clearTimeout(missingTimer);
        missingTimer = 0;
        timedOut = false;
      }
      const holes = [spotlight, ...regionBounds.map((region) => guidedTourSpotlight(region, viewport))]
        .filter((rectangle): rectangle is GuidedTourRectangle => Boolean(rectangle));
      const next: Layout = {
        key: stepKey, state, spotlight, holes, viewport,
        coach: { left: placement.left, top: placement.top, width: placement.width }, bottomSheet: placement.bottomSheet
      };
      setLayout((current) => {
        // A page change can briefly have no target. Keep the coach in place while it loads.
        if (!target && current && (availability === 'loading' || state === 'locating')) {
          next.coach = current.coach;
          next.bottomSheet = current.bottomSheet;
        }
        return JSON.stringify(current) === JSON.stringify(next) ? current : next;
      });
      if (!initialFocusDone && (target || !step.target || timedOut || availability !== 'ready')) {
        initialFocusDone = true;
        // Page controls can open help or menus on focus. Entry announces the coach;
        // the user reaches real controls deliberately through the existing Tab cycle.
        coach?.focus({ preventScroll: true });
      }
    };
    const resized = () => { needsScroll = true; schedule(); };
    const mutationObserver = new MutationObserver((records) => {
      if (records.every((record) => layerRef.current?.contains(record.target))) return;
      schedule();
    });
    mutationObserver.observe(document.body, { subtree: true, childList: true, attributes: true });
    if (coachRef.current) resizeObserver?.observe(coachRef.current);
    window.addEventListener('resize', resized);
    window.addEventListener('scroll', scrolled, true);
    measure();
    return () => {
      stopped = true;
      cancelScroll?.();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(missingTimer);
      window.clearTimeout(scrollSettleTimer);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('resize', resized);
      window.removeEventListener('scroll', scrolled, true);
    };
  }, [active, availability, extraSelectors, interactive, step.id, step.kind, step.scrollOnEnter, step.target, stepKey]);

  if (!active) return null;
  const missingExample = availability === 'missing';
  const loading = availability === 'loading';
  const missingTarget = targetState === 'missing';
  const title = missingExample ? unavailableTitle ?? "This example isn't available on this installation" : loading ? loadingTitle ?? 'Loading the example' : step.title;
  const body = missingExample ? unavailableBody ?? 'Choose another demo to continue.' : loading ? loadingBody ?? 'The saved example is loading.' : missingTarget ? step.unavailableBody : isComplete ? step.completionNote ?? step.body : step.body;
  const stepBullets = isComplete && step.kind === 'action' ? step.completionBullets : step.bullets;
  const bullets = availability === 'ready' && !missingTarget ? stepBullets : undefined;
  const bulletMessages = Boolean(step.bullets?.length && !step.body);
  const canAdvance = guidedTourCanAdvance(step.kind, isComplete, availability, targetState);
  const scrims = currentLayout ? guidedTourScrims(currentLayout.viewport, currentLayout.holes) : [];
  const content = (
    <div ref={layerRef} className="guided-tour-layer" data-guided-tour-step={step.id} data-guided-tour-target-state={targetState}>
      <DemoShading holes={currentLayout?.holes ?? []} />
      {currentLayout ? scrims.map((rectangle, index) => (
        <div key={index} className="guided-tour-scrim" style={rectangle} aria-hidden="true" />
      )) : <div className="guided-tour-scrim is-full" aria-hidden="true" />}
      {currentLayout?.spotlight && <div className="guided-tour-spotlight" style={currentLayout.spotlight} aria-hidden="true" />}
      <p className="guided-tour-live" aria-live="polite" aria-atomic="true">{`${demoLabel} · ${stepIndex + 1} of ${stepCount}. ${title}`}</p>
      <section
        ref={coachRef}
        className={`guided-tour-coach${currentLayout ? '' : ' is-centred'}${currentLayout?.bottomSheet ? ' is-bottom-sheet' : ''}`}
        style={currentLayout?.coach}
        role="dialog"
        aria-modal={!interactive ? true : undefined}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        aria-busy={loading || targetState === 'locating' ? true : undefined}
        tabIndex={-1}
      >
        <p className="guided-tour-progress">{demoLabel} · {Math.min(stepIndex + 1, stepCount)} of {stepCount}</p>
        <h2 id={titleId}>{title}</h2>
        <div className="guided-tour-body" id={bodyId} aria-live={step.kind === 'action' ? 'polite' : undefined} aria-atomic={step.kind === 'action' ? true : undefined}>
          {body && (bulletMessages ? <ul className="guided-tour-bullets"><li>{body}</li></ul> : <p>{body}</p>)}
          {bullets?.length ? <ul className="guided-tour-bullets">{bullets.map((bullet, index) => <li key={index}>{bullet}</li>)}</ul> : null}
        </div>
        {feedback && <p className="guided-tour-action-state" role="alert">{feedback}</p>}
        {availability === 'ready' && !missingTarget && step.kind === 'action' && !isComplete && (
          <div className="guided-tour-action-state is-waiting" aria-live="polite">
            {bulletMessages
              ? <ul className="guided-tour-bullets"><li>{step.actionHint ?? 'Complete the highlighted action to continue.'}</li></ul>
              : step.actionHint ?? 'Complete the highlighted action to continue.'}
          </div>
        )}
        <div className="guided-tour-actions">
          {missingExample ? (
            <button type="button" className="primary-button" onClick={onChooseAnotherDemo ?? onExit}>Choose another demo</button>
          ) : <>
            <button type="button" className="secondary-button" disabled={stepIndex === 0} onClick={onBack}>Back</button>
            {completionActions?.length ? completionActions.map((action) => (
              <button type="button" key={action.id} className={action.primary ? 'primary-button' : 'secondary-button'} onClick={action.onClick}>{action.label}</button>
            )) : <button type="button" className="primary-button" disabled={!canAdvance} onClick={onNext}>{nextLabel}</button>}
          </>}
          {showExit && <button type="button" className="secondary-button" onClick={onExit}>Exit</button>}
        </div>
      </section>
    </div>
  );
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}
