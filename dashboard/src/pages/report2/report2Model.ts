import type {
  KpiMetricSummary,
  LendingDistributionPayload,
  ResultsComparePayload,
  ResultsRunDetail,
  ResultsSeriesPoint
} from '../../../shared/types';

export const REPORT2_INDICATOR_IDS = [
  'output_saleAvSalePrice',
  'output_saleHPI',
  'core_mortgageApprovals',
  'core_housingTransactions',
  'core_debtToIncome',
  'core_advancesToFTB',
  'core_advancesToHM',
  'core_advancesToBTL',
  'output_ownershipRate',
  'output_nonOwnerShare',
  'output_nRenting',
  'output_nActiveBTL',
  'output_rentalAvSalePrice',
  'core_rentalYield',
  'core_housePriceGrowth',
  'core_creditGrowth'
];

export function getReport2Kpi(
  payload: ResultsComparePayload | null,
  runId: string,
  indicatorId: string
): KpiMetricSummary | undefined {
  return payload?.kpiSummaryByRun.find((run) => run.runId === runId)
    ?.kpiSummary.find((kpi) => kpi.indicatorId === indicatorId);
}

export function getReport2Points(
  payload: ResultsComparePayload | null,
  runId: string,
  indicatorId: string
): ResultsSeriesPoint[] {
  return payload?.indicators.find((entry) => entry.indicator.id === indicatorId)
    ?.seriesByRun.find((run) => run.runId === runId)?.points ?? [];
}

/** Temporal population SD of the recorded monthly series, which may be a seed mean.
 * This is neither a mean of within-seed volatilities nor uncertainty across seeds.
 */
export function getReport2Volatility(points: ResultsSeriesPoint[]): number | null {
  let count = 0;
  let mean = 0;
  let squaredDeviations = 0;
  for (const { modelTime, value } of points) {
    if (!Number.isFinite(modelTime) || value === null || !Number.isFinite(value)) continue;
    count += 1;
    const delta = value - mean;
    mean += delta / count;
    squaredDeviations += delta * (value - mean);
  }
  if (count < 2) return null;
  const deviation = Math.sqrt(Math.max(0, squaredDeviations / count));
  return Number.isFinite(deviation) ? deviation : null;
}

/** Band shares use each borrower group's valid loans as denominator, and inclusive cuts. */
export function getReport2TailShare(
  lending: LendingDistributionPayload | null,
  metric: 'ltv' | 'lti',
  borrower: 'FTB' | 'HM'
): number | null {
  if (!lending?.available) return null;
  const group = lending.bandGroups.find((entry) => entry.metric === metric);
  const series = group?.seriesByBorrowerType.find((entry) => entry.borrowerType === borrower);
  if (!group || !series || !Number.isFinite(series.count) || series.count <= 0
    || !Number.isFinite(group.highThreshold)) return null;
  const tailBands = group.bands.filter((band) => band.lowerEdge >= group.highThreshold);
  // A cut inside a band cannot be reconstructed exactly from the grouped data.
  if (!tailBands.some((band) => band.lowerEdge === group.highThreshold)) return null;
  let share = 0;
  for (const band of tailBands) {
    const value = series.bands.find((entry) => entry.bandId === band.id)?.share;
    if (value === undefined || !Number.isFinite(value) || value < 0 || value > 100) return null;
    share += value;
  }
  return share <= 100.000001 ? Math.min(100, share) : null;
}

/** Pool valid owner-occupier ratios by their metric-specific counts; exclude BTL and cash.
 * Summary counts include loans whose income is missing, while their LTI means do not.
 */
export function getReport2LoanMean(
  lending: LendingDistributionPayload | null,
  metric: 'ltv' | 'lti'
): number | null {
  if (!lending?.available) return null;
  let weighted = 0;
  let count = 0;
  for (const entry of lending.summaryByBorrowerType) {
    if (entry.borrowerType !== 'FTB' && entry.borrowerType !== 'HM') continue;
    if (!Number.isFinite(entry.count) || entry.count < 0) return null;
    if (entry.count === 0) continue;
    const validCount = lending.bandGroups.find((group) => group.metric === metric)
      ?.seriesByBorrowerType.find((series) => series.borrowerType === entry.borrowerType)?.count
      ?? lending.histograms.find((histogram) => histogram.metric === metric)
        ?.seriesByBorrowerType.find((series) => series.borrowerType === entry.borrowerType)?.count;
    if (validCount === undefined || !Number.isFinite(validCount) || validCount < 0 || validCount > entry.count) return null;
    if (validCount === 0) continue;
    const value = metric === 'ltv' ? entry.meanLtv : entry.meanLti;
    if (value === null || !Number.isFinite(value) || value < 0) return null;
    weighted += value * validCount;
    count += validCount;
  }
  const mean = count > 0 ? weighted / count : null;
  return mean !== null && Number.isFinite(mean) ? mean : null;
}

/** The server converts renting counts to UK scale month by month before taking their mean. */
export function getReport2PrivateRentingShare(
  payload: ResultsComparePayload | null,
  runId: string,
  detail: ResultsRunDetail | null
): number | null {
  if (!detail || detail.runId !== runId) return null;
  const households = detail.provenance.ukHouseholds;
  const kpi = getReport2Kpi(payload, runId, 'output_nRenting');
  const renting = kpi?.mean;
  if (households === null || !Number.isFinite(households) || households <= 0
    || renting === undefined || renting === null || !Number.isFinite(renting)
    || renting < 0 || renting > households || kpi?.scaling !== 'dashboard') return null;
  return (renting / households) * 100;
}
