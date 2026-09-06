package housing;

import utilities.Precision;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.function.IntToDoubleFunction;

/**
 * Diagnostic-only precision fragility observer.
 *
 * <p>Shadow mode never changes model values or control flow. It evaluates the complete fraction-bit
 * grid at explicitly instrumented storage and decision boundaries on the canonical FP64 path. The
 * result is therefore conditional on that path. It is a discovery floor for fragile sites, not a
 * propagated shadow simulation or a numerical lower bound on failure counts in an executing
 * reduced-precision trajectory.</p>
 */
final class PrecisionFragilityProbe {

    static final String PROPERTY = Precision.PROBE_MODE_PROPERTY;
    static final String MAX_EXAMPLES_PROPERTY = "housing.precisionProbeMaxExamples";
    static final String EVENT_FILE = "precision-fragility-events-run%03d.csv";
    static final String EVENT_SUMMARY_FILE = "precision-event-summary-run%03d.csv";
    static final String BRANCH_FILE = "precision-branch-summary-run%03d.csv";

    enum Mode {
        OFF,
        SHADOW,
        STRESS,
        CANDIDATE
    }

    enum ApprovalPurpose {
        BTL_PREVIEW,
        HOME_PREVIEW,
        COMMIT,
        UNSPECIFIED
    }

    enum Operator {
        GREATER_THAN,
        GREATER_OR_EQUAL,
        LESS_THAN,
        LESS_OR_EQUAL;

        boolean test(double left, double right) {
            return switch (this) {
                case GREATER_THAN -> left > right;
                case GREATER_OR_EQUAL -> left >= right;
                case LESS_THAN -> left < right;
                case LESS_OR_EQUAL -> left <= right;
            };
        }

        double signedMargin(double left, double right) {
            return switch (this) {
                case GREATER_THAN, GREATER_OR_EQUAL -> left - right;
                case LESS_THAN, LESS_OR_EQUAL -> right - left;
            };
        }
    }

    enum OperandPolicy {
        /** The operand is a selected stored field and is locally rounded in shadow mode. */
        REDUCED,
        /** Configuration, time, integer-derived, or an FP64 compute-local operand. */
        FP64
    }

    private static final int SCHEMA_VERSION = 1;
    private static final long HASH_SEED = 0x6a09_e667_f3bc_c909L;
    private static final Mode MODE = resolveMode();
    private static final int MAX_EXAMPLES = resolveMaxExamples();
    private static final Map<BranchKey, BranchStats> branchStats = new LinkedHashMap<>();
    private static final Map<EventKey, EventStats> eventOccurrences = new LinkedHashMap<>();

    private static BufferedWriter eventWriter;
    private static Path outputDirectory;
    private static int activeSimulation = -1;
    private static int activeSeed = -1;
    private static int activeTimeStep = -1;
    private static RngOrigin activePhase;
    private static String activeEntityKind = "NONE";
    private static int activeEntityId = -1;
    private static boolean stressStopRequested;
    private static boolean tainted;

    private PrecisionFragilityProbe() {
    }

    static void requireValidConfiguration() {
        if (MODE == Mode.SHADOW && !Precision.isFp64()) {
            throw new IllegalArgumentException(PROPERTY + "=shadow requires "
                    + Precision.MODE_PROPERTY + "=fp64");
        }
        if (MODE == Mode.STRESS && Precision.isFp64()) {
            throw new IllegalArgumentException(PROPERTY + "=stress requires "
                    + Precision.MODE_PROPERTY + "=mantissa");
        }
    }

    static String metadataLine() {
        return "PRECISION_FRAGILITY_METADATA mode=" + modeLabel()
                + " schemaVersion=" + SCHEMA_VERSION
                + " shadowSemantics=local-canonical-path"
                + " qGrid=" + qGridLabel()
                + " maxExamplesPerSiteQ=" + MAX_EXAMPLES;
    }

    static Mode mode() {
        return MODE;
    }

