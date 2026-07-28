package utilities;

import java.util.Iterator;

/**************************************************************************************************
 * Common interface for the two-dimensional market order-book used by the housing markets, allowing
 * the tree-based {@link PriorityQueue2D} and the array-based {@link ArrayOrderBook} to be swapped
 * for one another (and compared against each other) without touching the market code.
 *
 * The contract is exactly that of the original PriorityQueue2D: elements carry two unrelated
 * orderings, X and Y, and for a given boundary p we can extract the Y-greatest element that is not
 * X-greater than p.
 *
 * @author Orestes Hadjicostis
 *
 *************************************************************************************************/
public interface OrderBook2D<E> extends Iterable<E> {

    /** Add an element to the book */
    void add(E element);

    /** Remove an element from the book */
    void remove(E element);

    /** (Re)build the uncovered "staircase" from the current contents of the book */
    void sortPriorities();

    /** Y-greatest element that is not X-greater than xGreatestBoundary, or null if none exists */
    E peek(E xGreatestBoundary);

    /** Number of elements currently in the book */
    int size();

    /** Empty the book */
    void clear();

    /** Iterate the book in XY order. The returned iterator supports remove(). */
    @Override
    Iterator<E> iterator();
}
