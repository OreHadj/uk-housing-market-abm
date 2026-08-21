import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ExperimentRunMode } from './experiments/run/ExperimentRunMode';
import { ManualResultsView } from './experiments/view/ManualResultsView';
import { SensitivityResultsView } from './experiments/view/SensitivityResultsView';
import { ExperimentsLandingPage } from './ExperimentsLandingPage';
import type { ExperimentType } from './experiments/types';
import {
  clearScenarioDraft,
  createScenarioDraftId,
  resumableScenarioDraftId,
  setActiveScenarioDraftId
} from '../lib/scenarioDraft';
import {
  clearSensitivityDraft,
  createSensitivityDraftId,
  resumableSensitivityDraftId,
  setActiveSensitivityDraftId
} from '../lib/sensitivityDraft';

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
  const [isSetupOpen, setIsSetupOpen] = useState(initialView === 'create');
  const draftId = searchParams.get('draft')?.trim() ?? '';

  const returnToExperiments = useCallback(() => {
    setIsSetupOpen(false);
    navigate('/experiments');
  }, [navigate]);

  useEffect(() => {
    if (!isSetupOpen) return;
    if (draftId) {
      if (workspace === 'manual') setActiveScenarioDraftId(draftId);
      else setActiveSensitivityDraftId(draftId);
      return;
    }
    // Reopening picks up the draft the last close left behind; only discarding or submitting
    // retires it, so a fresh id is minted just for a genuinely new scenario.
    const nextDraftId = workspace === 'manual'
      ? resumableScenarioDraftId() || createScenarioDraftId()
      : resumableSensitivityDraftId() || createSensitivityDraftId();
    if (workspace === 'manual') setActiveScenarioDraftId(nextDraftId);
    else setActiveSensitivityDraftId(nextDraftId);
    const next = new URLSearchParams(searchParams);
    next.set('draft', nextDraftId);
    setSearchParams(next, { replace: true });
  }, [draftId, isSetupOpen, searchParams, setSearchParams, workspace]);

  const updateSearch = useCallback((updates: Record<string, string>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!isSetupOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isSetupOpen]);

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
      {initialView === 'create' && <ExperimentsLandingPage />}

      {initialView !== 'create' && <article className="results-card workspace-heading">
        <div>
          <h2>{copy.heading}</h2>
          <p>{copy.description}</p>
        </div>
        <div className="workspace-heading-actions">
          <button
            type="button"
            className="primary-button scenario-launch-button"
            aria-expanded={isSetupOpen}
            aria-haspopup="dialog"
            onClick={() => setIsSetupOpen(true)}
          >
            {copy.createAction}
          </button>
        </div>
      </article>}

      {/*
        No click-outside and no Escape handler: a half-built experiment is expensive to lose, so the
        setup closes only through Discard draft or the close button. Closing keeps the draft; it is
        resumed on reopen and cleared only by discarding or by a successful submit.
      */}
      <div hidden={!isSetupOpen} className="scenario-create-modal-backdrop" role="presentation">
        <section
          className="scenario-create-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="experiment-create-modal-title"
        >
          <div className="scenario-create-modal-head">
            <div>
              <p className="trend-modal-eyebrow">{copy.modalEyebrow}</p>
              <h2 id="experiment-create-modal-title">{copy.modalHeading}</h2>
              <p>{copy.modalDescription}</p>
            </div>
            <div className="scenario-modal-head-actions">
              {draftId && (
                <button type="button" className="danger-button scenario-discard-draft-button" onClick={() => {
                  if (workspace === 'manual') clearScenarioDraft(draftId);
                  else clearSensitivityDraft(draftId);
                  returnToExperiments();
                }}>Discard draft</button>
              )}
              <button
                type="button"
                className="trend-modal-close"
                aria-label={`Close ${workspace === 'manual' ? 'scenario' : 'sensitivity'} setup`}
                onClick={returnToExperiments}
              >×</button>
            </div>
          </div>
          <div className="scenario-create-modal-body">
            <ExperimentRunMode
              activeType={workspace}
              canWrite={canWrite}
              canDownloadResults={canDownloadResults}
              canDeleteResults={canDeleteResults}
              deleteKeyRequired={deleteKeyRequired}
              authEnabled={authEnabled}
              selectedJobRef={selectedJobRef}
              followJobRef={searchParams.get('follow') === '1' ? selectedJobRef : ''}
              showRunManagement={false}
              draftId={draftId}
              initialScenarioStep={searchParams.get('step') === 'model-version' ? 1 : 0}
              initialSensitivityStep={searchParams.get('step') === 'model-baseline' ? 2 : 0}
              onManualRunAccepted={() => navigate('/results?type=manual')}
              onSensitivityRunAccepted={(id) => navigate(
                `/results?type=sensitivity${id ? `&experimentId=${encodeURIComponent(id)}` : ''}`
              )}
              onSelectedJobRefChange={(jobRef) => updateSearch({ jobRef })}
              onOpenManualResults={(runId) => {
                setIsSetupOpen(false);
                navigate(`/results?type=manual&baselineRunId=${encodeURIComponent(runId)}`);
              }}
              onOpenSensitivityResults={(id) => {
                setIsSetupOpen(false);
                navigate(`/results?type=sensitivity&experimentId=${encodeURIComponent(id)}`);
              }}
            />
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
          onManualSelectionChange={(selection) => updateSearch(selection)}
          sidebarSubtitle="Policy scenario runs"
        />
      ) : (
        <SensitivityResultsView
          canWrite={canWrite}
          canDownloadResults={canDownloadResults}
          canDeleteResults={canDeleteResults}
          deleteKeyRequired={deleteKeyRequired}
          authEnabled={authEnabled}
          requestedExperimentId={experimentId}
          onSelectedExperimentIdChange={(value) => updateSearch({ experimentId: value })}
          sidebarSubtitle="Completed and in-progress sensitivity analyses"
        />
      ))}
    </section>
  );
}
