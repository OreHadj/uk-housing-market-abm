import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BasePolicyId,
  BasePolicyOption,
  ExperimentProgressSnapshot,
  ExperimentJobSummary,
  ModelRunOptionsPayload,
  ModelRunParameterDefinition,
  ModelRunSubmitRequest,
  ModelRunWarning,
  SensitivityPolicyPackageDefinition
} from '../../../../shared/types';
import { normalizeSensitivitySampleValue } from '../../../../shared/sensitivitySampling';
import { DEFAULT_SENSITIVITY_POLICY_PACKAGE_ID } from '../../../../shared/policyCatalogue';
import {
  API_RETRY_DELAY_MS,
  cancelExperimentJob,
  fetchExperimentJobs,
  fetchModelRunOptions,
  isRetryableApiError,
  submitModelRun,
  submitSensitivityExperiment
} from '../../../lib/api';
import {
  DEFAULT_EXPERIMENT_BASE_POLICY_ID,
  applyPolicyRunBuilderDefaults,
  buildDefaultSensitivityRange,
  buildSensitivityGeneralModelControlOverridesFromForm,
  getDefaultExperimentBasePolicy,
  getPackageBaselineValues,
  isSameValue,
  normalizeManualScenarioFormValues,
  normalizeSensitivityFormValues,
  parseFormValue,
  toInitialFormValues,
  type FormValue
} from '../../../lib/experimentRunDefaults';
import { useExperimentLogs } from '../../run-experiments/useExperimentLogs';
import {
  clearScenarioDraft,
  readScenarioDraft,
  restoreScenarioDraft,
  writeScenarioDraft,
  type ScenarioDraftV1
} from '../../../lib/scenarioDraft';
import {
  clearSensitivityDraft,
  readSensitivityDraft,
  restoreSensitivityDraft,
  writeSensitivityDraft,
  type SensitivityDraftV1
} from '../../../lib/sensitivityDraft';
import type { ExperimentType } from '../types';

export interface ExperimentRunController {
  options: ModelRunOptionsPayload | null;
  selectedBaseline: string;
  basePolicy: BasePolicyId;
  setBasePolicy: (value: BasePolicyId) => void;
  title: string;
  setTitle: (value: string) => void;
  formValues: Record<string, FormValue>;
  manualMaxWorkers: string;
  setManualMaxWorkers: (value: string) => void;
  maxWorkersCap?: number;
  warnings: ModelRunWarning[];
  draftId: string;
  draftNotice: string;
  sensitivityTitle: string;
  setSensitivityTitle: (value: string) => void;
  sensitivityBasePolicy: BasePolicyId;
  setSensitivityBasePolicy: (value: BasePolicyId) => void;
  sensitivityPolicyPackageId: string;
  setSensitivityPolicyPackageId: (value: string) => void;
  sensitivityMin: string;
  setSensitivityMin: (value: string) => void;
  sensitivityMax: string;
  setSensitivityMax: (value: string) => void;
  sensitivitySampleCount: string;
  setSensitivitySampleCount: (value: string) => void;
  sensitivityMaxWorkers: string;
  setSensitivityMaxWorkers: (value: string) => void;
  sensitivityMaxWorkersCap?: number;
  sensitivityFormValues: Record<string, FormValue>;
  sensitivityWarnings: ModelRunWarning[];
  jobs: ExperimentJobSummary[];
  selectedJob: ExperimentJobSummary | null;
  selectedJobRef: string;
  logLines: string[];
  logProgress: ExperimentProgressSnapshot | null;
  logError: string;
  policyParameters: ModelRunParameterDefinition[];
  sensitivityPolicyPackages: SensitivityPolicyPackageDefinition[];
  selectedSensitivityPackage: SensitivityPolicyPackageDefinition | null;
  isLoadingOptions: boolean;
  isLoadingJobs: boolean;
  isSubmitting: boolean;
  isSubmittingSensitivity: boolean;
  isCancelingSensitivity: boolean;
  pageError: string;
  pendingRunId: string;
  pendingSensitivityExperimentId: string;
  executionDisabled: boolean;
  executionDisabledReason: string;
  manualSubmissionLockedBySensitivity: boolean;
  sensitivitySubmissionLockedByManual: boolean;
  lockSensitivityId: string;
  lockManualId: string;
  hasActiveSensitivityJob: boolean;
  onBaselineChange: (baseline: string) => void;
  onFormValueChange: (parameter: ModelRunParameterDefinition, value: FormValue) => void;
  onSensitivityFormValueChange: (parameter: ModelRunParameterDefinition, value: FormValue) => void;
  onSubmitRun: (confirmWarnings: boolean) => Promise<void>;
  onSubmitSensitivity: (confirmWarnings: boolean) => Promise<void>;
  onCancelActiveSensitivity: () => Promise<void>;
  onCancelJob: (jobRef: string) => Promise<void>;
  refreshJobs: () => Promise<void>;
}

