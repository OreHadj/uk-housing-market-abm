package housing;

import java.util.Objects;

import org.apache.commons.math3.distribution.GeometricDistribution;
import org.apache.commons.math3.random.RandomGenerator;

import utilities.Pdf;

/** Run-scoped owner of both random backends and all address-construction authority. */
final class RandomService {

    private final RngMode mode;
    private final int configuredSeed;
    private final long masterSeed;
    private final RandomGenerator legacy;
    private final AddressedRandom addressed;
    private final RngMetadata metadata;

    RandomService(RngMode mode, int configuredSeed) {
        this.mode = Objects.requireNonNull(mode, "mode");
        this.configuredSeed = configuredSeed;
        masterSeed = RngFactory.masterSeed(configuredSeed);
        legacy = mode == RngMode.PHILOX ? null : new MersenneRandom(configuredSeed);
        addressed = mode == RngMode.MERSENNE ? null : new PhiloxAddressedRandom();
        metadata = new RngMetadata(mode.algorithm(), mode.addressVersion(), masterSeed,
                mode.propertyValue());
    }

    RngMode mode() {
        return mode;
    }

    int configuredSeed() {
        return configuredSeed;
    }

    RngContext demographicsContext(int simulation, int timeStep) {
        return context(RngOrigin.DEMOGRAPHICS, simulation, timeStep);
    }

    RngContext constructionContext(int simulation, int timeStep) {
        return context(RngOrigin.CONSTRUCTION, simulation, timeStep);
    }

    RngContext householdLoopContext(int simulation, int timeStep) {
        return context(RngOrigin.HOUSEHOLD_LOOP, simulation, timeStep);
    }

    RngContext saleClearingContext(int simulation, int timeStep) {
        return context(RngOrigin.SALE_CLEARING, simulation, timeStep);
    }

    RngContext rentClearingContext(int simulation, int timeStep) {
        return context(RngOrigin.RENT_CLEARING, simulation, timeStep);
    }

    /** Converts the model's one-based reporting number under this mode's address policy. */
    int simulationIndex(int reportingSimulation) {
        if (mode == RngMode.MERSENNE) {
            if (reportingSimulation < 1) {
                throw new IllegalArgumentException(
                        "reporting simulation must be positive: " + reportingSimulation);
            }
            return reportingSimulation - 1;
        }
        return RandomAddressV1.fromReportingSimulation(reportingSimulation);
    }

    void reseedLegacy(int seed) {
        requireLegacy().setSeed(seed);
    }

    RngMetadata metadata() {
        return metadata;
    }

    void requireModelSupport() {
        mode.requireModelSupport();
    }

    private RngContext context(RngOrigin origin, int simulation, int timeStep) {
        return new ServiceRngContext(this, origin, simulation, timeStep);
    }

    private double uniform(ServiceRngContext context, EntityKind entityKind, int entityId,
            RandomEvent event, int subcounter) {
        RngBackend backend = validateNonBounded(
                context, entityKind, event, RngOperation.UNIFORM, subcounter);
        PrecisionGateTrace.recordRequest(context.origin, backend, entityKind, entityId,
                event, RngOperation.UNIFORM, subcounter, 0L);
        return switch (backend) {
            case MERSENNE -> requireLegacy().nextDouble();
            case PHILOX -> requireAddressed().uniform(masterSeed, context.simulation,
                    context.timeStep, entityId, event.id(), subcounter);
        };
    }

    private double normal(ServiceRngContext context, EntityKind entityKind, int entityId,
            RandomEvent event, int subcounter) {
        RngBackend backend = validateNonBounded(
                context, entityKind, event, RngOperation.NORMAL, subcounter);
        PrecisionGateTrace.recordRequest(context.origin, backend, entityKind, entityId,
                event, RngOperation.NORMAL, subcounter, 0L);
        return switch (backend) {
            case MERSENNE -> requireLegacy().nextGaussian();
            case PHILOX -> requireAddressed().normal(masterSeed, context.simulation,
                    context.timeStep, entityId, event.id(), subcounter);
        };
    }

