// Step 2 of the ccgpu4 GPU smoke test: the same CUDA work, exposed as a plain C ABI
// shared library so Java can call it. This is the bridge the hybrid design in
// GPU_FEASIBILITY_ANALYSIS.md depends on (Java keeps the auction, GPU takes the
// household loop), so it is the part actually worth de-risking today.
//
// extern "C" is what makes the symbols findable: without it nvcc/C++ mangles the
// names and SymbolLookup.find() returns empty.
//
// Build: nvcc -O2 -arch=sm_86 -Xcompiler -fPIC -shared -o libsmoke.so libsmoke.cu
//
// Every entry point returns 0 on success, a positive cudaError_t on a CUDA failure,
// or a negative status for a rejected argument/environment. It never throws or
// exits, because a crash here takes the whole JVM down with it.

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cuda_runtime.h>

namespace {

constexpr char kExpectedDevice[] = "NVIDIA GeForce RTX 3090";
constexpr int kExpectedCudaRuntime = 13030;  // CUDA 13.3
constexpr int kMinimumCudaDriverApi = 13000;  // CUDA 13.x minor compatibility is valid.
constexpr int kThreads = 256;
constexpr int kMaxElements = 1 << 25;  // Three device arrays stay below 1 GiB.

constexpr int kInvalidArgument = -1;
constexpr int kInvalidPin = -2;
constexpr int kUnexpectedDeviceCount = -3;
constexpr int kUnexpectedDevice = -4;
constexpr int kUnexpectedRuntime = -5;
constexpr int kInvalidDeviceOrder = -6;

bool isSingleGpuIndex(const char* value) {
    return value != nullptr && value[0] >= '0' && value[0] <= '3' && value[1] == '\0';
}

int reportCudaError(cudaError_t error, const char* call, int line) {
    std::fprintf(stderr, "[libsmoke] %s at %s:%d: %s (%s)\n", call, __FILE__, line,
                 cudaGetErrorName(error), cudaGetErrorString(error));
    return static_cast<int>(error);
}

void releaseDeviceBuffer(double*& buffer, int& result) {
    if (buffer == nullptr) return;
    cudaError_t error = cudaFree(buffer);
    if (error != cudaSuccess && result == 0) {
        result = reportCudaError(error, "cudaFree", __LINE__);
    }
    buffer = nullptr;
}

}  // namespace

#define RETURN_IF_CUDA_ERROR(call)                                               \
    do {                                                                         \
        cudaError_t error_ = (call);                                             \
        if (error_ != cudaSuccess) {                                             \
            return reportCudaError(error_, #call, __LINE__);                    \
        }                                                                        \
    } while (0)

#define CLEAN_UP_IF_CUDA_ERROR(call)                                             \
    do {                                                                         \
        cudaError_t error_ = (call);                                             \
        if (error_ != cudaSuccess) {                                             \
            result = reportCudaError(error_, #call, __LINE__);                  \
            goto cleanup;                                                        \
        }                                                                        \
    } while (0)

__global__ void vecAdd(const double* a, const double* b, double* out, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) out[i] = a[i] + b[i];
}

extern "C" int cuda_device_info(void) {
    const char* pin = std::getenv("CUDA_VISIBLE_DEVICES");
    const char* order = std::getenv("CUDA_DEVICE_ORDER");
    if (!isSingleGpuIndex(pin)) {
        std::fprintf(stderr,
                     "[libsmoke] CUDA_VISIBLE_DEVICES must contain one ccgpu4 index (0-3).\n");
        return kInvalidPin;
    }
    if (order == nullptr || std::strcmp(order, "PCI_BUS_ID") != 0) {
        std::fprintf(stderr,
                     "[libsmoke] CUDA_DEVICE_ORDER must be PCI_BUS_ID so nvidia-smi and "
                     "CUDA indices match.\n");
        return kInvalidDeviceOrder;
    }

    int nDevices = 0;
    RETURN_IF_CUDA_ERROR(cudaGetDeviceCount(&nDevices));
    if (nDevices != 1) {
        std::fprintf(stderr, "[libsmoke] expected 1 visible device; found %d.\n", nDevices);
        return kUnexpectedDeviceCount;
    }

    cudaDeviceProp prop;
    RETURN_IF_CUDA_ERROR(cudaGetDeviceProperties(&prop, 0));

    int rtVersion = 0;
    int drVersion = 0;
    RETURN_IF_CUDA_ERROR(cudaRuntimeGetVersion(&rtVersion));
    RETURN_IF_CUDA_ERROR(cudaDriverGetVersion(&drVersion));
    std::printf("[libsmoke] %d visible device(s); using \"%s\" (sm_%d%d, %.1f GB)\n",
                nDevices, prop.name, prop.major, prop.minor, prop.totalGlobalMem / 1e9);
    std::printf("[libsmoke] CUDA runtime / driver API = %d.%d / %d.%d\n",
                rtVersion / 1000, (rtVersion % 1000) / 10,
                drVersion / 1000, (drVersion % 1000) / 10);
    std::fflush(stdout);

    if (std::strcmp(prop.name, kExpectedDevice) != 0 || prop.major != 8 || prop.minor != 6) {
        std::fprintf(stderr,
                     "[libsmoke] expected %s sm_86; found %s sm_%d%d.\n",
                     kExpectedDevice, prop.name, prop.major, prop.minor);
        return kUnexpectedDevice;
    }
    if (rtVersion != kExpectedCudaRuntime || drVersion < kMinimumCudaDriverApi) {
        std::fprintf(stderr,
                     "[libsmoke] expected CUDA runtime 13.3 and driver API support for 13.x; "
                     "encoded versions are %d / %d.\n",
                     rtVersion, drVersion);
        return kUnexpectedRuntime;
    }
    return 0;
}

// a, b, out point at off-heap memory owned by the caller (a Java Arena).
extern "C" int cuda_vector_add(const double* a, const double* b, double* out, int n) {
    if (a == nullptr || b == nullptr || out == nullptr || n <= 0 || n > kMaxElements) {
        std::fprintf(stderr,
                     "[libsmoke] invalid vector-add arguments: pointers must be non-null and "
                     "n must be in [1, %d]; got n=%d.\n",
                     kMaxElements, n);
        return kInvalidArgument;
    }

    const size_t bytes = static_cast<size_t>(n) * sizeof(double);
    double *dA = nullptr, *dB = nullptr, *dOut = nullptr;
    const int blocks = (n + kThreads - 1) / kThreads;
    int result = 0;

    CLEAN_UP_IF_CUDA_ERROR(cudaMalloc(&dA, bytes));
    CLEAN_UP_IF_CUDA_ERROR(cudaMalloc(&dB, bytes));
    CLEAN_UP_IF_CUDA_ERROR(cudaMalloc(&dOut, bytes));

    CLEAN_UP_IF_CUDA_ERROR(cudaMemcpy(dA, a, bytes, cudaMemcpyHostToDevice));
    CLEAN_UP_IF_CUDA_ERROR(cudaMemcpy(dB, b, bytes, cudaMemcpyHostToDevice));

    vecAdd<<<blocks, kThreads>>>(dA, dB, dOut, n);
    CLEAN_UP_IF_CUDA_ERROR(cudaGetLastError());
    CLEAN_UP_IF_CUDA_ERROR(cudaDeviceSynchronize());

    CLEAN_UP_IF_CUDA_ERROR(cudaMemcpy(out, dOut, bytes, cudaMemcpyDeviceToHost));

cleanup:
    releaseDeviceBuffer(dA, result);
    releaseDeviceBuffer(dB, result);
    releaseDeviceBuffer(dOut, result);
    return result;
}
