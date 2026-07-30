// Shared display helpers for Central Bank policy fields, used by both the run-setup form
// (CentralBankPolicyInput.tsx) and the base-policy catalogue summaries (policyCatalogue.ts) so the
// displayed percentage can never drift from the stored model-unit fraction.

// The form shows caps and rates rounded to two decimal places in their own unit (percent, ratio, …).
const DISPLAY_DECIMALS = 2;
const DISPLAY_ROUNDING = 10 ** DISPLAY_DECIMALS;

/** Rounds a stored model-unit fraction to the value shown in a scaled unit (e.g. base rate → %). */
export function roundScaled(fraction: number, scale: number): number {
  return Math.round(fraction * scale * DISPLAY_ROUNDING) / DISPLAY_ROUNDING;
}

/** Formats a stored fraction for display in its scaled unit, e.g. 0.0510833333 → "5.11" at scale 100. */
export function formatScaled(fraction: number, scale: number): string {
  if (!Number.isFinite(fraction)) {
    return '';
  }
  return String(roundScaled(fraction, scale));
}

/**
 * Formats a stored fraction in its scaled unit at full precision, stripping binary-float noise, e.g.
 * 0.0510833333 → "5.10833333" at scale 100. Unlike formatScaled it does not round to two decimals, so
 * a read-only display shows the exact value the model runs rather than a rounded stand-in for it.
 */
export function formatExactScaled(fraction: number, scale: number): string {
  if (!Number.isFinite(fraction)) {
    return '';
  }
  return String(Number((fraction * scale).toPrecision(15)));
}

/** Formats a stored fraction as a percentage string, e.g. 0.0510833333 → "5.11%". */
export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) {
    return '';
  }
  return `${formatScaled(fraction, 100)}%`;
}

/** Formats a stored fraction as a full-precision percentage string, e.g. 0.0510833333 → "5.10833333%". */
export function formatExactPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) {
    return '';
  }
  return `${formatExactScaled(fraction, 100)}%`;
}

/**
 * Collapses binary-float noise from a computed fraction to its shortest exact decimal, so a value
 * the user genuinely typed (e.g. 5.29% → 0.052900000000000003) is stored as "0.0529". Typed values
 * carry far fewer significant figures than a double, so trimming to 15 sig figs is always safe.
 */
function serializeFraction(fraction: number): string {
  return String(Number(fraction.toPrecision(15)));
}

/**
 * Converts a value typed into a scaled field (e.g. "5.11" at scale 100) to the stored model-unit
 * fraction string, free of binary-float noise ("5.11" -> "0.0511", never "0.051100000000000007").
 * This is a plain reading of what the user typed: what they see is what gets submitted. Non-numeric /
 * mid-edit text passes through unchanged so submit-time validation can catch it.
 */
export function scaledInputToStoredFraction(rawInput: string, scale: number): string {
  const parsed = Number.parseFloat(rawInput);
  if (!Number.isFinite(parsed)) {
    return rawInput;
  }
  return serializeFraction(parsed / scale);
}

/** Formats a stored fraction for the "exact model value" tooltip, stripping any binary-float noise. */
export function formatExactModelValue(value: string): string {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return String(Number(parsed.toPrecision(15)));
}

export type PolicyUnit = 'percentage' | 'multiple' | 'months' | 'ratio';

/**
 * Human-readable name and unit for each Central Bank policy key, in Bank of England terms. Single
 * source for anywhere a policy setting is named: the scenario builder's inputs and the policy
 * settings recorded against a completed run. Keeping one map means a run's recorded policy is
 * always described with the same words as the form that produced it.
 */
export const CENTRAL_BANK_POLICY_DISPLAY: Record<string, { label: string; unit: PolicyUnit }> = {
  CENTRAL_BANK_INITIAL_BASE_RATE: { label: 'Bank Rate (initial)', unit: 'percentage' },
  CENTRAL_BANK_LTV_HARD_MAX_FTB: { label: 'LTV limit — first-time buyers', unit: 'percentage' },
  CENTRAL_BANK_LTV_HARD_MAX_HM: { label: 'LTV limit — home movers', unit: 'percentage' },
  CENTRAL_BANK_LTV_HARD_MAX_BTL: { label: 'LTV limit — buy-to-let', unit: 'percentage' },
  CENTRAL_BANK_LTI_SOFT_MAX_FTB: { label: 'LTI threshold — first-time buyers', unit: 'multiple' },
  CENTRAL_BANK_LTI_SOFT_MAX_HM: { label: 'LTI threshold — home movers', unit: 'multiple' },
  CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_FTB: {
    label: 'Flow limit above threshold — first-time buyers',
    unit: 'percentage'
  },
  CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_HM: {
    label: 'Flow limit above threshold — home movers',
    unit: 'percentage'
  },
  CENTRAL_BANK_LTI_MONTHS_TO_CHECK: { label: 'Flow assessment period', unit: 'months' },
  CENTRAL_BANK_AFFORDABILITY_HARD_MAX: { label: 'Affordability cap', unit: 'percentage' },
  CENTRAL_BANK_ICR_HARD_MIN: { label: 'Interest coverage ratio floor', unit: 'ratio' }
};

/** Formats a stored policy value in its display unit, e.g. 0.95 -> "95%", 4.5 -> "4.5x income". */
export function formatPolicyValue(value: number, unit: PolicyUnit): string {
  if (!Number.isFinite(value)) {
    return 'Not set';
  }
  switch (unit) {
    case 'percentage':
      return `${Number((value * 100).toPrecision(15)).toLocaleString('en-GB')}%`;
    case 'multiple':
      return `${value.toLocaleString('en-GB')}× income`;
    case 'months':
      return `${value.toLocaleString('en-GB')} months`;
    case 'ratio':
      return value.toLocaleString('en-GB');
  }
}
