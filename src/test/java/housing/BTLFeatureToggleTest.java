package housing;

import collectors.HousingMarketStats;
import collectors.HouseholdStats;
import collectors.RentalMarketStats;
import org.apache.commons.math3.distribution.LogNormalDistribution;
import org.apache.commons.math3.random.RandomGenerator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Paths;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BTLFeatureToggleTest {

    private static final String CONFIG_PATH = Paths.get("src/main/resources/config.properties")
            .toAbsolutePath().toString();

    private RandomGenerator prng;

    @BeforeEach
    void setUp() throws Exception {
        Model.config = new Config(CONFIG_PATH);
        Model.config.BANK_INITIAL_RATE = 0.06;
        Model.config.CENTRAL_BANK_INITIAL_BASE_RATE = 0.06;
        Model.config.BANK_LTV_HARD_MAX_BTL = 0.85;
        Model.config.CENTRAL_BANK_LTV_HARD_MAX_BTL = 0.85;
        Model.config.BANK_ICR_HARD_MIN = 1.25;
        Model.config.CENTRAL_BANK_ICR_HARD_MIN = 1.25;
        prng = RngFactory.create(123);
        Model.government = new Government();
        Model.householdStats = new HouseholdStats();
        Model.householdStats.init();
        Model.housingMarketStats = new FixedHousingMarketStats(200000.0, 200000.0);
        Model.rentalMarketStats = new FixedRentalMarketStats(Model.housingMarketStats, 0.06, 1.0);
        Model.centralBank = new CentralBank();
        Model.centralBank.init();
        Model.bank = new Bank(Model.centralBank);
        Model.bank.init();
        resetHouseholdBehaviourStatics();
    }

    @Test
    void legacyBTLDownPaymentUsesMeanEpsilonRuleWhenToggleIsFalse() throws Exception {
        Model.config.enableBTLDownpaymentLognormal = false;
        Model.config.DOWNPAYMENT_BTL_MEAN = 0.40;
        Model.config.DOWNPAYMENT_BTL_EPSILON = 0.0;

        Household household = new Household(prng, 35.0);
        setField(household, "isFirstTimeBuyer", false);
        setField(household, "bankBalance", 100000.0);

        assertEquals(40000.0,
                household.behaviour.decideDownPayment(prng, household, 100000.0, false), 1.0e-9);
    }

    @Test
    void lognormalBTLDownPaymentUsesHpiScaledDistributionWhenToggleIsTrue() throws Exception {
        Model.config.enableBTLDownpaymentLognormal = true;
        Model.config.DOWNPAYMENT_BTL_SCALE = Math.log(0.25);
        Model.config.DOWNPAYMENT_BTL_SHAPE = 1.0e-12;

        Household household = new Household(prng, 35.0);
        setField(household, "isFirstTimeBuyer", false);
        setField(household, "bankBalance", 100000.0);
        setField(household, "incomePercentile", 0.5);

        assertEquals(50000.0,
                household.behaviour.decideDownPayment(prng, household, 100000.0, false), 1.0e-3);
    }

    @Test
    void percentileDownPaymentsReuseStoredPercentileWithoutAdvancingMersenne() throws Exception {
        Model.config.enableBTLDownpaymentLognormal = true;
        Model.housingMarketStats = new FixedHousingMarketStats(200000.0, 1.0);
        resetHouseholdBehaviourStatics();

        RandomGenerator control = RngFactory.create(123);
        Household household = new Household(prng, 35.0);
        Household controlHousehold = new Household(control, 35.0);
        setField(household, "isFirstTimeBuyer", false);
        setField(household, "bankBalance", Double.MAX_VALUE / 4.0);

        double percentile = household.incomePercentile;
        double housePrice = Double.MAX_VALUE / 2.0;
        double expectedOwnerOccupier = new LogNormalDistribution(null,
                Model.config.DOWNPAYMENT_OO_SCALE, Model.config.DOWNPAYMENT_OO_SHAPE)
                .inverseCumulativeProbability(percentile);
        double expectedBuyToLet = new LogNormalDistribution(null,
                Model.config.DOWNPAYMENT_BTL_SCALE, Model.config.DOWNPAYMENT_BTL_SHAPE)
                .inverseCumulativeProbability(percentile);
        double actualOwnerOccupier = household.behaviour.decideDownPayment(
                prng, household, housePrice, true);
        double actualBuyToLet = household.behaviour.decideDownPayment(
                prng, household, housePrice, false);

        assertAll(
                () -> assertEquals(Double.doubleToRawLongBits(controlHousehold.incomePercentile),
                        Double.doubleToRawLongBits(percentile)),
                () -> assertEquals(Double.doubleToRawLongBits(expectedOwnerOccupier),
                        Double.doubleToRawLongBits(actualOwnerOccupier)),
                () -> assertEquals(Double.doubleToRawLongBits(expectedBuyToLet),
                        Double.doubleToRawLongBits(actualBuyToLet)),
                () -> assertEquals(Double.doubleToRawLongBits(control.nextDouble()),
                        Double.doubleToRawLongBits(prng.nextDouble()))
        );
    }

    @Test
    void buyAndSellYieldInputsUseZeroAlternativeReturnWhenToggleIsFalse() throws Exception {
        Model.config.enableBTLAlternativeReturn = false;
        Model.config.BTL_ALTERNATIVE_RETURN = 0.03;

        HouseholdBehaviour behaviour = new Household(prng, 35.0).behaviour;

        assertEquals(0.0, invokeDouble(behaviour, "getBTLAlternativeReturn"), 1.0e-12);
    }

    @Test
    void buyAndSellYieldInputsUseConfiguredAlternativeReturnWhenToggleIsTrue() throws Exception {
        Model.config.enableBTLAlternativeReturn = true;
        Model.config.BTL_ALTERNATIVE_RETURN = 0.03;

        HouseholdBehaviour behaviour = new Household(prng, 35.0).behaviour;

        assertEquals(0.03, invokeDouble(behaviour, "getBTLAlternativeReturn"), 1.0e-12);
    }

    @Test
    void alternativeReturnToggleChangesBuyDecisionAtTheCallSite() throws Exception {
        Model.config.BTL_CHOICE_INTENSITY = 1000.0;
        Model.config.enableBTLAlternativeReturn = false;
        Model.rentalMarketStats = new FixedRentalMarketStats(Model.housingMarketStats, 0.058, 1.0);
        resetHouseholdBehaviourStatics();

        Household legacyInvestor = createInvestor(1_000_000.0, 2);
        setBehaviourField(legacyInvestor.behaviour, "BTLCapGainCoefficient", 0.0);

        assertTrue(legacyInvestor.behaviour.decideToBuyInvestmentProperty(prng, legacyInvestor));

        setUp();
        Model.config.BTL_CHOICE_INTENSITY = 1000.0;
        Model.config.enableBTLAlternativeReturn = true;
        Model.config.BTL_ALTERNATIVE_RETURN = 0.05;
        Model.rentalMarketStats = new FixedRentalMarketStats(Model.housingMarketStats, 0.058, 1.0);
        resetHouseholdBehaviourStatics();

        Household alternativeReturnInvestor = createInvestor(1_000_000.0, 2);
        setBehaviourField(alternativeReturnInvestor.behaviour, "BTLCapGainCoefficient", 0.0);

        assertFalse(alternativeReturnInvestor.behaviour.decideToBuyInvestmentProperty(
                prng, alternativeReturnInvestor));
    }

    @Test
    void alternativeReturnToggleChangesSellDecisionAtTheCallSite() throws Exception {
        Model.config.BTL_CHOICE_INTENSITY = 1000.0;
        Model.config.enableBTLAlternativeReturn = false;
        Model.rentalMarketStats = new FixedRentalMarketStats(Model.housingMarketStats, 0.06, 1.0);
        resetHouseholdBehaviourStatics();

        Household legacyInvestor = createInvestor(1_000_000.0, 3);
        setBehaviourField(legacyInvestor.behaviour, "BTLCapGainCoefficient", 0.0);
        House legacyTarget = addOwnedProperty(legacyInvestor, false, 120_000.0, 0.06, 120);
        legacyTarget.putForRent(new HouseOfferRecord(legacyTarget, 750.0, false));

        assertFalse(legacyInvestor.behaviour.decideToSellInvestmentProperty(prng, legacyTarget, legacyInvestor));

        setUp();
        Model.config.BTL_CHOICE_INTENSITY = 1000.0;
        Model.config.enableBTLAlternativeReturn = true;
        Model.config.BTL_ALTERNATIVE_RETURN = 0.05;
        Model.rentalMarketStats = new FixedRentalMarketStats(Model.housingMarketStats, 0.06, 1.0);
        resetHouseholdBehaviourStatics();

        Household alternativeReturnInvestor = createInvestor(1_000_000.0, 3);
        setBehaviourField(alternativeReturnInvestor.behaviour, "BTLCapGainCoefficient", 0.0);
        House alternativeReturnTarget = addOwnedProperty(alternativeReturnInvestor, false, 120_000.0, 0.06, 120);
        alternativeReturnTarget.putForRent(new HouseOfferRecord(alternativeReturnTarget, 750.0, false));

        assertTrue(alternativeReturnInvestor.behaviour.decideToSellInvestmentProperty(
                prng, alternativeReturnTarget, alternativeReturnInvestor));
    }

    @Test
    void buyAndSellYieldInputsUseLegacyPaymentFlowFinancingWhenToggleIsFalse() throws Exception {
        Model.config.enableBTLAmortizingMortgageMode = false;

        HouseholdBehaviour behaviour = new Household(prng, 35.0).behaviour;
        MortgageAgreement mortgage = new MortgageAgreement(new Household(prng, 35.0), true);
        mortgage.monthlyPayment = 700.0;
        mortgage.principal = 100000.0;
        mortgage.monthlyInterestRate = 0.005;
        mortgage.nPayments = 300;

        double financingCostRate = invokeDouble(behaviour, "getBTLFinancingCostRate", mortgage, 50000.0);

        assertEquals(0.168, financingCostRate, 1.0e-12);
    }

    @Test
    void buyAndSellYieldInputsUseAmortizingInterestExpenseWhenToggleIsTrue() throws Exception {
        Model.config.enableBTLAmortizingMortgageMode = true;

        HouseholdBehaviour behaviour = new Household(prng, 35.0).behaviour;
        MortgageAgreement mortgage = new MortgageAgreement(new Household(prng, 35.0), true);
        mortgage.monthlyPayment = 700.0;
        mortgage.principal = 100000.0;
        mortgage.monthlyInterestRate = 0.005;
        mortgage.nPayments = 300;

        double financingCostRate = invokeDouble(behaviour, "getBTLFinancingCostRate", mortgage, 50000.0);

        assertEquals(0.12, financingCostRate, 1.0e-12);
    }

    @Test
    void legacyBTLApprovalUsesInterestOnlyIcrSizing() throws Exception {
        Model.config.enableBTLAmortizingMortgageMode = false;

        Household borrower = new Household(prng, 35.0);
        setField(borrower, "isFirstTimeBuyer", false);
        setField(borrower, "bankBalance", 40000.0);

        MortgageAgreement approval = Model.bank.requestApproval(borrower, 100000.0, 0.0, false);

        assertAll(
                () -> assertEquals(80000.0, approval.principal, 1.0e-6),
                () -> assertEquals(20000.0, approval.downPayment, 1.0e-6),
                () -> assertEquals(400.0, approval.monthlyPayment, 1.0e-6),
                () -> assertTrue(approval.isBuyToLet)
        );
    }

    @Test
    void amortizingBTLApprovalUsesAmortizingIcrSizing() throws Exception {
        Model.config.enableBTLAmortizingMortgageMode = true;

        Household borrower = new Household(prng, 35.0);
        setField(borrower, "isFirstTimeBuyer", false);
        setField(borrower, "bankBalance", 40000.0);

        MortgageAgreement approval = Model.bank.requestApproval(borrower, 100000.0, 0.0, false);
        double annualPaymentRate = amortizingAnnualPaymentRate();
        double expectedPrincipal = Math.min(85000.0, 6000.0 / (1.25 * annualPaymentRate));

        assertAll(
                () -> assertEquals(expectedPrincipal, approval.principal, 1.0e-6),
                () -> assertEquals(400.0, approval.monthlyPayment, 1.0e-6),
                () -> assertTrue(approval.downPayment > 20000.0),
                () -> assertTrue(approval.isBuyToLet)
        );
    }

    @Test
    void legacyBTLMaxMortgagePriceUsesInterestOnlyIcrSizing() throws Exception {
        Model.config.enableBTLAmortizingMortgageMode = false;

        Household borrower = new Household(prng, 35.0);
        setField(borrower, "isFirstTimeBuyer", false);
        setField(borrower, "bankBalance", 40000.0);

        assertEquals(199999.95, Model.bank.getMaxMortgagePrice(borrower, false), 1.0e-2);
    }

    @Test
    void amortizingBTLMaxMortgagePriceUsesAmortizingIcrSizing() throws Exception {
        Model.config.enableBTLAmortizingMortgageMode = true;

        Household borrower = new Household(prng, 35.0);
        setField(borrower, "isFirstTimeBuyer", false);
        setField(borrower, "bankBalance", 40000.0);

        double annualPaymentRate = amortizingAnnualPaymentRate();
        double maxDownPayment = borrower.getBankBalance() - 0.01;
        double expectedMaxPrice = Math.min(maxDownPayment / (1.0 - 0.85),
                maxDownPayment / (1.0 - 0.06 / (1.25 * annualPaymentRate)));

        assertEquals(expectedMaxPrice, Model.bank.getMaxMortgagePrice(borrower, false), 1.0e-6);
    }

    private static void resetHouseholdBehaviourStatics() throws Exception {
        setStaticField(HouseholdBehaviour.class, "config", Model.config);
        setStaticField(HouseholdBehaviour.class, "housingMarketStats", Model.housingMarketStats);
        setStaticField(HouseholdBehaviour.class, "rentalMarketStats", Model.rentalMarketStats);
    }

    private static void setField(Object target, String fieldName, Object value) throws Exception {
        Field field = target.getClass().getDeclaredField(fieldName);
        field.setAccessible(true);
        field.set(target, value);
    }

    private static void setBehaviourField(HouseholdBehaviour behaviour, String fieldName, Object value)
            throws Exception {
        Field field = behaviour.getClass().getDeclaredField(fieldName);
        field.setAccessible(true);
        field.set(behaviour, value);
    }

    private static void setStaticField(Class<?> targetClass, String fieldName, Object value) throws Exception {
        Field field = targetClass.getDeclaredField(fieldName);
        field.setAccessible(true);
        field.set(null, value);
    }

    private static double invokeDouble(Object target, String methodName, Object... args) throws Exception {
        Class<?>[] argTypes = new Class<?>[args.length];
        for (int i = 0; i < args.length; i += 1) {
            if (args[i] instanceof Double) {
                argTypes[i] = double.class;
            } else {
                argTypes[i] = args[i].getClass();
            }
        }
        Method method = target.getClass().getDeclaredMethod(methodName, argTypes);
        method.setAccessible(true);
        return (double) method.invoke(target, args);
    }

    private static double amortizingAnnualPaymentRate() {
        double monthlyRate = Model.bank.getMortgageInterestRate() / Model.config.constants.MONTHS_IN_YEAR;
        int nPayments = Model.config.MORTGAGE_DURATION_YEARS * Model.config.constants.MONTHS_IN_YEAR;
        return monthlyRate / (1.0 - Math.pow(1.0 + monthlyRate, -nPayments))
                * Model.config.constants.MONTHS_IN_YEAR;
    }

    private Household createInvestor(double bankBalance, int nExistingProperties) throws Exception {
        Household investor = new Household(prng, 40.0);
        setField(investor, "bankBalance", bankBalance);
        setField(investor, "isFirstTimeBuyer", false);
        setBehaviourField(investor.behaviour, "BTLInvestor", true);

        addOwnedProperty(investor, true, 0.0, Model.bank.getMortgageInterestRate(),
                Model.config.MORTGAGE_DURATION_YEARS * Model.config.constants.MONTHS_IN_YEAR);
        for (int i = 1; i < nExistingProperties; i += 1) {
            addOwnedProperty(investor, false, 0.0, Model.bank.getMortgageInterestRate(),
                    Model.config.MORTGAGE_DURATION_YEARS * Model.config.constants.MONTHS_IN_YEAR);
        }
        return investor;
    }

    private static House addOwnedProperty(Household owner, boolean home, double principal, double annualRate,
                                          int nPayments) throws Exception {
        House house = new House(0);
        house.owner = owner;
        if (home) {
            house.resident = owner;
            setField(owner, "home", house);
        }

        MortgageAgreement mortgage = new MortgageAgreement(owner, !home);
        mortgage.principal = principal;
        mortgage.downPayment = 0.0;
        mortgage.purchasePrice = principal;
        mortgage.monthlyInterestRate = annualRate / Model.config.constants.MONTHS_IN_YEAR;
        mortgage.monthlyPayment = principal * mortgage.monthlyInterestRate;
        mortgage.nPayments = nPayments;
        owner.getHousePayments().put(house, mortgage);
        return house;
    }

    private static final class FixedHousingMarketStats extends HousingMarketStats {
        private final double salePrice;
        private final double hpi;

        private FixedHousingMarketStats(double salePrice, double hpi) {
            super(null, 1);
            this.salePrice = salePrice;
            this.hpi = hpi;
        }

        @Override
        public double getExpAvSalePriceForQuality(int quality) {
            return salePrice;
        }

        @Override
        public double getHPI() {
            return hpi;
        }
    }

    private static final class FixedRentalMarketStats extends RentalMarketStats {
        private final double flowYield;
        private final double occupancy;

        private FixedRentalMarketStats(HousingMarketStats housingMarketStats, double flowYield, double occupancy) {
            super(housingMarketStats, null, 1);
            this.flowYield = flowYield;
            this.occupancy = occupancy;
        }

        @Override
        public double getAvOccupancyForQuality(int quality) {
            return occupancy;
        }

        @Override
        public double getAvFlowYieldForQuality(int quality) {
            return flowYield;
        }

        @Override
        public double getExpAvFlowYield() {
            return flowYield;
        }
    }
}
