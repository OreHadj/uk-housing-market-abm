#!/usr/bin/env bash
# Snapshot-local paired cache benchmark harness for seed-1 timing diagnostics.
# Author: Max Stoddard

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/model-speed-lib.sh"

# Cache pairs may target older worktrees that predate Model's measured-phase markers.
MODEL_SPEED_TIMING_PROTOCOL="legacy-process-v0"
MODEL_SPEED_SAME_JVM_WARMUP_COUNT=0

LOG_TAG="CACHE-PAIR"
LOG_COLOR="\033[1;36m"
model_speed_log_init

helper_path="${script_dir}/model_speed.py"

usage() {
  cat <<EOF
Usage: $(basename "$0") --snapshot <version> --mode <mode> --seed <n> --repeat <n> --cache-off-root <dir> --cache-on-root <dir> --output-root <dir> [options]

Required arguments:
  --snapshot        Snapshot folder under input-data-versions
  --mode            Benchmark mode, usually core-minimal-20k-s1
  --seed            Model seed for every measured and warm-up run
  --repeat          Measured adjacent cache pairs; 40 gives 40 cache-off and 40 cache-on runs
  --cache-off-root  Repository/worktree root for the cache-off variant
  --cache-on-root   Repository/worktree root for the cache-on variant
  --output-root     Root directory for benchmark artifacts

Options:
  --warmup-pairs <n>             Balanced unmeasured cache pairs before measured timing (default: 3)
  --ordering-seed <n>            Deterministic randomization seed (default: 20260603)
  --pin-cpu <cpu-list>           Run Java through taskset -c <cpu-list>
  --active-processor-count <n>   Add -XX:ActiveProcessorCount=<n> to Java

Environment:
  MODEL_SPEED_JAVA_OPTS          JVM flags for direct Java execution (default: -Xms1g -Xmx4g)
  MODEL_SPEED_MAVEN_PROFILES     Optional Maven profiles for compile/classpath resolution
EOF
}

snapshot=""
mode=""
seed=""
repeat=""
cache_off_root=""
cache_on_root=""
output_root=""
warmup_pairs=3
ordering_seed=20260603
pin_cpu="${MODEL_SPEED_CPU_AFFINITY:-}"
active_processor_count="${MODEL_SPEED_ACTIVE_PROCESSOR_COUNT:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --snapshot)
      snapshot="$2"
      shift 2
      ;;
    --mode)
      mode="$2"
      shift 2
      ;;
    --seed)
      seed="$2"
      shift 2
      ;;
    --repeat)
      repeat="$2"
      shift 2
      ;;
    --cache-off-root)
      cache_off_root="$2"
      shift 2
      ;;
    --cache-on-root)
      cache_on_root="$2"
      shift 2
      ;;
    --output-root)
      output_root="$2"
      shift 2
      ;;
    --warmup-pairs)
      warmup_pairs="$2"
      shift 2
      ;;
    --ordering-seed)
      ordering_seed="$2"
      shift 2
      ;;
    --pin-cpu)
      pin_cpu="$2"
      shift 2
      ;;
    --active-processor-count)
      active_processor_count="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      log_err "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${snapshot}" || -z "${mode}" || -z "${seed}" || -z "${repeat}" || -z "${cache_off_root}" || -z "${cache_on_root}" || -z "${output_root}" ]]; then
  usage
  exit 1
fi
if ! [[ "${seed}" =~ ^[0-9]+$ ]] || (( seed < 1 )); then
  log_err "--seed must be a positive integer."
  exit 1
fi
if ! [[ "${repeat}" =~ ^[0-9]+$ ]] || (( repeat < 1 )); then
  log_err "--repeat must be a positive integer."
  exit 1
fi
if ! [[ "${warmup_pairs}" =~ ^[0-9]+$ ]]; then
  log_err "--warmup-pairs must be a non-negative integer."
  exit 1
fi
if ! [[ "${ordering_seed}" =~ ^-?[0-9]+$ ]]; then
  log_err "--ordering-seed must be an integer."
  exit 1
fi
if [[ -n "${active_processor_count}" ]] && ! [[ "${active_processor_count}" =~ ^[0-9]+$ ]]; then
  log_err "--active-processor-count must be a positive integer."
  exit 1
fi
if [[ -n "${active_processor_count}" ]] && (( active_processor_count < 1 )); then
  log_err "--active-processor-count must be a positive integer."
  exit 1
fi
if [[ -n "${pin_cpu}" && -z "${active_processor_count}" ]]; then
  active_processor_count=1
fi

cache_off_root="$(cd "${cache_off_root}" && pwd -P)"
cache_on_root="$(cd "${cache_on_root}" && pwd -P)"
mkdir -p "${output_root}"
output_root="$(cd "${output_root}" && pwd -P)"

