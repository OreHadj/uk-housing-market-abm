package housing;

/**
 * Stateless primitive-field API for addressed randomness.
 *
 * <p>The primitive fields are encoded by {@link RandomAddressV1}. This deliberately does not extend
 * Commons Math's stateful {@code RandomGenerator} API. {@code simulation} is zero-based, while
 * {@code entity} carries an unsigned 32-bit address word in its Java {@code int} bit pattern.</p>
 */
interface AddressedRandom {

    double uniform(long seed, int simulation, int timeStep, int entity, int event, int subcounter);

    double normal(long seed, int simulation, int timeStep, int entity, int event, int subcounter);

    int boundedInt(long seed, int simulation, int timeStep, int entity, int event, int subcounter,
                   int bound);
}
