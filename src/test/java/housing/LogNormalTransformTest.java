package housing;

import org.apache.commons.math3.distribution.LogNormalDistribution;
import org.apache.commons.math3.random.RandomGenerator;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Proxy;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LogNormalTransformTest {

    @Test
    void fixedJavaArithmeticMatchesRawRegressionVectors() {
        assertRawVector(0.7, 1.3, 0.5, 0x40001c2a61268987L);
        assertRawVector(0.7, 1.3, 0.25, 0x3fead036871bfb44L);
        assertRawVector(0.7, 1.3, 0.75, 0x40135bc5f10a6b6fL);
        assertRawVector(0.7, 1.3, 0.01, 0x3fb90d212714eb6bL);
        assertRawVector(0.7, 1.3, 0x1.0p-53, 0x3f0878043beafd1eL);

        // Active/configured parameter rows guard against confusing outer model scales with log-
        // distribution scale and against changing the established down-payment interpretation.
        assertRawVector(0.0, 0.4326188972, 0.25, 0x3fe7e6c50edd7d84L);
        assertRawVector(11.6262593749, 0.8751065769, 0.25, 0x40ee4eadec63e9c8L);
        assertRawVector(11.6262593749, 0.8751065769, 0.5, 0x40fb58095ccff9ceL);
    }

    @Test
    void scaleAndShapeMatchCommonsFixedGaussianSemanticsWithinExpUlps() {
        assertCommonsSemantics(0.7, 1.3, 0.5);
        assertCommonsSemantics(0.7, 1.3, 0.25);
        assertCommonsSemantics(0.7, 1.3, 0.75);
        assertCommonsSemantics(0.7, 1.3, 0.01);
        assertCommonsSemantics(0.7, 1.3, 0x1.0p-53);
        assertCommonsSemantics(0.0, 0.4326188972, 0.25);
        assertCommonsSemantics(11.6262593749, 0.8751065769, 0.25);
    }

    @Test
    void medianIsExpOfScale() {
        double scale = 0.7;
        assertEquals(Double.doubleToRawLongBits(Math.exp(scale)),
                Double.doubleToRawLongBits(LogNormalTransform.sample(scale, 1.3, 0.5)));
    }

    @Test
    void zeroShapeIsDegenerateButStillValidatesTheUniformFirst() {
        double scale = -0.75;

        assertEquals(Double.doubleToRawLongBits(Math.exp(scale)),
                Double.doubleToRawLongBits(LogNormalTransform.sample(scale, 0.0, 0.25)));
        assertThrows(IllegalArgumentException.class,
                () -> LogNormalTransform.sample(scale, 0.0, 0.0));
    }

    @Test
    void negativeAndNanShapesAreRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> LogNormalTransform.sample(0.0, -0.1, 0.5));
        assertThrows(IllegalArgumentException.class,
                () -> LogNormalTransform.sample(0.0, Double.NEGATIVE_INFINITY, 0.5));
        assertThrows(IllegalArgumentException.class,
                () -> LogNormalTransform.sample(0.0, Double.NaN, 0.5));
    }

    @Test
    void complementaryUniformsReflectAroundTheLogScale() {
        double scale = 0.7;
        double shape = 1.3;
        double expectedProduct = Math.exp(2.0 * scale);
        double[] lowerUniforms = {0.25, 0.0625, 0x1.0p-53};

        for (double lowerUniform : lowerUniforms) {
            double lower = LogNormalTransform.sample(scale, shape, lowerUniform);
            double upper = LogNormalTransform.sample(scale, shape, 1.0 - lowerUniform);
            assertEquals(expectedProduct, lower * upper, 8.0 * Math.ulp(expectedProduct),
                    "uniform " + Double.toHexString(lowerUniform));
        }
    }

    @Test
    void apiIsPrimitiveStaticAndStoresNoState() throws Exception {
        Method sample = LogNormalTransform.class.getDeclaredMethod(
                "sample", double.class, double.class, double.class);

        assertTrue(Modifier.isStatic(sample.getModifiers()));
        assertEquals(double.class, sample.getReturnType());
        for (Class<?> parameterType : sample.getParameterTypes()) {
            assertTrue(parameterType.isPrimitive());
        }
        assertEquals(0, LogNormalTransform.class.getDeclaredFields().length);
        assertTrue(Modifier.isPrivate(
                LogNormalTransform.class.getDeclaredConstructor().getModifiers()));
    }

    private static void assertRawVector(double scale, double shape, double uniform,
                                        long expectedBits) {
        assertEquals(expectedBits,
                Double.doubleToRawLongBits(LogNormalTransform.sample(scale, shape, uniform)));
    }

    private static void assertCommonsSemantics(double scale, double shape, double uniform) {
        double standardNormal = As241Normal.inverse(uniform);
        AtomicInteger gaussianCalls = new AtomicInteger();
        RandomGenerator fixedGaussian = (RandomGenerator) Proxy.newProxyInstance(
                RandomGenerator.class.getClassLoader(),
                new Class<?>[] { RandomGenerator.class },
                (proxy, method, arguments) -> {
                    if (method.getName().equals("nextGaussian")) {
                        gaussianCalls.incrementAndGet();
                        return standardNormal;
                    }
                    throw new AssertionError("unexpected random call: " + method.getName());
                });

        double commons = new LogNormalDistribution(fixedGaussian, scale, shape).sample();
        double actual = LogNormalTransform.sample(scale, shape, uniform);

        assertTrue(ulpDistance(commons, actual) <= 2,
                () -> "Commons=" + Double.toHexString(commons)
                        + ", transform=" + Double.toHexString(actual));
        assertEquals(1, gaussianCalls.get());
    }

    private static long ulpDistance(double left, double right) {
        return Math.abs(Double.doubleToRawLongBits(left) - Double.doubleToRawLongBits(right));
    }
}
