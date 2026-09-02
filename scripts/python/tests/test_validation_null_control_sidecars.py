#!/usr/bin/env python3
"""Per-seed generation-provenance sidecar contracts for the null-control harness."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from scripts.python.validation.model.runner import (
    LEGACY_REUSED_OUTPUT_GENERATION_NOTE,
    VALIDATION_GENERATION_PROVENANCE_FILENAME,
    run_validation_seed,
    validate_reused_validation_provenance,
)
from scripts.python.validation.model.validation_profiles import (
    ValidationProfile,
    resolve_validation_profile,
)


GENERATION_GIT = {
    "commit": "a" * 40,
    "tree": "b" * 40,
    "branch": "generation",
    "dirty": False,
}


class TestValidationNullControlProvenanceF4(unittest.TestCase):
    @staticmethod
    def _single_file_profile() -> ValidationProfile:
        base = resolve_validation_profile("v-test")
        metric = next(
            candidate
            for candidate in base.target_catalog
            if candidate.kind == "core_indicator" and candidate.file_name
        )
        return replace(
            base,
            target_catalog=(metric,),
            targets_by_id={metric.metric_id: metric},
        )

    def _generate(
        self,
        root: Path,
        *,
        seeds: tuple[int, ...] = (1, 2),
    ) -> tuple[Path, ValidationProfile, list[dict[str, object]]]:
        repo_root = root / "repo"
        version_dir = repo_root / "input-data-versions" / "v-test"
        version_dir.mkdir(parents=True)
        (version_dir / "config.properties").write_text(
            "SEED = 0\nN_STEPS = 24\nN_SIMS = 1\nTARGET_POPULATION = 100\n",
            encoding="utf-8",
        )
        output_dir = root / "campaign"
        profile = self._single_file_profile()
        metric = next(iter(profile.targets_by_id.values()))
        assert metric.file_name is not None
        results: list[dict[str, object]] = []

        for seed in seeds:
            def fake_model_run(*_: object, **__: object) -> subprocess.CompletedProcess[str]:
                seed_dir = output_dir / f"seed-{seed}"
                (seed_dir / metric.file_name).write_text(
                    f"header\nseed-{seed}\n",
                    encoding="utf-8",
                )
                stdout = (
                    "RNG_METADATA rngAlgorithm=MersenneTwister rngAddressVersion=none "
                    f"masterSeed={seed} rngMode=mersenne\n"
                    "MODEL_RUNTIME_METADATA orderBook=array\n"
                )
                return subprocess.CompletedProcess(
                    args=["mvn"],
                    returncode=0,
                    stdout=stdout,
                )

            materialized_config = (
                f"SEED = {seed}\nN_STEPS = 24\nN_SIMS = 1\n"
                "TARGET_POPULATION = 100\n"
            )
            with (
                patch(
                    "scripts.python.validation.model.runner.build_snapshot_local_config_text",
                    return_value=materialized_config,
                ),
                patch(
                    "scripts.python.validation.model.runner.subprocess.run",
                    side_effect=fake_model_run,
                ),
                patch(
                    "scripts.python.validation.model.runner._extract_seed_metrics",
                    return_value={metric.metric_id: float(seed)},
                ),
            ):
                results.append(
                    run_validation_seed(
                        repo_root=repo_root,
                        version="v-test",
                        seed=seed,
                        output_dir=output_dir,
                        maven_bin="mvn",
                        was_data_root=repo_root,
                        validation_profile=profile,
                        order_book="array",
                        rng_mode="mersenne",
                        generation_git=GENERATION_GIT,
                    )
                )
        return output_dir, profile, results

    def _validate(
        self,
        output_dir: Path,
        profile: ValidationProfile,
        *,
        seeds: tuple[int, ...] = (1, 2),
        version: str = "v-test",
        order_book: str = "array",
        rng_mode: str = "mersenne",
    ) -> dict[str, object]:
        return validate_reused_validation_provenance(
            output_dir=output_dir,
            seeds=seeds,
            expected_version=version,
            expected_order_book=order_book,
            expected_rng_mode=rng_mode,
            validation_profile=profile,
        )

    def test_generated_run_writes_sidecars_and_reuse_verifies(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir, profile, results = self._generate(Path(tmp_dir))

            for seed, result in zip((1, 2), results):
                provenance_path = (
                    output_dir / f"seed-{seed}" / VALIDATION_GENERATION_PROVENANCE_FILENAME
                )
                self.assertTrue(provenance_path.is_file())
                provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
                self.assertEqual(provenance["generation_git"], GENERATION_GIT)
                self.assertEqual(provenance["runtime_metadata"]["orderBook"], "array")
                self.assertEqual(provenance["runtime_metadata"]["rngMode"], "mersenne")
                self.assertTrue(provenance["scored_outputs"][0]["sha256"])
                self.assertEqual(result["generationProvenance"], provenance)

            validated = self._validate(output_dir, profile)
            self.assertEqual(validated["status"], "verified")
            self.assertEqual(validated["generation_git"], GENERATION_GIT)
            self.assertTrue(validated["baseline_eligible"])

    def test_tampered_scored_output_fails_loudly(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir, profile, _ = self._generate(Path(tmp_dir))
            metric = next(iter(profile.targets_by_id.values()))
            assert metric.file_name is not None
            (output_dir / "seed-1" / metric.file_name).write_text(
                "tampered\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(RuntimeError, "Scored output SHA-256 mismatch"):
                self._validate(output_dir, profile)

    def test_tampered_materialized_config_fails_loudly(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir, profile, _ = self._generate(Path(tmp_dir))
            (output_dir / "configs" / "seed-1.properties").write_text(
                "SEED = 999\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(RuntimeError, "config SHA-256 mismatch"):
                self._validate(output_dir, profile)

    def test_requested_version_order_book_or_rng_mismatch_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir, profile, _ = self._generate(Path(tmp_dir))

            with self.assertRaisesRegex(RuntimeError, "version mismatch"):
                self._validate(output_dir, profile, version="v-other")
            with self.assertRaisesRegex(RuntimeError, "order book mismatch"):
                self._validate(output_dir, profile, order_book="tree")
            with self.assertRaisesRegex(RuntimeError, "RNG mode mismatch"):
                self._validate(output_dir, profile, rng_mode="philox-household")

    def test_inconsistent_seed_sidecars_are_refused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir, profile, _ = self._generate(Path(tmp_dir))
            second_path = (
                output_dir / "seed-2" / VALIDATION_GENERATION_PROVENANCE_FILENAME
            )
            second = json.loads(second_path.read_text(encoding="utf-8"))
            second["generation_git"]["commit"] = "c" * 40
            second_path.write_text(json.dumps(second, indent=2), encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "inconsistent with each other"):
                self._validate(output_dir, profile)

    def test_partial_sidecar_inventory_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir, profile, _ = self._generate(Path(tmp_dir))
            (output_dir / "seed-2" / VALIDATION_GENERATION_PROVENANCE_FILENAME).unlink()

            with self.assertRaisesRegex(RuntimeError, "provenance is incomplete"):
                self._validate(output_dir, profile)

    def test_provenance_free_dirs_are_grandfathered_but_not_baseline_eligible(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir) / "campaign"
            for seed in (1, 2):
                (output_dir / f"seed-{seed}").mkdir(parents=True)
            profile = self._single_file_profile()

            validated = self._validate(output_dir, profile)

            self.assertEqual(validated["status"], "unverified-legacy")
            self.assertIsNone(validated["generation_git"])
            self.assertEqual(validated["note"], LEGACY_REUSED_OUTPUT_GENERATION_NOTE)
            self.assertFalse(validated["baseline_eligible"])


if __name__ == "__main__":
    unittest.main()
