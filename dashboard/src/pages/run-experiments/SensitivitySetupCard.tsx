import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExperimentHeaderStartButton } from '../../components/ExperimentHeaderStartButton';
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
import { GeneralModelControl, ParameterInput, isRecordSetting } from './GeneralModelControl';
import { InfoLabel } from './InfoLabel';
import { SETTING_HELP } from './settingHelp';
import {
  SENSITIVITY_EXPERIMENT_DEMO_TARGETS,
  SensitivityExperimentDemo,
  type SensitivityExperimentDemoContext,
  type SensitivityExperimentDemoStepId
} from '../../components/SensitivityExperimentDemo';
import { committedExperimentDemoText, type CreationDemoStep } from '../../lib/guidedDemos/creation';
import { readSensitivityDraft, updateSensitivityDraftStep } from '../../lib/sensitivityDraft';
import { validateSensitivityPracticeSize } from '../../lib/sensitivityPractice';

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
  onSubmit: () => void;
  onCancelActive: () => void;
  sensitivityDemo?: SensitivityExperimentDemoContext;
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

interface SensitivityCreationValidationState {
  title: string;
  selectedSnapshot: ModelRunSnapshotOption | null;
  selectedBasePolicy: BasePolicyOption | null;
  selectedPackage: SensitivityPolicyPackageDefinition | null;
  minValue: string;
  maxValue: string;
  sampleCount: string;
  parameters: ModelRunParameterDefinition[];
  formValues: Record<string, string | boolean>;
  maxWorkers: string;
  maxWorkersCap?: number;
}

/** Guide Next applies the same validation as the ordinary page-by-page builder. */
export function sensitivityCreationAdvanceValidation(
  nextStep: CreationDemoStep<SensitivityExperimentDemoStepId>,
  state: SensitivityCreationValidationState
): { step: number; message: string; targetId: string } | null {
  const lastCompletedPage = nextStep.id === 'sensitivity-complete' ? 3 : nextStep.wizardStep - 1;
  if (lastCompletedPage >= 0) {
    const message = validateSensitivityExperimentDetails(state.title);
    if (message) return { step: 0, message, targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.name };
  }
  if (lastCompletedPage >= 1) {
    const message = validateSensitivitySweepDefinition(state.selectedPackage, state.minValue, state.maxValue, state.sampleCount);
    if (message) {
      const min = Number.parseFloat(state.minValue);
      const max = Number.parseFloat(state.maxValue);
      const targetId = !state.selectedPackage ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.instrument
        : !Number.isFinite(min) || !Number.isFinite(max) || !(min < max) ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.range
        : SENSITIVITY_EXPERIMENT_DEMO_TARGETS.sampleCount;
      return { step: 1, message, targetId };
    }
  }
  // A changed range must contain the comparison value before leaving its editable page.
  const checkBaselineRange = nextStep.wizardStep === 2 && state.selectedSnapshot && state.selectedBasePolicy && state.selectedPackage;
  if (lastCompletedPage >= 2 || checkBaselineRange) {
    const message = validateSensitivityModelAndBaseline(state.selectedSnapshot, state.selectedBasePolicy, state.selectedPackage, state.minValue, state.maxValue);
    if (message) {
      if (state.selectedSnapshot && state.selectedBasePolicy && state.selectedPackage) {
        return { step: 1, message, targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.testedValues };
      }
      return { step: 2, message, targetId: state.selectedSnapshot ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.baseline : SENSITIVITY_EXPERIMENT_DEMO_TARGETS.model };
    }
  }
  if (lastCompletedPage >= 3) {
    const message = validateSensitivityRunSettings(state.parameters, state.formValues, state.maxWorkers, state.maxWorkersCap);
    if (message) return { step: 3, message, targetId: SENSITIVITY_EXPERIMENT_DEMO_TARGETS.runSettings };
  }
  return null;
}

