import {
  DEFAULT_EXPERIMENT_ROUTE_STATE,
  EXPERIMENT_MODES,
  EXPERIMENT_TYPES,
  type ExperimentMode,
  type ExperimentRouteState,
  type ExperimentType
} from './types';

interface ExperimentRouteStateInput {
  type?: string;
  mode?: string;
  baselineRunId?: string;
  comparisonRunId?: string;
  runId?: string;
  experimentId?: string;
  jobRef?: string;
  follow?: string | boolean;
}

function parseFollowFlag(value: string | boolean | null | undefined): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  const cleaned = clean(value).toLowerCase();
  return cleaned === '1' || cleaned === 'true';
}

function isExperimentType(value: string): value is ExperimentType {
  return (EXPERIMENT_TYPES as readonly string[]).includes(value);
}

function isExperimentMode(value: string): value is ExperimentMode {
  return (EXPERIMENT_MODES as readonly string[]).includes(value);
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function cleanManualRunId(value: string | null | undefined): string {
  const cleaned = clean(value);
  return cleaned.toLowerCase() === 'default' ? '' : cleaned;
}

export function normaliseExperimentRouteState(
  partial: ExperimentRouteStateInput
): ExperimentRouteState {
  const type = isExperimentType(clean(partial.type))
    ? (clean(partial.type) as ExperimentType)
    : DEFAULT_EXPERIMENT_ROUTE_STATE.type;
  const mode = isExperimentMode(clean(partial.mode))
    ? (clean(partial.mode) as ExperimentMode)
    : DEFAULT_EXPERIMENT_ROUTE_STATE.mode;

  const baselineRunId = cleanManualRunId(partial.baselineRunId) || cleanManualRunId(partial.runId);
  const comparisonRunIdRaw = cleanManualRunId(partial.comparisonRunId);
  const base: ExperimentRouteState = {
    type,
    mode,
    baselineRunId,
    comparisonRunId:
      baselineRunId && comparisonRunIdRaw && comparisonRunIdRaw !== baselineRunId ? comparisonRunIdRaw : '',
    experimentId: clean(partial.experimentId),
    jobRef: clean(partial.jobRef),
    follow: parseFollowFlag(partial.follow)
  };

  if (base.mode === 'run') {
    return {
      ...base,
      baselineRunId: '',
      comparisonRunId: '',
      experimentId: '',
      follow: base.follow && Boolean(base.jobRef)
    };
  }

  if (base.type === 'manual') {
    return {
      ...base,
      experimentId: '',
      jobRef: '',
      follow: false
    };
  }

  return {
    ...base,
    baselineRunId: '',
    comparisonRunId: '',
    jobRef: '',
    follow: false
  };
}

export function parseExperimentRouteState(searchParams: URLSearchParams): ExperimentRouteState {
  return normaliseExperimentRouteState({
    type: clean(searchParams.get('type')),
    mode: clean(searchParams.get('mode')),
    baselineRunId: clean(searchParams.get('baselineRunId')) || clean(searchParams.get('runId')),
    comparisonRunId: clean(searchParams.get('comparisonRunId')),
    experimentId: clean(searchParams.get('experimentId')),
    jobRef: clean(searchParams.get('jobRef')),
    follow: clean(searchParams.get('follow'))
  });
}

export function buildExperimentSearchParams(state: ExperimentRouteState): URLSearchParams {
  const normalised = normaliseExperimentRouteState(state);
  const params = new URLSearchParams();
  params.set('type', normalised.type);
  params.set('mode', normalised.mode);

  if (normalised.mode === 'run' && normalised.jobRef) {
    params.set('jobRef', normalised.jobRef);
    if (normalised.follow) {
      params.set('follow', '1');
    }
  }

  if (normalised.mode === 'view' && normalised.type === 'manual' && normalised.baselineRunId) {
    params.set('baselineRunId', normalised.baselineRunId);
    if (normalised.comparisonRunId) {
      params.set('comparisonRunId', normalised.comparisonRunId);
    }
  }

  if (normalised.mode === 'view' && normalised.type === 'sensitivity' && normalised.experimentId) {
    params.set('experimentId', normalised.experimentId);
  }

  return params;
}

export function buildExperimentsPath(state: ExperimentRouteState): string {
  const normalised = normaliseExperimentRouteState(state);
  const params = new URLSearchParams();
  if (normalised.mode === 'run' && normalised.jobRef) {
    params.set('jobRef', normalised.jobRef);
    if (normalised.follow) params.set('follow', '1');
  }
  if (normalised.mode === 'view' && normalised.type === 'manual' && normalised.baselineRunId) {
    params.set('baselineRunId', normalised.baselineRunId);
    if (normalised.comparisonRunId) params.set('comparisonRunId', normalised.comparisonRunId);
  }
  if (normalised.mode === 'view' && normalised.type === 'sensitivity' && normalised.experimentId) {
    params.set('experimentId', normalised.experimentId);
  }
  const basePath = normalised.type === 'sensitivity'
    ? '/sensitivity'
    : normalised.mode === 'view' && normalised.comparisonRunId
      ? '/compare'
      : '/scenarios';
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
