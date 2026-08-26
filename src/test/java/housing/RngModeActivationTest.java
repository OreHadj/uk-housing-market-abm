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
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RngModeActivationTest {

    private static final Path REPO_ROOT = Paths.get("").toAbsolutePath();
    private static final String EXPECTED_MERSENNE_METADATA =
            "RNG_METADATA rngAlgorithm=MersenneTwister rngAddressVersion=none "
                    + "masterSeed=123 rngMode=mersenne";

    @TempDir
    Path tempDir;

    @Test
    void invalidAndRecognizedInactiveModesFailBeforeOutputSideEffects() throws Exception {
        Path config = writeTinyConfig(tempDir.resolve("tiny.properties"));

        assertRejectedWithoutTouchingExistingOutput(config, "not-a-mode", "invalid");
        assertRejectedWithoutTouchingExistingOutput(
                config, RngMode.PHILOX_HOUSEHOLD.propertyValue(), "inactive");
        assertRejectedWithoutTouchingExistingOutput(
                config, RngMode.PHILOX.propertyValue(), "inactive-full");
        assertRejectedWithoutCreatingOutput(config, "not-a-mode", "invalid-absent");
        assertRejectedWithoutCreatingOutput(
                config, RngMode.PHILOX_HOUSEHOLD.propertyValue(), "inactive-absent");
        assertRejectedWithoutCreatingOutput(
                config, RngMode.PHILOX.propertyValue(), "inactive-full-absent");
    }

    @Test
    void tinyMersenneRunPrintsOneMetadataLineWithoutChangingOutputManifest() throws Exception {
        Path config = writeTinyConfig(tempDir.resolve("tiny.properties"));
        Path output = tempDir.resolve("mersenne-output");
        ProcessResult result = runModel(config, output, RngMode.MERSENNE.propertyValue());

        assertEquals(0, result.exitCode,
                () -> "Child output:\n" + result.output);
        List<String> metadataLines = result.output.lines()
                .filter(line -> line.startsWith("RNG_METADATA "))
                .collect(Collectors.toList());
        assertEquals(List.of(EXPECTED_MERSENNE_METADATA), metadataLines);

        try (Stream<Path> files = Files.list(output)) {
            Set<String> names = files
                    .map(path -> path.getFileName().toString())
                    .collect(Collectors.toSet());
            assertEquals(Set.of("tiny.properties", "Output-run1.csv"), names,
                    "RNG metadata belongs on stdout, not in the model output manifest");
        }
    }

    private void assertRejectedWithoutTouchingExistingOutput(
            Path config, String mode, String directoryName) throws Exception {
        Path output = tempDir.resolve(directoryName);
        Files.createDirectories(output);
        Path sentinel = output.resolve("sentinel.txt");
        Files.writeString(sentinel, "preserve me", StandardCharsets.UTF_8);

        ProcessResult result = runModel(config, output, mode);

        assertNotEquals(0, result.exitCode,
                () -> "Mode unexpectedly ran: " + mode + "\n" + result.output);
        assertEquals("preserve me", Files.readString(sentinel, StandardCharsets.UTF_8));
        try (Stream<Path> files = Files.list(output)) {
            assertEquals(List.of("sentinel.txt"), files
                    .map(path -> path.getFileName().toString())
                    .sorted()
                    .collect(Collectors.toList()),
                    "Mode validation occurred after output-folder side effects: " + mode);
        }
        assertTrue(result.output.contains(mode),
                () -> "Failure did not identify mode '" + mode + "':\n" + result.output);
    }

    private void assertRejectedWithoutCreatingOutput(
            Path config, String mode, String directoryName) throws Exception {
        Path output = tempDir.resolve(directoryName);
        assertFalse(Files.exists(output));

        ProcessResult result = runModel(config, output, mode);

        assertNotEquals(0, result.exitCode,
                () -> "Mode unexpectedly ran: " + mode + "\n" + result.output);
        assertFalse(Files.exists(output),
                "Mode validation occurred after output-folder creation: " + mode);
        assertTrue(result.output.contains(mode),
                () -> "Failure did not identify mode '" + mode + "':\n" + result.output);
    }

    private static Path writeTinyConfig(Path outputPath) throws IOException {
        String config = Files.readString(
                REPO_ROOT.resolve("src/main/resources/config.properties"), StandardCharsets.UTF_8);
        config = replaceSetting(config, "SEED", "123");
        config = replaceSetting(config, "N_STEPS", "0");
        config = replaceSetting(config, "N_SIMS", "1");
        config = replaceSetting(config, "TARGET_POPULATION", "1000");
        config = replaceSetting(config, "TIME_TO_START_RECORDING_TRANSACTIONS", "0");
        config = replaceSetting(config, "recordTransactions", "false");
        config = replaceSetting(config, "recordNBidUpFrequency", "false");
        config = replaceSetting(config, "recordCoreIndicators", "false");
        config = replaceSetting(config, "recordQualityBandPrice", "false");
        config = replaceSetting(config, "recordHouseholdID", "false");
        config = replaceSetting(config, "recordEmploymentIncome", "false");
        config = replaceSetting(config, "recordRentalIncome", "false");
        config = replaceSetting(config, "recordBankBalance", "false");
        config = replaceSetting(config, "recordHousingWealth", "false");
        config = replaceSetting(config, "recordTotalDebt", "false");
        config = replaceSetting(config, "recordHousingStatus", "false");
        config = replaceSetting(config, "recordConsumption", "false");
        config = replaceSetting(config, "recordNHousesOwned", "false");
        config = replaceSetting(config, "recordAge", "false");
        config = replaceSetting(config, "recordSavingRate", "false");
        config = replaceSetting(config, "enableBTLAmortizingMortgageMode", "false");
        config = replaceSetting(config, "enableBTLDownpaymentLognormal", "false");
        config = replaceSetting(config, "enableBTLAlternativeReturn", "false");
        Files.writeString(outputPath, config, StandardCharsets.UTF_8);
        return outputPath;
    }

    private static String replaceSetting(String text, String key, String value) {
        Pattern pattern = Pattern.compile("(?m)^" + Pattern.quote(key) + " = .*?$");
        Matcher matcher = pattern.matcher(text);
        assertTrue(matcher.find(), "Missing config key: " + key);
        return matcher.replaceFirst(Matcher.quoteReplacement(key + " = " + value));
    }

    private static ProcessResult runModel(Path config, Path output, String mode) throws Exception {
        ProcessBuilder processBuilder = new ProcessBuilder(
                Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-Dhousing.orderbook=array",
                "-D" + RngFactory.PROPERTY + "=" + mode,
                "-cp",
                System.getProperty("java.class.path"),
                "housing.Model",
                "-configFile",
                config.toAbsolutePath().toString(),
                "-outputFolder",
                output.toAbsolutePath().toString(),
                "-dev");
        processBuilder.directory(REPO_ROOT.toFile());
        processBuilder.redirectErrorStream(true);

        Process process = processBuilder.start();
        String childOutput = readStream(process.getInputStream());
        int exitCode = process.waitFor();
        return new ProcessResult(exitCode, childOutput);
    }

    private static String readStream(InputStream stream) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4_096];
        int read;
        while ((read = stream.read(buffer)) != -1) {
            output.write(buffer, 0, read);
        }
        return output.toString(StandardCharsets.UTF_8.name());
    }

    private static final class ProcessResult {
        private final int exitCode;
        private final String output;

        private ProcessResult(int exitCode, String output) {
            this.exitCode = exitCode;
            this.output = output;
        }
    }
}
