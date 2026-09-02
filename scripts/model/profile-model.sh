#!/usr/bin/env bash
# Snapshot-local profiling harness for the Java housing model.
# Author: Max Stoddard

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/model-speed-lib.sh"

# Standalone JFR and perf profiles share the ordinary whole-process model invocation.
MODEL_SPEED_TIMING_PROTOCOL="legacy-process-v0"
MODEL_SPEED_SAME_JVM_WARMUP_COUNT=0

LOG_TAG="SPEED-PROF"
LOG_COLOR="\033[1;32m"
model_speed_log_init

usage() {
  cat <<EOF
Usage: $(basename "$0") --snapshot <version> --mode <mode> --profiler <jfr|perf> --output-root <dir>

Required arguments:
  --snapshot     Snapshot folder under input-data-versions
  --mode         e2e-default-5k-s1 | core-minimal-10k-s1 | core-minimal-20k-s1
  --profiler     jfr | perf
  --output-root  Root directory for profile artifacts

Environment:
  MODEL_SPEED_MAVEN_PROFILES          Optional Maven profiles for compile/classpath resolution
  MODEL_SPEED_CPU_AFFINITY            CPU list used by taskset
  MODEL_SPEED_ACTIVE_PROCESSOR_COUNT  JVM active processor count
EOF
}

snapshot=""
mode=""
profiler=""
output_root=""

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
    --profiler)
      profiler="$2"
      shift 2
      ;;
    --output-root)
      output_root="$2"
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

if [[ -z "${snapshot}" || -z "${mode}" || -z "${profiler}" || -z "${output_root}" ]]; then
  usage
  exit 1
fi

if [[ "${profiler}" != "jfr" && "${profiler}" != "perf" ]]; then
  log_err "--profiler must be jfr or perf."
  exit 1
fi

mode_file="$(model_speed_mode_file "${snapshot}" "${mode}")"
mkdir -p "${output_root}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
run_root="${output_root%/}/${snapshot}/${mode}/${profiler}/${timestamp}"
generated_config_dir="$(model_speed_tmp_root)/generated-configs/${snapshot}/${mode}"
generated_config_dir="${generated_config_dir}/${timestamp}"
config_path="${generated_config_dir}/${snapshot}-${mode}.properties"
environment_txt="${run_root}/environment.txt"

log "Profile session root: ${run_root}"
log "Pinned mode definition: ${mode_file}"
log "Profiler: ${profiler}"

mkdir -p "${run_root}"
model_speed_capture_environment "${environment_txt}" "${snapshot}" "${mode}" "${output_root}"
model_speed_materialize_config "${snapshot}" "${mode}" "${config_path}"
model_speed_ensure_compiled
model_speed_resolve_classpath >/dev/null
model_speed_require_timing_tools

if [[ "${profiler}" == "jfr" ]]; then
  jfr_dir="${run_root}/jfr-run"
  jfr_file="${jfr_dir}/profile.jfr"
  mkdir -p "${jfr_dir}"
  log "Running JFR profile."
  model_speed_run_model_once \
    "${config_path}" \
    "${jfr_dir}" \
    "-XX:StartFlightRecording=filename=${jfr_file},settings=profile,dumponexit=true"
  log "JFR profile complete."
  log "Artifacts:"
  log "  environment: ${environment_txt}"
  log "  profile:     ${jfr_file}"
  log "  output:      ${jfr_dir}/model-output"
  exit 0
fi

perf_dir="${run_root}/perf-run"
perf_data="${perf_dir}/perf.data"
perf_report="${perf_dir}/perf-report.txt"
mkdir -p "${perf_dir}"

local_output_dir="${perf_dir}/model-output"
local_stdout_log="${perf_dir}/model.stdout.log"
local_stderr_log="${perf_dir}/model.stderr.log"
local_time_file="${perf_dir}/time.txt"
local_gc_summary="${perf_dir}/gc-summary.json"
local_manifest="${perf_dir}/model-output.sha256"
local_command_file="${perf_dir}/command.txt"

declare -a java_cmd=()
model_speed_reject_reserved_benchmark_options \
  "${MODEL_SPEED_JAVA_OPTS}" \
  "${JAVA_TOOL_OPTIONS:-}" \
  "${_JAVA_OPTIONS:-}" \
  "${JDK_JAVA_OPTIONS:-}"
model_speed_build_java_command java_cmd "${config_path}" "${local_output_dir}"
printf '%q ' perf record --call-graph dwarf -o "${perf_data}" -- "${java_cmd[@]}" > "${local_command_file}"
printf '\n' >> "${local_command_file}"

log "Running perf profile."
(
  cd "${model_speed_repo_root}"
  LC_ALL=C "${MODEL_SPEED_TIME_BIN}" -v -o "${local_time_file}" \
    perf record --call-graph dwarf -o "${perf_data}" -- "${java_cmd[@]}" \
    > "${local_stdout_log}" 2> "${local_stderr_log}"
)
if ! model_speed_verify_legacy_protocol "${local_stdout_log}"; then
  log_err "Legacy perf profile refuses Model benchmark markers: ${local_stdout_log}."
  exit 1
fi

python3 "$(model_speed_python_helper)" gc-summary --gc-log "${perf_dir}/gc.log" --output "${local_gc_summary}"
python3 "$(model_speed_python_helper)" manifest --output-dir "${local_output_dir}" --manifest-path "${local_manifest}"
perf report --stdio -i "${perf_data}" > "${perf_report}" || true

log "Perf profile complete."
log "Artifacts:"
log "  environment: ${environment_txt}"
log "  perf data:   ${perf_data}"
log "  perf report: ${perf_report}"
log "  output:      ${local_output_dir}"
