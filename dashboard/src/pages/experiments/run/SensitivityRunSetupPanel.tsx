import { SensitivitySetupCard } from '../../run-experiments/SensitivitySetupCard';
import type { ExperimentRunController } from './useExperimentRunController';

interface SensitivityRunSetupPanelProps {
  controller: ExperimentRunController;
  runActionsDisabled: boolean;
}

export function SensitivityRunSetupPanel({ controller, runActionsDisabled }: SensitivityRunSetupPanelProps) {
  return (
    <SensitivitySetupCard
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
          ? `Policy sensitivity sweeps are locked while policy scenario job ${controller.lockManualId} is active.`
          : null
      }
      hasActiveSensitivityJob={controller.hasActiveSensitivityJob}
      onSubmit={(confirmWarnings) => {
        void controller.onSubmitSensitivity(confirmWarnings);
      }}
      onCancelActive={() => {
        void controller.onCancelActiveSensitivity();
      }}
    />
  );
}
