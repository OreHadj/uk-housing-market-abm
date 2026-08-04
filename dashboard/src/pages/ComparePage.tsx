import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { CalibrationModelOverview, CalibrationOverviewResponse, CompareResponse, ParameterCardMeta, ParameterGroup } from '../../shared/types';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { CompareCard } from '../components/CompareCard';
import { LoadingSkeletonGroup } from '../components/LoadingSkeleton';
import { API_RETRY_DELAY_MS, fetchCalibrationOverview, fetchCatalog, fetchCompare, fetchVersions, isRetryableApiError } from '../lib/api';
import { buildModelOptions, formatModelName, formatModelSubtitle, getDefaultModelVersion } from '../lib/modelAnchors';
import { readScenarioDraft, updateScenarioDraftModel } from '../lib/scenarioDraft';

type ViewMode = 'single' | 'compare';
const FITTED_IDS = new Set(['rent_purchase_choice', 'btl_probability_multiplier', 'btl_choice_intensity', 'market_average_price_decay']);
const PRESETS = [
  ['Behavioural refit on 2011 model', 'v0', 'v0o7'],
  ['Updated empirical inputs', 'v0', 'v4.26'],
  ['Behavioural refit on 2024 model', 'v4.26', 'v5o3'],
  ['Full historical update', 'v0', 'v5o3']
] as const;

function fmt(value: number | null): string {
  if (value === null) return 'Not recorded';
  return new Intl.NumberFormat('en-GB', { maximumSignificantDigits: 6 }).format(value);
}

function scalarSummary(item: CompareResponse['items'][number], mode: ViewMode): string {
  const payload = item.visualPayload;
  if (payload.type === 'joint_distribution') {
    return item.id === 'income_given_age_joint'
      ? 'Age-by-income probability distribution'
      : 'Income-by-wealth probability distribution';
  }
  if (payload.type !== 'scalar') return payload.type.replaceAll('_', ' ');
  return payload.values.map((entry) => mode === 'single' ? `${entry.key}: ${fmt(entry.right)}` : `${entry.key}: ${fmt(entry.left)} → ${fmt(entry.right)}`).join(' · ');
}

function sourceSummary(item: CompareResponse['items'][number], mode: ViewMode): string {
  const sources = mode === 'single' ? item.sourceInfo.datasetsRight : [...item.sourceInfo.datasetsLeft, ...item.sourceInfo.datasetsRight];
  return [...new Set(sources.map((source) => `${source.fullName} (${source.year})`))].join(' · ') || 'Not recorded';
}

function inspectionLabel(item: CompareResponse['items'][number]): string {
  if (item.visualPayload.type === 'joint_distribution') return 'View heatmap';
  if (item.visualPayload.type === 'binned_distribution') return 'View distribution';
  return 'View chart';
}

function derivationDescription(derivation: ParameterCardMeta['keyMetadata'][number]['derivation']): string {
  switch (derivation) {
    case 'empirically estimated': return 'Calculated from observed survey or administrative data.';
    case 'postulated': return 'Specified as a modelling assumption rather than directly measured.';
    case 'policy-set': return 'Set from a documented policy rule or policy setting.';
    case 'technical/user-set': return 'Chosen to control the model or simulation setup.';
    case 'output-calibrated': return 'Fitted by matching simulated outcomes to evidence.';
  }
}

function ModelFacts({ model }: { model: CalibrationModelOverview }) {
  return <div className="calibration-model-facts">
    <h3>{model.identity.name} <span>{model.identity.version}</span></h3>
    <dl>
      <div><dt>Data vintage</dt><dd>{model.identity.dataVintage}</dd></div>
      <div><dt>Fit vintage</dt><dd>{model.identity.fitVintage}</dd></div>
      <div><dt>Method</dt><dd>{model.identity.method}</dd></div>
    </dl>
    {model.identity.inheritance && <p>{model.identity.inheritance}</p>}
  </div>;
}

