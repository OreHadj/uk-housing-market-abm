package utilities;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Locale;

/**
 * Run-wide storage-precision policy for the reduced-storage probe.
 *
 * <p>The mantissa bit count is the number of retained IEEE-754 binary64 fraction bits. Thus 52 is
 * an exact binary64 no-op and 23 matches binary32 significand rounding for normal-range values.
 * Arithmetic remains binary64; callers invoke {@link #store(Field, double)} only at persistent
 * storage boundaries.</p>
 */
public final class Precision {

    public static final String MODE_PROPERTY = "housing.precision";
    public static final String MANTISSA_BITS_PROPERTY = "housing.mantissaBits";
    public static final String DIAGNOSTICS_PROPERTY = "housing.precisionDiagnostics";
    public static final String PROBE_MODE_PROPERTY = "housing.precisionProbe";

    /** Fraction-bit grid evaluated together by the non-mutating shadow probe. */
    public static final int[] SHADOW_FRACTION_BITS = {
            52, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 32, 23, 16, 10, 8, 6, 4, 2
    };

    private static final long SIGN_MASK = 0x8000_0000_0000_0000L;
    private static final long EXPONENT_MASK = 0x7ff0_0000_0000_0000L;
    private static final long MAGNITUDE_MASK = 0x7fff_ffff_ffff_ffffL;

    public enum Field {
        HOUSEHOLD_ANNUAL_EMPLOYMENT_INCOME,
        HOUSEHOLD_MONTHLY_EMPLOYMENT_INCOME,
        HOUSEHOLD_DESIRED_PURCHASE_PRICE,
        HOUSEHOLD_MONTHLY_RENTAL_INCOME,
        HOUSEHOLD_BANK_BALANCE,
        HOUSEHOLD_DESIRED_CONSUMPTION,
        HOUSEHOLD_SAVING_RATE,
        HOUSEHOLD_PERSISTENT_LTI_LIMIT,
        MORTGAGE_DOWN_PAYMENT,
        MORTGAGE_PURCHASE_PRICE,
        MORTGAGE_PRINCIPAL,
        MORTGAGE_MONTHLY_INTEREST_RATE,
        PAYMENT_MONTHLY_PAYMENT,
        OFFER_INITIAL_LISTED_PRICE,
        OFFER_HOUSE_SPECIFIC_YIELD,
        MARKET_RECORD_PRICE,
        BID_DESIRED_DOWN_PAYMENT
    }

    private enum Mode {
        FP64,
        MANTISSA
    }

    private static final Mode MODE = resolveMode();
    private static final int FRACTION_BITS = resolveFractionBits();
    private static final boolean DIAGNOSTICS = resolveBoolean(DIAGNOSTICS_PROPERTY, false);
    private static final boolean SHADOW_DIAGNOSTICS =
            "shadow".equals(System.getProperty(PROBE_MODE_PROPERTY, "off").trim()
                    .toLowerCase(Locale.ROOT));
    private static final long[] writes = new long[Field.values().length];
    private static final long[] changedWrites = new long[Field.values().length];
    private static final long[][] shadowWrites =
            new long[Field.values().length][SHADOW_FRACTION_BITS.length];
    private static final long[][] shadowChangedWrites =
            new long[Field.values().length][SHADOW_FRACTION_BITS.length];
    private static final long[][] shadowZeroWrites =
            new long[Field.values().length][SHADOW_FRACTION_BITS.length];
    private static final long[][] shadowSubnormalWrites =
            new long[Field.values().length][SHADOW_FRACTION_BITS.length];
    private static final long[][] shadowNonfiniteWrites =
            new long[Field.values().length][SHADOW_FRACTION_BITS.length];
    private static final double[][] shadowMaxAbsoluteDelta =
            new double[Field.values().length][SHADOW_FRACTION_BITS.length];
    private static final double[][] shadowMaxRelativeDelta =
            new double[Field.values().length][SHADOW_FRACTION_BITS.length];
    private static final double[] shadowMinCandidate = new double[Field.values().length];
    private static final double[] shadowMaxCandidate = new double[Field.values().length];

    private Precision() {
    }

