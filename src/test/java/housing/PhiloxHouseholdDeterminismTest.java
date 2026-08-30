package housing;

import java.lang.reflect.Field;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import utilities.Pdf;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Proofs for addressed evaluation and durable Philox household streams. */
class PhiloxHouseholdDeterminismTest {

    private static final String CONFIG_PATH = "src/main/resources/config.properties";
    private static final int SEED = 0x13579bdf;
    private static final long MASTER_SEED = Integer.toUnsignedLong(SEED);
    private static final int SIMULATION = 37;
    private static final int TIME_STEP = 991;
    private static final Pdf PDF = new Pdf(0.0, 1.0, ignored -> 1.0, 257);

    @TempDir
    Path tempDir;

    private Household household;
    private House house;

    @BeforeEach
    void setUpEntities() {
        new Model(CONFIG_PATH, tempDir.toString() + "/");
        Household.resetIdPoolForNewSimulation();
        House.resetIdPoolForNewSimulation();
        RngContext creation = RngFactory.create(812, RngMode.MERSENNE)
                .demographicsContext(0, 0);
        household = new Household(creation, 37.0);
        house = new House(4);
    }

    @Test
    void completeAddressesAreEvaluationOrderIndependentThroughProductionService() {
        List<AddressedDraw> forwardOrder = List.of(
                draw(RandomEvent.HH_DESIRED_PURCHASE, RngOperation.NORMAL, household.id, 0, 0),
                draw(RandomEvent.HH_DESIRED_RENT, RngOperation.NORMAL, household.id, 0, 1),
                draw(RandomEvent.BTL_DOWNPAYMENT, RngOperation.NORMAL, household.id, 0, 2),
                draw(RandomEvent.RENT_OR_BUY, RngOperation.UNIFORM, household.id, 0, 3),
                draw(RandomEvent.BTL_BUY, RngOperation.UNIFORM, household.id, 0, 4),
                draw(RandomEvent.HOME_SELL, RngOperation.UNIFORM, house.id, 0, 5),
                draw(RandomEvent.BTL_SELL, RngOperation.UNIFORM, house.id, 0, 6),
                draw(RandomEvent.SALE_REPRICE, RngOperation.UNIFORM, house.id, 0, 7),
                draw(RandomEvent.SALE_REPRICE, RngOperation.NORMAL, house.id, 1, 8),
                draw(RandomEvent.RENT_REPRICE, RngOperation.UNIFORM, house.id, 0, 9),
                draw(RandomEvent.RENT_REPRICE, RngOperation.NORMAL, house.id, 1, 10),
                draw(RandomEvent.SALE_LIST_MARKUP, RngOperation.EMPIRICAL_PDF, house.id, 13, 11),
                draw(RandomEvent.RENT_LIST_MARKUP, RngOperation.EMPIRICAL_PDF, house.id, 29, 12));
        ArrayList<AddressedDraw> reverseOrder = new ArrayList<>(forwardOrder);
        Collections.reverse(reverseOrder);
        RandomService service = RngFactory.create(SEED, RngMode.PHILOX_HOUSEHOLD);

        Map<RawAddress, AddressObservation> forward = observe(service, forwardOrder);
        Map<RawAddress, AddressObservation> reverse = observe(service, reverseOrder);

        assertEquals(forwardOrder.size(), forward.size(), "raw addresses must be unique");
        assertEquals(forward.keySet(), reverse.keySet(), "the same address set must be evaluated");
        assertEquals(forward, reverse,
                "Philox words and service transforms must be keyed by address, not position");
    }

