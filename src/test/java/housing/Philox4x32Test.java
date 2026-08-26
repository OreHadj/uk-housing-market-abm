package housing;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Random123 known-answer tests for the ten-round Philox4x32 integer core.
 *
 * <p>The canonical vectors come from
 * <a href="https://github.com/DEShawResearch/random123/blob/9545ff6413f258be2f04c1d319d99aaef7521150/tests/kat_vectors">
 * {@code tests/kat_vectors}</a>; the explicit high-bit vectors come from
 * <a href="https://github.com/DEShawResearch/random123/blob/9545ff6413f258be2f04c1d319d99aaef7521150/tests/old_kat_vectors">
 * {@code tests/old_kat_vectors}</a>. Both files are pinned to upstream Random123 commit
 * {@code 9545ff6413f258be2f04c1d319d99aaef7521150}.</p>
 */
class Philox4x32Test {

    @Test
    void zeroCounterAndKeyMatchRandom123() {
        assertVector(
                0x00000000, 0x00000000, 0x00000000, 0x00000000,
                0x00000000, 0x00000000,
                0x6627e8d5, 0xe169c58d, 0xbc57ac4c, 0x9b00dbd8);
    }

    @Test
    void allOnesCounterAndKeyMatchRandom123() {
        assertVector(
                0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff,
                0xffffffff, 0xffffffff,
                0x408f276d, 0x41c83b0e, 0xa20bc7c6, 0x6d5451fd);
    }

    @Test
    void highBitInMultipliedCounterWordMatchesRandom123() {
        assertVector(
                0x00000000, 0x00000000, 0x80000000, 0x00000000,
                0x00000001, 0x00000000,
                0xf2e15c7d, 0x3fedcd99, 0x90046f6c, 0x6657f0ca);
    }

    @Test
    void highBitInKeyWordMatchesRandom123() {
        assertVector(
                0x00000001, 0x00000000, 0x00000000, 0x00000000,
                0x00000000, 0x80000000,
                0xe29b9f84, 0x2903d316, 0x42a1f56f, 0x1ad02eab);
    }

    @Test
    void mixedCounterAndKeyMatchRandom123() {
        assertVector(
                0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344,
                0xa4093822, 0x299f31d0,
                0xd16cfe09, 0x94fdcceb, 0x5001e420, 0x24126ea1);
    }

    private static void assertVector(int counter0, int counter1, int counter2, int counter3,
                                     int key0, int key1,
                                     int expected0, int expected1, int expected2, int expected3) {
        long words01 = Philox4x32.words01(counter0, counter1, counter2, counter3, key0, key1);
        long words23 = Philox4x32.words23(counter0, counter1, counter2, counter3, key0, key1);

        assertAll(
                () -> assertEquals(expected0, (int) (words01 >>> 32), "word 0"),
                () -> assertEquals(expected1, (int) words01, "word 1"),
                () -> assertEquals(expected2, (int) (words23 >>> 32), "word 2"),
                () -> assertEquals(expected3, (int) words23, "word 3"));
    }
}
