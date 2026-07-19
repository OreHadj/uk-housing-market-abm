import { useEffect, useRef, useState } from 'react';
import type { ModelRunParameterDefinition } from '../../../shared/types';
import {
  CENTRAL_BANK_AFFORDABILITY_OFF_SENTINEL,
  CENTRAL_BANK_ICR_OFF_SENTINEL
} from '../../../shared/policyCatalogue';
import {
  formatExactModelValue,
  formatExactScaled,
  formatScaled,
  fractionsEqual,
  resolveEditedStoredValue,
  scaledInputToStoredFraction
} from '../../../shared/policyDisplay';
import { InfoLabel } from './InfoLabel';
import { ParameterInput } from './GeneralModelControl';
import { getParameterHelp, type ExperimentControlMode } from './settingHelp';

type FormValue = string | boolean;

const AFFORDABILITY_KEY = 'CENTRAL_BANK_AFFORDABILITY_HARD_MAX';
const ICR_KEY = 'CENTRAL_BANK_ICR_HARD_MIN';
const BASE_RATE_KEY = 'CENTRAL_BANK_INITIAL_BASE_RATE';

// Fallback binding values (the 2011 base policy) used only when no prior "on" value exists.
const AFFORDABILITY_ON_FALLBACK = 0.4;
const ICR_ON_FALLBACK = 1.2;

