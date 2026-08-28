import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  buildModelEvidenceCalibrationUrl,
  buildModelEvidenceValidationUrl,
  clearCombinedModelEvidenceDemoProgress,
  clearModelEvidenceDemoChildProgress,
  completeModelEvidenceCalibration,
  completeModelEvidenceValidation,
  createModelEvidenceDemoProgress,
  isModelEvidenceDemoRequested,
  MODEL_EVIDENCE_CALIBRATION_COMPLETION_EVENT,
  MODEL_EVIDENCE_DEMO_COMPLETION_EVENT,
  MODEL_EVIDENCE_VALIDATION_SESSION_KEY,
  readModelEvidenceDemoProgress,
  type ModelEvidenceDemoProgress,
  writeModelEvidenceDemoProgress
} from '../lib/modelEvidenceDemo';
import { ComparePage, type CalibrationModelEvidenceDemoContext } from './ComparePage';
import { ValidationPage, type ValidationModelEvidenceDemoContext } from './ValidationPage';

const EVIDENCE_VIEWS = [
  {
    id: 'calibration',
    label: 'Calibration',
    description: 'Review the evidence and assumptions used to configure each model version.'
  },
  {
    id: 'validation',
    label: 'Validation',
    description: 'Compare model outputs with independent UK evidence.'
  }
] as const;

type EvidenceView = (typeof EVIDENCE_VIEWS)[number]['id'];

function isEvidenceView(value: string): value is EvidenceView {
  return EVIDENCE_VIEWS.some((view) => view.id === value);
}

function completionDetail(event: Event): unknown {
  return event instanceof CustomEvent ? event.detail : null;
}

