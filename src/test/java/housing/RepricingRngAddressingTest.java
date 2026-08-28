package housing;

import java.lang.reflect.Field;
import java.nio.file.Path;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

/** Address and transform coverage for Philox-backed sale and rental repricing. */
class RepricingRngAddressingTest {

    private static final String CONFIG_PATH = "src/main/resources/config.properties";
    private static final int SEED = 123;
    private static final int SIMULATION = 3;
    private static final int TIME_STEP = 21;

    @TempDir
    Path tempDir;

    private Household household;
    private House house;
    private RngContext context;

    @BeforeEach
    void setUp() throws Exception {
        new Model(CONFIG_PATH, tempDir.toString() + "/");
        Model.housingMarketStats.init();
        Model.rentalMarketStats.init();
        setBehaviourStatic("config", Model.config);
        setBehaviourStatic("housingMarketStats", Model.housingMarketStats);
        setBehaviourStatic("rentalMarketStats", Model.rentalMarketStats);
        Household.resetIdPoolForNewSimulation();
        House.resetIdPoolForNewSimulation();
        RngContext creation = RngFactory.create(SEED, RngMode.MERSENNE)
                .demographicsContext(0, 0);
        household = new Household(creation, 42.0);
        house = new House(3);
        context = RngFactory.create(SEED, RngMode.PHILOX_HOUSEHOLD)
                .householdLoopContext(SIMULATION, TIME_STEP);
    }

    @Test
    void saleRepricingUsesHouseTriggerZeroAndAs241MagnitudeOne() {
        Model.config.P_SALE_PRICE_REDUCE = 1.0;
        Model.config.REDUCTION_MU = -0.7;
        Model.config.REDUCTION_SIGMA = 0.3;
        HouseOfferRecord offer = new HouseOfferRecord(house, 250_000.0, false, 0);
        double normal = addressedNormal(RandomEvent.SALE_REPRICE);
        double expected = offer.getPrice() * Math.max(
                1.0 - Math.exp(-0.7 + 0.3 * normal) / 100.0, 0.5);

        assertEquals(expected,
                household.behaviour.rethinkHouseSalePrice(context, house, offer), 0.0);
    }

    @Test
    void rentRepricingUsesASeparateHouseEventWithTheSameTwoSubcounters() {
        Model.config.P_RENT_PRICE_REDUCE = 1.0;
        Model.config.RENT_REDUCTION_MU = -0.4;
        Model.config.RENT_REDUCTION_SIGMA = 0.2;
        HouseOfferRecord offer = new HouseOfferRecord(house, 1_500.0, false, 0);
        double rentNormal = addressedNormal(RandomEvent.RENT_REPRICE);
        double expected = offer.getPrice() * Math.max(
                1.0 - Math.exp(-0.4 + 0.2 * rentNormal) / 100.0, 0.5);

        assertNotEquals(Double.doubleToRawLongBits(addressedNormal(RandomEvent.SALE_REPRICE)),
                Double.doubleToRawLongBits(rentNormal));
        assertEquals(expected,
                household.behaviour.rethinkHouseRentPrice(context, house, offer), 0.0);
    }

    private double addressedNormal(RandomEvent event) {
        return new PhiloxAddressedRandom().normal(
                SEED, SIMULATION, TIME_STEP, house.id, event.id(), 1);
    }

    private static void setBehaviourStatic(String name, Object value) throws Exception {
        Field field = HouseholdBehaviour.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(null, value);
    }
}