    static boolean isEnabled() {
        return MODE != Mode.OFF;
    }

    static void beginSimulation(Path directory, int simulation, int seed) {
        if (MODE == Mode.OFF) {
            return;
        }
        if (eventWriter != null) {
            throw new IllegalStateException("precision fragility probe is already open");
        }
        outputDirectory = directory;
        activeSimulation = simulation;
        activeSeed = seed;
        activeTimeStep = -1;
        activePhase = null;
        activeEntityKind = "NONE";
        activeEntityId = -1;
        stressStopRequested = false;
        tainted = false;
        branchStats.clear();
        eventOccurrences.clear();

        Path output = directory.resolve(String.format(Locale.ROOT, EVENT_FILE, simulation));
        try {
            eventWriter = Files.newBufferedWriter(
                    output,
                    StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE_NEW,
                    StandardOpenOption.WRITE);
            eventWriter.write("schemaVersion,probeMode,simulation,seed,timeStep,phase,site,"
                    + "invariantId,q,eventKind,context,entityKind,entityId,operator,"
                    + "operandARole,operandARaw,operandAStored,operandAGridSpacing,"
                    + "operandBRole,operandBRaw,operandBStored,operandBGridSpacing,"
                    + "rawSlack,storedSlack,rawOutcome,storedOutcome,errorInUlps,"
                    + "ulpBasis,taint,occurrence");
            eventWriter.newLine();
        } catch (IOException exception) {
            throw new IllegalStateException("Could not create precision fragility output " + output,
                    exception);
        }
    }

    static void beginStep(int timeStep) {
        if (MODE == Mode.OFF) {
            return;
        }
        requireOpen();
        activeTimeStep = timeStep;
    }

    static void beginPhase(RngOrigin phase) {
        if (MODE == Mode.OFF) {
            return;
        }
        requireOpen();
        activePhase = phase;
        activeEntityKind = "NONE";
        activeEntityId = -1;
    }

    static void setHousehold(Household household) {
        if (MODE == Mode.OFF) {
            return;
        }
        activeEntityKind = "HOUSEHOLD";
        activeEntityId = household.id;
    }

    static void setHouse(House house) {
        if (MODE == Mode.OFF) {
            return;
        }
        activeEntityKind = "HOUSE";
        activeEntityId = house.id;
    }

    static void clearEntity() {
        if (MODE == Mode.OFF) {
            return;
        }
        activeEntityKind = "NONE";
        activeEntityId = -1;
    }

    /**
     * Observe a production branch without changing its FP64 outcome.
     *
     * <p>Only operands declared {@link OperandPolicy#REDUCED} are rounded. This deliberately does
     * not propagate shadow state through locals or through earlier branch choices.</p>
     */
    static boolean branch(
            String site,
            String context,
            Operator operator,
            String operandARole,
            double operandA,
            OperandPolicy operandAPolicy,
            String operandBRole,
            double operandB,
            OperandPolicy operandBPolicy) {
        boolean observed = operator.test(operandA, operandB);
        if (MODE == Mode.OFF) {
            return observed;
        }
        requireActiveLocation();

        if (MODE == Mode.SHADOW) {
            int coarsestQ = Precision.SHADOW_FRACTION_BITS[
                    Precision.SHADOW_FRACTION_BITS.length - 1];
            double maxErrorA = operandAPolicy == OperandPolicy.REDUCED
                    ? Precision.gridSpacing(operandA, coarsestQ) / 2.0 : 0.0;
            double maxErrorB = operandBPolicy == OperandPolicy.REDUCED
                    ? Precision.gridSpacing(operandB, coarsestQ) / 2.0 : 0.0;
            if (cannotCrossThreshold(operandA, operandB, maxErrorA, maxErrorB)) {
                updateAllShadowBranches(site, observed);
                return observed;
            }
            for (int q : Precision.SHADOW_FRACTION_BITS) {
                double shadowA = shadow(operandA, operandAPolicy, q);
                double shadowB = shadow(operandB, operandBPolicy, q);
                boolean shadowOutcome = operator.test(shadowA, shadowB);
                updateBranch(site, q, observed, shadowOutcome);
                if (observed != shadowOutcome) {
                    writeEvent(
                            site,
                            "",
                            q,
                            "BRANCH_FLIP",
                            context,
                            operator,
                            operandARole,
                            operandA,
                            shadowA,
                            operandAPolicy == OperandPolicy.REDUCED
                                    ? Precision.gridSpacing(operandA, q) : Double.NaN,
                            operandBRole,
                            operandB,
                            shadowB,
                            operandBPolicy == OperandPolicy.REDUCED
                                    ? Precision.gridSpacing(operandB, q) : Double.NaN,
                            operator.signedMargin(operandA, operandB),
                            operator.signedMargin(shadowA, shadowB),
                            observed,
                            shadowOutcome);
                }
            }
        } else {
            updateBranch(site, Precision.fractionBits(), observed, observed);
        }
        return observed;
    }

