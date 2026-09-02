package housing;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Integration coverage for the benchmark-only same-JVM warm-up protocol. */
class ModelBenchmarkWarmupTest {

    private static final Path REPO_ROOT = Paths.get("").toAbsolutePath();
    private static final Pattern MEASURED_SECONDS = Pattern.compile(
            "(?m)^BENCHMARK_MEASURED_WALL_SECONDS=([0-9]+(?:\\.[0-9]+)?)$");

    @TempDir
    Path tempDir;

    @Test
    void everyMeasuredModeRunsAfterAnEquivalentWarmupInTheSameJvm() throws Exception {
        Path configPath = writeTinyConfig(tempDir.resolve("benchmark.properties"));
        Path standaloneOutput = tempDir.resolve("standalone-mersenne");
        ProcessResult standalone = runModel(
                configPath, standaloneOutput, RngMode.MERSENNE, null, null);
        assertSuccessful(standalone);
        assertFalse(standalone.output.contains("BENCHMARK_PHASE"));
        assertEquals(1, standalone.output.lines()
                .filter("MODEL_RUNTIME_METADATA orderBook=array"::equals)
                .count());

        Path zeroWarmupOutput = tempDir.resolve("zero-warmup-mersenne");
        Path unusedWarmupRoot = tempDir.resolve("zero-warmup-should-not-exist");
        ProcessResult zeroWarmup = runModel(
                configPath, zeroWarmupOutput, RngMode.MERSENNE, 0, unusedWarmupRoot);
        assertSuccessful(zeroWarmup);
        assertFalse(zeroWarmup.output.contains("BENCHMARK_PHASE phase=warmup"));
        assertEquals(1, zeroWarmup.output.lines()
                .filter("BENCHMARK_PHASE phase=measured index=1 count=1"::equals)
                .count());
        assertTrue(zeroWarmup.output.contains(
                "BENCHMARK_METADATA sameJvmWarmupRuns=0 measuredSimulations=1 "
                        + "orderBook=array rngMode=mersenne"), zeroWarmup.output);
        assertFalse(Files.exists(unusedWarmupRoot));
        assertOutputTreesEqual(standaloneOutput, zeroWarmupOutput);

        for (RngMode mode : List.of(RngMode.MERSENNE, RngMode.PHILOX_HOUSEHOLD)) {
            Path runRoot = tempDir.resolve("same-jvm-" + mode.propertyValue());
            Path measuredOutput = runRoot.resolve("measured");
            Path warmupRoot = runRoot.resolve("warmups");
            ProcessResult benchmark = runModel(configPath, measuredOutput, mode, 1, warmupRoot);
            assertSuccessful(benchmark);

            assertEquals(1, benchmark.output.lines()
                    .filter("BENCHMARK_PHASE phase=warmup index=1 count=1"::equals)
                    .count());
            assertEquals(1, benchmark.output.lines()
                    .filter("BENCHMARK_PHASE phase=measured index=1 count=1"::equals)
                    .count());
            assertTrue(benchmark.output.contains(
                    "BENCHMARK_METADATA sameJvmWarmupRuns=1 measuredSimulations=1 "
                            + "orderBook=array rngMode=" + mode.propertyValue()), benchmark.output);
            Matcher seconds = MEASURED_SECONDS.matcher(benchmark.output);
            assertTrue(seconds.find(), benchmark.output);
            assertTrue(Double.parseDouble(seconds.group(1)) > 0.0);
            assertFalse(seconds.find(), "measured timing must be emitted exactly once");

            Path warmupOutput = warmupRoot.resolve("warmup-001/model-output");
            assertOutputTreesEqual(warmupOutput, measuredOutput);
            if (mode == RngMode.MERSENNE) {
                assertOutputTreesEqual(standaloneOutput, measuredOutput);
            }
        }
    }

    @Test
    void benchmarkWarmupCountRejectsInvalidValues() {
        String original = System.getProperty(Model.BENCHMARK_WARMUP_RUNS_PROPERTY);
        try {
            System.setProperty(Model.BENCHMARK_WARMUP_RUNS_PROPERTY, "2");
            assertEquals(2, Model.benchmarkWarmupRuns());
            System.setProperty(Model.BENCHMARK_WARMUP_RUNS_PROPERTY, "-1");
            org.junit.jupiter.api.Assertions.assertThrows(
                    IllegalArgumentException.class, Model::benchmarkWarmupRuns);
            System.setProperty(Model.BENCHMARK_WARMUP_RUNS_PROPERTY, "not-an-integer");
            org.junit.jupiter.api.Assertions.assertThrows(
                    IllegalArgumentException.class, Model::benchmarkWarmupRuns);
        } finally {
            if (original == null) {
                System.clearProperty(Model.BENCHMARK_WARMUP_RUNS_PROPERTY);
            } else {
                System.setProperty(Model.BENCHMARK_WARMUP_RUNS_PROPERTY, original);
            }
        }
    }

    @Test
    void invalidBenchmarkWarmupCountFailsBeforeOutputHandling() throws Exception {
        Path configPath = writeTinyConfig(tempDir.resolve("invalid-benchmark.properties"));
        Path outputPath = tempDir.resolve("must-not-be-created");

        ProcessResult invalid = runModel(
                configPath, outputPath, RngMode.MERSENNE, -1, tempDir.resolve("unused"));

        assertNotEquals(0, invalid.exitCode, invalid.output);
        assertTrue(invalid.output.contains(Model.BENCHMARK_WARMUP_RUNS_PROPERTY), invalid.output);
        assertFalse(Files.exists(outputPath));
    }

