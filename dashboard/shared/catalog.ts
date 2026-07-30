import type { ParameterCardMeta } from './types';

export const PARAMETER_CATALOG: ParameterCardMeta[] = [
  {
    id: 'income_given_age_joint',
    title: 'How Gross Income Is Distributed Across Age Groups',
    group: 'Household Demographics & Wealth',
    format: 'joint_distribution',
    configKeys: ['DATA_INCOME_GIVEN_AGE'],
    dataFileConfigKeys: ['DATA_INCOME_GIVEN_AGE'],
    explanation:
      'This joint distribution maps age bands to logarithmic gross-income bands. Shifts toward higher-income bins increase households\' purchasing capacity and can amplify demand pressure in owner-occupier and rental decisions. Changes in low-income mass can increase vulnerability to affordability constraints.'
  },
  {
    id: 'wealth_given_income_joint',
    title: 'How Household Wealth Is Distributed Across Income Groups',
    group: 'Household Demographics & Wealth',
    format: 'joint_distribution',
    configKeys: ['DATA_WEALTH_GIVEN_INCOME'],
    dataFileConfigKeys: ['DATA_WEALTH_GIVEN_INCOME'],
    explanation:
      'This matrix links gross-income bins to net-wealth bins. More mass in higher-wealth cells implies larger available buffers and greater ability to meet down-payment requirements. Lower-wealth concentration tends to tighten borrowing constraints and reduce transaction flexibility.'
  },
  {
    id: 'age_distribution',
    title: 'Household Population Share by Age Group',
    group: 'Household Demographics & Wealth',
    format: 'binned_distribution',
    configKeys: ['DATA_AGE_DISTRIBUTION'],
    dataFileConfigKeys: ['DATA_AGE_DISTRIBUTION'],
    explanation:
      'This distribution controls household density by age band. It affects how many agents are likely to be entering, moving within, or exiting ownership and rental pathways. Age-mix shifts can indirectly change mortgage demand, tenure transitions, and portfolio turnover.'
  },
  {
    id: 'uk_housing_stock_totals',
    title: 'UK Household and Dwelling Stock Totals',
    group: 'Household Demographics & Wealth',
    format: 'scalar_pair',
    configKeys: ['UK_HOUSEHOLDS', 'UK_DWELLINGS'],
    explanation:
      'These totals anchor the model-scale relationship between households and available dwellings. The relative gap influences structural pressure in occupancy and housing scarcity metrics.'
  },
  {
    id: 'household_consumption_fractions',
    title: 'Household Consumption Fractions',
    group: 'Household Demographics & Wealth',
    format: 'scalar_pair',
    configKeys: ['ESSENTIAL_CONSUMPTION_FRACTION', 'MAXIMUM_CONSUMPTION_FRACTION'],
    explanation:
      'These fractions set essential and capped consumption behavior relative to income/support levels. They shape disposable-income retention and therefore indirectly affect housing affordability resilience.'
  },
  {
    id: 'btl_probability_bins',
    title: 'Buy-to-Let Investor Probability by Income Percentile',
    group: 'BTL & Investor Behavior',
    format: 'binned_distribution',
    configKeys: ['DATA_BTL_PROBABILITY'],
    dataFileConfigKeys: ['DATA_BTL_PROBABILITY'],
    explanation:
      'This binned series sets the baseline probability of a household being a buy-to-let investor by income percentile. Higher probabilities in upper percentiles increase investor participation and potential competition with owner-occupiers. Lower values reduce investor-driven demand in the housing market.'
  },
  {
    id: 'btl_probability_multiplier',
    title: 'Buy-to-Let Investor Probability Multiplier',
    group: 'BTL & Investor Behavior',
    format: 'scalar',
    configKeys: ['BTL_PROBABILITY_MULTIPLIER'],
    explanation:
      'This multiplier scales the baseline probability of being a BTL investor after income-percentile probabilities are read. Higher values increase investor prevalence and can raise investor-driven demand pressure.'
  },
  {
    id: 'national_insurance_rates',
    title: 'National Insurance Rates Across Income Thresholds',
    group: 'Government & Tax',
    format: 'binned_distribution',
    configKeys: ['DATA_NATIONAL_INSURANCE_RATES'],
    dataFileConfigKeys: ['DATA_NATIONAL_INSURANCE_RATES'],
    explanation:
      'These NI contribution bands map income thresholds to marginal rates. Higher effective deductions reduce disposable income and may weaken affordability for rent and mortgage payments. Lower deductions increase net income and can support stronger effective demand.'
  },
  {
    id: 'income_tax_rates',
    title: 'Income Tax Rates Across Income Thresholds',
    group: 'Government & Tax',
    format: 'binned_distribution',
    configKeys: ['DATA_TAX_RATES'],
    dataFileConfigKeys: ['DATA_TAX_RATES'],
    explanation:
      'Tax bands define marginal tax rates across taxable income levels. Higher rates or earlier threshold transitions reduce post-tax income and can compress housing budgets. Lower tax burden increases spendable income and may relax affordability pressure.'
  },
  {
    id: 'government_allowance_support',
    title: 'Government Allowance, Income Limit, and Monthly Support',
    group: 'Government & Tax',
    format: 'scalar',
    configKeys: [
      'GOVERNMENT_GENERAL_PERSONAL_ALLOWANCE',
      'GOVERNMENT_INCOME_LIMIT_FOR_PERSONAL_ALLOWANCE',
      'GOVERNMENT_MONTHLY_INCOME_SUPPORT'
    ],
    explanation:
      'Personal allowance and its income-limit taper shape taxable-income relief, while monthly income support sets an income floor. Together they influence post-tax cash flow and affordability buffers for lower- and middle-income households.'
  },
  {
    id: 'house_price_lognormal',
    title: 'House Price Distribution Shape (Scale and Spread)',
    group: 'Housing & Rental Market',
    format: 'lognormal_pair',
    configKeys: ['HOUSE_PRICES_SCALE', 'HOUSE_PRICES_SHAPE'],
    explanation:
      'These parameters define the lognormal distribution used for house prices. A higher scale shifts the overall price level upward, while a higher shape increases dispersion and tail weight. Together they influence affordability, leverage needs, and transaction stratification by budget.'
  },
  {
    id: 'rental_price_lognormal',
    title: 'Rental Price Distribution Shape (Scale and Spread)',
    group: 'Housing & Rental Market',
    format: 'lognormal_pair',
    configKeys: ['RENTAL_PRICES_SCALE', 'RENTAL_PRICES_SHAPE'],
    explanation:
      'These parameters define the lognormal distribution of rental prices. Higher scale raises typical rent levels, and higher shape broadens rent dispersion across properties. This can alter rental affordability and tenure decisions between renting and buying.'
  },
  {
    id: 'desired_rent_power',
    title: 'Desired Rent as Income Changes (Power Curve)',
    group: 'Housing & Rental Market',
    format: 'power_law_pair',
    configKeys: ['DESIRED_RENT_SCALE', 'DESIRED_RENT_EXPONENT'],
    explanation:
      'Desired rent is modeled as a power function of income. Increasing scale lifts rent willingness at all income levels, while increasing exponent steepens the response for higher incomes. This affects bid intensity in the rental market and competitive pressure on rental prices.'
  },
  {
    id: 'rent_purchase_choice',
    title: 'Rent vs Purchase Decision Noise',
    group: 'Housing & Rental Market',
    format: 'scalar_pair',
    configKeys: ['PSYCHOLOGICAL_COST_OF_RENTING', 'SENSITIVITY_RENT_OR_PURCHASE'],
    explanation:
      'These output-calibrated parameters shape the rent-versus-purchase decision. Psychological renting cost shifts the relative burden of renting, while sensitivity controls how strongly households respond to utility differences.'
  },
  {
    id: 'hpa_expectation_params',
    title: 'Expected House Price Change vs Market Trend',
    group: 'Housing & Rental Market',
    format: 'hpa_expectation_line',
    configKeys: ['HPA_EXPECTATION_FACTOR', 'HPA_EXPECTATION_CONST'],
    explanation:
      'This equation view plots expected annual house-price change as trend sensitivity times observed trend plus an intercept. Higher factor steepens trend response, while const shifts the line up or down at every trend level.'
  },
  {
    id: 'hpa_lookback_years',
    title: 'House Price Appreciation Lookback Window',
    group: 'Housing & Rental Market',
    format: 'scalar',
    configKeys: ['HPA_YEARS_TO_CHECK'],
    explanation:
      'This lookback window controls how many years of recent house-price history households use when forming annual HPA expectations. Longer windows smooth trend signals, while shorter windows make expectations more responsive.'
  },
  {
    id: 'hold_period_years',
    title: 'Owner-Occupier Hold Period',
    group: 'Housing & Rental Market',
    format: 'scalar',
    configKeys: ['HOLD_PERIOD'],
    explanation:
      'This parameter sets the average tenure duration before sale for owner-occupiers. Longer hold periods reduce turnover and can dampen listing flow, while shorter periods increase transaction churn.'
  },
  {
    id: 'initial_sale_markup_distribution',
    title: 'Initial Sale Listing Mark-Up Distribution',
    group: 'Housing & Rental Market',
    format: 'binned_distribution',
    configKeys: ['DATA_INITIAL_SALE_MARKUP_DIST'],
    dataFileConfigKeys: ['DATA_INITIAL_SALE_MARKUP_DIST'],
    explanation:
      'This distribution sets sale-listing mark-up ratios relative to market reference prices. Higher mass above parity implies more aggressive initial pricing and can increase time-on-market and reductions before clearing.'
  },
  {
    id: 'price_reduction_probabilities',
    title: 'Monthly Probability of Price Reduction (Sale vs Rent)',
    group: 'Housing & Rental Market',
    format: 'scalar_pair',
    configKeys: ['P_SALE_PRICE_REDUCE', 'P_RENT_PRICE_REDUCE'],
    explanation:
      'These probabilities set how often listed sale and rental prices are cut each month. Higher values imply faster repricing when listings are above market-clearing levels.'
  },
  {
    id: 'sale_reduction_gaussian',
    title: 'Sale Reduction Size Distribution (Gaussian)',
    group: 'Housing & Rental Market',
    format: 'gaussian_pair',
    configKeys: ['REDUCTION_MU', 'REDUCTION_SIGMA'],
    explanation:
      'These parameters define the normal distribution for log sale-price reduction magnitudes. The chart shows both the direct log-reduction Gaussian and the implied percent-reduction density.'
  },
  {
    id: 'tenancy_length_range',
    title: 'Tenancy Length Range',
    group: 'Housing & Rental Market',
    format: 'scalar_pair',
    configKeys: ['TENANCY_LENGTH_MIN', 'TENANCY_LENGTH_MAX'],
    explanation:
      'These bounds define the discrete uniform range for tenancy durations. Wider or longer ranges can reduce turnover and affect rental market flow dynamics.'
  },
  {
    id: 'initial_rent_markup_distribution',
    title: 'Initial Rent Listing Mark-Up Distribution',
    group: 'Housing & Rental Market',
    format: 'binned_distribution',
    configKeys: ['DATA_INITIAL_RENT_MARKUP_DIST'],
    dataFileConfigKeys: ['DATA_INITIAL_RENT_MARKUP_DIST'],
    explanation:
      'This distribution sets rental listing mark-up ratios relative to local benchmark rents. Higher mark-up mass raises initial asking rents and can increase subsequent rent reductions before match.'
  },
  {
    id: 'rent_reduction_gaussian',
    title: 'Rent Reduction Size Distribution (Gaussian)',
    group: 'Housing & Rental Market',
    format: 'gaussian_pair',
    configKeys: ['RENT_REDUCTION_MU', 'RENT_REDUCTION_SIGMA'],
    explanation:
      'These parameters define the normal distribution for log rental-price reduction magnitudes. The chart shows both log-reduction density and the implied percent-reduction density.'
  },
  {
    id: 'days_under_offer',
    title: 'Days Under Offer Before Bid-Up Resolution',
    group: 'Housing & Rental Market',
    format: 'scalar',
    configKeys: ['DAYS_UNDER_OFFER'],
    explanation:
      'This duration controls how long a sale remains under offer while the seller can consider additional bids. Longer windows can increase the opportunity for bid-up events, while shorter windows resolve transactions faster.'
  },
  {
    id: 'bidup_multiplier',
    title: 'Bid-Up Multiplier Under Competition',
    group: 'Housing & Rental Market',
    format: 'scalar',
    configKeys: ['BIDUP'],
    explanation:
      'This multiplier sets the price uplift applied in competitive multi-bid sale situations. Higher values amplify short-run price escalation pressure in tight submarkets.'
  },
  {
    id: 'rent_gross_yield',
    title: 'Initial Buy-to-Let Gross Yield',
    group: 'Housing & Rental Market',
    format: 'scalar',
    configKeys: ['RENT_GROSS_YIELD'],
    explanation:
      'This parameter seeds expected gross rental yield for buy-to-let economics. Higher yields improve rental-investment attractiveness relative to capital-gain-only strategies.'
  },
  {
    id: 'market_average_price_decay',
    title: 'Speed of Market Average Price Adjustment',
    group: 'Housing & Rental Market',
    format: 'scalar',
    configKeys: ['MARKET_AVERAGE_PRICE_DECAY'],
    explanation:
      'This decay constant sets the responsiveness of the moving average used for market prices. Higher values make average-price signals adapt faster to new transactions, while lower values smooth shocks and delay adjustment. It influences short-run dynamics and expectation feedback.'
  },
  {
    id: 'mortgage_duration_years',
    title: 'Typical Mortgage Term Length (Years)',
    group: 'Purchase & Mortgage',
    format: 'scalar',
    configKeys: ['MORTGAGE_DURATION_YEARS'],
    explanation:
      'Mortgage duration governs repayment horizon for loans. Longer terms reduce monthly repayments for a given principal, potentially easing affordability checks and raising feasible loan sizes. Shorter terms do the reverse and can tighten borrowing capacity.'
  },
  {
    id: 'downpayment_ftb_lognormal',
    title: 'First-Time Buyer Down-Payment Distribution',
    group: 'Purchase & Mortgage',
    format: 'lognormal_pair',
    configKeys: ['DOWNPAYMENT_FTB_SCALE', 'DOWNPAYMENT_FTB_SHAPE'],
    explanation:
      'These parameters control the first-time-buyer down-payment distribution. Higher scale generally implies larger typical down-payments, while higher shape increases dispersion across households. This directly affects entry feasibility and loan-to-value dynamics for FTB cohorts.'
  },
  {
    id: 'downpayment_oo_lognormal',
    title: 'Owner-Occupier Down-Payment Distribution',
    group: 'Purchase & Mortgage',
    format: 'lognormal_pair',
    configKeys: ['DOWNPAYMENT_OO_SCALE', 'DOWNPAYMENT_OO_SHAPE'],
    explanation:
      'These parameters define down-payment behavior for owner-occupiers beyond first-time buyers. Higher scale increases typical equity contribution at purchase, while higher shape broadens variation between households. This influences leverage, mortgage demand, and transaction pacing.'
  },
  {
    id: 'downpayment_btl_lognormal',
    title: 'Buy-to-Let Down-Payment Distribution Shape',
    group: 'Purchase & Mortgage',
    format: 'lognormal_pair',
    configKeys: ['DOWNPAYMENT_BTL_SCALE', 'DOWNPAYMENT_BTL_SHAPE'],
    explanation:
      'These parameters define the lognormal down-payment distribution for BTL investors. Higher scale increases typical investor equity contributions, while higher shape broadens deposit dispersion across investors.'
  },
  {
    id: 'downpayment_btl_profile',
    title: 'Buy-to-Let Down-Payment Mean and Volatility',
    group: 'Purchase & Mortgage',
    format: 'scalar_pair',
    configKeys: ['DOWNPAYMENT_BTL_MEAN', 'DOWNPAYMENT_BTL_EPSILON'],
    explanation:
      'These parameters set the central tendency and dispersion of BTL down-payment behavior. Higher means increase equity contribution requirements, while larger epsilon broadens investor-level leverage dispersion.'
  },
  {
    id: 'buy_quad',
    title: 'Purchase Budget Curve and Bid Variation Noise',
    group: 'Purchase & Mortgage',
    format: 'buy_quad',
    configKeys: ['BUY_SCALE', 'BUY_EXPONENT', 'BUY_MU', 'BUY_SIGMA'],
    explanation:
      'This combined set defines desired purchase budget as a power function of income, multiplied by a lognormal noise term. Scale and exponent shape deterministic budget growth with income, while mu and sigma govern multiplicative variation between similar households. Larger sigma creates wider bid dispersion and can increase price-outcome heterogeneity.'
  },
  {
    id: 'bank_rate_credit_response',
    title: 'Bank Initial Rate and Credit-Supply Response',
    group: 'Bank & Credit Policy',
    format: 'scalar',
    configKeys: ['BANK_INITIAL_RATE', 'BANK_INITIAL_CREDIT_SUPPLY', 'BANK_D_INTEREST_D_DEMAND'],
    explanation:
      'These parameters define initial mortgage pricing and the sensitivity of lending rates to credit-demand pressure. They directly shape borrowing costs and credit availability feedback in the model.'
  },
  {
    id: 'central_bank_base_rate',
    title: 'Central Bank Initial Base Rate',
    group: 'Bank & Credit Policy',
    format: 'scalar',
    configKeys: ['CENTRAL_BANK_INITIAL_BASE_RATE'],
    explanation:
      'This policy rate seeds the central-bank rate environment used by the credit system. Higher base rates raise the monetary-policy backdrop that feeds into mortgage-rate calibration and affordability pressure.'
  },
  {
    id: 'bank_ltv_limits',
    title: 'Bank Hard LTV Limits by Borrower Type',
    group: 'Bank & Credit Policy',
    format: 'scalar',
    configKeys: ['BANK_LTV_HARD_MAX_FTB', 'BANK_LTV_HARD_MAX_HM', 'BANK_LTV_HARD_MAX_BTL'],
    explanation:
      'These internal bank caps bound maximum loan-to-value by segment. Tighter caps require larger deposits and can suppress leveraged purchase demand.'
  },
  {
    id: 'central_bank_ltv_limits',
    title: 'Central Bank Hard LTV Limits by Borrower Type',
    group: 'Bank & Credit Policy',
    format: 'scalar',
    configKeys: ['CENTRAL_BANK_LTV_HARD_MAX_FTB', 'CENTRAL_BANK_LTV_HARD_MAX_HM', 'CENTRAL_BANK_LTV_HARD_MAX_BTL'],
    explanation:
      'These central-bank caps bound maximum loan-to-value ratios for first-time buyers, home movers, and BTL investors. Lower caps require larger equity buffers and can reduce leveraged purchase demand.'
  },
  {
    id: 'bank_lti_limits',
    title: 'Bank Hard LTI Limits by Borrower Type',
    group: 'Bank & Credit Policy',
    format: 'scalar_pair',
    configKeys: ['BANK_LTI_HARD_MAX_FTB', 'BANK_LTI_HARD_MAX_HM'],
    explanation:
      'These hard loan-to-income limits cap borrowing relative to gross income for first-time buyers and home movers. Lower limits tighten affordability constraints and moderate debt-fueled demand.'
  },
  {
    id: 'central_bank_lti_soft_limits',
    title: 'Central Bank Soft LTI Limits by Borrower Type',
    group: 'Bank & Credit Policy',
    format: 'scalar_pair',
    configKeys: ['CENTRAL_BANK_LTI_SOFT_MAX_FTB', 'CENTRAL_BANK_LTI_SOFT_MAX_HM'],
    explanation:
      'These soft loan-to-income thresholds represent the central-bank flow-limit policy for first-time buyers and home movers. Lower thresholds tighten the share of high-LTI lending allowed through the policy channel.'
  },
  {
    id: 'bank_affordability_icr_limits',
    title: 'Bank Affordability and ICR Hard Limits',
    group: 'Bank & Credit Policy',
    format: 'scalar_pair',
    configKeys: ['BANK_AFFORDABILITY_HARD_MAX', 'BANK_ICR_HARD_MIN'],
    explanation:
      'These constraints cap repayment burden for owner-occupier mortgages and minimum rental-cover for BTL loans. Together they regulate debt service risk tolerance across lending channels.'
  },
  {
    id: 'central_bank_affordability_icr_limits',
    title: 'Central Bank Affordability and ICR Constraints',
    group: 'Bank & Credit Policy',
    format: 'scalar_pair',
    configKeys: ['CENTRAL_BANK_AFFORDABILITY_HARD_MAX', 'CENTRAL_BANK_ICR_HARD_MIN'],
    explanation:
      'These central-bank constraints represent the separate policy affordability cap and BTL interest-cover floor. Non-binding sentinel values distinguish inactive central-bank limits from representative-bank underwriting constraints.'
  },
  {
    id: 'bank_age_limit',
    title: 'Mortgage Origination and Repayment Age Limit',
    group: 'Bank & Credit Policy',
    format: 'scalar',
    configKeys: ['BANK_AGE_LIMIT'],
    explanation:
      'This lender-side age limit controls eligibility for obtaining and finishing repayment of non-BTL mortgages. Higher values expand mortgage eligibility for older households, while lower values tighten access.'
  },
  {
    id: 'btl_strategy_split',
    title: 'Buy-to-Let Strategy Mix: Income Yield, Capital Growth, and Mixed',
    group: 'BTL & Investor Behavior',
    format: 'scalar_pair',
    configKeys: ['BTL_P_INCOME_DRIVEN', 'BTL_P_CAPITAL_DRIVEN'],
    derivedScalars: [
      {
        key: 'BTL_P_MIXED',
        expression: 'btl_mixed_probability',
        sourceConfigKeys: ['BTL_P_INCOME_DRIVEN', 'BTL_P_CAPITAL_DRIVEN']
      }
    ],
    explanation:
      'These probabilities set how many BTL investors primarily target rental income, capital gains, or a mixed strategy. The mixed share is derived as the residual probability after income-driven and capital-driven shares are assigned, matching the Java model strategy-selection order.'
  },
  {
    id: 'btl_choice_intensity',
    title: 'Buy-to-Let Choice Intensity',
    group: 'BTL & Investor Behavior',
    format: 'scalar',
    configKeys: ['BTL_CHOICE_INTENSITY'],
    explanation:
      'This intensity parameter controls how strongly BTL investors respond to effective-yield differences when deciding whether to buy or sell. Higher values make choices more sharply concentrated around the highest-yield option.'
  }
];

export const PARAMETER_IDS = PARAMETER_CATALOG.map((entry) => entry.id);
