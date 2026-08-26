package housing;

import org.apache.commons.math3.distribution.GeometricDistribution;
import org.apache.commons.math3.random.RandomGenerator;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GeometricInverseCdfTest {

    private static final double MIN_CENTRED_UNIFORM = 0x1.0p-53;
    private static final double MAX_CENTRED_UNIFORM = 1.0 - MIN_CENTRED_UNIFORM;

    @Test
    void ordinaryCentredGridValuesAgreeWithCommonsMath() {
        double[] probabilities = {
                1.0, 0.9, 0.81, Math.pow(0.9, 3), 0.5, 0.1, 0.01
        };
        int sampleCount = 200_000;

        for (double probability : probabilities) {
            GeometricDistribution commons = new GeometricDistribution(probability);
            for (int index = 0; index < sampleCount; index++) {
                long randomBits = (long) ((index + 0.5) * 0x1.0p52 / sampleCount);
                double uniform = (randomBits + 0.5) * 0x1.0p-52;

                assertEquals(commons.inverseCumulativeProbability(uniform),
                        GeometricInverseCdf.sample(probability, uniform),
                        "p=" + Double.toHexString(probability)
                                + ", u=" + Double.toHexString(uniform));
            }
        }
    }

    @Test
    void roundedCommonsBoundaryDisagreementsAreExplicit() {
        GeometricDistribution pNineTenths = new GeometricDistribution(0.9);
        double pNineTenthsBoundary = pNineTenths.cumulativeProbability(4);
        double actualModelProbability = Math.pow(0.9, 3);
        GeometricDistribution actualModel = new GeometricDistribution(actualModelProbability);
        double actualModelBoundary = actualModel.cumulativeProbability(2);

        assertAll(
                () -> assertEquals(0x3fe753f7ced91688L,
                        Double.doubleToRawLongBits(actualModelProbability)),
                () -> assertEquals(0x3fefffeb074a771dL,
                        Double.doubleToRawLongBits(pNineTenthsBoundary)),
                () -> assertEquals(0x3fef5cf568c4b1eeL,
                        Double.doubleToRawLongBits(actualModelBoundary)),
                () -> assertEquals(4, pNineTenths.inverseCumulativeProbability(
                        Math.nextDown(pNineTenthsBoundary))),
                () -> assertEquals(4, GeometricInverseCdf.sample(
                        0.9, Math.nextDown(pNineTenthsBoundary))),
                () -> assertEquals(4,
                        pNineTenths.inverseCumulativeProbability(pNineTenthsBoundary)),
                () -> assertEquals(5,
                        GeometricInverseCdf.sample(0.9, pNineTenthsBoundary)),
                () -> assertEquals(5, pNineTenths.inverseCumulativeProbability(
                        Math.nextUp(pNineTenthsBoundary))),
                () -> assertEquals(5, GeometricInverseCdf.sample(
                        0.9, Math.nextUp(pNineTenthsBoundary))),
                () -> assertEquals(2,
                        actualModel.inverseCumulativeProbability(actualModelBoundary)),
                () -> assertEquals(3, GeometricInverseCdf.sample(
                        actualModelProbability, actualModelBoundary)),
                () -> assertEquals(1,
                        new GeometricDistribution(0.1).inverseCumulativeProbability(0.1)),
                () -> assertEquals(0, GeometricInverseCdf.sample(0.1, 0.1)));
    }

    @Test
    void maximumCentredUniformPinsCommonsCdfSaturationDifferences() {
        double actualModelProbability = Math.pow(0.9, 3);

        assertAll(
                () -> assertEquals(21,
                        new GeometricDistribution(0.81)
                                .inverseCumulativeProbability(MAX_CENTRED_UNIFORM)),
                () -> assertEquals(22,
                        GeometricInverseCdf.sample(0.81, MAX_CENTRED_UNIFORM)),
                () -> assertEquals(27,
                        new GeometricDistribution(actualModelProbability)
                                .inverseCumulativeProbability(MAX_CENTRED_UNIFORM)),
                () -> assertEquals(28,
                        GeometricInverseCdf.sample(
                                actualModelProbability, MAX_CENTRED_UNIFORM)));
    }

    @Test
    void certainSuccessAlwaysReturnsZero() {
        assertAll(
                () -> assertEquals(0,
                        GeometricInverseCdf.sample(1.0, MIN_CENTRED_UNIFORM)),
                () -> assertEquals(0, GeometricInverseCdf.sample(1.0, 0.5)),
                () -> assertEquals(0,
                        GeometricInverseCdf.sample(1.0, MAX_CENTRED_UNIFORM)));
    }

    @Test
    void extremelySmallSuccessProbabilitySaturatesExplicitly() {
        assertAll(
                () -> assertEquals(Integer.MAX_VALUE,
                        GeometricInverseCdf.sample(Float.MIN_VALUE, MIN_CENTRED_UNIFORM)),
                () -> assertEquals(Integer.MAX_VALUE,
                        GeometricInverseCdf.sample(Float.MIN_VALUE, 0.5)),
                () -> assertEquals(Integer.MAX_VALUE,
                        GeometricInverseCdf.sample(Float.MIN_VALUE, MAX_CENTRED_UNIFORM)));
    }

    @Test
    void invalidProbabilitiesAndUniformsFailLoudly() {
        double[] invalidProbabilities = {
                0.0, -1.0, Math.nextUp(1.0), Double.NaN,
                Double.NEGATIVE_INFINITY, Double.POSITIVE_INFINITY
        };
        double[] invalidUniforms = {
                0.0, 1.0, -1.0, Math.nextUp(1.0), Double.NaN,
                Double.NEGATIVE_INFINITY, Double.POSITIVE_INFINITY
        };

        for (double probability : invalidProbabilities) {
            assertThrows(IllegalArgumentException.class,
                    () -> GeometricInverseCdf.sample(probability, 0.5));
        }
        for (double uniform : invalidUniforms) {
            assertThrows(IllegalArgumentException.class,
                    () -> GeometricInverseCdf.sample(0.5, uniform));
        }
    }

    @Test
    void resultIsMonotoneInUniformAndSuccessProbability() {
        double[] probabilities = {0.01, 0.1, 0.5, 0.9, 1.0};
        int sampleCount = 100_000;

        for (double probability : probabilities) {
            int previous = -1;
            for (int index = 0; index < sampleCount; index++) {
                long randomBits = (long) ((index + 0.5) * 0x1.0p52 / sampleCount);
                double uniform = (randomBits + 0.5) * 0x1.0p-52;
                int value = GeometricInverseCdf.sample(probability, uniform);
                assertTrue(value >= previous,
                        "result decreased as the uniform increased");
                previous = value;
            }
        }

        double[] increasingProbabilities = {
                Double.MIN_VALUE, Float.MIN_VALUE, 0.001, 0.01, 0.1, 0.5, 0.9, 1.0
        };
        double[] uniforms = {MIN_CENTRED_UNIFORM, 0.1, 0.5, 0.9, MAX_CENTRED_UNIFORM};
        for (double uniform : uniforms) {
            int previous = Integer.MAX_VALUE;
            for (double probability : increasingProbabilities) {
                int value = GeometricInverseCdf.sample(probability, uniform);
                assertTrue(value <= previous,
                        "result increased with the probability of success");
                previous = value;
            }
        }
    }

    @Test
    void helperHasNoGeneratorOrMutableState() {
        assertEquals(0, GeometricInverseCdf.class.getDeclaredFields().length);
        for (Method method : GeometricInverseCdf.class.getDeclaredMethods()) {
            assertTrue(Modifier.isStatic(method.getModifiers()));
            assertTrue(method.getReturnType() != RandomGenerator.class);
            for (Class<?> parameter : method.getParameterTypes()) {
                assertTrue(parameter != RandomGenerator.class);
            }
        }
    }

    @Test
    void legacyCommonsSampleConsumesExactlyOneUniform() {
        CountingUniformGenerator generator = new CountingUniformGenerator(0.7);
        int result = new GeometricDistribution(generator, 0.5).sample();

        assertAll(
                () -> assertEquals(1, result),
                () -> assertEquals(1, generator.nextDoubleCalls));
    }

    private static final class CountingUniformGenerator implements RandomGenerator {

        private final double uniform;
        private int nextDoubleCalls;

        private CountingUniformGenerator(double uniform) {
            this.uniform = uniform;
        }

        @Override
        public double nextDouble() {
            nextDoubleCalls++;
            return uniform;
        }

        @Override public void setSeed(int seed) { throw unexpected(); }
        @Override public void setSeed(int[] seed) { throw unexpected(); }
        @Override public void setSeed(long seed) { throw unexpected(); }
        @Override public void nextBytes(byte[] bytes) { throw unexpected(); }
        @Override public int nextInt() { throw unexpected(); }
        @Override public int nextInt(int bound) { throw unexpected(); }
        @Override public long nextLong() { throw unexpected(); }
        @Override public boolean nextBoolean() { throw unexpected(); }
        @Override public float nextFloat() { throw unexpected(); }
        @Override public double nextGaussian() { throw unexpected(); }

        private AssertionError unexpected() {
            return new AssertionError("Commons geometric sampling consumed a non-uniform RNG method");
        }
    }
}
