// Author: Max Stoddard
import { CollapsibleSection } from '../../components/CollapsibleSection';
import type { ModelRunParameterDefinition } from '../../../shared/types';
import { InfoLabel } from './InfoLabel';
import { getParameterHelp, SETTING_HELP, type ExperimentControlMode } from './settingHelp';

type FormValue = string | boolean;
type ControlMode = ExperimentControlMode;
const HIDDEN_GENERAL_MODEL_CONTROL_KEYS = new Set(['TARGET_POPULATION', 'CUMULATIVE_WEIGHT_BEYOND_YEAR']);

interface GeneralModelControlProps {
  mode: ControlMode;
  parameters: ModelRunParameterDefinition[];
  formValues: Record<string, FormValue>;
  executionDisabled: boolean;
  onFormValueChange: (parameter: ModelRunParameterDefinition, value: FormValue) => void;
  maxWorkers?: string;
  maxWorkersCap?: number;
  onMaxWorkersChange?: (value: string) => void;
  maxWorkersHint?: string;
  showRecordSettings?: boolean;
  defaultOpen?: boolean;
  includeFixedControls?: boolean;
  embedded?: boolean;
}

export function isRecordSetting(parameter: ModelRunParameterDefinition): boolean {
  return parameter.key.startsWith('record') || parameter.key === 'TIME_TO_START_RECORDING_TRANSACTIONS';
}

function shouldShowParameter(parameter: ModelRunParameterDefinition): boolean {
  if (parameter.group !== 'General model control') {
    return false;
  }

  if (HIDDEN_GENERAL_MODEL_CONTROL_KEYS.has(parameter.key)) {
    return false;
  }

  if (parameter.key === 'SEED') {
    return false;
  }

  return true;
}

function displayParameter(parameter: ModelRunParameterDefinition, mode: ControlMode): ModelRunParameterDefinition {
  if (mode === 'manual' && parameter.key === 'TIME_TO_START_RECORDING_TRANSACTIONS') {
    return {
      ...parameter,
      title: 'Start recording at month'
    };
  }

  if (parameter.key === 'N_SIMS') {
    return {
      ...parameter,
      title: mode === 'sensitivity' ? 'Seeds per sampled point' : 'Seeds per run'
    };
  }

  return parameter;
}

interface ParameterInputProps {
  parameter: ModelRunParameterDefinition;
  value: FormValue | undefined;
  executionDisabled: boolean;
  mode?: ControlMode;
  onChange: (parameter: ModelRunParameterDefinition, value: FormValue) => void;
}

export function ParameterInput({ parameter, value, executionDisabled, mode = 'manual', onChange }: ParameterInputProps) {
  return (
    <label className="run-param-item">
      <InfoLabel label={parameter.title} info={getParameterHelp(parameter, mode)} />
      {parameter.type === 'boolean' ? (
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={executionDisabled}
          onChange={(event) => onChange(parameter, event.target.checked)}
        />
      ) : (
        <input
          type="number"
          step={parameter.type === 'integer' ? 1 : 'any'}
          value={String(value ?? '')}
          disabled={executionDisabled}
          onChange={(event) => onChange(parameter, event.target.value)}
        />
      )}
    </label>
  );
}

