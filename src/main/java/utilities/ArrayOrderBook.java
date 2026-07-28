package utilities;

import java.util.Iterator;
import java.util.NoSuchElementException;

/**************************************************************************************************
 * Array-based drop-in replacement for {@link PriorityQueue2D}, built as the enabling step for GPU
 * parallelisation of the household decision loop.
 *
 * MOTIVATION. PriorityQueue2D keeps two red-black trees (TreeSets) over the live offers. Households
 * mutate those trees from inside the household loop (offer / updateOffer / removeOffer), so the loop
 * cannot be parallelised: concurrent insertion into a shared tree requires locking, and locking
 * re-serialises the loop. This class replaces the trees with a flat slot arena, turning a household's
 * market interaction into "append to an array" and "clear a flag" - both parallel-safe.
 *
 * LAYOUT. Elements live in a slot arena. After a sort, the arena is compacted so that
 *
 *     slot index == rank in XY order
 *
 * which makes the "elements strictly between A and B in XY order" range queries used by the staircase
 * repair a plain contiguous index range, with no pointer chasing and no boundary search. New elements
 * appended after the sort occupy an unsorted tail at slots [nRanked, nUsed); the next sort re-compacts
 * and re-ranks everything.
 *
 * WHEN THE ORDER IS BUILT. Sort keys are immutable over the whole window from the end of the household
 * loop to the end of market clearing: HouseOfferRecord.setPrice (which also recomputes the yield used
 * by the price-yield book) is only ever called on an offer that has already been removed from both
 * books (see HousingMarket.clearMatches, where removeOfferFromQueues precedes setPrice). Removals
 * therefore preserve sortedness, and only add() marks the order dirty. The sort is done lazily, on the
 * first operation that needs it, which is HousingMarketStats.preClearingRecord iterating the book.
 *
 * BIT-IDENTICAL BEHAVIOUR. The uncovered "staircase" of PriorityQueue2D is a TreeSet keyed on the X
 * coordinate ALONE, so it holds at most one element per distinct X value. That produces three
 * behaviours which look like bugs but are load-bearing, and which this class reproduces exactly:
 *
 *   Q1  In the repair loop, an insert whose X value is already on the staircase is silently dropped,
 *       but lastElementAdded is still advanced to the dropped element (PriorityQueue2D:200-203), which
 *       changes the acceptance test for every element after it. See stairInsert() + repairStaircase().
 *   Q2  Removal from the staircase is by X value, not by identity (PriorityQueue2D:178): if the element
 *       being removed shares its X value with a different element on the staircase, the other one is
 *       evicted and the repair proceeds from there. See stairSearch() used by repairStaircase().
 *   Q3  When the removed element was the first on the staircase, the XY-first element of the whole book
 *       is added unconditionally (PriorityQueue2D:189-192).
 *
 * These can only fire during market clearing, never during the household loop: a rebuild by
 * sortPriorities() always yields a staircase whose X values are STRICTLY increasing. Proof: equal X
 * implies the XY comparator orders by Y descending, so a later element of equal X is never strictly
 * Y-greater than the last one added, and is therefore never even offered to the staircase.
 *
 * @author Orestes Hadjicostis
 *
 *************************************************************************************************/
public class ArrayOrderBook<E extends ArrayOrderBook.Slotted> implements OrderBook2D<E> {

    //----------------------//
    //----- Subclasses -----//
    //----------------------//

    /**
     * Implemented by elements stored in an ArrayOrderBook, so that the book can find an element's slot
     * in O(1) without a hash lookup. An element may sit in more than one book at a time (the sale
     * market keeps both a price-quality and a price-yield book over the same offers), so slots are
     * held per book id.
     */
    public interface Slotted {
        int getBookSlot(int bookId);
        void setBookSlot(int bookId, int slot);
    }

    /** Number of distinct books a single element can belong to simultaneously */
    public static final int MAX_BOOKS = 2;

    /** Book ids, used to index the per-element slot storage */
    public static final int BOOK_PRICE_QUALITY = 0;
    public static final int BOOK_PRICE_YIELD = 1;

    private static final int NO_SLOT = -1;

    //------------------//
    //----- Fields -----//
    //------------------//

