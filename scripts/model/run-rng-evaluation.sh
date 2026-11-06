#!/usr/bin/env bash
# Reproduces the random-number-generation evaluation runs: legacy compatibility, the
# Mersenne versus philox-household comparison, and the A-B-A timing session.
#
# Usage:
#   scripts/model/run-rng-evaluation.sh legacy  <output-root>
#   scripts/model/run-rng-evaluation.sh compare <output-root>
#   scripts/model/run-rng-evaluation.sh timing  <output-root>
#
# legacy   Builds PRE_COMMIT (default b07fd6b, the last commit before the RNG work) and
#          CANDIDATE (default HEAD) from git, then runs v0 with 5,000 households, 2,000 steps
#          and seed 1: the pre-migration build, the candidate with the RNG mode left at its
#          default and set to mersenne, and the candidate twice in philox-household mode.
#          Every output file is then compared byte for byte.
# compare  Builds CANDIDATE and runs seeds 1-8 on v5o3 with 10,000 households and 2,000 steps
#          in mersenne and philox-household modes, writing <output-root>/compare/mersenne and
#          <output-root>/compare/hybrid. Score them with
#          scripts/python/experiments/model/rng_mode_comparison.py.
# timing   A-B-A timing of this working tree with scripts/model/run-speed-benchmark.sh: a
#          discarded arm of 8 runs, then 15 measured runs each of mersenne, philox-household
#          and mersenne again (v0, 10,000 households, 2,000 steps, seed 1, main output file
#          only, one untimed simulation in the same JVM before each timed one). Run it on an
#          otherwise idle machine. It took about 15 minutes on an Apple M4 Pro.
#
# Model runs use the array order book, with a 1-4 GB heap for legacy and compare and a
# 2-6 GB heap for timing. The candidate and pre-migration builds are exported from git, so
# uncommitted changes are not included.
#
# Environment overrides:
#   CANDIDATE               commit to evaluate (default HEAD)
#   PRE_COMMIT              pre-migration control commit (default b07fd6b)
#   JOBS                    parallel model runs for legacy and compare (default 4)
#   TIMING_REPEATS          measured runs per timing arm (default 15)
#   TIMING_WARMUP_REPEATS   runs in the discarded timing arm (default 8)
#   JAVA_HOME               JDK 25 to use (default: java on PATH)

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

CANDIDATE="${CANDIDATE:-HEAD}"
PRE_COMMIT="${PRE_COMMIT:-b07fd6b}"
JOBS="${JOBS:-4}"
TIMING_REPEATS="${TIMING_REPEATS:-15}"
TIMING_WARMUP_REPEATS="${TIMING_WARMUP_REPEATS:-8}"
JAVA_BIN="${JAVA_HOME:+${JAVA_HOME}/bin/}java"