    /** Forces property parsing before the model performs output side effects. */
    public static void requireValidConfiguration() {
        // Static initialization performs validation.
    }

    public static double store(Field field, double candidate) {
        if (field == null) {
            throw new NullPointerException("field");
        }
        double stored = MODE == Mode.FP64 ? candidate : quantise(candidate, FRACTION_BITS);
        if (DIAGNOSTICS) {
            int index = field.ordinal();
            writes[index] += 1;
            if (Double.doubleToRawLongBits(candidate) != Double.doubleToRawLongBits(stored)) {
                changedWrites[index] += 1;
            }
        }
        if (SHADOW_DIAGNOSTICS) {
            observeShadowWrite(field, candidate);
        }
        return stored;
    }

    public static String metadataLine() {
        return "PRECISION_METADATA precision=" + modeLabel()
                + " mantissaBits=" + FRACTION_BITS
                + " fieldSet=gate-probe-v1-no-age"
                + " diagnostics=" + DIAGNOSTICS
                + " shadowGrid=" + shadowGridLabel();
    }

    public static void resetDiagnostics() {
        if (!DIAGNOSTICS && !SHADOW_DIAGNOSTICS) {
            return;
        }
        java.util.Arrays.fill(writes, 0L);
        java.util.Arrays.fill(changedWrites, 0L);
        resetShadowDiagnostics();
    }

    public static void writeDiagnostics(Path outputDirectory, int simulation) {
        if (!DIAGNOSTICS && !SHADOW_DIAGNOSTICS) {
            return;
        }
        if (DIAGNOSTICS) {
            Path output = outputDirectory.resolve(
                    String.format(Locale.ROOT, "precision-writes-run%03d.csv", simulation));
            try (BufferedWriter writer = Files.newBufferedWriter(
                    output,
                    StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE_NEW,
                    StandardOpenOption.WRITE)) {
                writer.write("field,writes,changedWrites");
                writer.newLine();
                for (Field field : Field.values()) {
                    int index = field.ordinal();
                    writer.write(field.name());
                    writer.write(',');
                    writer.write(Long.toString(writes[index]));
                    writer.write(',');
                    writer.write(Long.toString(changedWrites[index]));
                    writer.newLine();
                }
            } catch (IOException exception) {
                throw new IllegalStateException("Could not write precision diagnostics to " + output,
                        exception);
            }
        }
        if (SHADOW_DIAGNOSTICS) {
            writeShadowDiagnostics(outputDirectory, simulation);
        }
    }

    /** Public only for the diagnostics layer; model arithmetic must continue to use {@link #store}. */
    public static double quantiseForDiagnostics(double value, int fractionBits) {
        return quantise(value, fractionBits);
    }

    public static boolean isFp64() {
        return MODE == Mode.FP64;
    }

    public static int fractionBits() {
        return FRACTION_BITS;
    }

    /** Spacing of the q-fraction-bit lattice at {@code value}'s magnitude. */
    public static double gridSpacing(double value, int fractionBits) {
        if (fractionBits < 0 || fractionBits > 52) {
            throw new IllegalArgumentException(
                    "fractionBits must be between 0 and 52: " + fractionBits);
        }
        if (!Double.isFinite(value)) {
            return Double.NaN;
        }
        double magnitude = Math.abs(value);
        if (magnitude == 0.0 || magnitude < Double.MIN_NORMAL) {
            return Math.scalb(1.0, -1022 - fractionBits);
        }
        return Math.scalb(1.0, Math.getExponent(magnitude) - fractionBits);
    }

    static double quantise(double value, int fractionBits) {
        if (fractionBits < 0 || fractionBits > 52) {
            throw new IllegalArgumentException(
                    "fractionBits must be between 0 and 52: " + fractionBits);
        }
        if (fractionBits == 52) {
            return value;
        }

        long raw = Double.doubleToRawLongBits(value);
        long magnitude = raw & MAGNITUDE_MASK;
        if (magnitude == 0L || (magnitude & EXPONENT_MASK) == EXPONENT_MASK) {
            return value;
        }

        int droppedBits = 52 - fractionBits;
        long quantum = 1L << droppedBits;
        long discardedMask = quantum - 1L;
        long discarded = magnitude & discardedMask;
        long retained = magnitude & ~discardedMask;
        long halfway = quantum >>> 1;
        boolean retainedOdd = ((retained >>> droppedBits) & 1L) != 0L;
        if (discarded > halfway || (discarded == halfway && retainedOdd)) {
            retained += quantum;
        }
        return Double.longBitsToDouble((raw & SIGN_MASK) | retained);
    }

