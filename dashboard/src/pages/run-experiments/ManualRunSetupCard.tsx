import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  BasePolicyId,
  BasePolicyOption,
  ModelRunParameterDefinition,
  ModelRunSnapshotOption,
  ModelRunWarning
} from '../../../shared/types';
import { CENTRAL_BANK_POLICY_DISPLAY, formatPolicyValue } from '../../../shared/policyDisplay';
import {
  BENCHMARK_OPTION,
  INSTRUMENT_POLICY_KEYS,
  POLICY_INSTRUMENTS,
  changedInstrumentLabels,
  deriveChangedPolicyKeys,
  deriveVisibleInstruments,
  describeScenarioPolicy,
  findPolicyInstrument,
  type PolicyInstrumentId
} from '../../lib/manualScenarioPolicy';
import { formatExperimentModelOption, orderExperimentModelOptions } from '../../lib/experimentVersionOptions';
import { CentralBankPolicyInput } from './CentralBankPolicyInput';
import { GeneralModelControl } from './GeneralModelControl';
import { InfoLabel } from './InfoLabel';
import { SETTING_HELP } from './settingHelp';

type FormValue = string | boolean;

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

function policyLabel(key: string): string {
  return CENTRAL_BANK_POLICY_DISPLAY[key]?.label ?? key;
}

