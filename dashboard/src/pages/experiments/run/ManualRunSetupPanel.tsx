import { ManualRunSetupCard } from '../../run-experiments/ManualRunSetupCard';
import type { ExperimentRunController } from './useExperimentRunController';

interface ManualRunSetupPanelProps {
  controller: ExperimentRunController;
  runActionsDisabled: boolean;
}

export function ManualRunSetupPanel({ controller, runActionsDisabled }: ManualRunSetupPanelProps) {
  return (
    <ManualRunSetupCard
      formDisabled={controller.isSubmitting}
      submissionDisabled={runActionsDisabled}
      submissionDisabledReason={
        controller.executionDisabled
          ? controller.executionDisabledReason || 'Simulation execution is unavailable in this runtime.'
          : 'Run submission requires write access in this runtime.'
      }
      isLoadingOptions={!controller.options}
      selectedBaseline={controller.selectedBaseline}
      onBaselineChange={controller.onBaselineChange}
      basePolicies={controller.options?.basePolicies ?? []}
      basePolicy={controller.basePolicy}
      onBasePolicyChange={controller.setBasePolicy}
      snapshots={controller.options?.snapshots ?? []}
      title={controller.title}
      onTitleChange={controller.setTitle}
      parameters={controller.options?.parameters ?? []}
      policyParameters={controller.policyParameters}
      formValues={controller.formValues}
      onFormValueChange={controller.onFormValueChange}
      maxWorkers={controller.manualMaxWorkers}
      maxWorkersCap={controller.maxWorkersCap}
      onMaxWorkersChange={controller.setManualMaxWorkers}
      warnings={controller.warnings}
      isSubmitting={controller.isSubmitting}
      manualSubmissionLockedBySensitivity={controller.manualSubmissionLockedBySensitivity}
      lockMessage={
        controller.manualSubmissionLockedBySensitivity
          ? `Manual runs are locked while sensitivity experiment ${controller.lockSensitivityId} is active.`
          : null
      }
      onSubmit={(confirmWarnings) => {
        void controller.onSubmitRun(confirmWarnings);
      }}
    />
  );
}
