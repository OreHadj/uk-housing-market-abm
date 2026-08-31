"""Tests for 2024 validation publication and runner plumbing.

@author: Max Stoddard
"""

from __future__ import annotations

import io
import json
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import Mock, patch

from scripts.python.validation.model.runner import (
    build_validation_summary,
    load_reused_validation_results,
    publish_reference_validation_only,
    resolve_was_data_root,
    run_reference_validation_for_version,
    run_snapshot_local_validation,
    run_validation_for_version,
    run_validation_seed,
)
from scripts.python.validation.model.publish import write_validation_summary
from scripts.python.validation.model.validation_profiles import resolve_validation_profile


class TestValidationFrameworkPublish(unittest.TestCase):
    def test_write_validation_summary_creates_dashboard_tracked_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            summary = {
                "version": "v-test",
                "schemaVersion": 3,
                "seeds": [1, 2, 3, 4, 5, 6, 7, 8],
                "overallCompositeLoss": 0.25,
                "metrics": [],
            }
            output_path = write_validation_summary(repo_root=repo_root, summary=summary)
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["version"], "v-test")
            self.assertEqual(output_path.as_posix(), f"{repo_root.as_posix()}/input-data-versions/validation/v-test.json")

    def test_run_validation_for_version_writes_transient_and_tracked_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            version_dir = repo_root / "input-data-versions" / "v-test"
            version_dir.mkdir(parents=True)
            (version_dir / "config.properties").write_text("SEED = 1\n", encoding="utf-8")
            output_dir = repo_root / "tmp" / "validation" / "v-test"

            with patch(
                "scripts.python.validation.model.runner.run_snapshot_local_validation",
                return_value=self._synthetic_seed_results(),
            ):
                summary = run_validation_for_version(
                    repo_root=repo_root,
                    version="v-test",
                    seeds=[1, 2, 3, 4, 5, 6, 7, 8],
                    output_dir=output_dir,
                )

            self.assertEqual(summary["version"], "v-test")
            self.assertTrue((output_dir / "validation_summary.json").exists())
            self.assertTrue((output_dir / "validation_metrics.csv").exists())
            self.assertTrue((output_dir / "validation_seed_results.csv").exists())
            self.assertTrue((output_dir / "validation_summary.md").exists())
            self.assertTrue((repo_root / "input-data-versions" / "validation" / "v-test.json").exists())

    def test_run_validation_for_v0_keeps_tracked_summary_2024_and_writes_2011_reference_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            version_dir = repo_root / "input-data-versions" / "v0"
            version_dir.mkdir(parents=True)
            (version_dir / "config.properties").write_text("SEED = 1\n", encoding="utf-8")
            output_dir = repo_root / "tmp" / "validation" / "v0"
            seed_results: list[dict[str, object]] = []
            for seed in range(1, 9):
                seed_output_dir = output_dir / f"seed-{seed}"
                seed_output_dir.mkdir(parents=True)
                seed_results.append(
                    {
                        "seed": seed,
                        "outputDir": str(seed_output_dir),
                        "metrics": self._synthetic_metrics(),
                    }
                )

            with (
                patch(
                    "scripts.python.validation.model.runner.resolve_was_data_root",
                    return_value=repo_root,
                ),
                patch(
                    "scripts.python.validation.model.runner.run_snapshot_local_validation",
                    return_value=seed_results,
                ),
                patch(
                    "scripts.python.validation.model.runner._extract_seed_metrics",
                    return_value=self._synthetic_metrics(),
                ) as extract_mock,
            ):
                summary = run_validation_for_version(
                    repo_root=repo_root,
                    version="v0",
                    seeds=[1, 2, 3, 4, 5, 6, 7, 8],
                    output_dir=output_dir,
                )

            tracked_summary = json.loads(
                (repo_root / "input-data-versions" / "validation" / "v0.json").read_text(encoding="utf-8")
            )
            reference_summary = json.loads(
                (output_dir / "reference-2011" / "validation_summary.json").read_text(encoding="utf-8")
            )
            tracked_reference_overlay = json.loads(
                (repo_root / "input-data-versions" / "validation-overlays" / "v0-2011.json").read_text(
                    encoding="utf-8"
                )
            )

            self.assertEqual(summary["validationTargetYear"], 2024)
            self.assertEqual(tracked_summary["validationTargetYear"], 2024)
            self.assertEqual(reference_summary["validationTargetYear"], 2011)
            self.assertEqual(tracked_reference_overlay["validationTargetYear"], 2011)
            self.assertEqual(reference_summary["seeds"], [1, 2, 3, 4, 5, 6, 7, 8])
            self.assertEqual(tracked_reference_overlay["seeds"], [1, 2, 3, 4, 5, 6, 7, 8])
            self.assertEqual(reference_summary["artifactType"], "reference_overlay")
            self.assertEqual(tracked_reference_overlay["artifactType"], "reference_overlay")
            self.assertEqual(
                reference_summary["referenceSourceOutputDir"],
                "tmp/validation/v0",
            )
            self.assertEqual(
                tracked_reference_overlay["overallCompositeLoss"],
                reference_summary["overallCompositeLoss"],
            )
            self.assertEqual(extract_mock.call_count, 8)
            self.assertFalse((repo_root / "input-data-versions" / "validation" / "v0-reference-2011.json").exists())

    def test_reference_only_validation_writes_version_specific_v0_family_overlay(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            output_dir = repo_root / "tmp" / "validation" / "v0o"
            for seed in range(1, 9):
                (output_dir / f"seed-{seed}").mkdir(parents=True)

            with (
                patch(
                    "scripts.python.validation.model.runner.resolve_was_data_root",
                    return_value=repo_root,
                ),
                patch(
                    "scripts.python.validation.model.runner._extract_seed_metrics",
                    return_value=self._synthetic_metrics(),
                ) as extract_mock,
            ):
                summary = publish_reference_validation_only(
                    repo_root=repo_root,
                    version="v0o",
                    seeds=[1, 2, 3, 4, 5, 6, 7, 8],
                    output_dir=output_dir,
                )

            reference_summary = json.loads(
                (output_dir / "reference-2011" / "validation_summary.json").read_text(encoding="utf-8")
            )
            tracked_reference_overlay = json.loads(
                (repo_root / "input-data-versions" / "validation-overlays" / "v0o-2011.json").read_text(
                    encoding="utf-8"
                )
            )

            self.assertEqual(summary["version"], "v0o")
            self.assertEqual(summary["validationTargetYear"], 2011)
            self.assertEqual(reference_summary["validationTargetYear"], 2011)
            self.assertEqual(tracked_reference_overlay["version"], "v0o")
            self.assertEqual(tracked_reference_overlay["validationTargetYear"], 2011)
            self.assertEqual(tracked_reference_overlay["artifactType"], "reference_overlay")
            self.assertEqual(
                tracked_reference_overlay["referenceSourceOutputDir"],
                "tmp/validation/v0o",
            )
            self.assertEqual(extract_mock.call_count, 8)
            self.assertFalse((repo_root / "input-data-versions" / "validation" / "v0o.json").exists())
            self.assertFalse((repo_root / "input-data-versions" / "validation-overlays" / "v0-2011.json").exists())

    def test_reference_validation_runner_publishes_v0o7_overlay_without_tracked_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            version_dir = repo_root / "input-data-versions" / "v0o7"
            version_dir.mkdir(parents=True)
            (version_dir / "config.properties").write_text("SEED = 1\n", encoding="utf-8")
            output_dir = repo_root / "tmp" / "validation" / "v0o7"
            seed_results = [
                {
                    "seed": seed,
                    "outputDir": str(output_dir / f"seed-{seed}"),
                    "metrics": self._synthetic_metrics(),
                }
                for seed in (1, 2)
            ]

            with (
                patch(
                    "scripts.python.validation.model.runner.resolve_was_data_root",
                    return_value=repo_root,
                ),
                patch(
                    "scripts.python.validation.model.runner.run_snapshot_local_validation",
                    return_value=seed_results,
                ),
            ):
                summary = run_reference_validation_for_version(
                    repo_root=repo_root,
                    version="v0o7",
                    seeds=[1, 2],
                    output_dir=output_dir,
                    workers=2,
                    allow_noncanonical_seeds=True,
                )

            self.assertTrue((repo_root / "input-data-versions" / "validation-overlays" / "v0o7-2011.json").exists())
            self.assertFalse((repo_root / "input-data-versions" / "validation" / "v0o7.json").exists())
            self.assertEqual(summary["validationTargetYear"], 2011)

    def test_run_validation_for_version_can_reuse_existing_output_dirs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            version_dir = repo_root / "input-data-versions" / "v-test"
            version_dir.mkdir(parents=True)
            (version_dir / "config.properties").write_text("SEED = 1\n", encoding="utf-8")
            output_dir = repo_root / "tmp" / "validation" / "v-test"
            for seed in range(1, 9):
                (output_dir / f"seed-{seed}").mkdir(parents=True)

            with (
                patch(
                    "scripts.python.validation.model.runner.resolve_was_data_root",
                    return_value=repo_root,
                ),
                patch(
                    "scripts.python.validation.model.runner._extract_seed_metrics",
                    return_value=self._synthetic_metrics(),
                ) as extract_mock,
                patch(
                    "scripts.python.validation.model.runner.run_snapshot_local_validation",
                ) as run_mock,
            ):
                summary = run_validation_for_version(
                    repo_root=repo_root,
                    version="v-test",
                    seeds=[1, 2, 3, 4, 5, 6, 7, 8],
                    output_dir=output_dir,
                    reuse_existing_output=True,
                )

            self.assertEqual(summary["version"], "v-test")
            self.assertEqual(extract_mock.call_count, 8)
            run_mock.assert_not_called()
            self.assertTrue((repo_root / "input-data-versions" / "validation" / "v-test.json").exists())

    def test_run_validation_for_version_can_reuse_cached_seed_results_and_backfill_missing_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            version_dir = repo_root / "input-data-versions" / "v-test"
            version_dir.mkdir(parents=True)
            (version_dir / "config.properties").write_text("SEED = 1\n", encoding="utf-8")
            output_dir = repo_root / "tmp" / "validation" / "v-test"
            output_dir.mkdir(parents=True)
            csv_lines = ["seed,metricId,value,outputDir"]
            for seed in range(1, 9):
                (output_dir / f"seed-{seed}").mkdir(parents=True)
                csv_lines.append(f"{seed},core_mortgageApprovals,60.0,{output_dir / f'seed-{seed}'}")
            (output_dir / "validation_seed_results.csv").write_text("\n".join(csv_lines) + "\n", encoding="utf-8")

            def fake_extract_seed_metrics(*, metric_ids: list[str], **_: object) -> dict[str, float]:
                metrics = self._synthetic_metrics()
                return {metric_id: metrics[metric_id] for metric_id in metric_ids}

            with (
                patch(
                    "scripts.python.validation.model.runner.resolve_was_data_root",
                    return_value=repo_root,
                ),
                patch(
                    "scripts.python.validation.model.runner._extract_seed_metrics",
                    side_effect=fake_extract_seed_metrics,
                ) as extract_mock,
            ):
                summary = run_validation_for_version(
                    repo_root=repo_root,
                    version="v-test",
                    seeds=[1, 2, 3, 4, 5, 6, 7, 8],
                    output_dir=output_dir,
                    reuse_existing_output=True,
                )

            self.assertEqual(summary["version"], "v-test")
            self.assertEqual(extract_mock.call_count, 8)
            self.assertNotIn("core_mortgageApprovals", extract_mock.call_args_list[0].kwargs["metric_ids"])

    def test_provenance_sensitive_reuse_can_ignore_the_derived_seed_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            seed_dir = output_dir / "seed-1"
            seed_dir.mkdir()
            (output_dir / "validation_seed_results.csv").write_text(
                f"seed,metricId,value,outputDir\n1,core_mortgageApprovals,999.0,{seed_dir}\n",
                encoding="utf-8",
            )
            profile = resolve_validation_profile("v5o3")

            with patch(
                "scripts.python.validation.model.runner._extract_seed_metrics",
                return_value={metric_id: 1.0 for metric_id in profile.targets_by_id},
            ) as extract_mock:
                results = load_reused_validation_results(
                    output_dir=output_dir,
                    seeds=[1],
                    was_data_root=output_dir,
                    validation_profile=profile,
                    use_cached_seed_results=False,
                )

            self.assertEqual(extract_mock.call_count, 1)
            self.assertIn("core_mortgageApprovals", extract_mock.call_args.kwargs["metric_ids"])
            self.assertEqual(results[0]["metrics"]["core_mortgageApprovals"], 1.0)

    def test_run_validation_for_version_requires_all_eight_canonical_seeds(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            version_dir = repo_root / "input-data-versions" / "v-test"
            version_dir.mkdir(parents=True)
            (version_dir / "config.properties").write_text("SEED = 1\n", encoding="utf-8")

            with patch(
                "scripts.python.validation.model.runner.run_snapshot_local_validation",
                return_value=self._synthetic_seed_results()[:-1],
            ):
                with self.assertRaisesRegex(ValueError, "8/8 successful seeds"):
                    run_validation_for_version(
                        repo_root=repo_root,
                        version="v-test",
                        seeds=[1, 2, 3, 4, 5, 6, 7, 8],
                        output_dir=repo_root / "tmp" / "validation" / "v-test",
                    )

    def test_run_validation_seed_logs_java_start_context(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            version_dir = repo_root / "input-data-versions" / "v-test"
            version_dir.mkdir(parents=True)
            (version_dir / "config.properties").write_text("SEED = 1\n", encoding="utf-8")
            output_dir = repo_root / "tmp" / "validation" / "v-test"
            stdout = io.StringIO()

            with (
                patch(
                    "scripts.python.validation.model.runner.build_snapshot_local_config_text",
                    return_value="SEED = 3\n",
                ),
                patch(
                    "scripts.python.validation.model.runner.subprocess.run",
                    return_value=subprocess.CompletedProcess(args=["mvn"], returncode=0, stdout="ok"),
                ),
                patch(
                    "scripts.python.validation.model.runner._extract_seed_metrics",
                    return_value=self._synthetic_metrics(),
                ),
                redirect_stdout(stdout),
            ):
                result = run_validation_seed(
                    repo_root=repo_root,
                    version="v-test",
                    seed=3,
                    output_dir=output_dir,
                    maven_bin="mvn",
                    was_data_root=repo_root,
                    validation_profile=resolve_validation_profile("v-test"),
                )

            log_output = stdout.getvalue()
            self.assertEqual(result["seed"], 3)
            self.assertIn("[validation]", log_output)
            self.assertIn("version=v-test", log_output)
            self.assertIn("seed=3", log_output)
            self.assertIn("worker=MainThread", log_output)
            self.assertNotIn("start=", log_output)
            self.assertNotIn("maven=", log_output)
            self.assertNotIn("config=", log_output)
            self.assertNotIn("output_dir=", log_output)

    def test_run_validation_seed_pins_and_verifies_runtime_settings(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            version_dir = repo_root / "input-data-versions" / "v-test"
            version_dir.mkdir(parents=True)
            (version_dir / "config.properties").write_text("SEED = 1\n", encoding="utf-8")
            output_dir = repo_root / "tmp" / "validation" / "v-test"
            process_output = (
                "RNG_METADATA rngAlgorithm=MersenneTwister rngAddressVersion=none "
                "masterSeed=3 rngMode=mersenne\n"
                "MODEL_RUNTIME_METADATA orderBook=array\n"
            )

            with (
                patch(
                    "scripts.python.validation.model.runner.build_snapshot_local_config_text",
                    return_value="SEED = 3\n",
                ),
                patch(
                    "scripts.python.validation.model.runner.subprocess.run",
                    return_value=subprocess.CompletedProcess(
                        args=["mvn"], returncode=0, stdout=process_output
                    ),
                ) as run_mock,
                patch(
                    "scripts.python.validation.model.runner._extract_seed_metrics",
                    return_value=self._synthetic_metrics(),
                ) as extract_mock,
            ):
                result = run_validation_seed(
                    repo_root=repo_root,
                    version="v-test",
                    seed=3,
                    output_dir=output_dir,
                    maven_bin="mvn",
                    was_data_root=repo_root,
                    validation_profile=resolve_validation_profile("v-test"),
                    order_book="array",
                    rng_mode="mersenne",
                )

            command = run_mock.call_args.args[0]
            self.assertEqual(
                command[:5],
                [
                    "mvn",
                    "-q",
                    "-Dhousing.orderbook=array",
                    "-Dhousing.rng=mersenne",
                    "exec:java",
                ],
            )
            self.assertEqual(
                result["runtimeMetadata"],
                {
                    "orderBook": "array",
                    "rngMode": "mersenne",
                    "rngAlgorithm": "MersenneTwister",
                    "rngAddressVersion": "none",
                },
            )
            extract_mock.assert_called_once()

    def test_run_validation_seed_rejects_unverified_runtime_before_metric_extraction(self) -> None:
        cases = {
            "missing": "ordinary model output\n",
            "duplicate": (
                "RNG_METADATA rngAlgorithm=MersenneTwister rngAddressVersion=none "
                "masterSeed=3 rngMode=mersenne\n"
                "RNG_METADATA rngAlgorithm=MersenneTwister rngAddressVersion=none "
                "masterSeed=3 rngMode=mersenne\n"
                "MODEL_RUNTIME_METADATA orderBook=array\n"
            ),
            "mismatch": (
                "RNG_METADATA rngAlgorithm=MersenneTwister rngAddressVersion=none "
                "masterSeed=3 rngMode=mersenne\n"
                "MODEL_RUNTIME_METADATA orderBook=tree\n"
            ),
            "inconsistent-rng-tuple": (
                "RNG_METADATA rngAlgorithm=Philox4x32-10 rngAddressVersion=1 "
                "masterSeed=3 rngMode=mersenne\n"
                "MODEL_RUNTIME_METADATA orderBook=array\n"
            ),
            "wrong-rng-mode": (
                "RNG_METADATA rngAlgorithm=MersenneTwister+Philox4x32-10 "
                "rngAddressVersion=1 masterSeed=3 rngMode=philox-household\n"
                "MODEL_RUNTIME_METADATA orderBook=array\n"
            ),
            "wrong-master-seed": (
                "RNG_METADATA rngAlgorithm=MersenneTwister rngAddressVersion=none "
                "masterSeed=4 rngMode=mersenne\n"
                "MODEL_RUNTIME_METADATA orderBook=array\n"
            ),
            "duplicate-model-metadata": (
                "RNG_METADATA rngAlgorithm=MersenneTwister rngAddressVersion=none "
                "masterSeed=3 rngMode=mersenne\n"
                "MODEL_RUNTIME_METADATA orderBook=array\n"
                "MODEL_RUNTIME_METADATA orderBook=array\n"
            ),
        }
        for label, process_output in cases.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as tmp_dir:
                repo_root = Path(tmp_dir)
                version_dir = repo_root / "input-data-versions" / "v-test"
                version_dir.mkdir(parents=True)
                (version_dir / "config.properties").write_text("SEED = 1\n", encoding="utf-8")
                extract_mock = Mock(return_value=self._synthetic_metrics())
                with (
                    patch(
                        "scripts.python.validation.model.runner.build_snapshot_local_config_text",
                        return_value="SEED = 3\n",
                    ),
                    patch(
                        "scripts.python.validation.model.runner.subprocess.run",
                        return_value=subprocess.CompletedProcess(
                            args=["mvn"], returncode=0, stdout=process_output
                        ),
                    ),
                    patch(
                        "scripts.python.validation.model.runner._extract_seed_metrics",
                        extract_mock,
                    ),
                ):
                    with self.assertRaisesRegex(RuntimeError, "runtime metadata"):
                        run_validation_seed(
                            repo_root=repo_root,
                            version="v-test",
                            seed=3,
                            output_dir=repo_root / "tmp" / "validation",
                            maven_bin="mvn",
                            was_data_root=repo_root,
                            validation_profile=resolve_validation_profile("v-test"),
                            order_book="array",
                            rng_mode="mersenne",
                        )
                extract_mock.assert_not_called()

    def test_snapshot_runner_propagates_runtime_settings_in_serial_and_parallel_modes(self) -> None:
        for workers in (1, 2):
            with self.subTest(workers=workers), tempfile.TemporaryDirectory() as tmp_dir:
                repo_root = Path(tmp_dir)
                version_dir = repo_root / "input-data-versions" / "v-test"
                version_dir.mkdir(parents=True)
                (version_dir / "config.properties").write_text("SEED = 1\n", encoding="utf-8")
                expected_generation_git = {"commit": "a" * 40, "tree": "b" * 40}

                def fake_seed(
                    *,
                    seed: int,
                    order_book: str,
                    rng_mode: str,
                    generation_git: dict[str, object],
                    **_: object,
                ) -> dict:
                    self.assertEqual(order_book, "array")
                    self.assertEqual(rng_mode, "mersenne")
                    self.assertEqual(generation_git, expected_generation_git)
                    return {"seed": seed, "metrics": {}}

                with (
                    patch("scripts.python.validation.model.runner.ensure_project_compiled"),
                    patch(
                        "scripts.python.validation.model.runner.run_validation_seed",
                        side_effect=fake_seed,
                    ) as seed_mock,
                ):
                    results = run_snapshot_local_validation(
                        repo_root=repo_root,
                        version="v-test",
                        seeds=[2, 1],
                        output_dir=repo_root / "output",
                        maven_bin="mvn",
                        was_data_root=repo_root,
                        validation_profile=resolve_validation_profile("v-test"),
                        workers=workers,
                        order_book="array",
                        rng_mode="mersenne",
                        generation_git=expected_generation_git,
                    )

                self.assertEqual(seed_mock.call_count, 2)
                self.assertEqual([result["seed"] for result in results], [2, 1])

    def test_run_validation_seed_supports_explicit_long_run_window_overrides(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            version_dir = repo_root / "input-data-versions" / "v-test"
            version_dir.mkdir(parents=True)
            (version_dir / "config.properties").write_text("SEED = 1\nN_STEPS = 2000\n", encoding="utf-8")
            output_dir = repo_root / "tmp" / "validation" / "v-test"

            with (
                patch(
                    "scripts.python.validation.model.runner.build_snapshot_local_config_text",
                    return_value="SEED = 10\nN_STEPS = 3500\n",
                ) as config_mock,
                patch(
                    "scripts.python.validation.model.runner.subprocess.run",
                    return_value=subprocess.CompletedProcess(args=["mvn"], returncode=0, stdout="ok"),
                ),
                patch(
                    "scripts.python.validation.model.runner._extract_seed_metrics",
                    return_value=self._synthetic_metrics(),
                ) as extract_mock,
            ):
                run_validation_seed(
                    repo_root=repo_root,
                    version="v-test",
                    seed=10,
                    output_dir=output_dir,
                    maven_bin="mvn",
                    was_data_root=repo_root,
                    validation_profile=resolve_validation_profile("v-test"),
                    n_steps=3500,
                    window_start=500,
                    window_end=3500,
                )

            overrides = config_mock.call_args.args[1]
            self.assertEqual(overrides["SEED"], "10")
            self.assertEqual(overrides["N_STEPS"], "3500")
            self.assertEqual(overrides["recordTransactions"], "false")
            self.assertEqual(overrides["recordHousingStatus"], "true")
            self.assertEqual(extract_mock.call_args.kwargs["window_start"], 500)
            self.assertEqual(extract_mock.call_args.kwargs["window_end"], 3500)

    def test_build_validation_summary_rejects_missing_required_target_metadata(self) -> None:
        required_targets = {
            "core_mortgageApprovals": {
                "metric_id": "core_mortgageApprovals",
            }
        }
        with self.assertRaisesRegex(RuntimeError, "Missing target metadata"):
            build_validation_summary(
                version="v-test",
                seed_results=[
                    {
                        "seed": 1,
                        "metrics": {"core_mortgageApprovals": 60.0},
                    }
                ]
                * 8,
                seeds=[1, 2, 3, 4, 5, 6, 7, 8],
                targets_by_id=required_targets,
            )

    def test_build_validation_summary_publishes_explicit_window_metadata(self) -> None:
        summary = build_validation_summary(
            version="v-test",
            seed_results=self._synthetic_seed_results(),
            seeds=[1, 2, 3, 4, 5, 6, 7, 8],
            window_start=500,
            window_end=3500,
        )

        self.assertEqual(summary["window"], {"startIndex": 500, "endIndex": 3500})

    def test_build_validation_summary_emits_source_provenance_fields(self) -> None:
        summary = build_validation_summary(
            version="v-test",
            seed_results=self._synthetic_seed_results(),
            seeds=[1, 2, 3, 4, 5, 6, 7, 8],
        )
        metric = next(item for item in summary["metrics"] if item["metricId"] == "core_mortgageApprovals")
        self.assertEqual(metric["sourceIndicatorLabel"], "Mortgage approvals, 2024 annual mean")
        self.assertAlmostEqual(metric["rawSourceValue"], 62863.583333333336)
        self.assertAlmostEqual(metric["sourceValue"], 62.86358333333334)
        self.assertEqual(metric["sourceDocumentPath"], "input-data-versions/validation-sources/2024/boe/housing-tools.xlsx")
        self.assertEqual(metric["mappingStatus"], "derived_match")
        self.assertEqual(metric["targetBand"], {"lower": 55.575, "upper": 68.073})
        self.assertEqual(metric["metricWeight"], 1.0)

    def test_build_validation_summary_scores_ukf_backed_advances_metrics(self) -> None:
        summary = build_validation_summary(
            version="v-test",
            seed_results=self._synthetic_seed_results(),
            seeds=[1, 2, 3, 4, 5, 6, 7, 8],
        )
        metric = next(item for item in summary["metrics"] if item["metricId"] == "core_advancesToBTL")
        self.assertEqual(metric["sourceLabel"], "UK Finance BTL Mortgage Market Update 2024 (Q1-Q4)")
        self.assertEqual(metric["status"], "fail")
        self.assertEqual(metric["targetBand"], {"lower": 4.913, "upper": 5.43})
        self.assertEqual(len(metric["sourceReferences"]), 4)
        self.assertIsNotNone(metric["metricLoss"])
        self.assertEqual(metric["lossFamily"], "positive_level")
        self.assertEqual(metric["lossTransform"], "log_ratio_to_target_band")
        self.assertIsNone(metric["lossScale"])
        self.assertEqual(metric["lossScaleBasis"], "not_applicable")
        self.assertIsNotNone(metric["distanceComponent"])
        self.assertIsNotNone(metric["spreadComponent"])
        self.assertIsNotNone(metric["insideRateComponent"])

    def test_market_source_metrics_are_scored_once_required_bands_exist(self) -> None:
        summary = build_validation_summary(
            version="v-test",
            seed_results=self._synthetic_seed_results(),
            seeds=[1, 2, 3, 4, 5, 6, 7, 8],
        )
        oo_dti = next(item for item in summary["metrics"] if item["metricId"] == "core_ooDebtToIncome")
        rental = next(item for item in summary["metrics"] if item["metricId"] == "core_rentalYield")
        spread = next(item for item in summary["metrics"] if item["metricId"] == "core_interestRateSpread")

        self.assertEqual(oo_dti["status"], "fail")
        self.assertEqual(rental["status"], "fail")
        self.assertEqual(spread["status"], "fail")
        self.assertEqual(spread["units"], "percentage points")
        self.assertEqual(len(rental["sourceReferences"]), 4)
        self.assertEqual(len(spread["sourceReferences"]), 4)
        self.assertIsNotNone(oo_dti["metricLoss"])
        self.assertIsNotNone(rental["metricLoss"])
        self.assertIsNotNone(spread["metricLoss"])
        self.assertEqual(oo_dti["lossFamily"], "positive_level")
        self.assertEqual(rental["lossFamily"], "positive_level")
        self.assertEqual(spread["lossFamily"], "signed_additive")
        self.assertEqual(spread["lossTransform"], "additive_distance")
        self.assertIsNotNone(spread["additiveScale"])
        self.assertEqual(len(oo_dti["sourceReferences"]), 5)
        self.assertEqual(
            oo_dti["sourceReferences"][-1]["sourceDocumentPath"],
            "input-data-versions/validation-sources/2024/ons/qwnd-household-gross-disposable-income-2023q2-2024q4.json",
        )

    def test_build_validation_summary_preserves_statuses_while_publishing_loss_scale_audit_fields(self) -> None:
        summary = build_validation_summary(
            version="v-test",
            seed_results=self._synthetic_seed_results(),
            seeds=[1, 2, 3, 4, 5, 6, 7, 8],
        )

        mortgage_approvals = next(item for item in summary["metrics"] if item["metricId"] == "core_mortgageApprovals")
        financial_wealth = next(
            item for item in summary["metrics"] if item["metricId"] == "financial_wealth_distribution_jsd"
        )

        self.assertEqual(mortgage_approvals["status"], "pass")
        self.assertEqual(financial_wealth["status"], "pass")
        self.assertEqual(mortgage_approvals["lossFamily"], "positive_level")
        self.assertEqual(mortgage_approvals["lossScaleBasis"], "not_applicable")
        self.assertEqual(financial_wealth["lossScaleBasis"], "target_band_upper")
        self.assertAlmostEqual(financial_wealth["lossScale"], 0.12)
        self.assertEqual(financial_wealth["lossFamily"], "bounded_low_is_better")
        self.assertIsNotNone(financial_wealth["levelComponent"])

    def test_build_validation_summary_uses_metric_only_composite_weighting(self) -> None:
        summary = build_validation_summary(
            version="v-test",
            seed_results=self._synthetic_seed_results(),
            seeds=[1, 2, 3, 4, 5, 6, 7, 8],
        )

        scored_metrics = [metric for metric in summary["metrics"] if metric["metricWeight"] == 1.0]
        expected_loss = sum(metric["metricLoss"] for metric in scored_metrics) / len(scored_metrics)
        self.assertAlmostEqual(summary["overallCompositeLoss"], expected_loss)

    def test_new_required_tenure_and_rpi_metrics_are_weighted_and_scored(self) -> None:
        summary = build_validation_summary(
            version="v-test",
            seed_results=self._synthetic_seed_results(),
            seeds=[1, 2, 3, 4, 5, 6, 7, 8],
        )
        metrics_by_id = {metric["metricId"]: metric for metric in summary["metrics"]}

        for metric_id in ("household_owning_share", "household_renting_share", "rpi_mean"):
            metric = metrics_by_id[metric_id]
            self.assertEqual(metric["requirement"], "required")
            self.assertEqual(metric["metricWeight"], 1.0)
            self.assertIsNotNone(metric["metricLoss"])

        self.assertEqual(metrics_by_id["household_owning_share"]["lossFamily"], "bounded_share")
        self.assertEqual(metrics_by_id["household_renting_share"]["lossFamily"], "bounded_share")

        without_new_metrics = [
            metric["metricLoss"]
            for metric in summary["metrics"]
            if metric["metricWeight"] == 1.0
            and metric["metricId"] not in {"household_owning_share", "household_renting_share", "rpi_mean"}
        ]
        old_composite = sum(without_new_metrics) / len(without_new_metrics)
        self.assertNotAlmostEqual(summary["overallCompositeLoss"], old_composite)

    def test_resolve_was_data_root_uses_parent_checkout_when_worktree_lacks_private_datasets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            project_root = Path(tmp_dir) / "project"
            worktree_root = project_root / ".worktrees" / "validation-framework-2024"
            worktree_root.mkdir(parents=True)
            was_file = project_root / "private-datasets" / "was" / "was_round_8_hhold_eul_may_2025.privdata"
            was_file.parent.mkdir(parents=True)
            was_file.write_text("header\n", encoding="utf-8")

            resolved = resolve_was_data_root(repo_root=worktree_root, explicit_root=None)
            self.assertEqual(resolved, project_root)

    def test_resolve_was_data_root_accepts_wave_3_only_checkout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_root = Path(tmp_dir)
            was_file = repo_root / "private-datasets" / "was" / "was_wave_3_hhold_eul_final.dta"
            was_file.parent.mkdir(parents=True)
            was_file.write_text("header\n", encoding="utf-8")

            resolved = resolve_was_data_root(repo_root=repo_root, explicit_root=None)
            self.assertEqual(resolved, repo_root)

    def _synthetic_seed_results(self) -> list[dict[str, object]]:
        metrics = {
            "core_mortgageApprovals": 60.0,
            "core_housingTransactions": 94.0,
            "core_advancesToFTB": 20.0,
            "core_advancesToHM": 28.0,
            "core_advancesToBTL": 9.0,
            "core_debtToIncome": 135.0,
            "core_priceToIncome": 8.0,
            "core_housePriceGrowth": 1.0,
            "core_hpiMean": 1.02,
            "core_hpiStd": 0.0135,
            "core_hpiCyclePeriod": 170.0,
            "rpi_mean": 1.04,
            "household_owning_share": 66.0,
            "household_renting_share": 21.0,
            "core_ooDebtToIncome": 110.0,
            "core_rentalYield": 4.0,
            "core_interestRateSpread": 1.5,
            "income_distribution_jsd": 0.05,
            "housing_wealth_distribution_jsd": 0.06,
            "financial_wealth_distribution_jsd": 0.07,
        }
        return [
            {
                "seed": seed,
                "outputDir": f"/tmp/seed-{seed}",
                "metrics": metrics,
            }
            for seed in range(1, 9)
        ]

    def _synthetic_metrics(self) -> dict[str, float]:
        return self._synthetic_seed_results()[0]["metrics"]
