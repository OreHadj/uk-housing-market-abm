package housing;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

import collectors.HouseholdStats;
import collectors.HousingMarketStats;
import collectors.RentalMarketStats;
import org.apache.commons.math3.random.MersenneTwister;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import utilities.Pdf;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

/** Real call-graph coverage for sale and rental markups across RNG origins. */
class ListingMarkupRngIntegrationTest {

    private static final String CONFIG_PATH = "src/main/resources/config.properties";
    private static final int SEED = 4_321;
    private static final int SIMULATION = 7;
    private static final int TIME_STEP = 29;
    private static final double SALE_BASE = 250_000.0;
    private static final double RENT_BASE = 1_250.0;
    private static final Pdf SALE_PDF = new Pdf(0.8, 1.4, ignored -> 1.0 / 0.6, 257);
    private static final Pdf RENT_PDF = new Pdf(0.7, 1.3, ignored -> 1.0 / 0.6, 257);

    @TempDir
    Path tempDir;

    private RngContext creationContext;

    @BeforeEach
    void setUp() throws Exception {
        Model.config = new Config(CONFIG_PATH);
        Model.government = new Government();
        Model.householdStats = new HouseholdStats();
        Model.householdStats.init();
        Model.centralBank = new CentralBank();
        Model.centralBank.init();
        Model.bank = new Bank(Model.centralBank);
        Model.bank.init();
        Model.houseSaleMarket = new HouseSaleMarket();
        Model.houseSaleMarket.init();
        Model.houseRentalMarket = new HouseRentalMarket();
        Model.houseRentalMarket.init();
        Model.housingMarketStats = new FixedHousingMarketStats(SALE_BASE);
        Model.rentalMarketStats = new FixedRentalMarketStats(
                Model.housingMarketStats, RENT_BASE);
        Model.construction = new Construction();
        Model.construction.init();
        Model.households = new ArrayList<>();
        Model.t = TIME_STEP;

        Household.resetIdPoolForNewSimulation();
        House.resetIdPoolForNewSimulation();
        HousingMarketRecord.resetIdPoolForNewSimulation();
        creationContext = RngFactory.create(991, RngMode.MERSENNE)
                .demographicsContext(0, 0);

        setBehaviourStatic("config", Model.config);
        setBehaviourStatic("housingMarketStats", Model.housingMarketStats);
        setBehaviourStatic("rentalMarketStats", Model.rentalMarketStats);
        setBehaviourStatic("saleMarkUpPdf", SALE_PDF);
        setBehaviourStatic("rentMarkUpPdf", RENT_PDF);
    }

    @Test
    void sameMonthHouseholdRemoveAndRelistUsesASecondDistinctAddressedEpisode()
            throws Exception {
        Model.config.derivedParams.MONTHLY_P_SELL = 1.0;
        Household owner = new Household(creationContext, 42.0);
        setPropertyInvestor(owner, false);
        House home = addOwnedHome(owner);
        RngContext context = RngFactory.create(SEED, RngMode.PHILOX_HOUSEHOLD)
                .householdLoopContext(SIMULATION, TIME_STEP);

        invokeManageHouse(owner, home, context);
        HouseOfferRecord first = home.getSaleRecord();
        double expectedFirst = addressedMarkup(
                home, RandomEvent.SALE_LIST_MARKUP, 0, SALE_PDF) * SALE_BASE;
        assertRawEquals(expectedFirst, first.getPrice());
        assertEquals(TIME_STEP, first.getInitialListingTime());

        Model.houseSaleMarket.removeOffer(first);
        invokeManageHouse(owner, home, context);
        HouseOfferRecord second = home.getSaleRecord();
        double expectedSecond = addressedMarkup(
                home, RandomEvent.SALE_LIST_MARKUP, 1, SALE_PDF) * SALE_BASE;

        assertRawEquals(expectedSecond, second.getPrice());
        assertNotEquals(Double.doubleToRawLongBits(first.getPrice()),
                Double.doubleToRawLongBits(second.getPrice()));
        assertEquals(TIME_STEP, second.getInitialListingTime());
    }

