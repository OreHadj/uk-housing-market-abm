import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ExperimentJobSummary } from '../../../../shared/types';
import { deleteExperimentJob, downloadResultsRun, downloadSensitivityExperiment } from '../../../lib/api';
import { buildExperimentsPath } from '../routeState';
import { DEFAULT_EXPERIMENT_ROUTE_STATE, type ExperimentType } from '../types';
import { experimentTypeRegistry } from '../registry';
import { ExperimentLogCard } from '../../run-experiments/ExperimentLogCard';
import { ExperimentQueueCard } from '../../run-experiments/ExperimentQueueCard';
import { useExperimentRunController } from './useExperimentRunController';

interface ExperimentRunModeProps {
  activeType: ExperimentType;
  canWrite: boolean;
  canDownloadResults: boolean;
  canDeleteResults: boolean;
  deleteKeyRequired: boolean;
  authEnabled: boolean;
  selectedJobRef: string;
  onSelectedJobRefChange: (jobRef: string) => void;
  onOpenManualResults: (runId: string) => void;
  onOpenSensitivityResults: (experimentId: string) => void;
  followJobRef?: string;
  showRunManagement?: boolean;
}

export function ExperimentRunMode({
  activeType,
  canWrite,
  canDownloadResults,
  canDeleteResults,
  deleteKeyRequired,
  authEnabled,
  selectedJobRef,
  onSelectedJobRefChange,
  onOpenManualResults,
  onOpenSensitivityResults,
  followJobRef,
  showRunManagement = true
}: ExperimentRunModeProps) {
  const controller = useExperimentRunController({
    selectedJobRef,
    onSelectedJobRefChange,
    onOpenManualResults,
    onOpenSensitivityResults,
    followJobRef
  });
  const [downloadingJobRef, setDownloadingJobRef] = useState<string>('');
  const [deletingJobRef, setDeletingJobRef] = useState<string>('');
  const [downloadError, setDownloadError] = useState<string>('');
  const [deleteError, setDeleteError] = useState<string>('');

  const runActionsDisabled = controller.executionDisabled || !canWrite;
  const RunSetupComponent = experimentTypeRegistry[activeType].RunSetupComponent;
  const workspaceJobs = controller.jobs.filter((job) => job.type === activeType);

  const downloadJobResults = async (job: ExperimentJobSummary) => {
    if (!canDownloadResults) {
      return;
    }
    setDownloadError('');
    setDownloadingJobRef(job.jobRef);
    try {
      if (job.type === 'manual' && job.runId) {
        await downloadResultsRun(job.runId);
      } else if (job.type === 'sensitivity') {
        await downloadSensitivityExperiment(job.id);
      }
    } catch (error) {
      setDownloadError((error as Error).message);
    } finally {
      setDownloadingJobRef('');
    }
  };

  const deleteJob = async (job: ExperimentJobSummary) => {
    if (!canDeleteResults) {
      return;
    }
    const confirmed = window.confirm(`Delete ${job.type} experiment "${job.title}"? This permanently removes its results.`);
    if (!confirmed) {
      return;
    }

    const deleteKey = deleteKeyRequired ? window.prompt('Enter the private delete key to delete remote experiment results.') : undefined;
    if (deleteKeyRequired && !deleteKey) {
      return;
    }

    setDeleteError('');
    setDeletingJobRef(job.jobRef);
    try {
      await deleteExperimentJob(job.jobRef, deleteKey ?? undefined);
      await controller.refreshJobs();
    } catch (error) {
      setDeleteError((error as Error).message);
    } finally {
      setDeletingJobRef('');
    }
  };

  return (
    <section className="run-exp-layout">
      {controller.pageError && <p className="error-banner">{controller.pageError}</p>}
      {controller.logError && <p className="error-banner">{controller.logError}</p>}
      {downloadError && <p className="error-banner">{downloadError}</p>}
      {deleteError && <p className="error-banner">{deleteError}</p>}

      {controller.pendingRunId && (
        <p className="waiting-banner">
          Run completed. Redirecting to results...{' '}
          <Link
            to={buildExperimentsPath({
              ...DEFAULT_EXPERIMENT_ROUTE_STATE,
              mode: 'view',
              type: 'manual',
              baselineRunId: controller.pendingRunId
            })}
          >
            View results
          </Link>
        </p>
      )}

      {controller.pendingSensitivityExperimentId && (
        <p className="waiting-banner">
          Sensitivity analysis completed. Redirecting to results...{' '}
          <Link
            to={buildExperimentsPath({
              ...DEFAULT_EXPERIMENT_ROUTE_STATE,
              mode: 'view',
              type: 'sensitivity',
              experimentId: controller.pendingSensitivityExperimentId
            })}
          >
            View results
          </Link>
        </p>
      )}

      {controller.executionDisabled && (
        <p className="info-banner">
          {controller.executionDisabledReason ||
            'Model execution is currently unavailable because model runs are disabled or Java/Maven are missing in this API runtime.'}
        </p>
      )}

      {!canWrite && authEnabled && (
        <p className="info-banner">
          Write access is required to run or cancel experiments.{' '}
          <Link
            className="summary-link-inline"
            to={`/login?next=${encodeURIComponent(
              buildExperimentsPath({
                ...DEFAULT_EXPERIMENT_ROUTE_STATE,
                mode: 'run',
                type: activeType
              })
            )}`}
          >
            Login for run access
          </Link>
        </p>
      )}

      <div className="run-exp-grid">
        <RunSetupComponent controller={controller} runActionsDisabled={runActionsDisabled} />

        {showRunManagement && (
          <>
            <ExperimentQueueCard
              jobs={workspaceJobs}
              workspaceType={activeType}
              isLoading={controller.isLoadingJobs}
              selectedJobRef={selectedJobRef}
              onSelectJobRef={onSelectedJobRefChange}
              executionDisabled={runActionsDisabled}
              authEnabled={authEnabled}
              canDownloadResults={canDownloadResults}
              canDeleteResults={canDeleteResults}
              downloadingJobRef={downloadingJobRef}
              deletingJobRef={deletingJobRef}
              onOpenResults={(job) => {
                if (job.type === 'manual' && job.runId) {
                  onOpenManualResults(job.runId);
                } else if (job.type === 'sensitivity') {
                  onOpenSensitivityResults(job.id);
                }
              }}
              onCancelJob={(jobRef) => {
                void controller.onCancelJob(jobRef);
              }}
              onDownloadJob={(job) => {
                void downloadJobResults(job);
              }}
              onDeleteJob={(job) => {
                void deleteJob(job);
              }}
            />

            <ExperimentLogCard
              selectedJob={controller.selectedJob}
              lines={controller.logLines}
              progress={controller.logProgress}
            />
          </>
        )}
      </div>
    </section>
  );
}
