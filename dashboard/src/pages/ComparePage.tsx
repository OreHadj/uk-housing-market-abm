import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { CalibrationModelOverview, CalibrationOverviewResponse, CompareResponse, DatasetAttribution, ParameterCardMeta, ParameterGroup } from '../../shared/types';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { CompareCard } from '../components/CompareCard';
import { LoadingSkeletonGroup } from '../components/LoadingSkeleton';
import { API_RETRY_DELAY_MS, fetchCalibrationOverview, fetchCatalog, fetchCompare, fetchVersions, isRetryableApiError } from '../lib/api';
import { buildModelOptions, formatModelName, formatModelSubtitle, getDefaultModelVersion } from '../lib/modelAnchors';
import { readScenarioDraft, updateScenarioDraftModel } from '../lib/scenarioDraft';

type ViewMode = 'single' | 'compare';
const FITTED_IDS = new Set(['rent_purchase_choice', 'btl_probability_multiplier', 'btl_choice_intensity', 'market_average_price_decay']);

/**
 * The four model anchors differ on two axes — the era of the input data and the era of the evidence
 * the behavioural parameters were fitted to. These are the pairs that move one axis at a time (plus
 * the cumulative one), so a difference can be attributed to a single cause. Any other pair confounds
 * the two, which is what the advanced selectors are for.
 *
 * `left` must be the earlier version: the compare API lists provenance for the range between the two
 * versions, so a reversed pair reports no changes.
 */
interface ComparisonPreset {
  left: string;
  right: string;
  /** What the pair isolates. Shown under the selector, since the option text carries only identity. */
  question: string;
}

const PRESETS: readonly ComparisonPreset[] = [
  {
    left: 'v0',
    right: 'v0o7',
    question: 'Isolates the behavioural refit. Both models read the same 2011 inputs and target the same 2011 evidence, so only the five fitted parameters differ.'
  },
  {
    left: 'v0',
    right: 'v4.26',
    question: 'Isolates the updated empirical inputs. The behaviour stays fitted to 2011 evidence in both models, so differences come from the 2024 data alone.'
  },
  {
    left: 'v4.26',
    right: 'v5o3',
    question: 'Isolates the behavioural refit on current data. Both models read the same 2024 inputs; only the evidence the parameters were fitted to differs.'
  },
  {
    left: 'v0',
    right: 'v5o3',
    question: 'The cumulative historical update: 2024 inputs and behaviour refitted to 2024 evidence. Differences cannot be attributed to either change on its own.'
  }
];

const CUSTOM_COMPARISON_NOTE =
  'A custom pair. Differences may combine an input-data update and a behavioural refit, so they cannot be attributed to one cause.';

function formatPresetLabel(preset: ComparisonPreset): string {
  return `${formatModelName(preset.left)} (${preset.left}) → ${formatModelName(preset.right)} (${preset.right})`;
}

/**
 * The preset to open when comparison is switched on: one that keeps the model already being read as
 * the primary, so ticking the box adds a baseline rather than changing the subject. Falls back to a
 * preset that starts from it, then to the first available pair.
 */
function defaultPresetFor(version: string, available: readonly string[]): ComparisonPreset | undefined {
  const offered = PRESETS.filter((preset) => available.includes(preset.left) && available.includes(preset.right));
  return offered.find((preset) => preset.right === version)
    ?? offered.find((preset) => preset.left === version)
    ?? offered[0];
}

function fmt(value: number | null): string {
  if (value === null) return 'Not recorded';
  return new Intl.NumberFormat('en-GB', { maximumSignificantDigits: 6 }).format(value);
}

function scalarSummary(item: CompareResponse['items'][number], mode: ViewMode, meta: ParameterCardMeta) {
  const payload = item.visualPayload;
  if (payload.type === 'joint_distribution') {
    return item.id === 'income_given_age_joint'
      ? 'Age-by-income probability distribution'
      : 'Income-by-wealth probability distribution';
  }
  if (payload.type !== 'scalar') return payload.type.replaceAll('_', ' ');
  return <div className="assumption-scalar-values">
    {payload.values.map((entry) => {
      const label = meta.keyMetadata.find((key) => key.key === entry.key)?.label ?? entry.key;
      return <div key={entry.key}>
        <span>{label}</span>
        {mode === 'single'
          ? <strong>{fmt(entry.right)}</strong>
          : <span className="assumption-scalar-comparison"><strong>{fmt(entry.left)}</strong><i aria-hidden="true">→</i><strong>{fmt(entry.right)}</strong></span>}
      </div>;
    })}
  </div>;
}

