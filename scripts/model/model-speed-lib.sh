#!/usr/bin/env bash
# Shared helpers for snapshot-local model-speed scripts.
# Author: Max Stoddard

set -euo pipefail

model_speed_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
model_speed_repo_root="$(cd "${model_speed_script_dir}/../.." && pwd)"

source "${model_speed_repo_root}/scripts/helpers/log.sh"

# These scripts use bash namerefs ("local -n"), which need bash >= 4.3. Every mainstream Linux ships
# that, but macOS ships bash 3.2 at /bin/bash and will only fail once a nameref is reached, with an
# opaque "local: -n: invalid option". Fail fast with something actionable instead.
model_speed_bash_is_modern() {
  local bin="${1:-}"
  if [[ -z "${bin}" ]]; then
    (( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 3) ))
    return $?
  fi
  "${bin}" -c '(( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 3) ))' 2>/dev/null
}

model_speed_require_modern_bash() {
  if model_speed_bash_is_modern; then
    return 0
  fi
  log_err "The model-speed harness requires bash >= 4.3 (it uses namerefs); this is bash ${BASH_VERSION}."
  local candidate
  for candidate in "$(command -v bash 2>/dev/null || true)" /opt/homebrew/bin/bash /usr/local/bin/bash; do
    [[ -n "${candidate}" && -x "${candidate}" ]] || continue
    if model_speed_bash_is_modern "${candidate}"; then
      log_err "Re-run through a newer bash, e.g.: ${candidate} $0 <args...>"
      return 1
    fi
  done
  log_err "No bash >= 4.3 was found on PATH. On macOS: brew install bash"
  return 1
}

model_speed_require_modern_bash || exit 1

MODEL_SPEED_JAVA_OPTS="${MODEL_SPEED_JAVA_OPTS:--Xms1g -Xmx4g}"
MODEL_SPEED_POPULATION_LADDER="${MODEL_SPEED_POPULATION_LADDER:-0}"
MODEL_SPEED_CPU_AFFINITY="${MODEL_SPEED_CPU_AFFINITY:-}"
MODEL_SPEED_ACTIVE_PROCESSOR_COUNT="${MODEL_SPEED_ACTIVE_PROCESSOR_COUNT:-}"
MODEL_SPEED_MAVEN_PROFILES="${MODEL_SPEED_MAVEN_PROFILES:-}"
MODEL_SPEED_MAVEN_BIN="${MODEL_SPEED_MAVEN_BIN:-${model_speed_repo_root}/mvnw}"
MODEL_SPEED_SKIP_COMPILE="${MODEL_SPEED_SKIP_COMPILE:-0}"
MODEL_SPEED_SAME_JVM_WARMUP_COUNT="${MODEL_SPEED_SAME_JVM_WARMUP_COUNT:-0}"
MODEL_SPEED_TIMING_PROTOCOL="${MODEL_SPEED_TIMING_PROTOCOL:-legacy-process-v0}"
MODEL_SPEED_TIMING_TOOLS_CHECKED=0

# Per-run resource stats need GNU time's -v flag. That is /usr/bin/time on Linux, but macOS ships
# BSD time (no -v) at that path and SIP prevents replacing it, so on macOS install GNU time
# (`brew install gnu-time`) and it is picked up here as `gtime`. Override explicitly if needed.
MODEL_SPEED_TIME_BIN="${MODEL_SPEED_TIME_BIN:-$(command -v gtime 2>/dev/null || printf '/usr/bin/time')}"

# Wall-clock timing reads nanosecond epochs with `date +%s%N`. GNU date supports %N; older BSD/macOS
# date does not and silently emits a literal "N", which awk then parses as whole seconds only - a
# wrong measurement rather than an error. So pick a date that demonstrably supports %N. Recent macOS
# date does; where it does not, GNU coreutils installs one as `gdate` and it is picked up here.
model_speed_date_supports_nanos() {
  local bin="$1"
  command -v "${bin}" >/dev/null 2>&1 || return 1
  local probe
  probe="$("${bin}" +%s%N 2>/dev/null || true)"
  [[ "${probe}" =~ ^[0-9]{19,}$ ]]
}

