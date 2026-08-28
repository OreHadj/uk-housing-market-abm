import { ManualRunSetupCard } from '../../run-experiments/ManualRunSetupCard';
import type { PolicyExperimentDemoCoordinator } from '../../../components/PolicyExperimentDemoPrototype';
import type { ExperimentRunController } from './useExperimentRunController';

interface ManualRunSetupPanelProps {
  controller: ExperimentRunController;
  runActionsDisabled: boolean;
  initialScenarioStep?: number;
  policyDemo?: PolicyExperimentDemoCoordinator;
}

export function ManualRunSetupPanel({
  controller,
  runActionsDisabled,
  initialScenarioStep = 0,
  policyDemo
}: ManualRunSetupPanelProps) {
  return (
    <ManualRunSetupCard
      formDisabled={controller.isSubmitting}
      submissionDisabled={runActionsDisabled}
      submissionDisabledReason={
        policyDemo?.active
          ? 'This guided preview never submits a model run.'
          : controller.executionDisabled
          ? controller.executionDisabledReason || 'Simulation execution is unavailable in this runtime.'
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
      policyDemo={policyDemo ? {
        ...policyDemo,
        ready: controller.isDraftHydrated && Boolean(controller.options),
        loading: controller.isLoadingOptions,
        error: controller.isDraftHydrated ? '' : controller.pageError,
        onRetryLoad: () => {
          void controller.retryOptions();
        }
      } : undefined}
    />
  );
}
