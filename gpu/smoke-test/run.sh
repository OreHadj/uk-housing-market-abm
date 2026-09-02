#!/usr/bin/env bash
# ccgpu4 GPU smoke test runner.
#
#   ./run.sh              -> shows nvidia-smi and stops (choose a GPU yourself)
#   ./run.sh <gpu-index>  -> builds and runs both steps pinned to that GPU
#
# Constraints enforced below, stated here so the reasons travel with the script:
#   - compute runs only on ccgpu4, never on a shell gateway or another CC machine
#   - nvidia-smi is printed before anything launches for manual process inspection
#   - one GPU index (0-3) is required; <4 GiB free is refused and >80% util warns
#   - the target is an RTX 3090, the CUDA toolkit is 13.3, and the JDK is 25
#   - single-file nvcc compiles and a 4-processor JVM cap stay far below the Imperial
#     Custom Computing limit of half a machine's cores (<=16 of ccgpu4's 32)
#
# Imperial reserves the right to kill jobs that break these, and repeated breaches can
# suspend or permanently ban the account.

set -euo pipefail
cd "$(dirname "$0")"

host=$(hostname -s)
if [ "$host" != "ccgpu4" ]; then
    echo "REFUSING: this is '$host'. This smoke test targets ccgpu4 exactly." >&2
    echo "Shell gateways exist only to hop through, and lima01/maia01/maxnode1-2 are" >&2
    echo "reserved for test runs. Running compute there breaches Imperial Custom" >&2
    echo "Computing access policy and puts the account at risk. Connect with:" >&2
    echo "  ssh -J <user>@shell4.doc.ic.ac.uk <user>@ccgpu4.doc.ic.ac.uk" >&2
    exit 1
fi

if ! command -v nvidia-smi >/dev/null 2>&1; then
    echo "REFUSING: nvidia-smi is not available on '$host'." >&2
    exit 1
fi

echo "=== nvidia-smi (pick an idle GPU: low memory, low util, no foreign processes) ==="
nvidia-smi
echo

