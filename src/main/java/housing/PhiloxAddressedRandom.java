package housing;

/**
 * Stateless addressed transformations backed by Philox4x32-10.
 *
 * <p>{@code subcounter} is encoded directly in the low 16 bits of counter word 3. Every uniform and
 * normal uses words 0/1 from its literal subcounter block, independent of event identity. Every call
 * recomputes its addressed block. Bounded integers use word 0 on every attempt and advance only the
 * calling event's subcounter after a Lemire rejection.</p>
 */
final class PhiloxAddressedRandom implements AddressedRandom {

    private static final double TWO_TO_MINUS_52 = 0x1.0p-52;

    @Override
    public double uniform(long seed, int simulation, int timeStep, int entity, int event,
                          int subcounter) {
        return uniformFromPair(words01(seed, simulation, timeStep, entity, event, subcounter));
    }

    @Override
    public double normal(long seed, int simulation, int timeStep, int entity, int event,
                         int subcounter) {
        return As241Normal.inverse(uniform(seed, simulation, timeStep, entity, event, subcounter));
    }

    @Override
    public int boundedInt(long seed, int simulation, int timeStep, int entity, int event,
                          int subcounter, int bound) {
        LemireBoundedInt.validateBound(bound);
        int retrySubcounter = subcounter;

        while (true) {
            int candidate = word0(seed, simulation, timeStep, entity, event, retrySubcounter);
            long product = LemireBoundedInt.product(candidate, bound);
            if (!LemireBoundedInt.rejects(product, bound)) {
                return LemireBoundedInt.result(product);
            }
            if (retrySubcounter == RandomAddressV1.MAX_UNSIGNED_16) {
                throw new IllegalStateException("bounded-int rejection exhausted event subcounters");
            }
            retrySubcounter++;
        }
    }

    static double uniformFromWords(int highWord, int lowWord) {
        long pair = (Integer.toUnsignedLong(highWord) << 32)
                | Integer.toUnsignedLong(lowWord);
        return uniformFromPair(pair);
    }

    static double uniformFromPair(long pair) {
        long randomBits = pair >>> 12;
        return (randomBits + 0.5) * TWO_TO_MINUS_52;
    }

    static int word0(long seed, int simulation, int timeStep, int entity, int event,
                     int subcounter) {
        return (int) (words01(seed, simulation, timeStep, entity, event, subcounter) >>> 32);
    }

    private static long words01(long seed, int simulation, int timeStep, int entity, int event,
                                int subcounter) {
        return Philox4x32.words01(
                RandomAddressV1.counter0(simulation),
                RandomAddressV1.counter1(timeStep),
                RandomAddressV1.counter2(entity),
                RandomAddressV1.counter3(event, subcounter),
                RandomAddressV1.key0(seed),
                RandomAddressV1.key1(seed));
    }
}
