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
type PolicyType = 'benchmark' | 'ltv' | 'lti';

const LTV_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'CENTRAL_BANK_LTV_HARD_MAX_FTB', label: 'First-time buyers' },
  { key: 'CENTRAL_BANK_LTV_HARD_MAX_HM', label: 'Home movers' },
  { key: 'CENTRAL_BANK_LTV_HARD_MAX_BTL', label: 'Buy-to-let investors' }
];

const LTI_FIELDS: Array<{ key: string; label: string; unit: 'multiple' | 'percentage' | 'months' }> = [
  { key: 'CENTRAL_BANK_LTI_SOFT_MAX_FTB', label: 'First-time buyer loan-to-income threshold', unit: 'multiple' },
  { key: 'CENTRAL_BANK_LTI_SOFT_MAX_HM', label: 'Home mover loan-to-income threshold', unit: 'multiple' },
  {
    key: 'CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_FTB',
    label: 'First-time buyer lending allowed above threshold',
    unit: 'percentage'
  },
  {
    key: 'CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_HM',
    label: 'Home mover lending allowed above threshold',
    unit: 'percentage'
  },
  { key: 'CENTRAL_BANK_LTI_MONTHS_TO_CHECK', label: 'Assessment period', unit: 'months' }
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
  const [policyType, setPolicyType] = useState<PolicyType>('benchmark');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const orderedSnapshots = orderExperimentModelOptions(snapshots);
  const selectedBasePolicy = basePolicies.find((policy) => policy.id === basePolicy);
  const parametersByKey = useMemo(() => new Map(policyParameters.map((parameter) => [parameter.key, parameter])), [policyParameters]);
  const additionalPolicyParameters = policyParameters.filter((parameter) => !PRIMARY_POLICY_KEYS.has(parameter.key));

  const selectPolicyType = (nextPolicyType: PolicyType) => {
    setPolicyType(nextPolicyType);
    if (nextPolicyType === 'benchmark' && selectedBasePolicy) {
      for (const parameter of policyParameters) {
        const baseValue = selectedBasePolicy.values[parameter.key];
        if (baseValue !== undefined) onFormValueChange(parameter, String(baseValue));
      }
    }
  };

  const changedLtvGroups = LTV_FIELDS.filter((field) =>
    differsFromBase(formValues[field.key], selectedBasePolicy?.values[field.key])
  ).map((field) => field.label);
  const changedLtiGroups = LTI_FIELDS.filter(
    (field) => field.unit !== 'months' && differsFromBase(formValues[field.key], selectedBasePolicy?.values[field.key])
  ).map((field) => field.label.replace(/ loan-to-income threshold| lending allowed above threshold/, ''));
  const uniqueLtiGroups = [...new Set(changedLtiGroups)];

  const scenarioSentence = (() => {
    if (policyType === 'benchmark') return 'This scenario keeps the selected benchmark policy unchanged.';
    if (policyType === 'ltv') {
      if (changedLtvGroups.length === 0) return 'Choose one or more loan-to-value limits to change relative to the benchmark.';
      return `This scenario changes maximum loan-to-value ratios for ${changedLtvGroups.join(', ')}.`;
    }
    if (uniqueLtiGroups.length === 0) return 'Choose a loan-to-income threshold or lending allowance to change relative to the benchmark.';
    return `This scenario changes loan-to-income flow restrictions for ${uniqueLtiGroups.join(' and ')}.`;
  })();

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

            <section className="scenario-section">
              <h3>Policy change</h3>
              <p className="scenario-section-intro">Select the kind of mortgage-policy scenario you want to explore.</p>
              <div className="policy-choice-grid" role="radiogroup" aria-label="Policy type">
                {([
                  ['benchmark', 'Benchmark', 'Keep the selected reference policy unchanged.'],
                  ['ltv', 'Loan-to-value restriction', 'Set maximum mortgage sizes relative to property value.'],
                  ['lti', 'Loan-to-income flow restriction', 'Limit the share of lending above an income multiple.']
                ] as const).map(([value, label, description]) => (
                  <label className={`policy-choice ${policyType === value ? 'selected' : ''}`} key={value}>
                    <input
                      type="radio"
                      name="policy-type"
                      value={value}
                      checked={policyType === value}
                      disabled={formDisabled}
                      onChange={() => selectPolicyType(value)}
                    />
                    <span>
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </section>

            {policyType === 'benchmark' && selectedBasePolicy && (
              <section className="scenario-section scenario-reference-note">
                <h3>Reference policy</h3>
                <p><strong>{selectedBasePolicy.title}</strong></p>
                <p>{selectedBasePolicy.summary}</p>
              </section>
            )}

            {policyType === 'ltv' && (
              <section className="scenario-section" aria-labelledby="ltv-settings-heading">
                <h3 id="ltv-settings-heading">Loan-to-value limits</h3>
                <p className="scenario-section-intro">Set the maximum mortgage as a percentage of the property value for each borrower group.</p>
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

            {policyType === 'lti' && (
              <section className="scenario-section" aria-labelledby="lti-settings-heading">
                <h3 id="lti-settings-heading">Loan-to-income flow limits</h3>
                <p className="scenario-section-intro">Set the income multiple, permitted lending share above it, and the assessment period.</p>
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

          {advancedOpen ? (
          <aside className="scenario-advanced-panel" aria-labelledby="scenario-advanced-heading">
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

                <label className="scenario-field">
                  <InfoLabel label="Reference policy" info={SETTING_HELP.basePolicy} />
                  <select value={basePolicy} disabled={formDisabled} onChange={(event) => onBasePolicyChange(event.target.value as BasePolicyId)}>
                    {basePolicies.map((policy) => <option key={policy.id} value={policy.id}>{policy.title}</option>)}
                  </select>
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
          ) : (
          <aside className="scenario-summary" aria-labelledby="scenario-summary-heading">
            <p className="eyebrow">Live summary</p>
            <h3 id="scenario-summary-heading">{title.trim() || 'Untitled policy scenario'}</h3>
            <p>{scenarioSentence}</p>
            <dl>
              <div><dt>Reference policy</dt><dd>{selectedBasePolicy?.title ?? 'Not selected'}</dd></div>
              <div><dt>Policy type</dt><dd>{policyType === 'benchmark' ? 'Benchmark' : policyType === 'ltv' ? 'Loan-to-value restriction' : 'Loan-to-income flow restriction'}</dd></div>
              {policyType === 'ltv' && LTV_FIELDS.map((field) => (
                <div key={field.key}><dt>{field.label}</dt><dd>{formatValue(formValues[field.key], 'percentage')}</dd></div>
              ))}
              {policyType === 'lti' && LTI_FIELDS.map((field) => (
                <div key={field.key}><dt>{field.label}</dt><dd>{formatValue(formValues[field.key], field.unit)}</dd></div>
              ))}
            </dl>
            <div className="scenario-summary-advanced">
              <h4>Simulation</h4>
              <p>{advancedSummary.join(' · ')}</p>
              <p>Seeds are managed by the existing repeated-run process.</p>
            </div>
          </aside>
          )}
        </div>
        </>
      )}
    </article>
  );
}
