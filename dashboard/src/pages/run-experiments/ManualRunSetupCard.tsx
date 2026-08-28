import { useMemo, useRef, useState } from 'react';
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
  POLICY_INSTRUMENTS,
  POLICY_SETTING_GROUPS,
  changedInstrumentLabels,
  deriveChangedPolicyKeys,
  describeScenarioPolicy
} from '../../lib/manualScenarioPolicy';
import { formatExperimentModelOption, orderExperimentModelOptions } from '../../lib/experimentVersionOptions';
import { getModelAnchor } from '../../lib/modelAnchors';
import { CollapsibleSection } from '../../components/CollapsibleSection';
import { CentralBankPolicyInput } from './CentralBankPolicyInput';
import { GeneralModelControl, isRecordSetting } from './GeneralModelControl';
import { InfoLabel } from './InfoLabel';
import { SETTING_HELP } from './settingHelp';
import {
  POLICY_EXPERIMENT_DEMO_TARGETS,
  PolicyExperimentDemoPrototype,
  committedPolicyExperimentDemoName,
  type PolicyExperimentDemoContext
} from '../../components/PolicyExperimentDemoPrototype';

type FormValue = string | boolean;

interface ManualRunSetupCardProps {
  draftId?: string;
  draftNotice?: string;
  initialStep?: number;
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
  lockedParameterKeys?: readonly string[];
  onFormValueChange: (parameter: ModelRunParameterDefinition, value: FormValue) => void;
  maxWorkers: string;
  maxWorkersCap?: number;
  onMaxWorkersChange: (value: string) => void;
  warnings: ModelRunWarning[];
  isSubmitting: boolean;
  manualSubmissionLockedBySensitivity: boolean;
  lockMessage: string | null;
  onSubmit: (confirmWarnings: boolean) => void;
  policyDemo?: PolicyExperimentDemoContext;
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

function reviewParameterLabel(parameter: ModelRunParameterDefinition): string {
  if (parameter.key === 'N_SIMS') return 'Seeds per run';
  if (parameter.key === 'TIME_TO_START_RECORDING_TRANSACTIONS') return 'Start recording at month';
  if (parameter.key === 'recordCoreIndicators') return 'Dashboard results';
  return parameter.title;
}

function reviewParameterValue(parameter: ModelRunParameterDefinition, value: FormValue | undefined): string {
  if (parameter.key === 'recordCoreIndicators') return 'Enabled';
  if (parameter.type === 'boolean') return value ? 'Enabled' : 'Disabled';
  if (value === undefined || value === '') return 'Not set';
  if (parameter.key === 'N_STEPS') return `${value} steps`;
  if (parameter.key === 'N_SIMS') return `${value} seeds`;
  return String(value);
}

export function ManualRunSetupCard({
  draftId = '',
  draftNotice = '',
  initialStep = 0,
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
  lockedParameterKeys = [],
  onFormValueChange,
  maxWorkers,
  maxWorkersCap,
  onMaxWorkersChange,
  warnings,
  isSubmitting,
  manualSubmissionLockedBySensitivity,
  lockMessage,
  onSubmit,
  policyDemo
}: ManualRunSetupCardProps) {
  const [activeStep, setActiveStep] = useState(() => Math.max(0, Math.min(4, initialStep)));
  const [openPolicyGroups, setOpenPolicyGroups] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [committedDemoName, setCommittedDemoName] = useState('');
  const [nameCommitRevision, setNameCommitRevision] = useState(0);
  const demoNameEditedRef = useRef(false);
  const isPolicyDemoActive = policyDemo?.active === true;
  const steps = [
    { id: 'scenario-details', label: 'Scenario name' },
    { id: 'model-evidence', label: 'Model version' },
    { id: 'policy-settings', label: 'Policy settings' },
    { id: 'technical-details', label: 'Technical details' },
    { id: 'scenario-review', label: 'Review and start' }
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
  const reviewRunParameters = parameters.filter(
    (parameter) => parameter.group === 'General model control' && parameter.key !== 'SEED' && !isRecordSetting(parameter)
  );
  const reviewRecordingParameters = parameters.filter(
    (parameter) => parameter.group === 'General model control' && parameter.key !== 'SEED' && isRecordSetting(parameter)
  );

  // Benchmark status is derived from the values themselves, not from which instruments are selected:
  // editing any policy field makes this a policy-change scenario immediately.
  const changedPolicyKeys = useMemo(
    () => deriveChangedPolicyKeys(formValues, selectedBasePolicy?.values, knownPolicyKeys),
    [formValues, knownPolicyKeys, selectedBasePolicy]
  );

  const scenarioSentence = describeScenarioPolicy(changedPolicyKeys);
  const policyTypeSummary = changedPolicyKeys.size === 0
    ? 'No settings changed'
    : changedInstrumentLabels(changedPolicyKeys).join(' + ');

  const advancedSummary = [
    parameters.find((parameter) => parameter.key === 'N_STEPS') ? `${formValues.N_STEPS ?? '—'} simulation steps` : null,
    parameters.find((parameter) => parameter.key === 'N_SIMS') ? `${formValues.N_SIMS ?? '—'} repetitions` : null,
    `up to ${maxWorkers || '—'} parallel workers`
  ].filter(Boolean);

  const handleReferencePolicyChange = (nextBasePolicy: BasePolicyId) => {
    if (nextBasePolicy === basePolicy) return;
    if (
      changedPolicyKeys.size > 0 &&
      !window.confirm(`Change reference policy to ${nextBasePolicy}? This will reset the policy settings shown below.`)
    ) return;
    onBasePolicyChange(nextBasePolicy);
  };

  const commitDemoName = (value: string) => {
    if (!isPolicyDemoActive) return;
    const committedName = committedPolicyExperimentDemoName(value, demoNameEditedRef.current);
    demoNameEditedRef.current = false;
    if (!committedName) return;
    setCommittedDemoName(committedName);
    setNameCommitRevision((current) => current + 1);
  };

  return (
    <article className="scenario-builder-surface">
      {manualSubmissionLockedBySensitivity && lockMessage && <p className="info-banner">{lockMessage}</p>}

      {isLoadingOptions ? (
        <p className="loading-banner">Loading scenario options...</p>
      ) : (
        <>
          <div className="scenario-builder-heading">
            <h2>Create a new policy scenario</h2>
            <p>Name the scenario, choose a model, set the policy and review everything before starting.</p>
          </div>
          {draftNotice && <p className="info-banner">{draftNotice}</p>}
          <nav className="scenario-stepper policy-stepper" aria-label="Scenario sections">
            {steps.map((step, index) => (
              <button
                key={step.id}
                type="button"
                disabled={isPolicyDemoActive}
                onClick={() => setActiveStep(index)}
                aria-current={activeStep === index ? 'step' : undefined}
              >
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
                    data-policy-experiment-demo-target={
                      isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.scenarioName : undefined
                    }
                    onChange={(event) => {
                      if (isPolicyDemoActive) {
                        demoNameEditedRef.current = true;
                        setCommittedDemoName('');
                      }
                      onTitleChange(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                      event.preventDefault();
                      commitDemoName(event.currentTarget.value);
                    }}
                    onBlur={(event) => commitDemoName(event.currentTarget.value)}
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

              <section hidden={activeStep !== 2} id="policy-settings" className="scenario-section scenario-step-page scenario-policy-settings-page" aria-labelledby="policy-settings-heading">
                <h3 id="policy-settings-heading">Set the policy</h3>
                <p className="scenario-section-intro">
                  Choose a reference policy year, then edit any settings you want to test. Settings left unchanged will retain that year&rsquo;s values.
                </p>
                <label className="scenario-field scenario-reference-policy-field">
                  <InfoLabel label="Reference policy year" info={SETTING_HELP.basePolicy} />
                  <select value={basePolicy} disabled={formDisabled} onChange={(event) => handleReferencePolicyChange(event.target.value as BasePolicyId)}>
                    {basePolicies.map((policy) => <option key={policy.id} value={policy.id}>{policy.id} policy</option>)}
                  </select>
                </label>

                <p className={`scenario-policy-status ${changedPolicyKeys.size > 0 ? 'has-changes' : ''}`} aria-live="polite">
                  {changedPolicyKeys.size === 0
                    ? `No changes yet — this scenario will use the ${basePolicy} reference policy.`
                    : `${changedPolicyKeys.size} ${changedPolicyKeys.size === 1 ? 'setting' : 'settings'} changed from the ${basePolicy} reference policy.`}
                </p>

                <div className="scenario-policy-accordions">
                  {POLICY_SETTING_GROUPS.map((group) => {
                    const groupChangedCount = group.keys.filter((key) => changedPolicyKeys.has(key)).length;
                    return <details
                      key={group.id}
                      open={openPolicyGroups.has(group.id)}
                      onToggle={(event) => {
                        const isOpen = event.currentTarget.open;
                        setOpenPolicyGroups((current) => {
                          const next = new Set(current);
                          if (isOpen) next.add(group.id);
                          else next.delete(group.id);
                          return next;
                        });
                      }}
                      className="scenario-policy-accordion"
                    >
                      <summary>
                        <span>{group.heading}</span>
                        {groupChangedCount > 0 && <span className="scenario-accordion-change-count">{groupChangedCount} changed</span>}
                      </summary>
                      <div className="scenario-policy-accordion-content">
                        <p className="scenario-section-intro">{group.intro}</p>
                        <div className="scenario-fields-grid">
                      {group.keys.map((key) => {
                        const parameter = parametersByKey.get(key);
                        if (!parameter) return null;
                        const baseValue = selectedBasePolicy?.values[key];
                        const baseText = formatPolicyFieldValue(key, baseValue === undefined ? undefined : String(baseValue));
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
                                  <span className="scenario-policy-changed-chip">Changed</span>
                                  {`Reference: ${baseText}`}
                                </>
                              ) : (
                                `Reference: ${baseText}`
                              )}
                            </p>
                          </div>
                        );
                      })}
                        </div>
                      </div>
                    </details>;
                  })}
                </div>
              </section>

              <section hidden={activeStep !== 3} id="technical-details" className="scenario-section scenario-step-page" aria-labelledby="technical-details-heading">
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
                        disabledParameterKeys={lockedParameterKeys}
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

              <section hidden={activeStep !== 4} id="scenario-review" className="scenario-section scenario-step-page" aria-labelledby="scenario-review-heading">
                <h3 id="scenario-review-heading">Review and start</h3>
                <p className="scenario-section-intro">Check the complete scenario specification before starting the model run.</p>

                <dl className="sensitivity-review-list scenario-review-overview">
                  <div><dt>Scenario name</dt><dd>{title.trim() || 'Not set'}</dd></div>
                  <div><dt>Model</dt><dd>{selectedSnapshot ? formatExperimentModelOption(selectedSnapshot) : selectedBaseline || 'Not set'}</dd></div>
                  <div><dt>Reference policy</dt><dd>{selectedBasePolicy?.title ?? 'Not set'}</dd></div>
                  <div><dt>Policy changes</dt><dd>{changedPolicyKeys.size === 0 ? 'No settings changed' : `${changedPolicyKeys.size} ${changedPolicyKeys.size === 1 ? 'setting' : 'settings'} changed`}</dd></div>
                </dl>

                <div className="scenario-policy-review">
                  <div className="scenario-policy-review-heading">
                    <h4>Policy settings</h4>
                    <p>Every policy control is shown below. Values matching the reference policy are marked Unchanged.</p>
                  </div>
                  <div className="scenario-policy-review-groups">
                    {POLICY_SETTING_GROUPS.map((group) => (
                      <section key={group.id} className="scenario-policy-review-group" aria-labelledby={`review-${group.id}-heading`}>
                        <h5 id={`review-${group.id}-heading`}>{group.heading}</h5>
                        <dl>
                          {group.keys.map((key) => {
                            const baseValue = selectedBasePolicy?.values[key];
                            const baseText = formatPolicyFieldValue(key, baseValue === undefined ? undefined : String(baseValue));
                            const isChanged = changedPolicyKeys.has(key);
                            const currentText = isChanged ? formatPolicyFieldValue(key, formValues[key]) : baseText;
                            return (
                              <div key={key} className={isChanged ? 'is-changed' : undefined}>
                                <dt>{policyLabel(key)}</dt>
                                <dd>
                                  <span className="scenario-policy-review-value">{currentText}</span>
                                  <span className={`scenario-policy-review-status ${isChanged ? 'is-changed' : 'is-unchanged'}`}>
                                    {isChanged ? 'Changed' : 'Unchanged'}
                                  </span>
                                  {isChanged && <small>Reference: {baseText}</small>}
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                      </section>
                    ))}
                  </div>
                </div>

                <div className="scenario-review-run-settings">
                  <h4>Run settings</h4>
                  <dl className="sensitivity-review-list">
                    {reviewRunParameters.map((parameter) => (
                      <div key={parameter.key}>
                        <dt>{reviewParameterLabel(parameter)}</dt>
                        <dd>{reviewParameterValue(parameter, formValues[parameter.key])}</dd>
                      </div>
                    ))}
                    <div><dt>Max workers</dt><dd>{maxWorkers || 'Not set'}</dd></div>
                  </dl>
                </div>

                <CollapsibleSection
                  title="Recording configuration"
                  summary={`${reviewRecordingParameters.length} settings`}
                  className="scenario-review-recording-settings"
                  defaultOpen={false}
                >
                  <dl className="sensitivity-review-list">
                    {reviewRecordingParameters.map((parameter) => (
                      <div key={parameter.key}>
                        <dt>{reviewParameterLabel(parameter)}</dt>
                        <dd>{reviewParameterValue(parameter, formValues[parameter.key])}</dd>
                      </div>
                    ))}
                  </dl>
                </CollapsibleSection>

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

              <div className="scenario-page-navigation" aria-label="Scenario page navigation">
                <div className="scenario-page-movement">
                  <button
                    type="button"
                    className="secondary-button scenario-wizard-arrow-button"
                    disabled={activeStep === 0 || isPolicyDemoActive}
                    aria-label="Back to previous step"
                    title="Back to previous step"
                    onClick={() => setActiveStep((step) => Math.max(0, step - 1))}
                  >
                    <span aria-hidden="true">&larr;</span>
                  </button>
                  {activeStep < steps.length - 1 && (
                    <button
                      type="button"
                      className="secondary-button scenario-wizard-arrow-button"
                      disabled={isPolicyDemoActive && activeStep !== 0}
                      data-policy-experiment-demo-target={
                        isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.continueButton : undefined
                      }
                      aria-label="Continue to next step"
                      title="Continue to next step"
                      onClick={() => setActiveStep((step) => isPolicyDemoActive
                        ? step === 0 ? 1 : step
                        : Math.min(steps.length - 1, step + 1))}
                    >
                      <span aria-hidden="true">&rarr;</span>
                    </button>
                  )}
                </div>
                <div className="scenario-persistent-run-action">
                  {activeStep === steps.length - 1 && (
                    <button
                      type="button"
                      className="primary-button scenario-create-button"
                      disabled={isSubmitting || submissionDisabled || manualSubmissionLockedBySensitivity}
                      onClick={() => onSubmit(warnings.length > 0)}
                    >
                      {isSubmitting
                        ? 'Starting...'
                        : warnings.length > 0
                          ? 'Confirm and start'
                          : 'Start policy scenario'}
                    </button>
                  )}
                </div>
              </div>
              <p className="scenario-matched-baseline-note">Results compare the edited policy settings with the unchanged reference policy using the same calibrated model and run settings.</p>
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
                  <dd>{selectedBaseline || 'Not selected'}</dd>
                </div>
                <div>
                  <dt>Reference policy</dt>
                  <dd>{selectedBasePolicy ? `${selectedBasePolicy.id} policy` : 'Not selected'}</dd>
                </div>
                <div>
                  <dt>Policy settings</dt>
                  <dd>{policyTypeSummary}</dd>
                </div>
                {POLICY_INSTRUMENTS.flatMap((instrument) =>
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
                <p>The reference comparison uses the same model, duration, repetitions and seed process.</p>
              </div>
            </aside>
          </div>
        </>
      )}
      {policyDemo && (
        <PolicyExperimentDemoPrototype
          {...policyDemo}
          currentWizardStep={activeStep}
          currentName={title}
          committedName={committedDemoName}
          nameCommitRevision={nameCommitRevision}
        />
      )}
    </article>
  );
}
