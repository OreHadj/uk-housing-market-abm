import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { experimentTypeRegistry } from './experiments/registry';
import {
  buildExperimentSearchParams,
  parseExperimentRouteState
} from './experiments/routeState';
import { ExperimentRunMode } from './experiments/run/ExperimentRunMode';
import type { ExperimentRouteState, ExperimentType } from './experiments/types';

interface ExperimentsPageProps {
  canWrite: boolean;
  canDownloadResults: boolean;
  canDeleteResults: boolean;
  deleteKeyRequired: boolean;
  authEnabled: boolean;
}

export function ExperimentsPage({
  canWrite,
  canDownloadResults,
  canDeleteResults,
  deleteKeyRequired,
  authEnabled
}: ExperimentsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawQuery = searchParams.toString();

  const routeState = useMemo(() => parseExperimentRouteState(searchParams), [searchParams]);
  const canonicalQuery = useMemo(() => buildExperimentSearchParams(routeState).toString(), [routeState]);

  useEffect(() => {
    if (canonicalQuery === rawQuery) {
      return;
    }
    setSearchParams(canonicalQuery, { replace: true });
  }, [canonicalQuery, rawQuery, setSearchParams]);

  const updateRouteState = useCallback(
    (patch: Partial<ExperimentRouteState>, replace = false) => {
      const nextState: ExperimentRouteState = {
        ...routeState,
        ...patch
      };
      const nextQuery = buildExperimentSearchParams(nextState).toString();
      if (nextQuery === rawQuery) {
        return;
      }
      setSearchParams(nextQuery, { replace });
    },
    [rawQuery, routeState, setSearchParams]
  );

  const activeConfig = experimentTypeRegistry[routeState.type];

  return (
    <section className="run-exp-layout">
      <article className="results-card">
        <h2>Results</h2>
        <p>
          Browse completed model runs and their results. Launch a new run or a sensitivity sweep from the Run
          Experiment tab.
        </p>

        <div className="experiment-tabs">
          {(Object.keys(experimentTypeRegistry) as ExperimentType[]).map((type) => (
            <button
              key={type}
              type="button"
              className={`filter-pill ${routeState.type === type ? 'active' : ''}`}
              onClick={() => updateRouteState({ type })}
            >
              {experimentTypeRegistry[type].label}
            </button>
          ))}
        </div>

        <div className="experiment-tabs">
          <button
            type="button"
            className={`filter-pill ${routeState.mode === 'run' ? 'active' : ''}`}
            onClick={() => updateRouteState({ mode: 'run' })}
          >
            Run Experiment
          </button>
          <button
            type="button"
            className={`filter-pill ${routeState.mode === 'view' ? 'active' : ''}`}
            onClick={() => updateRouteState({ mode: 'view' })}
          >
            View Experiment Results
          </button>
        </div>
      </article>

      {routeState.mode === 'run' ? (
        <ExperimentRunMode
          activeType={routeState.type}
          canWrite={canWrite}
          canDownloadResults={canDownloadResults}
          canDeleteResults={canDeleteResults}
          deleteKeyRequired={deleteKeyRequired}
          authEnabled={authEnabled}
          selectedJobRef={routeState.jobRef}
          followJobRef={routeState.follow ? routeState.jobRef : ''}
          onSelectedJobRefChange={(jobRef) => updateRouteState({ jobRef }, true)}
          onOpenManualResults={(runId) =>
            updateRouteState({ mode: 'view', type: 'manual', baselineRunId: runId, comparisonRunId: '' })
          }
          onOpenSensitivityResults={(experimentId) =>
            updateRouteState({ mode: 'view', type: 'sensitivity', experimentId })
          }
        />
      ) : (
        <activeConfig.ViewComponent
          canWrite={canWrite}
          canDownloadResults={canDownloadResults}
          canDeleteResults={canDeleteResults}
          deleteKeyRequired={deleteKeyRequired}
          authEnabled={authEnabled}
          requestedBaselineRunId={routeState.baselineRunId}
          requestedComparisonRunId={routeState.comparisonRunId}
          requestedExperimentId={routeState.experimentId}
          onManualSelectionChange={({ baselineRunId, comparisonRunId }) =>
            updateRouteState({ baselineRunId, comparisonRunId }, true)
          }
          onSelectedExperimentIdChange={(experimentId) => updateRouteState({ experimentId }, true)}
          sidebarSubtitle={activeConfig.viewSidebarSubtitle}
        />
      )}
    </section>
  );
}
