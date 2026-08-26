package housing;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PhiloxAddressedRandomTest {

    private static final long SEED = 0x0123456789abcdefL;

    private final PhiloxAddressedRandom random = new PhiloxAddressedRandom();

    @Test
    void centredUniformPinsOpenIntervalEndpointsByRawBits() {
        double minimum = PhiloxAddressedRandom.uniformFromWords(0x00000000, 0x00000000);
        double maximum = PhiloxAddressedRandom.uniformFromWords(0xffffffff, 0xffffffff);

        assertAll(
                () -> assertEquals(0x3ca0000000000000L, rawBits(minimum)),
                () -> assertEquals(0x3fefffffffffffffL, rawBits(maximum)),
                () -> assertEquals(0x1.0p-53, minimum),
                () -> assertEquals(Math.nextDown(1.0), maximum),
                () -> assertTrue(minimum > 0.0),
                () -> assertTrue(maximum < 1.0));
    }

    @Test
    void uniformUsesHighThenLowWordAndDiscardsTheLowTwelveBits() {
        double ordered = PhiloxAddressedRandom.uniformFromWords(0x01234567, 0x89abcdef);
        double changedDiscardedBits = PhiloxAddressedRandom.uniformFromWords(
                0x01234567, 0x89abc000);
        double reversed = PhiloxAddressedRandom.uniformFromWords(0x89abcdef, 0x01234567);

        assertAll(
                () -> assertEquals(0x3f723456789abc80L, rawBits(ordered)),
                () -> assertEquals(rawBits(ordered), rawBits(changedDiscardedBits)),
                () -> assertEquals(0x3fe13579bde02469L, rawBits(reversed)),
                () -> assertNotEquals(rawBits(ordered), rawBits(reversed)));
    }

    @Test
    void addressedUniformIsOpenAndDeterministicAcrossLiteralSubcounterBlocks() {
        for (int subcounter : new int[] {0, 1, 2, 17, 0x7fff, 0xffff}) {
            double first = random.uniform(SEED, 3, 2_000, 0x10203040,
                    RandomEvent.SALE_LIST_MARKUP.id(), subcounter);
            double second = random.uniform(SEED, 3, 2_000, 0x10203040,
                    RandomEvent.SALE_LIST_MARKUP.id(), subcounter);

            assertTrue(first > 0.0 && first < 1.0, "subcounter " + subcounter);
            assertEquals(rawBits(first), rawBits(second), "subcounter " + subcounter);
        }

        assertAll(
                () -> assertThrows(IllegalArgumentException.class,
                        () -> random.uniform(SEED, 0, 0, 0,
                                RandomEvent.SALE_LIST_MARKUP.id(), -1)),
                () -> assertThrows(IllegalArgumentException.class,
                        () -> random.uniform(SEED, 0, 0, 0,
                                RandomEvent.SALE_LIST_MARKUP.id(), 0x10000)));
    }

    @Test
    void subcounterZeroUsesWordsZeroAndOneOfBlockZero() {
        assertUsesWords01(RandomEvent.SALE_REPRICE.id(), 0);
    }

    @Test
    void subcounterOneUsesWordsZeroAndOneOfBlockOne() {
        assertUsesWords01(RandomEvent.SALE_REPRICE.id(), 1);
    }

    @Test
    void markupAndRepricingUseTheIdenticalTransformRule() {
        assertUsesWords01(RandomEvent.SALE_REPRICE.id(), 1);
        assertUsesWords01(RandomEvent.RENT_REPRICE.id(), 1);
        assertUsesWords01(RandomEvent.SALE_LIST_MARKUP.id(), 1);
        assertUsesWords01(RandomEvent.RENT_LIST_MARKUP.id(), 1);
    }

    @Test
    void changingTheEventIdDoesNotChangeLaneSelection() {
        assertUsesWords01(0x0000, 1);
        assertUsesWords01(RandomEvent.HH_DESIRED_PURCHASE.id(), 1);
        assertUsesWords01(RandomEvent.SALE_MARKET_TIE_BREAK.id(), 1);
        assertUsesWords01(0xffff, 1);
    }

    @Test
    void normalDelegatesToAs241UsingTheSelectedUniformWithoutCache() {
        int simulation = 7;
        int timeStep = 123;
        int entity = 0x10203040;
        int event = RandomEvent.SALE_REPRICE.id();
        int subcounter = 0;

        double uniform = random.uniform(SEED, simulation, timeStep, entity, event, subcounter);
        double expected = As241Normal.inverse(uniform);
        double first = random.normal(SEED, simulation, timeStep, entity, event, subcounter);
        double second = random.normal(SEED, simulation, timeStep, entity, event, subcounter);

        assertAll(
                () -> assertEquals(0x3fdb333e66466816L, rawBits(uniform)),
                () -> assertEquals(0xbfc834cf2f3bc20bL, rawBits(expected)),
                () -> assertEquals(rawBits(expected), rawBits(first)),
                () -> assertEquals(rawBits(first), rawBits(second)));
    }

    private void assertUsesWords01(int event, int subcounter) {
        int simulation = 7;
        int timeStep = 123;
        int entity = 0x10203040;
        long expectedPair = words01(SEED, simulation, timeStep, entity, event, subcounter);
        long unusedPair = words23(SEED, simulation, timeStep, entity, event, subcounter);
        double actual = random.uniform(SEED, simulation, timeStep, entity, event, subcounter);

        assertAll(
                () -> assertEquals((event << 16) | subcounter,
                        RandomAddressV1.counter3(event, subcounter)),
                () -> assertEquals(rawBits(PhiloxAddressedRandom.uniformFromPair(expectedPair)),
                        rawBits(actual)),
                () -> assertNotEquals(rawBits(PhiloxAddressedRandom.uniformFromPair(unusedPair)),
                        rawBits(actual), "words 2/3 must not be selected"));
    }

    private static long words01(long seed, int simulation, int timeStep, int entity,
                                int event, int subcounter) {
        return Philox4x32.words01(
                RandomAddressV1.counter0(simulation),
                RandomAddressV1.counter1(timeStep),
                RandomAddressV1.counter2(entity),
                RandomAddressV1.counter3(event, subcounter),
                RandomAddressV1.key0(seed),
                RandomAddressV1.key1(seed));
    }

    private static long words23(long seed, int simulation, int timeStep, int entity,
                                int event, int subcounter) {
        return Philox4x32.words23(
                RandomAddressV1.counter0(simulation),
                RandomAddressV1.counter1(timeStep),
                RandomAddressV1.counter2(entity),
                RandomAddressV1.counter3(event, subcounter),
                RandomAddressV1.key0(seed),
                RandomAddressV1.key1(seed));
    }

    private static long rawBits(double value) {
        return Double.doubleToRawLongBits(value);
    }
}