/** True for the three Central Bank fields that get the toggle / percentage treatment. */
export function isCentralBankSpecialField(key: string): boolean {
  return key === AFFORDABILITY_KEY || key === ICR_KEY || key === BASE_RATE_KEY;
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
 * model-unit fraction in the submitted form value. Local text state lets the user type freely.
 *
 * `canonicalRef` holds the exact fraction the current display was seeded from; it is reseeded only on
 * external stored-value changes (base-policy switch, reset), never by the user's own typing. That way
 * an untouched field submits the base policy's fraction byte-for-byte, and reverting the display to
 * its original value restores that exact fraction rather than the rounded percentage it was shown as.
 * `lastEmittedRef` distinguishes our own edits (echoed back through the form) from external changes.
 */
function ScaledNumberInput({ storedValue, scale, suffix, disabled, ariaLabel, onStoredChange }: ScaledNumberInputProps) {
  const [text, setText] = useState(() => formatScaled(Number.parseFloat(storedValue), scale));
  const canonicalRef = useRef(storedValue);
  const lastEmittedRef = useRef(storedValue);

  useEffect(() => {
    if (storedValue === lastEmittedRef.current) {
      return; // Echo of our own edit: keep the canonical fraction and the user's in-progress text.
    }
    lastEmittedRef.current = storedValue;
    canonicalRef.current = storedValue;
    const stored = Number.parseFloat(storedValue);
    setText(Number.isFinite(stored) ? formatScaled(stored, scale) : '');
  }, [storedValue, scale]);

  const handleChange = (raw: string) => {
    setText(raw);
    const next = resolveEditedStoredValue(canonicalRef.current, raw, scale);
    lastEmittedRef.current = next;
    onStoredChange(next);
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
  const isOff = Number.isFinite(numeric) && fractionsEqual(numeric, offSentinel);

  // Remember the latest "on" value so re-enabling restores what the user last had.
  const lastOnValue = useRef<string>(String(onFallback));
  useEffect(() => {
    if (typeof value === 'string' && Number.isFinite(numeric) && !isOff) {
      lastOnValue.current = value;
    }
  }, [value, numeric, isOff]);

  const help = getParameterHelp(parameter, mode);
  const exactNote = typeof value === 'string' ? ` Exact model value: ${formatExactModelValue(value)}.` : '';
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

const BASE_RATE_SCALE = 100;

interface BaseRateFieldProps {
  parameter: ModelRunParameterDefinition;
  value: FormValue | undefined;
  basePolicyValue: number | undefined;
  disabled: boolean;
  mode: ExperimentControlMode;
  onChange: (parameter: ModelRunParameterDefinition, value: FormValue) => void;
}

/**
 * The initial base rate, shown and edited as a percentage. A "Use base policy value" checkbox makes
 * the two states unambiguous:
 *
 *  - Checked (default): the input is locked and greyed, showing the base policy's exact rate as a
 *    percentage (5.10833333%, at full precision — not the 2-dp rounded stand-in). On submit that
 *    exact stored fraction (0.0510833333) is passed through byte-for-byte.
 *  - Unchecked: the box clears to empty so the user types a fresh override; whatever they type is
 *    submitted as a plain reading of the percentage (5.11 -> 0.0511). An empty box is left as an
 *    invalid/empty value for submit-time validation to catch.
 *
 * Re-checking discards any typed value and returns to the base policy fraction. Switching the base
 * policy returns to the checked state (the run controller already overwrites the stored value on a
 * base-policy switch, so any override is discarded there regardless).
 */
function BaseRateField({ parameter, value, basePolicyValue, disabled, mode, onChange }: BaseRateFieldProps) {
  // Fall back to the current stored value if the base policy has no rate for this key (never expected
  // for the base rate, but keeps the control usable rather than blank).
  const baseFraction =
    typeof basePolicyValue === 'number' && Number.isFinite(basePolicyValue)
      ? basePolicyValue
      : Number.parseFloat(typeof value === 'string' ? value : '');
  const baseFractionString = Number.isFinite(baseFraction) ? String(baseFraction) : '';
  // Full precision, not the 2-dp rounded display: while locked this is a read-out of the exact base
  // policy rate (5.10833333%, not 5.11%), so it must not round the value it stands for.
  const baseDisplay = formatExactScaled(baseFraction, BASE_RATE_SCALE);

  const [useBasePolicy, setUseBasePolicy] = useState(true);
  // Only meaningful while unchecked; empty means "type a fresh override" (the box clears on untick).
  const [editText, setEditText] = useState('');

  // A base-policy switch changes the base fraction; return to carrying it through and clear any
  // half-typed override so re-unticking starts from an empty box again.
  useEffect(() => {
    setUseBasePolicy(true);
    setEditText('');
  }, [baseFractionString]);

  const help = getParameterHelp(parameter, mode);
  const exactNote = typeof value === 'string' ? ` Exact model value: ${formatExactModelValue(value)}.` : '';
  const info = `${help} Shown as a percentage. Keep "Use base policy value" ticked to submit the base policy's exact rate; untick to type your own percentage.${exactNote}`;

  const handleToggle = (checked: boolean) => {
    setUseBasePolicy(checked);
    setEditText('');
    // Ticked carries the base policy fraction through byte-exact; unticked clears to an empty override
    // box (the submitted value stays empty/invalid until the user types one).
    onChange(parameter, checked ? baseFractionString : '');
  };

  const handleEdit = (raw: string) => {
    setEditText(raw);
    onChange(parameter, scaledInputToStoredFraction(raw, BASE_RATE_SCALE));
  };

  return (
    <div className="run-param-item cap-field">
      <InfoLabel label={parameter.title} info={info} />
      <label className="base-rate-default-toggle">
        <input
          type="checkbox"
          checked={useBasePolicy}
          disabled={disabled}
          onChange={(event) => handleToggle(event.target.checked)}
        />
        <span>Use base policy value</span>
      </label>
      <span className="cap-value-field">
        <input
          type="number"
          step="any"
          className={useBasePolicy ? 'cap-value-input--locked' : undefined}
          value={useBasePolicy ? baseDisplay : editText}
          disabled={disabled || useBasePolicy}
          aria-label={`${parameter.title} percentage`}
          onChange={(event) => handleEdit(event.target.value)}
        />
        <span className="cap-value-suffix" aria-hidden="true">
          %
        </span>
      </span>
    </div>
  );
}

interface CentralBankPolicyInputProps {
  parameter: ModelRunParameterDefinition;
  value: FormValue | undefined;
  // The selected base policy's value for this parameter, used by the base-rate field to carry the
  // exact stored fraction through when "Use base policy value" is ticked.
  basePolicyValue?: number;
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
  basePolicyValue,
  executionDisabled,
  mode = 'manual',
  onChange
}: CentralBankPolicyInputProps) {
  if (parameter.key === BASE_RATE_KEY) {
    return (
      <BaseRateField
        parameter={parameter}
        value={value}
        basePolicyValue={basePolicyValue}
        disabled={executionDisabled}
        mode={mode}
        onChange={onChange}
      />
    );
  }
  if (parameter.key === AFFORDABILITY_KEY) {
    return (
      <CapField
        parameter={parameter}
        value={value}
        disabled={executionDisabled}
        mode={mode}
        offSentinel={CENTRAL_BANK_AFFORDABILITY_OFF_SENTINEL}
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
        offSentinel={CENTRAL_BANK_ICR_OFF_SENTINEL}
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
