package housing;

/** Stateless unsigned-32-bit Lemire bounded-integer transform. */
final class LemireBoundedInt {

    private static final long TWO_TO_32 = 0x1_0000_0000L;

    private LemireBoundedInt() { }

    static void validateBound(int bound) {
        if (bound <= 0) {
            throw new IllegalArgumentException("bound must be positive: " + bound);
        }
    }

    static long product(int candidate, int bound) {
        validateBound(bound);
        return Integer.toUnsignedLong(candidate) * (long) bound;
    }

    static int threshold(int bound) {
        validateBound(bound);
        return (int) (TWO_TO_32 % bound);
    }

    static boolean rejects(long product, int bound) {
        validateBound(bound);
        long lowWord = product & 0xffff_ffffL;
        return lowWord < Integer.toUnsignedLong(threshold(bound));
    }

    static int result(long product) {
        return (int) (product >>> 32);
    }
}
