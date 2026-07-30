import { CENTRAL_BANK_POLICY_KEYS } from '../../shared/policyCatalogue';

export type PolicyInstrumentId = 'bankRate' | 'ltv' | 'lti' | 'affordability' | 'icr';

export interface PolicyInstrumentDefinition {
  id: PolicyInstrumentId;
  label: string;
  description: string;
  heading: string;
  intro: string;
  keys: readonly string[];
}

/**
 * The central-bank instruments a manual scenario can change, and the policy parameters belonging to
 * each. Every key in CENTRAL_BANK_POLICY_KEYS belongs to exactly one instrument, so selecting
 * instruments reaches every supported policy parameter — none of them hide in Advanced settings.
 */
export const POLICY_INSTRUMENTS: readonly PolicyInstrumentDefinition[] = [
  {
    id: 'bankRate',
    label: 'Bank Rate',
    description: 'Set the policy rate the simulation starts from.',
    heading: 'Bank Rate',
    intro: 'The central bank policy rate applied at the start of the run.',
    keys: ['CENTRAL_BANK_INITIAL_BASE_RATE']
  },
  {
    id: 'ltv',
    label: 'LTV limits',
    description: 'Cap the mortgage as a share of property value, per borrower group.',
    heading: 'Loan-to-value (LTV) limits',
    intro:
      'The maximum mortgage as a percentage of property value. Applies to every new loan in the borrower group.',
    keys: ['CENTRAL_BANK_LTV_HARD_MAX_FTB', 'CENTRAL_BANK_LTV_HARD_MAX_HM', 'CENTRAL_BANK_LTV_HARD_MAX_BTL']
  },
  {
    id: 'lti',
    label: 'LTI flow limits',
    description: 'Cap the share of new lending at or above an income multiple.',
    heading: 'Loan-to-income (LTI) flow limits',
    intro:
      "The income multiple defining a high-LTI loan, the maximum share of a lender's new lending allowed at or above it, and the rolling window the share is enforced over. The 2024 baseline is 4.5× income with a 15% flow limit over 12 months.",
    keys: [
      'CENTRAL_BANK_LTI_SOFT_MAX_FTB',
      'CENTRAL_BANK_LTI_SOFT_MAX_HM',
      'CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_FTB',
      'CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_HM',
      'CENTRAL_BANK_LTI_MONTHS_TO_CHECK'
    ]
  },
  {
    id: 'affordability',
    label: 'Affordability cap',
    description: 'Cap mortgage costs as a share of borrower income.',
    heading: 'Mortgage affordability cap',
    intro:
      'The maximum share of income a mortgage may consume. The 2024 baseline sets this close to 100%, leaving it non-binding.',
    keys: ['CENTRAL_BANK_AFFORDABILITY_HARD_MAX']
  },
  {
    id: 'icr',
    label: 'Buy-to-let ICR floor',
    description: 'Require a minimum rent-to-interest coverage on buy-to-let lending.',
    heading: 'Buy-to-let interest coverage ratio floor',
    intro:
      'The minimum ratio of expected rent to mortgage interest on new buy-to-let lending. A floor of 0 leaves it non-binding.',
    keys: ['CENTRAL_BANK_ICR_HARD_MIN']
  }
];

export const BENCHMARK_OPTION = {
  label: 'No additional policy change',
  description: 'Run the selected baseline policy unchanged, to serve as the counterfactual.'
};

const INSTRUMENT_BY_KEY = new Map<string, PolicyInstrumentId>(
  POLICY_INSTRUMENTS.flatMap((instrument) => instrument.keys.map((key) => [key, instrument.id] as const))
);

/** Every policy key the instruments cover, in catalogue order. */
export const INSTRUMENT_POLICY_KEYS: readonly string[] = CENTRAL_BANK_POLICY_KEYS.filter((key) =>
  INSTRUMENT_BY_KEY.has(key)
);

export function instrumentForPolicyKey(key: string): PolicyInstrumentId | null {
  return INSTRUMENT_BY_KEY.get(key) ?? null;
}

export function findPolicyInstrument(id: PolicyInstrumentId): PolicyInstrumentDefinition | null {
  return POLICY_INSTRUMENTS.find((instrument) => instrument.id === id) ?? null;
}

type FormValue = string | boolean;

function numericValue(value: FormValue | undefined): number | null {
  if (typeof value === 'boolean') {
    return null;
  }
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Whether a policy field still carries its baseline value. An empty or half-typed field counts as
 * *not* at baseline, so an incomplete override is never mistaken for the benchmark scenario and never
 * hidden by collapsing its instrument.
 */
export function isAtBaseline(value: FormValue | undefined, baseValue: number | undefined): boolean {
  if (baseValue === undefined) {
    return true;
  }
  const parsed = numericValue(value);
  if (parsed === null) {
    return false;
  }
  return Math.abs(parsed - baseValue) <= 1e-10;
}

/**
 * The policy keys whose current value departs from the selected baseline policy. Benchmark status is
 * derived from this rather than from which instruments are selected, so editing any policy field makes
 * the scenario a policy-change scenario immediately.
 */
export function deriveChangedPolicyKeys(
  formValues: Record<string, FormValue>,
  baseValues: Record<string, number> | undefined,
  knownKeys: ReadonlySet<string>
): Set<string> {
  const changed = new Set<string>();
  for (const key of INSTRUMENT_POLICY_KEYS) {
    if (!knownKeys.has(key)) {
      continue;
    }
    if (!isAtBaseline(formValues[key], baseValues?.[key])) {
      changed.add(key);
    }
  }
  return changed;
}

/**
 * Instruments whose settings must be on screen: those the user selected, plus any holding a changed
 * value. The second half is what stops an override sitting hidden behind a collapsed section.
 */
export function deriveVisibleInstruments(
  activeInstruments: ReadonlySet<PolicyInstrumentId>,
  changedPolicyKeys: ReadonlySet<string>
): Set<PolicyInstrumentId> {
  const visible = new Set<PolicyInstrumentId>(activeInstruments);
  for (const key of changedPolicyKeys) {
    const instrument = INSTRUMENT_BY_KEY.get(key);
    if (instrument) {
      visible.add(instrument);
    }
  }
  return visible;
}

/** Labels of every instrument carrying at least one changed value, in display order. */
export function changedInstrumentLabels(changedPolicyKeys: ReadonlySet<string>): string[] {
  return POLICY_INSTRUMENTS.filter((instrument) => instrument.keys.some((key) => changedPolicyKeys.has(key))).map(
    (instrument) => instrument.label
  );
}

/**
 * Plain-English description of the scenario, naming every changed instrument rather than only LTV and
 * LTI, so a review summary can never understate what a scenario does.
 */
export function describeScenarioPolicy(changedPolicyKeys: ReadonlySet<string>): string {
  if (changedPolicyKeys.size === 0) {
    return 'This scenario runs the selected baseline policy without an additional policy change.';
  }
  const labels = changedInstrumentLabels(changedPolicyKeys);
  if (labels.length === 0) {
    return 'Change one or more policy settings relative to the baseline policy.';
  }
  const last = labels[labels.length - 1];
  const joined = labels.length === 1 ? last : `${labels.slice(0, -1).join(', ')} and ${last}`;
  return `This scenario changes ${joined} relative to the baseline policy.`;
}
