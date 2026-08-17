package housing;

import org.apache.commons.math3.random.MersenneTwister;
import org.apache.commons.math3.random.RandomGenerator;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
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
        int seed = 123;

        assertEquals(new MersenneTwister(seed).nextInt(), RngFactory.create(seed).nextInt());
    }

    @Test
    void explicitMersenneIsTrimmedAndCaseNormalized() {
        int seed = 456;
        System.setProperty(RngFactory.PROPERTY, "  MeRsEnNe  ");

        assertEquals(new MersenneTwister(seed).nextInt(), RngFactory.create(seed).nextInt());
    }

    @Test
    void propertyIsResolvedForEveryFactoryCall() {
        RngFactory.create(1);

        System.setProperty(RngFactory.PROPERTY, "philox");
        assertThrows(IllegalArgumentException.class, () -> RngFactory.create(1));

        System.setProperty(RngFactory.PROPERTY, "mersenne");
        assertEquals(new MersenneTwister(1).nextInt(), RngFactory.create(1).nextInt());
    }

    @Test
    void separateFactoryCallsCreateIndependentInstances() {
        int seed = 789;
        RandomGenerator first = RngFactory.create(seed);
        RandomGenerator second = RngFactory.create(seed);

        assertNotSame(first, second);
        first.nextInt();
        assertEquals(new MersenneTwister(seed).nextInt(), second.nextInt());
    }

    @Test
    void unsupportedOrBlankModesFailClearly() {
        System.setProperty(RngFactory.PROPERTY, "philox-household");
        assertThrows(IllegalArgumentException.class, () -> RngFactory.create(1));

        System.setProperty(RngFactory.PROPERTY, "   ");
        assertThrows(IllegalArgumentException.class, () -> RngFactory.create(1));
    }
}
