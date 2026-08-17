package housing;

import org.apache.commons.math3.random.RandomGenerator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;

class UkAccountingAndHousingWealthCompatibilityTest {

    private static final double TOLERANCE = 1.0e-9;
    private static final String CONFIG_PATH = "src/main/resources/config.properties";

    @TempDir
    Path tempDir;

    private RandomGenerator prng;

    @BeforeEach
    void setUpModel() {
        new Model(CONFIG_PATH, tempDir.toString() + "/");
        prng = RngFactory.create(123);
        Model.t = 996;
        Model.housingMarketStats.init();
        Model.rentalMarketStats.init();
        Model.householdStats.init();
    }

    @Test
    void incomeTaxDueMatchesUk2025To2026BandsAndAllowanceTaper() {
        Government government = new Government();

        assertAll(
                () -> assertEquals(0.0, government.incomeTaxDue(12_570.0), TOLERANCE),
                () -> assertEquals(7_540.0, government.incomeTaxDue(50_270.0), TOLERANCE),
                () -> assertEquals(33_432.0, government.incomeTaxDue(110_000.0), TOLERANCE),
                () -> assertEquals(42_516.0, government.incomeTaxDue(125_140.0), TOLERANCE),
                () -> assertEquals(53_703.0, government.incomeTaxDue(150_000.0), TOLERANCE)
        );
    }

    @Test
    void class1NicsUseAnnualPrimaryAndUpperThresholds() {
        Government government = new Government();

        assertAll(
                () -> assertEquals(0.0, government.class1NICsDue(12_584.0), TOLERANCE),
                () -> assertEquals(0.12, government.class1NICsDue(12_585.0), TOLERANCE),
                () -> assertEquals(4_524.0, government.class1NICsDue(50_284.0), TOLERANCE),
                () -> assertEquals(4_718.32, government.class1NICsDue(60_000.0), TOLERANCE)
        );
    }

    @Test
    void housingWealthMicroOutputMatchesLegacyMarkToMarketFixture() throws Exception {
        Household household = new Household(prng, 40.0);
        House home = new House(0);
        House investment = new House(1);
        MortgageAgreement homeMortgage = mortgageAgreement(household, 100_000.0);
        MortgageAgreement investmentMortgage = mortgageAgreement(household, 40_000.0);

        setField(household, "annualGrossEmploymentIncome", 0.0);
        setField(household, "monthlyGrossEmploymentIncome", 0.0);
        setField(household, "bankBalance", 0.0);
        setField(household, "home", home);

        home.owner = household;
        home.resident = household;
        investment.owner = household;

        household.getHousePayments().put(home, homeMortgage);
        household.getHousePayments().put(investment, investmentMortgage);

        Model.households = new ArrayList<>();
        Model.households.add(household);

        double[] expAvSalePricePerQuality = Model.housingMarketStats.getExpAvSalePricePerQuality().clone();
        expAvSalePricePerQuality[0] = 180_000.0;
        expAvSalePricePerQuality[1] = 260_000.0;
        setField(Model.housingMarketStats, "expAvSalePricePerQuality", expAvSalePricePerQuality);

        Model.microDataRecorder.openSingleRunSingleVariableFiles(1,
                Model.config.recordHouseholdID,
                Model.config.recordEmploymentIncome,
                Model.config.recordRentalIncome,
                Model.config.recordBankBalance,
                Model.config.recordHousingWealth,
                Model.config.recordTotalDebt,
                Model.config.recordNHousesOwned,
                Model.config.recordHousingStatus,
                Model.config.recordAge,
                Model.config.recordConsumption,
                Model.config.recordSavingRate);

        Model.householdStats.record();

        Model.microDataRecorder.finishRun(
                Model.config.recordHouseholdID,
                Model.config.recordEmploymentIncome,
                Model.config.recordRentalIncome,
                Model.config.recordBankBalance,
                Model.config.recordHousingWealth,
                Model.config.recordTotalDebt,
                Model.config.recordNHousesOwned,
                Model.config.recordHousingStatus,
                Model.config.recordAge,
                Model.config.recordConsumption,
                Model.config.recordSavingRate);

        assertEquals(
                readResourceLines("uk-observability/baseline/HousingWealth-run1.csv"),
                Files.readAllLines(tempDir.resolve("HousingWealth-run1.csv"), StandardCharsets.UTF_8));
    }

    private static MortgageAgreement mortgageAgreement(Household borrower, double principal) {
        MortgageAgreement mortgage = new MortgageAgreement(borrower, false);
        mortgage.principal = principal;
        mortgage.monthlyPayment = 0.0;
        mortgage.downPayment = 0.0;
        mortgage.monthlyInterestRate = 0.0;
        mortgage.nPayments = 360;
        return mortgage;
    }

    private static List<String> readResourceLines(String resourcePath) throws IOException {
        InputStream stream = UkAccountingAndHousingWealthCompatibilityTest.class
                .getClassLoader()
                .getResourceAsStream(resourcePath);
        Objects.requireNonNull(stream, "Missing test resource: " + resourcePath);

        List<String> lines = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line = reader.readLine();
            while (line != null) {
                lines.add(line);
                line = reader.readLine();
            }
        }
        return lines;
    }

    private static void setField(Object target, String fieldName, Object value) throws Exception {
        Field field = findField(target.getClass(), fieldName);
        field.setAccessible(true);
        field.set(target, value);
    }

    private static Field findField(Class<?> type, String fieldName) throws NoSuchFieldException {
        Class<?> current = type;
        while (current != null) {
            try {
                return current.getDeclaredField(fieldName);
            } catch (NoSuchFieldException error) {
                current = current.getSuperclass();
            }
        }
        throw new NoSuchFieldException(fieldName);
    }
}
