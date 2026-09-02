# GPU smoke test — does the ccgpu4 toolchain actually work?

Purpose: before writing any real CUDA for the model, prove the whole chain works end to end and
record the environment. Two escalating steps, both tiny.

| Step | File | What it proves |
|---|---|---|
| 0 | *(commands below)* | driver alive, a GPU is free, `nvcc` exists and matches the driver |
| 1 | `vector_add.cu` | `nvcc` compiles for `sm_86`, kernel runs on the 3090, doubles come back exact, H2D/D2H bandwidth |
| 2 | `libsmoke.cu` + `SmokeTest.java` | **the JVM can call a CUDA kernel** through the Foreign Function & Memory API |

Step 2 is the one that matters. Step 1 is a five-minute sanity check that any CUDA tutorial gives
you; step 2 tests the actual architecture in `GPU_FEASIBILITY_ANALYSIS.md` — Java keeps the
sequential auction, CUDA takes the household loop. If Java↔CUDA doesn't work on this box, the whole
hybrid plan needs rethinking, and it's much cheaper to find that out now than after writing a
household kernel.

## Run it

```bash
# on ccgpu4, NOT shell4
cd /mnt/ccnas2/bdp/ooh23/cuda-smoke
export PATH=/usr/local/cuda/bin:$PATH                                  # if nvcc isn't found
export JAVA_HOME="$(ls -d /mnt/ccnas2/bdp/ooh23/tools/jdk-25*)"
export PATH="$JAVA_HOME/bin:$PATH"

./run.sh        # prints nvidia-smi, then stops so you can pick a GPU
./run.sh 2      # builds and runs both steps pinned to GPU 2
```

`run.sh` enforces mechanically: it refuses to run anywhere but `ccgpu4`, shows `nvidia-smi` before
any GPU launch, requires exactly one physical GPU index from 0–3, requires an RTX 3090, CUDA 13.3
and JDK 25, maps CUDA indices to `nvidia-smi` with `CUDA_DEVICE_ORDER=PCI_BUS_ID`, **refuses a GPU
with less than 4 GiB free**, warns above 80 % utilisation, and caps the JVM at 4 processors (well
under the ≤16 half-cores cap).

The process table is deliberately a **manual** check. Running `./run.sh` without an index prints it
and stops; after inspecting it, supplying an index records the user's choice. The 4 GiB check only
protects memory headroom. It does not decide whether a foreign process is safe to share with, and
memory use above 500 MiB is not an automatic rejection.

> **Where the 4 GiB figure comes from.** No written rule mandates any GPU-memory threshold: the
> mandatory access-policy section covers CPU cores, FPGA builds and machine tiers, and says nothing
> about GPU memory. The sharing guidance is explicitly etiquette rather than policy, and asks for a
> GPU that is idle with "no foreign processes listed". That reading is unachievable here — the
> observation this script was written against is that all four GPUs routinely carry 8–16 GB of other
> people's ML jobs, so a near-empty-GPU rule would reject every GPU on the box, every time. The
> threshold therefore encodes a different principle: *is there room for this job without pushing
> anyone into OOM?* The smoke test needs well under 1 GB, so 4 GiB is a generous floor.
>
> **Open item — needs confirming on ccgpu4.** The 8–16 GB observation has not been re-checked
> recently. Run `nvidia-smi` and see whether it still holds. If the machine has emptied out, a
> tighter threshold becomes viable and this note should be revisited. Until then the script is
> deliberately more permissive than the written etiquette, which is a judgement call, not compliance.
>
> **Utilisation is only a warning**, and its stated reason is your own timing noise rather than the
> other user's job. That is acceptable for a smoke test that runs for seconds. It is *not* acceptable
> for timed CUDA comparisons, where competing load corrupts the measurement — tighten it to a refusal
> before running anything benchmarked.

## Expected output

Step 1 should report `NVIDIA GeForce RTX 3090`, `sm_86`, ~25.8 GB, 82 SMs, ~10–12 GB/s pageable
host↔device bandwidth over PCIe, and `PASS: 16777216 / 16777216 elements exact`.

Step 2 should print the same device from inside the JVM and `PASS`.

The accepted runtime contract is intentionally explicit: host `ccgpu4`; one visible RTX 3090
(`sm_86`); CUDA toolkit/runtime 13.3; driver API support for CUDA 13.x or newer; and JDK feature
release 25. CUDA's supported minor-version compatibility means the driver API need not numerically
equal 13.3. The exact driver build and JDK patch version are printed for the run record but may move
forward without weakening this contract.

## Things worth knowing before they bite

- **`extern "C"` is mandatory** in `libsmoke.cu`. Without it, C++ name mangling makes
  `SymbolLookup.find("cuda_vector_add")` return empty and the Java side fails with a confusing
  "symbol not found".
- **Native code cannot touch a Java `double[]`.** Data has to live off-heap in an `Arena`. For the
  real port this is a feature, not a tax: household state can stay off-heap and device-resident
  instead of being marshalled out of the JVM heap every step.
- **`--enable-native-access=ALL-UNNAMED`** — without it, JDK 25 prints a loud restricted-method
  warning (and will eventually refuse).
- **nvcc default is `-cudart static`**, so `libsmoke.so` carries the CUDA runtime with it and needs
  no `LD_LIBRARY_PATH` at run time.
- **A native crash kills the JVM**, with no Java stack trace. Hence every entry point in
  `libsmoke.cu` returns a status code instead of aborting.
- With `CUDA_DEVICE_ORDER=PCI_BUS_ID`, `CUDA_VISIBLE_DEVICES=2` selects the same physical index shown
  by `nvidia-smi`, then the program sees that GPU as **device 0**. The runner accepts only one index,
  and both native programs fail unless exactly one RTX 3090 (`sm_86`) is visible with the expected
  CUDA runtime. The Java side independently checks JDK 25, the 4-processor cap, the PCI-bus ordering
  and the single-index pin before loading the library, so `PASS` includes the documented contract.

## Step 0 by hand

```bash
nvidia-smi                 # who else is on the box, which GPUs are idle
nvidia-smi -L              # list GPUs with UUIDs
nvcc --version             # toolkit version
ls -d /usr/local/cuda*     # where the toolkit lives, if nvcc isn't on PATH
nproc                      # 64 logical on ccgpu4 -> parallel work stays ≤16
uptime                     # load average: is the machine already busy?
```
