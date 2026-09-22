import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { getInstanceByDom } from 'echarts';
import type { SensitivityExperimentChartsPayload, SensitivityExperimentMetadata, SensitivityExperimentResultsPayload, SensitivityExperimentSummary } from '../../../shared/types';
import { BASE_POLICY_OPTIONS } from '../../../shared/policyCatalogue';
import { EChart } from '../../components/EChart';
import { ReportInfo } from '../../components/ReportInfo';
import { fetchSensitivityExperiment, fetchSensitivityExperimentCharts, fetchSensitivityExperimentResults, fetchSensitivityExperiments } from '../../lib/api';
import { formatModelOptionLabel } from '../../lib/modelAnchors';
import { readSensitivityReportState, sensitivityDetailedSelection, updateReportQuery } from '../../lib/reportUrlState';
import type { ReportExecutionState } from '../../lib/resultsQueue';
import {
  buildSensitivityReport2, chooseReport2Setting, formatReport2ConstraintWarning,
  formatReport2Value, formatReport2Difference, formatReport2Pairing, formatReport2Number,
  REPORT2_SUMMARY_KEYS, REPORT2_BORROWER_KEYS, REPORT2_CYCLE_KEYS,
  type Report2Outcome, type Report2Metric
} from './sensitivityReport2Model';
import { buildSensitivityReport2Response, buildSensitivityReport2Comparison } from './sensitivityReport2Charts';
import './sensitivity-report2.css';

interface LoadedReport {
  experimentId: string;
  detail: SensitivityExperimentMetadata;
  results: SensitivityExperimentResultsPayload;
  windowType: SensitivityExperimentChartsPayload['windowType'] | null;
  windowError: string;
}

function name(experiment: SensitivityExperimentSummary): string {
  return experiment.title?.trim() || experiment.experimentId;
}

function Heading({ index, title, info, children }: { index: string; title: string; info: string; children: ReactNode }) {
  return <header className="sr2-card-heading"><p className="sr2-eyebrow">{index}</p><div className="sr2-heading-line"><h2>{title}</h2><ReportInfo label={title}>{info}</ReportInfo></div><p className="sr2-caption">{children}</p></header>;
}

function Delta({ metric, outcome }: { metric: Report2Metric | undefined; outcome: Report2Outcome }) {
  return <>{formatReport2Difference(metric?.change ?? null, outcome)}{metric?.relativeChange != null && <span className="sr2-relative"> ({metric.relativeChange > 0 ? '+' : ''}{formatReport2Number(metric.relativeChange)}%)</span>}</>;
}

