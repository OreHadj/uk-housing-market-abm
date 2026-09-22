// Author: Max Stoddard
import type {
  BasePolicyId,
  BasePolicyOption,
  ModelRunOptionsPayload,
  ModelRunParameterDefinition,
  SensitivityPolicyPackageDefinition
} from '../../shared/types';
import { DEFAULT_SENSITIVITY_POLICY_PACKAGE_ID } from '../../shared/policyCatalogue';

export type FormValue = string | boolean;
export const DEFAULT_EXPERIMENT_BASE_POLICY_ID: BasePolicyId = '2024';

/**
 * Seeds per scenario run and per sampled sweep point.
 *
 * Matches `CANONICAL_VALIDATION_SEEDS` (scripts/python/validation/model/schema.py), the seed block
 * every published validation result is scored on, so a scenario or sweep carries the same seed depth
 * as the evidence used to choose its model version. The model config ships `N_SIMS = 1`, which gives
 * a single stochastic draw with no dispersion to read an effect against.
 *
 * Seeds run as independent processes against the worker pool, and max workers derives from the seed
 * count, so eight seeds cost roughly one run of wall clock for a scenario.
 */
export const DEFAULT_EXPERIMENT_SEED_COUNT = 8;

/**
 * Simulation duration for the policy-run builder.
 *
 * The model config ships `N_STEPS = 2000`, which is not a value either source paper uses. The BoE
 * paper runs 3,500 steps for SMM calibration, and both the TuRBO calibration and the project
 * report's validation loss aggregate over a 500-3,500 window with the first 500 steps discarded as
 * warm-up. 3,500 is the duration consistent with both, and stays under the >4,000 heavy-run warning
 * raised by `createWarnings` (server/lib/modelRuns.ts). Home's Default Run preset already uses it.
 */
export const DEFAULT_POLICY_RUN_N_STEPS = 3500;

/**
 * First model month retained in transaction-level exports for policy runs.
 *
 * The standard analysis window discards months 0-499 as warm-up. Starting transaction exports at
 * month 500 preserves that whole window without paying the storage and runtime cost of warm-up
 * microdata. Model-version configs retain their historical value; the policy-run builder applies
 * this research-aligned default explicitly when it submits a manual experiment.
 */
export const DEFAULT_POLICY_RUN_TRANSACTION_RECORDING_START = 500;

/**
 * Cumulative weight assigned to events older than twelve months.
 *
 * The model config ships 0.25, which has no basis in either source paper. Table 16 of the BoE
 * paper's Online Appendix (C.1.1, user-set parameters) gives 0.14.
 */
export const DEFAULT_POLICY_RUN_CUMULATIVE_WEIGHT_BEYOND_YEAR = 0.14;

/**
 * Builder-level defaults for the policy-run wizard.
 *
 * Every other default reaches the form from the selected model version's config.properties via
 * `toInitialFormValues`. These corrections align manual policy runs with the project's standard
 * analysis conventions, so they are applied here rather than by rewriting the version configs.
 * Deliberately not applied to the sensitivity builder or to Home's Default Run preset: neither
 * retains transaction-level exports.
 */
export function applyPolicyRunBuilderDefaults(
  parameters: ModelRunParameterDefinition[],
  values: Record<string, FormValue>
): Record<string, FormValue> {
  const hasParameter = (key: string) => parameters.some((parameter) => parameter.key === key);
  const nextValues = { ...values };
  if (hasParameter('N_STEPS')) {
    nextValues.N_STEPS = String(DEFAULT_POLICY_RUN_N_STEPS);
  }
  if (hasParameter('TIME_TO_START_RECORDING_TRANSACTIONS')) {
    nextValues.TIME_TO_START_RECORDING_TRANSACTIONS = String(DEFAULT_POLICY_RUN_TRANSACTION_RECORDING_START);
  }
  if (hasParameter('CUMULATIVE_WEIGHT_BEYOND_YEAR')) {
    nextValues.CUMULATIVE_WEIGHT_BEYOND_YEAR = String(DEFAULT_POLICY_RUN_CUMULATIVE_WEIGHT_BEYOND_YEAR);
  }
  return nextValues;
}

/** Policy-scenario result pages require core indicators, including when a saved draft disabled them. */
export function normalizeManualScenarioFormValues(values: Record<string, FormValue>): Record<string, FormValue> {
  return { ...values, recordCoreIndicators: true };
}

/**
 * Sensitivity results are reduced to the fixed dashboard indicators and each sampled run's raw
 * output is discarded. Keep the form state aligned with that retained-output contract even if a
 * stale client state previously enabled one of the raw export flags.
 */
export function normalizeSensitivityFormValues(
  parameters: ModelRunParameterDefinition[],
  values: Record<string, FormValue>
): Record<string, FormValue> {
  const nextValues = { ...values };
  for (const parameter of parameters) {
    if (
      parameter.group === 'General model control' &&
      parameter.type === 'boolean' &&
      parameter.key.startsWith('record')
    ) {
      nextValues[parameter.key] = parameter.key === 'recordCoreIndicators';
    }
  }
  return nextValues;
}

function applyMinimalRecordDefaults(
  parameters: ModelRunParameterDefinition[],
  values: Record<string, FormValue>
): Record<string, FormValue> {
  const nextValues = { ...values };
  for (const parameter of parameters) {
    if (parameter.type === 'boolean' && parameter.key.startsWith('record')) {
      nextValues[parameter.key] = parameter.key === 'recordCoreIndicators';
    }
  }
  return nextValues;
}

