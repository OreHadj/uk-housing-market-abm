import { ManualRunSetupCard } from '../../run-experiments/ManualRunSetupCard';
import type { ExperimentDemoCoordinator } from '../../../lib/guidedDemos/creation';
import type { ExperimentRunController } from './useExperimentRunController';

interface ManualRunSetupPanelProps {
  controller: ExperimentRunController;
  runActionsDisabled: boolean;
  initialScenarioStep?: number;
  experimentDemo?: ExperimentDemoCoordinator;
}

export function ManualRunSetupPanel({
  controller,
  runActionsDisabled,
  initialScenarioStep,
  experimentDemo
}: ManualRunSetupPanelProps) {
  return (
    <ManualRunSetupCard
      formDisabled={controller.isSubmitting}
      submissionDisabled={runActionsDisabled}
      submissionDisabledReason={
        controller.executionDisabled
          ? controller.executionDisabledReason || 'Simulation execution is unavailable in this runtime.'
          : experimentDemo?.policyRun
          ? 'This practice already has a pending or submitted run. Open its Results entry.'
          : experimentDemo?.active && !experimentDemo.allowPolicySubmission
          ? 'Start is available at the practice guide’s Start lesson.'
          : 'Run submission requires write access in this runtime.'
      }
      isLoadingOptions={!controller.options}
      draftId={controller.draftId}
      draftNotice={controller.draftNotice}
      initialStep={initialScenarioStep}
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
      lockedParameterKeys={controller.manualLockedParameterKeys}
      onFormValueChange={controller.onFormValueChange}
      maxWorkers={controller.manualMaxWorkers}
      maxWorkersCap={controller.maxWorkersCap}
      onMaxWorkersChange={controller.setManualMaxWorkers}
      warnings={controller.warnings}
      isSubmitting={controller.isSubmitting}
      manualSubmissionLockedBySensitivity={controller.manualSubmissionLockedBySensitivity}
      lockMessage={
        controller.manualSubmissionLockedBySensitivity
          ? `Policy scenario runs are locked while policy sensitivity sweep ${controller.lockSensitivityId} is active.`
          : null
      }
      onSubmit={(confirmWarnings) => {
        void controller.onSubmitRun(confirmWarnings);
      }}
      policyDemo={experimentDemo ? {
        ...experimentDemo,
        ready: controller.isDraftHydrated && Boolean(controller.options),
        loading: controller.isLoadingOptions,
        error: controller.isLoadingOptions ? '' : controller.optionsError,
        onRetryLoad: () => {
          void controller.retryOptions();
        }
      } : undefined}
    />
  );
}
