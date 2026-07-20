import { useCallback, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ExperimentRunMode } from './experiments/run/ExperimentRunMode';
import { ManualResultsView } from './experiments/view/ManualResultsView';
import { SensitivityResultsView } from './experiments/view/SensitivityResultsView';
import type { ExperimentType } from './experiments/types';

interface ExperimentsPageProps {
  canWrite: boolean;
  canDownloadResults: boolean;
  canDeleteResults: boolean;
  deleteKeyRequired: boolean;
  authEnabled: boolean;
  workspace: ExperimentType;
  initialView?: 'create' | 'workspace';
}

type ResultsAccessProps = Pick<ExperimentsPageProps,
  'canWrite' | 'canDownloadResults' | 'canDeleteResults' | 'deleteKeyRequired' | 'authEnabled'>;

export function ManualComparisonPage(props: ResultsAccessProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const baselineRunId = searchParams.get('baselineRunId')?.trim() || searchParams.get('runId')?.trim() || '';
  const comparisonRunId = searchParams.get('comparisonRunId')?.trim() ?? '';
  return (
    <section className="run-exp-layout workspace-page">
      <article className="results-card workspace-heading">
        <div><h2>Compare policy scenario results</h2><p>Compare completed ordinary policy scenario runs against a benchmark or another policy run.</p></div>
      </article>
      <ManualResultsView
        {...props}
        requestedBaselineRunId={baselineRunId}
        requestedComparisonRunId={comparisonRunId}
        onManualSelectionChange={(selection) => setSearchParams(selection, { replace: true })}
        sidebarSubtitle="Completed policy scenario runs"
      />
    </section>
  );
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
  const viewingResults = searchParams.get('view') === 'results' || (workspace === 'manual' ? Boolean(baselineRunId) : Boolean(experimentId));

  const updateSearch = useCallback((updates: Record<string, string>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const copy = useMemo(() => workspace === 'manual' ? {
    heading: 'Policy scenarios',
    description: 'Create a policy scenario, monitor its simulation runs, and open completed results.',
    resultsAction: 'View completed scenario results',
    resultsPath: '/scenarios?view=results'
  } : {
    heading: 'Sensitivity analyses',
    description: 'Test how results change when a policy setting is varied across a range of values.',
    resultsAction: 'View sensitivity results',
    resultsPath: '/sensitivity?view=results'
  }, [workspace]);

  return (
    <section className="run-exp-layout workspace-page">
      <article className="results-card workspace-heading">
        <div>
          <h2>{copy.heading}</h2>
          <p>{copy.description}</p>
        </div>
        <div className="workspace-heading-actions">
          {initialView !== 'create' && !viewingResults && (
            <Link className="secondary-button" to={copy.resultsPath}>{copy.resultsAction}</Link>
          )}
          {(initialView === 'create' || viewingResults) && <Link className="secondary-button" to={workspace === 'manual' ? '/scenarios' : '/sensitivity'}>Back to workspace</Link>}
        </div>
      </article>

      {viewingResults ? (
        workspace === 'manual' ? (
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
            sidebarSubtitle="Sensitivity analyses"
          />
        )
      ) : (
        <ExperimentRunMode
          activeType={workspace}
          canWrite={canWrite}
          canDownloadResults={canDownloadResults}
          canDeleteResults={canDeleteResults}
          deleteKeyRequired={deleteKeyRequired}
          authEnabled={authEnabled}
          selectedJobRef={selectedJobRef}
          followJobRef={searchParams.get('follow') === '1' ? selectedJobRef : ''}
          onSelectedJobRefChange={(jobRef) => updateSearch({ jobRef })}
          onOpenManualResults={(runId) => navigate(`/scenarios?baselineRunId=${encodeURIComponent(runId)}`)}
          onOpenSensitivityResults={(id) => navigate(`/sensitivity?experimentId=${encodeURIComponent(id)}`)}
        />
      )}
    </section>
  );
}
