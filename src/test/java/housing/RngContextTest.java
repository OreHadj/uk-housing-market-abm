package housing;

import org.apache.commons.math3.distribution.GeometricDistribution;
import org.apache.commons.math3.random.MersenneTwister;
import org.junit.jupiter.api.Test;

import utilities.Pdf;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class RngContextTest {

    @Test
    void mixedContextSequenceIsRawBitExactWithCommonsMersenne() {
        int seed = 9087;
        RandomService service = RngFactory.create(seed, RngMode.MERSENNE);
        RngContext householdContext = service.householdLoopContext(3, 41);
        RngContext saleContext = service.saleClearingContext(3, 41);
        House house = new House(0);
        Pdf pdf = new Pdf(0.0, 1.0, ignored -> 1.0, 257);
        MersenneTwister expected = new MersenneTwister(seed);

        assertRawEquals(expected.nextDouble(),
                householdContext.uniform(house, RandomEvent.SALE_REPRICE, 0));
        assertRawEquals(expected.nextGaussian(),
                householdContext.normal(house, RandomEvent.SALE_REPRICE, 1));
        assertEquals(expected.nextInt(37),
                saleContext.boundedInt(house, RandomEvent.SALE_MARKET_TIE_BREAK, 37));
        assertRawEquals(pdf.nextDouble(expected), householdContext.empiricalPdf(
                house, RandomEvent.SALE_LIST_MARKUP, 12, pdf));

        // Commons' second Gaussian is the cached partner even though other operation types intervened.
        assertRawEquals(expected.nextGaussian(),
                householdContext.normal(house, RandomEvent.RENT_REPRICE, 1));
        assertEquals(new GeometricDistribution(expected, 0.37).sample(),
                saleContext.geometric(house, RandomEvent.SALE_MARKET_BID_UP, 0.37));

        // Pin the first untouched draw after the complete mixed sequence.
        assertRawEquals(expected.nextDouble(),
                householdContext.uniform(house, RandomEvent.HOME_SELL));
    }

    @Test
    void separatelyCreatedPhaseContextsShareOneExactLegacyStream() {
        int seed = 719;
        RandomService service = RngFactory.create(seed, RngMode.MERSENNE);
        RngContext demographics = service.demographicsContext(0, 9);
        RngContext construction = service.constructionContext(0, 9);
        RngContext householdLoop = service.householdLoopContext(0, 9);
        RngContext saleClearing = service.saleClearingContext(0, 9);
        RngContext rentClearing = service.rentClearingContext(0, 9);
        MersenneTwister expected = new MersenneTwister(seed);
        House.IdReservation houseReservation = House.reserveId();

        assertEquals(RngOrigin.DEMOGRAPHICS, demographics.origin());
        int expectedQuality = (int) (expected.nextDouble() * 11);
        int actualQuality = construction.boundedInt(
                houseReservation, RandomEvent.NEW_BUILD_QUALITY, 11);
        assertEquals(expectedQuality, actualQuality);
        House house = new House(houseReservation, actualQuality);
        assertRawEquals(expected.nextDouble(),
                householdLoop.uniform(house, RandomEvent.HOME_SELL));
        assertEquals(new GeometricDistribution(expected, 0.61).sample(),
                saleClearing.geometric(house, RandomEvent.SALE_MARKET_BID_UP, 0.61));
        assertEquals(expected.nextInt(19), rentClearing.boundedInt(
                house, RandomEvent.RENT_MARKET_TIE_BREAK, 19));
        assertRawEquals(expected.nextDouble(),
                householdLoop.uniform(house, RandomEvent.BTL_SELL));
    }

    @Test
    void invalidOriginEntityKindOperationAndSubcounterFailLoudly() {
        RandomService service = RngFactory.create(1, RngMode.MERSENNE);
        RngContext demographics = service.demographicsContext(0, 0);
        RngContext householdLoop = service.householdLoopContext(0, 0);
        RngContext saleClearing = service.saleClearingContext(0, 0);
        House house = new House(0);

        assertThrows(IllegalArgumentException.class,
                () -> saleClearing.uniform(house, RandomEvent.HOME_SELL));
        assertThrows(IllegalArgumentException.class,
                () -> demographics.uniform(house, RandomEvent.HH_DEATH));
        assertThrows(IllegalArgumentException.class,
                () -> householdLoop.normal(house, RandomEvent.HOME_SELL));
        assertThrows(IllegalArgumentException.class,
                () -> householdLoop.uniform(house, RandomEvent.HOME_SELL, 1));
        assertThrows(IllegalArgumentException.class,
                () -> householdLoop.uniform(house, RandomEvent.SALE_REPRICE, 2));
        assertThrows(IllegalArgumentException.class,
                () -> householdLoop.uniform(house, RandomEvent.SALE_REPRICE, 1));
        assertThrows(IllegalArgumentException.class,
                () -> householdLoop.normal(house, RandomEvent.SALE_REPRICE, 0));
        assertThrows(IllegalArgumentException.class,
                () -> householdLoop.empiricalPdf(house, RandomEvent.SALE_LIST_MARKUP,
                        RandomAddressV1.MAX_UNSIGNED_16 + 1,
                        new Pdf(0.0, 1.0, ignored -> 1.0, 17)));
        assertThrows(IllegalArgumentException.class,
                () -> saleClearing.boundedInt(
                        house, RandomEvent.SALE_MARKET_BID_UP, 7));
    }

    @Test
    void contextCoordinatesAreExplicitAndValidated() {
        RandomService service = RngFactory.create(1, RngMode.MERSENNE);
        RngContext context = service.householdLoopContext(7, 2_000);

        assertEquals(RngOrigin.HOUSEHOLD_LOOP, context.origin());
        assertEquals(7, context.simulation());
        assertEquals(2_000, context.timeStep());
        assertThrows(IllegalArgumentException.class,
                () -> service.householdLoopContext(-1, 0));
        assertThrows(IllegalArgumentException.class,
                () -> service.householdLoopContext(0, -1));
    }

    @Test
    void addressedModesEnforceTheVersionOneSimulationLimitBeforeContextUse() {
        int lastValid = RandomAddressV1.MAX_UNSIGNED_16;
        int firstInvalid = lastValid + 1;

        for (RngMode mode : new RngMode[] {
                RngMode.PHILOX_HOUSEHOLD, RngMode.PHILOX }) {
            RandomService service = RngFactory.create(1, mode);
            RngContext context = service.householdLoopContext(lastValid, 0);

            assertEquals(lastValid, context.simulation(), mode.name());
            assertThrows(IllegalArgumentException.class,
                    () -> service.householdLoopContext(firstInvalid, 0), mode.name());
        }
    }

    @Test
    void mersenneRetainsLegacySimulationRangeWhileRejectingNegativeIdentities() {
        RandomService service = RngFactory.create(1, RngMode.MERSENNE);
        int beyondAddressV1 = RandomAddressV1.MAX_UNSIGNED_16 + 1;

        assertEquals(beyondAddressV1,
                service.householdLoopContext(beyondAddressV1, 0).simulation());
        assertEquals(RandomAddressV1.MAX_REPORTING_SIMULATION,
                service.simulationIndex(RandomAddressV1.MAX_REPORTING_SIMULATION + 1));
        assertThrows(IllegalArgumentException.class,
                () -> service.householdLoopContext(-1, 0));
        assertThrows(IllegalArgumentException.class, () -> service.simulationIndex(0));
    }

    @Test
    void reportingSimulationBoundaryIsModeDependent() {
        int lastValidReporting = RandomAddressV1.MAX_REPORTING_SIMULATION;
        int firstInvalidReporting = lastValidReporting + 1;

        assertEquals(RandomAddressV1.MAX_UNSIGNED_16,
                RngFactory.create(1, RngMode.PHILOX_HOUSEHOLD)
                        .simulationIndex(lastValidReporting));
        assertEquals(RandomAddressV1.MAX_UNSIGNED_16,
                RngFactory.create(1, RngMode.PHILOX)
                        .simulationIndex(lastValidReporting));
        assertThrows(IllegalArgumentException.class,
                () -> RngFactory.create(1, RngMode.PHILOX_HOUSEHOLD)
                        .simulationIndex(firstInvalidReporting));
        assertThrows(IllegalArgumentException.class,
                () -> RngFactory.create(1, RngMode.PHILOX)
                        .simulationIndex(firstInvalidReporting));
        assertEquals(RandomAddressV1.MAX_REPORTING_SIMULATION,
                RngFactory.create(1, RngMode.MERSENNE)
                        .simulationIndex(firstInvalidReporting));
    }

    private static void assertRawEquals(double expected, double actual) {
        assertEquals(Double.doubleToRawLongBits(expected), Double.doubleToRawLongBits(actual));
    }
}