model_speed_default_date_bin() {
  local candidate
  for candidate in date gdate; do
    if model_speed_date_supports_nanos "${candidate}"; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  # Fall back to the Linux-standard name so the preflight check reports the real problem.
  printf 'date\n'
}

MODEL_SPEED_DATE_BIN="${MODEL_SPEED_DATE_BIN:-$(model_speed_default_date_bin)}"

model_speed_log_init() {
  LOG_TAG="${LOG_TAG:-MODEL-SPEED}"
  LOG_COLOR="${LOG_COLOR:-\033[1;35m}"
  log_init
}

model_speed_mode_file() {
  local snapshot="$1"
  local mode="$2"
  local mode_file="${model_speed_repo_root}/scripts/model/configs/${snapshot}-${mode}.properties"
  if [[ ! -f "${mode_file}" ]]; then
    log_err "Unsupported snapshot/mode combination: snapshot=${snapshot}, mode=${mode}"
    return 1
  fi
  printf '%s\n' "${mode_file}"
}

model_speed_python_helper() {
  printf '%s\n' "${model_speed_repo_root}/scripts/model/model_speed.py"
}

model_speed_sha256_file() {
  local path="$1"
  python3 - "${path}" <<'PY'
import hashlib
import sys

digest = hashlib.sha256()
with open(sys.argv[1], "rb") as handle:
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        digest.update(chunk)
print(digest.hexdigest())
PY
}

model_speed_tmp_root() {
  printf '%s\n' "${model_speed_repo_root}/tmp/model-speed"
}

model_speed_maven_profile_args() {
  local -n out_ref="$1"
  out_ref=()
  if [[ -n "${MODEL_SPEED_MAVEN_PROFILES}" ]]; then
    out_ref+=( "-P${MODEL_SPEED_MAVEN_PROFILES}" )
  fi
}

model_speed_check_time_bin() {
  if ! "${MODEL_SPEED_TIME_BIN}" -v true >/dev/null 2>&1; then
    log_err "'${MODEL_SPEED_TIME_BIN}' does not support GNU time's -v flag, which is required for"
    log_err "per-run memory and CPU statistics."
    if [[ "$(uname -s)" == "Darwin" ]]; then
      log_err "On macOS: brew install gnu-time   (installs it as 'gtime', picked up automatically)"
    fi
    log_err "Or set MODEL_SPEED_TIME_BIN to a GNU time binary."
    return 1
  fi
}

model_speed_check_date_bin() {
  if ! model_speed_date_supports_nanos "${MODEL_SPEED_DATE_BIN}"; then
    log_err "'${MODEL_SPEED_DATE_BIN}' does not support nanosecond timestamps ('date +%s%N'), which the"
    log_err "wall-clock measurement depends on."
    if [[ "$(uname -s)" == "Darwin" ]]; then
      log_err "On macOS: brew install coreutils   (installs it as 'gdate', picked up automatically)"
    fi
    log_err "Or set MODEL_SPEED_DATE_BIN to a date binary that supports %N."
    return 1
  fi
}

model_speed_require_timing_tools() {
  if [[ "${MODEL_SPEED_TIMING_TOOLS_CHECKED}" == "1" ]]; then
    return 0
  fi
  model_speed_check_time_bin || return 1
  model_speed_check_date_bin || return 1
  MODEL_SPEED_TIMING_TOOLS_CHECKED=1
}

# Logical CPU count for the environment record. GNU coreutils' nproc is the Linux answer; macOS has
# no nproc unless coreutils is installed, so fall back to sysctl/getconf.
model_speed_logical_cpu_count() {
  local count=""
  if command -v nproc >/dev/null 2>&1; then
    count="$(nproc 2>/dev/null || true)"
  elif command -v gnproc >/dev/null 2>&1; then
    count="$(gnproc 2>/dev/null || true)"
  elif command -v sysctl >/dev/null 2>&1; then
    count="$(sysctl -n hw.logicalcpu 2>/dev/null || true)"
  fi
  if [[ -z "${count}" ]] && command -v getconf >/dev/null 2>&1; then
    count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
  fi
  printf '%s\n' "${count:-unknown}"
}

