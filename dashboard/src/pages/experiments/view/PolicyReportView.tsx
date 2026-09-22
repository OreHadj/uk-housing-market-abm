import { useMemo } from 'react';
import type { KpiMetricSummary, ResultsCompareIndicator, ResultsComparePayload, ResultsRunDetail } from '../../../../shared/types';
import { getBasePolicyOption, summariseRunPolicy } from '../../../../shared/policyCatalogue';
import { CENTRAL_BANK_POLICY_DISPLAY, formatPolicyValue } from '../../../../shared/policyDisplay';
import { EChart } from '../../../components/EChart';
import { LoadingSkeletonGroup } from '../../../components/LoadingSkeleton';
import { formatKpiComparisonDelta, formatKpiValue, getPolicySettingDifferences } from '../../../lib/manualResultsView';
import { buildPolicyReportChartOption, getPolicyReportCoverage, POLICY_REPORT_INDICATORS } from '../../../lib/policyReport';

function runName(run: ResultsRunDetail): string {
  return run.title?.trim() || run.runId;
}

/** The short policy context belongs above the outcomes; full settings stay in the details dialog. */
export function PolicyReportContext({ primary, comparison, comparisonRunId }: {
  primary: ResultsRunDetail;
  comparison: ResultsRunDetail | null;
  comparisonRunId: string;
}) {
  const inferred = summariseRunPolicy(primary.policySettings);
  const basePolicy = primary.configuration.basePolicy
    ? getBasePolicyOption(primary.configuration.basePolicy)
    : inferred.basePolicyId ? getBasePolicyOption(inferred.basePolicyId) : null;
  const reference = comparison?.policySettings ?? (basePolicy
    ? Object.entries(basePolicy.values).map(([key, value]) => ({ key, value })) : []);
  const differences = comparisonRunId && !comparison ? [] : getPolicySettingDifferences(primary.policySettings, reference);
  const referenceLabel = comparison ? runName(comparison) : basePolicy?.title;

  return (
    <section className="policy-report-context" aria-label="Policy report context">
      <p className="policy-report-eyebrow">Policy scenario report</p>
      <h3>{runName(primary)}</h3>
      <p>
        {primary.configuration.modelVersion ? `Model ${primary.configuration.modelVersion}` : 'Model version not recorded'}
        {basePolicy && ` · ${basePolicy.title}`}
        {primary.provenance.ukHouseholds !== null && ` · ${primary.provenance.ukHouseholds.toLocaleString('en-GB')} UK households`}
      </p>
      {comparisonRunId && !comparison ? <p>Loading comparison settings…</p> : referenceLabel ? (
        <>
          <p>{differences.length === 0 ? 'No recorded policy settings differ' : `${differences.length} policy ${differences.length === 1 ? 'setting differs' : 'settings differ'}`} from {referenceLabel}.</p>
          {differences.length > 0 && (
            <dl className="policy-report-policy-changes">
              {differences.map((difference) => {
                const display = CENTRAL_BANK_POLICY_DISPLAY[difference.key];
                const format = (value: number | null) => value === null ? 'Not recorded' : display ? formatPolicyValue(value, display.unit) : String(value);
                return (
                  <div key={difference.key}>
                    <dt>{display?.label ?? difference.key}</dt>
                    <dd><strong>{format(difference.primaryValue)}</strong><span> compared with {format(difference.comparisonValue)}</span></dd>
                  </div>
                );
              })}
            </dl>
          )}
        </>
      ) : <p>Reference policy not recorded. Full settings are available in run details.</p>}
    </section>
  );
}

function coverageText(coverage: ReturnType<typeof getPolicyReportCoverage>): string {
  if (!coverage) return 'No recorded values in this analysis window.';
  return `Months ${coverage.startMonth.toLocaleString('en-GB')}–${coverage.endMonth.toLocaleString('en-GB')} · ${coverage.observedMonths.toLocaleString('en-GB')} monthly observations`;
}

