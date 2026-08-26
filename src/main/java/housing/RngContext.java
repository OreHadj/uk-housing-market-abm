package housing;

import utilities.Pdf;

/** Immutable phase-scoped access to semantic model randomness. */
sealed interface RngContext permits RandomService.ServiceRngContext {

    RngOrigin origin();

    int simulation();

    int timeStep();

    double uniform(Household.IdReservation entity, RandomEvent event);

    double uniform(Household entity, RandomEvent event);

    double uniform(Household entity, RandomEvent event, int subcounter);

    double uniform(House entity, RandomEvent event);

    double uniform(House entity, RandomEvent event, int subcounter);

    double normal(Household entity, RandomEvent event);

    double normal(Household entity, RandomEvent event, int subcounter);

    double normal(House entity, RandomEvent event);

    double normal(House entity, RandomEvent event, int subcounter);

    int boundedInt(Household entity, RandomEvent event, int bound);

    int boundedInt(House entity, RandomEvent event, int bound);

    int boundedInt(House.IdReservation entity, RandomEvent event, int bound);

    double empiricalPdf(House entity, RandomEvent event, int subcounter, Pdf pdf);

    int geometric(House entity, RandomEvent event, double probabilityOfSuccess);
}
