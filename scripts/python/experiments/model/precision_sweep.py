#!/usr/bin/env python3
"""Generate reproducible v5o3 reduced-storage precision arms.

This is the minimum executable driver for the active B+ route in
``precision_experiment_plan.md``.  It deliberately separates generation from scoring:

* ``generate`` records the 17 currently scoreable validation inputs, verifies every JVM's
  Philox/precision identity, and commits a seed output only after hashing it;
* ``score-reference`` scores H64 in fixed eight-seed blocks and freezes operational margins only
  when the complete predeclared 20-block (seeds 1..160) reference is present;
* ``score-candidates`` refuses to expose candidate composites until that margin seal exists.

The current Java precision field set reports ``gate-probe-v1-no-age``.  It is not yet the complete
state-field manifest required for a whole-model precision claim, so campaign metadata carries that
limitation explicitly.
"""

from __future__ import annotations

import argparse
import csv
import dataclasses
import hashlib
import json
import os
import platform
import shlex
import shutil
import statistics
import subprocess
import sys
import time
import uuid
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Mapping, Sequence


REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.python.experiments.model.null_control_provenance import (  # noqa: E402
    V5O3_REQUIRED_SEED_OUTPUT_FILES,
)
from scripts.python.helpers.common.abm_policy_sweep import (  # noqa: E402
    build_snapshot_local_config_text,
    ensure_project_compiled,
    resolve_maven_bin,
)
from scripts.python.validation.model.runner import (  # noqa: E402
    VALIDATION_RECORDING_OVERRIDES,
    _extract_seed_metrics,
    build_validation_summary,
    resolve_was_data_root,
)
from scripts.python.validation.model.schema import (  # noqa: E402
    VALIDATION_WINDOW_END,
    VALIDATION_WINDOW_START,
)
from scripts.python.validation.model.validation_profiles import (  # noqa: E402
    ValidationProfile,
    resolve_validation_profile,
)


SCHEMA_VERSION = 1
CAMPAIGN_FILE = "campaign.json"
CAMPAIGN_SEAL_FILE = "campaign.sha256"
RUN_FILE = "run.json"
PRECISION_WRITES_FILE = "precision-writes-run001.csv"
REFERENCE_FILE = "analysis/reference-distribution.json"
REFERENCE_SEAL_FILE = "seals/reference-distribution.sha256"
MARGINS_FILE = "analysis/margins.json"
MARGINS_SEAL_FILE = "seals/margins.sha256"
FIELD_SET = "gate-probe-v1-no-age"
MODEL_CONTROL_ENV = (
    "MAVEN_OPTS",
    "MAVEN_ARGS",
    "JAVA_TOOL_OPTIONS",
    "_JAVA_OPTIONS",
    "JDK_JAVA_OPTIONS",
)
EXPECTED_PRECISION_FIELDS = (
    "HOUSEHOLD_ANNUAL_EMPLOYMENT_INCOME",
    "HOUSEHOLD_MONTHLY_EMPLOYMENT_INCOME",
    "HOUSEHOLD_DESIRED_PURCHASE_PRICE",
    "HOUSEHOLD_MONTHLY_RENTAL_INCOME",
    "HOUSEHOLD_BANK_BALANCE",
    "HOUSEHOLD_DESIRED_CONSUMPTION",
    "HOUSEHOLD_SAVING_RATE",
    "HOUSEHOLD_PERSISTENT_LTI_LIMIT",
    "MORTGAGE_DOWN_PAYMENT",
    "MORTGAGE_PURCHASE_PRICE",
    "MORTGAGE_PRINCIPAL",
    "MORTGAGE_MONTHLY_INTEREST_RATE",
    "PAYMENT_MONTHLY_PAYMENT",
    "OFFER_INITIAL_LISTED_PRICE",
    "OFFER_HOUSE_SPECIFIC_YIELD",
    "MARKET_RECORD_PRICE",
    "BID_DESIRED_DOWN_PAYMENT",
)
SOURCE_ENTRIES = (
    "pom.xml",
    "mvnw",
    ".mvn",
    "src/main",
    "input-data-versions/v5o3",
    "scripts/python/experiments/model/precision_sweep.py",
    "scripts/python/experiments/model/null_control_provenance.py",
    "scripts/python/helpers/common/abm_policy_sweep.py",
    "scripts/python/validation/model",
)


@dataclass(frozen=True)
class Arm:
    arm_id: str
    mode: str
    mantissa_bits: int

    @property
    def jvm_properties(self) -> tuple[str, ...]:
        if self.mode == "fp64":
            return ("-Dhousing.precision=fp64",)
        return (
            "-Dhousing.precision=mantissa",
            f"-Dhousing.mantissaBits={self.mantissa_bits}",
        )