/** The default sensitivity report for a saved one-instrument sweep. */
export function SensitivityReport2Page({ presentationControls, queueControls, execution }: { presentationControls: ReactNode; queueControls?: ReactNode; execution?: ReportExecutionState }) {
  const [workspaceTitle, setWorkspaceTitle] = useState<HTMLElement | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const experimentId = searchParams.get('experimentId')?.trim() || execution?.selectedJob?.id || '';
  const reportBlocked = execution?.blocked ?? false;
  const isSensitivityGuide = searchParams.get('demo') === 'sensitivity-results';
  const [savedExperiments, setExperiments] = useState<SensitivityExperimentSummary[]>([]);
  const experiments = savedExperiments.filter((experiment) => !execution?.removedIds.includes(experiment.experimentId));
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [loaded, setLoaded] = useState<LoadedReport | null>(null);
  const [loadingId, setLoadingId] = useState('');
  const [failure, setFailure] = useState<{ experimentId: string; message: string } | null>(null);
  const [retry, setRetry] = useState(0);
  // Payload identity is checked during render as well as canceling effects: an old experiment
  // never flashes while the next request is pending, including back/forward and direct links.
  const data = !reportBlocked && loaded?.experimentId === experimentId ? loaded : null;
  const error = !reportBlocked && failure?.experimentId === experimentId ? failure.message : '';
  const loading = !reportBlocked && Boolean(experimentId && !error && (!data || loadingId === experimentId));

  useEffect(() => {
    const heading = document.getElementById('workspace-page-title');
    if (!heading) return;
    const titleHost = document.createElement('span');
    titleHost.className = 'sr2-workspace-title';
    heading.append(titleHost);
    setWorkspaceTitle(titleHost);
    return () => titleHost.remove();
  }, []);

  useEffect(() => {
    // Printing changes the available page width synchronously. EChart's normal resize
    // observer runs on an animation frame, which can be too late for the print snapshot.
    const resizeCharts = () => document.querySelectorAll<HTMLElement>('.sensitivity-report2 .sr2-chart')
      .forEach((element) => getInstanceByDom(element)?.resize());
    const printMedia = window.matchMedia('print');
    window.addEventListener('beforeprint', resizeCharts);
    window.addEventListener('afterprint', resizeCharts);
    printMedia.addEventListener('change', resizeCharts);
    return () => {
      window.removeEventListener('beforeprint', resizeCharts);
      window.removeEventListener('afterprint', resizeCharts);
      printMedia.removeEventListener('change', resizeCharts);
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    setListLoading(true); setListError('');
    void fetchSensitivityExperiments().then((payload) => {
      if (!canceled) setExperiments([...payload.experiments].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.experimentId.localeCompare(b.experimentId)));
    }).catch((reason: unknown) => {
      if (!canceled) setListError(reason instanceof Error ? reason.message : 'Unable to load the experiment list.');
    }).finally(() => { if (!canceled) setListLoading(false); });
    return () => { canceled = true; };
  }, [retry, execution?.revision]);

  useEffect(() => {
    if (reportBlocked) return;
    if (isSensitivityGuide || experimentId || listLoading || experiments.length === 0) return;
    const first = experiments.find((item) => item.status === 'succeeded') ?? experiments[0];
    setSearchParams((current) => {
      if (current.get('experimentId')) return current;
      const next = new URLSearchParams(current);
      next.set('experimentId', first.experimentId);
      return next;
    }, { replace: true });
  }, [reportBlocked, isSensitivityGuide, experimentId, experiments, listLoading, setSearchParams]);

  useEffect(() => {
    let canceled = false;
    setFailure(null); setLoaded(null);
    if (reportBlocked || !experimentId) { setLoadingId(''); return; }
    setLoadingId(experimentId);
    void Promise.allSettled([
      fetchSensitivityExperiment(experimentId),
      fetchSensitivityExperimentResults(experimentId),
      fetchSensitivityExperimentCharts(experimentId)
    ]).then(([detail, results, charts]) => {
      if (canceled) return;
      if (detail.status === 'rejected' || results.status === 'rejected') {
        const reason: unknown = detail.status === 'rejected' ? detail.reason : results.status === 'rejected' ? results.reason : null;
        setFailure({ experimentId, message: reason instanceof Error ? reason.message : 'Unable to load saved sensitivity results.' });
      } else if (detail.value.experiment.experimentId !== experimentId || results.value.experimentId !== experimentId) {
        setFailure({ experimentId, message: 'The returned experiment does not match the selected experiment. Please retry.' });
      } else {
        const validCharts = charts.status === 'fulfilled' && charts.value.experimentId === experimentId;
        setLoaded({ experimentId, detail: detail.value.experiment, results: results.value,
          windowType: validCharts ? charts.value.windowType : null,
          windowError: validCharts ? '' : 'The recorded analysis window could not be loaded. Saved outcomes are shown; retry to restore the window label.' });
      }
      setLoadingId('');
    });
    return () => { canceled = true; };
  }, [reportBlocked, experimentId, retry]);

  const model = useMemo(() => data ? buildSensitivityReport2(data.detail, data.results, data.windowType) : null, [data]);
  const reportState = model ? readSensitivityReportState(searchParams, model) : null;
  const selected = model ? chooseReport2Setting(model, reportState?.settingId ?? undefined) : null;
  const outcome = model?.outcomes.find((item) => item.key === reportState?.outcomeKey);
  const response = useMemo(() => model && outcome ? buildSensitivityReport2Response(model, outcome.key, selected?.point.pointId ?? '') : null, [model, outcome, selected]);
  const borrowers = useMemo(() => model ? buildSensitivityReport2Comparison(model, 'borrowers', selected?.point.pointId ?? '') : null, [model, selected]);
  const cycles = useMemo(() => model ? buildSensitivityReport2Comparison(model, 'cycles', selected?.point.pointId ?? '') : null, [model, selected]);
  const incompleteOutcomeCount = model && outcome ? model.rows.filter((row) => !row.metrics[outcome.key]?.eligible).length : 0;
  const constraintWarnings = model?.warnings.filter((warning) => /non_binding|bank.*cap/i.test(`${warning.code} ${warning.message}`)) ?? [];
  const update = (updates: Record<string, string>) => setSearchParams((current) => updateReportQuery(current, updates), { replace: true });
  const choosePoint = (pointId: string) => update({ setting: pointId });
  const chartClick = (params: unknown) => {
    const pointId = (params as { data?: { pointId?: unknown } })?.data?.pointId;
    if (typeof pointId === 'string' && model?.rows.some((row) => row.point.pointId === pointId)) choosePoint(pointId);
  };
  const detailedParams = updateReportQuery(searchParams, { presentation: 'detailed', ...sensitivityDetailedSelection(searchParams) });
  const selectedMetric = outcome && selected?.metrics[outcome.key];
  const tested = model?.numericRows ?? [];
  const basePolicy = data ? BASE_POLICY_OPTIONS.find((item) => item.id === data.detail.basePolicy)?.title : null;
  const selectedExperiment = data?.detail ?? experiments.find((item) => item.experimentId === experimentId);
  const selectedExperimentName = selectedExperiment ? name(selectedExperiment) : execution?.selectedJob?.title || experimentId || 'Select a sensitivity analysis';

  function valuesTable(keys: readonly string[]) {
    if (!model || !selected) return null;
    return <div className="sr2-table-wrap"><table className="sr2-table"><thead><tr><th scope="col">Outcome</th><th scope="col">Baseline<span className="sr2-table-setting">({model.baselineRow?.setting ?? 'Not recorded'})</span></th><th scope="col">Selected<span className="sr2-table-setting">({selected.setting})</span></th><th scope="col">Change</th></tr></thead><tbody>{keys.map((key) => {
      const item = model.outcomes.find((candidate) => candidate.key === key);
      if (!item) return null;
      const metric = selected.metrics[key];
      const baselineMetric = model.baselineRow?.metrics[key];
      return <tr key={key}><th scope="row">{item.title}{!metric?.eligible && <small>Selected: {selected.coverage.state} · {metric?.finiteSeeds ?? '?'} / {selected.coverage.expected ?? '?'} valid seed values</small>}{!baselineMetric?.eligible && <small>Baseline: {model.baselineRow?.coverage.state ?? 'missing'} · {baselineMetric?.finiteSeeds ?? '?'} / {model.baselineRow?.coverage.expected ?? '?'} valid seed values</small>}</th><td>{formatReport2Value(metric?.baselineValue ?? null, item)}</td><td>{formatReport2Value(metric?.value ?? null, item)}</td><td><Delta metric={metric} outcome={item} /></td></tr>;
    })}</tbody></table></div>;
  }

  return <section className="sensitivity-report2" aria-labelledby="sr2-title">
    {workspaceTitle && createPortal(<><span aria-hidden="true"> / </span>Sensitivity analysis<span aria-hidden="true"> / </span>Report</>, workspaceTitle)}
    {queueControls}
    <div className="sr2-toolbar">
      <label className="sr2-experiment"><span>Select run to view</span><select aria-label="Sensitivity experiment" value={experimentId} disabled={listLoading && experiments.length === 0} onChange={(event) => {
        update({ experimentId: event.target.value, jobRef: '', setting: '' });
      }}>
        {!experimentId && <option value="">{listLoading ? 'Loading experiments…' : 'Select an experiment'}</option>}
        {experimentId && !experiments.some((item) => item.experimentId === experimentId) && <option value={experimentId}>{selectedExperimentName}</option>}
        {experiments.map((item) => <option key={item.experimentId} value={item.experimentId}>{name(item)} — {item.parameter.title}</option>)}
      </select></label>
      {presentationControls}
    </div>
    <header className="sr2-page-heading"><div><p className="sr2-eyebrow">Results / Sensitivity analysis</p><h1 id="sr2-title">{selectedExperimentName}</h1><p className="sr2-caption">Policy responses, borrowing and growth variability.</p></div>
      <div className="sr2-actions"><button type="button" onClick={() => window.print()} disabled={!model}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7zM17 11h.01" /></svg><span>Print</span></button></div>
    </header>

    {listError && <div className="sr2-notice" role="alert">Experiment list could not be loaded: {listError} <button onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    {error && <div className="sr2-notice" role="alert"><strong>Could not load this experiment.</strong><p>{error}</p><button onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    {loading && <p className="sr2-loading" role="status">Loading saved sensitivity results…</p>}
    {!reportBlocked && !experimentId && !listLoading && !listError && <p className="sr2-empty">No saved sensitivity experiments are available.</p>}
    {model && data && !loading && <>
      {data.windowError && <div className="sr2-notice" role="alert">{data.windowError} <button onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
      <div className="sr2-dashboard">
      <section className="sr2-context" aria-label="Experiment context" data-guided-target="sensitivity-context">
        <div className="sr2-instrument"><div className="sr2-context-label"><p className="sr2-eyebrow">{(data.detail.parameter.parameterKeys?.length ?? 1) > 1 ? 'Linked policy package' : 'Policy instrument'}</p><ReportInfo label="the policy instrument">This sweep varies one instrument or linked package; other settings stay fixed. Linked parameters change together.</ReportInfo></div><h2>{data.detail.parameter.title}</h2><p className="sr2-caption">{data.detail.parameter.description}</p></div>
        <div><div className="sr2-context-label"><p className="sr2-eyebrow">Simulated baseline</p><ReportInfo label="the simulated baseline">The reference setting simulated in this experiment. Changes compare saved outcomes over the same recorded analysis window.</ReportInfo></div><strong>{model.baselineRow?.setting ?? 'Baseline settings not recorded'}</strong><p className="sr2-caption">{basePolicy ?? 'Base policy not recorded'}</p><p className="sr2-caption">{model.baselineRow?.coverage.label ?? 'Baseline result missing'}</p></div>
        <div><div className="sr2-context-label"><p className="sr2-eyebrow">Tested settings</p><ReportInfo label="the tested settings">Actual policy values tested. Rounding, removing duplicates and adding the baseline can change the count from that requested.</ReportInfo></div><strong>{tested.length ? `${tested[0].setting}${tested.length > 1 ? `–${tested[tested.length - 1].setting}` : ''}` : 'No non-baseline scalar settings'}</strong><p className="sr2-caption">{model.numericRows.length} unique numeric settings · {model.rows.length} configurations including baseline</p><p className="sr2-caption">{data.detail.parameter.sampleCount} requested sweep samples</p></div>
        <div><div className="sr2-context-label"><p className="sr2-eyebrow">Model & coverage</p><ReportInfo label="the model and seed coverage">Model version and completion of simulations with different seeds. Successful runs can still lack outcome values; incomplete or unverified coverage limits comparisons.</ReportInfo></div><strong>{formatModelOptionLabel(data.detail.baseline)}</strong><p className="sr2-caption">{model.rows.some((row) => row.coverage.successful === null) ? 'Seed coverage not fully retained' : `${model.successfulSeeds} / ${model.expectedSeeds ?? '?'} planned seed runs succeeded`}</p><p className="sr2-caption">{model.complete ? 'Complete seed coverage' : `Coverage needs qualification · ${data.detail.status}`}</p></div>
      </section>
      <div className="sr2-grid">
        <article className="sr2-card sr2-response" data-guided-target="sensitivity-response">
          <Heading index="01 / Across tested settings" title="How does the response change?" info="Each point averages available finite seed summaries at a tested setting. The horizontal axis shows policy value, not time; lines do not establish untested responses.">One outcome across tested policy settings. Select a point to compare outcomes.</Heading>
          <label className="sr2-outcome" data-guided-target="sensitivity-outcome"><span>Outcome</span><select aria-label="Response outcome" value={outcome?.key ?? ''} onChange={(event) => update({ outcome: event.target.value })}>{model.outcomes.map((item) => <option key={item.key} value={item.key}>{item.title}</option>)}</select></label>
          <div className="sr2-legend"><span><i />Complete setting</span><span><i className="sr2-baseline-dot" />Baseline reference</span>{model.rows.some((row) => !row.coverage.state.match(/complete|missing/)) && <span><i className="sr2-partial-dot" />Qualified coverage</span>}</div>
          {response ? <div role="group" aria-label={`${outcome?.title} across actual tested policy values`}><EChart className="sr2-chart sr2-response-chart" option={response} onClick={chartClick} /></div> : <p className="sr2-empty">No finite responses were retained for this outcome.</p>}
          <p className="sr2-footnote">Straight segments join complete neighbouring observations; gaps remain gaps. They do not locate thresholds or establish behaviour between settings.</p>
          {model.baselineRow?.x === null && <p className="sr2-footnote">The linked baseline’s component values differ, so it has no single horizontal position. A reference line shows its outcome.</p>}
          {incompleteOutcomeCount > 0 && <aside className="sr2-response-notice" aria-label="Outcome coverage">
            <p><strong>Incomplete outcome coverage.</strong> {incompleteOutcomeCount} of {model.rows.length} settings have incomplete or unverified values for {outcome?.title}. Check Methods & coverage for seed counts.</p>
          </aside>}
          {constraintWarnings.length > 0 && <aside className="sr2-response-notice" aria-label="Recorded policy constraints">
            <p><strong>Bank limits may constrain the response.</strong></p>
            {constraintWarnings.map((warning) => <p key={warning.code}>{formatReport2ConstraintWarning(warning)}{warning.settings.length > 0 && <> Affected settings: {warning.settings.join(', ')}.</>}</p>)}
          </aside>}
        </article>

        <article className="sr2-card sr2-selected" data-guided-target="sensitivity-selected">
          <Heading index="02 / One shared comparison" title="At the selected setting" info="Compare outcomes at one setting with this experiment’s baseline. Differences retain their sign; higher or lower does not automatically mean better.">All comparisons use this setting and this experiment’s baseline.</Heading>
          <label className="sr2-setting" data-guided-target="sensitivity-setting"><span>Selected setting</span><select aria-label="Selected sensitivity setting" value={selected?.point.pointId ?? ''} onChange={(event) => choosePoint(event.target.value)}>{model.rows.map((row) => <option key={row.point.pointId} value={row.point.pointId}>{row.setting}{row.point.isBaseline ? ' · baseline' : ''} · {row.coverage.state}</option>)}</select></label>
          <p className="sr2-footnote">{reportState?.hasExplicitSetting ? 'Selected for inspection.' : 'Initial selection: lowest tested non-baseline setting.'} {selected?.coverage.label}</p>
          {valuesTable(REPORT2_SUMMARY_KEYS)}
          <div className="sr2-pairing" data-guided-target="sensitivity-pairing"><div className="sr2-context-label"><p className="sr2-eyebrow">Seed consistency · {outcome?.title}</p><ReportInfo label="seed consistency">Setting and baseline results are matched by seed ID. Direction counts and the min–max range describe variation across valid pairs, not significance or confidence intervals.</ReportInfo></div><strong>{selected?.point.isBaseline ? 'Baseline selected — choose another setting to compare.' : selectedMetric ? formatReport2Pairing(selectedMetric) : 'No paired seed values available.'}</strong>
            {!selected?.point.isBaseline && selectedMetric?.paired && selectedMetric.paired.total > 1 && outcome && <p className="sr2-caption">Paired differences: {formatReport2Difference(selectedMetric.paired.min, outcome)} to {formatReport2Difference(selectedMetric.paired.max, outcome)} (min–max).</p>}
            {!selected?.point.isBaseline && <p className="sr2-caption">{selectedMetric?.paired?.total ?? 0} valid pairs / {selected?.coverage.expected ?? 'unknown'} planned seeds. {model.baselineRow?.metrics[outcome?.key ?? '']?.eligible ? '' : 'Baseline outcome coverage is incomplete or unverified.'}</p>}
            <p className="sr2-caption">Differences match seed IDs. Descriptive simulation variation; no significance test or confidence interval.</p>
          </div>
        </article>

      </div>
      <div className="sr2-lower-grid">
        <article className="sr2-card sr2-borrowers"><Heading index="03 / Borrower lending activity" title="Who is borrowing?" info="Monthly mortgages to first-time buyers, home movers and buy-to-let investors at UK scale. These are lending counts, not household shares; cash purchases are excluded.">Mortgage advances by buyer group · UK / month.</Heading>
          <div className="sr2-legend"><span><i />Selected setting</span><span><i className="sr2-baseline-dot" />Baseline</span></div>
          <div className="sr2-comparison-content">
            {borrowers ? <EChart className="sr2-chart sr2-comparison-chart" option={borrowers} /> : <p className="sr2-empty">Borrower advances are unavailable for this comparison.</p>}
            {valuesTable(REPORT2_BORROWER_KEYS)}
          </div>
          <p className="sr2-footnote">Mortgage advances measure lending, not homeownership or all purchases. Compare these changes with leverage above.</p>
        </article>

        <article className="sr2-card sr2-cycles"><Heading index="04 / Variation over time" title="How wide are the growth cycles?" info="Growth’s 95th–5th percentile range over time, calculated per seed, then averaged. Wider ranges mean more variation over time, not more uncertainty across seeds.">Growth P95–P5 over time, calculated per seed, then averaged.</Heading>
          <div className="sr2-legend"><span><i />Selected setting</span><span><i className="sr2-baseline-dot" />Baseline</span></div>
          <div className="sr2-comparison-content">
            {cycles ? <EChart className="sr2-chart sr2-comparison-chart" option={cycles} /> : <p className="sr2-empty">Temporal growth ranges are unavailable for this comparison.</p>}
            {valuesTable(REPORT2_CYCLE_KEYS)}
          </div>
          <p className="sr2-footnote">Ranges are in percentage points (pp). House-price growth is quarter-on-quarter; credit growth is over 12 months. This is variation over time, not across seeds or policy settings.</p>
        </article>

      </div>
      </div>
      <footer className="sr2-method">
        <div className="sr2-method-overview">
          <p><strong>Analysis window:</strong> {data.windowError ? 'Could not load window.' : model.windowLabel}</p>
          <Link to={`/results?${detailedParams}`}>Detailed results →</Link>
        </div>
        <details className="sr2-coverage"><summary>Methods & coverage</summary>
          <p><strong>Reading this report.</strong> Values average available finite per-seed summaries over the recorded window. Relative change is 100 × (setting aggregate − baseline aggregate) / baseline aggregate, not the mean of seed percentage changes. Signed differences use native units; pp means percentage points. Missing values stay unavailable; percentage comparisons are suppressed for unstable or non-positive baselines.</p>
          <p>Coverage distinguishes partial, failed, canceled and legacy results. This sweep varies one instrument or linked package; it does not rank different instruments or establish a preferred policy.</p>
          <div className="sr2-table-wrap"><table className="sr2-table"><thead><tr><th>Setting</th><th>Coverage</th><th>Valid values for selected outcome</th></tr></thead><tbody>{model.rows.map((row) => <tr key={row.point.pointId}><th>{row.setting}{row.point.isBaseline ? ' · baseline' : ''}</th><td>{row.coverage.label}</td><td>{row.metrics[outcome?.key ?? '']?.finiteSeeds ?? 'Unknown'} / {row.coverage.expected ?? '?'}</td></tr>)}</tbody></table></div>
          {model.warnings.length > 0 && <div className="sr2-warnings"><strong>Recorded configuration warnings</strong>{model.warnings.map((warning) => <p key={warning.code}><b>{warning.settings.join('; ') || 'Experiment'}:</b> {warning.messages.length ? warning.messages.join(' ') : warning.message}</p>)}</div>}
          <p>Only core-indicator summaries were saved. Monthly histories, alternative windows, transaction lending tails, rent levels, homeownership and renter composition cannot be reconstructed. Owner-occupier LTV and LTI are means above the median; owner-occupier mortgage debt to income uses the whole household sector’s income as denominator. Rental yield does not measure rent affordability.</p>
          <p>“After first 200 valid observations” refers to the parser’s retained series, not a verified model-month boundary. Legacy windows keep their recorded meaning.</p>
        </details>
      </footer>
    </>}
  </section>;
}
