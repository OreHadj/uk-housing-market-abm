package housing;

/**
 * Stateless Philox4x32-10 integer core.
 *
 * <p>The counter and key words are interpreted as unsigned 32-bit values. Results are returned in
 * two packed pairs so callers can stay allocation-free: the earlier word occupies the high 32 bits
 * of each {@code long}. Calling both methods deliberately recomputes the block.</p>
 */
final class Philox4x32 {

    private static final int ROUNDS = 10;
    private static final int MULTIPLIER_0 = 0xd2511f53;
    private static final int MULTIPLIER_1 = 0xcd9e8d57;
    private static final int WEYL_0 = 0x9e3779b9;
    private static final int WEYL_1 = 0xbb67ae85;

    private Philox4x32() { }

    /** Returns output words 0 and 1, with word 0 in the high half. */
    static long words01(int counter0, int counter1, int counter2, int counter3,
                        int key0, int key1) {
        return generatePair(counter0, counter1, counter2, counter3, key0, key1, false);
    }

    /** Returns output words 2 and 3, with word 2 in the high half. */
    static long words23(int counter0, int counter1, int counter2, int counter3,
                        int key0, int key1) {
        return generatePair(counter0, counter1, counter2, counter3, key0, key1, true);
    }

    private static long generatePair(int counter0, int counter1, int counter2, int counter3,
                                     int key0, int key1, boolean secondPair) {
        for (int round = 0; round < ROUNDS; round++) {
            long product0 = Integer.toUnsignedLong(counter0)
                    * Integer.toUnsignedLong(MULTIPLIER_0);
            long product1 = Integer.toUnsignedLong(counter2)
                    * Integer.toUnsignedLong(MULTIPLIER_1);

            int next0 = (int) (product1 >>> 32) ^ counter1 ^ key0;
            int next1 = (int) product1;
            int next2 = (int) (product0 >>> 32) ^ counter3 ^ key1;
            int next3 = (int) product0;

            counter0 = next0;
            counter1 = next1;
            counter2 = next2;
            counter3 = next3;

            if (round + 1 < ROUNDS) {
                key0 += WEYL_0;
                key1 += WEYL_1;
            }
        }

        return secondPair ? pack(counter2, counter3) : pack(counter0, counter1);
    }

    private static long pack(int highWord, int lowWord) {
        return (Integer.toUnsignedLong(highWord) << 32) | Integer.toUnsignedLong(lowWord);
    }
}
