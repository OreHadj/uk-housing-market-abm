#!/usr/bin/env bash
# Snapshot-local benchmark harness for the Java housing model.
# Author: Max Stoddard

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/model-speed-lib.sh"

# This is the only harness whose wall-clock summaries use Model's same-JVM measured-phase protocol.
MODEL_SPEED_TIMING_PROTOCOL="same-jvm-measured-phase-v1"

LOG_TAG="SPEED-BENCH"
LOG_COLOR="\033[1;36m"
model_speed_log_init

usage() {
  cat <<EOF
Usage: $(basename "$0") --snapshot <version> --mode <mode> --repeat <n> --output-root <dir> [options]

Required arguments:
  --snapshot     Snapshot folder under input-data-versions (canonical model-speed snapshot: v0)
  --mode         e2e-default-5k-s1 | core-minimal-10k-s1 | core-minimal-20k-s1
  --repeat       Number of measured repeats
  --output-root  Root directory for benchmark artifacts

Options:
  --warmup <n>                  Same-JVM warm-up simulations before every measured sample (default: 0)
  --cooldown <n>                Number of unmeasured cool-down runs (default: 0)
  --capture-jfr                 Re-run the median scenario with JFR and the same warm-up protocol
  --pin-cpu <cpu-list>          Run Java through taskset -c <cpu-list>
  --active-processor-count <n>  Add -XX:ActiveProcessorCount=<n> to Java

Environment:
  MODEL_SPEED_JAVA_OPTS                 JVM flags for direct Java execution (default: -Xms1g -Xmx4g)
  MODEL_SPEED_CPU_AFFINITY              CPU list used by taskset when --pin-cpu is omitted
  MODEL_SPEED_ACTIVE_PROCESSOR_COUNT    JVM active processor count when --active-processor-count is omitted
  MODEL_SPEED_MAVEN_PROFILES            Optional Maven profiles for compile/classpath resolution
  MODEL_SPEED_SKIP_COMPILE              Set to 1 to use already-compiled classes (default: 0)
  MODEL_SPEED_POPULATION_LADDER         Set to 1 to record the 5k/10k population ladder for core-minimal-10k-s1
  MODEL_SPEED_TIME_BIN                  GNU time binary (default: gtime if present, else /usr/bin/time)
  MODEL_SPEED_DATE_BIN                  date binary supporting %N (default: date, else gdate)

Timing fields:
  wall_clock_seconds          Measured model phase only; excludes JVM startup and same-JVM warm-ups
  process_wall_clock_seconds  Complete JVM invocation; includes startup and same-JVM warm-ups
EOF
}

snapshot=""
mode=""
repeat=""
output_root=""
warmup=0
cooldown=0
capture_jfr=0
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
    --repeat)
      repeat="$2"
      shift 2
      ;;
    --output-root)
      output_root="$2"
      shift 2
      ;;
    --warmup)
      warmup="$2"
      shift 2
      ;;
    --cooldown)
      cooldown="$2"
      shift 2
      ;;
    --capture-jfr)
      capture_jfr=1
      shift
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

if [[ -z "${snapshot}" || -z "${mode}" || -z "${repeat}" || -z "${output_root}" ]]; then
  usage
  exit 1
fi

if ! [[ "${repeat}" =~ ^[0-9]+$ ]] || (( repeat < 1 )); then
  log_err "--repeat must be a positive integer."
  exit 1
fi
if ! [[ "${warmup}" =~ ^[0-9]+$ ]]; then
  log_err "--warmup must be a non-negative integer."
  exit 1
fi
if ! [[ "${cooldown}" =~ ^[0-9]+$ ]]; then
  log_err "--cooldown must be a non-negative integer."
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
if [[ "${MODEL_SPEED_SKIP_COMPILE}" != "0" && "${MODEL_SPEED_SKIP_COMPILE}" != "1" ]]; then
  log_err "MODEL_SPEED_SKIP_COMPILE must be 0 or 1."
  exit 1
fi
if [[ -n "${pin_cpu}" && -z "${active_processor_count}" ]]; then
  active_processor_count=1
fi
MODEL_SPEED_CPU_AFFINITY="${pin_cpu}"
MODEL_SPEED_ACTIVE_PROCESSOR_COUNT="${active_processor_count}"
MODEL_SPEED_SAME_JVM_WARMUP_COUNT="${warmup}"
export MODEL_SPEED_CPU_AFFINITY MODEL_SPEED_ACTIVE_PROCESSOR_COUNT

