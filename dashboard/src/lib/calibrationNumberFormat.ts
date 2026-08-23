const DISPLAY_SIGNIFICANT_DIGITS = 6;
const MAX_DECIMAL_PLACES = 12;

function normalizeDisplayValue(value: number): number {
  return Number(value.toPrecision(DISPLAY_SIGNIFICANT_DIGITS));
}

/**
 * Calibration values arrive as numbers, so any trailing zeroes from their source files have already
 * been lost. Recover the shortest useful decimal precision while keeping the page's existing six
 * significant-digit limit and ignoring binary floating-point noise.
 */
function decimalPlacesForValue(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;

  const rounded = normalizeDisplayValue(value);
  const [coefficient, exponentText] = Math.abs(rounded).toString().toLowerCase().split('e');
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const decimalIndex = coefficient.indexOf('.');
  const coefficientPlaces = decimalIndex === -1 ? 0 : coefficient.length - decimalIndex - 1;

  return Math.min(MAX_DECIMAL_PLACES, Math.max(0, coefficientPlaces - exponent));
}

/** Use the most precise source number for every value that the user is comparing. */
export function calibrationDecimalPlaces(values: readonly number[]): number {
  return values.reduce(
    (maximum, value) => Math.max(maximum, decimalPlacesForValue(value)),
    0
  );
}

export function formatCalibrationNumber(value: number, decimalPlaces?: number): string {
  if (!Number.isFinite(value)) return 'Not recorded';

  const places = decimalPlaces ?? decimalPlacesForValue(value);
  const zeroThreshold = places === 0 ? 0.5 : 0.5 * 10 ** -places;
  const rounded = normalizeDisplayValue(value);
  const displayValue = Math.abs(rounded) < zeroThreshold ? 0 : rounded;

  return new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: places,
    maximumFractionDigits: places
  }).format(displayValue);
}

/**
 * Create one formatter for a range or comparison. Derived values, such as a difference, should be
 * passed to the returned formatter but omitted from `sourceValues`, so subtraction artefacts cannot
 * inflate the displayed precision.
 */
export function createCalibrationComparisonFormatter(sourceValues: readonly number[]): (value: number) => string {
  const decimalPlaces = calibrationDecimalPlaces(sourceValues);
  return (value: number) => formatCalibrationNumber(value, decimalPlaces);
}
