import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ModelRunJob, ModelRunJobStatus, ResultsRunSummary } from '../../../shared/types';
import { LoadingSkeleton, LoadingSkeletonGroup } from '../../components/LoadingSkeleton';
import { PolicyRanAs } from '../../components/PolicyRanAs';
import {
  API_RETRY_DELAY_MS,
  deleteResultsRun,
  fetchModelRunJobs,
  fetchResultsRuns,
  isRetryableApiError,
  renameResultsRun
} from '../../lib/api';
import { findMatchedManualBaselineRun } from '../../lib/manualResultsView';
import { isPracticeRunTitle, runNameMatches } from '../../lib/runSearch';
import { buildRunReportHref } from '../../lib/workspaceNavigation';
import { CENTRAL_BANK_POLICY_DISPLAY, formatPolicyValue } from '../../../shared/policyDisplay';
import { RunHistoryCheckbox, RunHistorySelectionToolbar } from '../experiments/view/RunHistorySelection';
import { useRunHistoryDeletion } from '../experiments/view/useRunHistoryDeletion';
import { noRunsMatchMessage, RunHistoryGroup, RunHistorySearch } from './RunHistorySearch';
import { RunRenameForm, useRunRename } from './RunRename';
import {
  describeRunPolicy,
  formatQueueTimestamp,
  getRunPrimaryLabel,
  isProtectedResultsRun,
  MODEL_RUN_JOB_STATUS_META,
  resultsRunStatusClass as statusClass
} from './runHistoryDisplay';
import { useRunHistorySearch } from './useRunHistorySearch';

function isActiveJob(status: ModelRunJobStatus): boolean {
  return status === 'queued' || status === 'running';
}

/**
 * Every saved policy run, for opening, renaming and deleting. Failed and cancelled runs from this
 * server session are listed too, although they saved no results.
 */
