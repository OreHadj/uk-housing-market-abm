import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  BasePolicyId,
  BasePolicyOption,
  ModelRunParameterDefinition,
  ModelRunSnapshotOption,
  ModelRunWarning
} from '../../../shared/types';
import { formatExperimentModelOption, orderExperimentModelOptions } from '../../lib/experimentVersionOptions';
import { CentralBankPolicyInput } from './CentralBankPolicyInput';
import { GeneralModelControl } from './GeneralModelControl';
import { InfoLabel } from './InfoLabel';
import { SETTING_HELP } from './settingHelp';

type FormValue = string | boolean;
type PolicyInstrument = 'ltv' | 'lti';

const BENCHMARK_OPTION = {
  label: 'Baseline policy — no additional change',
  description: 'Run the selected baseline policy unchanged, to serve as the counterfactual.'
};

const POLICY_INSTRUMENT_OPTIONS: ReadonlyArray<{
  value: PolicyInstrument;
  label: string;
  description: string;
}> = [
  {
    value: 'ltv',
    label: 'Loan-to-value (LTV) limit',
    description: 'Cap the mortgage as a share of property value, per borrower group.'
  },
  {
    value: 'lti',
    label: 'Loan-to-income (LTI) flow limit',
    description: 'Cap the share of new lending at or above an income multiple.'
  }
];

const LTV_FIELDS: Array<{ key: string; label: string; group: string }> = [
  { key: 'CENTRAL_BANK_LTV_HARD_MAX_FTB', label: 'LTV limit — first-time buyers', group: 'first-time buyers' },
  { key: 'CENTRAL_BANK_LTV_HARD_MAX_HM', label: 'LTV limit — home movers', group: 'home movers' },
  { key: 'CENTRAL_BANK_LTV_HARD_MAX_BTL', label: 'LTV limit — buy-to-let', group: 'buy-to-let' }
];

const LTI_FIELDS: Array<{ key: string; label: string; group: string; unit: 'multiple' | 'percentage' | 'months' }> = [
  {
    key: 'CENTRAL_BANK_LTI_SOFT_MAX_FTB',
    label: 'LTI threshold — first-time buyers',
    group: 'first-time buyers',
    unit: 'multiple'
  },
  {
    key: 'CENTRAL_BANK_LTI_SOFT_MAX_HM',
    label: 'LTI threshold — home movers',
    group: 'home movers',
    unit: 'multiple'
  },
  {
    key: 'CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_FTB',
    label: 'Flow limit above threshold — first-time buyers',
    group: 'first-time buyers',
    unit: 'percentage'
  },
  {
    key: 'CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_HM',
    label: 'Flow limit above threshold — home movers',
    group: 'home movers',
    unit: 'percentage'
  },
  {
    key: 'CENTRAL_BANK_LTI_MONTHS_TO_CHECK',
    label: 'Flow assessment period',
    group: 'assessment period',
    unit: 'months'
  }
];

const PRIMARY_POLICY_KEYS = new Set([...LTV_FIELDS.map((field) => field.key), ...LTI_FIELDS.map((field) => field.key)]);

interface ManualRunSetupCardProps {
  formDisabled: boolean;
  submissionDisabled: boolean;
  submissionDisabledReason: string;
  isLoadingOptions: boolean;
  selectedBaseline: string;
  onBaselineChange: (baseline: string) => void;
  basePolicies: BasePolicyOption[];
  basePolicy: BasePolicyId;
  onBasePolicyChange: (basePolicy: BasePolicyId) => void;
  snapshots: ModelRunSnapshotOption[];
  title: string;
  onTitleChange: (value: string) => void;
  parameters: ModelRunParameterDefinition[];
  policyParameters: ModelRunParameterDefinition[];
  formValues: Record<string, FormValue>;
  onFormValueChange: (parameter: ModelRunParameterDefinition, value: FormValue) => void;
  maxWorkers: string;
  maxWorkersCap?: number;
  onMaxWorkersChange: (value: string) => void;
  warnings: ModelRunWarning[];
  isSubmitting: boolean;
  manualSubmissionLockedBySensitivity: boolean;
  lockMessage: string | null;
  onSubmit: (confirmWarnings: boolean) => void;
}

