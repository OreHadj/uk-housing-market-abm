import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { SensitivityExperimentSummary } from '../../../shared/types';
import {
  API_RETRY_DELAY_MS,
  deleteSensitivityExperiment,
  fetchSensitivityExperiments,
  isRetryableApiError,
  renameSensitivityExperiment
} from '../../lib/api';
import { formatModelOptionLabel } from '../../lib/modelAnchors';
import { isPracticeRunTitle } from '../../lib/runSearch';
import { buildRunReportHref } from '../../lib/workspaceNavigation';
import { RunHistoryCheckbox, RunHistorySelectionToolbar } from '../experiments/view/RunHistorySelection';
import { useRunHistoryDeletion } from '../experiments/view/useRunHistoryDeletion';
import { noRunsMatchMessage, RunHistoryGroup, RunHistorySearch } from './RunHistorySearch';
import { RunRenameForm, useRunRename } from './RunRename';
import {
  formatBasePolicyLabel,
  formatQueueTimestamp,
  formatSensitivityStatus as formatStatus,
  isFinishedSensitivityStatus as isFinishedStatus,
  sensitivityStatusClass as statusClass
} from './runHistoryDisplay';
import { useRunHistorySearch } from './useRunHistorySearch';

/** Every finished sensitivity analysis, for opening, renaming and deleting. */
export function SensitivityRunHistory({ canWrite, canDeleteResults, deleteKeyRequired }: {
  canWrite: boolean;
  canDeleteResults: boolean;
  deleteKeyRequired: boolean;
}) {
  const [experiments, setExperiments] = useState<SensitivityExperimentSummary[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [pageError, setPageError] = useState('');
  const [previewExperimentId, setPreviewExperimentId] = useState('');
  const removedExperimentIds = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const payload = await fetchSensitivityExperiments();
      if (!mounted.current) return true;
      setExperiments(payload.experiments.filter((experiment) => !removedExperimentIds.current.has(experiment.experimentId)));
      setPageError('');
      return true;
    } catch (error) {
      if (mounted.current && !isRetryableApiError(error)) setPageError((error as Error).message);
      return false;
    } finally {
      if (mounted.current) setIsLoadingHistory(false);
    }
  }, []);

  // Refresh only while analyses are still running, so finished ones appear without a reload.
  const hasActive = experiments.some((experiment) => !isFinishedStatus(experiment.status));
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      const ok = await refreshHistory();
      if (cancelled) return;
      if (!ok || hasActive) timer = window.setTimeout(() => void load(), ok ? 4000 : API_RETRY_DELAY_MS);
    };
    void load();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [hasActive, refreshHistory]);

  const historyExperiments = useMemo(
    () => experiments.filter((experiment) => isFinishedStatus(experiment.status)).map((experiment) => ({
      experiment,
      name: experiment.title || experiment.experimentId,
      isExample: experiment.isExample === true,
      isPractice: isPracticeRunTitle(experiment.title)
    })),
    [experiments]
  );
  const search = useRunHistorySearch(historyExperiments);
  const rename = useRunRename({ rename: renameSensitivityExperiment, onRenamed: refreshHistory, onError: setPageError });
  const shown = search.shown.map((entry) => entry.experiment);
  // "Select all shown" and deleting only ever reach analyses that are visible in the list.
  const historyDeletion = useRunHistoryDeletion({
    items: shown.filter((experiment) => !experiment.isExample).map((experiment) => ({
      id: experiment.experimentId,
      label: experiment.title || experiment.experimentId
    })),
    canDelete: canDeleteResults,
    deleteKeyRequired,
    deleteItem: deleteSensitivityExperiment,
    onDeleted: async (ids) => {
      const deletedIds = new Set(ids);
      for (const id of ids) removedExperimentIds.current.add(id);
      setExperiments((current) => current.filter((experiment) => !deletedIds.has(experiment.experimentId)));
      setPreviewExperimentId((current) => deletedIds.has(current) ? '' : current);
      rename.forget(deletedIds);
      await refreshHistory();
    }
  });

  const renderExperiment = (experiment: SensitivityExperimentSummary): ReactNode => {
    const label = experiment.title || experiment.experimentId;
    return (
      <li
        key={experiment.experimentId}
        className={['run-item', previewExperimentId === experiment.experimentId ? 'is-previewed' : ''].filter(Boolean).join(' ')}
        onMouseEnter={() => setPreviewExperimentId(experiment.experimentId)}
        onFocus={() => setPreviewExperimentId(experiment.experimentId)}
      >
        <div className="run-item-head">
          {canDeleteResults && (
            <RunHistoryCheckbox
              label={label}
              checked={historyDeletion.selectedIds.has(experiment.experimentId)}
              disabled={historyDeletion.isDeleting || Boolean(experiment.isExample)}
              disabledReason={experiment.isExample ? 'Bundled example runs cannot be deleted.' : undefined}
              onChange={(checked) => historyDeletion.toggle(experiment.experimentId, checked)}
            />
          )}
          <div className="run-item-name">
            {rename.renamingId === experiment.experimentId
              ? <RunRenameForm rename={rename} label={label} placeholder="Analysis name" />
              : <strong>{label}</strong>}
          </div>
        </div>
        {rename.renamingId !== experiment.experimentId && (
          <div className="manual-run-action-row">
            <Link className="run-select-btn" to={buildRunReportHref('sensitivity', experiment.experimentId)}>
              View results
            </Link>
            {canWrite && !experiment.isExample && (
              <button type="button" className="table-toggle" onClick={() => rename.start(experiment.experimentId, experiment.title)}>
                Rename
              </button>
            )}
          </div>
        )}
        <div className="run-meta">
          <span className={statusClass(experiment.status)}>{formatStatus(experiment.status)}</span>
          {experiment.isExample && <span>Example</span>}
        </div>
      </li>
    );
  };

  const previewExperiment = shown.find((experiment) => experiment.experimentId === previewExperimentId) ?? shown[0] ?? null;

  return (
    <article className="results-card run-history-card sensitivity-run-history-card">
      <RunHistorySearch
        query={search.query}
        matchCount={search.matchCount}
        totalCount={historyExperiments.length}
        onQueryChange={search.setQuery}
      />
      {pageError && <p className="error-banner" role="alert">{pageError}</p>}
      {canDeleteResults && historyExperiments.length > 0 && (
        <RunHistorySelectionToolbar selection={historyDeletion} selectAllLabel="Select all shown" />
      )}
      {historyDeletion.error && <p className="error-banner" role="alert">{historyDeletion.error}</p>}
      {isLoadingHistory ? (
        <p className="loading-banner">Loading experiments...</p>
      ) : historyExperiments.length === 0 ? (
        <p className="info-banner">No finished sensitivity runs yet. Active runs appear in the queue on Results.</p>
      ) : search.matchCount === 0 ? (
        <p className="info-banner">{noRunsMatchMessage(search.query)}</p>
      ) : (
        <div className="run-history-split" onMouseLeave={() => setPreviewExperimentId('')}>
          <ul className="run-list">
            {search.groups.main.map((entry) => renderExperiment(entry.experiment))}
            <RunHistoryGroup
              id="sensitivity-run-history-practice"
              label="Practice runs"
              count={search.groups.practice.length}
              open={search.practiceOpen}
              onToggle={search.togglePractice}
            >
              {search.groups.practice.map((entry) => renderExperiment(entry.experiment))}
            </RunHistoryGroup>
            <RunHistoryGroup
              id="sensitivity-run-history-examples"
              label="Examples"
              count={search.groups.examples.length}
              open={search.examplesOpen}
              onToggle={search.toggleExamples}
            >
              {search.groups.examples.map((entry) => renderExperiment(entry.experiment))}
            </RunHistoryGroup>
          </ul>
          {previewExperiment && (
            <div className="run-history-preview" aria-live="polite">
              <p className="run-history-preview-eyebrow">
                {previewExperimentId === previewExperiment.experimentId ? 'Previewed run'
                  : search.query.trim() ? 'Newest match' : 'Latest finished run'}
              </p>
              <h4>{previewExperiment.title || previewExperiment.experimentId}</h4>
              <p className="run-item-id"><strong>Run ID:</strong> {previewExperiment.experimentId}</p>
              <div className="run-meta">
                <span className={statusClass(previewExperiment.status)}>{formatStatus(previewExperiment.status)}</span>
                {previewExperiment.isExample && <span>Example</span>}
              </div>
              <div className="run-item-policy">
                <p className="run-item-policy-head">Sensitivity setup</p>
                <dl className="run-item-policy-list">
                  <div><dt>Instrument</dt><dd>{previewExperiment.parameter.title}</dd></div>
                  <div><dt>Baseline policy</dt><dd>{formatBasePolicyLabel(previewExperiment.basePolicy)}</dd></div>
                  <div><dt>Model</dt><dd>{formatModelOptionLabel(previewExperiment.baseline)}</dd></div>
                  <div><dt>Created</dt><dd>{formatQueueTimestamp(previewExperiment.createdAt)}</dd></div>
                  {previewExperiment.endedAt && (
                    <div><dt>Finished</dt><dd>{formatQueueTimestamp(previewExperiment.endedAt)}</dd></div>
                  )}
                  <div><dt>Requested sample points</dt><dd>{previewExperiment.parameter.sampleCount}</dd></div>
                  {(previewExperiment.seedsPerPoint ?? previewExperiment.seeds?.length) !== undefined && (
                    <div><dt>Seeds per point</dt><dd>{previewExperiment.seedsPerPoint ?? previewExperiment.seeds?.length}</dd></div>
                  )}
                </dl>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