    @Test
    void removingAHouseholdDoesNotShiftASurvivorsAddressedStream() {
        RngContext creation = RngFactory.create(913, RngMode.MERSENNE)
                .demographicsContext(0, 0);
        Household removed = new Household(creation, 68.0);
        Household survivor = household;
        Model.households.add(removed);
        Model.households.add(survivor);

        RandomService service = RngFactory.create(SEED, RngMode.PHILOX_HOUSEHOLD);
        RngContext context = service.householdLoopContext(SIMULATION, TIME_STEP);
        int survivorId = survivor.id;
        long survivorBefore = rawBits(
                context.normal(survivor, RandomEvent.HH_DESIRED_PURCHASE));
        long removedValue = rawBits(
                context.normal(removed, RandomEvent.HH_DESIRED_PURCHASE));

        assertEquals(1, Model.households.indexOf(survivor));
        assertTrue(Model.households.remove(removed));
        assertEquals(0, Model.households.indexOf(survivor),
                "the survivor must actually move to a different loop position");

        long survivorAfter = rawBits(
                context.normal(survivor, RandomEvent.HH_DESIRED_PURCHASE));
        assertEquals(survivorId, survivor.id, "the survivor keeps its durable identity");
        assertEquals(survivorBefore, survivorAfter,
                "the same complete survivor address must retain the same value");
        assertNotEquals(removedValue, survivorAfter,
                "the removed household's distinct identity must not alias the survivor");
    }

    @Test
    void liveMonthlyHouseholdPathDoesNotAdvanceTheSharedMersenneStream() throws Exception {
        initialiseMonthlyHouseholdState();
        RngContext creation = RngFactory.create(914, RngMode.MERSENNE)
                .demographicsContext(0, 0);
        Household investor = new Household(creation, 41.0);
        setField(investor.behaviour, "BTLInvestor", true);
        setField(investor, "isFirstTimeBuyer", false);
        Model.households.add(investor);

        RandomService exercised = RngFactory.create(SEED, RngMode.PHILOX_HOUSEHOLD);
        RandomService untouched = RngFactory.create(SEED, RngMode.PHILOX_HOUSEHOLD);
        investor.step(exercised.householdLoopContext(SIMULATION, TIME_STEP));

        assertEquals(1, Model.houseSaleMarket.getBids().size(),
                "the forced investor must traverse the live monthly housing-decision path");
        long expectedNextLegacy = rawBits(untouched.demographicsContext(SIMULATION, TIME_STEP)
                .uniform(investor, RandomEvent.HH_DEATH));
        long actualNextLegacy = rawBits(exercised.demographicsContext(SIMULATION, TIME_STEP)
                .uniform(investor, RandomEvent.HH_DEATH));
        assertEquals(expectedNextLegacy, actualNextLegacy,
                "a live HOUSEHOLD_LOOP draw escaped to the shared Mersenne stream; "
                        + "keep dormant HH_ALT_DESIRED_PURCHASE and BTL_TARGET_LTV unwired "
                        + "until they have approved Philox routes");
    }

    private static void initialiseMonthlyHouseholdState() throws Exception {
        Model.houseSaleMarket.init();
        Model.houseRentalMarket.init();
        Model.centralBank.init();
        Model.bank.init();
        Model.householdStats.init();
        Model.housingMarketStats.init();
        Model.rentalMarketStats.init();
        setStaticField(HouseholdBehaviour.class, "config", Model.config);
        setStaticField(HouseholdBehaviour.class, "housingMarketStats", Model.housingMarketStats);
        setStaticField(HouseholdBehaviour.class, "rentalMarketStats", Model.rentalMarketStats);
    }

    private static void setField(Object target, String fieldName, Object value) throws Exception {
        Field field = target.getClass().getDeclaredField(fieldName);
        field.setAccessible(true);
        field.set(target, value);
    }

    private static void setStaticField(Class<?> target, String fieldName, Object value)
            throws Exception {
        Field field = target.getDeclaredField(fieldName);
        field.setAccessible(true);
        field.set(null, value);
    }

    private AddressedDraw draw(RandomEvent event, RngOperation operation, int entity,
            int subcounter, int offset) {
        return new AddressedDraw(
                new RawAddress(MASTER_SEED, SIMULATION + offset, TIME_STEP + offset,
                        entity, event.id(), subcounter),
                event,
                operation);
    }

