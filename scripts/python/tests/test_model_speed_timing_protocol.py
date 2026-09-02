#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for the serial model-speed timing and comparison protocol."""

from __future__ import annotations

import csv
import json
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path

from scripts.model import model_speed


class TestModelSpeedTimingProtocol(unittest.TestCase):
    def test_summary_records_stable_timing_scopes_and_process_wall_stats(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            runs_tsv = root / "runs.tsv"
            summary_path = root / "summary.json"
            rows = [
                _row(root, "run-001", warmup_count=2, wall=10.0, process_wall=31.0),
                _row(root, "run-002", warmup_count=2, wall=12.0, process_wall=35.0),
            ]
            _write_runs_tsv(runs_tsv, rows)

            return_code = model_speed.benchmark_summary(
                Namespace(
                    runs_tsv=str(runs_tsv),
                    output=str(summary_path),
                    warmup_count=2,
                    cooldown_count=0,
                    jfr_captured=1,
                )
            )
            summary = json.loads(summary_path.read_text(encoding="utf-8"))

        self.assertEqual(return_code, 0)
        self.assertEqual(summary["summary_schema_version"], 2)
        self.assertEqual(
            summary["benchmark_protocol"],
            model_speed.current_benchmark_protocol(2),
        )
        self.assertEqual(summary["metric_summary"]["wall_clock_seconds"]["mean"], 11.0)
        self.assertEqual(summary["metric_summary"]["process_wall_clock_seconds"]["mean"], 33.0)
        self.assertEqual(summary["median_jfr_same_jvm_warmup_count"], 2)
        self.assertTrue(summary["median_jfr_protocol_matches_measured_runs"])

    def test_summary_rejects_cli_row_and_scope_protocol_mismatches(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            summary_path = root / "summary.json"

            mismatched_row_tsv = root / "row-mismatch.tsv"
            _write_runs_tsv(
                mismatched_row_tsv,
                [_row(root, "run-row-mismatch", warmup_count=1, wall=10.0, process_wall=20.0)],
            )
            with self.assertRaisesRegex(SystemExit, "does not match --warmup-count=2"):
                model_speed.benchmark_summary(
                    Namespace(
                        runs_tsv=str(mismatched_row_tsv),
                        output=str(summary_path),
                        warmup_count=2,
                        cooldown_count=0,
                        jfr_captured=0,
                    )
                )

            bad_scope_tsv = root / "scope-mismatch.tsv"
            bad_scope_row = _row(
                root,
                "run-scope-mismatch",
                warmup_count=2,
                wall=10.0,
                process_wall=30.0,
            )
            scope_path = Path(str(bad_scope_row["measurement_scope_path"]))
            scope_path.write_text(
                scope_path.read_text(encoding="utf-8").replace(
                    model_speed.BENCHMARK_WALL_CLOCK_SCOPE,
                    "whole_jvm_process",
                    1,
                ),
                encoding="utf-8",
            )
            _write_runs_tsv(bad_scope_tsv, [bad_scope_row])
            with self.assertRaisesRegex(SystemExit, "wall_clock_seconds_scope"):
                model_speed.benchmark_summary(
                    Namespace(
                        runs_tsv=str(bad_scope_tsv),
                        output=str(summary_path),
                        warmup_count=2,
                        cooldown_count=0,
                        jfr_captured=0,
                    )
                )

    def test_comparison_allows_matching_protocol_and_rejects_mixed_scopes_or_warmups(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            output_path = root / "comparison.md"
            baseline = _comparison_summary(10.0, warmup_count=1)
            candidate = _comparison_summary(9.0, warmup_count=1)
            baseline_path = _write_json(root / "baseline.json", baseline)
            candidate_path = _write_json(root / "candidate.json", candidate)

            return_code = model_speed.benchmark_compare(
                Namespace(
                    verdict_metric="wall_clock_seconds",
                    comparison=[("mode", str(baseline_path), str(candidate_path))],
                    output=str(output_path),
                )
            )
            report = output_path.read_text(encoding="utf-8")
            self.assertEqual(return_code, 0)
            self.assertIn(model_speed.BENCHMARK_PROTOCOL_ID, report)
            self.assertIn("Same-JVM warm-ups per measured sample: `1`", report)

            candidate["benchmark_protocol"] = model_speed.current_benchmark_protocol(2)
            _write_json(candidate_path, candidate)
            with self.assertRaisesRegex(SystemExit, "same_jvm_warmup_count"):
                model_speed.benchmark_compare(
                    Namespace(
                        verdict_metric="wall_clock_seconds",
                        comparison=[("mode", str(baseline_path), str(candidate_path))],
                        output=str(output_path),
                    )
                )

            legacy = _comparison_summary(10.0, warmup_count=0)
            del legacy["benchmark_protocol"]
            legacy["warmup_count"] = 0
            legacy_path = _write_json(root / "legacy.json", legacy)
            candidate_path = _write_json(
                candidate_path,
                _comparison_summary(9.0, warmup_count=0),
            )
            with self.assertRaisesRegex(SystemExit, "wall_clock_seconds_scope"):
                model_speed.benchmark_compare(
                    Namespace(
                        verdict_metric="wall_clock_seconds",
                        comparison=[("mode", str(legacy_path), str(candidate_path))],
                        output=str(output_path),
                    )
                )

    def test_ambiguous_legacy_warmed_summary_fails_closed(self) -> None:
        legacy = _comparison_summary(10.0, warmup_count=3)
        del legacy["benchmark_protocol"]
        legacy["warmup_count"] = 3

        with self.assertRaisesRegex(SystemExit, "historical wall-clock scope is ambiguous"):
            model_speed.benchmark_protocol_from_summary(legacy, label="legacy-summary")

    def test_inferred_legacy_zero_warmup_protocol_can_be_persisted_and_reloaded(self) -> None:
        legacy = _comparison_summary(10.0, warmup_count=0)
        del legacy["benchmark_protocol"]
        inferred = model_speed.benchmark_protocol_from_summary(legacy, label="legacy-summary")
        legacy["benchmark_protocol"] = inferred

        reloaded = model_speed.benchmark_protocol_from_summary(legacy, label="legacy-baseline")

        self.assertEqual(reloaded["protocol_id"], model_speed.LEGACY_BENCHMARK_PROTOCOL_ID)
        self.assertEqual(
            reloaded["wall_clock_seconds_scope"],
            model_speed.LEGACY_BENCHMARK_WALL_CLOCK_SCOPE,
        )

    def test_tracked_historical_baseline_is_classified_as_legacy_whole_process(self) -> None:
        baseline_path = Path(
            "docs/model-speed/baselines/v0-core-minimal-10k-s1.summary.json"
        )
        baseline = json.loads(baseline_path.read_text(encoding="utf-8"))

        protocol = model_speed.benchmark_protocol_from_summary(
            baseline,
            label=str(baseline_path),
        )

        self.assertEqual(protocol["protocol_id"], model_speed.LEGACY_BENCHMARK_PROTOCOL_ID)
        self.assertEqual(
            protocol["wall_clock_seconds_scope"],
            model_speed.LEGACY_BENCHMARK_WALL_CLOCK_SCOPE,
        )

    def test_baseline_snapshot_preserves_the_protocol(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            runs_tsv = root / "runs.tsv"
            summary_path = root / "summary.json"
            baseline_path = root / "baseline.json"
            _write_runs_tsv(
                runs_tsv,
                [_row(root, "run-001", warmup_count=1, wall=10.0, process_wall=21.0)],
            )
            model_speed.benchmark_summary(
                Namespace(
                    runs_tsv=str(runs_tsv),
                    output=str(summary_path),
                    warmup_count=1,
                    cooldown_count=0,
                    jfr_captured=0,
                )
            )

            model_speed.baseline_snapshot(
                Namespace(
                    summary=str(summary_path),
                    environment=None,
                    output=str(baseline_path),
                    baseline_id="test-baseline",
                    snapshot="v0",
                    validation_dataset="r8",
                    mode="core-minimal-10k-s1",
                    purpose="test",
                    contract="summary",
                    manifest_path=None,
                )
            )
            baseline = json.loads(baseline_path.read_text(encoding="utf-8"))

        self.assertEqual(
            baseline["benchmark_protocol"],
            model_speed.current_benchmark_protocol(1),
        )
        self.assertEqual(baseline["source_run"]["summary_schema_version"], 2)


def _row(
    root: Path,
    run_id: str,
    *,
    warmup_count: int,
    wall: float,
    process_wall: float,
) -> dict[str, object]:
    scope_path = root / f"{run_id}-measurement-scope.properties"
    scope_path.write_text(
        "\n".join(
            (
                f"wall_clock_seconds_scope={model_speed.BENCHMARK_WALL_CLOCK_SCOPE}",
                f"process_wall_clock_seconds_scope={model_speed.BENCHMARK_PROCESS_WALL_CLOCK_SCOPE}",
                f"model_computing_seconds_scope={model_speed.BENCHMARK_MODEL_COMPUTING_SCOPE}",
                f"denominator_scope={model_speed.BENCHMARK_NORMALIZATION_SCOPE}",
                f"same_jvm_warmup_count={warmup_count}",
            )
        )
        + "\n",
        encoding="utf-8",
    )
    manifest_path = root / f"{run_id}-model-output.sha256"
    manifest_path.write_text("a" * 64 + "  Output-run1.csv\n", encoding="utf-8")
    return {
        "run_id": run_id,
        "wall_clock_seconds": wall,
        "process_wall_clock_seconds": process_wall,
        "model_computing_seconds": wall,
        "seconds_per_household_month": wall / 10_000,
        "ns_per_household_month": wall * 100_000,
        "same_jvm_warmup_count": warmup_count,
        "output_bytes": 1234,
        "max_rss_kb": 100_000,
        "user_cpu_seconds": process_wall - 1.0,
        "system_cpu_seconds": 0.5,
        "gc_pause_count": 2,
        "gc_pause_time_ms_total": 3.0,
        "manifest_path": str(manifest_path),
        "measurement_scope_path": str(scope_path),
    }


def _write_runs_tsv(path: Path, rows: list[dict[str, object]]) -> None:
    headers = [
        "run_id",
        *model_speed.BENCHMARK_NUMERIC_KEYS,
        "same_jvm_warmup_count",
        "manifest_path",
        "measurement_scope_path",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def _comparison_summary(mean: float, *, warmup_count: int) -> dict[str, object]:
    return {
        "run_count": 2,
        "warmup_count": warmup_count,
        "benchmark_protocol": model_speed.current_benchmark_protocol(warmup_count),
        "metric_summary": {
            "wall_clock_seconds": model_speed.metric_stats([mean - 0.1, mean + 0.1]),
            "seconds_per_household_month": model_speed.metric_stats(
                [(mean - 0.1) / 10_000, (mean + 0.1) / 10_000]
            ),
        },
    }


def _write_json(path: Path, payload: dict[str, object]) -> Path:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


if __name__ == "__main__":
    unittest.main()
