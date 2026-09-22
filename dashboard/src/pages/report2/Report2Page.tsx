import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { LendingDistributionComparePayload, LendingDistributionPayload, ResultsComparePayload, ResultsRunDetail, ResultsRunSummary } from '../../../shared/types';
import { getBasePolicyOption, summariseRunPolicy } from '../../../shared/policyCatalogue';
import { CENTRAL_BANK_POLICY_DISPLAY, formatPolicyValue } from '../../../shared/policyDisplay';
import { EChart } from '../../components/EChart';
import { ReportInfo } from '../../components/ReportInfo';
import { fetchLendingDistributionCompare, fetchResultsCompare, fetchResultsRunDetail, fetchResultsRuns } from '../../lib/api';
import { findMatchedManualBaselineRun, formatKpiComparisonDelta, formatKpiDeltaValue, formatKpiValue, formatManualComparisonCalibrationNotice, formatManualComparisonMismatchWarning, getManualComparisonFieldDifferences, getPolicySettingDifferences } from '../../lib/manualResultsView';
import { getPolicyReportCoverage } from '../../lib/policyReport';
import { formatModelOptionLabel } from '../../lib/modelAnchors';
import { POLICY_ANALYSIS_WINDOWS as WINDOWS, policyDetailedSelection, readPolicyAnalysisWindow, readReportIndicator, updateReportQuery } from '../../lib/reportUrlState';
import type { ReportExecutionState } from '../../lib/resultsQueue';
import { createScenarioDraftId, setActiveScenarioDraftId, writeScenarioDraft, type ScenarioDraftV1 } from '../../lib/scenarioDraft';
import { buildReport2Borrowers, buildReport2Risk, buildReport2Tenure, buildReport2Trend } from './report2Charts';
import { Report2MarketChart } from './Report2MarketChart';
import { Report2ComparisonAction } from './Report2ComparisonAction';
import { getReport2Kpi, getReport2LoanMean, getReport2Points, getReport2PrivateRentingShare, getReport2TailShare, getReport2Volatility, REPORT2_INDICATOR_IDS } from './report2Model';
import './report2.css';

const MARKET = [
  { id: 'output_saleAvSalePrice', label: 'House prices', units: 'GBP' },
  { id: 'core_mortgageApprovals', label: 'Mortgage approvals', units: 'count/month' },
  { id: 'core_housingTransactions', label: 'Transactions', units: 'count/month' }
];
const BORROWERS = [
  { id: 'core_advancesToFTB', label: 'First-time buyers' },
  { id: 'core_advancesToHM', label: 'Home movers' },
  { id: 'core_advancesToBTL', label: 'Buy-to-let investors' }
];

function name(run: ResultsRunSummary | null | undefined): string {
  return run?.title?.trim() || run?.runId || 'Not selected';
}

function number(value: number | null | undefined, units: string): string {
  return value == null || !Number.isFinite(value) ? 'Not recorded' : formatKpiValue(value, units);
}

function delta(value: number | null, reference: number | null, units: string): string {
  if (value === null || reference === null || !Number.isFinite(value) || !Number.isFinite(reference)) return 'Not available';
  return formatKpiComparisonDelta(value, reference, units);
}

function relative(value: number | null, reference: number | null): string | null {
  if (value === null || reference === null || !Number.isFinite(value) || !Number.isFinite(reference) || reference === 0) return null;
  const change = (value - reference) / Math.abs(reference) * 100;
  return formatKpiDeltaValue(change, 'GBP');
}

function CardHeading({ index, title, subtitle, help, extra }: { index: string; title: string; subtitle: string; help: string; extra?: ReactNode }) {
  return <header className="r2-card-heading"><div className="r2-heading-copy"><p className="r2-eyebrow">{index}</p><div className="r2-title-row"><h2>{title}</h2><ReportInfo label={title}>{help}</ReportInfo></div><p className="r2-caption">{subtitle}</p></div>{extra}</header>;
}

function Legend({ comparison }: { comparison: boolean }) {
  return <div className="r2-legend"><span><i className="r2-dot r2-policy" />Selected run</span>{comparison && <span><i className="r2-dot r2-baseline" />Baseline</span>}</div>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="r2-empty"><span aria-hidden="true">—</span><p>{children}</p></div>;
}

