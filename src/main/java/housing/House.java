package housing;

/**************************************************************************************************
 * Class to represent a house with all its intrinsic characteristics.
 *
 * @author daniel, Adrian Carro
 *
 *************************************************************************************************/
public class House implements Comparable<House> {

    //------------------//
    //----- Fields -----//
    //------------------//

    private static int  id_pool = 0;
    private static boolean idReservationOutstanding;

    public IHouseOwner  owner;
    public Household    resident;
    public int          id;

    HouseOfferRecord    saleRecord;
    HouseOfferRecord    rentalRecord;

    private int         quality;
    private int         nextSaleListingEpisode;
    private int         nextRentListingEpisode;

    //------------------------//
    //----- Constructors -----//
    //------------------------//

    /**
     * Creates a house of quality quality in region region
     *
     * @param quality Quality band characterizing the house
     */
    public House(int quality) {
        this(reserveId(), quality);
    }

    House(IdReservation reservation, int quality) {
        this.id = reservation.claim();
        this.owner = null;
        this.resident = null;
        this.quality = quality;
    }

    static IdReservation reserveId() {
        if (idReservationOutstanding) {
            throw new IllegalStateException("previous house ID reservation is still unclaimed");
        }
        idReservationOutstanding = true;
        return new IdReservation(id_pool + 1);
    }

    /** Reset the run-local identifier sequence before each simulation. */
    static void resetIdPoolForNewSimulation() {
        id_pool = 0;
        idReservationOutstanding = false;
    }

    //-------------------//
    //----- Methods -----//
    //-------------------//

    boolean isOnMarket() { return saleRecord != null; }

    HouseOfferRecord getSaleRecord() { return saleRecord; }

    HouseOfferRecord getRentalRecord() { return rentalRecord; }

    boolean isOnRentalMarket() { return rentalRecord != null; }
    void putForSale(HouseOfferRecord saleRecord) { this.saleRecord = saleRecord; }

    void resetSaleRecord() { saleRecord = null; }
    void putForRent(HouseOfferRecord rentalRecord) { this.rentalRecord = rentalRecord; }

    void resetRentalRecord() { rentalRecord = null; }

    int allocateSaleListingEpisode() {
        if (nextSaleListingEpisode > RandomAddressV1.MAX_UNSIGNED_16) {
            throw new IllegalStateException("sale listing episodes exhausted for house " + id);
        }
        return nextSaleListingEpisode++;
    }

    int allocateRentListingEpisode() {
        if (nextRentListingEpisode > RandomAddressV1.MAX_UNSIGNED_16) {
            throw new IllegalStateException("rent listing episodes exhausted for house " + id);
        }
        return nextRentListingEpisode++;
    }

    public int getQuality() { return quality; }

    @Override
    public int compareTo(House o) { return((int)Math.signum(id-o.id)); }

    /** Opaque claim-once reservation for randomness needed before house construction. */
    static final class IdReservation {

        private final int id;
        private boolean claimed;

        private IdReservation(int id) {
            this.id = id;
        }

        int address() {
            if (claimed || !idReservationOutstanding || id != id_pool + 1) {
                throw new IllegalStateException(
                        "house ID reservation is not available for a prospective draw: " + id);
            }
            return id;
        }

        private int claim() {
            if (claimed) {
                throw new IllegalStateException("house ID reservation already claimed: " + id);
            }
            if (!idReservationOutstanding || id != id_pool + 1) {
                throw new IllegalStateException("house ID reservation is no longer current: " + id);
            }
            claimed = true;
            id_pool = id;
            idReservationOutstanding = false;
            return id;
        }
    }

}