function FittedParameterCard({
  parameter,
  compared,
  primaryVersion,
  comparisonVersion,
  mode
}: {
  parameter: CalibrationModelOverview['parameters'][number];
  compared: CalibrationModelOverview['parameters'][number] | undefined;
  primaryVersion: string;
  comparisonVersion: string | undefined;
  mode: ViewMode;
}) {
  const changed = compared ? compared.value !== parameter.value : false;
  const testedRange = parameter.lower === null || parameter.upper === null
    ? 'Not recorded'
    : `${fmt(parameter.lower)}–${fmt(parameter.upper)}`;

  return <article className="calibration-parameter-row">
    <div className="parameter-row-head">
      <div><h3>{parameter.name}</h3><code>{parameter.key}</code></div>
    </div>
    <div className="parameter-number-grid">
      {mode === 'compare' && compared && comparisonVersion &&
        <div><span>{comparisonVersion} value</span><strong>{fmt(compared.value)}</strong></div>}
      <div><span>{mode === 'compare' ? `${primaryVersion} value` : 'Selected value'}</span><strong>{fmt(parameter.value)}</strong></div>
      {mode === 'compare' && compared &&
        <div><span>Absolute difference</span><strong>{fmt(parameter.value - compared.value)}</strong><small className={changed ? 'changed' : 'unchanged'}>{changed ? 'Changed' : 'Unchanged'}</small></div>}
      <div><span>Range tested</span><strong>{testedRange}</strong></div>
    </div>
    <div className="parameter-explanation-grid">
      <p><b>Behavioural meaning</b>{parameter.meaning}</p>
      <p><b>Why calibrate it</b>{parameter.calibrationReason}</p>
      <p><b>If increased</b>{parameter.increaseEffect}</p>
      <p><b>If decreased</b>{parameter.decreaseEffect}</p>
    </div>
  </article>;
}

