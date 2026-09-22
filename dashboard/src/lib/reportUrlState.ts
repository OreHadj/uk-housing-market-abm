import { chooseReport2Setting, REPORT2_OUTCOMES, type SensitivityReport2Model } from '../pages/sensitivity-report2/sensitivityReport2Model';
import { SELECTABLE_KPI_KEYS } from './kpiLabels';

export const POLICY_ANALYSIS_WINDOWS = [
  { value: 'post500', label: 'After month 500' },
  { value: 'post1000', label: 'After month 1,000' },
  { value: 'post1500', label: 'After month 1,500' },
  { value: 'post2000', label: 'After month 2,000' },
  { value: 'full', label: 'Full run' }
] as const;

export function readPolicyAnalysisWindow(params: URLSearchParams) {
  return POLICY_ANALYSIS_WINDOWS.find((item) => item.value === params.get('window'))?.value ?? 'post500';
}

/** An absent comparison in Report is an explicit choice when opening Detailed. */
export function policyDetailedSelection(params: URLSearchParams, selectedRunId = '') {
  const primaryId = params.get('baselineRunId')?.trim() || params.get('runId')?.trim() || selectedRunId;
  const comparisonId = params.get('comparisonRunId')?.trim();
  // A job-only link may be switched before its accepted run id has arrived.
  const jobRef = params.get('jobRef')?.trim() ?? '';
  const scope = primaryId || (jobRef.startsWith('manual:') ? jobRef : '');
  return { comparisonNoneFor: scope && (!comparisonId || comparisonId === primaryId) ? scope : '' };
}

export const REPORT_MARKET_INDICATOR_IDS = [
  'output_saleAvSalePrice', 'core_mortgageApprovals', 'core_housingTransactions'
] as const;
export type ReportMarketIndicatorId = (typeof REPORT_MARKET_INDICATOR_IDS)[number];

/** Only the market chart's supported indicators can be selected by a saved link. */
export function readReportIndicator(params: URLSearchParams): ReportMarketIndicatorId {
  const requested = params.get('indicator')?.trim();
  return REPORT_MARKET_INDICATOR_IDS.find((id) => id === requested) ?? REPORT_MARKET_INDICATOR_IDS[0];
}

/** Resolve against the loaded experiment, including its existing deterministic setting default. */
export function readSensitivityReportState(params: URLSearchParams, model: SensitivityReport2Model) {
  const requestedOutcome = params.get('outcome')?.trim();
  const requestedSetting = params.get('setting')?.trim();
  const outcome = model.outcomes.find((item) => item.key === requestedOutcome)
    ?? model.outcomes.find((item) => item.key === 'core_mortgageApprovals')
    ?? model.outcomes[0];
  const explicitSetting = model.rows.find((row) => row.point.pointId === requestedSetting);
  return {
    outcomeKey: outcome?.key ?? '',
    settingId: chooseReport2Setting(model, explicitSetting?.point.pointId)?.point.pointId ?? null,
    hasExplicitSetting: Boolean(explicitSetting)
  };
}

/** Map the Report's outcome (including temporal ranges) to the retained Detailed controls. */
export function sensitivityDetailedSelection(params: URLSearchParams) {
  const outcome = REPORT2_OUTCOMES.find((item) => item.key === params.get('outcome')?.trim())
    ?? REPORT2_OUTCOMES.find((item) => item.key === 'core_mortgageApprovals')!;
  return { indicator: outcome.id, measure: outcome.measure };
}

/** URL-owned Detailed controls, validated against the loaded experiment and offered measures. */
export function readSensitivityDetailedState(params: URLSearchParams, indicatorIds: readonly string[]) {
  const fromReport = params.has('outcome') ? sensitivityDetailedSelection(params) : null;
  const requested = params.get('indicator')?.trim() || fromReport?.indicator;
  const measure = params.get('measure')?.trim() || fromReport?.measure;
  return {
    indicatorId: indicatorIds.find((id) => id === requested) ?? indicatorIds[0] ?? '',
    measure: SELECTABLE_KPI_KEYS.find((key) => key === measure) ?? 'mean',
    resultsOpen: params.get('sensitivityResults') === 'open'
  };
}

/** Page controls own only their specified keys; guide and other workspace state survive. */
export function updateReportQuery(params: URLSearchParams, updates: Readonly<Record<string, string | null | undefined>>): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(updates)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}
