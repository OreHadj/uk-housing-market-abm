import type { ExperimentType } from '../pages/experiments/types';
import { createScenarioDraftId, resumableScenarioDraftId } from './scenarioDraft';
import { createSensitivityDraftId, resumableSensitivityDraftId } from './sensitivityDraft';

export type PrimaryDestination = 'home' | 'experiments' | 'results' | 'model-evidence' | 'settings';

export type ModelInformationView = 'calibration' | 'validation';

export const MODEL_INFORMATION_VIEWS = [
  {
    id: 'calibration',
    label: 'Calibration',
    description: 'Review the evidence and assumptions used to configure each model version.'
  },
  {
    id: 'validation',
    label: 'Validation',
    description: 'Compare model outputs with UK evidence.'
  }
] as const satisfies readonly { id: ModelInformationView; label: string; description: string }[];

export function getModelInformationView(search: URLSearchParams): ModelInformationView {
  return search.get('view')?.trim() === 'validation' ? 'validation' : 'calibration';
}

/** Switching evidence sections retains model selections, return context and tour state. */
export function buildModelInformationViewHref(search: URLSearchParams, view: ModelInformationView): string {
  const next = new URLSearchParams(search);
  next.set('view', view);
  return `/model-evidence?${next.toString()}`;
}


export const PRIMARY_DESTINATION_LABELS: Record<PrimaryDestination, string> = {
  home: 'Home',
  experiments: 'Experiments',
  results: 'Results',
  'model-evidence': 'Model information',
  settings: 'Settings'
};

export function getActivePrimaryDestination(pathname: string): PrimaryDestination | null {
  if (pathname === '/') return 'home';
  if (pathname === '/experiments') return 'experiments';
  if (pathname === '/results') return 'results';
  if (pathname === '/settings') return 'settings';
  if (pathname === '/model-evidence' || pathname === '/calibration' || pathname === '/validation') {
    return 'model-evidence';
  }
  return getExperimentType(pathname) ? 'experiments' : null;
}

export function getExperimentType(pathname: string): ExperimentType | null {
  if (pathname === '/sensitivity' || pathname === '/sensitivity/new') return 'sensitivity';
  if (
    pathname === '/scenarios' || pathname === '/scenarios/new' ||
    pathname === '/runs' || pathname === '/new-scenario' || pathname === '/compare'
  ) return 'manual';
  return null;
}

export function getResultsType(search: URLSearchParams): ExperimentType {
  const requested = search.get('type')?.trim();
  if (requested) return requested === 'sensitivity' ? 'sensitivity' : 'manual';
  const jobType = search.get('jobRef')?.trim().split(':')[0];
  if (jobType === 'manual' || jobType === 'sensitivity') return jobType;
  const demo = search.get('demo') || search.get('resultsDemo');
  if (demo === 'policy-results' || search.get('practice') === 'policy') return 'manual';
  if (demo === 'sensitivity-results' || search.get('practice') === 'sensitivity') return 'sensitivity';
  const hasPolicySelection = ['baselineRunId', 'comparisonRunId', 'runId'].some((key) => search.get(key)?.trim());
  return search.get('experimentId')?.trim() && !hasPolicySelection ? 'sensitivity' : 'manual';
}

/** Bare Results opens the chooser. Saved selections, jobs and report controls open a view. */
export function isResultsLanding(search: URLSearchParams): boolean {
  const resultKeys = [
    'type', 'baselineRunId', 'comparisonRunId', 'runId', 'experimentId', 'jobRef',
    'presentation', 'queue', 'window', 'indicator', 'outcome', 'setting', 'policyResults',
    'practice', 'resultsDemo'
  ];
  if (resultKeys.some((key) => search.get(key)?.trim())) return false;
  return !['policy-results', 'sensitivity-results', 'navigation'].includes(search.get('demo') ?? '');
}

/** Remember result selections without carrying a presentation choice or restarting a walkthrough. */
export function getResultsNavigationSearch(search: URLSearchParams): string {
  const next = new URLSearchParams(search);
  for (const key of ['presentation', 'demo', 'step', 'tour', 'from', 'journey', 'practice', 'resultsDemo']) next.delete(key);
  return next.size ? `?${next}` : '';
}

export function getExperimentSetupPath(type: ExperimentType): string {
  return type === 'manual' ? '/scenarios/new' : '/sensitivity/new';
}

/** Resolve the destination's own draft at click time, before its controller mounts. */
export function resolveExperimentSetupHref(type: ExperimentType): string {
  const draftId = type === 'manual'
    ? resumableScenarioDraftId() || createScenarioDraftId()
    : resumableSensitivityDraftId() || createSensitivityDraftId();
  return `${getExperimentSetupPath(type)}?${new URLSearchParams({ draft: draftId })}`;
}

/** Every results entry opens Report while retaining selections and other controls. */
export function buildResultsTypeHref(search: URLSearchParams, type: ExperimentType): string {
  const next = new URLSearchParams(search);
  next.set('type', type);
  next.set('presentation', 'report');
  return `/results?${next.toString()}`;
}
