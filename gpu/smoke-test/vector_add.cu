// Step 1 of the ccgpu4 GPU smoke test: standalone CUDA.
//
// Proves: nvcc works, sm_86 codegen runs on the RTX 3090, the driver/runtime pair
// is healthy, CUDA_VISIBLE_DEVICES pinning took effect, and doubles come back exact.
// Also reports host<->device bandwidth, which is the main risk flagged in
// GPU_FEASIBILITY_ANALYSIS.md (per-step transfer overhead).
//
// Build: nvcc -O2 -arch=sm_86 -o vector_add vector_add.cu
// Run:   CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=<free gpu> ./vector_add

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cuda_runtime.h>

namespace {

constexpr char kExpectedDevice[] = "NVIDIA GeForce RTX 3090";
constexpr int kExpectedCudaRuntime = 13030;  // CUDA 13.3
constexpr int kMinimumCudaDriverApi = 13000;  // CUDA 13.x minor compatibility is valid.

bool isSingleGpuIndex(const char* value) {
    return value != nullptr && value[0] >= '0' && value[0] <= '3' && value[1] == '\0';
}

}  // namespace

#define CHECK(call)                                                              \
    do {                                                                         \
        cudaError_t err_ = (call);                                               \
        if (err_ != cudaSuccess) {                                               \
            std::fprintf(stderr, "CUDA error at %s:%d: %s (%s)\n", __FILE__,     \
                         __LINE__, cudaGetErrorName(err_),                       \
                         cudaGetErrorString(err_));                              \
            std::exit(1);                                                        \
        }                                                                        \
    } while (0)

__global__ void vecAdd(const double* a, const double* b, double* out, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) out[i] = a[i] + b[i];
}