    private final PriorityQueue2D.XYComparator<E> comparator;
    private final int bookId;

    // Slot arena. Slots [0, nRanked) are in XY order; slots [nRanked, nUsed) are an unsorted tail of
    // elements appended since the last sort. Dead slots keep their element reference until the next
    // compaction, because the staircase repair needs their XY rank as a range boundary.
    private Object[] element;
    private boolean[] alive;
    private int nUsed;
    private int nRanked;
    private int nLive;

    // Cursor for the XY-first live element. Elements are only removed (never added) between a sort and
    // the end of clearing, so this only ever advances.
    private int firstLiveSlot;

    // The uncovered staircase: slot indices, X-ascending and Y-ascending.
    private int[] stair;
    private int nStair;
    private boolean staircaseValid;

    // Scratch buffer for the merge sort, retained across months to avoid re-allocating every step
    private int[] sortScratch;

    // Instrumentation: staircase repairs performed on a staircase that is later thrown away wholesale
    // by sortPriorities(). Correctness does not depend on this being zero - the repair is reproduced
    // faithfully either way - but a high count is the measure of how much work the tree version wastes
    // inside the household loop, and hence of what the GPU port stands to remove.
    private static long discardedRepairs = 0;
    private long repairsSinceRebuild = 0;

    //------------------------//
    //----- Constructors -----//
    //------------------------//

    public ArrayOrderBook(PriorityQueue2D.XYComparator<E> comparator, int bookId, int initialCapacity) {
        this.comparator = comparator;
        this.bookId = bookId;
        int cap = Math.max(16, initialCapacity);
        element = new Object[cap];
        alive = new boolean[cap];
        stair = new int[cap];
        sortScratch = new int[cap];
    }

    //-------------------//
    //----- Methods -----//
    //-------------------//

    //----- Public API (mirrors PriorityQueue2D) -----//

    @Override
    public void add(E e) {
        if (nUsed == element.length) grow();
        int slot = nUsed++;
        element[slot] = e;
        alive[slot] = true;
        e.setBookSlot(bookId, slot);
        nLive++;
        // The tail is unsorted, so both the XY order and the staircase are now stale
        staircaseValid = false;
    }

    @Override
    public void remove(E e) {
        int slot = e.getBookSlot(bookId);
        if (slot == NO_SLOT) return; // Not in this book
        alive[slot] = false;
        e.setBookSlot(bookId, NO_SLOT);
        nLive--;
        if (slot == firstLiveSlot) advanceFirstLive();
        // Removals preserve XY sortedness, so only the staircase needs repairing - and only if there is
        // a live staircase to repair. If add() has already invalidated it, the tree version's repair
        // work would be discarded by the next sortPriorities() rebuild, so skipping it is unobservable.
        if (staircaseValid) {
            repairStaircase(slot, e);
            repairsSinceRebuild++;
        }
    }

    @Override
    public void sortPriorities() {
        ensureRanked();
        rebuildStaircase();
    }

    @Override
    public E peek(E xGreatestBoundary) {
        // Guard for the invariant the whole design rests on: nothing queries the staircase between a
        // mutation and the next rebuild, so staircase state during the household loop is unobservable.
        // If this ever fires, the "repair during the household loop is dead work" finding is wrong.
        if (!staircaseValid) {
            throw new IllegalStateException(
                    "peek() called on a stale staircase - sortPriorities() must run after any add()");
        }
        int i = floorOnStaircase(xGreatestBoundary);
        return i < 0 ? null : elementAt(stair[i]);
    }

    @Override
    public int size() { return nLive; }

    @Override
    public void clear() {
        for (int s = 0; s < nUsed; s++) {
            if (alive[s]) elementAt(s).setBookSlot(bookId, NO_SLOT);
            element[s] = null;
            alive[s] = false;
        }
        nUsed = 0;
        nRanked = 0;
        nLive = 0;
        firstLiveSlot = 0;
        nStair = 0;
        staircaseValid = false;
    }

    @Override
    public Iterator<E> iterator() {
        ensureRanked(); // Callers rely on XY order (HousingMarketStats sums offer prices in this order)
        return new Iter();
    }