    private int boundedInt(ServiceRngContext context, EntityKind entityKind, int entityId,
            RandomEvent event, int bound) {
        LemireBoundedInt.validateBound(bound);
        RngBackend backend = validate(context, entityKind, event, RngOperation.BOUNDED_INT);
        int initialSubcounter = event.initialBoundedSubcounter();
        PrecisionGateTrace.recordRequest(context.origin, backend, entityKind, entityId,
                event, RngOperation.BOUNDED_INT, initialSubcounter, bound);
        return switch (backend) {
            case MERSENNE -> event.legacyConsumptionPolicy()
                    == LegacyConsumptionPolicy.FLOOR_OF_UNIFORM_BOUNDED
                            ? (int) (requireLegacy().nextDouble() * bound)
                            : requireLegacy().nextInt(bound);
            case PHILOX -> requireAddressed().boundedInt(masterSeed, context.simulation,
                    context.timeStep, entityId, event.id(), initialSubcounter, bound);
        };
    }

    private double empiricalPdf(ServiceRngContext context, int entityId, RandomEvent event,
            int subcounter, Pdf pdf) {
        Objects.requireNonNull(pdf, "pdf");
        RngBackend backend = validateNonBounded(
                context, EntityKind.HOUSE, event, RngOperation.EMPIRICAL_PDF, subcounter);
        PrecisionGateTrace.recordRequest(context.origin, backend, EntityKind.HOUSE, entityId,
                event, RngOperation.EMPIRICAL_PDF, subcounter, 0L);
        return switch (backend) {
            case MERSENNE -> pdf.nextDouble(requireLegacy());
            case PHILOX -> pdf.sample(requireAddressed().uniform(masterSeed, context.simulation,
                    context.timeStep, entityId, event.id(), subcounter));
        };
    }

    private int geometric(ServiceRngContext context, int entityId, RandomEvent event,
            double probabilityOfSuccess) {
        RngBackend backend = validateNonBounded(
                context, EntityKind.HOUSE, event, RngOperation.GEOMETRIC, 0);
        PrecisionGateTrace.recordRequest(context.origin, backend, EntityKind.HOUSE, entityId,
                event, RngOperation.GEOMETRIC, 0,
                Double.doubleToRawLongBits(probabilityOfSuccess));
        return switch (backend) {
            case MERSENNE -> new GeometricDistribution(
                    requireLegacy(), probabilityOfSuccess).sample();
            case PHILOX -> GeometricInverseCdf.sample(probabilityOfSuccess,
                    requireAddressed().uniform(masterSeed, context.simulation, context.timeStep,
                            entityId, event.id(), 0));
        };
    }

    private RngBackend validateNonBounded(ServiceRngContext context, EntityKind entityKind,
            RandomEvent event, RngOperation operation, int subcounter) {
        RngBackend backend = validate(context, entityKind, event, operation);
        event.requireNonBoundedSubcounter(operation, subcounter);
        return backend;
    }

    private RngBackend validate(ServiceRngContext context, EntityKind entityKind,
            RandomEvent event, RngOperation operation) {
        Objects.requireNonNull(context, "context");
        Objects.requireNonNull(entityKind, "entityKind");
        Objects.requireNonNull(event, "event");
        if (event.entityKind() != entityKind) {
            throw new IllegalArgumentException("entity kind " + entityKind + " is invalid for "
                    + event + " (expected " + event.entityKind() + ")");
        }
        event.requireOperation(operation);
        return event.backend(mode, context.origin);
    }

    private RandomGenerator requireLegacy() {
        if (legacy == null) {
            throw new IllegalStateException("RNG mode 'philox' has no Mersenne backend");
        }
        return legacy;
    }

    long legacyRawWordCount() {
        return legacy == null ? 0L : ((MersenneRandom) legacy).rawWordCount();
    }

    private AddressedRandom requireAddressed() {
        if (addressed == null) {
            throw new IllegalStateException("RNG mode 'mersenne' has no addressed backend");
        }
        return addressed;
    }

    static final class ServiceRngContext implements RngContext {

