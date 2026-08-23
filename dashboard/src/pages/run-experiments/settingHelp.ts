// Author: Max Stoddard
import type { ModelRunParameterDefinition } from '../../../shared/types';

export type ExperimentControlMode = 'manual' | 'sensitivity';

export const SETTING_HELP = {
  sensitivityPolicyParameter: 'Policy instrument varied across the analysis. Choose the one to test against the selected baseline policy.',
  sensitivityPolicyPackage: 'One or more related central-bank policy settings varied together across the analysis.',
  basePolicy:
    'The reference year supplies the starting value for every policy setting. Any setting you leave unchanged keeps that year’s value. Note for 2011: these values follow the project report’s recalibrated parameter table (95/90/80 LTV, 1.2 ICR floor). The Bank of England working paper’s own central-bank table lists 90/90/75 and a 1.25 ICR floor. The builder follows the report for consistency with the recalibration.',
  optionalExperimentTitle: 'Short label used to identify this experiment in results and logs.',
  optionalRunTitle: 'Short label used to identify this run in results and logs.',
  calibrationParameterVersion: 'A saved configuration of model inputs and behavioural assumptions. Its behavioural parameters were adjusted until the model reflected patterns in observed UK housing statistics and survey data.',
  minValue: 'Lowest sampled value for the selected policy instrument.',
  maxValue: 'Highest sampled value for the selected policy instrument.',
  sampleCount:
    'Sampled values include the minimum and maximum. The baseline point is added when it is not already on the grid.',
  maxWorkers: 'Independent model runs allowed to execute in parallel. Higher values can finish faster and use more CPU.'
} as const;

const PARAMETER_HELP_BY_KEY: Record<string, string> = {
  SEED: 'Seeded dashboard experiments run deterministic seed blocks starting at 1.',
  N_STEPS:
    'Number of model time steps to simulate. Longer runs cost more but allow slower dynamics to emerge. The default of 3,500 matches the calibration and validation window used for this model (steps 500-3,500, with the first 500 discarded as warm-up).',
  N_SIMS: 'Independent seed runs used to average stochastic outcomes. More seeds reduce noise and increase runtime.',
  ROLLING_WINDOW_SIZE_FOR_CORE_INDICATORS:
    'Months included in rolling averages for core indicators. This smooths short-term variation.',
  TIME_TO_START_RECORDING_TRANSACTIONS:
    'Month when transaction-level export begins. Earlier recording creates larger files and may affect performance.',
  CUMULATIVE_WEIGHT_BEYOND_YEAR:
    'Weight given to events older than twelve months. The default of 0.14 is the config default in the user-set parameters table of the Bank of England working paper.',
  recordTransactions: 'Exports every transaction event for downloaded or external analysis. This can create very large files and affect performance.',
  recordNBidUpFrequency: 'Exports bid-up frequency data for analysis outside the dashboard.',
  recordCoreIndicators: 'Writes the main indicator series required by charts in the dashboard.',
  recordQualityBandPrice: 'Exports prices by quality band for analysis outside the dashboard; this does not add dashboard charts.',
  recordHouseholdID: 'Writes household identifiers in microdata output. Useful for tracing agents across records.',
  recordEmploymentIncome: 'Writes household employment income in microdata output.',
  recordRentalIncome: 'Writes household rental income in microdata output.',
  recordBankBalance: 'Writes household bank balances in microdata output.',
  recordHousingWealth: 'Writes household housing wealth in microdata output.',
  recordTotalDebt: 'Writes household debt totals in microdata output.',
  recordHousingStatus: 'Writes household tenure and housing state in microdata output.',
  recordConsumption: 'Writes household non-housing consumption in microdata output.',
  recordNHousesOwned: 'Writes household property counts in microdata output.',
  recordAge: 'Writes representative household age in microdata output.',
  recordSavingRate: 'Writes household saving-rate values in microdata output.',
  CENTRAL_BANK_INITIAL_BASE_RATE: 'Central bank base rate applied at the start of the run. It anchors borrowing costs.',
  CENTRAL_BANK_LTV_HARD_MAX_FTB:
    'Maximum loan-to-value ratio for first-time buyers. Lower values tighten deposit constraints.',
  CENTRAL_BANK_LTV_HARD_MAX_HM:
    'Maximum loan-to-value ratio for home movers. Lower values tighten mover borrowing constraints.',
  CENTRAL_BANK_LTV_HARD_MAX_BTL:
    'Maximum loan-to-value ratio for buy-to-let investors. Lower values restrict investor leverage.',
  CENTRAL_BANK_LTI_SOFT_MAX_FTB:
    'Soft loan-to-income limit for first-time buyers. It shapes access to larger mortgages.',
  CENTRAL_BANK_LTI_SOFT_MAX_HM: 'Soft loan-to-income limit for home movers. It shapes mover mortgage capacity.',
  CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_FTB:
    'Share of first-time buyer lending allowed above the soft LTI limit.',
  CENTRAL_BANK_LTI_MAX_FRAC_OVER_SOFT_MAX_HM: 'Share of home-mover lending allowed above the soft LTI limit.',
  CENTRAL_BANK_LTI_MONTHS_TO_CHECK:
    'Months used for the moving average that controls lending above soft LTI limits.',
  CENTRAL_BANK_AFFORDABILITY_HARD_MAX:
    'Maximum income share allowed for mortgage repayments. Lower values tighten affordability tests.',
  CENTRAL_BANK_ICR_HARD_MIN:
    'Minimum rental-income coverage for buy-to-let interest costs. Higher values tighten investor credit.'
};

export function getParameterHelp(parameter: ModelRunParameterDefinition, mode: ExperimentControlMode): string {
  if (mode === 'sensitivity' && parameter.key === 'N_SIMS') {
    return 'Independent seed runs for every sampled value. More seeds reduce noise and increase runtime.';
  }
  if (mode === 'manual' && parameter.key === 'N_SIMS') {
    return 'Independent seed runs for this parameter set. More seeds reduce noise and increase runtime.';
  }

  return PARAMETER_HELP_BY_KEY[parameter.key] ?? parameter.description;
}

export function assertSettingHelpCopy(): void {
  const values = [...Object.values(SETTING_HELP), ...Object.values(PARAMETER_HELP_BY_KEY)];
  for (const value of values) {
    if (/\b(?:what|why)\b/iu.test(value)) {
      throw new Error(`Setting help copy includes a disallowed word: ${value}`);
    }
  }
}
