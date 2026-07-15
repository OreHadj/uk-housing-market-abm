export const EXPERIMENT_TYPES = ['manual', 'sensitivity'] as const;
export type ExperimentType = (typeof EXPERIMENT_TYPES)[number];

export const EXPERIMENT_MODES = ['run', 'view'] as const;
export type ExperimentMode = (typeof EXPERIMENT_MODES)[number];

export interface ExperimentRouteState {
  type: ExperimentType;
  mode: ExperimentMode;
  baselineRunId: string;
  comparisonRunId: string;
  experimentId: string;
  jobRef: string;
  // When true (run mode, manual job), auto-redirect to results once the focused job completes.
  // Used by the Home "Default Run" hand-off; expert-initiated runs leave this false.
  follow: boolean;
}

export const DEFAULT_EXPERIMENT_ROUTE_STATE: ExperimentRouteState = {
  type: 'sensitivity',
  mode: 'run',
  baselineRunId: '',
  comparisonRunId: '',
  experimentId: '',
  jobRef: '',
  follow: false
};
