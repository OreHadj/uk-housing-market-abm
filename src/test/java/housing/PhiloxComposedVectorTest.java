package housing;

import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * Frozen end-to-end Java/CUDA oracle for address v1 and the Step 6 transforms.
 *
 * <p>Each row pins one primitive address through key/counter packing, all four Philox words, the
 * words-0/1 centred-uniform raw bits, AS241 raw bits and a fixed-bound Lemire result. Central AS241
 * rows are part of the exact CUDA contract; tail rows are a deterministic Java reference until a
 * shared logarithm is adopted. Repricing and markup rows deliberately expose two economic meanings
 * of the same low-16-bit {@code subcounter} field without changing transform behavior.</p>
 *
 * <p>The bounded columns are a low-level Lemire transform oracle. Their presence on every row does
 * not authorize bounded operations for those event IDs; operation authorization belongs to the
 * semantic event registry.</p>
 */
class PhiloxComposedVectorTest {

    private static final String RESOURCE = "/rng/philox-v1-java-cuda-vectors.csv";
    private static final PhiloxAddressedRandom RANDOM = new PhiloxAddressedRandom();

    @Test
    void frozenRowsPinTheCompleteAddressToTransformChain() throws IOException {
        List<VectorRow> rows = readRows();

        assertEquals(5, rows.size(), "frozen vector row count");
        for (VectorRow row : rows) {
            assertRow(row);
        }
    }

    @Test
    void vectorSetPinsLiteralSubcounterMeaningsWithoutLaneConventions() throws IOException {
        Map<String, VectorRow> rows = new LinkedHashMap<>();
        for (VectorRow row : readRows()) {
            rows.put(row.value("name"), row);
        }

        VectorRow reprice = rows.get("sale_reprice_magnitude");
        VectorRow markup = rows.get("sale_markup_episode_1");
        assertNotNull(reprice);
        assertNotNull(markup);
        assertAll(
                () -> assertEquals("0001", reprice.value("subcounter_hex")),
                () -> assertEquals("0001", markup.value("subcounter_hex")),
                () -> assertEquals("20030001", reprice.value("c3_hex")),
                () -> assertEquals("20050001", markup.value("c3_hex")));
    }

    @Test
    void boundedColumnsAreTransformOracleNotEventAuthorization() throws IOException {
        Map<String, VectorRow> rows = new LinkedHashMap<>();
        for (VectorRow row : readRows()) {
            rows.put(row.value("name"), row);
        }

        VectorRow ordinaryUniformEvent = rows.get("sale_reprice_trigger");
        VectorRow realBoundedEvent = rows.get("new_build_quality");
        assertNotNull(ordinaryUniformEvent);
        assertNotNull(realBoundedEvent);
        assertAll(
                () -> assertEquals("7", ordinaryUniformEvent.value("bounded_bound")),
                () -> assertEquals("2003", ordinaryUniformEvent.value("event_hex")),
                () -> assertEquals("7", realBoundedEvent.value("bounded_bound")),
                () -> assertEquals("5001", realBoundedEvent.value("event_hex")));
    }

