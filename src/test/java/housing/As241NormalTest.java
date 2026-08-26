package housing;

import org.junit.jupiter.api.Test;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Deterministic and distribution gates for the vendored Wichura AS241 transform.
 *
 * <p>The published decimal values independently check accuracy; the raw seam values freeze this
 * Java implementation's explicit, non-fused Horner order.</p>
 */
class As241NormalTest {

    private static final int LARGE_SAMPLE_SIZE = 1 << 18;

    @Test
    void midpointIsPositiveZeroAtTheRawBitLevel() {
        assertEquals(0L, Double.doubleToRawLongBits(As241Normal.inverse(0.5)));
    }

    @Test
    void matchesWichurasPublishedReferenceValues() {
        assertPublishedValue(0.25, -0.6744897501960817);
        assertPublishedValue(0.001, -3.090232306167814);
        assertPublishedValue(1.0e-20, -9.262340089798408);
    }

    @Test
    void centralBranchSeamsArePinnedByRawInputsAndOutputs() {
        double lowerTail = Double.longBitsToDouble(0x3fb3333333333332L);
        double lowerCentral = Double.longBitsToDouble(0x3fb3333333333333L);
        double upperCentral = Double.longBitsToDouble(0x3fed999999999999L);
        double upperTail = Double.longBitsToDouble(0x3fed99999999999aL);

        assertAll(
                () -> assertEquals(As241Normal.INTERMEDIATE_TAIL,
                        As241Normal.branch(lowerTail)),
                () -> assertEquals(As241Normal.CENTRAL,
                        As241Normal.branch(lowerCentral)),
                () -> assertEquals(As241Normal.CENTRAL,
                        As241Normal.branch(upperCentral)),
                () -> assertEquals(As241Normal.INTERMEDIATE_TAIL,
                        As241Normal.branch(upperTail)),
                () -> assertRawEquals(-0x1.7085226d3e522p0,
                        As241Normal.inverse(lowerTail)),
                () -> assertRawEquals(-0x1.7085226d3e523p0,
                        As241Normal.inverse(lowerCentral)),
                () -> assertRawEquals(0x1.7085226d3e521p0,
                        As241Normal.inverse(upperCentral)),
                () -> assertRawEquals(0x1.7085226d3e524p0,
                        As241Normal.inverse(upperTail)));
    }

    @Test
    void fiveRadiusTailSeamIsPinnedByRawInputsAndOutputs() {
        double extremeSide = Double.longBitsToDouble(0x3dae8a37a45fc300L);
        double atExpMinusTwentyFive = Double.longBitsToDouble(0x3dae8a37a45fc32eL);
        double intermediateSide = Double.longBitsToDouble(0x3dae8a37a45fc35cL);

        assertAll(
                () -> assertEquals(As241Normal.EXTREME_TAIL,
                        As241Normal.branch(extremeSide)),
                () -> assertEquals(As241Normal.INTERMEDIATE_TAIL,
                        As241Normal.branch(atExpMinusTwentyFive)),
                () -> assertEquals(As241Normal.INTERMEDIATE_TAIL,
                        As241Normal.branch(intermediateSide)),
                () -> assertRawEquals(-0x1.aa1b1c13ee528p2,
                        As241Normal.inverse(extremeSide)),
                () -> assertRawEquals(-0x1.aa1b1c13ee525p2,
                        As241Normal.inverse(atExpMinusTwentyFive)),
                () -> assertRawEquals(-0x1.aa1b1c13ee523p2,
                        As241Normal.inverse(intermediateSide)));
    }

    @Test
    void productionUniformEndpointsAreFiniteExactSignMirrors() {
        double lowerProbability = 0x1.0p-53;
        double upperProbability = 0x1.fffffffffffffp-1;
        double lower = As241Normal.inverse(lowerProbability);
        double upper = As241Normal.inverse(upperProbability);

        assertAll(
                () -> assertTrue(Double.isFinite(lower)),
                () -> assertTrue(Double.isFinite(upper)),
                () -> assertRawEquals(-0x1.06b48528cea51p3, lower),
                () -> assertRawEquals(0x1.06b48528cea51p3, upper),
                () -> assertEquals(Double.doubleToRawLongBits(lower) ^ Long.MIN_VALUE,
                        Double.doubleToRawLongBits(upper)));
    }