    private Map<RawAddress, AddressObservation> observe(
            RandomService service, List<AddressedDraw> draws) {
        Map<RawAddress, AddressObservation> observations = new LinkedHashMap<>();
        PhiloxAddressedRandom addressed = new PhiloxAddressedRandom();

        for (AddressedDraw draw : draws) {
            RawAddress address = draw.address();
            assertEquals(MASTER_SEED, address.seed());
            assertEquals(draw.event().id(), address.event());
            assertEquals(draw.event().entityKind() == EntityKind.HOUSEHOLD
                    ? household.id : house.id, address.entity());

            RngContext context = service.householdLoopContext(
                    address.simulation(), address.timeStep());
            double serviceValue = invoke(context, draw);
            double directValue = invoke(addressed, draw);
            assertEquals(rawBits(directValue), rawBits(serviceValue), address.toString());

            AddressObservation observation = new AddressObservation(
                    words01(address), words23(address), rawBits(serviceValue));
            assertTrue(observations.put(address, observation) == null,
                    "duplicate raw address: " + address);
        }
        return observations;
    }

    private double invoke(RngContext context, AddressedDraw draw) {
        return switch (draw.operation()) {
            case UNIFORM -> draw.event().entityKind() == EntityKind.HOUSEHOLD
                    ? context.uniform(household, draw.event(), draw.address().subcounter())
                    : context.uniform(house, draw.event(), draw.address().subcounter());
            case NORMAL -> draw.event().entityKind() == EntityKind.HOUSEHOLD
                    ? context.normal(household, draw.event(), draw.address().subcounter())
                    : context.normal(house, draw.event(), draw.address().subcounter());
            case EMPIRICAL_PDF -> context.empiricalPdf(
                    house, draw.event(), draw.address().subcounter(), PDF);
            case BOUNDED_INT, GEOMETRIC -> throw new AssertionError(
                    "household Philox route is not a double transform: " + draw);
        };
    }

    private static double invoke(PhiloxAddressedRandom addressed, AddressedDraw draw) {
        RawAddress address = draw.address();
        return switch (draw.operation()) {
            case UNIFORM -> addressed.uniform(address.seed(), address.simulation(),
                    address.timeStep(), address.entity(), address.event(), address.subcounter());
            case NORMAL -> addressed.normal(address.seed(), address.simulation(),
                    address.timeStep(), address.entity(), address.event(), address.subcounter());
            case EMPIRICAL_PDF -> PDF.sample(addressed.uniform(address.seed(),
                    address.simulation(), address.timeStep(), address.entity(), address.event(),
                    address.subcounter()));
            case BOUNDED_INT, GEOMETRIC -> throw new AssertionError(
                    "household Philox route is not a double transform: " + draw);
        };
    }

    private static long words01(RawAddress address) {
        return Philox4x32.words01(
                RandomAddressV1.counter0(address.simulation()),
                RandomAddressV1.counter1(address.timeStep()),
                RandomAddressV1.counter2(address.entity()),
                RandomAddressV1.counter3(address.event(), address.subcounter()),
                RandomAddressV1.key0(address.seed()),
                RandomAddressV1.key1(address.seed()));
    }

    private static long words23(RawAddress address) {
        return Philox4x32.words23(
                RandomAddressV1.counter0(address.simulation()),
                RandomAddressV1.counter1(address.timeStep()),
                RandomAddressV1.counter2(address.entity()),
                RandomAddressV1.counter3(address.event(), address.subcounter()),
                RandomAddressV1.key0(address.seed()),
                RandomAddressV1.key1(address.seed()));
    }

    private static long rawBits(double value) {
        return Double.doubleToRawLongBits(value);
    }

    private record AddressedDraw(
            RawAddress address, RandomEvent event, RngOperation operation) { }

    private record RawAddress(
            long seed,
            int simulation,
            int timeStep,
            int entity,
            int event,
            int subcounter) { }

    private record AddressObservation(long words01, long words23, long transformedBits) { }
}