    @Test
    void householdEndTenancyDispatchKeepsHouseholdOriginAndUsesAddressedRentMarkup()
            throws Exception {
        CapturingLandlord landlord = new CapturingLandlord(creationContext, 48.0);
        House rentedHome = addOwnedInvestmentHouse(landlord);
        Household tenant = new Household(creationContext, 35.0);
        RentalAgreement agreement = installTenancy(landlord, tenant, rentedHome, 900.0);
        RngContext context = RngFactory.create(SEED, RngMode.PHILOX_HOUSEHOLD)
                .householdLoopContext(SIMULATION, TIME_STEP);

        invokeEndTenancy(tenant, context);

        assertSame(context, landlord.receivedContext);
        assertEquals(RngOrigin.HOUSEHOLD_LOOP, landlord.receivedContext.origin());
        assertRawEquals(addressedMarkup(
                        rentedHome, RandomEvent.RENT_LIST_MARKUP, 0, RENT_PDF) * RENT_BASE,
                rentedHome.getRentalRecord().getPrice());
        assertEquals(TIME_STEP, rentedHome.getRentalRecord().getInitialListingTime());
        assertEquals(agreement, landlord.receivedContract);
    }

    @Test
    void saleClearingTransactionKeepsOriginalOriginThroughBuyerEndTenancyCallback()
            throws Exception {
        CapturingLandlord landlord = new CapturingLandlord(creationContext, 48.0);
        House rentedHome = addOwnedInvestmentHouse(landlord);
        Household buyer = new Household(creationContext, 35.0);
        installTenancy(landlord, buyer, rentedHome, 900.0);
        setHouseholdField(buyer, "bankBalance", 10.0);
        setHouseholdField(buyer, "persistentLTILimit", 100.0);

        House purchased = new House(0);
        purchased.owner = new CapturingForeignOwner();
        HouseOfferRecord sale = new HouseOfferRecord(purchased, 1.0, false, 3);
        HouseBidderRecord bid = new HouseBidderRecord(buyer, 1.0, false, 1.0);
        RngContext context = RngFactory.create(SEED, RngMode.PHILOX_HOUSEHOLD)
                .saleClearingContext(SIMULATION, TIME_STEP);

        Model.houseSaleMarket.completeTransaction(bid, sale, context);

        MersenneTwister expected = new MersenneTwister(SEED);
        assertSame(context, landlord.receivedContext);
        assertEquals(RngOrigin.SALE_CLEARING, landlord.receivedContext.origin());
        assertRawEquals(RENT_PDF.nextDouble(expected) * RENT_BASE,
                rentedHome.getRentalRecord().getPrice());
        assertEquals(TIME_STEP, rentedHome.getRentalRecord().getInitialListingTime());
        assertSame(buyer, purchased.owner);
    }

    @Test
    void demographicsTransferKeepsOriginThroughForeignOwnerAndInheritanceCallbacks()
            throws Exception {
        Household deceased = new Household(creationContext, 80.0);
        Household beneficiary = new Household(creationContext, 45.0);
        setPropertyInvestor(beneficiary, false);
        addOwnedHome(beneficiary);

        CapturingForeignOwner foreignOwner = new CapturingForeignOwner();
        House rentedHome = new House(0);
        rentedHome.owner = foreignOwner;
        RentalAgreement agreement = new RentalAgreement();
        agreement.monthlyPayment = 700.0;
        agreement.nPayments = 6;
        deceased.getHousePayments().put(rentedHome, agreement);
        rentedHome.resident = deceased;
        setHouseholdField(deceased, "home", rentedHome);

        House inherited = addOwnedInvestmentHouse(deceased);
        RngContext context = RngFactory.create(SEED, RngMode.PHILOX_HOUSEHOLD)
                .demographicsContext(SIMULATION, TIME_STEP);

        deceased.transferAllWealthTo(beneficiary, context);

        MersenneTwister expected = new MersenneTwister(SEED);
        assertSame(context, foreignOwner.receivedContext);
        assertEquals(RngOrigin.DEMOGRAPHICS, foreignOwner.receivedContext.origin());
        assertSame(agreement, foreignOwner.receivedContract);
        assertRawEquals(SALE_PDF.nextDouble(expected) * SALE_BASE,
                inherited.getSaleRecord().getPrice());
        assertRawEquals(RENT_PDF.nextDouble(expected) * RENT_BASE,
                inherited.getRentalRecord().getPrice());
        assertEquals(TIME_STEP, inherited.getSaleRecord().getInitialListingTime());
        assertEquals(TIME_STEP, inherited.getRentalRecord().getInitialListingTime());
        assertSame(beneficiary, inherited.owner);
    }

