package housing;

import org.apache.commons.math3.random.MersenneTwister;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

class RngFactoryTest {

    private String originalProperty;

    @BeforeEach
    void rememberAndClearProperty() {
        originalProperty = System.getProperty(RngFactory.PROPERTY);
        System.clearProperty(RngFactory.PROPERTY);
    }

    @AfterEach
    void restoreProperty() {
        if (originalProperty == null) {
            System.clearProperty(RngFactory.PROPERTY);
        } else {
            System.setProperty(RngFactory.PROPERTY, originalProperty);
        }
    }

    @Test
    void omittedPropertyDefaultsToMersenne() {
        RandomService service = RngFactory.create(123);
        House house = new House(0);

        assertSame(RngMode.MERSENNE, RngFactory.resolveMode());
        assertSame(RngMode.MERSENNE, service.mode());
        assertRawEquals(new MersenneTwister(123).nextDouble(),
                service.householdLoopContext(0, 0).uniform(house, RandomEvent.HOME_SELL));
    }

    @Test
    void everyModeParsesAfterTrimmingAndCaseNormalization() {
        assertSame(RngMode.MERSENNE, RngMode.parse("  MeRsEnNe  "));
        assertSame(RngMode.PHILOX_HOUSEHOLD, RngMode.parse("  PhIlOx-HoUsEhOlD  "));
        assertSame(RngMode.PHILOX, RngMode.parse("  PhIlOx  "));
    }

    @Test
    void blankAndUnknownModesFailWithTheCompleteAcceptedSet() {
        IllegalArgumentException blank = assertThrows(IllegalArgumentException.class,
                () -> RngMode.parse("   "));
        assertEquals("Unsupported housing.rng value '' (expected 'mersenne', "
                + "'philox-household', or 'philox')", blank.getMessage());

        IllegalArgumentException unknown = assertThrows(IllegalArgumentException.class,
                () -> RngMode.parse("  PHILOX_HOUSEHOLD  "));
        assertEquals("Unsupported housing.rng value 'philox_household' (expected 'mersenne', "
                + "'philox-household', or 'philox')", unknown.getMessage());

        IllegalArgumentException extraMode = assertThrows(IllegalArgumentException.class,
                () -> RngMode.parse("philox-serial"));
        assertEquals("Unsupported housing.rng value 'philox-serial' (expected 'mersenne', "
                + "'philox-household', or 'philox')", extraMode.getMessage());
    }

    @Test
    void propertyIsResolvedForEveryFactoryCallAndCapturedByEachService() {
        System.setProperty(RngFactory.PROPERTY, "mersenne");
        RandomService mersenne = RngFactory.create(17);

        System.setProperty(RngFactory.PROPERTY, "  PHILOX-HOUSEHOLD  ");
        assertSame(RngMode.PHILOX_HOUSEHOLD, RngFactory.resolveMode());
        RandomService household = RngFactory.create(18);

        System.setProperty(RngFactory.PROPERTY, "philox");
        assertSame(RngMode.PHILOX, RngFactory.resolveMode());
        RandomService philox = RngFactory.create(19);

        assertSame(RngMode.MERSENNE, mersenne.mode());
        assertSame(RngMode.PHILOX_HOUSEHOLD, household.mode());
        assertSame(RngMode.PHILOX, philox.mode());
        assertEquals(17, mersenne.configuredSeed());
        assertEquals(18, household.configuredSeed());
        assertEquals(19, philox.configuredSeed());
    }

    @Test
    void explicitFactoryModeDoesNotConsultTheRuntimeProperty() {
        System.setProperty(RngFactory.PROPERTY, "philox");
        RandomService service = RngFactory.create(41, RngMode.MERSENNE);
        House house = new House(0);

        assertSame(RngMode.MERSENNE, service.mode());
        assertRawEquals(new MersenneTwister(41).nextDouble(),
                service.householdLoopContext(0, 0).uniform(house, RandomEvent.HOME_SELL));
    }

    @Test
    void serviceConfigurationAndMetadataRemainStableAfterPropertyAndStateChanges() {
        System.setProperty(RngFactory.PROPERTY, "philox-household");
        RandomService service = RngFactory.create(-1);
        RngMetadata metadata = service.metadata();
        House house = new House(0);

        System.setProperty(RngFactory.PROPERTY, "mersenne");
        service.householdLoopContext(0, 0).uniform(house, RandomEvent.HOME_SELL);
        service.reseedLegacy(73);

        assertSame(RngMode.PHILOX_HOUSEHOLD, service.mode());
        assertEquals(-1, service.configuredSeed());
        assertEquals(0xffff_ffffL, service.metadata().masterSeed());
        assertSame(metadata, service.metadata());
        assertEquals("RNG_METADATA rngAlgorithm=MersenneTwister+Philox4x32-10 "
                + "rngAddressVersion=1 masterSeed=4294967295 rngMode=philox-household",
                service.metadata().formatLine());
    }

    @Test
    void separateServicesAreIndependent() {
        int seed = 789;
        RandomService firstService = RngFactory.create(seed, RngMode.MERSENNE);
        RandomService secondService = RngFactory.create(seed, RngMode.MERSENNE);
        RngContext first = firstService.householdLoopContext(0, 0);
        RngContext second = secondService.householdLoopContext(0, 0);
        House firstHouse = new House(0);
        House secondHouse = new House(0);

        assertNotSame(firstService, secondService);
        assertNotSame(first, second);
        first.uniform(firstHouse, RandomEvent.HOME_SELL);
        assertRawEquals(new MersenneTwister(seed).nextDouble(),
                second.uniform(secondHouse, RandomEvent.HOME_SELL));
    }

