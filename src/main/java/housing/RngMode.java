package housing;

import java.util.Locale;

/** Configured random-number mode names and their stable metadata labels. */
enum RngMode {

    MERSENNE("mersenne", "MersenneTwister", "none"),
    PHILOX_HOUSEHOLD("philox-household", "MersenneTwister+Philox4x32-10", "1"),
    PHILOX("philox", "Philox4x32-10", "1");

    private final String propertyValue;
    private final String algorithm;
    private final String addressVersion;

    RngMode(String propertyValue, String algorithm, String addressVersion) {
        this.propertyValue = propertyValue;
        this.algorithm = algorithm;
        this.addressVersion = addressVersion;
    }

    String propertyValue() {
        return propertyValue;
    }

    String algorithm() {
        return algorithm;
    }

    String addressVersion() {
        return addressVersion;
    }

    static RngMode parse(String value) {
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        for (RngMode mode : values()) {
            if (mode.propertyValue.equals(normalized)) {
                return mode;
            }
        }
        throw new IllegalArgumentException("Unsupported " + RngFactory.PROPERTY + " value '"
                + normalized + "' (expected 'mersenne', 'philox-household', or 'philox')");
    }

    /**
     * Prevents a named mode from silently falling back before its event origins have been wired.
     */
    void requireModelSupport() {
        switch (this) {
            case MERSENNE:
                return;
            case PHILOX_HOUSEHOLD:
                throw new IllegalStateException("RNG mode 'philox-household' is not active until "
                        + "the household event origins are migrated in Step 9");
            case PHILOX:
                throw new IllegalStateException("RNG mode 'philox' is not active until all event "
                        + "origins are migrated in Step 12");
            default:
                throw new AssertionError("Unhandled RNG mode: " + this);
        }
    }
}
