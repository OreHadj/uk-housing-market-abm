import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchResultsRuns, fetchSensitivityExperiments } from '../lib/api';
import { buildGuidedDemoHref, guidedDemoExitHref, guidedDemoState, hasGuidedDemoExamples, isGuidedActionComplete } from '../lib/guidedDemos/registry';
import { GuidedTourOverlay } from './GuidedTourOverlay';
import './GuidedTourOverlay.css';
import { buildExperimentDemoLaunchHref, readExperimentDemoProgress } from '../lib/experimentDemo';

/** URL-owned progress, with navigation only on entry into a different stop. */
export function GuidedDemo() {
  const location = useLocation();
  const navigate = useNavigate();
  const search = new URLSearchParams(location.search);
  const state = guidedDemoState(search);
  const identity = state ? `${state.definition.id}:${state.completed ? 'complete' : state.step.id}` : '';
  const entered = useRef('');
  const [availability, setAvailability] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [domComplete, setDomComplete] = useState(false);
  const definition = state?.definition;
  const needsExamples = Boolean(definition?.requiredRunIds.length || definition?.requiredExperimentIds.length);
  const completion = state?.step.completion;
  const isModelInformation = definition?.id === 'model-information';
  const evidenceView = state?.step.query.view;
  const evidenceLabel = evidenceView === 'validation' ? 'Validation' : 'Calibration';
  const [modelContext, setModelContext] = useState<{
    identity: string; availability: 'loading' | 'ready' | 'missing'; message: string;
  }>({ identity: '', availability: 'loading', message: '' });

  // The two pages expose readiness only after the requested model and evidence match.
  // Check each new step before paint so same-page moves do not flash a loading screen.
  useLayoutEffect(() => {
    if (!isModelInformation) return;
    const attribute = evidenceView === 'validation'
      ? 'data-model-information-validation-state' : 'data-model-information-calibration-state';
    const update = () => {
      const page = document.querySelector(`[${attribute}]`);
      const status = page?.getAttribute(attribute);
      const next = {
        identity,
        availability: status === 'ready' ? 'ready' as const : status === 'unavailable' ? 'missing' as const : 'loading' as const,
        message: page?.getAttribute('data-model-information-message') ?? ''
      };
      setModelContext((current) => current.identity === next.identity && current.availability === next.availability && current.message === next.message ? current : next);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: [attribute, 'data-model-information-message'] });
    return () => observer.disconnect();
  }, [evidenceView, identity, isModelInformation]);

  useEffect(() => {
    if (!definition || !needsExamples) return;
    let cancelled = false;
    setAvailability('loading');
    void Promise.allSettled([fetchResultsRuns(true), fetchSensitivityExperiments(true)]).then(([runs, experiments]) => {
      const runIds = runs.status === 'fulfilled' ? runs.value.filter((run) => run.isExample).map((run) => run.runId) : [];
      const experimentIds = experiments.status === 'fulfilled' ? experiments.value.experiments.filter((experiment) => experiment.isExample).map((experiment) => experiment.experimentId) : [];
      if (!cancelled) setAvailability(hasGuidedDemoExamples(definition, runIds, experimentIds) ? 'ready' : 'missing');
    }).catch(() => { if (!cancelled) setAvailability('missing'); });
    return () => { cancelled = true; };
  }, [definition, needsExamples]);

  useEffect(() => {
    if (search.get('demo') === 'navigation') {
      const next = new URLSearchParams(search);
      for (const key of ['demo', 'tour', 'step']) next.delete(key);
      navigate(`${location.pathname}${next.size ? `?${next}` : ''}`, { replace: true });
      return;
    }
    if (entered.current === identity) return;
    const wasActive = Boolean(entered.current);
    entered.current = identity;
    if (!state) {
      if (wasActive) {
        const returnFocus = document.querySelector<HTMLElement>('.trend-modal-close') ?? document.getElementById('main-workspace');
        returnFocus?.focus({ preventScroll: true });
      }
      return;
    }
    const href = buildGuidedDemoHref(state.definition.id, state.index, search, true);
    if (href !== `${location.pathname}${location.search}`) navigate(href, { replace: true });
  });

  useEffect(() => {
    if (completion?.kind !== 'selector') { setDomComplete(false); return; }
    const update = () => setDomComplete(isGuidedActionComplete(completion, new URLSearchParams(), document));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'open', 'class'] });
    return () => observer.disconnect();
  }, [completion]);

  if (!state) return null;
  const exit = () => navigate(guidedDemoExitHref(location.pathname, search), { replace: true });
  const { index, completed } = state;
  const finishOnPage = Boolean(state.definition.finishOnLastStep && index >= state.definition.steps.length - 1);
  const finishOnAction = finishOnPage && state.step.kind === 'action';
  const practice = completed && state.definition.id === 'policy-results' && search.get('from') === 'policy' ? readExperimentDemoProgress() : null;
  const returnToPractice = practice && practice.journeyId === search.get('journey')
    ? () => navigate(buildExperimentDemoLaunchHref(practice.mode, practice.journeyId, 'policy'))
    : null;
  const step = completed && !finishOnPage ? {
    id: 'complete', ...state.definition.completion, kind: 'info' as const, target: null, unavailableBody: ''
  } : state.step;
  const evidenceAvailability = modelContext.identity === identity ? modelContext.availability : 'loading';
  const currentAvailability = isModelInformation ? evidenceAvailability : needsExamples ? availability : 'ready';
  return <GuidedTourOverlay
    demoLabel={isModelInformation ? evidenceLabel : state.definition.label} step={step}
    stepIndex={Math.min(index, state.definition.steps.length - 1)} stepCount={state.definition.steps.length}
    isComplete={completed && !finishOnPage || (completion?.kind === 'selector' ? domComplete : isGuidedActionComplete(completion, search))}
    availability={currentAvailability}
    loadingTitle={isModelInformation ? `Opening ${evidenceLabel}` : undefined}
    loadingBody={isModelInformation ? evidenceView === 'validation'
      ? 'Opening the evidence for the same model and year.'
      : 'Loading the selected model and evidence.' : undefined}
    unavailableTitle={isModelInformation ? 'Model evidence is unavailable' : undefined}
    unavailableBody={isModelInformation ? modelContext.message || 'Evidence for this model is unavailable. Exit to choose another model.' : undefined}
    onBack={() => navigate(buildGuidedDemoHref(state.definition.id, index - 1, search))}
    onNext={() => finishOnAction ? exit() : navigate(buildGuidedDemoHref(state.definition.id, index + 1, search))}
    nextLabel={finishOnAction ? 'Finish' : state.step.nextLabel}
    onExit={exit}
    showExit={!((completed || finishOnPage) && currentAvailability !== 'missing')}
    onChooseAnotherDemo={() => navigate('/?chooseDemo=1')}
    completionActions={(completed || finishOnPage) && !finishOnAction ? [
      { id: 'finish', label: 'Finish', onClick: exit, primary: true },
      ...(returnToPractice ? [{ id: 'return-to-practice', label: 'Return to your practice draft', onClick: returnToPractice }] : [])
    ] : undefined}
  />;
}
