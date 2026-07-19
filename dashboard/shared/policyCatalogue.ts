// Author: Max Stoddard
import type {
  BasePolicyId,
  BasePolicyOption,
  ModelRunParameterType,
  SensitivityPolicyPackageDefinition
} from './types';
import { formatExactPercent, formatPercent } from './policyDisplay';

export const CENTRAL_BANK_POLICY_KEYS = [
  'CENTRAL_BANK_INITIAL_BASE_RATE',
  'CENTRAL_BANK_LTV_HARD_MAX_FTB',
  'CENTRAL_BANK_LTV_HARD_MAX_HM',
  'CENTRAL_BANK_LTV_HARD_MAX_BTL',
  'CENTRAL_BANK_LTI_SOFT_MAX_FTB',
  'CENTRAL_BANK_LTI_SOFT_MAX_HM',
  'CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_FTB',
  'CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_HM',
  'CENTRAL_BANK_LTI_MONTHS_TO_CHECK',
  'CENTRAL_BANK_AFFORDABILITY_HARD_MAX',
  'CENTRAL_BANK_ICR_HARD_MIN'
] as const;

// Non-binding "off" sentinels for the FPC affordability cap and BTL ICR floor, as set by the 2024
// base policy: a ~100%-of-income affordability cap never bites, and a zero ICR floor is a no-op. Both
// the run-setup toggles (CentralBankPolicyInput.tsx) and the summaries below read these to describe a
// cap as "off", so there is a single source of truth for what "off" means.
export const CENTRAL_BANK_AFFORDABILITY_OFF_SENTINEL = 0.9999;
export const CENTRAL_BANK_ICR_OFF_SENTINEL = 0;

function describeAffordabilityCap(values: Record<string, number>): string {
  const value = values.CENTRAL_BANK_AFFORDABILITY_HARD_MAX;
  return value >= CENTRAL_BANK_AFFORDABILITY_OFF_SENTINEL
    ? 'no separate FPC affordability cap'
    : `an FPC affordability cap of ${formatPercent(value)} of income`;
}

function describeIcrFloor(values: Record<string, number>): string {
  const value = values.CENTRAL_BANK_ICR_HARD_MIN;
  return value <= CENTRAL_BANK_ICR_OFF_SENTINEL ? 'no separate FPC BTL ICR floor' : `an FPC BTL ICR floor of ${value}x`;
}

interface BasePolicyDefinition {
  id: BasePolicyId;
  title: string;
  values: Record<string, number>;
  // Built from the values so the displayed Bank Rate and cap statuses can never drift from what the
  // model actually runs, using the same percentage formatter as the run-setup form.
  buildSummary: (values: Record<string, number>) => string;
}

const BASE_POLICY_DEFINITIONS: BasePolicyDefinition[] = [
  {
    id: '2011',
    title: '2011 base policy',
    buildSummary: (values) =>
      `2011 policy uses a ${formatExactPercent(values.CENTRAL_BANK_INITIAL_BASE_RATE)} Bank Rate and central-bank mortgage limits aligned to lender limits, so the macroprudential constraints are mostly non-binding.`,
    values: {
      CENTRAL_BANK_INITIAL_BASE_RATE: 0.005,
      CENTRAL_BANK_LTV_HARD_MAX_FTB: 0.95,
      CENTRAL_BANK_LTV_HARD_MAX_HM: 0.9,
      CENTRAL_BANK_LTV_HARD_MAX_BTL: 0.8,
      CENTRAL_BANK_LTI_SOFT_MAX_FTB: 5.4,
      CENTRAL_BANK_LTI_SOFT_MAX_HM: 5.6,
      CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_FTB: 0.15,
      CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_HM: 0.15,
      CENTRAL_BANK_LTI_MONTHS_TO_CHECK: 12,
      CENTRAL_BANK_AFFORDABILITY_HARD_MAX: 0.4,
      CENTRAL_BANK_ICR_HARD_MIN: 1.2
    }
  },
  {
    id: '2024',
    title: '2024 base policy',
    buildSummary: (values) =>
      `2024 policy uses a ${formatExactPercent(values.CENTRAL_BANK_INITIAL_BASE_RATE)} Bank Rate, a 4.5x owner-occupier LTI flow limit with a 15% quota over 12 months, ${describeAffordabilityCap(values)}, and ${describeIcrFloor(values)}.`,
    values: {
      CENTRAL_BANK_INITIAL_BASE_RATE: 0.0510833333,
      CENTRAL_BANK_LTV_HARD_MAX_FTB: 0.95,
      CENTRAL_BANK_LTV_HARD_MAX_HM: 0.95,
      CENTRAL_BANK_LTV_HARD_MAX_BTL: 0.85,
      CENTRAL_BANK_LTI_SOFT_MAX_FTB: 4.5,
      CENTRAL_BANK_LTI_SOFT_MAX_HM: 4.5,
      CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_FTB: 0.15,
      CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_HM: 0.15,
      CENTRAL_BANK_LTI_MONTHS_TO_CHECK: 12,
      CENTRAL_BANK_AFFORDABILITY_HARD_MAX: 0.9999,
      CENTRAL_BANK_ICR_HARD_MIN: 0
    }
  }
];

