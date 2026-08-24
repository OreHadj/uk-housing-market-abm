import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ManualResultsView } from './experiments/view/ManualResultsView';
import { SensitivityResultsView } from './experiments/view/SensitivityResultsView';
import { EXPERIMENT_TYPES, type ExperimentType } from './experiments/types';

interface ResultsPageProps {
  canWrite: boolean;
  canDownloadResults: boolean;
  canDeleteResults: boolean;
  deleteKeyRequired: boolean;
  authEnabled: boolean;
}

const RESULT_TYPES: ReadonlyArray<{ id: ExperimentType; label: string; description: string }> = [
  {
    id: 'manual',
    label: 'Policy scenarios',
    description: 'Open a finished policy scenario, and compare it against another run.'
  },
  {
    id: 'sensitivity',
    label: 'Sensitivity analysis',
    description: 'Open a finished sweep and read how each indicator responds across the tested range.'
  }
];

function isExperimentType(value: string): value is ExperimentType {
  return (EXPERIMENT_TYPES as readonly string[]).includes(value);
}

/**
 * One place to read finished work of either kind.
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

  const requestedType = searchParams.get('type')?.trim() ?? '';
  // Scenarios are the common case, and the legacy `?type=` links this route already received use
  // the same vocabulary, so an old link lands on the workspace it originally meant.
  const activeType: ExperimentType = isExperimentType(requestedType) ? requestedType : 'manual';

  const baselineRunId = searchParams.get('baselineRunId')?.trim() || searchParams.get('runId')?.trim() || '';
  const comparisonRunId = searchParams.get('comparisonRunId')?.trim() ?? '';
  const experimentId = searchParams.get('experimentId')?.trim() ?? '';
  const queueInitiallyExpanded = searchParams.get('queue') === 'open';

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

  return (
    <section className="run-exp-layout workspace-page">
      <header className="results-view-switcher">
        <h2 className="visually-hidden">Results</h2>
        <div
          className="results-type-toggle"
          role="tablist"
          aria-label="Type of result to view"
        >
          {RESULT_TYPES.map((type) => (
            <button
              key={type.id}
              type="button"
              role="tab"
              aria-selected={type.id === activeType}
              className={`results-type-option ${type.id === activeType ? 'active' : ''}`}
              title={type.description}
              onClick={() => updateSearch({ type: type.id })}
            >
              {type.label}
            </button>
          ))}
        </div>
      </header>

      {activeType === 'manual' ? (
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
      )}
    </section>
  );
}
