import { scenarioDraftStorageKey } from './scenarioDraft';

export const POLICY_EXPERIMENT_DEMO_QUERY_VALUE = 'experiment';
export const POLICY_EXPERIMENT_DEMO_SEGMENT = 'policy';
export const POLICY_EXPERIMENT_DEMO_SESSION_KEY = 'experiment-demo-policy-progress-v1';
export const POLICY_EXPERIMENT_DEMO_DRAFT_PREFIX = 'experiment-demo-policy-';
export const POLICY_EXPERIMENT_DEMO_LAUNCH_HREF =
  '/scenarios/new?demo=experiment&segment=policy';

export type PolicyExperimentDemoStageId =
  | 'introduction'
  | 'scenario-name'
  | 'continue'
  | 'complete';

export interface PolicyExperimentDemoProgress {
  version: 1;
  draftId: string;
  stageId: PolicyExperimentDemoStageId;
}

interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const POLICY_EXPERIMENT_DEMO_STAGES = new Set<PolicyExperimentDemoStageId>([
  'introduction',
  'scenario-name',
  'continue',
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

export function isPolicyExperimentDemoRequested(searchParams: URLSearchParams): boolean {
  return searchParams.get('demo') === POLICY_EXPERIMENT_DEMO_QUERY_VALUE &&
    searchParams.get('segment') === POLICY_EXPERIMENT_DEMO_SEGMENT;
}

export function isPolicyExperimentDemoDraftId(draftId: string): boolean {
  return draftId.startsWith(POLICY_EXPERIMENT_DEMO_DRAFT_PREFIX) &&
    draftId.length > POLICY_EXPERIMENT_DEMO_DRAFT_PREFIX.length;
}

export function createPolicyExperimentDemoDraftId(): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${POLICY_EXPERIMENT_DEMO_DRAFT_PREFIX}${suffix}`;
}

export function createPolicyExperimentDemoProgress(
  draftId: string,
  stageId: PolicyExperimentDemoStageId = 'introduction'
): PolicyExperimentDemoProgress {
  return { version: 1, draftId, stageId };
}

export function parsePolicyExperimentDemoProgress(raw: string | null): PolicyExperimentDemoProgress | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PolicyExperimentDemoProgress>;
    if (
      value.version !== 1 ||
      typeof value.draftId !== 'string' ||
      !isPolicyExperimentDemoDraftId(value.draftId) ||
      typeof value.stageId !== 'string' ||
      !POLICY_EXPERIMENT_DEMO_STAGES.has(value.stageId as PolicyExperimentDemoStageId)
    ) return null;
    return {
      version: 1,
      draftId: value.draftId,
      stageId: value.stageId as PolicyExperimentDemoStageId
    };
  } catch {
    return null;
  }
}

export function readPolicyExperimentDemoProgress(
  storage: SessionStorageLike | null = browserSessionStorage()
): PolicyExperimentDemoProgress | null {
  if (!storage) return null;
  try {
    return parsePolicyExperimentDemoProgress(storage.getItem(POLICY_EXPERIMENT_DEMO_SESSION_KEY));
  } catch {
    return null;
  }
}

export function writePolicyExperimentDemoProgress(
  progress: PolicyExperimentDemoProgress,
  storage: SessionStorageLike | null = browserSessionStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(POLICY_EXPERIMENT_DEMO_SESSION_KEY, JSON.stringify(progress));
  } catch {
    // The current preview remains usable if session storage is blocked.
  }
}

/**
 * Removes only Policy-preview state. In particular, this never reads, writes, or clears the
 * ordinary `scenario-draft:v1:active` pointer.
 */
export function clearPolicyExperimentDemoState(
  draftId = '',
  storage: SessionStorageLike | null = browserSessionStorage()
): void {
  if (!storage) return;
  try {
    const storedProgress = parsePolicyExperimentDemoProgress(
      storage.getItem(POLICY_EXPERIMENT_DEMO_SESSION_KEY)
    );
    const demoDraftIds = new Set([
      isPolicyExperimentDemoDraftId(draftId) ? draftId : '',
      storedProgress?.draftId ?? ''
    ]);
    for (const demoDraftId of demoDraftIds) {
      if (isPolicyExperimentDemoDraftId(demoDraftId)) {
        storage.removeItem(scenarioDraftStorageKey(demoDraftId));
      }
    }
    storage.removeItem(POLICY_EXPERIMENT_DEMO_SESSION_KEY);
  } catch {
    // Leaving the preview must still succeed when storage is unavailable.
  }
}