usage() {
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

# Exports <commit> into <dir> with git archive, compiles it and records the runtime classpath.
build() {
  local commit="$1" dir="$2" sha
  sha="$(git -C "${repo_root}" rev-parse --verify "${commit}^{commit}")"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  git -C "${repo_root}" archive "${sha}" | tar -x -C "${dir}"
  printf '%s\n' "${sha}" > "${dir}/COMMIT"
  echo "building ${sha} in ${dir}"
  (cd "${dir}" && ./mvnw -q compile)
  (cd "${dir}" && ./mvnw -q -Dexec.classpathScope=runtime -Dexec.executable=echo \
      -Dexec.args='%classpath' exec:exec | tail -n 1) > "${dir}/classpath.txt"
  if [[ ! -s "${dir}/classpath.txt" ]]; then
    echo "failed to resolve the runtime classpath for ${sha}" >&2
    exit 1
  fi
}

# Writes a run config from a version's config.properties, pointing its data paths at
# input-data-versions/<version>/. "validation" applies the output-recording settings that the
# validation runs used.
make_config() {
  local src="$1" out="$2" version="$3" seed="$4" population="$5" recording="$6"
  local -a edits=(
    -e "s#\"src/main/resources/#\"input-data-versions/${version}/#"
    -e "s/^SEED = .*/SEED = ${seed}/"
    -e "s/^TARGET_POPULATION = .*/TARGET_POPULATION = ${population}/"
  )
  if [[ "${recording}" == "validation" ]]; then
    edits+=(
      -e 's/^recordTransactions = .*/recordTransactions = false/'
      -e 's/^recordHouseholdID = .*/recordHouseholdID = false/'
      -e 's/^recordRentalIncome = .*/recordRentalIncome = false/'
      -e 's/^recordHousingStatus = .*/recordHousingStatus = true/'
      -e 's/^recordNHousesOwned = .*/recordNHousesOwned = false/'
      -e 's/^recordAge = .*/recordAge = false/'
    )
  fi
  sed "${edits[@]}" "${src}" > "${out}"
}

# Runs one simulation from <build-dir>, so that relative data paths resolve inside that build.
run_model() {
  local dir="$1" config="$2" out="$3" log="$4"
  shift 4
  rm -rf "${out}"
  mkdir -p "${out}" "$(dirname "${log}")"
  if (cd "${dir}" && "${JAVA_BIN}" -Xms1g -Xmx4g -Dhousing.orderbook=array "$@" \
        -cp "$(cat classpath.txt)" housing.Model -configFile "${config}" -outputFolder "${out}/" -dev) \
        > "${log}" 2>&1; then
    echo "finished ${out}"
  else
    echo "FAILED ${out} (see ${log})" >&2
    return 1
  fi
}

pids=()

launch() {
  while [[ "$(jobs -pr | wc -l)" -ge "${JOBS}" ]]; do
    sleep 1
  done
  run_model "$@" &
  pids+=("$!")
}

wait_all() {
  local pid status=0
  for pid in ${pids[@]+"${pids[@]}"}; do
    wait "${pid}" || status=1
  done
  pids=()
  return "${status}"
}

compare_dirs() {
  local label="$1" control="$2" candidate="$3" same=0 differ=0 differing="" file
  while IFS= read -r file; do
    if cmp -s "${control}/${file}" "${candidate}/${file}"; then
      same=$((same + 1))
    else
      differ=$((differ + 1))
      differing="${differing} ${file}"
    fi
  done < <(cd "${control}" && ls)
  printf '%-34s %d identical, %d differ%s\n' "${label}" "${same}" "${differ}" \
    "${differing:+ (${differing# })}"
}

run_legacy() {
  local root="$1"
  build "${PRE_COMMIT}" "${root}/build/pre-migration"
  build "${CANDIDATE}" "${root}/build/candidate"
  local config="${root}/configs/v0-5k-seed-1.properties"
  mkdir -p "${root}/configs"
  make_config "${root}/build/candidate/input-data-versions/v0/config.properties" "${config}" \
    v0 1 5000 default
  local pre="${root}/build/pre-migration" cand="${root}/build/candidate"
  launch "${pre}" "${config}" "${root}/out/pre-migration" "${root}/logs/pre-migration.log"
  launch "${cand}" "${config}" "${root}/out/mersenne-default" "${root}/logs/mersenne-default.log"
  launch "${cand}" "${config}" "${root}/out/mersenne-explicit" "${root}/logs/mersenne-explicit.log" \
    -Dhousing.rng=mersenne
  launch "${cand}" "${config}" "${root}/out/hybrid-1" "${root}/logs/hybrid-1.log" \
    -Dhousing.rng=philox-household
  launch "${cand}" "${config}" "${root}/out/hybrid-2" "${root}/logs/hybrid-2.log" \
    -Dhousing.rng=philox-household
  wait_all
  echo
  echo "pre-migration commit: $(cat "${pre}/COMMIT")"
  echo "candidate commit:     $(cat "${cand}/COMMIT")"
  echo "control: pre-migration, $(ls "${root}/out/pre-migration" | wc -l | tr -d ' ') output files"
  compare_dirs "mersenne-default vs control" "${root}/out/pre-migration" "${root}/out/mersenne-default"
  compare_dirs "mersenne-explicit vs control" "${root}/out/pre-migration" "${root}/out/mersenne-explicit"
  compare_dirs "hybrid-1 vs control" "${root}/out/pre-migration" "${root}/out/hybrid-1"
  compare_dirs "hybrid-1 vs hybrid-2" "${root}/out/hybrid-1" "${root}/out/hybrid-2"
}

run_compare() {
  local root="$1" seed config
  build "${CANDIDATE}" "${root}/build/candidate"
  local cand="${root}/build/candidate"
  mkdir -p "${root}/configs"
  for seed in 1 2 3 4 5 6 7 8; do
    config="${root}/configs/v5o3-10k-seed-${seed}.properties"
    make_config "${cand}/input-data-versions/v5o3/config.properties" "${config}" \
      v5o3 "${seed}" 10000 validation
    launch "${cand}" "${config}" "${root}/compare/mersenne/seed-${seed}" \
      "${root}/logs/mersenne-seed-${seed}.log" -Dhousing.rng=mersenne
    launch "${cand}" "${config}" "${root}/compare/hybrid/seed-${seed}" \
      "${root}/logs/hybrid-seed-${seed}.log" -Dhousing.rng=philox-household
  done
  wait_all
  echo
  echo "candidate commit: $(cat "${cand}/COMMIT")"
  echo "Score with:"
  echo "  python3 ${repo_root}/scripts/python/experiments/model/rng_mode_comparison.py \\"
  echo "    --mersenne ${root}/compare/mersenne --hybrid ${root}/compare/hybrid \\"
  echo "    --null-control <run-null-control.sh output folder>"
}

run_timing() {
  local root="$1"
  local bench="${repo_root}/scripts/model/run-speed-benchmark.sh"
  local mode=core-minimal-10k-s1
  local base_opts="-Xms2g -Xmx6g -Dhousing.orderbook=array"
  mkdir -p "${root}"
  cd "${repo_root}"

  echo "=== preflight ==="
  echo "HEAD             $(git -C "${repo_root}" rev-parse HEAD)"
  echo "modified tracked $(git -C "${repo_root}" status --porcelain | grep -vc '^??' || true)"
  echo "load before      $(uptime)"
  if command -v pmset > /dev/null; then
    echo "power            $(pmset -g batt | head -1)"
  fi
  echo

  # The discarded arm absorbs the machine settling, so that the first measured arm starts on
  # the plateau. It also compiles the model once; the measured arms skip compilation.
  echo "=== [1/4] discarded warm-up arm (${TIMING_WARMUP_REPEATS} runs) ==="
  MODEL_SPEED_JAVA_OPTS="${base_opts}" \
    bash "${bench}" --snapshot v0 --mode "${mode}" --repeat "${TIMING_WARMUP_REPEATS}" --warmup 1 \
    --output-root "${root}/W-discarded" > "${root}/W-discarded.log" 2>&1
  export MODEL_SPEED_SKIP_COMPILE=1

  echo "=== [2/4] A1 mersenne (${TIMING_REPEATS} runs) ==="
  MODEL_SPEED_JAVA_OPTS="${base_opts}" \
    bash "${bench}" --snapshot v0 --mode "${mode}" --repeat "${TIMING_REPEATS}" --warmup 1 \
    --output-root "${root}/A1-mersenne" > "${root}/A1-mersenne.log" 2>&1

  echo "=== [3/4] B philox-household (${TIMING_REPEATS} runs) ==="
  MODEL_SPEED_JAVA_OPTS="${base_opts} -Dhousing.rng=philox-household" \
    bash "${bench}" --snapshot v0 --mode "${mode}" --repeat "${TIMING_REPEATS}" --warmup 1 \
    --output-root "${root}/B-philox" > "${root}/B-philox.log" 2>&1

  echo "=== [4/4] A2 mersenne (${TIMING_REPEATS} runs) ==="
  MODEL_SPEED_JAVA_OPTS="${base_opts}" \
    bash "${bench}" --snapshot v0 --mode "${mode}" --repeat "${TIMING_REPEATS}" --warmup 1 \
    --output-root "${root}/A2-mersenne" > "${root}/A2-mersenne.log" 2>&1
  echo
  echo "load after       $(uptime)"
  echo

  echo "=== result ==="
  python3 - "${root}" <<'PY'
import csv, glob, statistics, sys
root = sys.argv[1]
def ns(arm):
    f = glob.glob(f"{root}/{arm}/**/measured-runs.tsv", recursive=True)[0]
    with open(f) as fh:
        return [float(r["ns_per_household_month"]) for r in csv.DictReader(fh, delimiter="\t")]
a1, b, a2 = ns("A1-mersenne"), ns("B-philox"), ns("A2-mersenne")
pooled = a1 + a2
m = statistics.median
sd = lambda v: statistics.stdev(v) if len(v) > 1 else float("nan")
print(f"A1 mersenne         n={len(a1):2d}  median {m(a1):8.2f}  sd {sd(a1):6.2f}")
print(f"B  philox-household n={len(b):2d}  median {m(b):8.2f}  sd {sd(b):6.2f}")
print(f"A2 mersenne         n={len(a2):2d}  median {m(a2):8.2f}  sd {sd(a2):6.2f}")
print(f"machine drift A1->A2 {100*(m(a2)-m(a1))/m(a1):+.2f} %")
print(f"pooled A median      {m(pooled):.2f} ns/household-month")
print(f"philox-household     {100*(m(b)-m(pooled))/m(pooled):+.2f} % against the pooled Mersenne median")
print("A1 in execution order (watch for a ramp):")
print("  " + " ".join(f"{v:.0f}" for v in a1))
PY
  echo
  (cd "${root}" && find . -type f ! -name 'SHA256SUMS' | LC_ALL=C sort | xargs shasum -a 256 > SHA256SUMS)
  echo "evidence in ${root} (file hashes in SHA256SUMS)"
}

[[ $# -eq 2 ]] || usage
command="$1"
output_root="$(mkdir -p "$2" && cd "$2" && pwd)"

case "${command}" in
  legacy) run_legacy "${output_root}" ;;
  compare) run_compare "${output_root}" ;;
  timing) run_timing "${output_root}" ;;
  *) usage ;;
esac