    /**
     * Observe a branch whose q-specific operand must be recomputed from selected stored inputs.
     * The supplied functions are evaluated only in shadow mode; executing modes merely count the
     * branch that actually ran. Grid spacing is intentionally blank because a derived operand need
     * not lie on one binary lattice.
     */
    static boolean branchDerived(
            String site,
            String context,
            Operator operator,
            String operandARole,
            double operandA,
            IntToDoubleFunction shadowOperandA,
            String operandBRole,
            double operandB,
            IntToDoubleFunction shadowOperandB) {
        return branchDerivedBounded(
                site,
                context,
                operator,
                operandARole,
                operandA,
                shadowOperandA,
                Double.NaN,
                operandBRole,
                operandB,
                shadowOperandB,
                Double.NaN);
    }

    /** Same as {@link #branchDerived}, with conservative coarsest-q error bounds for fast paths. */
    static boolean branchDerivedBounded(
            String site,
            String context,
            Operator operator,
            String operandARole,
            double operandA,
            IntToDoubleFunction shadowOperandA,
            double maxAbsErrorA,
            String operandBRole,
            double operandB,
            IntToDoubleFunction shadowOperandB,
            double maxAbsErrorB) {
        boolean observed = operator.test(operandA, operandB);
        if (MODE == Mode.OFF) {
            return observed;
        }
        requireActiveLocation();

        if (MODE == Mode.SHADOW) {
            if (cannotCrossThreshold(operandA, operandB, maxAbsErrorA, maxAbsErrorB)) {
                updateAllShadowBranches(site, observed);
                return observed;
            }
            for (int q : Precision.SHADOW_FRACTION_BITS) {
                double shadowA = shadowOperandA.applyAsDouble(q);
                double shadowB = shadowOperandB.applyAsDouble(q);
                boolean shadowOutcome = operator.test(shadowA, shadowB);
                updateBranch(site, q, observed, shadowOutcome);
                if (observed != shadowOutcome) {
                    writeEvent(
                            site,
                            "",
                            q,
                            "BRANCH_FLIP",
                            context,
                            operator,
                            operandARole,
                            operandA,
                            shadowA,
                            Double.NaN,
                            operandBRole,
                            operandB,
                            shadowB,
                            Double.NaN,
                            operator.signedMargin(operandA, operandB),
                            operator.signedMargin(shadowA, shadowB),
                            observed,
                            shadowOutcome);
                }
            }
        } else {
            updateBranch(site, Precision.fractionBits(), observed, observed);
        }
        return observed;
    }

