package housing;

/** Pure inverse CDF for the number of failures before a geometric success. */
final class GeometricInverseCdf {

    private GeometricInverseCdf() { }

    /**
     * Returns the number of failures before the first success.
     *
     * <p>The closed form implements {@code ceil(log(1-u) / log(1-p)) - 1}. {@code log1p}
     * preserves the small-probability inputs, and the explicit saturation matches the distribution's
     * finite Java support without relying on narrowing-conversion behavior.</p>
     */
    static int sample(double probabilityOfSuccess, double uniform) {
        if (!(probabilityOfSuccess > 0.0 && probabilityOfSuccess <= 1.0)) {
            throw new IllegalArgumentException("probability of success must be in (0, 1]: "
                    + probabilityOfSuccess);
        }
        if (!(uniform > 0.0 && uniform < 1.0)) {
            throw new IllegalArgumentException("uniform must be in (0, 1): " + uniform);
        }
        if (probabilityOfSuccess == 1.0) {
            return 0;
        }

        double ratio = StrictMath.log1p(-uniform) / StrictMath.log1p(-probabilityOfSuccess);
        double failures = StrictMath.ceil(ratio) - 1.0;
        if (failures >= Integer.MAX_VALUE) {
            return Integer.MAX_VALUE;
        }
        return (int) failures;
    }
}
