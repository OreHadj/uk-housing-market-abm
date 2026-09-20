import { scenarioDraftStorageKey } from './scenarioDraft';
import { sensitivityDraftStorageKey } from './sensitivityDraft';

export const EXPERIMENT_DEMO_QUERY_VALUE = 'experiment';
export const EXPERIMENT_DEMO_SESSION_KEY = 'experiment-demo-progress-v2';
export const LEGACY_POLICY_EXPERIMENT_DEMO_SESSION_KEY = 'experiment-demo-policy-progress-v1';
export const EXPERIMENT_DEMO_POLICY_DRAFT_PREFIX = 'experiment-demo-policy-v2-';
export const EXPERIMENT_DEMO_SENSITIVITY_DRAFT_PREFIX = 'experiment-demo-sensitivity-v2-';

export type ExperimentDemoLaunchMode = 'policy' | 'sensitivity' | 'both';
export type ExperimentDemoChapter = 'policy' | 'sensitivity';
export type ExperimentDemoPhase = 'policy' | 'policy-transition' | 'sensitivity' | 'complete';

export interface ExperimentDemoChapterProgress {
  draftId: string;
  stepId: string;
  fingerprint: string;
}

export interface ExperimentDemoProgress {
  version: 2;
  journeyId: string;
  mode: ExperimentDemoLaunchMode;
  phase: ExperimentDemoPhase;
  paused: boolean;
  policy: ExperimentDemoChapterProgress;
  sensitivity: ExperimentDemoChapterProgress;
}

export interface ExperimentDemoProgressEvent {
  journeyId: string;
  chapter: ExperimentDemoChapter;
  draftId: string;
}

export interface ExperimentDemoStepProgressEvent extends ExperimentDemoProgressEvent {
  stepId: string;
  fingerprint: string;
}

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const VALID_MODES = new Set<ExperimentDemoLaunchMode>(['policy', 'sensitivity', 'both']);
const VALID_PHASES = new Set<ExperimentDemoPhase>([
  'policy',
  'policy-transition',
  'sensitivity',
  'complete'
]);

function browserSessionStorage(): SessionStorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createExperimentDemoJourneyId(): string {
  return `experiment-demo-${randomId()}`;
}

export function isExperimentDemoJourneyId(value: string): boolean {
  return /^experiment-demo-[a-zA-Z0-9][a-zA-Z0-9-]{5,}$/.test(value);
}

export function createExperimentDemoDraftId(chapter: ExperimentDemoChapter): string {
  const prefix = chapter === 'policy'
    ? EXPERIMENT_DEMO_POLICY_DRAFT_PREFIX
    : EXPERIMENT_DEMO_SENSITIVITY_DRAFT_PREFIX;
  return `${prefix}${randomId()}`;
}

export function isExperimentDemoPolicyDraftId(value: string): boolean {
  return value.startsWith(EXPERIMENT_DEMO_POLICY_DRAFT_PREFIX) &&
    value.length > EXPERIMENT_DEMO_POLICY_DRAFT_PREFIX.length;
}

export function isExperimentDemoSensitivityDraftId(value: string): boolean {
  return value.startsWith(EXPERIMENT_DEMO_SENSITIVITY_DRAFT_PREFIX) &&
    value.length > EXPERIMENT_DEMO_SENSITIVITY_DRAFT_PREFIX.length;
}

export function initialExperimentDemoPhase(mode: ExperimentDemoLaunchMode): ExperimentDemoPhase {
  return mode === 'sensitivity' ? 'sensitivity' : 'policy';
}

export function createExperimentDemoProgress(
  mode: ExperimentDemoLaunchMode,
  journeyId = createExperimentDemoJourneyId()
): ExperimentDemoProgress {
  const safeJourneyId = isExperimentDemoJourneyId(journeyId)
    ? journeyId
    : createExperimentDemoJourneyId();
  return {
    version: 2,
    journeyId: safeJourneyId,
    mode,
    phase: initialExperimentDemoPhase(mode),
    paused: false,
    policy: {
      draftId: createExperimentDemoDraftId('policy'),
      stepId: 'policy-purpose',
      fingerprint: ''
    },
    sensitivity: {
      draftId: createExperimentDemoDraftId('sensitivity'),
      stepId: 'sensitivity-purpose',
      fingerprint: ''
    }
  };
}

