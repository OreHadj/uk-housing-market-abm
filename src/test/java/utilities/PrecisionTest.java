package utilities;

import org.junit.jupiter.api.Test;

import java.util.Random;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class PrecisionTest {

    @Test
    void q52IsRawBitNoOp() {
        Random random = new Random(0x51c0ffeeL);
        for (int i = 0; i < 100_000; i++) {
            long raw = random.nextLong();
            double value = Double.longBitsToDouble(raw);
            assertEquals(raw, Double.doubleToRawLongBits(Precision.quantise(value, 52)));
        }
    }

    @Test
    void q23MatchesBinary32ForNormalRangeFiniteValues() {
        Random random = new Random(0x23c0ffeeL);
        for (int i = 0; i < 100_000; i++) {
            int exponent = 1 + random.nextInt(253);
            long sign = random.nextBoolean() ? Long.MIN_VALUE : 0L;
            long exponentBits = (long) (exponent - 127 + 1023) << 52;
            long fraction = random.nextLong() & 0x000f_ffff_ffff_ffffL;
            double value = Double.longBitsToDouble(sign | exponentBits | fraction);
            double expected = (double) (float) value;
            assertEquals(Double.doubleToRawLongBits(expected),
                    Double.doubleToRawLongBits(Precision.quantise(value, 23)));
        }
    }

    @Test
    void tiesRoundToEvenForBothSigns() {
        assertRawEquals(1.0, Precision.quantise(1.03125, 4));
        assertRawEquals(1.125, Precision.quantise(1.09375, 4));
        assertRawEquals(-1.0, Precision.quantise(-1.03125, 4));
        assertRawEquals(-1.125, Precision.quantise(-1.09375, 4));
    }

    @Test
    void preservesSpecialValuesAndSignedZero() {
        assertEquals(Double.doubleToRawLongBits(0.0),
                Double.doubleToRawLongBits(Precision.quantise(0.0, 0)));
        assertEquals(Double.doubleToRawLongBits(-0.0),
                Double.doubleToRawLongBits(Precision.quantise(-0.0, 0)));
        assertRawEquals(Double.POSITIVE_INFINITY,
                Precision.quantise(Double.POSITIVE_INFINITY, 4));
        assertRawEquals(Double.NEGATIVE_INFINITY,
                Precision.quantise(Double.NEGATIVE_INFINITY, 4));
        long nan = 0x7ff8_1234_5678_9abcL;
        assertEquals(nan, Double.doubleToRawLongBits(
                Precision.quantise(Double.longBitsToDouble(nan), 4)));
    }

    @Test
    void handlesExponentCarryAndIsIdempotent() {
        double belowTwo = Double.longBitsToDouble(
                Double.doubleToRawLongBits(2.0) - 1L);
        assertRawEquals(2.0, Precision.quantise(belowTwo, 4));

        for (int q : new int[] {0, 2, 4, 10, 16, 23, 32, 40, 51, 52}) {
            double once = Precision.quantise(123_456.789012345, q);
            assertEquals(Double.doubleToRawLongBits(once),
                    Double.doubleToRawLongBits(Precision.quantise(once, q)));
        }
    }

    @Test
    void rejectsUnsupportedFractionCounts() {
        assertThrows(IllegalArgumentException.class, () -> Precision.quantise(1.0, -1));
        assertThrows(IllegalArgumentException.class, () -> Precision.quantise(1.0, 53));
    }

    @Test
    void reportsTheStorageLatticeSpacingIncludingQ2() {
        assertEquals(0.25, Precision.gridSpacing(1.0, 2));
        assertEquals(8192.0, Precision.gridSpacing(40_960.0, 2));
        assertEquals(Math.ulp(40_960.0), Precision.gridSpacing(40_960.0, 52));
    }

    private static void assertRawEquals(double expected, double actual) {
        assertEquals(Double.doubleToRawLongBits(expected), Double.doubleToRawLongBits(actual));
    }
}
