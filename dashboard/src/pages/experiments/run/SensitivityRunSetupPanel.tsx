import { SensitivitySetupCard } from '../../run-experiments/SensitivitySetupCard';
import type { ExperimentDemoCoordinator } from '../../../components/ExperimentDemoOverlay';
import type { ExperimentRunController } from './useExperimentRunController';

interface SensitivityRunSetupPanelProps {
  controller: ExperimentRunController;
  runActionsDisabled: boolean;
  initialSensitivityStep?: number;
  experimentDemo?: ExperimentDemoCoordinator;
}

export function SensitivityRunSetupPanel({
  controller,
  runActionsDisabled,
  initialSensitivityStep,
  experimentDemo
}: SensitivityRunSetupPanelProps) {
  return (
    <SensitivitySetupCard
      draftId={controller.draftId}
      initialStep={initialSensitivityStep}
      executionDisabled={runActionsDisabled}
      isLoadingOptions={controller.isLoadingOptions || !controller.options}
      selectedBaseline={controller.selectedBaseline}
      onBaselineChange={controller.onBaselineChange}
      snapshots={controller.options?.snapshots ?? []}
      basePolicies={controller.options?.basePolicies ?? []}
      basePolicy={controller.sensitivityBasePolicy}
      onBasePolicyChange={controller.setSensitivityBasePolicy}
      policyPackages={controller.sensitivityPolicyPackages}
      policyPackageId={controller.sensitivityPolicyPackageId}
      onPolicyPackageChange={(value) => {
        controller.setSensitivityPolicyPackageId(value);
      }}
      minValue={controller.sensitivityMin}
      maxValue={controller.sensitivityMax}
      onMinValueChange={(value) => {
        controller.setSensitivityMin(value);
      }}
      onMaxValueChange={(value) => {
        controller.setSensitivityMax(value);
      }}
      sampleCount={controller.sensitivitySampleCount}
      onSampleCountChange={controller.setSensitivitySampleCount}
      parameters={controller.options?.parameters ?? []}
      formValues={controller.sensitivityFormValues}
      onFormValueChange={controller.onSensitivityFormValueChange}
      maxWorkers={controller.sensitivityMaxWorkers}
      maxWorkersCap={controller.sensitivityMaxWorkersCap}
      onMaxWorkersChange={controller.setSensitivityMaxWorkers}
      title={controller.sensitivityTitle}
      onTitleChange={controller.setSensitivityTitle}
      selectedPackage={controller.selectedSensitivityPackage}
      warnings={controller.sensitivityWarnings}
      isSubmitting={controller.isSubmittingSensitivity}
      isCanceling={controller.isCancelingSensitivity}
      sensitivitySubmissionLockedByManual={controller.sensitivitySubmissionLockedByManual}
      lockMessage={
        controller.sensitivitySubmissionLockedByManual
          ? `Sensitivity analyses are locked while scenario job ${controller.lockManualId} is active.`
          : null
      }
      hasActiveSensitivityJob={controller.hasActiveSensitivityJob}
      onSubmit={() => {
        void controller.onSubmitSensitivity();
      }}
      onCancelActive={() => {
        void controller.onCancelActiveSensitivity();
      }}
      sensitivityDemo={experimentDemo ? {
        ...experimentDemo,
        ready: controller.isDraftHydrated && Boolean(controller.options),
        loading: controller.isLoadingOptions,
        error: controller.isLoadingOptions ? '' : controller.pageError,
        onRetryLoad: () => {
          void controller.retryOptions();
        }
      } : undefined}
    />
  );
}