MODEL_SPEED_CPU_AFFINITY="${pin_cpu}"
MODEL_SPEED_ACTIVE_PROCESSOR_COUNT="${active_processor_count}"
export MODEL_SPEED_CPU_AFFINITY MODEL_SPEED_ACTIVE_PROCESSOR_COUNT

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
run_root="${output_root%/}/${snapshot}/${mode}/seed-${seed}/paired-cache/${timestamp}"
run_plan_tsv="${run_root}/run-plan.tsv"
measured_runs_tsv="${run_root}/measured-runs.tsv"
summary_json="${run_root}/paired-summary.json"
generated_config_dir="$(model_speed_tmp_root)/generated-configs/${snapshot}/${mode}/paired-cache/${timestamp}"

declare -A variant_roots=(
  ["cache-off"]="${cache_off_root}"
  ["cache-on"]="${cache_on_root}"
)
declare -A variant_classpaths=()

log "Paired cache benchmark root: ${run_root}"
log "Mode: ${snapshot}/${mode}; seed=${seed}; repeat=${repeat}; warmup pairs=${warmup_pairs}"
log "Cache-off root: ${cache_off_root}"
log "Cache-on root:  ${cache_on_root}"
if [[ -n "${MODEL_SPEED_CPU_AFFINITY}" ]]; then
  log "CPU affinity: taskset -c ${MODEL_SPEED_CPU_AFFINITY}; JVM ActiveProcessorCount=${MODEL_SPEED_ACTIVE_PROCESSOR_COUNT}"
fi

mkdir -p "${run_root}" "${generated_config_dir}"
python3 "${helper_path}" cache-paired-plan \
  --seed "${seed}" \
  --repeat "${repeat}" \
  --warmup-pairs "${warmup_pairs}" \
  --ordering-seed "${ordering_seed}" \
  --output "${run_plan_tsv}"

printf '%s\n' \
  'phase	variant	pair_index	run_order_index	seed	run_id	wall_clock_seconds	model_computing_seconds	seconds_per_household_month	output_bytes	max_rss_kb	user_cpu_seconds	system_cpu_seconds	gc_pause_count	gc_pause_time_ms_total	config_path	output_dir	stdout_log	time_file	manifest_path' \
  > "${measured_runs_tsv}"

maven_profile_args() {
  local -n out_ref="$1"
  out_ref=()
  if [[ -n "${MODEL_SPEED_MAVEN_PROFILES:-}" ]]; then
    out_ref+=( "-P${MODEL_SPEED_MAVEN_PROFILES}" )
  fi
}

prepare_variant() {
  local variant="$1"
  local root="${variant_roots[${variant}]}"
  local -a profile_args=()
  maven_profile_args profile_args

  log "Running Java tests for ${variant}."
  ( cd "${root}" && ./mvnw -q test )

  log "Running exact regression gate for ${variant}."
  local -a regression_args=(
    bash scripts/model/run-speed-regression.sh
    --snapshot "${snapshot}"
    --mode e2e-default-5k-s1
    --contract exact
    --baseline-manifest docs/model-speed/baselines/v0-e2e-default-5k-s1.exact.sha256
    --repeat 3
    --output-root "${run_root}/regressions/${variant}"
  )
  if [[ -n "${MODEL_SPEED_CPU_AFFINITY}" ]]; then
    regression_args+=( --pin-cpu "${MODEL_SPEED_CPU_AFFINITY}" )
  fi
  if [[ -n "${MODEL_SPEED_ACTIVE_PROCESSOR_COUNT}" ]]; then
    regression_args+=( --active-processor-count "${MODEL_SPEED_ACTIVE_PROCESSOR_COUNT}" )
  fi
  (
    cd "${root}"
    "${regression_args[@]}"
  )

  log "Compiling and resolving runtime classpath for ${variant}."
  ( cd "${root}" && ./mvnw -q "${profile_args[@]}" -DskipTests clean compile )
  variant_classpaths["${variant}"]="$(
    cd "${root}"
    ./mvnw -q "${profile_args[@]}" -Dexec.classpathScope=runtime -Dexec.executable=echo -Dexec.args='%classpath' exec:exec | tail -n 1
  )"
  if [[ -z "${variant_classpaths[${variant}]}" ]]; then
    log_err "Failed to resolve classpath for ${variant}."
    exit 1
  fi

  model_speed_repo_root="${root}"
  MODEL_SPEED_MAVEN_BIN="${root}/mvnw"
  MODEL_SPEED_CLASSPATH="${variant_classpaths[${variant}]}"
  export MODEL_SPEED_MAVEN_BIN MODEL_SPEED_CLASSPATH
  model_speed_capture_environment "${run_root}/environment-${variant}.txt" "${snapshot}" "${mode}" "${output_root}"
}