function sourceBasisFallback(meta: ParameterCardMeta): string {
  if (meta.id === 'hpa_lookback_years') return 'Documented design decision, selected through robustness analysis.';
  if (meta.id === 'downpayment_btl_lognormal') return 'Inherited placeholder copied from the owner-occupier distribution; direct BTL calibration not recorded.';
  if (meta.id === 'downpayment_btl_profile') return 'Legacy BTL parameter; original evidence reference not recorded.';
  const derivation = meta.keyMetadata[0]?.derivation;
  if (derivation === 'policy-set') return 'Documented policy or non-binding model setting; no empirical dataset attached.';
  if (derivation === 'technical/user-set') return 'Documented model-design setting; no empirical dataset attached.';
  if (derivation === 'postulated') return 'Postulated modelling assumption; no empirical dataset attached.';
  if (derivation === 'output-calibrated') return 'Fitted to model output rather than directly measured.';
  return 'Source not recorded for this model version.';
}

function formatDatasetSource(source: DatasetAttribution): string {
  const details = [source.year !== 'Unknown' ? source.year : '', source.edition ?? ''].filter(Boolean);
  return details.length ? `${source.fullName} (${details.join(', ')})` : source.fullName;
}

function sourceForModel(sources: DatasetAttribution[], meta: ParameterCardMeta): string {
  const known = sources.filter((source) => source.fullName !== 'Unknown source');
  if (known.length === 0) return sourceBasisFallback(meta);
  return [...new Set(known.map(formatDatasetSource))].join(' · ');
}

