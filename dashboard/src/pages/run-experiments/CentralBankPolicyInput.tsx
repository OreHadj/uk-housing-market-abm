import { useEffect, useRef, useState } from 'react';
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

// Every Central Bank policy field gets the "Use base policy value" checkbox, with the unit it is shown
// and edited in. Rates, LTV caps, permitted lending shares and the affordability cap are stored as
// fractions and shown as percentages (scale 100); LTI thresholds, the enforcement window and the ICR
// floor are already in their display unit (scale 1).
const POLICY_FIELD_UNITS: Record<string, { scale: number; suffix: string }> = {
  CENTRAL_BANK_INITIAL_BASE_RATE: { scale: 100, suffix: '%' },
  CENTRAL_BANK_LTV_HARD_MAX_FTB: { scale: 100, suffix: '%' },
  CENTRAL_BANK_LTV_HARD_MAX_HM: { scale: 100, suffix: '%' },
  CENTRAL_BANK_LTV_HARD_MAX_BTL: { scale: 100, suffix: '%' },
  CENTRAL_BANK_LTI_SOFT_MAX_FTB: { scale: 1, suffix: '× income' },
  CENTRAL_BANK_LTI_SOFT_MAX_HM: { scale: 1, suffix: '× income' },
  CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_FTB: { scale: 100, suffix: '%' },
  CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_HM: { scale: 100, suffix: '%' },
  CENTRAL_BANK_LTI_MONTHS_TO_CHECK: { scale: 1, suffix: 'months' },
  CENTRAL_BANK_AFFORDABILITY_HARD_MAX: { scale: 100, suffix: '%' },
  CENTRAL_BANK_ICR_HARD_MIN: { scale: 1, suffix: '×' }
};

/** True for the Central Bank fields that get the "Use base policy value" checkbox treatment. */
export function isCentralBankSpecialField(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(POLICY_FIELD_UNITS, key);
}

interface PolicyValueFieldProps {
  parameter: ModelRunParameterDefinition;
  label: string;
  value: FormValue | undefined;
  basePolicyValue: number | undefined;
  scale: number;
  suffix: string;
  disabled: boolean;
  mode: ExperimentControlMode;
  onChange: (parameter: ModelRunParameterDefinition, value: FormValue) => void;
}

/**
 * A Central Bank policy value shown and edited in its own unit (percentages for rates, caps and
 * lending shares; a multiple for LTI thresholds; months for the enforcement window; a ratio for the
 * ICR floor).
 *
 * The field is directly editable — the baseline value is pre-filled, so there is nothing to unlock
 * before typing. Whether the value is still the baseline or a user override is shown by the caller,
 * derived from the value itself rather than from a separate checkbox that could disagree with it.
 *
 * Two invariants are enforced, so a scenario can never be submitted with a blank or negative policy
 * value:
 *
 *  - only a finite, non-negative number is ever committed to the form;
 *  - on blur, text that is blank, malformed or negative is replaced by the last committed value.
 *
 * Mid-typing states like "4." or "0.9" are left alone: the local text is only re-synced when the
 * stored value changes from outside the field (a baseline switch, or an instrument being reset), which
 * is detected numerically rather than by string comparison.
 *
 * An untouched field emits no change at all, so the base policy's exact stored fraction
 * (0.0510833333, not a 2-dp stand-in) is submitted byte-for-byte.
 */
function PolicyValueField({ parameter, label, value, basePolicyValue, scale, suffix, disabled, mode, onChange }: PolicyValueFieldProps) {
  const storedString = typeof value === 'string' ? value : '';
  const storedNumber = Number.parseFloat(storedString);
  const fallbackNumber =
    typeof basePolicyValue === 'number' && Number.isFinite(basePolicyValue) ? basePolicyValue : Number.NaN;
  const effectiveNumber = Number.isFinite(storedNumber) ? storedNumber : fallbackNumber;
  const displayText = Number.isFinite(effectiveNumber) ? formatExactScaled(effectiveNumber, scale) : '';

  const [text, setText] = useState(displayText);
  const committedRef = useRef<number | null>(Number.isFinite(effectiveNumber) ? effectiveNumber : null);

  // Adopt a value changed from outside the field. Compared numerically so an in-progress edit such as
  // "4." is not overwritten by its own echo.
  useEffect(() => {
    if (!Number.isFinite(effectiveNumber)) {
      return;
    }
    if (committedRef.current !== null && Math.abs(committedRef.current - effectiveNumber) < 1e-12) {
      return;
    }
    committedRef.current = effectiveNumber;
    setText(formatExactScaled(effectiveNumber, scale));
  }, [effectiveNumber, scale]);

  const help = getParameterHelp(parameter, mode);
  const exactNote = typeof value === 'string' ? ` Exact model value: ${formatExactModelValue(value)}.` : '';
  const info = `${help} Starts at the baseline policy value; type to override it. Negative and empty values are not accepted.${exactNote}`;

  const handleEdit = (raw: string) => {
    setText(raw);
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      // Keep the last valid stored value; blur restores the text so nothing invalid can be submitted.
      return;
    }
    const stored = scaledInputToStoredFraction(raw, scale);
    committedRef.current = Number.parseFloat(stored);
    onChange(parameter, stored);
  };

  const handleBlur = () => {
    const parsed = Number.parseFloat(text);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return;
    }
    setText(Number.isFinite(effectiveNumber) ? formatExactScaled(effectiveNumber, scale) : '');
  };

  return (
    <div className="run-param-item cap-field">
      <InfoLabel label={label} info={info} />
      <span className="cap-value-field">
        <input
          type="number"
          step="any"
          min={0}
          value={text}
          disabled={disabled}
          aria-label={`${label} value`}
          onChange={(event) => handleEdit(event.target.value)}
          onBlur={handleBlur}
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
  /** Display name for the field. Defaults to the parameter's own title. */
  label?: string;
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
  label,
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
        label={label ?? parameter.title}
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