function parseChapterProgress(
  value: unknown,
  chapter: ExperimentDemoChapter
): ExperimentDemoChapterProgress | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ExperimentDemoChapterProgress>;
  const validDraft = chapter === 'policy'
    ? isExperimentDemoPolicyDraftId(candidate.draftId ?? '')
    : isExperimentDemoSensitivityDraftId(candidate.draftId ?? '');
  if (
    !validDraft ||
    typeof candidate.stepId !== 'string' ||
    !candidate.stepId ||
    candidate.stepId.length > 100 ||
    typeof candidate.fingerprint !== 'string' ||
    candidate.fingerprint.length > 1000
  ) return null;
  return {
    draftId: candidate.draftId!,
    stepId: candidate.stepId,
    fingerprint: candidate.fingerprint
  };
}

function phaseMatchesMode(mode: ExperimentDemoLaunchMode, phase: ExperimentDemoPhase): boolean {
  if (mode === 'policy') return phase === 'policy' || phase === 'policy-transition' || phase === 'complete';
  if (mode === 'sensitivity') return phase === 'sensitivity' || phase === 'complete';
  return true;
}

export function parseExperimentDemoProgress(raw: string | null): ExperimentDemoProgress | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ExperimentDemoProgress>;
    const mode = value.mode as ExperimentDemoLaunchMode;
    const phase = value.phase as ExperimentDemoPhase;
    const policy = parseChapterProgress(value.policy, 'policy');
    const sensitivity = parseChapterProgress(value.sensitivity, 'sensitivity');
    if (
      value.version !== 2 ||
      typeof value.journeyId !== 'string' ||
      !isExperimentDemoJourneyId(value.journeyId) ||
      !VALID_MODES.has(mode) ||
      !VALID_PHASES.has(phase) ||
      !phaseMatchesMode(mode, phase) ||
      typeof value.paused !== 'boolean' ||
      !policy ||
      !sensitivity
    ) return null;
    return {
      version: 2,
      journeyId: value.journeyId,
      mode,
      phase,
      paused: value.paused,
      policy,
      sensitivity
    };
  } catch {
    return null;
  }
}

export function readExperimentDemoProgress(
  storage: SessionStorageLike | null = browserSessionStorage()
): ExperimentDemoProgress | null {
  if (!storage) return null;
  try {
    return parseExperimentDemoProgress(storage.getItem(EXPERIMENT_DEMO_SESSION_KEY));
  } catch {
    return null;
  }
}

export function writeExperimentDemoProgress(
  progress: ExperimentDemoProgress,
  storage: SessionStorageLike | null = browserSessionStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(EXPERIMENT_DEMO_SESSION_KEY, JSON.stringify(progress));
  } catch {
    // A blocked session store should not make the in-memory tour unusable.
  }
}

export function updateExperimentDemoStep(
  progress: ExperimentDemoProgress,
  event: ExperimentDemoStepProgressEvent
): ExperimentDemoProgress {
  const currentChapter = progress[event.chapter];
  if (
    progress.journeyId !== event.journeyId ||
    currentChapter.draftId !== event.draftId ||
    !event.stepId ||
    event.stepId.length > 100
  ) return progress;
  const nextFingerprint = event.fingerprint.slice(0, 1000);
  if (
    currentChapter.stepId === event.stepId &&
    currentChapter.fingerprint === nextFingerprint
  ) return progress;
  return {
    ...progress,
    [event.chapter]: {
      ...currentChapter,
      stepId: event.stepId,
      fingerprint: nextFingerprint
    }
  };
}

export function completeExperimentDemoChapter(
  progress: ExperimentDemoProgress,
  event: ExperimentDemoProgressEvent
): ExperimentDemoProgress {
  const currentChapter = progress[event.chapter];
  if (
    progress.journeyId !== event.journeyId ||
    currentChapter.draftId !== event.draftId
  ) return progress;

  if (event.chapter === 'policy' && progress.phase === 'policy') {
    return { ...progress, phase: 'policy-transition' };
  }
  if (event.chapter === 'sensitivity' && progress.phase === 'sensitivity') {
    return { ...progress, phase: 'complete' };
  }
  return progress;
}

