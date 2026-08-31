"""Snapshot-local runner and summary builder for tracked validation and references.

@author: Max Stoddard
"""

from __future__ import annotations

import csv
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import shutil
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Mapping, Sequence

import numpy as np

from scripts.python.helpers.common.abm_policy_sweep import (
    build_snapshot_local_config_text,
    ensure_project_compiled,
    resolve_maven_bin,
)
from scripts.python.validation.model.extractors import (
    HOUSEHOLD_DISTRIBUTION_SPECS,
    extract_core_indicator_mean,
    extract_household_metric_from_results,
    extract_household_share_from_results,
    extract_output_series_metric_from_results,
)
from scripts.python.validation.model.publish import (
    write_transient_artifacts,
    write_validation_overlay_summary,
    write_validation_summary,
)
from scripts.python.validation.model.schema import (
    CANONICAL_VALIDATION_SEEDS,
    VALIDATION_SCHEMA_VERSION,
    VALIDATION_WINDOW_END,
    VALIDATION_WINDOW_START,
    MetricDefinition,
    MetricSourceMetadata,
    MetricSourceReference,
)
from scripts.python.validation.model.scoring import (
    classify_metric_status,
    compute_metric_loss_audit,
    compute_overall_composite_loss,
)
from scripts.python.validation.model.validation_profiles import (
    ValidationProfile,
    resolve_reference_validation_profile,
    resolve_validation_profile,
)

VALIDATION_RECORDING_OVERRIDES = {
    "recordTransactions": "false",
    "recordNBidUpFrequency": "false",
    "recordCoreIndicators": "true",
    "recordQualityBandPrice": "false",
    "recordHouseholdID": "false",
    "recordEmploymentIncome": "true",
    "recordRentalIncome": "false",
    "recordBankBalance": "true",
    "recordHousingWealth": "true",
    "recordHousingStatus": "true",
    "recordNHousesOwned": "false",
    "recordAge": "false",
    "recordSavingRate": "false",
}

SUPPORTED_VALIDATION_ORDER_BOOKS = frozenset({"array", "tree"})
SUPPORTED_VALIDATION_RNG_MODES = frozenset({"mersenne", "philox-household"})
EXPECTED_VALIDATION_RNG_METADATA = {
    "mersenne": {
        "rngAlgorithm": "MersenneTwister",
        "rngAddressVersion": "none",
    },
    "philox-household": {
        "rngAlgorithm": "MersenneTwister+Philox4x32-10",
        "rngAddressVersion": "1",
    },
}

VALIDATION_GENERATION_PROVENANCE_FILENAME = "generation-provenance.json"
VALIDATION_GENERATION_PROVENANCE_SCHEMA_VERSION = 1
VALIDATION_GENERATION_PROVENANCE_ARTIFACT_TYPE = (
    "validation-seed-generation-provenance"
)
LEGACY_REUSED_OUTPUT_GENERATION_NOTE = "unknown - reused pre-provenance output"


def _validated_runtime_request(
    *,
    order_book: str | None,
    rng_mode: str | None,
) -> tuple[str, str] | None:
    """Validate an optional pair of model runtime settings.

    Supplying the settings as a pair keeps existing validation callers unchanged while allowing
    provenance-sensitive experiments to pin both settings and verify the values reported by the
    model process.
    """

    if order_book is None and rng_mode is None:
        return None
    if order_book is None or rng_mode is None:
        raise ValueError("order_book and rng_mode must be supplied together")
    if order_book not in SUPPORTED_VALIDATION_ORDER_BOOKS:
        expected = ", ".join(sorted(SUPPORTED_VALIDATION_ORDER_BOOKS))
        raise ValueError(f"Unsupported order_book '{order_book}' (expected one of: {expected})")
    if rng_mode not in SUPPORTED_VALIDATION_RNG_MODES:
        expected = ", ".join(sorted(SUPPORTED_VALIDATION_RNG_MODES))
        raise ValueError(f"Unsupported rng_mode '{rng_mode}' (expected one of: {expected})")
    return order_book, rng_mode


def _parse_single_metadata_line(
    output: str,
    *,
    prefix: str,
    version: str,
    seed: int,
) -> dict[str, str]:
    lines = [
        line.strip()
        for line in output.splitlines()
        if line.strip().startswith(f"{prefix} ")
    ]
    if len(lines) != 1:
        raise RuntimeError(
            "Model validation runtime metadata check failed.\n"
            f"version={version} seed={seed}\n"
            f"Expected exactly one {prefix} line, found {len(lines)}.\n"
            f"Output tail:\n{output[-3000:]}"
        )

    fields: dict[str, str] = {}
    for token in lines[0][len(prefix) + 1 :].split():
        if "=" not in token:
            raise RuntimeError(
                f"Malformed {prefix} token for version={version} seed={seed}: {token!r}"
            )
        key, value = token.split("=", 1)
        if not key or not value or key in fields:
            raise RuntimeError(
                f"Malformed {prefix} metadata for version={version} seed={seed}: {lines[0]}"
            )
        fields[key] = value
    return fields


def _verify_runtime_metadata(
    output: str,
    *,
    version: str,
    seed: int,
    expected_order_book: str,
    expected_rng_mode: str,
) -> dict[str, str]:
    rng_fields = _parse_single_metadata_line(
        output,
        prefix="RNG_METADATA",
        version=version,
        seed=seed,
    )
    model_fields = _parse_single_metadata_line(
        output,
        prefix="MODEL_RUNTIME_METADATA",
        version=version,
        seed=seed,
    )

    required_rng_fields = {"rngAlgorithm", "rngAddressVersion", "masterSeed", "rngMode"}
    missing_rng_fields = sorted(required_rng_fields - rng_fields.keys())
    if missing_rng_fields:
        raise RuntimeError(
            f"RNG_METADATA missing {', '.join(missing_rng_fields)} for "
            f"version={version} seed={seed}"
        )
    if "orderBook" not in model_fields:
        raise RuntimeError(
            f"MODEL_RUNTIME_METADATA missing orderBook for version={version} seed={seed}"
        )

    mismatches: list[str] = []
    if model_fields["orderBook"] != expected_order_book:
        mismatches.append(
            f"orderBook requested={expected_order_book} observed={model_fields['orderBook']}"
        )
    if rng_fields["rngMode"] != expected_rng_mode:
        mismatches.append(
            f"rngMode requested={expected_rng_mode} observed={rng_fields['rngMode']}"
        )
    expected_rng_metadata = EXPECTED_VALIDATION_RNG_METADATA[expected_rng_mode]
    for field_name, expected_value in expected_rng_metadata.items():
        if rng_fields[field_name] != expected_value:
            mismatches.append(
                f"{field_name} requested={expected_value} observed={rng_fields[field_name]}"
            )
    if rng_fields["masterSeed"] != str(seed):
        mismatches.append(f"masterSeed requested={seed} observed={rng_fields['masterSeed']}")
    if mismatches:
        raise RuntimeError(
            "Model validation runtime metadata mismatch.\n"
            f"version={version} seed={seed}\n"
            + "\n".join(mismatches)
        )

    return {
        "orderBook": model_fields["orderBook"],
        "rngMode": rng_fields["rngMode"],
        "rngAlgorithm": rng_fields["rngAlgorithm"],
        "rngAddressVersion": rng_fields["rngAddressVersion"],
    }


def _json_object_copy(value: Mapping[str, object], *, label: str) -> dict[str, object]:
    try:
        encoded = json.dumps(value, sort_keys=True, allow_nan=False)
        copied = json.loads(encoded)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be JSON-serializable: {error}") from error
    if not isinstance(copied, dict):
        raise ValueError(f"{label} must be a mapping")
    return copied


def _normalized_generation_git(
    generation_git: Mapping[str, object],
) -> dict[str, object]:
    normalized = _json_object_copy(generation_git, label="generation_git")
    for field_name in ("commit", "tree"):
        value = normalized.get(field_name)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"generation_git.{field_name} must be a non-empty string")
    return normalized


