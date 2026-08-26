package housing;

/** Creates an immutable random service for one model run configuration. */
final class RngFactory {

    static final String PROPERTY = "housing.rng";

    private RngFactory() { }

    /** Resolves the property for this run; no class-load-time mode is cached. */
    static RngMode resolveMode() {
        return RngMode.parse(System.getProperty(PROPERTY, RngMode.MERSENNE.propertyValue()));
    }

    static RandomService create(int configuredSeed) {
        return create(configuredSeed, resolveMode());
    }

    static RandomService create(int configuredSeed, RngMode mode) {
        return new RandomService(mode, configuredSeed);
    }

    /**
     * Bridges the signed configuration field to the 64-bit Philox key without sign extension.
     */
    static long masterSeed(int configuredSeed) {
        return Integer.toUnsignedLong(configuredSeed);
    }
}