export function continueExperimentDemoToSensitivity(
  progress: ExperimentDemoProgress,
  journeyId: string
): ExperimentDemoProgress {
  if (
    progress.journeyId !== journeyId ||
    progress.mode !== 'both' ||
    progress.phase !== 'policy-transition'
  ) return progress;
  return { ...progress, phase: 'sensitivity', paused: false };
}

export function setExperimentDemoPaused(
  progress: ExperimentDemoProgress,
  journeyId: string,
  paused: boolean
): ExperimentDemoProgress {
  if (progress.journeyId !== journeyId) return progress;
  return { ...progress, paused };
}

function legacyPolicyDraftId(raw: string | null): string {
  if (!raw) return '';
  try {
    const value = JSON.parse(raw) as { draftId?: unknown };
    return typeof value.draftId === 'string' && value.draftId.startsWith('experiment-demo-policy-')
      ? value.draftId
      : '';
  } catch {
    return '';
  }
}

/** Clears only demo-owned progress and draft bodies. Ordinary active-draft pointers are untouched. */
export function clearExperimentDemoState(
  journeyId = '',
  storage: SessionStorageLike | null = browserSessionStorage()
): void {
  if (!storage) return;
  try {
    const progress = parseExperimentDemoProgress(storage.getItem(EXPERIMENT_DEMO_SESSION_KEY));
    if (progress && (!journeyId || progress.journeyId === journeyId)) {
      storage.removeItem(scenarioDraftStorageKey(progress.policy.draftId));
      storage.removeItem(sensitivityDraftStorageKey(progress.sensitivity.draftId));
      storage.removeItem(EXPERIMENT_DEMO_SESSION_KEY);
    } else if (!progress && !journeyId) {
      storage.removeItem(EXPERIMENT_DEMO_SESSION_KEY);
    }

    const legacyDraftId = legacyPolicyDraftId(
      storage.getItem(LEGACY_POLICY_EXPERIMENT_DEMO_SESSION_KEY)
    );
    if (legacyDraftId) storage.removeItem(scenarioDraftStorageKey(legacyDraftId));
    storage.removeItem(LEGACY_POLICY_EXPERIMENT_DEMO_SESSION_KEY);
  } catch {
    // Exiting remains safe when storage is unavailable.
  }
}

export function experimentDemoLaunchMode(
  searchParams: URLSearchParams
): ExperimentDemoLaunchMode | null {
  if (searchParams.get('demo') !== EXPERIMENT_DEMO_QUERY_VALUE) return null;
  const mode = searchParams.get('mode');
  if (mode && VALID_MODES.has(mode as ExperimentDemoLaunchMode)) {
    return mode as ExperimentDemoLaunchMode;
  }
  // Version-one Policy preview URLs fail forward into the complete standalone Policy chapter.
  if (searchParams.get('segment') === 'policy') return 'policy';
  return null;
}

export function isExperimentDemoRequested(
  searchParams: URLSearchParams,
  chapter?: ExperimentDemoChapter
): boolean {
  const mode = experimentDemoLaunchMode(searchParams);
  if (!mode) return false;
  if (!chapter) return true;
  return mode === 'both' || mode === chapter;
}

export function buildExperimentDemoLaunchHref(
  mode: ExperimentDemoLaunchMode,
  journeyId = '',
  chapter: ExperimentDemoChapter = mode === 'sensitivity' ? 'sensitivity' : 'policy'
): string {
  const path = chapter === 'policy' ? '/scenarios/new' : '/sensitivity/new';
  const params = new URLSearchParams({ demo: EXPERIMENT_DEMO_QUERY_VALUE, mode });
  if (isExperimentDemoJourneyId(journeyId)) params.set('journey', journeyId);
  return `${path}?${params.toString()}`;
}

export const EXPERIMENT_DEMO_COMBINED_LAUNCH_HREF = buildExperimentDemoLaunchHref('both');
export const EXPERIMENT_DEMO_POLICY_LAUNCH_HREF = buildExperimentDemoLaunchHref('policy');
export const EXPERIMENT_DEMO_SENSITIVITY_LAUNCH_HREF = buildExperimentDemoLaunchHref('sensitivity');
