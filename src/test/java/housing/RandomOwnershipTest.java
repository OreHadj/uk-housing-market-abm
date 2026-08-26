package housing;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Parameter;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

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
import static org.junit.jupiter.api.Assertions.assertTrue;

class RandomOwnershipTest {

    private static final String CONFIG_PATH = "src/main/resources/config.properties";

    @TempDir
    Path tempDir;

    @Test
    void modelOwnsOnePrivateServiceAndConsumersStoreNoBackend() throws Exception {
        Field modelRandom = Model.class.getDeclaredField("randomService");
        assertEquals(RandomService.class, modelRandom.getType());
        assertTrue(Modifier.isPrivate(modelRandom.getModifiers()));
        assertTrue(Modifier.isStatic(modelRandom.getModifiers()));

        Class<?>[] consumers = modelConsumers();
        for (Class<?> consumer : consumers) {
            for (Field field : consumer.getDeclaredFields()) {
                if (consumer == Model.class && field.getName().equals("randomService")) {
                    continue;
                }
                assertFalse(RandomService.class.isAssignableFrom(field.getType()),
                        () -> consumer.getName() + "." + field.getName() + " stores RNG service");
                assertFalse(RandomGenerator.class.isAssignableFrom(field.getType()),
                        () -> consumer.getName() + "." + field.getName() + " stores raw RNG");
                assertFalse(AddressedRandom.class.isAssignableFrom(field.getType()),
                        () -> consumer.getName() + "." + field.getName()
                                + " stores addressed RNG");
            }
        }

        Field[] facadeFields = MersenneRandom.class.getDeclaredFields();
        assertEquals(1, facadeFields.length);
        assertSame(MersenneTwister.class, facadeFields[0].getType());

        assertEquals(1, Arrays.stream(RandomService.class.getDeclaredFields())
                .filter(field -> RandomGenerator.class.isAssignableFrom(field.getType())).count());
        assertEquals(1, Arrays.stream(RandomService.class.getDeclaredFields())
                .filter(field -> AddressedRandom.class.isAssignableFrom(field.getType())).count());
    }

    @Test
    void modelConsumersHoldAndAcceptNoRawGenerator() {
        for (Class<?> consumer : modelConsumers()) {
            for (Method method : consumer.getDeclaredMethods()) {
                assertNotBackendType(consumer, method.getName(), method.getReturnType());
                assertNoBackendParameter(consumer, method.getName(), method.getParameters());
            }
            for (var constructor : consumer.getDeclaredConstructors()) {
                assertNoBackendParameter(consumer, "<init>", constructor.getParameters());
            }
        }

        assertFalse(RandomGenerator.class.isAssignableFrom(RngContext.class));
        assertFalse(Arrays.stream(RandomService.class.getDeclaredMethods())
                .anyMatch(method -> method.getName().equals("legacy")
                        || method.getName().equals("addressed")));
    }

    @Test
    void contextIsImmutableAndContainsOnlyOwnerOriginSimulationAndTimeStep() {
        Class<?> implementation = RandomService.ServiceRngContext.class;
        assertTrue(Modifier.isFinal(implementation.getModifiers()));
        assertTrue(RngContext.class.isAssignableFrom(implementation));

        Map<String, Class<?>> fields = Arrays.stream(implementation.getDeclaredFields())
                .filter(field -> !field.isSynthetic())
                .peek(field -> assertTrue(Modifier.isFinal(field.getModifiers()), field.getName()))
                .collect(Collectors.toMap(Field::getName, Field::getType));
        assertEquals(Map.of(
                "owner", RandomService.class,
                "origin", RngOrigin.class,
                "simulation", int.class,
                "timeStep", int.class), fields);
        assertEquals(0, RngContext.class.getDeclaredFields().length);
    }

    @Test
    void onlyFiveNamedPhaseFactoriesCanCreateProductionContexts() {
        Set<String> factories = Arrays.stream(RandomService.class.getDeclaredMethods())
                .filter(method -> method.getReturnType() == RngContext.class)
                .filter(method -> !Modifier.isPrivate(method.getModifiers()))
                .map(Method::getName)
                .collect(Collectors.toSet());
        assertEquals(Set.of(
                "demographicsContext",
                "constructionContext",
                "householdLoopContext",
                "saleClearingContext",
                "rentClearingContext"), factories);

        assertEquals(1, RandomService.ServiceRngContext.class.getDeclaredConstructors().length);
        assertTrue(Modifier.isPrivate(RandomService.ServiceRngContext.class
                .getDeclaredConstructors()[0].getModifiers()));
        assertTrue(RngContext.class.isSealed());
    }

    @Test
    void inverseCdfOnlyLognormalObjectsRetainNoGenerator() throws Exception {
        new Model(CONFIG_PATH, tempDir.toString() + "/");

        assertDistributionHasNoGenerator(staticDistribution(HouseholdBehaviour.class,
                "downpaymentDistFTB"));
        assertDistributionHasNoGenerator(staticDistribution(HouseholdBehaviour.class,
                "downpaymentDistOO"));

        RngContext context = RngFactory.create(17).demographicsContext(0, 0);
        Household household = new Household(context, 35.0);
        Method btlDistribution = HouseholdBehaviour.class.getDeclaredMethod("getBTLDownpaymentDist");
        btlDistribution.setAccessible(true);
        assertDistributionHasNoGenerator(
                (LogNormalDistribution) btlDistribution.invoke(household.behaviour));
    }

    private static Class<?>[] modelConsumers() {
        return new Class<?>[] {
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
    }

    private static void assertNotBackendType(Class<?> owner, String member, Class<?> type) {
        assertFalse(type == MersenneRandom.class
                        || RandomGenerator.class.isAssignableFrom(type)
                        || AddressedRandom.class.isAssignableFrom(type)
                        || type == RandomService.class,
                () -> owner.getName() + "." + member + " exposes backend type " + type.getName());
    }

    private static void assertNoBackendParameter(Class<?> owner, String member,
            Parameter[] parameters) {
        for (Parameter parameter : parameters) {
            assertNotBackendType(owner, member, parameter.getType());
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