    @Test
    void runtimeMetadataReportsResolvedTreeOrderBook() throws Exception {
        Path configPath = writeTinyConfig(tempDir.resolve("tree-runtime.properties"));
        ProcessResult tree = runModel(
                configPath,
                tempDir.resolve("tree-output"),
                RngMode.MERSENNE,
                null,
                null,
                "tree");

        assertSuccessful(tree);
        assertEquals(1, tree.output.lines()
                .filter("MODEL_RUNTIME_METADATA orderBook=tree"::equals)
                .count());
    }

    private static ProcessResult runModel(
            Path configPath,
            Path outputDir,
            RngMode mode,
            Integer warmupRuns,
            Path warmupRoot) throws Exception {
        return runModel(configPath, outputDir, mode, warmupRuns, warmupRoot, "array");
    }

    private static ProcessResult runModel(
            Path configPath,
            Path outputDir,
            RngMode mode,
            Integer warmupRuns,
            Path warmupRoot,
            String orderBook) throws Exception {
        ArrayList<String> command = new ArrayList<>();
        command.add(Path.of(System.getProperty("java.home"), "bin", "java").toString());
        command.add("-Dhousing.orderbook=" + orderBook);
        command.add("-D" + RngFactory.PROPERTY + "=" + mode.propertyValue());
        if (warmupRuns != null) {
            command.add("-D" + Model.BENCHMARK_WARMUP_RUNS_PROPERTY + "=" + warmupRuns);
        }
        if (warmupRuns != null && warmupRuns > 0) {
            command.add("-D" + Model.BENCHMARK_WARMUP_OUTPUT_ROOT_PROPERTY + "="
                    + warmupRoot.toAbsolutePath());
        }
        command.add("-cp");
        command.add(System.getProperty("java.class.path"));
        command.add("housing.Model");
        command.add("-configFile");
        command.add(configPath.toAbsolutePath().toString());
        command.add("-outputFolder");
        command.add(outputDir.toAbsolutePath().toString() + "/");
        command.add("-dev");

        ProcessBuilder processBuilder = new ProcessBuilder(command);
        processBuilder.directory(REPO_ROOT.toFile());
        processBuilder.redirectErrorStream(true);
        Process process = processBuilder.start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        int exitCode = process.waitFor();
        return new ProcessResult(exitCode, output);
    }

    private static void assertSuccessful(ProcessResult result) {
        assertEquals(0, result.exitCode, result.output);
    }

    private static void assertOutputTreesEqual(Path expectedRoot, Path actualRoot)
            throws IOException {
        Map<String, byte[]> expected = readOutputTree(expectedRoot);
        Map<String, byte[]> actual = readOutputTree(actualRoot);
        assertEquals(expected.keySet(), actual.keySet());
        for (String relativePath : expected.keySet()) {
            org.junit.jupiter.api.Assertions.assertArrayEquals(
                    expected.get(relativePath), actual.get(relativePath), relativePath);
        }
    }

    private static Map<String, byte[]> readOutputTree(Path root) throws IOException {
        Map<String, byte[]> files = new TreeMap<>();
        try (Stream<Path> paths = Files.walk(root)) {
            for (Path path : paths.filter(Files::isRegularFile).toList()) {
                files.put(root.relativize(path).toString(), Files.readAllBytes(path));
            }
        }
        return files;
    }

    private static Path writeTinyConfig(Path outputPath) throws IOException {
        String configText = Files.readString(
                REPO_ROOT.resolve("src/main/resources/config.properties"), StandardCharsets.UTF_8);
        configText = replaceSetting(configText, "SEED", "1");
        configText = replaceSetting(configText, "N_STEPS", "24");
        configText = replaceSetting(configText, "N_SIMS", "1");
        configText = replaceSetting(configText, "TARGET_POPULATION", "200");
        configText = replaceSetting(configText, "TIME_TO_START_RECORDING_TRANSACTIONS", "24");
        for (String key : List.of(
                "recordTransactions", "recordNBidUpFrequency", "recordCoreIndicators",
                "recordQualityBandPrice", "recordHouseholdID", "recordEmploymentIncome",
                "recordRentalIncome", "recordBankBalance", "recordHousingWealth",
                "recordTotalDebt", "recordHousingStatus", "recordConsumption",
                "recordNHousesOwned", "recordAge", "recordSavingRate",
                "enableBTLAmortizingMortgageMode", "enableBTLDownpaymentLognormal",
                "enableBTLAlternativeReturn")) {
            configText = replaceSetting(configText, key, "false");
        }
        Files.writeString(outputPath, configText, StandardCharsets.UTF_8);
        return outputPath;
    }

    private static String replaceSetting(String text, String key, String value) {
        Pattern pattern = Pattern.compile("(?m)^" + Pattern.quote(key) + " = .*?$");
        Matcher matcher = pattern.matcher(text);
        assertTrue(matcher.find(), "Missing config key: " + key);
        return matcher.replaceFirst(Matcher.quoteReplacement(key + " = " + value));
    }

    private record ProcessResult(int exitCode, String output) { }
}
