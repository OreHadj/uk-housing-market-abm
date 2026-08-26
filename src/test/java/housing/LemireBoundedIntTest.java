package housing;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LemireBoundedIntTest {

    private static final long SEED = 0x0123456789abcdefL;
    private static final int SIMULATION = 0;
    private static final int TIME_STEP = 42;
    private static final int EVENT = 0x5001;
    private static final int FORCED_REJECTION_BOUND = 0x55555556;
    private static final int STATISTICAL_SAMPLE_SIZE = 131_072;

    private final PhiloxAddressedRandom random = new PhiloxAddressedRandom();

    @Test
    void thresholdsAreExactUnsignedTwoToTheThirtyTwoRemainders() {
        assertAll(
                () -> assertEquals(0, LemireBoundedInt.threshold(1)),
                () -> assertEquals(0, LemireBoundedInt.threshold(2)),
                () -> assertEquals(1, LemireBoundedInt.threshold(3)),
                () -> assertEquals(4, LemireBoundedInt.threshold(7)),
                () -> assertEquals(7_296, LemireBoundedInt.threshold(10_000)),
                () -> assertEquals(2, LemireBoundedInt.threshold(Integer.MAX_VALUE)),
                () -> assertEquals(0x55555554,
                        LemireBoundedInt.threshold(FORCED_REJECTION_BOUND)));
    }

    @Test
    void candidateMultiplicationTreatsAllThirtyTwoBitsAsUnsigned() {
        long maximumProduct = LemireBoundedInt.product(0xffffffff, Integer.MAX_VALUE);

        assertAll(
                () -> assertEquals(0L, LemireBoundedInt.product(0, Integer.MAX_VALUE)),
                () -> assertEquals(0x0000000380000000L,
                        LemireBoundedInt.product(0x80000000, 7)),
                () -> assertEquals(0x7ffffffe80000001L, maximumProduct),
                () -> assertEquals(Integer.MAX_VALUE - 1,
                        LemireBoundedInt.result(maximumProduct)));
    }

    @Test
    void requiredBoundsAreDeterministicAndStayInRange() {
        int[] bounds = {1, 2, 16, 256, 1 << 30, 3, 7, 10_000, Integer.MAX_VALUE};

        for (int bound : bounds) {
            for (int entity = 0; entity < 4_096; entity++) {
                int value = random.boundedInt(SEED, SIMULATION, 17, entity,
                        RandomEvent.SALE_MARKET_TIE_BREAK.id(), 0, bound);
                int repeated = random.boundedInt(SEED, SIMULATION, 17, entity,
                        RandomEvent.SALE_MARKET_TIE_BREAK.id(), 0, bound);

                assertEquals(value, repeated, "same address must be deterministic");
                assertTrue(value >= 0 && value < bound,
                        "bounded result outside [0, bound) for bound " + bound);
            }
        }
    }

    @Test
    void invalidBoundsAndStartingBlocksFailLoudly() {
        assertAll(
                () -> assertThrows(IllegalArgumentException.class,
                        () -> random.boundedInt(SEED, SIMULATION, TIME_STEP, 0, EVENT, 0, 0)),
                () -> assertThrows(IllegalArgumentException.class,
                        () -> random.boundedInt(SEED, SIMULATION, TIME_STEP, 0, EVENT, 0, -1)),
                () -> assertThrows(IllegalArgumentException.class,
                        () -> random.boundedInt(SEED, SIMULATION, TIME_STEP, 0, EVENT, 0,
                                Integer.MIN_VALUE)),
                () -> assertThrows(IllegalArgumentException.class,
                        () -> random.boundedInt(SEED, SIMULATION, TIME_STEP, 0, EVENT, -1, 7)),
                () -> assertThrows(IllegalArgumentException.class,
                        () -> random.boundedInt(SEED, SIMULATION, TIME_STEP, 0, EVENT, 0x10000, 7)));
    }

    @Test
    void rejectionAdvancesOnlyTheCallingEventsLowSixteenBitSubcounter() {
        int[] expectedCandidates = {0x76341df2, 0xe18c51c0, 0xb5a8fcdd};
        long[] expectedProducts = {
                0x2766b4a64ecd694cL,
                0x4b2ec5eb41083680L,
                0x3c8da99f791b533eL
        };
        boolean[] expectedRejections = {true, true, false};

        for (int retrySubcounter = 0; retrySubcounter < expectedCandidates.length;
             retrySubcounter++) {
            int candidate = PhiloxAddressedRandom.word0(SEED, SIMULATION, TIME_STEP, 0,
                    EVENT, retrySubcounter);
            long product = LemireBoundedInt.product(candidate, FORCED_REJECTION_BOUND);

            assertEquals(expectedCandidates[retrySubcounter], candidate,
                    "candidate at retry subcounter " + retrySubcounter);
            assertEquals(expectedProducts[retrySubcounter], product,
                    "product at retry subcounter " + retrySubcounter);
            assertEquals(expectedRejections[retrySubcounter],
                    LemireBoundedInt.rejects(product, FORCED_REJECTION_BOUND),
                    "rejection at retry subcounter " + retrySubcounter);
        }

        assertEquals(1_015_916_959,
                random.boundedInt(SEED, SIMULATION, TIME_STEP, 0, EVENT, 0,
                        FORCED_REJECTION_BOUND));
    }

    @Test
    void finalSubcounterMayAcceptButNeverWrapsAfterRejection() {
        int acceptedCandidate = PhiloxAddressedRandom.word0(SEED, SIMULATION, TIME_STEP, 0,
                EVENT, 0xffff);
        int rejectedCandidate = PhiloxAddressedRandom.word0(SEED, SIMULATION, TIME_STEP, 2,
                EVENT, 0xffff);

        assertAll(
                () -> assertEquals(0x368b4597, acceptedCandidate),
                () -> assertTrue(!LemireBoundedInt.rejects(
                        LemireBoundedInt.product(acceptedCandidate, FORCED_REJECTION_BOUND),
                        FORCED_REJECTION_BOUND)),
                () -> assertEquals(305_032_327,
                        random.boundedInt(SEED, SIMULATION, TIME_STEP, 0, EVENT, 0xffff,
                                FORCED_REJECTION_BOUND)),
                () -> assertEquals(0x7c9c0ec0, rejectedCandidate),
                () -> assertTrue(LemireBoundedInt.rejects(
                        LemireBoundedInt.product(rejectedCandidate, FORCED_REJECTION_BOUND),
                        FORCED_REJECTION_BOUND)),
                () -> assertThrows(IllegalStateException.class,
                        () -> random.boundedInt(SEED, SIMULATION, TIME_STEP, 2, EVENT, 0xffff,
                                FORCED_REJECTION_BOUND)));
    }

    @Test
    void smallBoundsPassDeterministicChiSquareGates() {
        long[] boundThree = observedCounts(3, 3);
        long[] boundSeven = observedCounts(7, 7);

        assertAll(
                () -> assertArrayEquals(new long[]{43_635, 43_566, 43_871}, boundThree),
                () -> assertArrayEquals(
                        new long[]{18_724, 18_781, 18_597, 18_659, 18_716, 18_685, 18_910},
                        boundSeven),
                () -> assertTrue(chiSquare(boundThree, 3) < 20.0),
                () -> assertTrue(chiSquare(boundSeven, 7) < 30.0));
    }

    @Test
    void populationAndMaximumBoundsPassDeterministicBucketedChiSquareGates() {
        long[] population = observedCounts(10_000, 256);
        long[] maximum = observedCounts(Integer.MAX_VALUE, 256);

        assertAll(
                () -> assertTrue(chiSquare(population, 10_000) < 350.0,
                        "population-sized bound is not uniform across quantile buckets"),
                () -> assertTrue(chiSquare(maximum, Integer.MAX_VALUE) < 350.0,
                        "Integer.MAX_VALUE bound is not uniform across quantile buckets"));
    }

    private long[] observedCounts(int bound, int bucketCount) {
        long[] observed = new long[bucketCount];
        for (int entity = 0; entity < STATISTICAL_SAMPLE_SIZE; entity++) {
            int value = random.boundedInt(SEED, SIMULATION, 17, entity,
                    RandomEvent.SALE_MARKET_TIE_BREAK.id(), 0, bound);
            int bucket = (int) (((long) value * bucketCount) / bound);
            observed[bucket]++;
        }
        return observed;
    }

    private static double chiSquare(long[] observed, int bound) {
        int bucketCount = observed.length;
        double statistic = 0.0;

        for (int bucket = 0; bucket < bucketCount; bucket++) {
            long lower = divideRoundingUp((long) bucket * bound, bucketCount);
            long upper = divideRoundingUp((long) (bucket + 1) * bound, bucketCount);
            long width = upper - lower;
            double expected = (double) STATISTICAL_SAMPLE_SIZE * width / bound;
            double difference = observed[bucket] - expected;
            statistic += difference * difference / expected;
        }
        return statistic;
    }

    private static long divideRoundingUp(long numerator, int denominator) {
        return (numerator + denominator - 1L) / denominator;
    }
}
