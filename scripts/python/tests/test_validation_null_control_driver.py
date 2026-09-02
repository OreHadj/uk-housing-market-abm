#!/usr/bin/env python3
"""Integration contracts for the null-control driver provenance boundary."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from scripts.python.helpers.common import abm_policy_sweep
from scripts.python.experiments.model import validation_null_control as driver
from scripts.python.experiments.model.null_control_provenance import (
    V5O3_REQUIRED_SEED_OUTPUT_FILES,
)
from scripts.python.validation.model import runner


REPO_ROOT = Path(__file__).resolve().parents[3]
RUNTIME = {
    "orderBook": "array",
    "rngMode": "mersenne",
    "rngAlgorithm": "MersenneTwister",
    "rngAddressVersion": "none",
}
GENERATION_GIT = {
    "commit": "a" * 40,
    "tree": "b" * 40,
    "branch": "generation",
    "dirty": False,
    "workingTreeFingerprint": {
        "algorithm": "sha256",
        "sha256": "c" * 64,
        "scope": ["synthetic-generation"],
        "untrackedFileCount": 0,
    },
}
SCORING_GIT_1 = {
    "commit": "d" * 40,
    "tree": "e" * 40,
    "branch": "score-one",
    "dirty": True,
    "workingTreeFingerprint": {
        "algorithm": "sha256",
        "sha256": "f" * 64,
        "scope": ["synthetic-scoring"],
        "untrackedFileCount": 0,
    },
}
SCORING_GIT_2 = {
    "commit": "1" * 40,
    "tree": "2" * 40,
    "branch": "score-two",
    "dirty": True,
    "workingTreeFingerprint": {
        "algorithm": "sha256",
        "sha256": "3" * 64,
        "scope": ["synthetic-scoring"],
        "untrackedFileCount": 0,
    },
}


def _fake_generation(**kwargs: object) -> list[dict[str, object]]:
    output_dir = Path(kwargs["output_dir"])
    results: list[dict[str, object]] = []
    for seed in kwargs["seeds"]:
        config_text = (
            f"SEED = {seed}\nN_STEPS = 2000\nN_SIMS = 1\n"
            "TARGET_POPULATION = 10000\n"
        )
        config_path = output_dir / "configs" / f"seed-{seed}.properties"
        config_path.parent.mkdir(parents=True, exist_ok=True)
        config_path.write_text(config_text, encoding="utf-8")
        seed_dir = output_dir / f"seed-{seed}"
        seed_dir.mkdir(parents=True, exist_ok=True)
        (seed_dir / f"seed-{seed}.properties").write_text(config_text, encoding="utf-8")
        for file_name in V5O3_REQUIRED_SEED_OUTPUT_FILES:
            (seed_dir / file_name).write_text("header\nvalue\n", encoding="utf-8")
        generation_provenance = runner._write_seed_generation_provenance(
            repo_root=Path(kwargs["repo_root"]),
            version=str(kwargs["version"]),
            seed=seed,
            output_dir=output_dir,
            seed_output_dir=seed_dir,
            version_config_path=(
                Path(kwargs["repo_root"])
                / "input-data-versions"
                / str(kwargs["version"])
                / "config.properties"
            ),
            materialized_config_path=config_path,
            validation_profile=kwargs.get("provenance_validation_profile")
            or kwargs["validation_profile"],
            runtime_metadata=RUNTIME,
            generation_git=kwargs["generation_git"],
        )
        results.append(
            {
                "seed": seed,
                "outputDir": str(seed_dir),
                "metrics": {},
                "runtimeMetadata": dict(RUNTIME),
                "generationProvenance": generation_provenance,
            }
        )
    return results


def _fake_summary(**_: object) -> dict[str, object]:
    return {
        "overallCompositeLoss": 0.5,
        "metrics": [{"metricId": "synthetic", "metricLoss": 0.5}],
    }


class TestValidationNullControlDriver(unittest.TestCase):
    def test_clean_compile_removes_stale_classes_before_provenance_runs(self) -> None:
        with patch.object(abm_policy_sweep.subprocess, "run") as run_mock:
            abm_policy_sweep.ensure_project_compiled(
                REPO_ROOT,
                maven_bin="mvn-test",
                clean=True,
            )

        self.assertEqual(
            run_mock.call_args.args[0],
            ["mvn-test", "-q", "clean", "compile"],
        )

    def test_repo_root_must_match_the_executing_driver_checkout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            output_dir = temp_root / "campaign"
            other_checkout = temp_root / "other-checkout"
            with (
                patch.object(
                    sys,
                    "argv",
                    self._arguments(
                        output_dir,
                        "--repo-root",
                        str(other_checkout),
                    ),
                ),
                redirect_stdout(StringIO()),
            ):
                with self.assertRaisesRegex(SystemExit, "same checkout"):
                    driver.main()

    def _arguments(self, output_dir: Path, *extra: str) -> list[str]:
        return [
            "validation_null_control.py",
            "--version",
            "v5o3",
            "--output-dir",
            str(output_dir),
            "--n-sets",
            "1",
            "--set-size",
            "1",
            "--workers",
            "1",
            "--skip-metric-kinds",
            "household_jsd",
            *extra,
        ]

    def _run_main(self, arguments: list[str], *, git_side_effect: object) -> None:
        with (
            patch.object(sys, "argv", arguments),
            patch.object(driver, "_git_provenance", side_effect=git_side_effect),
            patch(
                "scripts.python.validation.model.runner.resolve_was_data_root",
                return_value=REPO_ROOT,
            ),
            patch(
                "scripts.python.validation.model.runner.build_validation_summary",
                side_effect=_fake_summary,
            ),
            redirect_stdout(StringIO()),
        ):
            driver.main()

    def test_fresh_refuses_occupied_generation_before_launching_model(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir) / "campaign"
            (output_dir / "seed-1").mkdir(parents=True)
            with (
                patch.object(sys, "argv", self._arguments(output_dir)),
                patch(
                    "scripts.python.validation.model.runner.run_snapshot_local_validation"
                ) as run_mock,
                redirect_stdout(StringIO()),
            ):
                with self.assertRaisesRegex(SystemExit, "Fresh generation refused"):
                    driver.main()
            run_mock.assert_not_called()

    def test_reuse_with_a_missing_seed_directory_refuses_before_loading_results(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir) / "campaign"
            output_dir.mkdir()
            with (
                patch.object(
                    sys,
                    "argv",
                    self._arguments(output_dir, "--reuse-existing-output"),
                ),
                patch(
                    "scripts.python.validation.model.runner.load_reused_validation_results"
                ) as load_mock,
                redirect_stdout(StringIO()),
            ):
                with self.assertRaisesRegex(SystemExit, "Reuse refused"):
                    driver.main()
            load_mock.assert_not_called()

    def test_reuse_cannot_overwrite_the_canonical_full_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir) / "campaign"
            with (
                patch.object(
                    sys,
                    "argv",
                    self._arguments(
                        output_dir,
                        "--reuse-existing-output",
                        "--json-out",
                        str(output_dir / "summary.json"),
                    ),
                ),
                patch(
                    "scripts.python.validation.model.runner.load_reused_validation_results"
                ) as load_mock,
                redirect_stdout(StringIO()),
            ):
                with self.assertRaisesRegex(SystemExit, "must not overwrite"):
                    driver.main()
            load_mock.assert_not_called()

    def test_fresh_rejects_an_unfingerprinted_maven_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir) / "campaign"
            with (
                patch.object(
                    sys,
                    "argv",
                    self._arguments(output_dir, "--maven-bin", "/opt/custom/mvn"),
                ),
                patch(
                    "scripts.python.validation.model.runner.run_snapshot_local_validation"
                ) as run_mock,
                redirect_stdout(StringIO()),
            ):
                with self.assertRaisesRegex(SystemExit, "Maven wrapper"):
                    driver.main()
            run_mock.assert_not_called()

    def test_legacy_adoption_is_disabled_in_favor_of_grandfathered_reuse(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir) / "campaign"
            output_dir.mkdir()
            sentinel = output_dir / "legacy-output.csv"
            sentinel.write_text("unchanged\n", encoding="utf-8")
            with (
                patch.object(
                    sys,
                    "argv",
                    self._arguments(output_dir, "--adopt-legacy"),
                ),
                redirect_stdout(StringIO()),
            ):
                with self.assertRaisesRegex(SystemExit, "cannot be reconstructed"):
                    driver.main()

            self.assertEqual(sentinel.read_text(encoding="utf-8"), "unchanged\n")
            self.assertEqual(list(output_dir.iterdir()), [sentinel])

    def test_fresh_and_reuse_keep_generation_and_scoring_provenance_separate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir) / "campaign"
            fresh_summary = output_dir / "fresh-summary.json"
            fresh_args = self._arguments(
                output_dir,
                "--json-out",
                str(fresh_summary),
            )
            fresh_seed_result = {
                "seed": 1,
                "outputDir": str(output_dir / "seed-1"),
                "metrics": {},
            }
            with (
                patch(
                    "scripts.python.validation.model.runner.run_snapshot_local_validation",
                    side_effect=_fake_generation,
                ) as run_mock,
                patch(
                    "scripts.python.validation.model.runner.load_reused_validation_results",
                    return_value=[fresh_seed_result],
                ) as fresh_load_mock,
            ):
                self._run_main(
                    fresh_args,
                    git_side_effect=[SCORING_GIT_1, GENERATION_GIT],
                )
            self.assertTrue(run_mock.call_args.kwargs["clean_compile"])
            self.assertEqual(run_mock.call_args.kwargs["generation_git"], GENERATION_GIT)
            self.assertFalse(fresh_load_mock.call_args.kwargs["use_cached_seed_results"])
            self.assertTrue(
                (output_dir / "seed-1" / runner.VALIDATION_GENERATION_PROVENANCE_FILENAME).is_file()
            )

            fresh = json.loads(fresh_summary.read_text(encoding="utf-8"))
            self.assertNotIn("git", fresh)
            self.assertEqual(fresh["generation_git"], GENERATION_GIT)
            self.assertEqual(fresh["scoring_git"], SCORING_GIT_1)
            self.assertEqual(
                fresh["runtime_verification"]["status"],
                "verified-generated-output",
            )
            self.assertTrue(fresh["verified_baseline_eligible"])
            self.assertEqual(
                fresh["generationProvenance"]["git"]["commit"],
                GENERATION_GIT["commit"],
            )
            self.assertEqual(
                fresh["scoringProvenance"]["git"]["commit"],
                SCORING_GIT_1["commit"],
            )

            reuse_summary = output_dir / "reuse-summary.json"
            reuse_args = self._arguments(
                output_dir,
                "--reuse-existing-output",
                "--json-out",
                str(reuse_summary),
            )
            reused_seed_result = {
                "seed": 1,
                "outputDir": str(output_dir / "seed-1"),
                "metrics": {},
            }
            with patch(
                "scripts.python.validation.model.runner.load_reused_validation_results",
                return_value=[reused_seed_result],
            ) as load_mock:
                self._run_main(reuse_args, git_side_effect=[SCORING_GIT_2])

            self.assertFalse(load_mock.call_args.kwargs["use_cached_seed_results"])
            reused = json.loads(reuse_summary.read_text(encoding="utf-8"))
            self.assertEqual(reused["generation_git"], GENERATION_GIT)
            self.assertEqual(reused["scoring_git"], SCORING_GIT_2)
            self.assertEqual(
                reused["runtime_verification"]["status"],
                "not-verified-reused-output",
            )
            self.assertTrue(reused["verified_baseline_eligible"])
            self.assertEqual(
                reused["generationProvenance"]["git"]["commit"],
                GENERATION_GIT["commit"],
            )
            self.assertEqual(
                reused["scoringProvenance"]["git"]["commit"],
                SCORING_GIT_2["commit"],
            )

            with (
                patch.object(
                    sys,
                    "argv",
                    self._arguments(
                        output_dir,
                        "--reuse-existing-output",
                        "--window-end",
                        "2001",
                    ),
                ),
                patch(
                    "scripts.python.validation.model.runner.load_reused_validation_results"
                ) as beyond_window_loader,
                redirect_stdout(StringIO()),
            ):
                with self.assertRaisesRegex(SystemExit, "exceeds generated N_STEPS"):
                    driver.main()
            beyond_window_loader.assert_not_called()

    def test_provenance_free_reuse_is_explicitly_unverified_legacy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir) / "campaign"
            (output_dir / "seed-1").mkdir(parents=True)
            summary_path = output_dir / "legacy-reuse-summary.json"
            arguments = self._arguments(
                output_dir,
                "--reuse-existing-output",
                "--json-out",
                str(summary_path),
            )
            reused_seed_result = {
                "seed": 1,
                "outputDir": str(output_dir / "seed-1"),
                "metrics": {},
            }
            with patch(
                "scripts.python.validation.model.runner.load_reused_validation_results",
                return_value=[reused_seed_result],
            ):
                self._run_main(arguments, git_side_effect=[SCORING_GIT_2])

            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            self.assertIsNone(summary["generation_git"])
            self.assertEqual(summary["scoring_git"], SCORING_GIT_2)
            self.assertEqual(
                summary["generation_git_note"],
                runner.LEGACY_REUSED_OUTPUT_GENERATION_NOTE,
            )
            self.assertEqual(
                summary["generation_provenance"]["status"],
                "unverified-legacy",
            )
            self.assertFalse(summary["generation_provenance"]["baseline_eligible"])
            self.assertFalse(summary["verified_baseline_eligible"])
            self.assertEqual(
                summary["runtime_verification"]["status"],
                "not-verified-reused-output",
            )


if __name__ == "__main__":
    unittest.main()