def _sha256_regular_file(path: Path, *, label: str) -> tuple[int, str]:
    if path.is_symlink() or not path.is_file():
        raise RuntimeError(f"{label} is missing or is not a regular file: {path}")
    before = path.stat()
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    after = path.stat()
    before_identity = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
    after_identity = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
    if before_identity != after_identity:
        raise RuntimeError(f"{label} changed while its SHA-256 was being computed: {path}")
    return after.st_size, digest.hexdigest()


def _scored_output_file_names(validation_profile: ValidationProfile) -> tuple[str, ...]:
    file_names: set[str] = set()
    for metric in validation_profile.targets_by_id.values():
        file_name = metric.file_name
        if file_name is None and metric.kind == "household_jsd":
            spec = HOUSEHOLD_DISTRIBUTION_SPECS.get(metric.metric_id)
            if spec is not None:
                file_name = spec.results_file_name
        if not file_name:
            raise RuntimeError(
                f"Missing scored output file mapping for validation metric {metric.metric_id}"
            )
        pure_path = PurePosixPath(file_name)
        if pure_path.as_posix() != file_name or len(pure_path.parts) != 1:
            raise RuntimeError(
                f"Scored output file mapping must be one canonical file name: {file_name!r}"
            )
        file_names.add(file_name)
    return tuple(sorted(file_names))


