#!/usr/bin/env bash
# Negative control for the validation metric: Mersenne vs Mersenne on disjoint seed sets.
#
# Establishes the null distribution of the composite loss (and of every individual metric)
# under no code change at all, so that trajectory-changing experiments -- Philox, AS241,
# the mantissa probe, the exact frontier -- have a derived acceptance tolerance instead of
# an invented one.
#
# Set 1 uses the canonical seeds, so its composite IS the reference baseline.
#
# Usage:
#   scripts/model/run-null-control.sh smoke    # 2 sets, reuses existing per-seed outputs, seconds
#   scripts/model/run-null-control.sh full     # 20 sets = 160 model runs, ~10-15 min
#   scripts/model/run-null-control.sh rescore   # 20 sets, reuses verified outputs
#   scripts/model/run-null-control.sh adopt-legacy  # attest the retained 2026-08-14 campaign
#
# Override any default via the environment, e.g.:
#   WORKERS=8 N_SETS=30 scripts/model/run-null-control.sh full

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

VERSION="${VERSION:-v5o3}"
OUTPUT_DIR="${OUTPUT_DIR:-${HOME}/UROP/null-control}"
WORKERS="${WORKERS:-10}"          # each worker is its own JVM (~1.2-1.5 GB RSS); 10 fits 24 GB
SET_SIZE="${SET_SIZE:-8}"         # must match the canonical seed block (schema.py CANONICAL_VALIDATION_SEEDS)
N_SETS="${N_SETS:-20}"

# private-datasets/was is not available on this machine, so the three household_jsd metrics
# (income / housing-wealth / financial-wealth distribution JSDs) cannot be scored. The composite
# is then a 17-metric subset quantity: internally comparable, NOT comparable to published
# 20-metric baselines. Clear this variable once WAS access is sorted.
SKIP_METRIC_KINDS="${SKIP_METRIC_KINDS:-household_jsd}"

# The order book is chosen by a JVM system property (OrderBookFactory), NOT by the model config.
# Pass both identity-bearing settings explicitly on every Maven invocation and verify the values
# emitted by the model process. MAVEN_OPTS remains available for unrelated JVM tuning only.
ORDERBOOK="${ORDERBOOK:-array}"
RNG_MODE="mersenne"
mode="${1:-full}"

case "${ORDERBOOK}" in
  array|tree) ;;
  *) echo "ORDERBOOK must be 'array' or 'tree', got '${ORDERBOOK}'" >&2; exit 2 ;;
esac

if [[ "${mode}" != "adopt-legacy" ]]; then
  option_variables=(MAVEN_OPTS MAVEN_ARGS JAVA_TOOL_OPTIONS _JAVA_OPTIONS JDK_JAVA_OPTIONS)
  model_control_properties=(
    housing.orderbook
    housing.rng
    housing.benchmark.sameJvmWarmupRuns
    housing.benchmark.warmupOutputRoot
  )
  for option_variable in "${option_variables[@]}"; do
    option_value="${!option_variable-}"
    for reserved_property in "${model_control_properties[@]}"; do
      if [[ "${option_value}" == *"-D${reserved_property}"* ]]; then
        echo "${option_variable} must not set -D${reserved_property}; this harness passes and verifies model controls explicitly." >&2
        echo "Remove that property (unrelated options such as -Xmx are preserved)." >&2
        exit 2
      fi
    done
  done
fi

reuse_args=()
operation_args=()
case "${mode}" in
  smoke)
    n_sets=2
    reuse_args=(--reuse-existing-output)
    summary_file="${OUTPUT_DIR}/summary-smoke.json"
    ;;
  full)
    n_sets="${N_SETS}"
    summary_file="${OUTPUT_DIR}/summary.json"
    ;;
  # Rescore the retained per-seed outputs without rerunning the model. This is how the
  # 20-metric null gets built once WAS access lands: the three household_jsd metrics read
  # MonthlyGrossEmploymentIncome-run1.csv, HousingWealth-run1.csv and BankBalance-run1.csv,
  # all of which the 17-metric campaign already wrote. Use:
  #   SKIP_METRIC_KINDS= ./scripts/model/run-null-control.sh rescore
  rescore)
    n_sets="${N_SETS}"
    reuse_args=(--reuse-existing-output)
    summary_file="${OUTPUT_DIR}/summary-rescore.json"
    ;;
  adopt-legacy)
    n_sets="${N_SETS}"
    operation_args=(--adopt-legacy)
    summary_file=""
    ;;
  *)
    echo "Usage: $(basename "$0") [smoke|full|rescore|adopt-legacy]" >&2
    exit 2
    ;;
esac

log_dir="${LOG_DIR:-${OUTPUT_DIR%/}-logs}"
mkdir -p "${log_dir}"
# Keep logs outside immutable generation material and never truncate an earlier evidence log.
log_file="$(mktemp "${log_dir}/run-${mode}.XXXXXX")"

echo "mode        : ${mode}"
echo "version     : ${VERSION}"
echo "sets        : ${n_sets} x ${SET_SIZE} seeds"
echo "workers     : ${WORKERS}"
echo "order book  : ${ORDERBOOK}   (explicit and process-verified for fresh runs)"
echo "RNG mode    : ${RNG_MODE}   (explicit and process-verified for fresh runs)"
echo "MAVEN_OPTS  : ${MAVEN_OPTS:-<unset>}   (diagnostic/JVM tuning only)"
echo "output dir  : ${OUTPUT_DIR}"
echo "log         : ${log_file}"
if [[ -n "${summary_file}" ]]; then
  echo "summary     : ${summary_file}"
fi
echo

cd "${repo_root}"
python_args=(
  scripts/python/experiments/model/validation_null_control.py
  --version "${VERSION}"
  --n-sets "${n_sets}"
  --set-size "${SET_SIZE}"
  --workers "${WORKERS}"
  --output-dir "${OUTPUT_DIR}"
  --orderbook "${ORDERBOOK}"
  --rng-mode "${RNG_MODE}"
  --skip-metric-kinds "${SKIP_METRIC_KINDS}"
  "${reuse_args[@]}"
  "${operation_args[@]}"
)
if [[ -n "${summary_file}" ]]; then
  python_args+=(--json-out "${summary_file}")
fi
python3 "${python_args[@]}" 2>&1 | tee "${log_file}"

echo
if [[ -n "${summary_file}" ]]; then
  echo "Summary JSON: ${summary_file}"
else
  echo "Legacy generation provenance adopted in: ${OUTPUT_DIR}"
fi
