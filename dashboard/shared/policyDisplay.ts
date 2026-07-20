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
