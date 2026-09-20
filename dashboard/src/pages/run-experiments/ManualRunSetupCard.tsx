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
  committedExperimentDemoText,
  type PolicyExperimentDemoStepId,
  type PolicyExperimentDemoContext
} from '../../components/PolicyExperimentDemo';
import type { ExperimentDemoStep } from '../../components/ExperimentDemoOverlay';

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
    initialStep ?? (policyDemo?.active ? undefined : readScenarioDraft(draftId)?.currentStep) ?? 0
  )));
  const [openPolicyGroups, setOpenPolicyGroups] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [additionalExportsOpen, setAdditionalExportsOpen] = useState(false);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [committedDemoName, setCommittedDemoName] = useState('');
  const [nameCommitRevision, setNameCommitRevision] = useState(0);
  const [committedDemoFtbLtv, setCommittedDemoFtbLtv] = useState('');
  const [ftbCommitRevision, setFtbCommitRevision] = useState(0);
  const [modelSelectionPending, setModelSelectionPending] = useState(false);
  const demoNameEditedRef = useRef(false);
  const demoFtbLtvEditedRef = useRef(false);
  const pendingModelSelectionRef = useRef('');
  const isPolicyDemoActive = policyDemo?.active === true;
  useEffect(() => {
    if (!isPolicyDemoActive && !isLoadingOptions) updateScenarioDraftStep(draftId, activeStep);
  }, [activeStep, draftId, isLoadingOptions, isPolicyDemoActive]);
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
    setCommittedDemoName(committedName);
    setNameCommitRevision((current) => current + 1);
  };

  const commitDemoFtbLtv = (value: string) => {
    if (!isPolicyDemoActive || !demoFtbLtvEditedRef.current) return;
    demoFtbLtvEditedRef.current = false;
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    setCommittedDemoFtbLtv(value);
    setFtbCommitRevision((current) => current + 1);
  };

  const handleModelChange = (nextBaseline: string) => {
    if (isPolicyDemoActive && nextBaseline && nextBaseline !== selectedBaseline) {
      pendingModelSelectionRef.current = nextBaseline;
      setModelSelectionPending(true);
    }
    onBaselineChange(nextBaseline);
  };

  useEffect(() => {
    const pending = pendingModelSelectionRef.current;
    if (!pending || isLoadingOptions || selectedBaseline !== pending) return;
    pendingModelSelectionRef.current = '';
    setModelSelectionPending(false);
  }, [isLoadingOptions, selectedBaseline]);

  const restorePolicyDemoStep = useCallback((step: ExperimentDemoStep<PolicyExperimentDemoStepId>) => {
    setActiveStep(step.wizardStep);
    const groupForStep = (() => {
      if (step.id === 'policy-inspect-bank-rate') return 'bankRate';
      if (
        step.id === 'policy-inspect-ltv' ||
        step.id === 'policy-change-ftb-ltv' ||
        step.id === 'policy-inspect-change' ||
        step.id === 'policy-inspect-live-summary'
      ) return 'ltv';
      if (step.id === 'policy-inspect-lti') return 'lti';
      if (step.id === 'policy-inspect-affordability') return 'affordability-and-btl';
      return '';
    })();
    if (groupForStep) {
      setOpenPolicyGroups((current) => {
        if (current.has(groupForStep)) return current;
        return new Set([...current, groupForStep]);
      });
    }
    if (step.id === 'policy-inspect-exports') setAdditionalExportsOpen(true);
    if (step.id === 'policy-inspect-recording') setRecordingOpen(true);
  }, []);

  const requiresOverwriteConfirmation = warnings.some((warning) => warning.code === 'output_folder_exists');

  return (
    <article className="scenario-builder-surface">
      <ExperimentHeaderStartButton
        disabled={isLoadingOptions || isPolicyDemoActive || formDisabled || submissionDisabled || manualSubmissionLockedBySensitivity}
        isSubmitting={isSubmitting}
        requiresOverwriteConfirmation={requiresOverwriteConfirmation}
        onStart={() => onSubmit(requiresOverwriteConfirmation)}
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
            className="scenario-stepper policy-stepper"
            aria-label="Scenario sections"
            tabIndex={isPolicyDemoActive ? -1 : undefined}
            data-experiment-demo-target={isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.stepper : undefined}
          >
            {steps.map((step, index) => (
              <button
                key={step.id}
                type="button"
                disabled={isLoadingOptions || isPolicyDemoActive}
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
                        onChange={(event) => handleModelChange(event.target.value)}
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
                              demoTarget={isPolicyDemoActive && key === 'CENTRAL_BANK_LTV_HARD_MAX_FTB'
                                ? POLICY_EXPERIMENT_DEMO_TARGETS.ftbLtvInput
                                : undefined}
                              onDemoEdit={isPolicyDemoActive && key === 'CENTRAL_BANK_LTV_HARD_MAX_FTB'
                                ? () => {
                                  demoFtbLtvEditedRef.current = true;
                                  setCommittedDemoFtbLtv('');
                                }
                                : undefined}
                              onDemoCommit={isPolicyDemoActive && key === 'CENTRAL_BANK_LTV_HARD_MAX_FTB'
                                ? commitDemoFtbLtv
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
                      data-experiment-demo-target={isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.continueButton : undefined}
                      aria-label="Continue to next step"
                      title="Continue to next step"
                      onClick={() => setActiveStep((step) => Math.min(steps.length - 1, step + 1))}
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
                      style={{ background: '#237a36' }}
                      disabled={isPolicyDemoActive || isSubmitting || submissionDisabled || manualSubmissionLockedBySensitivity}
                      data-experiment-demo-target={isPolicyDemoActive ? POLICY_EXPERIMENT_DEMO_TARGETS.startBoundary : undefined}
                      onClick={() => onSubmit(requiresOverwriteConfirmation)}
                    >
                      {isSubmitting
                        ? 'Starting...'
                        : requiresOverwriteConfirmation
                          ? 'Replace results and start'
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
        <PolicyExperimentDemo
          {...policyDemo}
          currentWizardStep={activeStep}
          currentName={title}
          committedName={committedDemoName}
          nameCommitRevision={nameCommitRevision}
          openPolicyGroups={openPolicyGroups}
          currentFtbLtv={typeof formValues.CENTRAL_BANK_LTV_HARD_MAX_FTB === 'string'
            ? formValues.CENTRAL_BANK_LTV_HARD_MAX_FTB
            : ''}
          referenceFtbLtv={selectedBasePolicy?.values.CENTRAL_BANK_LTV_HARD_MAX_FTB}
          committedFtbLtv={committedDemoFtbLtv}
          ftbCommitRevision={ftbCommitRevision}
          additionalExportsOpen={additionalExportsOpen}
          recordingOpen={recordingOpen}
          modelSelectionPending={modelSelectionPending}
          selectedModel={selectedBaseline}
          selectedReferencePolicy={basePolicy}
          onRestoreStep={restorePolicyDemoStep}
        />
      )}
    </article>
  );
}