    @Test
    void constructionStepKeepsConstructionOriginForNestedInheritHouseListings()
            throws Exception {
        Household first = homeowner(40.0);
        Household second = homeowner(41.0);
        Model.households.add(first);
        Model.households.add(second);
        int firstNewHouseId = Math.max(first.getHome().id, second.getHome().id) + 1;
        RngContext context = RngFactory.create(SEED, RngMode.PHILOX_HOUSEHOLD)
                .constructionContext(SIMULATION, TIME_STEP);

        MersenneTwister expected = new MersenneTwister(SEED);
        Map<Integer, double[]> expectedPrices = new HashMap<>();
        int targetStock = (int) (Model.households.size()
                * Model.config.derivedParams.UK_HOUSES_PER_HOUSEHOLD);
        for (int i = 0; i < targetStock; i++) {
            expected.nextDouble(); // NEW_BUILD_QUALITY retains floor-of-uniform consumption.
            expected.nextInt(Model.households.size()); // NEW_BUILD_RECIPIENT remains deferred.
            expectedPrices.put(firstNewHouseId + i, new double[] {
                    SALE_PDF.nextDouble(expected) * SALE_BASE,
                    RENT_PDF.nextDouble(expected) * RENT_BASE
            });
        }

        Model.construction.step(context);

        assertEquals(targetStock, Model.construction.getHousingStock());
        assertEquals(targetStock, expectedPrices.size());
        for (HousingMarketRecord record : Model.houseSaleMarket.getOffersPQ()) {
            House house = ((HouseOfferRecord) record).getHouse();
            double[] prices = expectedPrices.remove(house.id);
            assertRawEquals(prices[0], house.getSaleRecord().getPrice());
            assertRawEquals(prices[1], house.getRentalRecord().getPrice());
            assertEquals(TIME_STEP, house.getSaleRecord().getInitialListingTime());
            assertEquals(TIME_STEP, house.getRentalRecord().getInitialListingTime());
        }
        assertEquals(Map.of(), expectedPrices);
    }

    @Test
    void inheritedInvestorChecksSaleBeforeListingForEveryDeferredOrigin() throws Exception {
        assertInheritedInvestorChecksSaleBeforeListing(
                RngFactory.create(SEED, RngMode.PHILOX_HOUSEHOLD)
                        .demographicsContext(SIMULATION, TIME_STEP),
                RngOrigin.DEMOGRAPHICS);
        assertInheritedInvestorChecksSaleBeforeListing(
                RngFactory.create(SEED, RngMode.PHILOX_HOUSEHOLD)
                        .constructionContext(SIMULATION, TIME_STEP),
                RngOrigin.CONSTRUCTION);
    }

    private void assertInheritedInvestorChecksSaleBeforeListing(
            RngContext context, RngOrigin expectedOrigin) throws Exception {
        Household investor = new Household(creationContext, 45.0);
        setPropertyInvestor(investor, true);
        addOwnedHome(investor);
        addOwnedInvestmentHouse(investor);

        House inherited = new House(0);
        inherited.owner = new CapturingForeignOwner();
        investor.inheritHouse(inherited, SALE_BASE, context);

        assertNull(inherited.getSaleRecord());
        assertNotNull(inherited.getRentalRecord());
        assertRawEquals(RENT_PDF.nextDouble(new MersenneTwister(SEED)) * RENT_BASE,
                inherited.getRentalRecord().getPrice());
        assertEquals(expectedOrigin, context.origin());
    }

    private Household homeowner(double age) throws Exception {
        Household household = new Household(creationContext, age);
        setPropertyInvestor(household, false);
        addOwnedHome(household);
        return household;
    }

    private static House addOwnedHome(Household owner) throws Exception {
        House home = addOwnedHouse(owner, false);
        home.resident = owner;
        setHouseholdField(owner, "home", home);
        return home;
    }

    private static House addOwnedInvestmentHouse(Household owner) {
        return addOwnedHouse(owner, true);
    }

    private static House addOwnedHouse(Household owner, boolean buyToLet) {
        House house = new House(0);
        house.owner = owner;
        MortgageAgreement mortgage = new MortgageAgreement(owner, buyToLet);
        mortgage.nPayments = 0;
        mortgage.monthlyPayment = 0.0;
        mortgage.principal = 0.0;
        mortgage.monthlyInterestRate = 0.0;
        mortgage.purchasePrice = SALE_BASE;
        owner.getHousePayments().put(house, mortgage);
        return house;
    }