    /** Total staircase repairs whose result was later discarded by a wholesale rebuild */
    public static long getDiscardedRepairs() { return discardedRepairs; }

    //----- XY ordering -----//

    /**
     * Bring the arena into XY order, compacting away dead slots so that slot index == XY rank. Cheap
     * no-op when nothing has been added since the last sort.
     */
    private void ensureRanked() {
        if (nUsed == nRanked) return; // No unsorted tail, so the ranking still holds

        // Gather live slots, sort them by the XY comparator, then rewrite the arena densely
        if (sortScratch.length < nUsed) sortScratch = new int[element.length];
        int[] live = new int[nLive];
        int n = 0;
        for (int s = 0; s < nUsed; s++) {
            if (alive[s]) live[n++] = s;
        }
        mergeSortByXY(live, 0, n);

        Object[] compacted = new Object[element.length];
        for (int i = 0; i < n; i++) {
            E e = elementAt(live[i]);
            compacted[i] = e;
            e.setBookSlot(bookId, i);
        }
        element = compacted;
        java.util.Arrays.fill(alive, 0, nUsed, false);
        java.util.Arrays.fill(alive, 0, n, true);
        nUsed = n;
        nRanked = n;
        firstLiveSlot = 0;
        staircaseValid = false;
    }

    /**
     * Stable merge sort over slot indices using the XY comparator. Java's primitive Arrays.sort cannot
     * take a comparator, and boxing to Integer[] would reintroduce exactly the pointer chasing this
     * class exists to remove. The XY comparator is a total order (it tie-breaks on a unique id), so
     * stability is not required for determinism, but a merge sort makes that easy to reason about.
     */
    private void mergeSortByXY(int[] a, int lo, int hi) {
        if (hi - lo < 2) return;
        int mid = (lo + hi) >>> 1;
        mergeSortByXY(a, lo, mid);
        mergeSortByXY(a, mid, hi);
        int i = lo, j = mid, k = lo;
        while (i < mid && j < hi) {
            sortScratch[k++] = comparator.XYCompare(elementAt(a[i]), elementAt(a[j])) <= 0 ? a[i++] : a[j++];
        }
        while (i < mid) sortScratch[k++] = a[i++];
        while (j < hi) sortScratch[k++] = a[j++];
        System.arraycopy(sortScratch, lo, a, lo, hi - lo);
    }

    //----- The uncovered staircase -----//

    /**
     * Rebuild the staircase from scratch, mirroring PriorityQueue2D.sortPriorities. The first element in
     * XY order is uncovered by definition; every later element joins only if it is strictly Y-greater
     * than the last one added. As argued in the class comment, the duplicate-X drop cannot fire here, so
     * the resulting staircase has strictly increasing X values.
     */
    private void rebuildStaircase() {
        if (repairsSinceRebuild > 0) {
            discardedRepairs += repairsSinceRebuild;
            repairsSinceRebuild = 0;
        }
        nStair = 0;
        if (nLive == 0) {
            staircaseValid = true;
            return;
        }
        if (stair.length < nLive) stair = new int[Math.max(nLive, stair.length * 2)];
        // Dead slots survive until the next compaction, and ensureRanked() is a no-op in a month where
        // nothing was added, so the scan cannot assume a hole-free arena starting at slot 0
        advanceFirstLive();
        int lastAdded = firstLiveSlot;
        stair[nStair++] = lastAdded;
        for (int s = lastAdded + 1; s < nUsed; s++) {
            if (!alive[s]) continue;
            if (comparator.YCompare(elementAt(s), elementAt(lastAdded)) == 1) {
                stair[nStair++] = s;
                lastAdded = s;
            }
        }
        staircaseValid = true;
    }