    /** Records the one currently enforced numeric invariant in an executing arm. */
    static boolean mortgageApprovalInvariant(
            Household household,
            ApprovalPurpose purpose,
            double rawDownPayment,
            double storedDownPayment,
            double liquidWealth,
            double sourceGridSpacing,
            String sourceRole) {
        boolean observedValid = storedDownPayment <= liquidWealth;
        if (MODE == Mode.OFF) {
            return observedValid;
        }
        requireActiveLocation();
        if (MODE == Mode.SHADOW) {
            throw new IllegalStateException(
                    "shadow approval checks must use shadowMortgageApprovalInvariant");
        }
        String previousKind = activeEntityKind;
        int previousId = activeEntityId;
        activeEntityKind = "HOUSEHOLD";
        activeEntityId = household.id;
        try {
            int q = Precision.fractionBits();
            updateBranch("bank.approval.downpayment-within-wealth", q,
                    observedValid, observedValid);
            if (!observedValid) {
                writeEvent(
                        "bank.approval.downpayment-within-wealth",
                        "MORTGAGE_DOWNPAYMENT_LE_LIQUID_WEALTH",
                        q,
                        "INVARIANT_FAILURE",
                        purpose.name(),
                        Operator.LESS_OR_EQUAL,
                        sourceRole,
                        rawDownPayment,
                        storedDownPayment,
                        sourceGridSpacing,
                        "liquidWealth",
                        liquidWealth,
                        liquidWealth,
                        Precision.gridSpacing(liquidWealth, q),
                        liquidWealth - rawDownPayment,
                        liquidWealth - storedDownPayment,
                        rawDownPayment <= liquidWealth,
                        false);
                if (MODE == Mode.STRESS && purpose == ApprovalPurpose.BTL_PREVIEW) {
                    stressStopRequested = true;
                }
            }
        } finally {
            activeEntityKind = previousKind;
            activeEntityId = previousId;
        }
        return observedValid;
    }

    /**
     * More faithful shadow check for a derived down-payment: q is applied to the final principal
     * storage candidate, then down-payment is re-derived from the unchanged FP64 house price.
     */
    static void shadowMortgageApprovalInvariant(
            Household household,
            ApprovalPurpose purpose,
            double housePrice,
            double rawPrincipal,
            double rawDownPayment,
            double liquidWealth,
            boolean downPaymentWasStored) {
        if (MODE != Mode.SHADOW) {
            return;
        }
        requireActiveLocation();
        String previousKind = activeEntityKind;
        int previousId = activeEntityId;
        activeEntityKind = "HOUSEHOLD";
        activeEntityId = household.id;
        try {
            boolean rawValid = rawDownPayment <= liquidWealth;
            for (int q : Precision.SHADOW_FRACTION_BITS) {
                double shadowDownPayment;
                double sourceGridSpacing;
                String sourceRole;
                if (downPaymentWasStored) {
                    shadowDownPayment = Precision.quantiseForDiagnostics(rawDownPayment, q);
                    sourceGridSpacing = Precision.gridSpacing(rawDownPayment, q);
                    sourceRole = "downPayment[stored]";
                } else {
                    double shadowPrincipal = Precision.quantiseForDiagnostics(rawPrincipal, q);
                    shadowDownPayment = housePrice - shadowPrincipal;
                    sourceGridSpacing = Precision.gridSpacing(rawPrincipal, q);
                    sourceRole = "downPayment[derived-from-principal]";
                }
                double shadowWealth = Precision.quantiseForDiagnostics(liquidWealth, q);
                boolean shadowValid = shadowDownPayment <= shadowWealth;
                updateBranch("bank.approval.downpayment-within-wealth", q,
                        rawValid, shadowValid);
                if (!shadowValid || rawValid != shadowValid) {
                    writeEvent(
                            "bank.approval.downpayment-within-wealth",
                            "MORTGAGE_DOWNPAYMENT_LE_LIQUID_WEALTH",
                            q,
                            "INVARIANT_FAILURE",
                            purpose.name(),
                            Operator.LESS_OR_EQUAL,
                            sourceRole,
                            rawDownPayment,
                            shadowDownPayment,
                            sourceGridSpacing,
                            "liquidWealth",
                            liquidWealth,
                            shadowWealth,
                            Precision.gridSpacing(liquidWealth, q),
                            liquidWealth - rawDownPayment,
                            shadowWealth - shadowDownPayment,
                            rawValid,
                            shadowValid);
                }
            }
        } finally {
            activeEntityKind = previousKind;
            activeEntityId = previousId;
        }
    }

