import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ExperimentJobDeleteResponse, ExperimentJobType } from '../../shared/types';
import { findSubmittedReportJob, watchResultsQueue, type ReportExecutionState, type ResultsQueueState } from '../lib/resultsQueue';
import { ResultsQueue } from '../pages/experiments/view/ResultsQueue';
import { useStopAndDeleteExperiment } from '../pages/experiments/view/useStopAndDeleteExperiment';

/** Open the selected Report immediately, then load its data once the queued job finishes. */
export function SubmittedReport({ type, jobRef, selectionId, queueInitiallyExpanded, canWrite, canDeleteResults,
  deleteKeyRequired, onDeleted, children }: {
  type: ExperimentJobType;
  jobRef: string;
  selectionId: string;
  queueInitiallyExpanded: boolean;
  canWrite: boolean;
  canDeleteResults: boolean;
  deleteKeyRequired: boolean;
  onDeleted: (result: ExperimentJobDeleteResponse) => void;
  children: (queue: ReactNode, execution: ReportExecutionState) => ReactNode;
}) {
  const [queueState, setQueueState] = useState<ResultsQueueState>({ items: [], loading: true, error: '' });
  const [isQueueExpanded, setIsQueueExpanded] = useState(queueInitiallyExpanded);
  const removedJobRefs = useRef(new Set<string>());
  const removedIds = useRef(new Set<string>());
  const stopDeletion = useStopAndDeleteExperiment({
    canWrite, canDeleteResults, deleteKeyRequired,
    onDeleted: (result) => {
      removedJobRefs.current.add(result.jobRef);
      const id = result.type === 'manual' ? result.runId ?? queueState.items.find((item) => item.jobRef === result.jobRef)?.runId : result.id;
      if (id) removedIds.current.add(id);
      setQueueState((current) => ({ ...current, items: current.items.filter((item) => item.jobRef !== result.jobRef) }));
      onDeleted(result);
    }
  });
  useEffect(() => watchResultsQueue({
    type,
    onUpdate: (state) => setQueueState({ ...state, items: state.items.filter((item) => !removedJobRefs.current.has(item.jobRef)) })
  }), [type]);

  const job = findSubmittedReportJob(queueState.items, type, jobRef, selectionId);
  const checking = queueState.loading && Boolean(jobRef);
  const canceling = Boolean(job && stopDeletion.pending?.jobRef === job.jobRef);
  const pending = checking || job?.status === 'queued' || job?.status === 'running'
    || canceling;
  const failed = Boolean(jobRef && (job?.status === 'failed' || job?.status === 'canceled'));
  const queue = <div className="results-queue-section">
    {queueState.error && <p className="info-banner" role="status">{queueState.error}</p>}
    <ResultsQueue items={queueState.items}
      expanded={isQueueExpanded} onExpandedChange={setIsQueueExpanded}
      canCancel={canWrite && canDeleteResults} stopDeletion={stopDeletion}
      loadingSubmitted={checking} />
    {pending && <div className="info-banner" role="status" data-guided-target="submitted-report-progress">
      <p>{canceling ? 'Canceling your run.' : <>{checking ? 'Checking your run.' : job?.status === 'running' ? 'Your run is running.' : 'Your run is queued.'} This Report will load automatically when it finishes.</>}</p>
      {job?.title && <p>{job.title}</p>}
    </div>}
    {!pending && failed && <p className="error-banner" role="alert">{job?.status === 'failed' ? 'The run failed.' : 'The run was canceled.'} Use Detailed to inspect its Run History entry.</p>}
  </div>;

  // Keep the report shell mounted: its selectors must remain usable while work is pending.
  return <>{children(queue, {
    blocked: pending || failed,
    selectedJob: job,
    items: queueState.items,
    revision: queueState.items.map((item) => `${item.jobRef}:${item.status}`).join('|'),
    removedIds: [...removedIds.current]
  })}</>;
}
