package housing;

import org.junit.jupiter.api.Test;

import java.nio.file.Paths;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RandomAddressV1Test {

    @Test
    void fixedAddressesMapToExactKeyAndCounterTuples() {
        assertEncoding(
                0x0123456789abcdefL,
                0x2345, 0x12345678, 0x89abcdef, 0xabcd, 0xef01,
                0x89abcdef, 0x01234567,
                0x00012345, 0x12345678, 0x89abcdef, 0xabcdef01);

        assertEncoding(
                0xffffffffffffffffL,
                0xffff, Integer.MAX_VALUE, 0x80000000, 0xffff, 0xffff,
                0xffffffff, 0xffffffff,
                0x0001ffff, Integer.MAX_VALUE, 0x80000000, 0xffffffff);
    }

    @Test
    void reportingSimulationIsConvertedExactlyOnceToZeroBasedAddressing() {
        assertAll(
                () -> assertEquals(0, RandomAddressV1.fromReportingSimulation(1)),
                () -> assertEquals(1, RandomAddressV1.fromReportingSimulation(2)),
                () -> assertEquals(0xffff,
                        RandomAddressV1.fromReportingSimulation(
                                RandomAddressV1.MAX_REPORTING_SIMULATION)),
                () -> assertEquals(0x00010000,
                        RandomAddressV1.counter0(RandomAddressV1.fromReportingSimulation(1))),
                () -> assertEquals(0x00010001,
                        RandomAddressV1.counter0(RandomAddressV1.fromReportingSimulation(2))));
    }

    @Test
    void explicitTimeStepCoversZeroOneAndConfiguredFinalStep() {
        Config config = new Config(Paths.get("src/main/resources/config.properties")
                .toAbsolutePath().toString());

        assertAll(
                () -> assertEquals(0, RandomAddressV1.counter1(0)),
                () -> assertEquals(1, RandomAddressV1.counter1(1)),
                () -> assertEquals(config.N_STEPS, RandomAddressV1.counter1(config.N_STEPS)));
    }

    @Test
    void secondSimulationInitializationCannotInheritStaleGlobalTime() {
        int previousTimeStep = Model.t;
        try {
            Model.t = Integer.MAX_VALUE;
            int simulation = RandomAddressV1.fromReportingSimulation(2);
            int explicitInitializationTimeStep = 0;

            assertAll(
                    () -> assertEquals(0x00010001, RandomAddressV1.counter0(simulation)),
                    () -> assertEquals(0,
                            RandomAddressV1.counter1(explicitInitializationTimeStep)),
                    () -> assertNotEquals(Model.t,
                            RandomAddressV1.counter1(explicitInitializationTimeStep)));
        } finally {
            Model.t = previousTimeStep;
        }
    }

    @Test
    void entityUsesTheCompleteUnsignedThirtyTwoBitField() {
        assertAll(
                () -> assertEquals(0x00000000, RandomAddressV1.counter2(0x00000000)),
                () -> assertEquals(0x7fffffff, RandomAddressV1.counter2(0x7fffffff)),
                () -> assertEquals(0x80000000, RandomAddressV1.counter2(0x80000000)),
                () -> assertEquals(0xffffffff, RandomAddressV1.counter2(0xffffffff)),
                () -> assertEquals(0x80000000L,
                        Integer.toUnsignedLong(RandomAddressV1.counter2(0x80000000))),
                () -> assertEquals(0xffffffffL,
                        Integer.toUnsignedLong(RandomAddressV1.counter2(0xffffffff))));
    }

    @Test
    void fieldBoundariesDoNotOverlap() {
        assertAll(
                () -> assertEquals(0x00010000, RandomAddressV1.counter0(0)),
                () -> assertEquals(0x0001ffff, RandomAddressV1.counter0(0xffff)),
                () -> assertEquals(RandomAddressV1.VERSION,
                        RandomAddressV1.counter0(0xffff) >>> 16),
                () -> assertEquals(0xffff,
                        RandomAddressV1.counter0(0xffff) & RandomAddressV1.MAX_UNSIGNED_16),
                () -> assertEquals(0x0000ffff, RandomAddressV1.counter3(0, 0xffff)),
                () -> assertEquals(0x00010000, RandomAddressV1.counter3(1, 0)),
                () -> assertEquals(0xffff0000, RandomAddressV1.counter3(0xffff, 0)),
                () -> assertEquals(0xffffffff, RandomAddressV1.counter3(0xffff, 0xffff)));
    }

    @Test
    void listingEpisodeOccupiesTheSubcounterFieldDirectly() {
        assertAll(
                () -> assertEquals(0x20050000,
                        RandomAddressV1.counter3(RandomEvent.SALE_LIST_MARKUP.id(), 0)),
                () -> assertEquals(0x20050001,
                        RandomAddressV1.counter3(RandomEvent.SALE_LIST_MARKUP.id(), 1)),
                () -> assertEquals(0x2006ffff,
                        RandomAddressV1.counter3(RandomEvent.RENT_LIST_MARKUP.id(), 0xffff)),
                () -> assertThrows(IllegalArgumentException.class,
                        () -> RandomAddressV1.counter3(
                                RandomEvent.RENT_LIST_MARKUP.id(), 0x10000)));
    }

    @Test
    void outOfRangeFieldsAreRejectedInsteadOfTruncated() {
        assertAll(
                () -> assertThrows(IllegalArgumentException.class,
                        () -> RandomAddressV1.fromReportingSimulation(0)),
                () -> assertThrows(IllegalArgumentException.class,
                        () -> RandomAddressV1.fromReportingSimulation(
                                RandomAddressV1.MAX_REPORTING_SIMULATION + 1)),
                () -> assertThrows(IllegalArgumentException.class,
                        () -> RandomAddressV1.counter0(-1)),
                () -> assertThrows(IllegalArgumentException.class,
                        () -> RandomAddressV1.counter0(0x10000)),
                () -> assertThrows(IllegalArgumentException.class,
                        () -> RandomAddressV1.counter1(-1)),
                () -> assertThrows(IllegalArgumentException.class,
                        () -> RandomAddressV1.counter3(-1, 0)),
                () -> assertThrows(IllegalArgumentException.class,
                        () -> RandomAddressV1.counter3(0x10000, 0)),
                () -> assertThrows(IllegalArgumentException.class,
                        () -> RandomAddressV1.counter3(0, -1)),
                () -> assertThrows(IllegalArgumentException.class,
                        () -> RandomAddressV1.counter3(0, 0x10000)));
    }

    @Test
    void logicalTupleGridEncodesInjectively() {
        long[] seeds = {
                0L, 1L, 0x0000000100000000L, 0x8000000000000000L, 0xffffffffffffffffL
        };
        int[] simulations = {0, 1, 0x7fff, 0xffff};
        int[] timeSteps = {0, 1, 2_000, Integer.MAX_VALUE};
        int[] entities = {0, 1, Integer.MAX_VALUE, Integer.MIN_VALUE, -1};
        int[] events = {0, 1, 0x3002, 0xffff};
        int[] subcounters = {0, 1, 0x8000, 0xffff};
        Set<EncodedTuple> encoded = new HashSet<>();

        for (long seed : seeds) {
            for (int simulation : simulations) {
                for (int timeStep : timeSteps) {
                    for (int entity : entities) {
                        for (int event : events) {
                            for (int subcounter : subcounters) {
                                assertTrue(encoded.add(encode(seed, simulation, timeStep, entity,
                                        event, subcounter)), "address collision");
                            }
                        }
                    }
                }
            }
        }

        int expected = seeds.length * simulations.length * timeSteps.length * entities.length
                * events.length * subcounters.length;
        assertEquals(expected, encoded.size());
    }

    @Test
    void addressedSimulationDoesNotInheritLegacySimulationSeedCollision() {
        EncodedTuple seed42Simulation2 = encode(42L,
                RandomAddressV1.fromReportingSimulation(2), 0, 1, 0x0001, 0);
        EncodedTuple seed43Simulation1 = encode(43L,
                RandomAddressV1.fromReportingSimulation(1), 0, 1, 0x0001, 0);

        assertEquals(Model.simulationSeed(42, 2), Model.simulationSeed(43, 1));
        assertNotEquals(seed42Simulation2, seed43Simulation1);
    }

    private static void assertEncoding(long seed,
                                       int simulation, int timeStep, int entity,
                                       int event, int subcounter,
                                       int key0, int key1,
                                       int counter0, int counter1, int counter2, int counter3) {
        assertEquals(new EncodedTuple(key0, key1, counter0, counter1, counter2, counter3),
                encode(seed, simulation, timeStep, entity, event, subcounter));
    }

    private static EncodedTuple encode(long seed,
                                       int simulation, int timeStep, int entity,
                                       int event, int subcounter) {
        return new EncodedTuple(
                RandomAddressV1.key0(seed),
                RandomAddressV1.key1(seed),
                RandomAddressV1.counter0(simulation),
                RandomAddressV1.counter1(timeStep),
                RandomAddressV1.counter2(entity),
                RandomAddressV1.counter3(event, subcounter));
    }

    private record EncodedTuple(int key0, int key1,
                                int counter0, int counter1, int counter2, int counter3) { }
}
