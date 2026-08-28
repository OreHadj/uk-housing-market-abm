package housing;

import java.nio.file.Path;
import java.util.Comparator;
import java.util.Set;

import org.apache.commons.math3.distribution.GeometricDistribution;
import org.apache.commons.math3.random.MersenneTwister;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import utilities.Pdf;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** Production-path proof of the total {@code (mode, origin, event)} routing policy. */
class RandomServiceRoutingTest {

    private static final String CONFIG_PATH = "src/main/resources/config.properties";
    private static final int SEED = 0x13579bdf;
    private static final int SIMULATION = 37;
    private static final int TIME_STEP = 991;
    private static final int BOUND = 37;
    private static final double GEOMETRIC_P = 0.37;
    private static final Pdf PDF = new Pdf(0.0, 1.0, ignored -> 1.0, 257);

    /** Complete Step 9 route manifest; kept explicit so later route changes remain reviewable. */
    private static final Set<Route> MIGRATED_HYBRID_ROUTES = Set.of(
            new Route(RngOrigin.HOUSEHOLD_LOOP, RandomEvent.HH_DESIRED_PURCHASE),
            new Route(RngOrigin.HOUSEHOLD_LOOP, RandomEvent.HH_DESIRED_RENT),
            new Route(RngOrigin.HOUSEHOLD_LOOP, RandomEvent.BTL_DOWNPAYMENT),
            new Route(RngOrigin.HOUSEHOLD_LOOP, RandomEvent.HOME_SELL),
            new Route(RngOrigin.HOUSEHOLD_LOOP, RandomEvent.BTL_SELL),
            new Route(RngOrigin.HOUSEHOLD_LOOP, RandomEvent.SALE_REPRICE),
            new Route(RngOrigin.HOUSEHOLD_LOOP, RandomEvent.RENT_REPRICE),
            new Route(RngOrigin.HOUSEHOLD_LOOP, RandomEvent.SALE_LIST_MARKUP),
            new Route(RngOrigin.HOUSEHOLD_LOOP, RandomEvent.RENT_LIST_MARKUP),
            new Route(RngOrigin.HOUSEHOLD_LOOP, RandomEvent.RENT_OR_BUY),
            new Route(RngOrigin.HOUSEHOLD_LOOP, RandomEvent.BTL_BUY));

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
        new House(0);
        house = new House(4);
    }

    @Test
    void everySupportedModeOriginEventOperationUsesThePinnedBackend() {
        for (RngMode mode : RngMode.values()) {
            for (RandomEvent event : RandomEvent.values()) {
                for (RngOrigin origin : event.validOrigins()) {
                    for (RngOperation operation : event.permittedOperations()) {
                        assertProductionDraw(mode, origin, event, operation);
                    }
                }
            }
        }
    }

    @Test
    void desiredPurchaseNormalPinsTheCompleteServiceToTransformChain() {
        RandomService service = RngFactory.create(SEED, RngMode.PHILOX_HOUSEHOLD);
        double actual = service.householdLoopContext(SIMULATION, TIME_STEP)
                .normal(household, RandomEvent.HH_DESIRED_PURCHASE);

        assertEquals(0xbff1e2a387ab77d5L, Double.doubleToRawLongBits(actual));
    }

    @Test
    void everyUnsupportedOriginFailsThroughTheProductionContext() {
        for (RngMode mode : RngMode.values()) {
            for (RandomEvent event : RandomEvent.values()) {
                RngOperation operation = event.permittedOperations().stream()
                        .min(Comparator.comparingInt(Enum::ordinal))
                        .orElseThrow();
                for (RngOrigin origin : RngOrigin.values()) {
                    if (!event.validOrigins().contains(origin)) {
                        RandomService service = RngFactory.create(SEED, mode);
                        RngContext context = context(service, origin);
                        assertThrows(IllegalArgumentException.class,
                                () -> invoke(context, event, operation),
                                mode + "/" + origin + "/" + event + "/" + operation);
                    }
                }
            }
        }
    }

    @Test
    void invalidEntityKindOperationAndSubcounterFailInEveryMode() {
        for (RngMode mode : RngMode.values()) {
            RngContext context = RngFactory.create(SEED, mode)
                    .householdLoopContext(SIMULATION, TIME_STEP);

            assertThrows(IllegalArgumentException.class,
                    () -> context.uniform(house, RandomEvent.RENT_OR_BUY), mode.name());
            assertThrows(IllegalArgumentException.class,
                    () -> context.uniform(household, RandomEvent.HOME_SELL), mode.name());
            assertThrows(IllegalArgumentException.class,
                    () -> context.normal(household, RandomEvent.RENT_OR_BUY), mode.name());
            assertThrows(IllegalArgumentException.class,
                    () -> context.uniform(house, RandomEvent.HOME_SELL, 1), mode.name());
            assertThrows(IllegalArgumentException.class,
                    () -> context.uniform(house, RandomEvent.SALE_REPRICE, 1), mode.name());
            assertThrows(IllegalArgumentException.class,
                    () -> context.normal(house, RandomEvent.SALE_REPRICE, 0), mode.name());
        }
    }

    @Test
    void mixedOriginMarkupRoutesUseOnlyTheApprovedHybridBackend() {
        for (RngMode mode : new RngMode[] {RngMode.MERSENNE, RngMode.PHILOX_HOUSEHOLD}) {
            for (RandomEvent event : new RandomEvent[] {
                    RandomEvent.SALE_LIST_MARKUP, RandomEvent.RENT_LIST_MARKUP}) {
                for (RngOrigin origin : event.validOrigins()) {
                    assertProductionDraw(mode, origin, event, RngOperation.EMPIRICAL_PDF);
                }
            }
        }
    }

    @Test
    void tenancyLengthAndEveryDeferredRouteRemainMersenneInHybridMode() {
        for (RandomEvent event : RandomEvent.values()) {
            for (RngOrigin origin : event.validOrigins()) {
                if (!MIGRATED_HYBRID_ROUTES.contains(new Route(origin, event))) {
                    for (RngOperation operation : event.permittedOperations()) {
                        assertProductionDraw(
                                RngMode.PHILOX_HOUSEHOLD, origin, event, operation);
                    }
                }
            }
        }
    }

    private void assertProductionDraw(RngMode mode, RngOrigin origin, RandomEvent event,
            RngOperation operation) {
        RandomService service = RngFactory.create(SEED, mode);
        RngContext context = context(service, origin);
        Object actual = invoke(context, event, operation);
        RngBackend expectedBackend = expectedBackend(mode, origin, event);
        Object expected = expectedBackend == RngBackend.MERSENNE
                ? expectedMersenne(event, operation)
                : expectedPhilox(event, operation);
        String route = mode + "/" + origin + "/" + event + "/" + operation;

        if (actual instanceof Double actualDouble) {
            assertEquals(Double.doubleToRawLongBits((double) expected),
                    Double.doubleToRawLongBits(actualDouble), route);
        } else {
            assertEquals(expected, actual, route);
        }
    }

    private Object invoke(RngContext context, RandomEvent event, RngOperation operation) {
        return switch (operation) {
            case UNIFORM -> event.entityKind() == EntityKind.HOUSEHOLD
                    ? context.uniform(household, event, uniformSubcounter(event))
                    : context.uniform(house, event, uniformSubcounter(event));
            case NORMAL -> event.entityKind() == EntityKind.HOUSEHOLD
                    ? context.normal(household, event, normalSubcounter(event))
                    : context.normal(house, event, normalSubcounter(event));
            case BOUNDED_INT -> event.entityKind() == EntityKind.HOUSEHOLD
                    ? context.boundedInt(household, event, BOUND)
                    : context.boundedInt(house, event, BOUND);
            case EMPIRICAL_PDF -> context.empiricalPdf(house, event, 13, PDF);
            case GEOMETRIC -> context.geometric(house, event, GEOMETRIC_P);
        };
    }

    private Object expectedMersenne(RandomEvent event, RngOperation operation) {
        MersenneTwister random = new MersenneTwister(SEED);
        return switch (operation) {
            case UNIFORM -> random.nextDouble();
            case NORMAL -> random.nextGaussian();
            case BOUNDED_INT -> event.legacyConsumptionPolicy()
                    == LegacyConsumptionPolicy.FLOOR_OF_UNIFORM_BOUNDED
                            ? (int) (random.nextDouble() * BOUND)
                            : random.nextInt(BOUND);
            case EMPIRICAL_PDF -> PDF.nextDouble(random);
            case GEOMETRIC -> new GeometricDistribution(random, GEOMETRIC_P).sample();
        };
    }

    private Object expectedPhilox(RandomEvent event, RngOperation operation) {
        PhiloxAddressedRandom random = new PhiloxAddressedRandom();
        int entityId = event.entityKind() == EntityKind.HOUSEHOLD ? household.id : house.id;
        return switch (operation) {
            case UNIFORM -> random.uniform(SEED, SIMULATION, TIME_STEP, entityId,
                    event.id(), uniformSubcounter(event));
            case NORMAL -> random.normal(SEED, SIMULATION, TIME_STEP, entityId,
                    event.id(), normalSubcounter(event));
            case BOUNDED_INT -> random.boundedInt(SEED, SIMULATION, TIME_STEP, entityId,
                    event.id(), 0, BOUND);
            case EMPIRICAL_PDF -> PDF.sample(random.uniform(SEED, SIMULATION, TIME_STEP,
                    entityId, event.id(), 13));
            case GEOMETRIC -> GeometricInverseCdf.sample(GEOMETRIC_P,
                    random.uniform(SEED, SIMULATION, TIME_STEP, entityId, event.id(), 0));
        };
    }

    private static RngBackend expectedBackend(
            RngMode mode, RngOrigin origin, RandomEvent event) {
        return switch (mode) {
            case MERSENNE -> RngBackend.MERSENNE;
            case PHILOX_HOUSEHOLD -> MIGRATED_HYBRID_ROUTES.contains(new Route(origin, event))
                    ? RngBackend.PHILOX : RngBackend.MERSENNE;
            case PHILOX -> RngBackend.PHILOX;
        };
    }

    private static int uniformSubcounter(RandomEvent event) {
        return event.subcounterPolicy() == SubcounterPolicy.FIXED_TWO ? 0 : 0;
    }

    private static int normalSubcounter(RandomEvent event) {
        return event.subcounterPolicy() == SubcounterPolicy.FIXED_TWO ? 1 : 0;
    }

    private static RngContext context(RandomService service, RngOrigin origin) {
        return switch (origin) {
            case DEMOGRAPHICS -> service.demographicsContext(SIMULATION, TIME_STEP);
            case CONSTRUCTION -> service.constructionContext(SIMULATION, TIME_STEP);
            case HOUSEHOLD_LOOP -> service.householdLoopContext(SIMULATION, TIME_STEP);
            case SALE_CLEARING -> service.saleClearingContext(SIMULATION, TIME_STEP);
            case RENT_CLEARING -> service.rentClearingContext(SIMULATION, TIME_STEP);
        };
    }

    private record Route(RngOrigin origin, RandomEvent event) { }
}
