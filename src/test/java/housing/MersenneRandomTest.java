package housing;

import org.apache.commons.math3.distribution.GeometricDistribution;
import org.apache.commons.math3.random.MersenneTwister;
import org.junit.jupiter.api.Test;

import utilities.Pdf;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

class MersenneRandomTest {

    @Test
    void mixedSequenceMatchesCommonsMersenneTwisterBitForBit() {
        MersenneTwister expected = new MersenneTwister(0x12345678);
        MersenneRandom actual = new MersenneRandom(0x12345678);

        assertEquals(expected.nextInt(), actual.nextInt());
        assertEquals(expected.nextLong(), actual.nextLong());
        assertEquals(expected.nextBoolean(), actual.nextBoolean());
        assertEquals(Float.floatToRawIntBits(expected.nextFloat()),
                Float.floatToRawIntBits(actual.nextFloat()));
        assertEquals(Double.doubleToRawLongBits(expected.nextDouble()),
                Double.doubleToRawLongBits(actual.nextDouble()));

        // The first call fills Commons' Gaussian cache. Other draws must not disturb the cached value.
        assertEquals(Double.doubleToRawLongBits(expected.nextGaussian()),
                Double.doubleToRawLongBits(actual.nextGaussian()));
        assertEquals(expected.nextInt(7), actual.nextInt(7));
        assertEquals(Double.doubleToRawLongBits(expected.nextDouble()),
                Double.doubleToRawLongBits(actual.nextDouble()));
        assertEquals(Double.doubleToRawLongBits(expected.nextGaussian()),
                Double.doubleToRawLongBits(actual.nextGaussian()));

        byte[] expectedBytes = new byte[19];
        byte[] actualBytes = new byte[19];
        expected.nextBytes(expectedBytes);
        actual.nextBytes(actualBytes);
        assertArrayEquals(expectedBytes, actualBytes);

        assertEquals(expected.nextInt(1), actual.nextInt(1));
        assertEquals(expected.nextInt(Integer.MAX_VALUE), actual.nextInt(Integer.MAX_VALUE));
    }

    @Test
    void reseedingClearsTheDelegatesGaussianCache() {
        MersenneTwister expected = new MersenneTwister(41);
        MersenneRandom actual = new MersenneRandom(41);

        assertEquals(Double.doubleToRawLongBits(expected.nextGaussian()),
                Double.doubleToRawLongBits(actual.nextGaussian()));

        expected.setSeed(73);
        actual.setSeed(73);

        assertEquals(Double.doubleToRawLongBits(expected.nextGaussian()),
                Double.doubleToRawLongBits(actual.nextGaussian()));
        assertEquals(Double.doubleToRawLongBits(expected.nextGaussian()),
                Double.doubleToRawLongBits(actual.nextGaussian()));
    }

    @Test
    void everySeedOverloadDelegatesExactly() {
        MersenneTwister expected = new MersenneTwister(1);
        MersenneRandom actual = new MersenneRandom(1);

        expected.setSeed(0x10203040);
        actual.setSeed(0x10203040);
        assertEquals(expected.nextInt(), actual.nextInt());

        expected.setSeed(new int[] { 1, 2, 3, Integer.MIN_VALUE, Integer.MAX_VALUE });
        actual.setSeed(new int[] { 1, 2, 3, Integer.MIN_VALUE, Integer.MAX_VALUE });
        assertEquals(expected.nextLong(), actual.nextLong());

        expected.setSeed(0x0123456789ABCDEFL);
        actual.setSeed(0x0123456789ABCDEFL);
        assertEquals(Double.doubleToRawLongBits(expected.nextDouble()),
                Double.doubleToRawLongBits(actual.nextDouble()));
    }

    @Test
    void legacyCommonsAndPdfHelpersConsumeTheSameStream() {
        MersenneTwister expected = new MersenneTwister(9087);
        MersenneRandom actual = new MersenneRandom(9087);
        Pdf pdf = new Pdf(0.0, 1.0, x -> 1.0, 64);

        assertEquals(Double.doubleToRawLongBits(pdf.nextDouble(expected)),
                Double.doubleToRawLongBits(pdf.nextDouble(actual)));
        assertEquals(new GeometricDistribution(expected, 0.37).sample(),
                new GeometricDistribution(actual, 0.37).sample());
        assertEquals(expected.nextInt(10_000), actual.nextInt(10_000));
    }
}
