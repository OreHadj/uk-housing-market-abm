import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { CalibrationModelOverview, CalibrationOverviewResponse, CompareResponse, DatasetAttribution, ParameterCardMeta, ParameterGroup } from '../../shared/types';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { CompareCard } from '../components/CompareCard';
import { LoadingSkeletonGroup } from '../components/LoadingSkeleton';
import { EvidenceReturnPanel } from '../components/EvidenceReturnPanel';
import { API_RETRY_DELAY_MS, fetchCalibrationOverview, fetchCatalog, fetchCompare, fetchVersions, isRetryableApiError } from '../lib/api';
import { buildModelOptions, getDefaultModelVersion } from '../lib/modelAnchors';
import { readScenarioDraft, updateScenarioDraftModel } from '../lib/scenarioDraft';
import { readSensitivityDraft, updateSensitivityDraftModel } from '../lib/sensitivityDraft';
import { ValidationModelOptions } from './ValidationPage';

type ViewMode = 'single' | 'compare';
type RefittedCampaign = Extract<CalibrationModelOverview['campaign'], { kind: 'refitted' }>;
type CalibrationValidationReturnContext = {
  source: 'scenario' | 'sensitivity' | '';
  draftId: string;
  returnStep: string;
};
const FITTED_IDS = new Set(['rent_purchase_choice', 'btl_probability_multiplier', 'btl_choice_intensity', 'market_average_price_decay']);

function fmt(value: number | null): string {
  if (value === null) return 'Not recorded';
  return new Intl.NumberFormat('en-GB', { maximumSignificantDigits: 6 }).format(value);
}

function fmtLoss(value: number): string {
  return new Intl.NumberFormat('en-GB', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(value);
}

/** Relative loss reduction in percent. Null protects zero, negative and non-finite baselines. */
export function relativeLossImprovement(before: number, after: number): number | null {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0 || after < 0) return null;
  return ((before - after) / before) * 100;
}

function lossChangeLabel(campaign: RefittedCampaign): string {
  const relative = relativeLossImprovement(campaign.baselineLoss, campaign.selectedLoss);
  const losses = `${fmtLoss(campaign.baselineLoss)} → ${fmtLoss(campaign.selectedLoss)}`;
  if (relative === null) return losses;
  if (relative > 0) return `${losses} · ${relative.toFixed(1)}% lower`;
  if (relative < 0) return `${losses} · ${Math.abs(relative).toFixed(1)}% higher`;
  return `${losses} · unchanged`;
}

function lossChangeSentence(campaign: RefittedCampaign): string {
  const relative = relativeLossImprovement(campaign.baselineLoss, campaign.selectedLoss);
  if (relative === null) return 'The recorded loss values do not support a safe relative comparison.';
  if (relative > 0) return `Validation loss was ${relative.toFixed(1)}% lower.`;
  if (relative < 0) return `Validation loss was ${Math.abs(relative).toFixed(1)}% higher.`;
  return 'Validation loss was unchanged.';
}

function campaignDecision(campaign: RefittedCampaign): string {
  if (campaign.selected && campaign.passedChecks) return 'Selected after passing the house-price guardrail';
  if (campaign.selected) return 'Selected despite not passing every recorded check';
  if (campaign.passedChecks) return 'Passed the required checks but was not selected';
  return 'Not selected after failing the required checks';
}

function campaignDecisionSentence(campaign: RefittedCampaign): string {
  if (campaign.selected && campaign.passedChecks) return 'The candidate passed the required house-price checks and was selected.';
  if (campaign.selected) return 'The candidate did not pass every recorded check but was selected.';
  if (campaign.passedChecks) return 'The candidate passed the required checks but was not selected.';
  return 'The candidate did not pass the required checks and was not selected.';
}

function campaignOriginSummary(campaign: CalibrationModelOverview['campaign']): string {
  switch (campaign.kind) {
    case 'refitted': return `${campaign.evidenceYear} evidence · Refitted`;
    case 'original': return campaign.status;
    case 'inherited': return `Inherited unchanged from ${campaign.sourceVersion}`;
    case 'unavailable': return 'Detailed record unavailable';
  }
}

