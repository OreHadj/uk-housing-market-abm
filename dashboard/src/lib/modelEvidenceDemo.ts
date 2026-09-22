export const MODEL_EVIDENCE_DEMO_QUERY_VALUE = 'model-evidence';
export const MODEL_EVIDENCE_DEMO_SESSION_KEY = 'model-evidence-demo-progress-v1';
export const MODEL_EVIDENCE_CALIBRATION_SESSION_KEY = 'model-evidence-calibration-progress-v1';
export const MODEL_EVIDENCE_VALIDATION_SESSION_KEY = 'model-evidence-validation-progress-v1';
export const MODEL_EVIDENCE_CALIBRATION_COMPLETION_EVENT = 'model-evidence-calibration:complete';
export const MODEL_EVIDENCE_DEMO_COMPLETION_EVENT = 'model-evidence-demo:complete';
export const MODEL_EVIDENCE_DEMO_LAUNCH_HREF =
  '/model-evidence?view=calibration&demo=model-evidence&mode=single';

export type ModelEvidenceDemoPhase = 'calibration' | 'calibration-review' | 'validation' | 'complete';

export interface ModelEvidenceDemoProgress {
  version: 1;
  journeyId: string;
  phase: ModelEvidenceDemoPhase;
  calibrationPrimaryVersion: string;
  calibrationComparisonVersion: string;
  calibrationComplete: boolean;
  validationStarted: boolean;
}

export interface ModelEvidenceDemoCompletionDetail {
  demo: typeof MODEL_EVIDENCE_DEMO_QUERY_VALUE;
  journeyId: string;
  phase: 'calibration' | 'validation';
  primaryVersion?: string;
  comparisonVersion?: string;
}

const MODEL_EVIDENCE_DEMO_PHASES = new Set<ModelEvidenceDemoPhase>([
  'calibration',
  'calibration-review',
  'validation',
  'complete'
]);

