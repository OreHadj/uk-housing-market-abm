import type { BasePolicyId, ModelRunOptionsPayload } from '../../shared/types';
import type { FormValue } from './experimentRunDefaults';

const STORAGE_PREFIX = 'scenario-draft:v1:';

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
  if (draftId) sessionStorage.removeItem(scenarioDraftStorageKey(draftId));
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
