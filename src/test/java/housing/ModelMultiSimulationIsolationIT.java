package housing;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Slow, explicit-only regression coverage for multi-simulation isolation.
 *
 * @author Max Stoddard
 */
@Tag("slow")
class ModelMultiSimulationIsolationIT {

    private static final Path REPO_ROOT = Paths.get("").toAbsolutePath();

    @TempDir
    Path tempDir;

    @Test
    void multiSimulationRunMatchesSeparateSeededRuns() throws Exception {
        Path combinedConfig = writeTinyConfig(tempDir.resolve("combined.properties"), 1, 2);
        Path isolatedSeedOneConfig = writeTinyConfig(tempDir.resolve("isolated-seed-1.properties"), 1, 1);
        Path isolatedSeedTwoConfig = writeTinyConfig(tempDir.resolve("isolated-seed-2.properties"), 2, 1);

        Path combinedOutput = tempDir.resolve("combined");
        Path isolatedSeedOneOutput = tempDir.resolve("isolated-seed-1");
        Path isolatedSeedTwoOutput = tempDir.resolve("isolated-seed-2");

        assertSuccessful(runModel(combinedConfig, combinedOutput));
        assertSuccessful(runModel(isolatedSeedOneConfig, isolatedSeedOneOutput));
        assertSuccessful(runModel(isolatedSeedTwoConfig, isolatedSeedTwoOutput));

        assertSameFile(isolatedSeedOneOutput.resolve("Output-run1.csv"), combinedOutput.resolve("Output-run1.csv"));
        assertSameFile(isolatedSeedOneOutput.resolve("HouseholdID-run1.csv"),
                combinedOutput.resolve("HouseholdID-run1.csv"));
        assertSameFile(isolatedSeedTwoOutput.resolve("Output-run1.csv"), combinedOutput.resolve("Output-run2.csv"));
        assertSameFile(isolatedSeedTwoOutput.resolve("HouseholdID-run1.csv"),
                combinedOutput.resolve("HouseholdID-run2.csv"));
    }

    private static Path writeTinyConfig(Path outputPath, int seed, int nSims) throws IOException {
        String configText = Files.readString(REPO_ROOT.resolve("src/main/resources/config.properties"),
                StandardCharsets.UTF_8);
        configText = replaceSetting(configText, "SEED", Integer.toString(seed));
        configText = replaceSetting(configText, "N_STEPS", "996");
        configText = replaceSetting(configText, "N_SIMS", Integer.toString(nSims));
        configText = replaceSetting(configText, "TARGET_POPULATION", "1000");
        configText = replaceSetting(configText, "TIME_TO_START_RECORDING_TRANSACTIONS", "996");
        configText = replaceSetting(configText, "recordTransactions", "false");
        configText = replaceSetting(configText, "recordNBidUpFrequency", "false");
        configText = replaceSetting(configText, "recordCoreIndicators", "false");
        configText = replaceSetting(configText, "recordQualityBandPrice", "false");
        configText = replaceSetting(configText, "recordHouseholdID", "true");
        configText = replaceSetting(configText, "recordEmploymentIncome", "false");
        configText = replaceSetting(configText, "recordRentalIncome", "false");
        configText = replaceSetting(configText, "recordBankBalance", "false");
        configText = replaceSetting(configText, "recordHousingWealth", "false");
        configText = replaceSetting(configText, "recordTotalDebt", "false");
        configText = replaceSetting(configText, "recordHousingStatus", "false");
        configText = replaceSetting(configText, "recordConsumption", "false");
        configText = replaceSetting(configText, "recordNHousesOwned", "false");
        configText = replaceSetting(configText, "recordAge", "false");
        configText = replaceSetting(configText, "recordSavingRate", "false");
        configText = replaceSetting(configText, "enableBTLAmortizingMortgageMode", "false");
        configText = replaceSetting(configText, "enableBTLDownpaymentLognormal", "false");
        configText = replaceSetting(configText, "enableBTLAlternativeReturn", "false");
        Files.writeString(outputPath, configText, StandardCharsets.UTF_8);
        return outputPath;
    }

    private static String replaceSetting(String text, String key, String value) {
        Pattern pattern = Pattern.compile("(?m)^" + Pattern.quote(key) + " = .*?$");
        Matcher matcher = pattern.matcher(text);
        assertTrue(matcher.find(), "Missing config key: " + key);
        return matcher.replaceFirst(Matcher.quoteReplacement(key + " = " + value));
    }

    private static void assertSuccessful(ProcessResult result) {
        assertEquals(0, result.exitCode, () -> "STDOUT:\n" + result.stdout + "\nSTDERR:\n" + result.stderr);
    }

    private static void assertSameFile(Path expected, Path actual) throws IOException {
        assertEquals(Files.readString(expected, StandardCharsets.UTF_8),
                Files.readString(actual, StandardCharsets.UTF_8),
                () -> "File differs from isolated run: " + actual.getFileName());
    }

    private static ProcessResult runModel(Path configPath, Path outputDir) throws Exception {
        Files.createDirectories(outputDir);
        ProcessBuilder processBuilder = new ProcessBuilder(
                Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-Dhousing.orderbook=array",
                "-cp",
                System.getProperty("java.class.path"),
                "housing.Model",
                "-configFile",
                configPath.toAbsolutePath().toString(),
                "-outputFolder",
                outputDir.toAbsolutePath().toString() + "/",
                "-dev"
        );
        processBuilder.directory(REPO_ROOT.toFile());
        Process process = processBuilder.start();
        String stdout = readStream(process.getInputStream());
        String stderr = readStream(process.getErrorStream());
        int exitCode = process.waitFor();
        return new ProcessResult(exitCode, stdout, stderr);
    }

    private static String readStream(InputStream stream) throws IOException {
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int read;
        while ((read = stream.read(buffer)) != -1) {
            outputStream.write(buffer, 0, read);
        }
        return outputStream.toString(StandardCharsets.UTF_8.name());
    }

    private static final class ProcessResult {
        private final int exitCode;
        private final String stdout;
        private final String stderr;

        private ProcessResult(int exitCode, String stdout, String stderr) {
            this.exitCode = exitCode;
            this.stdout = stdout;
            this.stderr = stderr;
        }
    }
}