export function ComparePage() {
  const [params, setParams] = useSearchParams();
  const [versions, setVersions] = useState<string[]>([]);
  const [inProgress, setInProgress] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<ParameterCardMeta[]>([]);
  const [mode, setMode] = useState<ViewMode>('single');
  const [selected, setSelected] = useState('');
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [overview, setOverview] = useState<CalibrationOverviewResponse | null>(null);
  const [comparison, setComparison] = useState<CompareResponse | null>(null);
  const [inspectionItem, setInspectionItem] = useState<CompareResponse['items'][number] | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const scenarioDraftId = params.get('from') === 'scenario' ? params.get('draft')?.trim() ?? '' : '';
  const hasScenarioContext = Boolean(scenarioDraftId && readScenarioDraft(scenarioDraftId));
  const returnVersion = mode === 'single' ? selected : right;

  useEffect(() => {
    if (!inspectionItem) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInspectionItem(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [inspectionItem]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchVersions(), fetchCatalog()]).then(([versionPayload, catalogue]) => {
      if (cancelled) return;
      const available = versionPayload.versions;
      const initialMode: ViewMode = params.get('mode') === 'compare' ? 'compare' : 'single';
      const defaultVersion = getDefaultModelVersion(available, versionPayload.inProgressVersions);
      const requested = params.get('version') ?? '';
      setVersions(available); setInProgress(versionPayload.inProgressVersions); setCatalog(catalogue);
      setMode(initialMode);
      setSelected(available.includes(requested) ? requested : defaultVersion);
      setLeft(available.includes(params.get('left') ?? '') ? params.get('left')! : (available.includes('v0') ? 'v0' : available[0] ?? ''));
      setRight(available.includes(params.get('right') ?? '') ? params.get('right')! : defaultVersion);
    }).catch((reason) => { setError((reason as Error).message); setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selected || (mode === 'compare' && (!left || !right)) || catalog.length === 0) return;
    const next = new URLSearchParams(params);
    next.set('mode', mode);
    if (mode === 'single') { next.set('version', selected); next.delete('left'); next.delete('right'); }
    else { next.set('left', left); next.set('right', right); next.delete('version'); }
    if (next.toString() !== params.toString()) setParams(next, { replace: true });

    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      setLoading(true); setWaiting(false); setError('');
      const primary = mode === 'single' ? selected : right;
      const other = mode === 'compare' ? left : undefined;
      try {
        const [overviewPayload, comparePayload] = await Promise.all([
          fetchCalibrationOverview(primary, other),
          fetchCompare(mode === 'single' ? selected : left, primary, catalog.map((item) => item.id), mode === 'single' ? 'through_right' : 'range')
        ]);
        if (!cancelled) { setOverview(overviewPayload); setComparison(comparePayload); }
      } catch (reason) {
        if (cancelled) return;
        if (isRetryableApiError(reason)) { setWaiting(true); timer = window.setTimeout(() => void load(), API_RETRY_DELAY_MS); }
        else setError((reason as Error).message);
      } finally { if (!cancelled) setLoading(false); }
    };
    void load();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [mode, selected, left, right, catalog]);

  const fittedByKey = useMemo(() => {
    const items = comparison?.items.filter((item) => FITTED_IDS.has(item.id)) ?? [];
    const map = new Map<string, { left: number; right: number }>();
    for (const item of items) if (item.visualPayload.type === 'scalar') for (const value of item.visualPayload.values) map.set(value.key, value);
    return map;
  }, [comparison]);
  const referenceGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = (comparison?.items ?? []).filter((item) => !FITTED_IDS.has(item.id))
      .filter((item) => !term || [item.title, item.id, ...item.sourceInfo.configKeys].some((value) => value.toLowerCase().includes(term)));
    const grouped = new Map<ParameterGroup, CompareResponse['items']>();
    for (const item of rows) grouped.set(item.group, [...(grouped.get(item.group) ?? []), item]);
    return grouped;
  }, [comparison, mode, search]);
  const optionSet = useMemo(() => new Set(inProgress), [inProgress]);
  const singleOptions = buildModelOptions(versions, selected, optionSet);
  const leftOptions = buildModelOptions(versions, left, optionSet);
  const rightOptions = buildModelOptions(versions, right, optionSet);
  const validationYear = overview?.primary.campaign.evidenceYear ?? 2024;
  const evidenceContext = hasScenarioContext ? `&from=scenario&draft=${encodeURIComponent(scenarioDraftId)}&scenarioStep=model-version` : '';

  return <section className="calibration-layout calibration-workspace">
    {hasScenarioContext && returnVersion && <aside className="evidence-context-banner"><p>You are reviewing calibration evidence for an unfinished policy scenario.</p><div><Link className="secondary-button" to={`/scenarios/new?draft=${encodeURIComponent(scenarioDraftId)}&step=model-version`}>Return without changing model</Link><Link className="primary-button" onClick={() => updateScenarioDraftModel(scenarioDraftId, returnVersion)} to={`/scenarios/new?draft=${encodeURIComponent(scenarioDraftId)}&step=model-version`}>Use {formatModelName(returnVersion)} and return</Link></div></aside>}
    <header className="calibration-page-head"><div><p className="eyebrow">Model evidence</p><h1>Calibration</h1><p>Understand why the model needs fitted behaviour, what was fitted, and which other assumptions it carries.</p></div></header>
    <section className="summary-panel calibration-introduction calibration-description">
      <div>
        <h2>Calibration assumptions</h2>
        <p>
          The model combines inputs measured directly from UK data with behavioural parameters that cannot be
          observed directly. Household demographics and incomes, for example, can be set using published
          statistics, whereas parameters influencing decisions such as whether to rent or buy must be estimated
          through calibration. This page documents the values used in the selected model version and the evidence
          supporting them.
        </p>
      </div>
    </section>
    <div className="calibration-controls results-card" aria-label="Calibration view controls">
      <div><span className="control-label">View</span><div className="mode-switch-row"><button className={`filter-pill ${mode === 'single' ? 'active' : ''}`} onClick={() => setMode('single')}>Single model</button><button className={`filter-pill ${mode === 'compare' ? 'active' : ''}`} onClick={() => setMode('compare')}>Compare models</button></div></div>
      {mode === 'single' ? <label><span className="control-label">Model</span><select value={selected} onChange={(event) => setSelected(event.target.value)}>{singleOptions.map((option) => <option key={option.version} value={option.version}>{option.label}</option>)}</select><small>{formatModelSubtitle(selected)}</small></label> : <><label><span className="control-label">From model</span><select value={left} onChange={(event) => setLeft(event.target.value)}>{leftOptions.map((option) => <option key={option.version} value={option.version}>{option.label}</option>)}</select></label><label><span className="control-label">To model</span><select value={right} onChange={(event) => setRight(event.target.value)}>{rightOptions.map((option) => <option key={option.version} value={option.version}>{option.label}</option>)}</select></label><label><span className="control-label">Preset comparison</span><select value="" onChange={(event) => { const preset = PRESETS[Number(event.target.value)]; if (preset) { setLeft(preset[1]); setRight(preset[2]); } }}><option value="">Choose a preset…</option>{PRESETS.map((preset, index) => <option value={index} key={preset[0]}>{preset[0]}: {preset[1]} → {preset[2]}</option>)}</select><small>A shortcut that fills the two model selectors for a common analytical question.</small></label></>}
    </div>
    {error && <p className="error-banner">{error}</p>}{waiting && <p className="waiting-banner">Waiting for API to become available. Retrying every 2 seconds…</p>}
    {loading && !overview ? <LoadingSkeletonGroup count={4} ariaLabel="Loading calibration analysis" /> : overview && <div className="calibration-columns">
      <main className="calibration-main">
        <section className="results-card calibration-campaign"><div className="section-heading-row"><div><p className="eyebrow">Calibration campaign</p><h2>Why output calibration is necessary</h2></div><Link className="secondary-button" to={`/validation?version=${encodeURIComponent(overview.primary.identity.version)}&evidenceYear=${validationYear}${evidenceContext}`}>View indicator-level fit</Link></div><p>The five behavioural parameters below describe latent choices and model memory; they cannot be measured directly. Output calibration searches for values whose simulated outcomes collectively reproduce documented evidence.</p>{overview.primary.identity.inheritance && <p className="inheritance-note">{overview.primary.identity.inheritance}</p>}
          <div className="campaign-grid"><div><span>Evidence / fit year</span><strong>{overview.primary.campaign.evidenceYear ?? 'Not recorded'}</strong></div><div><span>Method</span><strong>{overview.primary.campaign.method}</strong></div><div className="wide"><span>Objective</span><strong>{overview.primary.campaign.objective}</strong></div><div><span>Before loss</span><strong>{fmt(overview.primary.campaign.baselineLoss)}</strong></div><div><span>After loss</span><strong>{fmt(overview.primary.campaign.selectedLoss)}</strong></div><div><span>Improvement</span><strong>{fmt(overview.primary.campaign.improvement)}</strong></div><div><span>Promotion</span><strong>{overview.primary.campaign.promotion}</strong></div><div className="wide"><span>Guardrail result</span><strong>{overview.primary.campaign.guardrail}</strong></div></div>
          {overview.primary.campaign.targetGroups.length > 0 ? <div className="target-groups"><h3>Target indicators</h3>{overview.primary.campaign.targetGroups.map((group) => <span key={group.name} title={group.indicators.join(', ')}>{group.name} <b>{group.count}</b></span>)}</div> : <p>Target indicators: <strong>Not recorded</strong></p>}
          {mode === 'compare' && !overview.sameEvidenceProfile && <p className="info-banner">The models use different evidence profiles. Loss values are shown only within each campaign and are not compared across evidence years.</p>}
          <CollapsibleSection title="Technical campaign details" defaultOpen={false} summary="Seeds, run length, bounds and provenance"><dl className="technical-details"><div><dt>Seeds</dt><dd>{overview.primary.campaign.seeds?.join(', ') ?? 'Not recorded'}</dd></div><div><dt>Simulation length</dt><dd>{overview.primary.campaign.simulationSteps ?? 'Not recorded'}</dd></div><div><dt>Analysis window</dt><dd>{overview.primary.campaign.analysisWindow ? `${overview.primary.campaign.analysisWindow.start}–${overview.primary.campaign.analysisWindow.end}` : 'Not recorded'}</dd></div><div><dt>Optimisation</dt><dd>{overview.primary.campaign.optimisationSettings.join(' · ') || 'Not recorded'}</dd></div><div><dt>Provenance</dt><dd>{overview.primary.campaign.provenance.join(' · ') || 'Not recorded'}</dd></div></dl></CollapsibleSection>
        </section>
        <section className="calibration-parameters">
          <div><p className="eyebrow">Output-calibrated</p><h2>Five fitted behavioural parameters</h2></div>
          {overview.primary.parameters.map((parameter) =>
            <FittedParameterCard
              key={parameter.key}
              parameter={parameter}
              compared={overview.comparison?.parameters.find((candidate) => candidate.key === parameter.key)}
              primaryVersion={overview.primary.identity.version}
              comparisonVersion={overview.comparison?.identity.version}
              mode={mode}
            />
          )}
        </section>
        <section className="results-card assumption-reference">
          <div className="section-heading-row"><div><p className="eyebrow">Reference</p><h2>Other model assumptions</h2></div></div>
          <p className="assumption-reference-intro">
            These are the model inputs outside the five fitted behavioural parameters. Each row represents one
            related assumption or input dataset. Use the values to see what the selected model contains
            {mode === 'compare' ? ' and whether it changed between the two models' : ''}. “Basis for assumption” says
            whether it was calculated from observed data, postulated, policy-set, technically set, or output-calibrated.
            Source/evidence records the specific evidence it came from.
          </p>
          <input className="assumption-search" aria-label="Search model assumptions" placeholder="Search assumptions or config keys" value={search} onChange={(event) => setSearch(event.target.value)} />
          {[...referenceGroups.entries()].map(([group, items]) => <section className="assumption-group" key={group as ParameterGroup}><h3>{group} <span>{items.length}</span></h3><div className="assumption-table" role="table"><div className="assumption-table-head" role="row"><span>Assumption and config key</span><span>{mode === 'compare' ? 'Model values and change' : 'Model value'}</span><span>Basis for assumption</span><span>Source / evidence</span></div>{items.map((item) => { const meta = catalog.find((entry) => entry.id === item.id)!; const complex = item.visualPayload.type !== 'scalar'; const derivation = meta.keyMetadata[0]?.derivation; return <div className="assumption-table-row" role="row" key={item.id}><div><strong>{item.title}</strong><code>{meta.configKeys.join(', ')}</code><small>{meta.keyMetadata[0]?.description}</small></div><div>{scalarSummary(item, mode)}{item.visualPayload.type === 'joint_distribution' && <small>The heatmap shows the full distribution; each cell is the share of households in that combination of bands.</small>}{mode === 'compare' && <span className={item.unchanged ? 'unchanged' : 'changed'}>{item.unchanged ? 'Unchanged' : 'Changed'}</span>}{complex && <button type="button" className="secondary-button assumption-inspection-button" aria-haspopup="dialog" onClick={() => setInspectionItem(item)}>{inspectionLabel(item)}</button>}</div><div>{derivation && <><b>{derivation}</b><small>{derivationDescription(derivation)}</small></>}</div><div>{sourceSummary(item, mode)}</div></div>; })}</div></section>)}
          {referenceGroups.size === 0 && <p className="info-banner">No assumptions match the current filters.</p>}
        </section>
      </main>
      <aside className="calibration-sticky-summary results-card"><p className="eyebrow">Selected model{mode === 'compare' ? 's' : ''}</p>{mode === 'compare' && overview.comparison && <ModelFacts model={overview.comparison} />}<ModelFacts model={overview.primary} /><h3>Fitted values</h3>{overview.primary.parameters.map((parameter) => <div className="sticky-value" key={parameter.key}><span>{parameter.name}</span><strong>{mode === 'compare' && fittedByKey.get(parameter.key) ? `${fmt(fittedByKey.get(parameter.key)!.left)} → ` : ''}{fmt(parameter.value)}</strong></div>)}</aside>
    </div>}
    {inspectionItem && <div
      className="scenario-create-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) setInspectionItem(null); }}
    >
      <section className="scenario-create-modal calibration-inspection-modal" role="dialog" aria-modal="true" aria-labelledby="calibration-inspection-title">
        <div className="scenario-create-modal-head">
          <div>
            <p className="trend-modal-eyebrow">Model assumption</p>
            <h2 id="calibration-inspection-title">{inspectionItem.title}</h2>
            <p>{mode === 'compare' ? `${inspectionItem.leftVersion} compared with ${inspectionItem.rightVersion}` : inspectionItem.rightVersion}</p>
          </div>
          <button type="button" className="trend-modal-close" aria-label="Close assumption visualization" autoFocus onClick={() => setInspectionItem(null)}>×</button>
        </div>
        <div className="scenario-create-modal-body">
          <CompareCard item={inspectionItem} mode={mode} inProgressVersions={inProgress} defaultExpanded />
        </div>
      </section>
    </div>}
  </section>;
}
