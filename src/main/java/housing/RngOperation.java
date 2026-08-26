package housing;

/** Typed random operation permitted by an economic event. */
enum RngOperation {
    UNIFORM,
    NORMAL,
    BOUNDED_INT,
    EMPIRICAL_PDF,
    GEOMETRIC
}
