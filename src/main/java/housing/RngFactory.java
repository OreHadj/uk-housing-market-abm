package housing;

import java.util.Locale;

import org.apache.commons.math3.random.RandomGenerator;

/** Creates a random facade for one model run configuration. */
final class RngFactory {

    static final String PROPERTY = "housing.rng";

    private RngFactory() { }

    static RandomGenerator create(int seed) {
        String requested = System.getProperty(PROPERTY, "mersenne").trim().toLowerCase(Locale.ROOT);
        if (requested.equals("mersenne")) {
            return new MersenneRandom(seed);
        }
        throw new IllegalArgumentException("Unsupported " + PROPERTY + " value '" + requested
                + "' (only 'mersenne' is available)");
    }
}
