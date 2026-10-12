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
  /** What the settings are called, for "only limits below 75% can make a difference". */
  settingNoun: string;
}

const LENDER_LIMIT_SOURCES: Record<string, LenderLimitSource> = {
  CENTRAL_BANK_LTV_HARD_MAX_FTB: {
    configKey: 'BANK_LTV_HARD_MAX_FTB',
    bound: 'max',
    rule: (limit) => `never lend first-time buyers more than ${limit} of the property value`,
    settingNoun: 'limits'
  },
  CENTRAL_BANK_LTV_HARD_MAX_HM: {
    configKey: 'BANK_LTV_HARD_MAX_HM',
    bound: 'max',
    rule: (limit) => `never lend home movers more than ${limit} of the property value`,
    settingNoun: 'limits'
  },
  CENTRAL_BANK_LTV_HARD_MAX_BTL: {
    configKey: 'BANK_LTV_HARD_MAX_BTL',
    bound: 'max',
    rule: (limit) => `never lend buy-to-let landlords more than ${limit} of the property value`,
    settingNoun: 'limits'
  },
  CENTRAL_BANK_LTI_SOFT_MAX_FTB: {
    configKey: 'BANK_LTI_HARD_MAX_FTB',
    bound: 'max',
    rule: (limit) => `never lend first-time buyers more than ${limit}`,
    settingNoun: 'thresholds'
  },
  CENTRAL_BANK_LTI_SOFT_MAX_HM: {
    configKey: 'BANK_LTI_HARD_MAX_HM',
    bound: 'max',
    rule: (limit) => `never lend home movers more than ${limit}`,
    settingNoun: 'thresholds'
  },
  CENTRAL_BANK_AFFORDABILITY_HARD_MAX: {
    configKey: 'BANK_AFFORDABILITY_HARD_MAX',
    bound: 'max',
    rule: (limit) => `never let mortgage payments take more than ${limit} of income`,
    settingNoun: 'caps'
  },
  CENTRAL_BANK_ICR_HARD_MIN: {
    configKey: 'BANK_ICR_HARD_MIN',
    bound: 'min',
    rule: (limit) => `already require buy-to-let rent to cover at least ${limit} the mortgage interest`,
    settingNoun: 'floors'
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

/** Another model a capped value is checked against. `group` names a set of models, e.g. "a 2024 model". */
export interface OtherModelLenderLimits {
  name: string;
  limits: LenderLimits | undefined;
  group?: string;
}

function joinWithOr(names: readonly string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/**
 * The other models whose lenders let `value` take effect as entered, with how far they go, e.g.
 * "a 2024 model, whose lenders allow up to 95%". A whole group is named by the group. Empty when
 * every model caps the value.
 */
function describeModelsAllowing(key: string, value: number, models: readonly OtherModelLenderLimits[]): string {
  const source = LENDER_LIMIT_SOURCES[key];
  const allowing = models.filter(({ limits }) => typeof limits?.[key] === 'number' && findLenderCap(key, value, limits) === null);
  if (!source || !allowing.length) return '';
  const group = allowing[0].group;
  const isWholeGroup = group !== undefined && allowing.every((model) => model.group === group) &&
    models.filter((model) => model.group === group).length === allowing.length;
  const names = isWholeGroup ? group : joinWithOr(allowing.map(({ name }) => name));
  const limits = new Set(allowing.map(({ limits: modelLimits }) => modelLimits?.[key]));
  const shared = limits.size === 1 ? [...limits][0] : undefined;
  const reach = shared === undefined
    ? 'allow it'
    : source.bound === 'max' ? `allow up to ${formatLenderLimit(key, shared)}` : `require only ${formatLenderLimit(key, shared)}`;
  return `${names}, whose lenders ${reach}`;
}

/**
 * Run setup: why a setting will run at the lender's limit, and what to do instead. `modelName` reads
 * "the Refitted 2024 model". An unchanged reference value gets one sentence. A changed `value` also
 * says which values make a difference and which other models would apply it. When its reference
 * value is past the limit too (`referenceValue`, as when a 2011 model is paired with the 2024
 * policy), the change has no effect, and the note leads with that.
 */
export function describeLenderCap(key: string, limit: number, modelName: string, {
  changed = false,
  referenceValue,
  value,
  otherModels = []
}: {
  changed?: boolean;
  referenceValue?: number;
  value?: number;
  otherModels?: readonly OtherModelLenderLimits[];
} = {}): string {
  const source = LENDER_LIMIT_SOURCES[key];
  const limitText = formatLenderLimit(key, limit);
  if (!source) {
    return `Runs as ${limitText}.`;
  }
  const rule = source.rule(limitText);
  if (!changed || value === undefined) {
    return `Runs as ${limitText}: lenders in ${modelName} ${rule}.`;
  }
  const direction = source.bound === 'max' ? 'below' : 'above';
  const elsewhere = describeModelsAllowing(key, value, otherModels);
  if (referenceValue !== undefined) {
    return `No effect in this model. Its lenders ${rule}, so both ${formatLenderLimit(key, value)} and the ` +
      `${formatLenderLimit(key, referenceValue)} reference run as ${limitText}. ` +
      `Use a value ${direction} ${limitText}${elsewhere ? `, or ${elsewhere}` : ''}.`;
  }
  return `Runs as ${limitText}. Lenders in ${modelName} ${rule}, so only ${source.settingNoun} ${direction} ` +
    `${limitText} make a difference here.${elsewhere ? ` To test ${formatLenderLimit(key, value)}, use ${elsewhere}.` : ''}`;
}

/** Results: why a recorded setting ran at the lender's limit. */
export function describeRanAs(key: string, limit: number): string {
  const source = LENDER_LIMIT_SOURCES[key];
  const limitText = formatLenderLimit(key, limit);
  return source
    ? `This run used ${limitText}: lenders in its model ${source.rule(limitText)}.`
    : `This run used ${limitText}.`;
}