function Headline({ label, value, reference, units, comparison, note, accent, help, guidedTarget }: {
  label: string; value: number | null; reference: number | null; units: string; comparison: boolean; note: string; accent: string; help: string; guidedTarget?: string;
}) {
  const change = units === 'GBP' ? relative(value, reference) : value === null || reference === null ? null : delta(value, reference, units);
  return <article className={`r2-card r2-headline r2-accent-${accent}`} data-guided-target={guidedTarget}>
    <p className="r2-headline-label"><span className="r2-square" /><span className="r2-headline-label-text">{label}</span><ReportInfo label={label}>{help}</ReportInfo></p>
    <strong className="r2-headline-value">{number(value, units)}</strong>
    <div className="r2-headline-comparison">{comparison ? <><span className="r2-change">{change ?? 'Not available'}</span><span className="r2-baseline-reference">vs baseline <strong>{number(reference, units)}</strong></span></> : <span>Selected run · {note}</span>}</div>
    {comparison && <p className="r2-caption">{note}</p>}
  </article>;
}

function PolicyContext({ primary, comparison, comparisonSelected }: { primary: ResultsRunDetail | null; comparison: ResultsRunDetail | null; comparisonSelected: boolean }) {
  if (!primary) return <aside className="r2-card r2-context"><Empty>Run settings will appear here.</Empty></aside>;
  const inferred = summariseRunPolicy(primary.policySettings);
  const baseId = primary.configuration.basePolicy ?? inferred.basePolicyId;
  const base = baseId ? getBasePolicyOption(baseId) : null;
  const reference = comparison?.policySettings ?? (!comparisonSelected && base ? Object.entries(base.values).map(([key, value]) => ({ key, value })) : []);
  const differences = getPolicySettingDifferences(primary.policySettings, reference);
  const displayed = differences.slice(0, 3);
  const seeds = primary.provenance.seeds;
  const setting = (key: string, value: number | null) => value === null ? 'Not recorded' : CENTRAL_BANK_POLICY_DISPLAY[key] ? formatPolicyValue(value, CENTRAL_BANK_POLICY_DISPLAY[key].unit) : String(value);
  return <aside className="r2-card r2-context" aria-label="Policy and run setup" data-guided-target="policy-context">
    <p className="r2-small-title r2-title-row"><span>{comparisonSelected ? 'Changes from baseline' : 'Changes from base policy'}</span><ReportInfo label="Policy and run settings">Recorded policy differences and run settings. Expand “All policy settings” for the full configuration. Check model, duration and seed coverage when comparing runs.</ReportInfo></p>
    {reference.length === 0 ? <p className="r2-caption">Reference settings not recorded.</p> : displayed.length === 0 ? <p className="r2-caption">No recorded policy settings differ.</p> : <dl className="r2-policy-changes">{displayed.map((item) => <div key={item.key}><dt>{CENTRAL_BANK_POLICY_DISPLAY[item.key]?.label ?? item.key}</dt><dd><span>{setting(item.key, item.comparisonValue)}</span><span aria-hidden="true"> → </span><strong>{setting(item.key, item.primaryValue)}</strong></dd></div>)}</dl>}
    <details className="r2-settings"><summary>All policy settings{differences.length > 3 ? ` (${differences.length} changes)` : ''}</summary><dl>{primary.policySettings.map((item) => <div key={item.key}><dt>{CENTRAL_BANK_POLICY_DISPLAY[item.key]?.label ?? item.key}</dt><dd>{setting(item.key, item.value)}</dd></div>)}</dl></details>
    <div className="r2-context-rule" />
    <dl className="r2-provenance">
      <div><dt>Model</dt><dd>{primary.configuration.modelVersion ? formatModelOptionLabel(primary.configuration.modelVersion) : 'Not recorded'}</dd></div>
      <div><dt>Model households</dt><dd>{number(primary.provenance.targetPopulation, 'count')}</dd></div>
      <div><dt>UK households</dt><dd>{number(primary.provenance.ukHouseholds, 'count')}</dd></div>
      <div><dt>Duration</dt><dd>{primary.provenance.nSteps === null ? 'Not recorded' : `${primary.provenance.nSteps.toLocaleString('en-GB')} months`}</dd></div>
      <div><dt>Recorded seeds</dt><dd title={seeds?.join(', ')}>{seeds?.length ?? 'Unknown'}{primary.provenance.seedSource !== 'manifest' && ' · unconfirmed'}</dd></div>
    </dl>
    {comparison && <div className="r2-baseline-name"><span className="r2-small-title r2-title-row"><span>Comparison baseline</span><ReportInfo label="Comparison baseline">The reference run for reported changes. Model settings, recorded months and seed differences can also affect comparisons.</ReportInfo></span><strong>{name(comparison)}</strong><span className="r2-caption">{comparison.configuration.modelVersion ? formatModelOptionLabel(comparison.configuration.modelVersion) : 'Model not recorded'} · {comparison.provenance.seedSource === 'manifest' ? `${comparison.provenance.seeds?.length ?? 'unknown'} seeds` : 'seed coverage unconfirmed'}</span></div>}
  </aside>;
}

