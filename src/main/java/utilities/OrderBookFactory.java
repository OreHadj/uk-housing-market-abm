package utilities;

/**************************************************************************************************
 * Chooses which order-book implementation the housing markets use, so that the tree-based baseline
 * and the array-based replacement can be benchmarked and diffed against each other without editing
 * the market code.
 *
 * Selected with a JVM system property, which keeps it out of the model config files and lets the
 * existing benchmark harness switch implementations per run:
 *
 *     -Dhousing.orderbook=tree    (default - the original PriorityQueue2D, i.e. the baseline)
 *     -Dhousing.orderbook=array   (the flat ArrayOrderBook)
 *
 * The default is deliberately the tree, so that a run with no extra flags reproduces the measured
 * CPU baseline exactly.
 *
 * @author Orestes Hadjicostis
 *
 *************************************************************************************************/
public final class OrderBookFactory {

    public enum Impl { TREE, ARRAY }

    public static final String PROPERTY = "housing.orderbook";

    private static final Impl IMPL = resolve();

    private OrderBookFactory() { }

    private static Impl resolve() {
        String requested = System.getProperty(PROPERTY, "tree").trim().toLowerCase();
        switch (requested) {
            case "array": return Impl.ARRAY;
            case "tree":  return Impl.TREE;
            default:
                throw new IllegalArgumentException("Unknown " + PROPERTY + " value '" + requested
                        + "' (expected 'tree' or 'array')");
        }
    }

    public static Impl getImpl() { return IMPL; }

    /**
     * @param comparator XY comparator defining the two orderings of this book
     * @param bookId Identifier distinguishing books an element can belong to at once (see ArrayOrderBook)
     * @param initialCapacity Hint for the initial array allocation, ignored by the tree implementation
     */
    public static <E extends ArrayOrderBook.Slotted> OrderBook2D<E> create(
            PriorityQueue2D.XYComparator<E> comparator, int bookId, int initialCapacity) {
        if (IMPL == Impl.ARRAY) {
            return new ArrayOrderBook<>(comparator, bookId, initialCapacity);
        }
        return new PriorityQueue2D<>(comparator);
    }
}