    static boolean mayContinueMortgageViolation(ApprovalPurpose purpose) {
        return isSafeStressContinuation(MODE, purpose);
    }

    static boolean isSafeStressContinuation(Mode mode, ApprovalPurpose purpose) {
        return mode == Mode.STRESS && purpose == ApprovalPurpose.BTL_PREVIEW;
    }

    static void stopAfterHouseholdPhaseIfRequested() {
        if (MODE == Mode.STRESS && stressStopRequested) {
            throw new StressStopException(
                    "precision stress probe collected safe BTL-preview violations; "
                            + "stopping before market clearing");
        }
    }

    static void markTainted() {
        if (MODE != Mode.OFF) {
            tainted = true;
        }
    }

    static void finishSimulation(String status) {
        if (MODE == Mode.OFF) {
            return;
        }
        if (eventWriter == null) {
            return;
        }
        RuntimeException pending = null;
        try {
            eventWriter.flush();
            writeBranchSummary(status);
            writeEventSummary(status);
        } catch (IOException exception) {
            pending = new IllegalStateException("Could not finish precision fragility diagnostics",
                    exception);
        } finally {
            try {
                eventWriter.close();
            } catch (IOException exception) {
                if (pending == null) {
                    pending = new IllegalStateException(
                            "Could not close precision fragility diagnostics", exception);
                }
            }
            eventWriter = null;
            outputDirectory = null;
            activeSimulation = -1;
            activeSeed = -1;
            activeTimeStep = -1;
            activePhase = null;
        }
        if (pending != null) {
            throw pending;
        }
    }

    private static void writeBranchSummary(String status) throws IOException {
        Path output = outputDirectory.resolve(
                String.format(Locale.ROOT, BRANCH_FILE, activeSimulation));
        try (BufferedWriter writer = Files.newBufferedWriter(
                output,
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE_NEW,
                StandardOpenOption.WRITE)) {
            writer.write("schemaVersion,probeMode,status,simulation,seed,site,q,evaluations,"
                    + "observedTrue,shadowTrue,flips,observedHash,shadowHash,eventOccurrences,"
                    + "suppressedExamples");
            writer.newLine();
            for (Map.Entry<BranchKey, BranchStats> entry : branchStats.entrySet()) {
                BranchKey key = entry.getKey();
                BranchStats stats = entry.getValue();
                long occurrences = eventCount(key.site, key.q);
                long suppressedExamples = suppressedEventCount(key.site, key.q);
                writer.write(Integer.toString(SCHEMA_VERSION));
                writer.write(',');
                writer.write(modeLabel());
                writer.write(',');
                writer.write(status);
                writer.write(',');
                writer.write(Integer.toString(activeSimulation));
                writer.write(',');
                writer.write(Integer.toString(activeSeed));
                writer.write(',');
                writer.write(key.site);
                writer.write(',');
                writer.write(Integer.toString(key.q));
                writer.write(',');
                writer.write(Long.toString(stats.evaluations));
                writer.write(',');
                writer.write(Long.toString(stats.observedTrue));
                writer.write(',');
                writer.write(Long.toString(stats.shadowTrue));
                writer.write(',');
                writer.write(Long.toString(stats.flips));
                writer.write(',');
                writer.write(String.format(Locale.ROOT, "%016x", stats.observedHash));
                writer.write(',');
                writer.write(String.format(Locale.ROOT, "%016x", stats.shadowHash));
                writer.write(',');
                writer.write(Long.toString(occurrences));
                writer.write(',');
                writer.write(Long.toString(suppressedExamples));
                writer.newLine();
            }
        }
    }

