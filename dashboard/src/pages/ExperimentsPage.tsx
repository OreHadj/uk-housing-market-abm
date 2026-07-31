import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ExperimentRunMode } from './experiments/run/ExperimentRunMode';
import { ManualResultsView } from './experiments/view/ManualResultsView';
import { SensitivityResultsView } from './experiments/view/SensitivityResultsView';
import type { ExperimentType } from './experiments/types';
import { clearScenarioDraft, createScenarioDraftId } from '../lib/scenarioDraft';

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
  const draftId = workspace === 'manual' ? searchParams.get('draft')?.trim() ?? '' : '';

  useEffect(() => {
    if (workspace !== 'manual' || !isSetupOpen || draftId) return;
    const next = new URLSearchParams(searchParams);
    next.set('draft', createScenarioDraftId());
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

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSetupOpen(false);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
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
      <article className="results-card workspace-heading">
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
      </article>

      <div
        hidden={!isSetupOpen}
        className="scenario-create-modal-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setIsSetupOpen(false);
          }
        }}
      >
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
              {workspace === 'manual' && draftId && (
                <button type="button" className="text-button" onClick={() => {
                  clearScenarioDraft(draftId);
                  const next = new URLSearchParams(searchParams);
                  next.delete('draft');
                  setSearchParams(next, { replace: true });
                  setIsSetupOpen(false);
                }}>Discard draft</button>
              )}
              <button
                type="button"
                className="trend-modal-close"
                aria-label={`Close ${workspace === 'manual' ? 'scenario' : 'sensitivity'} setup`}
                onClick={() => setIsSetupOpen(false)}
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
              onSelectedJobRefChange={(jobRef) => updateSearch({ jobRef })}
              onOpenManualResults={(runId) => {
                setIsSetupOpen(false);
                navigate(`/scenarios?baselineRunId=${encodeURIComponent(runId)}`);
              }}
              onOpenSensitivityResults={(id) => {
                setIsSetupOpen(false);
                navigate(`/sensitivity?experimentId=${encodeURIComponent(id)}`);
              }}
            />
          </div>
        </section>
      </div>

      {workspace === 'manual' ? (
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
      )}
    </section>
  );
}
