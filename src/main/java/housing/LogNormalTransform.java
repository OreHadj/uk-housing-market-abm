package housing;

/** Stateless lognormal transform using Commons Math's scale/shape parameter meanings. */
final class LogNormalTransform {

    private LogNormalTransform() { }

    /**
     * Returns {@code exp(scale + shape * AS241(uniform))}.
     *
     * <p>{@code scale} is the mean and {@code shape} the standard deviation of the underlying
     * normal logarithm. A zero shape is supported for the model's degenerate desired-rent
     * configuration. The uniform is transformed before shape validation so that a zero shape never
     * hides an invalid caller-owned random value.</p>
     */
    static double sample(double scale, double shape, double uniform) {
        double standardNormal = As241Normal.inverse(uniform);
        if (!(shape >= 0.0)) {
            throw new IllegalArgumentException("shape must be non-negative: " + shape);
        }
        double scaledNormal = shape * standardNormal;
        double logValue = scale + scaledNormal;
        return Math.exp(logValue);
    }
}