interface UseExperimentRunControllerOptions {
  activeType: ExperimentType;
  selectedJobRef: string;
  onSelectedJobRefChange: (jobRef: string) => void;
  onOpenManualResults: (runId: string) => void;
  onOpenSensitivityResults: (experimentId: string) => void;
  onManualRunAccepted?: (runId: string) => void;
  onSensitivityRunAccepted?: (experimentId: string) => void;
  // Manual jobRef to auto-follow: once it completes, redirect to its results (Home "Default Run" hand-off).
  followJobRef?: string;
  draftId?: string;
}

function parseJobRefId(jobRef: string | null): string {
  if (!jobRef) {
    return '';
  }
  const match = /^(manual|sensitivity):(.+)$/.exec(jobRef);
  return match?.[2] ?? jobRef;
}

function applyBasePolicyToFormValues(
  parameters: ModelRunParameterDefinition[],
  basePolicy: BasePolicyOption,
  currentValues: Record<string, FormValue>
): Record<string, FormValue> {
  const knownKeys = new Set(parameters.map((parameter) => parameter.key));
  const nextValues = { ...currentValues };
  for (const [key, value] of Object.entries(basePolicy.values)) {
    if (knownKeys.has(key)) {
      nextValues[key] = String(value);
    }
  }
  return nextValues;
}

function estimateSensitivityPointCount(
  policyPackage: SensitivityPolicyPackageDefinition | null,
  basePolicy: BasePolicyOption | null,
  minRaw: string,
  maxRaw: string,
  sampleCountRaw: string
): number {
  if (!policyPackage || !basePolicy) {
    return 0;
  }

  const min = Number.parseFloat(minRaw);
  const max = Number.parseFloat(maxRaw);
  const sampleCount = Number.parseFloat(sampleCountRaw);
  const baselineValues = getPackageBaselineValues(policyPackage, basePolicy);
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    baselineValues.length !== policyPackage.parameterKeys.length ||
    baselineValues.some((value) => value < min || value > max) ||
    !Number.isFinite(sampleCount) ||
    !Number.isInteger(sampleCount) ||
    sampleCount < 2 ||
    !(min < max)
  ) {
    return 0;
  }

  const values = Array.from({ length: sampleCount }, (_, index) =>
    normalizeSensitivitySampleValue(
      index === sampleCount - 1 ? max : min + ((max - min) * index) / (sampleCount - 1),
      policyPackage.type
    )
  );
  const normalizedBaselineValues = baselineValues.map((value) => normalizeSensitivitySampleValue(value, policyPackage.type));
  const [firstBaseline] = normalizedBaselineValues;
  const hasSharedBaseline =
    firstBaseline !== undefined && normalizedBaselineValues.every((value) => Math.abs(value - firstBaseline) < 1e-12);
  if (hasSharedBaseline && firstBaseline !== undefined) {
    values.push(firstBaseline);
  } else {
    values.push(Number.NaN);
  }
  return new Set(values.map((value) => (Number.isNaN(value) ? 'base-policy' : String(value)))).size;
}