    private static void writeEventSummary(String status) throws IOException {
        Path output = outputDirectory.resolve(
                String.format(Locale.ROOT, EVENT_SUMMARY_FILE, activeSimulation));
        try (BufferedWriter writer = Files.newBufferedWriter(
                output,
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE_NEW,
                StandardOpenOption.WRITE)) {
            writer.write("schemaVersion,probeMode,status,simulation,seed,site,q,eventKind,context,"
                    + "occurrences,writtenExamples,suppressedExamples,firstTimeStep,firstPhase,"
                    + "firstEntityKind,firstEntityId,firstTaint");
            writer.newLine();
            for (Map.Entry<EventKey, EventStats> entry : eventOccurrences.entrySet()) {
                EventKey key = entry.getKey();
                EventStats stats = entry.getValue();
                writer.write(Integer.toString(SCHEMA_VERSION));
                writer.write(',');
                writer.write(modeLabel());
                writer.write(',');
                writer.write(status);
                writer.write(',');
                writer.write(Integer.toString(activeSimulation));
                writer.write(',');
                writer.write(Integer.toString(activeSeed));
                writer.write(',');
                writer.write(key.site);
                writer.write(',');
                writer.write(Integer.toString(key.q));
                writer.write(',');
                writer.write(key.eventKind);
                writer.write(',');
                writer.write(key.context);
                writer.write(',');
                writer.write(Long.toString(stats.occurrences));
                writer.write(',');
                writer.write(Long.toString(stats.writtenExamples));
                writer.write(',');
                writer.write(Long.toString(stats.occurrences - stats.writtenExamples));
                writer.write(',');
                writer.write(Integer.toString(stats.firstTimeStep));
                writer.write(',');
                writer.write(stats.firstPhase);
                writer.write(',');
                writer.write(stats.firstEntityKind);
                writer.write(',');
                writer.write(Integer.toString(stats.firstEntityId));
                writer.write(',');
                writer.write(Boolean.toString(stats.firstTaint));
                writer.newLine();
            }
        }
    }

    private static void updateBranch(String site, int q, boolean observed, boolean shadowOutcome) {
        BranchKey key = new BranchKey(site, q);
        BranchStats stats = branchStats.computeIfAbsent(key, ignored -> new BranchStats());
        stats.evaluations += 1;
        if (observed) {
            stats.observedTrue += 1;
        }
        if (shadowOutcome) {
            stats.shadowTrue += 1;
        }
        if (observed != shadowOutcome) {
            stats.flips += 1;
        }
        stats.observedHash = mix(stats.observedHash, activeTimeStep, activeEntityId, observed);
        stats.shadowHash = mix(stats.shadowHash, activeTimeStep, activeEntityId, shadowOutcome);
    }

    private static void updateAllShadowBranches(String site, boolean observed) {
        for (int q : Precision.SHADOW_FRACTION_BITS) {
            updateBranch(site, q, observed, observed);
        }
    }

    private static boolean cannotCrossThreshold(
            double operandA,
            double operandB,
            double maxAbsErrorA,
            double maxAbsErrorB) {
        return Double.isFinite(operandA)
                && Double.isFinite(operandB)
                && Double.isFinite(maxAbsErrorA)
                && Double.isFinite(maxAbsErrorB)
                && maxAbsErrorA >= 0.0
                && maxAbsErrorB >= 0.0
                && Math.abs(operandA - operandB) > maxAbsErrorA + maxAbsErrorB;
    }