export function SensitivitySetupCard({
  draftId = '',
  initialStep,
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
  onCancelActive,
  sensitivityDemo
}: SensitivitySetupCardProps) {
  const [activeStep, setActiveStep] = useState(() => Math.max(0, Math.min(SENSITIVITY_STEPS.length - 1,
    initialStep ?? (sensitivityDemo?.active && !sensitivityDemo.paused ? undefined : readSensitivityDraft(draftId)?.currentStep) ?? 0
  )));
  const [stepError, setStepError] = useState('');
  const [stepErrorTargetId, setStepErrorTargetId] = useState<string | null>(null);
  const stepErrorRef = useRef<HTMLParagraphElement>(null);
  const stepperRef = useRef<HTMLElement>(null);
  const demoNameEditedRef = useRef(false);
  const isSensitivityDemoActive = sensitivityDemo?.active === true;
  const isSensitivityGuideActive = isSensitivityDemoActive && !sensitivityDemo?.paused;
  useEffect(() => {
    if (!isSensitivityGuideActive && !isLoadingOptions) updateSensitivityDraftStep(draftId, activeStep);
  }, [activeStep, draftId, isLoadingOptions, isSensitivityGuideActive]);
  useEffect(() => {
    const strip = stepperRef.current;
    const current = strip?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!strip || !current) return;
    const stripBounds = strip.getBoundingClientRect();
    const currentBounds = current.getBoundingClientRect();
    const offset = currentBounds.left < stripBounds.left
      ? currentBounds.left - stripBounds.left
      : Math.max(0, currentBounds.right - stripBounds.right);
    if (offset) strip.scrollBy({ left: offset, behavior: 'instant' });
  }, [activeStep, isLoadingOptions, sensitivityDemo?.savedStepId]);
  const orderedSnapshots = orderExperimentModelOptions(snapshots, selectedBaseline);
  const selectedSnapshot = orderedSnapshots.find((snapshot) => snapshot.version === selectedBaseline) ?? null;
  const selectedBasePolicy = basePolicies.find((policy) => policy.id === basePolicy) ?? null;
  const sampleValues = buildSensitivitySampleValues(selectedPackage, selectedBasePolicy, minValue, maxValue, sampleCount);
  const baselineValues = selectedPackage && selectedBasePolicy
    ? getPackageBaseValues(selectedPackage, selectedBasePolicy)
    : [];
  const basePolicyValues = selectedPackage && selectedBasePolicy ? formatPackageBaseValues(selectedPackage, selectedBasePolicy) : null;
  const simulationDuration = String(formValues.N_STEPS ?? '');
  const seedsPerPoint = parsePositiveIntegerForDisplay(formValues.N_SIMS);
  const seedsParameter = parameters.find((parameter) => parameter.key === 'N_SIMS');
  // Fields stay editable when execution is unavailable; only starting a run is gated, matching the policy builder.
  const formDisabled = isSubmitting;
  const practiceSubmissionBlocked = isSensitivityDemoActive && (
    !isSensitivityGuideActive || sensitivityDemo?.savedStepId !== 'sensitivity-submit' ||
    sensitivityDemo?.allowSensitivitySubmission !== true || Boolean(sensitivityDemo?.sensitivityRun)
  );
  const submissionBlocked = practiceSubmissionBlocked || isLoadingOptions || isSubmitting || executionDisabled || sensitivitySubmissionLockedByManual;

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
    }. Every other instrument stays at the ${baseName} value.`;
  })();

  const totalExecutions = pointCount > 0 && seedsPerPoint !== null ? pointCount * seedsPerPoint : 0;

  const commitDemoName = (value: string) => {
    if (!isSensitivityDemoActive) return;
    const committedName = committedExperimentDemoText(value, demoNameEditedRef.current);
    demoNameEditedRef.current = false;
    if (!committedName) return;
    sensitivityDemo?.onCommit('name', committedName);
  };

  const handleInstrumentChange = (value: string) => {
    clearValidationError();
    onPolicyPackageChange(value);
  };

  const handleModelChange = (value: string) => {
    clearValidationError();
    onBaselineChange(value);
  };

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

  const validationTargetForStep = (step: number): string => {
    if (step === 0) return SENSITIVITY_EXPERIMENT_DEMO_TARGETS.name;
    if (step === 1) {
      if (!selectedPackage) return SENSITIVITY_EXPERIMENT_DEMO_TARGETS.instrument;
      const min = Number.parseFloat(minValue);
      const max = Number.parseFloat(maxValue);
      if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < max)) {
        return SENSITIVITY_EXPERIMENT_DEMO_TARGETS.range;
      }
      return SENSITIVITY_EXPERIMENT_DEMO_TARGETS.sampleCount;
    }
    if (step === 2) {
      return selectedSnapshot
        ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.baseline
        : SENSITIVITY_EXPERIMENT_DEMO_TARGETS.model;
    }
    return SENSITIVITY_EXPERIMENT_DEMO_TARGETS.runSettings;
  };

  const firstInvalidStepThrough = (
    lastStep: number
  ): { step: number; message: string; targetId: string } | null => {
    for (let step = 0; step <= Math.min(lastStep, SENSITIVITY_STEPS.length - 2); step += 1) {
      const message = validateStep(step);
      if (message) return { step, message, targetId: validationTargetForStep(step) };
    }
    return null;
  };

  const navigateToStep = (nextStep: number) => {
    setStepError('');
    setStepErrorTargetId(null);
    setActiveStep(nextStep);
  };

  const continueToNextStep = () => {
    const invalid = firstInvalidStepThrough(activeStep);
    if (invalid) {
      setActiveStep(invalid.step);
      setStepError(invalid.message);
      setStepErrorTargetId(invalid.targetId);
      return;
    }
    navigateToStep(Math.min(SENSITIVITY_STEPS.length - 1, activeStep + 1));
  };

  const submitWithValidation = () => {
    if (submissionBlocked) return;
    const invalid = firstInvalidStepThrough(SENSITIVITY_STEPS.length - 2);
    if (invalid) {
      setActiveStep(invalid.step);
      setStepError(invalid.message);
      setStepErrorTargetId(invalid.targetId);
      return;
    }
    if (isSensitivityDemoActive && !validatePracticeSize()) return;
    onSubmit();
  };

  const clearValidationError = () => {
    // Keep a guided recovery target available throughout repairs, even when its page differs
    // from this stop's usual page. Successful Next or an explicit stop entry clears it.
    if (isSensitivityGuideActive && stepError) return;
    setStepError('');
    setStepErrorTargetId(null);
  };

  const restoreSensitivityDemoStep = useCallback((step: CreationDemoStep<SensitivityExperimentDemoStepId>) => {
    setActiveStep(step.wizardStep);
    setStepError('');
    setStepErrorTargetId(null);
  }, []);

  const beforeAdvanceSensitivityDemo = (nextStep: CreationDemoStep<SensitivityExperimentDemoStepId>): boolean => {
    if (nextStep.id === 'sensitivity-complete' && sensitivityDemo?.sensitivityRun?.status !== 'submitted') {
      setStepError('Select Start sensitivity analysis to queue your practice run.');
      setStepErrorTargetId(SENSITIVITY_EXPERIMENT_DEMO_TARGETS.startBoundary);
      return false;
    }
    const invalid = sensitivityCreationAdvanceValidation(nextStep, {
      title, selectedSnapshot, selectedBasePolicy, selectedPackage, minValue, maxValue, sampleCount,
      parameters, formValues, maxWorkers, maxWorkersCap
    });
    if (invalid) {
      setActiveStep(invalid.step);
      setStepError(invalid.message);
      setStepErrorTargetId(invalid.targetId);
      return false;
    }
    if (nextStep.wizardStep >= 2 && !validatePracticeSize()) return false;
    setStepError('');
    setStepErrorTargetId(null);
    return true;
  };

  const validatePracticeSize = (): boolean => {
    const message = validateSensitivityPracticeSize(formValues, sampleCount, maxWorkers);
    if (!message) return true;
    const wrongSamples = Number(sampleCount) !== 3;
    setActiveStep(wrongSamples ? 1 : 3);
    setStepError(message);
    setStepErrorTargetId(wrongSamples ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.sampleCount : SENSITIVITY_EXPERIMENT_DEMO_TARGETS.runSettings);
    return false;
  };

  return (
    <article className="scenario-builder-surface">
      <ExperimentHeaderStartButton
        disabled={isLoadingOptions || submissionBlocked}
        isSubmitting={isSubmitting}
        onStart={submitWithValidation}
      />
      {sensitivitySubmissionLockedByManual && lockMessage && <p className="info-banner">{lockMessage}</p>}
      {!isLoadingOptions && warnings.length > 0 && (
        <div className="run-warning-card" role="alert">
          <h4>Run information</h4>
          <ul>
            {warnings.map((warning) => (
              <li key={`${warning.code}-${warning.message}`}>{warning.message}</li>
            ))}
          </ul>
        </div>
      )}

      {(!isLoadingOptions || !isSensitivityDemoActive) && (
        <>
          <div className="scenario-builder-heading">
            <h2>Create a sensitivity analysis</h2>
            <p>Define the sweep, choose the model and baseline, and configure the run. Start from any step when the setup is ready.</p>
          </div>
          <nav
            ref={stepperRef}
            className="scenario-stepper sensitivity-stepper"
            aria-label="Sensitivity analysis sections"
            tabIndex={isSensitivityDemoActive ? -1 : undefined}
            data-experiment-demo-target={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.stepper : undefined}
          >
            {SENSITIVITY_STEPS.map((step, index) => (
              <button
                key={step.id}
                type="button"
                disabled={isLoadingOptions || isSensitivityGuideActive}
                aria-current={activeStep === index ? 'step' : undefined}
                onClick={() => navigateToStep(index)}
              >
                <span>{index + 1}</span>{step.label}
              </button>
            ))}
          </nav>
        </>
      )}
      {isLoadingOptions ? (
        <div className="scenario-builder-loading" role="status">
          <p className="loading-banner">Loading sensitivity analysis options...</p>
        </div>
      ) : (
        <>
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
                    data-experiment-demo-target={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.name : undefined}
                    onChange={(event) => {
                      clearValidationError();
                      if (isSensitivityDemoActive) {
                        demoNameEditedRef.current = true;
                        sensitivityDemo?.onCommit('name', event.target.value.trim());
                      }
                      onTitleChange(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                      event.preventDefault();
                      commitDemoName(event.currentTarget.value);
                      clearValidationError();
                    }}
                    onBlur={(event) => {
                      commitDemoName(event.currentTarget.value);
                      clearValidationError();
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
                <div
                  className="sensitivity-instrument-selection"
                  tabIndex={isSensitivityDemoActive ? -1 : undefined}
                  data-experiment-demo-target={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.instrument : undefined}
                >
                  <label className="scenario-field">
                    <InfoLabel label="Policy instrument to vary" info={SETTING_HELP.sensitivityPolicyPackage} />
                    <select
                      value={policyPackageId}
                      disabled={formDisabled}
                      onChange={(event) => handleInstrumentChange(event.target.value)}
                    >
                      {policyPackages.map((policyPackage) => (
                        <option key={policyPackage.id} value={policyPackage.id}>
                          {policyPackage.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedPackage ? <p className="scenario-section-intro">{selectedPackage.description}</p> : null}
                </div>
                <div data-experiment-demo-target={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.testedValues : undefined}>
                  <div
                    className="scenario-fields-grid sensitivity-range-fields"
                    data-experiment-demo-target={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.range : undefined}
                  >
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
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                          event.preventDefault();
                          clearValidationError();
                        }}
                        onBlur={() => {
                          clearValidationError();
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
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                          event.preventDefault();
                          clearValidationError();
                        }}
                        onBlur={() => {
                          clearValidationError();
                        }}
                      />
                    </label>
                  </div>
                  <div className="scenario-fields-grid sensitivity-sample-count-field">
                    <label className="scenario-field">
                      <InfoLabel label="Sample count" info={SETTING_HELP.sampleCount} />
                      <input
                        type="number"
                        step={1}
                        min={2}
                        value={sampleCount}
                        disabled={formDisabled}
                        data-experiment-demo-target={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.sampleCount : undefined}
                        onChange={(event) => {
                          clearValidationError();
                          onSampleCountChange(event.target.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                          event.preventDefault();
                          clearValidationError();
                        }}
                        onBlur={() => {
                          clearValidationError();
                        }}
                      />
                    </label>
                  </div>
                  <div
                    className="sensitivity-sweep-preview"
                    aria-live="polite"
                    tabIndex={isSensitivityDemoActive ? -1 : undefined}
                    data-experiment-demo-target={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.updatedPreview : undefined}
                  >
                    <strong>Values that will be tested</strong>
                    {sampleValues.length > 0 ? (
                      <ul
                        className="sensitivity-sampled-values"
                        tabIndex={isSensitivityDemoActive ? -1 : undefined}
                        data-experiment-demo-target={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.actualValues : undefined}
                      >
                        {sampleValues.map((value) => <li key={value}>{value}</li>)}
                      </ul>
                    ) : (
                      <p>Enter a valid minimum, maximum and sample count to preview the sampled values.</p>
                    )}
                    <p>{sweepSentence}</p>
                  </div>
                </div>
              </section>

              <section hidden={activeStep !== 2} id="sensitivity-model-baseline" className="scenario-section scenario-step-page" aria-labelledby="sensitivity-model-baseline-heading">
                <h3 id="sensitivity-model-baseline-heading">Model and baseline</h3>
                <p className="scenario-section-intro">
                  Choose the calibrated model and reference policy. Every instrument not being swept remains at the selected baseline-policy value.
                </p>
                <div
                  className="sensitivity-model-selection"
                  tabIndex={isSensitivityDemoActive ? -1 : undefined}
                  data-experiment-demo-target={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.model : undefined}
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
                  {selectedSnapshot && <p className="scenario-evidence-note">{formatEvidenceNote(selectedSnapshot)}</p>}
                  <p className="scenario-field-links">
                    <Link
                      className="summary-link-inline"
                      to={`/calibration?mode=single&version=${encodeURIComponent(selectedBaseline)}&from=sensitivity&draft=${encodeURIComponent(draftId)}&sensitivityStep=model-baseline`}
                      aria-disabled={isSensitivityDemoActive ? 'true' : undefined}
                      tabIndex={isSensitivityDemoActive ? -1 : undefined}
                      onClick={isSensitivityDemoActive ? (event) => event.preventDefault() : undefined}
                    >
                      View this model&rsquo;s assumptions
                    </Link>
                    <Link
                      className="summary-link-inline"
                      to={`/validation?version=${encodeURIComponent(selectedBaseline)}&evidenceYear=${
                        selectedSnapshot?.evidenceYear ?? 2024
                      }&from=sensitivity&draft=${encodeURIComponent(draftId)}&sensitivityStep=model-baseline`}
                      aria-disabled={isSensitivityDemoActive ? 'true' : undefined}
                      tabIndex={isSensitivityDemoActive ? -1 : undefined}
                      onClick={isSensitivityDemoActive ? (event) => event.preventDefault() : undefined}
                    >
                      Compare how models fit the evidence
                    </Link>
                  </p>
                </label>
                </div>
                <div
                  className="sensitivity-baseline-selection"
                  tabIndex={isSensitivityDemoActive ? -1 : undefined}
                  data-experiment-demo-target={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.baseline : undefined}
                >
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
                </div>
              </section>

              <section hidden={activeStep !== 3} id="sensitivity-run-settings" className="scenario-section scenario-step-page" aria-labelledby="sensitivity-run-settings-heading">
                <h3 id="sensitivity-run-settings-heading">Run and recording settings</h3>
                <p className="scenario-section-intro">
                  Set the simulation workload first. Recording is fixed to the summaries retained by sensitivity results.
                </p>
                <div
                  className="scenario-advanced-panel scenario-advanced-panel--inline"
                  tabIndex={isSensitivityDemoActive ? -1 : undefined}
                  data-experiment-demo-target={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.runSettings : undefined}
                >
                  <div className="scenario-advanced-content">
                    <h4>Run settings</h4>
                    <div
                      className="run-param-grid"
                      data-experiment-demo-target={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.seedsWorkload : undefined}
                    >
                      {seedsParameter && (
                        <ParameterInput
                          parameter={{ ...seedsParameter, title: 'Seeds per sampled point' }}
                          value={formValues.N_SIMS}
                          executionDisabled={formDisabled}
                          mode="sensitivity"
                          onChange={(parameter, value) => {
                            clearValidationError();
                            onFormValueChange(parameter, value);
                          }}
                        />
                      )}
                      <div className="sensitivity-execution-total" aria-live="polite">
                        <strong>{totalExecutions || '—'}</strong>
                        <span>Total model executions</span>
                        <small>{pointCount || '—'} settings × {seedsPerPoint ?? '—'} seeds per setting</small>
                      </div>
                    </div>
                    <GeneralModelControl
                      mode="sensitivity"
                      parameters={parameters.filter((parameter) => parameter.key !== 'N_SIMS')}
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
                      fixedRecordingDemoTarget={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.fixedRecording : undefined}
                    />
                  </div>
                </div>
              </section>

              <section data-experiment-demo-target={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.review : undefined} hidden={activeStep !== 4} id="sensitivity-review" className="scenario-section scenario-step-page" aria-labelledby="sensitivity-review-heading">
                <h3 id="sensitivity-review-heading">Review and start</h3>
                <p className="scenario-section-intro">Check the complete analysis specification before starting any model executions.</p>
                <dl
                  className="sensitivity-review-list"
                  tabIndex={isSensitivityDemoActive ? -1 : undefined}
                  data-experiment-demo-target={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.reviewSamples : undefined}
                >
                  <div><dt>Experiment name</dt><dd>{title.trim() || 'Not set'}</dd></div>
                  <div><dt>Policy instrument</dt><dd>{selectedPackage?.title ?? 'Not set'}</dd></div>
                  <div><dt>Sweep range</dt><dd>{minValue || '—'} to {maxValue || '—'} ({sampleCount || '—'} requested samples)</dd></div>
                  <div className="sensitivity-review-wide">
                    <dt>Actual sampled values</dt>
                    <dd>{sampleValues.length > 0 ? sampleValues.join(', ') : 'Not available'}</dd>
                  </div>
                </dl>
                <dl className="sensitivity-review-list sensitivity-review-context">
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
                <div
                  className="sensitivity-execution-total"
                  aria-live="polite"
                  tabIndex={isSensitivityDemoActive ? -1 : undefined}
                  data-experiment-demo-target={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.totalExecutions : undefined}
                >
                  <strong>{totalExecutions || '—'}</strong>
                  <span>Total model executions</span>
                  <small>
                    {pointCount || '—'} unique sampled {pointCount === 1 ? 'point' : 'points'} × {seedsPerPoint ?? '—'} {seedsPerPoint === 1 ? 'seed' : 'seeds'} per point
                  </small>
                </div>
              </section>

              <div className="scenario-page-navigation" aria-label="Sensitivity analysis page navigation">
                <div className="scenario-page-movement">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={activeStep === 0 || isSensitivityGuideActive}
                    aria-label="Back to previous step"
                    title="Back to previous step"
                    onClick={() => navigateToStep(Math.max(0, activeStep - 1))}
                  >
                    Back
                  </button>
                  {activeStep < SENSITIVITY_STEPS.length - 1 && (
                    <button
                      type="button"
                      className="secondary-button"
                      data-experiment-demo-target={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.continueButton : undefined}
                      aria-label="Continue to next step"
                      title="Continue to next step"
                      disabled={isSensitivityGuideActive}
                      onClick={continueToNextStep}
                    >
                      Next
                    </button>
                  )}
                </div>
                <div className="scenario-persistent-run-action">
                  {hasActiveSensitivityJob && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={isSensitivityDemoActive || isCanceling || executionDisabled}
                      onClick={onCancelActive}
                    >
                      {isCanceling ? 'Canceling...' : 'Cancel active experiment'}
                    </button>
                  )}
                  {activeStep === SENSITIVITY_STEPS.length - 1 && (
                    <button
                      type="button"
                      className="primary-button scenario-create-button"
                      style={{ background: '#237a36' }}
                      disabled={submissionBlocked}
                      data-experiment-demo-target={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.startBoundary : undefined}
                      onClick={submitWithValidation}
                    >
                      {isSubmitting
                        ? 'Starting...'
                        : 'Start sensitivity analysis'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <aside
              className="scenario-summary"
              aria-labelledby="sensitivity-summary-heading"
              tabIndex={isSensitivityDemoActive ? -1 : undefined}
              data-experiment-demo-target={isSensitivityDemoActive ? SENSITIVITY_EXPERIMENT_DEMO_TARGETS.liveSummary : undefined}
            >
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
      {sensitivityDemo && (
        <SensitivityExperimentDemo
          {...sensitivityDemo}
          currentWizardStep={activeStep}
          currentName={title}
          minValue={minValue}
          maxValue={maxValue}
          sampleCount={sampleCount}
          baselineValues={baselineValues}
          sampleValues={sampleValues}
          seedsPerPoint={seedsPerPoint}
          runMonths={simulationDuration}
          householdCount={String(formValues.TARGET_POPULATION ?? '')}
          selectedInstrument={policyPackageId}
          selectedModel={selectedBaseline}
          selectedBaselinePolicy={basePolicy}
          actionError={stepError}
          actionErrorTargetId={stepErrorTargetId}
          onRestoreStep={restoreSensitivityDemoStep}
          onBeforeAdvance={beforeAdvanceSensitivityDemo}
        />
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
