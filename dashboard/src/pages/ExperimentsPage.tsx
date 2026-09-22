import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ExperimentRunMode } from './experiments/run/ExperimentRunMode';
import { ManualResultsView } from './experiments/view/ManualResultsView';
import { SensitivityResultsView } from './experiments/view/SensitivityResultsView';
import { ExperimentHeaderStartTarget } from '../components/ExperimentHeaderStartButton';
import type { ExperimentType } from './experiments/types';
import {
  clearScenarioDraft,
  createScenarioDraftId,
  readScenarioDraft,
  resumableScenarioDraftId,
  setActiveScenarioDraftId
} from '../lib/scenarioDraft';
import {
  clearSensitivityDraft,
  createSensitivityDraftId,
  readSensitivityDraft,
  resumableSensitivityDraftId,
  setActiveSensitivityDraftId
} from '../lib/sensitivityDraft';
import {
  buildExperimentDemoLaunchHref,
  clearExperimentDemoState,
  completeExperimentDemoChapter,
  commitExperimentDemoValue,
  continueExperimentDemoToSensitivity,
  createExperimentDemoProgress,
  experimentDemoLaunchMode,
  isExperimentDemoJourneyId,
  readExperimentDemoProgress,
  setExperimentDemoPaused,
  updateExperimentDemoStep,
  writeExperimentDemoProgress,
  persistPolicyPracticeProgress,
  updatePolicyPracticeRun,
  buildPolicyPracticeResultsHref,
  updateSensitivityPracticeRun,
  buildSensitivityPracticeResultsHref,
  type ExperimentDemoProgress,
  type ExperimentDemoProgressEvent,
  type ExperimentDemoStepProgressEvent
} from '../lib/experimentDemo';
import type { ExperimentDemoCoordinator, PolicyPracticeRun } from '../lib/guidedDemos/creation';
import { buildGuidedDemoHref, GUIDED_DEMOS, hasGuidedDemoExamples } from '../lib/guidedDemos/registry';
import { fetchResultsRuns } from '../lib/api';
import { policyExperimentDemoWizardStep } from '../components/PolicyExperimentDemo';
import { sensitivityExperimentDemoWizardStep } from '../components/SensitivityExperimentDemo';

interface ExperimentsPageProps {
  canWrite: boolean;
  canDownloadResults: boolean;
  canDeleteResults: boolean;
  deleteKeyRequired: boolean;
  authEnabled: boolean;
  workspace: ExperimentType;
  initialView?: 'create' | 'workspace';
}

