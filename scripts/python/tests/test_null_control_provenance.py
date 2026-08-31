#!/usr/bin/env python3
"""Tests for null-control generation provenance sealing and reuse validation."""

from __future__ import annotations

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from scripts.python.experiments.model.null_control_provenance import (
    LEGACY_HASH_TIMING_CAVEAT,
    LEGACY_PROVENANCE_CLASS,
    LEGACY_RUNTIME_CAVEAT,
    MANIFEST_FILENAME,
    NATIVE_PROVENANCE_CLASS,
    RETAINED_2026_08_14_ATTESTATION,
    SEAL_FILENAME,
    V5O3_REQUIRED_SEED_OUTPUT_FILES,
    LegacyAttestation,
    ProvenanceError,
    adopt_legacy_generation,
    build_scoring_provenance,
    compact_generation_reference,
    fingerprint_files,
    preflight_fresh_generation,
    seal_native_generation,
    sha256_file,
    validate_generation_for_reuse,
)


RUNTIME = {
    "orderBook": "array",
    "rngMode": "mersenne",
    "rngAlgorithm": "MersenneTwister",
    "rngAddressVersion": "none",
}
GIT = {
    "commit": "a" * 40,
    "tree": "b" * 40,
    "branch": "test",
    "dirty": False,
    "workingTreeFingerprint": {
        "algorithm": "sha256",
        "sha256": "c" * 64,
        "scope": ["synthetic"],
        "untrackedFileCount": 0,
    },
}