mode_file="$(model_speed_mode_file "${snapshot}" "${mode}")"
mkdir -p "${output_root}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
run_root="${output_root%/}/${snapshot}/${mode}/${timestamp}"
generated_config_dir="$(model_speed_tmp_root)/generated-configs/${snapshot}/${mode}"
generated_config_dir="${generated_config_dir}/${timestamp}"
config_path="${generated_config_dir}/${snapshot}-${mode}.properties"
runs_tsv="${run_root}/measured-runs.tsv"
summary_json="${run_root}/summary.json"
environment_txt="${run_root}/environment.txt"

log "Benchmark session root: ${run_root}"
log "Pinned mode definition: ${mode_file}"
log "Materialised config path: ${config_path}"
log "Measured repeats: ${repeat}; same-JVM warm-ups per measured sample: ${warmup}; cool-down runs: ${cooldown}; median JFR: ${capture_jfr}"
if [[ -n "${MODEL_SPEED_CPU_AFFINITY}" ]]; then
  log "CPU affinity: taskset -c ${MODEL_SPEED_CPU_AFFINITY}; JVM ActiveProcessorCount=${MODEL_SPEED_ACTIVE_PROCESSOR_COUNT}"
fi

mkdir -p "${run_root}"
model_speed_materialize_config "${snapshot}" "${mode}" "${config_path}"
model_speed_capture_environment "${environment_txt}" "${snapshot}" "${mode}" "${output_root}" \
  "${config_path}" "${mode_file}"

target_population="$(model_speed_read_config_value "${config_path}" TARGET_POPULATION)"
n_steps="$(model_speed_read_config_value "${config_path}" N_STEPS)"
n_sims="$(model_speed_read_config_value "${config_path}" N_SIMS)"

log "Benchmark config pins TARGET_POPULATION=${target_population}, N_STEPS=${n_steps}, N_SIMS=${n_sims}"
model_speed_require_timing_tools
model_speed_ensure_compiled
model_speed_resolve_classpath >/dev/null
python3 "$(model_speed_python_helper)" manifest \
  --output-dir "${model_speed_repo_root}/target/classes" \
  --manifest-path "${run_root}/compiled-runtime.sha256"

model_speed_write_tsv_header "${runs_tsv}"
for run_index in $(seq 1 "${repeat}"); do
  run_id="$(printf 'run-%03d' "${run_index}")"
  run_dir="${run_root}/runs/${run_id}"
  log "Running measured benchmark ${run_id}/${repeat}."
  model_speed_run_model_once "${config_path}" "${run_dir}"

  wall_clock_seconds="$(cat "${run_dir}/wall_clock_seconds.txt")"
  process_wall_clock_seconds="$(cat "${run_dir}/process_wall_clock_seconds.txt")"
  model_computing_seconds="$(model_speed_extract_model_seconds "${run_dir}/model.stdout.log")"
  primary_metric="$(model_speed_compute_primary_metric "${wall_clock_seconds}" "${target_population}" "${n_steps}" "${n_sims}")"
  ns_per_household_month="$(model_speed_compute_ns_per_household_month \
    "${wall_clock_seconds}" "${target_population}" "${n_steps}" "${n_sims}")"
  output_bytes="$(model_speed_sum_output_bytes "${run_dir}/model-output")"
  max_rss_kb="$(model_speed_extract_time_field "${run_dir}/time.txt" "Maximum resident set size (kbytes)")"
  user_cpu_seconds="$(model_speed_extract_time_field "${run_dir}/time.txt" "User time (seconds)")"
  system_cpu_seconds="$(model_speed_extract_time_field "${run_dir}/time.txt" "System time (seconds)")"
  gc_pause_count="$(model_speed_json_field "${run_dir}/gc-summary.json" "pause_count")"
  gc_pause_time_ms_total="$(model_speed_json_field "${run_dir}/gc-summary.json" "pause_time_ms_total")"

  model_speed_append_tsv_row \
    "${runs_tsv}" \
    "${run_id}" \
    "${wall_clock_seconds}" \
    "${process_wall_clock_seconds}" \
    "${model_computing_seconds}" \
    "${primary_metric}" \
    "${ns_per_household_month}" \
    "${warmup}" \
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
    "${run_dir}/measurement-scope.properties" \
    "${run_dir}/load-observation.txt"
done

# Write the timing summary first so its median run selects the ancillary JFR rerun. It is regenerated
# with median_jfr_captured=true only after that capture succeeds.
python3 "$(model_speed_python_helper)" benchmark-summary \
  --runs-tsv "${runs_tsv}" \
  --output "${summary_json}" \
  --warmup-count "${warmup}" \
  --cooldown-count "${cooldown}" \
  --jfr-captured 0
