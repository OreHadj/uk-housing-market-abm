package housing;

/** Top-level stochastic phase whose identity survives every nested callback. */
enum RngOrigin {
    DEMOGRAPHICS,
    CONSTRUCTION,
    HOUSEHOLD_LOOP,
    SALE_CLEARING,
    RENT_CLEARING
}