model_speed_ensure_compiled() {
  if [[ "${MODEL_SPEED_SKIP_COMPILE}" == "1" ]]; then
    if [[ ! -f "${model_speed_repo_root}/target/classes/housing/Model.class" ]]; then
      log_err "MODEL_SPEED_SKIP_COMPILE=1 but target/classes/housing/Model.class is missing."
      return 1
    fi
    log "Using the existing compiled classes (MODEL_SPEED_SKIP_COMPILE=1)."
    return 0
  fi
  log "Compiling Java sources for snapshot-local model-speed harness."
  local -a profile_args=()
  model_speed_maven_profile_args profile_args
  (
    cd "${model_speed_repo_root}"
    "${MODEL_SPEED_MAVEN_BIN}" -q "${profile_args[@]}" -DskipTests clean compile
  )
}

model_speed_resolve_classpath() {
  if [[ -n "${MODEL_SPEED_CLASSPATH:-}" ]]; then
    printf '%s\n' "${MODEL_SPEED_CLASSPATH}"
    return 0
  fi
  local classpath
  local -a profile_args=()
  model_speed_maven_profile_args profile_args
  classpath="$(
    cd "${model_speed_repo_root}"
    "${MODEL_SPEED_MAVEN_BIN}" -q "${profile_args[@]}" -Dexec.classpathScope=runtime -Dexec.executable=echo -Dexec.args='%classpath' exec:exec | tail -n 1
  )"
  if [[ -z "${classpath}" ]]; then
    log_err "Failed to resolve runtime classpath."
    return 1
  fi
  MODEL_SPEED_CLASSPATH="${classpath}"
  export MODEL_SPEED_CLASSPATH
  printf '%s\n' "${classpath}"
}

model_speed_materialize_config() {
  local snapshot="$1"
  local mode="$2"
  local output_path="$3"
  shift 3
  local mode_file
  mode_file="$(model_speed_mode_file "${snapshot}" "${mode}")"
  mkdir -p "$(dirname "${output_path}")"
  python3 "$(model_speed_python_helper)" materialize-config \
    --snapshot "${snapshot}" \
    --mode-file "${mode_file}" \
    --output "${output_path}" \
    "$@"
}

model_speed_read_config_value() {
  local config_path="$1"
  local key="$2"
  awk -F'=' -v wanted="${key}" '
    $1 ~ "^[[:space:]]*" wanted "[[:space:]]*$" {
      value = $2
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      print value
      exit
    }
  ' "${config_path}"
}

model_speed_json_field() {
  local json_path="$1"
  local field_path="$2"
  python3 - "${json_path}" "${field_path}" <<'PY'
import json
import sys

data = json.loads(open(sys.argv[1], "r", encoding="utf-8").read())
value = data
for key in sys.argv[2].split("."):
    value = value[key]
if isinstance(value, float):
    print(f"{value:.12f}".rstrip("0").rstrip("."))
else:
    print(value)
PY
}

# Total bytes of regular files under a directory. This used `find -type f -printf '%s\n'`, but
# -printf is a GNU find extension with no BSD/macOS equivalent. Python gives the same st_size sum on
# every platform: os.walk does not descend into symlinked directories and lstat+S_ISREG excludes
# symlinks, which is exactly what `find -type f` (without -L) matched.
model_speed_sum_output_bytes() {
  local output_dir="$1"
  python3 - "${output_dir}" <<'PY'
import os
import stat
import sys

root = sys.argv[1]
if not os.path.isdir(root):
    raise SystemExit(f"model_speed_sum_output_bytes: not a directory: {root}")


def _raise(error):
    # os.walk swallows directory errors by default. An unreadable subtree would then be
    # silently omitted from the total, i.e. a wrong output_bytes rather than a failure -
    # so surface it, matching the fail-fast behaviour of the find pipeline this replaced.
    raise error


total = 0
for dir_path, _dir_names, file_names in os.walk(root, onerror=_raise):
    for file_name in file_names:
        info = os.lstat(os.path.join(dir_path, file_name))
        if stat.S_ISREG(info.st_mode):
            total += info.st_size
print(total)
PY
}