function formatPolicyFieldValue(key: string, value: FormValue | undefined): string {
  const display = CENTRAL_BANK_POLICY_DISPLAY[key];
  const parsed = numericValue(value);
  if (parsed === null) {
    return 'Not set';
  }
  return display ? formatPolicyValue(parsed, display.unit) : String(parsed);
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
  const [activeInstruments, setActiveInstruments] = useState<ReadonlySet<PolicyInstrumentId>>(new Set());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const orderedSnapshots = orderExperimentModelOptions(snapshots);
  const selectedBasePolicy = basePolicies.find((policy) => policy.id === basePolicy);
  const parametersByKey = useMemo(
    () => new Map(policyParameters.map((parameter) => [parameter.key, parameter])),
    [policyParameters]
  );
  const knownPolicyKeys = useMemo(() => new Set(parametersByKey.keys()), [parametersByKey]);

  // Switching the baseline policy rewrites every policy value to the new regime (the run controller
  // does this), so no override survives the switch. Clear the instrument selection to match, rather
  // than leaving sections open that no longer describe a change.
  useEffect(() => {
    setActiveInstruments(new Set());
  }, [basePolicy]);

  // Benchmark status is derived from the values themselves, not from which instruments are selected:
  // editing any policy field makes this a policy-change scenario immediately.
  const changedPolicyKeys = useMemo(
    () => deriveChangedPolicyKeys(formValues, selectedBasePolicy?.values, knownPolicyKeys),
    [formValues, knownPolicyKeys, selectedBasePolicy]
  );

  const isBenchmark = changedPolicyKeys.size === 0;

  // An instrument holding a changed value is always shown, even if it was never ticked, so a policy
  // override can never sit hidden behind a collapsed section.
  const visibleInstruments = useMemo(
    () => deriveVisibleInstruments(activeInstruments, changedPolicyKeys),
    [activeInstruments, changedPolicyKeys]
  );

  // The benchmark choice reflects both conditions: nothing changed *and* no instrument opened.
  // Selecting an instrument unticks it straight away, so the two choices never read as
  // simultaneously active while the user is part-way through setting a value.
  const benchmarkSelected = isBenchmark && visibleInstruments.size === 0;

  const resetKeysToBaseline = (keys: readonly string[]) => {
    if (!selectedBasePolicy) return;
    for (const key of keys) {
      const parameter = parametersByKey.get(key);
      const baseValue = selectedBasePolicy.values[key];
      if (parameter && baseValue !== undefined) {
        onFormValueChange(parameter, String(baseValue));
      }
    }
  };

  const selectBenchmark = () => {
    setActiveInstruments(new Set());
    resetKeysToBaseline(INSTRUMENT_POLICY_KEYS);
  };

  const toggleInstrument = (id: PolicyInstrumentId) => {
    const instrument = findPolicyInstrument(id);
    if (!instrument) return;
    // Turning an instrument off returns its own fields to the baseline policy, so a collapsed section
    // can never leave a stale override in the submitted scenario.
    if (visibleInstruments.has(id)) {
      resetKeysToBaseline(instrument.keys);
      setActiveInstruments((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      return;
    }
    setActiveInstruments((current) => new Set(current).add(id));
  };

  const scenarioSentence =
    isBenchmark && !benchmarkSelected
      ? 'Set a value on the selected instrument, or this scenario will run as the unchanged baseline policy.'
      : describeScenarioPolicy(changedPolicyKeys);
  const policyTypeSummary = isBenchmark
    ? BENCHMARK_OPTION.label
    : changedInstrumentLabels(changedPolicyKeys).join(' + ');

  const advancedSummary = [
    parameters.find((parameter) => parameter.key === 'N_STEPS') ? `${formValues.N_STEPS ?? '—'} simulation steps` : null,
    parameters.find((parameter) => parameter.key === 'N_SIMS') ? `${formValues.N_SIMS ?? '—'} repetitions` : null,
    `up to ${maxWorkers || '—'} parallel workers`
  ].filter(Boolean);

  const shownInstruments = POLICY_INSTRUMENTS.filter((instrument) => visibleInstruments.has(instrument.id));

  return (
    <article className="scenario-builder-surface">
      {manualSubmissionLockedBySensitivity && lockMessage && <p className="info-banner">{lockMessage}</p>}

      {isLoadingOptions ? (
        <p className="loading-banner">Loading scenario options...</p>
      ) : (
        <>
          <div className="scenario-builder-heading">
            <h2>Create a scenario</h2>
            <p>Choose the model baseline and the policy change, then create and queue the simulation.</p>
          </div>
          <div className="scenario-builder-grid">
            <div className="scenario-builder-form">
              <section className="scenario-section" aria-labelledby="scenario-details-heading">
                <h3 id="scenario-details-heading">Scenario details</h3>
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

              <section className="scenario-section" aria-labelledby="model-baseline-heading">
                <h3 id="model-baseline-heading">Model baseline</h3>
                <p className="scenario-section-intro">
                  What this scenario is run on. The calibration version is the model build itself — the calibrated
                  behavioural inputs — and normally stays at the recommended default. The baseline policy regime is the
                  real-world rulebook the change departs from, and sets the starting value of every policy setting
                  below.
                </p>
                <div className="scenario-fields-grid">
                  <label className="scenario-field">
                    <InfoLabel label="Calibration version" info={SETTING_HELP.calibrationParameterVersion} />
                    <select
                      value={selectedBaseline}
                      disabled={formDisabled}
                      onChange={(event) => onBaselineChange(event.target.value)}
                    >
                      {orderedSnapshots.map((snapshot) => (
                        <option key={snapshot.version} value={snapshot.version}>
                          {formatExperimentModelOption(snapshot, orderedSnapshots)}
                        </option>
                      ))}
                    </select>
                    <Link
                      className="summary-link-inline"
                      to={`/calibration?mode=single&version=${encodeURIComponent(selectedBaseline)}`}
                    >
                      View in Calibration
                    </Link>
                  </label>

                  <label className="scenario-field">
                    <InfoLabel label="Baseline policy regime" info={SETTING_HELP.basePolicy} />
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
                </div>
                {selectedBasePolicy ? (
                  <div className="scenario-reference-note">
                    <p>
                      <strong>{selectedBasePolicy.title}</strong>
                    </p>
                    <p>{selectedBasePolicy.summary}</p>
                  </div>
                ) : null}
              </section>

              <section className="scenario-section" aria-labelledby="policy-change-heading">
                <h3 id="policy-change-heading">Policy change</h3>
                <p className="scenario-section-intro">
                  Changes applied on top of the baseline policy. Select an instrument to reveal its settings; combine
                  instruments to test how they interact.
                </p>
                <div className="policy-choice-grid" role="group" aria-label="Policy change">
                  <label className={`policy-choice ${benchmarkSelected ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      name="policy-benchmark"
                      checked={benchmarkSelected}
                      disabled={formDisabled}
                      onChange={selectBenchmark}
                    />
                    <span>
                      <strong>{BENCHMARK_OPTION.label}</strong>
                      <small>{BENCHMARK_OPTION.description}</small>
                    </span>
                  </label>
                  {POLICY_INSTRUMENTS.map((instrument) => (
                    <label
                      className={`policy-choice ${visibleInstruments.has(instrument.id) ? 'selected' : ''}`}
                      key={instrument.id}
                    >
                      <input
                        type="checkbox"
                        name={`policy-${instrument.id}`}
                        value={instrument.id}
                        checked={visibleInstruments.has(instrument.id)}
                        disabled={formDisabled}
                        onChange={() => toggleInstrument(instrument.id)}
                      />
                      <span>
                        <strong>{instrument.label}</strong>
                        <small>{instrument.description}</small>
                      </span>
                    </label>
                  ))}
                </div>

                {shownInstruments.map((instrument) => (
                  <div
                    key={instrument.id}
                    className="scenario-instrument-panel"
                    aria-labelledby={`instrument-${instrument.id}-heading`}
                  >
                    <h4 id={`instrument-${instrument.id}-heading`}>{instrument.heading}</h4>
                    <p className="scenario-section-intro">{instrument.intro}</p>
                    <div className="scenario-fields-grid">
                      {instrument.keys.map((key) => {
                        const parameter = parametersByKey.get(key);
                        if (!parameter) {
                          return null;
                        }
                        const baseValue = selectedBasePolicy?.values[key];
                        const baseText = formatPolicyFieldValue(
                          key,
                          baseValue === undefined ? undefined : String(baseValue)
                        );
                        const isChanged = changedPolicyKeys.has(key);
                        return (
                          <div key={key} className={`scenario-policy-field ${isChanged ? 'is-overridden' : ''}`}>
                            <CentralBankPolicyInput
                              parameter={parameter}
                              label={policyLabel(key)}
                              value={formValues[key]}
                              basePolicyValue={baseValue}
                              executionDisabled={formDisabled}
                              mode="manual"
                              onChange={onFormValueChange}
                            />
                            <p className="scenario-policy-baseline-note">
                              {isChanged ? (
                                <>
                                  <span className="scenario-policy-changed-chip">Override</span>
                                  {`baseline ${baseText}`}
                                </>
                              ) : (
                                `Baseline value: ${baseText}`
                              )}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>

              <button
                type="button"
                className={`scenario-advanced-toggle ${advancedOpen ? 'active' : ''}`}
                aria-expanded={advancedOpen}
                aria-controls="scenario-advanced-panel"
                onClick={() => setAdvancedOpen((open) => !open)}
              >
                <span>Advanced simulation settings</span>
                <span aria-hidden="true">{advancedOpen ? '−' : '+'}</span>
              </button>

              {advancedOpen && (
                <aside
                  id="scenario-advanced-panel"
                  className="scenario-advanced-panel scenario-advanced-panel--inline"
                  aria-labelledby="scenario-advanced-heading"
                >
                  <div className="scenario-advanced-panel-heading">
                    <p className="eyebrow">Advanced</p>
                    <h3 id="scenario-advanced-heading">Simulation settings</h3>
                    <p>
                      Execution and output settings only. The model baseline and every policy setting are chosen above.
                    </p>
                  </div>
                  <div className="scenario-advanced-content">
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
                  </div>
                </aside>
              )}

              {warnings.length > 0 && (
                <div className="run-warning-card">
                  <h4>Warnings detected</h4>
                  <p>Confirm to submit anyway.</p>
                  <ul>
                    {warnings.map((warning) => (
                      <li key={`${warning.code}-${warning.message}`}>{warning.message}</li>
                    ))}
                  </ul>
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
                <div>
                  <dt>Calibration version</dt>
                  <dd>{selectedBaseline || 'Not selected'}</dd>
                </div>
                <div>
                  <dt>Baseline policy regime</dt>
                  <dd>{selectedBasePolicy?.title ?? 'Not selected'}</dd>
                </div>
                <div>
                  <dt>Policy change</dt>
                  <dd>{policyTypeSummary}</dd>
                </div>
                {shownInstruments.flatMap((instrument) =>
                  instrument.keys
                    .filter((key) => parametersByKey.has(key))
                    .map((key) => (
                      <div key={key}>
                        <dt>{policyLabel(key)}</dt>
                        <dd>
                          {formatPolicyFieldValue(key, formValues[key])}
                          {changedPolicyKeys.has(key) && <span className="scenario-summary-changed"> changed</span>}
                        </dd>
                      </div>
                    ))
                )}
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
