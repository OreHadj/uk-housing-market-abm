import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { buildNavigationDemoHref, navigationDemoExitHref, navigationDemoState } from '../lib/navigationDemo';
import { NavigationDemoOverlay } from './NavigationDemoOverlay';

/** URL-owned progress survives refresh, browser Back, and page-specific result selection. */
export function NavigationDemo() {
  const location = useLocation();
  const navigate = useNavigate();
  const search = new URLSearchParams(location.search);
  const state = navigationDemoState(search);
  const wasActive = useRef(false);
  const active = state !== null;

  useEffect(() => {
    const ended = wasActive.current && !active;
    wasActive.current = active;
    if (!ended) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('main-workspace')?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    const currentSearch = new URLSearchParams(location.search);
    const current = navigationDemoState(currentSearch);
    if (!current) return;
    const onStepPage = location.pathname === current.step.path
      && Object.entries(current.step.query ?? {}).every(([key, value]) => currentSearch.get(key) === value);
    if (!onStepPage) navigate(buildNavigationDemoHref(current.mode, current.index, currentSearch), { replace: true });
  }, [location.pathname, location.search, navigate]);

  if (!state) return null;
  const { mode, index, step, steps } = state;
  const finish = () => navigate(navigationDemoExitHref(location.pathname, search), { replace: true });

  return <NavigationDemoOverlay
    key={`${mode}:${step.id}`}
    title={step.title}
    body={step.body}
    section={step.section}
    stepIndex={index}
    stepCount={steps.length}
    targetSelector={step.targetSelector}
    unavailableBody={step.unavailableBody}
    nextLabel={index === steps.length - 1 ? 'Finish and explore' : index === 0 && mode === 'full' ? 'Show me the results' : 'Next'}
    onNext={index === steps.length - 1 ? finish : () => navigate(buildNavigationDemoHref(mode, index + 1, search))}
    onBack={() => navigate(buildNavigationDemoHref(mode, index - 1, search))}
    onExit={finish}
  />;
}