median_run_id="$(
  python3 - "${summary_json}" <<'PY'
import json
import sys
summary = json.loads(open(sys.argv[1], "r", encoding="utf-8").read())
print(summary["median_run_id"])
PY
)"
log "Median measured run: ${median_run_id}"

median_jfr_file=""
if (( capture_jfr == 1 )); then
  median_jfr_dir="${run_root}/median-jfr"
  median_jfr_file="${median_jfr_dir}/profile.jfr"
  mkdir -p "${median_jfr_dir}"
  log "Re-running median scenario with JFR capture."
  model_speed_run_model_once \
    "${config_path}" \
    "${median_jfr_dir}" \
    "-XX:StartFlightRecording=filename=${median_jfr_file},settings=profile,dumponexit=true"
  python3 "$(model_speed_python_helper)" benchmark-summary \
    --runs-tsv "${runs_tsv}" \
    --output "${summary_json}" \
    --warmup-count "${warmup}" \
    --cooldown-count "${cooldown}" \
    --jfr-captured 1
fi

log "Measured summary written to ${summary_json}"

# Cool-down and population-ladder runs are diagnostics, not repetitions of the measured protocol.
MODEL_SPEED_SAME_JVM_WARMUP_COUNT=0

if (( cooldown > 0 )); then
  for run_index in $(seq 1 "${cooldown}"); do
    run_id="$(printf 'cooldown-%03d' "${run_index}")"
    log "Running cool-down benchmark ${run_id}/${cooldown}."
    model_speed_run_model_once "${config_path}" "${run_root}/cooldown/${run_id}"
  done
fi

if [[ "${mode}" == "core-minimal-10k-s1" && "${MODEL_SPEED_POPULATION_LADDER}" == "1" ]]; then
  ladder_tsv="${run_root}/population-ladder.tsv"
  printf '%s\n' \
    'population	wall_clock_seconds	seconds_per_household_month	output_bytes	max_rss_kb	gc_pause_count	gc_pause_time_ms_total	output_dir	manifest_path' \
    > "${ladder_tsv}"
  for ladder_population in 5000 10000; do
    ladder_config="${generated_config_dir}/${snapshot}-${mode}-ladder-${ladder_population}.properties"
    ladder_run_dir="${run_root}/population-ladder/pop-${ladder_population}"
    log "Running population ladder point TARGET_POPULATION=${ladder_population}."
    model_speed_materialize_config \
      "${snapshot}" \
      "${mode}" \
      "${ladder_config}" \
      --override "TARGET_POPULATION=${ladder_population}"
    model_speed_run_model_once "${ladder_config}" "${ladder_run_dir}"
    ladder_wall="$(cat "${ladder_run_dir}/wall_clock_seconds.txt")"
    ladder_steps="$(model_speed_read_config_value "${ladder_config}" N_STEPS)"
    ladder_sims="$(model_speed_read_config_value "${ladder_config}" N_SIMS)"
    ladder_primary="$(model_speed_compute_primary_metric "${ladder_wall}" "${ladder_population}" "${ladder_steps}" "${ladder_sims}")"
    ladder_output_bytes="$(model_speed_sum_output_bytes "${ladder_run_dir}/model-output")"
    ladder_rss="$(model_speed_extract_time_field "${ladder_run_dir}/time.txt" "Maximum resident set size (kbytes)")"
    ladder_pause_count="$(model_speed_json_field "${ladder_run_dir}/gc-summary.json" "pause_count")"
    ladder_pause_time="$(model_speed_json_field "${ladder_run_dir}/gc-summary.json" "pause_time_ms_total")"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "${ladder_population}" \
      "${ladder_wall}" \
      "${ladder_primary}" \
      "${ladder_output_bytes}" \
      "${ladder_rss}" \
      "${ladder_pause_count}" \
      "${ladder_pause_time}" \
      "${ladder_run_dir}/model-output" \
      "${ladder_run_dir}/model-output.sha256" \
      >> "${ladder_tsv}"
  done
  log "Population ladder written to ${ladder_tsv}"
fi

log "Benchmark complete."
log "Artifacts:"
log "  environment: ${environment_txt}"
log "  runs:        ${runs_tsv}"
log "  summary:     ${summary_json}"
if (( capture_jfr == 1 )); then
  log "  median JFR:  ${median_jfr_file}"
fi
