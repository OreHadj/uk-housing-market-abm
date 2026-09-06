package housing;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RngContextArchitectureTest {

    private static final Path SOURCE_ROOT = Path.of("src/main/java/housing");

    @Test
    void everyProductionListingRouteUsesTheTwoHouseholdHelpers() throws IOException {
        String household = source("Household.java");
        assertEquals(1, occurrences(household, "Model.houseSaleMarket.offer("));
        assertEquals(1, occurrences(household, "Model.houseRentalMarket.offer("));
        assertEquals(1, occurrences(household, "h.allocateSaleListingEpisode()"));
        assertEquals(1, occurrences(household, "h.allocateRentListingEpisode()"));

        for (Path path : productionJavaFiles()) {
            if (!path.getFileName().toString().equals("Household.java")) {
                String source = Files.readString(path);
                assertFalse(source.contains("Model.houseSaleMarket.offer("), path.toString());
                assertFalse(source.contains("Model.houseRentalMarket.offer("), path.toString());
            }
        }

        assertTrue(household.contains("private void putHouseForSale(House h, RngContext context)"));
        assertTrue(household.contains("private void putHouseForRent(House h, RngContext context)"));
    }

    @Test
    void offerTimestampAndListingAgeUseTheSameExplicitContextTimeStep() throws IOException {
        String record = source("HouseOfferRecord.java");
        String household = source("Household.java");
        int manageStart = household.indexOf("private void manageHouse(");
        int saleHelperStart = household.indexOf("private void putHouseForSale(");
        String manageHouse = household.substring(manageStart, saleHelperStart);

        assertFalse(record.contains("Model.getTime()"));
        assertTrue(record.contains("tInitialListing = initialListingTime;"));
        assertEquals(2, occurrences(manageHouse,
                "context.timeStep() >"));
        assertFalse(manageHouse.contains("Model.getTime()"));
        assertEquals(2, occurrences(household, "context.timeStep());"));
    }

    @Test
    void modelCreatesOneHouseholdLoopContextAndSharesItAcrossTheWholeLoop()
            throws IOException {
        String model = source("Model.java");

        assertEquals(1, occurrences(model, "randomService.householdLoopContext("));
        assertTrue(model.contains("for (Household h : households) {"));
        assertEquals(1, occurrences(model, "h.step(householdLoopContext);"));
    }

    @Test
    void nestedCallbacksCannotReplaceTheirOriginalPhaseOrigin() throws IOException {
        for (Path path : productionJavaFiles()) {
            String fileName = path.getFileName().toString();
            if (!fileName.equals("Model.java") && !fileName.equals("RandomService.java")) {
                String source = Files.readString(path);
                assertFalse(source.contains("demographicsContext("), path.toString());
                assertFalse(source.contains("constructionContext("), path.toString());
                assertFalse(source.contains("householdLoopContext("), path.toString());
                assertFalse(source.contains("saleClearingContext("), path.toString());
                assertFalse(source.contains("rentClearingContext("), path.toString());
            }
        }

        assertTrue(source("HouseSaleMarket.java").contains(
                "sale, purchase.getDesiredDownPayment(), context"));
        assertTrue(source("Household.java").contains(
                "h.owner.endOfLettingAgreement(h, housePayments.get(h), context);"));
        assertTrue(source("Household.java").contains(
                "beneficiary.inheritHouse("));
    }

    private static List<Path> productionJavaFiles() throws IOException {
        try (var paths = Files.list(SOURCE_ROOT)) {
            return paths.filter(path -> path.getFileName().toString().endsWith(".java"))
                    .toList();
        }
    }

    private static String source(String fileName) throws IOException {
        return Files.readString(SOURCE_ROOT.resolve(fileName));
    }

    private static int occurrences(String text, String needle) {
        int count = 0;
        int offset = 0;
        while ((offset = text.indexOf(needle, offset)) >= 0) {
            count++;
            offset += needle.length();
        }
        return count;
    }
}
