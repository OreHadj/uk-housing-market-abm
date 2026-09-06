package housing;

import org.apache.commons.math3.random.MersenneTwister;
import org.apache.commons.math3.random.RandomGenerator;

/**
 * Run-scoped facade over the model's legacy Apache Commons Math generator.
 *
 * <p>Every operation delegates directly to one {@link MersenneTwister}. In particular, Gaussian
 * caching and cache clearing during reseeding remain owned by the Commons implementation.</p>
 */
final class MersenneRandom implements RandomGenerator {

    private final MersenneTwister delegate;

    MersenneRandom(int seed) {
        delegate = PrecisionGateTrace.enabled()
                ? new CountingMersenneTwister(seed)
                : new MersenneTwister(seed);
    }

    @Override
    public void setSeed(int seed) {
        delegate.setSeed(seed);
    }

    @Override
    public void setSeed(int[] seed) {
        delegate.setSeed(seed);
    }

    @Override
    public void setSeed(long seed) {
        delegate.setSeed(seed);
    }

    @Override
    public void nextBytes(byte[] bytes) {
        delegate.nextBytes(bytes);
    }

    @Override
    public int nextInt() {
        return delegate.nextInt();
    }

    @Override
    public int nextInt(int bound) {
        return delegate.nextInt(bound);
    }

    @Override
    public long nextLong() {
        return delegate.nextLong();
    }

    @Override
    public boolean nextBoolean() {
        return delegate.nextBoolean();
    }

    @Override
    public float nextFloat() {
        return delegate.nextFloat();
    }

    @Override
    public double nextDouble() {
        return delegate.nextDouble();
    }

    @Override
    public double nextGaussian() {
        return delegate.nextGaussian();
    }

    long rawWordCount() {
        if (delegate instanceof CountingMersenneTwister counting) {
            return counting.rawWordCount();
        }
        return 0L;
    }

    private static final class CountingMersenneTwister extends MersenneTwister {

        private long rawWordCount;

        private CountingMersenneTwister(int seed) {
            super(seed);
        }

        @Override
        protected int next(int bits) {
            rawWordCount += 1;
            return super.next(bits);
        }

        @Override
        public void setSeed(int seed) {
            super.setSeed(seed);
            rawWordCount = 0L;
        }

        @Override
        public void setSeed(int[] seed) {
            super.setSeed(seed);
            rawWordCount = 0L;
        }

        @Override
        public void setSeed(long seed) {
            super.setSeed(seed);
            rawWordCount = 0L;
        }

        private long rawWordCount() {
            return rawWordCount;
        }
    }
}