        private final RandomService owner;
        private final RngOrigin origin;
        private final int simulation;
        private final int timeStep;

        private ServiceRngContext(RandomService owner, RngOrigin origin, int simulation,
                int timeStep) {
            this.owner = Objects.requireNonNull(owner, "owner");
            this.origin = Objects.requireNonNull(origin, "origin");
            if (simulation < 0) {
                throw new IllegalArgumentException(
                        "simulation must be non-negative: " + simulation);
            }
            if (owner.mode != RngMode.MERSENNE) {
                RandomAddressV1.counter0(simulation);
            }
            RandomAddressV1.counter1(timeStep);
            this.simulation = simulation;
            this.timeStep = timeStep;
        }

        @Override
        public RngOrigin origin() {
            return origin;
        }

        @Override
        public int simulation() {
            return simulation;
        }

        @Override
        public int timeStep() {
            return timeStep;
        }

        @Override
        public double uniform(Household.IdReservation entity, RandomEvent event) {
            if (event != RandomEvent.HH_AGE_AT_CREATION) {
                throw new IllegalArgumentException(
                        "prospective household IDs are reserved for HH_AGE_AT_CREATION");
            }
            return owner.uniform(this, EntityKind.HOUSEHOLD,
                    Objects.requireNonNull(entity, "entity").address(), event, 0);
        }

        @Override
        public double uniform(Household entity, RandomEvent event) {
            return uniform(entity, event, 0);
        }

        @Override
        public double uniform(Household entity, RandomEvent event, int subcounter) {
            return owner.uniform(this, EntityKind.HOUSEHOLD,
                    Objects.requireNonNull(entity, "entity").id, event, subcounter);
        }

        @Override
        public double uniform(House entity, RandomEvent event) {
            return uniform(entity, event, 0);
        }

        @Override
        public double uniform(House entity, RandomEvent event, int subcounter) {
            return owner.uniform(this, EntityKind.HOUSE,
                    Objects.requireNonNull(entity, "entity").id, event, subcounter);
        }

        @Override
        public double normal(Household entity, RandomEvent event) {
            return normal(entity, event, 0);
        }

        @Override
        public double normal(Household entity, RandomEvent event, int subcounter) {
            return owner.normal(this, EntityKind.HOUSEHOLD,
                    Objects.requireNonNull(entity, "entity").id, event, subcounter);
        }

        @Override
        public double normal(House entity, RandomEvent event) {
            return normal(entity, event, 0);
        }

        @Override
        public double normal(House entity, RandomEvent event, int subcounter) {
            return owner.normal(this, EntityKind.HOUSE,
                    Objects.requireNonNull(entity, "entity").id, event, subcounter);
        }

        @Override
        public int boundedInt(Household entity, RandomEvent event, int bound) {
            return owner.boundedInt(this, EntityKind.HOUSEHOLD,
                    Objects.requireNonNull(entity, "entity").id, event, bound);
        }

        @Override
        public int boundedInt(House entity, RandomEvent event, int bound) {
            return owner.boundedInt(this, EntityKind.HOUSE,
                    Objects.requireNonNull(entity, "entity").id, event, bound);
        }

        @Override
        public int boundedInt(House.IdReservation entity, RandomEvent event, int bound) {
            if (event != RandomEvent.NEW_BUILD_QUALITY) {
                throw new IllegalArgumentException(
                        "prospective house IDs are reserved for NEW_BUILD_QUALITY");
            }
            return owner.boundedInt(this, EntityKind.HOUSE,
                    Objects.requireNonNull(entity, "entity").address(), event, bound);
        }

        @Override
        public double empiricalPdf(House entity, RandomEvent event, int subcounter, Pdf pdf) {
            return owner.empiricalPdf(this, Objects.requireNonNull(entity, "entity").id,
                    event, subcounter, pdf);
        }

        @Override
        public int geometric(House entity, RandomEvent event, double probabilityOfSuccess) {
            return owner.geometric(this, Objects.requireNonNull(entity, "entity").id,
                    event, probabilityOfSuccess);
        }
    }
}
