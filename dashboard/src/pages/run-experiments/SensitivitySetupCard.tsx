import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  BasePolicyId,
  BasePolicyOption,
  ModelRunParameterDefinition,
  ModelRunSnapshotOption,
  ModelRunWarning,
  SensitivityPolicyPackageDefinition
} from '../../../shared/types';
import {
  formatEvidenceNote,
  formatExperimentModelOption,
  orderExperimentModelOptions
} from '../../lib/experimentVersionOptions';
import { GeneralModelControl, isRecordSetting } from './GeneralModelControl';
import { InfoLabel } from './InfoLabel';
import { SETTING_HELP } from './settingHelp';

interface SensitivitySetupCardProps {
  draftId?: string;
  initialStep?: number;
  executionDisabled: boolean;
  isLoadingOptions: boolean;
  selectedBaseline: string;
  onBaselineChange: (baseline: string) => void;
  snapshots: ModelRunSnapshotOption[];
  basePolicies: BasePolicyOption[];
  basePolicy: BasePolicyId;
  onBasePolicyChange: (basePolicy: BasePolicyId) => void;
  policyPackages: SensitivityPolicyPackageDefinition[];
  policyPackageId: string;
  onPolicyPackageChange: (value: string) => void;
  minValue: string;
  maxValue: string;
  onMinValueChange: (value: string) => void;
  onMaxValueChange: (value: string) => void;
  sampleCount: string;
  onSampleCountChange: (value: string) => void;
  parameters: ModelRunParameterDefinition[];
  formValues: Record<string, string | boolean>;
  onFormValueChange: (parameter: ModelRunParameterDefinition, value: string | boolean) => void;
  maxWorkers: string;
  maxWorkersCap?: number;
  onMaxWorkersChange: (value: string) => void;
  title: string;
  onTitleChange: (value: string) => void;
  selectedPackage: SensitivityPolicyPackageDefinition | null;
  warnings: ModelRunWarning[];
  isSubmitting: boolean;
  isCanceling: boolean;
  sensitivitySubmissionLockedByManual: boolean;
  lockMessage: string | null;
  hasActiveSensitivityJob: boolean;
  onSubmit: (confirmWarnings: boolean) => void;
  onCancelActive: () => void;
}

const SENSITIVITY_STEPS = [
  { id: 'sensitivity-details', label: 'Experiment details' },
  { id: 'sensitivity-sweep', label: 'Define the sweep' },
  { id: 'sensitivity-model-baseline', label: 'Model and baseline' },
  { id: 'sensitivity-run-settings', label: 'Run and recording' },
  { id: 'sensitivity-review', label: 'Review and start' }
] as const;

const POSITIVE_RUN_CONTROL_KEYS = new Set([
  'N_STEPS',
  'N_SIMS',
  'TARGET_POPULATION',
  'ROLLING_WINDOW_SIZE_FOR_CORE_INDICATORS'
]);

export function validateSensitivityExperimentDetails(title: string): string | null {
  return title.trim() ? null : 'Enter an experiment name before continuing.';
}

export function validateSensitivitySweepDefinition(
  selectedPackage: SensitivityPolicyPackageDefinition | null,
  minValue: string,
  maxValue: string,
  sampleCount: string
): string | null {
  if (!selectedPackage) {
    return 'Choose a policy instrument to vary.';
  }
  const min = Number.parseFloat(minValue);
  const max = Number.parseFloat(maxValue);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return 'Enter numeric minimum and maximum values.';
  }
  if (!(min < max)) {
    return 'Minimum value must be lower than maximum value.';
  }
  const count = Number.parseFloat(sampleCount);
  if (!Number.isFinite(count) || !Number.isInteger(count) || count < 2) {
    return 'Sample count must be a whole number of at least 2.';
  }
  return null;
}

