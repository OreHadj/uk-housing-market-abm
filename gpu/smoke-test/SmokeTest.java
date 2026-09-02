// Step 2 of the ccgpu4 GPU smoke test, Java side: call a CUDA kernel from the JVM
// through the Foreign Function & Memory API (final since Java 22; ccgpu4 has
// Temurin 25.0.3). No JNI, no C glue - just dlopen + a downcall handle.
//
// Run (single-file source launch, no javac needed):
//   CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=<free gpu> \
//     java --enable-native-access=ALL-UNNAMED \
//        -XX:ActiveProcessorCount=4 SmokeTest.java
//
// The one design constraint this demonstrates: native code cannot see a Java
// double[] on the heap. Data must live in off-heap memory (an Arena). For the
// real port that is good news - household state stays resident off-heap/on-device
// instead of being copied out of the JVM heap every step.

import java.lang.foreign.Arena;
import java.lang.foreign.FunctionDescriptor;
import java.lang.foreign.Linker;
import java.lang.foreign.MemorySegment;
import java.lang.foreign.SymbolLookup;
import java.lang.foreign.ValueLayout;
import java.lang.invoke.MethodHandle;
import java.nio.file.Path;

public class SmokeTest {

    private static final ValueLayout.OfDouble D = ValueLayout.JAVA_DOUBLE;
    private static final int EXPECTED_JDK_FEATURE = 25;
    private static final int EXPECTED_ACTIVE_PROCESSORS = 4;
    private static final int DEFAULT_ELEMENTS = 1 << 22;
    private static final int MAX_ELEMENTS = 1 << 25;

    public static void main(String[] args) throws Throwable {
        int exitCode = run(args);
        if (exitCode != 0) System.exit(exitCode);
    }

    private static int run(String[] args) throws Throwable {
        if (args.length > 2) {
            System.err.println("Usage: SmokeTest.java [libsmoke.so] [element-count]");
            return 2;
        }

        Path lib = Path.of(args.length > 0 ? args[0] : "libsmoke.so").toAbsolutePath();
        int n = DEFAULT_ELEMENTS;
        if (args.length > 1) {
            try {
                n = Integer.parseInt(args[1]);
            } catch (NumberFormatException error) {
                System.err.println("FAIL: element-count must be an integer; got '" + args[1] + "'.");
                return 2;
            }
        }
        if (n <= 0 || n > MAX_ELEMENTS) {
            System.err.printf("FAIL: element-count must be in [1, %d]; got %d.%n", MAX_ELEMENTS, n);
            return 2;
        }

        String pin = System.getenv("CUDA_VISIBLE_DEVICES");
        String deviceOrder = System.getenv("CUDA_DEVICE_ORDER");
        System.out.println("JVM      : " + Runtime.version());
        System.out.println("JVM CPUs : " + Runtime.getRuntime().availableProcessors());
        System.out.println("library  : " + lib);
        System.out.println("pinned to: CUDA_VISIBLE_DEVICES="
                + (pin == null ? "<unset - NOT PINNED>" : pin));
        System.out.println("order    : CUDA_DEVICE_ORDER="
                + (deviceOrder == null ? "<unset>" : deviceOrder));
        if (Runtime.version().feature() != EXPECTED_JDK_FEATURE) {
            System.err.printf("FAIL: expected JDK feature release %d; found %d.%n",
                    EXPECTED_JDK_FEATURE, Runtime.version().feature());
            return 2;
        }
        if (Runtime.getRuntime().availableProcessors() != EXPECTED_ACTIVE_PROCESSORS) {
            System.err.printf("FAIL: expected %d active JVM processors; found %d.%n",
                    EXPECTED_ACTIVE_PROCESSORS, Runtime.getRuntime().availableProcessors());
            return 2;
        }
        if (!isSingleGpuIndex(pin)) {
            System.err.println(
                    "FAIL: CUDA_VISIBLE_DEVICES must contain exactly one ccgpu4 index (0-3).");
            return 2;
        }
        if (!"PCI_BUS_ID".equals(deviceOrder)) {
            System.err.println(
                    "FAIL: CUDA_DEVICE_ORDER must be PCI_BUS_ID so nvidia-smi and CUDA indices match.");
            return 2;
        }

        try (Arena arena = Arena.ofConfined()) {
            SymbolLookup smoke = SymbolLookup.libraryLookup(lib, arena);
            Linker linker = Linker.nativeLinker();

            MethodHandle deviceInfo = linker.downcallHandle(
                    smoke.find("cuda_device_info").orElseThrow(
                            () -> new IllegalStateException("symbol cuda_device_info not found")),
                    FunctionDescriptor.of(ValueLayout.JAVA_INT));

            MethodHandle vectorAdd = linker.downcallHandle(
                    smoke.find("cuda_vector_add").orElseThrow(
                            () -> new IllegalStateException("symbol cuda_vector_add not found")),
                    FunctionDescriptor.of(ValueLayout.JAVA_INT,
                            ValueLayout.ADDRESS,   // const double* a
                            ValueLayout.ADDRESS,   // const double* b
                            ValueLayout.ADDRESS,   // double* out
                            ValueLayout.JAVA_INT));// int n

            int rc = (int) deviceInfo.invokeExact();
            if (rc != 0) {
                System.err.println("FAIL: cuda_device_info returned status " + rc);
                return 1;
            }

            MemorySegment a = arena.allocate(D, n);
            MemorySegment b = arena.allocate(D, n);
            MemorySegment out = arena.allocate(D, n);
            for (int i = 0; i < n; i++) {
                a.setAtIndex(D, i, i * 0.5);   // exactly representable in binary64,
                b.setAtIndex(D, i, i * 0.25);  // so the check below demands equality
            }

            long t0 = System.nanoTime();
            rc = (int) vectorAdd.invokeExact(a, b, out, n);
            long elapsedMs = (System.nanoTime() - t0) / 1_000_000;

            if (rc != 0) {
                System.err.println("FAIL: cuda_vector_add returned status " + rc);
                return 1;
            }

            int bad = 0;
            for (int i = 0; i < n; i++) {
                if (out.getAtIndex(D, i) != i * 0.75) bad++;
            }

            System.out.printf(
                    "round trip: %d doubles in %d ms (device alloc + H2D + kernel + D2H + free)%n",
                    n, elapsedMs);
            System.out.printf("%s: %d / %d elements exact%n", bad == 0 ? "PASS" : "FAIL", n - bad, n);
            return bad == 0 ? 0 : 1;
        }
    }

    private static boolean isSingleGpuIndex(String value) {
        return value != null && value.length() == 1
                && value.charAt(0) >= '0' && value.charAt(0) <= '3';
    }
}