export const BASE_POLICY_OPTIONS: BasePolicyOption[] = BASE_POLICY_DEFINITIONS.map((definition) => ({
  id: definition.id,
  title: definition.title,
  values: definition.values,
  summary: definition.buildSummary(definition.values)
}));

export const SENSITIVITY_POLICY_PACKAGES: SensitivityPolicyPackageDefinition[] = [
  {
    id: 'central_bank_initial_base_rate',
    title: 'Initial base rate',
    description: 'Varies the central bank base rate applied at the start of the run.',
    parameterKeys: ['CENTRAL_BANK_INITIAL_BASE_RATE'],
    type: 'number'
  },
  {
    id: 'central_bank_ltv_hard_max_ftb',
    title: 'Hard max LTV FTB',
    description: 'Varies the first-time buyer hard loan-to-value cap.',
    parameterKeys: ['CENTRAL_BANK_LTV_HARD_MAX_FTB'],
    type: 'number'
  },
  {
    id: 'central_bank_ltv_hard_max_hm',
    title: 'Hard max LTV HM',
    description: 'Varies the home-mover hard loan-to-value cap.',
    parameterKeys: ['CENTRAL_BANK_LTV_HARD_MAX_HM'],
    type: 'number'
  },
  {
    id: 'central_bank_ltv_hard_max_btl',
    title: 'Hard max LTV BTL',
    description: 'Varies the buy-to-let hard loan-to-value cap.',
    parameterKeys: ['CENTRAL_BANK_LTV_HARD_MAX_BTL'],
    type: 'number'
  },
  {
    id: 'central_bank_lti_soft_max_ftb',
    title: 'Soft max LTI FTB',
    description: 'Varies the first-time buyer soft loan-to-income threshold.',
    parameterKeys: ['CENTRAL_BANK_LTI_SOFT_MAX_FTB'],
    type: 'number'
  },
  {
    id: 'central_bank_lti_soft_max_hm',
    title: 'Soft max LTI HM',
    description: 'Varies the home-mover soft loan-to-income threshold.',
    parameterKeys: ['CENTRAL_BANK_LTI_SOFT_MAX_HM'],
    type: 'number'
  },
  {
    id: 'central_bank_lti_max_frac_over_soft_max_ftb',
    title: 'Max share over soft LTI FTB',
    description: 'Varies the first-time buyer share allowed above the soft LTI threshold.',
    parameterKeys: ['CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_FTB'],
    type: 'number'
  },
  {
    id: 'central_bank_lti_max_frac_over_soft_max_hm',
    title: 'Max share over soft LTI HM',
    description: 'Varies the home-mover share allowed above the soft LTI threshold.',
    parameterKeys: ['CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_HM'],
    type: 'number'
  },
  {
    id: 'central_bank_lti_months_to_check',
    title: 'LTI months to check',
    description: 'Varies the rolling window used to enforce lending above soft LTI limits.',
    parameterKeys: ['CENTRAL_BANK_LTI_MONTHS_TO_CHECK'],
    type: 'integer'
  },
  {
    id: 'central_bank_affordability_hard_max',
    title: 'Hard max affordability',
    description: 'Varies the central-bank cap on mortgage repayments as a share of income.',
    parameterKeys: ['CENTRAL_BANK_AFFORDABILITY_HARD_MAX'],
    type: 'number'
  },
  {
    id: 'central_bank_icr_hard_min',
    title: 'Hard min ICR',
    description: 'Varies the minimum buy-to-let rental-income coverage ratio.',
    parameterKeys: ['CENTRAL_BANK_ICR_HARD_MIN'],
    type: 'number'
  },
  {
    id: 'owner_occupier_lti_soft_max',
    title: 'Soft max LTI FTB + HM',
    description: 'Varies the first-time buyer and home-mover soft LTI thresholds together.',
    parameterKeys: ['CENTRAL_BANK_LTI_SOFT_MAX_FTB', 'CENTRAL_BANK_LTI_SOFT_MAX_HM'],
    type: 'number'
  },
  {
    id: 'owner_occupier_lti_quota',
    title: 'Max share over soft LTI FTB + HM',
    description: 'Varies the first-time buyer and home-mover shares allowed above soft LTI thresholds together.',
    parameterKeys: ['CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_FTB', 'CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_HM'],
    type: 'number'
  },
  {
    id: 'owner_occupier_ltv_hard_max',
    title: 'Hard max LTV FTB + HM',
    description: 'Varies the first-time buyer and home-mover hard LTV caps together.',
    parameterKeys: ['CENTRAL_BANK_LTV_HARD_MAX_FTB', 'CENTRAL_BANK_LTV_HARD_MAX_HM'],
    type: 'number'
  }
];