    private static void assertRow(VectorRow row) {
        String name = row.value("name");
        long seed = unsignedLong(row.value("seed_hex"));
        int simulation = Integer.parseInt(row.value("simulation"));
        int timeStep = word(row.value("time_step_hex"));
        int entity = word(row.value("entity_hex"));
        int event = word(row.value("event_hex"));
        int subcounter = word(row.value("subcounter_hex"));

        int key0 = RandomAddressV1.key0(seed);
        int key1 = RandomAddressV1.key1(seed);
        int counter0 = RandomAddressV1.counter0(simulation);
        int counter1 = RandomAddressV1.counter1(timeStep);
        int counter2 = RandomAddressV1.counter2(entity);
        int counter3 = RandomAddressV1.counter3(event, subcounter);

        long words01 = Philox4x32.words01(counter0, counter1, counter2, counter3, key0, key1);
        long words23 = Philox4x32.words23(counter0, counter1, counter2, counter3, key0, key1);
        int word0 = (int) (words01 >>> 32);
        int word1 = (int) words01;
        int word2 = (int) (words23 >>> 32);
        int word3 = (int) words23;
        double uniform = RANDOM.uniform(seed, simulation, timeStep, entity, event, subcounter);
        double normal = RANDOM.normal(seed, simulation, timeStep, entity, event, subcounter);
        int bound = Integer.parseInt(row.value("bounded_bound"));
        int bounded = RANDOM.boundedInt(
                seed, simulation, timeStep, entity, event, subcounter, bound);
        int retries = boundedRetries(
                seed, simulation, timeStep, entity, event, subcounter, bound);

        assertAll(name,
                () -> assertEquals(word(row.value("k0_hex")), key0, "k0"),
                () -> assertEquals(word(row.value("k1_hex")), key1, "k1"),
                () -> assertEquals(word(row.value("c0_hex")), counter0, "c0"),
                () -> assertEquals(word(row.value("c1_hex")), counter1, "c1"),
                () -> assertEquals(word(row.value("c2_hex")), counter2, "c2"),
                () -> assertEquals(word(row.value("c3_hex")), counter3, "c3"),
                () -> assertEquals(word(row.value("w0_hex")), word0, "w0"),
                () -> assertEquals(word(row.value("w1_hex")), word1, "w1"),
                () -> assertEquals(word(row.value("w2_hex")), word2, "w2"),
                () -> assertEquals(word(row.value("w3_hex")), word3, "w3"),
                () -> assertEquals(Double.doubleToRawLongBits(
                                PhiloxAddressedRandom.uniformFromPair(words01)),
                        Double.doubleToRawLongBits(uniform), "words 0/1"),
                () -> assertEquals(unsignedLong(row.value("uniform_bits_hex")),
                        Double.doubleToRawLongBits(uniform), "uniform raw bits"),
                () -> assertEquals(branchName(As241Normal.branch(uniform)),
                        row.value("as241_branch"), "AS241 branch"),
                () -> assertEquals(unsignedLong(row.value("as241_bits_hex")),
                        Double.doubleToRawLongBits(normal), "AS241 raw bits"),
                () -> assertEquals(As241Normal.branch(uniform) == As241Normal.CENTRAL
                                ? "exact" : "java-reference-only",
                        row.value("as241_cuda_contract"), "CUDA AS241 policy"),
                () -> assertEquals(7, bound, "fixed Lemire oracle bound"),
                () -> assertEquals(Integer.parseInt(row.value("bounded_int")), bounded,
                        "bounded integer"),
                () -> assertEquals(Integer.parseInt(row.value("bounded_retries")), retries,
                        "bounded retries"),
                () -> assertEquals(word(row.value("bounded_final_subcounter_hex")),
                        subcounter + retries, "bounded final subcounter"));
    }

    private static int boundedRetries(long seed, int simulation, int timeStep, int entity,
                                      int event, int subcounter, int bound) {
        int retrySubcounter = subcounter;
        int retries = 0;
        while (true) {
            int candidate = PhiloxAddressedRandom.word0(
                    seed, simulation, timeStep, entity, event, retrySubcounter);
            long product = LemireBoundedInt.product(candidate, bound);
            if (!LemireBoundedInt.rejects(product, bound)) {
                return retries;
            }
            retrySubcounter++;
            retries++;
        }
    }

    private static String branchName(int branch) {
        return switch (branch) {
            case As241Normal.CENTRAL -> "central";
            case As241Normal.INTERMEDIATE_TAIL -> "intermediate-tail";
            case As241Normal.EXTREME_TAIL -> "extreme-tail";
            default -> throw new AssertionError("unknown AS241 branch: " + branch);
        };
    }

    private static List<VectorRow> readRows() throws IOException {
        InputStream input = PhiloxComposedVectorTest.class.getResourceAsStream(RESOURCE);
        assertNotNull(input, "missing vector resource " + RESOURCE);

        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String headerLine = reader.readLine();
            assertNotNull(headerLine, "empty vector resource");
            String[] headers = headerLine.split(",", -1);
            List<VectorRow> rows = new ArrayList<>();
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.isBlank()) {
                    continue;
                }
                String[] values = line.split(",", -1);
                assertEquals(headers.length, values.length, "CSV column count for " + line);
                Map<String, String> fields = new LinkedHashMap<>();
                for (int i = 0; i < headers.length; i++) {
                    fields.put(headers[i], values[i]);
                }
                rows.add(new VectorRow(fields));
            }
            return rows;
        }
    }

    private static int word(String hexadecimal) {
        return (int) Long.parseUnsignedLong(hexadecimal, 16);
    }

    private static long unsignedLong(String hexadecimal) {
        return Long.parseUnsignedLong(hexadecimal, 16);
    }

    private record VectorRow(Map<String, String> fields) {
        String value(String name) {
            String value = fields.get(name);
            if (value == null) {
                throw new AssertionError("missing vector column " + name);
            }
            return value;
        }
    }
}