int main() {
    const char* pin = std::getenv("CUDA_VISIBLE_DEVICES");
    const char* order = std::getenv("CUDA_DEVICE_ORDER");
    std::printf("CUDA_VISIBLE_DEVICES = %s\n", pin ? pin : "<unset - NOT PINNED>");
    std::printf("CUDA_DEVICE_ORDER    = %s\n", order ? order : "<unset>");
    if (!isSingleGpuIndex(pin)) {
        std::fprintf(stderr,
                     "FAIL: CUDA_VISIBLE_DEVICES must contain exactly one ccgpu4 index (0-3).\n");
        return 1;
    }
    if (order == nullptr || std::strcmp(order, "PCI_BUS_ID") != 0) {
        std::fprintf(stderr,
                     "FAIL: CUDA_DEVICE_ORDER must be PCI_BUS_ID so nvidia-smi and CUDA indices match.\n");
        return 1;
    }

    int nDevices = 0;
    CHECK(cudaGetDeviceCount(&nDevices));
    std::printf("visible devices      = %d\n", nDevices);
    if (nDevices != 1) {
        std::fprintf(stderr,
                     "FAIL: expected exactly one visible device after pinning; found %d.\n",
                     nDevices);
        return 1;
    }

    cudaDeviceProp prop;
    CHECK(cudaGetDeviceProperties(&prop, 0));
    std::printf("device               = %s\n", prop.name);
    std::printf("compute capability   = sm_%d%d  (want sm_86)\n", prop.major, prop.minor);
    std::printf("global memory        = %.1f GB\n", prop.totalGlobalMem / 1e9);
    std::printf("SMs                  = %d\n", prop.multiProcessorCount);
    if (std::strcmp(prop.name, kExpectedDevice) != 0 || prop.major != 8 || prop.minor != 6) {
        std::fprintf(stderr,
                     "FAIL: expected %s with compute capability sm_86; found %s sm_%d%d.\n",
                     kExpectedDevice, prop.name, prop.major, prop.minor);
        return 1;
    }

    int rtVersion = 0, drVersion = 0;
    CHECK(cudaRuntimeGetVersion(&rtVersion));
    CHECK(cudaDriverGetVersion(&drVersion));
    std::printf("runtime / driver     = %d.%d / %d.%d\n", rtVersion / 1000,
                (rtVersion % 1000) / 10, drVersion / 1000, (drVersion % 1000) / 10);
    if (rtVersion != kExpectedCudaRuntime) {
        std::fprintf(stderr, "FAIL: expected CUDA runtime 13.3; encoded version is %d.\n",
                     rtVersion);
        return 1;
    }
    if (drVersion < kMinimumCudaDriverApi) {
        std::fprintf(stderr,
                     "FAIL: expected driver API support for CUDA 13.x or newer; encoded version "
                     "is %d.\n",
                     drVersion);
        return 1;
    }

    // 16.8M doubles per array: 134 MB each, ~400 MB on device. Small next to 24 GB.
    const int n = 1 << 24;
    const size_t bytes = static_cast<size_t>(n) * sizeof(double);

    double* hA = static_cast<double*>(std::malloc(bytes));
    double* hB = static_cast<double*>(std::malloc(bytes));
    double* hOut = static_cast<double*>(std::malloc(bytes));
    if (hA == nullptr || hB == nullptr || hOut == nullptr) {
        std::fprintf(stderr, "FAIL: could not allocate three %.0f MB host arrays.\n", bytes / 1e6);
        std::free(hA);
        std::free(hB);
        std::free(hOut);
        return 1;
    }
    for (int i = 0; i < n; ++i) {
        hA[i] = i * 0.5;   // exactly representable, so the check below can demand
        hB[i] = i * 0.25;  // bit-exact equality rather than a tolerance
    }

    double *dA = nullptr, *dB = nullptr, *dOut = nullptr;
    CHECK(cudaMalloc(&dA, bytes));
    CHECK(cudaMalloc(&dB, bytes));
    CHECK(cudaMalloc(&dOut, bytes));

    const int threads = 256;
    const int blocks = (n + threads - 1) / threads;

    // Warm up: first launch pays context creation, which would swamp the timings.
    CHECK(cudaMemcpy(dA, hA, bytes, cudaMemcpyHostToDevice));
    CHECK(cudaMemcpy(dB, hB, bytes, cudaMemcpyHostToDevice));
    vecAdd<<<blocks, threads>>>(dA, dB, dOut, n);
    CHECK(cudaGetLastError());
    CHECK(cudaDeviceSynchronize());

    cudaEvent_t t0, t1, t2, t3;
    CHECK(cudaEventCreate(&t0)); CHECK(cudaEventCreate(&t1));
    CHECK(cudaEventCreate(&t2)); CHECK(cudaEventCreate(&t3));

    CHECK(cudaEventRecord(t0));
    CHECK(cudaMemcpy(dA, hA, bytes, cudaMemcpyHostToDevice));
    CHECK(cudaMemcpy(dB, hB, bytes, cudaMemcpyHostToDevice));
    CHECK(cudaEventRecord(t1));
    vecAdd<<<blocks, threads>>>(dA, dB, dOut, n);
    CHECK(cudaGetLastError());
    CHECK(cudaEventRecord(t2));
    CHECK(cudaMemcpy(hOut, dOut, bytes, cudaMemcpyDeviceToHost));
    CHECK(cudaEventRecord(t3));
    CHECK(cudaEventSynchronize(t3));

    float msH2D = 0, msKernel = 0, msD2H = 0;
    CHECK(cudaEventElapsedTime(&msH2D, t0, t1));
    CHECK(cudaEventElapsedTime(&msKernel, t1, t2));
    CHECK(cudaEventElapsedTime(&msD2H, t2, t3));

    int bad = 0;
    for (int i = 0; i < n; ++i) {
        if (hOut[i] != i * 0.75) { ++bad; }
    }

    std::printf("\nn = %d doubles (%.0f MB per array)\n", n, bytes / 1e6);
    std::printf("H2D  %6.2f ms  (%5.1f GB/s, 2 arrays)\n", msH2D, 2 * bytes / (msH2D * 1e6));
    std::printf("kern %6.2f ms\n", msKernel);
    std::printf("D2H  %6.2f ms  (%5.1f GB/s)\n", msD2H, bytes / (msD2H * 1e6));
    std::printf("\n%s: %d / %d elements exact\n", bad == 0 ? "PASS" : "FAIL", n - bad, n);

    CHECK(cudaEventDestroy(t0)); CHECK(cudaEventDestroy(t1));
    CHECK(cudaEventDestroy(t2)); CHECK(cudaEventDestroy(t3));
    CHECK(cudaFree(dA)); CHECK(cudaFree(dB)); CHECK(cudaFree(dOut));
    std::free(hA); std::free(hB); std::free(hOut);
    return bad == 0 ? 0 : 1;
}