export function GeneralModelControl({
  mode,
  parameters,
  formValues,
  executionDisabled,
  onFormValueChange,
  maxWorkers,
  maxWorkersCap,
  onMaxWorkersChange,
  maxWorkersHint,
  showRecordSettings = true,
  defaultOpen = false,
  includeFixedControls = false,
  embedded = false
}: GeneralModelControlProps) {
  const visibleParameters = parameters
    .filter((parameter) =>
      includeFixedControls
        ? parameter.group === 'General model control' && parameter.key !== 'SEED'
        : shouldShowParameter(parameter)
    )
    .map((parameter) => displayParameter(parameter, mode));
  const modelParameters = visibleParameters.filter((parameter) => !isRecordSetting(parameter));
  const recordParameters = visibleParameters.filter(isRecordSetting);
  const optionalRecordParameters = mode === 'manual'
    ? recordParameters.filter((parameter) => parameter.key !== 'recordCoreIndicators')
    : [];
  const primaryModelParameters = modelParameters.filter((parameter) =>
    parameter.key === 'N_STEPS' || parameter.key === 'N_SIMS'
  );
  const remainingModelParameters = modelParameters.filter((parameter) =>
    parameter.key !== 'N_STEPS' && parameter.key !== 'N_SIMS'
  );
  const summaryCount = modelParameters.length + (showRecordSettings ? recordParameters.length : 0) + (onMaxWorkersChange ? 1 : 0);

  const controls = (
    <>
      <div className="run-param-grid">
        {primaryModelParameters.map((parameter) => (
          <ParameterInput
            key={parameter.key}
            parameter={parameter}
            value={formValues[parameter.key]}
            executionDisabled={executionDisabled}
            mode={mode}
            onChange={onFormValueChange}
          />
        ))}

        {onMaxWorkersChange && (
          <label className="run-param-item">
            <InfoLabel label="Max workers" info={maxWorkersHint ?? SETTING_HELP.maxWorkers} />
            <input
              type="number"
              step={1}
              min={1}
              max={maxWorkersCap}
              value={maxWorkers ?? ''}
              disabled={executionDisabled}
              onChange={(event) => onMaxWorkersChange(event.target.value)}
            />
          </label>
        )}

        {remainingModelParameters.map((parameter) => (
          <ParameterInput
            key={parameter.key}
            parameter={parameter}
            value={formValues[parameter.key]}
            executionDisabled={executionDisabled}
            mode={mode}
            onChange={onFormValueChange}
          />
        ))}
      </div>

      {showRecordSettings && (
        <RecordSettingsControl
          mode={mode}
          parameters={optionalRecordParameters}
          formValues={formValues}
          executionDisabled={executionDisabled}
          onFormValueChange={onFormValueChange}
        />
      )}
    </>
  );

  if (embedded) {
    return controls;
  }

  return (
    <CollapsibleSection
      title="General model control"
      defaultOpen={defaultOpen}
      summary={`${summaryCount} controls`}
      className="general-model-control"
    >
      {controls}
    </CollapsibleSection>
  );
}

interface RecordSettingsControlProps {
  mode: ControlMode;
  parameters: ModelRunParameterDefinition[];
  formValues: Record<string, FormValue>;
  executionDisabled: boolean;
  onFormValueChange: (parameter: ModelRunParameterDefinition, value: FormValue) => void;
}

export function RecordSettingsControl({
  mode,
  parameters,
  formValues,
  executionDisabled,
  onFormValueChange
}: RecordSettingsControlProps) {
  if (mode === 'sensitivity') {
    return (
      <section className="sensitivity-recording-settings" aria-labelledby="sensitivity-recording-settings-heading">
        <h4 id="sensitivity-recording-settings-heading">Recording settings</h4>
        <p className="sensitivity-recording-note">
          Transaction, bid-up, quality-band and household microdata files are unavailable for sensitivity analyses.
          Each sampled run is reduced to dashboard outcome summaries, then its raw output directory is discarded.
        </p>
      </section>
    );
  }

  return (
    <>
      <CollapsibleSection
        title={mode === 'manual' ? 'Additional data exports' : 'Record settings'}
        defaultOpen={false}
        summary={mode === 'manual' ? 'Optional transaction and household-level files' : `${parameters.length} controls`}
        className="record-settings-control"
      >
        {mode === 'manual' && (
          <p className="additional-data-exports-intro">
            Optional transaction and household-level files for analysis outside the dashboard. These exports can substantially increase file size and do not add charts to the current Results page.
          </p>
        )}
        <div className="run-param-grid">
          {parameters.map((parameter) => (
            <ParameterInput
              key={parameter.key}
              parameter={parameter}
              value={formValues[parameter.key]}
              executionDisabled={executionDisabled}
              mode={mode}
              onChange={onFormValueChange}
            />
          ))}
        </div>
      </CollapsibleSection>
    </>
  );
}
