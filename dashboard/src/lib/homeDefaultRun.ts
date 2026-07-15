import type { BasePolicyId, ModelRunOptionsPayload, ModelRunSubmitRequest } from '../../shared/types';
import {
  buildGeneralModelControlOverridesFromForm,
  toInitialFormValues,
  type FormValue
} from './experimentRunDefaults';

/**
 * Zero-decision preset for the Home "Default Run" button.
 *
 * Rationale (one step = one month):
 * - 3500 steps matches the calibration paper's standard run length: it clears the model's
 *   warm-up/spin-up phase and produces a full house-price cycle, so core indicators read as
 *   signal rather than warm-up noise. It also stays under the >4000-step "heavy run" warning.
 * - 1 seed avoids the multi-seed "may take much longer" warning (a single seed does not
 *   parallelise, so max workers is left at the app's safe default).
 * - Records are the minimal set (core indicators only), so the run cannot trip the heavy-output
 *   or heavy-microdata warnings.
 * - Population and rolling window stay at the model's calibrated defaults (10,000 / 6); the
 *   Central Bank levers are driven entirely by the base policy, never set individually.
 *
 * Baseline (the stable "Optimised 2011" version) is NOT hardcoded here: it is taken from the
 * run-options payload's `defaultBaseline`, i.e. the same stable default the Manual tab selects.
 */
export const DEFAULT_RUN_CONFIG = {
  basePolicy: '2011' as BasePolicyId,
  nSteps: 3500,
  nSims: 1,
  maxWorkers: 1,
  titlePrefix: 'Default run'
} as const;

export function buildDefaultRunTitle(now: Date = new Date()): string {
  return `${DEFAULT_RUN_CONFIG.titlePrefix} — ${now.toISOString()}`;
}

/**
 * Builds the manual-run submit payload for the Default Run, reusing the exact helpers the
 * Manual Parameters tab uses so it goes through the same queue path with no duplicated logic.
 */
export function buildDefaultRunSubmitRequest(
  options: ModelRunOptionsPayload,
  now: Date = new Date(),
  title?: string
): ModelRunSubmitRequest {
  const baseline = options.defaultBaseline;
  const basePolicyOption =
    options.basePolicies.find((policy) => policy.id === DEFAULT_RUN_CONFIG.basePolicy) ?? null;

  // Start from the Manual tab's initial values: base-policy Central Bank values + minimal
  // record defaults (core indicators on, everything else off), then apply the two preset edits.
  const formValues: Record<string, FormValue> = {
    ...toInitialFormValues(options.parameters, basePolicyOption),
    N_STEPS: String(DEFAULT_RUN_CONFIG.nSteps),
    N_SIMS: String(DEFAULT_RUN_CONFIG.nSims)
  };

  // General-model-control overrides only (this helper skips the Central Bank group, so those
  // levers come purely from the base policy applied server-side).
  const overrides = buildGeneralModelControlOverridesFromForm(options.parameters, formValues);

  const trimmedTitle = title?.trim();

  return {
    baseline,
    basePolicy: DEFAULT_RUN_CONFIG.basePolicy,
    // Use the user-supplied name when given; otherwise fall back to a unique timestamped title.
    title: trimmedTitle ? trimmedTitle : buildDefaultRunTitle(now),
    overrides,
    maxWorkers: DEFAULT_RUN_CONFIG.maxWorkers,
    confirmWarnings: true
  };
}
