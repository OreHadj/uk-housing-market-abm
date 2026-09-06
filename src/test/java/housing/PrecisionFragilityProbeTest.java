package housing;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PrecisionFragilityProbeTest {

    private static final Path REPO_ROOT = Paths.get("").toAbsolutePath();

    @TempDir
    Path tempDir;

    @Test
    void stressContinuationIsLimitedToBtlPreview() {
        for (PrecisionFragilityProbe.Mode mode : PrecisionFragilityProbe.Mode.values()) {
            for (PrecisionFragilityProbe.ApprovalPurpose purpose
                    : PrecisionFragilityProbe.ApprovalPurpose.values()) {
                assertEquals(
                        mode == PrecisionFragilityProbe.Mode.STRESS
                                && purpose == PrecisionFragilityProbe.ApprovalPurpose.BTL_PREVIEW,
                        PrecisionFragilityProbe.isSafeStressContinuation(mode, purpose),
                        () -> mode + " / " + purpose);
            }
        }
    }

    @Test
    void shadowModeSweepsCompleteGridAndKeepsQ52AsNoOp() throws Exception {
        Path config = writeTinyConfig(tempDir.resolve("shadow.properties"));
        Path output = tempDir.resolve("output");
        Files.createDirectories(output);

        ProcessResult result = runModel(config, output);
        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("PRECISION_FRAGILITY_METADATA mode=shadow"));
        assertTrue(result.output.contains(
                "qGrid=52:51:50:49:48:47:46:45:44:43:42:41:40:32:23:16:10:8:6:4:2"));

        List<Map<String, String>> writes = readCsv(
                output.resolve("precision-shadow-writes-run001.csv"));
        assertTrue(writes.stream().anyMatch(row -> row.get("q").equals("2")));
        assertTrue(writes.stream().anyMatch(row -> row.get("q").equals("52")));
        assertTrue(writes.stream()
                .filter(row -> row.get("q").equals("52"))
                .allMatch(row -> row.get("changedWrites").equals("0")));

        List<Map<String, String>> branches = readCsv(
                output.resolve("precision-branch-summary-run001.csv"));
        assertFalse(branches.isEmpty());
        assertTrue(branches.stream().anyMatch(row -> row.get("q").equals("2")));
        assertTrue(branches.stream()
                .filter(row -> row.get("q").equals("52"))
                .allMatch(row -> row.get("flips").equals("0")));

        List<Map<String, String>> events = readCsv(
                output.resolve("precision-fragility-events-run001.csv"));
        assertTrue(events.stream().noneMatch(row -> row.get("q").equals("52")));
        assertTrue(Files.exists(output.resolve("precision-event-summary-run001.csv")));
    }

    private static Path writeTinyConfig(Path outputPath) throws IOException {
        String config = Files.readString(
                REPO_ROOT.resolve("src/main/resources/config.properties"),
                StandardCharsets.UTF_8);
        config = replace(config, "SEED", "1");
        config = replace(config, "N_STEPS", "1");
        config = replace(config, "N_SIMS", "1");
        config = replace(config, "TARGET_POPULATION", "1000");
        config = replace(config, "TIME_TO_START_RECORDING_TRANSACTIONS", "0");
        for (String key : List.of(
                "recordTransactions",
                "recordNBidUpFrequency",
                "recordCoreIndicators",
                "recordQualityBandPrice",
                "recordHouseholdID",
                "recordEmploymentIncome",
                "recordRentalIncome",
                "recordBankBalance",
                "recordHousingWealth",
                "recordTotalDebt",
                "recordHousingStatus",
                "recordConsumption",
                "recordNHousesOwned",
                "recordAge",
                "recordSavingRate")) {
            config = replace(config, key, "false");
        }
        Files.writeString(outputPath, config, StandardCharsets.UTF_8);
        return outputPath;
    }

    private static String replace(String text, String key, String value) {
        Pattern pattern = Pattern.compile("(?m)^" + Pattern.quote(key) + " = .*?$");
        Matcher matcher = pattern.matcher(text);
        assertTrue(matcher.find(), "missing config key " + key);
        return matcher.replaceFirst(Matcher.quoteReplacement(key + " = " + value));
    }

    private static ProcessResult runModel(Path config, Path output) throws Exception {
        ProcessBuilder builder = new ProcessBuilder(
                Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-Dhousing.orderbook=array",
                "-Dhousing.rng=philox-household",
                "-Dhousing.precision=fp64",
                "-Dhousing.precisionProbe=shadow",
                "-Dhousing.precisionProbeMaxExamples=2",
                "-Dhousing.precisionDiagnostics=false",
                "-Dhousing.precisionGateTrace=false",
                "-cp",
                System.getProperty("java.class.path"),
                "housing.Model",
                "-configFile",
                config.toAbsolutePath().toString(),
                "-outputFolder",
                output.toAbsolutePath().toString() + "/",
                "-dev");
        builder.directory(REPO_ROOT.toFile());
        builder.redirectErrorStream(true);
        Process process = builder.start();
        String childOutput = readStream(process.getInputStream());
        return new ProcessResult(process.waitFor(), childOutput);
    }

    private static List<Map<String, String>> readCsv(Path path) throws IOException {
        List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
        String[] header = lines.get(0).split(",", -1);
        return lines.subList(1, lines.size()).stream().map(line -> {
            String[] values = line.split(",", -1);
            assertEquals(header.length, values.length, "malformed CSV row in " + path);
            Map<String, String> row = new HashMap<>();
            for (int i = 0; i < header.length; i++) {
                row.put(header[i], values[i]);
            }
            return row;
        }).toList();
    }

    private static String readStream(InputStream stream) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4_096];
        int read;
        while ((read = stream.read(buffer)) != -1) {
            output.write(buffer, 0, read);
        }
        return output.toString(StandardCharsets.UTF_8);
    }

    private record ProcessResult(int exitCode, String output) {
    }
}
