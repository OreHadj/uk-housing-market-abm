"""Fail-closed provenance for retained validation null-control outputs.

The model outputs and the code that scores them have different lifetimes.  This module seals the
former without attributing a later checkout, validation catalogue, or shell environment to their
generation.  Its manifests intentionally contain no timestamp or absolute path, so the same inputs
produce the same manifest bytes.

The seal is an integrity check, not a signature.  It protects against accidental edits and makes
coordinated replacement of a manifest and its artifacts visible wherever the manifest SHA-256 has
been recorded, but it does not establish trust against a malicious writer with access to both.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Mapping, Sequence


SCHEMA_VERSION = 1
ARTIFACT_TYPE = "validation-null-control-generation"
NATIVE_PROVENANCE_CLASS = "native-verified"
LEGACY_PROVENANCE_CLASS = "legacy-attested"
MANIFEST_FILENAME = "generation-manifest.json"
SEAL_FILENAME = "generation-manifest.sha256"

_SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")
_SEED_DIRECTORY_PATTERN = re.compile(r"seed-([0-9]+)")
_SEED_CONFIG_PATTERN = re.compile(r"seed-([0-9]+)\.properties")
_EXPECTED_RNG_METADATA = {
    "mersenne": {
        "rngAlgorithm": "MersenneTwister",
        "rngAddressVersion": "none",
    },
    "philox-household": {
        "rngAlgorithm": "MersenneTwister+Philox4x32-10",
        "rngAddressVersion": "1",
    },
}
# Materialized inputs for every metric in the supported v5o3 scoring profile.  Keep this module
# independent of the NumPy/pandas scoring stack; the contract test derives the same set from the
# profile and extractor mappings so additions or filename changes fail loudly.
V5O3_REQUIRED_SEED_OUTPUT_FILES = (
    "BankBalance-run1.csv",
    "HousingStatus-run1.csv",
    "HousingWealth-run1.csv",
    "MonthlyGrossEmploymentIncome-run1.csv",
    "Output-run1.csv",
    "coreIndicator-advancesToBTL.csv",
    "coreIndicator-advancesToFTB.csv",
    "coreIndicator-advancesToHM.csv",
    "coreIndicator-debtToIncome.csv",
    "coreIndicator-housePriceGrowth.csv",
    "coreIndicator-housingTransactions.csv",
    "coreIndicator-interestRateSpread.csv",
    "coreIndicator-mortgageApprovals.csv",
    "coreIndicator-ooDebtToIncome.csv",
    "coreIndicator-priceToIncome.csv",
    "coreIndicator-rentalYield.csv",
)

LEGACY_RUNTIME_CAVEAT = (
    "Generation commit and runtime identity are operator-attested from retained records; they "
    "were not captured from process metadata at generation time."
)
LEGACY_HASH_TIMING_CAVEAT = (
    "Artifact hashes were computed during legacy adoption, not at the original generation time."
)


class ProvenanceError(RuntimeError):
    """Raised when provenance is absent, inconsistent, or cannot be verified."""


@dataclass(frozen=True)
class LegacyAttestation:
    """Explicit evidence required to adopt outputs that predate native generation manifests."""

    version: str
    seeds: tuple[int, ...]
    n_steps: int
    n_sims: int
    target_population: int
    runtime_metadata: Mapping[str, str]
    attested_commit: str
    attested_tree: str
    attested_branch: str
    evidence_record_relative_path: str
    anchor_relative_path: str
    anchor_sha256: str
    statement: str
    anchor_size_bytes: int | None = None
    additional_anchors: tuple[tuple[str, int, str], ...] = ()
    attested_generation_inputs: tuple[tuple[str, int, str], ...] = ()
    additional_caveats: tuple[str, ...] = ()


RETAINED_2026_08_14_ATTESTATION = LegacyAttestation(
    version="v5o3",
    seeds=tuple(range(1, 161)),
    n_steps=2000,
    n_sims=1,
    target_population=10000,
    runtime_metadata={
        "orderBook": "array",
        "rngMode": "mersenne",
        "rngAlgorithm": "MersenneTwister",
        "rngAddressVersion": "none",
    },
    attested_commit="b07fd6b6c7cdb08cb7e5d1c22767c86753dd0608",
    attested_tree="5ce8546a2f5f7f707946cc393adb46d11d6177fc",
    attested_branch="orestes/gpu-acceleration",
    evidence_record_relative_path="docs/rng/baselines/pre-philox-mersenne-control.json",
    anchor_relative_path="summary.json",
    anchor_sha256="75dc853b0f02d91e6f8bbe4326056b72fc23fcdb411beb89da63710ae0cd5baa",
    anchor_size_bytes=25325,
    additional_anchors=(
        (
            "run-full.log",
            13326,
            "90323f52fbe916d6303378295cc0167c4de016ce0455e53b2876172003eeb837",
        ),
    ),
    statement=(
        "Identity is attested by the retained 2026-08-14 run-full.log and the matching "
        "GPU_RESULTS_LOG.md entry."
    ),
    attested_generation_inputs=(
        (
            "input-data-versions/v5o3/Age15-FRS-2023-24-Weighted.csv",
            545,
            "1ed2a0fc22acdb1d5e089163354f603104bc17e581ab74a0d8efd0acb8275ce4",
        ),
        (
            "input-data-versions/v5o3/AgeGrossIncomeJointDist.csv",
            26571,
            "5f2b42a127e004dfca2e56cdf5f4a4b85ed086a56077181804ade66d7a164b04",
        ),
        (
            "input-data-versions/v5o3/BTLProbabilityPerIncomePercentileBin-R8.csv",
            3204,
            "5bc38aaa093b6433aaae4a75a0c165f4a268ba2164f12c37145e2a0f298d2a6d",
        ),
        (
            "input-data-versions/v5o3/GrossIncomeNetWealthJointDist.csv",
            46860,
            "5adc87e31ed856fe20b7bd243f13534b31aa94e4653b45d5d3f8264d8daabbb5",
        ),
        (
            "input-data-versions/v5o3/InitialRentMarkUpDist.csv",
            2492,
            "d80f160a9a3a35262674fb9b80a7a2ac3884cb0b3a4267014369c3c46e720846",
        ),
        (
            "input-data-versions/v5o3/InitialSaleMarkUpDist.csv",
            2479,
            "51f7914d206368195a823cfd063f9679a5fc9f195c2cfbc8b0a80808b4b65e0c",
        ),
        (
            "input-data-versions/v5o3/NationalInsuranceRates.csv",
            357,
            "2b95184a86a41c0800186a69fd1d58200361c19c4318b3324ea7710b0f860bde",
        ),
        (
            "input-data-versions/v5o3/TaxRates.csv",
            373,
            "4a00235f9c7d1a6ca57b1d39c905a7513db32f7a28ad86b19c511048cc447ba4",
        ),
        (
            "input-data-versions/v5o3/config.properties",
            41748,
            "31c19b3f0e47758a43ec2c8fb0d1598ee1e8cb620e45b2707fd7cbf02c7772c5",
        ),
    ),
    additional_caveats=(
        "The original working-tree cleanliness and exact uncommitted source bytes are unknown.",
    ),
)


def sha256_file(path: Path) -> str:
    """Return a stable SHA-256 for one regular, non-symlink file."""

    return _fingerprint_file(Path(path))[1]


def fingerprint_files(files: Mapping[str, Path]) -> list[dict[str, object]]:
    """Fingerprint caller-named files without recording machine-specific absolute paths."""

    if not files:
        raise ProvenanceError("At least one named input file is required")

    rows: list[dict[str, object]] = []
    seen: set[str] = set()
    for raw_name, raw_path in files.items():
        name = _normalized_relative_path(raw_name, label="input path")
        if name in seen:
            raise ProvenanceError(f"Duplicate input path: {name}")
        seen.add(name)
        size_bytes, digest = _fingerprint_file(Path(raw_path))
        rows.append({"path": name, "sizeBytes": size_bytes, "sha256": digest})
    rows.sort(key=lambda row: str(row["path"]))
    return rows


def verify_files_unchanged(
    files: Mapping[str, Path],
    initial_snapshot: Sequence[Mapping[str, object]],
    *,
    label: str,
) -> list[dict[str, object]]:
    """Verify an input set still exactly matches a snapshot captured before an operation."""

    initial = _normalized_file_snapshot(initial_snapshot, label=label)
    current = fingerprint_files(files)
    if current != initial:
        initial_by_path = {str(row["path"]): row for row in initial}
        current_by_path = {str(row["path"]): row for row in current}
        changed = sorted(
            path
            for path in set(initial_by_path) | set(current_by_path)
            if initial_by_path.get(path) != current_by_path.get(path)
        )
        raise ProvenanceError(
            f"{label} changed while the operation was running: {changed[:10]}"
        )
    return initial


def verify_legacy_evidence_record(
    evidence_record_path: Path,
    *,
    attestation: LegacyAttestation,
) -> dict[str, object]:
    """Cross-check the tracked legacy record and return its stable manifest fingerprint."""

    logical_path = _normalized_relative_path(
        attestation.evidence_record_relative_path,
        label="legacy evidence-record path",
    )
    path = Path(evidence_record_path)
    logical_parts = PurePosixPath(logical_path).parts
    if tuple(path.parts[-len(logical_parts) :]) != logical_parts:
        raise ProvenanceError(
            f"Legacy evidence record path must end with {logical_path}, got {path}"
        )
    record_bytes, size_bytes, digest = _read_stable_bytes(path)
    try:
        record = json.loads(
            record_bytes.decode("utf-8"),
            object_pairs_hook=_unique_json_object,
        )
    except (UnicodeError, json.JSONDecodeError, ProvenanceError) as error:
        raise ProvenanceError(f"Invalid legacy evidence record JSON: {error}") from error
    if not isinstance(record, Mapping):
        raise ProvenanceError("Legacy evidence record root must be an object")

    source = _required_mapping(record, "source", label="legacy evidence record")
    control = _required_mapping(record, "nullControl20260814", label="legacy evidence record")
    integrity = _required_mapping(control, "artifactIntegrity", label="legacy null control")
    expected_runtime = _normalized_runtime(attestation.runtime_metadata)
    seeds = _normalized_seeds(attestation.seeds)
    if seeds != tuple(range(seeds[0], seeds[-1] + 1)):
        raise ProvenanceError(
            "Tracked legacy record represents one contiguous seed range; "
            "attested seeds are not contiguous"
        )

    mismatches: list[str] = []

    def compare(label: str, observed: object, expected: object) -> None:
        if type(observed) is not type(expected) or observed != expected:
            mismatches.append(f"{label} expected={expected!r} recorded={observed!r}")

    compare("schemaVersion", record.get("schemaVersion"), 1)
    compare("source.commit", source.get("commit"), attestation.attested_commit)
    compare("source.tree", source.get("tree"), attestation.attested_tree)
    compare("source.branch", source.get("branch"), attestation.attested_branch)
    compare("null.version", control.get("version"), attestation.version)
    compare("null.orderbook", control.get("orderbook"), expected_runtime["orderBook"])
    compare(
        "null.generator",
        control.get("generator"),
        "Legacy MersenneTwister" if expected_runtime["rngMode"] == "mersenne" else None,
    )
    compare("null.targetPopulation", control.get("targetPopulation"), attestation.target_population)
    compare("null.steps", control.get("steps"), attestation.n_steps)
    compare("null.firstSeed", control.get("firstSeed"), seeds[0])
    compare("null.lastSeed", control.get("lastSeed"), seeds[-1])
    compare("null.seedDirectories", integrity.get("seedDirectories"), len(seeds))
    compare("null.outputRun1Files", integrity.get("outputRun1Files"), len(seeds))
    gate2_counts = integrity.get("gate2InputFiles")
    if not isinstance(gate2_counts, Mapping):
        mismatches.append("artifactIntegrity.gate2InputFiles is not an object")
    else:
        expected_gate2_names = {
            "MonthlyGrossEmploymentIncome-run1.csv",
            "HousingWealth-run1.csv",
            "BankBalance-run1.csv",
        }
        if set(gate2_counts) != expected_gate2_names:
            mismatches.append(
                "artifactIntegrity.gate2InputFiles fields differ: "
                f"expected={sorted(expected_gate2_names)} recorded={sorted(gate2_counts)}"
            )
        for file_name in sorted(expected_gate2_names):
            compare(
                f"artifactIntegrity.gate2InputFiles.{file_name}",
                gate2_counts.get(file_name),
                len(seeds),
            )
    compare("null.gate2InputsComplete", integrity.get("gate2InputsComplete"), True)
    sets = control.get("sets")
    seeds_per_set = control.get("seedsPerSet")
    if (
        not isinstance(sets, int)
        or isinstance(sets, bool)
        or not isinstance(seeds_per_set, int)
        or isinstance(seeds_per_set, bool)
        or sets <= 0
        or seeds_per_set <= 0
        or sets * seeds_per_set != len(seeds)
    ):
        mismatches.append(
            "null sets/seedsPerSet do not describe the attested seed count "
            f"({sets!r} x {seeds_per_set!r} versus {len(seeds)})"
        )

    primary_path = _normalized_relative_path(
        attestation.anchor_relative_path, label="legacy primary anchor path"
    )
    additional_hashes = {
        _normalized_relative_path(raw_path, label="legacy additional anchor path"):
        _normalized_sha256(raw_sha, label=f"legacy anchor SHA-256 for {raw_path}")
        for raw_path, _raw_size, raw_sha in attestation.additional_anchors
    }
    if primary_path != "summary.json":
        mismatches.append(
            f"tracked record primary anchor expected='summary.json' attested={primary_path!r}"
        )
    compare(
        "artifactIntegrity.summarySha256",
        integrity.get("summarySha256"),
        _normalized_sha256(
            attestation.anchor_sha256, label="legacy summary anchor SHA-256"
        ),
    )
    compare(
        "artifactIntegrity.runFullLogSha256",
        integrity.get("runFullLogSha256"),
        additional_hashes.get("run-full.log"),
    )
    if set(additional_hashes) != {"run-full.log"}:
        mismatches.append(
            "tracked record requires exactly one additional anchor named run-full.log"
        )
    if mismatches:
        raise ProvenanceError(
            "Legacy evidence record disagrees with the attestation:\n" + "\n".join(mismatches)
        )
    return {
        "path": logical_path,
        "sizeBytes": size_bytes,
        "sha256": digest,
    }


def preflight_fresh_generation(output_dir: Path, *, seeds: Sequence[int]) -> None:
    """Refuse a fresh run that would overwrite any retained generation namespace."""

    root = Path(output_dir)
    normalized_seeds = _normalized_seeds(seeds)
    manifest_path = root / MANIFEST_FILENAME
    seal_path = root / SEAL_FILENAME
    if manifest_path.exists() or seal_path.exists():
        raise ProvenanceError(
            f"Refusing to overwrite sealed generation in {root}; choose a new output directory"
        )
    if not root.exists():
        return
    if root.is_symlink() or not root.is_dir():
        raise ProvenanceError(f"Output root is not a real directory: {root}")

    occupied: list[str] = []
    for child in root.iterdir():
        if child.name.startswith("seed-"):
            occupied.append(child.name)
    configs_dir = root / "configs"
    if configs_dir.exists():
        if configs_dir.is_symlink() or not configs_dir.is_dir():
            raise ProvenanceError(f"Generation config path is not a real directory: {configs_dir}")
        occupied.extend(f"configs/{child.name}" for child in configs_dir.iterdir())

    if occupied:
        preview = ", ".join(sorted(occupied)[:5])
        suffix = " ..." if len(occupied) > 5 else ""
        raise ProvenanceError(
            "Refusing to overwrite existing generation artifacts "
            f"in {root}: {preview}{suffix} (requested seeds: {list(normalized_seeds)})"
        )


def seal_native_generation(
    output_dir: Path,
    *,
    version: str,
    seeds: Sequence[int],
    n_steps: int,
    runtime_metadata: Mapping[str, str],
    git_provenance: Mapping[str, object],
    generation_inputs: Mapping[str, Path],
    generation_input_snapshot: Sequence[Mapping[str, object]],
) -> dict[str, object]:
    """Seal a completed native generation and return its validated descriptor."""

    root = Path(output_dir)
    normalized_version = _normalized_version(version)
    normalized_seeds = _normalized_seeds(seeds)
    normalized_n_steps = _normalized_n_steps(n_steps)
    normalized_runtime = _normalized_runtime(runtime_metadata)
    normalized_git = _normalized_native_git(git_provenance)
    inputs = verify_files_unchanged(
        generation_inputs,
        generation_input_snapshot,
        label="Generation inputs",
    )
    materialized_config = _verify_seed_configs(root, normalized_seeds, normalized_n_steps)
    artifacts = _build_generation_artifacts(root, normalized_seeds)

    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "artifactType": ARTIFACT_TYPE,
        "provenanceClass": NATIVE_PROVENANCE_CLASS,
        "generation": {
            "version": normalized_version,
            "seeds": list(normalized_seeds),
            "nSteps": normalized_n_steps,
            "config": materialized_config,
            "runtime": normalized_runtime,
            "git": normalized_git,
            "inputs": inputs,
        },
        "artifacts": {
            "algorithm": "sha256",
            "fileCount": len(artifacts),
            "hashTiming": "post-generation-seal",
            "files": artifacts,
        },
        "caveats": [],
    }
    descriptor = _persist_manifest(root, manifest)
    descriptor["validatedSeeds"] = list(normalized_seeds)
    descriptor["warnings"] = []
    return descriptor


def adopt_legacy_generation(
    output_dir: Path,
    *,
    attestation: LegacyAttestation,
    evidence_record_path: Path,
) -> dict[str, object]:
    """Explicitly seal legacy outputs after checking their external evidence anchor."""

    root = Path(output_dir)
    version = _normalized_version(attestation.version)
    seeds = _normalized_seeds(attestation.seeds)
    n_steps = _normalized_n_steps(attestation.n_steps)
    n_sims = _normalized_positive_int(attestation.n_sims, label="N_SIMS")
    target_population = _normalized_positive_int(
        attestation.target_population, label="TARGET_POPULATION"
    )
    runtime = _normalized_runtime(attestation.runtime_metadata)
    commit = _normalized_git_oid(attestation.attested_commit, label="attested commit")
    tree = _normalized_git_oid(attestation.attested_tree, label="attested tree")
    branch = _normalized_nonempty_string(attestation.attested_branch, "attested branch")
    statement = _normalized_nonempty_string(attestation.statement, "attestation statement")
    manifest_path = root / MANIFEST_FILENAME
    seal_path = root / SEAL_FILENAME
    if manifest_path.exists() or seal_path.exists():
        raise ProvenanceError(f"Legacy generation is already sealed in {root}")

    evidence_record = verify_legacy_evidence_record(
        evidence_record_path,
        attestation=attestation,
    )
    anchors = _verify_legacy_anchors(root, attestation)

    attested_inputs = _normalized_attested_inputs(attestation.attested_generation_inputs)
    materialized_config = _verify_seed_configs(
        root,
        seeds,
        n_steps,
        expected_n_sims=n_sims,
        expected_target_population=target_population,
    )
    artifacts = _build_generation_artifacts(root, seeds)
    caveats = _normalized_caveats(
        (
            LEGACY_RUNTIME_CAVEAT,
            LEGACY_HASH_TIMING_CAVEAT,
            *attestation.additional_caveats,
        )
    )
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "artifactType": ARTIFACT_TYPE,
        "provenanceClass": LEGACY_PROVENANCE_CLASS,
        "generation": {
            "version": version,
            "seeds": list(seeds),
            "nSteps": n_steps,
            "config": materialized_config,
            "runtime": runtime,
            "git": {
                "commit": commit,
                "tree": tree,
                "branch": branch,
                "dirty": "unknown",
            },
            "inputs": attested_inputs,
        },
        "artifacts": {
            "algorithm": "sha256",
            "fileCount": len(artifacts),
            "hashTiming": "legacy-adoption",
            "files": artifacts,
        },
        "attestation": {
            "statement": statement,
            "evidenceRecord": evidence_record,
            "anchors": anchors,
        },
        "caveats": caveats,
    }
    descriptor = _persist_manifest(root, manifest)
    descriptor["validatedSeeds"] = list(seeds)
    descriptor["warnings"] = caveats
    return descriptor


def validate_generation_for_reuse(
    output_dir: Path,
    *,
    requested_seeds: Sequence[int],
    expected_version: str,
    expected_order_book: str,
    expected_rng_mode: str,
    expected_n_steps: int | None = None,
    expected_n_sims: int | None = None,
    expected_target_population: int | None = None,
    scoring_window_end: int | None = None,
    expected_generation_input_hashes: Mapping[str, str] | None = None,
) -> dict[str, object]:
    """Validate a requested seed subset before any retained result is loaded or scored."""

    root = Path(output_dir)
    requested = _normalized_seeds(requested_seeds)
    expected_version_value = _normalized_version(expected_version)
    expected_runtime = _expected_runtime_identity(expected_order_book, expected_rng_mode)
    manifest, manifest_sha = _load_sealed_manifest(root)
    generation = manifest["generation"]
    generation_seeds = tuple(generation["seeds"])

    mismatches: list[str] = []
    if generation["version"] != expected_version_value:
        mismatches.append(
            f"version requested={expected_version_value} recorded={generation['version']}"
        )
    for field_name in ("orderBook", "rngMode", "rngAlgorithm", "rngAddressVersion"):
        if generation["runtime"][field_name] != expected_runtime[field_name]:
            mismatches.append(
                f"{field_name} requested={expected_runtime[field_name]} "
                f"recorded={generation['runtime'][field_name]}"
            )
    missing_seeds = sorted(set(requested) - set(generation_seeds))
    if missing_seeds:
        mismatches.append(f"requested seeds absent from generation: {missing_seeds}")
    if expected_n_steps is not None:
        requested_n_steps = _normalized_n_steps(expected_n_steps)
        if generation["nSteps"] != requested_n_steps:
            mismatches.append(
                f"N_STEPS requested={requested_n_steps} recorded={generation['nSteps']}"
            )
    if expected_n_sims is not None:
        requested_n_sims = _normalized_positive_int(expected_n_sims, label="expected N_SIMS")
        if generation["config"]["nSims"] != requested_n_sims:
            mismatches.append(
                f"N_SIMS requested={requested_n_sims} "
                f"recorded={generation['config']['nSims']}"
            )
    if expected_target_population is not None:
        requested_population = _normalized_positive_int(
            expected_target_population, label="expected TARGET_POPULATION"
        )
        if generation["config"]["targetPopulation"] != requested_population:
            mismatches.append(
                f"TARGET_POPULATION requested={requested_population} "
                f"recorded={generation['config']['targetPopulation']}"
            )
    if scoring_window_end is not None:
        if scoring_window_end <= 0:
            raise ProvenanceError("scoring_window_end must be positive")
        if scoring_window_end > generation["nSteps"]:
            mismatches.append(
                f"scoring window end={scoring_window_end} exceeds generated "
                f"N_STEPS={generation['nSteps']}"
            )
    if expected_generation_input_hashes is not None:
        recorded_hashes = {
            row["path"]: row["sha256"] for row in generation["inputs"]
        }
        normalized_expected_hashes: dict[str, str] = {}
        for raw_path, raw_digest in expected_generation_input_hashes.items():
            input_path = _normalized_relative_path(raw_path, label="expected input path")
            expected_digest = _normalized_sha256(
                raw_digest, label=f"expected SHA-256 for {input_path}"
            )
            if input_path in normalized_expected_hashes:
                raise ProvenanceError(f"Duplicate normalized expected input path: {input_path}")
            normalized_expected_hashes[input_path] = expected_digest
            observed_digest = recorded_hashes.get(input_path)
            if observed_digest is None:
                mismatches.append(f"generation input not recorded: {input_path}")
            elif observed_digest != expected_digest:
                mismatches.append(
                    f"generation input {input_path} requested={expected_digest} "
                    f"recorded={observed_digest}"
                )
        version_prefix = f"input-data-versions/{expected_version_value}/"
        recorded_version_paths = {
            path for path in recorded_hashes if path.startswith(version_prefix)
        }
        expected_version_paths = {
            path for path in normalized_expected_hashes if path.startswith(version_prefix)
        }
        if recorded_version_paths != expected_version_paths:
            mismatches.append(
                "generation version-input path set differs from the current snapshot: "
                f"missing-current={sorted(recorded_version_paths - expected_version_paths)} "
                f"unrecorded-current={sorted(expected_version_paths - recorded_version_paths)}"
            )
    if mismatches:
        raise ProvenanceError("Generation provenance mismatch:\n" + "\n".join(mismatches))

    _validate_seed_inventory(root, generation_seeds)
    _verify_seed_configs(
        root,
        requested,
        generation["nSteps"],
        expected_n_sims=generation["config"]["nSims"],
        expected_target_population=generation["config"]["targetPopulation"],
    )
    _verify_artifact_subset(root, manifest, requested)

    caveats = list(manifest["caveats"])
    return {
        "manifest": manifest,
        "manifestPath": MANIFEST_FILENAME,
        "sealPath": SEAL_FILENAME,
        "manifestSha256": manifest_sha,
        "provenanceClass": manifest["provenanceClass"],
        "validatedSeeds": list(requested),
        "warnings": caveats,
    }


def compact_generation_reference(validated: Mapping[str, object]) -> dict[str, object]:
    """Return the immutable generation identity suitable for embedding in a score summary."""

    manifest = validated.get("manifest")
    if not isinstance(manifest, Mapping):
        raise ProvenanceError("Validated generation descriptor is missing its manifest")
    manifest_sha = _normalized_sha256(
        str(validated.get("manifestSha256", "")), label="manifest SHA-256"
    )
    _validate_manifest_structure(dict(manifest))
    generation = manifest["generation"]
    warnings = validated.get("warnings", manifest["caveats"])
    if not isinstance(warnings, Sequence) or isinstance(warnings, (str, bytes)):
        raise ProvenanceError("Validated generation warnings must be a sequence")
    normalized_warnings = _normalized_caveats(tuple(str(item) for item in warnings))
    seeds = generation["seeds"]
    return {
        "manifestPath": str(validated.get("manifestPath", MANIFEST_FILENAME)),
        "manifestSha256": manifest_sha,
        "schemaVersion": manifest["schemaVersion"],
        "provenanceClass": manifest["provenanceClass"],
        "version": generation["version"],
        "seedCount": len(seeds),
        "firstSeed": seeds[0],
        "lastSeed": seeds[-1],
        "nSteps": generation["nSteps"],
        "config": copy.deepcopy(generation["config"]),
        "runtime": copy.deepcopy(generation["runtime"]),
        "git": copy.deepcopy(generation["git"]),
        "warnings": normalized_warnings,
    }


def build_scoring_provenance(
    *,
    git_provenance: Mapping[str, object],
    scoring_config: Mapping[str, object],
    scoring_inputs: Mapping[str, Path],
    scoring_input_snapshot: Sequence[Mapping[str, object]],
    ambient_maven_opts: str = "",
) -> dict[str, object]:
    """Build current scoring identity without mutating or relabelling generation provenance."""

    normalized_git = _normalized_native_git(git_provenance)
    normalized_config = _json_mapping(scoring_config, label="scoring config")
    return {
        "git": normalized_git,
        "config": normalized_config,
        "inputs": verify_files_unchanged(
            scoring_inputs,
            scoring_input_snapshot,
            label="Scoring inputs",
        ),
        "ambientMavenOpts": str(ambient_maven_opts),
    }


def _persist_manifest(root: Path, manifest: dict[str, object]) -> dict[str, object]:
    root.mkdir(parents=True, exist_ok=True)
    if root.is_symlink() or not root.is_dir():
        raise ProvenanceError(f"Output root is not a real directory: {root}")
    manifest_path = root / MANIFEST_FILENAME
    seal_path = root / SEAL_FILENAME
    if manifest_path.exists() or seal_path.exists():
        raise ProvenanceError(f"Generation provenance already exists in {root}")

    _validate_manifest_structure(copy.deepcopy(manifest))
    manifest_bytes = _canonical_json_bytes(manifest)
    digest = hashlib.sha256(manifest_bytes).hexdigest()
    seal_bytes = f"{digest}  {MANIFEST_FILENAME}\n".encode("ascii")
    wrote_manifest = False
    try:
        _write_new_file(manifest_path, manifest_bytes)
        wrote_manifest = True
        _write_new_file(seal_path, seal_bytes)
    except Exception:
        if wrote_manifest and not seal_path.exists():
            try:
                manifest_path.unlink()
            except OSError:
                pass
        raise

    return {
        "manifest": copy.deepcopy(manifest),
        "manifestPath": MANIFEST_FILENAME,
        "sealPath": SEAL_FILENAME,
        "manifestSha256": digest,
        "provenanceClass": manifest["provenanceClass"],
    }


def _load_sealed_manifest(root: Path) -> tuple[dict[str, object], str]:
    manifest_path = root / MANIFEST_FILENAME
    seal_path = root / SEAL_FILENAME
    if not manifest_path.is_file() or not seal_path.is_file():
        raise ProvenanceError(
            f"Reusable generation requires both {MANIFEST_FILENAME} and {SEAL_FILENAME} in {root}"
        )
    if manifest_path.is_symlink() or seal_path.is_symlink():
        raise ProvenanceError("Generation provenance files must not be symlinks")

    manifest_bytes = manifest_path.read_bytes()
    observed_digest = hashlib.sha256(manifest_bytes).hexdigest()
    expected_seal = f"{observed_digest}  {MANIFEST_FILENAME}\n"
    try:
        seal_text = seal_path.read_text(encoding="ascii")
    except (OSError, UnicodeError) as error:
        raise ProvenanceError(f"Could not read generation seal: {error}") from error
    if seal_text != expected_seal:
        raise ProvenanceError(
            f"Generation manifest seal mismatch for {manifest_path}; expected digest "
            f"{observed_digest}"
        )

    try:
        manifest = json.loads(manifest_bytes.decode("utf-8"), object_pairs_hook=_unique_json_object)
    except (UnicodeError, json.JSONDecodeError, ProvenanceError) as error:
        raise ProvenanceError(f"Invalid generation manifest JSON: {error}") from error
    if not isinstance(manifest, dict):
        raise ProvenanceError("Generation manifest root must be an object")
    if manifest_bytes != _canonical_json_bytes(manifest):
        raise ProvenanceError("Generation manifest is not in canonical deterministic form")
    _validate_manifest_structure(manifest)
    return manifest, observed_digest


def _validate_manifest_structure(manifest: dict[str, object]) -> None:
    provenance_class = manifest.get("provenanceClass")
    expected_root_keys = {
        "schemaVersion",
        "artifactType",
        "provenanceClass",
        "generation",
        "artifacts",
        "caveats",
    }
    if provenance_class == LEGACY_PROVENANCE_CLASS:
        expected_root_keys.add("attestation")
    _require_exact_keys(manifest, expected_root_keys, label="generation manifest")
    if (
        not isinstance(manifest.get("schemaVersion"), int)
        or isinstance(manifest.get("schemaVersion"), bool)
        or manifest.get("schemaVersion") != SCHEMA_VERSION
    ):
        raise ProvenanceError(
            f"Unsupported generation manifest schema: {manifest.get('schemaVersion')!r}"
        )
    if manifest.get("artifactType") != ARTIFACT_TYPE:
        raise ProvenanceError(
            f"Unexpected generation artifact type: {manifest.get('artifactType')!r}"
        )
    if provenance_class not in {NATIVE_PROVENANCE_CLASS, LEGACY_PROVENANCE_CLASS}:
        raise ProvenanceError(f"Unsupported provenance class: {provenance_class!r}")

    generation = manifest.get("generation")
    if not isinstance(generation, dict):
        raise ProvenanceError("Generation manifest is missing generation identity")
    _require_exact_keys(
        generation,
        {"version", "seeds", "nSteps", "config", "runtime", "git", "inputs"},
        label="generation identity",
    )
    generation["version"] = _normalized_version(generation.get("version"))
    generation["seeds"] = list(_normalized_seeds(generation.get("seeds", ())))
    generation["nSteps"] = _normalized_n_steps(generation.get("nSteps"))
    config = generation.get("config")
    if not isinstance(config, Mapping):
        raise ProvenanceError("Generation manifest is missing materialized config semantics")
    _require_exact_keys(
        config,
        {"nSteps", "nSims", "targetPopulation"},
        label="materialized config semantics",
    )
    normalized_config = {
        "nSteps": _normalized_n_steps(config.get("nSteps")),
        "nSims": _normalized_positive_int(config.get("nSims"), label="manifest N_SIMS"),
        "targetPopulation": _normalized_positive_int(
            config.get("targetPopulation"), label="manifest TARGET_POPULATION"
        ),
    }
    if normalized_config["nSteps"] != generation["nSteps"]:
        raise ProvenanceError("Generation nSteps and materialized config N_STEPS disagree")
    generation["config"] = normalized_config
    if not isinstance(generation.get("runtime"), Mapping):
        raise ProvenanceError("Generation manifest is missing runtime identity")
    _require_exact_keys(
        generation["runtime"],
        {"orderBook", "rngMode", "rngAlgorithm", "rngAddressVersion"},
        label="generation runtime identity",
    )
    generation["runtime"] = _normalized_runtime(generation["runtime"])
    if not isinstance(generation.get("git"), Mapping):
        raise ProvenanceError("Generation manifest is missing Git identity")
    if provenance_class == NATIVE_PROVENANCE_CLASS:
        generation["git"] = _normalized_native_git(generation["git"])
    else:
        generation["git"] = _normalized_legacy_git(generation["git"])
    generation["inputs"] = _validate_fingerprint_rows(generation.get("inputs"), label="input")

    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict):
        raise ProvenanceError("Generation manifest is missing artifact hashes")
    _require_exact_keys(
        artifacts,
        {"algorithm", "fileCount", "hashTiming", "files"},
        label="generation artifacts",
    )
    if artifacts.get("algorithm") != "sha256":
        raise ProvenanceError("Generation manifest must use SHA-256 artifact hashes")
    expected_hash_timing = (
        "post-generation-seal"
        if provenance_class == NATIVE_PROVENANCE_CLASS
        else "legacy-adoption"
    )
    if artifacts.get("hashTiming") != expected_hash_timing:
        raise ProvenanceError(
            f"Generation manifest hashTiming must be {expected_hash_timing!r}"
        )
    artifact_rows = _validate_fingerprint_rows(artifacts.get("files"), label="artifact")
    file_count = artifacts.get("fileCount")
    if (
        not isinstance(file_count, int)
        or isinstance(file_count, bool)
        or file_count != len(artifact_rows)
    ):
        raise ProvenanceError("Generation manifest artifact fileCount is inconsistent")
    artifacts["files"] = artifact_rows
    _validate_manifest_artifact_coverage(generation["seeds"], artifact_rows)

    caveats = manifest.get("caveats")
    if not isinstance(caveats, list):
        raise ProvenanceError("Generation manifest caveats must be a list")
    manifest["caveats"] = _normalized_caveats(tuple(caveats))
    if provenance_class == NATIVE_PROVENANCE_CLASS and manifest["caveats"]:
        raise ProvenanceError("Native generation manifests must not contain legacy caveats")
    if provenance_class == NATIVE_PROVENANCE_CLASS and "attestation" in manifest:
        raise ProvenanceError("Native generation manifests must not contain a legacy attestation")
    if provenance_class == LEGACY_PROVENANCE_CLASS:
        if LEGACY_RUNTIME_CAVEAT not in manifest["caveats"]:
            raise ProvenanceError("Legacy manifest is missing the runtime-attestation caveat")
        if LEGACY_HASH_TIMING_CAVEAT not in manifest["caveats"]:
            raise ProvenanceError("Legacy manifest is missing the hash-timing caveat")
        attestation = manifest.get("attestation")
        if not isinstance(attestation, dict):
            raise ProvenanceError("Legacy manifest is missing its attestation")
        _require_exact_keys(
            attestation,
            {"statement", "evidenceRecord", "anchors"},
            label="legacy attestation",
        )
        attestation["statement"] = _normalized_nonempty_string(
            attestation.get("statement"), "legacy attestation statement"
        )
        attestation["anchors"] = _validate_fingerprint_rows(
            attestation.get("anchors"), label="attestation anchor"
        )
        evidence_record = attestation.get("evidenceRecord")
        if not isinstance(evidence_record, Mapping):
            raise ProvenanceError("Legacy manifest is missing its tracked evidence record")
        attestation["evidenceRecord"] = _validate_fingerprint_rows(
            [evidence_record], label="evidence record"
        )[0]


def _validate_manifest_artifact_coverage(
    seeds: Sequence[int], rows: Sequence[Mapping[str, object]]
) -> None:
    seed_set = set(seeds)
    rows_by_path = {str(row["path"]): row for row in rows}
    found_config_seeds: set[int] = set()
    found_output_seeds: set[int] = set()
    for row in rows:
        path = str(row["path"])
        config_match = re.fullmatch(r"configs/seed-([0-9]+)\.properties", path)
        output_match = re.match(r"seed-([0-9]+)/", path)
        if config_match:
            seed = int(config_match.group(1))
            if path != f"configs/seed-{seed}.properties":
                raise ProvenanceError(f"Non-canonical config artifact path: {path}")
            found_config_seeds.add(seed)
        elif output_match:
            seed = int(output_match.group(1))
            if not path.startswith(f"seed-{seed}/"):
                raise ProvenanceError(f"Non-canonical output artifact path: {path}")
            found_output_seeds.add(seed)
        else:
            raise ProvenanceError(f"Artifact lies outside the generation namespace: {path}")
    if found_config_seeds != seed_set or found_output_seeds != seed_set:
        raise ProvenanceError(
            "Generation manifest artifact coverage does not match its seed list: "
            f"configs={sorted(found_config_seeds)} outputs={sorted(found_output_seeds)} "
            f"seeds={sorted(seed_set)}"
        )
    for seed in seeds:
        required_paths = (
            f"seed-{seed}/seed-{seed}.properties",
            *(f"seed-{seed}/{file_name}" for file_name in V5O3_REQUIRED_SEED_OUTPUT_FILES),
        )
        for required_path in required_paths:
            row = rows_by_path.get(required_path)
            if row is None:
                raise ProvenanceError(
                    f"Generation manifest is missing required seed artifact: {required_path}"
                )
            if int(row["sizeBytes"]) <= 0:
                raise ProvenanceError(
                    f"Required generation seed artifact is empty: {required_path}"
                )


def _build_generation_artifacts(root: Path, seeds: Sequence[int]) -> list[dict[str, object]]:
    _validate_seed_inventory(root, seeds)
    paths: list[Path] = []
    configs_dir = root / "configs"
    for seed in seeds:
        paths.append(configs_dir / f"seed-{seed}.properties")
        paths.extend(_regular_files_under(root / f"seed-{seed}"))
    rows: list[dict[str, object]] = []
    for path in sorted(paths, key=lambda item: item.relative_to(root).as_posix()):
        relative = path.relative_to(root).as_posix()
        size_bytes, digest = _fingerprint_file(path)
        rows.append({"path": relative, "sizeBytes": size_bytes, "sha256": digest})
    return rows


def _verify_artifact_subset(
    root: Path, manifest: Mapping[str, object], requested_seeds: Sequence[int]
) -> None:
    recorded_rows = {
        row["path"]: row for row in manifest["artifacts"]["files"]
    }
    actual_paths: set[str] = set()
    for seed in requested_seeds:
        config_relative = f"configs/seed-{seed}.properties"
        actual_paths.add(config_relative)
        for path in _regular_files_under(root / f"seed-{seed}"):
            actual_paths.add(path.relative_to(root).as_posix())

    recorded_subset = {
        path
        for path in recorded_rows
        if any(
            path == f"configs/seed-{seed}.properties" or path.startswith(f"seed-{seed}/")
            for seed in requested_seeds
        )
    }
    if actual_paths != recorded_subset:
        missing = sorted(recorded_subset - actual_paths)
        unexpected = sorted(actual_paths - recorded_subset)
        raise ProvenanceError(
            "Generation artifact set mismatch for requested seeds: "
            f"missing={missing[:5]} unexpected={unexpected[:5]}"
        )
    for relative in sorted(recorded_subset):
        path = root / Path(*PurePosixPath(relative).parts)
        size_bytes, digest = _fingerprint_file(path)
        recorded = recorded_rows[relative]
        if size_bytes != recorded["sizeBytes"] or digest != recorded["sha256"]:
            raise ProvenanceError(
                f"Generation artifact hash mismatch for {relative}: "
                f"expected size={recorded['sizeBytes']} sha256={recorded['sha256']}, "
                f"observed size={size_bytes} sha256={digest}"
            )


def _validate_seed_inventory(root: Path, seeds: Sequence[int]) -> None:
    if not root.is_dir() or root.is_symlink():
        raise ProvenanceError(f"Generation output root is not a real directory: {root}")
    expected = set(seeds)
    actual_seed_dirs: set[int] = set()
    for child in root.iterdir():
        if not child.name.startswith("seed-"):
            continue
        match = _SEED_DIRECTORY_PATTERN.fullmatch(child.name)
        if match is None or child.is_symlink() or not child.is_dir():
            raise ProvenanceError(f"Invalid generation seed directory: {child}")
        seed = int(match.group(1))
        if child.name != f"seed-{seed}" or seed in actual_seed_dirs:
            raise ProvenanceError(f"Non-canonical or duplicate generation seed directory: {child}")
        actual_seed_dirs.add(seed)
    if actual_seed_dirs != expected:
        raise ProvenanceError(
            f"Generation seed directories mismatch: expected={sorted(expected)} "
            f"observed={sorted(actual_seed_dirs)}"
        )

    configs_dir = root / "configs"
    if not configs_dir.is_dir() or configs_dir.is_symlink():
        raise ProvenanceError(f"Missing real generation configs directory: {configs_dir}")
    actual_config_seeds: set[int] = set()
    for child in configs_dir.iterdir():
        match = _SEED_CONFIG_PATTERN.fullmatch(child.name)
        if match is None or child.is_symlink() or not child.is_file():
            raise ProvenanceError(f"Invalid generation config artifact: {child}")
        seed = int(match.group(1))
        if child.name != f"seed-{seed}.properties" or seed in actual_config_seeds:
            raise ProvenanceError(f"Non-canonical or duplicate generation config artifact: {child}")
        actual_config_seeds.add(seed)
    if actual_config_seeds != expected:
        raise ProvenanceError(
            f"Generation config inventory mismatch: expected={sorted(expected)} "
            f"observed={sorted(actual_config_seeds)}"
        )


def _verify_seed_configs(
    root: Path,
    seeds: Sequence[int],
    n_steps: int,
    *,
    expected_n_sims: int | None = None,
    expected_target_population: int | None = None,
) -> dict[str, int]:
    observed_n_sims: int | None = None
    observed_target_population: int | None = None
    for seed in seeds:
        source_config = root / "configs" / f"seed-{seed}.properties"
        copied_config = root / f"seed-{seed}" / f"seed-{seed}.properties"
        if not source_config.is_file() or source_config.is_symlink():
            raise ProvenanceError(f"Missing real generated config: {source_config}")
        if not copied_config.is_file() or copied_config.is_symlink():
            raise ProvenanceError(f"Missing copied generated config: {copied_config}")
        if source_config.read_bytes() != copied_config.read_bytes():
            raise ProvenanceError(f"Generated and copied configs differ for seed {seed}")
        observed_seed = _read_unique_property(source_config, "SEED")
        observed_steps = _read_unique_property(source_config, "N_STEPS")
        raw_n_sims = _read_unique_property(source_config, "N_SIMS")
        raw_target_population = _read_unique_property(source_config, "TARGET_POPULATION")
        try:
            parsed_seed = int(observed_seed)
            parsed_steps = int(observed_steps)
            parsed_n_sims = int(raw_n_sims)
            parsed_target_population = int(raw_target_population)
        except ValueError as error:
            raise ProvenanceError(
                f"Non-integer SEED, N_STEPS, N_SIMS, or TARGET_POPULATION in {source_config}"
            ) from error
        if parsed_seed != seed:
            raise ProvenanceError(
                f"Config seed mismatch in {source_config}: expected {seed}, observed {parsed_seed}"
            )
        if parsed_steps != n_steps:
            raise ProvenanceError(
                f"Config N_STEPS mismatch in {source_config}: expected {n_steps}, "
                f"observed {parsed_steps}"
            )
        _normalized_positive_int(parsed_n_sims, label=f"N_SIMS in {source_config}")
        _normalized_positive_int(
            parsed_target_population, label=f"TARGET_POPULATION in {source_config}"
        )
        if observed_n_sims is None:
            observed_n_sims = parsed_n_sims
            observed_target_population = parsed_target_population
        elif (
            parsed_n_sims != observed_n_sims
            or parsed_target_population != observed_target_population
        ):
            raise ProvenanceError(
                "Generated configs disagree on N_SIMS or TARGET_POPULATION: "
                f"{source_config} has N_SIMS={parsed_n_sims}, "
                f"TARGET_POPULATION={parsed_target_population}"
            )

    assert observed_n_sims is not None
    assert observed_target_population is not None
    if expected_n_sims is not None and observed_n_sims != expected_n_sims:
        raise ProvenanceError(
            f"Materialized N_SIMS mismatch: expected {expected_n_sims}, "
            f"observed {observed_n_sims}"
        )
    if (
        expected_target_population is not None
        and observed_target_population != expected_target_population
    ):
        raise ProvenanceError(
            "Materialized TARGET_POPULATION mismatch: "
            f"expected {expected_target_population}, observed {observed_target_population}"
        )
    return {
        "nSteps": n_steps,
        "nSims": observed_n_sims,
        "targetPopulation": observed_target_population,
    }


def _read_unique_property(path: Path, key: str) -> str:
    values: list[str] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith(("#", "!")) or "=" not in line:
            continue
        raw_key, raw_value = line.split("=", 1)
        if raw_key.strip() == key:
            values.append(raw_value.strip())
    if len(values) != 1 or not values[0]:
        raise ProvenanceError(f"Expected exactly one non-empty {key} property in {path}")
    return values[0]


def _regular_files_under(root: Path) -> list[Path]:
    if not root.is_dir() or root.is_symlink():
        raise ProvenanceError(f"Generation directory is not a real directory: {root}")
    files: list[Path] = []
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ProvenanceError(f"Generation artifacts must not contain symlinks: {path}")
        if path.is_file():
            files.append(path)
        elif not path.is_dir():
            raise ProvenanceError(f"Generation artifact is not a regular file: {path}")
    if not files:
        raise ProvenanceError(f"Generation directory contains no files: {root}")
    return sorted(files, key=lambda item: item.relative_to(root).as_posix())


def _fingerprint_file(path: Path) -> tuple[int, str]:
    if path.is_symlink() or not path.is_file():
        raise ProvenanceError(f"Expected a regular non-symlink file: {path}")
    try:
        before = path.stat()
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        after = path.stat()
    except OSError as error:
        raise ProvenanceError(f"Could not fingerprint {path}: {error}") from error
    identity_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
    identity_after = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
    if identity_before != identity_after:
        raise ProvenanceError(f"File changed while it was being fingerprinted: {path}")
    return after.st_size, digest.hexdigest()


def _read_stable_bytes(path: Path) -> tuple[bytes, int, str]:
    if path.is_symlink() or not path.is_file():
        raise ProvenanceError(f"Expected a regular non-symlink file: {path}")
    try:
        before = path.stat()
        content = path.read_bytes()
        after = path.stat()
    except OSError as error:
        raise ProvenanceError(f"Could not read {path}: {error}") from error
    identity_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
    identity_after = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
    if identity_before != identity_after or len(content) != after.st_size:
        raise ProvenanceError(f"File changed while it was being read: {path}")
    return content, after.st_size, hashlib.sha256(content).hexdigest()


def _required_mapping(
    parent: Mapping[str, object], key: str, *, label: str
) -> Mapping[str, object]:
    value = parent.get(key)
    if not isinstance(value, Mapping):
        raise ProvenanceError(f"{label} is missing object {key!r}")
    return value


def _normalized_runtime(runtime: Mapping[str, str]) -> dict[str, str]:
    if not isinstance(runtime, Mapping):
        raise ProvenanceError("Runtime identity must be a mapping")
    missing = sorted(
        {"orderBook", "rngMode", "rngAlgorithm", "rngAddressVersion"} - set(runtime)
    )
    if missing:
        raise ProvenanceError(f"Runtime identity is missing: {', '.join(missing)}")
    return _expected_runtime_identity(str(runtime["orderBook"]), str(runtime["rngMode"]), runtime)


def _expected_runtime_identity(
    order_book: str,
    rng_mode: str,
    observed: Mapping[str, str] | None = None,
) -> dict[str, str]:
    if order_book not in {"array", "tree"}:
        raise ProvenanceError(f"Unsupported order book identity: {order_book!r}")
    if rng_mode not in _EXPECTED_RNG_METADATA:
        raise ProvenanceError(f"Unsupported RNG identity: {rng_mode!r}")
    expected = {
        "orderBook": order_book,
        "rngMode": rng_mode,
        **_EXPECTED_RNG_METADATA[rng_mode],
    }
    if observed is not None:
        mismatches = [
            f"{key} expected={value} observed={observed.get(key)}"
            for key, value in expected.items()
            if str(observed.get(key)) != value
        ]
        if mismatches:
            raise ProvenanceError("Inconsistent runtime metadata: " + "; ".join(mismatches))
    return expected


def _normalized_native_git(git: Mapping[str, object]) -> dict[str, object]:
    normalized = _json_mapping(git, label="generation Git provenance")
    required_keys = {"commit", "tree", "branch", "dirty", "workingTreeFingerprint"}
    _require_exact_keys(normalized, required_keys, label="native Git provenance")
    normalized["commit"] = _normalized_git_oid(
        normalized.get("commit"), label="native generation commit"
    )
    normalized["tree"] = _normalized_git_oid(
        normalized.get("tree"), label="native generation tree"
    )
    normalized["branch"] = _normalized_nonempty_string(
        normalized.get("branch"), "native generation branch"
    )
    if not isinstance(normalized.get("dirty"), bool):
        raise ProvenanceError("Native generation dirty state must be a boolean")
    fingerprint = normalized["workingTreeFingerprint"]
    if not isinstance(fingerprint, Mapping):
        raise ProvenanceError("Native working-tree fingerprint must be an object")
    _require_exact_keys(
        fingerprint,
        {"algorithm", "sha256", "scope", "untrackedFileCount"},
        label="native working-tree fingerprint",
    )
    if fingerprint.get("algorithm") != "sha256":
        raise ProvenanceError("Native working-tree fingerprint must use SHA-256")
    _normalized_sha256(
        fingerprint.get("sha256"), label="native working-tree fingerprint SHA-256"
    )
    scope = fingerprint.get("scope")
    if not isinstance(scope, list) or not scope or any(
        not isinstance(item, str) or not item for item in scope
    ):
        raise ProvenanceError("Native working-tree fingerprint scope must be non-empty strings")
    untracked_count = fingerprint.get("untrackedFileCount")
    if (
        not isinstance(untracked_count, int)
        or isinstance(untracked_count, bool)
        or untracked_count < 0
    ):
        raise ProvenanceError(
            "Native working-tree fingerprint untrackedFileCount must be non-negative"
        )
    return normalized


def _normalized_legacy_git(git: Mapping[str, object]) -> dict[str, object]:
    normalized = _json_mapping(git, label="legacy generation Git provenance")
    expected_keys = {"commit", "tree", "branch", "dirty"}
    if set(normalized) != expected_keys:
        raise ProvenanceError(
            "Legacy generation Git provenance must contain exactly commit, tree, branch, dirty"
        )
    normalized["commit"] = _normalized_git_oid(
        normalized["commit"], label="legacy generation commit"
    )
    normalized["tree"] = _normalized_git_oid(
        normalized["tree"], label="legacy generation tree"
    )
    normalized["branch"] = _normalized_nonempty_string(
        normalized["branch"], "legacy generation branch"
    )
    if normalized["dirty"] != "unknown":
        raise ProvenanceError("Legacy generation dirty state must be 'unknown'")
    return normalized


def _normalized_attested_inputs(
    rows: Sequence[tuple[str, int, str]],
) -> list[dict[str, object]]:
    normalized: list[dict[str, object]] = []
    seen: set[str] = set()
    for raw_path, raw_size, raw_sha in rows:
        path = _normalized_relative_path(raw_path, label="attested input path")
        if path in seen:
            raise ProvenanceError(f"Duplicate attested generation input: {path}")
        seen.add(path)
        if not isinstance(raw_size, int) or isinstance(raw_size, bool) or raw_size < 0:
            raise ProvenanceError(f"Invalid attested input size for {path}: {raw_size!r}")
        normalized.append(
            {
                "path": path,
                "sizeBytes": raw_size,
                "sha256": _normalized_sha256(raw_sha, label=f"attested SHA-256 for {path}"),
            }
        )
    normalized.sort(key=lambda row: str(row["path"]))
    if not normalized:
        raise ProvenanceError("At least one attested generation input is required")
    return normalized


def _verify_legacy_anchors(
    root: Path, attestation: LegacyAttestation
) -> list[dict[str, object]]:
    raw_anchors: tuple[tuple[str, int | None, str], ...] = (
        (
            attestation.anchor_relative_path,
            attestation.anchor_size_bytes,
            attestation.anchor_sha256,
        ),
        *attestation.additional_anchors,
    )
    anchors: list[dict[str, object]] = []
    seen: set[str] = set()
    for raw_path, raw_size, raw_sha in raw_anchors:
        relative_path = _normalized_relative_path(raw_path, label="legacy anchor path")
        if relative_path in seen:
            raise ProvenanceError(f"Duplicate legacy anchor path: {relative_path}")
        seen.add(relative_path)
        if raw_size is not None and (
            not isinstance(raw_size, int) or isinstance(raw_size, bool) or raw_size < 0
        ):
            raise ProvenanceError(
                f"Legacy anchor size for {relative_path} must be a non-negative integer"
            )
        expected_sha = _normalized_sha256(
            raw_sha, label=f"legacy anchor SHA-256 for {relative_path}"
        )
        anchor_path = root / Path(*PurePosixPath(relative_path).parts)
        observed_size, observed_sha = _fingerprint_file(anchor_path)
        if observed_sha != expected_sha:
            raise ProvenanceError(
                f"Legacy anchor SHA-256 mismatch for {relative_path}: "
                f"expected {expected_sha}, observed {observed_sha}"
            )
        if raw_size is not None and observed_size != raw_size:
            raise ProvenanceError(
                f"Legacy anchor size mismatch for {relative_path}: "
                f"expected {raw_size}, observed {observed_size}"
            )
        anchors.append(
            {
                "path": relative_path,
                "sizeBytes": observed_size,
                "sha256": observed_sha,
            }
        )
    anchors.sort(key=lambda row: str(row["path"]))
    return anchors


def _validate_fingerprint_rows(value: object, *, label: str) -> list[dict[str, object]]:
    if not isinstance(value, list):
        raise ProvenanceError(f"Generation {label} fingerprints must be a list")
    rows: list[dict[str, object]] = []
    seen: set[str] = set()
    for raw in value:
        if not isinstance(raw, Mapping):
            raise ProvenanceError(f"Invalid generation {label} fingerprint entry")
        _require_exact_keys(
            raw,
            {"path", "sizeBytes", "sha256"},
            label=f"generation {label} fingerprint",
        )
        path = _normalized_relative_path(raw.get("path"), label=f"{label} path")
        if path in seen:
            raise ProvenanceError(f"Duplicate generation {label} path: {path}")
        seen.add(path)
        size = raw.get("sizeBytes")
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise ProvenanceError(f"Invalid generation {label} size for {path}: {size!r}")
        digest = _normalized_sha256(raw.get("sha256"), label=f"{label} SHA-256 for {path}")
        rows.append({"path": path, "sizeBytes": size, "sha256": digest})
    if not rows:
        raise ProvenanceError(f"Generation {label} fingerprints must not be empty")
    if rows != sorted(rows, key=lambda row: str(row["path"])):
        raise ProvenanceError(f"Generation {label} fingerprints are not deterministically sorted")
    return rows


def _normalized_file_snapshot(
    value: Sequence[Mapping[str, object]], *, label: str
) -> list[dict[str, object]]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise ProvenanceError(f"{label} snapshot must be a sequence")
    try:
        copied = copy.deepcopy(list(value))
    except Exception as error:
        raise ProvenanceError(f"Could not copy {label} snapshot: {error}") from error
    return _validate_fingerprint_rows(copied, label=f"{label} snapshot")


def _normalized_seeds(seeds: object) -> tuple[int, ...]:
    if not isinstance(seeds, Sequence) or isinstance(seeds, (str, bytes)):
        raise ProvenanceError("Seeds must be a sequence of positive integers")
    normalized: list[int] = []
    for seed in seeds:
        if not isinstance(seed, int) or isinstance(seed, bool) or seed <= 0:
            raise ProvenanceError(f"Invalid seed: {seed!r}")
        normalized.append(seed)
    if not normalized:
        raise ProvenanceError("At least one seed is required")
    if len(set(normalized)) != len(normalized):
        raise ProvenanceError("Seeds must not contain duplicates")
    if normalized != sorted(normalized):
        raise ProvenanceError("Seeds must be sorted for deterministic provenance")
    return tuple(normalized)


def _normalized_n_steps(value: object) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ProvenanceError(f"N_STEPS must be a non-negative integer, got {value!r}")
    return value


def _normalized_positive_int(value: object, *, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ProvenanceError(f"{label} must be a positive integer, got {value!r}")
    return value


def _normalized_version(value: object) -> str:
    return _normalized_nonempty_string(value, "version")


def _normalized_nonempty_string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ProvenanceError(f"{label} must be a non-empty string")
    if value != value.strip():
        raise ProvenanceError(f"{label} must not contain leading or trailing whitespace")
    return value


def _normalized_relative_path(value: object, *, label: str) -> str:
    raw = _normalized_nonempty_string(value, label)
    if "\\" in raw:
        raise ProvenanceError(f"{label} must use POSIX separators: {raw!r}")
    path = PurePosixPath(raw)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ProvenanceError(f"{label} must be a safe relative path: {raw!r}")
    normalized = path.as_posix()
    if normalized != raw:
        raise ProvenanceError(f"{label} is not normalized: {raw!r}")
    return normalized


def _normalized_sha256(value: object, *, label: str) -> str:
    if not isinstance(value, str) or _SHA256_PATTERN.fullmatch(value) is None:
        raise ProvenanceError(f"{label} must be 64 lowercase hexadecimal characters")
    return value


def _normalized_git_oid(value: object, *, label: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) not in {40, 64}
        or re.fullmatch(r"[0-9a-f]+", value) is None
    ):
        raise ProvenanceError(f"{label} must be a 40- or 64-character lowercase Git object ID")
    return value


def _normalized_caveats(caveats: Sequence[object]) -> list[str]:
    normalized: list[str] = []
    for caveat in caveats:
        text = _normalized_nonempty_string(caveat, "provenance caveat")
        if text not in normalized:
            normalized.append(text)
    return normalized


def _json_mapping(value: Mapping[str, object], *, label: str) -> dict[str, object]:
    if not isinstance(value, Mapping):
        raise ProvenanceError(f"{label} must be an object")
    try:
        encoded = json.dumps(value, sort_keys=True, allow_nan=False)
        decoded = json.loads(encoded)
    except (TypeError, ValueError) as error:
        raise ProvenanceError(f"{label} is not JSON-serializable: {error}") from error
    if not isinstance(decoded, dict):
        raise ProvenanceError(f"{label} must be an object")
    return decoded


def _require_exact_keys(
    value: Mapping[str, object], expected: set[str], *, label: str
) -> None:
    observed = set(value)
    if observed != expected:
        missing = sorted(expected - observed)
        unexpected = sorted(observed - expected)
        raise ProvenanceError(
            f"{label} fields mismatch: missing={missing} unexpected={unexpected}"
        )


def _canonical_json_bytes(value: object) -> bytes:
    try:
        return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")
    except (TypeError, ValueError) as error:
        raise ProvenanceError(f"Could not serialize generation manifest: {error}") from error


def _unique_json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ProvenanceError(f"Duplicate JSON key in generation manifest: {key}")
        result[key] = value
    return result


def _write_new_file(path: Path, content: bytes) -> None:
    temporary_path: Path | None = None
    try:
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
        )
        temporary_path = Path(temporary_name)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        # A same-filesystem hard link publishes complete bytes atomically and refuses an existing
        # destination.  The two-file manifest/seal pair can still be interrupted between links;
        # that state is deliberately unusable and preflight refuses to overwrite it.
        os.link(temporary_path, path)
    except OSError as error:
        raise ProvenanceError(f"Could not create provenance file {path}: {error}") from error
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink()
            except FileNotFoundError:
                pass
