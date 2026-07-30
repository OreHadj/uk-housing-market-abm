import { useState } from 'react';
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
import { GeneralModelControl } from './GeneralModelControl';
import { InfoLabel } from './InfoLabel';
import { SETTING_HELP } from './settingHelp';

interface SensitivitySetupCardProps {
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

export function SensitivitySetupCard({
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const orderedSnapshots = orderExperimentModelOptions(snapshots);
  const selectedSnapshot = orderedSnapshots.find((snapshot) => snapshot.version === selectedBaseline) ?? null;
  const selectedBasePolicy = basePolicies.find((policy) => policy.id === basePolicy) ?? null;
  const sampleValues = buildSensitivitySampleValues(selectedPackage, selectedBasePolicy, minValue, maxValue, sampleCount);
  const basePolicyValues = selectedPackage && selectedBasePolicy ? formatPackageBaseValues(selectedPackage, selectedBasePolicy) : null;
  const simulationDuration = String(formValues.N_STEPS ?? '');
  const monteCarloRuns = String(formValues.N_SIMS ?? '');
  const submissionBlocked =
    isSubmitting || executionDisabled || sensitivitySubmissionLockedByManual || hasActiveSensitivityJob;

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

  return (
    <article className="scenario-builder-surface">
      {sensitivitySubmissionLockedByManual && lockMessage && <p className="info-banner">{lockMessage}</p>}

      {isLoadingOptions ? (
        <p className="loading-banner">Loading sensitivity analysis options...</p>
      ) : (
        <>
          <div className="scenario-builder-heading">
            <h2>Create a sensitivity analysis</h2>
            <p>Vary one policy instrument across a range and compare each tested value with the selected baseline policy.</p>
          </div>
          <div className="scenario-builder-grid">
            <div className="scenario-builder-form">
              <section className="scenario-section">
                <h3>Experiment details</h3>
                <label className="scenario-field">
                  <span>Experiment name</span>
                  <input
                    type="text"
                    value={title}
                    disabled={executionDisabled}
                    onChange={(event) => onTitleChange(event.target.value)}
                    maxLength={120}
                    placeholder="For example, Soft LTI limit sweep"
                  />
                </label>
              </section>

              <section className="scenario-section">
                <h3>Policy instrument</h3>
                <p className="scenario-section-intro">Choose the policy instrument to vary and the range of values to test.</p>
                <label className="scenario-field">
                  <InfoLabel label="Policy instrument to vary" info={SETTING_HELP.sensitivityPolicyPackage} />
                  <select
                    value={policyPackageId}
                    disabled={executionDisabled}
                    onChange={(event) => onPolicyPackageChange(event.target.value)}
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
                      disabled={executionDisabled}
                      onChange={(event) => onMinValueChange(event.target.value)}
                    />
                  </label>
                  <label className="scenario-field">
                    <InfoLabel label="Max value" info={SETTING_HELP.maxValue} />
                    <input
                      type="number"
                      step={selectedPackage?.type === 'integer' ? 1 : 'any'}
                      value={maxValue}
                      disabled={executionDisabled}
                      onChange={(event) => onMaxValueChange(event.target.value)}
                    />
                  </label>
                  <label className="scenario-field">
                    <InfoLabel label="Sample count" info={SETTING_HELP.sampleCount} />
                    <input
                      type="number"
                      step={1}
                      min={2}
                      value={sampleCount}
                      disabled={executionDisabled}
                      onChange={(event) => onSampleCountChange(event.target.value)}
                    />
                  </label>
                </div>
              </section>

              <section className="scenario-section">
                <h3>Baseline policy</h3>
                <p className="scenario-section-intro">Every instrument that isn&apos;t being varied stays at this policy&apos;s value.</p>
                <label className="scenario-field">
                  <InfoLabel label="Baseline policy" info={SETTING_HELP.basePolicy} />
                  <select
                    value={basePolicy}
                    disabled={executionDisabled}
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
                <div className="scenario-advanced-panel scenario-advanced-panel--inline">
                  <div className="scenario-advanced-panel-heading">
                    <p className="eyebrow">Advanced</p>
                    <h3>Simulation settings</h3>
                    <p>Configure execution details without changing the analysis itself.</p>
                  </div>
                  <div className="scenario-advanced-content">
                    <div className="scenario-fields-grid">
                      <label className="scenario-field">
                        <InfoLabel label="Calibration version" info={SETTING_HELP.calibrationParameterVersion} />
                        <select
                          value={selectedBaseline}
                          disabled={executionDisabled}
                          onChange={(event) => onBaselineChange(event.target.value)}
                        >
                          {orderedSnapshots.map((snapshot) => (
                            <option key={snapshot.version} value={snapshot.version}>
                              {formatExperimentModelOption(snapshot, orderedSnapshots)}
                            </option>
                          ))}
                        </select>
                        {selectedSnapshot && (
                          <p className="scenario-evidence-note">
                            <strong>{selectedSnapshot.version}</strong> · {formatEvidenceNote(selectedSnapshot)}
                          </p>
                        )}
                        <p className="scenario-field-links">
                          <Link
                            className="summary-link-inline"
                            to={`/validation?version=${encodeURIComponent(selectedBaseline)}&evidenceYear=${
                              selectedSnapshot?.evidenceYear ?? 2024
                            }&from=sensitivity`}
                          >
                            Compare how models fit the evidence
                          </Link>
                          <Link className="summary-link-inline" to={`/calibration?mode=single&version=${encodeURIComponent(selectedBaseline)}`}>
                            View this model&rsquo;s assumptions
                          </Link>
                        </p>
                      </label>
                    </div>

                    <h4>Simulation controls</h4>
                    <GeneralModelControl
                      mode="sensitivity"
                      parameters={parameters}
                      formValues={formValues}
                      executionDisabled={executionDisabled}
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
              )}

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

              <div className="scenario-submit-row">
                <button
                  type="button"
                  className="primary-button scenario-create-button"
                  disabled={submissionBlocked}
                  onClick={() => onSubmit(false)}
                >
                  {isSubmitting ? 'Submitting...' : 'Start sensitivity analysis'}
                </button>
                {warnings.length > 0 && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={submissionBlocked}
                    onClick={() => onSubmit(true)}
                  >
                    Confirm and start
                  </button>
                )}
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
                  <dd>{monteCarloRuns || 'Not set'}</dd>
                </div>
                <div>
                  <dt>Model version</dt>
                  <dd>{selectedSnapshot ? formatExperimentModelOption(selectedSnapshot, orderedSnapshots) : selectedBaseline}</dd>
                </div>
                <div>
                  <dt>Simulation duration</dt>
                  <dd>{simulationDuration ? `${simulationDuration} steps` : 'Not set'}</dd>
                </div>
                <div>
                  <dt>Workers parallelised across</dt>
                  <dd>{maxWorkers || 'Not set'}</dd>
                </div>
              </dl>
            </aside>
          </div>
        </>
      )}
    </article>
  );
}

function buildSensitivitySampleValues(
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
