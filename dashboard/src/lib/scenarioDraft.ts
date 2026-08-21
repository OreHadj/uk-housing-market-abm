import type { BasePolicyId, ModelRunOptionsPayload } from '../../shared/types';
import type { FormValue } from './experimentRunDefaults';

const STORAGE_PREFIX = 'scenario-draft:v1:';
/**
 * Which draft the scenario modal should resume. Draft bodies are keyed by a random id that only
 * ever travels in the `?draft=` query param, so closing the modal — which returns to /experiments
 * and drops the param — used to strand the saved draft under an id nothing could name again. This
 * pointer is how reopening finds it.
 */
const ACTIVE_DRAFT_KEY = 'scenario-draft:v1:active';

export interface ScenarioDraftV1 {
  version: 1;
  title: string;
  calibratedModel: string;
  basePolicy: BasePolicyId;
  formValues: Record<string, FormValue>;
  maxWorkers: string;
}

export interface RestoredScenarioDraft {
  draft: ScenarioDraftV1;
  choicesChanged: boolean;
}

export function createScenarioDraftId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function scenarioDraftStorageKey(draftId: string): string {
  return `${STORAGE_PREFIX}${draftId}`;
}

export function readScenarioDraft(draftId: string): ScenarioDraftV1 | null {
  if (!draftId) return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(scenarioDraftStorageKey(draftId)) ?? 'null') as Partial<ScenarioDraftV1> | null;
    if (!parsed || parsed.version !== 1 || typeof parsed.title !== 'string' || typeof parsed.calibratedModel !== 'string') {
      return null;
    }
    return {
      version: 1,
      title: parsed.title,
      calibratedModel: parsed.calibratedModel,
      basePolicy: typeof parsed.basePolicy === 'string' ? parsed.basePolicy : '2024',
      formValues: parsed.formValues && typeof parsed.formValues === 'object' ? parsed.formValues : {},
      maxWorkers: typeof parsed.maxWorkers === 'string' ? parsed.maxWorkers : '1',
    };
  } catch {
    return null;
  }
}

export function writeScenarioDraft(draftId: string, draft: ScenarioDraftV1): void {
  if (draftId) sessionStorage.setItem(scenarioDraftStorageKey(draftId), JSON.stringify(draft));
}

export function clearScenarioDraft(draftId: string): void {
  if (!draftId) return;
  sessionStorage.removeItem(scenarioDraftStorageKey(draftId));
  // Discarding or submitting a draft must also retire the pointer, or the next open resumes an id
  // whose body is gone.
  if (readActiveScenarioDraftId() === draftId) {
    clearActiveScenarioDraftId();
  }
}

/** The draft to resume, or '' when there is no stored draft to return to. */
export function readActiveScenarioDraftId(): string {
  try {
    return sessionStorage.getItem(ACTIVE_DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setActiveScenarioDraftId(draftId: string): void {
  try {
    if (draftId) sessionStorage.setItem(ACTIVE_DRAFT_KEY, draftId);
  } catch {
    // Storage unavailable: the draft simply will not resume.
  }
}

export function clearActiveScenarioDraftId(): void {
  try {
    sessionStorage.removeItem(ACTIVE_DRAFT_KEY);
  } catch {
    // Nothing to do.
  }
}

/** A draft id worth resuming: one the pointer names and whose body is still readable. */
export function resumableScenarioDraftId(): string {
  const draftId = readActiveScenarioDraftId();
  return draftId && readScenarioDraft(draftId) ? draftId : '';
}

export function updateScenarioDraftModel(draftId: string, calibratedModel: string): boolean {
  const draft = readScenarioDraft(draftId);
  if (!draft || !calibratedModel) return false;
  writeScenarioDraft(draftId, { ...draft, calibratedModel });
  return true;
}

export function restoreScenarioDraft(
  stored: ScenarioDraftV1,
  options: ModelRunOptionsPayload,
  fallback: ScenarioDraftV1
): RestoredScenarioDraft {
  let choicesChanged = false;
  const snapshotVersions = new Set(options.snapshots.map((item) => item.version));
  const calibratedModel = snapshotVersions.has(stored.calibratedModel) ? stored.calibratedModel : fallback.calibratedModel;
  if (calibratedModel !== stored.calibratedModel) choicesChanged = true;

  const policyIds = new Set(options.basePolicies.map((item) => item.id));
  const basePolicy = policyIds.has(stored.basePolicy) ? stored.basePolicy : fallback.basePolicy;
  if (basePolicy !== stored.basePolicy) choicesChanged = true;

  const parameterKeys = new Set(options.parameters.map((item) => item.key));
  const formValues = { ...fallback.formValues };
  for (const [key, value] of Object.entries(stored.formValues)) {
    if (parameterKeys.has(key) && (typeof value === 'string' || typeof value === 'boolean')) formValues[key] = value;
    else choicesChanged = true;
  }
  const parsedMaxWorkers = Number(stored.maxWorkers);
  const maxWorkers = Number.isInteger(parsedMaxWorkers) && parsedMaxWorkers > 0 ? stored.maxWorkers : fallback.maxWorkers;
  if (maxWorkers !== stored.maxWorkers) choicesChanged = true;

  return {
    choicesChanged,
    draft: { ...stored, calibratedModel, basePolicy, formValues, maxWorkers }
  };
}
