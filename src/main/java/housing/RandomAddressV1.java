package housing;

/**
 * Stateless encoder for random-address layout version 1.
 *
 * <p>The encoded tuple is {@code (k0, k1, c0, c1, c2, c3)}:</p>
 *
 * <pre>
 * k0 = master seed bits 31..0
 * k1 = master seed bits 63..32
 * c0 = version (high 16) | zero-based simulation (low 16)
 * c1 = non-negative elapsed model time step
 * c2 = entity id's complete 32-bit pattern
 * c3 = event id (high 16) | subcounter (low 16)
 * </pre>
 *
 * <p>Separate primitive accessors keep the production path allocation-free. In particular, a Java
 * {@code int} carrying an entity value at or above {@code 0x80000000} is copied unchanged; the
 * Philox core interprets that word as unsigned.</p>
 */
final class RandomAddressV1 {

    static final int VERSION = 1;
    static final int MAX_UNSIGNED_16 = 0xffff;
    static final int MAX_REPORTING_SIMULATION = MAX_UNSIGNED_16 + 1;

    private static final int FIELD_SHIFT = 16;

    private RandomAddressV1() { }

    /** Converts the model's one-based reporting number at the single run boundary. */
    static int fromReportingSimulation(int reportingSimulation) {
        if (reportingSimulation < 1 || reportingSimulation > MAX_REPORTING_SIMULATION) {
            throw new IllegalArgumentException("reporting simulation must be in [1, "
                    + MAX_REPORTING_SIMULATION + "]: " + reportingSimulation);
        }
        return reportingSimulation - 1;
    }

    /** Packs the fixed layout version and a zero-based simulation index into counter word 0. */
    static int counter0(int simulation) {
        requireUnsigned16("simulation", simulation);
        return (VERSION << FIELD_SHIFT) | simulation;
    }

    /** Copies the explicit, non-negative elapsed model time step into counter word 1. */
    static int counter1(int timeStep) {
        if (timeStep < 0) {
            throw new IllegalArgumentException("timeStep must be non-negative: " + timeStep);
        }
        return timeStep;
    }

    /** Copies all 32 entity bits into counter word 2, including sign-bit-set patterns. */
    static int counter2(int entity) {
        return entity;
    }

    /** Packs an unsigned 16-bit event and subcounter into counter word 3. */
    static int counter3(int event, int subcounter) {
        requireUnsigned16("event", event);
        requireUnsigned16("subcounter", subcounter);
        return (event << FIELD_SHIFT) | subcounter;
    }

    /** Returns master-seed bits 31..0 as Random123 key word 0. */
    static int key0(long masterSeed) {
        return (int) masterSeed;
    }

    /** Returns master-seed bits 63..32 as Random123 key word 1. */
    static int key1(long masterSeed) {
        return (int) (masterSeed >>> 32);
    }

    private static void requireUnsigned16(String field, int value) {
        if ((value & ~MAX_UNSIGNED_16) != 0) {
            throw new IllegalArgumentException(field + " must be in [0, " + MAX_UNSIGNED_16
                    + "]: " + value);
        }
    }
}