export function ExperimentsPage({
  canWrite,
  canDownloadResults,
  canDeleteResults,
  deleteKeyRequired,
  authEnabled,
  workspace,
  initialView = 'workspace'
}: ExperimentsPageProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedJobRef = searchParams.get('jobRef')?.trim() ?? '';
  const baselineRunId = searchParams.get('baselineRunId')?.trim() || searchParams.get('runId')?.trim() || '';
  const comparisonRunId = searchParams.get('comparisonRunId')?.trim() ?? '';
  const experimentId = searchParams.get('experimentId')?.trim() ?? '';
  const queueInitiallyExpanded = searchParams.get('queue') === 'open';
  const [isSetupOpen, setIsSetupOpen] = useState(initialView === 'create');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [headerStartTarget, setHeaderStartTarget] = useState<HTMLSpanElement | null>(null);
  const draftId = searchParams.get('draft')?.trim() ?? '';
  const requestedDemoMode = experimentDemoLaunchMode(searchParams);
  const isExperimentDemo = requestedDemoMode !== null;
  const inlineSetup = initialView === 'create';
  const setupVisible = inlineSetup || (isExperimentDemo && isSetupOpen);
  const queryJourneyId = searchParams.get('journey')?.trim() ?? '';
  const currentDemoChapter = workspace === 'manual' ? 'policy' : 'sensitivity';
  const [policyExampleAvailable, setPolicyExampleAvailable] = useState(false);
  const [demoProgress, setDemoProgress] = useState<ExperimentDemoProgress | null>(() => {
    if (!requestedDemoMode || !isExperimentDemoJourneyId(queryJourneyId)) return null;
    const stored = readExperimentDemoProgress();
    return stored?.journeyId === queryJourneyId && stored.mode === requestedDemoMode ? stored : null;
  });
  const pendingDemoProgressRef = useRef<ExperimentDemoProgress | null>(demoProgress);
  const resumeDemoButtonRef = useRef<HTMLButtonElement>(null);
  const setupHeadingRef = useRef<HTMLHeadingElement>(null);
  const effectiveDraftId = isExperimentDemo
    ? demoProgress?.[currentDemoChapter].draftId ?? ''
    : draftId;

  const returnToExperiments = useCallback(() => {
    setIsSetupOpen(false);
    navigate('/experiments');
  }, [navigate]);

  const startOver = () => {
    if (!effectiveDraftId || isExperimentDemo || isSubmitting) return;
    const storedDraft = workspace === 'manual'
      ? readScenarioDraft(effectiveDraftId)
      : readSensitivityDraft(effectiveDraftId);
    if (storedDraft && !window.confirm('Clear setup? This will restore the default settings and return to step 1.')) return;

    const nextDraftId = workspace === 'manual' ? createScenarioDraftId() : createSensitivityDraftId();
    if (workspace === 'manual') {
      clearScenarioDraft(effectiveDraftId);
      setActiveScenarioDraftId(nextDraftId);
    } else {
      clearSensitivityDraft(effectiveDraftId);
      setActiveSensitivityDraftId(nextDraftId);
    }
    // A new identity resets both the controller and the wizard to step 1. Drop evidence-return
    // and job-following parameters too, so they cannot override the fresh setup's defaults.
    setSearchParams(new URLSearchParams({ draft: nextDraftId }), { replace: true });
    setupHeadingRef.current?.focus();
  };

  useEffect(() => {
    if (!setupVisible) return;
    if (requestedDemoMode) {
      let progress = pendingDemoProgressRef.current;
      const hasMatchingJourney = Boolean(
        progress &&
        progress.mode === requestedDemoMode &&
        (!queryJourneyId || progress.journeyId === queryJourneyId)
      );
      if (!hasMatchingJourney) {
        clearExperimentDemoState();
        progress = createExperimentDemoProgress(
          requestedDemoMode,
          isExperimentDemoJourneyId(queryJourneyId) ? queryJourneyId : undefined
        );
        pendingDemoProgressRef.current = progress;
        writeExperimentDemoProgress(progress);
        setDemoProgress(progress);
      }
      if (!progress) return;

      const expectedChapter = progress.mode === 'policy'
        ? 'policy'
        : progress.mode === 'sensitivity'
          ? 'sensitivity'
          : progress.phase === 'policy' || progress.phase === 'policy-transition'
            ? 'policy'
            : 'sensitivity';
      if (expectedChapter !== currentDemoChapter) {
        navigate(
          buildExperimentDemoLaunchHref(progress.mode, progress.journeyId, expectedChapter),
          { replace: true }
        );
        return;
      }

      const submitted = progress[currentDemoChapter].submission;
      if (submitted?.status === 'submitted' && submitted.runId && submitted.jobRef) {
        clearExperimentDemoState(progress.journeyId);
        pendingDemoProgressRef.current = null;
        setDemoProgress(null);
        navigate(currentDemoChapter === 'policy'
          ? buildPolicyPracticeResultsHref(submitted.runId, submitted.jobRef)
          : buildSensitivityPracticeResultsHref(submitted.runId, submitted.jobRef), { replace: true });
        return;
      }

      const next = new URLSearchParams(searchParams);
      next.set('demo', 'experiment');
      next.set('mode', progress.mode);
      next.set('journey', progress.journeyId);
      next.set('draft', progress[currentDemoChapter].draftId);
      next.delete('segment');
      next.delete('step');
      if (next.toString() !== searchParams.toString()) {
        setSearchParams(next, { replace: true });
      }
      return;
    }
    if (draftId) {
      if (workspace === 'manual') setActiveScenarioDraftId(draftId);
      else setActiveSensitivityDraftId(draftId);
      return;
    }
    // Reopening picks up the draft the last close left behind; only starting over or submitting
    // retires it, so a fresh id is minted just for a genuinely new scenario.
    const nextDraftId = workspace === 'manual'
      ? resumableScenarioDraftId() || createScenarioDraftId()
      : resumableSensitivityDraftId() || createSensitivityDraftId();
    if (workspace === 'manual') setActiveScenarioDraftId(nextDraftId);
    else setActiveSensitivityDraftId(nextDraftId);
    const next = new URLSearchParams(searchParams);
    next.set('draft', nextDraftId);
    setSearchParams(next, { replace: true });
  }, [
    currentDemoChapter,
    draftId,
    setupVisible,
    navigate,
    queryJourneyId,
    requestedDemoMode,
    searchParams,
    setSearchParams,
    workspace
  ]);

  const updateSearch = useCallback((updates: Record<string, string>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const updateDemoProgress = useCallback((
    update: (current: ExperimentDemoProgress) => ExperimentDemoProgress
  ) => {
    setDemoProgress((current) => {
      const base = current ?? readExperimentDemoProgress();
      if (!base) return current;
      const next = update(base);
      if (next !== base) {
        pendingDemoProgressRef.current = next;
        writeExperimentDemoProgress(next);
      }
      return next;
    });
  }, []);

  const pauseExperimentDemo = useCallback(() => {
    if (!demoProgress) return;
    updateDemoProgress((current) => setExperimentDemoPaused(current, demoProgress.journeyId, true));
  }, [demoProgress, updateDemoProgress]);

  const resumeExperimentDemo = useCallback(() => {
    if (!demoProgress) return;
    updateDemoProgress((current) => setExperimentDemoPaused(current, demoProgress.journeyId, false));
  }, [demoProgress, updateDemoProgress]);

  useEffect(() => {
    if (isExperimentDemo && demoProgress?.paused) resumeDemoButtonRef.current?.focus();
  }, [demoProgress?.paused, isExperimentDemo]);

  const exitExperimentDemo = useCallback(() => {
    clearExperimentDemoState(demoProgress?.journeyId ?? '');
    pendingDemoProgressRef.current = null;
    setDemoProgress(null);
    setIsSetupOpen(false);
    navigate('/');
  }, [demoProgress?.journeyId, navigate]);

  const recordDemoStep = useCallback((event: ExperimentDemoStepProgressEvent) => {
    updateDemoProgress((current) => updateExperimentDemoStep(current, event));
  }, [updateDemoProgress]);

  const recordDemoChapterComplete = useCallback((event: ExperimentDemoProgressEvent) => {
    updateDemoProgress((current) => completeExperimentDemoChapter(current, event));
  }, [updateDemoProgress]);

  const recordDemoCommit = useCallback((field: 'name' | 'bankRate', value: string) => {
    if (!demoProgress) return;
    updateDemoProgress((current) => commitExperimentDemoValue(current, {
      journeyId: demoProgress.journeyId, chapter: currentDemoChapter,
      draftId: demoProgress[currentDemoChapter].draftId, field, value
    }));
  }, [currentDemoChapter, demoProgress, updateDemoProgress]);

  const recordPolicyRun = useCallback((run: PolicyPracticeRun | undefined) => {
    const current = pendingDemoProgressRef.current;
    if (!current || currentDemoChapter !== 'policy') throw new Error('Open the policy practice guide before starting this run.');
    const next = updatePolicyPracticeRun(current, {
      journeyId: current.journeyId, chapter: 'policy', draftId: current.policy.draftId, run
    });
    // Synchronous persistence closes the refresh window before the controller starts its POST.
    persistPolicyPracticeProgress(next);
    pendingDemoProgressRef.current = next;
    setDemoProgress(next);
  }, [currentDemoChapter]);

  const endSubmittedPractice = useCallback(() => {
    const progress = pendingDemoProgressRef.current;
    if (!isExperimentDemo || !progress) return;
    clearExperimentDemoState(progress.journeyId);
    pendingDemoProgressRef.current = null;
    setDemoProgress(null);
  }, [isExperimentDemo]);

  const viewPolicyPracticeRun = useCallback(() => {
    const progress = pendingDemoProgressRef.current;
    const run = progress?.policy.submission;
    if (progress && run?.status === 'submitted' && run.runId && run.jobRef) {
      endSubmittedPractice();
      navigate(buildPolicyPracticeResultsHref(run.runId, run.jobRef), { replace: true });
    }
  }, [endSubmittedPractice, navigate]);

  const recordSensitivityRun = useCallback((run: PolicyPracticeRun | undefined) => {
    const current = pendingDemoProgressRef.current;
    if (!current || currentDemoChapter !== 'sensitivity') throw new Error('Open the sensitivity practice guide before starting this analysis.');
    const next = updateSensitivityPracticeRun(current, {
      journeyId: current.journeyId, chapter: 'sensitivity', draftId: current.sensitivity.draftId, run
    });
    persistPolicyPracticeProgress(next);
    pendingDemoProgressRef.current = next;
    setDemoProgress(next);
  }, [currentDemoChapter]);

  const viewSensitivityPracticeRun = useCallback(() => {
    const progress = pendingDemoProgressRef.current;
    const run = progress?.sensitivity.submission;
    if (progress && run?.status === 'submitted' && run.runId && run.jobRef) {
      endSubmittedPractice();
      navigate(buildSensitivityPracticeResultsHref(run.runId, run.jobRef), { replace: true });
    }
  }, [endSubmittedPractice, navigate]);

  useEffect(() => {
    if (!isExperimentDemo || currentDemoChapter !== 'policy') return;
    let cancelled = false;
    void fetchResultsRuns(true).then((runs) => {
      const policyDemo = GUIDED_DEMOS.find((demo) => demo.id === 'policy-results');
      if (!cancelled) setPolicyExampleAvailable(Boolean(policyDemo && hasGuidedDemoExamples(policyDemo, runs.filter((run) => run.isExample).map((run) => run.runId), [])));
    }).catch(() => { if (!cancelled) setPolicyExampleAvailable(false); });
    return () => { cancelled = true; };
  }, [currentDemoChapter, isExperimentDemo]);

  const explorePolicyExample = useCallback(() => {
    if (!demoProgress || !policyExampleAvailable) return;
    const href = buildGuidedDemoHref('policy-results');
    navigate(`${href}&from=policy&journey=${encodeURIComponent(demoProgress.journeyId)}`);
  }, [demoProgress, navigate, policyExampleAvailable]);

  const continueToSensitivityDemo = useCallback(() => {
    if (!demoProgress) return;
    const next = continueExperimentDemoToSensitivity(demoProgress, demoProgress.journeyId);
    if (next === demoProgress) return;
    pendingDemoProgressRef.current = next;
    writeExperimentDemoProgress(next);
    setDemoProgress(next);
    navigate(buildExperimentDemoLaunchHref(next.mode, next.journeyId, 'sensitivity'));
  }, [demoProgress, navigate]);

  const experimentDemo = useMemo<ExperimentDemoCoordinator | undefined>(() => {
    if (!isExperimentDemo || !demoProgress) return undefined;
    return {
      active: true,
      paused: demoProgress.paused,
      journeyId: demoProgress.journeyId,
      draftId: demoProgress[currentDemoChapter].draftId,
      mode: demoProgress.mode,
      savedStepId: demoProgress[currentDemoChapter].stepId,
      committedValues: demoProgress[currentDemoChapter].committedValues ?? {},
      policyRun: currentDemoChapter === 'policy' ? demoProgress.policy.submission : undefined,
      allowPolicySubmission: currentDemoChapter === 'policy' && !demoProgress.paused && demoProgress.policy.stepId === 'policy-submit' && !demoProgress.policy.submission,
      onPolicyRunChange: currentDemoChapter === 'policy' ? recordPolicyRun : undefined,
      sensitivityRun: currentDemoChapter === 'sensitivity' ? demoProgress.sensitivity.submission : undefined,
      allowSensitivitySubmission: currentDemoChapter === 'sensitivity' && !demoProgress.paused && demoProgress.sensitivity.stepId === 'sensitivity-submit' && !demoProgress.sensitivity.submission,
      onSensitivityRunChange: currentDemoChapter === 'sensitivity' ? recordSensitivityRun : undefined,
      onViewSubmittedRun: demoProgress[currentDemoChapter].submission?.status === 'submitted'
        ? currentDemoChapter === 'policy' ? viewPolicyPracticeRun : viewSensitivityPracticeRun : undefined,
      onCommit: recordDemoCommit,
      onProgress: recordDemoStep,
      onChapterComplete: recordDemoChapterComplete,
      onContinueToSensitivity: continueToSensitivityDemo,
      onExploreResults: currentDemoChapter === 'policy' && !demoProgress.policy.submission && policyExampleAvailable ? explorePolicyExample : undefined,
      onFinish: exitExperimentDemo,
      onPause: pauseExperimentDemo,
      onExit: exitExperimentDemo
    };
  }, [
    continueToSensitivityDemo,
    currentDemoChapter,
    demoProgress,
    exitExperimentDemo,
    isExperimentDemo,
    pauseExperimentDemo,
    recordDemoChapterComplete,
    recordDemoStep,
    recordDemoCommit,
    policyExampleAvailable,
    explorePolicyExample,
    recordPolicyRun,
    viewPolicyPracticeRun,
    recordSensitivityRun,
    viewSensitivityPracticeRun
  ]);

  const initialScenarioStep = isExperimentDemo && demoProgress
    ? demoProgress.paused ? undefined : policyExperimentDemoWizardStep(demoProgress.policy.stepId)
    : searchParams.get('step') === 'model-version' ? 1 : undefined;
  const initialSensitivityStep = isExperimentDemo && demoProgress
    ? demoProgress.paused ? undefined : sensitivityExperimentDemoWizardStep(demoProgress.sensitivity.stepId)
    : searchParams.get('step') === 'model-baseline' ? 2 : undefined;

  useEffect(() => {
    // Evidence returns choose an initial section once; subsequent reloads resume saved progress.
    if (!inlineSetup || !effectiveDraftId || !searchParams.has('step')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('step');
    setSearchParams(next, { replace: true });
  }, [effectiveDraftId, inlineSetup, searchParams, setSearchParams]);

  useEffect(() => {
    if (inlineSetup) setupHeadingRef.current?.focus({ preventScroll: true });
  }, [inlineSetup, workspace]);

  useEffect(() => {
    if (!setupVisible || inlineSetup) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [inlineSetup, setupVisible]);

  const copy = useMemo(() => workspace === 'manual' ? {
    heading: 'Policy scenarios',
    description: 'Create, monitor and inspect policy scenarios in one workspace.',
    createAction: 'Create new policy scenario',
    modalEyebrow: 'Policy experiment',
    modalHeading: 'Create new policy scenario',
    modalDescription: 'Choose the policy features to test, review the setup, then start the model run.'
  } : {
    heading: 'Sensitivity analysis',
    description: 'Create, monitor and inspect policy sensitivity sweeps in one workspace.',
    createAction: 'New sensitivity analysis',
    modalEyebrow: 'Sensitivity analysis',
    modalHeading: 'Create sensitivity analysis',
    modalDescription: 'Choose the policy instrument and tested range, review the setup, then start the analysis.'
  }, [workspace]);

  return (
    <section className="run-exp-layout workspace-page">
      {initialView !== 'create' && <article className="results-card workspace-heading">
        <div>
          <h2>{copy.heading}</h2>
          <p>{copy.description}</p>
        </div>
        <div className="workspace-heading-actions">
          <button
            type="button"
            className="primary-button scenario-launch-button"
            onClick={() => navigate(workspace === 'manual' ? '/scenarios/new' : '/sensitivity/new')}
          >
            {copy.createAction}
          </button>
        </div>
      </article>}

      {/* Practice uses the same current page layout and real controls as ordinary creation. */}
      <div
        hidden={!setupVisible}
        className={inlineSetup ? 'experiment-setup-workspace' : 'scenario-create-modal-backdrop'}
        role={inlineSetup ? undefined : 'presentation'}
      >
        <section
          className={inlineSetup ? 'experiment-setup-content' : 'scenario-create-modal'}
          role={inlineSetup ? 'region' : 'dialog'}
          aria-modal={inlineSetup ? undefined : true}
          aria-labelledby={inlineSetup ? 'experiment-setup-title' : 'experiment-create-modal-title'}
        >
          <div className={inlineSetup ? 'experiment-setup-heading' : 'scenario-create-modal-head'}>
            <div>
              {!inlineSetup && <p className="trend-modal-eyebrow">{copy.modalEyebrow}</p>}
              <h2
                id={inlineSetup ? 'experiment-setup-title' : 'experiment-create-modal-title'}
                ref={setupHeadingRef}
                className={inlineSetup ? 'visually-hidden' : undefined}
                tabIndex={inlineSetup ? -1 : undefined}
              >{copy.modalHeading}</h2>
              <p>{copy.modalDescription}</p>
            </div>
            <div className="scenario-modal-head-actions">
              {inlineSetup && <span ref={setHeaderStartTarget} style={{ display: 'inline-flex' }} />}
              {!isExperimentDemo && (inlineSetup || effectiveDraftId) && (
                <button
                  type="button"
                  className="danger-button scenario-discard-draft-button scenario-start-over-button"
                  disabled={!effectiveDraftId || isSubmitting}
                  onClick={startOver}
                >Clear</button>
              )}
              {!inlineSetup && <button
                type="button"
                className="trend-modal-close"
                aria-label={isExperimentDemo
                  ? 'End experiment creation demo'
                  : `Close ${workspace === 'manual' ? 'scenario' : 'sensitivity'} setup`}
                onClick={isExperimentDemo ? exitExperimentDemo : returnToExperiments}
              >×</button>}
            </div>
          </div>
          <div className={inlineSetup ? 'experiment-setup-body' : 'scenario-create-modal-body'}>
            {isExperimentDemo && demoProgress?.paused && (
              <div className="info-banner experiment-demo-paused-banner" role="status">
                <span>Start is disabled while editing this practice draft.</span>{' '}
                <button ref={resumeDemoButtonRef} type="button" className="secondary-button" onClick={resumeExperimentDemo}>Resume guide</button>{' '}
                <button type="button" className="secondary-button" onClick={exitExperimentDemo}>Finish practice</button>
              </div>
            )}
            {setupVisible && !effectiveDraftId && (
              <div className="scenario-builder-loading" role="status">
                <p className="loading-banner">Preparing experiment setup...</p>
              </div>
            )}
            {setupVisible && effectiveDraftId && <ExperimentHeaderStartTarget.Provider value={inlineSetup ? headerStartTarget : null}><ExperimentRunMode
              key={isExperimentDemo ? `${demoProgress?.journeyId ?? 'experiment-demo-loading'}:${effectiveDraftId}` : `${workspace}:${effectiveDraftId}`}
              activeType={workspace}
              canWrite={canWrite}
              canDownloadResults={canDownloadResults}
              canDeleteResults={canDeleteResults}
              deleteKeyRequired={deleteKeyRequired}
              authEnabled={authEnabled}
              selectedJobRef={selectedJobRef}
              followJobRef={searchParams.get('follow') === '1' ? selectedJobRef : ''}
              showRunManagement={false}
              draftId={effectiveDraftId}
              initialScenarioStep={initialScenarioStep}
              initialSensitivityStep={initialSensitivityStep}
              experimentDemo={experimentDemo}
              onSubmissionStateChange={setIsSubmitting}
              onManualRunAccepted={(runId, jobRef) => {
                const progress = pendingDemoProgressRef.current;
                endSubmittedPractice();
                navigate(isExperimentDemo && progress
                  ? buildPolicyPracticeResultsHref(runId, jobRef)
                  : `/results?type=manual&presentation=report&queue=open${jobRef ? `&jobRef=${encodeURIComponent(jobRef)}` : ''}${runId ? `&baselineRunId=${encodeURIComponent(runId)}` : ''}`,
                { replace: true });
              }}
              onSensitivityRunAccepted={(id, jobRef) => {
                const progress = pendingDemoProgressRef.current;
                endSubmittedPractice();
                navigate(isExperimentDemo && progress
                  ? buildSensitivityPracticeResultsHref(id, jobRef)
                  : `/results?type=sensitivity&presentation=report&queue=open${jobRef ? `&jobRef=${encodeURIComponent(jobRef)}` : ''}${id ? `&experimentId=${encodeURIComponent(id)}` : ''}`,
                { replace: true });
              }}
              onSelectedJobRefChange={(jobRef) => updateSearch({ jobRef })}
              onOpenManualResults={(runId) => {
                setIsSetupOpen(false);
                navigate(`/results?type=manual&baselineRunId=${encodeURIComponent(runId)}`);
              }}
              onOpenSensitivityResults={(id) => {
                setIsSetupOpen(false);
                navigate(`/results?type=sensitivity&experimentId=${encodeURIComponent(id)}`);
              }}
            /></ExperimentHeaderStartTarget.Provider>}
          </div>
        </section>
      </div>

      {initialView !== 'create' && (workspace === 'manual' ? (
        <ManualResultsView
          canWrite={canWrite}
          canDownloadResults={canDownloadResults}
          canDeleteResults={canDeleteResults}
          deleteKeyRequired={deleteKeyRequired}
          authEnabled={authEnabled}
          requestedBaselineRunId={baselineRunId}
          requestedComparisonRunId={comparisonRunId}
          queueInitiallyExpanded={queueInitiallyExpanded}
          onManualSelectionChange={(selection) => updateSearch(selection)}
          sidebarSubtitle="Manage policy scenario runs"
        />
      ) : (
        <SensitivityResultsView
          canWrite={canWrite}
          canDownloadResults={canDownloadResults}
          canDeleteResults={canDeleteResults}
          deleteKeyRequired={deleteKeyRequired}
          authEnabled={authEnabled}
          requestedExperimentId={experimentId}
          queueInitiallyExpanded={queueInitiallyExpanded}
          onSelectedExperimentIdChange={(value) => updateSearch({ experimentId: value })}
          sidebarSubtitle="Completed and in-progress sensitivity analyses"
        />
      ))}
    </section>
  );
}