/** Coordinates the two independent evidence tours without merging their step or page state. */
export function ModelEvidencePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedView = searchParams.get('view')?.trim() ?? '';
  const activeView: EvidenceView = isEvidenceView(requestedView) ? requestedView : 'calibration';
  const combinedDemoRequested = isModelEvidenceDemoRequested(searchParams);
  const [demoProgress, setDemoProgress] = useState<ModelEvidenceDemoProgress | null>(() =>
    combinedDemoRequested ? readModelEvidenceDemoProgress() : null
  );

  useEffect(() => {
    if (!combinedDemoRequested) {
      if (demoProgress) setDemoProgress(null);
      return;
    }
    if (demoProgress) return;
    const saved = readModelEvidenceDemoProgress();
    if (saved) {
      setDemoProgress(saved);
      return;
    }
    clearCombinedModelEvidenceDemoProgress();
    const fresh = createModelEvidenceDemoProgress();
    writeModelEvidenceDemoProgress(fresh);
    setDemoProgress(fresh);
  }, [combinedDemoRequested, demoProgress]);

  useEffect(() => {
    if (!combinedDemoRequested) return;
    const handleCalibrationComplete = (event: Event) => {
      setDemoProgress((current) => {
        if (!current) return current;
        const next = completeModelEvidenceCalibration(current, completionDetail(event));
        if (next !== current) writeModelEvidenceDemoProgress(next);
        return next;
      });
    };
    const handleValidationComplete = (event: Event) => {
      setDemoProgress((current) => {
        if (!current) return current;
        const next = completeModelEvidenceValidation(current, completionDetail(event));
        if (next !== current) writeModelEvidenceDemoProgress(next);
        return next;
      });
    };
    window.addEventListener(MODEL_EVIDENCE_CALIBRATION_COMPLETION_EVENT, handleCalibrationComplete);
    window.addEventListener(MODEL_EVIDENCE_DEMO_COMPLETION_EVENT, handleValidationComplete);
    return () => {
      window.removeEventListener(MODEL_EVIDENCE_CALIBRATION_COMPLETION_EVENT, handleCalibrationComplete);
      window.removeEventListener(MODEL_EVIDENCE_DEMO_COMPLETION_EVENT, handleValidationComplete);
    };
  }, [combinedDemoRequested]);

  useEffect(() => {
    if (!combinedDemoRequested || !demoProgress) return;
    if (demoProgress.phase === 'calibration-review') {
      const pairIsRestored =
        activeView === 'calibration' &&
        searchParams.get('mode') === 'compare' &&
        searchParams.get('right') === demoProgress.calibrationPrimaryVersion &&
        searchParams.get('left') === demoProgress.calibrationComparisonVersion;
      if (!pairIsRestored) {
        navigate(buildModelEvidenceCalibrationUrl(
          demoProgress.calibrationPrimaryVersion,
          demoProgress.calibrationComparisonVersion
        ), { replace: true });
      }
      return;
    }
    if (demoProgress.phase === 'validation' || demoProgress.phase === 'complete') {
      if (activeView !== 'validation') {
        navigate(buildModelEvidenceValidationUrl(demoProgress.calibrationPrimaryVersion), { replace: true });
      }
      return;
    }
    if (activeView !== 'calibration') {
      navigate(buildModelEvidenceCalibrationUrl(
        demoProgress.calibrationPrimaryVersion,
        demoProgress.calibrationComparisonVersion
      ), { replace: true });
    }
  }, [activeView, combinedDemoRequested, demoProgress, navigate, searchParams]);

  const selectView = useCallback(
    (view: EvidenceView) => {
      const next = new URLSearchParams(searchParams);
      next.set('view', view);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const updateCalibrationContext = useCallback((primaryVersion: string, comparisonVersion: string) => {
    setDemoProgress((current) => {
      if (!current || current.phase !== 'calibration') return current;
      if (
        current.calibrationPrimaryVersion === primaryVersion &&
        current.calibrationComparisonVersion === comparisonVersion
      ) return current;
      const next = {
        ...current,
        calibrationPrimaryVersion: primaryVersion,
        calibrationComparisonVersion: comparisonVersion
      };
      writeModelEvidenceDemoProgress(next);
      return next;
    });
  }, []);

  const pauseCombinedDemo = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('demo');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const exitCombinedDemoToHome = useCallback(() => {
    clearCombinedModelEvidenceDemoProgress();
    navigate('/');
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('nav.main a[href="/"]')?.focus({ preventScroll: true });
    });
  }, [navigate]);

  const continueToValidation = useCallback(() => {
    if (!demoProgress?.calibrationComplete || !demoProgress.calibrationPrimaryVersion) return;
    if (!demoProgress.validationStarted) {
      clearModelEvidenceDemoChildProgress(MODEL_EVIDENCE_VALIDATION_SESSION_KEY);
    }
    const next = { ...demoProgress, phase: 'validation' as const, validationStarted: true };
    writeModelEvidenceDemoProgress(next);
    setDemoProgress(next);
    navigate(buildModelEvidenceValidationUrl(next.calibrationPrimaryVersion));
  }, [demoProgress, navigate]);

  const returnToCalibrationReview = useCallback(() => {
    if (!demoProgress?.calibrationComplete) return;
    const next = { ...demoProgress, phase: 'calibration-review' as const };
    writeModelEvidenceDemoProgress(next);
    setDemoProgress(next);
    navigate(buildModelEvidenceCalibrationUrl(
      next.calibrationPrimaryVersion,
      next.calibrationComparisonVersion
    ));
  }, [demoProgress, navigate]);

  const finishCombinedDemo = useCallback(() => {
    clearCombinedModelEvidenceDemoProgress();
    const next = new URLSearchParams(searchParams);
    next.delete('demo');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const calibrationDemo = useMemo<CalibrationModelEvidenceDemoContext | undefined>(() => {
    if (!combinedDemoRequested || !demoProgress) return undefined;
    return {
      active: demoProgress.phase === 'calibration' || demoProgress.phase === 'calibration-review',
      journeyId: demoProgress.journeyId,
      showCompletion: demoProgress.phase === 'calibration-review',
      primaryVersion: demoProgress.calibrationPrimaryVersion,
      comparisonVersion: demoProgress.calibrationComparisonVersion,
      onContextChange: updateCalibrationContext,
      onPause: pauseCombinedDemo,
      onContinueToValidation: continueToValidation,
      onExitToHome: exitCombinedDemoToHome
    };
  }, [
    combinedDemoRequested,
    continueToValidation,
    demoProgress,
    exitCombinedDemoToHome,
    pauseCombinedDemo,
    updateCalibrationContext
  ]);

  const validationDemo = useMemo<ValidationModelEvidenceDemoContext | undefined>(() => {
    if (!combinedDemoRequested || !demoProgress) return undefined;
    return {
      active: demoProgress.phase === 'validation' || demoProgress.phase === 'complete',
      journeyId: demoProgress.journeyId,
      showCompletion: demoProgress.phase === 'complete',
      onPause: pauseCombinedDemo,
      onPurposeBack: returnToCalibrationReview,
      onFinish: finishCombinedDemo,
      onExitToHome: exitCombinedDemoToHome
    };
  }, [
    combinedDemoRequested,
    demoProgress,
    exitCombinedDemoToHome,
    finishCombinedDemo,
    pauseCombinedDemo,
    returnToCalibrationReview
  ]);

  return (
    <section className="run-exp-layout model-evidence-page">
      <header className="results-view-switcher model-evidence-view-switcher">
        <h2 className="visually-hidden">Model evidence</h2>
        <div className="results-type-toggle" role="tablist" aria-label="Type of model evidence to view">
          {EVIDENCE_VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              role="tab"
              aria-selected={view.id === activeView}
              className={`results-type-option ${view.id === activeView ? 'active' : ''}`}
              title={view.description}
              onClick={() => selectView(view.id)}
            >
              {view.label}
            </button>
          ))}
        </div>
      </header>

      {activeView === 'calibration'
        ? <ComparePage modelEvidenceDemo={calibrationDemo} />
        : <ValidationPage modelEvidenceDemo={validationDemo} />}
    </section>
  );
}
