package housing;

/** Meaning and permitted externally supplied range of an event's low-16-bit subcounter. */
enum SubcounterPolicy {
    SINGLE,
    FIXED_TWO,
    LISTING_EPISODE,
    BOUNDED_EXCLUSIVE;

    void requireNonBoundedSubcounter(int subcounter) {
        if (subcounter < 0 || subcounter > RandomAddressV1.MAX_UNSIGNED_16) {
            throw new IllegalArgumentException("subcounter must be in [0, "
                    + RandomAddressV1.MAX_UNSIGNED_16 + "]: " + subcounter);
        }
        switch (this) {
            case SINGLE:
                if (subcounter != 0) {
                    throw new IllegalArgumentException("SINGLE event requires subcounter 0: "
                            + subcounter);
                }
                return;
            case FIXED_TWO:
                if (subcounter > 1) {
                    throw new IllegalArgumentException(
                            "FIXED_TWO event requires subcounter 0 or 1: " + subcounter);
                }
                return;
            case LISTING_EPISODE:
                return;
            case BOUNDED_EXCLUSIVE:
                throw new IllegalArgumentException(
                        "BOUNDED_EXCLUSIVE event does not accept a caller subcounter");
        }
    }

    int initialBoundedSubcounter() {
        if (this != BOUNDED_EXCLUSIVE) {
            throw new IllegalArgumentException(
                    "bounded operation requires BOUNDED_EXCLUSIVE policy: " + this);
        }
        return 0;
    }
}