ARM_REGISTRY: dict[str, Arm] = {
    "H64": Arm("H64", "fp64", 52),
    **{
        f"HQ{q}": Arm(f"HQ{q}", "mantissa", q)
        for q in (52, 51, 40, 32, 23, 16, 10, 8, 6, 4)
    },
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def canonical_json(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise RuntimeError(f"expected a regular file: {path}")
    before = path.stat()
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    after = path.stat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
    ):
        raise RuntimeError(f"file changed while hashing: {path}")
    return digest.hexdigest()


def write_new(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("xb") as handle:
            handle.write(value)
    except FileExistsError as error:
        raise RuntimeError(f"refusing to overwrite immutable artifact: {path}") from error


def write_atomic(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_bytes(value)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"could not read {path}: {error}") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"expected a JSON object: {path}")
    return value


def collect_files(entries: Iterable[str]) -> dict[str, Path]:
    files: dict[str, Path] = {}
    for entry in entries:
        path = REPO_ROOT / entry
        if not path.exists():
            raise RuntimeError(f"missing campaign input: {path}")
        candidates = path.rglob("*") if path.is_dir() else (path,)
        for candidate in candidates:
            if "__pycache__" in candidate.parts or candidate.is_dir():
                continue
            if candidate.is_symlink() or not candidate.is_file():
                raise RuntimeError(f"campaign input is not a regular file: {candidate}")
            files[candidate.relative_to(REPO_ROOT).as_posix()] = candidate
    return dict(sorted(files.items()))


def fingerprint_files(files: Mapping[str, Path]) -> dict[str, object]:
    rows: list[dict[str, object]] = []
    aggregate = hashlib.sha256()
    for name, path in sorted(files.items()):
        digest = sha256_file(path)
        size = path.stat().st_size
        rows.append({"path": name, "sizeBytes": size, "sha256": digest})
        aggregate.update(name.encode("utf-8"))
        aggregate.update(b"\0")
        aggregate.update(str(size).encode("ascii"))
        aggregate.update(b"\0")
        aggregate.update(bytes.fromhex(digest))
    return {"algorithm": "sha256", "sha256": aggregate.hexdigest(), "files": rows}


def git_identity() -> dict[str, object]:
    def run(*args: str) -> str:
        return subprocess.run(
            ["git", *args],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()

    return {
        "commit": run("rev-parse", "HEAD"),
        "tree": run("rev-parse", "HEAD^{tree}"),
        "branch": run("rev-parse", "--abbrev-ref", "HEAD"),
        "dirty": bool(run("status", "--porcelain=v1", "--untracked-files=all")),
    }


def tree_inventory(root: Path, *, scientific_only: bool = False) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        relative = path.relative_to(root).as_posix()
        if scientific_only and (path.name == RUN_FILE or path.name.startswith("precision-")):
            continue
        rows.append(
            {
                "path": relative,
                "sizeBytes": path.stat().st_size,
                "sha256": sha256_file(path),
            }
        )
    return rows


def inventory_hash(rows: Sequence[Mapping[str, object]]) -> str:
    return sha256_bytes(
        b"".join(
            str(row[key]).encode("utf-8") + b"\0"
            for row in rows
            for key in ("path", "sizeBytes", "sha256")
        )
    )


def parse_property(path: Path, key: str) -> int:
    matches: list[str] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if "=" not in line:
            continue
        name, value = (part.strip() for part in line.split("=", 1))
        if name == key:
            matches.append(value)
    if len(matches) != 1:
        raise RuntimeError(f"expected exactly one {key} in {path}, found {len(matches)}")
    try:
        return int(matches[0])
    except ValueError as error:
        raise RuntimeError(f"{key} is not an integer in {path}: {matches[0]!r}") from error


def filtered_profile() -> ValidationProfile:
    profile = resolve_validation_profile("v5o3")
    kept = {
        metric_id: metric
        for metric_id, metric in profile.targets_by_id.items()
        if metric.kind != "household_jsd"
    }
    return dataclasses.replace(
        profile,
        target_catalog=[metric for metric in profile.target_catalog if metric.metric_id in kept],
        targets_by_id=kept,
    )


def reject_ambient_controls() -> None:
    found: list[str] = []
    for variable in MODEL_CONTROL_ENV:
        value = os.environ.get(variable, "")
        try:
            tokens = shlex.split(value)
        except ValueError as error:
            raise SystemExit(f"could not parse {variable}: {error}") from error
        controls = [token for token in tokens if token.startswith("-Dhousing.")]
        if controls:
            found.append(f"{variable}={' '.join(controls)}")
    if found:
        raise SystemExit(
            "ambient JVM options contain hidden housing.* controls; remove them: "
            + "; ".join(found)
        )


def parse_arms(value: str) -> list[Arm]:
    names = [item.strip() for item in value.split(",") if item.strip()]
    if not names:
        raise argparse.ArgumentTypeError("at least one arm is required")
    unknown = sorted(set(names) - ARM_REGISTRY.keys())
    if unknown:
        raise argparse.ArgumentTypeError(
            f"unknown arm(s): {', '.join(unknown)}; choose from {', '.join(ARM_REGISTRY)}"
        )
    if len(names) != len(set(names)):
        raise argparse.ArgumentTypeError("arm IDs must not be repeated")
    return [ARM_REGISTRY[name] for name in names]


def parse_metadata(output: str, prefix: str) -> dict[str, str]:
    lines = [line.strip() for line in output.splitlines() if line.startswith(prefix + " ")]
    if len(lines) != 1:
        raise RuntimeError(f"expected exactly one {prefix} line, found {len(lines)}")
    fields: dict[str, str] = {}
    for token in lines[0][len(prefix) + 1 :].split():
        if "=" not in token:
            raise RuntimeError(f"malformed {prefix} token: {token!r}")
        key, value = token.split("=", 1)
        if not key or not value or key in fields:
            raise RuntimeError(f"malformed {prefix} line: {lines[0]}")
        fields[key] = value
    return fields


def verify_metadata(output: str, *, arm: Arm, seed: int) -> dict[str, object]:
    rng = parse_metadata(output, "RNG_METADATA")
    model = parse_metadata(output, "MODEL_RUNTIME_METADATA")
    precision = parse_metadata(output, "PRECISION_METADATA")
    gate = parse_metadata(output, "PRECISION_GATE_METADATA")
    probe = parse_metadata(output, "PRECISION_FRAGILITY_METADATA")
    expected = {
        "rng.rngAlgorithm": (rng.get("rngAlgorithm"), "MersenneTwister+Philox4x32-10"),
        "rng.rngAddressVersion": (rng.get("rngAddressVersion"), "1"),
        "rng.rngMode": (rng.get("rngMode"), "philox-household"),
        "rng.masterSeed": (rng.get("masterSeed"), str(seed)),
        "model.orderBook": (model.get("orderBook"), "array"),
        "precision.precision": (precision.get("precision"), arm.mode),
        "precision.mantissaBits": (precision.get("mantissaBits"), str(arm.mantissa_bits)),
        "precision.fieldSet": (precision.get("fieldSet"), FIELD_SET),
        "precision.diagnostics": (precision.get("diagnostics"), "true"),
        "gate.enabled": (gate.get("enabled"), "false"),
        "probe.mode": (probe.get("mode"), "off"),
    }
    mismatches = [
        f"{name}: expected={wanted!r} observed={seen!r}"
        for name, (seen, wanted) in expected.items()
        if seen != wanted
    ]
    if mismatches:
        raise RuntimeError("runtime metadata mismatch: " + "; ".join(mismatches))
    return {
        "rng": rng,
        "model": model,
        "precision": precision,
        "precisionGate": gate,
        "precisionProbe": probe,
    }


def prepare_classpath(
    output_root: Path,
    *,
    maven_bin: str | None,
    java_bin: str | None,
) -> tuple[str, str, dict[str, object]]:
    resolved_maven = resolve_maven_bin(REPO_ROOT, maven_bin)
    ensure_project_compiled(REPO_ROOT, resolved_maven, clean=True)
    namespace = {"m": "http://maven.apache.org/POM/4.0.0"}
    pom_root = ET.parse(REPO_ROOT / "pom.xml").getroot()
    runtime_jars: list[Path] = []
    for dependency in pom_root.findall("./m:dependencies/m:dependency", namespace):
        scope = dependency.findtext("m:scope", default="", namespaces=namespace)
        if scope == "test":
            continue
        group = dependency.findtext("m:groupId", namespaces=namespace)
        artifact = dependency.findtext("m:artifactId", namespaces=namespace)
        version = dependency.findtext("m:version", namespaces=namespace)
        if not group or not artifact or not version or version.startswith("$"):
            raise RuntimeError(f"cannot resolve runtime dependency {group}:{artifact}:{version}")
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
    resolved_java = shutil.which(java_bin or "java")
    if resolved_java is None:
        raise RuntimeError(f"Java executable not found: {java_bin or 'java'}")
    classpath_paths = [REPO_ROOT / "target" / "classes", *runtime_jars]
    classpath = os.pathsep.join(str(path) for path in classpath_paths)
    dependency_text = "\n".join(str(path) for path in runtime_jars) + "\n"
    dependency_path = output_root / "dependency-classpath.txt"
    if dependency_path.exists():
        if dependency_path.read_text(encoding="utf-8") != dependency_text:
            raise RuntimeError("resolved dependency classpath differs from the campaign record")
    else:
        write_new(dependency_path, dependency_text.encode("utf-8"))
    java_version = subprocess.run(
        [resolved_java, "-version"], capture_output=True, text=True, check=True
    )
    build_rows = tree_inventory(REPO_ROOT / "target" / "classes")
    return classpath, resolved_java, {
        "classesSha256": inventory_hash(build_rows),
        "classFileCount": len(build_rows),
        "java": (java_version.stderr or java_version.stdout).strip().splitlines(),
        "maven": str(resolved_maven),
    }


def campaign_payload(*, n_steps: int, build: Mapping[str, object]) -> dict[str, object]:
    source_files = collect_files(SOURCE_ENTRIES)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "artifactType": "precision-storage-bplus-campaign",
        "createdAt": utc_now(),
        "protocol": {
            "version": "v5o3",
            "steps": n_steps,
            "population": 10000,
            "simulationsPerSeed": 1,
            "scoringWindow": [VALIDATION_WINDOW_START, VALIDATION_WINDOW_END],
            "validationMetricCount": 17,
            "excludedMetricKinds": ["household_jsd"],
            "orderBook": "array",
            "rngMode": "philox-household",
            "rngAddressVersion": "1",
            "frontier": "legacy",
            "precisionFieldSet": FIELD_SET,
            "precisionFieldManifestStatus": "incomplete-stage-0A",
            "precisionScope": "all-currently-instrumented-fields",
            "claimStatus": "engineering/exploratory until field manifest and margins are sealed",
        },
        "armRegistry": {
            arm_id: {"precision": arm.mode, "mantissaBits": arm.mantissa_bits}
            for arm_id, arm in ARM_REGISTRY.items()
        },
        "fixedBlocks": {
            f"B{index:02d}": list(range(1 + (index - 1) * 8, 1 + index * 8))
            for index in range(1, 37)
        },
        "git": git_identity(),
        "source": fingerprint_files(source_files),
        "build": dict(build),
        "environment": {
            "os": platform.platform(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
    }


def ensure_campaign(
    output_root: Path,
    *,
    n_steps: int,
    build: Mapping[str, object],
    resume: bool,
) -> dict[str, object]:
    campaign_path = output_root / CAMPAIGN_FILE
    seal_path = output_root / CAMPAIGN_SEAL_FILE
    if campaign_path.exists() or seal_path.exists():
        if not resume:
            raise RuntimeError(
                f"campaign already exists at {output_root}; pass --resume to verify and add runs"
            )
        if not campaign_path.is_file() or not seal_path.is_file():
            raise RuntimeError("campaign identity is only partially present")
        campaign_bytes = campaign_path.read_bytes()
        expected_seal = seal_path.read_text(encoding="ascii").strip()
        if sha256_bytes(campaign_bytes) != expected_seal:
            raise RuntimeError("campaign.json does not match campaign.sha256")
        campaign = read_json(campaign_path)
        if campaign.get("schemaVersion") != SCHEMA_VERSION:
            raise RuntimeError("unsupported campaign schema")
        protocol = campaign.get("protocol")
        if not isinstance(protocol, Mapping) or protocol.get("steps") != n_steps:
            raise RuntimeError("requested N_STEPS differs from the campaign")
        current_source = fingerprint_files(collect_files(SOURCE_ENTRIES))
        if campaign.get("source") != current_source:
            raise RuntimeError("generation source changed since campaign creation")
        if campaign.get("build") != dict(build):
            raise RuntimeError("compiled classes or Java/Maven identity changed since campaign creation")
        return campaign

    if resume:
        raise RuntimeError(f"--resume requested but no campaign exists at {output_root}")
    occupied = [path for path in output_root.iterdir() if path.name != "dependency-classpath.txt"]
    if occupied:
        raise RuntimeError(f"refusing to initialise a non-empty campaign directory: {output_root}")
    campaign = campaign_payload(n_steps=n_steps, build=build)
    payload = canonical_json(campaign)
    write_new(campaign_path, payload)
    write_new(seal_path, (sha256_bytes(payload) + "\n").encode("ascii"))
    return campaign


def prepare_config(output_root: Path, *, seed: int, n_steps: int) -> Path:
    source = REPO_ROOT / "input-data-versions" / "v5o3" / "config.properties"
    overrides = dict(VALIDATION_RECORDING_OVERRIDES)
    overrides.update({"SEED": str(seed), "N_STEPS": str(n_steps)})
    text = build_snapshot_local_config_text(source, overrides)
    path = output_root / "configs" / f"seed-{seed:06d}.properties"
    if path.exists():
        if path.read_text(encoding="utf-8") != text:
            raise RuntimeError(f"materialized config differs for seed {seed}: {path}")
    else:
        write_new(path, text.encode("utf-8"))
    if parse_property(path, "SEED") != seed or parse_property(path, "N_STEPS") != n_steps:
        raise RuntimeError(f"materialized config identity check failed for seed {seed}")
    if parse_property(path, "N_SIMS") != 1:
        raise RuntimeError("precision campaign currently requires N_SIMS=1")
    if parse_property(path, "TARGET_POPULATION") != 10000:
        raise RuntimeError("precision campaign currently requires TARGET_POPULATION=10000")
    return path


def command_for(
    *, java_bin: str, classpath: str, arm: Arm, seed: int, config: Path, output: Path
) -> list[str]:
    return [
        java_bin,
        "-Xms256m",
        "-Xmx2g",
        "-Dhousing.orderbook=array",
        "-Dhousing.rng=philox-household",
        "-Dhousing.precisionDiagnostics=true",
        "-Dhousing.precisionGateTrace=false",
        "-Dhousing.precisionProbe=off",
        *arm.jvm_properties,
        "-cp",
        classpath,
        "housing.Model",
        "-configFile",
        str(config),
        "-outputFolder",
        str(output),
        "-dev",
    ]


def read_precision_writes(path: Path) -> dict[str, dict[str, int]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    observed = {str(row["field"]) for row in rows}
    if observed != set(EXPECTED_PRECISION_FIELDS) or len(rows) != len(EXPECTED_PRECISION_FIELDS):
        raise RuntimeError(
            "precision diagnostic field set differs: "
            f"missing={sorted(set(EXPECTED_PRECISION_FIELDS) - observed)} "
            f"extra={sorted(observed - set(EXPECTED_PRECISION_FIELDS))}"
        )
    return {
        str(row["field"]): {
            "writes": int(row["writes"]),
            "changedWrites": int(row["changedWrites"]),
        }
        for row in rows
    }


def verify_run_record(seed_dir: Path, *, campaign_sha: str, arm: Arm, seed: int) -> dict[str, object]:
    record = read_json(seed_dir / RUN_FILE)
    expected = {
        "schemaVersion": SCHEMA_VERSION,
        "artifactType": "precision-storage-seed-run",
        "campaignSha256": campaign_sha,
        "arm": arm.arm_id,
        "seed": seed,
    }
    mismatches = [
        f"{key}: expected={value!r} observed={record.get(key)!r}"
        for key, value in expected.items()
        if record.get(key) != value
    ]
    if mismatches:
        raise RuntimeError("run sidecar identity mismatch: " + "; ".join(mismatches))
    recorded_files = record.get("files")
    if not isinstance(recorded_files, list):
        raise RuntimeError("run sidecar has no file inventory")
    actual_files = tree_inventory(seed_dir)
    actual_without_sidecar = [row for row in actual_files if row["path"] != RUN_FILE]
    if recorded_files != actual_without_sidecar:
        raise RuntimeError(f"run output hashes no longer match sidecar: {seed_dir}")
    scientific = tree_inventory(seed_dir, scientific_only=True)
    if record.get("scientificTreeSha256") != inventory_hash(scientific):
        raise RuntimeError(f"scientific output hash no longer matches sidecar: {seed_dir}")
    return record


def classify_failure(output: str) -> str:
    lowered = output.lower()
    if ("down payment" in lowered or "down-payment" in lowered) and "liquid wealth" in lowered:
        return "invalid-model-invariant"
    if "nan" in lowered or "infinity" in lowered or "nonfinite" in lowered:
        return "invalid-nonfinite"
    return "execution-failure"


def generate_one(
    *,
    output_root: Path,
    campaign_sha: str,
    classpath: str,
    java_bin: str,
    arm: Arm,
    seed: int,
    n_steps: int,
    resume: bool,
) -> dict[str, object]:
    final_dir = output_root / "arms" / arm.arm_id / "seeds" / f"seed-{seed:06d}"
    failure_dir = output_root / "failures" / arm.arm_id / f"seed-{seed:06d}"
    if final_dir.exists() and failure_dir.exists():
        raise RuntimeError(
            f"both successful and failed output exist for {arm.arm_id} seed {seed}"
        )
    if final_dir.exists():
        if not resume:
            raise RuntimeError(f"refusing to overwrite existing run: {final_dir}")
        record = verify_run_record(
            final_dir, campaign_sha=campaign_sha, arm=arm, seed=seed
        )
        return {"arm": arm.arm_id, "seed": seed, "status": "reused", "record": record}
    if failure_dir.exists():
        if not resume:
            raise RuntimeError(f"refusing to overwrite existing failed run: {failure_dir}")
        record = read_json(failure_dir / "failure.json")
        expected = {
            "schemaVersion": SCHEMA_VERSION,
            "artifactType": "precision-storage-failed-run",
            "campaignSha256": campaign_sha,
            "arm": arm.arm_id,
            "seed": seed,
        }
        mismatches = [
            f"{key}: expected={value!r} observed={record.get(key)!r}"
            for key, value in expected.items()
            if record.get(key) != value
        ]
        actual_partial = [
            row for row in tree_inventory(failure_dir) if row["path"] != "failure.json"
        ]
        if record.get("partialFiles") != actual_partial:
            mismatches.append("partial output hashes no longer match failure sidecar")
        if mismatches:
            raise RuntimeError("failed-run sidecar mismatch: " + "; ".join(mismatches))
        return {
            "arm": arm.arm_id,
            "seed": seed,
            "status": str(record.get("status")),
            "record": record,
        }

    config = prepare_config(output_root, seed=seed, n_steps=n_steps)
    temporary = output_root / "tmp" / f"{arm.arm_id}-seed-{seed:06d}-{uuid.uuid4().hex}"
    temporary.mkdir(parents=True)
    command = command_for(
        java_bin=java_bin,
        classpath=classpath,
        arm=arm,
        seed=seed,
        config=config,
        output=temporary,
    )
    started_at = utc_now()
    start = time.monotonic()
    process = subprocess.run(
        command,
        cwd=REPO_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    elapsed = time.monotonic() - start
    finished_at = utc_now()
    log_path = output_root / "logs" / arm.arm_id / f"seed-{seed:06d}.log"
    write_new(log_path, process.stdout.encode("utf-8", errors="replace"))
    if process.returncode != 0:
        failure_class = classify_failure(process.stdout)
        failure_dir.parent.mkdir(parents=True, exist_ok=True)
        temporary.replace(failure_dir)
        failure = {
            "schemaVersion": SCHEMA_VERSION,
            "artifactType": "precision-storage-failed-run",
            "campaignSha256": campaign_sha,
            "arm": arm.arm_id,
            "seed": seed,
            "status": failure_class,
            "exitCode": process.returncode,
            "startedAt": started_at,
            "finishedAt": finished_at,
            "wallSeconds": elapsed,
            "log": log_path.relative_to(output_root).as_posix(),
            "partialFiles": tree_inventory(failure_dir),
        }
        write_new(failure_dir / "failure.json", canonical_json(failure))
        return {"arm": arm.arm_id, "seed": seed, "status": failure_class, "record": failure}

    metadata = verify_metadata(process.stdout, arm=arm, seed=seed)
    missing = [name for name in V5O3_REQUIRED_SEED_OUTPUT_FILES if not (temporary / name).is_file()]
    if missing:
        raise RuntimeError(f"{arm.arm_id} seed {seed} is missing validation outputs: {missing}")
    writes = read_precision_writes(temporary / PRECISION_WRITES_FILE)
    files = tree_inventory(temporary)
    scientific = tree_inventory(temporary, scientific_only=True)
    run_record = {
        "schemaVersion": SCHEMA_VERSION,
        "artifactType": "precision-storage-seed-run",
        "campaignSha256": campaign_sha,
        "arm": arm.arm_id,
        "seed": seed,
        "request": {
            "version": "v5o3",
            "steps": n_steps,
            "population": 10000,
            "orderBook": "array",
            "rngMode": "philox-household",
            "precision": arm.mode,
            "mantissaBits": arm.mantissa_bits,
            "precisionFieldSet": FIELD_SET,
            "precisionDiagnostics": True,
            "precisionGateTrace": False,
            "precisionProbe": "off",
        },
        "command": command,
        "observedMetadata": metadata,
        "config": {
            "path": config.relative_to(output_root).as_posix(),
            "sha256": sha256_file(config),
        },
        "status": "complete",
        "exitCode": process.returncode,
        "startedAt": started_at,
        "finishedAt": finished_at,
        "wallSeconds": elapsed,
        "outputBytes": sum(int(row["sizeBytes"]) for row in files),
        "scientificTreeSha256": inventory_hash(scientific),
        "files": files,
        "precisionWrites": writes,
        "zeroWriteFields": sorted(name for name, row in writes.items() if row["writes"] == 0),
        "changedWrites": sum(row["changedWrites"] for row in writes.values()),
        "log": log_path.relative_to(output_root).as_posix(),
    }
    write_new(temporary / RUN_FILE, canonical_json(run_record))
    verify_run_record(temporary, campaign_sha=campaign_sha, arm=arm, seed=seed)
    final_dir.parent.mkdir(parents=True, exist_ok=True)
    temporary.replace(final_dir)
    return {"arm": arm.arm_id, "seed": seed, "status": "complete", "record": run_record}


def control_report(
    output_root: Path,
    *,
    seeds: Sequence[int],
    campaign_sha: str,
) -> dict[str, object] | None:
    if not all(
        (output_root / "arms" / arm / "seeds" / f"seed-{seed:06d}").is_dir()
        for arm in ("H64", "HQ52")
        for seed in seeds
    ):
        return None
    pairs: list[dict[str, object]] = []
    for seed in seeds:
        left = verify_run_record(
            output_root / "arms" / "H64" / "seeds" / f"seed-{seed:06d}",
            campaign_sha=campaign_sha,
            arm=ARM_REGISTRY["H64"],
            seed=seed,
        )
        right = verify_run_record(
            output_root / "arms" / "HQ52" / "seeds" / f"seed-{seed:06d}",
            campaign_sha=campaign_sha,
            arm=ARM_REGISTRY["HQ52"],
            seed=seed,
        )
        identical = left["scientificTreeSha256"] == right["scientificTreeSha256"]
        pairs.append(
            {
                "seed": seed,
                "h64ScientificTreeSha256": left["scientificTreeSha256"],
                "hq52ScientificTreeSha256": right["scientificTreeSha256"],
                "identical": identical,
            }
        )
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "artifactType": "precision-q52-control",
        "campaignSha256": campaign_sha,
        "seeds": list(seeds),
        "passed": all(bool(pair["identical"]) for pair in pairs),
        "pairs": pairs,
    }
    path = output_root / "analysis" / (
        f"q52-control-seeds-{seeds[0]:06d}-{seeds[-1]:06d}.json"
    )
    if path.exists():
        if path.read_bytes() != canonical_json(report):
            raise RuntimeError(f"existing Q52 control report differs: {path}")
    else:
        write_new(path, canonical_json(report))
    return report


def seed_dir(output_root: Path, arm_id: str, seed: int) -> Path:
    return output_root / "arms" / arm_id / "seeds" / f"seed-{seed:06d}"


def load_seed_results(
    output_root: Path,
    *,
    arm: Arm,
    seeds: Sequence[int],
    campaign_sha: str,
    profile: ValidationProfile,
) -> list[dict[str, object]]:
    was_root = resolve_was_data_root(repo_root=REPO_ROOT, explicit_root=None)
    results: list[dict[str, object]] = []
    for seed in seeds:
        path = seed_dir(output_root, arm.arm_id, seed)
        verify_run_record(path, campaign_sha=campaign_sha, arm=arm, seed=seed)
        metrics = _extract_seed_metrics(
            seed_output_dir=path,
            was_data_root=was_root,
            validation_profile=profile,
            window_start=VALIDATION_WINDOW_START,
            window_end=VALIDATION_WINDOW_END,
        )
        results.append({"seed": seed, "outputDir": str(path), "metrics": metrics})
    return results


def block_summary(
    output_root: Path,
    *,
    arm: Arm,
    block_id: str,
    seeds: Sequence[int],
    campaign_sha: str,
    profile: ValidationProfile,
) -> dict[str, object]:
    results = load_seed_results(
        output_root,
        arm=arm,
        seeds=seeds,
        campaign_sha=campaign_sha,
        profile=profile,
    )
    summary = build_validation_summary(
        version="v5o3",
        seed_results=results,
        seeds=seeds,
        validation_profile=profile,
        window_start=VALIDATION_WINDOW_START,
        window_end=VALIDATION_WINDOW_END,
    )
    return {
        "blockId": block_id,
        "arm": arm.arm_id,
        "seeds": list(seeds),
        "summary": summary,
    }


def verify_sealed_json(output_root: Path, relative_json: str, relative_seal: str) -> dict[str, object]:
    path = output_root / relative_json
    seal = output_root / relative_seal
    if not path.is_file() or not seal.is_file():
        raise RuntimeError(f"required sealed artifact is absent: {path} / {seal}")
    payload = path.read_bytes()
    if sha256_bytes(payload) != seal.read_text(encoding="ascii").strip():
        raise RuntimeError(f"sealed artifact hash mismatch: {path}")
    return read_json(path)


def score_reference(output_root: Path) -> int:
    campaign_bytes = (output_root / CAMPAIGN_FILE).read_bytes()
    campaign_sha = sha256_bytes(campaign_bytes)
    expected_campaign_sha = (output_root / CAMPAIGN_SEAL_FILE).read_text(encoding="ascii").strip()
    if campaign_sha != expected_campaign_sha:
        raise RuntimeError("campaign seal mismatch")
    profile = filtered_profile()
    blocks: list[dict[str, object]] = []
    for index in range(1, 21):
        seeds = list(range(1 + (index - 1) * 8, 1 + index * 8))
        blocks.append(
            block_summary(
                output_root,
                arm=ARM_REGISTRY["H64"],
                block_id=f"B{index:02d}",
                seeds=seeds,
                campaign_sha=campaign_sha,
                profile=profile,
            )
        )
    composites = [float(block["summary"]["overallCompositeLoss"]) for block in blocks]
    metric_ids = [str(metric["metricId"]) for metric in blocks[0]["summary"]["metrics"]]
    raw_by_metric = {
        metric_id: [
            float(next(m for m in block["summary"]["metrics"] if m["metricId"] == metric_id)["seedMean"])
            for block in blocks
        ]
        for metric_id in metric_ids
    }
    reference = {
        "schemaVersion": SCHEMA_VERSION,
        "artifactType": "precision-h64-reference-distribution",
        "campaignSha256": campaign_sha,
        "blocks": blocks,
        "composite": {
            "mean": statistics.fmean(composites),
            "sd": statistics.stdev(composites),
            "median": statistics.median(composites),
            "min": min(composites),
            "max": max(composites),
        },
    }
    margins = {
        "schemaVersion": SCHEMA_VERSION,
        "artifactType": "precision-operational-margins",
        "campaignSha256": campaign_sha,
        "referenceSha256": sha256_bytes(canonical_json(reference)),
        "rule": "two-times-H64-eight-seed-block-sample-sd",
        "blockCount": 20,
        "blockSize": 8,
        "seeds": list(range(1, 161)),
        "compositeMargin": 2.0 * statistics.stdev(composites),
        "rawMetricMargins": {
            metric_id: 2.0 * statistics.stdev(values)
            for metric_id, values in raw_by_metric.items()
        },
        "claimLimit": "operational sampling margins, not economic tolerances",
    }
    reference_bytes = canonical_json(reference)
    margins_bytes = canonical_json(margins)
    write_new(output_root / REFERENCE_FILE, reference_bytes)
    write_new(
        output_root / REFERENCE_SEAL_FILE,
        (sha256_bytes(reference_bytes) + "\n").encode("ascii"),
    )
    write_new(output_root / MARGINS_FILE, margins_bytes)
    write_new(
        output_root / MARGINS_SEAL_FILE,
        (sha256_bytes(margins_bytes) + "\n").encode("ascii"),
    )
    print(
        f"Frozen 20 H64 blocks; composite mean={statistics.fmean(composites):.6f} "
        f"sd={statistics.stdev(composites):.6f} margin={margins['compositeMargin']:.6f}"
    )
    return 0


def score_candidates(output_root: Path, *, arms: Sequence[Arm], first_seed: int, seeds: int) -> int:
    if seeds <= 0 or seeds % 8:
        raise RuntimeError("candidate scoring requires a positive multiple of eight seeds")
    if first_seed != 1 and (first_seed - 1) % 8:
        raise RuntimeError("candidate scoring must begin on a predeclared block boundary")
    margins = verify_sealed_json(output_root, MARGINS_FILE, MARGINS_SEAL_FILE)
    campaign_sha = sha256_file(output_root / CAMPAIGN_FILE)
    if margins.get("campaignSha256") != campaign_sha:
        raise RuntimeError("margins belong to a different campaign")
    profile = filtered_profile()
    rows: list[dict[str, object]] = []
    for arm in arms:
        if arm.arm_id == "H64":
            continue
        for offset in range(0, seeds, 8):
            block_seeds = list(range(first_seed + offset, first_seed + offset + 8))
            block_index = 1 + (block_seeds[0] - 1) // 8
            candidate = block_summary(
                output_root,
                arm=arm,
                block_id=f"B{block_index:02d}",
                seeds=block_seeds,
                campaign_sha=campaign_sha,
                profile=profile,
            )
            reference = block_summary(
                output_root,
                arm=ARM_REGISTRY["H64"],
                block_id=f"B{block_index:02d}",
                seeds=block_seeds,
                campaign_sha=campaign_sha,
                profile=profile,
            )
            candidate_loss = float(candidate["summary"]["overallCompositeLoss"])
            reference_loss = float(reference["summary"]["overallCompositeLoss"])
            rows.append(
                {
                    "arm": arm.arm_id,
                    "blockId": f"B{block_index:02d}",
                    "seeds": block_seeds,
                    "referenceCompositeLoss": reference_loss,
                    "candidateCompositeLoss": candidate_loss,
                    "pairedCompositeDifference": candidate_loss - reference_loss,
                    "candidateSummary": candidate["summary"],
                }
            )
    result = {
        "schemaVersion": SCHEMA_VERSION,
        "artifactType": "precision-candidate-block-scores",
        "campaignSha256": campaign_sha,
        "marginsSha256": sha256_file(output_root / MARGINS_FILE),
        "status": "exploratory" if first_seed <= 64 else "confirmation",
        "rows": rows,
    }
    arm_label = "-".join(arm.arm_id for arm in arms if arm.arm_id != "H64")
    path = output_root / "blocks" / f"{arm_label}-seeds-{first_seed:06d}-{first_seed + seeds - 1:06d}.json"
    write_new(path, canonical_json(result))
    for row in rows:
        print(
            f"{row['arm']} {row['blockId']}: reference={row['referenceCompositeLoss']:.6f} "
            f"candidate={row['candidateCompositeLoss']:.6f} "
            f"delta={row['pairedCompositeDifference']:+.6f}"
        )
    return 0


def generate(args: argparse.Namespace) -> int:
    reject_ambient_controls()
    output_root = args.output_dir.expanduser().resolve()
    source_config = REPO_ROOT / "input-data-versions" / "v5o3" / "config.properties"
    n_steps = args.n_steps if args.n_steps is not None else parse_property(source_config, "N_STEPS")
    if n_steps < VALIDATION_WINDOW_END:
        raise RuntimeError(
            f"N_STEPS={n_steps} is shorter than scoring window end {VALIDATION_WINDOW_END}"
        )
    selected_arms: list[Arm] = args.arms
    seed_ids = list(range(args.first_seed, args.first_seed + args.seeds))
    if args.dry_run:
        print(
            json.dumps(
                {
                    "outputDir": str(output_root),
                    "arms": [arm.arm_id for arm in selected_arms],
                    "seeds": seed_ids,
                    "runCount": len(selected_arms) * len(seed_ids),
                    "nSteps": n_steps,
                    "scoring": "disabled during generation",
                },
                indent=2,
            )
        )
        return 0
    output_root.mkdir(parents=True, exist_ok=True)
    classpath, java_bin, build = prepare_classpath(
        output_root, maven_bin=args.maven_bin, java_bin=args.java_bin
    )
    campaign = ensure_campaign(
        output_root, n_steps=n_steps, build=build, resume=args.resume
    )
    campaign_sha = sha256_file(output_root / CAMPAIGN_FILE)
    tasks = [(arm, seed) for arm in selected_arms for seed in seed_ids]
    print(
        f"Generating {len(tasks)} run(s): arms={','.join(arm.arm_id for arm in selected_arms)} "
        f"seeds={seed_ids[0]}..{seed_ids[-1]} workers={args.workers} N_STEPS={n_steps}"
    )
    results: list[dict[str, object]] = []
    with ThreadPoolExecutor(max_workers=args.workers, thread_name_prefix="precision-sweep") as pool:
        futures = {
            pool.submit(
                generate_one,
                output_root=output_root,
                campaign_sha=campaign_sha,
                classpath=classpath,
                java_bin=java_bin,
                arm=arm,
                seed=seed,
                n_steps=n_steps,
                resume=args.resume,
            ): (arm.arm_id, seed)
            for arm, seed in tasks
        }
        for completed, future in enumerate(as_completed(futures), start=1):
            arm_id, seed = futures[future]
            try:
                result = future.result()
            except Exception as error:
                result = {"arm": arm_id, "seed": seed, "status": "driver-failure", "error": str(error)}
            results.append(result)
            print(
                f"[{completed}/{len(tasks)}] {arm_id} seed {seed}: {result['status']}",
                flush=True,
            )
    results.sort(key=lambda row: (str(row["arm"]), int(row["seed"])))
    control = control_report(
        output_root, seeds=seed_ids, campaign_sha=campaign_sha
    )
    invocation = {
        "schemaVersion": SCHEMA_VERSION,
        "artifactType": "precision-generation-invocation",
        "campaignSha256": campaign_sha,
        "requestedArms": [arm.arm_id for arm in selected_arms],
        "requestedSeeds": seed_ids,
        "workers": args.workers,
        "results": results,
        "q52Control": control,
    }
    invocation_path = output_root / "invocations" / (
        f"generate-{'-'.join(arm.arm_id for arm in selected_arms)}-"
        f"{seed_ids[0]:06d}-{seed_ids[-1]:06d}-{uuid.uuid4().hex[:8]}.json"
    )
    write_new(invocation_path, canonical_json(invocation))
    failures = [row for row in results if row["status"] not in {"complete", "reused"}]
    if control is not None and not control["passed"]:
        print("STOP: H64/HQ52 scientific outputs differ", file=sys.stderr)
        return 2
    if failures:
        print(f"Completed with {len(failures)} failed/invalid run(s); see {invocation_path}")
        return 3
    durations = [
        float(row["record"]["wallSeconds"])
        for row in results
        if row["status"] == "complete"
    ]
    output_bytes = sum(
        int(row["record"]["outputBytes"])
        for row in results
        if row["status"] == "complete"
    )
    if durations:
        print(
            f"Complete: median JVM time={statistics.median(durations):.2f}s, "
            f"new output={output_bytes / (1024 ** 2):.1f} MiB"
        )
    if control is not None:
        print(f"Q52 no-op control: {'PASS' if control['passed'] else 'FAIL'}")
    print(f"Evidence: {output_root}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    generation = subparsers.add_parser("generate", help="Generate and verify arm/seed outputs")
    generation.add_argument("--output-dir", type=Path, required=True)
    generation.add_argument("--arms", type=parse_arms, default=parse_arms("H64,HQ52"))
    generation.add_argument("--first-seed", type=int, default=1)
    generation.add_argument("--seeds", type=int, default=2)
    generation.add_argument("--workers", type=int, default=2)
    generation.add_argument("--n-steps", type=int, default=None)
    generation.add_argument("--maven-bin", default=None)
    generation.add_argument("--java-bin", default=None)
    generation.add_argument("--resume", action="store_true")
    generation.add_argument("--dry-run", action="store_true")

    reference = subparsers.add_parser(
        "score-reference", help="Score and seal H64 blocks B01..B20 (seeds 1..160)"
    )
    reference.add_argument("--output-dir", type=Path, required=True)

    candidates = subparsers.add_parser(
        "score-candidates", help="Score complete candidate blocks after margins are sealed"
    )
    candidates.add_argument("--output-dir", type=Path, required=True)
    candidates.add_argument("--arms", type=parse_arms, required=True)
    candidates.add_argument("--first-seed", type=int, default=1)
    candidates.add_argument("--seeds", type=int, default=8)
    return parser


def validate_args(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    if args.command == "generate":
        if args.first_seed <= 0:
            parser.error("--first-seed must be positive")
        if args.seeds <= 0:
            parser.error("--seeds must be positive")
        if args.workers <= 0 or args.workers > 16:
            parser.error("--workers must be in [1,16]")
        if args.n_steps is not None and args.n_steps < 0:
            parser.error("--n-steps must be non-negative")
    elif args.command == "score-candidates":
        if args.first_seed <= 0 or args.seeds <= 0:
            parser.error("candidate seed range must be positive")
        if all(arm.arm_id == "H64" for arm in args.arms):
            parser.error("--arms must include at least one candidate arm")


def dispatch(args: argparse.Namespace) -> int:
    if args.command == "generate":
        return generate(args)
    if args.command == "score-reference":
        return score_reference(args.output_dir.expanduser().resolve())
    if args.command == "score-candidates":
        return score_candidates(
            args.output_dir.expanduser().resolve(),
            arms=args.arms,
            first_seed=args.first_seed,
            seeds=args.seeds,
        )
    raise AssertionError(args.command)


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    validate_args(args, parser)
    try:
        return dispatch(args)
    except RuntimeError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
