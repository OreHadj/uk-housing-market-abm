import { useMemo, useState } from 'react';
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
import { getModelAnchor } from '../../lib/modelAnchors';
import { CentralBankPolicyInput } from './CentralBankPolicyInput';
import { GeneralModelControl } from './GeneralModelControl';
import { InfoLabel } from './InfoLabel';
import { SETTING_HELP } from './settingHelp';

type FormValue = string | boolean;

interface ManualRunSetupCardProps {
  draftId?: string;
  draftNotice?: string;
  initialStep?: number;
  activeInstruments?: ReadonlySet<PolicyInstrumentId>;
  onActiveInstrumentsChange?: (value: ReadonlySet<PolicyInstrumentId>) => void;
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
  draftId = '',
  draftNotice = '',
  initialStep = 0,
  activeInstruments = new Set(),
  onActiveInstrumentsChange = () => {},
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
  const [activeStep, setActiveStep] = useState(() => Math.max(0, Math.min(4, initialStep)));
  const steps = [
    { id: 'scenario-details', label: 'Scenario name' },
    { id: 'model-evidence', label: 'Model version' },
    { id: 'baseline-policy', label: 'Baseline policy' },
    { id: 'policy-change', label: 'Policy change' },
    { id: 'technical-details', label: 'Technical details' }
  ] as const;
  const orderedSnapshots = orderExperimentModelOptions(snapshots, selectedBaseline);
  const selectedBasePolicy = basePolicies.find((policy) => policy.id === basePolicy);
  const selectedSnapshot = orderedSnapshots.find((snapshot) => snapshot.version === selectedBaseline);
  const selectedModelAnchor = getModelAnchor(selectedBaseline);
  const parametersByKey = useMemo(
    () => new Map(policyParameters.map((parameter) => [parameter.key, parameter])),
    [policyParameters]
  );
  const knownPolicyKeys = useMemo(() => new Set(parametersByKey.keys()), [parametersByKey]);

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
    onActiveInstrumentsChange(new Set());
    resetKeysToBaseline(INSTRUMENT_POLICY_KEYS);
  };

  const toggleInstrument = (id: PolicyInstrumentId) => {
    const instrument = findPolicyInstrument(id);
    if (!instrument) return;
    // Turning an instrument off returns its own fields to the baseline policy, so a collapsed section
    // can never leave a stale override in the submitted scenario.
    if (visibleInstruments.has(id)) {
      resetKeysToBaseline(instrument.keys);
      const next = new Set(activeInstruments);
        next.delete(id);
      onActiveInstrumentsChange(next);
      return;
    }
    onActiveInstrumentsChange(new Set(activeInstruments).add(id));
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
            <h2>Create a new policy scenario</h2>
            <p>Define the evidence, baseline and policy change, then review and run the matched comparison.</p>
          </div>
          {draftNotice && <p className="info-banner">{draftNotice}</p>}
          <nav className="scenario-stepper" aria-label="Scenario sections">
            {steps.map((step, index) => (
              <button key={step.id} type="button" onClick={() => setActiveStep(index)} aria-current={activeStep === index ? 'step' : undefined}>
                <span>{index + 1}</span>{step.label}
              </button>
            ))}
          </nav>
          <div className="scenario-builder-grid">
            <div className="scenario-builder-form">
              <section hidden={activeStep !== 0} id="scenario-details" className="scenario-section scenario-step-page" aria-labelledby="scenario-details-heading">
                <h3 id="scenario-details-heading">Scenario name</h3>
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

              <section hidden={activeStep !== 1} id="model-evidence" className="scenario-section scenario-step-page" aria-labelledby="model-evidence-heading">
                <h3 id="model-evidence-heading">Model version</h3>
                <p className="scenario-section-intro">
                  Choose the calibrated model used to run this scenario. Each version combines UK housing and household
                  inputs with behavioural parameters adjusted using observed UK housing statistics and survey data.
                </p>
                  <label className="scenario-field">
                    <InfoLabel label="Model version" info={SETTING_HELP.calibrationParameterVersion} />
                    <select
                      value={selectedBaseline}
                      disabled={formDisabled}
                      onChange={(event) => onBaselineChange(event.target.value)}
                    >
                      {orderedSnapshots.map((snapshot) => (
                        <option key={snapshot.version} value={snapshot.version}>
                          {formatExperimentModelOption(snapshot)}
                        </option>
                      ))}
                    </select>
                    {selectedSnapshot && (
                      <p className="scenario-evidence-note">
                        {selectedModelAnchor
                          ? `${selectedModelAnchor.dataYear} UK housing and household inputs · Behavioural parameters calibrated using ${selectedModelAnchor.fitYear} UK observations`
                          : `Saved model configuration ${selectedSnapshot.version}`}
                      </p>
                    )}
                    <p className="scenario-field-links">
                      <Link
                        className="summary-link-inline"
                        to={`/calibration?mode=single&version=${encodeURIComponent(selectedBaseline)}&from=scenario&draft=${encodeURIComponent(draftId)}&scenarioStep=model-version`}
                      >
                        Check the model&rsquo;s assumptions
                      </Link>
                      <Link
                        className="summary-link-inline"
                        to={`/validation?version=${encodeURIComponent(selectedBaseline)}&evidenceYear=${selectedSnapshot?.evidenceYear ?? 2024}&from=scenario&draft=${encodeURIComponent(draftId)}&scenarioStep=model-version`}
                      >
                        Check how well the model matches UK data
                      </Link>
                    </p>
                  </label>
              </section>

              <section hidden={activeStep !== 2} id="baseline-policy" className="scenario-section scenario-step-page" aria-labelledby="baseline-policy-heading">
                <h3 id="baseline-policy-heading">Baseline policy regime</h3>
                <p className="scenario-section-intro">The real-world rulebook the intervention departs from. It supplies the starting value for every policy setting.</p>
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
                {selectedBasePolicy ? (
                  <div className="scenario-reference-note">
                    <p>
                      <strong>{selectedBasePolicy.title}</strong>
                    </p>
                    <p>{selectedBasePolicy.summary}</p>
                  </div>
                ) : null}
              </section>

              <section hidden={activeStep !== 3} id="policy-change" className="scenario-section scenario-step-page" aria-labelledby="policy-change-heading">
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

              <section hidden={activeStep !== 4} id="technical-details" className="scenario-section scenario-step-page" aria-labelledby="technical-details-heading">
                  <div className="scenario-advanced-panel-heading">
                    <h3 id="technical-details-heading">Technical details</h3>
                    <p>
                      Advanced run settings control execution and output only. Your model and policy choices remain unchanged.
                    </p>
                  </div>
                  <div id="scenario-advanced-panel" className="scenario-advanced-panel scenario-advanced-panel--inline">
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
                  </div>

              </section>

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

              <div className="scenario-page-navigation" aria-label="Scenario page navigation">
                <div className="scenario-page-movement">
                  <button type="button" className="secondary-button" disabled={activeStep === 0} onClick={() => setActiveStep((step) => Math.max(0, step - 1))}>Back</button>
                  {activeStep < steps.length - 1 && <button type="button" className="secondary-button" onClick={() => setActiveStep((step) => Math.min(steps.length - 1, step + 1))}>Continue</button>}
                </div>
                <div className="scenario-persistent-run-action">
                  {warnings.length > 0 && (
                    <button type="button" className="secondary-button" disabled={isSubmitting || submissionDisabled || manualSubmissionLockedBySensitivity} onClick={() => onSubmit(true)}>Confirm and Queue</button>
                  )}
                  <button type="button" className="primary-button scenario-create-button" disabled={isSubmitting || submissionDisabled || manualSubmissionLockedBySensitivity} onClick={() => onSubmit(false)}>
                    {isSubmitting ? 'Running policy scenario...' : 'Run policy scenario'}
                  </button>
                </div>
              </div>
              <p className="scenario-matched-baseline-note">Results compare the intervention with a matched baseline using the same calibrated model and run settings.</p>
              {submissionDisabled && !manualSubmissionLockedBySensitivity && (
                <p className="scenario-submission-note">Run policy scenario is unavailable: {submissionDisabledReason}</p>
              )}
            </div>

            <aside className="scenario-summary" aria-labelledby="scenario-summary-heading">
              <p className="eyebrow">Live summary</p>
              <h3 id="scenario-summary-heading">{title.trim() || 'Untitled policy scenario'}</h3>
              <p>{scenarioSentence}</p>
              <dl>
                <div>
                  <dt>Calibrated model</dt>
                  <dd>{selectedSnapshot ? formatExperimentModelOption(selectedSnapshot) : selectedBaseline || 'Not selected'}</dd>
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
                    .filter((key) => parametersByKey.has(key) && changedPolicyKeys.has(key))
                    .map((key) => (
                      <div key={key}>
                        <dt>{policyLabel(key)} intervention delta</dt>
                        <dd>
                          {formatPolicyFieldValue(key, selectedBasePolicy?.values[key] === undefined ? undefined : String(selectedBasePolicy.values[key]))}
                          {' → '}{formatPolicyFieldValue(key, formValues[key])}
                        </dd>
                      </div>
                    ))
                )}
              </dl>
              <div className="scenario-summary-advanced">
                <h4>Run specification</h4>
                <p>{advancedSummary.join(' · ')}</p>
                <p>Matched-baseline comparison uses the same model, duration, repetitions and seed process.</p>
              </div>
            </aside>
          </div>
        </>
      )}
    </article>
  );
}
