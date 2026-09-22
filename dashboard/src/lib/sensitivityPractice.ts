import type { ModelRunParameterDefinition } from '../../shared/types';
import { normalizeSensitivityFormValues, type FormValue } from './experimentRunDefaults';

export const SENSITIVITY_PRACTICE_SETTINGS = {
  households: 1000,
  months: 600,
  seeds: 1,
  samples: 3,
  workers: 1
} as const;

/** Keep practice small, including drafts restored from the former preview-only guide. */
export function applySensitivityPracticeDefaults(
  parameters: ModelRunParameterDefinition[],
  values: Record<string, FormValue>
): Record<string, FormValue> {
  return normalizeSensitivityFormValues(parameters, {
    ...values,
    TARGET_POPULATION: String(SENSITIVITY_PRACTICE_SETTINGS.households),
    N_STEPS: String(SENSITIVITY_PRACTICE_SETTINGS.months),
    N_SIMS: String(SENSITIVITY_PRACTICE_SETTINGS.seeds)
  });
}

/** Validate visible settings before submission instead of silently changing the reviewed run. */
export function validateSensitivityPracticeSize(
  values: Record<string, FormValue>, sampleCount: string, maxWorkers: string
): string | null {
  const practice = SENSITIVITY_PRACTICE_SETTINGS;
  if (Number(sampleCount) !== practice.samples) return 'Use 3 samples for this short practice run.';
  if (Number(values.TARGET_POPULATION) !== practice.households || Number(values.N_STEPS) !== practice.months ||
    Number(values.N_SIMS) !== practice.seeds || Number(maxWorkers) !== practice.workers) {
    return 'Keep this practice small with 1,000 households, 600 months, 1 seed and 1 worker.';
  }
  return null;
}
