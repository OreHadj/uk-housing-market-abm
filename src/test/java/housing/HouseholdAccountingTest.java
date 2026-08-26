package housing;

import collectors.HouseholdStats;
import collectors.HousingMarketStats;
import collectors.MicroDataRecorder;
import collectors.RentalMarketStats;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class HouseholdAccountingTest {

    private static final String CONFIG_PATH = Paths.get("src/main/resources/config.properties")
            .toAbsolutePath().toString();

    @TempDir
    Path tempDir;

    private RandomService randomService;
    private RngContext context;

    @BeforeEach
    void setUp() throws Exception {
        Model.config = new Config(CONFIG_PATH);
        randomService = RngFactory.create(123);
        context = randomService.demographicsContext(0, 0);
        Model.government = new Government();
        Model.householdStats = new HouseholdStats();
        Model.householdStats.init();
        Model.centralBank = new CentralBank();
        Model.centralBank.init();
        Model.bank = new Bank(Model.centralBank);
        Model.bank.init();
        Model.housingMarketStats = new FixedHousingMarketStats(250000.0);
        Model.houseRentalMarket = new HouseRentalMarket();
        Model.houseRentalMarket.init();
        Model.rentalMarketStats = new FixedRentalMarketStats(Model.housingMarketStats, 0.05, 1.0);
        resetHouseholdBehaviourStatics();
    }

    @Test
    void recordedNonHousingConsumptionUsesUkEssentialConsumptionRule() throws Exception {
        Model.config.ESSENTIAL_CONSUMPTION_FRACTION = 0.5;
        Model.config.GOVERNMENT_MONTHLY_INCOME_SUPPORT = 800.0;

        Household household = new Household(context, 35.0);
        setField(household, "desiredConsumption", 250.0);

        assertEquals(650.0, household.getRecordedNonHousingConsumption(), 1.0e-9);
    }

    @Test
    void recordHousingCashFlowsSplitsRentalInterestAndPrincipal() throws Exception {
        Household household = new Household(context, 35.0);

        House rentalHome = new House(0);
        RentalAgreement rentalAgreement = new RentalAgreement();
        rentalAgreement.nPayments = 1;
        rentalAgreement.monthlyPayment = 900.0;
        household.getHousePayments().put(rentalHome, rentalAgreement);

        House ownedHome = new House(0);
        ownedHome.owner = household;
        MortgageAgreement mortgageAgreement = new MortgageAgreement(household, false);
        mortgageAgreement.nPayments = 12;
        mortgageAgreement.monthlyPayment = 1200.0;
        mortgageAgreement.principal = 200000.0;
        mortgageAgreement.monthlyInterestRate = 0.003;
        household.getHousePayments().put(ownedHome, mortgageAgreement);

        Method method = Household.class.getDeclaredMethod("recordHousingCashFlows");
        method.setAccessible(true);
        method.invoke(household);

        assertAll(
                () -> assertEquals(900.0, getDoubleField(Model.householdStats, "rentalCashOutflowCounter"), 1.0e-9),
                () -> assertEquals(600.0, getDoubleField(Model.householdStats, "mortgageInterestPaymentCounter"), 1.0e-9),
                () -> assertEquals(600.0, getDoubleField(Model.householdStats, "mortgagePrincipalPaymentCounter"), 1.0e-9)
        );
    }

    @Test
    void completeHouseLetCachesActiveRentalIncome() {
        Household landlord = new Household(context, 45.0);
        House rentedHouse = addOwnedInvestmentHouse(landlord);
        HouseOfferRecord offer = new HouseOfferRecord(rentedHouse, 950.0, false, 0);
        RentalAgreement rentalAgreement = rentalAgreement(950.0, 6);

        landlord.completeHouseLet(offer, rentalAgreement);

        assertEquals(950.0, landlord.getMonthlyGrossRentalIncome(), 1.0e-9);
    }

    @Test
    void finalRentalPaymentUpdatesLandlordCachedRentalIncome() throws Exception {
        Household landlord = new Household(context, 45.0);
        Household tenant = new Household(context, 35.0);
        House rentedHouse = addOwnedInvestmentHouse(landlord);
        RentalAgreement rentalAgreement = rentalAgreement(875.0, 1);
        setRentedHome(tenant, rentedHouse, rentalAgreement);
        landlord.completeHouseLet(
                new HouseOfferRecord(rentedHouse, 875.0, false, 0), rentalAgreement);

        invokeMonthlyDisposableIncome(tenant);

        assertAll(
                () -> assertEquals(0, rentalAgreement.nPayments),
                () -> assertEquals(0.0, landlord.getMonthlyGrossRentalIncome(), 1.0e-9)
        );
    }

    @Test
    void finalRentalPaymentOnlyRemovesExpiredContractFromMultipleRentals() throws Exception {
        Household landlord = new Household(context, 45.0);
        Household expiringTenant = new Household(context, 35.0);
        Household ongoingTenant = new Household(context, 36.0);
        House expiringHouse = addOwnedInvestmentHouse(landlord);
        House ongoingHouse = addOwnedInvestmentHouse(landlord);
        RentalAgreement expiringAgreement = rentalAgreement(875.0, 1);
        RentalAgreement ongoingAgreement = rentalAgreement(1025.0, 6);
        setRentedHome(expiringTenant, expiringHouse, expiringAgreement);
        setRentedHome(ongoingTenant, ongoingHouse, ongoingAgreement);
        landlord.completeHouseLet(
                new HouseOfferRecord(expiringHouse, 875.0, false, 0), expiringAgreement);
        landlord.completeHouseLet(
                new HouseOfferRecord(ongoingHouse, 1025.0, false, 0), ongoingAgreement);

        invokeMonthlyDisposableIncome(expiringTenant);

        assertEquals(1025.0, landlord.getMonthlyGrossRentalIncome(), 1.0e-9);
    }

    @Test
    void endOfLettingAgreementRemovesActiveRentalIncome() {
        Household landlord = new Household(context, 45.0);
        House rentedHouse = addOwnedInvestmentHouse(landlord);
        RentalAgreement rentalAgreement = rentalAgreement(725.0, 6);
        landlord.completeHouseLet(
                new HouseOfferRecord(rentedHouse, 725.0, false, 0), rentalAgreement);

        landlord.endOfLettingAgreement(rentedHouse, rentalAgreement, context);

        assertEquals(0.0, landlord.getMonthlyGrossRentalIncome(), 1.0e-9);
    }

    @Test
    void saleClearingCallbackRetainsItsOriginAndExplicitTimeStep() {
        Household landlord = new Household(context, 45.0);
        House rentedHouse = addOwnedInvestmentHouse(landlord);
        RentalAgreement rentalAgreement = rentalAgreement(725.0, 6);
        landlord.completeHouseLet(
                new HouseOfferRecord(rentedHouse, 725.0, false, 3), rentalAgreement);
        RngContext saleClearing = randomService.saleClearingContext(0, 17);

        landlord.endOfLettingAgreement(rentedHouse, rentalAgreement, saleClearing);

        assertEquals(17, rentedHouse.getRentalRecord().getInitialListingTime());
    }

    @Test
    void tenantDeathEndsLettingAgreementAndRemovesLandlordRentalIncome() throws Exception {
        Household landlord = new Household(context, 45.0);
        Household tenant = new Household(context, 35.0);
        Household beneficiary = new Household(context, 40.0);
        House rentedHouse = addOwnedInvestmentHouse(landlord);
        RentalAgreement rentalAgreement = rentalAgreement(725.0, 6);
        setRentedHome(tenant, rentedHouse, rentalAgreement);
        landlord.completeHouseLet(
                new HouseOfferRecord(rentedHouse, 725.0, false, 0), rentalAgreement);

        tenant.transferAllWealthTo(beneficiary, context);

        assertAll(
                () -> assertEquals(0.0, landlord.getMonthlyGrossRentalIncome(), 1.0e-9),
                () -> assertEquals(null, tenant.getHome()),
                () -> assertEquals(null, rentedHouse.resident)
        );
    }

    @Test
    void completeHouseSaleEvictsTenantAndRemovesRentalIncome() throws Exception {
        Household landlord = new Household(context, 45.0);
        Household tenant = new Household(context, 35.0);
        House rentedHouse = addOwnedInvestmentHouse(landlord);
        RentalAgreement rentalAgreement = rentalAgreement(1030.0, 6);
        setRentedHome(tenant, rentedHouse, rentalAgreement);
        landlord.completeHouseLet(
                new HouseOfferRecord(rentedHouse, 1030.0, false, 0), rentalAgreement);

        landlord.completeHouseSale(new HouseOfferRecord(rentedHouse, 250000.0, true, 0));

        assertAll(
                () -> assertEquals(0.0, landlord.getMonthlyGrossRentalIncome(), 1.0e-9),
                () -> assertFalse(tenant.getHousePayments().containsKey(rentedHouse)),
                () -> assertEquals(null, tenant.getHome())
        );
    }

    @Test
    void recordWritesBackwardCompatibleHousingWealthAndNewMicrodata() throws Exception {
        Model.config.recordHouseholdID = false;
        Model.config.recordEmploymentIncome = false;
        Model.config.recordRentalIncome = false;
        Model.config.recordBankBalance = false;
        Model.config.recordHousingWealth = true;
        Model.config.recordTotalDebt = true;
        Model.config.recordNHousesOwned = false;
        Model.config.recordHousingStatus = true;
        Model.config.recordAge = false;
        Model.config.recordConsumption = true;
        Model.config.recordSavingRate = false;
        Model.config.ESSENTIAL_CONSUMPTION_FRACTION = 0.25;
        Model.config.GOVERNMENT_MONTHLY_INCOME_SUPPORT = 400.0;

        Model.t = 996;
        Model.households = new ArrayList<>();
        Model.housingMarketStats = new FixedHousingMarketStats(250000.0);
        Model.microDataRecorder = new MicroDataRecorder(tempDir.toString() + File.separator);
        Model.microDataRecorder.openSingleRunSingleVariableFiles(1, false, false, false, false, true, true,
                false, true, false, true, false);

        Household household = new Household(context, 35.0);
        setField(household, "bankBalance", 5000.0);
        setField(household, "desiredConsumption", 250.0);
        setBehaviourPropertyInvestor(household, false);

        House home = new House(0);
        home.owner = household;
        home.resident = household;
        setField(household, "home", home);

        MortgageAgreement mortgageAgreement = new MortgageAgreement(household, false);
        mortgageAgreement.nPayments = 12;
        mortgageAgreement.monthlyPayment = 1200.0;
        mortgageAgreement.principal = 100000.0;
        mortgageAgreement.monthlyInterestRate = 0.003;
        household.getHousePayments().put(home, mortgageAgreement);

        Model.households.add(household);

        Model.householdStats.record();
        Model.microDataRecorder.finishRun(false, false, false, false, true, true,
                false, true, false, true, false);

        assertAll(
                () -> assertEquals("996; 150000.00",
                        Files.readString(tempDir.resolve("HousingWealth-run1.csv")).trim()),
                () -> assertEquals("996; 100000.00",
                        Files.readString(tempDir.resolve("TotalDebt-run1.csv")).trim()),
                () -> assertEquals("996; 2",
                        Files.readString(tempDir.resolve("HousingStatus-run1.csv")).trim()),
                () -> assertEquals("996; 350.00",
                        Files.readString(tempDir.resolve("NonHousingConsumption-run1.csv")).trim())
        );
    }

    private static RentalAgreement rentalAgreement(double monthlyPayment, int nPayments) {
        RentalAgreement rentalAgreement = new RentalAgreement();
        rentalAgreement.monthlyPayment = monthlyPayment;
        rentalAgreement.nPayments = nPayments;
        return rentalAgreement;
    }

    private static House addOwnedInvestmentHouse(Household owner) {
        House house = new House(0);
        house.owner = owner;
        MortgageAgreement mortgageAgreement = new MortgageAgreement(owner, true);
        mortgageAgreement.nPayments = 0;
        mortgageAgreement.monthlyPayment = 0.0;
        mortgageAgreement.principal = 0.0;
        mortgageAgreement.monthlyInterestRate = 0.0;
        mortgageAgreement.purchasePrice = 250000.0;
        owner.getHousePayments().put(house, mortgageAgreement);
        return house;
    }

    private static void setRentedHome(Household tenant, House house, RentalAgreement rentalAgreement) throws Exception {
        tenant.getHousePayments().put(house, rentalAgreement);
        house.resident = tenant;
        setField(tenant, "home", house);
    }

    private static double invokeMonthlyDisposableIncome(Household household) throws Exception {
        Method method = Household.class.getDeclaredMethod("getMonthlyDisposableIncome");
        method.setAccessible(true);
        return (double) method.invoke(household);
    }

    private static void resetHouseholdBehaviourStatics() throws Exception {
        setStaticField(HouseholdBehaviour.class, "config", Model.config);
        setStaticField(HouseholdBehaviour.class, "housingMarketStats", Model.housingMarketStats);
        setStaticField(HouseholdBehaviour.class, "rentalMarketStats", Model.rentalMarketStats);
    }

    private static void setBehaviourPropertyInvestor(Household household, boolean value) throws Exception {
        Field investorField = household.behaviour.getClass().getDeclaredField("BTLInvestor");
        investorField.setAccessible(true);
        investorField.setBoolean(household.behaviour, value);
    }

    private static void setField(Object target, String fieldName, Object value) throws Exception {
        Field field = target.getClass().getDeclaredField(fieldName);
        field.setAccessible(true);
        field.set(target, value);
    }

    private static void setStaticField(Class<?> targetClass, String fieldName, Object value) throws Exception {
        Field field = targetClass.getDeclaredField(fieldName);
        field.setAccessible(true);
        field.set(null, value);
    }

    private static double getDoubleField(Object target, String fieldName) throws Exception {
        Field field = target.getClass().getDeclaredField(fieldName);
        field.setAccessible(true);
        return field.getDouble(target);
    }

    private static final class FixedHousingMarketStats extends HousingMarketStats {
        private final double houseValue;

        private FixedHousingMarketStats(double houseValue) {
            super(null, 1);
            this.houseValue = houseValue;
        }

        @Override
        public double getExpAvSalePriceForQuality(int quality) {
            return houseValue;
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
        public double getAvFlowYieldForQuality(int quality) {
            return flowYield;
        }

        @Override
        public double getAvOccupancyForQuality(int quality) {
            return occupancy;
        }

        @Override
        public double getExpAvSalePriceForQuality(int quality) {
            return 1000.0;
        }
    }
}
