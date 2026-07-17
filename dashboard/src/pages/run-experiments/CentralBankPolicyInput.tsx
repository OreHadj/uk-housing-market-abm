import { useEffect, useRef, useState } from 'react';
import type { ModelRunParameterDefinition } from '../../../shared/types';
import { InfoLabel } from './InfoLabel';
import { ParameterInput } from './GeneralModelControl';
import { getParameterHelp, type ExperimentControlMode } from './settingHelp';

type FormValue = string | boolean;

const AFFORDABILITY_KEY = 'CENTRAL_BANK_AFFORDABILITY_HARD_MAX';
const ICR_KEY = 'CENTRAL_BANK_ICR_HARD_MIN';
const BASE_RATE_KEY = 'CENTRAL_BANK_INITIAL_BASE_RATE';

// "Off" / non-binding sentinels defined by the base-policy catalogue (policyCatalogue.ts):
// affordability 0.9999 is a ~100%-of-income cap that never bites; ICR 0 makes the coverage
// constraint a no-op. Every other value is a genuine binding setting.
const AFFORDABILITY_OFF_SENTINEL = 0.9999;
const ICR_OFF_SENTINEL = 0;
// Fallback binding values (the 2011 base policy) used only when no prior "on" value exists.
const AFFORDABILITY_ON_FALLBACK = 0.4;
const ICR_ON_FALLBACK = 1.2;

const VALUE_EPSILON = 1e-9;

/** True for the three Central Bank fields that get the toggle / percentage treatment. */
export function isCentralBankSpecialField(key: string): boolean {
  return key === AFFORDABILITY_KEY || key === ICR_KEY || key === BASE_RATE_KEY;
}

/** Formats a stored model-unit fraction for display in the field's own unit (%, ratio, …). */
function formatScaled(fraction: number, scale: number): string {
  if (!Number.isFinite(fraction)) {
    return '';
  }
  const rounded = Math.round(fraction * scale * 100) / 100;
  return String(rounded);
}

interface ScaledNumberInputProps {
  storedValue: string;
  scale: number;
  suffix: string;
  disabled: boolean;
  ariaLabel: string;
  onStoredChange: (next: string) => void;
}

/**
 * Number input that shows a scaled unit (e.g. base rate as a percentage) while keeping the exact
 * model-unit fraction in the submitted form value. Local text state lets the user type freely; it
 * only resyncs from the stored value when that value changes externally (base-policy switch, reset).
 */
function ScaledNumberInput({ storedValue, scale, suffix, disabled, ariaLabel, onStoredChange }: ScaledNumberInputProps) {
  const [text, setText] = useState(() => formatScaled(Number.parseFloat(storedValue), scale));

  useEffect(() => {
    const stored = Number.parseFloat(storedValue);
    if (!Number.isFinite(stored)) {
      return; // Empty / mid-edit stored value: leave the user's text alone.
    }
    const current = Number.parseFloat(text) / scale;
    if (!Number.isFinite(current) || Math.abs(current - stored) > VALUE_EPSILON) {
      setText(formatScaled(stored, scale));
    }
  }, [storedValue]);

  const handleChange = (raw: string) => {
    setText(raw);
    const parsed = Number.parseFloat(raw);
    onStoredChange(Number.isFinite(parsed) ? String(parsed / scale) : raw);
  };

  return (
    <span className="cap-value-field">
      <input
        type="number"
        step="any"
        value={text}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => handleChange(event.target.value)}
      />
      {suffix ? (
        <span className="cap-value-suffix" aria-hidden="true">
          {suffix}
        </span>
      ) : null}
    </span>
  );
}

interface CapFieldProps {
  parameter: ModelRunParameterDefinition;
  value: FormValue | undefined;
  disabled: boolean;
  mode: ExperimentControlMode;
  offSentinel: number;
  onFallback: number;
  scale: number;
  suffix: string;
  onChange: (parameter: ModelRunParameterDefinition, value: FormValue) => void;
}