    private static void writeEvent(
            String site,
            String invariantId,
            int q,
            String eventKind,
            String context,
            Operator operator,
            String operandARole,
            double operandARaw,
            double operandAStored,
            double operandAGrid,
            String operandBRole,
            double operandBRaw,
            double operandBStored,
            double operandBGrid,
            double rawSlack,
            double storedSlack,
            boolean rawOutcome,
            boolean storedOutcome) {
        EventKey key = new EventKey(site, q, eventKind, context);
        EventStats stats = eventOccurrences.computeIfAbsent(key, ignored -> new EventStats());
        stats.occurrences += 1;
        if (stats.occurrences == 1) {
            stats.firstTimeStep = activeTimeStep;
            stats.firstPhase = activePhase == null ? "NONE" : activePhase.name();
            stats.firstEntityKind = activeEntityKind;
            stats.firstEntityId = activeEntityId;
            stats.firstTaint = tainted;
        }
        long occurrence = stats.occurrences;
        if (occurrence > MAX_EXAMPLES) {
            return;
        }
        stats.writtenExamples += 1;
        double ulpBasis = maxFinite(operandAGrid, operandBGrid);
        double errorInUlps = Double.isFinite(ulpBasis) && ulpBasis > 0.0
                ? Math.abs(storedSlack - rawSlack) / ulpBasis
                : Double.NaN;
        try {
            eventWriter.write(Integer.toString(SCHEMA_VERSION));
            eventWriter.write(',');
            eventWriter.write(modeLabel());
            eventWriter.write(',');
            eventWriter.write(Integer.toString(activeSimulation));
            eventWriter.write(',');
            eventWriter.write(Integer.toString(activeSeed));
            eventWriter.write(',');
            eventWriter.write(Integer.toString(activeTimeStep));
            eventWriter.write(',');
            eventWriter.write(activePhase == null ? "NONE" : activePhase.name());
            eventWriter.write(',');
            eventWriter.write(site);
            eventWriter.write(',');
            eventWriter.write(invariantId);
            eventWriter.write(',');
            eventWriter.write(Integer.toString(q));
            eventWriter.write(',');
            eventWriter.write(eventKind);
            eventWriter.write(',');
            eventWriter.write(context);
            eventWriter.write(',');
            eventWriter.write(activeEntityKind);
            eventWriter.write(',');
            eventWriter.write(Integer.toString(activeEntityId));
            eventWriter.write(',');
            eventWriter.write(operator.name());
            eventWriter.write(',');
            eventWriter.write(operandARole);
            eventWriter.write(',');
            eventWriter.write(Double.toHexString(operandARaw));
            eventWriter.write(',');
            eventWriter.write(Double.toHexString(operandAStored));
            eventWriter.write(',');
            eventWriter.write(hexOrBlank(operandAGrid));
            eventWriter.write(',');
            eventWriter.write(operandBRole);
            eventWriter.write(',');
            eventWriter.write(Double.toHexString(operandBRaw));
            eventWriter.write(',');
            eventWriter.write(Double.toHexString(operandBStored));
            eventWriter.write(',');
            eventWriter.write(hexOrBlank(operandBGrid));
            eventWriter.write(',');
            eventWriter.write(Double.toHexString(rawSlack));
            eventWriter.write(',');
            eventWriter.write(Double.toHexString(storedSlack));
            eventWriter.write(',');
            eventWriter.write(Boolean.toString(rawOutcome));
            eventWriter.write(',');
            eventWriter.write(Boolean.toString(storedOutcome));
            eventWriter.write(',');
            eventWriter.write(hexOrBlank(errorInUlps));
            eventWriter.write(',');
            eventWriter.write(hexOrBlank(ulpBasis));
            eventWriter.write(',');
            eventWriter.write(Boolean.toString(tainted));
            eventWriter.write(',');
            eventWriter.write(Long.toString(occurrence));
            eventWriter.newLine();
            eventWriter.flush();
        } catch (IOException exception) {
            throw new IllegalStateException("Could not append precision fragility event", exception);
        }
    }

    private static double shadow(double value, OperandPolicy policy, int q) {
        return policy == OperandPolicy.REDUCED
                ? Precision.quantiseForDiagnostics(value, q)
                : value;
    }

    private static long eventCount(String site, int q) {
        long total = 0L;
        for (Map.Entry<EventKey, EventStats> entry : eventOccurrences.entrySet()) {
            EventKey key = entry.getKey();
            if (key.site.equals(site) && key.q == q) {
                total += entry.getValue().occurrences;
            }
        }
        return total;
    }