    @Test
    void dyadicComplementaryInputsAreRawBitSymmetricAcrossAllBranches() {
        double[] lowerProbabilities = {0x1.0p-2, 0x1.0p-4, 0x1.0p-53};

        for (double lowerProbability : lowerProbabilities) {
            long lower = Double.doubleToRawLongBits(As241Normal.inverse(lowerProbability));
            long upper = Double.doubleToRawLongBits(
                    As241Normal.inverse(1.0 - lowerProbability));
            assertEquals(lower ^ Long.MIN_VALUE, upper,
                    "probability " + Double.toHexString(lowerProbability));
        }
    }

    @Test
    void rejectsValuesOutsideTheOpenUnitInterval() {
        double[] invalid = {
                Double.NEGATIVE_INFINITY, -1.0, -0.0, 0.0,
                1.0, Math.nextUp(1.0), Double.POSITIVE_INFINITY, Double.NaN
        };

        for (double probability : invalid) {
            assertThrows(IllegalArgumentException.class,
                    () -> As241Normal.inverse(probability),
                    "probability " + probability);
            assertThrows(IllegalArgumentException.class,
                    () -> As241Normal.branch(probability),
                    "branch probability " + probability);
        }
    }

    @Test
    void inverseIsMonotoneOnADeterministicOpenIntervalGrid() {
        int points = 100_000;
        double previous = Double.NEGATIVE_INFINITY;

        for (int i = 0; i < points; i++) {
            double probability = (i + 0.5) / points;
            double current = As241Normal.inverse(probability);
            assertTrue(current > previous,
                    "non-increasing at probability " + Double.toHexString(probability));
            previous = current;
        }
    }

    @Test
    void addressedNormalsHaveNoCrossAddressCache() {
        PhiloxAddressedRandom random = new PhiloxAddressedRandom();
        long seed = 0x0123456789abcdefL;
        int event = RandomEvent.SALE_REPRICE.id();

        long firstA = Double.doubleToRawLongBits(random.normal(seed, 2, 37, 91, event, 0));
        long valueB = Double.doubleToRawLongBits(random.normal(seed, 2, 37, 91, event, 1));
        long secondA = Double.doubleToRawLongBits(random.normal(seed, 2, 37, 91, event, 0));

        assertAll(
                () -> assertEquals(firstA, secondA),
                () -> assertNotEquals(firstA, valueB));
    }

    @Test
    void addressedNormalsPassLargeSampleMomentAndQuantileGates() {
        PhiloxAddressedRandom random = new PhiloxAddressedRandom();
        double[] sample = new double[LARGE_SAMPLE_SIZE];
        long seed = 0x6a09e667f3bcc909L;
        int event = RandomEvent.HH_DESIRED_PURCHASE.id();
        double mean = 0.0;
        double sumSquaredDeviations = 0.0;

        for (int i = 0; i < sample.length; i++) {
            double value = random.normal(seed, 7, 123, i, event, 0);
            sample[i] = value;

            double delta = value - mean;
            mean += delta / (i + 1.0);
            sumSquaredDeviations += delta * (value - mean);
        }

        double sampleMean = mean;
        double variance = sumSquaredDeviations / (sample.length - 1.0);
        Arrays.sort(sample);

        assertAll(
                () -> assertTrue(Math.abs(sampleMean) < 0.012,
                        "mean = " + sampleMean),
                () -> assertTrue(Math.abs(variance - 1.0) < 0.018,
                        "variance = " + variance),
                () -> assertQuantile(sample, 0.001, -3.090232306167814, 0.12),
                () -> assertQuantile(sample, 0.01, -2.3263478740408408, 0.05),
                () -> assertQuantile(sample, 0.05, -1.6448536269514729, 0.03),
                () -> assertQuantile(sample, 0.50, 0.0, 0.018),
                () -> assertQuantile(sample, 0.95, 1.6448536269514722, 0.03),
                () -> assertQuantile(sample, 0.99, 2.3263478740408408, 0.05),
                () -> assertQuantile(sample, 0.999, 3.090232306167814, 0.12));
    }

    private static void assertPublishedValue(double probability, double expected) {
        assertEquals(expected, As241Normal.inverse(probability),
                Math.abs(expected) * 1.0e-15);
    }

    private static void assertRawEquals(double expected, double actual) {
        assertEquals(Double.doubleToRawLongBits(expected),
                Double.doubleToRawLongBits(actual));
    }

    private static void assertQuantile(double[] sortedSample, double probability,
                                       double expected, double tolerance) {
        int index = (int) Math.round(probability * (sortedSample.length - 1));
        double actual = sortedSample[index];
        assertTrue(Math.abs(actual - expected) < tolerance,
                "quantile " + probability + " = " + actual);
    }
}
