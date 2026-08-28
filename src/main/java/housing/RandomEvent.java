package housing;

import java.util.Collections;
import java.util.EnumMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Stable, enforceable semantic registry for economic randomness.
 *
 * <p>Dormant event IDs remain allocated here. A future retired event must likewise remain as a
 * tombstone instead of allowing its version-1 ID to be reused.</p>
 *
 * <p>Under {@code philox-household} the backend is pinned per {@code (origin, event)} pair rather
 * than per event, because an event reached from several top-level phases is migrated one phase at a
 * time. {@code philoxHousehold(...)} names the origins already routed to Philox; every other valid
 * origin of the same event stays on Mersenne. The derived table covers exactly
 * {@link #validOrigins()}, so routing is total over the pairs that can occur and has no fallback
 * entry.</p>
 */
enum RandomEvent {

    HH_AGE_AT_CREATION(0x0001, EntityKind.HOUSEHOLD,
            origins(RngOrigin.DEMOGRAPHICS), SubcounterPolicy.SINGLE,
            philoxHousehold(),
            operations(RngOperation.UNIFORM)),
    HH_INCOME_PERCENTILE(0x0002, EntityKind.HOUSEHOLD,
            origins(RngOrigin.DEMOGRAPHICS), SubcounterPolicy.SINGLE,
            philoxHousehold(),
            operations(RngOperation.UNIFORM)),
    HH_PROPENSITY_TO_SAVE(0x0003, EntityKind.HOUSEHOLD,
            origins(RngOrigin.DEMOGRAPHICS), SubcounterPolicy.SINGLE,
            philoxHousehold(),
            operations(RngOperation.UNIFORM)),
    HH_BTL_GENE(0x0004, EntityKind.HOUSEHOLD,
            origins(RngOrigin.DEMOGRAPHICS), SubcounterPolicy.SINGLE,
            philoxHousehold(),
            operations(RngOperation.UNIFORM)),
    HH_BTL_STRATEGY(0x0005, EntityKind.HOUSEHOLD,
            origins(RngOrigin.DEMOGRAPHICS), SubcounterPolicy.SINGLE,
            philoxHousehold(),
            operations(RngOperation.UNIFORM)),

    HH_DESIRED_PURCHASE(0x1001, EntityKind.HOUSEHOLD,
            origins(RngOrigin.HOUSEHOLD_LOOP), SubcounterPolicy.SINGLE,
            philoxHousehold(RngOrigin.HOUSEHOLD_LOOP),
            operations(RngOperation.NORMAL)),
    HH_DESIRED_RENT(0x1002, EntityKind.HOUSEHOLD,
            origins(RngOrigin.HOUSEHOLD_LOOP), SubcounterPolicy.SINGLE,
            philoxHousehold(RngOrigin.HOUSEHOLD_LOOP),
            operations(RngOperation.NORMAL)),
    RENT_OR_BUY(0x1003, EntityKind.HOUSEHOLD,
            origins(RngOrigin.HOUSEHOLD_LOOP), SubcounterPolicy.SINGLE,
            philoxHousehold(RngOrigin.HOUSEHOLD_LOOP),
            operations(RngOperation.UNIFORM)),
    BTL_BUY(0x1004, EntityKind.HOUSEHOLD,
            origins(RngOrigin.HOUSEHOLD_LOOP), SubcounterPolicy.SINGLE,
            philoxHousehold(RngOrigin.HOUSEHOLD_LOOP),
            operations(RngOperation.UNIFORM)),
    BTL_DOWNPAYMENT(0x1005, EntityKind.HOUSEHOLD,
            origins(RngOrigin.HOUSEHOLD_LOOP), SubcounterPolicy.SINGLE,
            philoxHousehold(RngOrigin.HOUSEHOLD_LOOP),
            operations(RngOperation.NORMAL)),
    HH_ALT_DESIRED_PURCHASE(0x1006, EntityKind.HOUSEHOLD,
            origins(RngOrigin.HOUSEHOLD_LOOP), SubcounterPolicy.SINGLE,
            philoxHousehold(),
            operations(RngOperation.NORMAL)),
    BTL_TARGET_LTV(0x1007, EntityKind.HOUSEHOLD,
            origins(RngOrigin.HOUSEHOLD_LOOP), SubcounterPolicy.SINGLE,
            philoxHousehold(),
            operations(RngOperation.NORMAL)),

    HOME_SELL(0x2001, EntityKind.HOUSE,
            origins(RngOrigin.HOUSEHOLD_LOOP), SubcounterPolicy.SINGLE,
            philoxHousehold(RngOrigin.HOUSEHOLD_LOOP),
            operations(RngOperation.UNIFORM)),
    BTL_SELL(0x2002, EntityKind.HOUSE,
            origins(RngOrigin.HOUSEHOLD_LOOP), SubcounterPolicy.SINGLE,
            philoxHousehold(RngOrigin.HOUSEHOLD_LOOP),
            operations(RngOperation.UNIFORM)),
    SALE_REPRICE(0x2003, EntityKind.HOUSE,
            origins(RngOrigin.HOUSEHOLD_LOOP), SubcounterPolicy.FIXED_TWO,
            philoxHousehold(RngOrigin.HOUSEHOLD_LOOP),
            operations(RngOperation.UNIFORM, RngOperation.NORMAL)),
    RENT_REPRICE(0x2004, EntityKind.HOUSE,
            origins(RngOrigin.HOUSEHOLD_LOOP), SubcounterPolicy.FIXED_TWO,
            philoxHousehold(RngOrigin.HOUSEHOLD_LOOP),
            operations(RngOperation.UNIFORM, RngOperation.NORMAL)),
    SALE_LIST_MARKUP(0x2005, EntityKind.HOUSE,
            origins(RngOrigin.HOUSEHOLD_LOOP, RngOrigin.DEMOGRAPHICS,
                    RngOrigin.CONSTRUCTION), SubcounterPolicy.LISTING_EPISODE,
            philoxHousehold(RngOrigin.HOUSEHOLD_LOOP),
            operations(RngOperation.EMPIRICAL_PDF)),
    RENT_LIST_MARKUP(0x2006, EntityKind.HOUSE,
            origins(RngOrigin.HOUSEHOLD_LOOP, RngOrigin.SALE_CLEARING,
                    RngOrigin.DEMOGRAPHICS, RngOrigin.CONSTRUCTION),
            SubcounterPolicy.LISTING_EPISODE,
            philoxHousehold(RngOrigin.HOUSEHOLD_LOOP),
            operations(RngOperation.EMPIRICAL_PDF)),

    SALE_MARKET_BID_UP(0x3001, EntityKind.HOUSE,
            origins(RngOrigin.SALE_CLEARING), SubcounterPolicy.SINGLE,
            philoxHousehold(),
            operations(RngOperation.GEOMETRIC)),
    SALE_MARKET_TIE_BREAK(0x3002, EntityKind.HOUSE,
            origins(RngOrigin.SALE_CLEARING), SubcounterPolicy.BOUNDED_EXCLUSIVE,
            philoxHousehold(),
            operations(RngOperation.BOUNDED_INT)),
    RENT_MARKET_BID_UP(0x3003, EntityKind.HOUSE,
            origins(RngOrigin.RENT_CLEARING), SubcounterPolicy.SINGLE,
            philoxHousehold(),
            operations(RngOperation.GEOMETRIC)),
    RENT_MARKET_TIE_BREAK(0x3004, EntityKind.HOUSE,
            origins(RngOrigin.RENT_CLEARING), SubcounterPolicy.BOUNDED_EXCLUSIVE,
            philoxHousehold(),
            operations(RngOperation.BOUNDED_INT)),
    RENT_TENANCY_LENGTH(0x3005, EntityKind.HOUSE,
            origins(RngOrigin.RENT_CLEARING), SubcounterPolicy.BOUNDED_EXCLUSIVE,
            philoxHousehold(),
            operations(RngOperation.BOUNDED_INT)),

    HH_DEATH(0x4001, EntityKind.HOUSEHOLD,
            origins(RngOrigin.DEMOGRAPHICS), SubcounterPolicy.SINGLE,
            philoxHousehold(),
            operations(RngOperation.UNIFORM)),
    HH_INHERITOR(0x4002, EntityKind.HOUSEHOLD,
            origins(RngOrigin.DEMOGRAPHICS), SubcounterPolicy.BOUNDED_EXCLUSIVE,
            philoxHousehold(),
            operations(RngOperation.BOUNDED_INT)),

    NEW_BUILD_QUALITY(0x5001, EntityKind.HOUSE,
            origins(RngOrigin.CONSTRUCTION), SubcounterPolicy.BOUNDED_EXCLUSIVE,
            philoxHousehold(), LegacyConsumptionPolicy.FLOOR_OF_UNIFORM_BOUNDED,
            operations(RngOperation.BOUNDED_INT)),
    NEW_BUILD_RECIPIENT(0x5002, EntityKind.HOUSE,
            origins(RngOrigin.CONSTRUCTION), SubcounterPolicy.BOUNDED_EXCLUSIVE,
            philoxHousehold(),
            operations(RngOperation.BOUNDED_INT));

    private final int id;
    private final EntityKind entityKind;
    private final Set<RngOrigin> validOrigins;
    private final SubcounterPolicy subcounterPolicy;
    private final Map<RngOrigin, RngBackend> philoxHouseholdBackends;
    private final LegacyConsumptionPolicy legacyConsumptionPolicy;
    private final Set<RngOperation> permittedOperations;

    RandomEvent(int id, EntityKind entityKind, Set<RngOrigin> validOrigins,
            SubcounterPolicy subcounterPolicy, Set<RngOrigin> philoxHouseholdOrigins,
            Set<RngOperation> permittedOperations) {
        this(id, entityKind, validOrigins, subcounterPolicy, philoxHouseholdOrigins,
                LegacyConsumptionPolicy.STANDARD, permittedOperations);
    }

    RandomEvent(int id, EntityKind entityKind, Set<RngOrigin> validOrigins,
            SubcounterPolicy subcounterPolicy, Set<RngOrigin> philoxHouseholdOrigins,
            LegacyConsumptionPolicy legacyConsumptionPolicy,
            Set<RngOperation> permittedOperations) {
        this.id = id;
        this.entityKind = Objects.requireNonNull(entityKind, "entityKind");
        this.validOrigins = Set.copyOf(validOrigins);
        this.subcounterPolicy = Objects.requireNonNull(subcounterPolicy, "subcounterPolicy");
        this.legacyConsumptionPolicy = Objects.requireNonNull(
                legacyConsumptionPolicy, "legacyConsumptionPolicy");
        this.permittedOperations = Set.copyOf(permittedOperations);
        if (this.validOrigins.isEmpty()) {
            throw new IllegalArgumentException("random event must have at least one valid origin");
        }
        if (this.permittedOperations.isEmpty()) {
            throw new IllegalArgumentException("random event must permit at least one operation");
        }
        if (!this.validOrigins.containsAll(philoxHouseholdOrigins)) {
            throw new IllegalArgumentException(
                    "philox-household routes must name valid origins only: "
                            + philoxHouseholdOrigins);
        }
        EnumMap<RngOrigin, RngBackend> backends = new EnumMap<>(RngOrigin.class);
        for (RngOrigin origin : this.validOrigins) {
            backends.put(origin, philoxHouseholdOrigins.contains(origin)
                    ? RngBackend.PHILOX
                    : RngBackend.MERSENNE);
        }
        this.philoxHouseholdBackends = backends;
    }

    int id() {
        return id;
    }

    EntityKind entityKind() {
        return entityKind;
    }

    Set<RngOrigin> validOrigins() {
        return validOrigins;
    }

    SubcounterPolicy subcounterPolicy() {
        return subcounterPolicy;
    }

    /** Returns the backend pinned for one valid origin of this event under philox-household. */
    RngBackend philoxHouseholdBackend(RngOrigin origin) {
        requireOrigin(origin);
        return philoxHouseholdBackends.get(origin);
    }

    /** Returns the complete philox-household route table, keyed by this event's valid origins. */
    Map<RngOrigin, RngBackend> philoxHouseholdBackends() {
        return Collections.unmodifiableMap(philoxHouseholdBackends);
    }

    LegacyConsumptionPolicy legacyConsumptionPolicy() {
        return legacyConsumptionPolicy;
    }

    Set<RngOperation> permittedOperations() {
        return permittedOperations;
    }

    void requireOrigin(RngOrigin origin) {
        Objects.requireNonNull(origin, "origin");
        if (!validOrigins.contains(origin)) {
            throw new IllegalArgumentException("origin " + origin + " is invalid for " + this);
        }
    }

    RngBackend backend(RngMode mode, RngOrigin origin) {
        Objects.requireNonNull(mode, "mode");
        requireOrigin(origin);
        return switch (mode) {
            case MERSENNE -> RngBackend.MERSENNE;
            case PHILOX_HOUSEHOLD -> philoxHouseholdBackends.get(origin);
            case PHILOX -> RngBackend.PHILOX;
        };
    }

    void requireOperation(RngOperation operation) {
        Objects.requireNonNull(operation, "operation");
        if (!permittedOperations.contains(operation)) {
            throw new IllegalArgumentException(
                    "operation " + operation + " is invalid for " + this);
        }
    }

    void requireNonBoundedSubcounter(RngOperation operation, int subcounter) {
        requireOperation(operation);
        if (operation == RngOperation.BOUNDED_INT) {
            throw new IllegalArgumentException(
                    "bounded operation owns its initial and retry subcounters: " + this);
        }
        subcounterPolicy.requireNonBoundedSubcounter(subcounter);
        if (subcounterPolicy == SubcounterPolicy.FIXED_TWO) {
            int expected = switch (operation) {
                case UNIFORM -> 0;
                case NORMAL -> 1;
                case BOUNDED_INT, EMPIRICAL_PDF, GEOMETRIC -> throw new IllegalArgumentException(
                        "operation " + operation + " has no FIXED_TWO slot for " + this);
            };
            if (subcounter != expected) {
                throw new IllegalArgumentException("operation " + operation + " requires "
                        + "subcounter " + expected + " for " + this + ": " + subcounter);
            }
        }
    }

    int initialBoundedSubcounter() {
        requireOperation(RngOperation.BOUNDED_INT);
        return subcounterPolicy.initialBoundedSubcounter();
    }

    private static Set<RngOrigin> origins(RngOrigin... origins) {
        return Set.of(origins);
    }

    /**
     * Names the origins of this event already routed to Philox under {@code philox-household}.
     *
     * <p>An empty list means every valid origin of the event routes Mersenne in the hybrid. Naming
     * an approved {@code (origin, event)} row here routes only that row to Philox, leaving the same
     * event reached from any other phase untouched.</p>
     */
    private static Set<RngOrigin> philoxHousehold(RngOrigin... origins) {
        return origins(origins);
    }

    private static Set<RngOperation> operations(RngOperation... operations) {
        return Set.of(operations);
    }
}