function createJourneyId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `model-evidence-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createModelEvidenceDemoProgress(
  journeyId = createJourneyId()
): ModelEvidenceDemoProgress {
  return {
    version: 1,
    journeyId,
    phase: 'calibration',
    calibrationPrimaryVersion: '',
    calibrationComparisonVersion: '',
    calibrationComplete: false,
    validationStarted: false
  };
}

export function isModelEvidenceDemoRequested(searchParams: URLSearchParams): boolean {
  return searchParams.get('demo') === MODEL_EVIDENCE_DEMO_QUERY_VALUE;
}

export function parseModelEvidenceDemoProgress(raw: string | null): ModelEvidenceDemoProgress | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ModelEvidenceDemoProgress>;
    if (
      value.version !== 1 ||
      typeof value.journeyId !== 'string' ||
      !value.journeyId ||
      typeof value.phase !== 'string' ||
      !MODEL_EVIDENCE_DEMO_PHASES.has(value.phase as ModelEvidenceDemoPhase)
    ) {
      return null;
    }

    const phase = value.phase as ModelEvidenceDemoPhase;
    const calibrationPrimaryVersion = typeof value.calibrationPrimaryVersion === 'string'
      ? value.calibrationPrimaryVersion
      : '';
    const calibrationComparisonVersion = typeof value.calibrationComparisonVersion === 'string'
      ? value.calibrationComparisonVersion
      : '';
    const calibrationComplete = value.calibrationComplete === true;
    const validationStarted = value.validationStarted === true;
    const completedCalibrationIsValid = Boolean(
      calibrationComplete &&
      calibrationPrimaryVersion &&
      calibrationComparisonVersion &&
      calibrationPrimaryVersion !== calibrationComparisonVersion
    );

    if (
      (phase === 'calibration-review' || phase === 'validation' || phase === 'complete') &&
      !completedCalibrationIsValid
    ) {
      return null;
    }
    if ((phase === 'validation' || phase === 'complete') && !validationStarted) return null;

    return {
      version: 1,
      journeyId: value.journeyId,
      phase,
      calibrationPrimaryVersion,
      calibrationComparisonVersion,
      calibrationComplete,
      validationStarted
    };
  } catch {
    return null;
  }
}

export function readModelEvidenceDemoProgress(): ModelEvidenceDemoProgress | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseModelEvidenceDemoProgress(
      window.sessionStorage.getItem(MODEL_EVIDENCE_DEMO_SESSION_KEY)
    );
  } catch {
    return null;
  }
}

export function writeModelEvidenceDemoProgress(progress: ModelEvidenceDemoProgress): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(MODEL_EVIDENCE_DEMO_SESSION_KEY, JSON.stringify(progress));
  } catch {
    // A blocked or full session store must not make the current walkthrough unusable.
  }
}

export function clearCombinedModelEvidenceDemoProgress(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(MODEL_EVIDENCE_DEMO_SESSION_KEY);
    window.sessionStorage.removeItem(MODEL_EVIDENCE_CALIBRATION_SESSION_KEY);
    window.sessionStorage.removeItem(MODEL_EVIDENCE_VALIDATION_SESSION_KEY);
  } catch {
    // Completion and abandonment still work when storage is unavailable.
  }
}

export function clearModelEvidenceDemoChildProgress(
  storageKey: typeof MODEL_EVIDENCE_CALIBRATION_SESSION_KEY | typeof MODEL_EVIDENCE_VALIDATION_SESSION_KEY
): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Starting the next phase must not depend on persistence being available.
  }
}

export function buildModelEvidenceCalibrationUrl(
  primaryVersion = '',
  comparisonVersion = ''
): string {
  const query = new URLSearchParams();
  query.set('view', 'calibration');
  query.set('demo', MODEL_EVIDENCE_DEMO_QUERY_VALUE);

  const primary = primaryVersion.trim();
  const comparison = comparisonVersion.trim();
  if (primary && comparison && primary !== comparison) {
    query.set('mode', 'compare');
    query.set('right', primary);
    query.set('left', comparison);
  } else {
    query.set('mode', 'single');
    if (primary) query.set('version', primary);
  }

  return `/model-evidence?${query.toString()}`;
}

export function buildModelEvidenceValidationUrl(primaryVersion: string): string {
  const query = new URLSearchParams();
  query.set('view', 'validation');
  query.set('demo', MODEL_EVIDENCE_DEMO_QUERY_VALUE);
  const primary = primaryVersion.trim();
  if (primary) query.set('version', primary);
  return `/model-evidence?${query.toString()}`;
}

export function isMatchingModelEvidenceCompletion(
  progress: ModelEvidenceDemoProgress | null,
  detail: unknown,
  expectedPhase: 'calibration' | 'validation'
): detail is ModelEvidenceDemoCompletionDetail {
  if (!progress || !detail || typeof detail !== 'object') return false;
  const candidate = detail as Partial<ModelEvidenceDemoCompletionDetail>;
  if (
    candidate.demo !== MODEL_EVIDENCE_DEMO_QUERY_VALUE ||
    candidate.journeyId !== progress.journeyId ||
    candidate.phase !== expectedPhase
  ) {
    return false;
  }
  if (expectedPhase === 'calibration') {
    return progress.phase === 'calibration' && !progress.calibrationComplete;
  }
  return progress.phase === 'validation' && progress.validationStarted;
}

export function completeModelEvidenceCalibration(
  progress: ModelEvidenceDemoProgress,
  detail: unknown
): ModelEvidenceDemoProgress {
  if (!isMatchingModelEvidenceCompletion(progress, detail, 'calibration')) return progress;
  const primaryVersion = detail.primaryVersion?.trim() ?? '';
  const comparisonVersion = detail.comparisonVersion?.trim() ?? '';
  if (!primaryVersion || !comparisonVersion || primaryVersion === comparisonVersion) return progress;
  return {
    ...progress,
    phase: 'calibration-review',
    calibrationPrimaryVersion: primaryVersion,
    calibrationComparisonVersion: comparisonVersion,
    calibrationComplete: true
  };
}

export function completeModelEvidenceValidation(
  progress: ModelEvidenceDemoProgress,
  detail: unknown
): ModelEvidenceDemoProgress {
  if (!isMatchingModelEvidenceCompletion(progress, detail, 'validation')) return progress;
  return { ...progress, phase: 'complete' };
}
