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
  defaultOpen = true,
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
  const summaryCount = modelParameters.length + (showRecordSettings ? recordParameters.length : 0) + (onMaxWorkersChange ? 1 : 0);

  const controls = (
    <>
      <div className="run-param-grid">
        {modelParameters.map((parameter) => (
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
      </div>

      {showRecordSettings && (
        <RecordSettingsControl
          parameters={recordParameters}
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
  parameters: ModelRunParameterDefinition[];
  formValues: Record<string, FormValue>;
  executionDisabled: boolean;
  onFormValueChange: (parameter: ModelRunParameterDefinition, value: FormValue) => void;
}

export function RecordSettingsControl({
  parameters,
  formValues,
  executionDisabled,
  onFormValueChange
}: RecordSettingsControlProps) {
  if (parameters.length === 0) {
    return null;
  }

  return (
    <CollapsibleSection
      title="Record settings"
      defaultOpen={false}
      summary={`${parameters.length} controls`}
      className="record-settings-control"
    >
      <div className="run-param-grid">
        {parameters.map((parameter) => (
          <ParameterInput
            key={parameter.key}
            parameter={parameter}
            value={formValues[parameter.key]}
            executionDisabled={executionDisabled}
            mode="manual"
            onChange={onFormValueChange}
          />
        ))}
      </div>
    </CollapsibleSection>
  );
}