function lendingCoverage(run: LendingDistributionPayload | null): string {
  if (!run?.available) return run?.note || 'Transaction-level lending was not recorded for this window.';
  const start = run.window.startModelTime;
  const end = run.window.endModelTime;
  return `Months ${start?.toLocaleString('en-GB') ?? '?'}–${end?.toLocaleString('en-GB') ?? '?'} · ${run.seedCount} transaction ${run.seedCount === 1 ? 'file' : 'files'}${run.window.clamped ? ' · limited to recorded months' : ''}`;
}

/** The default policy report, kept separate from the detailed and sensitivity presentations. */
export function Report2Page({ presentationControls, queueControls, execution, canWrite }: { presentationControls: ReactNode; queueControls?: ReactNode; execution?: ReportExecutionState; canWrite: boolean }) {
  const [workspaceTitle, setWorkspaceTitle] = useState<HTMLElement | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const primaryId = searchParams.get('baselineRunId')?.trim() || searchParams.get('runId')?.trim() || execution?.selectedJob?.runId || '';
  const reportBlocked = execution?.blocked ?? false;
  const requestedComparison = searchParams.get('comparisonRunId')?.trim() ?? '';
  const comparisonId = requestedComparison === primaryId ? '' : requestedComparison;
  const isPolicyGuide = searchParams.get('demo') === 'policy-results';
  const window = readPolicyAnalysisWindow(searchParams);
  const [savedRuns, setRuns] = useState<ResultsRunSummary[]>([]);
  const unavailableRunIds = new Set([
    ...(execution?.removedIds ?? []),
    ...(execution?.items.filter((job) => job.status === 'queued' || job.status === 'running').map((job) => job.runId) ?? [])
  ]);
  if (reportBlocked && primaryId) unavailableRunIds.add(primaryId);
  const runs = savedRuns.filter((run) => !unavailableRunIds.has(run.runId));
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState('');
  const [loadedPrimary, setPrimary] = useState<ResultsRunDetail | null>(null);
  const [loadedComparison, setComparison] = useState<ResultsRunDetail | null>(null);
  const [loadedPayload, setPayload] = useState<ResultsComparePayload | null>(null);
  const [loadedLending, setLending] = useState<LendingDistributionComparePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [lendingLoading, setLendingLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [lendingError, setLendingError] = useState('');
  const [retry, setRetry] = useState(0);
  const marketId = readReportIndicator(searchParams);
  const [showMarketSelected, setShowMarketSelected] = useState(true);
  const [showMarketBaseline, setShowMarketBaseline] = useState(true);
  const [riskMetric, setRiskMetric] = useState<'ltv' | 'lti'>('ltv');
  const matchesSelection = (value: ResultsComparePayload | LendingDistributionComparePayload | null) => value?.window === window
    && value.runIds.length === (comparisonId ? 2 : 1) && value.runIds.includes(primaryId)
    && (!comparisonId || value.runIds.includes(comparisonId));
  const payload = !reportBlocked && matchesSelection(loadedPayload) ? loadedPayload : null;
  const lending = !reportBlocked && matchesSelection(loadedLending) ? loadedLending : null;
  const primary = !reportBlocked && loadedPrimary?.runId === primaryId ? loadedPrimary : null;
  const comparison = !reportBlocked && comparisonId && loadedComparison?.runId === comparisonId ? loadedComparison : null;

  useEffect(() => {
    const heading = document.getElementById('workspace-page-title');
    if (!heading) return;
    // Own only this span so navigation and other presentations keep their shared header.
    const titleHost = document.createElement('span');
    titleHost.className = 'r2-workspace-title';
    heading.append(titleHost);
    setWorkspaceTitle(titleHost);
    return () => titleHost.remove();
  }, []);

  function update(updates: Record<string, string>) {
    setSearchParams((current) => updateReportQuery(current, updates), { replace: true });
  }

  function openMatchingBaseline(draft: ScenarioDraftV1) {
    if (!canWrite) return;
    try {
      const draftId = createScenarioDraftId();
      writeScenarioDraft(draftId, draft);
      setActiveScenarioDraftId(draftId);
      navigate(`/scenarios/new?${new URLSearchParams({ draft: draftId, baseline: draft.calibratedModel })}`);
    } catch {
      setDetailError('Could not save the matching-run draft. Please try again.');
    }
  }

  useEffect(() => {
    let cancelled = false;
    setRunsLoading(true);
    setRunsError('');
    void fetchResultsRuns().then((items) => { if (!cancelled) setRuns(items.filter((run) => run.status !== 'invalid')); })
      .catch((reason: Error) => { if (!cancelled) setRunsError(reason.message); })
      .finally(() => { if (!cancelled) setRunsLoading(false); });
    return () => { cancelled = true; };
  }, [retry, execution?.revision]);

  useEffect(() => {
    if (reportBlocked) return;
    if (isPolicyGuide || primaryId || runsLoading || runs.length === 0) return;
    const selected = runs.find((run) => run.status === 'complete') ?? runs[0];
    const matched = findMatchedManualBaselineRun(runs, selected.runId);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('baselineRunId', selected.runId);
      if (!next.has('comparisonRunId') && matched && next.get('comparisonNoneFor') !== selected.runId) next.set('comparisonRunId', matched.runId);
      return next;
    }, { replace: true });
  }, [reportBlocked, isPolicyGuide, primaryId, runs, runsLoading, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    setPayload(null); setPrimary(null); setComparison(null); setError(''); setDetailError('');
    if (reportBlocked || !primaryId) { setLoading(false); return; }
    setLoading(true);
    const ids = comparisonId ? [primaryId, comparisonId] : [primaryId];
    void Promise.allSettled([
      fetchResultsCompare(ids, [...REPORT2_INDICATOR_IDS], window, 0),
      fetchResultsRunDetail(primaryId),
      comparisonId ? fetchResultsRunDetail(comparisonId) : Promise.resolve(null)
    ]).then(([outcomes, policy, baseline]) => {
      if (cancelled) return;
      if (outcomes.status === 'fulfilled') setPayload(outcomes.value); else setError(outcomes.reason instanceof Error ? outcomes.reason.message : 'Unable to load results.');
      if (policy.status === 'fulfilled') setPrimary(policy.value);
      if (baseline.status === 'fulfilled') setComparison(baseline.value);
      if (policy.status === 'rejected' || baseline.status === 'rejected') setDetailError('Some run settings could not be loaded. Comparison context is incomplete.');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [reportBlocked, primaryId, comparisonId, window, retry]);

  useEffect(() => {
    let cancelled = false;
    setLending(null); setLendingError('');
    if (reportBlocked || !primaryId) { setLendingLoading(false); return; }
    setLendingLoading(true);
    void fetchLendingDistributionCompare(comparisonId ? [primaryId, comparisonId] : [primaryId], window)
      .then((data) => { if (!cancelled) setLending(data); })
      .catch((reason: Error) => { if (!cancelled) setLendingError(reason.message); })
      .finally(() => { if (!cancelled) setLendingLoading(false); });
    return () => { cancelled = true; };
  }, [reportBlocked, primaryId, comparisonId, window, retry]);

  const hasComparison = Boolean(comparisonId);
  const mean = (id: string, runId = primaryId) => getReport2Kpi(payload, runId, id)?.mean ?? null;
  const primaryLending = lending?.runs.find((run) => run.runId === primaryId) ?? null;
  const comparisonLending = lending?.runs.find((run) => run.runId === comparisonId) ?? null;
  const transactionRecordingDisabled = [primaryLending, comparisonLending].some((run) => run?.unavailableReason === 'recording_disabled');
  const riskThreshold = (run: LendingDistributionPayload | null) => run?.bandGroups.find((group) => group.metric === riskMetric)?.highThreshold;
  const riskDefinition = (run: LendingDistributionPayload | null) => {
    const threshold = riskThreshold(run);
    return threshold === undefined || !Number.isFinite(threshold) ? 'Threshold not recorded' : `${riskMetric.toUpperCase()} ≥ ${threshold}${riskMetric === 'ltv' ? '%' : '× income'}`;
  };
  const thresholdsDiffer = riskThreshold(primaryLending) !== undefined && riskThreshold(comparisonLending) !== undefined
    && riskThreshold(primaryLending) !== riskThreshold(comparisonLending);
  const priceVolatility = getReport2Volatility(getReport2Points(payload, primaryId, 'core_housePriceGrowth'));
  const baselinePriceVolatility = getReport2Volatility(getReport2Points(payload, comparisonId, 'core_housePriceGrowth'));
  const creditVolatility = getReport2Volatility(getReport2Points(payload, primaryId, 'core_creditGrowth'));
  const baselineCreditVolatility = getReport2Volatility(getReport2Points(payload, comparisonId, 'core_creditGrowth'));
  const rentingShare = getReport2PrivateRentingShare(payload, primaryId, primary);
  const baselineRentingShare = getReport2PrivateRentingShare(payload, comparisonId, comparison);
  const trend = useMemo(() => buildReport2Trend(payload?.indicators.find((item) => item.indicator.id === marketId), primaryId, comparisonId), [payload, marketId, primaryId, comparisonId]);
  const borrowers = useMemo(() => buildReport2Borrowers(payload, primaryId, comparisonId), [payload, primaryId, comparisonId]);
  const risk = useMemo(() => buildReport2Risk(primaryLending, comparisonLending, riskMetric), [primaryLending, comparisonLending, riskMetric]);
  const ownership = mean('output_ownershipRate');
  const tenure = useMemo(() => buildReport2Tenure(ownership, rentingShare), [ownership, rentingShare]);
  const marketCoverage = getPolicyReportCoverage(getReport2Points(payload, primaryId, marketId));
  const baselineCoverage = getPolicyReportCoverage(getReport2Points(payload, comparisonId, marketId));
  const differences = primary && comparison ? getManualComparisonFieldDifferences(primary, comparison) : [];
  const calibrationNote = formatManualComparisonCalibrationNotice(differences);
  const settingsNote = formatManualComparisonMismatchWarning(differences);
  const originalParams = updateReportQuery(searchParams, policyDetailedSelection(searchParams, primaryId));
  originalParams.set('type', 'manual'); originalParams.set('presentation', 'detailed');
  const detailedUrl = `/results?${originalParams}`;
  const coverage = (value: typeof marketCoverage) => value ? `${value.startMonth.toLocaleString('en-GB')}–${value.endMonth.toLocaleString('en-GB')} · ${value.observedMonths.toLocaleString('en-GB')} observations` : 'No recorded months';
  const seedsNote = [primary, comparison].filter(Boolean).some((run) => run?.provenance.seedSource !== 'manifest');
  const selectedRun = primary ?? runs.find((run) => run.runId === primaryId);
  const selectedRunName = selectedRun ? name(selectedRun) : execution?.selectedJob?.title || primaryId || 'Select a policy run';
  const comparisonRun = comparison ?? runs.find((run) => run.runId === comparisonId);
  const comparisonRunName = comparisonRun ? name(comparisonRun) : comparisonId;
  const reportTitle = hasComparison ? `${selectedRunName} vs ${comparisonRunName}` : selectedRunName;

  return <section className="report2" aria-labelledby="r2-title">
    {workspaceTitle && createPortal(<><span aria-hidden="true"> / </span>Policy scenarios<span aria-hidden="true"> / </span>Report</>, workspaceTitle)}
    {queueControls}
    <div className="r2-toolbar">
      <div className="r2-controls r2-run-controls" data-guided-target="policy-run-selectors">
      <label><span><i className="r2-dot r2-policy" />Selected policy run</span><select aria-label="Selected policy run" value={primaryId} onChange={(event) => { const id = event.target.value; update({ baselineRunId: id, runId: '', jobRef: '', comparisonRunId: findMatchedManualBaselineRun(runs, id)?.runId ?? '', comparisonNoneFor: '' }); }} disabled={runsLoading && runs.length === 0}>
        {!primaryId && <option value="">{runsLoading ? 'Loading runs…' : 'Select a run'}</option>}{primaryId && !runs.some((run) => run.runId === primaryId) && <option value={primaryId}>{selectedRunName}</option>}{runs.map((run) => <option key={run.runId} value={run.runId}>{name(run)}</option>)}
      </select></label>
      <label><span><i className="r2-dot r2-baseline" />Comparison baseline</span><select aria-label="Comparison baseline" value={comparisonId} onChange={(event) => update({ comparisonRunId: event.target.value, comparisonNoneFor: event.target.value ? '' : primaryId })} disabled={runsLoading || !primaryId}>
        <option value="">No comparison run</option>{comparisonId && !runs.some((run) => run.runId === comparisonId) && <option value={comparisonId}>{comparisonId}</option>}{runs.filter((run) => run.runId !== primaryId).map((run) => <option key={run.runId} value={run.runId}>{name(run)}</option>)}
      </select></label>
      </div>
      {presentationControls}
    </div>
    <header className="r2-page-heading">
      <div><p className="r2-eyebrow">Results / Policy runs</p><h1 id="r2-title">{reportTitle}</h1><p className="r2-caption">The market, the borrowers, and the wider effects.</p><p className="r2-print-window">{WINDOWS.find((item) => item.value === window)?.label}</p></div>
      <div className="r2-controls r2-report-actions">
      <label className="r2-window-control"><span>Analysis window</span><select aria-label="Analysis window" value={window} onChange={(event) => update({ window: event.target.value })}>{WINDOWS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <button className="r2-print" type="button" onClick={() => globalThis.window.print()} disabled={reportBlocked || loading || !payload || lendingLoading || (!lending && !lendingError)} aria-label="Print policy report"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7zM17 11h.01" /></svg><span>Print</span></button>
      </div>
    </header>

    {runsError || (!reportBlocked && error) ? <div className="r2-notice" role="alert"><p>{runsError || error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div> : null}
    {!reportBlocked && detailError && <p className="r2-notice" role="status">{detailError}</p>}
    {!reportBlocked && !runsLoading && !runsError && runs.length === 0 && !primaryId && <Empty>No saved policy runs are available yet. Open this page after a run has produced results.</Empty>}
    {!reportBlocked && (loading || runsLoading) && <div className="r2-loading" role="status"><span />Loading the policy report…</div>}

    {!loading && payload && <>
      {(calibrationNote || settingsNote) && <aside className="r2-notice" aria-label="Comparison context">{calibrationNote && <p>{calibrationNote}</p>}{settingsNote && <p>{settingsNote}</p>}</aside>}
      {(primary?.status === 'partial' || comparison?.status === 'partial') && <p className="r2-notice">Partial output: figures cover recorded months only.</p>}
      {primary && !runsLoading && !runsError && (!hasComparison || comparison) && <Report2ComparisonAction
        primary={primary} comparison={comparison} runs={runs} canWrite={canWrite}
        onUse={(runId) => update({ comparisonRunId: runId, comparisonNoneFor: '' })} onCreate={openMatchingBaseline}
      />}
      <div className="r2-dashboard">
        <PolicyContext primary={primary} comparison={comparison} comparisonSelected={hasComparison} />
        <div className="r2-main-grid">
          <div className="r2-headlines">
            <Headline guidedTarget="policy-house-price" label="Average house price" value={mean('output_saleAvSalePrice')} reference={mean('output_saleAvSalePrice', comparisonId)} units="GBP" comparison={hasComparison} note="Completed sales · window mean" accent="blue" help="Mean recorded monthly price of completed sales over the selected window. Change compares this mean with the baseline run." />
            <Headline label="Mortgage debt / income" value={mean('core_debtToIncome')} reference={mean('core_debtToIncome', comparisonId)} units="%" comparison={hasComparison} note="All mortgage debt / household net income" accent="purple" help="Total mortgage debt relative to household net income, averaged over the selected window. This measures household-sector leverage, not an individual borrower’s loan-to-income ratio." />
            <Headline label="Price-growth volatility" value={priceVolatility} reference={baselinePriceVolatility} units="percentage points" comparison={hasComparison} note="Temporal SD · quarterly growth" accent="teal" help="Monthly variation in quarterly house-price growth over the selected window, after averaging available seeds. Larger values mean a more variable average path." />
            <Headline label="Owner-occupier share" value={ownership} reference={mean('output_ownershipRate', comparisonId)} units="%" comparison={hasComparison} note="Share of all model households" accent="gold" help="Share in the model’s owner-occupier category, averaged over the selected window. Active buy-to-let investors are counted separately. Baseline differences use percentage points, calculated before rounding the displayed shares." />
          </div>

          <article className="r2-card r2-market" data-guided-target="policy-market">
            <CardHeading index="01 / The market" title="Market activity" subtitle="Recorded monthly values for this window." help="Choose sale prices, mortgage approvals or housing transactions. Lines show recorded monthly values; the table compares window averages. Counts use UK scale. Legend dots hide or show each run." extra={<div className="r2-legend r2-market-legend" role="group" aria-label="Visible market runs">
              <button type="button" aria-pressed={showMarketSelected} aria-controls="r2-market-chart" title={`${showMarketSelected ? 'Hide' : 'Show'} selected run`} onClick={() => setShowMarketSelected((shown) => !shown)}><i className="r2-dot r2-policy" aria-hidden="true" />Selected run</button>
              {hasComparison && <button type="button" aria-pressed={showMarketBaseline} aria-controls="r2-market-chart" title={`${showMarketBaseline ? 'Hide' : 'Show'} baseline`} onClick={() => setShowMarketBaseline((shown) => !shown)}><i className="r2-dot r2-baseline" aria-hidden="true" />Baseline</button>}
            </div>} />
            <div className="r2-tabs" role="group" aria-label="Market indicator">{MARKET.map((item) => <button type="button" key={item.id} aria-pressed={marketId === item.id} onClick={() => update({ indicator: item.id })}>{item.label}</button>)}</div>
            {trend ? <div id="r2-market-chart" className="r2-market-chart-wrap" role="img" aria-label={`${MARKET.find((item) => item.id === marketId)?.label}: ${[showMarketSelected && 'selected run', hasComparison && showMarketBaseline && 'baseline'].filter(Boolean).join(' and ') || 'both runs hidden'}. Monthly observations; values are summarised below.`}><Report2MarketChart option={trend} showSelected={showMarketSelected} showBaseline={hasComparison && showMarketBaseline} />{!showMarketSelected && !(hasComparison && showMarketBaseline) && <p className="r2-market-hidden-hint">Use the legend dots to show a run.</p>}</div> : <Empty>This indicator has no recorded values in the selected window.</Empty>}
            <div className="r2-table-wrap"><table className="r2-table"><caption className="visually-hidden">Market outcomes, window means</caption><thead><tr><th scope="col">Window mean</th>{hasComparison && <th scope="col">Baseline</th>}<th scope="col">Selected run</th>{hasComparison && <th scope="col">Change</th>}</tr></thead><tbody>{MARKET.map((item) => <tr key={item.id}><th scope="row">{item.label}{item.units === 'count/month' && <small>UK-scaled count</small>}</th>{hasComparison && <td>{number(mean(item.id, comparisonId), item.units)}</td>}<td>{number(mean(item.id), item.units)}</td>{hasComparison && <td>{delta(mean(item.id), mean(item.id, comparisonId), item.units)}</td>}</tr>)}</tbody></table></div>
            <p className="r2-footnote">Months · selected run {coverage(marketCoverage)}{hasComparison && `; baseline ${coverage(baselineCoverage)}`}. No extra smoothing.</p>
          </article>

          <article className="r2-card r2-borrowers" data-guided-target="policy-borrowers">
            <CardHeading index="02 / Access to credit" title="Who is borrowing?" subtitle="Mortgage advances by buyer group · UK / month." help="Average monthly mortgages to first-time buyers, home movers and buy-to-let investors at UK scale. These measure lending activity, not homeownership, and exclude cash purchases." />
            <Legend comparison={hasComparison} />
            {borrowers ? <div role="img" aria-label="Mortgage advances for first-time buyers, home movers and buy-to-let investors. Exact values appear below."><EChart option={borrowers} className="r2-borrower-chart" /></div> : <Empty>No borrower-level advances are recorded.</Empty>}
            <div className="r2-borrower-values">{BORROWERS.map((item) => <div key={item.id}><span>{item.label}</span><strong>{number(mean(item.id), 'count/month')}</strong><small>{hasComparison ? `${delta(mean(item.id), mean(item.id, comparisonId), 'count/month')} vs baseline` : 'advances / month'}</small></div>)}</div>
          </article>

          <article className="r2-card r2-risk">
            <CardHeading index="03 / Lending risk" title="Beyond the averages" subtitle="High-ratio loans, as a share of each borrower group." help="Share of recorded first-time-buyer and home-mover mortgages at or above the displayed loan-to-value (LTV) or loan-to-income (LTI) threshold. Requires mortgage transactions recorded in this window; excludes cash purchases." />
            <div className="r2-tabs" role="group" aria-label="Lending risk measure"><button type="button" aria-pressed={riskMetric === 'ltv'} onClick={() => setRiskMetric('ltv')}>High LTV</button><button type="button" aria-pressed={riskMetric === 'lti'} onClick={() => setRiskMetric('lti')}>High LTI</button></div>
            {lendingLoading ? <Empty>Loading recorded mortgage transactions…</Empty> : lendingError ? <Empty>{lendingError}</Empty> : risk ? <>
              <Legend comparison={hasComparison} /><div role="img" aria-label={`${riskMetric.toUpperCase()} risk shares for first-time buyers and home movers. Exact values appear below.`}><EChart option={risk} className="r2-risk-chart" /></div>
              <div className="r2-risk-values">{(['FTB', 'HM'] as const).map((group) => <div key={group}><span>{group === 'FTB' ? 'First-time buyers' : 'Home movers'}</span><strong>{number(getReport2TailShare(primaryLending, riskMetric, group), '%')}</strong>{hasComparison && <small>Baseline {number(getReport2TailShare(comparisonLending, riskMetric, group), '%')}</small>}</div>)}</div>
            </> : <Empty>{primaryLending?.note ?? 'Loan-level transactions are unavailable. Risk shares cannot be inferred from aggregate averages.'}</Empty>}
            {!lendingLoading && !lendingError && transactionRecordingDisabled && <p className="r2-footnote r2-recording-help"><strong>To enable:</strong> Experiments → Policy scenarios → Technical details → Additional data exports → <strong>Record transactions</strong>. Set <strong>Start recording at month</strong> no later than your analysis window’s start, then start a new run. For comparisons, enable baseline recording too.</p>}
            <p className="r2-footnote">{hasComparison ? `Selected run: ${riskDefinition(primaryLending)}; baseline: ${riskDefinition(comparisonLending)}.` : `${riskDefinition(primaryLending)}.`} Recorded mortgages; cash purchases excluded.{thresholdsDiffer && ' Thresholds differ: these shares use different risk definitions.'}</p>
            <div className="r2-loan-means"><span>Valid recorded owner-occupier loans</span><div>{(['ltv', 'lti'] as const).map((metric) => <span key={metric}>Mean {metric.toUpperCase()} <strong>{number(getReport2LoanMean(primaryLending, metric), metric === 'ltv' ? '%' : 'ratio')}</strong>{hasComparison && <small>Baseline {number(getReport2LoanMean(comparisonLending, metric), metric === 'ltv' ? '%' : 'ratio')}</small>}</span>)}</div></div>
            <details className="r2-coverage-details"><summary>Transaction coverage</summary><p>Selected run: {lendingCoverage(primaryLending)}</p>{hasComparison && <p>Baseline: {lendingCoverage(comparisonLending)}</p>}<p>Shares and means pool recorded loans across available seed files.</p></details>
          </article>

          <article className="r2-card r2-rental" data-guided-target="policy-rental">
            <CardHeading index="04 / Beyond the mortgage market" title="Renting & ownership" subtitle="Household shares in the selected run and rental-market comparisons." help="The chart shows household groups in the selected run. Active buy-to-let investors and households in social housing are counted under Other. Differences against the baseline use unrounded averages. Rent alone does not measure affordability." />
            <div className="r2-rental-body">
              <div className="r2-tenure">
                {tenure ? <div role="img" aria-label={`Selected run: ${number(ownership, '%')} owner-occupiers and ${number(rentingShare, '%')} private renters. Remaining households shown separately.`}><EChart option={tenure} className="r2-tenure-chart" /></div> : <Empty>Tenure shares are not available.</Empty>}
                <div className="r2-tenure-labels"><span><i className="r2-dot r2-policy" />Owner-occupiers <strong>{number(ownership, '%')}</strong></span><span><i className="r2-dot r2-baseline" />Private renters <strong>{number(rentingShare, '%')}</strong></span><span><i className="r2-dot r2-other" />Other households</span></div>
              </div>
              <div className="r2-rental-metrics">{[
                { label: 'Monthly rent', value: mean('output_rentalAvSalePrice'), baseline: mean('output_rentalAvSalePrice', comparisonId), units: 'GBP', note: 'New tenancies' },
                { label: 'Rental yield', value: mean('core_rentalYield'), baseline: mean('core_rentalYield', comparisonId), units: '%', note: 'Rented housing stock' },
                { label: 'Private renter share', value: rentingShare, baseline: baselineRentingShare, units: '%', note: 'All households' }
              ].map((item) => <div key={item.label}><span>{item.label}</span><strong>{number(item.value, item.units)}</strong><small>{hasComparison ? `${delta(item.value, item.baseline, item.units)} vs baseline` : item.note}</small></div>)}</div>
            </div>
            <p className="r2-footnote">Other includes active buy-to-let investors and households in social housing. Rent-to-income, rental transaction counts and investor property holdings are unavailable.</p>
          </article>

          <article className="r2-card r2-stability">
            <CardHeading index="05 / Cyclical variation" title="A steadier market?" subtitle="Temporal standard deviation of recorded growth rates." help="Variation across months in quarterly house-price growth and twelve-month credit growth, measured in percentage points. Lower values indicate steadier average paths; these are not uncertainty intervals across simulation seeds." />
            <div className="r2-stability-values"><div><span>House-price growth</span><strong>{number(priceVolatility, 'percentage points')}</strong><small>{hasComparison ? `Baseline ${number(baselinePriceVolatility, 'percentage points')}` : 'Quarter-on-quarter growth'}</small></div><div><span>Credit growth</span><strong>{number(creditVolatility, 'percentage points')}</strong><small>{hasComparison ? `Baseline ${number(baselineCreditVolatility, 'percentage points')}` : 'Twelve-month growth'}</small></div></div>
            <p className="r2-footnote">Variation across months after averaging available seeds; this describes the average path, not uncertainty across simulations.</p>
          </article>

        </div>
      </div>

      <footer className="r2-method"><p><strong>Reading this report.</strong> Means cover each run’s available months in the selected window; counts use UK scale. Monthly series average available seeds before averaging over time. Core indicators retain the model’s recorded rolling averages. These descriptive comparisons do not establish immediate policy impacts or rank welfare.</p><p>{seedsNote && 'Some seed coverage lacks confirmation from a run manifest. '}No uncertainty interval across seeds is shown. {hasComparison && 'Model version, other settings, seeds and recorded windows may also affect comparisons. '}<Link to={detailedUrl}>Explore the detailed results →</Link></p></footer>
    </>}
  </section>;
}