    private static void observeShadowWrite(Field field, double candidate) {
        int fieldIndex = field.ordinal();
        if (Double.isFinite(candidate)) {
            shadowMinCandidate[fieldIndex] = Math.min(shadowMinCandidate[fieldIndex], candidate);
            shadowMaxCandidate[fieldIndex] = Math.max(shadowMaxCandidate[fieldIndex], candidate);
        }
        for (int qIndex = 0; qIndex < SHADOW_FRACTION_BITS.length; qIndex++) {
            int q = SHADOW_FRACTION_BITS[qIndex];
            double shadow = quantise(candidate, q);
            shadowWrites[fieldIndex][qIndex] += 1;
            if (Double.doubleToRawLongBits(candidate) != Double.doubleToRawLongBits(shadow)) {
                shadowChangedWrites[fieldIndex][qIndex] += 1;
            }
            if (shadow == 0.0) {
                shadowZeroWrites[fieldIndex][qIndex] += 1;
            }
            if (Double.isFinite(shadow) && shadow != 0.0 && Math.abs(shadow) < Double.MIN_NORMAL) {
                shadowSubnormalWrites[fieldIndex][qIndex] += 1;
            }
            if (!Double.isFinite(shadow)) {
                shadowNonfiniteWrites[fieldIndex][qIndex] += 1;
            }
            if (Double.isFinite(candidate) && Double.isFinite(shadow)) {
                double absoluteDelta = Math.abs(shadow - candidate);
                shadowMaxAbsoluteDelta[fieldIndex][qIndex] = Math.max(
                        shadowMaxAbsoluteDelta[fieldIndex][qIndex], absoluteDelta);
                double denominator = Math.abs(candidate);
                double relativeDelta = denominator == 0.0 ? absoluteDelta : absoluteDelta / denominator;
                shadowMaxRelativeDelta[fieldIndex][qIndex] = Math.max(
                        shadowMaxRelativeDelta[fieldIndex][qIndex], relativeDelta);
            }
        }
    }

    private static void resetShadowDiagnostics() {
        java.util.Arrays.fill(shadowMinCandidate, Double.POSITIVE_INFINITY);
        java.util.Arrays.fill(shadowMaxCandidate, Double.NEGATIVE_INFINITY);
        for (int field = 0; field < Field.values().length; field++) {
            java.util.Arrays.fill(shadowWrites[field], 0L);
            java.util.Arrays.fill(shadowChangedWrites[field], 0L);
            java.util.Arrays.fill(shadowZeroWrites[field], 0L);
            java.util.Arrays.fill(shadowSubnormalWrites[field], 0L);
            java.util.Arrays.fill(shadowNonfiniteWrites[field], 0L);
            java.util.Arrays.fill(shadowMaxAbsoluteDelta[field], 0.0);
            java.util.Arrays.fill(shadowMaxRelativeDelta[field], 0.0);
        }
    }