function SourceSummary({ item, mode, meta }: { item: CompareResponse['items'][number]; mode: ViewMode; meta: ParameterCardMeta }) {
  if (mode === 'single') return <span>{sourceForModel(item.sourceInfo.datasetsRight, meta)}</span>;
  return <div className="assumption-model-sources">
    <div><b>{item.leftVersion}</b><span>{sourceForModel(item.sourceInfo.datasetsLeft, meta)}</span></div>
    <div><b>{item.rightVersion}</b><span>{sourceForModel(item.sourceInfo.datasetsRight, meta)}</span></div>
  </div>;
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

/**
 * A page-level section that folds away. `CollapsibleSection` can't be reused here: its title slot is
 * inside the toggle button, which may only hold phrasing content, and these sections need to keep
 * their eyebrow and `h2` so the page keeps its heading outline. The heading wraps the button instead.
 */
function CalibrationSection({
  eyebrow,
  title,
  summary,
  defaultOpen,
  className,
  children
}: {
  eyebrow: string;
  title: string;
  /** Stays visible when collapsed, so the fold never hides what is inside. */
  summary: string;
  defaultOpen: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = useId();

  return <section className={['calibration-collapsible', isOpen ? 'is-open' : 'is-collapsed', className].filter(Boolean).join(' ')}>
    <div className="section-heading-row calibration-collapsible-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>
          <button type="button" aria-expanded={isOpen} aria-controls={contentId} onClick={() => setIsOpen((current) => !current)}>
            <span className="calibration-collapsible-indicator" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
            {title}
          </button>
        </h2>
      </div>
      <span className="calibration-collapsible-summary">{summary}</span>
    </div>
    <div id={contentId} className="calibration-collapsible-body" hidden={!isOpen}>{children}</div>
  </section>;
}

/** How many fitted parameters differ between the two models, or null when only one is selected. */
function countChangedParameters(overview: CalibrationOverviewResponse): number | null {
  const compared = overview.comparison;
  if (!compared) return null;
  return overview.primary.parameters.filter((parameter) => {
    const other = compared.parameters.find((candidate) => candidate.key === parameter.key);
    return other !== undefined && other.value !== parameter.value;
  }).length;
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
  const [customComparison, setCustomComparison] = useState(false);
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
      const requestedLeft = available.includes(params.get('left') ?? '') ? params.get('left')! : (available.includes('v0') ? 'v0' : available[0] ?? '');
      let requestedRight = available.includes(params.get('right') ?? '') ? params.get('right')! : defaultVersion;
      if (requestedRight === requestedLeft) requestedRight = defaultVersion !== requestedLeft
        ? defaultVersion
        : available.find((version) => version !== requestedLeft) ?? requestedRight;
      setLeft(requestedLeft);
      setRight(requestedRight);
      setCustomComparison(initialMode === 'compare' && !PRESETS.some((preset) => preset.left === requestedLeft && preset.right === requestedRight));
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
  // Header counts for the collapsible sections, taken before the search filter so a collapsed
  // section still reports the whole model rather than the current query.
  const referenceItems = useMemo(() => (comparison?.items ?? []).filter((item) => !FITTED_IDS.has(item.id)), [comparison]);
  const optionSet = useMemo(() => new Set(inProgress), [inProgress]);
  const singleOptions = buildModelOptions(versions, selected, optionSet);
  const leftOptions = buildModelOptions(versions, left, optionSet);
  const rightOptions = buildModelOptions(versions, right, optionSet);
  const validationYear = overview?.primary.campaign.evidenceYear ?? 2024;
  const selectedPresetIndex = PRESETS.findIndex((preset) => preset.left === left && preset.right === right);
  const activePreset = (customComparison || selectedPresetIndex < 0) ? undefined : PRESETS[selectedPresetIndex];
  const evidenceContext = hasScenarioContext ? `&from=scenario&draft=${encodeURIComponent(scenarioDraftId)}&scenarioStep=model-version` : '';

  const setComparisonEnabled = (enabled: boolean) => {
    if (!enabled) {
      // Keep reading about the same model: `right` is the primary while comparing.
      if (right) setSelected(right);
      setMode('single');
      return;
    }
    const preset = defaultPresetFor(selected, versions);
    if (preset) {
      setLeft(preset.left);
      setRight(preset.right);
      setCustomComparison(false);
    }
    setMode('compare');
  };

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
      <div className="calibration-controls-row">
        {mode === 'single' ? <label><span className="control-label">Model</span><select value={selected} onChange={(event) => setSelected(event.target.value)}>{singleOptions.map((option) => <option key={option.version} value={option.version}>{option.label}</option>)}</select><small>{formatModelSubtitle(selected)}</small></label> : <div className="calibration-comparison-question">
          <label>
            <span className="control-label">Comparison</span>
            <select value={selectedPresetIndex >= 0 && !customComparison ? String(selectedPresetIndex) : 'custom'} onChange={(event) => {
              if (event.target.value === 'custom') { setCustomComparison(true); return; }
              const preset = PRESETS[Number(event.target.value)];
              if (preset) { setLeft(preset.left); setRight(preset.right); setCustomComparison(false); }
            }}>
              {PRESETS.filter((preset) => versions.includes(preset.left) && versions.includes(preset.right)).map((preset) => {
                const index = PRESETS.indexOf(preset);
                return <option value={index} key={`${preset.left}-${preset.right}`}>{formatPresetLabel(preset)}</option>;
              })}
              <option value="custom">Advanced: choose any two models</option>
            </select>
            <small>{activePreset?.question ?? CUSTOM_COMPARISON_NOTE}</small>
          </label>
          <div className="calibration-selected-pair" aria-live="polite">
            <span>From <strong>{formatModelName(left)} ({left})</strong></span><i aria-hidden="true">→</i><span>To <strong>{formatModelName(right)} ({right})</strong></span>
          </div>
          <details className="calibration-custom-comparison" open={customComparison} onToggle={(event) => setCustomComparison(event.currentTarget.open)}>
            <summary>Advanced custom comparison</summary>
            <p>For configuration audits where a curated analytical comparison does not answer the question. Pick the earlier version as the “From” model: provenance covers the changes between the two, so a reversed pair reports none.</p>
            <div>
              <label><span className="control-label">From model</span><select value={left} onChange={(event) => setLeft(event.target.value)}>{leftOptions.map((option) => <option key={option.version} value={option.version} disabled={option.version === right}>{option.label}</option>)}</select></label>
              <label><span className="control-label">To model</span><select value={right} onChange={(event) => setRight(event.target.value)}>{rightOptions.map((option) => <option key={option.version} value={option.version} disabled={option.version === left}>{option.label}</option>)}</select></label>
            </div>
          </details>
        </div>}
      </div>
      <label className="comparison-enable-toggle">
        <input
          type="checkbox"
          checked={mode === 'compare'}
          disabled={versions.length < 2}
          onChange={(event) => setComparisonEnabled(event.target.checked)}
        />
        <span>Compare with another model</span>
      </label>
    </div>
    {error && <p className="error-banner">{error}</p>}{waiting && <p className="waiting-banner">Waiting for API to become available. Retrying every 2 seconds…</p>}
    {loading && !overview ? <LoadingSkeletonGroup count={4} ariaLabel="Loading calibration analysis" /> : overview && <>
    <div className="calibration-columns">
      <main className="calibration-main">
        <section className="results-card calibration-campaign"><div className="section-heading-row"><div><p className="eyebrow">Calibration campaign</p><h2>Why output calibration is necessary</h2></div><Link className="secondary-button" to={`/validation?version=${encodeURIComponent(overview.primary.identity.version)}&evidenceYear=${validationYear}${evidenceContext}`}>View indicator-level fit</Link></div><p>The five behavioural parameters below describe latent choices and model memory; they cannot be measured directly. Output calibration searches for values whose simulated outcomes collectively reproduce documented evidence.</p>{overview.primary.identity.inheritance && <p className="inheritance-note">{overview.primary.identity.inheritance}</p>}
          <div className="campaign-grid"><div><span>Evidence / fit year</span><strong>{overview.primary.campaign.evidenceYear ?? 'Not recorded'}</strong></div><div><span>Method</span><strong>{overview.primary.campaign.method}</strong></div><div className="wide"><span>Objective</span><strong>{overview.primary.campaign.objective}</strong></div><div><span>Before loss</span><strong>{fmt(overview.primary.campaign.baselineLoss)}</strong></div><div><span>After loss</span><strong>{fmt(overview.primary.campaign.selectedLoss)}</strong></div><div><span>Improvement</span><strong>{fmt(overview.primary.campaign.improvement)}</strong></div><div><span>Promotion</span><strong>{overview.primary.campaign.promotion}</strong></div><div className="wide"><span>Guardrail result</span><strong>{overview.primary.campaign.guardrail}</strong></div></div>
          {overview.primary.campaign.targetGroups.length > 0 ? <div className="target-groups"><h3>Target indicators</h3>{overview.primary.campaign.targetGroups.map((group) => <span key={group.name} title={group.indicators.join(', ')}>{group.name} <b>{group.count}</b></span>)}</div> : <p>Target indicators: <strong>Not recorded</strong></p>}
          {mode === 'compare' && !overview.sameEvidenceProfile && <p className="info-banner">The models use different evidence profiles. Loss values are shown only within each campaign and are not compared across evidence years.</p>}
          <CollapsibleSection title="Technical campaign details" defaultOpen={false} summary="Seeds, run length, bounds and provenance"><dl className="technical-details"><div><dt>Seeds</dt><dd>{overview.primary.campaign.seeds?.join(', ') ?? 'Not recorded'}</dd></div><div><dt>Simulation length</dt><dd>{overview.primary.campaign.simulationSteps ?? 'Not recorded'}</dd></div><div><dt>Analysis window</dt><dd>{overview.primary.campaign.analysisWindow ? `${overview.primary.campaign.analysisWindow.start}–${overview.primary.campaign.analysisWindow.end}` : 'Not recorded'}</dd></div><div><dt>Optimisation</dt><dd>{overview.primary.campaign.optimisationSettings.join(' · ') || 'Not recorded'}</dd></div><div><dt>Provenance</dt><dd>{overview.primary.campaign.provenance.join(' · ') || 'Not recorded'}</dd></div></dl></CollapsibleSection>
        </section>
        <CalibrationSection
          className="calibration-parameters"
          eyebrow="Output-calibrated"
          title="Five fitted behavioural parameters"
          summary={countChangedParameters(overview) === null
            ? `${overview.primary.parameters.length} parameters`
            : `${countChangedParameters(overview)} of ${overview.primary.parameters.length} changed`}
          defaultOpen
        >
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
        </CalibrationSection>
      </main>
      <aside className="calibration-sticky-summary results-card"><p className="eyebrow">Selected model{mode === 'compare' ? 's' : ''}</p>{mode === 'compare' && overview.comparison && <ModelFacts model={overview.comparison} />}<ModelFacts model={overview.primary} /><h3>Fitted values</h3>{overview.primary.parameters.map((parameter) => <div className="sticky-value" key={parameter.key}><span>{parameter.name}</span><strong>{mode === 'compare' && fittedByKey.get(parameter.key) ? `${fmt(fittedByKey.get(parameter.key)!.left)} → ` : ''}{fmt(parameter.value)}</strong></div>)}</aside>
    </div>
    <CalibrationSection
      className="results-card assumption-reference assumption-reference-full"
      eyebrow="Reference"
      title="Other model assumptions"
      summary={mode === 'compare'
        ? `${referenceItems.length} assumptions · ${referenceItems.filter((item) => !item.unchanged).length} changed`
        : `${referenceItems.length} assumptions`}
      defaultOpen={false}
    >
      <p className="assumption-reference-intro">
        These are the model inputs outside the five fitted behavioural parameters. Each row represents one
        related assumption or input dataset. Use the values to see what the selected model contains
        {mode === 'compare' ? ' and whether it changed between the two models' : ''}. “Basis for assumption” says
        whether it was calculated from observed data, postulated, policy-set, technically set, or output-calibrated.
        Source/evidence records the specific evidence it came from.
      </p>
      <input className="assumption-search" aria-label="Search model assumptions" placeholder="Search assumptions or config keys" value={search} onChange={(event) => setSearch(event.target.value)} />
      {[...referenceGroups.entries()].map(([group, items]) => <section className="assumption-group" key={group as ParameterGroup}><h3>{group} <span>{items.length}</span></h3><div className="assumption-table" role="table"><div className="assumption-table-head" role="row"><span>Assumption and config key</span><span>{mode === 'compare' ? 'Model values and change' : 'Model value'}</span><span>Basis for assumption</span><span>Source / evidence</span></div>{items.map((item) => { const meta = catalog.find((entry) => entry.id === item.id)!; const complex = item.visualPayload.type !== 'scalar'; const derivation = meta.keyMetadata[0]?.derivation; return <div className="assumption-table-row" role="row" key={item.id}><div><strong>{item.title}</strong><code>{meta.configKeys.join(', ')}</code><small>{meta.keyMetadata[0]?.description}</small></div><div>{scalarSummary(item, mode, meta)}{item.visualPayload.type === 'joint_distribution' && <small>The heatmap shows the full distribution; each cell is the share of households in that combination of bands.</small>}{mode === 'compare' && <span className={item.unchanged ? 'unchanged' : 'changed'}>{item.unchanged ? 'Unchanged' : 'Changed'}</span>}{complex && <button type="button" className="secondary-button assumption-inspection-button" aria-haspopup="dialog" onClick={() => setInspectionItem(item)}>{inspectionLabel(item)}</button>}</div><div>{derivation && <><b>{derivation}</b><small>{derivationDescription(derivation)}</small></>}</div><div><SourceSummary item={item} mode={mode} meta={meta} /></div></div>; })}</div></section>)}
      {referenceGroups.size === 0 && <p className="info-banner">No assumptions match the current filters.</p>}
    </CalibrationSection>
    </>}
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
          <CompareCard item={inspectionItem} mode={mode} inProgressVersions={inProgress} presentation="visualization" />
        </div>
      </section>
    </div>}
  </section>;
}