export function validateSensitivityModelAndBaseline(
  selectedSnapshot: ModelRunSnapshotOption | null,
  selectedBasePolicy: BasePolicyOption | null,
  selectedPackage: SensitivityPolicyPackageDefinition | null,
  minValue: string,
  maxValue: string
): string | null {
  if (!selectedSnapshot) {
    return 'Choose a model version.';
  }
  if (!selectedBasePolicy) {
    return 'Choose a baseline policy.';
  }
  if (!selectedPackage) {
    return 'Return to Define the sweep and choose a policy instrument.';
  }

  const min = Number.parseFloat(minValue);
  const max = Number.parseFloat(maxValue);
  const baselineValues = getPackageBaseValues(selectedPackage, selectedBasePolicy);
  if (
    baselineValues.length !== selectedPackage.parameterKeys.length ||
    baselineValues.some((value) => value < min || value > max)
  ) {
    return `The ${selectedBasePolicy.title} value for this instrument must fall inside the sweep range. Return to Define the sweep or choose another baseline policy.`;
  }
  return null;
}

export function validateSensitivityRunSettings(
  parameters: ModelRunParameterDefinition[],
  formValues: Record<string, string | boolean>,
  maxWorkers: string,
  maxWorkersCap?: number
): string | null {
  for (const parameter of parameters) {
    if (parameter.group !== 'General model control' || parameter.key === 'SEED' || isRecordSetting(parameter)) {
      continue;
    }
    if (parameter.type === 'boolean') {
      continue;
    }
    const parsed = Number.parseFloat(String(formValues[parameter.key] ?? ''));
    if (!Number.isFinite(parsed)) {
      return `${parameter.title} must be numeric.`;
    }
    if (parameter.type === 'integer' && !Number.isInteger(parsed)) {
      return `${parameter.title} must be a whole number.`;
    }
    if (POSITIVE_RUN_CONTROL_KEYS.has(parameter.key) && parsed < 1) {
      return `${parameter.title} must be at least 1.`;
    }
  }

  const workers = Number.parseFloat(maxWorkers);
  if (!Number.isFinite(workers) || !Number.isInteger(workers) || workers < 1) {
    return 'Max workers must be a whole number of at least 1.';
  }
  if (maxWorkersCap !== undefined && workers > maxWorkersCap) {
    return `Max workers cannot exceed ${maxWorkersCap} in this runtime.`;
  }
  return null;
}

