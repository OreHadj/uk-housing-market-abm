function formatScaledAxisNumber(value: number, divisor: number, suffix: string): string {
  return `${(value / divisor).toLocaleString('en-GB', { maximumFractionDigits: 1 })}${suffix}`;
}

/**
 * Keeps large tick labels short enough for Results-page charts without changing the underlying
 * values. Tooltips continue to show the fuller, metric-specific formatting.
 */
export function formatResultsAxisTick(value: number | string): string {
  const numericValue = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(numericValue)) {
    return String(value);
  }

  const absoluteValue = Math.abs(numericValue);
  if (absoluteValue >= 1_000_000_000_000) return formatScaledAxisNumber(numericValue, 1_000_000_000_000, 'T');
  if (absoluteValue >= 1_000_000_000) return formatScaledAxisNumber(numericValue, 1_000_000_000, 'B');
  if (absoluteValue >= 1_000_000) return formatScaledAxisNumber(numericValue, 1_000_000, 'M');
  if (absoluteValue >= 10_000) return formatScaledAxisNumber(numericValue, 1_000, 'K');
  if (absoluteValue > 0 && absoluteValue < 0.001) {
    return numericValue.toExponential(1);
  }

  const maximumFractionDigits = absoluteValue >= 100 ? 0 : absoluteValue >= 10 ? 1 : absoluteValue >= 1 ? 2 : 4;
  return numericValue.toLocaleString('en-GB', { maximumFractionDigits });
}

/** Approximate the horizontal room ECharts needs between a vertical axis name and its ticks. */
export function resultsValueAxisNameGap(values: Array<number | null | undefined>): number {
  const widestTick = values.reduce<number>((widest, value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return widest;
    }
    return Math.max(widest, formatResultsAxisTick(value).length);
  }, 1);
  const estimatedTickWidth = Math.ceil(widestTick * 6.5);
  return Math.max(48, Math.min(78, estimatedTickWidth + 18));
}

/** Wrap long axis names at word boundaries so they remain visible on narrow charts. */
export function wrapResultsAxisName(label: string, lineLength = 32): string {
  const words = label.trim().split(/\s+/);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || current.length + word.length + 1 > lineLength) {
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
  }
  return lines.join('\n');
}