    @Test
    void reseedingPreservesCommonsMersenneAndGaussianCacheSemantics() {
        RandomService service = RngFactory.create(41, RngMode.MERSENNE);
        RngContext context = service.householdLoopContext(0, 0);
        House house = new House(0);
        context.normal(house, RandomEvent.SALE_REPRICE, 1);

        service.reseedLegacy(73);

        MersenneTwister expected = new MersenneTwister(73);
        assertRawEquals(expected.nextGaussian(),
                context.normal(house, RandomEvent.SALE_REPRICE, 1));
        assertRawEquals(expected.nextDouble(),
                context.uniform(house, RandomEvent.SALE_REPRICE, 0));

        RandomService hybrid = RngFactory.create(41, RngMode.PHILOX_HOUSEHOLD);
        RngContext saleClearing = hybrid.saleClearingContext(0, 0);
        hybrid.reseedLegacy(73);
        expected = new MersenneTwister(73);
        assertEquals(expected.nextInt(37), saleClearing.boundedInt(
                house, RandomEvent.SALE_MARKET_TIE_BREAK, 37));
    }

    @Test
    void backendsAreUsableOnlyThroughSemanticContexts() {
        House house = new House(0);
        assertDoesNotThrow(() -> RngFactory.create(1, RngMode.MERSENNE)
                .householdLoopContext(0, 0).uniform(house, RandomEvent.HOME_SELL));
        assertDoesNotThrow(() -> RngFactory.create(1, RngMode.PHILOX_HOUSEHOLD)
                .householdLoopContext(0, 0).uniform(house, RandomEvent.HOME_SELL));
        assertDoesNotThrow(() -> RngFactory.create(1, RngMode.PHILOX)
                .householdLoopContext(0, 0).uniform(house, RandomEvent.HOME_SELL));

        assertFalse(Arrays.stream(RandomService.class.getDeclaredMethods())
                .anyMatch(method -> method.getName().equals("legacy")
                        || method.getName().equals("addressed")));
        IllegalStateException noReseed = assertThrows(IllegalStateException.class,
                () -> RngFactory.create(1, RngMode.PHILOX).reseedLegacy(2));
        assertEquals("RNG mode 'philox' has no Mersenne backend", noReseed.getMessage());
    }

    @Test
    void hybridModelModeIsActiveWhileFullPhiloxRetainsTheStepTwelveBarrier() {
        assertDoesNotThrow(() -> RngFactory.create(1, RngMode.MERSENNE).requireModelSupport());
        assertDoesNotThrow(() -> RngFactory.create(
                1, RngMode.PHILOX_HOUSEHOLD).requireModelSupport());

        IllegalStateException philox = assertThrows(IllegalStateException.class,
                () -> RngFactory.create(1, RngMode.PHILOX).requireModelSupport());
        assertEquals("RNG mode 'philox' is not active until all event origins are migrated in Step 12",
                philox.getMessage());
    }

    @Test
    void configuredSeedIsZeroExtendedAcrossADenseRepresentativeBitGrid() {
        for (int high = 0; high <= 0xffff; high += 257) {
            for (int low = 0; low <= 0xffff; low += 257) {
                int configuredSeed = (high << 16) | low;
                long expected = Integer.toUnsignedLong(configuredSeed);
                long actual = RngFactory.masterSeed(configuredSeed);

                assertEquals(expected, actual);
                assertEquals(configuredSeed, RandomAddressV1.key0(actual));
                assertEquals(0, RandomAddressV1.key1(actual));
            }
        }
    }

    @Test
    void negativeConfigurationRowsPinUnsignedMasterSeedAndLegacySeedSeparately() {
        assertSeedBridge(-1, 0xffff_ffffL);
        assertSeedBridge(Integer.MIN_VALUE, 0x8000_0000L);
    }

    @Test
    void metadataLinesAreExactDeterministicAndUseUnsignedMasterSeedText() {
        assertEquals("RNG_METADATA rngAlgorithm=MersenneTwister rngAddressVersion=none "
                        + "masterSeed=4294967295 rngMode=mersenne",
                RngFactory.create(-1, RngMode.MERSENNE).metadata().formatLine());
        assertEquals("RNG_METADATA rngAlgorithm=MersenneTwister+Philox4x32-10 "
                        + "rngAddressVersion=1 masterSeed=4294967295 rngMode=philox-household",
                RngFactory.create(-1, RngMode.PHILOX_HOUSEHOLD).metadata().formatLine());
        assertEquals("RNG_METADATA rngAlgorithm=Philox4x32-10 rngAddressVersion=1 "
                        + "masterSeed=4294967295 rngMode=philox",
                RngFactory.create(-1, RngMode.PHILOX).metadata().formatLine());
    }

    private static void assertSeedBridge(int configuredSeed, long expectedMasterSeed) {
        RandomService service = RngFactory.create(configuredSeed, RngMode.PHILOX_HOUSEHOLD);
        House house = new House(0);

        assertEquals(configuredSeed, service.configuredSeed());
        assertEquals(expectedMasterSeed, RngFactory.masterSeed(configuredSeed));
        assertEquals(expectedMasterSeed, service.metadata().masterSeed());
        assertEquals(configuredSeed, RandomAddressV1.key0(service.metadata().masterSeed()));
        assertEquals(0, RandomAddressV1.key1(service.metadata().masterSeed()));

        assertEquals(new MersenneTwister(configuredSeed).nextInt(37),
                service.saleClearingContext(0, 0).boundedInt(
                        house, RandomEvent.SALE_MARKET_TIE_BREAK, 37));
    }

    private static void assertRawEquals(double expected, double actual) {
        assertEquals(Double.doubleToRawLongBits(expected), Double.doubleToRawLongBits(actual));
    }
}
