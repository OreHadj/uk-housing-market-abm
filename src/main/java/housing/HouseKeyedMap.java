package housing;

import java.util.Arrays;

/**************************************************************************************************
 * Array-backed replacement for the per-household {@code TreeMap<House, V>} objects
 * ({@code housePayments}, {@code rentalContracts}), keyed and ordered by {@link House#id}.
 *
 * MOTIVATION. Profiling after the order-book refactor showed {@code java.util.TreeMap.successor} as
 * the single hottest method in the model (~15% of self time): red-black-tree iteration over maps
 * that almost always hold zero or one entry. Households in social housing hold none, owner-occupiers
 * one, and only buy-to-let investors hold more. Paying tree machinery - node allocation, pointer
 * chasing, comparator dispatch - for a collection of size 1, ten thousand times a month for two
 * thousand months, is pure overhead.
 *
 * It is also the last data-structure blocker to the GPU port: these maps are read and written from
 * inside the household loop, so they must be flat before household state can move to the device.
 *
 * ORDERING. {@code House.compareTo} is {@code signum(id - o.id)}, so a TreeMap keyed on House
 * iterates in ascending id order. This class keeps the same order by holding keys in an id-sorted
 * array and locating them by binary search, so iteration order - which is observable, because
 * several callers accumulate doubles while walking these maps and floating-point addition is not
 * associative - is unchanged.
 *
 * Ids are small positive ints, so {@code Integer.compare} agrees with {@code signum} of the
 * difference without risk of overflow.
 *
 * ALLOCATION. Backing arrays start empty and shared, and are only allocated on first insertion, so
 * the many households that own nothing cost nothing. TreeMap likewise allocates no nodes until used,
 * so this preserves that property rather than regressing it.
 *
 * @author Orestes Hadjicostis
 *
 *************************************************************************************************/
public class HouseKeyedMap<V> {

    //------------------//
    //----- Fields -----//
    //------------------//

    private static final House[]    EMPTY_KEYS = new House[0];
    private static final Object[]   EMPTY_VALUES = new Object[0];

    private House[]     keys = EMPTY_KEYS;     // ascending House.id
    private Object[]    values = EMPTY_VALUES; // parallel to keys
    private int         size;

    //-------------------//
    //----- Methods -----//
    //-------------------//

    //----- Map-style access -----//

    public V get(House house) {
        int i = indexOf(house);
        return i < 0 ? null : valueAt(i);
    }

    public boolean containsKey(House house) { return indexOf(house) >= 0; }

    /**
     * @return the previous value for this house, or null if it was not present (matching Map.put)
     */
    public V put(House house, V value) {
        int i = indexOf(house);
        if (i >= 0) {
            V previous = valueAt(i);
            values[i] = value;
            return previous;
        }
        int insertionPoint = -i - 1;
        if (size == keys.length) grow();
        System.arraycopy(keys, insertionPoint, keys, insertionPoint + 1, size - insertionPoint);
        System.arraycopy(values, insertionPoint, values, insertionPoint + 1, size - insertionPoint);
        keys[insertionPoint] = house;
        values[insertionPoint] = value;
        size++;
        return null;
    }

    /**
     * @return the removed value, or null if the house was not present (matching Map.remove)
     */
    public V remove(House house) {
        int i = indexOf(house);
        if (i < 0) return null;
        V previous = valueAt(i);
        removeAt(i);
        return previous;
    }

    //----- Index-based iteration -----//
    // Callers walk the map by index rather than through an Iterator. Removal during iteration is done
    // with removeAt(i) without advancing i, which is the array equivalent of Iterator.remove().

    public int size() { return size; }

    public House keyAt(int i) { return keys[i]; }

    @SuppressWarnings("unchecked")
    public V valueAt(int i) { return (V) values[i]; }

    public void removeAt(int i) {
        int trailing = size - i - 1;
        System.arraycopy(keys, i + 1, keys, i, trailing);
        System.arraycopy(values, i + 1, values, i, trailing);
        size--;
        keys[size] = null; // Release references so entries do not pin dead houses/agreements
        values[size] = null;
    }

    //----- Internals -----//

    /**
     * @return index of the house, or -(insertion point) - 1 if absent, as per Arrays.binarySearch
     */
    private int indexOf(House house) {
        int id = house.id;
        int lo = 0;
        int hi = size - 1;
        while (lo <= hi) {
            int mid = (lo + hi) >>> 1;
            int c = Integer.compare(keys[mid].id, id);
            if (c < 0) {
                lo = mid + 1;
            } else if (c > 0) {
                hi = mid - 1;
            } else {
                return mid;
            }
        }
        return -(lo + 1);
    }

    private void grow() {
        // Most households hold 0-1 entries, so start small and double from there
        int capacity = keys.length == 0 ? 2 : keys.length * 2;
        keys = Arrays.copyOf(keys, capacity);
        values = Arrays.copyOf(values, capacity);
    }
}