model_speed_compute_primary_metric() {
  local wall_clock_seconds="$1"
  local target_population="$2"
  local n_steps="$3"
  local n_sims="$4"
  awk -v wall="${wall_clock_seconds}" -v pop="${target_population}" -v steps="${n_steps}" -v sims="${n_sims}" \
    'BEGIN { printf "%.12f", wall / (pop * steps * sims) }'
}

model_speed_compute_ns_per_household_month() {
  local wall_clock_seconds="$1"
  local target_population="$2"
  local n_steps="$3"
  local n_sims="$4"
  awk -v wall="${wall_clock_seconds}" -v pop="${target_population}" -v steps="${n_steps}" -v sims="${n_sims}" \
    'BEGIN { printf "%.9f", (wall * 1000000000) / (pop * steps * sims) }'
}

model_speed_extract_model_seconds() {
  local stdout_log="$1"
  awk '/Computing time:/ {value = $3} END { if (value == "") exit 1; print value }' "${stdout_log}"
}

model_speed_extract_benchmark_measured_seconds() {
  local stdout_log="$1"
  awk -F'=' '
    $1 == "BENCHMARK_MEASURED_WALL_SECONDS" {
      value = $2
      count += 1
    }
    END {
      if (count != 1 || value !~ /^([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$/ || value + 0 <= 0) exit 1
      print value
    }
  ' "${stdout_log}"
}

model_speed_verify_benchmark_protocol() {
  local stdout_log="$1"
  local expected_warmup_count="$2"
  python3 - "${stdout_log}" "${expected_warmup_count}" <<'PY'
import sys

path = sys.argv[1]
expected_warmups = int(sys.argv[2])
lines = [line.strip() for line in open(path, "r", encoding="utf-8").read().splitlines()]

metadata_lines = [line for line in lines if line.startswith("BENCHMARK_METADATA ")]
if len(metadata_lines) != 1:
    raise SystemExit(
        f"expected exactly one BENCHMARK_METADATA line, found {len(metadata_lines)}"
    )
fields = {}
for token in metadata_lines[0].split()[1:]:
    key, separator, value = token.partition("=")
    if not separator or not key or not value or key in fields:
        raise SystemExit(f"malformed BENCHMARK_METADATA token: {token!r}")
    fields[key] = value
if fields.get("sameJvmWarmupRuns") != str(expected_warmups):
    raise SystemExit(
        "BENCHMARK_METADATA sameJvmWarmupRuns="
        f"{fields.get('sameJvmWarmupRuns')!r}; expected {expected_warmups}"
    )

actual_phases = [line for line in lines if line.startswith("BENCHMARK_PHASE ")]
expected_phases = [
    f"BENCHMARK_PHASE phase=warmup index={index} count={expected_warmups}"
    for index in range(1, expected_warmups + 1)
]
expected_phases.append("BENCHMARK_PHASE phase=measured index=1 count=1")
if actual_phases != expected_phases:
    raise SystemExit(
        f"BENCHMARK_PHASE sequence mismatch: expected {expected_phases!r}, "
        f"found {actual_phases!r}"
    )
PY
}

model_speed_verify_legacy_protocol() {
  local stdout_log="$1"
  awk '
    /^BENCHMARK_PHASE / || /^BENCHMARK_METADATA / || /^BENCHMARK_MEASURED_WALL_SECONDS=/ {
      print "unexpected benchmark marker in legacy timing mode: " $0 > "/dev/stderr"
      found = 1
    }
    END { exit found ? 1 : 0 }
  ' "${stdout_log}"
}

model_speed_reject_reserved_benchmark_options() {
  local option_source
  for option_source in "$@"; do
    if [[ "${option_source}" == *"-Dhousing.benchmark.sameJvmWarmupRuns"* \
          || "${option_source}" == *"-Dhousing.benchmark.warmupOutputRoot"* ]]; then
      log_err "Do not set housing.benchmark.sameJvmWarmupRuns or warmupOutputRoot in JVM options."
      log_err "The selected model-speed timing protocol owns and verifies those properties."
      return 1
    fi
  done
}

model_speed_extract_time_field() {
  local time_file="$1"
  local label="$2"
  awk -F': *' -v wanted="${label}" '
    {
      field = $1
      value = $2
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", field)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      if (field == wanted) {
        print value
        exit
      }
    }
  ' "${time_file}"
}

model_speed_capture_environment() {
  local output_path="$1"
  local snapshot="$2"
  local mode="$3"
  local output_root="$4"
  local config_path="${5:-}"
  local mode_file="${6:-}"
  local git_status=""
  git_status="$(git -C "${model_speed_repo_root}" status --porcelain --untracked-files=all 2>/dev/null || true)"
  mkdir -p "$(dirname "${output_path}")"
  {
    printf 'date_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'repo_root=%s\n' "${model_speed_repo_root}"
    # Which build was measured. Attributing a result to the wrong commit is easy and expensive,
    # so record it alongside the numbers rather than relying on shell history. git_dirty matters
    # as much as the hash: with uncommitted changes the hash does not describe what actually ran.
    printf 'git_commit=%s\n' "$(git -C "${model_speed_repo_root}" rev-parse HEAD 2>/dev/null || printf 'unknown')"
    printf 'git_tree=%s\n' "$(git -C "${model_speed_repo_root}" rev-parse 'HEAD^{tree}' 2>/dev/null || printf 'unknown')"
    printf 'git_branch=%s\n' "$(git -C "${model_speed_repo_root}" rev-parse --abbrev-ref HEAD 2>/dev/null || printf 'unknown')"
    if [[ -z "${git_status}" ]]; then
      printf 'git_dirty=no\n'
    else
      printf 'git_dirty=YES\n'
    fi
    printf 'snapshot=%s\n' "${snapshot}"
    printf 'mode=%s\n' "${mode}"
    printf 'java_opts=%s\n' "${MODEL_SPEED_JAVA_OPTS}"
    printf 'time_bin=%s\n' "${MODEL_SPEED_TIME_BIN}"
    printf 'date_bin=%s\n' "${MODEL_SPEED_DATE_BIN}"
    printf 'maven_bin=%s\n' "${MODEL_SPEED_MAVEN_BIN}"
    printf 'maven_profiles=%s\n' "${MODEL_SPEED_MAVEN_PROFILES:-none}"
    printf 'skip_compile=%s\n' "${MODEL_SPEED_SKIP_COMPILE}"
    printf 'timing_protocol=%s\n' "${MODEL_SPEED_TIMING_PROTOCOL}"
    printf 'same_jvm_warmup_count=%s\n' "${MODEL_SPEED_SAME_JVM_WARMUP_COUNT}"
    printf 'cpu_affinity=%s\n' "${MODEL_SPEED_CPU_AFFINITY:-none}"
    printf 'active_processor_count=%s\n' "${MODEL_SPEED_ACTIVE_PROCESSOR_COUNT:-default}"
    printf 'output_root=%s\n' "${output_root}"
    printf 'tmp_root=%s\n' "$(model_speed_tmp_root)"
    if [[ -n "${config_path}" && -f "${config_path}" ]]; then
      printf 'resolved_config_sha256=%s\n' "$(model_speed_sha256_file "${config_path}")"
    fi
    if [[ -n "${mode_file}" && -f "${mode_file}" ]]; then
      printf 'mode_file_sha256=%s\n' "$(model_speed_sha256_file "${mode_file}")"
    fi
    printf 'benchmark_script_sha256=%s\n' "$(model_speed_sha256_file "${BASH_SOURCE[1]}")"
    printf 'benchmark_lib_sha256=%s\n' "$(model_speed_sha256_file "${BASH_SOURCE[0]}")"
    printf 'benchmark_python_sha256=%s\n' "$(model_speed_sha256_file "$(model_speed_python_helper)")"
    printf '\n[git status --porcelain --untracked-files=all]\n'
    printf '%s\n' "${git_status:-clean}"
    printf '\n[uname -a]\n'
    uname -a
    printf '\n[uptime]\n'
    uptime
    printf '\n[nproc]\n'
    model_speed_logical_cpu_count
    if command -v taskset >/dev/null 2>&1; then
      printf '\n[taskset -pc $$]\n'
      taskset -pc $$ || true
    fi
    printf '\n[java -version]\n'
    java -version 2>&1
    printf '\n[mvn -version]\n'
    "${MODEL_SPEED_MAVEN_BIN}" -version 2>&1
    if [[ "$(uname -s)" == "Darwin" ]]; then
      printf '\n[sw_vers]\n'
      sw_vers 2>&1 || true
      printf '\n[system_profiler SPHardwareDataType]\n'
      (system_profiler SPHardwareDataType 2>&1 | awk '
        /Model Name:|Model Identifier:|Model Number:|Chip:|Total Number of Cores:|Memory:/
      ') || true
      printf '\n[pmset -g batt]\n'
      pmset -g batt 2>&1 || true
      printf '\n[pmset -g custom]\n'
      pmset -g custom 2>&1 || true
      printf '\n[vm_stat]\n'
      vm_stat 2>&1 || true
      if command -v memory_pressure >/dev/null 2>&1; then
        printf '\n[memory_pressure -Q]\n'
        memory_pressure -Q 2>&1 || true
      fi
    fi
    printf '\n[top processes by CPU]\n'
    (ps -Ao pid=,%cpu=,%mem=,etime=,comm= -r 2>&1 | sed -n '1,25p') || true
    printf '\n[df -h]\n'
    df -h "${output_root}"
  } > "${output_path}"
}

model_speed_write_tsv_header() {
  local tsv_path="$1"
  printf '%s\n' \
    'run_id	wall_clock_seconds	process_wall_clock_seconds	model_computing_seconds	seconds_per_household_month	ns_per_household_month	same_jvm_warmup_count	output_bytes	max_rss_kb	user_cpu_seconds	system_cpu_seconds	gc_pause_count	gc_pause_time_ms_total	config_path	output_dir	stdout_log	time_file	manifest_path	measurement_scope_path	load_observation_path' \
    > "${tsv_path}"
}

model_speed_append_tsv_row() {
  local tsv_path="$1"
  shift
  if (( $# == 0 )); then
    printf '\n' >> "${tsv_path}"
    return 0
  fi
  printf '%s' "$1" >> "${tsv_path}"
  shift
  printf '\t%s' "$@" >> "${tsv_path}"
  printf '\n' >> "${tsv_path}"
}

model_speed_build_java_command() {
  local -n out_ref="$1"
  local config_path="$2"
  local output_dir="$3"
  shift 3
  local -a extra_java_flags=( "$@" )
  local -a cmd=(java)
  if [[ -n "${MODEL_SPEED_JAVA_OPTS}" ]]; then
    local -a default_java_flags=()
    read -r -a default_java_flags <<< "${MODEL_SPEED_JAVA_OPTS}"
    cmd+=( "${default_java_flags[@]}" )
  fi
  if [[ -n "${MODEL_SPEED_ACTIVE_PROCESSOR_COUNT}" ]]; then
    cmd+=( "-XX:ActiveProcessorCount=${MODEL_SPEED_ACTIVE_PROCESSOR_COUNT}" )
  fi
  cmd+=( -Xlog:gc*:file="${output_dir%/*}/gc.log":time,level,tags )
  if (( ${#extra_java_flags[@]} > 0 )); then
    cmd+=( "${extra_java_flags[@]}" )
  fi
  cmd+=( -cp "${MODEL_SPEED_CLASSPATH}" housing.Model -configFile "${config_path}" -outputFolder "${output_dir}" -dev )
  out_ref=( "${cmd[@]}" )
}

model_speed_run_model_once() {
  local config_path="$1"
  local run_dir="$2"
  shift 2
  local -a extra_java_flags=( "$@" )

  local output_dir="${run_dir}/model-output"
  local stdout_log="${run_dir}/model.stdout.log"
  local stderr_log="${run_dir}/model.stderr.log"
  local time_file="${run_dir}/time.txt"
  local gc_summary="${run_dir}/gc-summary.json"
  local manifest_path="${run_dir}/model-output.sha256"
  local wall_clock_file="${run_dir}/wall_clock_seconds.txt"
  local process_wall_clock_file="${run_dir}/process_wall_clock_seconds.txt"
  local command_file="${run_dir}/command.txt"
  local measurement_scope_file="${run_dir}/measurement-scope.properties"
  local load_observation_file="${run_dir}/load-observation.txt"
  local same_jvm_warmup_count="${MODEL_SPEED_SAME_JVM_WARMUP_COUNT:-0}"
  local measured_phase_timing=0

  if ! [[ "${same_jvm_warmup_count}" =~ ^[0-9]+$ ]]; then
    log_err "MODEL_SPEED_SAME_JVM_WARMUP_COUNT must be a non-negative integer."
    return 1
  fi
  model_speed_reject_reserved_benchmark_options \
    "${MODEL_SPEED_JAVA_OPTS}" \
    "${JAVA_TOOL_OPTIONS:-}" \
    "${_JAVA_OPTIONS:-}" \
    "${JDK_JAVA_OPTIONS:-}" \
    "${extra_java_flags[@]}" || return 1
  case "${MODEL_SPEED_TIMING_PROTOCOL}" in
    same-jvm-measured-phase-v1)
      measured_phase_timing=1
      # Setting the property explicitly selects Model's benchmark path even when the count is zero.
      extra_java_flags+=(
        "-Dhousing.benchmark.sameJvmWarmupRuns=${same_jvm_warmup_count}"
      )
      ;;
    legacy-process-v0)
      if (( same_jvm_warmup_count != 0 )); then
        log_err "legacy-process-v0 does not support MODEL_SPEED_SAME_JVM_WARMUP_COUNT>0."
        return 1
      fi
      ;;
    *)
      log_err "Unknown MODEL_SPEED_TIMING_PROTOCOL '${MODEL_SPEED_TIMING_PROTOCOL}'."
      return 1
      ;;
  esac
  if (( measured_phase_timing == 1 && same_jvm_warmup_count > 0 )); then
    extra_java_flags+=(
      "-Dhousing.benchmark.warmupOutputRoot=${run_dir}/same-jvm-warmup"
    )
  fi
  model_speed_require_timing_tools || return 1
  mkdir -p "${run_dir}"

  local -a java_cmd=()
  model_speed_build_java_command java_cmd "${config_path}" "${output_dir}" "${extra_java_flags[@]}"
  local -a run_cmd=( "${java_cmd[@]}" )
  if [[ -n "${MODEL_SPEED_CPU_AFFINITY}" ]]; then
    if ! command -v taskset >/dev/null 2>&1; then
      log_err "MODEL_SPEED_CPU_AFFINITY is set but taskset is not available."
      return 1
    fi
    run_cmd=( taskset -c "${MODEL_SPEED_CPU_AFFINITY}" "${java_cmd[@]}" )
  fi
  printf '%q ' "${run_cmd[@]}" > "${command_file}"
  printf '\n' >> "${command_file}"

  local start_ns
  local end_ns
  local wall_clock_seconds
  local process_wall_clock_seconds
  {
    printf 'before_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'before_uptime='
    uptime
  } > "${load_observation_file}"
  start_ns="$("${MODEL_SPEED_DATE_BIN}" +%s%N)"
  (
    cd "${model_speed_repo_root}"
    LC_ALL=C "${MODEL_SPEED_TIME_BIN}" -v -o "${time_file}" "${run_cmd[@]}" > "${stdout_log}" 2> "${stderr_log}"
  )
  end_ns="$("${MODEL_SPEED_DATE_BIN}" +%s%N)"
  process_wall_clock_seconds="$(awk -v start="${start_ns}" -v end="${end_ns}" 'BEGIN { printf "%.6f", (end - start) / 1000000000 }')"
  printf '%s\n' "${process_wall_clock_seconds}" > "${process_wall_clock_file}"
  if (( measured_phase_timing == 1 )); then
    if ! wall_clock_seconds="$(model_speed_extract_benchmark_measured_seconds "${stdout_log}")"; then
      log_err "Expected exactly one valid BENCHMARK_MEASURED_WALL_SECONDS line in ${stdout_log}."
      return 1
    fi
    if ! model_speed_verify_benchmark_protocol "${stdout_log}" "${same_jvm_warmup_count}"; then
      log_err "Model output does not prove the requested benchmark protocol: ${stdout_log}."
      return 1
    fi
  else
    if ! model_speed_verify_legacy_protocol "${stdout_log}"; then
      log_err "Legacy timing mode refuses Model benchmark markers: ${stdout_log}."
      return 1
    fi
    wall_clock_seconds="${process_wall_clock_seconds}"
  fi
  printf '%s\n' "${wall_clock_seconds}" > "${wall_clock_file}"
  {
    printf 'after_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'after_uptime='
    uptime
  } >> "${load_observation_file}"

  python3 "$(model_speed_python_helper)" gc-summary --gc-log "${run_dir}/gc.log" --output "${gc_summary}"
  python3 "$(model_speed_python_helper)" manifest --output-dir "${output_dir}" --manifest-path "${manifest_path}"

  local warmup_index
  local warmup_id
  local warmup_manifest
  for (( warmup_index = 1; warmup_index <= same_jvm_warmup_count; warmup_index += 1 )); do
    warmup_id="$(printf 'warmup-%03d' "${warmup_index}")"
    warmup_manifest="${run_dir}/same-jvm-warmup/${warmup_id}/model-output.sha256"
    python3 "$(model_speed_python_helper)" manifest \
      --output-dir "${run_dir}/same-jvm-warmup/${warmup_id}/model-output" \
      --manifest-path "${warmup_manifest}"
    if ! cmp -s "${manifest_path}" "${warmup_manifest}"; then
      log_err "Same-JVM warm-up output differs from measured output: ${warmup_manifest}"
      return 1
    fi
  done

  if (( measured_phase_timing == 1 )); then
    {
      printf 'wall_clock_seconds_scope=measured_model_phase_only_excludes_warmup_and_jvm_startup\n'
      printf 'model_computing_seconds_scope=measured_model_phase_only_excludes_warmup_and_jvm_startup\n'
      printf 'process_wall_clock_seconds_scope=whole_jvm_process_includes_startup_and_same_jvm_warmup\n'
      printf 'user_cpu_seconds_scope=whole_jvm_process_includes_startup_and_same_jvm_warmup\n'
      printf 'system_cpu_seconds_scope=whole_jvm_process_includes_startup_and_same_jvm_warmup\n'
      printf 'max_rss_kb_scope=whole_jvm_process_peak_includes_startup_and_same_jvm_warmup\n'
      printf 'gc_pause_count_scope=whole_jvm_process_includes_startup_and_same_jvm_warmup\n'
      printf 'gc_pause_time_ms_total_scope=whole_jvm_process_includes_startup_and_same_jvm_warmup\n'
      printf 'denominator_scope=measured_config_TARGET_POPULATION_x_N_STEPS_x_N_SIMS_only\n'
      printf 'same_jvm_warmup_count=%s\n' "${same_jvm_warmup_count}"
    } > "${measurement_scope_file}"
  else
    {
      printf 'wall_clock_seconds_scope=whole_jvm_process_includes_startup\n'
      printf 'model_computing_seconds_scope=whole_model_invocation_excludes_jvm_startup\n'
      printf 'process_wall_clock_seconds_scope=whole_jvm_process_includes_startup\n'
      printf 'same_jvm_warmup_count=0\n'
    } > "${measurement_scope_file}"
  fi
}