    private static long suppressedEventCount(String site, int q) {
        long total = 0L;
        for (Map.Entry<EventKey, EventStats> entry : eventOccurrences.entrySet()) {
            EventKey key = entry.getKey();
            if (key.site.equals(site) && key.q == q) {
                EventStats stats = entry.getValue();
                total += stats.occurrences - stats.writtenExamples;
            }
        }
        return total;
    }

    private static double maxFinite(double left, double right) {
        if (!Double.isFinite(left)) {
            return right;
        }
        if (!Double.isFinite(right)) {
            return left;
        }
        return Math.max(left, right);
    }

    private static String hexOrBlank(double value) {
        return Double.isFinite(value) ? Double.toHexString(value) : "";
    }

    private static long mix(long hash, int timeStep, int entityId, boolean outcome) {
        long value = (((long) timeStep) << 32) ^ Integer.toUnsignedLong(entityId);
        value ^= outcome ? 0x9e37_79b9_7f4a_7c15L : 0x3c6e_f372_fe94_f82aL;
        value ^= value >>> 30;
        value *= 0xbf58_476d_1ce4_e5b9L;
        value ^= value >>> 27;
        value *= 0x94d0_49bb_1331_11ebL;
        value ^= value >>> 31;
        return Long.rotateLeft(hash ^ value, 29) * 0x9e37_79b1_85eb_ca87L;
    }

    private static void requireOpen() {
        if (eventWriter == null) {
            throw new IllegalStateException("precision fragility probe is not open");
        }
    }

    private static void requireActiveLocation() {
        requireOpen();
        if (activeTimeStep < 0 || activePhase == null) {
            throw new IllegalStateException(
                    "precision observation occurred outside an active model phase");
        }
    }

    private static Mode resolveMode() {
        String configured = System.getProperty(PROPERTY, "off").trim().toLowerCase(Locale.ROOT);
        return switch (configured) {
            case "off" -> Mode.OFF;
            case "shadow" -> Mode.SHADOW;
            case "stress" -> Mode.STRESS;
            case "candidate" -> Mode.CANDIDATE;
            default -> throw new IllegalArgumentException(PROPERTY
                    + " must be off, shadow, stress, or candidate; got '" + configured + "'");
        };
    }

    private static int resolveMaxExamples() {
        String configured = System.getProperty(MAX_EXAMPLES_PROPERTY, "25").trim();
        try {
            int parsed = Integer.parseInt(configured);
            if (parsed < 1) {
                throw new IllegalArgumentException(MAX_EXAMPLES_PROPERTY
                        + " must be positive: " + configured);
            }
            return parsed;
        } catch (NumberFormatException exception) {
            throw new IllegalArgumentException(MAX_EXAMPLES_PROPERTY
                    + " must be a positive integer: " + configured, exception);
        }
    }

    private static String modeLabel() {
        return MODE.name().toLowerCase(Locale.ROOT);
    }

    private static String qGridLabel() {
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < Precision.SHADOW_FRACTION_BITS.length; i++) {
            if (i > 0) {
                result.append(':');
            }
            result.append(Precision.SHADOW_FRACTION_BITS[i]);
        }
        return result.toString();
    }

    private record BranchKey(String site, int q) {
    }

    private record EventKey(String site, int q, String eventKind, String context) {
    }

    private static final class BranchStats {
        private long evaluations;
        private long observedTrue;
        private long shadowTrue;
        private long flips;
        private long observedHash = HASH_SEED;
        private long shadowHash = HASH_SEED;
    }

    private static final class EventStats {
        private long occurrences;
        private long writtenExamples;
        private int firstTimeStep;
        private String firstPhase;
        private String firstEntityKind;
        private int firstEntityId;
        private boolean firstTaint;
    }

    static final class StressStopException extends RuntimeException {
        private StressStopException(String message) {
            super(message);
        }
    }
}