export function buildCalibrationValidationHref(
  primaryVersion: string,
  comparisonVersion = '',
  returnContext: CalibrationValidationReturnContext = { source: '', draftId: '', returnStep: '' }
): string | null {
  const primary = primaryVersion.trim();
  if (!primary) return null;

  const query = new URLSearchParams();
  query.set('view', 'validation');
  query.set('version', primary);

  const comparison = comparisonVersion.trim();
  if (comparison && comparison !== primary) query.set('comparisonVersion', comparison);

  const draftId = returnContext.draftId.trim();
  if (returnContext.source && draftId) {
    query.set('from', returnContext.source);
    query.set('draft', draftId);
    query.set(
      returnContext.source === 'scenario' ? 'scenarioStep' : 'sensitivityStep',
      returnContext.returnStep.trim() || (returnContext.source === 'scenario' ? 'model-version' : 'model-baseline')
    );
  }

  return `/model-evidence?${query.toString()}`;
}

export function CalibrationValidationGuidance({
  primaryVersion,
  comparisonVersion = '',
  returnContext = { source: '', draftId: '', returnStep: '' }
}: {
  primaryVersion: string;
  comparisonVersion?: string;
  returnContext?: CalibrationValidationReturnContext;
}) {
  const href = buildCalibrationValidationHref(primaryVersion, comparisonVersion, returnContext);

  return <p className="validation-calibration-guidance calibration-validation-guidance">
    If you want to see how well the model matches UK evidence, visit the{' '}
    {href ? <Link to={href}>validation page</Link> : <span>validation page</span>}.
  </p>;
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

/** A page-level section that keeps a semantic heading while matching Validation's disclosures. */
function CalibrationSection({
  title,
  description,
  summary,
  defaultOpen,
  className,
  children
}: {
  title: string;
  description?: string;
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
        <h2>
          <button type="button" aria-expanded={isOpen} aria-controls={contentId} onClick={() => setIsOpen((current) => !current)}>
            <span className="calibration-collapsible-indicator" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
            <span className="calibration-collapsible-heading-copy">
              <span className="calibration-collapsible-title">{title}</span>
              {description && <span className="calibration-collapsible-description">{description}</span>}
            </span>
          </button>
        </h2>
      </div>
      <span className="calibration-collapsible-summary">{summary}</span>
    </div>
    <div id={contentId} className="calibration-collapsible-body" hidden={!isOpen}>{children}</div>
  </section>;
}

function ProvenanceDisclosure({ provenance }: { provenance: string[] }) {
  if (provenance.length === 0) return null;
  return <CollapsibleSection title="Technical provenance" defaultOpen={false} summary="Source records">
    <ul className="campaign-provenance-list">
      {provenance.map((record) => <li key={record}><span className="campaign-technical-path">{record}</span></li>)}
    </ul>
  </CollapsibleSection>;
}

function RefittedCampaignTechnicalDetails({ campaign }: { campaign: RefittedCampaign }) {
  return <CollapsibleSection title="Technical campaign details" defaultOpen={false} summary="Optimiser settings and provenance">
    <dl className="technical-details campaign-technical-details">
      {campaign.optimisationSettings.length > 0 && <div>
        <dt>Optimiser configuration</dt>
        <dd><ul>{campaign.optimisationSettings.map((setting) => <li key={setting}>{setting}</li>)}</ul></dd>
      </div>}
      <div>
        <dt>Calibration artifact</dt>
        <dd><span className="campaign-technical-path">{campaign.artifactPath}</span></dd>
      </div>
      {campaign.provenance.length > 0 && <div>
        <dt>Supporting provenance</dt>
        <dd><ul>{campaign.provenance.map((record) => <li key={record}><span className="campaign-technical-path">{record}</span></li>)}</ul></dd>
      </div>}
    </dl>
  </CollapsibleSection>;
}

export function BehaviouralParameterOriginSection({
  model,
  differentEvidenceProfile = false
}: {
  model: CalibrationModelOverview;
  differentEvidenceProfile?: boolean;
}) {
  const campaign = model.campaign;

  return <CalibrationSection
    className={`calibration-campaign calibration-campaign-${campaign.kind}`}
    title="How the behavioural parameters were obtained"
    description="Where this model’s five fitted behavioural values came from."
    summary={campaignOriginSummary(campaign)}
    defaultOpen={false}
  >
    <div className="calibration-campaign-content">
    {campaign.kind === 'refitted' && <>
      <p className="calibration-campaign-explanation">
        Starting from <strong>{campaign.startingVersion}</strong>, this model tuned {campaign.tunedParameterCount}
        {' '}behavioural parameters against {campaign.evidenceYear} evidence using {campaign.targetOutcomeCount}
        {' '}outcome targets and {campaign.method}. {lossChangeSentence(campaign)}{' '}
        {campaignDecisionSentence(campaign)}
      </p>
      <dl className="campaign-grid">
        <div><dt>Starting model</dt><dd>{campaign.startingVersion}</dd></div>
        <div><dt>Method</dt><dd>{campaign.method}</dd></div>
        <div><dt>Validation loss</dt><dd>{lossChangeLabel(campaign)}</dd></div>
        <div><dt>Decision</dt><dd>{campaignDecision(campaign)}</dd></div>
      </dl>
      <RefittedCampaignTechnicalDetails campaign={campaign} />
    </>}

    {campaign.kind === 'original' && <>
      <p className="calibration-campaign-explanation">
        The five behavioural values in <strong>{model.identity.version}</strong> come from the original published
        {' '}calibration rather than from a new optimisation campaign recorded by this dashboard.
      </p>
      <dl className="campaign-grid">
        <div><dt>Evidence / fit year</dt><dd>{campaign.evidenceYear}</dd></div>
        <div><dt>Original calibration method</dt><dd>{campaign.method}</dd></div>
        <div><dt>Status</dt><dd>{campaign.status}</dd></div>
        {campaign.provenance.length > 0 && <div>
          <dt>Available provenance</dt>
          <dd>{campaign.provenance.length} source {campaign.provenance.length === 1 ? 'record' : 'records'}</dd>
        </div>}
      </dl>
      <ProvenanceDisclosure provenance={campaign.provenance} />
    </>}

    {campaign.kind === 'inherited' && <>
      <p className="calibration-campaign-explanation">
        No new behavioural calibration was run for this model. Its five behavioural parameters were supplied by
        {' '}<strong>{campaign.sourceVersion}</strong>, where they were fitted against {campaign.evidenceYear} evidence,
        {' '}and were inherited unchanged.
      </p>
      <dl className="campaign-grid">
        <div><dt>Source model</dt><dd>{campaign.sourceVersion}</dd></div>
        <div><dt>Evidence / fit year</dt><dd>{campaign.evidenceYear}</dd></div>
        <div><dt>Status</dt><dd>Inherited unchanged</dd></div>
      </dl>
      <ProvenanceDisclosure provenance={campaign.provenance} />
    </>}

    {campaign.kind === 'unavailable' && <>
      <p className="calibration-campaign-unavailable">
        A detailed behavioural-calibration record is not available for this model version.
      </p>
      <ProvenanceDisclosure provenance={campaign.provenance} />
    </>}

    {differentEvidenceProfile && <p className="info-banner">
      The selected models use different behavioural-fit evidence years, so their fit records should be interpreted
      within their own evidence profiles.
    </p>}
    </div>
  </CalibrationSection>;
}

/** A compact, independently expandable group within Other model assumptions. */
export function AssumptionGroupDisclosure({
  group,
  assumptionCount,
  children
}: {
  group: string;
  assumptionCount: number;
  children: ReactNode;
}) {
  const countLabel = `${assumptionCount} assumption${assumptionCount === 1 ? '' : 's'}`;

  return <details className="assumption-group">
    <summary className="assumption-group-summary">
      <h3>
        <span className="assumption-group-indicator" aria-hidden="true">▸</span>
        <span className="assumption-group-title">{group}</span>
        <span className="assumption-group-count">{countLabel}</span>
      </h3>
    </summary>
    <div className="assumption-group-body">{children}</div>
  </details>;
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

export function FittedParameterRow({
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

  return <details className={`calibration-parameter-row calibration-parameter-row-${mode}`}>
    <summary className="calibration-parameter-summary">
      <span className="calibration-parameter-indicator" aria-hidden="true">▸</span>
      <span className="parameter-row-head">
        <strong>{parameter.name}</strong>
        <code>{parameter.key}</code>
      </span>
      <span className="parameter-number-grid">
        <span className="parameter-number-item">
          <span>{mode === 'compare' ? `${primaryVersion} value` : 'Selected value'}</span>
          <strong>{fmt(parameter.value)}</strong>
        </span>
        {mode === 'compare' && compared && comparisonVersion && (
          <span className="parameter-number-item">
            <span>{comparisonVersion} value</span>
            <strong>{fmt(compared.value)}</strong>
          </span>
        )}
        {mode === 'compare' && compared && (
          <span className="parameter-number-item">
            <span>Absolute difference</span>
            <strong>{fmt(parameter.value - compared.value)}</strong>
            <small className={changed ? 'changed' : 'unchanged'}>{changed ? 'Changed' : 'Unchanged'}</small>
          </span>
        )}
        <span className="parameter-number-item">
          <span>Range tested</span>
          <strong>{testedRange}</strong>
        </span>
      </span>
    </summary>
    <div className="calibration-parameter-body">
      <div className="parameter-explanation-grid">
        <p><b>Behavioural meaning</b>{parameter.meaning}</p>
        <p><b>Why calibrate it</b>{parameter.calibrationReason}</p>
        <p><b>If increased</b>{parameter.increaseEffect}</p>
        <p><b>If decreased</b>{parameter.decreaseEffect}</p>
      </div>
    </div>
  </details>;
}

export function ComparePage() {
  const [params, setParams] = useSearchParams();
  const [versions, setVersions] = useState<string[]>([]);
  const [inProgress, setInProgress] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<ParameterCardMeta[]>([]);
  const [comparisonEnabled, setComparisonEnabledState] = useState(false);
  const [selected, setSelected] = useState('');
  const [left, setLeft] = useState('');
  const [overview, setOverview] = useState<CalibrationOverviewResponse | null>(null);
  const [comparison, setComparison] = useState<CompareResponse | null>(null);
  const [inspectionItem, setInspectionItem] = useState<CompareResponse['items'][number] | null>(null);
  const [loading, setLoading] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const mode: ViewMode = comparisonEnabled && left && left !== selected ? 'compare' : 'single';
  const returnSource = params.get('from')?.trim() ?? '';
  const evidenceDraftId = params.get('draft')?.trim() ?? '';
  const hasScenarioContext = returnSource === 'scenario' && Boolean(evidenceDraftId && readScenarioDraft(evidenceDraftId));
  const hasSensitivityContext = returnSource === 'sensitivity' && Boolean(evidenceDraftId && readSensitivityDraft(evidenceDraftId));
  const hasSetupContext = hasScenarioContext || hasSensitivityContext;
  const returnVersion = selected;

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
      const initialComparisonEnabled = params.get('mode') === 'compare';
      const defaultVersion = getDefaultModelVersion(available, versionPayload.inProgressVersions);
      const requested = initialComparisonEnabled ? params.get('right') ?? '' : params.get('version') ?? '';
      const primaryVersion = available.includes(requested) ? requested : defaultVersion;
      const requestedComparison = params.get('left') ?? '';
      setVersions(available); setInProgress(versionPayload.inProgressVersions); setCatalog(catalogue);
      setComparisonEnabledState(initialComparisonEnabled);
      setSelected(primaryVersion);
      setLeft(
        initialComparisonEnabled && available.includes(requestedComparison) && requestedComparison !== primaryVersion
          ? requestedComparison
          : ''
      );
    }).catch((reason) => { setError((reason as Error).message); setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selected || catalog.length === 0) return;
    const next = new URLSearchParams(params);
    next.set('mode', comparisonEnabled ? 'compare' : 'single');
    if (!comparisonEnabled) {
      next.set('version', selected);
      next.delete('left');
      next.delete('right');
    } else {
      next.set('right', selected);
      if (left && left !== selected) next.set('left', left);
      else next.delete('left');
      next.delete('version');
    }
    if (next.toString() !== params.toString()) setParams(next, { replace: true });

    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      setLoading(true); setWaiting(false); setError('');
      const other = mode === 'compare' ? left : undefined;
      try {
        const [overviewPayload, comparePayload] = await Promise.all([
          fetchCalibrationOverview(selected, other),
          fetchCompare(mode === 'single' ? selected : left, selected, catalog.map((item) => item.id), mode === 'single' ? 'through_right' : 'range')
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
  }, [comparisonEnabled, mode, selected, left, catalog]);

  const referenceGroups = useMemo(() => {
    const rows = (comparison?.items ?? []).filter((item) => !FITTED_IDS.has(item.id));
    const grouped = new Map<ParameterGroup, CompareResponse['items']>();
    for (const item of rows) grouped.set(item.group, [...(grouped.get(item.group) ?? []), item]);
    return grouped;
  }, [comparison]);
  // Header counts for the collapsible sections report the whole selected model.
  const referenceItems = useMemo(() => (comparison?.items ?? []).filter((item) => !FITTED_IDS.has(item.id)), [comparison]);
  const optionSet = useMemo(() => new Set(inProgress), [inProgress]);
  const pickerVersions = useMemo(() => {
    const offered = buildModelOptions(versions, selected, optionSet).map((option) => option.version);
    return left && versions.includes(left) && !offered.includes(left) ? [...offered, left] : offered;
  }, [left, optionSet, selected, versions]);
  const validationReturnContext: CalibrationValidationReturnContext = hasScenarioContext
    ? {
        source: 'scenario',
        draftId: evidenceDraftId,
        returnStep: params.get('scenarioStep')?.trim() || 'model-version'
      }
    : hasSensitivityContext
      ? {
          source: 'sensitivity',
          draftId: evidenceDraftId,
          returnStep: params.get('sensitivityStep')?.trim() || 'model-baseline'
        }
      : { source: '', draftId: '', returnStep: '' };
  const returnHref = hasScenarioContext
    ? `/scenarios/new?draft=${encodeURIComponent(evidenceDraftId)}&step=model-version`
    : `/sensitivity/new?draft=${encodeURIComponent(evidenceDraftId)}&step=model-baseline`;

  const setComparisonEnabled = (enabled: boolean) => {
    setComparisonEnabledState(enabled);
    if (!enabled) setLeft('');
  };

  const selectPrimaryModel = (version: string) => {
    setSelected(version);
    if (version === left) setLeft('');
  };

  return <section className="calibration-layout calibration-workspace">
    {hasSetupContext && returnVersion && <EvidenceReturnPanel
      className="evidence-context-banner"
      message={hasScenarioContext
        ? 'You are reviewing calibration evidence for an unfinished policy scenario.'
        : 'You are reviewing calibration evidence for an unfinished sensitivity analysis.'}
      returnHref={returnHref}
      versions={pickerVersions}
      currentVersion={returnVersion}
      inProgressVersions={optionSet}
      onChooseModel={(version) => {
        if (hasScenarioContext) updateScenarioDraftModel(evidenceDraftId, version);
        else updateSensitivityDraftModel(evidenceDraftId, version);
      }}
    />}
    <article className="results-card calibration-evidence-introduction">
      <div className="validation-introduction-copy">
        <h2>Calibration</h2>
        <p>Understand why the model needs fitted behaviour, what was fitted, and which other assumptions it carries.</p>
        <p>
          The model combines inputs measured directly from UK data with behavioural parameters that cannot be
          observed directly. Household demographics and incomes, for example, can be set using published
          statistics, whereas parameters influencing decisions such as whether to rent or buy must be estimated
          through calibration. This page documents the values used in the selected model version and the evidence
          supporting them.
        </p>
      </div>
    </article>
    <section className="calibration-model-picker" aria-label="Calibration model selection">
      <div className="validation-model-columns-scroll">
        <div className="validation-model-columns">
          <section className="validation-model-column" aria-labelledby="calibration-primary-model-heading">
            <div className="validation-model-column-heading">
              <div>
                <span>Model 1</span>
                <h3 id="calibration-primary-model-heading">Primary model</h3>
              </div>
            </div>
            <ValidationModelOptions
              versions={pickerVersions}
              selectedVersion={selected}
              name="calibration-primary-model"
              label="Primary calibration model"
              inProgressVersions={optionSet}
              onChange={selectPrimaryModel}
            />
          </section>

          <section
            className={`validation-model-column validation-model-column-comparison ${comparisonEnabled ? 'is-enabled' : 'is-disabled'}`}
            aria-labelledby="calibration-comparison-model-heading"
            aria-disabled={!comparisonEnabled}
          >
            <div className="validation-model-column-heading">
              <div>
                <span>Model 2</span>
                <h3 id="calibration-comparison-model-heading">Comparison model</h3>
              </div>
              <label className="comparison-enable-toggle validation-comparison-enable-toggle">
                <input
                  type="checkbox"
                  checked={comparisonEnabled}
                  disabled={versions.length < 2}
                  onChange={(event) => setComparisonEnabled(event.target.checked)}
                />
                <span>Compare</span>
              </label>
            </div>
            <ValidationModelOptions
              versions={pickerVersions}
              selectedVersion={left}
              name="calibration-comparison-model"
              label="Comparison calibration model"
              disabled={!comparisonEnabled}
              unavailableVersion={selected}
              inProgressVersions={optionSet}
              onChange={setLeft}
            />
            <small className="validation-selector-note">
              {comparisonEnabled
                ? left ? 'One model selected for comparison.' : 'Choose one model to compare with the primary model.'
                : 'Check Compare to enable this column.'}
            </small>
          </section>
        </div>
      </div>
      <CalibrationValidationGuidance
        primaryVersion={selected}
        comparisonVersion={mode === 'compare' ? left : ''}
        returnContext={validationReturnContext}
      />
    </section>
    {error && <p className="error-banner">{error}</p>}{waiting && <p className="waiting-banner">Waiting for API to become available. Retrying every 2 seconds…</p>}
    {loading && !overview ? <LoadingSkeletonGroup count={4} ariaLabel="Loading calibration analysis" /> : overview && <>
      <main className="calibration-main">
        <BehaviouralParameterOriginSection
          model={overview.primary}
          differentEvidenceProfile={mode === 'compare' && !overview.sameEvidenceProfile}
        />
        <CalibrationSection
          className="calibration-parameters"
          title="Five fitted behavioural parameters"
          summary={countChangedParameters(overview) === null
            ? `${overview.primary.parameters.length} parameters`
            : `${countChangedParameters(overview)} of ${overview.primary.parameters.length} changed`}
          defaultOpen
        >
          {overview.primary.parameters.map((parameter) =>
            <FittedParameterRow
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
    <CalibrationSection
      className="assumption-reference assumption-reference-full"
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
      <div className="assumption-groups">
        {[...referenceGroups.entries()].map(([group, items]) =>
          <AssumptionGroupDisclosure key={group as ParameterGroup} group={group} assumptionCount={items.length}>
            <div className="assumption-table" role="table">
              <div className="assumption-table-head" role="row">
                <span>Assumption and config key</span>
                <span>{mode === 'compare' ? 'Model values and change' : 'Model value'}</span>
                <span>Basis for assumption</span>
                <span>Source / evidence</span>
              </div>
              {items.map((item) => {
                const meta = catalog.find((entry) => entry.id === item.id)!;
                const complex = item.visualPayload.type !== 'scalar';
                const derivation = meta.keyMetadata[0]?.derivation;
                return <div className="assumption-table-row" role="row" key={item.id}>
                  <div><strong>{item.title}</strong><code>{meta.configKeys.join(', ')}</code><small>{meta.keyMetadata[0]?.description}</small></div>
                  <div>{scalarSummary(item, mode, meta)}{item.visualPayload.type === 'joint_distribution' && <small>The heatmap shows the full distribution; each cell is the share of households in that combination of bands.</small>}{mode === 'compare' && <span className={item.unchanged ? 'unchanged' : 'changed'}>{item.unchanged ? 'Unchanged' : 'Changed'}</span>}{complex && <button type="button" className="secondary-button assumption-inspection-button" aria-haspopup="dialog" onClick={() => setInspectionItem(item)}>{inspectionLabel(item)}</button>}</div>
                  <div>{derivation && <><b>{derivation}</b><small>{derivationDescription(derivation)}</small></>}</div>
                  <div><SourceSummary item={item} mode={mode} meta={meta} /></div>
                </div>;
              })}
            </div>
          </AssumptionGroupDisclosure>
        )}
      </div>
      {referenceGroups.size === 0 && <p className="info-banner">No model assumptions are available.</p>}
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