    /**
     * Faithful port of PriorityQueue2D.removeFromUncovered, including quirks Q1, Q2 and Q3 described in
     * the class comment. Called after the element has already been marked dead, matching the tree
     * version, where xySortedElements.remove precedes removeFromUncovered.
     *
     * @param slot XY rank of the removed element, retained as the lower bound of the repair range
     * @param removed The removed element, whose X value drives the staircase lookup
     */
    private void repairStaircase(int slot, E removed) {
        // Q2: the lookup is by X value, so this may evict a different element that shares the X value
        int k = stairSearch(removed);
        if (k < 0) return; // Nothing on the staircase at this X value: the tree's remove() returned false
        System.arraycopy(stair, k + 1, stair, k, nStair - k - 1);
        nStair--;

        if (nLive == 0) return;

        // After the shift, stair[k] is the entry with the smallest X strictly greater than the removed
        // one, and stair[k - 1] the one with the largest X strictly less
        int nextHigher = (k < nStair) ? stair[k] : NO_SLOT;
        int lastAdded = (k > 0) ? stair[k - 1] : NO_SLOT;

        // Q3: with nothing below it, the XY-first element of the book is uncovered by definition
        if (lastAdded == NO_SLOT) {
            lastAdded = firstLiveSlot;
            stairInsert(lastAdded);
        }

        // The elements that may have become uncovered are those strictly between the removed element and
        // the next staircase entry in XY order. Because slot index == XY rank, that is a plain range.
        int end = (nextHigher == NO_SLOT) ? nUsed : nextHigher;
        for (int s = slot + 1; s < end; s++) {
            if (!alive[s]) continue;
            if (comparator.YCompare(elementAt(s), elementAt(lastAdded)) == 1) {
                stairInsert(s); // Q1: may be dropped on an X-value tie...
                lastAdded = s;  // ...but lastAdded advances either way
            }
        }
    }

    /**
     * Insert a slot into the staircase, keyed on X value alone.
     *
     * @return false if an entry with the same X value is already present, in which case nothing is
     *         inserted - this is the TreeSet.add contract that produces quirk Q1
     */
    private boolean stairInsert(int slot) {
        int r = stairSearch(elementAt(slot));
        if (r >= 0) return false; // X value already on the staircase
        int ip = -r - 1;
        if (nStair == stair.length) stair = java.util.Arrays.copyOf(stair, stair.length * 2);
        System.arraycopy(stair, ip, stair, ip + 1, nStair - ip);
        stair[ip] = slot;
        nStair++;
        return true;
    }

    /**
     * Binary search of the staircase by X value.
     *
     * @return index of the entry with the same X value, or -(insertion point) - 1 if there is none
     */
    private int stairSearch(E key) {
        int lo = 0, hi = nStair - 1;
        while (lo <= hi) {
            int mid = (lo + hi) >>> 1;
            int c = comparator.XCompare(elementAt(stair[mid]), key);
            if (c < 0) lo = mid + 1;
            else if (c > 0) hi = mid - 1;
            else return mid;
        }
        return -(lo + 1);
    }

    /** Index of the last staircase entry whose X value is not greater than the boundary, or -1 */
    private int floorOnStaircase(E boundary) {
        int r = stairSearch(boundary);
        return r >= 0 ? r : -r - 2;
    }

    //----- Housekeeping -----//

    @SuppressWarnings("unchecked")
    private E elementAt(int slot) { return (E) element[slot]; }

    private void advanceFirstLive() {
        while (firstLiveSlot < nUsed && !alive[firstLiveSlot]) firstLiveSlot++;
    }

    private void grow() {
        int cap = element.length * 2;
        element = java.util.Arrays.copyOf(element, cap);
        alive = java.util.Arrays.copyOf(alive, cap);
        sortScratch = new int[cap];
    }

    /**
     * Iterator over live elements in XY order. Mirrors PriorityQueue2D.Iter: removing through the
     * iterator also repairs the staircase.
     */
    private class Iter implements Iterator<E> {
        private int next = 0;
        private int last = NO_SLOT;

        Iter() { skipDead(); }

        private void skipDead() {
            while (next < nUsed && !alive[next]) next++;
        }

        @Override
        public boolean hasNext() { return next < nUsed; }

        @Override
        public E next() {
            if (next >= nUsed) throw new NoSuchElementException();
            last = next++;
            skipDead();
            return elementAt(last);
        }

        @Override
        public void remove() {
            if (last == NO_SLOT) throw new IllegalStateException();
            ArrayOrderBook.this.remove(elementAt(last));
            last = NO_SLOT;
        }
    }
}