run_planned_entry() {
  local phase="$1"
  local run_order_index="$2"
  local pair_index="$3"
  local row_seed="$4"
  local variant="$5"
  local run_id="$6"
  local root="${variant_roots[${variant}]}"
  local run_dir
  local config_path="${generated_config_dir}/${run_id}.properties"

  if [[ "${phase}" == "warmup" ]]; then
    run_dir="${run_root}/warmup/${run_id}"
  else
    run_dir="${run_root}/runs/${run_id}"
  fi

  model_speed_repo_root="${root}"
  MODEL_SPEED_MAVEN_BIN="${root}/mvnw"
  MODEL_SPEED_CLASSPATH="${variant_classpaths[${variant}]}"
  export MODEL_SPEED_MAVEN_BIN MODEL_SPEED_CLASSPATH

  model_speed_materialize_config \
    "${snapshot}" \
    "${mode}" \
    "${config_path}" \
    --override "SEED=${row_seed}" \
    --override "N_SIMS=1"

  log "Running ${phase} ${run_id} (order ${run_order_index}; pair ${pair_index}; ${variant}; seed ${row_seed})."
  model_speed_run_model_once "${config_path}" "${run_dir}"

  if [[ "${phase}" != "measured" ]]; then
    return 0
  fi

  local wall_clock_seconds
  local model_computing_seconds
  local target_population
  local n_steps
  local n_sims
  local primary_metric
  local output_bytes
  local max_rss_kb
  local user_cpu_seconds
  local system_cpu_seconds
  local gc_pause_count
  local gc_pause_time_ms_total

  wall_clock_seconds="$(cat "${run_dir}/wall_clock_seconds.txt")"
  model_computing_seconds="$(model_speed_extract_model_seconds "${run_dir}/model.stdout.log")"
  target_population="$(model_speed_read_config_value "${config_path}" TARGET_POPULATION)"
  n_steps="$(model_speed_read_config_value "${config_path}" N_STEPS)"
  n_sims="$(model_speed_read_config_value "${config_path}" N_SIMS)"
  primary_metric="$(model_speed_compute_primary_metric "${wall_clock_seconds}" "${target_population}" "${n_steps}" "${n_sims}")"
  output_bytes="$(model_speed_sum_output_bytes "${run_dir}/model-output")"
  max_rss_kb="$(model_speed_extract_time_field "${run_dir}/time.txt" "Maximum resident set size (kbytes)")"
  user_cpu_seconds="$(model_speed_extract_time_field "${run_dir}/time.txt" "User time (seconds)")"
  system_cpu_seconds="$(model_speed_extract_time_field "${run_dir}/time.txt" "System time (seconds)")"
  gc_pause_count="$(model_speed_json_field "${run_dir}/gc-summary.json" "pause_count")"
  gc_pause_time_ms_total="$(model_speed_json_field "${run_dir}/gc-summary.json" "pause_time_ms_total")"

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "${phase}" \
    "${variant}" \
    "${pair_index}" \
    "${run_order_index}" \
    "${row_seed}" \
    "${run_id}" \
    "${wall_clock_seconds}" \
    "${model_computing_seconds}" \
    "${primary_metric}" \
    "${output_bytes}" \
    "${max_rss_kb}" \
    "${user_cpu_seconds}" \
    "${system_cpu_seconds}" \
    "${gc_pause_count}" \
    "${gc_pause_time_ms_total}" \
    "${config_path}" \
    "${run_dir}/model-output" \
    "${run_dir}/model.stdout.log" \
    "${run_dir}/time.txt" \
    "${run_dir}/model-output.sha256" \
    >> "${measured_runs_tsv}"
}

prepare_variant "cache-off"
prepare_variant "cache-on"

{
  read -r _header
  while IFS=$'\t' read -r phase run_order_index pair_index row_seed variant run_id; do
    [[ -z "${phase}" ]] && continue
    run_planned_entry "${phase}" "${run_order_index}" "${pair_index}" "${row_seed}" "${variant}" "${run_id}"
  done
} < "${run_plan_tsv}"

if ! python3 "${helper_path}" cache-paired-summary \
  --runs-tsv "${measured_runs_tsv}" \
  --output "${summary_json}" \
  --expected-repeat "${repeat}" \
  --expected-seed "${seed}"; then
  log_err "Paired cache benchmark failed. See ${summary_json}"
  exit 1
fi

log "Paired cache benchmark complete."
log "Artifacts:"
log "  run plan:      ${run_plan_tsv}"
log "  measured runs: ${measured_runs_tsv}"
log "  summary:       ${summary_json}"
