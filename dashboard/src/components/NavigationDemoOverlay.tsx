import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { DemoShading } from './DemoShading';
import './NavigationDemoOverlay.css';

export interface NavigationDemoOverlayProps {
  title: string;
  body: string;
  section: string;
  stepIndex: number;
  stepCount: number;
  targetSelector?: string;
  unavailableBody?: string;
  nextLabel?: string;
  onNext: () => void;
  onBack: () => void;
  onExit: () => void;
}

interface Rectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Layout {
  key: string;
  spotlight: Rectangle | null;
  coach: CSSProperties;
}

const MARGIN = 12;
const GAP = 18;
const FOCUSABLE = 'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return element.isConnected && !element.closest('[hidden], [inert]') &&
    style.visibility !== 'hidden' && style.display !== 'none' &&
    element.getClientRects().length > 0 && element.getBoundingClientRect().width > 0 &&
    element.getBoundingClientRect().height > 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

function coachPosition(target: Rectangle | null, width: number, height: number): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  if (!target) {
    return { left: (viewportWidth - width) / 2, top: Math.max(MARGIN, (viewportHeight - height) / 2) };
  }
  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const alignedLeft = clamp(target.left, MARGIN, viewportWidth - width - MARGIN);
  const alignedTop = clamp(target.top, MARGIN, viewportHeight - height - MARGIN);
  const candidates = [
    { left: right + GAP, top: alignedTop },
    { left: target.left - width - GAP, top: alignedTop },
    { left: alignedLeft, top: bottom + GAP },
    { left: alignedLeft, top: target.top - height - GAP }
  ];
  const clearPosition = candidates.find(({ left, top }) =>
    left >= MARGIN && top >= MARGIN && left + width <= viewportWidth - MARGIN &&
    top + height <= viewportHeight - MARGIN);
  if (clearPosition) return clearPosition;

  // Large panels can fill the screen. Use the corner that obscures the least content.
  const corners = [
    { left: MARGIN, top: viewportHeight - height - MARGIN },
    { left: viewportWidth - width - MARGIN, top: viewportHeight - height - MARGIN },
    { left: MARGIN, top: MARGIN },
    { left: viewportWidth - width - MARGIN, top: MARGIN }
  ];
  const overlap = ({ left, top }: { left: number; top: number }) =>
    Math.max(0, Math.min(left + width, right) - Math.max(left, target.left)) *
    Math.max(0, Math.min(top + height, bottom) - Math.max(top, target.top));
  return corners.sort((a, b) => overlap(a) - overlap(b))[0];
}