function numericValue(value: FormValue | undefined): number | null {
  if (typeof value === 'boolean') return null;
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

function formatValue(value: FormValue | undefined, unit: 'multiple' | 'percentage' | 'months'): string {
  const parsed = numericValue(value);
  if (parsed === null) return 'Not set';
  if (unit === 'percentage') return `${(parsed * 100).toLocaleString(undefined, { maximumFractionDigits: 4 })}%`;
  if (unit === 'months') return `${parsed.toLocaleString()} months`;
  return `${parsed.toLocaleString(undefined, { maximumFractionDigits: 4 })} times income`;
}

function differsFromBase(value: FormValue | undefined, baseValue: number | undefined): boolean {
  const parsed = numericValue(value);
  return parsed !== null && baseValue !== undefined && Math.abs(parsed - baseValue) > 1e-10;
}

interface PolicyNumberInputProps {
  parameter: ModelRunParameterDefinition;
  label: string;
  value: FormValue | undefined;
  unit: 'multiple' | 'percentage' | 'months';
  disabled: boolean;
  onChange: (parameter: ModelRunParameterDefinition, value: FormValue) => void;
}

function PolicyNumberInput({ parameter, label, value, unit, disabled, onChange }: PolicyNumberInputProps) {
  const storedValue = typeof value === 'string' ? value : '';
  const displayValue = unit === 'percentage' && storedValue !== '' ? String(Number(storedValue) * 100) : storedValue;
  const suffix = unit === 'percentage' ? '%' : unit === 'months' ? 'months' : '× income';

  return (
    <label className="scenario-field">
      <InfoLabel label={label} info={parameter.description} />
      <span className="scenario-number-control">
        <input
          type="number"
          step={unit === 'months' ? 1 : 'any'}
          value={displayValue}
          disabled={disabled}
          onChange={(event) => {
            const raw = event.target.value;
            onChange(parameter, unit === 'percentage' && raw !== '' ? String(Number(raw) / 100) : raw);
          }}
        />
        <span>{suffix}</span>
      </span>
    </label>
  );
}

export function ManualRunSetupCard({
  formDisabled,
  submissionDisabled,
  submissionDisabledReason,
  isLoadingOptions,
  selectedBaseline,
  onBaselineChange,
  basePolicies,
  basePolicy,
  onBasePolicyChange,
  snapshots,
  title,
  onTitleChange,
  parameters,
  policyParameters,
  formValues,
  onFormValueChange,
  maxWorkers,
  maxWorkersCap,
  onMaxWorkersChange,
  warnings,
  isSubmitting,
  manualSubmissionLockedBySensitivity,
  lockMessage,
  onSubmit
}: ManualRunSetupCardProps) {
  const [activeInstruments, setActiveInstruments] = useState<ReadonlySet<PolicyInstrument>>(new Set());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const orderedSnapshots = orderExperimentModelOptions(snapshots);
  const selectedBasePolicy = basePolicies.find((policy) => policy.id === basePolicy);
  const parametersByKey = useMemo(() => new Map(policyParameters.map((parameter) => [parameter.key, parameter])), [policyParameters]);
  const additionalPolicyParameters = policyParameters.filter((parameter) => !PRIMARY_POLICY_KEYS.has(parameter.key));
  const isBenchmark = activeInstruments.size === 0;

  const resetToBase = (keys: readonly string[]) => {
    if (!selectedBasePolicy) return;
    for (const key of keys) {
      const parameter = parametersByKey.get(key);
      const baseValue = selectedBasePolicy.values[key];
      if (parameter && baseValue !== undefined) onFormValueChange(parameter, String(baseValue));
    }
  };

  const selectBenchmark = () => {
    setActiveInstruments(new Set());
    resetToBase(policyParameters.map((parameter) => parameter.key));
  };

  const toggleInstrument = (instrument: PolicyInstrument) => {
    // Turning an instrument off returns its fields to the baseline policy, so a hidden
    // section can never leave a stale override in the submitted scenario.
    if (activeInstruments.has(instrument)) {
      resetToBase((instrument === 'ltv' ? LTV_FIELDS : LTI_FIELDS).map((field) => field.key));
    }
    setActiveInstruments((current) => {
      const next = new Set(current);
      if (next.has(instrument)) {
        next.delete(instrument);
      } else {
        next.add(instrument);
      }
      return next;
    });
  };

  const changedLtvGroups = LTV_FIELDS.filter((field) =>
    differsFromBase(formValues[field.key], selectedBasePolicy?.values[field.key])
  ).map((field) => field.group);
  const changedLtiGroups = LTI_FIELDS.filter(
    (field) => field.unit !== 'months' && differsFromBase(formValues[field.key], selectedBasePolicy?.values[field.key])
  ).map((field) => field.group);
  const uniqueLtiGroups = [...new Set(changedLtiGroups)];

  const scenarioSentence = (() => {
    if (isBenchmark) {
      return 'This scenario runs the selected baseline policy without an additional policy change.';
    }
    const clauses: string[] = [];
    if (activeInstruments.has('ltv') && changedLtvGroups.length > 0) {
      clauses.push(`LTV limits for ${changedLtvGroups.join(', ')}`);
    }
    if (activeInstruments.has('lti') && uniqueLtiGroups.length > 0) {
      clauses.push(`the LTI flow limit for ${uniqueLtiGroups.join(' and ')}`);
    }
    if (clauses.length === 0) {
      return 'Change one or more limits relative to the baseline policy.';
    }
    return `This scenario changes ${clauses.join(', and ')}.`;
  })();

  const policyTypeSummary = isBenchmark
    ? BENCHMARK_OPTION.label
    : POLICY_INSTRUMENT_OPTIONS.filter((option) => activeInstruments.has(option.value))
        .map((option) => option.label)
        .join(' + ');

  const advancedSummary = [
    parameters.find((parameter) => parameter.key === 'N_STEPS')
      ? `${formValues.N_STEPS ?? '—'} simulation steps`
      : null,
    parameters.find((parameter) => parameter.key === 'N_SIMS')
      ? `${formValues.N_SIMS ?? '—'} repetitions`
      : null,
    `up to ${maxWorkers || '—'} parallel workers`
  ].filter(Boolean);

  return (
    <article className="scenario-builder-surface">
      {manualSubmissionLockedBySensitivity && lockMessage && <p className="info-banner">{lockMessage}</p>}

      {isLoadingOptions ? (
        <p className="loading-banner">Loading scenario options...</p>
      ) : (
        <>
        <div className="scenario-builder-heading">
          <h2>Create a scenario</h2>
          <p>Choose the policy settings, then create and queue the simulation.</p>
        </div>
        <div className="scenario-builder-grid">
          <div className="scenario-builder-form">
            <section className="scenario-section">
              <h3>Scenario details</h3>
              <label className="scenario-field">
                <span>Scenario name</span>
                <input
                  type="text"
                  value={title}
                  disabled={formDisabled}
                  onChange={(event) => onTitleChange(event.target.value)}
                  maxLength={120}
                  placeholder="For example, Lower LTV limits for first-time buyers"
                />
              </label>
            </section>

            <section className="scenario-section" aria-labelledby="baseline-policy-heading">
              <h3 id="baseline-policy-heading">Baseline policy</h3>
              <p className="scenario-section-intro">
                The real-world regime this scenario departs from. Every setting you do not change stays at its value,
                and results are reported against it.
              </p>
              <label className="scenario-field">
                <InfoLabel label="Baseline policy" info={SETTING_HELP.basePolicy} />
                <select
                  value={basePolicy}
                  disabled={formDisabled}
                  onChange={(event) => onBasePolicyChange(event.target.value as BasePolicyId)}
                >
                  {basePolicies.map((policy) => (
                    <option key={policy.id} value={policy.id}>
                      {policy.title}
                    </option>
                  ))}
                </select>
              </label>
              {selectedBasePolicy ? (
                <div className="scenario-reference-note">
                  <p><strong>{selectedBasePolicy.title}</strong></p>
                  <p>{selectedBasePolicy.summary}</p>
                </div>
              ) : null}
            </section>

            <section className="scenario-section">
              <h3>Policy change</h3>
              <p className="scenario-section-intro">
                Changes applied on top of the baseline policy. Combine both to test how the two instruments interact.
              </p>
              <div className="policy-choice-grid" role="group" aria-label="Policy change">
                <label className={`policy-choice ${isBenchmark ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    name="policy-benchmark"
                    checked={isBenchmark}
                    disabled={formDisabled}
                    onChange={selectBenchmark}
                  />
                  <span>
                    <strong>{BENCHMARK_OPTION.label}</strong>
                    <small>{BENCHMARK_OPTION.description}</small>
                  </span>
                </label>
                {POLICY_INSTRUMENT_OPTIONS.map(({ value, label, description }) => (
                  <label className={`policy-choice ${activeInstruments.has(value) ? 'selected' : ''}`} key={value}>
                    <input
                      type="checkbox"
                      name={`policy-${value}`}
                      value={value}
                      checked={activeInstruments.has(value)}
                      disabled={formDisabled}
                      onChange={() => toggleInstrument(value)}
                    />
                    <span>
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </section>

            {activeInstruments.has('ltv') && (
              <section className="scenario-section" aria-labelledby="ltv-settings-heading">
                <h3 id="ltv-settings-heading">Loan-to-value (LTV) limits</h3>
                <p className="scenario-section-intro">
                  The maximum mortgage as a percentage of property value. Applies to every new loan in the borrower group.
                </p>
                <div className="scenario-fields-grid">
                  {LTV_FIELDS.map((field) => {
                    const parameter = parametersByKey.get(field.key);
                    return parameter ? (
                      <PolicyNumberInput
                        key={field.key}
                        parameter={parameter}
                        label={field.label}
                        value={formValues[field.key]}
                        unit="percentage"
                        disabled={formDisabled}
                        onChange={onFormValueChange}
                      />
                    ) : null;
                  })}
                </div>
              </section>
            )}

            {activeInstruments.has('lti') && (
              <section className="scenario-section" aria-labelledby="lti-settings-heading">
                <h3 id="lti-settings-heading">Loan-to-income (LTI) flow limit</h3>
                <p className="scenario-section-intro">
                  The income multiple defining a high-LTI loan, and the maximum share of a lender&apos;s new lending
                  allowed at or above it. The 2024 baseline is 4.5&times; income with a 15% flow limit.
                </p>
                <div className="scenario-fields-grid">
                  {LTI_FIELDS.map((field) => {
                    const parameter = parametersByKey.get(field.key);
                    return parameter ? (
                      <PolicyNumberInput
                        key={field.key}
                        parameter={parameter}
                        label={field.label}
                        value={formValues[field.key]}
                        unit={field.unit}
                        disabled={formDisabled}
                        onChange={onFormValueChange}
                      />
                    ) : null;
                  })}
                </div>
              </section>
            )}

            <button
              type="button"
              className={`scenario-advanced-toggle ${advancedOpen ? 'active' : ''}`}
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((open) => !open)}
            >
              <span>Advanced simulation settings</span>
              <span aria-hidden="true">{advancedOpen ? '−' : '+'}</span>
            </button>

            {advancedOpen && (
              <aside
                className="scenario-advanced-panel scenario-advanced-panel--inline"
                aria-labelledby="scenario-advanced-heading"
              >
                <div className="scenario-advanced-panel-heading">
                  <p className="eyebrow">Advanced</p>
                  <h3 id="scenario-advanced-heading">Simulation settings</h3>
                  <p>Configure execution details without changing the policy scenario itself.</p>
                </div>
                <div className="scenario-advanced-content">
                  <div className="scenario-fields-grid">
                    <label className="scenario-field">
                      <InfoLabel label="Calibration version" info={SETTING_HELP.calibrationParameterVersion} />
                      <select value={selectedBaseline} disabled={formDisabled} onChange={(event) => onBaselineChange(event.target.value)}>
                        {orderedSnapshots.map((snapshot) => (
                          <option key={snapshot.version} value={snapshot.version}>
                            {formatExperimentModelOption(snapshot, orderedSnapshots)}
                          </option>
                        ))}
                      </select>
                      <Link className="summary-link-inline" to={`/calibration?mode=single&version=${encodeURIComponent(selectedBaseline)}`}>
                        View in Calibration
                      </Link>
                    </label>
                  </div>

                  <h4>Simulation controls</h4>
                  <GeneralModelControl
                    mode="manual"
                    parameters={parameters}
                    formValues={formValues}
                    executionDisabled={formDisabled}
                    onFormValueChange={onFormValueChange}
                    maxWorkers={maxWorkers}
                    maxWorkersCap={maxWorkersCap}
                    onMaxWorkersChange={onMaxWorkersChange}
                    maxWorkersHint={SETTING_HELP.maxWorkers}
                    includeFixedControls
                    embedded
                  />

                  {additionalPolicyParameters.length > 0 && (
                    <div className="scenario-additional-policy">
                      <h4>Other policy controls</h4>
                      <div className="scenario-fields-grid">
                        {additionalPolicyParameters.map((parameter) => (
                          <CentralBankPolicyInput
                            key={parameter.key}
                            parameter={parameter}
                            value={formValues[parameter.key]}
                            basePolicyValue={selectedBasePolicy?.values[parameter.key]}
                            executionDisabled={formDisabled}
                            mode="manual"
                            onChange={onFormValueChange}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </aside>
            )}

            {warnings.length > 0 && (
              <div className="run-warning-card">
                <h4>Warnings detected</h4>
                <p>Confirm to submit anyway.</p>
                <ul>{warnings.map((warning) => <li key={`${warning.code}-${warning.message}`}>{warning.message}</li>)}</ul>
              </div>
            )}

            <div className="scenario-submit-row">
              <button
                type="button"
                className="primary-button scenario-create-button"
                disabled={isSubmitting || submissionDisabled || manualSubmissionLockedBySensitivity}
                onClick={() => onSubmit(false)}
              >
                {isSubmitting ? 'Creating scenario...' : 'Create scenario'}
              </button>
              {warnings.length > 0 && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isSubmitting || submissionDisabled || manualSubmissionLockedBySensitivity}
                  onClick={() => onSubmit(true)}
                >
                  Confirm and Queue
                </button>
              )}
            </div>
            {submissionDisabled && !manualSubmissionLockedBySensitivity && (
              <p className="scenario-submission-note">Create scenario is unavailable: {submissionDisabledReason}</p>
            )}
          </div>

          <aside className="scenario-summary" aria-labelledby="scenario-summary-heading">
            <p className="eyebrow">Live summary</p>
            <h3 id="scenario-summary-heading">{title.trim() || 'Untitled policy scenario'}</h3>
            <p>{scenarioSentence}</p>
            <dl>
              <div><dt>Baseline policy</dt><dd>{selectedBasePolicy?.title ?? 'Not selected'}</dd></div>
              <div>
                <dt>Policy type</dt>
                <dd>{policyTypeSummary}</dd>
              </div>
              {activeInstruments.has('ltv') && LTV_FIELDS.map((field) => (
                <div key={field.key}><dt>{field.label}</dt><dd>{formatValue(formValues[field.key], 'percentage')}</dd></div>
              ))}
              {activeInstruments.has('lti') && LTI_FIELDS.map((field) => (
                <div key={field.key}><dt>{field.label}</dt><dd>{formatValue(formValues[field.key], field.unit)}</dd></div>
              ))}
            </dl>
            <div className="scenario-summary-advanced">
              <h4>Simulation</h4>
              <p>{advancedSummary.join(' · ')}</p>
              <p>Seeds are managed by the existing repeated-run process.</p>
            </div>
          </aside>
        </div>
        </>
      )}
    </article>
  );
}