    private static void writeShadowDiagnostics(Path outputDirectory, int simulation) {
        Path output = outputDirectory.resolve(
                String.format(Locale.ROOT, "precision-shadow-writes-run%03d.csv", simulation));
        try (BufferedWriter writer = Files.newBufferedWriter(
                output,
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE_NEW,
                StandardOpenOption.WRITE)) {
            writer.write("field,q,writes,changedWrites,maxAbsoluteDelta,maxRelativeDelta,"
                    + "minCandidate,maxCandidate,storedZeroCount,storedSubnormalCount,"
                    + "storedNonfiniteCount");
            writer.newLine();
            for (Field field : Field.values()) {
                int fieldIndex = field.ordinal();
                for (int qIndex = 0; qIndex < SHADOW_FRACTION_BITS.length; qIndex++) {
                    writer.write(field.name());
                    writer.write(',');
                    writer.write(Integer.toString(SHADOW_FRACTION_BITS[qIndex]));
                    writer.write(',');
                    writer.write(Long.toString(shadowWrites[fieldIndex][qIndex]));
                    writer.write(',');
                    writer.write(Long.toString(shadowChangedWrites[fieldIndex][qIndex]));
                    writer.write(',');
                    writer.write(Double.toHexString(shadowMaxAbsoluteDelta[fieldIndex][qIndex]));
                    writer.write(',');
                    writer.write(Double.toHexString(shadowMaxRelativeDelta[fieldIndex][qIndex]));
                    writer.write(',');
                    writer.write(finiteHexOrBlank(shadowMinCandidate[fieldIndex]));
                    writer.write(',');
                    writer.write(finiteHexOrBlank(shadowMaxCandidate[fieldIndex]));
                    writer.write(',');
                    writer.write(Long.toString(shadowZeroWrites[fieldIndex][qIndex]));
                    writer.write(',');
                    writer.write(Long.toString(shadowSubnormalWrites[fieldIndex][qIndex]));
                    writer.write(',');
                    writer.write(Long.toString(shadowNonfiniteWrites[fieldIndex][qIndex]));
                    writer.newLine();
                }
            }
        } catch (IOException exception) {
            throw new IllegalStateException("Could not write shadow precision diagnostics to " + output,
                    exception);
        }
    }

    private static String finiteHexOrBlank(double value) {
        return Double.isFinite(value) ? Double.toHexString(value) : "";
    }

    private static String shadowGridLabel() {
        StringBuilder label = new StringBuilder();
        for (int i = 0; i < SHADOW_FRACTION_BITS.length; i++) {
            if (i > 0) {
                label.append(':');
            }
            label.append(SHADOW_FRACTION_BITS[i]);
        }
        return label.toString();
    }

    private static Mode resolveMode() {
        String configured = System.getProperty(MODE_PROPERTY, "fp64").trim().toLowerCase(Locale.ROOT);
        return switch (configured) {
            case "fp64" -> Mode.FP64;
            case "mantissa" -> Mode.MANTISSA;
            default -> throw new IllegalArgumentException(
                    "Unsupported " + MODE_PROPERTY + " value '" + configured
                            + "' (expected 'fp64' or 'mantissa')");
        };
    }

    private static int resolveFractionBits() {
        String configured = System.getProperty(MANTISSA_BITS_PROPERTY);
        if (MODE == Mode.FP64) {
            if (configured == null || configured.isBlank()) {
                return 52;
            }
            int parsed = parseFractionBits(configured);
            if (parsed != 52) {
                throw new IllegalArgumentException(MANTISSA_BITS_PROPERTY
                        + " must be absent or 52 when " + MODE_PROPERTY + "=fp64");
            }
            return parsed;
        }
        if (configured == null || configured.isBlank()) {
            throw new IllegalArgumentException(MANTISSA_BITS_PROPERTY
                    + " is required when " + MODE_PROPERTY + "=mantissa");
        }
        return parseFractionBits(configured);
    }

    private static int parseFractionBits(String configured) {
        try {
            int parsed = Integer.parseInt(configured.trim());
            if (parsed < 0 || parsed > 52) {
                throw new IllegalArgumentException(MANTISSA_BITS_PROPERTY
                        + " must be in [0,52], got '" + configured + "'");
            }
            return parsed;
        } catch (NumberFormatException exception) {
            throw new IllegalArgumentException(MANTISSA_BITS_PROPERTY
                    + " must be an integer in [0,52], got '" + configured + "'", exception);
        }
    }

    private static boolean resolveBoolean(String property, boolean defaultValue) {
        String configured = System.getProperty(property);
        if (configured == null) {
            return defaultValue;
        }
        return switch (configured.trim().toLowerCase(Locale.ROOT)) {
            case "true" -> true;
            case "false" -> false;
            default -> throw new IllegalArgumentException(
                    property + " must be 'true' or 'false', got '" + configured + "'");
        };
    }

    private static String modeLabel() {
        return MODE == Mode.FP64 ? "fp64" : "mantissa";
    }
}
