package housing;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import static java.util.Map.entry;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RandomEventTest {

    @Test
    void versionOneRegistryIsExhaustiveUniqueAndPinned() {
        Map<RandomEvent, Integer> expected = Map.ofEntries(
                entry(RandomEvent.HH_AGE_AT_CREATION, 0x0001),
                entry(RandomEvent.HH_INCOME_PERCENTILE, 0x0002),
                entry(RandomEvent.HH_PROPENSITY_TO_SAVE, 0x0003),
                entry(RandomEvent.HH_BTL_GENE, 0x0004),
                entry(RandomEvent.HH_BTL_STRATEGY, 0x0005),
                entry(RandomEvent.HH_DESIRED_PURCHASE, 0x1001),
                entry(RandomEvent.HH_DESIRED_RENT, 0x1002),
                entry(RandomEvent.RENT_OR_BUY, 0x1003),
                entry(RandomEvent.BTL_BUY, 0x1004),
                entry(RandomEvent.BTL_DOWNPAYMENT, 0x1005),
                entry(RandomEvent.HH_ALT_DESIRED_PURCHASE, 0x1006),
                entry(RandomEvent.BTL_TARGET_LTV, 0x1007),
                entry(RandomEvent.HOME_SELL, 0x2001),
                entry(RandomEvent.BTL_SELL, 0x2002),
                entry(RandomEvent.SALE_REPRICE, 0x2003),
                entry(RandomEvent.RENT_REPRICE, 0x2004),
                entry(RandomEvent.SALE_LIST_MARKUP, 0x2005),
                entry(RandomEvent.RENT_LIST_MARKUP, 0x2006),
                entry(RandomEvent.SALE_MARKET_BID_UP, 0x3001),
                entry(RandomEvent.SALE_MARKET_TIE_BREAK, 0x3002),
                entry(RandomEvent.RENT_MARKET_BID_UP, 0x3003),
                entry(RandomEvent.RENT_MARKET_TIE_BREAK, 0x3004),
                entry(RandomEvent.RENT_TENANCY_LENGTH, 0x3005),
                entry(RandomEvent.HH_DEATH, 0x4001),
                entry(RandomEvent.HH_INHERITOR, 0x4002),
                entry(RandomEvent.NEW_BUILD_QUALITY, 0x5001),
                entry(RandomEvent.NEW_BUILD_RECIPIENT, 0x5002));
        Set<Integer> ids = new HashSet<>();

        assertEquals(expected.size(), RandomEvent.values().length,
                "Adding, removing, or retiring an event requires an explicit v1 registry decision");
        for (RandomEvent event : RandomEvent.values()) {
            assertEquals(expected.get(event), event.id(), event.name());
            assertTrue(ids.add(event.id()), "duplicate event id: " + event.id());
            assertTrue(event.id() >= 0 && event.id() <= RandomAddressV1.MAX_UNSIGNED_16,
                    "event id outside its 16-bit field: " + event.name());
        }
    }

    @Test
    void dormantEventIdsRemainReservedRatherThanReused() {
        assertEquals(0x1006, RandomEvent.HH_ALT_DESIRED_PURCHASE.id());
        assertEquals(0x1007, RandomEvent.BTL_TARGET_LTV.id());
    }

    @Test
    void pureHelperBandOwnsNoEconomicEvent() {
        for (RandomEvent event : RandomEvent.values()) {
            assertTrue(event.id() < 0x6000 || event.id() > 0x6fff,
                    "pure helper band used by " + event.name());
        }
    }

    @Test
    void everyEventPinsItsExactEntityKind() {
        Map<RandomEvent, EntityKind> expected = Map.ofEntries(
                entry(RandomEvent.HH_AGE_AT_CREATION, EntityKind.HOUSEHOLD),
                entry(RandomEvent.HH_INCOME_PERCENTILE, EntityKind.HOUSEHOLD),
                entry(RandomEvent.HH_PROPENSITY_TO_SAVE, EntityKind.HOUSEHOLD),
                entry(RandomEvent.HH_BTL_GENE, EntityKind.HOUSEHOLD),
                entry(RandomEvent.HH_BTL_STRATEGY, EntityKind.HOUSEHOLD),
                entry(RandomEvent.HH_DESIRED_PURCHASE, EntityKind.HOUSEHOLD),
                entry(RandomEvent.HH_DESIRED_RENT, EntityKind.HOUSEHOLD),
                entry(RandomEvent.RENT_OR_BUY, EntityKind.HOUSEHOLD),
                entry(RandomEvent.BTL_BUY, EntityKind.HOUSEHOLD),
                entry(RandomEvent.BTL_DOWNPAYMENT, EntityKind.HOUSEHOLD),
                entry(RandomEvent.HH_ALT_DESIRED_PURCHASE, EntityKind.HOUSEHOLD),
                entry(RandomEvent.BTL_TARGET_LTV, EntityKind.HOUSEHOLD),
                entry(RandomEvent.HOME_SELL, EntityKind.HOUSE),
                entry(RandomEvent.BTL_SELL, EntityKind.HOUSE),
                entry(RandomEvent.SALE_REPRICE, EntityKind.HOUSE),
                entry(RandomEvent.RENT_REPRICE, EntityKind.HOUSE),
                entry(RandomEvent.SALE_LIST_MARKUP, EntityKind.HOUSE),
                entry(RandomEvent.RENT_LIST_MARKUP, EntityKind.HOUSE),
                entry(RandomEvent.SALE_MARKET_BID_UP, EntityKind.HOUSE),
                entry(RandomEvent.SALE_MARKET_TIE_BREAK, EntityKind.HOUSE),
                entry(RandomEvent.RENT_MARKET_BID_UP, EntityKind.HOUSE),
                entry(RandomEvent.RENT_MARKET_TIE_BREAK, EntityKind.HOUSE),
                entry(RandomEvent.RENT_TENANCY_LENGTH, EntityKind.HOUSE),
                entry(RandomEvent.HH_DEATH, EntityKind.HOUSEHOLD),
                entry(RandomEvent.HH_INHERITOR, EntityKind.HOUSEHOLD),
                entry(RandomEvent.NEW_BUILD_QUALITY, EntityKind.HOUSE),
                entry(RandomEvent.NEW_BUILD_RECIPIENT, EntityKind.HOUSE));

        assertExactRegistry(expected, RandomEvent::entityKind);
    }

    @Test
    void everyEventPinsItsExactSubcounterPolicy() {
        Map<RandomEvent, SubcounterPolicy> expected = Map.ofEntries(
                entry(RandomEvent.HH_AGE_AT_CREATION, SubcounterPolicy.SINGLE),
                entry(RandomEvent.HH_INCOME_PERCENTILE, SubcounterPolicy.SINGLE),
                entry(RandomEvent.HH_PROPENSITY_TO_SAVE, SubcounterPolicy.SINGLE),
                entry(RandomEvent.HH_BTL_GENE, SubcounterPolicy.SINGLE),
                entry(RandomEvent.HH_BTL_STRATEGY, SubcounterPolicy.SINGLE),
                entry(RandomEvent.HH_DESIRED_PURCHASE, SubcounterPolicy.SINGLE),
                entry(RandomEvent.HH_DESIRED_RENT, SubcounterPolicy.SINGLE),
                entry(RandomEvent.RENT_OR_BUY, SubcounterPolicy.SINGLE),
                entry(RandomEvent.BTL_BUY, SubcounterPolicy.SINGLE),
                entry(RandomEvent.BTL_DOWNPAYMENT, SubcounterPolicy.SINGLE),
                entry(RandomEvent.HH_ALT_DESIRED_PURCHASE, SubcounterPolicy.SINGLE),
                entry(RandomEvent.BTL_TARGET_LTV, SubcounterPolicy.SINGLE),
                entry(RandomEvent.HOME_SELL, SubcounterPolicy.SINGLE),
                entry(RandomEvent.BTL_SELL, SubcounterPolicy.SINGLE),
                entry(RandomEvent.SALE_REPRICE, SubcounterPolicy.FIXED_TWO),
                entry(RandomEvent.RENT_REPRICE, SubcounterPolicy.FIXED_TWO),
                entry(RandomEvent.SALE_LIST_MARKUP, SubcounterPolicy.LISTING_EPISODE),
                entry(RandomEvent.RENT_LIST_MARKUP, SubcounterPolicy.LISTING_EPISODE),
                entry(RandomEvent.SALE_MARKET_BID_UP, SubcounterPolicy.SINGLE),
                entry(RandomEvent.SALE_MARKET_TIE_BREAK, SubcounterPolicy.BOUNDED_EXCLUSIVE),
                entry(RandomEvent.RENT_MARKET_BID_UP, SubcounterPolicy.SINGLE),
                entry(RandomEvent.RENT_MARKET_TIE_BREAK, SubcounterPolicy.BOUNDED_EXCLUSIVE),
                entry(RandomEvent.RENT_TENANCY_LENGTH, SubcounterPolicy.BOUNDED_EXCLUSIVE),
                entry(RandomEvent.HH_DEATH, SubcounterPolicy.SINGLE),
                entry(RandomEvent.HH_INHERITOR, SubcounterPolicy.BOUNDED_EXCLUSIVE),
                entry(RandomEvent.NEW_BUILD_QUALITY, SubcounterPolicy.BOUNDED_EXCLUSIVE),
                entry(RandomEvent.NEW_BUILD_RECIPIENT, SubcounterPolicy.BOUNDED_EXCLUSIVE));

        assertExactRegistry(expected, RandomEvent::subcounterPolicy);
    }

    @Test
    void everyEventPinsItsExactValidOrigins() {
        Map<RandomEvent, Set<RngOrigin>> expected = Map.ofEntries(
                entry(RandomEvent.HH_AGE_AT_CREATION, origins(RngOrigin.DEMOGRAPHICS)),
                entry(RandomEvent.HH_INCOME_PERCENTILE, origins(RngOrigin.DEMOGRAPHICS)),
                entry(RandomEvent.HH_PROPENSITY_TO_SAVE, origins(RngOrigin.DEMOGRAPHICS)),
                entry(RandomEvent.HH_BTL_GENE, origins(RngOrigin.DEMOGRAPHICS)),
                entry(RandomEvent.HH_BTL_STRATEGY, origins(RngOrigin.DEMOGRAPHICS)),
                entry(RandomEvent.HH_DESIRED_PURCHASE, origins(RngOrigin.HOUSEHOLD_LOOP)),
                entry(RandomEvent.HH_DESIRED_RENT, origins(RngOrigin.HOUSEHOLD_LOOP)),
                entry(RandomEvent.RENT_OR_BUY, origins(RngOrigin.HOUSEHOLD_LOOP)),
                entry(RandomEvent.BTL_BUY, origins(RngOrigin.HOUSEHOLD_LOOP)),
                entry(RandomEvent.BTL_DOWNPAYMENT, origins(RngOrigin.HOUSEHOLD_LOOP)),
                entry(RandomEvent.HH_ALT_DESIRED_PURCHASE, origins(RngOrigin.HOUSEHOLD_LOOP)),
                entry(RandomEvent.BTL_TARGET_LTV, origins(RngOrigin.HOUSEHOLD_LOOP)),
                entry(RandomEvent.HOME_SELL, origins(RngOrigin.HOUSEHOLD_LOOP)),
                entry(RandomEvent.BTL_SELL, origins(RngOrigin.HOUSEHOLD_LOOP)),
                entry(RandomEvent.SALE_REPRICE, origins(RngOrigin.HOUSEHOLD_LOOP)),
                entry(RandomEvent.RENT_REPRICE, origins(RngOrigin.HOUSEHOLD_LOOP)),
                entry(RandomEvent.SALE_LIST_MARKUP, origins(RngOrigin.HOUSEHOLD_LOOP,
                        RngOrigin.DEMOGRAPHICS, RngOrigin.CONSTRUCTION)),
                entry(RandomEvent.RENT_LIST_MARKUP, origins(RngOrigin.HOUSEHOLD_LOOP,
                        RngOrigin.SALE_CLEARING, RngOrigin.DEMOGRAPHICS,
                        RngOrigin.CONSTRUCTION)),
                entry(RandomEvent.SALE_MARKET_BID_UP, origins(RngOrigin.SALE_CLEARING)),
                entry(RandomEvent.SALE_MARKET_TIE_BREAK, origins(RngOrigin.SALE_CLEARING)),
                entry(RandomEvent.RENT_MARKET_BID_UP, origins(RngOrigin.RENT_CLEARING)),
                entry(RandomEvent.RENT_MARKET_TIE_BREAK, origins(RngOrigin.RENT_CLEARING)),
                entry(RandomEvent.RENT_TENANCY_LENGTH, origins(RngOrigin.RENT_CLEARING)),
                entry(RandomEvent.HH_DEATH, origins(RngOrigin.DEMOGRAPHICS)),
                entry(RandomEvent.HH_INHERITOR, origins(RngOrigin.DEMOGRAPHICS)),
                entry(RandomEvent.NEW_BUILD_QUALITY, origins(RngOrigin.CONSTRUCTION)),
                entry(RandomEvent.NEW_BUILD_RECIPIENT, origins(RngOrigin.CONSTRUCTION)));

        assertExactRegistry(expected, RandomEvent::validOrigins);
    }

    @Test
    void everyValidModeOriginEventRouteHasAnExplicitBackend() {
        for (RandomEvent event : RandomEvent.values()) {
            assertEquals(event.validOrigins(), event.philoxHouseholdBackends().keySet(),
                    event.name());
            for (RngOrigin origin : event.validOrigins()) {
                assertEquals(RngBackend.MERSENNE,
                        event.backend(RngMode.MERSENNE, origin), event.name());
                assertEquals(RngBackend.MERSENNE,
                        event.philoxHouseholdBackend(origin), event.name());
                assertEquals(event.philoxHouseholdBackend(origin),
                        event.backend(RngMode.PHILOX_HOUSEHOLD, origin), event.name());
                assertEquals(RngBackend.PHILOX,
                        event.backend(RngMode.PHILOX, origin), event.name());
            }
        }
    }

    /**
     * Step 9 migrates one {@code (origin, event)} row at a time, so an event reachable from several
     * top-level phases must carry an independent decision for each of them. Without this, flipping
     * the household-loop listing markup would silently flip the inheritance and new-build markups
     * that share its event ID.
     */
    @Test
    void philoxHouseholdRoutingIsPinnedPerOriginNotPerEvent() {
        assertEquals(
                Map.of(RngOrigin.HOUSEHOLD_LOOP, RngBackend.MERSENNE,
                        RngOrigin.DEMOGRAPHICS, RngBackend.MERSENNE,
                        RngOrigin.CONSTRUCTION, RngBackend.MERSENNE),
                RandomEvent.SALE_LIST_MARKUP.philoxHouseholdBackends());
        assertEquals(
                Map.of(RngOrigin.HOUSEHOLD_LOOP, RngBackend.MERSENNE,
                        RngOrigin.SALE_CLEARING, RngBackend.MERSENNE,
                        RngOrigin.DEMOGRAPHICS, RngBackend.MERSENNE,
                        RngOrigin.CONSTRUCTION, RngBackend.MERSENNE),
                RandomEvent.RENT_LIST_MARKUP.philoxHouseholdBackends());

        for (RandomEvent event : RandomEvent.values()) {
            for (RngOrigin origin : RngOrigin.values()) {
                if (!event.validOrigins().contains(origin)) {
                    assertThrows(IllegalArgumentException.class,
                            () -> event.philoxHouseholdBackend(origin), event + "/" + origin);
                }
            }
        }
    }

    @Test
    void philoxHouseholdRouteTableIsUnmodifiable() {
        assertThrows(UnsupportedOperationException.class,
                () -> RandomEvent.SALE_LIST_MARKUP.philoxHouseholdBackends()
                        .put(RngOrigin.HOUSEHOLD_LOOP, RngBackend.PHILOX));
    }

    @Test
    void everyInvalidOriginEventCombinationThrowsWithoutFallback() {
        for (RandomEvent event : RandomEvent.values()) {
            for (RngOrigin origin : RngOrigin.values()) {
                if (!event.validOrigins().contains(origin)) {
                    for (RngMode mode : RngMode.values()) {
                        assertThrows(IllegalArgumentException.class,
                                () -> event.backend(mode, origin),
                                mode + "/" + origin + "/" + event);
                    }
                }
            }
        }
    }

    @Test
    void boundedExclusiveEventsRejectEveryNonBoundedOperation() {
        Set<RngOperation> nonBounded = Set.of(RngOperation.UNIFORM, RngOperation.NORMAL,
                RngOperation.EMPIRICAL_PDF, RngOperation.GEOMETRIC);

        for (RandomEvent event : RandomEvent.values()) {
            if (event.subcounterPolicy() == SubcounterPolicy.BOUNDED_EXCLUSIVE) {
                assertEquals(Set.of(RngOperation.BOUNDED_INT), event.permittedOperations(),
                        event.name());
                for (RngOperation operation : nonBounded) {
                    assertThrows(IllegalArgumentException.class,
                            () -> event.requireNonBoundedSubcounter(operation, 0),
                            event + "/" + operation);
                }
            }
        }
    }

    @Test
    void productionBoundedOperationsAlwaysOwnSubcounterZero() {
        for (RandomEvent event : RandomEvent.values()) {
            if (event.subcounterPolicy() == SubcounterPolicy.BOUNDED_EXCLUSIVE) {
                assertEquals(0, event.initialBoundedSubcounter(), event.name());
            } else {
                assertThrows(IllegalArgumentException.class, event::initialBoundedSubcounter,
                        event.name());
            }
        }

        assertDoesNotThrow(() -> RandomEvent.class.getDeclaredMethod(
                "initialBoundedSubcounter"));
        assertThrows(NoSuchMethodException.class, () -> RandomEvent.class.getDeclaredMethod(
                "initialBoundedSubcounter", int.class));
    }

    @Test
    void listingMarkupOriginsAreExactAndExcludeRentClearing() {
        assertEquals(origins(RngOrigin.HOUSEHOLD_LOOP, RngOrigin.DEMOGRAPHICS,
                        RngOrigin.CONSTRUCTION),
                RandomEvent.SALE_LIST_MARKUP.validOrigins());
        assertEquals(origins(RngOrigin.HOUSEHOLD_LOOP, RngOrigin.SALE_CLEARING,
                        RngOrigin.DEMOGRAPHICS, RngOrigin.CONSTRUCTION),
                RandomEvent.RENT_LIST_MARKUP.validOrigins());
        assertThrows(IllegalArgumentException.class,
                () -> RandomEvent.SALE_LIST_MARKUP.requireOrigin(RngOrigin.RENT_CLEARING));
        assertThrows(IllegalArgumentException.class,
                () -> RandomEvent.RENT_LIST_MARKUP.requireOrigin(RngOrigin.RENT_CLEARING));
    }

    @Test
    void legacyConsumptionExceptionIsPinnedOnlyToNewBuildQuality() {
        for (RandomEvent event : RandomEvent.values()) {
            LegacyConsumptionPolicy expected = event == RandomEvent.NEW_BUILD_QUALITY
                    ? LegacyConsumptionPolicy.FLOOR_OF_UNIFORM_BOUNDED
                    : LegacyConsumptionPolicy.STANDARD;
            assertEquals(expected, event.legacyConsumptionPolicy(), event.name());
        }
    }

    private static <T> void assertExactRegistry(
            Map<RandomEvent, T> expected, EventAttribute<T> attribute) {
        assertEquals(RandomEvent.values().length, expected.size());
        for (RandomEvent event : RandomEvent.values()) {
            assertEquals(expected.get(event), attribute.get(event), event.name());
        }
    }

    private static Set<RngOrigin> origins(RngOrigin... origins) {
        return Set.of(origins);
    }

    @FunctionalInterface
    private interface EventAttribute<T> {
        T get(RandomEvent event);
    }
}