export function NavigationDemoOverlay({
  title, body, section, stepIndex, stepCount, targetSelector, unavailableBody,
  nextLabel = 'Next', onNext, onBack, onExit
}: NavigationDemoOverlayProps) {
  const coachRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  const titleId = useId();
  const bodyId = useId();
  const stepKey = `${stepIndex}:${targetSelector ?? ''}`;
  const [layout, setLayout] = useState<Layout | null>(null);
  const [unavailableKey, setUnavailableKey] = useState<string | null>(null);

  useEffect(() => { onExitRef.current = onExit; }, [onExit]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const coach = coachRef.current;
    coach?.focus({ preventScroll: true });

    const insideCoach = (target: EventTarget | null) => target instanceof Node && coach?.contains(target);
    const trapFocus = (event: FocusEvent) => {
      if (!insideCoach(event.target)) coach?.focus({ preventScroll: true });
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onExitRef.current();
      } else if (event.key === 'Tab') {
        const buttons = Array.from(coach?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(isVisible);
        const index = buttons.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey
          ? (index <= 0 ? buttons.length - 1 : index - 1)
          : (index + 1) % buttons.length;
        event.preventDefault();
        event.stopImmediatePropagation();
        (buttons[next] ?? coach)?.focus({ preventScroll: true });
      } else if (!insideCoach(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const blockInteraction = (event: Event) => {
      if (insideCoach(event.target)) return;
      // Touch defaults allow the page to scroll. The subsequent click is still blocked.
      const isTouch = event.type.startsWith('touch') ||
        (event instanceof PointerEvent && event.pointerType === 'touch');
      if (!isTouch) event.preventDefault();
      event.stopImmediatePropagation();
    };
    const blockedEvents = [
      'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick',
      'auxclick', 'contextmenu', 'dragstart', 'drop', 'submit', 'touchstart', 'touchend'
    ];
    document.addEventListener('focusin', trapFocus, true);
    document.addEventListener('keydown', handleKey, true);
    blockedEvents.forEach((name) => document.addEventListener(name, blockInteraction, { capture: true, passive: false }));
    return () => {
      document.removeEventListener('focusin', trapFocus, true);
      document.removeEventListener('keydown', handleKey, true);
      blockedEvents.forEach((name) => document.removeEventListener(name, blockInteraction, true));
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    coachRef.current?.focus({ preventScroll: true });
    setUnavailableKey(null);
    let animationFrame = 0;
    let stopped = false;
    let missingTimer: number | null = null;
    let missingTimedOut = false;
    let currentTarget: HTMLElement | null = null;
    let scrolledTarget: HTMLElement | null = null;
    const scheduleMeasure = () => {
      if (!stopped && !animationFrame) animationFrame = window.requestAnimationFrame(measure);
    };
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    const measure = () => {
      animationFrame = 0;
      const coach = coachRef.current;
      if (!coach || stopped) return;
      let target: HTMLElement | null = null;
      if (targetSelector) {
        try {
          target = Array.from(document.querySelectorAll<HTMLElement>(targetSelector))
            .find((element) => !layerRef.current?.contains(element) && isVisible(element)) ?? null;
        } catch {
          // An unavailable target must never prevent continuing the tour.
        }
      }
      if (target !== currentTarget) {
        if (currentTarget) resizeObserver.unobserve(currentTarget);
        currentTarget = target;
        if (target) resizeObserver.observe(target);
      }
      if (target) {
        if (missingTimer !== null) window.clearTimeout(missingTimer);
        missingTimer = null;
        missingTimedOut = false;
        setUnavailableKey((key) => key === stepKey ? null : key);
      } else if (targetSelector && missingTimer === null && !missingTimedOut) {
        missingTimer = window.setTimeout(() => {
          missingTimer = null;
          missingTimedOut = true;
          setUnavailableKey(stepKey);
        }, 3000);
      }
      if (target && target !== scrolledTarget) {
        scrolledTarget = target;
        target.scrollIntoView({
          block: 'center', inline: 'nearest',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
        });
      }
      let spotlight: Rectangle | null = null;
      if (target) {
        const bounds = target.getBoundingClientRect();
        const left = clamp(bounds.left - 8, 0, window.innerWidth);
        const top = clamp(bounds.top - 8, 0, window.innerHeight);
        const right = clamp(bounds.right + 8, 0, window.innerWidth);
        const bottom = clamp(bounds.bottom + 8, 0, window.innerHeight);
        if (right > left && bottom > top) spotlight = { left, top, width: right - left, height: bottom - top };
      }
      const size = coach.getBoundingClientRect();
      const nextLayout = { key: stepKey, spotlight, coach: coachPosition(spotlight, size.width, size.height) };
      setLayout((previous) => JSON.stringify(previous) === JSON.stringify(nextLayout) ? previous : nextLayout);
    };
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => !layerRef.current?.contains(record.target))) scheduleMeasure();
    });
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true });
    if (coachRef.current) resizeObserver.observe(coachRef.current);
    window.addEventListener('resize', scheduleMeasure);
    document.addEventListener('scroll', scheduleMeasure, true);
    scheduleMeasure();
    return () => {
      stopped = true;
      window.cancelAnimationFrame(animationFrame);
      if (missingTimer !== null) window.clearTimeout(missingTimer);
      mutations.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      document.removeEventListener('scroll', scheduleMeasure, true);
    };
  }, [stepKey, targetSelector]);

  const currentLayout = layout?.key === stepKey ? layout : null;
  return createPortal(
    <div className="navigation-demo-layer" ref={layerRef}>
      <DemoShading holes={currentLayout?.spotlight ? [currentLayout.spotlight] : []} />
      {currentLayout?.spotlight ? (
        <div className="navigation-demo-spotlight" style={currentLayout.spotlight} aria-hidden="true" />
      ) : <div className="navigation-demo-scrim" aria-hidden="true" />}
      <div
        className={`navigation-demo-coach${currentLayout ? '' : ' is-centred'}`}
        ref={coachRef}
        style={currentLayout?.coach}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="navigation-demo-header">
          <p className="navigation-demo-progress">{section} · {stepIndex + 1} of {stepCount}</p>
          <button className="navigation-demo-exit" type="button" onClick={onExit} aria-label="Exit tour">Exit</button>
        </div>
        <div aria-live="polite" aria-atomic="true">
          <h2 id={titleId}>{title}</h2>
          <p className="navigation-demo-body" id={bodyId}>
            {unavailableKey === stepKey && unavailableBody ? unavailableBody : body}
          </p>
        </div>
        <div className="navigation-demo-actions">
          <button className="secondary-button" type="button" disabled={stepIndex === 0} onClick={onBack}>Back</button>
          <button className="primary-button" type="button" onClick={onNext}>{nextLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default NavigationDemoOverlay;
