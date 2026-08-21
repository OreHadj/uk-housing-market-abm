import type { ComponentType } from 'react';
import type { ExperimentType } from './types';
import { ManualRunSetupPanel } from './run/ManualRunSetupPanel';
import { SensitivityRunSetupPanel } from './run/SensitivityRunSetupPanel';
import type { ExperimentRunController } from './run/useExperimentRunController';
import { ManualResultsView } from './view/ManualResultsView';
import { SensitivityResultsView } from './view/SensitivityResultsView';

export interface ExperimentRunRendererProps {
  controller: ExperimentRunController;
  runActionsDisabled: boolean;
  initialScenarioStep?: number;
  initialSensitivityStep?: number;
}

export interface ExperimentViewRendererProps {
  canWrite: boolean;
  canDownloadResults: boolean;
  canDeleteResults: boolean;
  deleteKeyRequired: boolean;
  authEnabled: boolean;
  requestedBaselineRunId: string;
  requestedComparisonRunId: string;
  requestedExperimentId: string;
  onManualSelectionChange: (selection: { baselineRunId: string; comparisonRunId: string }) => void;
  onSelectedExperimentIdChange: (experimentId: string) => void;
  sidebarSubtitle: string;
}

interface ExperimentTypeDefinition {
  label: string;
  viewSidebarSubtitle: string;
  RunSetupComponent: ComponentType<ExperimentRunRendererProps>;
  ViewComponent: ComponentType<ExperimentViewRendererProps>;
}

const ManualViewRenderer: ComponentType<ExperimentViewRendererProps> = ({
  canWrite,
  canDownloadResults,
  canDeleteResults,
  deleteKeyRequired,
  authEnabled,
  requestedBaselineRunId,
  requestedComparisonRunId,
  onManualSelectionChange,
  sidebarSubtitle
}) => (
  <ManualResultsView
    canWrite={canWrite}
    canDownloadResults={canDownloadResults}
    canDeleteResults={canDeleteResults}
    deleteKeyRequired={deleteKeyRequired}
    authEnabled={authEnabled}
    requestedBaselineRunId={requestedBaselineRunId}
    requestedComparisonRunId={requestedComparisonRunId}
    onManualSelectionChange={onManualSelectionChange}
    sidebarSubtitle={sidebarSubtitle}
  />
);

const SensitivityViewRenderer: ComponentType<ExperimentViewRendererProps> = ({
  canWrite,
  canDownloadResults,
  canDeleteResults,
  deleteKeyRequired,
  authEnabled,
  requestedExperimentId,
  onSelectedExperimentIdChange,
  sidebarSubtitle
}) => (
  <SensitivityResultsView
    canWrite={canWrite}
    canDownloadResults={canDownloadResults}
    canDeleteResults={canDeleteResults}
    deleteKeyRequired={deleteKeyRequired}
    authEnabled={authEnabled}
    requestedExperimentId={requestedExperimentId}
    onSelectedExperimentIdChange={onSelectedExperimentIdChange}
    sidebarSubtitle={sidebarSubtitle}
  />
);

export const experimentTypeRegistry: Record<ExperimentType, ExperimentTypeDefinition> = {
  manual: {
    label: 'Scenario',
    viewSidebarSubtitle: 'Selected run required, comparison optional.',
    RunSetupComponent: ManualRunSetupPanel,
    ViewComponent: ManualViewRenderer
  },
  sensitivity: {
    label: 'Sensitivity analysis',
    viewSidebarSubtitle: 'Completed and in-progress sensitivity analyses.',
    RunSetupComponent: SensitivityRunSetupPanel,
    ViewComponent: SensitivityViewRenderer
  }
};
