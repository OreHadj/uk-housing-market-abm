import type { BasePolicyId, ModelRunOptionsPayload } from '../../shared/types';
import type { FormValue } from './experimentRunDefaults';

const STORAGE_PREFIX = 'sensitivity-draft:v1:';
const ACTIVE_DRAFT_KEY = 'sensitivity-draft:v1:active';

export interface SensitivityDraftV1 {
  version: 1;
  title: string;
  calibratedModel: string;
  basePolicy: BasePolicyId;
  policyPackageId: string;
  min: string;
  max: string;
  sampleCount: string;
  formValues: Record<string, FormValue>;
  maxWorkers: string;
}

export interface RestoredSensitivityDraft {
  draft: SensitivityDraftV1;
  choicesChanged: boolean;
}

export function createSensitivityDraftId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function storageKey(draftId: string): string {
  return `${STORAGE_PREFIX}${draftId}`;
}

export function readSensitivityDraft(draftId: string): SensitivityDraftV1 | null {
  if (!draftId) return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey(draftId)) ?? 'null') as Partial<SensitivityDraftV1> | null;
    if (!parsed || parsed.version !== 1 || typeof parsed.title !== 'string' || typeof parsed.calibratedModel !== 'string') {
      return null;
    }
    return {
      version: 1,
      title: parsed.title,
      calibratedModel: parsed.calibratedModel,
      basePolicy: typeof parsed.basePolicy === 'string' ? parsed.basePolicy : '2024',
      policyPackageId: typeof parsed.policyPackageId === 'string' ? parsed.policyPackageId : '',
      min: typeof parsed.min === 'string' ? parsed.min : '',
      max: typeof parsed.max === 'string' ? parsed.max : '',
      sampleCount: typeof parsed.sampleCount === 'string' ? parsed.sampleCount : '5',
      formValues: parsed.formValues && typeof parsed.formValues === 'object' ? parsed.formValues : {},
      maxWorkers: typeof parsed.maxWorkers === 'string' ? parsed.maxWorkers : '1'
    };
  } catch {
    return null;
  }
}

export function writeSensitivityDraft(draftId: string, draft: SensitivityDraftV1): void {
  if (!draftId) return;
  try {
    sessionStorage.setItem(storageKey(draftId), JSON.stringify(draft));
  } catch {
    // Storage unavailable: the setup still works, but cannot survive leaving the page.
  }
}

export function clearSensitivityDraft(draftId: string): void {
  if (!draftId) return;
  try {
    sessionStorage.removeItem(storageKey(draftId));
    if (readActiveSensitivityDraftId() === draftId) sessionStorage.removeItem(ACTIVE_DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function readActiveSensitivityDraftId(): string {
  try {
    return sessionStorage.getItem(ACTIVE_DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setActiveSensitivityDraftId(draftId: string): void {
  try {
    if (draftId) sessionStorage.setItem(ACTIVE_DRAFT_KEY, draftId);
  } catch {
    // Storage unavailable: the draft simply will not resume.
  }
}

export function resumableSensitivityDraftId(): string {
  const draftId = readActiveSensitivityDraftId();
  return draftId && readSensitivityDraft(draftId) ? draftId : '';
}

export function updateSensitivityDraftModel(draftId: string, calibratedModel: string): boolean {
  const draft = readSensitivityDraft(draftId);
  if (!draft || !calibratedModel) return false;
  writeSensitivityDraft(draftId, { ...draft, calibratedModel });
  return true;
}

export function restoreSensitivityDraft(
  stored: SensitivityDraftV1,
  options: ModelRunOptionsPayload,
  fallback: SensitivityDraftV1
): RestoredSensitivityDraft {
  let choicesChanged = false;
  const snapshotVersions = new Set(options.snapshots.map((item) => item.version));
  const calibratedModel = snapshotVersions.has(stored.calibratedModel) ? stored.calibratedModel : fallback.calibratedModel;
  if (calibratedModel !== stored.calibratedModel) choicesChanged = true;

  const policyIds = new Set(options.basePolicies.map((item) => item.id));
  const basePolicy = policyIds.has(stored.basePolicy) ? stored.basePolicy : fallback.basePolicy;
  if (basePolicy !== stored.basePolicy) choicesChanged = true;

  const packageIds = new Set(options.sensitivityPolicyPackages.map((item) => item.id));
  const policyPackageId = packageIds.has(stored.policyPackageId) ? stored.policyPackageId : fallback.policyPackageId;
  if (policyPackageId !== stored.policyPackageId) choicesChanged = true;

  const parameterKeys = new Set(options.parameters.map((item) => item.key));
  const formValues = { ...fallback.formValues };
  for (const [key, value] of Object.entries(stored.formValues)) {
    if (parameterKeys.has(key) && (typeof value === 'string' || typeof value === 'boolean')) formValues[key] = value;
    else choicesChanged = true;
  }

  const positiveInteger = (value: string, fallbackValue: string, minimum: number): string => {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= minimum) return value;
    choicesChanged = true;
    return fallbackValue;
  };
  const finiteNumber = (value: string, fallbackValue: string): string => {
    if (value.trim() !== '' && Number.isFinite(Number(value))) return value;
    choicesChanged = true;
    return fallbackValue;
  };

  return {
    choicesChanged,
    draft: {
      ...stored,
      calibratedModel,
      basePolicy,
      policyPackageId,
      min: finiteNumber(stored.min, fallback.min),
      max: finiteNumber(stored.max, fallback.max),
      sampleCount: positiveInteger(stored.sampleCount, fallback.sampleCount, 2),
      formValues,
      maxWorkers: positiveInteger(stored.maxWorkers, fallback.maxWorkers, 1)
    }
  };
}
