import { useEffect, useState } from 'react';
import type { ModelRunParameterDefinition } from '../../../shared/types';
import {
  formatExactModelValue,
  formatExactScaled,
  scaledInputToStoredFraction
} from '../../../shared/policyDisplay';
import { InfoLabel } from './InfoLabel';
import { ParameterInput } from './GeneralModelControl';
import { getParameterHelp, type ExperimentControlMode } from './settingHelp';

type FormValue = string | boolean;

const AFFORDABILITY_KEY = 'CENTRAL_BANK_AFFORDABILITY_HARD_MAX';
const ICR_KEY = 'CENTRAL_BANK_ICR_HARD_MIN';
const BASE_RATE_KEY = 'CENTRAL_BANK_INITIAL_BASE_RATE';

// The Central Bank fields that get the "Use base policy value" checkbox, with the unit each is shown
// and edited in: base rate & affordability cap as a percentage (scale 100, "%"), ICR floor as a ratio
// (scale 1, "×"). Every other Central Bank field falls back to the standard numeric input.
const POLICY_FIELD_UNITS: Record<string, { scale: number; suffix: string }> = {
  [BASE_RATE_KEY]: { scale: 100, suffix: '%' },
  [AFFORDABILITY_KEY]: { scale: 100, suffix: '%' },
  [ICR_KEY]: { scale: 1, suffix: '×' }
};

/** True for the Central Bank fields that get the "Use base policy value" checkbox treatment. */
export function isCentralBankSpecialField(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(POLICY_FIELD_UNITS, key);
}

interface PolicyValueFieldProps {
  parameter: ModelRunParameterDefinition;
  value: FormValue | undefined;
  basePolicyValue: number | undefined;
  scale: number;
  suffix: string;
  disabled: boolean;
  mode: ExperimentControlMode;
  onChange: (parameter: ModelRunParameterDefinition, value: FormValue) => void;
}

/**
 * A Central Bank policy value shown and edited in a human-friendly unit (base rate & affordability cap
 * as a percentage, ICR floor as a ratio). A "Use base policy value" checkbox makes the two states
 * unambiguous:
 *
 *  - Checked (default): the input is locked and greyed, showing the base policy's exact value in its
 *    display unit at full precision (5.10833333%, not the 2-dp rounded stand-in). On submit that exact
 *    stored fraction (0.0510833333) is passed through byte-for-byte.
 *  - Unchecked: the box clears to empty so the user types a fresh override; whatever they type is
 *    submitted as a plain reading of the displayed unit (5.11% -> 0.0511). An empty box is left as an
 *    invalid/empty value for submit-time validation to catch.
 *
 * Re-checking discards any typed value and returns to the base policy value. Switching the base policy
 * returns to the checked state (the run controller already overwrites the stored value on a
 * base-policy switch, so any override is discarded there regardless).
 */
function PolicyValueField({ parameter, value, basePolicyValue, scale, suffix, disabled, mode, onChange }: PolicyValueFieldProps) {
  // Fall back to the current stored value if the base policy has no value for this key (not expected
  // for these fields, but keeps the control usable rather than blank).
  const baseFraction =
    typeof basePolicyValue === 'number' && Number.isFinite(basePolicyValue)
      ? basePolicyValue
      : Number.parseFloat(typeof value === 'string' ? value : '');
  const baseFractionString = Number.isFinite(baseFraction) ? String(baseFraction) : '';
  // Full precision, not the 2-dp rounded display: while locked this is a read-out of the exact base
  // policy value, so it must not round the value it stands for.
  const baseDisplay = formatExactScaled(baseFraction, scale);

  const [useBasePolicy, setUseBasePolicy] = useState(true);
  // Only meaningful while unchecked; empty means "type a fresh override" (the box clears on untick).
  const [editText, setEditText] = useState('');

  // A base-policy switch changes the base value; return to carrying it through and clear any
  // half-typed override so re-unticking starts from an empty box again.
  useEffect(() => {
    setUseBasePolicy(true);
    setEditText('');
  }, [baseFractionString]);

  const help = getParameterHelp(parameter, mode);
  const exactNote = typeof value === 'string' ? ` Exact model value: ${formatExactModelValue(value)}.` : '';
  const info = `${help} Keep "Use base policy value" ticked to submit the base policy's exact value; untick to type your own.${exactNote}`;

  const handleToggle = (checked: boolean) => {
    setUseBasePolicy(checked);
    setEditText('');
    // Ticked carries the base policy fraction through byte-exact; unticked clears to an empty override
    // box (the submitted value stays empty/invalid until the user types one).
    onChange(parameter, checked ? baseFractionString : '');
  };

  const handleEdit = (raw: string) => {
    setEditText(raw);
    onChange(parameter, scaledInputToStoredFraction(raw, scale));
  };

  return (
    <div className="run-param-item cap-field">
      <InfoLabel label={parameter.title} info={info} />
      <label className="policy-value-toggle">
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
          aria-label={`${parameter.title} value`}
          onChange={(event) => handleEdit(event.target.value)}
        />
        {suffix ? (
          <span className="cap-value-suffix" aria-hidden="true">
            {suffix}
          </span>
        ) : null}
      </span>
    </div>
  );
}

interface CentralBankPolicyInputProps {
  parameter: ModelRunParameterDefinition;
  value: FormValue | undefined;
  // The selected base policy's value for this parameter, carried through byte-exact when "Use base
  // policy value" is ticked.
  basePolicyValue?: number;
  executionDisabled: boolean;
  mode?: ExperimentControlMode;
  onChange: (parameter: ModelRunParameterDefinition, value: FormValue) => void;
}

/**
 * Renders a Central Bank policy field. The base rate, affordability cap and ICR floor get an
 * interpretability-focused control (a "Use base policy value" checkbox over a scaled-unit input);
 * every other field falls back to the standard numeric input. All variants write the same numeric
 * string back into the form value, so the submitted payload is unchanged.
 */
export function CentralBankPolicyInput({
  parameter,
  value,
  basePolicyValue,
  executionDisabled,
  mode = 'manual',
  onChange
}: CentralBankPolicyInputProps) {
  const units = POLICY_FIELD_UNITS[parameter.key];
  if (units) {
    return (
      <PolicyValueField
        parameter={parameter}
        value={value}
        basePolicyValue={basePolicyValue}
        scale={units.scale}
        suffix={units.suffix}
        disabled={executionDisabled}
        mode={mode}
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