    private static RentalAgreement installTenancy(Household landlord, Household tenant,
            House house, double rent) throws Exception {
        RentalAgreement agreement = new RentalAgreement();
        agreement.monthlyPayment = rent;
        agreement.nPayments = 6;
        tenant.getHousePayments().put(house, agreement);
        house.resident = tenant;
        setHouseholdField(tenant, "home", house);
        landlord.completeHouseLet(new HouseOfferRecord(house, rent, false, 0), agreement);
        return agreement;
    }

    private static void invokeManageHouse(Household household, House house, RngContext context)
            throws Exception {
        Method method = Household.class.getDeclaredMethod(
                "manageHouse", House.class, RngContext.class);
        method.setAccessible(true);
        method.invoke(household, house, context);
    }

    private static void invokeEndTenancy(Household household, RngContext context)
            throws Exception {
        Method method = Household.class.getDeclaredMethod("endTenancy", RngContext.class);
        method.setAccessible(true);
        method.invoke(household, context);
    }

    private static double addressedMarkup(
            House house, RandomEvent event, int episode, Pdf pdf) {
        double uniform = new PhiloxAddressedRandom().uniform(
                SEED, SIMULATION, TIME_STEP, house.id, event.id(), episode);
        return pdf.sample(uniform);
    }

    private static void setPropertyInvestor(Household household, boolean value)
            throws Exception {
        Field field = HouseholdBehaviour.class.getDeclaredField("BTLInvestor");
        field.setAccessible(true);
        field.setBoolean(household.behaviour, value);
    }

    private static void setHouseholdField(Household household, String name, Object value)
            throws Exception {
        Field field = Household.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(household, value);
    }

    private static void setBehaviourStatic(String name, Object value) throws Exception {
        Field field = HouseholdBehaviour.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(null, value);
    }

    private static void assertRawEquals(double expected, double actual) {
        assertEquals(Double.doubleToRawLongBits(expected), Double.doubleToRawLongBits(actual));
    }

    private static final class CapturingLandlord extends Household {
        private RngContext receivedContext;
        private PaymentAgreement receivedContract;

        private CapturingLandlord(RngContext creationContext, double age) {
            super(creationContext, age);
        }

        @Override
        public void endOfLettingAgreement(
                House house, PaymentAgreement contract, RngContext context) {
            receivedContext = context;
            receivedContract = contract;
            super.endOfLettingAgreement(house, contract, context);
        }
    }

    private static final class CapturingForeignOwner implements IHouseOwner {
        private RngContext receivedContext;
        private PaymentAgreement receivedContract;

        @Override
        public void completeHouseSale(HouseOfferRecord saleRecord) { }

        @Override
        public void endOfLettingAgreement(
                House house, PaymentAgreement contract, RngContext context) {
            receivedContext = context;
            receivedContract = contract;
        }

        @Override
        public void completeHouseLet(
                HouseOfferRecord saleRecord, RentalAgreement rentalAgreement) { }
    }

    private static final class FixedHousingMarketStats extends HousingMarketStats {
        private final double salePrice;

        private FixedHousingMarketStats(double salePrice) {
            super(null, 1);
            this.salePrice = salePrice;
        }

        @Override
        public double getExpAvSalePriceForQuality(int quality) {
            return salePrice;
        }

        @Override
        public void recordTransaction(HouseBidderRecord purchase, HouseOfferRecord sale) { }
    }

    private static final class FixedRentalMarketStats extends RentalMarketStats {
        private final double rentPrice;

        private FixedRentalMarketStats(HousingMarketStats housingMarketStats, double rentPrice) {
            super(housingMarketStats, null, 1);
            this.rentPrice = rentPrice;
        }

        @Override
        public double getAvFlowYieldForQuality(int quality) {
            return 0.05;
        }

        @Override
        public double getAvOccupancyForQuality(int quality) {
            return 1.0;
        }

        @Override
        public double getExpAvFlowYield() {
            return 0.05;
        }

        @Override
        public double getExpAvSalePriceForQuality(int quality) {
            return rentPrice;
        }
    }
}