if [ $# -eq 0 ]; then
    echo "Now re-run with the index of a free GPU, e.g.:  ./run.sh 2"
    exit 0
fi
if [ $# -ne 1 ]; then
    echo "Usage: ./run.sh <gpu-index>" >&2
    exit 1
fi
if [[ ! "$1" =~ ^[0-3]$ ]]; then
    echo "REFUSING: GPU index must be exactly one of 0, 1, 2, or 3; got '$1'." >&2
    exit 1
fi

gpu="$1"
if ! gpu_stats=$(nvidia-smi --id="$gpu" \
        --query-gpu=name,memory.used,memory.total,utilization.gpu \
        --format=csv,noheader,nounits); then
    echo "REFUSING: nvidia-smi could not inspect GPU $gpu." >&2
    exit 1
fi
if [[ "$gpu_stats" == *$'\n'* ]]; then
    echo "REFUSING: GPU index '$gpu' selected more than one device." >&2
    exit 1
fi
IFS=',' read -r gpu_name used_mib total_mib util_percent extra <<<"$gpu_stats"
gpu_name="${gpu_name#"${gpu_name%%[![:space:]]*}"}"
gpu_name="${gpu_name%"${gpu_name##*[![:space:]]}"}"
used_mib="${used_mib//[[:space:]]/}"
total_mib="${total_mib//[[:space:]]/}"
util_percent="${util_percent//[[:space:]]/}"
if [ -n "$extra" ] || [[ ! "$used_mib" =~ ^[0-9]+$ ]] \
        || [[ ! "$total_mib" =~ ^[0-9]+$ ]] || [[ ! "$util_percent" =~ ^[0-9]+$ ]]; then
    echo "REFUSING: unexpected nvidia-smi data for GPU $gpu: '$gpu_stats'." >&2
    exit 1
fi
if [ "$gpu_name" != "NVIDIA GeForce RTX 3090" ]; then
    echo "REFUSING: GPU $gpu is '$gpu_name'; expected 'NVIDIA GeForce RTX 3090'." >&2
    exit 1
fi
free_mib=$(( total_mib - used_mib ))

# On ccgpu4 all four GPUs normally carry other people's ML jobs (~8-16 GB of each 24 GB), so
# "idle" cannot mean "near-zero memory" - that would reject every GPU on the box. What matters
# is whether there is room for this job without pushing anyone into OOM. The smoke test needs
# well under 1 GB; 4 GB of headroom is a generous floor.
if [ "$free_mib" -lt 4096 ]; then
    echo "REFUSING: GPU $gpu has only ${free_mib} MiB free of ${total_mib} MiB." >&2
    echo "Pick one with more headroom. All four GPUs are shared with other users, and" >&2
    echo "claiming one that is nearly full can push someone else's job out of memory." >&2
    exit 1
fi
if [ "$util_percent" -gt 80 ]; then
    echo "WARNING: GPU $gpu is at ${util_percent}% utilisation - someone is working it hard."
    echo "         Timings will be noise. Prefer a quieter GPU if one is available."
fi
echo "GPU $gpu: ${free_mib} MiB free of ${total_mib} MiB, ${util_percent}% utilisation."
echo "The process table above still requires manual inspection; memory headroom alone"
echo "does not establish that another user's job is safe to share. Pinning to GPU $gpu."
echo

# Match CUDA's numeric indices to nvidia-smi's PCI-bus ordering before applying the mask.
export CUDA_DEVICE_ORDER=PCI_BUS_ID
export CUDA_VISIBLE_DEVICES="$gpu"

if ! command -v nvcc >/dev/null 2>&1; then
    echo "nvcc not on PATH. Try:  export PATH=/usr/local/cuda/bin:\$PATH" >&2
    echo "(look for the toolkit with: ls -d /usr/local/cuda*)" >&2
    exit 1
fi
nvcc_output=$(nvcc --version)
cuda_release=$(printf '%s\n' "$nvcc_output" \
    | sed -nE 's/.*release ([0-9]+\.[0-9]+).*/\1/p' | tail -1)
if [ "$cuda_release" != "13.3" ]; then
    printf '%s\n' "$nvcc_output" >&2
    echo "REFUSING: expected CUDA toolkit release 13.3; found '${cuda_release:-unknown}'." >&2
    exit 1
fi

if ! command -v java >/dev/null 2>&1; then
    echo "java not on PATH. Try:" >&2
    echo "  export JAVA_HOME=\"\$(ls -d /mnt/ccnas2/bdp/ooh23/tools/jdk-25*)\"" >&2
    echo "  export PATH=\"\$JAVA_HOME/bin:\$PATH\"" >&2
    exit 1
fi
java_version_output=$(java -version 2>&1)
java_feature=$(printf '%s\n' "$java_version_output" \
    | sed -nE '1s/.*version "([0-9]+).*/\1/p')
if [ "$java_feature" != "25" ]; then
    printf '%s\n' "$java_version_output" >&2
    echo "REFUSING: expected JDK feature release 25; found '${java_feature:-unknown}'." >&2
    exit 1
fi

echo "=== build ==="
printf '%s\n' "$nvcc_output" | tail -2
nvcc -O2 -arch=sm_86 -o vector_add vector_add.cu
nvcc -O2 -arch=sm_86 -Xcompiler -fPIC -shared -o libsmoke.so libsmoke.cu
echo "built vector_add and libsmoke.so"
echo

echo "=== step 1: standalone CUDA ==="
./vector_add
echo

echo "=== step 2: Java -> CUDA via the Foreign Function & Memory API ==="
java --enable-native-access=ALL-UNNAMED -XX:ActiveProcessorCount=4 SmokeTest.java
echo
echo "=== smoke test complete ==="