export function SensitivitySetupCard({
  draftId = '',
  initialStep = 0,
  executionDisabled,
  isLoadingOptions,
  selectedBaseline,
  onBaselineChange,
  snapshots,
  basePolicies,
  basePolicy,
  onBasePolicyChange,
  policyPackages,
  policyPackageId,
  onPolicyPackageChange,
  minValue,
  maxValue,
  onMinValueChange,
  onMaxValueChange,
  sampleCount,
  onSampleCountChange,
  parameters,
  formValues,
  onFormValueChange,
  maxWorkers,
  maxWorkersCap,
  onMaxWorkersChange,
  title,
  onTitleChange,
  selectedPackage,
  warnings,
  isSubmitting,
  isCanceling,
  sensitivitySubmissionLockedByManual,
  lockMessage,
  hasActiveSensitivityJob,
  onSubmit,
  onCancelActive
}: SensitivitySetupCardProps) {
  const normalizedInitialStep = Math.max(0, Math.min(SENSITIVITY_STEPS.length - 1, initialStep));
  const [activeStep, setActiveStep] = useState(normalizedInitialStep);
  const [stepError, setStepError] = useState('');
  const stepErrorRef = useRef<HTMLParagraphElement>(null);
  const orderedSnapshots = orderExperimentModelOptions(snapshots, selectedBaseline);
  const selectedSnapshot = orderedSnapshots.find((snapshot) => snapshot.version === selectedBaseline) ?? null;
  const selectedBasePolicy = basePolicies.find((policy) => policy.id === basePolicy) ?? null;
  const sampleValues = buildSensitivitySampleValues(selectedPackage, selectedBasePolicy, minValue, maxValue, sampleCount);
  const basePolicyValues = selectedPackage && selectedBasePolicy ? formatPackageBaseValues(selectedPackage, selectedBasePolicy) : null;
  const simulationDuration = String(formValues.N_STEPS ?? '');
  const seedsPerPoint = parsePositiveIntegerForDisplay(formValues.N_SIMS);
  // Fields stay editable when execution is unavailable; only starting a run is gated, matching the policy builder.
  const formDisabled = isSubmitting;
  const submissionBlocked = isSubmitting || executionDisabled || sensitivitySubmissionLockedByManual;

  const pointCount = sampleValues.length;
  const sweepSentence = (() => {
    if (!selectedPackage) {
      return 'Choose a policy instrument and range to define the analysis.';
    }
    if (pointCount === 0) {
      return `This experiment varies ${selectedPackage.title}. Enter a valid min, max, and sample count to see the values tested.`;
    }
    const baseName = selectedBasePolicy?.title ?? 'the baseline policy';
    return `This experiment varies ${selectedPackage.title} across ${pointCount} value${
      pointCount === 1 ? '' : 's'
    }; every other instrument stays at the ${baseName} value.`;
  })();

  const totalExecutions = pointCount > 0 && seedsPerPoint !== null ? pointCount * seedsPerPoint : 0;

  useEffect(() => {
    if (stepError) {
      stepErrorRef.current?.focus();
    }
  }, [stepError]);

  const validateStep = (step: number): string | null => {
    if (step === 0) return validateSensitivityExperimentDetails(title);
    if (step === 1) return validateSensitivitySweepDefinition(selectedPackage, minValue, maxValue, sampleCount);
    if (step === 2) {
      return validateSensitivityModelAndBaseline(
        selectedSnapshot,
        selectedBasePolicy,
        selectedPackage,
        minValue,
        maxValue
      );
    }
    if (step === 3) return validateSensitivityRunSettings(parameters, formValues, maxWorkers, maxWorkersCap);
    return null;
  };

  const firstInvalidStepThrough = (lastStep: number): { step: number; message: string } | null => {
    for (let step = 0; step <= Math.min(lastStep, SENSITIVITY_STEPS.length - 2); step += 1) {
      const message = validateStep(step);
      if (message) return { step, message };
    }
    return null;
  };

  const navigateToStep = (nextStep: number) => {
    setStepError('');
    setActiveStep(nextStep);
  };

  const continueToNextStep = () => {
    const invalid = firstInvalidStepThrough(activeStep);
    if (invalid) {
      setActiveStep(invalid.step);
      setStepError(invalid.message);
      return;
    }
    navigateToStep(Math.min(SENSITIVITY_STEPS.length - 1, activeStep + 1));
  };

  const submitFromReview = (confirmWarnings: boolean) => {
    const invalid = firstInvalidStepThrough(SENSITIVITY_STEPS.length - 2);
    if (invalid) {
      setActiveStep(invalid.step);
      setStepError(invalid.message);
      return;
    }
    onSubmit(confirmWarnings);
  };

  const clearValidationError = () => setStepError('');

  return (
    <article className="scenario-builder-surface">
      {sensitivitySubmissionLockedByManual && lockMessage && <p className="info-banner">{lockMessage}</p>}

      {isLoadingOptions ? (
        <p className="loading-banner">Loading sensitivity analysis options...</p>
      ) : (
        <>
          <div className="scenario-builder-heading">
            <h2>Create a sensitivity analysis</h2>
            <p>Define the sweep, choose the model and baseline, configure the run, then review it before starting.</p>
          </div>
          <nav className="scenario-stepper sensitivity-stepper" aria-label="Sensitivity analysis sections">
            {SENSITIVITY_STEPS.map((step, index) => (
              <button
                key={step.id}
                type="button"
                aria-current={activeStep === index ? 'step' : undefined}
                onClick={() => navigateToStep(index)}
              >
                <span>{index + 1}</span>{step.label}
              </button>
            ))}
          </nav>
          <div className="scenario-builder-grid">
            <div className="scenario-builder-form">
              {stepError && (
                <p ref={stepErrorRef} className="sensitivity-step-error" role="alert" tabIndex={-1}>
                  {stepError}
                </p>
              )}

              <section hidden={activeStep !== 0} id="sensitivity-details" className="scenario-section scenario-step-page" aria-labelledby="sensitivity-details-heading">
                <h3 id="sensitivity-details-heading">Experiment details</h3>
                <p className="scenario-section-intro">Give this analysis a clear name so it is easy to find in Results.</p>
                <label className="scenario-field">
                  <span>Experiment name</span>
                  <input
                    type="text"
                    value={title}
                    disabled={formDisabled}
                    onChange={(event) => {
                      clearValidationError();
                      onTitleChange(event.target.value);
                    }}
                    maxLength={120}
                    required
                    aria-invalid={activeStep === 0 && Boolean(stepError)}
                    placeholder="For example, Soft LTI limit sweep"
                  />
                </label>
              </section>

              <section hidden={activeStep !== 1} id="sensitivity-sweep" className="scenario-section scenario-step-page" aria-labelledby="sensitivity-sweep-heading">
                <h3 id="sensitivity-sweep-heading">Define the sweep</h3>
                <p className="scenario-section-intro">Choose one policy instrument and the range of values to test.</p>
                <label className="scenario-field">
                  <InfoLabel label="Policy instrument to vary" info={SETTING_HELP.sensitivityPolicyPackage} />
                  <select
                    value={policyPackageId}
                    disabled={formDisabled}
                    onChange={(event) => {
                      clearValidationError();
                      onPolicyPackageChange(event.target.value);
                    }}
                  >
                    {policyPackages.map((policyPackage) => (
                      <option key={policyPackage.id} value={policyPackage.id}>
                        {policyPackage.title}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedPackage ? <p className="scenario-section-intro">{selectedPackage.description}</p> : null}
                <div className="scenario-fields-grid">
                  <label className="scenario-field">
                    <InfoLabel label="Min value" info={SETTING_HELP.minValue} />
                    <input
                      type="number"
                      step={selectedPackage?.type === 'integer' ? 1 : 'any'}
                      value={minValue}
                      disabled={formDisabled}
                      onChange={(event) => {
                        clearValidationError();
                        onMinValueChange(event.target.value);
                      }}
                    />
                  </label>
                  <label className="scenario-field">
                    <InfoLabel label="Max value" info={SETTING_HELP.maxValue} />
                    <input
                      type="number"
                      step={selectedPackage?.type === 'integer' ? 1 : 'any'}
                      value={maxValue}
                      disabled={formDisabled}
                      onChange={(event) => {
                        clearValidationError();
                        onMaxValueChange(event.target.value);
                      }}
                    />
                  </label>
                  <label className="scenario-field">
                    <InfoLabel label="Sample count" info={SETTING_HELP.sampleCount} />
                    <input
                      type="number"
                      step={1}
                      min={2}
                      value={sampleCount}
                      disabled={formDisabled}
                      onChange={(event) => {
                        clearValidationError();
                        onSampleCountChange(event.target.value);
                      }}
                    />
                  </label>
                </div>
                <div className="sensitivity-sweep-preview" aria-live="polite">
                  <strong>Values that will be tested</strong>
                  {sampleValues.length > 0 ? (
                    <ul className="sensitivity-sampled-values">
                      {sampleValues.map((value) => <li key={value}>{value}</li>)}
                    </ul>
                  ) : (
                    <p>Enter a valid minimum, maximum and sample count to preview the sampled values.</p>
                  )}
                  <p>{sweepSentence}</p>
                </div>
              </section>

              <section hidden={activeStep !== 2} id="sensitivity-model-baseline" className="scenario-section scenario-step-page" aria-labelledby="sensitivity-model-baseline-heading">
                <h3 id="sensitivity-model-baseline-heading">Model and baseline</h3>
                <p className="scenario-section-intro">
                  Choose the calibrated model and reference policy. Every instrument not being swept remains at the selected baseline-policy value.
                </p>
                <label className="scenario-field">
                  <InfoLabel label="Model version" info={SETTING_HELP.calibrationParameterVersion} />
                  <select
                    value={selectedBaseline}
                    disabled={formDisabled}
                    onChange={(event) => {
                      clearValidationError();
                      onBaselineChange(event.target.value);
                    }}
                  >
                    {orderedSnapshots.map((snapshot) => (
                      <option key={snapshot.version} value={snapshot.version}>
                        {formatExperimentModelOption(snapshot)}
                      </option>
                    ))}
                  </select>
                  {selectedSnapshot && <p className="scenario-evidence-note">{formatEvidenceNote(selectedSnapshot)}</p>}
                  <p className="scenario-field-links">
                    <Link
                      className="summary-link-inline"
                      to={`/calibration?mode=single&version=${encodeURIComponent(selectedBaseline)}&from=sensitivity&draft=${encodeURIComponent(draftId)}&sensitivityStep=model-baseline`}
                    >
                      View this model&rsquo;s assumptions
                    </Link>
                    <Link
                      className="summary-link-inline"
                      to={`/validation?version=${encodeURIComponent(selectedBaseline)}&evidenceYear=${
                        selectedSnapshot?.evidenceYear ?? 2024
                      }&from=sensitivity&draft=${encodeURIComponent(draftId)}&sensitivityStep=model-baseline`}
                    >
                      Compare how models fit the evidence
                    </Link>
                  </p>
                </label>
                <label className="scenario-field">
                  <InfoLabel label="Baseline policy" info={SETTING_HELP.basePolicy} />
                  <select
                    value={basePolicy}
                    disabled={formDisabled}
                    onChange={(event) => {
                      clearValidationError();
                      onBasePolicyChange(event.target.value as BasePolicyId);
                    }}
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

              <section hidden={activeStep !== 3} id="sensitivity-run-settings" className="scenario-section scenario-step-page" aria-labelledby="sensitivity-run-settings-heading">
                <h3 id="sensitivity-run-settings-heading">Run and recording settings</h3>
                <p className="scenario-section-intro">
                  Set the simulation workload first. Recording is fixed to the summaries retained by sensitivity results.
                </p>
                <div className="scenario-advanced-panel scenario-advanced-panel--inline">
                  <div className="scenario-advanced-content">
                    <h4>Run settings</h4>
                    <GeneralModelControl
                      mode="sensitivity"
                      parameters={parameters}
                      formValues={formValues}
                      executionDisabled={formDisabled}
                      onFormValueChange={(parameter, value) => {
                        clearValidationError();
                        onFormValueChange(parameter, value);
                      }}
                      maxWorkers={maxWorkers}
                      maxWorkersCap={maxWorkersCap}
                      onMaxWorkersChange={(value) => {
                        clearValidationError();
                        onMaxWorkersChange(value);
                      }}
                      maxWorkersHint={SETTING_HELP.maxWorkers}
                      includeFixedControls
                      embedded
                    />
                  </div>
                </div>
              </section>

              <section hidden={activeStep !== 4} id="sensitivity-review" className="scenario-section scenario-step-page" aria-labelledby="sensitivity-review-heading">
                <h3 id="sensitivity-review-heading">Review and start</h3>
                <p className="scenario-section-intro">Check the complete analysis specification before starting any model executions.</p>
                <dl className="sensitivity-review-list">
                  <div><dt>Experiment name</dt><dd>{title.trim() || 'Not set'}</dd></div>
                  <div><dt>Policy instrument</dt><dd>{selectedPackage?.title ?? 'Not set'}</dd></div>
                  <div><dt>Sweep range</dt><dd>{minValue || '—'} to {maxValue || '—'} ({sampleCount || '—'} requested samples)</dd></div>
                  <div className="sensitivity-review-wide">
                    <dt>Actual sampled values</dt>
                    <dd>{sampleValues.length > 0 ? sampleValues.join(', ') : 'Not available'}</dd>
                  </div>
                  <div><dt>Model</dt><dd>{selectedSnapshot ? formatExperimentModelOption(selectedSnapshot) : 'Not set'}</dd></div>
                  <div><dt>Baseline policy</dt><dd>{selectedBasePolicy?.title ?? 'Not set'}</dd></div>
                  <div><dt>Simulation duration</dt><dd>{simulationDuration ? `${simulationDuration} steps` : 'Not set'}</dd></div>
                  <div><dt>Seeds per sampled point</dt><dd>{seedsPerPoint ?? 'Not set'}</dd></div>
                  <div><dt>Max workers</dt><dd>{maxWorkers || 'Not set'}</dd></div>
                  <div className="sensitivity-review-wide">
                    <dt>Recording configuration</dt>
                    <dd>Dashboard outcomes enabled; raw transaction, bid-up, quality-band and household files are not retained.</dd>
                  </div>
                </dl>
                <div className="sensitivity-execution-total" aria-live="polite">
                  <strong>{totalExecutions || '—'}</strong>
                  <span>Total model executions</span>
                  <small>
                    {pointCount || '—'} unique sampled {pointCount === 1 ? 'point' : 'points'} × {seedsPerPoint ?? '—'} {seedsPerPoint === 1 ? 'seed' : 'seeds'} per point
                  </small>
                </div>
                {warnings.length > 0 && (
                  <div className="run-warning-card">
                    <h4>Warnings detected</h4>
                    <p>Confirm to start anyway.</p>
                    <ul>
                      {warnings.map((warning) => (
                        <li key={`${warning.code}-${warning.message}`}>{warning.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              <div className="scenario-page-navigation" aria-label="Sensitivity analysis page navigation">
                <div className="scenario-page-movement">
                  <button
                    type="button"
                    className="secondary-button scenario-wizard-arrow-button"
                    disabled={activeStep === 0}
                    aria-label="Back to previous step"
                    title="Back to previous step"
                    onClick={() => navigateToStep(Math.max(0, activeStep - 1))}
                  >
                    <span aria-hidden="true">←</span>
                  </button>
                  {activeStep < SENSITIVITY_STEPS.length - 1 && (
                    <button
                      type="button"
                      className="secondary-button scenario-wizard-arrow-button"
                      aria-label="Continue to next step"
                      title="Continue to next step"
                      onClick={continueToNextStep}
                    >
                      <span aria-hidden="true">→</span>
                    </button>
                  )}
                </div>
                <div className="scenario-persistent-run-action">
                  {hasActiveSensitivityJob && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={isCanceling || executionDisabled}
                      onClick={onCancelActive}
                    >
                      {isCanceling ? 'Canceling...' : 'Cancel active experiment'}
                    </button>
                  )}
                  {activeStep === SENSITIVITY_STEPS.length - 1 && (
                    <button
                      type="button"
                      className="primary-button scenario-create-button"
                      disabled={submissionBlocked}
                      onClick={() => submitFromReview(warnings.length > 0)}
                    >
                      {isSubmitting
                        ? 'Starting...'
                        : warnings.length > 0
                          ? 'Confirm and start'
                          : 'Start sensitivity analysis'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <aside className="scenario-summary" aria-labelledby="sensitivity-summary-heading">
              <p className="eyebrow">Live summary</p>
              <h3 id="sensitivity-summary-heading">{title.trim() || 'Untitled sensitivity analysis'}</h3>
              <p>{sweepSentence}</p>
              <dl>
                <div>
                  <dt>Instrument varied</dt>
                  <dd>{selectedPackage ? selectedPackage.title : 'No instrument selected'}</dd>
                </div>
                <div>
                  <dt>Baseline policy</dt>
                  <dd>{selectedBasePolicy ? selectedBasePolicy.title : 'Not set'}</dd>
                </div>
                <div>
                  <dt>Baseline policy values</dt>
                  <dd>{basePolicyValues ?? 'Not set'}</dd>
                </div>
                <div>
                  <dt>Values tested</dt>
                  <dd>{sampleValues.length > 0 ? sampleValues.join(', ') : 'Enter a valid min, max, and sample count.'}</dd>
                </div>
                <div>
                  <dt>Monte Carlo runs per point</dt>
                  <dd>{seedsPerPoint ?? 'Not set'}</dd>
                </div>
                <div>
                  <dt>Model version</dt>
                  <dd>{selectedSnapshot ? formatExperimentModelOption(selectedSnapshot) : selectedBaseline}</dd>
                </div>
                <div>
                  <dt>Simulation duration</dt>
                  <dd>{simulationDuration ? `${simulationDuration} steps` : 'Not set'}</dd>
                </div>
                <div>
                  <dt>Workers parallelised across</dt>
                  <dd>{maxWorkers || 'Not set'}</dd>
                </div>
                <div>
                  <dt>Total model executions</dt>
                  <dd>{totalExecutions || 'Not available'}</dd>
                </div>
                <div>
                  <dt>Recording</dt>
                  <dd>Dashboard outcomes only</dd>
                </div>
              </dl>
            </aside>
          </div>
        </>
      )}
    </article>
  );
}

export function buildSensitivitySampleValues(
  policyPackage: SensitivityPolicyPackageDefinition | null,
  basePolicy: BasePolicyOption | null,
  minRaw: string,
  maxRaw: string,
  sampleCountRaw: string
): string[] {
  if (!policyPackage || !basePolicy) {
    return [];
  }

  const min = Number.parseFloat(minRaw);
  const max = Number.parseFloat(maxRaw);
  const baseValues = getPackageBaseValues(policyPackage, basePolicy);
  const baseline = getCommonValue(baseValues);
  const sampleCount = Number.parseFloat(sampleCountRaw);
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    !Number.isFinite(sampleCount) ||
    !Number.isInteger(sampleCount) ||
    sampleCount < 2 ||
    !(min < max)
  ) {
    return [];
  }

  const normalize = (value: number) => {
    const rounded = policyPackage.type === 'integer' ? Math.round(value) : value;
    return Object.is(rounded, -0) ? 0 : rounded;
  };
  const values = new Set<number>();
  for (let index = 0; index < sampleCount; index += 1) {
    const value = index === sampleCount - 1 ? max : min + ((max - min) * index) / (sampleCount - 1);
    values.add(normalize(value));
  }
  if (baseline !== null && baseline >= min && baseline <= max) {
    values.add(normalize(baseline));
  }

  const formattedValues = [...values]
    .sort((left, right) => left - right)
    .map((value) => formatPolicyValue(value, policyPackage.type));
  const usesDistinctBaseValues = baseline === null && baseValues.every((value) => value >= min && value <= max);
  return usesDistinctBaseValues ? [`baseline policy values (${formatPackageBaseValues(policyPackage, basePolicy)})`, ...formattedValues] : formattedValues;
}

function parsePositiveIntegerForDisplay(value: string | boolean | undefined): number | null {
  if (typeof value === 'boolean') return null;
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function getPackageBaseValues(policyPackage: SensitivityPolicyPackageDefinition, basePolicy: BasePolicyOption): number[] {
  return policyPackage.parameterKeys
    .map((parameterKey) => Number(basePolicy.values[parameterKey]))
    .filter((value) => Number.isFinite(value));
}

function getCommonValue(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const [firstValue] = values;
  return values.every((value) => value === firstValue) ? firstValue : null;
}

function formatPackageBaseValues(policyPackage: SensitivityPolicyPackageDefinition, basePolicy: BasePolicyOption): string {
  const values = getPackageBaseValues(policyPackage, basePolicy);
  if (values.length === 0) {
    return 'Not set';
  }
  const commonValue = getCommonValue(values);
  if (commonValue !== null) {
    return formatPolicyValue(commonValue, policyPackage.type);
  }
  return values.map((value) => formatPolicyValue(value, policyPackage.type)).join(', ');
}

function formatPolicyValue(value: number, type: SensitivityPolicyPackageDefinition['type']): string {
  const normalized = type === 'integer' ? Math.round(value) : value;
  return Number.isInteger(normalized) ? String(normalized) : String(Number(normalized.toFixed(6)));
}