/** A binding limit that can be switched Off (non-binding sentinel) or On (an editable value). */
function CapField({ parameter, value, disabled, mode, offSentinel, onFallback, scale, suffix, onChange }: CapFieldProps) {
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
  const isOff = Number.isFinite(numeric) && Math.abs(numeric - offSentinel) <= VALUE_EPSILON;

  // Remember the latest "on" value so re-enabling restores what the user last had.
  const lastOnValue = useRef<string>(String(onFallback));
  useEffect(() => {
    if (typeof value === 'string' && Number.isFinite(numeric) && !isOff) {
      lastOnValue.current = value;
    }
  }, [value, numeric, isOff]);

  const help = getParameterHelp(parameter, mode);
  const exactNote = typeof value === 'string' ? ` Exact model value: ${value}.` : '';
  const info = `${help} Off sets this to the non-binding value ${offSentinel}.${exactNote}`;
  const toggleName = `${parameter.key}-enabled`;

  const handleOff = () => onChange(parameter, String(offSentinel));
  const handleOn = () => {
    if (isOff) {
      onChange(parameter, lastOnValue.current);
    }
  };

  return (
    <div className="run-param-item cap-field">
      <InfoLabel label={parameter.title} info={info} />
      <span className="cap-toggle" role="radiogroup" aria-label={`${parameter.title} enabled`}>
        <label className="cap-toggle-option">
          <input type="radio" name={toggleName} checked={isOff} disabled={disabled} onChange={handleOff} />
          <span>Off</span>
        </label>
        <label className="cap-toggle-option">
          <input type="radio" name={toggleName} checked={!isOff} disabled={disabled} onChange={handleOn} />
          <span>On</span>
        </label>
      </span>
      {!isOff ? (
        <ScaledNumberInput
          storedValue={typeof value === 'string' ? value : ''}
          scale={scale}
          suffix={suffix}
          disabled={disabled}
          ariaLabel={`${parameter.title} value`}
          onStoredChange={(next) => onChange(parameter, next)}
        />
      ) : null}
    </div>
  );
}

interface BaseRateFieldProps {
  parameter: ModelRunParameterDefinition;
  value: FormValue | undefined;
  disabled: boolean;
  mode: ExperimentControlMode;
  onChange: (parameter: ModelRunParameterDefinition, value: FormValue) => void;
}

/** The initial base rate, shown and edited as a percentage while submitting the exact fraction. */
function BaseRateField({ parameter, value, disabled, mode, onChange }: BaseRateFieldProps) {
  const help = getParameterHelp(parameter, mode);
  const exactNote = typeof value === 'string' ? ` Exact model value: ${value}.` : '';
  const info = `${help} Shown as a percentage; the exact fraction is submitted.${exactNote}`;

  return (
    <div className="run-param-item cap-field">
      <InfoLabel label={parameter.title} info={info} />
      <ScaledNumberInput
        storedValue={typeof value === 'string' ? value : ''}
        scale={100}
        suffix="%"
        disabled={disabled}
        ariaLabel={`${parameter.title} percentage`}
        onStoredChange={(next) => onChange(parameter, next)}
      />
    </div>
  );
}

interface CentralBankPolicyInputProps {
  parameter: ModelRunParameterDefinition;
  value: FormValue | undefined;
  executionDisabled: boolean;
  mode?: ExperimentControlMode;
  onChange: (parameter: ModelRunParameterDefinition, value: FormValue) => void;
}

/**
 * Renders a Central Bank policy field. The base rate, affordability cap and ICR floor get an
 * interpretability-focused control (percentage display, Off/On toggle for the non-binding
 * sentinels); every other field falls back to the standard numeric input. All variants write the
 * same numeric string back into the form value, so the submitted payload is unchanged.
 */
export function CentralBankPolicyInput({
  parameter,
  value,
  executionDisabled,
  mode = 'manual',
  onChange
}: CentralBankPolicyInputProps) {
  if (parameter.key === BASE_RATE_KEY) {
    return <BaseRateField parameter={parameter} value={value} disabled={executionDisabled} mode={mode} onChange={onChange} />;
  }
  if (parameter.key === AFFORDABILITY_KEY) {
    return (
      <CapField
        parameter={parameter}
        value={value}
        disabled={executionDisabled}
        mode={mode}
        offSentinel={AFFORDABILITY_OFF_SENTINEL}
        onFallback={AFFORDABILITY_ON_FALLBACK}
        scale={100}
        suffix="%"
        onChange={onChange}
      />
    );
  }
  if (parameter.key === ICR_KEY) {
    return (
      <CapField
        parameter={parameter}
        value={value}
        disabled={executionDisabled}
        mode={mode}
        offSentinel={ICR_OFF_SENTINEL}
        onFallback={ICR_ON_FALLBACK}
        scale={1}
        suffix="×"
        onChange={onChange}
      />
    );
  }
  return (
    <ParameterInput
      parameter={parameter}
      value={value}
      executionDisabled={executionDisabled}
      mode={mode}
      onChange={onChange}
    />
  );
}