export function toInitialFormValues(
  parameters: ModelRunParameterDefinition[],
  basePolicy: BasePolicyOption | null
): Record<string, FormValue> {
  const values: Record<string, FormValue> = {};
  for (const parameter of parameters) {
    const basePolicyValue = basePolicy?.values[parameter.key];
    if (typeof basePolicyValue === 'number') {
      values[parameter.key] = String(basePolicyValue);
    } else if (parameter.type === 'boolean') {
      values[parameter.key] = Boolean(parameter.defaultValue);
    } else {
      values[parameter.key] = String(parameter.defaultValue);
    }
  }
  // Overrides the model config's single-seed default for both builder modes; Home's Default Run
  // preset sets its own N_SIMS after calling this, so it is unaffected.
  if (parameters.some((parameter) => parameter.key === 'N_SIMS')) {
    values.N_SIMS = String(DEFAULT_EXPERIMENT_SEED_COUNT);
  }
  return applyMinimalRecordDefaults(parameters, values);
}

export function parseFormValue(parameter: ModelRunParameterDefinition, value: FormValue): number | boolean {
  if (parameter.type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new Error(`Parameter ${parameter.key} must be boolean.`);
    }
    return value;
  }

  if (typeof value !== 'string') {
    throw new Error(`Parameter ${parameter.key} must be numeric.`);
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Parameter ${parameter.key} must be numeric.`);
  }

  if (parameter.type === 'integer' && !Number.isInteger(parsed)) {
    throw new Error(`Parameter ${parameter.key} must be an integer.`);
  }

  return parsed;
}

export function isSameValue(left: number | boolean, right: number | boolean): boolean {
  if (typeof left === 'boolean' || typeof right === 'boolean') {
    return left === right;
  }
  return Math.abs(left - right) < 1e-12;
}

export function getPackageBaselineValues(
  policyPackage: SensitivityPolicyPackageDefinition,
  basePolicy: BasePolicyOption | null
): number[] {
  if (!basePolicy) {
    return [];
  }
  return policyPackage.parameterKeys
    .map((key) => basePolicy.values[key])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function getRepresentativePackageBaseline(
  policyPackage: SensitivityPolicyPackageDefinition,
  basePolicy: BasePolicyOption | null
): number {
  const values = getPackageBaselineValues(policyPackage, basePolicy);
  if (values.length === 0) {
    return Number.NaN;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildDefaultSensitivityRange(
  policyPackage: SensitivityPolicyPackageDefinition,
  basePolicy: BasePolicyOption | null
): { min: string; max: string } {
  if (policyPackage.id === DEFAULT_SENSITIVITY_POLICY_PACKAGE_ID && basePolicy?.id === DEFAULT_EXPERIMENT_BASE_POLICY_ID) {
    return { min: '4', max: '5' };
  }

  const baseline = getRepresentativePackageBaseline(policyPackage, basePolicy);
  if (!Number.isFinite(baseline)) {
    return { min: '', max: '' };
  }

  if (policyPackage.type === 'integer') {
    if (baseline === 0) {
      return { min: '-1', max: '1' };
    }
    const delta = Math.max(1, Math.round(Math.abs(baseline) * 0.1));
    return {
      min: String(Math.round(baseline - delta)),
      max: String(Math.round(baseline + delta))
    };
  }

  if (Math.abs(baseline) < 1e-12) {
    return { min: '-0.1', max: '0.1' };
  }

  return {
    min: String(Number((baseline * 0.9).toFixed(6))),
    max: String(Number((baseline * 1.1).toFixed(6)))
  };
}

export function getDefaultExperimentBasePolicy(payload: ModelRunOptionsPayload): BasePolicyId {
  return payload.basePolicies.some((item) => item.id === DEFAULT_EXPERIMENT_BASE_POLICY_ID)
    ? DEFAULT_EXPERIMENT_BASE_POLICY_ID
    : payload.defaultBasePolicy;
}

export function buildGeneralModelControlOverridesFromForm(
  parameters: ModelRunParameterDefinition[],
  formValues: Record<string, FormValue>
): Record<string, number | boolean> {
  const overrides: Record<string, number | boolean> = {};

  for (const parameter of parameters) {
    if (parameter.group !== 'General model control' || parameter.key === 'SEED') {
      continue;
    }

    const rawValue = formValues[parameter.key];
    const parsedValue = parseFormValue(parameter, rawValue);
    if (parameter.key === 'N_SIMS' || !isSameValue(parsedValue, parameter.defaultValue)) {
      overrides[parameter.key] = parsedValue;
    }
  }

  return overrides;
}

/**
 * Build sensitivity overrides without generating files that the sensitivity pipeline immediately
 * discards. Core indicators are mandatory because they are the source of every retained result.
 */
export function buildSensitivityGeneralModelControlOverridesFromForm(
  parameters: ModelRunParameterDefinition[],
  formValues: Record<string, FormValue>
): Record<string, number | boolean> {
  const overrides: Record<string, number | boolean> = {};

  for (const parameter of parameters) {
    if (parameter.group !== 'General model control' || parameter.key === 'SEED') {
      continue;
    }

    if (parameter.key === 'TIME_TO_START_RECORDING_TRANSACTIONS') {
      continue;
    }

    if (parameter.type === 'boolean' && parameter.key.startsWith('record')) {
      overrides[parameter.key] = parameter.key === 'recordCoreIndicators';
      continue;
    }

    const parsedValue = parseFormValue(parameter, formValues[parameter.key]);
    if (parameter.key === 'N_SIMS' || !isSameValue(parsedValue, parameter.defaultValue)) {
      overrides[parameter.key] = parsedValue;
    }
  }

  return overrides;
}
