import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { readScenarioDraft, updateScenarioDraftStep } from '../../lib/scenarioDraft';
import { CollapsibleSection } from '../../components/CollapsibleSection';
import { ExperimentHeaderStartButton } from '../../components/ExperimentHeaderStartButton';
import { CentralBankPolicyInput } from './CentralBankPolicyInput';
import { GeneralModelControl, isRecordSetting } from './GeneralModelControl';
import { InfoLabel } from './InfoLabel';
import { SETTING_HELP } from './settingHelp';
import {
  POLICY_EXPERIMENT_DEMO_TARGETS,
  PolicyExperimentDemo,
  policyExperimentDemoWizardStep,
  type PolicyExperimentDemoStepId,
  type PolicyExperimentDemoContext
} from '../../components/PolicyExperimentDemo';
import { committedExperimentDemoText, type CreationDemoStep } from '../../lib/guidedDemos/creation';

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
  initialStep,
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
  const [activeStep, setActiveStep] = useState(() => Math.max(0, Math.min(4,
    (policyDemo?.active && policyDemo.paused ? readScenarioDraft(draftId)?.currentStep : undefined)
      ?? initialStep
      ?? (policyDemo?.active ? policyExperimentDemoWizardStep(policyDemo.savedStepId) : readScenarioDraft(draftId)?.currentStep)
      ?? 0
  )));
  const [openPolicyGroups, setOpenPolicyGroups] = useState<ReadonlySet<string>>(() => new Set<string>(
    policyDemo?.active && policyDemo.savedStepId === 'policy-change-bank-rate' ? ['bankRate'] : []
  ));
  const [additionalExportsOpen, setAdditionalExportsOpen] = useState(
    policyDemo?.active === true && policyDemo.savedStepId === 'policy-exports'
  );
  const [recordingOpen, setRecordingOpen] = useState(false);
  const stepperRef = useRef<HTMLElement>(null);
  const demoNameEditedRef = useRef(false);
  const demoBankRateEditedRef = useRef(false);
  const isPolicyDemoActive = policyDemo?.active === true;
  const isPolicyGuideActive = isPolicyDemoActive && !policyDemo?.paused;
  const policyPracticeSubmissionBlocked = isPolicyDemoActive && (
    !isPolicyGuideActive || policyDemo?.savedStepId !== 'policy-submit' ||
    policyDemo?.allowPolicySubmission !== true || Boolean(policyDemo?.policyRun)
  );
  useEffect(() => {
    if (!isPolicyGuideActive && !isLoadingOptions) updateScenarioDraftStep(draftId, activeStep);
  }, [activeStep, draftId, isLoadingOptions, isPolicyGuideActive]);
  useEffect(() => {
    const strip = stepperRef.current;
    const current = strip?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!strip || !current) return;
    const stripBounds = strip.getBoundingClientRect();
    const currentBounds = current.getBoundingClientRect();
    // Reveal the active section on narrow screens without moving the page or its spotlight.
    const offset = currentBounds.left < stripBounds.left
      ? currentBounds.left - stripBounds.left
      : Math.max(0, currentBounds.right - stripBounds.right);
    if (offset) strip.scrollBy({ left: offset, behavior: 'instant' });
  }, [activeStep, isLoadingOptions, policyDemo?.savedStepId]);
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
    const committedName = committedExperimentDemoText(value, demoNameEditedRef.current);
    demoNameEditedRef.current = false;
    if (!committedName) return;
    policyDemo?.onCommit('name', committedName);
  };

  const commitDemoBankRate = (value: string) => {
    if (!isPolicyDemoActive || !demoBankRateEditedRef.current) return;
    demoBankRateEditedRef.current = false;
    const parsed = Number(value);
    if (!value.trim() || !Number.isFinite(parsed) || parsed < 0) return;
    policyDemo?.onCommit('bankRate', value);
  };

  const restorePolicyDemoStep = useCallback((step: CreationDemoStep<PolicyExperimentDemoStepId>) => {
    setActiveStep(step.wizardStep);
    if (step.id === 'policy-exports') setAdditionalExportsOpen(true);
    if (step.id === 'policy-change-bank-rate') {
      setOpenPolicyGroups((current) => {
        if (current.has('bankRate')) return current;
        return new Set([...current, 'bankRate']);
      });
    }
  }, []);

  const requiresOverwriteConfirmation = warnings.some((warning) => warning.code === 'output_folder_exists');
  const confirmOverwrite = requiresOverwriteConfirmation && !isPolicyDemoActive;

  return (
    <article className="scenario-builder-surface">
      <ExperimentHeaderStartButton
        disabled={isLoadingOptions || policyPracticeSubmissionBlocked || formDisabled || submissionDisabled || manualSubmissionLockedBySensitivity}
        isSubmitting={isSubmitting}
        requiresOverwriteConfirmation={confirmOverwrite}
        onStart={() => onSubmit(confirmOverwrite)}
      />
      {manualSubmissionLockedBySensitivity && lockMessage && <p className="info-banner">{lockMessage}</p>}
      {!isLoadingOptions && warnings.length > 0 && (
        <div className="run-warning-card" role="alert">
          <h4>{requiresOverwriteConfirmation ? 'Existing results would be replaced' : 'Run information'}</h4>
          {requiresOverwriteConfirmation && <p>Choose a different scenario name to keep both runs, or replace the existing results.</p>}
          <ul>
            {warnings.map((warning) => (
              <li key={`${warning.code}-${warning.message}`}>{warning.message}</li>
            ))}
          </ul>
        </div>
      )}

      {(!isLoadingOptions || !isPolicyDemoActive) && (
        <>
          <div className="scenario-builder-heading">
            <h2>Create a new policy scenario</h2>
            <p>Name the scenario, choose a model and set the policy. Start from any step when the setup is ready.</p>
          </div>
          {draftNotice && <p className="info-banner">{draftNotice}</p>}
          <nav
            ref={stepperRef}
            className="scenario-stepper policy-stepper"
            aria-label="Scenario sections"
            tabIndex={isPolicyDemoActive ? 0 : undefined}
            data-experiment-demo-target={isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.stepper : undefined}
          >
            {steps.map((step, index) => (
              <button
                key={step.id}
                type="button"
                disabled={isLoadingOptions || isPolicyGuideActive}
                onClick={() => setActiveStep(index)}
                aria-current={activeStep === index ? 'step' : undefined}
              >
                <span>{index + 1}</span>{step.label}
              </button>
            ))}
          </nav>
        </>
      )}
      {isLoadingOptions ? (
        <div className="scenario-builder-loading" role="status">
          <p className="loading-banner">Loading scenario options...</p>
        </div>
      ) : (
        <>
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
                    data-experiment-demo-target={isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.name : undefined}
                    onChange={(event) => {
                      if (isPolicyDemoActive) {
                        demoNameEditedRef.current = true;
                        policyDemo?.onCommit('name', event.target.value.trim());
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
                  <div
                    className="scenario-model-selection"
                    tabIndex={isPolicyDemoActive ? -1 : undefined}
                    data-experiment-demo-target={isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.model : undefined}
                  >
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
                    </label>
                    <p className="scenario-field-links">
                      <Link
                        className="summary-link-inline"
                        to={`/calibration?mode=single&version=${encodeURIComponent(selectedBaseline)}&from=scenario&draft=${encodeURIComponent(draftId)}&scenarioStep=model-version`}
                        aria-disabled={isPolicyDemoActive ? 'true' : undefined}
                        tabIndex={isPolicyDemoActive ? -1 : undefined}
                        onClick={isPolicyDemoActive ? (event) => event.preventDefault() : undefined}
                      >
                        Check the model&rsquo;s assumptions
                      </Link>
                      <Link
                        className="summary-link-inline"
                        to={`/validation?version=${encodeURIComponent(selectedBaseline)}&evidenceYear=${selectedSnapshot?.evidenceYear ?? 2024}&from=scenario&draft=${encodeURIComponent(draftId)}&scenarioStep=model-version`}
                        aria-disabled={isPolicyDemoActive ? 'true' : undefined}
                        tabIndex={isPolicyDemoActive ? -1 : undefined}
                        onClick={isPolicyDemoActive ? (event) => event.preventDefault() : undefined}
                      >
                        Check how well the model matches UK data
                      </Link>
                    </p>
                  </div>
              </section>

              <section hidden={activeStep !== 2} id="policy-settings" className="scenario-section scenario-step-page scenario-policy-settings-page" aria-labelledby="policy-settings-heading">
                <h3 id="policy-settings-heading">Set the policy</h3>
                <p className="scenario-section-intro">
                  Choose a reference policy year, then edit any settings you want to test. Settings left unchanged will retain that year&rsquo;s values.
                </p>
                <label
                  className="scenario-field scenario-reference-policy-field"
                  data-experiment-demo-target={isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.referencePolicy : undefined}
                >
                  <InfoLabel label="Reference policy year" info={SETTING_HELP.basePolicy} />
                  <select value={basePolicy} disabled={formDisabled} onChange={(event) => handleReferencePolicyChange(event.target.value as BasePolicyId)}>
                    {basePolicies.map((policy) => <option key={policy.id} value={policy.id}>{policy.id} policy</option>)}
                  </select>
                </label>

                <p
                  className={`scenario-policy-status ${changedPolicyKeys.size > 0 ? 'has-changes' : ''}`}
                  aria-live="polite"
                  tabIndex={isPolicyDemoActive ? -1 : undefined}
                  data-experiment-demo-target={isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.changedFeedback : undefined}
                >
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
                      <summary data-experiment-demo-target={isPolicyDemoActive
                        ? group.id === 'bankRate'
                          ? POLICY_EXPERIMENT_DEMO_TARGETS.bankRateToggle
                          : group.id === 'ltv'
                            ? POLICY_EXPERIMENT_DEMO_TARGETS.ltvToggle
                            : group.id === 'lti'
                              ? POLICY_EXPERIMENT_DEMO_TARGETS.ltiToggle
                              : POLICY_EXPERIMENT_DEMO_TARGETS.affordabilityToggle
                        : undefined}
                      >
                        <span>{group.heading}</span>
                        {groupChangedCount > 0 && <span className="scenario-accordion-change-count">{groupChangedCount} changed</span>}
                      </summary>
                      <div
                        className="scenario-policy-accordion-content"
                        tabIndex={isPolicyDemoActive ? -1 : undefined}
                        data-experiment-demo-target={isPolicyDemoActive
                          ? group.id === 'bankRate'
                            ? POLICY_EXPERIMENT_DEMO_TARGETS.bankRateContent
                            : group.id === 'ltv'
                              ? POLICY_EXPERIMENT_DEMO_TARGETS.ltvContent
                              : group.id === 'lti'
                                ? POLICY_EXPERIMENT_DEMO_TARGETS.ltiContent
                                : POLICY_EXPERIMENT_DEMO_TARGETS.affordabilityContent
                          : undefined}
                      >
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
                              demoTarget={isPolicyDemoActive && key === 'CENTRAL_BANK_INITIAL_BASE_RATE'
                                ? POLICY_EXPERIMENT_DEMO_TARGETS.bankRateInput
                                : undefined}
                              onDemoEdit={isPolicyDemoActive && key === 'CENTRAL_BANK_INITIAL_BASE_RATE'
                                ? () => {
                                  demoBankRateEditedRef.current = true;
                                  policyDemo?.onCommit('bankRate', '');
                                }
                                : undefined}
                              onDemoCommit={isPolicyDemoActive && key === 'CENTRAL_BANK_INITIAL_BASE_RATE'
                                ? commitDemoBankRate
                                : undefined}
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
                  <div
                    id="scenario-advanced-panel"
                    className="scenario-advanced-panel scenario-advanced-panel--inline"
                    tabIndex={isPolicyDemoActive ? -1 : undefined}
                    data-experiment-demo-target={isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.technicalSettings : undefined}
                  >
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
                        recordSettingsOpen={additionalExportsOpen}
                        onRecordSettingsOpenChange={setAdditionalExportsOpen}
                        recordSettingsDemoTarget={isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.additionalExportsToggle : undefined}
                        recordSettingsContentDemoTarget={isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.additionalExportsContent : undefined}
                      />
                    </div>
                  </div>

              </section>

              <section hidden={activeStep !== 4} id="scenario-review" className="scenario-section scenario-step-page" aria-labelledby="scenario-review-heading">
                <h3 id="scenario-review-heading">Review and start</h3>
                <p className="scenario-section-intro">Check the complete scenario specification before starting the model run.</p>

                <dl
                  className="sensitivity-review-list scenario-review-overview"
                  tabIndex={isPolicyDemoActive ? -1 : undefined}
                  data-experiment-demo-target={isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.reviewOverview : undefined}
                >
                  <div><dt>Scenario name</dt><dd>{title.trim() || 'Not set'}</dd></div>
                  <div><dt>Model</dt><dd>{selectedSnapshot ? formatExperimentModelOption(selectedSnapshot) : selectedBaseline || 'Not set'}</dd></div>
                  <div><dt>Reference policy</dt><dd>{selectedBasePolicy?.title ?? 'Not set'}</dd></div>
                  <div><dt>Policy changes</dt><dd>{changedPolicyKeys.size === 0 ? 'No settings changed' : `${changedPolicyKeys.size} ${changedPolicyKeys.size === 1 ? 'setting' : 'settings'} changed`}</dd></div>
                </dl>

                <div
                  className="scenario-policy-review"
                  tabIndex={isPolicyDemoActive ? -1 : undefined}
                  data-experiment-demo-target={isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.policyAudit : undefined}
                >
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
                  open={recordingOpen}
                  onOpenChange={setRecordingOpen}
                  experimentDemoTarget={isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.recordingToggle : undefined}
                  experimentDemoContentTarget={isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.recordingContent : undefined}
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

              </section>

              <div className="scenario-page-navigation" aria-label="Scenario page navigation">
                <div className="scenario-page-movement">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={activeStep === 0 || isPolicyGuideActive}
                    aria-label="Back to previous step"
                    title="Back to previous step"
                    onClick={() => setActiveStep((step) => Math.max(0, step - 1))}
                  >
                    Back
                  </button>
                  {activeStep < steps.length - 1 && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={isPolicyGuideActive}
                      data-experiment-demo-target={isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.continueButton : undefined}
                      aria-label="Continue to next step"
                      title="Continue to next step"
                      onClick={() => setActiveStep((step) => Math.min(steps.length - 1, step + 1))}
                    >
                      Next
                    </button>
                  )}
                </div>
                <div className="scenario-persistent-run-action">
                  {activeStep === steps.length - 1 && (
                    <button
                      type="button"
                      className="primary-button scenario-create-button"
                      style={{ background: '#237a36' }}
                      disabled={isLoadingOptions || policyPracticeSubmissionBlocked || formDisabled || isSubmitting || submissionDisabled || manualSubmissionLockedBySensitivity}
                      data-experiment-demo-target={isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.startBoundary : undefined}
                      onClick={() => onSubmit(confirmOverwrite)}
                    >
                      {isSubmitting
                        ? 'Starting...'
                        : confirmOverwrite
                          ? 'Replace results and start'
                          : 'Start policy scenario'}
                    </button>
                  )}
                </div>
              </div>
              <p className="scenario-matched-baseline-note">Results compare your scenario with a saved unchanged-reference run using the same model and run settings, if one exists. The reference run is not created automatically.</p>
              {submissionDisabled && !manualSubmissionLockedBySensitivity && !isPolicyDemoActive && (
                <p className="scenario-submission-note">Run policy scenario is unavailable. {submissionDisabledReason}</p>
              )}
            </div>

            <aside
              className="scenario-summary"
              aria-labelledby="scenario-summary-heading"
              tabIndex={isPolicyDemoActive ? -1 : undefined}
              data-experiment-demo-target={isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.liveSummary : undefined}
            >
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
                          {' to '}{formatPolicyFieldValue(key, formValues[key])}
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
        <PolicyExperimentDemo
          {...policyDemo}
          currentName={title}
          currentBankRate={typeof formValues.CENTRAL_BANK_INITIAL_BASE_RATE === 'string'
            ? formValues.CENTRAL_BANK_INITIAL_BASE_RATE
            : ''}
          referenceBankRate={selectedBasePolicy?.values.CENTRAL_BANK_INITIAL_BASE_RATE}
          selectedModel={selectedBaseline}
          selectedReferencePolicy={basePolicy}
          runMonths={typeof formValues.N_STEPS === 'string' ? formValues.N_STEPS : ''}
          seedCount={typeof formValues.N_SIMS === 'string' ? formValues.N_SIMS : ''}
          householdCount={typeof formValues.TARGET_POPULATION === 'string' ? formValues.TARGET_POPULATION : ''}
          recordingStartMonth={typeof formValues.TIME_TO_START_RECORDING_TRANSACTIONS === 'string'
            ? formValues.TIME_TO_START_RECORDING_TRANSACTIONS
            : ''}
          recordTransactions={formValues.recordTransactions === true}
          onRestoreStep={restorePolicyDemoStep}
        />
      )}
    </article>
  );
}
