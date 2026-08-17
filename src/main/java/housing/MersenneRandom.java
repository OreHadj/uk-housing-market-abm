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
        delegate = new MersenneTwister(seed);
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
}
