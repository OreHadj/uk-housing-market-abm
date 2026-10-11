import { CENTRAL_BANK_POLICY_DISPLAY, formatPolicyValue } from './policyDisplay';

/**
 * Each model's lenders have their own limits (the BANK_* values in its config.properties), and
 * Bank.java applies the tighter of the lender's limit and the policy setting: the minimum for the
 * LTV, LTI and affordability caps, the maximum for the ICR floor. A policy setting past the lender's
 * limit therefore runs at that limit. These limits are calibrated per model and are not editable.
 */
interface LenderLimitSource {
  configKey: string;
  bound: 'max' | 'min';
  /** What the lenders do, completed by the formatted limit. */
  rule: (limit: string) => string;
  /** The setting a looser value would be, for "so a higher limit has no extra effect". */
  looserSetting: string;
}

const LENDER_LIMIT_SOURCES: Record<string, LenderLimitSource> = {
  CENTRAL_BANK_LTV_HARD_MAX_FTB: {
    configKey: 'BANK_LTV_HARD_MAX_FTB',
    bound: 'max',
    rule: (limit) => `never lend first-time buyers more than ${limit} of the property value`,
    looserSetting: 'a higher limit'
  },
  CENTRAL_BANK_LTV_HARD_MAX_HM: {
    configKey: 'BANK_LTV_HARD_MAX_HM',
    bound: 'max',
    rule: (limit) => `never lend home movers more than ${limit} of the property value`,
    looserSetting: 'a higher limit'
  },
  CENTRAL_BANK_LTV_HARD_MAX_BTL: {
    configKey: 'BANK_LTV_HARD_MAX_BTL',
    bound: 'max',
    rule: (limit) => `never lend buy-to-let landlords more than ${limit} of the property value`,
    looserSetting: 'a higher limit'
  },
  CENTRAL_BANK_LTI_SOFT_MAX_FTB: {
    configKey: 'BANK_LTI_HARD_MAX_FTB',
    bound: 'max',
    rule: (limit) => `never lend first-time buyers more than ${limit}`,
    looserSetting: 'a higher threshold'
  },
  CENTRAL_BANK_LTI_SOFT_MAX_HM: {
    configKey: 'BANK_LTI_HARD_MAX_HM',
    bound: 'max',
    rule: (limit) => `never lend home movers more than ${limit}`,
    looserSetting: 'a higher threshold'
  },
  CENTRAL_BANK_AFFORDABILITY_HARD_MAX: {
    configKey: 'BANK_AFFORDABILITY_HARD_MAX',
    bound: 'max',
    rule: (limit) => `never let mortgage payments take more than ${limit} of income`,
    looserSetting: 'a higher cap'
  },
  CENTRAL_BANK_ICR_HARD_MIN: {
    configKey: 'BANK_ICR_HARD_MIN',
    bound: 'min',
    rule: (limit) => `already require buy-to-let rent to cover at least ${limit} the mortgage interest`,
    looserSetting: 'a lower floor'
  }
};

/** A model's lender limits, keyed by the policy setting each one caps. */
export type LenderLimits = Partial<Record<string, number>>;

const LIMIT_EPSILON = 1e-9;

/** Reads the lender limits from a model or run config; a limit the config does not record is omitted. */
export function readLenderLimits(readConfigNumber: (configKey: string) => number | null | undefined): LenderLimits {
  const limits: LenderLimits = {};
  for (const [policyKey, source] of Object.entries(LENDER_LIMIT_SOURCES)) {
    const value = readConfigNumber(source.configKey);
    if (typeof value === 'number' && Number.isFinite(value)) {
      limits[policyKey] = value;
    }
  }
  return limits;
}

/**
 * The lender's limit when `value` is past it, so the setting runs at the limit instead; null when
 * the setting takes effect as entered, or the model records no limit for it.
 */
export function findLenderCap(key: string, value: number | null, limits: LenderLimits | null | undefined): number | null {
  const source = LENDER_LIMIT_SOURCES[key];
  const limit = limits?.[key];
  if (!source || value === null || !Number.isFinite(value) || typeof limit !== 'number') {
    return null;
  }
  const isPastLimit = source.bound === 'max' ? value > limit + LIMIT_EPSILON : value < limit - LIMIT_EPSILON;
  return isPastLimit ? limit : null;
}

/** Formats a limit in the setting's own unit; the ICR floor is a multiple of the interest. */
export function formatLenderLimit(key: string, limit: number): string {
  const display = CENTRAL_BANK_POLICY_DISPLAY[key];
  if (key === 'CENTRAL_BANK_ICR_HARD_MIN') {
    return `${limit.toLocaleString('en-GB')}×`;
  }
  return display ? formatPolicyValue(limit, display.unit) : String(limit);
}

/**
 * Run setup: why a changed setting will run at the lender's limit. `modelName` reads "the Refitted
 * 2024 model". `referenceValue` is passed when the reference policy's own value is past the limit too,
 * as when a 2011 model is paired with the 2024 policy, so the note explains why both run the same.
 */
export function describeLenderCap(key: string, limit: number, modelName: string, referenceValue?: number): string {
  const source = LENDER_LIMIT_SOURCES[key];
  const limitText = formatLenderLimit(key, limit);
  if (!source) {
    return `Runs as ${limitText}.`;
  }
  if (referenceValue !== undefined) {
    return `Runs as ${limitText}, like the ${formatLenderLimit(key, referenceValue)} reference: lenders in ${modelName} ${source.rule(limitText)}.`;
  }
  return `Runs as ${limitText}. Lenders in ${modelName} ${source.rule(limitText)}, so ${source.looserSetting} has no extra effect.`;
}

/** Results: why a recorded setting ran at the lender's limit. */
export function describeRanAs(key: string, limit: number): string {
  const source = LENDER_LIMIT_SOURCES[key];
  const limitText = formatLenderLimit(key, limit);
  return source
    ? `This run used ${limitText}: lenders in its model ${source.rule(limitText)}.`
    : `This run used ${limitText}.`;
}
