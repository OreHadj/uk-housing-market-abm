import { lazy, Suspense, useCallback, useEffect, useLayoutEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { clearExperimentDemoState } from '../lib/experimentDemo';
import { ManualResultsView } from './experiments/view/ManualResultsView';
import { SensitivityResultsView } from './experiments/view/SensitivityResultsView';
import { getResultsType } from '../lib/workspaceNavigation';
import { NAVIGATION_DEMO_QUERY_VALUE } from '../lib/navigationDemo';
import { SubmittedReport } from '../components/SubmittedReport';
import { ResultsDemoInvitation } from '../components/ResultsDemoInvitation';
import { policyDetailedSelection, sensitivityDetailedSelection } from '../lib/reportUrlState';

const Report2Page = lazy(() => import('./report2/Report2Page').then((module) => ({ default: module.Report2Page })));
const SensitivityReport2Page = lazy(() => import('./sensitivity-report2/SensitivityReport2Page').then((module) => ({ default: module.SensitivityReport2Page })));

interface ResultsPageProps {
  canWrite: boolean;
  canDownloadResults: boolean;
  canDeleteResults: boolean;
  deleteKeyRequired: boolean;
  authEnabled: boolean;
}

/**
 * One place to follow submitted work and read finished results of either kind.
 *
 * The two result views are the same components the Scenarios and Sensitivity workspaces render —
 * this page only chooses between them and drops the "create" affordance, so reading results is
 * separated from starting runs. Selection state for both kinds is kept in the query string at once
 * (`baselineRunId`/`comparisonRunId` for scenarios, `experimentId` for sweeps), so toggling across
 * and back does not lose what was open.
 */
export function ResultsPage({
  canWrite,
  canDownloadResults,
  canDeleteResults,
  deleteKeyRequired,
  authEnabled
}: ResultsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  // Retire the former practice handoff when an existing Results tab or old link is reopened.
  useEffect(() => {
    if (!['policy', 'sensitivity'].includes(searchParams.get('practice') ?? '')) return;
    const journeyId = searchParams.get('journey');
    if (journeyId) clearExperimentDemoState(journeyId);
    const next = new URLSearchParams(searchParams);
    next.set('resultsDemo', searchParams.get('practice') === 'sensitivity' ? 'sensitivity-results' : 'policy-results');
    next.delete('practice');
    next.delete('journey');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Scenarios are the common case, and the legacy `?type=` links this route already received use
  // the same vocabulary, so an old link lands on the workspace it originally meant.
  const activeType = getResultsType(searchParams);
  const requestedPresentation = searchParams.get('presentation');
  // Report is the default for saved and newly submitted runs of either kind.
  // Detailed requires an explicit choice. Legacy `presentation=report2` also opens Report.
  const presentation = requestedPresentation === 'detailed' ? 'detailed' : 'report';

  // Footer links switch presentation on this same route. Scroll after the new view
  // commits, while preserving position for run and outcome selection changes.
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [activeType, presentation]);

  const baselineRunId = searchParams.get('baselineRunId')?.trim() || searchParams.get('runId')?.trim() || '';
  const comparisonRunId = searchParams.get('comparisonRunId')?.trim() ?? '';
  const experimentId = searchParams.get('experimentId')?.trim() ?? '';
  const queueInitiallyExpanded = searchParams.get('queue') === 'open';
  const requestedJobRef = searchParams.get('jobRef')?.trim() ?? '';
  const submittedJobRef = requestedJobRef.startsWith(`${activeType}:`) ? requestedJobRef : '';

  const updateSearch = useCallback(
    (updates: Record<string, string>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const presentationControls = (
    <header className="results-presentation-header">
        <div className="results-presentation-bar">
          <span>Presentation</span>
          <div className="results-presentation-toggle" role="group" aria-label="Results presentation">
            {(['report', 'detailed'] as const).map((style) => (
              <button
                key={style}
                type="button"
                aria-pressed={presentation === style}
                onClick={() => updateSearch({
                  presentation: style,
                  ...(style === 'detailed' && presentation !== style
                    ? activeType === 'sensitivity' ? sensitivityDetailedSelection(searchParams) : policyDetailedSelection(searchParams) : {})
                })}
              >
                {style === 'report' ? 'Report' : 'Detailed'}
              </button>
            ))}
          </div>
        </div>
    </header>
  );

  return (
    <section className="run-exp-layout workspace-page">
      <ResultsDemoInvitation />
      {presentation === 'report' ? (
        <SubmittedReport key={activeType}
          type={activeType} jobRef={submittedJobRef}
          selectionId={activeType === 'manual' ? baselineRunId : experimentId}
          queueInitiallyExpanded={queueInitiallyExpanded}
          canWrite={canWrite} canDeleteResults={canDeleteResults} deleteKeyRequired={deleteKeyRequired}
          onDeleted={(result) => {
            const updates: Record<string, string> = {};
            if (result.jobRef === submittedJobRef) updates.jobRef = '';
            if (result.type === 'manual') {
              if (result.runId === baselineRunId) { updates.baselineRunId = ''; updates.runId = ''; }
              if (result.runId === comparisonRunId) { updates.comparisonRunId = ''; updates.comparisonNoneFor = baselineRunId; }
            } else if (result.id === experimentId) updates.experimentId = '';
            if (Object.keys(updates).length) updateSearch(updates);
          }}>
          {(queue, execution) => <Suspense fallback={<>{queue}{presentationControls}<p className="loading-banner">Loading report…</p></>}>
            {activeType === 'sensitivity'
              ? <SensitivityReport2Page presentationControls={presentationControls} queueControls={queue} execution={execution} />
              : <Report2Page presentationControls={presentationControls} queueControls={queue} execution={execution} canWrite={canWrite} />}
          </Suspense>}
        </SubmittedReport>
      ) : activeType === 'manual' ? (
        <ManualResultsView
          presentation="detailed"
          presentationControls={presentationControls}
          canWrite={canWrite}
          canDownloadResults={canDownloadResults}
          canDeleteResults={canDeleteResults}
          deleteKeyRequired={deleteKeyRequired}
          authEnabled={authEnabled}
          requestedBaselineRunId={baselineRunId}
          requestedComparisonRunId={comparisonRunId}
          requestedJobRef={submittedJobRef}
          queueInitiallyExpanded={queueInitiallyExpanded}
          onManualSelectionChange={(selection) => updateSearch({ ...selection, runId: '', jobRef: selection.jobRef ?? '' })}
          sidebarSubtitle="Manage policy scenario runs"
        />
      ) : (
        <SensitivityResultsView
          presentation="detailed"
          presentationControls={presentationControls}
          canWrite={canWrite}
          canDownloadResults={canDownloadResults}
          canDeleteResults={canDeleteResults}
          deleteKeyRequired={deleteKeyRequired}
          authEnabled={authEnabled}
          requestedExperimentId={experimentId}
          preferCompletedRun={searchParams.get('demo') === NAVIGATION_DEMO_QUERY_VALUE}
          queueInitiallyExpanded={queueInitiallyExpanded}
          onSelectedExperimentIdChange={(value) => updateSearch({ experimentId: value, jobRef: '' })}
          sidebarSubtitle="Completed and in-progress sensitivity analyses"
        />
      )}
    </section>
  );
}
