package housing;

import java.util.ArrayList;

import utilities.Precision;

/**************************************************************************************************
 * This class encapsulates information on a house that is to be offered on the rental or the
 * ownership housing market. One can think of it as the file an estate agent would have on each
 * property managed.
 *
 *
 * @author daniel, Adrian Carro
 *
 *************************************************************************************************/
public class HouseOfferRecord extends HousingMarketRecord {

    //------------------//
    //----- Fields -----//
    //------------------//

    private House                           house;
    private ArrayList<HouseBidderRecord>    matchedBids;
    private double                          initialListedPrice;
    private int                             tInitialListing; // Time of initial listing
    private double                          houseSpecificYield;
    private boolean                         BTLOffer; // True if buy-to-let investor offering an investment property, false if homeowner offering home (Note that rental offers are all set to false)

    //------------------------//
    //----- Constructors -----//
    //------------------------//

    public HouseOfferRecord(House house, double price, boolean BTLOffer,
            int initialListingTime) {
        super(price);
        if (initialListingTime < 0) {
            throw new IllegalArgumentException(
                    "initial listing timeStep must be non-negative: " + initialListingTime);
        }
        this.house = house;
        this.BTLOffer = BTLOffer;
        initialListedPrice = Precision.store(
                Precision.Field.OFFER_INITIAL_LISTED_PRICE,
                getPrice());
        tInitialListing = initialListingTime;
        matchedBids = new ArrayList<>(8); // TODO: Check if this initial size of 8 is good enough or can be improved
        recalculateHouseSpecificYield(getPrice());
    }

    //-------------------//
    //----- Methods -----//
    //-------------------//

    /**
     * Expected gross rental yield for this particular property, obtained by multiplying the average flow gross rental
     * yield for houses of this quality in this particular region by the average sale price for houses of this quality
     * in this region and dividing by the actual listed price of this property
     *
     * @param price Updated price of the property
     */
    private void recalculateHouseSpecificYield(double price) {
        int q = house.getQuality();
        if (price > 0) {
            houseSpecificYield = Precision.store(
                    Precision.Field.OFFER_HOUSE_SPECIFIC_YIELD,
                    Model.rentalMarketStats.getAvFlowYieldForQuality(q)
                            *Model.housingMarketStats.getExpAvSalePriceForQuality(q)
                            /price);
        }
    }

    /**
     * Record the match of the offer of this property with a bid
     *
     * @param bid The bid being matched to the offer
     */
    void matchWith(HouseBidderRecord bid) { matchedBids.add(bid); }

    //----- Getter/setter methods -----//

    /**
     * Quality of this property
     */
    @Override
    public int getQuality() { return house.getQuality(); }

    /**
     * Expected gross yield for this particular house, based on the current average flow yield and the actual listed
     * price for the house, and taking into account both the quality and the expected occupancy levels
     */
    @Override
    public double getYield() { return houseSpecificYield; }

    /**
     * Set the listed price for this property
     *
     * @param newPrice The new listed price for this property
     */
    public void setPrice(double newPrice) {
        super.setPrice(newPrice);
        recalculateHouseSpecificYield(getPrice());
    }

    public House getHouse() { return house; }

    ArrayList<HouseBidderRecord> getMatchedBids() { return matchedBids; }

    public double getInitialListedPrice() { return initialListedPrice; }

    public int getInitialListingTime() { return tInitialListing; }

    /** Compatibility accessor for existing collectors. */
    public int gettInitialListing() { return getInitialListingTime(); }

    public boolean isBTLOffer() { return BTLOffer; }
}
