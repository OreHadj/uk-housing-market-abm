#!/usr/bin/env python3
"""Run paired philox-household FP64/Qq traces for the precision decorrelation gate.

This is deliberately a diagnostic driver, not a validation scorer. It records the underlying
Mersenne word position and semantic RNG-request traces at each model phase, then compares paired
arms with identical seed IDs. The Q arm uses the explicitly reported gate-probe-v1-no-age field set.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
import statistics
import subprocess
import sys
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.python.helpers.common.abm_policy_sweep import (  # noqa: E402
    build_snapshot_local_config_text,
    ensure_project_compiled,
    resolve_maven_bin,
)


PHASE_ORDER = {
    "DEMOGRAPHICS": 0,
    "CONSTRUCTION": 1,
    "HOUSEHOLD_LOOP": 2,
    "SALE_CLEARING": 3,
    "RENT_CLEARING": 4,
}
TRACE_NAME = "precision-gate-trace-run001.csv"
WRITES_NAME = "precision-writes-run001.csv"
MODEL_CONTROL_ENV = (
    "MAVEN_OPTS",
    "MAVEN_ARGS",
    "JAVA_TOOL_OPTIONS",
    "_JAVA_OPTIONS",
    "JDK_JAVA_OPTIONS",
)
RECORDING_OVERRIDES = {
    "recordTransactions": "false",
    "recordNBidUpFrequency": "false",
    "recordCoreIndicators": "false",
    "recordQualityBandPrice": "false",
    "recordHouseholdID": "false",
    "recordEmploymentIncome": "false",
    "recordRentalIncome": "false",
    "recordBankBalance": "false",
    "recordHousingWealth": "false",
    "recordTotalDebt": "false",
    "recordHousingStatus": "false",
    "recordConsumption": "false",
    "recordNHousesOwned": "false",
    "recordAge": "false",
    "recordSavingRate": "false",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--version", default="v5o3")
    parser.add_argument("--first-seed", type=int, default=1)
    parser.add_argument("--seeds", type=int, default=32, help="Number of paired seed IDs")
    parser.add_argument("--fraction-bits", type=int, default=23)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--n-steps", type=int, default=None)
    parser.add_argument("--maven-bin", default=None)
    parser.add_argument("--java-bin", default=None)
    parser.add_argument(
        "--require-noop",
        action="store_true",
        help="Require paired traces and model outputs to be identical (appropriate for Q52)",
    )
    args = parser.parse_args()
    if args.seeds <= 0:
        parser.error("--seeds must be positive")
    if args.first_seed <= 0:
        parser.error("--first-seed must be positive")
    if not 0 <= args.fraction_bits <= 52:
        parser.error("--fraction-bits must be in [0,52]")
    if args.workers <= 0:
        parser.error("--workers must be positive")
    if args.n_steps is not None and args.n_steps < 0:
        parser.error("--n-steps must be non-negative")
    if args.require_noop and args.fraction_bits != 52:
        parser.error("--require-noop is valid only with --fraction-bits 52")
    return args


def reject_ambient_controls() -> None:
    for variable in MODEL_CONTROL_ENV:
        value = os.environ.get(variable, "")
        if "-Dhousing." in value:
            raise SystemExit(
                f"{variable} contains an ambient housing.* property; remove it so the gate identity "
                "is explicit"
            )


def git_output(*args: str) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_fingerprint() -> dict[str, object]:
    paths = [
        "pom.xml",
        "src/main",
        "scripts/python/experiments/model/precision_decorrelation_gate.py",
    ]
    diff = git_output("diff", "--binary", "HEAD", "--", *paths)
    untracked = git_output("ls-files", "--others", "--exclude-standard", "--", *paths).splitlines()
    untracked_hashes = {
        path: sha256_file(REPO_ROOT / path)
        for path in sorted(untracked)
        if path
    }
    return {
        "commit": git_output("rev-parse", "HEAD"),
        "trackedDiffSha256": hashlib.sha256(diff.encode("utf-8")).hexdigest(),
        "untrackedFiles": untracked_hashes,
    }


def prepare_classpath(campaign_root: Path, maven_bin: str | None) -> tuple[str, str]:
    resolved_maven = resolve_maven_bin(REPO_ROOT, maven_bin)
    ensure_project_compiled(REPO_ROOT, resolved_maven, clean=True)
    namespace = {"m": "http://maven.apache.org/POM/4.0.0"}
    pom_root = ET.parse(REPO_ROOT / "pom.xml").getroot()
    runtime_jars: list[Path] = []
    for dependency in pom_root.findall("./m:dependencies/m:dependency", namespace):
        scope_node = dependency.find("m:scope", namespace)
        if scope_node is not None and scope_node.text == "test":
            continue
        group = dependency.findtext("m:groupId", namespaces=namespace)
        artifact = dependency.findtext("m:artifactId", namespaces=namespace)
        version = dependency.findtext("m:version", namespaces=namespace)
        if not group or not artifact or not version or version.startswith("$"):
            raise RuntimeError(
                "gate classpath supports pinned direct runtime dependencies only; "
                f"could not resolve {group}:{artifact}:{version}"
            )
        jar = (
            Path.home()
            / ".m2"
            / "repository"
            / Path(*group.split("."))
            / artifact
            / version
            / f"{artifact}-{version}.jar"
        )
        if not jar.is_file():
            raise RuntimeError(f"runtime dependency is not installed: {jar}")
        runtime_jars.append(jar)
    classpath_parts = [REPO_ROOT / "target" / "classes", *runtime_jars]
    classpath = os.pathsep.join(str(path) for path in classpath_parts)
    (campaign_root / "dependency-classpath.txt").write_text(
        os.linesep.join(str(path) for path in runtime_jars) + os.linesep,
        encoding="utf-8",
    )
    java_bin = shutil.which("java")
    if java_bin is None:
        raise RuntimeError("java executable not found")
    return classpath, java_bin


def prepare_configs(
    campaign_root: Path,
    *,
    version: str,
    seeds: Iterable[int],
    n_steps: int | None,
) -> dict[int, Path]:
    source = REPO_ROOT / "input-data-versions" / version / "config.properties"
    if not source.is_file():
        raise RuntimeError(f"missing validation config: {source}")
    config_dir = campaign_root / "configs"
    config_dir.mkdir()
    configs: dict[int, Path] = {}
    for seed in seeds:
        overrides = dict(RECORDING_OVERRIDES)
        overrides["SEED"] = str(seed)
        if n_steps is not None:
            overrides["N_STEPS"] = str(n_steps)
        text = build_snapshot_local_config_text(source, overrides)
        path = config_dir / f"seed-{seed}.properties"
        path.write_text(text, encoding="utf-8")
        configs[seed] = path
    return configs


def command_for(
    *,
    java_bin: str,
    classpath: str,
    config: Path,
    output: Path,
    fraction_bits: int | None,
) -> list[str]:
    precision_args = ["-Dhousing.precision=fp64"]
    if fraction_bits is not None:
        precision_args = [
            "-Dhousing.precision=mantissa",
            f"-Dhousing.mantissaBits={fraction_bits}",
        ]
    return [
        java_bin,
        "-Xms256m",
        "-Xmx2g",
        "-Dhousing.orderbook=array",
        "-Dhousing.rng=philox-household",
        "-Dhousing.precisionDiagnostics=true",
        "-Dhousing.precisionGateTrace=true",
        *precision_args,
        "-cp",
        classpath,
        "housing.Model",
        "-configFile",
        str(config),
        "-outputFolder",
        str(output),
        "-dev",
    ]


def verify_metadata(stdout: str, *, fraction_bits: int | None) -> None:
    rng_lines = [line for line in stdout.splitlines() if line.startswith("RNG_METADATA ")]
    precision_lines = [
        line for line in stdout.splitlines() if line.startswith("PRECISION_METADATA ")
    ]
    gate_lines = [
        line for line in stdout.splitlines() if line.startswith("PRECISION_GATE_METADATA ")
    ]
    if len(rng_lines) != 1 or "rngMode=philox-household" not in rng_lines[0]:
        raise RuntimeError(f"unexpected RNG metadata: {rng_lines}")
    expected_mode = "fp64" if fraction_bits is None else "mantissa"
    expected_bits = 52 if fraction_bits is None else fraction_bits
    if (
        len(precision_lines) != 1
        or f"precision={expected_mode}" not in precision_lines[0]
        or f"mantissaBits={expected_bits}" not in precision_lines[0]
        or "fieldSet=gate-probe-v1-no-age" not in precision_lines[0]
    ):
        raise RuntimeError(f"unexpected precision metadata: {precision_lines}")
    if len(gate_lines) != 1 or "enabled=true" not in gate_lines[0]:
        raise RuntimeError(f"unexpected gate metadata: {gate_lines}")


def model_tree_hash(output: Path) -> str:
    digest = hashlib.sha256()
    excluded = {TRACE_NAME, WRITES_NAME}
    files = sorted(
        path for path in output.rglob("*") if path.is_file() and path.name not in excluded
    )
    for path in files:
        relative = path.relative_to(output).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(bytes.fromhex(sha256_file(path)))
    return digest.hexdigest()


def run_arm(
    *,
    arm: str,
    seed: int,
    fraction_bits: int | None,
    config: Path,
    campaign_root: Path,
    java_bin: str,
    classpath: str,
) -> dict[str, object]:
    arm_root = campaign_root / "arms" / arm
    output = arm_root / f"seed-{seed}"
    if output.exists():
        raise RuntimeError(f"refusing to overwrite existing output: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    command = command_for(
        java_bin=java_bin,
        classpath=classpath,
        config=config,
        output=output,
        fraction_bits=fraction_bits,
    )
    process = subprocess.run(
        command,
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    log_dir = campaign_root / "logs" / arm
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"seed-{seed}.log"
    log_path.write_text(process.stdout + process.stderr, encoding="utf-8")
    if process.returncode != 0:
        raise RuntimeError(
            f"{arm} seed {seed} failed with exit {process.returncode}; see {log_path}"
        )
    verify_metadata(process.stdout, fraction_bits=fraction_bits)
    trace = output / TRACE_NAME
    writes = output / WRITES_NAME
    if not trace.is_file() or not writes.is_file():
        raise RuntimeError(f"{arm} seed {seed} did not produce both diagnostic files")
    return {
        "arm": arm,
        "seed": seed,
        "output": str(output),
        "traceSha256": sha256_file(trace),
        "writesSha256": sha256_file(writes),
        "modelTreeSha256": model_tree_hash(output),
    }


def load_trace(path: Path) -> dict[tuple[int, int, str], dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    result: dict[tuple[int, int, str], dict[str, str]] = {}
    for row in rows:
        key = (int(row["simulation"]), int(row["timeStep"]), row["phase"])
        if key in result:
            raise RuntimeError(f"duplicate trace row {key} in {path}")
        result[key] = row
    return result


def load_writes(path: Path) -> dict[str, tuple[int, int]]:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    return {
        row["field"]: (int(row["writes"]), int(row["changedWrites"]))
        for row in rows
    }


def ordered_keys(
    left: dict[tuple[int, int, str], dict[str, str]],
    right: dict[tuple[int, int, str], dict[str, str]],
) -> list[tuple[int, int, str]]:
    if left.keys() != right.keys():
        missing_left = sorted(right.keys() - left.keys())
        missing_right = sorted(left.keys() - right.keys())
        raise RuntimeError(
            f"trace keys differ; missing left={missing_left[:3]} missing right={missing_right[:3]}"
        )
    return sorted(left, key=lambda key: (key[0], key[1], PHASE_ORDER[key[2]]))


def first_difference(
    keys: Iterable[tuple[int, int, str]],
    left: dict[tuple[int, int, str], dict[str, str]],
    right: dict[tuple[int, int, str], dict[str, str]],
    columns: tuple[str, ...],
    *,
    phase: str | None = None,
) -> dict[str, object] | None:
    for key in keys:
        if phase is not None and key[2] != phase:
            continue
        if any(left[key][column] != right[key][column] for column in columns):
            return {
                "simulation": key[0],
                "timeStep": key[1],
                "phase": key[2],
                "columns": {
                    column: {"reference": left[key][column], "candidate": right[key][column]}
                    for column in columns
                    if left[key][column] != right[key][column]
                },
            }
    return None


def position(value: dict[str, object] | None) -> tuple[int, int] | None:
    if value is None:
        return None
    return int(value["timeStep"]), PHASE_ORDER[str(value["phase"])]


def relation(
    legacy: dict[str, object] | None,
    household: dict[str, object] | None,
) -> str:
    legacy_position = position(legacy)
    household_position = position(household)
    if legacy_position is None and household_position is None:
        return "no-divergence"
    if legacy_position is None:
        return "household-only"
    if household_position is None:
        return "legacy-only"
    if household_position < legacy_position:
        return "household-before-legacy"
    if household_position > legacy_position:
        return "legacy-before-household"
    return "same-phase"


def compare_pair(
    campaign_root: Path,
    *,
    seed: int,
    candidate_arm: str,
    expected_rows: int,
) -> dict[str, object]:
    reference_output = campaign_root / "arms" / "H64" / f"seed-{seed}"
    candidate_output = campaign_root / "arms" / candidate_arm / f"seed-{seed}"
    reference = load_trace(reference_output / TRACE_NAME)
    candidate = load_trace(candidate_output / TRACE_NAME)
    if len(reference) != expected_rows or len(candidate) != expected_rows:
        raise RuntimeError(
            f"seed {seed} trace rows expected {expected_rows}, "
            f"got H64={len(reference)} {candidate_arm}={len(candidate)}"
        )
    keys = ordered_keys(reference, candidate)
    first_raw = first_difference(
        keys,
        reference,
        candidate,
        ("legacyRawWordsCumulative",),
    )
    first_legacy_semantic = first_difference(
        keys,
        reference,
        candidate,
        (
            "legacyLogicalRequests",
            "legacyRequestHashA",
            "legacyRequestHashB",
        ),
    )
    first_household = first_difference(
        keys,
        reference,
        candidate,
        (
            "addressedRequests",
            "addressedRequestHashA",
            "addressedRequestHashB",
        ),
        phase="HOUSEHOLD_LOOP",
    )
    reference_writes = load_writes(reference_output / WRITES_NAME)
    candidate_writes = load_writes(candidate_output / WRITES_NAME)
    changed_fields = {
        field: {"writes": values[0], "changedWrites": values[1]}
        for field, values in candidate_writes.items()
        if values[1] > 0
    }
    return {
        "seed": seed,
        "firstLegacyRawWordDivergence": first_raw,
        "firstLegacySemanticRequestDivergence": first_legacy_semantic,
        "firstHouseholdAddressRequestDivergence": first_household,
        "rawVsHouseholdRelation": relation(first_raw, first_household),
        "referenceChangedWrites": sum(value[1] for value in reference_writes.values()),
        "candidateChangedWrites": sum(value[1] for value in candidate_writes.values()),
        "candidateChangedFields": changed_fields,
        "referenceModelTreeSha256": model_tree_hash(reference_output),
        "candidateModelTreeSha256": model_tree_hash(candidate_output),
    }


def aggregate(pairs: list[dict[str, object]]) -> dict[str, object]:
    relations: dict[str, int] = {}
    raw_times: list[int] = []
    household_times: list[int] = []
    for pair in pairs:
        label = str(pair["rawVsHouseholdRelation"])
        relations[label] = relations.get(label, 0) + 1
        raw = pair["firstLegacyRawWordDivergence"]
        household = pair["firstHouseholdAddressRequestDivergence"]
        if isinstance(raw, dict):
            raw_times.append(int(raw["timeStep"]))
        if isinstance(household, dict):
            household_times.append(int(household["timeStep"]))
    return {
        "pairCount": len(pairs),
        "relations": dict(sorted(relations.items())),
        "legacyRawDivergenceCount": len(raw_times),
        "householdAddressDivergenceCount": len(household_times),
        "legacyRawFirstTimeStepMedian": (
            statistics.median(raw_times) if raw_times else None
        ),
        "householdAddressFirstTimeStepMedian": (
            statistics.median(household_times) if household_times else None
        ),
    }


def write_pairs_csv(path: Path, pairs: list[dict[str, object]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "seed",
                "relation",
                "firstLegacyRawTimeStep",
                "firstLegacyRawPhase",
                "firstLegacySemanticTimeStep",
                "firstLegacySemanticPhase",
                "firstHouseholdAddressTimeStep",
                "candidateChangedWrites",
                "changedFieldCount",
                "modelOutputsIdentical",
            ],
        )
        writer.writeheader()
        for pair in pairs:
            raw = pair["firstLegacyRawWordDivergence"]
            semantic = pair["firstLegacySemanticRequestDivergence"]
            household = pair["firstHouseholdAddressRequestDivergence"]
            writer.writerow(
                {
                    "seed": pair["seed"],
                    "relation": pair["rawVsHouseholdRelation"],
                    "firstLegacyRawTimeStep": raw["timeStep"] if isinstance(raw, dict) else "",
                    "firstLegacyRawPhase": raw["phase"] if isinstance(raw, dict) else "",
                    "firstLegacySemanticTimeStep": (
                        semantic["timeStep"] if isinstance(semantic, dict) else ""
                    ),
                    "firstLegacySemanticPhase": (
                        semantic["phase"] if isinstance(semantic, dict) else ""
                    ),
                    "firstHouseholdAddressTimeStep": (
                        household["timeStep"] if isinstance(household, dict) else ""
                    ),
                    "candidateChangedWrites": pair["candidateChangedWrites"],
                    "changedFieldCount": len(pair["candidateChangedFields"]),
                    "modelOutputsIdentical": (
                        pair["referenceModelTreeSha256"] == pair["candidateModelTreeSha256"]
                    ),
                }
            )


def main() -> int:
    args = parse_args()
    reject_ambient_controls()
    output_dir = args.output_dir.resolve()
    if output_dir.exists():
        raise SystemExit(f"refusing to overwrite existing campaign directory: {output_dir}")
    output_dir.mkdir(parents=True)

    seeds = list(range(args.first_seed, args.first_seed + args.seeds))
    classpath, discovered_java = prepare_classpath(output_dir, args.maven_bin)
    java_bin = args.java_bin or discovered_java
    configs = prepare_configs(
        output_dir,
        version=args.version,
        seeds=seeds,
        n_steps=args.n_steps,
    )
    source_config = REPO_ROOT / "input-data-versions" / args.version / "config.properties"
    config_values = {}
    for line in configs[seeds[0]].read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            config_values[key.strip()] = value.strip()
    resolved_steps = int(config_values["N_STEPS"])
    resolved_population = int(config_values["TARGET_POPULATION"])
    expected_rows = (resolved_steps + 1) * len(PHASE_ORDER)
    candidate_arm = f"HQ{args.fraction_bits}"

    manifest = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "repoRoot": str(REPO_ROOT),
        "version": args.version,
        "seeds": seeds,
        "workers": args.workers,
        "nSteps": resolved_steps,
        "targetPopulation": resolved_population,
        "referenceArm": "H64",
        "candidateArm": candidate_arm,
        "rngMode": "philox-household",
        "orderBook": "array",
        "frontier": "legacy",
        "fieldSet": "gate-probe-v1-no-age",
        "fractionBits": args.fraction_bits,
        "traceContract": "legacy-raw-and-semantic-request-v1",
        "source": source_fingerprint(),
        "java": subprocess.run(
            [java_bin, "-version"], capture_output=True, text=True, check=True
        ).stderr.strip(),
    }
    (output_dir / "campaign.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    print(
        f"Running {len(seeds)} paired seeds ({2 * len(seeds)} model runs), "
        f"N_STEPS={resolved_steps}, population={resolved_population}, workers={args.workers}"
    )

    run_records: list[dict[str, object]] = []
    failures: list[dict[str, object]] = []

    def run_pair(seed: int) -> list[dict[str, object]]:
        reference = run_arm(
            arm="H64",
            seed=seed,
            fraction_bits=None,
            config=configs[seed],
            campaign_root=output_dir,
            java_bin=java_bin,
            classpath=classpath,
        )
        candidate = run_arm(
            arm=candidate_arm,
            seed=seed,
            fraction_bits=args.fraction_bits,
            config=configs[seed],
            campaign_root=output_dir,
            java_bin=java_bin,
            classpath=classpath,
        )
        return [reference, candidate]

    with ThreadPoolExecutor(max_workers=args.workers, thread_name_prefix="precision-gate") as executor:
        futures = {executor.submit(run_pair, seed): seed for seed in seeds}
        completed = 0
        for future in as_completed(futures):
            seed = futures[future]
            try:
                run_records.extend(future.result())
            except Exception as error:
                failures.append({"seed": seed, "error": str(error)})
                print(f"FAILED pair seed {seed}: {error}", flush=True)
            completed += 1
            print(f"Completed pair {completed}/{len(seeds)} (seed {seed})", flush=True)

    if failures:
        stopped = {
            "campaign": manifest,
            "status": "stopped-invalid-arm",
            "failures": sorted(failures, key=lambda row: int(row["seed"])),
            "runRecords": sorted(
                run_records, key=lambda row: (str(row["arm"]), int(row["seed"]))
            ),
            "decision": (
                "No onset classification was made. The candidate failed before complete paired "
                "traces existed; per the experiment stop rule, do not launch the full gate."
            ),
        }
        (output_dir / "summary.json").write_text(
            json.dumps(stopped, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(json.dumps({"status": stopped["status"], "failures": stopped["failures"]}, indent=2))
        print(f"Evidence: {output_dir}")
        return 3

    pairs = [
        compare_pair(
            output_dir,
            seed=seed,
            candidate_arm=candidate_arm,
            expected_rows=expected_rows,
        )
        for seed in seeds
    ]
    summary = {
        "campaign": manifest,
        "aggregate": aggregate(pairs),
        "pairs": pairs,
        "runRecords": sorted(run_records, key=lambda row: (str(row["arm"]), int(row["seed"]))),
        "methodologicalNote": (
            "The household trace measures semantic addressed-request reachability, not raw numeric "
            "state. Onset ordering is descriptive: both channels are treatment mediators and the "
            "ordering alone does not identify the effect of a full-Philox intervention."
        ),
    }
    (output_dir / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    write_pairs_csv(output_dir / "pairs.csv", pairs)

    if args.require_noop:
        failures = [
            pair
            for pair in pairs
            if pair["firstLegacyRawWordDivergence"] is not None
            or pair["firstLegacySemanticRequestDivergence"] is not None
            or pair["firstHouseholdAddressRequestDivergence"] is not None
            or pair["candidateChangedWrites"] != 0
            or pair["referenceModelTreeSha256"] != pair["candidateModelTreeSha256"]
        ]
        if failures:
            print(f"Q52 no-op check FAILED for {len(failures)} paired seeds")
            return 2

    print(json.dumps(summary["aggregate"], indent=2, sort_keys=True))
    print(f"Evidence: {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
