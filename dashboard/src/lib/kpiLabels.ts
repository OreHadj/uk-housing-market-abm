import type { KpiMetricKey } from '../../shared/types';

/**
 * Display names for the KPI summary measures. `label` is the descriptive form used where there is
 * room to explain (dropdowns, chart axis titles); `short` is the compact form for table headers.
 * Kept in one place so the results view and the chart options cannot drift apart.
 */
export const KPI_LABELS: Record<KpiMetricKey, { label: string; short: string }> = {
  mean: { label: 'Mean (monthly)', short: 'Mean' },
  cv: { label: 'Volatility (coefficient of variation)', short: 'Volatility' },
  annualisedTrend: { label: 'Annualised trend', short: 'Trend' },
  range: { label: 'Dispersion (P95–P5)', short: 'Dispersion' }
};

/** Measures offered to the user in the sensitivity results view, in display order. */
export const SELECTABLE_KPI_KEYS: readonly KpiMetricKey[] = ['mean', 'cv', 'range'];
