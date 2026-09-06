package housing;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import java.util.Locale;

/** Low-volume phase traces used only by the paired precision/RNG diagnostic gate. */
final class PrecisionGateTrace {

    static final String PROPERTY = "housing.precisionGateTrace";

    private static final long HASH_SEED_A = 0x243f_6a88_85a3_08d3L;
    private static final long HASH_SEED_B = 0x1319_8a2e_0370_7344L;
    private static final boolean ENABLED = resolveEnabled();
    private static final long[] legacyRequests = new long[RngOrigin.values().length];
    private static final long[] legacyHashA = new long[RngOrigin.values().length];
    private static final long[] legacyHashB = new long[RngOrigin.values().length];
    private static final long[] addressedRequests = new long[RngOrigin.values().length];
    private static final long[] addressedHashA = new long[RngOrigin.values().length];
    private static final long[] addressedHashB = new long[RngOrigin.values().length];

    private static BufferedWriter writer;
    private static int activeSimulation = -1;
    private static int activeTimeStep = -1;

    private PrecisionGateTrace() {
    }

    static void requireValidConfiguration() {
        // Static initialization validates the property.
    }

    static String metadataLine() {
        return "PRECISION_GATE_METADATA enabled=" + ENABLED
                + " traceContract=legacy-raw-and-semantic-request-v1";
    }

    static boolean enabled() {
        return ENABLED;
    }

    static void beginSimulation(Path outputDirectory, int simulation) {
        if (!ENABLED) {
            return;
        }
        if (writer != null) {
            throw new IllegalStateException("precision gate trace is already open");
        }
        activeSimulation = simulation;
        Path output = outputDirectory.resolve(
                String.format(Locale.ROOT, "precision-gate-trace-run%03d.csv", simulation));
        try {
            writer = Files.newBufferedWriter(
                    output,
                    StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE_NEW,
                    StandardOpenOption.WRITE);
            writer.write("simulation,timeStep,phase,legacyRawWordsCumulative,"
                    + "legacyLogicalRequests,legacyRequestHashA,legacyRequestHashB,"
                    + "addressedRequests,addressedRequestHashA,addressedRequestHashB");
            writer.newLine();
        } catch (IOException exception) {
            throw new IllegalStateException("Could not create precision gate trace " + output,
                    exception);
        }
    }

    static void beginStep(int simulation, int timeStep) {
        if (!ENABLED) {
            return;
        }
        if (writer == null || simulation != activeSimulation) {
            throw new IllegalStateException("precision gate trace has no active simulation");
        }
        activeTimeStep = timeStep;
        Arrays.fill(legacyRequests, 0L);
        Arrays.fill(legacyHashA, HASH_SEED_A);
        Arrays.fill(legacyHashB, HASH_SEED_B);
        Arrays.fill(addressedRequests, 0L);
        Arrays.fill(addressedHashA, HASH_SEED_A);
        Arrays.fill(addressedHashB, HASH_SEED_B);
    }

    static void recordRequest(
            RngOrigin origin,
            RngBackend backend,
            EntityKind entityKind,
            int entityId,
            RandomEvent event,
            RngOperation operation,
            int subcounter,
            long auxiliary) {
        if (!ENABLED) {
            return;
        }
        if (activeTimeStep < 0) {
            throw new IllegalStateException("random request occurred outside an active traced step");
        }
        int index = origin.ordinal();
        long hashA;
        long hashB;
        if (backend == RngBackend.MERSENNE) {
            legacyRequests[index] += 1;
            hashA = legacyHashA[index];
            hashB = legacyHashB[index];
        } else {
            addressedRequests[index] += 1;
            hashA = addressedHashA[index];
            hashB = addressedHashB[index];
        }

        hashA = mixA(hashA, entityKind.ordinal());
        hashA = mixA(hashA, entityId);
        hashA = mixA(hashA, event.id());
        hashA = mixA(hashA, operation.ordinal());
        hashA = mixA(hashA, subcounter);
        hashA = mixA(hashA, auxiliary);

        hashB = mixB(hashB, entityKind.ordinal());
        hashB = mixB(hashB, entityId);
        hashB = mixB(hashB, event.id());
        hashB = mixB(hashB, operation.ordinal());
        hashB = mixB(hashB, subcounter);
        hashB = mixB(hashB, auxiliary);

        if (backend == RngBackend.MERSENNE) {
            legacyHashA[index] = hashA;
            legacyHashB[index] = hashB;
        } else {
            addressedHashA[index] = hashA;
            addressedHashB[index] = hashB;
        }
    }