def _write_seed_generation_provenance(
    *,
    repo_root: Path,
    version: str,
    seed: int,
    output_dir: Path,
    seed_output_dir: Path,
    version_config_path: Path,
    materialized_config_path: Path,
    validation_profile: ValidationProfile,
    runtime_metadata: Mapping[str, object],
    generation_git: Mapping[str, object],
) -> dict[str, object]:
    normalized_git = _normalized_generation_git(generation_git)
    normalized_runtime = _json_object_copy(
        runtime_metadata,
        label="observed runtime metadata",
    )
    version_config_size, version_config_sha256 = _sha256_regular_file(
        version_config_path,
        label="Version config",
    )
    materialized_size, materialized_sha256 = _sha256_regular_file(
        materialized_config_path,
        label="Materialized validation config",
    )
    try:
        version_config_identifier = version_config_path.relative_to(repo_root).as_posix()
    except ValueError:
        version_config_identifier = str(version_config_path.resolve())
    materialized_identifier = materialized_config_path.relative_to(output_dir).as_posix()

    output_rows: list[dict[str, object]] = []
    for file_name in _scored_output_file_names(validation_profile):
        size_bytes, digest = _sha256_regular_file(
            seed_output_dir / file_name,
            label=f"Scored output for seed {seed}",
        )
        output_rows.append(
            {
                "path": file_name,
                "size_bytes": size_bytes,
                "sha256": digest,
            }
        )

    provenance: dict[str, object] = {
        "schema_version": VALIDATION_GENERATION_PROVENANCE_SCHEMA_VERSION,
        "artifact_type": VALIDATION_GENERATION_PROVENANCE_ARTIFACT_TYPE,
        "seed": seed,
        "version": version,
        "generation_git": normalized_git,
        "config": {
            "version_config": version_config_identifier,
            "version_config_size_bytes": version_config_size,
            "version_config_sha256": version_config_sha256,
            "materialized_config": materialized_identifier,
            "materialized_config_size_bytes": materialized_size,
            "materialized_config_sha256": materialized_sha256,
            "validation_profile": validation_profile.profile_id,
        },
        # These values came from the model's MODEL_RUNTIME_METADATA and RNG_METADATA lines
        # and were checked against the requested JVM settings before this file was written.
        "runtime_metadata": normalized_runtime,
        "scored_outputs": output_rows,
    }

    provenance_path = seed_output_dir / VALIDATION_GENERATION_PROVENANCE_FILENAME
    temporary_path = seed_output_dir / f".{VALIDATION_GENERATION_PROVENANCE_FILENAME}.tmp"
    try:
        temporary_path.write_text(
            json.dumps(provenance, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        temporary_path.replace(provenance_path)
    finally:
        temporary_path.unlink(missing_ok=True)
    return provenance


def _is_sha256(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def _read_seed_generation_provenance(path: Path, *, seed: int) -> dict[str, object]:
    if path.is_symlink() or not path.is_file():
        raise RuntimeError(f"Seed provenance is not a regular file for seed {seed}: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Could not read seed provenance for seed {seed}: {error}") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"Seed provenance must be a JSON object for seed {seed}: {path}")
    return value


def _checked_provenance_file(
    *,
    root: Path,
    relative: object,
    label: str,
    direct_child: bool = False,
) -> tuple[Path, str]:
    if not isinstance(relative, str) or not relative:
        raise RuntimeError(f"{label} has an invalid recorded path: {relative!r}")
    pure_path = PurePosixPath(relative)
    if (
        pure_path.is_absolute()
        or pure_path.as_posix() != relative
        or any(part in {"", ".", ".."} for part in pure_path.parts)
        or (direct_child and len(pure_path.parts) != 1)
    ):
        raise RuntimeError(f"{label} has a non-canonical recorded path: {relative!r}")
    path = root.joinpath(*pure_path.parts)
    return path, relative


def validate_reused_validation_provenance(
    *,
    output_dir: Path,
    seeds: Sequence[int],
    expected_version: str,
    expected_order_book: str,
    expected_rng_mode: str,
    validation_profile: ValidationProfile,
) -> dict[str, object]:
    """Validate opt-in per-seed generation evidence before reused outputs are scored.

    Campaigns created before this sidecar existed are deliberately grandfathered only when every
    requested seed lacks it. A partial set is ambiguous and therefore refused. Normal validation
    callers are unaffected because this check is invoked explicitly by provenance-sensitive
    experiments rather than by :func:`load_reused_validation_results` itself.
    """

    runtime_request = _validated_runtime_request(
        order_book=expected_order_book,
        rng_mode=expected_rng_mode,
    )
    assert runtime_request is not None
    normalized_seeds = [int(seed) for seed in seeds]
    if len(set(normalized_seeds)) != len(normalized_seeds):
        raise ValueError("seeds must not contain duplicates")

    provenance_paths: dict[int, Path] = {}
    missing_seeds: list[int] = []
    for seed in normalized_seeds:
        seed_dir = output_dir / f"seed-{seed}"
        if seed_dir.is_symlink() or not seed_dir.is_dir():
            raise RuntimeError(f"Missing existing validation output directory: {seed_dir}")
        provenance_path = seed_dir / VALIDATION_GENERATION_PROVENANCE_FILENAME
        if provenance_path.exists() or provenance_path.is_symlink():
            provenance_paths[seed] = provenance_path
        else:
            missing_seeds.append(seed)

    if not provenance_paths:
        return {
            "status": "unverified-legacy",
            "generation_git": None,
            "note": LEGACY_REUSED_OUTPUT_GENERATION_NOTE,
            "baseline_eligible": False,
            "runtime_metadata": None,
            "provenance_files": [],
        }
    if missing_seeds:
        raise RuntimeError(
            "Seed generation provenance is incomplete: "
            f"present for seeds {sorted(provenance_paths)}, "
            f"absent for seeds {sorted(missing_seeds)}"
        )

    expected_output_files = set(_scored_output_file_names(validation_profile))
    common_identity: str | None = None
    common_git: dict[str, object] | None = None
    common_runtime: dict[str, object] | None = None
    relative_provenance_paths: list[str] = []
    for seed in normalized_seeds:
        provenance_path = provenance_paths[seed]
        record = _read_seed_generation_provenance(provenance_path, seed=seed)
        if record.get("schema_version") != VALIDATION_GENERATION_PROVENANCE_SCHEMA_VERSION:
            raise RuntimeError(
                f"Unsupported seed provenance schema for seed {seed}: "
                f"{record.get('schema_version')!r}"
            )
        if record.get("artifact_type") != VALIDATION_GENERATION_PROVENANCE_ARTIFACT_TYPE:
            raise RuntimeError(f"Unexpected seed provenance artifact type for seed {seed}")
        if record.get("seed") != seed:
            raise RuntimeError(
                f"Seed provenance identity mismatch for seed-{seed}: "
                f"recorded seed={record.get('seed')!r}"
            )
        if record.get("version") != expected_version:
            raise RuntimeError(
                f"Seed provenance version mismatch for seed-{seed}: "
                f"requested={expected_version!r} recorded={record.get('version')!r}"
            )

        raw_git = record.get("generation_git")
        if not isinstance(raw_git, Mapping):
            raise RuntimeError(f"Seed provenance is missing generation_git for seed {seed}")
        try:
            generation_git = _normalized_generation_git(raw_git)
        except ValueError as error:
            raise RuntimeError(f"Invalid generation_git for seed {seed}: {error}") from error

        raw_runtime = record.get("runtime_metadata")
        if not isinstance(raw_runtime, Mapping):
            raise RuntimeError(f"Seed provenance is missing runtime metadata for seed {seed}")
        try:
            runtime_metadata = _json_object_copy(
                raw_runtime,
                label=f"runtime metadata for seed {seed}",
            )
        except ValueError as error:
            raise RuntimeError(f"Invalid runtime metadata for seed {seed}: {error}") from error
        recorded_order_book = runtime_metadata.get("orderBook")
        recorded_rng_mode = runtime_metadata.get("rngMode")
        if recorded_order_book != expected_order_book:
            raise RuntimeError(
                f"Seed provenance order book mismatch for seed-{seed}: "
                f"requested={expected_order_book!r} recorded={recorded_order_book!r}"
            )
        if recorded_rng_mode != expected_rng_mode:
            raise RuntimeError(
                f"Seed provenance RNG mode mismatch for seed-{seed}: "
                f"requested={expected_rng_mode!r} recorded={recorded_rng_mode!r}"
            )
        expected_rng_metadata = EXPECTED_VALIDATION_RNG_METADATA[expected_rng_mode]
        for field_name, expected_value in expected_rng_metadata.items():
            if runtime_metadata.get(field_name) != expected_value:
                raise RuntimeError(
                    f"Seed provenance {field_name} mismatch for seed-{seed}: "
                    f"expected={expected_value!r} recorded={runtime_metadata.get(field_name)!r}"
                )

        raw_config = record.get("config")
        if not isinstance(raw_config, Mapping):
            raise RuntimeError(f"Seed provenance is missing config identifiers for seed {seed}")
        try:
            config = _json_object_copy(raw_config, label=f"config identifiers for seed {seed}")
        except ValueError as error:
            raise RuntimeError(f"Invalid config identifiers for seed {seed}: {error}") from error
        if config.get("validation_profile") != validation_profile.profile_id:
            raise RuntimeError(
                f"Seed provenance validation profile mismatch for seed-{seed}: "
                f"requested={validation_profile.profile_id!r} "
                f"recorded={config.get('validation_profile')!r}"
            )
        expected_materialized = f"configs/seed-{seed}.properties"
        if config.get("materialized_config") != expected_materialized:
            raise RuntimeError(
                f"Seed provenance materialized config mismatch for seed-{seed}: "
                f"expected={expected_materialized!r} "
                f"recorded={config.get('materialized_config')!r}"
            )
        materialized_path, _ = _checked_provenance_file(
            root=output_dir,
            relative=config.get("materialized_config"),
            label=f"Materialized config for seed {seed}",
        )
        observed_config_size, observed_config_sha256 = _sha256_regular_file(
            materialized_path,
            label=f"Materialized config for seed {seed}",
        )
        if (
            config.get("materialized_config_size_bytes") != observed_config_size
            or config.get("materialized_config_sha256") != observed_config_sha256
        ):
            raise RuntimeError(
                f"Materialized config SHA-256 mismatch for seed-{seed}: "
                f"expected size={config.get('materialized_config_size_bytes')!r} "
                f"sha256={config.get('materialized_config_sha256')!r}, "
                f"observed size={observed_config_size} sha256={observed_config_sha256}"
            )
        if not _is_sha256(config.get("version_config_sha256")):
            raise RuntimeError(f"Invalid version config SHA-256 in seed provenance for seed {seed}")
        version_config_size = config.get("version_config_size_bytes")
        if (
            not isinstance(version_config_size, int)
            or isinstance(version_config_size, bool)
            or version_config_size < 0
        ):
            raise RuntimeError(f"Invalid version config size in seed provenance for seed {seed}")
        version_config_identifier = config.get("version_config")
        if not isinstance(version_config_identifier, str) or not version_config_identifier:
            raise RuntimeError(
                f"Invalid version config identifier in seed provenance for seed {seed}"
            )
        expected_version_config_identifier = (
            f"input-data-versions/{expected_version}/config.properties"
        )
        if version_config_identifier != expected_version_config_identifier:
            raise RuntimeError(
                f"Seed provenance version config identifier mismatch for seed-{seed}: "
                f"expected={expected_version_config_identifier!r} "
                f"recorded={version_config_identifier!r}"
            )

        raw_outputs = record.get("scored_outputs")
        if not isinstance(raw_outputs, list) or not raw_outputs:
            raise RuntimeError(f"Seed provenance has no scored output hashes for seed {seed}")
        recorded_output_files: set[str] = set()
        seed_dir = output_dir / f"seed-{seed}"
        for row in raw_outputs:
            if not isinstance(row, Mapping):
                raise RuntimeError(f"Malformed scored output hash row for seed {seed}")
            output_path, relative_output = _checked_provenance_file(
                root=seed_dir,
                relative=row.get("path"),
                label=f"Scored output for seed {seed}",
                direct_child=True,
            )
            if relative_output in recorded_output_files:
                raise RuntimeError(
                    f"Duplicate scored output hash for seed {seed}: {relative_output}"
                )
            recorded_output_files.add(relative_output)
            expected_digest = row.get("sha256")
            expected_size = row.get("size_bytes")
            if not _is_sha256(expected_digest):
                raise RuntimeError(
                    f"Invalid scored output SHA-256 for seed {seed}: {relative_output}"
                )
            if (
                not isinstance(expected_size, int)
                or isinstance(expected_size, bool)
                or expected_size < 0
            ):
                raise RuntimeError(
                    f"Invalid scored output size for seed {seed}: {relative_output}"
                )
            observed_size, observed_digest = _sha256_regular_file(
                output_path,
                label=f"Scored output for seed {seed}",
            )
            if expected_size != observed_size or expected_digest != observed_digest:
                raise RuntimeError(
                    f"Scored output SHA-256 mismatch for seed-{seed}/{relative_output}: "
                    f"expected size={expected_size} sha256={expected_digest}, "
                    f"observed size={observed_size} sha256={observed_digest}"
                )
        missing_output_hashes = sorted(expected_output_files - recorded_output_files)
        if missing_output_hashes:
            raise RuntimeError(
                f"Seed provenance does not hash every currently scored output for seed {seed}: "
                + ", ".join(missing_output_hashes)
            )

        shared_config = {
            "version_config": version_config_identifier,
            "version_config_size_bytes": version_config_size,
            "version_config_sha256": config["version_config_sha256"],
            "validation_profile": config["validation_profile"],
        }
        identity = json.dumps(
            {
                "version": record["version"],
                "generation_git": generation_git,
                "config": shared_config,
                "runtime_metadata": runtime_metadata,
            },
            sort_keys=True,
            allow_nan=False,
        )
        if common_identity is None:
            common_identity = identity
            common_git = generation_git
            common_runtime = runtime_metadata
        elif identity != common_identity:
            raise RuntimeError(
                "Seed generation provenance files are inconsistent with each other: "
                f"seed-{seed} differs from seed-{normalized_seeds[0]}"
            )
        relative_provenance_paths.append(
            f"seed-{seed}/{VALIDATION_GENERATION_PROVENANCE_FILENAME}"
        )

    assert common_git is not None and common_runtime is not None
    return {
        "status": "verified",
        "generation_git": common_git,
        "note": None,
        "baseline_eligible": True,
        "runtime_metadata": common_runtime,
        "provenance_files": relative_provenance_paths,
    }

REFERENCE_ARTIFACT_DIRNAME = "reference-2011"
REFERENCE_OVERLAY_SUFFIX = "2011"


def reference_overlay_name(version: str) -> str:
    """Return the dashboard overlay name for one v0-family 2011 reference summary."""

    normalized_version = version.strip().lower()
    if not normalized_version:
        raise ValueError("version must not be empty")
    return f"{normalized_version}-{REFERENCE_OVERLAY_SUFFIX}"


def _reference_artifact_label(version: str) -> str:
    return f"Tracked 8-seed {version} validation outputs rescored against the v0-only 2011 reference catalog"


def run_validation_for_version(
    *,
    repo_root: Path,
    version: str,
    seeds: list[int],
    output_dir: Path,
    maven_bin: str | None = None,
    was_data_root: Path | None = None,
    reuse_existing_output: bool = False,
    workers: int = 20,
    allow_test_override: bool = False,
    allow_noncanonical_seeds: bool = False,
    n_steps: int | None = None,
    window_start: int | None = None,
    window_end: int | None = None,
) -> dict:
    """Run canonical validation for one input-data version and publish artifacts."""

    canonical_seeds = list(CANONICAL_VALIDATION_SEEDS)
    if seeds != canonical_seeds and not allow_test_override and not allow_noncanonical_seeds:
        raise ValueError("Canonical validation requires seeds 1..8 unless an explicit test-only override is used")
    if workers <= 0:
        raise ValueError("workers must be positive")
    resolved_window_start, resolved_window_end = _resolve_validation_window(
        window_start=window_start,
        window_end=window_end,
    )
    if n_steps is not None and n_steps < resolved_window_end:
        raise ValueError("n_steps must be at least the validation window end")

    validation_profile = resolve_validation_profile(version)
    resolved_was_data_root = resolve_was_data_root(repo_root=repo_root, explicit_root=was_data_root)
    if reuse_existing_output:
        run_results = load_reused_validation_results(
            output_dir=output_dir,
            seeds=seeds,
            was_data_root=resolved_was_data_root,
            validation_profile=validation_profile,
            window_start=resolved_window_start,
            window_end=resolved_window_end,
        )
    else:
        resolved_maven_bin = resolve_maven_bin(repo_root, maven_bin)
        run_results = run_snapshot_local_validation(
            repo_root=repo_root,
            version=version,
            seeds=seeds,
            output_dir=output_dir,
            maven_bin=resolved_maven_bin,
            was_data_root=resolved_was_data_root,
            validation_profile=validation_profile,
            workers=workers,
            n_steps=n_steps,
            window_start=resolved_window_start,
            window_end=resolved_window_end,
        )
    return publish_validation_results(
        repo_root=repo_root,
        version=version,
        seeds=seeds,
        output_dir=output_dir,
        run_results=run_results,
        validation_profile=validation_profile,
        was_data_root=resolved_was_data_root,
        window_start=resolved_window_start,
        window_end=resolved_window_end,
    )


def run_reference_validation_for_version(
    *,
    repo_root: Path,
    version: str,
    seeds: Sequence[int],
    output_dir: Path,
    maven_bin: str | None = None,
    workers: int = 1,
    was_data_root: Path | None = None,
    reuse_existing_output: bool = False,
    allow_noncanonical_seeds: bool = False,
    n_steps: int | None = None,
    window_start: int | None = None,
    window_end: int | None = None,
) -> dict:
    """Run and publish only a 2011 reference validation overlay for a v0-family version."""

    canonical_seeds = list(CANONICAL_VALIDATION_SEEDS)
    if list(seeds) != canonical_seeds and not allow_noncanonical_seeds:
        raise ValueError("2011 reference validation requires canonical seeds unless --allow-noncanonical-seeds is set")
    if workers <= 0:
        raise ValueError("workers must be positive")
    reference_profile = resolve_reference_validation_profile(version)
    if reference_profile is None:
        raise RuntimeError(f"No 2011 reference validation profile is available for {version}")
    resolved_window_start, resolved_window_end = _resolve_validation_window(
        window_start=window_start,
        window_end=window_end,
    )
    if n_steps is not None and n_steps < resolved_window_end:
        raise ValueError("n_steps must be at least the validation window end")
    resolved_was_data_root = resolve_was_data_root(repo_root=repo_root, explicit_root=was_data_root)
    if reuse_existing_output:
        run_results = load_reused_validation_results(
            output_dir=output_dir,
            seeds=seeds,
            was_data_root=resolved_was_data_root,
            validation_profile=reference_profile,
            window_start=resolved_window_start,
            window_end=resolved_window_end,
        )
    else:
        resolved_maven_bin = resolve_maven_bin(repo_root, maven_bin)
        run_results = run_snapshot_local_validation(
            repo_root=repo_root,
            version=version,
            seeds=seeds,
            output_dir=output_dir,
            maven_bin=resolved_maven_bin,
            was_data_root=resolved_was_data_root,
            validation_profile=reference_profile,
            workers=workers,
            n_steps=n_steps,
            window_start=resolved_window_start,
            window_end=resolved_window_end,
        )
    return _write_reference_validation_artifacts(
        repo_root=repo_root,
        version=version,
        output_dir=output_dir,
        reference_seed_results=run_results,
        reference_profile=reference_profile,
        window_start=resolved_window_start,
        window_end=resolved_window_end,
    )


def publish_reference_validation_only(
    *,
    repo_root: Path,
    version: str,
    seeds: Sequence[int],
    output_dir: Path,
    was_data_root: Path | None = None,
    window_start: int | None = None,
    window_end: int | None = None,
) -> dict:
    """Publish only the optional 2011 reference overlay from existing seed output directories."""

    reference_profile = resolve_reference_validation_profile(version)
    if reference_profile is None:
        raise RuntimeError(f"No 2011 reference validation profile is available for {version}")

    resolved_window_start, resolved_window_end = _resolve_validation_window(
        window_start=window_start,
        window_end=window_end,
    )
    resolved_was_data_root = resolve_was_data_root(repo_root=repo_root, explicit_root=was_data_root)
    reference_seed_results = _extract_reference_seed_results_from_output_dir(
        output_dir=output_dir,
        seeds=seeds,
        was_data_root=resolved_was_data_root,
        reference_profile=reference_profile,
        window_start=resolved_window_start,
        window_end=resolved_window_end,
    )
    return _write_reference_validation_artifacts(
        repo_root=repo_root,
        version=version,
        output_dir=output_dir,
        reference_seed_results=reference_seed_results,
        reference_profile=reference_profile,
        window_start=resolved_window_start,
        window_end=resolved_window_end,
    )


def publish_validation_results(
    *,
    repo_root: Path,
    version: str,
    seeds: Sequence[int],
    output_dir: Path,
    run_results: Sequence[dict[str, object]],
    validation_profile: ValidationProfile | None = None,
    was_data_root: Path | None = None,
    window_start: int | None = None,
    window_end: int | None = None,
) -> dict:
    """Publish tracked and transient outputs after all seed runs succeed."""

    returned_seeds = sorted(int(result["seed"]) for result in run_results)
    if returned_seeds != sorted(seeds):
        raise ValueError("Tracked publication requires 8/8 successful seeds before publishing tracked JSON")

    resolved_profile = validation_profile or resolve_validation_profile(version)
    resolved_window_start, resolved_window_end = _resolve_validation_window(
        window_start=window_start,
        window_end=window_end,
    )
    summary = build_validation_summary(
        version=version,
        seed_results=run_results,
        seeds=seeds,
        validation_profile=resolved_profile,
        window_start=resolved_window_start,
        window_end=resolved_window_end,
    )
    write_transient_artifacts(output_dir=output_dir, summary=summary, seed_results=run_results)
    write_validation_summary(repo_root=repo_root, summary=summary)
    publish_reference_validation_artifacts(
        repo_root=repo_root,
        version=version,
        output_dir=output_dir,
        run_results=run_results,
        was_data_root=was_data_root,
        window_start=resolved_window_start,
        window_end=resolved_window_end,
    )
    return summary


def run_snapshot_local_validation(
    *,
    repo_root: Path,
    version: str,
    seeds: Sequence[int],
    output_dir: Path,
    maven_bin: str,
    was_data_root: Path,
    validation_profile: ValidationProfile,
    workers: int,
    n_steps: int | None = None,
    window_start: int | None = None,
    window_end: int | None = None,
    order_book: str | None = None,
    rng_mode: str | None = None,
    clean_compile: bool = False,
    generation_git: Mapping[str, object] | None = None,
    provenance_validation_profile: ValidationProfile | None = None,
) -> list[dict[str, object]]:
    """Execute the Java model snapshot-locally for each seed and extract metrics.

    Supplying ``generation_git`` opts this run into per-seed generation sidecars. Existing callers
    that omit it retain the historical output contract. ``provenance_validation_profile`` can be a
    superset of the profile scored immediately, allowing later rescoring inputs to be hashed at
    generation time without extracting metrics that currently need unavailable target data.
    """

    runtime_request = _validated_runtime_request(order_book=order_book, rng_mode=rng_mode)
    normalized_generation_git = (
        _normalized_generation_git(generation_git) if generation_git is not None else None
    )
    if normalized_generation_git is not None and runtime_request is None:
        raise ValueError(
            "generation_git requires explicit order_book and rng_mode so provenance records "
            "observed model runtime metadata"
        )
    version_config_path = repo_root / "input-data-versions" / version / "config.properties"
    if not version_config_path.exists():
        raise RuntimeError(f"Missing version config: {version_config_path}")

    if clean_compile:
        ensure_project_compiled(repo_root, maven_bin=maven_bin, clean=True)
    else:
        ensure_project_compiled(repo_root, maven_bin=maven_bin)
    configs_dir = output_dir / "configs"
    configs_dir.mkdir(parents=True, exist_ok=True)

    if workers <= 1:
        seed_results: list[dict[str, object]] = []
        for seed in seeds:
            seed_results.append(
                run_validation_seed(
                    repo_root=repo_root,
                    version=version,
                    seed=seed,
                    output_dir=output_dir,
                    maven_bin=maven_bin,
                    was_data_root=was_data_root,
                    validation_profile=validation_profile,
                    n_steps=n_steps,
                    window_start=window_start,
                    window_end=window_end,
                    order_book=runtime_request[0] if runtime_request else None,
                    rng_mode=runtime_request[1] if runtime_request else None,
                    generation_git=normalized_generation_git,
                    provenance_validation_profile=provenance_validation_profile,
                )
            )
        return seed_results

    worker_results: dict[int, dict[str, object]] = {}
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="validation-worker") as executor:
        futures = {
            executor.submit(
                run_validation_seed,
                repo_root=repo_root,
                version=version,
                seed=seed,
                output_dir=output_dir,
                maven_bin=maven_bin,
                was_data_root=was_data_root,
                validation_profile=validation_profile,
                n_steps=n_steps,
                window_start=window_start,
                window_end=window_end,
                order_book=runtime_request[0] if runtime_request else None,
                rng_mode=runtime_request[1] if runtime_request else None,
                generation_git=normalized_generation_git,
                provenance_validation_profile=provenance_validation_profile,
            ): seed
            for seed in seeds
        }

        for future in as_completed(futures):
            seed = futures[future]
            worker_results[seed] = future.result()

    return [worker_results[seed] for seed in seeds]


def run_validation_seed(
    *,
    repo_root: Path,
    version: str,
    seed: int,
    output_dir: Path,
    maven_bin: str,
    was_data_root: Path,
    validation_profile: ValidationProfile,
    n_steps: int | None = None,
    window_start: int | None = None,
    window_end: int | None = None,
    order_book: str | None = None,
    rng_mode: str | None = None,
    generation_git: Mapping[str, object] | None = None,
    provenance_validation_profile: ValidationProfile | None = None,
) -> dict[str, object]:

    """Run one snapshot-local validation seed and return its extracted metrics.

    A non-null ``generation_git`` writes the opt-in generation sidecar after runtime verification
    and metric extraction both succeed.
    """

    runtime_request = _validated_runtime_request(order_book=order_book, rng_mode=rng_mode)
    normalized_generation_git = (
        _normalized_generation_git(generation_git) if generation_git is not None else None
    )
    if normalized_generation_git is not None and runtime_request is None:
        raise ValueError(
            "generation_git requires explicit order_book and rng_mode so provenance records "
            "observed model runtime metadata"
        )
    version_config_path = repo_root / "input-data-versions" / version / "config.properties"
    if not version_config_path.exists():
        raise RuntimeError(f"Missing version config: {version_config_path}")

    seed_output_dir = output_dir / f"seed-{seed}"
    if seed_output_dir.exists():
        shutil.rmtree(seed_output_dir)
    seed_output_dir.mkdir(parents=True, exist_ok=True)
    configs_dir = output_dir / "configs"
    configs_dir.mkdir(parents=True, exist_ok=True)

    overrides = dict(VALIDATION_RECORDING_OVERRIDES)
    overrides["SEED"] = str(seed)
    if n_steps is not None:
        overrides["N_STEPS"] = str(n_steps)
    config_text = build_snapshot_local_config_text(version_config_path, overrides)
    config_path = configs_dir / f"seed-{seed}.properties"
    config_path.write_text(config_text, encoding="utf-8")

    exec_args = f'-configFile "{config_path}" -outputFolder "{seed_output_dir}" -dev'
    _log_validation_run_start(
        version=version,
        seed=seed,
    )
    command = [maven_bin, "-q"]
    if runtime_request is not None:
        command.extend(
            [
                f"-Dhousing.orderbook={runtime_request[0]}",
                f"-Dhousing.rng={runtime_request[1]}",
            ]
        )
    command.extend(["exec:java", f"-Dexec.args={exec_args}"])
    proc = subprocess.run(
        command,
        cwd=repo_root,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            "Model validation run failed.\n"
            f"version={version} seed={seed}\n"
            f"Output tail:\n{proc.stdout[-3000:]}"
        )

    runtime_metadata = None
    if runtime_request is not None:
        runtime_metadata = _verify_runtime_metadata(
            proc.stdout,
            version=version,
            seed=seed,
            expected_order_book=runtime_request[0],
            expected_rng_mode=runtime_request[1],
        )

    metrics = _extract_seed_metrics(
        seed_output_dir=seed_output_dir,
        was_data_root=was_data_root,
        validation_profile=validation_profile,
        window_start=window_start,
        window_end=window_end,
    )
    result: dict[str, object] = {
        "seed": seed,
        "outputDir": str(seed_output_dir),
        "metrics": metrics,
    }
    if runtime_metadata is not None:
        result["runtimeMetadata"] = runtime_metadata
    if normalized_generation_git is not None:
        assert runtime_metadata is not None
        result["generationProvenance"] = _write_seed_generation_provenance(
            repo_root=repo_root,
            version=version,
            seed=seed,
            output_dir=output_dir,
            seed_output_dir=seed_output_dir,
            version_config_path=version_config_path,
            materialized_config_path=config_path,
            validation_profile=provenance_validation_profile or validation_profile,
            runtime_metadata=runtime_metadata,
            generation_git=normalized_generation_git,
        )
    return result



def load_reused_validation_results(
    *,
    output_dir: Path,
    seeds: Sequence[int],
    was_data_root: Path,
    validation_profile: ValidationProfile,
    window_start: int | None = None,
    window_end: int | None = None,
    use_cached_seed_results: bool = True,
) -> list[dict[str, object]]:
    """Reuse existing per-seed outputs instead of rerunning the model.

    Provenance-sensitive callers can disable the derived CSV cache so every value is
    re-extracted from the immutable, manifest-verified model outputs. The default preserves
    the existing validation workflow for callers that intentionally use the cache.
    """

    cached_seed_results = _load_cached_seed_results(output_dir) if use_cached_seed_results else {}
    seed_results: list[dict[str, object]] = []
    for seed in seeds:
        seed_output_dir = output_dir / f"seed-{seed}"
        if not seed_output_dir.exists():
            raise RuntimeError(f"Missing existing validation output directory: {seed_output_dir}")
        cached_entry = cached_seed_results.get(seed)
        metrics = dict(cached_entry["metrics"]) if cached_entry is not None else {}
        missing_metric_ids = [
            metric_id for metric_id in validation_profile.targets_by_id if metric_id not in metrics
        ]
        if missing_metric_ids:
            metrics.update(
                _extract_seed_metrics(
                    seed_output_dir=seed_output_dir,
                    was_data_root=was_data_root,
                    metric_ids=missing_metric_ids,
                    validation_profile=validation_profile,
                    window_start=window_start,
                    window_end=window_end,
                )
            )
        seed_results.append(
            {
                "seed": seed,
                "outputDir": cached_entry["outputDir"] if cached_entry is not None else str(seed_output_dir),
                "metrics": metrics,
            }
        )
    return seed_results




def _log_validation_run_start(
    *,
    version: str,
    seed: int,
) -> None:
    worker_name = threading.current_thread().name
    print(
        f"[validation] version={version} seed={seed} worker={worker_name}",
        flush=True,
    )


def _resolve_validation_window(
    *,
    window_start: int | None,
    window_end: int | None,
) -> tuple[int, int]:
    resolved_start = VALIDATION_WINDOW_START if window_start is None else int(window_start)
    resolved_end = VALIDATION_WINDOW_END if window_end is None else int(window_end)
    if resolved_start < 0:
        raise ValueError("window_start must be non-negative")
    if resolved_end <= resolved_start:
        raise ValueError("window_end must be greater than window_start")
    return resolved_start, resolved_end


def resolve_was_data_root(*, repo_root: Path, explicit_root: Path | None) -> Path:
    """Resolve a usable WAS data root for a normal checkout or a git worktree."""

    if explicit_root is not None:
        return explicit_root

    dataset_candidates = (
        Path("private-datasets/was/was_round_8_hhold_eul_may_2025.privdata"),
        Path("private-datasets/was/was_wave_3_hhold_eul_final.dta"),
    )
    candidates = [repo_root]
    candidates.extend(repo_root.parents[:3])
    for candidate in candidates:
        if any((candidate / dataset_path).exists() for dataset_path in dataset_candidates):
            return candidate
    return repo_root


def build_validation_summary(
    *,
    version: str,
    seed_results: Sequence[dict[str, object]],
    seeds: Sequence[int],
    validation_profile: ValidationProfile | None = None,
    targets_by_id: Mapping[str, object] | None = None,
    window_start: int | None = None,
    window_end: int | None = None,
) -> dict:
    """Build the dashboard-facing summary JSON from per-seed metric values."""

    if len(seed_results) != len(seeds):
        raise ValueError("Tracked publication requires 8/8 successful seeds before publishing tracked JSON")

    resolved_profile = validation_profile or resolve_validation_profile(version)
    resolved_window_start, resolved_window_end = _resolve_validation_window(
        window_start=window_start,
        window_end=window_end,
    )
    target_lookup = targets_by_id or resolved_profile.targets_by_id
    metric_ids = _ordered_metric_ids(
        seed_results=seed_results,
        target_lookup=target_lookup,
        target_catalog=resolved_profile.target_catalog,
    )
    summary_metrics: list[dict] = []
    scored_metric_losses: list[float] = []
    scored_metric_weights: list[float] = []

    for metric_id in metric_ids:
        target = _coerce_target_definition(metric_id, target_lookup.get(metric_id))
        seed_values = _metric_seed_values(metric_id=metric_id, seed_results=seed_results)
        seed_mean = float(np.mean(seed_values))
        p25 = float(np.percentile(seed_values, 25))
        p75 = float(np.percentile(seed_values, 75))

        metric_summary = {
            "metricId": target.metric_id,
            "label": target.label,
            "requirement": target.requirement,
            "units": target.units,
            "sourceLabel": target.source_label,
            "sourceIndicatorLabel": None,
            "sourceDocumentPath": None,
            "sourceTextPath": None,
            "sourceTable": None,
            "sourcePage": None,
            "rawSourceValue": None,
            "sourceValue": None,
            "sourceAsOf": None,
            "sourceUnits": None,
            "comparisonUnits": None,
            "mappingStatus": None,
            "bandMethod": None,
            "bandNotes": None,
            "sourceReferences": [],
            "targetBand": None,
            "seedMean": seed_mean,
            "p25": p25,
            "p75": p75,
            "insideRate": None,
            "lossFamily": target.loss_family,
            "lossTransform": None,
            "lossScale": None,
            "lossScaleBasis": None,
            "additiveScale": None,
            "additiveScaleBasis": None,
            "normalizedDistance": None,
            "normalizedIqr": None,
            "distanceComponent": None,
            "spreadComponent": None,
            "levelComponent": None,
            "insideRateComponent": None,
            "metricLoss": None,
            "metricWeight": 0.0,
            "status": "unsupported",
        }
        if target.source_metadata is not None:
            metric_summary.update(
                {
                    "sourceIndicatorLabel": target.source_metadata.source_indicator_label,
                    "sourceDocumentPath": target.source_metadata.source_document_path,
                    "sourceTextPath": target.source_metadata.source_text_path,
                    "sourceTable": target.source_metadata.source_table,
                    "sourcePage": target.source_metadata.source_page,
                    "rawSourceValue": target.source_metadata.raw_source_value,
                    "sourceValue": target.source_metadata.normalized_source_value,
                    "sourceAsOf": target.source_metadata.source_as_of,
                    "sourceUnits": target.source_metadata.source_units,
                    "comparisonUnits": target.source_metadata.comparison_units,
                    "mappingStatus": target.source_metadata.mapping_status,
                    "bandMethod": target.source_metadata.band_method,
                    "bandNotes": target.source_metadata.band_notes,
                    "sourceReferences": [
                        _serialize_source_reference(reference)
                        for reference in target.source_metadata.source_references
                    ],
                }
            )

        if target.target_band is None:
            if target.requirement == "required":
                raise RuntimeError(f"Missing target metadata for required metric {target.metric_id}")
        else:
            inside_rate = _inside_rate(seed_values=seed_values, lower=target.target_band.lower, upper=target.target_band.upper)
            source_value = target.source_metadata.normalized_source_value if target.source_metadata else None
            loss_audit = compute_metric_loss_audit(
                loss_family=target.loss_family,
                seed_mean=seed_mean,
                p25=p25,
                p75=p75,
                lower_bound=target.target_band.lower,
                upper_bound=target.target_band.upper,
                inside_rate=inside_rate,
                source_value=source_value,
            )
            metric_summary.update(
                {
                    "targetBand": {"lower": target.target_band.lower, "upper": target.target_band.upper},
                    "insideRate": inside_rate,
                    "lossFamily": loss_audit.loss_family,
                    "lossTransform": loss_audit.loss_transform,
                    "lossScale": loss_audit.loss_scale,
                    "lossScaleBasis": loss_audit.loss_scale_basis,
                    "additiveScale": loss_audit.additive_scale,
                    "additiveScaleBasis": loss_audit.additive_scale_basis,
                    "normalizedDistance": loss_audit.normalized_distance,
                    "normalizedIqr": loss_audit.normalized_iqr,
                    "distanceComponent": loss_audit.distance_component,
                    "spreadComponent": loss_audit.spread_component,
                    "levelComponent": loss_audit.level_component,
                    "insideRateComponent": loss_audit.inside_rate_component,
                    "metricLoss": loss_audit.metric_loss,
                    "status": classify_metric_status(
                        seed_mean=seed_mean,
                        lower_bound=target.target_band.lower,
                        upper_bound=target.target_band.upper,
                        inside_rate=inside_rate,
                    ),
                }
            )
            if target.requirement == "required":
                metric_summary["metricWeight"] = 1.0
                scored_metric_losses.append(loss_audit.metric_loss)
                scored_metric_weights.append(1.0)

        summary_metrics.append(metric_summary)

    if not scored_metric_losses:
        raise RuntimeError("Missing required metric losses for overall composite scoring")

    summary = {
        "schemaVersion": VALIDATION_SCHEMA_VERSION,
        "version": version,
        "validationTargetYear": resolved_profile.validation_target_year,
        "generatedAt": _utc_now_iso(),
        "seeds": list(seeds),
        "window": {
            "startIndex": resolved_window_start,
            "endIndex": resolved_window_end,
        },
        "overallCompositeLoss": compute_overall_composite_loss(
            metric_losses=scored_metric_losses,
            metric_weights=scored_metric_weights,
        ),
        "metrics": summary_metrics,
    }
    return summary


def _extract_seed_metrics(
    *,
    seed_output_dir: Path,
    was_data_root: Path,
    validation_profile: ValidationProfile,
    metric_ids: Sequence[str] | None = None,
    window_start: int | None = None,
    window_end: int | None = None,
) -> dict[str, float]:
    metrics: dict[str, float] = {}
    resolved_window_start, resolved_window_end = _resolve_validation_window(
        window_start=window_start,
        window_end=window_end,
    )
    selected_metric_ids = (
        list(metric_ids) if metric_ids is not None else list(validation_profile.targets_by_id.keys())
    )
    for metric_id in selected_metric_ids:
        metric = validation_profile.targets_by_id[metric_id]
        if metric.kind == "core_indicator":
            if not metric.file_name:
                raise RuntimeError(f"Missing core-indicator file mapping for {metric.metric_id}")
            metrics[metric.metric_id] = extract_core_indicator_mean(
                seed_output_dir / metric.file_name,
                scale=metric.scale,
                window_start=resolved_window_start,
                window_end=resolved_window_end,
            )
        elif metric.kind == "output_series":
            metrics[metric.metric_id] = extract_output_series_metric_from_results(
                metric_id=metric.metric_id,
                results_dir=seed_output_dir,
                trailing_months=validation_profile.output_series_trailing_months_by_metric.get(metric.metric_id),
                window_start=resolved_window_start,
                window_end=resolved_window_end,
            )
        elif metric.kind == "household_jsd":
            metrics[metric.metric_id] = extract_household_metric_from_results(
                metric_id=metric.metric_id,
                results_dir=seed_output_dir,
                was_data_root=was_data_root,
                was_dataset=validation_profile.was_dataset,
                window_start=resolved_window_start,
                window_end=resolved_window_end,
            )
        elif metric.kind == "household_share":
            metrics[metric.metric_id] = extract_household_share_from_results(
                metric_id=metric.metric_id,
                results_dir=seed_output_dir,
                window_start=resolved_window_start,
                window_end=resolved_window_end,
            )
        else:
            raise RuntimeError(f"Unsupported metric kind for {metric.metric_id}: {metric.kind}")
    return metrics


def _load_cached_seed_results(output_dir: Path) -> dict[int, dict[str, object]]:
    seed_results_path = output_dir / "validation_seed_results.csv"
    if not seed_results_path.exists():
        return {}

    cached: dict[int, dict[str, object]] = {}
    with seed_results_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            seed = int(row["seed"])
            cached.setdefault(
                seed,
                {
                    "outputDir": row.get("outputDir") or str(output_dir / f"seed-{seed}"),
                    "metrics": {},
                },
            )
            cached[seed]["metrics"][row["metricId"]] = float(row["value"])
    return cached


def _metric_seed_values(*, metric_id: str, seed_results: Sequence[dict[str, object]]) -> list[float]:
    values: list[float] = []
    for seed_result in seed_results:
        metrics = seed_result["metrics"]
        if metric_id not in metrics:
            raise RuntimeError(f"Missing metric {metric_id} in seed {seed_result['seed']}")
        values.append(float(metrics[metric_id]))
    return values


def score_existing_summary_against_targets(
    *,
    summary: Mapping[str, object],
    targets_by_id: Mapping[str, object],
    target_catalog: Sequence[MetricDefinition] | None = None,
) -> float:
    """Rescore an existing tracked summary against the supplied validation targets."""

    raw_metrics = summary.get("metrics")
    if not isinstance(raw_metrics, Sequence):
        raise RuntimeError("Existing validation summary is missing metrics")

    metrics_by_id = {
        str(metric["metricId"]): metric for metric in raw_metrics if isinstance(metric, Mapping) and "metricId" in metric
    }
    metric_ids = _ordered_metric_ids(
        seed_results=(),
        target_lookup=targets_by_id,
        target_catalog=target_catalog,
        metrics_by_id=metrics_by_id,
    )
    scored_metric_losses: list[float] = []
    scored_metric_weights: list[float] = []

    for metric_id in metric_ids:
        target = _coerce_target_definition(metric_id, targets_by_id.get(metric_id))
        if target.requirement != "required":
            continue
        if target.target_band is None:
            raise RuntimeError(f"Missing target metadata for required metric {target.metric_id}")

        existing_metric = metrics_by_id.get(metric_id)
        if existing_metric is None:
            raise RuntimeError(f"Existing validation summary is missing metric {metric_id}")

        if existing_metric.get("insideRate") is None:
            raise RuntimeError(f"Existing validation summary is missing insideRate for {metric_id}")

        source_value = (
            float(existing_metric["sourceValue"])
            if existing_metric.get("sourceValue") is not None
            else target.source_metadata.normalized_source_value
            if target.source_metadata
            else None
        )
        loss_audit = compute_metric_loss_audit(
            loss_family=target.loss_family,
            seed_mean=float(existing_metric["seedMean"]),
            p25=float(existing_metric["p25"]),
            p75=float(existing_metric["p75"]),
            lower_bound=target.target_band.lower,
            upper_bound=target.target_band.upper,
            inside_rate=float(existing_metric["insideRate"]),
            source_value=source_value,
        )
        scored_metric_losses.append(loss_audit.metric_loss)
        scored_metric_weights.append(1.0)

    return compute_overall_composite_loss(
        metric_losses=scored_metric_losses,
        metric_weights=scored_metric_weights,
    )


def publish_reference_validation_artifacts(
    *,
    repo_root: Path,
    version: str,
    output_dir: Path,
    run_results: Sequence[dict[str, object]],
    was_data_root: Path | None = None,
    window_start: int | None = None,
    window_end: int | None = None,
) -> dict | None:
    """Publish the tracked v0-family 2011 reference overlay plus transient audit artifacts."""

    reference_profile = resolve_reference_validation_profile(version)
    if reference_profile is None:
        return None

    resolved_window_start, resolved_window_end = _resolve_validation_window(
        window_start=window_start,
        window_end=window_end,
    )
    resolved_was_data_root = resolve_was_data_root(repo_root=repo_root, explicit_root=was_data_root)
    reference_seed_results = _extract_reference_seed_results_from_run_results(
        repo_root=repo_root,
        run_results=run_results,
        was_data_root=resolved_was_data_root,
        reference_profile=reference_profile,
        window_start=resolved_window_start,
        window_end=resolved_window_end,
    )
    return _write_reference_validation_artifacts(
        repo_root=repo_root,
        version=version,
        output_dir=output_dir,
        reference_seed_results=reference_seed_results,
        reference_profile=reference_profile,
        window_start=resolved_window_start,
        window_end=resolved_window_end,
    )


def _extract_reference_seed_results_from_run_results(
    *,
    repo_root: Path,
    run_results: Sequence[dict[str, object]],
    was_data_root: Path,
    reference_profile: ValidationProfile,
    window_start: int | None = None,
    window_end: int | None = None,
) -> list[dict[str, object]]:
    reference_seed_results: list[dict[str, object]] = []
    for tracked_seed_result in run_results:
        seed = int(tracked_seed_result["seed"])
        seed_output_dir = _resolve_output_dir_path(
            repo_root=repo_root,
            raw_path=str(tracked_seed_result["outputDir"]),
        )
        if not seed_output_dir.exists():
            raise RuntimeError(f"Missing tracked seed output directory for 2011 reference publication: {seed_output_dir}")
        reference_seed_results.append(
            {
                "seed": seed,
                "outputDir": str(seed_output_dir),
                "metrics": _extract_seed_metrics(
                    seed_output_dir=seed_output_dir,
                    was_data_root=was_data_root,
                    validation_profile=reference_profile,
                    window_start=window_start,
                    window_end=window_end,
                ),
            }
        )
    return reference_seed_results


def _extract_reference_seed_results_from_output_dir(
    *,
    output_dir: Path,
    seeds: Sequence[int],
    was_data_root: Path,
    reference_profile: ValidationProfile,
    window_start: int | None = None,
    window_end: int | None = None,
) -> list[dict[str, object]]:
    reference_seed_results: list[dict[str, object]] = []
    for seed in seeds:
        seed_output_dir = output_dir / f"seed-{seed}"
        if not seed_output_dir.exists():
            raise RuntimeError(f"Missing existing validation output directory: {seed_output_dir}")
        reference_seed_results.append(
            {
                "seed": seed,
                "outputDir": str(seed_output_dir),
                "metrics": _extract_seed_metrics(
                    seed_output_dir=seed_output_dir,
                    was_data_root=was_data_root,
                    validation_profile=reference_profile,
                    window_start=window_start,
                    window_end=window_end,
                ),
            }
        )
    return reference_seed_results


def _write_reference_validation_artifacts(
    *,
    repo_root: Path,
    version: str,
    output_dir: Path,
    reference_seed_results: Sequence[dict[str, object]],
    reference_profile: ValidationProfile,
    window_start: int | None = None,
    window_end: int | None = None,
) -> dict:
    seeds = [int(seed_result["seed"]) for seed_result in reference_seed_results]
    summary = build_validation_summary(
        version=version,
        seed_results=reference_seed_results,
        seeds=seeds,
        validation_profile=reference_profile,
        window_start=window_start,
        window_end=window_end,
    )
    summary["artifactType"] = "reference_overlay"
    summary["artifactLabel"] = _reference_artifact_label(version)
    summary["referenceSourceOutputDir"] = _display_repo_relative_path(
        repo_root=repo_root,
        path=output_dir,
    )
    write_transient_artifacts(
        output_dir=output_dir / REFERENCE_ARTIFACT_DIRNAME,
        summary=summary,
        seed_results=reference_seed_results,
    )
    write_validation_overlay_summary(
        repo_root=repo_root,
        overlay_name=reference_overlay_name(version),
        summary=summary,
    )
    return summary


def _ordered_metric_ids(
    *,
    seed_results: Sequence[dict[str, object]],
    target_lookup: Mapping[str, object],
    target_catalog: Sequence[MetricDefinition] | None = None,
    metrics_by_id: Mapping[str, object] | None = None,
) -> list[str]:
    seen = set()
    ordered = []
    catalog = target_catalog or tuple(
        _coerce_target_definition(metric_id, raw_target) for metric_id, raw_target in target_lookup.items()
    )
    for metric in catalog:
        if metric.metric_id in target_lookup:
            ordered.append(metric.metric_id)
            seen.add(metric.metric_id)
    if metrics_by_id is not None:
        metric_id_iterables = [metrics_by_id.keys()]
    else:
        metric_id_iterables = [seed_result["metrics"].keys() for seed_result in seed_results]
    for metric_ids in metric_id_iterables:
        for metric_id in metric_ids:
            if metric_id not in seen:
                if metric_id not in target_lookup:
                    raise RuntimeError(f"Missing target metadata for required metric {metric_id}")
                ordered.append(metric_id)
                seen.add(metric_id)
    return ordered


def _coerce_target_definition(metric_id: str, raw_target: object | None) -> MetricDefinition:
    if raw_target is None:
        raise RuntimeError(f"Missing target metadata for required metric {metric_id}")
    if isinstance(raw_target, MetricDefinition):
        return raw_target
    if not isinstance(raw_target, Mapping):
        raise RuntimeError(f"Missing target metadata for required metric {metric_id}")

    required_fields = {"metric_id", "label", "requirement", "units", "source_label", "kind", "loss_family"}
    missing_fields = sorted(field for field in required_fields if field not in raw_target)
    if missing_fields:
        raise RuntimeError(f"Missing target metadata for required metric {metric_id}: {missing_fields}")

    target_band = raw_target.get("target_band")
    return MetricDefinition(
        metric_id=str(raw_target["metric_id"]),
        label=str(raw_target["label"]),
        requirement=str(raw_target["requirement"]),
        units=str(raw_target["units"]),
        source_label=str(raw_target["source_label"]),
        kind=str(raw_target["kind"]),
        loss_family=str(raw_target["loss_family"]),
        source_metadata=_coerce_source_metadata(raw_target.get("source_metadata")),
        target_band=target_band,
        file_name=raw_target.get("file_name"),
        legacy_validation_module=raw_target.get("legacy_validation_module"),
    )


def _inside_rate(*, seed_values: Sequence[float], lower: float, upper: float) -> float:
    inside = sum(1 for value in seed_values if lower <= value <= upper)
    return inside / len(seed_values)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _coerce_source_metadata(raw_source_metadata: object | None) -> MetricSourceMetadata | None:
    if raw_source_metadata is None:
        return None
    if isinstance(raw_source_metadata, MetricSourceMetadata):
        return raw_source_metadata
    if not isinstance(raw_source_metadata, Mapping):
        raise RuntimeError("Invalid source metadata object")
    return MetricSourceMetadata(
        source_document_path=str(raw_source_metadata["source_document_path"]),
        source_text_path=str(raw_source_metadata["source_text_path"]),
        source_table=str(raw_source_metadata["source_table"]),
        source_page=int(raw_source_metadata["source_page"]),
        source_indicator_label=str(raw_source_metadata["source_indicator_label"]),
        raw_source_value=(
            None if raw_source_metadata.get("raw_source_value") is None else float(raw_source_metadata["raw_source_value"])
        ),
        normalized_source_value=(
            None
            if raw_source_metadata.get("normalized_source_value") is None
            else float(raw_source_metadata["normalized_source_value"])
        ),
        source_units=str(raw_source_metadata["source_units"]),
        comparison_units=str(raw_source_metadata["comparison_units"]),
        source_as_of=(
            None if raw_source_metadata.get("source_as_of") is None else str(raw_source_metadata["source_as_of"])
        ),
        mapping_status=str(raw_source_metadata["mapping_status"]),
        band_method=(
            None if raw_source_metadata.get("band_method") is None else str(raw_source_metadata["band_method"])
        ),
        band_notes=None if raw_source_metadata.get("band_notes") is None else str(raw_source_metadata["band_notes"]),
        source_references=tuple(
            _coerce_source_reference(raw_source_reference)
            for raw_source_reference in raw_source_metadata.get("source_references", ())
        ),
    )


def _coerce_source_reference(raw_source_reference: object) -> MetricSourceReference:
    if isinstance(raw_source_reference, MetricSourceReference):
        return raw_source_reference
    if not isinstance(raw_source_reference, Mapping):
        raise RuntimeError("Invalid source reference object")
    return MetricSourceReference(
        label=str(raw_source_reference["label"]),
        source_document_path=str(raw_source_reference["source_document_path"]),
        source_text_path=(
            None
            if raw_source_reference.get("source_text_path") is None
            else str(raw_source_reference["source_text_path"])
        ),
        source_table=(
            None if raw_source_reference.get("source_table") is None else str(raw_source_reference["source_table"])
        ),
        source_page=(
            None if raw_source_reference.get("source_page") is None else int(raw_source_reference["source_page"])
        ),
        source_indicator_label=(
            None
            if raw_source_reference.get("source_indicator_label") is None
            else str(raw_source_reference["source_indicator_label"])
        ),
        raw_source_value=(
            None if raw_source_reference.get("raw_source_value") is None else float(raw_source_reference["raw_source_value"])
        ),
        source_as_of=(
            None if raw_source_reference.get("source_as_of") is None else str(raw_source_reference["source_as_of"])
        ),
        source_units=(
            None if raw_source_reference.get("source_units") is None else str(raw_source_reference["source_units"])
        ),
        notes=None if raw_source_reference.get("notes") is None else str(raw_source_reference["notes"]),
    )


def _serialize_source_reference(reference: MetricSourceReference) -> dict[str, object]:
    return {
        "label": reference.label,
        "sourceDocumentPath": reference.source_document_path,
        "sourceTextPath": reference.source_text_path,
        "sourceTable": reference.source_table,
        "sourcePage": reference.source_page,
        "sourceIndicatorLabel": reference.source_indicator_label,
        "rawSourceValue": reference.raw_source_value,
        "sourceAsOf": reference.source_as_of,
        "sourceUnits": reference.source_units,
        "notes": reference.notes,
    }


def _display_repo_relative_path(*, repo_root: Path, path: Path) -> str:
    try:
        return path.relative_to(repo_root).as_posix()
    except ValueError:
        return path.as_posix()


def _resolve_output_dir_path(*, repo_root: Path, raw_path: str) -> Path:
    path = Path(raw_path)
    if path.is_absolute():
        return path
    return repo_root / path
