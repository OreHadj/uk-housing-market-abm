package utilities;

import org.apache.commons.math3.random.MersenneTwister;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PdfTest {

    @Test
    void constructorTrimsLeadingAndTrailingZeroBins() {
        BinnedDataDouble data = binnedData(0.0, 1.0, 0.0, 0.0, 0.2, 0.3, 0.5, 0.0, 0.0);

        Pdf pdf = new Pdf(data);

        assertAll(
                () -> assertEquals(Pdf.DEFAULT_CDF_SAMPLES, pdf.nSamples),
                () -> assertEquals(2.0, pdf.getSupportLowerBound(), 1.0e-12),
                () -> assertEquals(5.0, pdf.getSupportUpperBound(), 1.0e-12),
                () -> assertEquals(0.2, pdf.density(2.5), 1.0e-12),
                () -> assertEquals(0.5, pdf.density(4.5), 1.0e-12)
        );
    }

    @Test
    void explicitSetPdfOverloadKeepsZeroDensityOutsideTrimmedSupport() {
        BinnedDataDouble data = binnedData(10.0, 0.5, 0.0, 0.1, 0.4, 0.5, 0.0);
        Pdf pdf = new Pdf(0.0, 1.0, x -> 1.0, 17);

        pdf.setPdf(data, 257);

        assertAll(
                () -> assertEquals(257, pdf.nSamples),
                () -> assertEquals(10.5, pdf.getSupportLowerBound(), 1.0e-12),
                () -> assertEquals(12.0, pdf.getSupportUpperBound(), 1.0e-12),
                () -> assertEquals(0.0, pdf.density(10.49), 1.0e-12),
                () -> assertEquals(0.0, pdf.density(12.0), 1.0e-12),
                () -> assertEquals(0.0, pdf.density(50.0), 1.0e-12),
                () -> assertEquals(0.2, pdf.density(10.75), 1.0e-12),
                () -> assertEquals(1.0, pdf.density(11.75), 1.0e-12)
        );
    }

    @Test
    void allZeroBinnedDataThrowsIllegalStateException() {
        BinnedDataDouble data = binnedData(-1.0, 0.25, 0.0, 0.0, 0.0, 0.0);

        assertThrows(IllegalStateException.class, () -> new Pdf(data));
    }

    @Test
    void inverseCumulativeProbabilityMatchesAnalyticDistribution() {
        Pdf pdf = new Pdf(0.0, 1.0, x -> 2.0*x, 20001);

        assertAll(
                () -> assertEquals(0.2, pdf.inverseCumulativeProbability(0.04), 5.0e-4),
                () -> assertEquals(0.5, pdf.inverseCumulativeProbability(0.25), 5.0e-4),
                () -> assertEquals(0.9, pdf.inverseCumulativeProbability(0.81), 5.0e-4)
        );
    }

    @Test
    void pureSampleMatchesInverseCdfByRawBitsAndIsIdempotent() {
        Pdf pdf = new Pdf(-2.0, 3.0, x -> 0.2, 257);
        double[] uniforms = {
                0.0, -0.0, 0x1.0p-53, 0.125, 0.5, 0.875, Math.nextDown(1.0)
        };

        for(double uniform : uniforms) {
            long expected = Double.doubleToRawLongBits(pdf.inverseCumulativeProbability(uniform));

            assertEquals(expected, Double.doubleToRawLongBits(pdf.sample(uniform)),
                    "uniform " + uniform);
            assertEquals(expected, Double.doubleToRawLongBits(pdf.sample(uniform)),
                    "repeated uniform " + uniform);
        }
    }

    @Test
    void pureSampleRetainsInverseCdfDomainSemantics() {
        Pdf pdf = new Pdf(0.0, 1.0, x -> 1.0, 64);

        assertAll(
                () -> assertEquals(
                        Double.doubleToRawLongBits(pdf.inverseCumulativeProbability(0.0)),
                        Double.doubleToRawLongBits(pdf.sample(0.0))),
                () -> assertEquals(
                        Double.doubleToRawLongBits(pdf.inverseCumulativeProbability(Math.nextDown(1.0))),
                        Double.doubleToRawLongBits(pdf.sample(Math.nextDown(1.0)))),
                () -> assertThrows(IllegalArgumentException.class,
                        () -> pdf.sample(-Double.MIN_VALUE)),
                () -> assertThrows(IllegalArgumentException.class, () -> pdf.sample(1.0)),
                () -> assertThrows(IllegalArgumentException.class,
                        () -> pdf.sample(Math.nextUp(1.0))),
                () -> assertThrows(IllegalArgumentException.class,
                        () -> pdf.sample(Double.NEGATIVE_INFINITY)),
                () -> assertThrows(IllegalArgumentException.class,
                        () -> pdf.sample(Double.POSITIVE_INFINITY)),
                () -> assertTrue(Double.isNaN(pdf.sample(Double.NaN))));
    }

    @Test
    void pureSampleConsumesNoRngAndLegacyHelperConsumesExactlyOneUniform() {
        Pdf pdf = new Pdf(0.0, 1.0, x -> 1.0, 64);
        MersenneTwister untouchedExpected = new MersenneTwister(9087);
        MersenneTwister untouchedActual = new MersenneTwister(9087);

        pdf.sample(0.37);

        assertEquals(untouchedExpected.nextInt(), untouchedActual.nextInt(),
                "pure sampling must not advance an RNG");

        MersenneTwister manual = new MersenneTwister(112358);
        MersenneTwister legacy = new MersenneTwister(112358);
        double uniform = manual.nextDouble();
        double expectedSample = pdf.inverseCumulativeProbability(uniform);
        double actualSample = pdf.nextDouble(legacy);

        assertAll(
                () -> assertEquals(Double.doubleToRawLongBits(expectedSample),
                        Double.doubleToRawLongBits(actualSample)),
                () -> assertEquals(manual.nextInt(), legacy.nextInt(),
                        "legacy helper must consume exactly one nextDouble"));
    }

    private static BinnedDataDouble binnedData(double firstBinMin, double binWidth, double... bins) {
        BinnedDataDouble data = new BinnedDataDouble(firstBinMin, binWidth);

        for(double bin : bins) {
            data.add(bin);
        }

        return(data);
    }
}