class TestNullControlProvenance(unittest.TestCase):
    def test_v5o3_required_output_contract_matches_scoring_profile(self) -> None:
        from scripts.python.validation.model.extractors import (
            HOUSEHOLD_DISTRIBUTION_SPECS,
            HOUSEHOLD_SHARE_SPECS,
            OUTPUT_SERIES_SPECS,
        )
        from scripts.python.validation.model.validation_profiles import (
            resolve_validation_profile,
        )

        profile = resolve_validation_profile("v5o3")
        required_files: set[str] = set()
        for metric_id, metric in profile.targets_by_id.items():
            if metric.kind == "household_jsd":
                required_files.add(
                    HOUSEHOLD_DISTRIBUTION_SPECS[metric_id].results_file_name
                )
            elif metric.kind == "household_share":
                required_files.add(HOUSEHOLD_SHARE_SPECS[metric_id].results_file_name)
            elif metric.kind == "output_series":
                required_files.add(OUTPUT_SERIES_SPECS[metric_id].results_file_name)
            elif metric.kind == "core_indicator":
                required_files.add(metric.file_name)
            else:
                self.fail(f"Unhandled v5o3 metric kind: {metric.kind}")
        self.assertEqual(required_files, set(V5O3_REQUIRED_SEED_OUTPUT_FILES))

    def test_retained_attestation_pins_known_inputs_and_evidence(self) -> None:
        self.assertEqual(
            (
                RETAINED_2026_08_14_ATTESTATION.attested_commit,
                RETAINED_2026_08_14_ATTESTATION.attested_tree,
                RETAINED_2026_08_14_ATTESTATION.attested_branch,
                RETAINED_2026_08_14_ATTESTATION.evidence_record_relative_path,
            ),
            (
                "b07fd6b6c7cdb08cb7e5d1c22767c86753dd0608",
                "5ce8546a2f5f7f707946cc393adb46d11d6177fc",
                "orestes/gpu-acceleration",
                "docs/rng/baselines/pre-philox-mersenne-control.json",
            ),
        )
        self.assertEqual(
            {
                path: (size, digest)
                for path, size, digest in (
                    RETAINED_2026_08_14_ATTESTATION.attested_generation_inputs
                )
            },
            {
                "input-data-versions/v5o3/Age15-FRS-2023-24-Weighted.csv": (
                    545,
                    "1ed2a0fc22acdb1d5e089163354f603104bc17e581ab74a0d8efd0acb8275ce4",
                ),
                "input-data-versions/v5o3/AgeGrossIncomeJointDist.csv": (
                    26571,
                    "5f2b42a127e004dfca2e56cdf5f4a4b85ed086a56077181804ade66d7a164b04",
                ),
                "input-data-versions/v5o3/BTLProbabilityPerIncomePercentileBin-R8.csv": (
                    3204,
                    "5bc38aaa093b6433aaae4a75a0c165f4a268ba2164f12c37145e2a0f298d2a6d",
                ),
                "input-data-versions/v5o3/GrossIncomeNetWealthJointDist.csv": (
                    46860,
                    "5adc87e31ed856fe20b7bd243f13534b31aa94e4653b45d5d3f8264d8daabbb5",
                ),
                "input-data-versions/v5o3/InitialRentMarkUpDist.csv": (
                    2492,
                    "d80f160a9a3a35262674fb9b80a7a2ac3884cb0b3a4267014369c3c46e720846",
                ),
                "input-data-versions/v5o3/InitialSaleMarkUpDist.csv": (
                    2479,
                    "51f7914d206368195a823cfd063f9679a5fc9f195c2cfbc8b0a80808b4b65e0c",
                ),
                "input-data-versions/v5o3/NationalInsuranceRates.csv": (
                    357,
                    "2b95184a86a41c0800186a69fd1d58200361c19c4318b3324ea7710b0f860bde",
                ),
                "input-data-versions/v5o3/TaxRates.csv": (
                    373,
                    "4a00235f9c7d1a6ca57b1d39c905a7513db32f7a28ad86b19c511048cc447ba4",
                ),
                "input-data-versions/v5o3/config.properties": (
                    41748,
                    "31c19b3f0e47758a43ec2c8fb0d1598ee1e8cb620e45b2707fd7cbf02c7772c5",
                ),
            },
        )
        self.assertEqual(
            RETAINED_2026_08_14_ATTESTATION.additional_anchors,
            (
                (
                    "run-full.log",
                    13326,
                    "90323f52fbe916d6303378295cc0167c4de016ce0455e53b2876172003eeb837",
                ),
            ),
        )

    def _make_generation(
        self,
        temp_root: Path,
        *,
        seeds: tuple[int, ...] = (1, 2, 3),
        n_steps: int = 20,
    ) -> tuple[Path, dict[str, Path]]:
        output = temp_root / "campaign"
        configs = output / "configs"
        configs.mkdir(parents=True)
        for seed in seeds:
            config_text = (
                f"SEED = {seed}\nN_STEPS = {n_steps}\nN_SIMS = 1\n"
                "TARGET_POPULATION = 10000\n"
            )
            config = configs / f"seed-{seed}.properties"
            config.write_text(config_text, encoding="utf-8")
            seed_dir = output / f"seed-{seed}"
            seed_dir.mkdir()
            (seed_dir / f"seed-{seed}.properties").write_text(config_text, encoding="utf-8")
            for file_name in V5O3_REQUIRED_SEED_OUTPUT_FILES:
                (seed_dir / file_name).write_text(
                    f"{seed};{seed + 1};{seed + 2}\n", encoding="utf-8"
                )
        source_root = temp_root / "source"
        source_root.mkdir()
        source_config = source_root / "config.properties"
        source_config.write_text(f"N_STEPS = {n_steps}\n", encoding="utf-8")
        source_model = source_root / "Model.java"
        source_model.write_text("final class Model {}\n", encoding="utf-8")
        return output, {
            "input-data-versions/v-test/config.properties": source_config,
            "src/main/java/housing/Model.java": source_model,
        }

    def _seal_native(
        self,
        temp_root: Path,
        *,
        seeds: tuple[int, ...] = (1, 2, 3),
        n_steps: int = 20,
    ) -> tuple[Path, dict[str, Path], dict[str, object]]:
        output, inputs = self._make_generation(temp_root, seeds=seeds, n_steps=n_steps)
        descriptor = seal_native_generation(
            output,
            version="v-test",
            seeds=seeds,
            n_steps=n_steps,
            runtime_metadata=RUNTIME,
            git_provenance=GIT,
            generation_inputs=inputs,
            generation_input_snapshot=fingerprint_files(inputs),
        )
        return output, inputs, descriptor

    def test_native_seal_is_deterministic_and_validates_a_seed_subset(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            output, inputs = self._make_generation(root)
            preflight_fresh_generation(root / "empty", seeds=(1, 2, 3))
            with self.assertRaisesRegex(ProvenanceError, "overwrite existing generation"):
                preflight_fresh_generation(output, seeds=(1, 2, 3))

            descriptor = seal_native_generation(
                output,
                version="v-test",
                seeds=(1, 2, 3),
                n_steps=20,
                runtime_metadata=RUNTIME,
                git_provenance=GIT,
                generation_inputs=inputs,
                generation_input_snapshot=fingerprint_files(inputs),
            )

            manifest_bytes = (output / MANIFEST_FILENAME).read_bytes()
            digest = hashlib.sha256(manifest_bytes).hexdigest()
            self.assertEqual(descriptor["manifestSha256"], digest)
            self.assertEqual(
                (output / SEAL_FILENAME).read_text(encoding="ascii"),
                f"{digest}  {MANIFEST_FILENAME}\n",
            )
            self.assertEqual(
                manifest_bytes,
                (json.dumps(descriptor["manifest"], indent=2, sort_keys=True) + "\n").encode(),
            )
            artifact_paths = [
                row["path"] for row in descriptor["manifest"]["artifacts"]["files"]
            ]
            self.assertEqual(artifact_paths, sorted(artifact_paths))
            self.assertEqual(len(artifact_paths), 54)

            expected_config_hash = sha256_file(
                inputs["input-data-versions/v-test/config.properties"]
            )
            validated = validate_generation_for_reuse(
                output,
                requested_seeds=(1, 2),
                expected_version="v-test",
                expected_order_book="array",
                expected_rng_mode="mersenne",
                expected_n_steps=20,
                scoring_window_end=20,
                expected_generation_input_hashes={
                    "input-data-versions/v-test/config.properties": expected_config_hash,
                },
            )
            self.assertEqual(validated["provenanceClass"], NATIVE_PROVENANCE_CLASS)
            self.assertEqual(validated["validatedSeeds"], [1, 2])
            self.assertEqual(validated["warnings"], [])
            reference = compact_generation_reference(validated)
            self.assertEqual(reference["seedCount"], 3)
            self.assertEqual(reference["runtime"], RUNTIME)
            self.assertEqual(
                reference["config"],
                {"nSteps": 20, "nSims": 1, "targetPopulation": 10000},
            )
            self.assertEqual(reference["manifestSha256"], digest)

            with self.assertRaisesRegex(ProvenanceError, "already exists"):
                seal_native_generation(
                    output,
                    version="v-test",
                    seeds=(1, 2, 3),
                    n_steps=20,
                    runtime_metadata=RUNTIME,
                    git_provenance=GIT,
                    generation_inputs=inputs,
                    generation_input_snapshot=fingerprint_files(inputs),
                )

    def test_reuse_rejects_absent_or_incompatible_generation_identity(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            output, inputs, _ = self._seal_native(root)
            common = {
                "output_dir": output,
                "requested_seeds": (1, 2),
                "expected_version": "v-test",
                "expected_order_book": "array",
                "expected_rng_mode": "mersenne",
            }
            cases = (
                ({"expected_version": "v-other"}, "version requested"),
                ({"expected_order_book": "tree"}, "orderBook requested"),
                ({"expected_rng_mode": "philox-household"}, "rngMode requested"),
                ({"requested_seeds": (1, 4)}, "seeds absent"),
                ({"expected_n_steps": 21}, "N_STEPS requested"),
                ({"expected_n_sims": 2}, "N_SIMS requested"),
                ({"expected_target_population": 9999}, "TARGET_POPULATION requested"),
                ({"scoring_window_end": 21}, "exceeds generated"),
                (
                    {
                        "expected_generation_input_hashes": {
                            "input-data-versions/v-test/config.properties": "f" * 64,
                        }
                    },
                    "generation input",
                ),
                (
                    {
                        # Simulates a current version-input directory from which the recorded
                        # config was deleted or renamed; unrelated code hashes remain optional.
                        "expected_generation_input_hashes": {
                            "src/main/java/housing/Model.java": sha256_file(
                                inputs["src/main/java/housing/Model.java"]
                            ),
                        }
                    },
                    "version-input path set",
                ),
            )
            for overrides, message in cases:
                kwargs = dict(common)
                kwargs.update(overrides)
                with self.subTest(overrides=overrides), self.assertRaisesRegex(
                    ProvenanceError, message
                ):
                    validate_generation_for_reuse(**kwargs)

        with tempfile.TemporaryDirectory() as tmp_dir:
            output, _ = self._make_generation(Path(tmp_dir))
            with self.assertRaisesRegex(ProvenanceError, "requires both"):
                validate_generation_for_reuse(
                    output,
                    requested_seeds=(1,),
                    expected_version="v-test",
                    expected_order_book="array",
                    expected_rng_mode="mersenne",
                )

    def test_seal_rejects_seed_and_materialized_config_disagreement(self) -> None:
        cases = {
            "seed": ("SEED = 2", "SEED = 9", "Config seed mismatch"),
            "n-sims": ("N_SIMS = 1", "N_SIMS = 2", "disagree on N_SIMS"),
            "population": (
                "TARGET_POPULATION = 10000",
                "TARGET_POPULATION = 9999",
                "disagree on N_SIMS or TARGET_POPULATION",
            ),
        }
        for label, (old, new, expected_message) in cases.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as tmp_dir:
                output, inputs = self._make_generation(Path(tmp_dir), seeds=(1, 2))
                for config_path in (
                    output / "configs" / "seed-2.properties",
                    output / "seed-2" / "seed-2.properties",
                ):
                    config_path.write_text(
                        config_path.read_text(encoding="utf-8").replace(old, new),
                        encoding="utf-8",
                    )
                with self.assertRaisesRegex(ProvenanceError, expected_message):
                    seal_native_generation(
                        output,
                        version="v-test",
                        seeds=(1, 2),
                        n_steps=20,
                        runtime_metadata=RUNTIME,
                        git_provenance=GIT,
                        generation_inputs=inputs,
                        generation_input_snapshot=fingerprint_files(inputs),
                    )
                self.assertFalse((output / MANIFEST_FILENAME).exists())
                self.assertFalse((output / SEAL_FILENAME).exists())

        for missing_file in V5O3_REQUIRED_SEED_OUTPUT_FILES:
            with self.subTest(missing_file=missing_file), tempfile.TemporaryDirectory() as tmp_dir:
                output, inputs = self._make_generation(Path(tmp_dir), seeds=(1, 2))
                (output / "seed-2" / missing_file).unlink()
                with self.assertRaisesRegex(ProvenanceError, "required seed artifact"):
                    seal_native_generation(
                        output,
                        version="v-test",
                        seeds=(1, 2),
                        n_steps=20,
                        runtime_metadata=RUNTIME,
                        git_provenance=GIT,
                        generation_inputs=inputs,
                        generation_input_snapshot=fingerprint_files(inputs),
                    )
                self.assertFalse((output / MANIFEST_FILENAME).exists())

        with tempfile.TemporaryDirectory() as tmp_dir:
            output, inputs = self._make_generation(Path(tmp_dir), seeds=(1, 2))
            (output / "seed-2" / "HousingStatus-run1.csv").write_bytes(b"")
            with self.assertRaisesRegex(ProvenanceError, "seed artifact is empty"):
                seal_native_generation(
                    output,
                    version="v-test",
                    seeds=(1, 2),
                    n_steps=20,
                    runtime_metadata=RUNTIME,
                    git_provenance=GIT,
                    generation_inputs=inputs,
                    generation_input_snapshot=fingerprint_files(inputs),
                )
            self.assertFalse((output / MANIFEST_FILENAME).exists())

    def test_reuse_rejects_tampered_deleted_added_and_resealed_manifest_files(self) -> None:
        mutations = {
            "tampered": lambda output: (output / "seed-1" / "Output-run1.csv").write_text(
                "changed\n", encoding="utf-8"
            ),
            "deleted": lambda output: (output / "seed-1" / "Output-run1.csv").unlink(),
            "added": lambda output: (output / "seed-1" / "unexpected.csv").write_text(
                "unexpected\n", encoding="utf-8"
            ),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as tmp_dir:
                output, _, _ = self._seal_native(Path(tmp_dir))
                mutate(output)
                with self.assertRaisesRegex(ProvenanceError, "artifact"):
                    validate_generation_for_reuse(
                        output,
                        requested_seeds=(1,),
                        expected_version="v-test",
                        expected_order_book="array",
                        expected_rng_mode="mersenne",
                    )

        with tempfile.TemporaryDirectory() as tmp_dir:
            output, _, _ = self._seal_native(Path(tmp_dir))
            manifest_path = output / MANIFEST_FILENAME
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["generation"]["version"] = "forged"
            manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
            with self.assertRaisesRegex(ProvenanceError, "seal mismatch"):
                validate_generation_for_reuse(
                    output,
                    requested_seeds=(1,),
                    expected_version="v-test",
                    expected_order_book="array",
                    expected_rng_mode="mersenne",
                )

    def test_reuse_rejects_noncanonical_seed_alias_and_malformed_resealed_schema(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output, _, _ = self._seal_native(Path(tmp_dir))
            alias_dir = output / "seed-01"
            alias_dir.mkdir()
            (alias_dir / "alias.csv").write_text("alias\n", encoding="utf-8")
            (output / "configs" / "seed-01.properties").write_text(
                "SEED = 1\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(ProvenanceError, "Non-canonical"):
                validate_generation_for_reuse(
                    output,
                    requested_seeds=(1,),
                    expected_version="v-test",
                    expected_order_book="array",
                    expected_rng_mode="mersenne",
                )

        malformed_cases = {
            "unknown-root": (
                lambda manifest: manifest.__setitem__("unknown", True),
                "fields mismatch",
            ),
            "hash-timing": (
                lambda manifest: manifest["artifacts"].__setitem__("hashTiming", "nonsense"),
                "hashTiming",
            ),
            "missing-git": (
                lambda manifest: manifest["generation"].__setitem__("git", {}),
                "Git provenance fields mismatch",
            ),
        }
        for label, (mutate, expected_message) in malformed_cases.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as tmp_dir:
                output, _, _ = self._seal_native(Path(tmp_dir))
                manifest_path = output / MANIFEST_FILENAME
                seal_path = output / SEAL_FILENAME
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                mutate(manifest)
                manifest_bytes = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
                manifest_path.write_bytes(manifest_bytes)
                seal_path.write_text(
                    f"{hashlib.sha256(manifest_bytes).hexdigest()}  {MANIFEST_FILENAME}\n",
                    encoding="ascii",
                )
                with self.assertRaisesRegex(ProvenanceError, expected_message):
                    validate_generation_for_reuse(
                        output,
                        requested_seeds=(1,),
                        expected_version="v-test",
                        expected_order_book="array",
                        expected_rng_mode="mersenne",
                    )

    def test_operation_inputs_must_match_their_pre_operation_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            output, inputs = self._make_generation(root)
            snapshot = fingerprint_files(inputs)
            inputs["src/main/java/housing/Model.java"].write_text(
                "final class Changed {}\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(ProvenanceError, "Generation inputs changed"):
                seal_native_generation(
                    output,
                    version="v-test",
                    seeds=(1, 2, 3),
                    n_steps=20,
                    runtime_metadata=RUNTIME,
                    git_provenance=GIT,
                    generation_inputs=inputs,
                    generation_input_snapshot=snapshot,
                )
            self.assertFalse((output / MANIFEST_FILENAME).exists())

        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            output, inputs = self._make_generation(root)
            snapshot = fingerprint_files(inputs)
            added = root / "source" / "Added.java"
            added.write_text("final class Added {}\n", encoding="utf-8")
            current_inputs = dict(inputs)
            current_inputs["src/main/java/housing/Added.java"] = added
            with self.assertRaisesRegex(ProvenanceError, "Added.java"):
                seal_native_generation(
                    output,
                    version="v-test",
                    seeds=(1, 2, 3),
                    n_steps=20,
                    runtime_metadata=RUNTIME,
                    git_provenance=GIT,
                    generation_inputs=current_inputs,
                    generation_input_snapshot=snapshot,
                )

        with tempfile.TemporaryDirectory() as tmp_dir:
            score_input = Path(tmp_dir) / "scoring.py"
            score_input.write_text("TARGET = 1\n", encoding="utf-8")
            scoring_inputs = {"scripts/scoring.py": score_input}
            snapshot = fingerprint_files(scoring_inputs)
            score_input.write_text("TARGET = 2\n", encoding="utf-8")
            with self.assertRaisesRegex(ProvenanceError, "Scoring inputs changed"):
                build_scoring_provenance(
                    git_provenance=GIT,
                    scoring_config={"windowEnd": 20},
                    scoring_inputs=scoring_inputs,
                    scoring_input_snapshot=snapshot,
                )

    def test_legacy_adoption_requires_exact_anchor_and_preserves_caveats(self) -> None:
        anchor_bytes = b"known legacy summary\n"
        anchor_sha = hashlib.sha256(anchor_bytes).hexdigest()
        log_bytes = b"known legacy log\n"
        log_sha = hashlib.sha256(log_bytes).hexdigest()

        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            output, _ = self._make_generation(root, seeds=(1, 2), n_steps=20)
            (output / "summary.json").write_bytes(anchor_bytes)
            (output / "run-full.log").write_bytes(log_bytes)
            evidence_path = (
                root
                / "repo"
                / "docs"
                / "rng"
                / "baselines"
                / "pre-philox-mersenne-control.json"
            )
            evidence_path.parent.mkdir(parents=True)
            evidence = {
                "schemaVersion": 1,
                "source": {
                    "commit": "c" * 40,
                    "tree": "e" * 40,
                    "branch": "synthetic",
                },
                "nullControl20260814": {
                    "generator": "Legacy MersenneTwister",
                    "version": "v-test",
                    "orderbook": "array",
                    "sets": 1,
                    "seedsPerSet": 2,
                    "firstSeed": 1,
                    "lastSeed": 2,
                    "targetPopulation": 10000,
                    "steps": 20,
                    "artifactIntegrity": {
                        "summarySha256": anchor_sha,
                        "runFullLogSha256": log_sha,
                        "seedDirectories": 2,
                        "outputRun1Files": 2,
                        "gate2InputFiles": {
                            "MonthlyGrossEmploymentIncome-run1.csv": 2,
                            "HousingWealth-run1.csv": 2,
                            "BankBalance-run1.csv": 2,
                        },
                        "gate2InputsComplete": True,
                    },
                },
            }
            evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
            attestation = LegacyAttestation(
                version="v-test",
                seeds=(1, 2),
                n_steps=20,
                n_sims=1,
                target_population=10000,
                runtime_metadata=RUNTIME,
                attested_commit="c" * 40,
                attested_tree="e" * 40,
                attested_branch="synthetic",
                evidence_record_relative_path=(
                    "docs/rng/baselines/pre-philox-mersenne-control.json"
                ),
                anchor_relative_path="summary.json",
                anchor_sha256=anchor_sha,
                anchor_size_bytes=len(anchor_bytes),
                additional_anchors=(("run-full.log", len(log_bytes), log_sha),),
                statement="Synthetic retained campaign.",
                attested_generation_inputs=(("config.properties", 12, "d" * 64),),
                additional_caveats=("Synthetic legacy limitation.",),
            )

            evidence["source"]["tree"] = "0" * 40
            evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
            with self.assertRaisesRegex(ProvenanceError, "source.tree"):
                adopt_legacy_generation(
                    output,
                    attestation=attestation,
                    evidence_record_path=evidence_path,
                )
            evidence["source"]["tree"] = "e" * 40
            evidence_path.write_text(json.dumps(evidence), encoding="utf-8")

            evidence["nullControl20260814"]["artifactIntegrity"]["outputRun1Files"] = 1
            evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
            with self.assertRaisesRegex(ProvenanceError, "outputRun1Files"):
                adopt_legacy_generation(
                    output,
                    attestation=attestation,
                    evidence_record_path=evidence_path,
                )
            evidence["nullControl20260814"]["artifactIntegrity"]["outputRun1Files"] = 2
            evidence["nullControl20260814"]["artifactIntegrity"][
                "gate2InputsComplete"
            ] = False
            evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
            with self.assertRaisesRegex(ProvenanceError, "gate2InputsComplete"):
                adopt_legacy_generation(
                    output,
                    attestation=attestation,
                    evidence_record_path=evidence_path,
                )
            evidence["nullControl20260814"]["artifactIntegrity"][
                "gate2InputsComplete"
            ] = True
            evidence_path.write_text(json.dumps(evidence), encoding="utf-8")

            (output / "summary.json").write_text("wrong summary\n", encoding="utf-8")
            with self.assertRaisesRegex(ProvenanceError, "anchor SHA-256 mismatch"):
                adopt_legacy_generation(
                    output,
                    attestation=attestation,
                    evidence_record_path=evidence_path,
                )
            self.assertFalse((output / MANIFEST_FILENAME).exists())
            self.assertFalse((output / SEAL_FILENAME).exists())
            (output / "summary.json").write_bytes(anchor_bytes)

            (output / "run-full.log").write_text("wrong log\n", encoding="utf-8")
            with self.assertRaisesRegex(ProvenanceError, "run-full.log"):
                adopt_legacy_generation(
                    output,
                    attestation=attestation,
                    evidence_record_path=evidence_path,
                )
            self.assertFalse((output / MANIFEST_FILENAME).exists())
            self.assertFalse((output / SEAL_FILENAME).exists())
            (output / "run-full.log").write_bytes(log_bytes)

            for missing_file in V5O3_REQUIRED_SEED_OUTPUT_FILES:
                with self.subTest(legacy_missing_file=missing_file):
                    missing_path = output / "seed-2" / missing_file
                    missing_bytes = missing_path.read_bytes()
                    missing_path.unlink()
                    with self.assertRaisesRegex(ProvenanceError, "required seed artifact"):
                        adopt_legacy_generation(
                            output,
                            attestation=attestation,
                            evidence_record_path=evidence_path,
                        )
                    self.assertFalse((output / MANIFEST_FILENAME).exists())
                    self.assertFalse((output / SEAL_FILENAME).exists())
                    missing_path.write_bytes(missing_bytes)

            adopted = adopt_legacy_generation(
                output,
                attestation=attestation,
                evidence_record_path=evidence_path,
            )
            self.assertEqual(adopted["provenanceClass"], LEGACY_PROVENANCE_CLASS)
            self.assertIn(LEGACY_RUNTIME_CAVEAT, adopted["warnings"])
            self.assertIn(LEGACY_HASH_TIMING_CAVEAT, adopted["warnings"])
            self.assertEqual(
                [row["path"] for row in adopted["manifest"]["attestation"]["anchors"]],
                ["run-full.log", "summary.json"],
            )
            self.assertEqual(
                adopted["manifest"]["attestation"]["evidenceRecord"]["path"],
                "docs/rng/baselines/pre-philox-mersenne-control.json",
            )

            # A later score may replace the root-level summary; the sealed anchor remains evidence
            # of what adoption checked, while immutable generation artifacts stay hash-verified.
            (output / "summary.json").write_text("later score\n", encoding="utf-8")
            validated = validate_generation_for_reuse(
                output,
                requested_seeds=(1,),
                expected_version="v-test",
                expected_order_book="array",
                expected_rng_mode="mersenne",
                expected_n_steps=20,
            )
            self.assertEqual(validated["provenanceClass"], LEGACY_PROVENANCE_CLASS)
            self.assertIn(LEGACY_RUNTIME_CAVEAT, validated["warnings"])
            reference = compact_generation_reference(validated)
            self.assertEqual(reference["warnings"], validated["warnings"])
            self.assertEqual(reference["git"]["dirty"], "unknown")
            self.assertEqual(reference["git"]["tree"], "e" * 40)
            self.assertEqual(reference["git"]["branch"], "synthetic")

    def test_scoring_provenance_is_independent_of_generation_identity(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            score_input = root / "scoring.py"
            score_input.write_text("TARGET = 1\n", encoding="utf-8")
            scoring_git = {
                "commit": "e" * 40,
                "tree": "f" * 40,
                "branch": "score",
                "dirty": True,
                "workingTreeFingerprint": {
                    "algorithm": "sha256",
                    "sha256": "a" * 64,
                    "scope": ["scoring"],
                    "untrackedFileCount": 0,
                },
            }
            provenance = build_scoring_provenance(
                git_provenance=scoring_git,
                scoring_config={"windowStart": 200, "windowEnd": 2000, "excluded": ["jsd"]},
                scoring_inputs={"scripts/scoring.py": score_input},
                scoring_input_snapshot=fingerprint_files(
                    {"scripts/scoring.py": score_input}
                ),
                ambient_maven_opts="-Xmx2g",
            )
            self.assertEqual(provenance["git"], scoring_git)
            self.assertEqual(provenance["ambientMavenOpts"], "-Xmx2g")
            self.assertEqual(provenance["inputs"][0]["sha256"], sha256_file(score_input))

            changed_git = copy.deepcopy(scoring_git)
            changed_git["commit"] = "1" * 40
            changed = build_scoring_provenance(
                git_provenance=changed_git,
                scoring_config=provenance["config"],
                scoring_inputs={"scripts/scoring.py": score_input},
                scoring_input_snapshot=fingerprint_files(
                    {"scripts/scoring.py": score_input}
                ),
            )
            self.assertNotEqual(changed["git"], provenance["git"])
            self.assertEqual(changed["inputs"], provenance["inputs"])

            malformed_git = copy.deepcopy(scoring_git)
            malformed_git["workingTreeFingerprint"]["sha256"] = ""
            with self.assertRaisesRegex(ProvenanceError, "fingerprint SHA-256"):
                build_scoring_provenance(
                    git_provenance=malformed_git,
                    scoring_config=provenance["config"],
                    scoring_inputs={"scripts/scoring.py": score_input},
                    scoring_input_snapshot=fingerprint_files(
                        {"scripts/scoring.py": score_input}
                    ),
                )


if __name__ == "__main__":
    unittest.main()
