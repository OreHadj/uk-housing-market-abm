package housing;

/**
 * Stateless Wichura AS241 (PPND16) inverse standard-normal transform.
 *
 * <p>The scalar coefficients and explicit Horner assignments preserve the published operation
 * order without arrays, loops, reassociation, or fused multiply-adds. The central branch is pure
 * IEEE-754 arithmetic. Tail branches additionally use {@link StrictMath#log(double)} to pin the
 * Java reference; Java/CUDA tail bitwise agreement is deliberately not claimed.</p>
 *
 * <p>Coefficient source: M. J. Wichura, "Algorithm AS 241: The Percentage Points of the Normal
 * Distribution", Applied Statistics 37(3), 1988,
 * <a href="https://doi.org/10.2307/2347330">doi:10.2307/2347330</a>.</p>
 */
final class As241Normal {

    static final int CENTRAL = 0;
    static final int INTERMEDIATE_TAIL = 1;
    static final int EXTREME_TAIL = 2;

    private As241Normal() { }

    static double inverse(double probability) {
        validate(probability);

        double q = probability - 0.5;
        if (Math.abs(q) <= 0.425) {
            double r = 0.180625 - q * q;
            return central(q, r);
        }

        double tailProbability = q < 0.0 ? probability : 1.0 - probability;
        double r = Math.sqrt(-StrictMath.log(tailProbability));
        double value;
        if (r <= 5.0) {
            value = intermediateTail(r - 1.6);
        } else {
            value = extremeTail(r - 5.0);
        }
        return q < 0.0 ? -value : value;
    }

    static int branch(double probability) {
        validate(probability);

        double q = probability - 0.5;
        if (Math.abs(q) <= 0.425) {
            return CENTRAL;
        }
        double tailProbability = q < 0.0 ? probability : 1.0 - probability;
        return Math.sqrt(-StrictMath.log(tailProbability)) <= 5.0
                ? INTERMEDIATE_TAIL : EXTREME_TAIL;
    }

    private static double central(double q, double r) {
        double numerator = 2.5090809287301226727e3;
        numerator = numerator * r + 3.3430575583588128105e4;
        numerator = numerator * r + 6.7265770927008700853e4;
        numerator = numerator * r + 4.5921953931549871457e4;
        numerator = numerator * r + 1.3731693765509461125e4;
        numerator = numerator * r + 1.9715909503065514427e3;
        numerator = numerator * r + 1.3314166789178437745e2;
        numerator = numerator * r + 3.3871328727963666080;

        double denominator = 5.2264952788528545610e3;
        denominator = denominator * r + 2.8729085735721942674e4;
        denominator = denominator * r + 3.9307895800092710610e4;
        denominator = denominator * r + 2.1213794301586595867e4;
        denominator = denominator * r + 5.3941960214247511077e3;
        denominator = denominator * r + 6.8718700749205790830e2;
        denominator = denominator * r + 4.2313330701600911252e1;
        denominator = denominator * r + 1.0;

        return (q * numerator) / denominator;
    }

    private static double intermediateTail(double r) {
        double numerator = 7.74545014278341407640e-4;
        numerator = numerator * r + 2.27238449892691845833e-2;
        numerator = numerator * r + 2.41780725177450611770e-1;
        numerator = numerator * r + 1.27045825245236838258;
        numerator = numerator * r + 3.64784832476320460504;
        numerator = numerator * r + 5.76949722146069140550;
        numerator = numerator * r + 4.63033784615654529590;
        numerator = numerator * r + 1.42343711074968357734;

        double denominator = 1.05075007164441684324e-9;
        denominator = denominator * r + 5.47593808499534494600e-4;
        denominator = denominator * r + 1.51986665636164571966e-2;
        denominator = denominator * r + 1.48103976427480074590e-1;
        denominator = denominator * r + 6.89767334985100004550e-1;
        denominator = denominator * r + 1.67638483018380384940;
        denominator = denominator * r + 2.05319162663775882187;
        denominator = denominator * r + 1.0;

        return numerator / denominator;
    }

    private static double extremeTail(double r) {
        double numerator = 2.01033439929228813265e-7;
        numerator = numerator * r + 2.71155556874348757815e-5;
        numerator = numerator * r + 1.24266094738807843860e-3;
        numerator = numerator * r + 2.65321895265761230930e-2;
        numerator = numerator * r + 2.96560571828504891230e-1;
        numerator = numerator * r + 1.78482653991729133580;
        numerator = numerator * r + 5.46378491116411436990;
        numerator = numerator * r + 6.65790464350110377720;

        double denominator = 2.04426310338993978564e-15;
        denominator = denominator * r + 1.42151175831644588870e-7;
        denominator = denominator * r + 1.84631831751005468180e-5;
        denominator = denominator * r + 7.86869131145613259100e-4;
        denominator = denominator * r + 1.48753612908506148525e-2;
        denominator = denominator * r + 1.36929880922735805310e-1;
        denominator = denominator * r + 5.99832206555887937690e-1;
        denominator = denominator * r + 1.0;

        return numerator / denominator;
    }

    private static void validate(double probability) {
        if (!(probability > 0.0 && probability < 1.0)) {
            throw new IllegalArgumentException("probability must be in (0, 1): " + probability);
        }
    }
}