    static void endPhase(
            int simulation,
            int timeStep,
            RngOrigin origin,
            long legacyRawWordsCumulative) {
        if (!ENABLED) {
            return;
        }
        if (writer == null || simulation != activeSimulation || timeStep != activeTimeStep) {
            throw new IllegalStateException("precision gate phase does not match active trace step");
        }
        int index = origin.ordinal();
        try {
            writer.write(Integer.toString(simulation));
            writer.write(',');
            writer.write(Integer.toString(timeStep));
            writer.write(',');
            writer.write(origin.name());
            writer.write(',');
            writer.write(Long.toString(legacyRawWordsCumulative));
            writer.write(',');
            writer.write(Long.toString(legacyRequests[index]));
            writer.write(',');
            writer.write(hash(legacyRequests[index], legacyHashA[index]));
            writer.write(',');
            writer.write(hash(legacyRequests[index], legacyHashB[index]));
            writer.write(',');
            writer.write(Long.toString(addressedRequests[index]));
            writer.write(',');
            writer.write(hash(addressedRequests[index], addressedHashA[index]));
            writer.write(',');
            writer.write(hash(addressedRequests[index], addressedHashB[index]));
            writer.newLine();
            if (timeStep == 0 || origin == RngOrigin.RENT_CLEARING) {
                writer.flush();
            }
        } catch (IOException exception) {
            throw new IllegalStateException("Could not append precision gate trace", exception);
        }
    }

    static void finishSimulation() {
        if (!ENABLED) {
            return;
        }
        if (writer == null) {
            throw new IllegalStateException("precision gate trace is not open");
        }
        try {
            writer.close();
        } catch (IOException exception) {
            throw new IllegalStateException("Could not close precision gate trace", exception);
        } finally {
            writer = null;
            activeSimulation = -1;
            activeTimeStep = -1;
        }
    }

    private static String hash(long count, long value) {
        return count == 0L ? "0000000000000000" : String.format(Locale.ROOT, "%016x", value);
    }

    private static long mixA(long hash, long value) {
        long mixed = value;
        mixed ^= mixed >>> 33;
        mixed *= 0xff51_afd7_ed55_8ccdL;
        mixed ^= mixed >>> 33;
        return Long.rotateLeft(hash ^ mixed, 27) * 0x9e37_79b1_85eb_ca87L;
    }

    private static long mixB(long hash, long value) {
        long mixed = value + 0x9e37_79b9_7f4a_7c15L;
        mixed = (mixed ^ (mixed >>> 30)) * 0xbf58_476d_1ce4_e5b9L;
        mixed = (mixed ^ (mixed >>> 27)) * 0x94d0_49bb_1331_11ebL;
        mixed ^= mixed >>> 31;
        return Long.rotateLeft(hash + mixed, 31) * 0xd6e8_feb8_6659_fd93L;
    }

    private static boolean resolveEnabled() {
        String configured = System.getProperty(PROPERTY, "false").trim().toLowerCase(Locale.ROOT);
        return switch (configured) {
            case "true" -> true;
            case "false" -> false;
            default -> throw new IllegalArgumentException(
                    PROPERTY + " must be 'true' or 'false', got '" + configured + "'");
        };
    }
}
