package housing;

import java.util.Arrays;

import org.apache.commons.math3.random.MersenneTwister;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class ModelSimulationSeedTest {

    @Test
    void runOnePreservesSingleRunBehaviour() {
        int baseSeed = 1234;

        assertEquals(baseSeed, Model.simulationSeed(baseSeed, 1));
        assertArrayEquals(nextInts(new MersenneTwister(baseSeed), 10), nextInts(reseededPrng(baseSeed, 1), 10));
    }

    @Test
    void identicalSeedAndRunIndexPairsProduceIdenticalSequences() {
        int baseSeed = 5678;
        int runIndex = 4;

        assertArrayEquals(nextInts(reseededPrng(baseSeed, runIndex), 10),
                nextInts(reseededPrng(baseSeed, runIndex), 10));
    }

    @Test
    void differentRunIndicesProduceDifferentSequences() {
        int baseSeed = 9012;

        assertFalse(Arrays.equals(nextInts(reseededPrng(baseSeed, 2), 10),
                nextInts(reseededPrng(baseSeed, 3), 10)));
    }

    @Test
    void documentsLegacyCollisionAcrossSeedAndRunIndexPairs() {
        int seed42Run2 = Model.simulationSeed(42, 2);
        int seed43Run1 = Model.simulationSeed(43, 1);

        // Compatibility evidence only: the addressed RNG must not inherit this legacy collision.
        assertEquals(43, seed42Run2);
        assertEquals(43, seed43Run1);
        assertEquals(seed42Run2, seed43Run1);
    }

    private static MersenneTwister reseededPrng(int baseSeed, int runIndex) {
        MersenneTwister prng = new MersenneTwister(baseSeed);
        prng.setSeed(Model.simulationSeed(baseSeed, runIndex));
        return prng;
    }

    private static int[] nextInts(MersenneTwister prng, int count) {
        int[] values = new int[count];

        for (int i = 0; i < count; i += 1) {
            values[i] = prng.nextInt();
        }

        return values;
    }
}
