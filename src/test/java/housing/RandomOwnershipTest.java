package housing;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Parameter;
import java.nio.file.Path;

import org.apache.commons.math3.distribution.AbstractRealDistribution;
import org.apache.commons.math3.distribution.LogNormalDistribution;
import org.apache.commons.math3.random.MersenneTwister;
import org.apache.commons.math3.random.RandomGenerator;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

class RandomOwnershipTest {

    private static final String CONFIG_PATH = "src/main/resources/config.properties";

    @TempDir
    Path tempDir;

    @Test
    void modelOwnsOnePrivateFacadeAndNoConsumerStoresTheRawGenerator() throws Exception {
        Field modelRandom = Model.class.getDeclaredField("prng");
        assertEquals(RandomGenerator.class, modelRandom.getType());
        assertFalse(Modifier.isPublic(modelRandom.getModifiers()));
        assertFalse(Modifier.isProtected(modelRandom.getModifiers()));

        Class<?>[] consumers = {
                Model.class,
                Demographics.class,
                Construction.class,
                HousingMarket.class,
                HouseSaleMarket.class,
                HouseRentalMarket.class,
                Household.class,
                HouseholdBehaviour.class
        };
        for (Class<?> consumer : consumers) {
            for (Field field : consumer.getDeclaredFields()) {
                assertFalse(MersenneTwister.class.isAssignableFrom(field.getType()),
                        () -> consumer.getName() + "." + field.getName() + " stores raw Mersenne state");
            }
        }

        Field[] facadeFields = MersenneRandom.class.getDeclaredFields();
        assertEquals(1, facadeFields.length);
        assertSame(MersenneTwister.class, facadeFields[0].getType());
    }

    @Test
    void householdsAndBehavioursRetainNoRandomServiceReference() {
        assertStoresNoRandomService(Household.class);
        assertStoresNoRandomService(HouseholdBehaviour.class);
    }

    @Test
    void modelConsumersDependOnTheRandomGeneratorInterface() throws Exception {
        Class<?>[] consumers = {
                Model.class,
                Demographics.class,
                Construction.class,
                HousingMarket.class,
                HouseSaleMarket.class,
                HouseRentalMarket.class,
                Household.class,
                HouseholdBehaviour.class,
                IHouseOwner.class
        };
        for (Class<?> consumer : consumers) {
            for (Field field : consumer.getDeclaredFields()) {
                assertFalse(field.getType() == MersenneRandom.class,
                        () -> consumer.getName() + "." + field.getName() + " leaks the concrete facade");
            }
            for (Method method : consumer.getDeclaredMethods()) {
                assertFalse(method.getReturnType() == MersenneRandom.class,
                        () -> consumer.getName() + "." + method.getName() + " returns the concrete facade");
                assertNoConcreteFacadeParameter(consumer, method.getName(), method.getParameters());
            }
            for (var constructor : consumer.getDeclaredConstructors()) {
                assertNoConcreteFacadeParameter(consumer, "<init>", constructor.getParameters());
            }
        }

        assertSame(RandomGenerator.class,
                RngFactory.class.getDeclaredMethod("create", int.class).getReturnType());
    }

    @Test
    void inverseCdfOnlyLognormalObjectsRetainNoGenerator() throws Exception {
        new Model(CONFIG_PATH, tempDir.toString() + "/");

        assertDistributionHasNoGenerator(staticDistribution(HouseholdBehaviour.class,
                "downpaymentDistFTB"));
        assertDistributionHasNoGenerator(staticDistribution(HouseholdBehaviour.class,
                "downpaymentDistOO"));

        Household household = new Household(new MersenneRandom(17), 35.0);
        Method btlDistribution = HouseholdBehaviour.class.getDeclaredMethod("getBTLDownpaymentDist");
        btlDistribution.setAccessible(true);
        assertDistributionHasNoGenerator((LogNormalDistribution) btlDistribution.invoke(household.behaviour));

    }

    private static void assertStoresNoRandomService(Class<?> type) {
        for (Field field : type.getDeclaredFields()) {
            assertFalse(RandomGenerator.class.isAssignableFrom(field.getType()),
                    () -> type.getName() + "." + field.getName() + " retains an RNG facade");
        }
    }

    private static void assertNoConcreteFacadeParameter(Class<?> owner, String member,
            Parameter[] parameters) {
        for (Parameter parameter : parameters) {
            assertFalse(parameter.getType() == MersenneRandom.class,
                    () -> owner.getName() + "." + member + " accepts the concrete facade");
        }
    }

    private static LogNormalDistribution staticDistribution(Class<?> owner, String fieldName)
            throws Exception {
        Field field = owner.getDeclaredField(fieldName);
        field.setAccessible(true);
        return (LogNormalDistribution) field.get(null);
    }

    private static void assertDistributionHasNoGenerator(LogNormalDistribution distribution)
            throws Exception {
        Field random = AbstractRealDistribution.class.getDeclaredField("random");
        random.setAccessible(true);
        assertNull(random.get(distribution));
    }
}