export function PolicyRunHistory({ canWrite, canDeleteResults, deleteKeyRequired }: {
  canWrite: boolean;
  canDeleteResults: boolean;
  deleteKeyRequired: boolean;
}) {
  const [runs, setRuns] = useState<ResultsRunSummary[]>([]);
  const [runJobs, setRunJobs] = useState<ModelRunJob[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(true);
  const [loadError, setLoadError] = useState('');
  // Which run the detail panel describes. Set on hover *and* focus so the panel is reachable by
  // keyboard, and cleared when the pointer leaves the list so it falls back to the newest run.
  const [previewRunId, setPreviewRunId] = useState('');
  const removedRunIds = useRef(new Set<string>());
  // The list is slow to build in production, so a response that arrives after leaving is dropped.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const runsRequestId = useRef(0);
  const loadRuns = useCallback(async () => {
    const requestId = ++runsRequestId.current;
    const isCurrent = () => mounted.current && requestId === runsRequestId.current;
    setLoadError('');
    setIsLoadingRuns(true);
    try {
      const payload = (await fetchResultsRuns()).filter((run) => !removedRunIds.current.has(run.runId));
      if (isCurrent()) setRuns(payload);
      return payload;
    } finally {
      if (isCurrent()) setIsLoadingRuns(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    const loadRunsWithRetry = async () => {
      try {
        await loadRuns();
      } catch (error) {
        if (cancelled) return;
        if (isRetryableApiError(error)) {
          retryTimer = window.setTimeout(() => void loadRunsWithRetry(), API_RETRY_DELAY_MS);
          return;
        }
        setLoadError((error as Error).message);
      }
    };
    void loadRunsWithRetry();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [loadRuns]);

  // A run's output folder is created when it is queued, so an in-progress run appears in the
  // results listing with no parsed output. Keep those out until they finish, and refresh the list
  // when a job finishes or disappears so new runs show up without a reload.
  useEffect(() => {
    let cancelled = false;
    let previousStatuses: Map<string, ModelRunJobStatus> | undefined;
    let polling = false;
    const poll = async () => {
      if (cancelled || polling) return;
      polling = true;
      try {
        const jobs = await fetchModelRunJobs();
        if (cancelled) return;
        setRunJobs(jobs);
        const statuses = new Map(jobs.map((job) => [job.jobId, job.status]));
        const changed = previousStatuses !== undefined && (
          jobs.some((job) => !isActiveJob(job.status) && previousStatuses?.get(job.jobId) !== job.status) ||
          [...previousStatuses].some(([jobId, status]) => isActiveJob(status) && !statuses.has(jobId))
        );
        previousStatuses = statuses;
        if (changed) await loadRuns();
      } catch {
        // Model runs may be unavailable (e.g. cloud/preview); ignore polling errors.
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadRuns]);

  const activeRunIds = useMemo(
    () => new Set(runJobs.filter((job) => isActiveJob(job.status)).map((job) => job.runId).filter(Boolean)),
    [runJobs]
  );
  const historyRuns = useMemo(
    () => runs.filter((run) => !activeRunIds.has(run.runId)).map((run) => ({
      run,
      name: getRunPrimaryLabel(run),
      isExample: run.isExample === true,
      isPractice: isPracticeRunTitle(run.title)
    })),
    [activeRunIds, runs]
  );
  const failedHistoryJobs = runJobs.filter((job) => job.status === 'failed' || job.status === 'canceled');
  const search = useRunHistorySearch(historyRuns);
  const failedMatches = failedHistoryJobs.filter((job) => runNameMatches(job.title || job.runId || job.jobId, search.query));
  const shownRuns = search.shown.map((entry) => entry.run);
  const runById = new Map(historyRuns.map((entry) => [entry.run.runId, entry.run]));
  const rename = useRunRename({ rename: renameResultsRun, onRenamed: loadRuns, onError: setLoadError });

  // "Select all shown" and deleting only ever reach runs that are visible in the list.
  const historyDeletion = useRunHistoryDeletion({
    items: shownRuns
      .filter((run) => !run.isExample && !isProtectedResultsRun(run.runId))
      .map((run) => ({ id: run.runId, label: getRunPrimaryLabel(run) })),
    canDelete: canDeleteResults,
    deleteKeyRequired,
    deleteItem: deleteResultsRun,
    onDeleted: async (deletedRunIds) => {
      const deletedIds = new Set(deletedRunIds);
      for (const runId of deletedIds) removedRunIds.current.add(runId);
      setRuns((current) => current.filter((run) => !deletedIds.has(run.runId)));
      setPreviewRunId((current) => deletedIds.has(current) ? '' : current);
      rename.forget(deletedIds);
      await loadRuns();
    }
  });

  // "View results" pairs a run with its matched baseline, as choosing it on the Report does.
  const matchableRuns = historyRuns.map((entry) => entry.run).filter((run) => run.status !== 'invalid');

  const renderRun = (run: ResultsRunSummary): ReactNode => {
    const deleteDisabledReason = run.isExample
      ? 'Example runs cannot be deleted.'
      : isProtectedResultsRun(run.runId) ? 'Protected runs cannot be deleted.' : undefined;
    return (
      <li
        key={run.runId}
        className={['run-item', previewRunId === run.runId ? 'is-previewed' : ''].filter(Boolean).join(' ')}
        onMouseEnter={() => setPreviewRunId(run.runId)}
        onFocus={() => setPreviewRunId(run.runId)}
      >
        <div className="run-item-head">
          {canDeleteResults && (
            <RunHistoryCheckbox
              label={getRunPrimaryLabel(run)}
              checked={historyDeletion.selectedIds.has(run.runId)}
              disabled={historyDeletion.isDeleting || Boolean(deleteDisabledReason)}
              disabledReason={deleteDisabledReason}
              onChange={(checked) => historyDeletion.toggle(run.runId, checked)}
            />
          )}
          <div className="run-item-name">
            {rename.renamingId === run.runId
              ? <RunRenameForm rename={rename} label={run.title ?? run.runId} placeholder="Scenario name" />
              : <strong>{getRunPrimaryLabel(run)}</strong>}
          </div>
        </div>

        {rename.renamingId !== run.runId && (
          <div className="manual-run-action-row">
            <Link
              className="run-select-btn"
              to={buildRunReportHref('manual', run.runId, findMatchedManualBaselineRun(matchableRuns, run.runId)?.runId)}
            >
              View results
            </Link>
            {canWrite && !run.isExample && (
              <button type="button" className="table-toggle" onClick={() => rename.start(run.runId, run.title)}>
                Rename
              </button>
            )}
          </div>
        )}

        <div className="run-meta">
          <span className={statusClass(run.status)}>{run.status}</span>
        </div>
      </li>
    );
  };

  const detailRun = runById.get(previewRunId) ?? shownRuns[0] ?? null;
  const detailPolicy = detailRun ? describeRunPolicy(detailRun) : null;
  const showRunsSkeleton = isLoadingRuns && runs.length === 0;
  const showRunsRefreshing = isLoadingRuns && runs.length > 0;
  const totalCount = historyRuns.length + failedHistoryJobs.length;

  return (
    <article className="results-card run-history-card">
      <RunHistorySearch
        query={search.query}
        matchCount={search.matchCount + failedMatches.length}
        totalCount={totalCount}
        onQueryChange={search.setQuery}
      />
      {loadError && <p className="error-banner" role="alert">{loadError}</p>}
      {canDeleteResults && <RunHistorySelectionToolbar selection={historyDeletion} selectAllLabel="Select all shown" />}
      {historyDeletion.error && <p className="error-banner" role="alert">{historyDeletion.error}</p>}
      {showRunsRefreshing && (
        <LoadingSkeleton as="span" className="loading-skeleton-pill section-loading-row" ariaLabel="Refreshing runs" />
      )}
      {showRunsSkeleton ? (
        <LoadingSkeletonGroup
          className="run-list-skeleton"
          count={4}
          itemClassName="loading-skeleton-card run-item-skeleton"
          ariaLabel="Loading runs"
        />
      ) : totalCount === 0 ? (
        <p className="info-banner">No completed runs yet.</p>
      ) : search.matchCount + failedMatches.length === 0 ? (
        <p className="info-banner">{noRunsMatchMessage(search.query)}</p>
      ) : search.matchCount > 0 && (
        <div className="run-history-split" onMouseLeave={() => setPreviewRunId('')}>
          <ul className="run-list">
            {search.groups.main.map((entry) => renderRun(entry.run))}
            <RunHistoryGroup
              id="policy-run-history-practice"
              label="Practice runs"
              count={search.groups.practice.length}
              open={search.practiceOpen}
              onToggle={search.togglePractice}
            >
              {search.groups.practice.map((entry) => renderRun(entry.run))}
            </RunHistoryGroup>
            <RunHistoryGroup
              id="policy-run-history-examples"
              label="Examples"
              count={search.groups.examples.length}
              open={search.examplesOpen}
              onToggle={search.toggleExamples}
            >
              {search.groups.examples.map((entry) => renderRun(entry.run))}
            </RunHistoryGroup>
          </ul>
          {detailRun && (
            <div className="run-history-preview" aria-live="polite">
              <p className="run-history-preview-eyebrow">
                {previewRunId === detailRun.runId ? 'Hovered run' : search.query.trim() ? 'Newest match' : 'Newest run'}
              </p>
              <h4>{getRunPrimaryLabel(detailRun)}</h4>
              <p className="run-item-id"><strong>Run ID:</strong> {detailRun.runId}</p>
              <div className="run-meta">
                <span className={statusClass(detailRun.status)}>{detailRun.status}</span>
                <span>{(detailRun.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
                <span>
                  Coverage {detailRun.parseCoverage.supportedCount}/{detailRun.parseCoverage.requiredCount}
                </span>
              </div>
              {detailPolicy ? (
                <div className="run-item-policy">
                  <p className="run-item-policy-head">{detailPolicy.heading}</p>
                  <dl className="run-item-policy-list">
                    {detailRun.policySettings.map((setting) => {
                      const display = CENTRAL_BANK_POLICY_DISPLAY[setting.key];
                      const isChanged = detailPolicy.changedKeys.has(setting.key);
                      return (
                        <div
                          key={setting.key}
                          className={isChanged ? 'is-changed' : undefined}
                          title={setting.key}
                        >
                          <dt>{display?.label ?? setting.key}</dt>
                          <dd>
                            {display ? formatPolicyValue(setting.value, display.unit) : String(setting.value)}
                            {isChanged && <PolicyRanAs settingKey={setting.key} ranAs={setting.ranAs} />}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </div>
              ) : (
                <p className="info-banner">No policy settings recorded for this run.</p>
              )}
            </div>
          )}
        </div>
      )}
      {!showRunsSkeleton && failedMatches.length > 0 && (
        <ul className="run-list run-history-failed-list">
          {failedMatches.map((job) => (
            <li key={job.jobId} className="run-item run-item-failed">
              <div className="run-item-head">
                <strong>{job.title || job.runId || job.jobId}</strong>
                <span className={MODEL_RUN_JOB_STATUS_META[job.status].className}>
                  {MODEL_RUN_JOB_STATUS_META[job.status].label}
                </span>
              </div>
              <p className="run-queue-failure">
                This run {job.status === 'canceled' ? 'was cancelled' : 'failed'} — no results.
                {job.signal
                  ? ` Stopped by signal ${job.signal}.`
                  : job.exitCode != null
                    ? ` Exit code ${job.exitCode}.`
                    : ''}
              </p>
              <p>{formatQueueTimestamp(job.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
