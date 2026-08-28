package housing;

import java.nio.file.Path;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class EntityIdReservationTest {

    private static final String CONFIG_PATH = "src/main/resources/config.properties";

    @TempDir
    Path tempDir;

    private RandomService randomService;

    @BeforeEach
    void setUp() {
        new Model(CONFIG_PATH, tempDir.toString() + "/");
        Household.resetIdPoolForNewSimulation();
        House.resetIdPoolForNewSimulation();
        randomService = RngFactory.create(123, RngMode.MERSENNE);
    }

    @Test
    void prospectiveHouseholdIdsAreGaplessUniqueAndClaimedExactlyOnce() {
        RngContext context = randomService.demographicsContext(0, 0);

        Household.IdReservation firstReservation = Household.reserveId();
        context.uniform(firstReservation, RandomEvent.HH_AGE_AT_CREATION);
        Household first = new Household(firstReservation, context, 31.0);
        Household second = new Household(context, 32.0);
        Household.IdReservation thirdReservation = Household.reserveId();
        Household third = new Household(thirdReservation, context, 33.0);

        assertEquals(1, first.id);
        assertEquals(2, second.id);
        assertEquals(3, third.id);
        assertThrows(IllegalStateException.class,
                () -> new Household(firstReservation, context, 34.0));
        assertEquals(4, new Household(context, 35.0).id);
    }

    @Test
    void prospectiveHouseIdsAreGaplessUniqueAndClaimedExactlyOnce() {
        RngContext context = randomService.constructionContext(0, 0);

        House.IdReservation firstReservation = House.reserveId();
        int quality = context.boundedInt(
                firstReservation, RandomEvent.NEW_BUILD_QUALITY, 10);
        House first = new House(firstReservation, quality);
        House second = new House(2);
        House.IdReservation thirdReservation = House.reserveId();
        House third = new House(thirdReservation, 3);

        assertEquals(1, first.id);
        assertEquals(2, second.id);
        assertEquals(3, third.id);
        assertThrows(IllegalStateException.class,
                () -> new House(firstReservation, 4));
        assertEquals(4, new House(5).id);
    }

    @Test
    void resetRestoresTheExactRunLocalStartingIds() {
        RngContext demographics = randomService.demographicsContext(0, 0);
        new Household(demographics, 40.0);
        new House(0);

        Household.resetIdPoolForNewSimulation();
        House.resetIdPoolForNewSimulation();

        assertEquals(1, new Household(demographics, 41.0).id);
        assertEquals(1, new House(1).id);
    }

    @Test
    void aSecondReservationCannotBypassAnUnclaimedId() {
        Household.reserveId();
        assertThrows(IllegalStateException.class, Household::reserveId);
        Household.resetIdPoolForNewSimulation();

        House.reserveId();
        assertThrows(IllegalStateException.class, House::reserveId);
        House.resetIdPoolForNewSimulation();
    }

    @Test
    void rngIdentityFieldsArePublicFinalAndRetainTheirAllocatedValues() throws Exception {
        Field householdId = Household.class.getField("id");
        Field houseId = House.class.getField("id");
        RngContext context = randomService.demographicsContext(0, 0);
        Household household = new Household(context, 38.0);
        House house = new House(4);

        assertEquals(int.class, householdId.getType());
        assertEquals(int.class, houseId.getType());
        assertEquals(Modifier.PUBLIC | Modifier.FINAL,
                householdId.getModifiers() & (Modifier.PUBLIC | Modifier.FINAL));
        assertEquals(Modifier.PUBLIC | Modifier.FINAL,
                houseId.getModifiers() & (Modifier.PUBLIC | Modifier.FINAL));
        assertEquals(household.id, householdId.getInt(household));
        assertEquals(house.id, houseId.getInt(house));
        assertEquals(0, house.compareTo(house));
    }
}