export const DEFAULT_SENSITIVITY_POLICY_PACKAGE_ID = 'owner_occupier_lti_soft_max';

const LEGACY_2011_VERSIONS = new Set(['v0', 'v0o', 'v0oo', 'v0o1', 'v0o2', 'v0o3', 'v0o6', 'v0o7']);
const CENTRAL_BANK_POLICY_KEY_SET = new Set<string>(CENTRAL_BANK_POLICY_KEYS);

export function getDefaultBasePolicyId(baseline: string): BasePolicyId {
  return LEGACY_2011_VERSIONS.has(baseline) ? '2011' : '2024';
}

export function getBasePolicyOption(basePolicyId: BasePolicyId): BasePolicyOption {
  const option = BASE_POLICY_OPTIONS.find((item) => item.id === basePolicyId);
  if (!option) {
    throw new Error(`Unsupported base policy: ${basePolicyId}`);
  }
  return option;
}

export function isBasePolicyId(value: string): value is BasePolicyId {
  return value === '2011' || value === '2024';
}

export function isCentralBankPolicyKey(value: string): boolean {
  return CENTRAL_BANK_POLICY_KEY_SET.has(value);
}

export function getSensitivityPolicyPackageById(id: string): SensitivityPolicyPackageDefinition | null {
  return SENSITIVITY_POLICY_PACKAGES.find((item) => item.id === id) ?? null;
}

export function getSingletonSensitivityPolicyPackage(parameterKey: string): SensitivityPolicyPackageDefinition | null {
  return SENSITIVITY_POLICY_PACKAGES.find((item) => item.parameterKeys.length === 1 && item.parameterKeys[0] === parameterKey) ?? null;
}

export function assertCompatiblePolicyPackageTypes(
  packageDefinition: SensitivityPolicyPackageDefinition,
  parameterTypesByKey: ReadonlyMap<string, ModelRunParameterType>
): void {
  for (const key of packageDefinition.parameterKeys) {
    const type = parameterTypesByKey.get(key);
    if (!type) {
      throw new Error(`Policy package ${packageDefinition.id} references unsupported parameter ${key}.`);
    }
    if (type !== packageDefinition.type) {
      throw new Error(`Policy package ${packageDefinition.id} expects ${key} to be ${packageDefinition.type}.`);
    }
  }
}