function PolicyOutcomeCard({ definition, indicator, primaryKpi, comparisonKpi, primaryRunId, comparisonRunId, primary, comparison }: {
  definition: (typeof POLICY_REPORT_INDICATORS)[number];
  indicator: ResultsCompareIndicator | undefined;
  primaryKpi: KpiMetricSummary | undefined;
  comparisonKpi: KpiMetricSummary | undefined;
  primaryRunId: string;
  comparisonRunId: string;
  primary: ResultsRunDetail | null;
  comparison: ResultsRunDetail | null;
}) {
  const option = useMemo(() => indicator ? buildPolicyReportChartOption(indicator, primaryRunId, comparisonRunId) : null,
    [indicator, primaryRunId, comparisonRunId]);
  const primaryCoverage = getPolicyReportCoverage(indicator?.seriesByRun.find((series) => series.runId === primaryRunId)?.points ?? []);
  const comparisonCoverage = getPolicyReportCoverage(indicator?.seriesByRun.find((series) => series.runId === comparisonRunId)?.points ?? []);
  const units = primaryKpi?.units ?? indicator?.indicator.units ?? definition.units;
  const hasComparison = Boolean(comparisonRunId);
  const missingNote = primary?.indicators.find((item) => item.id === definition.id && !item.available)?.note;
  const missingComparisonNote = comparison?.indicators.find((item) => item.id === definition.id && !item.available)?.note;
  const titleId = `policy-report-${definition.id}`;

  return (
    <article className="policy-report-card" aria-labelledby={titleId}>
      <header>
        <h4 id={titleId}>{definition.title}</h4>
        <p className="policy-report-description">{definition.description}</p>
      </header>
      <dl className="policy-report-values">
        <div className="policy-report-primary-value">
          <dt>{hasComparison ? 'Primary run mean' : 'Analysis-window mean'}</dt>
          <dd>{primaryKpi?.mean == null ? 'Unavailable' : formatKpiValue(primaryKpi.mean, units, primaryKpi.scaling)}</dd>
        </div>
        {hasComparison && (
          <>
            <div>
              <dt>Comparison mean</dt>
              <dd>{comparisonKpi?.mean == null ? 'Unavailable' : formatKpiValue(comparisonKpi.mean, units, comparisonKpi.scaling)}</dd>
            </div>
            <div className="policy-report-difference">
              <dt>Primary − comparison</dt>
              <dd>{formatKpiComparisonDelta(primaryKpi?.mean ?? null, comparisonKpi?.mean ?? null, units, primaryKpi?.scaling)}</dd>
            </div>
          </>
        )}
      </dl>
      {option && (primaryCoverage || comparisonCoverage) ? (
        <div role="img" aria-label={`${definition.title}. Recorded monthly values${hasComparison ? ' for the primary and comparison runs' : ''}. Dotted lines show analysis-window means.`}>
          <EChart option={option} className="policy-report-chart" />
        </div>
      ) : <p className="policy-report-empty">{missingNote || 'No recorded values in this analysis window. Try a shorter warm-up period or another run.'}</p>}
      <div className="policy-report-coverage">
        <p>{hasComparison && <strong>Primary run · </strong>}{primaryCoverage ? coverageText(primaryCoverage) : missingNote || coverageText(null)}</p>
        {hasComparison && <p><strong>Comparison run · </strong>{comparisonCoverage ? coverageText(comparisonCoverage) : missingComparisonNote || coverageText(null)}</p>}
      </div>
    </article>
  );
}

export function PolicyReportView({ payload, primary, comparison, primaryRunId, comparisonRunId, windowLabel, isLoading, error }: {
  payload: ResultsComparePayload | null;
  primary: ResultsRunDetail | null;
  comparison: ResultsRunDetail | null;
  primaryRunId: string;
  comparisonRunId: string;
  windowLabel: string;
  isLoading: boolean;
  error: string;
}) {
  const primaryKpis = payload?.kpiSummaryByRun.find((run) => run.runId === primaryRunId)?.kpiSummary;
  const comparisonKpis = payload?.kpiSummaryByRun.find((run) => run.runId === comparisonRunId)?.kpiSummary;
  const runs = [primary, comparison].filter((run): run is ResultsRunDetail => run !== null);
  const hasEnsemble = runs.some((run) => run.provenance.seedSource === 'manifest' && (run.provenance.seeds?.length ?? 0) > 1);
  const hasLegacyProvenance = runs.some((run) => run.provenance.seedSource !== 'manifest');

  return (
    <section className="policy-report results-card" aria-labelledby="policy-report-outcomes" aria-busy={isLoading}>
      <header className="policy-report-heading">
        <div><h3 id="policy-report-outcomes">Policy outcomes</h3><p>{windowLabel}</p></div>
        <span className="policy-report-monthly-label">Recorded monthly series</span>
      </header>
      <p className="policy-report-reading-note">Each headline and dotted line is the mean of available months in this window. Charts use no additional smoothing.</p>
      {error ? <p className="error-banner" role="alert">{error}</p> : isLoading ? (
        <LoadingSkeletonGroup className="policy-report-grid" count={4} itemClassName="policy-report-loading-card" ariaLabel="Loading policy report" />
      ) : !primaryRunId || !payload ? <p className="info-banner">Select a finished policy run to read its report.</p> : (
        <>
          <div className="policy-report-grid">
            {POLICY_REPORT_INDICATORS.map((definition) => (
              <PolicyOutcomeCard
                key={definition.id}
                definition={definition}
                indicator={payload.indicators.find((item) => item.indicator.id === definition.id)}
                primaryKpi={primaryKpis?.find((kpi) => kpi.indicatorId === definition.id)}
                comparisonKpi={comparisonKpis?.find((kpi) => kpi.indicatorId === definition.id)}
                primaryRunId={primaryRunId}
                comparisonRunId={comparisonRunId}
                primary={primary}
                comparison={comparison}
              />
            ))}
          </div>
          <aside className="policy-report-method" aria-label="How the report is calculated">
            <p>{hasEnsemble ? 'For runs with multiple recorded seeds, monthly values average the available seeds before the time average is calculated. ' : ''}These are averages of model indicators over time. No interval for uncertainty across seeds is shown.</p>
            {hasLegacyProvenance && <p>Some selected output has no recorded ensemble manifest. Its seed coverage cannot be confirmed from the results metadata.</p>}
            {comparisonRunId && <p>Differences are primary minus comparison. Each mean uses that run’s available months, shown beneath its chart. The comparison is descriptive. Differing run settings or calibration also affect outcomes.</p>}
            <p>Use Detailed to explore all indicators and smoothing options.</p>
          </aside>
        </>
      )}
    </section>
  );
}