function parsePositiveInteger(rawValue: FormValue | undefined): number {
  const raw = typeof rawValue === 'string' ? rawValue : String(rawValue ?? '');
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

function defaultMaxWorkers(totalRuns: number, workerCap?: number): string {
  if (totalRuns <= 0) {
    return '1';
  }
  if (workerCap !== undefined) {
    const normalizedCap = Math.max(1, Math.trunc(workerCap));
    return String(Math.max(1, Math.min(totalRuns, normalizedCap)));
  }
  const cpuCount = Math.max(1, Math.trunc(window.navigator.hardwareConcurrency || 1));
  return String(Math.max(1, Math.min(totalRuns, cpuCount, 20)));
}

export function useExperimentRunController({
  activeType,
  selectedJobRef,
  onSelectedJobRefChange,
  onOpenManualResults,
  onOpenSensitivityResults,
  onManualRunAccepted,
  onSensitivityRunAccepted,
  followJobRef,
  draftId = ''
}: UseExperimentRunControllerOptions): ExperimentRunController {
  const [options, setOptions] = useState<ModelRunOptionsPayload | null>(null);
  const [selectedBaseline, setSelectedBaseline] = useState<string>('');
  const [basePolicy, setBasePolicyState] = useState<BasePolicyId>(DEFAULT_EXPERIMENT_BASE_POLICY_ID);

  const [title, setTitle] = useState<string>('');
  const [formValues, setFormValues] = useState<Record<string, FormValue>>({});
  const [manualMaxWorkers, setManualMaxWorkers] = useState<string>('1');
  const [manualMaxWorkersTouched, setManualMaxWorkersTouched] = useState<boolean>(false);
  const [warnings, setWarnings] = useState<ModelRunWarning[]>([]);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftNotice, setDraftNotice] = useState('');

  const [sensitivityTitle, setSensitivityTitle] = useState<string>('');
  const [sensitivityBasePolicy, setSensitivityBasePolicyState] = useState<BasePolicyId>(DEFAULT_EXPERIMENT_BASE_POLICY_ID);
  const [sensitivityPolicyPackageId, setSensitivityPolicyPackageId] = useState<string>('');
  const [sensitivityMin, setSensitivityMin] = useState<string>('');
  const [sensitivityMax, setSensitivityMax] = useState<string>('');
  const [sensitivitySampleCount, setSensitivitySampleCount] = useState<string>('5');
  const [sensitivityMaxWorkers, setSensitivityMaxWorkers] = useState<string>('1');
  const [sensitivityMaxWorkersTouched, setSensitivityMaxWorkersTouched] = useState<boolean>(false);
  const [sensitivityFormValues, setSensitivityFormValues] = useState<Record<string, FormValue>>({});
  const [sensitivityWarnings, setSensitivityWarnings] = useState<ModelRunWarning[]>([]);
  const skipSensitivityRangeResetForPackage = useRef('');

  const [jobs, setJobs] = useState<ExperimentJobSummary[]>([]);
  const [manualSubmissionLockedBySensitivity, setManualSubmissionLockedBySensitivity] = useState<boolean>(false);
  const [sensitivitySubmissionLockedByManual, setSensitivitySubmissionLockedByManual] = useState<boolean>(false);
  const [activeManualJobRef, setActiveManualJobRef] = useState<string | null>(null);
  const [activeSensitivityJobRef, setActiveSensitivityJobRef] = useState<string | null>(null);

  const [isLoadingOptions, setIsLoadingOptions] = useState<boolean>(true);
  const [isLoadingJobs, setIsLoadingJobs] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isSubmittingSensitivity, setIsSubmittingSensitivity] = useState<boolean>(false);
  const [isCancelingSensitivity, setIsCancelingSensitivity] = useState<boolean>(false);
  const [pageError, setPageError] = useState<string>('');

  const [pendingRunId, setPendingRunId] = useState<string>('');
  const [pendingSensitivityExperimentId, setPendingSensitivityExperimentId] = useState<string>('');
  const [pendingManualJobRef, setPendingManualJobRef] = useState<string>('');
  const [pendingSensitivityJobRef, setPendingSensitivityJobRef] = useState<string>('');

  const selectedJob = useMemo(
    () => jobs.find((job) => job.jobRef === selectedJobRef) ?? null,
    [jobs, selectedJobRef]
  );

  const policyParameters = useMemo(
    () => (options?.parameters ?? []).filter((parameter) => parameter.group === 'Central Bank policy'),
    [options]
  );

  const selectedSensitivityBasePolicy = useMemo(
    () => options?.basePolicies.find((item) => item.id === sensitivityBasePolicy) ?? null,
    [options, sensitivityBasePolicy]
  );

  const sensitivityPolicyPackages = useMemo(() => options?.sensitivityPolicyPackages ?? [], [options]);

  const selectedSensitivityPackage = useMemo(
    () => sensitivityPolicyPackages.find((policyPackage) => policyPackage.id === sensitivityPolicyPackageId) ?? null,
    [sensitivityPolicyPackageId, sensitivityPolicyPackages]
  );

  const activeSensitivityJob = useMemo(
    () => jobs.find((job) => job.type === 'sensitivity' && (job.status === 'queued' || job.status === 'running')) ?? null,
    [jobs]
  );

  const executionDisabled = Boolean(options && !options.executionEnabled);
  const executionDisabledReason = options?.executionDisabledReason ?? options?.remoteExecution?.reason ?? '';

  const { lines: logLines, progress: logProgress, error: logError } = useExperimentLogs(
    selectedJobRef,
    Boolean(options?.executionEnabled && selectedJobRef)
  );

  const refreshOptions = async (requestedBaseline?: string, hydrateDraft = false): Promise<ModelRunOptionsPayload | null> => {
    setPageError('');
    setIsLoadingOptions(true);

    try {
      const payload = await fetchModelRunOptions(requestedBaseline);
      const defaultBasePolicy = getDefaultExperimentBasePolicy(payload);
      const defaultBasePolicyOption = payload.basePolicies.find((item) => item.id === defaultBasePolicy) ?? null;
      const initialValues = toInitialFormValues(payload.parameters, defaultBasePolicyOption);
      // Seeds per sampled point come from the shared builder default, so a sweep point is scored
      // on the same seed depth as a scenario run.
      const initialSensitivityValues = normalizeSensitivityFormValues(payload.parameters, initialValues);
      setOptions(payload);
      setSelectedBaseline(payload.requestedBaseline);
      setBasePolicyState(defaultBasePolicy);
      setSensitivityBasePolicyState(defaultBasePolicy);
      setFormValues(applyPolicyRunBuilderDefaults(payload.parameters, initialValues));
      setSensitivityFormValues(initialSensitivityValues);
      setManualMaxWorkers(defaultMaxWorkers(parsePositiveInteger(initialValues.N_SIMS), payload.sensitivityMaxWorkersCap));
      setManualMaxWorkersTouched(false);
      setWarnings([]);
      if (activeType === 'manual' && draftId && hydrateDraft) {
        const stored = readScenarioDraft(draftId);
        if (stored) {
          const storedBasePolicyOption = payload.basePolicies.find((item) => item.id === stored.basePolicy) ?? defaultBasePolicyOption;
          const draftInitialValues = applyPolicyRunBuilderDefaults(
            payload.parameters,
            toInitialFormValues(payload.parameters, storedBasePolicyOption)
          );
          const fallback: ScenarioDraftV1 = {
            version: 1, title: '', calibratedModel: payload.requestedBaseline, basePolicy: defaultBasePolicy,
            formValues: draftInitialValues,
            maxWorkers: defaultMaxWorkers(parsePositiveInteger(initialValues.N_SIMS), payload.sensitivityMaxWorkersCap),
          };
          const restored = restoreScenarioDraft(stored, payload, fallback);
          setSelectedBaseline(restored.draft.calibratedModel);
          setBasePolicyState(restored.draft.basePolicy);
          setTitle(restored.draft.title);
          setFormValues(normalizeManualScenarioFormValues(restored.draft.formValues));
          setManualMaxWorkers(restored.draft.maxWorkers);
          setManualMaxWorkersTouched(true);
          setDraftNotice(restored.choicesChanged ? 'Some saved choices are no longer available and were replaced with current defaults.' : 'Scenario draft restored for this tab.');
        }
      }
      if (activeType === 'sensitivity' && draftId && hydrateDraft) {
        const stored = readSensitivityDraft(draftId);
        if (stored) {
          const storedBasePolicyOption = payload.basePolicies.find((item) => item.id === stored.basePolicy) ?? defaultBasePolicyOption;
          const draftInitialValues = normalizeSensitivityFormValues(
            payload.parameters,
            toInitialFormValues(payload.parameters, storedBasePolicyOption)
          );
          const fallbackPackage =
            payload.sensitivityPolicyPackages.find((item) => item.id === DEFAULT_SENSITIVITY_POLICY_PACKAGE_ID) ??
            payload.sensitivityPolicyPackages[0] ?? null;
          const fallbackRange = fallbackPackage
            ? buildDefaultSensitivityRange(fallbackPackage, storedBasePolicyOption)
            : { min: '', max: '' };
          const fallback: SensitivityDraftV1 = {
            version: 1,
            title: '',
            calibratedModel: payload.requestedBaseline,
            basePolicy: defaultBasePolicy,
            policyPackageId: fallbackPackage?.id ?? '',
            min: fallbackRange.min,
            max: fallbackRange.max,
            sampleCount: '5',
            formValues: draftInitialValues,
            maxWorkers: defaultMaxWorkers(
              parsePositiveInteger(draftInitialValues.N_SIMS),
              payload.sensitivityMaxWorkersCap
            )
          };
          const restored = restoreSensitivityDraft(stored, payload, fallback);
          setSelectedBaseline(restored.draft.calibratedModel);
          setSensitivityBasePolicyState(restored.draft.basePolicy);
          setSensitivityTitle(restored.draft.title);
          setSensitivityPolicyPackageId(restored.draft.policyPackageId);
          setSensitivityMin(restored.draft.min);
          setSensitivityMax(restored.draft.max);
          setSensitivitySampleCount(restored.draft.sampleCount);
          setSensitivityFormValues(normalizeSensitivityFormValues(payload.parameters, restored.draft.formValues));
          setSensitivityMaxWorkers(restored.draft.maxWorkers);
          setSensitivityMaxWorkersTouched(true);
          skipSensitivityRangeResetForPackage.current = restored.draft.policyPackageId;
          setDraftNotice(restored.choicesChanged
            ? 'Some saved choices are no longer available and were replaced with current defaults.'
            : 'Sensitivity draft restored for this tab.');
        }
      }
      setDraftHydrated(true);
      return payload;
    } catch (error) {
      setPageError((error as Error).message);
      return null;
    } finally {
      setIsLoadingOptions(false);
    }
  };

  useEffect(() => {
    if (activeType !== 'manual' || !draftId || !draftHydrated || !options) return;
    writeScenarioDraft(draftId, {
      version: 1,
      title,
      calibratedModel: selectedBaseline,
      basePolicy,
      formValues,
      maxWorkers: manualMaxWorkers
    });
  }, [activeType, basePolicy, draftHydrated, draftId, formValues, manualMaxWorkers, options, selectedBaseline, title]);

  useEffect(() => {
    if (activeType !== 'sensitivity' || !draftId || !draftHydrated || !options) return;
    writeSensitivityDraft(draftId, {
      version: 1,
      title: sensitivityTitle,
      calibratedModel: selectedBaseline,
      basePolicy: sensitivityBasePolicy,
      policyPackageId: sensitivityPolicyPackageId,
      min: sensitivityMin,
      max: sensitivityMax,
      sampleCount: sensitivitySampleCount,
      formValues: sensitivityFormValues,
      maxWorkers: sensitivityMaxWorkers
    });
  }, [
    activeType,
    draftHydrated,
    draftId,
    options,
    selectedBaseline,
    sensitivityBasePolicy,
    sensitivityFormValues,
    sensitivityMax,
    sensitivityMaxWorkers,
    sensitivityMin,
    sensitivityPolicyPackageId,
    sensitivitySampleCount,
    sensitivityTitle
  ]);

  const refreshJobs = async () => {
    try {
      const payload = await fetchExperimentJobs();
      setJobs(payload.jobs);
      setManualSubmissionLockedBySensitivity(payload.locks.manualSubmissionLocked);
      setSensitivitySubmissionLockedByManual(payload.locks.sensitivitySubmissionLocked);
      setActiveManualJobRef(payload.locks.activeManualJobRef);
      setActiveSensitivityJobRef(payload.locks.activeSensitivityJobRef);

      const nextSelectedJobRef =
        selectedJobRef && payload.jobs.some((job) => job.jobRef === selectedJobRef)
          ? selectedJobRef
          : payload.jobs[0]?.jobRef ?? '';

      if (nextSelectedJobRef !== selectedJobRef) {
        onSelectedJobRefChange(nextSelectedJobRef);
      }
    } catch (error) {
      if (!isRetryableApiError(error)) {
        setPageError((error as Error).message);
      }
    } finally {
      setIsLoadingJobs(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

    const load = async () => {
      // A "Use this model" hand-off from Validation arrives as ?baseline=<version>. Honour it once
      // on mount so the analyst returns to the form with the model they chose already selected.
      const handedOffBaseline = new URLSearchParams(window.location.search).get('baseline')?.trim();
      const savedDraftBaseline = draftId
        ? activeType === 'manual'
          ? readScenarioDraft(draftId)?.calibratedModel
          : readSensitivityDraft(draftId)?.calibratedModel
        : '';
      const loadedOptions = await refreshOptions(handedOffBaseline || savedDraftBaseline || undefined, true);
      if (cancelled) {
        return;
      }

      if (!loadedOptions || !loadedOptions.executionEnabled) {
        setIsLoadingJobs(false);
        setJobs([]);
        if (selectedJobRef) {
          onSelectedJobRefChange('');
        }
        return;
      }

      await refreshJobs();
    };

    void load().catch((error: unknown) => {
      if (cancelled) {
        return;
      }
      if (isRetryableApiError(error)) {
        retryTimer = window.setTimeout(() => {
          void load();
        }, API_RETRY_DELAY_MS);
        return;
      }
      setPageError((error as Error).message);
    });

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, []);

  useEffect(() => {
    if (!options?.executionEnabled) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshJobs();
    }, 2000);

    return () => {
      window.clearInterval(interval);
    };
  }, [options?.executionEnabled, selectedJobRef]);

  useEffect(() => {
    const firstPackage = sensitivityPolicyPackages[0];
    if (!firstPackage) {
      setSensitivityPolicyPackageId('');
      return;
    }

    setSensitivityPolicyPackageId((current) => {
      if (current && sensitivityPolicyPackages.some((item) => item.id === current)) {
        return current;
      }
      return (
        sensitivityPolicyPackages.find((item) => item.id === DEFAULT_SENSITIVITY_POLICY_PACKAGE_ID)?.id ?? firstPackage.id
      );
    });
  }, [sensitivityPolicyPackages]);

  useEffect(() => {
    if (!selectedSensitivityPackage) {
      setSensitivityMin('');
      setSensitivityMax('');
      return;
    }

    if (skipSensitivityRangeResetForPackage.current === selectedSensitivityPackage.id) {
      skipSensitivityRangeResetForPackage.current = '';
      return;
    }

    const defaults = buildDefaultSensitivityRange(selectedSensitivityPackage, selectedSensitivityBasePolicy);
    setSensitivityMin(defaults.min);
    setSensitivityMax(defaults.max);
  }, [selectedSensitivityBasePolicy, selectedSensitivityPackage?.id, selectedBaseline]);

  useEffect(() => {
    if (manualMaxWorkersTouched) {
      return;
    }
    const seedCount = parsePositiveInteger(formValues.N_SIMS);
    setManualMaxWorkers(defaultMaxWorkers(seedCount, options?.sensitivityMaxWorkersCap));
  }, [formValues.N_SIMS, manualMaxWorkersTouched, options?.sensitivityMaxWorkersCap]);

  useEffect(() => {
    if (sensitivityMaxWorkersTouched) {
      return;
    }
    const pointCount = estimateSensitivityPointCount(
      selectedSensitivityPackage,
      selectedSensitivityBasePolicy,
      sensitivityMin,
      sensitivityMax,
      sensitivitySampleCount
    );
    const seedCount = parsePositiveInteger(sensitivityFormValues.N_SIMS);
    setSensitivityMaxWorkers(defaultMaxWorkers(pointCount * seedCount, options?.sensitivityMaxWorkersCap));
  }, [
    options?.sensitivityMaxWorkersCap,
    selectedSensitivityBasePolicy,
    selectedSensitivityPackage,
    sensitivityFormValues.N_SIMS,
    sensitivityMax,
    sensitivityMaxWorkersTouched,
    sensitivityMin,
    sensitivitySampleCount
  ]);

  useEffect(() => {
    if (!followJobRef || !followJobRef.startsWith('manual:')) {
      return;
    }
    // Adopt a hand-off job (e.g. from Home's Default Run) as pending so the existing
    // completion effect redirects to its results once it succeeds.
    setPendingManualJobRef((current) => current || followJobRef);
  }, [followJobRef]);

  useEffect(() => {
    if (!pendingManualJobRef) {
      return;
    }

    const job = jobs.find((item) => item.jobRef === pendingManualJobRef);
    if (!job) {
      return;
    }

    if (job.status === 'succeeded' && job.runId) {
      setPendingRunId(job.runId);
      setPendingManualJobRef('');
      return;
    }

    if (job.status === 'failed' || job.status === 'canceled') {
      setPendingManualJobRef('');
    }
  }, [jobs, pendingManualJobRef]);

  useEffect(() => {
    if (!pendingSensitivityJobRef) {
      return;
    }

    const job = jobs.find((item) => item.jobRef === pendingSensitivityJobRef);
    if (!job) {
      return;
    }

    if (job.status === 'succeeded') {
      setPendingSensitivityExperimentId(job.id);
      setPendingSensitivityJobRef('');
      return;
    }

    if (job.status === 'failed' || job.status === 'canceled') {
      setPendingSensitivityJobRef('');
    }
  }, [jobs, pendingSensitivityJobRef]);

  useEffect(() => {
    if (!pendingRunId) {
      return;
    }

    const timer = window.setTimeout(() => {
      onOpenManualResults(pendingRunId);
      setPendingRunId('');
    }, 1200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [onOpenManualResults, pendingRunId]);

  useEffect(() => {
    if (!pendingSensitivityExperimentId) {
      return;
    }

    const timer = window.setTimeout(() => {
      onOpenSensitivityResults(pendingSensitivityExperimentId);
      setPendingSensitivityExperimentId('');
    }, 1200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [onOpenSensitivityResults, pendingSensitivityExperimentId]);

  const onBaselineChange = (nextBaseline: string) => {
    if (!nextBaseline || nextBaseline === selectedBaseline) {
      return;
    }
    void refreshOptions(nextBaseline);
  };

  const onBasePolicyChange = (nextBasePolicy: BasePolicyId) => {
    if (!options || nextBasePolicy === basePolicy) {
      return;
    }
    const option = options.basePolicies.find((item) => item.id === nextBasePolicy);
    if (!option) {
      return;
    }
    setBasePolicyState(nextBasePolicy);
    setFormValues((current) => applyBasePolicyToFormValues(options.parameters, option, current));
    setWarnings([]);
  };

  const onSensitivityBasePolicyChange = (nextBasePolicy: BasePolicyId) => {
    if (!options || nextBasePolicy === sensitivityBasePolicy) {
      return;
    }
    const option = options.basePolicies.find((item) => item.id === nextBasePolicy);
    if (!option) {
      return;
    }
    setSensitivityBasePolicyState(nextBasePolicy);
    setSensitivityFormValues((current) => applyBasePolicyToFormValues(options.parameters, option, current));
    setSensitivityWarnings([]);
  };

  const onFormValueChange = (parameter: ModelRunParameterDefinition, value: FormValue) => {
    setFormValues((current) => ({
      ...current,
      [parameter.key]: value
    }));
    setWarnings([]);
  };

  const onSensitivityFormValueChange = (parameter: ModelRunParameterDefinition, value: FormValue) => {
    if (
      parameter.key === 'TIME_TO_START_RECORDING_TRANSACTIONS' ||
      (parameter.type === 'boolean' && parameter.key.startsWith('record'))
    ) {
      return;
    }
    setSensitivityFormValues((current) => ({
      ...current,
      [parameter.key]: value
    }));
    setSensitivityWarnings([]);
  };

  const buildSubmitPayload = (confirmWarnings: boolean, maxWorkers: number): ModelRunSubmitRequest => {
    if (!options) {
      throw new Error('Run options are not loaded yet.');
    }

    const overrides: Record<string, number | boolean> = {};

    for (const parameter of options.parameters) {
      if (parameter.key === 'SEED') {
        continue;
      }
      const rawValue = formValues[parameter.key];
      const parsedValue = parameter.key === 'recordCoreIndicators' ? true : parseFormValue(parameter, rawValue);
      if (parameter.key === 'recordCoreIndicators') {
        overrides.recordCoreIndicators = true;
        continue;
      }
      if (parameter.group === 'Central Bank policy') {
        overrides[parameter.key] = parsedValue;
        continue;
      }
      if (!isSameValue(parsedValue, parameter.defaultValue)) {
        overrides[parameter.key] = parsedValue;
      }
    }

    return {
      baseline: selectedBaseline,
      basePolicy,
      title,
      overrides,
      maxWorkers: Math.min(maxWorkers, options.sensitivityMaxWorkersCap ?? maxWorkers),
      confirmWarnings
    };
  };

  const buildSensitivityGeneralOverrides = (): Record<string, number | boolean> => {
    if (!options) {
      throw new Error('Run options are not loaded yet.');
    }

    return buildSensitivityGeneralModelControlOverridesFromForm(options.parameters, sensitivityFormValues);
  };

  const onSubmitRun = async (confirmWarnings: boolean) => {
    setPageError('');
    setIsSubmitting(true);

    try {
      const maxWorkers = Number(manualMaxWorkers);
      if (!Number.isFinite(maxWorkers) || !Number.isInteger(maxWorkers) || maxWorkers < 1) {
        throw new Error('Max workers must be a positive integer.');
      }
      const payload = buildSubmitPayload(confirmWarnings, maxWorkers);
      const response = await submitModelRun(payload);
      if (!response.accepted) {
        setWarnings(response.warnings);
        return;
      }

      setDraftHydrated(false);
      clearScenarioDraft(draftId);
      setWarnings([]);
      setTitle('');
      if (response.job) {
        const jobRef = `manual:${response.job.jobId}`;
        setPendingManualJobRef(jobRef);
        onSelectedJobRefChange(jobRef);
      }
      onManualRunAccepted?.(response.job?.runId ?? '');
      await refreshJobs();
    } catch (error) {
      setPageError((error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onSubmitSensitivity = async (confirmWarnings: boolean) => {
    if (!selectedSensitivityPackage) {
      setPageError('Select a policy instrument for the sensitivity analysis.');
      return;
    }

    setPageError('');
    setIsSubmittingSensitivity(true);

    try {
      const min = Number.parseFloat(sensitivityMin);
      const max = Number.parseFloat(sensitivityMax);
      const sampleCount = Number.parseFloat(sensitivitySampleCount);
      const maxWorkers = Number.parseFloat(sensitivityMaxWorkers);
      if (!Number.isFinite(sampleCount) || !Number.isInteger(sampleCount) || sampleCount < 2) {
        throw new Error('Sample count must be an integer greater than or equal to 2.');
      }
      if (!Number.isFinite(maxWorkers) || !Number.isInteger(maxWorkers) || maxWorkers < 1) {
        throw new Error('Max workers must be a positive integer.');
      }
      const response = await submitSensitivityExperiment({
        baseline: selectedBaseline,
        basePolicy: sensitivityBasePolicy,
        title: sensitivityTitle,
        policyPackageId: selectedSensitivityPackage.id,
        min,
        max,
        sampleCount,
        overrides: buildSensitivityGeneralOverrides(),
        maxWorkers: Math.min(maxWorkers, options?.sensitivityMaxWorkersCap ?? maxWorkers),
        confirmWarnings
      });

      if (!response.accepted) {
        setSensitivityWarnings(response.warnings);
        return;
      }

      setDraftHydrated(false);
      clearSensitivityDraft(draftId);
      setSensitivityWarnings([]);
      setSensitivityTitle('');
      let acceptedExperimentId = '';
      if (response.experiment) {
        acceptedExperimentId = response.experiment.experimentId;
        const jobRef = `sensitivity:${acceptedExperimentId}`;
        setPendingSensitivityJobRef(jobRef);
        onSelectedJobRefChange(jobRef);
      }
      onSensitivityRunAccepted?.(acceptedExperimentId);
      await refreshJobs();
    } catch (error) {
      setPageError((error as Error).message);
    } finally {
      setIsSubmittingSensitivity(false);
    }
  };

  const onCancelActiveSensitivity = async () => {
    if (!activeSensitivityJob) {
      return;
    }

    setPageError('');
    setIsCancelingSensitivity(true);
    try {
      await cancelExperimentJob(activeSensitivityJob.jobRef);
      await refreshJobs();
    } catch (error) {
      setPageError((error as Error).message);
    } finally {
      setIsCancelingSensitivity(false);
    }
  };

  const onCancelJob = async (jobRef: string) => {
    setPageError('');

    try {
      await cancelExperimentJob(jobRef);
      await refreshJobs();
    } catch (error) {
      setPageError((error as Error).message);
    }
  };

  const onSensitivityPolicyPackageChange = (value: string) => {
    setSensitivityPolicyPackageId(value);
    setSensitivityWarnings([]);
  };

  const onSensitivityMinChange = (value: string) => {
    setSensitivityMin(value);
    setSensitivityWarnings([]);
  };

  const onSensitivityMaxChange = (value: string) => {
    setSensitivityMax(value);
    setSensitivityWarnings([]);
  };

  const onSensitivitySampleCountChange = (value: string) => {
    setSensitivitySampleCount(value);
    setSensitivityWarnings([]);
  };

  const onSensitivityMaxWorkersChange = (value: string) => {
    setSensitivityMaxWorkers(value);
    setSensitivityMaxWorkersTouched(true);
    setSensitivityWarnings([]);
  };

  const onManualMaxWorkersChange = (value: string) => {
    setManualMaxWorkers(value);
    setManualMaxWorkersTouched(true);
    setWarnings([]);
  };

  return {
    options,
    selectedBaseline,
    basePolicy,
    setBasePolicy: onBasePolicyChange,
    title,
    setTitle,
    formValues,
    manualMaxWorkers,
    setManualMaxWorkers: onManualMaxWorkersChange,
    maxWorkersCap: options?.sensitivityMaxWorkersCap,
    warnings,
    draftId,
    draftNotice,
    sensitivityTitle,
    setSensitivityTitle,
    sensitivityBasePolicy,
    setSensitivityBasePolicy: onSensitivityBasePolicyChange,
    sensitivityPolicyPackageId,
    setSensitivityPolicyPackageId: onSensitivityPolicyPackageChange,
    sensitivityMin,
    setSensitivityMin: onSensitivityMinChange,
    sensitivityMax,
    setSensitivityMax: onSensitivityMaxChange,
    sensitivitySampleCount,
    setSensitivitySampleCount: onSensitivitySampleCountChange,
    sensitivityMaxWorkers,
    setSensitivityMaxWorkers: onSensitivityMaxWorkersChange,
    sensitivityMaxWorkersCap: options?.sensitivityMaxWorkersCap,
    sensitivityFormValues,
    sensitivityWarnings,
    jobs,
    selectedJob,
    selectedJobRef,
    logLines,
    logProgress,
    logError,
    policyParameters,
    sensitivityPolicyPackages,
    selectedSensitivityPackage,
    isLoadingOptions,
    isLoadingJobs,
    isSubmitting,
    isSubmittingSensitivity,
    isCancelingSensitivity,
    pageError,
    pendingRunId,
    pendingSensitivityExperimentId,
    executionDisabled,
    executionDisabledReason,
    manualSubmissionLockedBySensitivity,
    sensitivitySubmissionLockedByManual,
    lockSensitivityId: parseJobRefId(activeSensitivityJobRef),
    lockManualId: parseJobRefId(activeManualJobRef),
    hasActiveSensitivityJob: Boolean(activeSensitivityJob),
    onBaselineChange,
    onFormValueChange,
    onSensitivityFormValueChange,
    onSubmitRun,
    onSubmitSensitivity,
    onCancelActiveSensitivity,
    onCancelJob,
    refreshJobs
  };
}
