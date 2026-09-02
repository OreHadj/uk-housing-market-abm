#!/usr/bin/env bash
# Snapshot-local regression harness for model-speed work.
# Author: Max Stoddard

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/model-speed-lib.sh"

MODEL_SPEED_TIMING_PROTOCOL="legacy-process-v0"
MODEL_SPEED_SAME_JVM_WARMUP_COUNT=0

LOG_TAG="SPEED-REG"
LOG_COLOR="\033[1;33m"
model_speed_log_init

usage() {
  cat <<EOF
Usage: $(basename "$0") --snapshot <version> --mode <mode> --contract <exact|tolerance> --baseline-manifest <path> --output-root <dir> [options]

Required arguments:
  --snapshot          Snapshot folder under input-data-versions
  --mode              e2e-default-5k-s1 | core-minimal-10k-s1 | core-minimal-20k-s1
  --contract          exact | tolerance
  --baseline-manifest Exact SHA-256 manifest path or tolerance-spec JSON path
  --output-root       Root directory for regression artifacts

Options:
  --repeat <n>                  Number of exact candidate repeats (default: 1)
  --pin-cpu <cpu-list>          Run Java through taskset -c <cpu-list>
  --active-processor-count <n>  Add -XX:ActiveProcessorCount=<n> to Java

Environment:
  MODEL_SPEED_MAVEN_PROFILES            Optional Maven profiles for compile/classpath resolution
EOF
}

snapshot=""
mode=""
contract=""
baseline_manifest=""
output_root=""
repeat=1
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
    --contract)
      contract="$2"
      shift 2
      ;;
    --baseline-manifest)
      baseline_manifest="$2"
      shift 2
      ;;
    --output-root)
      output_root="$2"
      shift 2
      ;;
    --repeat)
      repeat="$2"
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

if [[ -z "${snapshot}" || -z "${mode}" || -z "${contract}" || -z "${baseline_manifest}" || -z "${output_root}" ]]; then
  usage
  exit 1
fi

if [[ "${contract}" != "exact" && "${contract}" != "tolerance" ]]; then
  log_err "--contract must be exact or tolerance."
  exit 1
fi

if [[ ! -f "${baseline_manifest}" ]]; then
  log_err "Baseline manifest/spec not found: ${baseline_manifest}"
  exit 1
fi
if ! [[ "${repeat}" =~ ^[0-9]+$ ]] || (( repeat < 1 )); then
  log_err "--repeat must be a positive integer."
  exit 1
fi
if [[ "${contract}" != "exact" && "${repeat}" != "1" ]]; then
  log_err "--repeat is currently supported only with --contract exact."
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
MODEL_SPEED_CPU_AFFINITY="${pin_cpu}"
MODEL_SPEED_ACTIVE_PROCESSOR_COUNT="${active_processor_count}"
export MODEL_SPEED_CPU_AFFINITY MODEL_SPEED_ACTIVE_PROCESSOR_COUNT

mode_file="$(model_speed_mode_file "${snapshot}" "${mode}")"
mkdir -p "${output_root}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
run_root="${output_root%/}/${snapshot}/${mode}/${contract}/${timestamp}"
generated_config_dir="$(model_speed_tmp_root)/generated-configs/${snapshot}/${mode}"
generated_config_dir="${generated_config_dir}/${timestamp}"
config_path="${generated_config_dir}/${snapshot}-${mode}.properties"
environment_txt="${run_root}/environment.txt"
candidate_root="${run_root}/candidate"
report_path="${run_root}/regression-report.md"

log "Regression session root: ${run_root}"
log "Pinned mode definition: ${mode_file}"
log "Regression contract: ${contract}"
log "Candidate repeats: ${repeat}"
log "Baseline manifest/spec: ${baseline_manifest}"
if [[ -n "${MODEL_SPEED_CPU_AFFINITY}" ]]; then
  log "CPU affinity: taskset -c ${MODEL_SPEED_CPU_AFFINITY}; JVM ActiveProcessorCount=${MODEL_SPEED_ACTIVE_PROCESSOR_COUNT}"
fi

mkdir -p "${run_root}"
model_speed_capture_environment "${environment_txt}" "${snapshot}" "${mode}" "${output_root}"
model_speed_materialize_config "${snapshot}" "${mode}" "${config_path}"
model_speed_ensure_compiled
model_speed_resolve_classpath >/dev/null

if [[ "${contract}" == "exact" ]]; then
  declare -a candidate_manifests=()
  for run_index in $(seq 1 "${repeat}"); do
    run_id="$(printf 'run-%03d' "${run_index}")"
    candidate_dir="${candidate_root}/${run_id}"
    log "Running exact candidate ${run_id}/${repeat}."
    model_speed_run_model_once "${config_path}" "${candidate_dir}"
    candidate_manifests+=( "${candidate_dir}/model-output.sha256" )
  done
  log "Comparing exact manifests."
  declare -a compare_args=()
  for candidate_manifest in "${candidate_manifests[@]}"; do
    compare_args+=( --candidate-manifest "${candidate_manifest}" )
  done
  python3 "$(model_speed_python_helper)" exact-repeat-compare \
    --baseline-manifest "${baseline_manifest}" \
    --report-path "${report_path}" \
    "${compare_args[@]}"
else
  log "Running tolerance-based comparison."
  candidate_dir="${candidate_root}/run-001"
  log "Running tolerance candidate."
  model_speed_run_model_once "${config_path}" "${candidate_dir}"
  python3 "$(model_speed_python_helper)" tolerance-compare \
    --spec "${baseline_manifest}" \
    --candidate-dir "${candidate_dir}/model-output" \
    --report-path "${report_path}"
fi

log "Regression succeeded."
log "Artifacts:"
log "  environment: ${environment_txt}"
log "  candidate:   ${candidate_root}"
log "  report:      ${report_path}"
