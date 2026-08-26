package housing;

/** Stable, deterministic metadata for one configured model run. */
record RngMetadata(
        String rngAlgorithm,
        String rngAddressVersion,
        long masterSeed,
        String rngMode) {

    String formatLine() {
        return "RNG_METADATA rngAlgorithm=" + rngAlgorithm
                + " rngAddressVersion=" + rngAddressVersion
                + " masterSeed=" + Long.toUnsignedString(masterSeed)
                + " rngMode=" + rngMode;
    }
}
