package housing;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ListingEpisodeTest {

    @Test
    void saleAndRentEpisodesStartAtZeroAndAdvanceIndependently() {
        House house = new House(0);

        assertEquals(0, house.allocateSaleListingEpisode());
        assertEquals(1, house.allocateSaleListingEpisode());
        assertEquals(0, house.allocateRentListingEpisode());
        assertEquals(2, house.allocateSaleListingEpisode());
        assertEquals(1, house.allocateRentListingEpisode());
    }

    @Test
    void ownershipChangesDoNotResetEitherEpisodeSequence() {
        House house = new House(0);
        IHouseOwner firstOwner = new NoOpOwner();
        IHouseOwner secondOwner = new NoOpOwner();

        house.owner = firstOwner;
        assertEquals(0, house.allocateSaleListingEpisode());
        assertEquals(0, house.allocateRentListingEpisode());
        house.owner = secondOwner;

        assertEquals(1, house.allocateSaleListingEpisode());
        assertEquals(1, house.allocateRentListingEpisode());
    }

    @Test
    void episode65535IsReturnedOnceAndTheFollowingAllocationThrows() {
        House house = new House(0);

        for (int expected = 0; expected <= RandomAddressV1.MAX_UNSIGNED_16; expected++) {
            assertEquals(expected, house.allocateSaleListingEpisode());
        }
        assertThrows(IllegalStateException.class, house::allocateSaleListingEpisode);

        for (int expected = 0; expected <= RandomAddressV1.MAX_UNSIGNED_16; expected++) {
            assertEquals(expected, house.allocateRentListingEpisode());
        }
        assertThrows(IllegalStateException.class, house::allocateRentListingEpisode);
    }

    @Test
    void offerRecordRequiresAnExplicitNonNegativeTimeStep() {
        House house = new House(0);

        HouseOfferRecord offer = new HouseOfferRecord(house, 0.0, false, 73);

        assertEquals(73, offer.getInitialListingTime());
        assertThrows(IllegalArgumentException.class,
                () -> new HouseOfferRecord(house, 0.0, false, -1));
    }

    private static final class NoOpOwner implements IHouseOwner {

        @Override
        public void completeHouseSale(HouseOfferRecord saleRecord) { }

        @Override
        public void endOfLettingAgreement(
                House house, PaymentAgreement contract, RngContext context) { }

        @Override
        public void completeHouseLet(
                HouseOfferRecord saleRecord, RentalAgreement rentalAgreement) { }
    }
}
