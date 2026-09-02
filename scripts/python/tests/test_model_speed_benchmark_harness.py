#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Contract tests for the serial model-speed benchmark harness."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


class TestModelSpeedBenchmarkHarness(unittest.TestCase):
    def test_help_and_wiring_require_per_sample_same_jvm_warmup(self) -> None:
        bash = shutil.which("bash")
        self.assertIsNotNone(bash)
        result = subprocess.run(
            [bash, "scripts/model/run-speed-benchmark.sh", "--help"],
            check=False,
            encoding="utf-8",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Same-JVM warm-up simulations before every measured sample", result.stdout)

        harness = Path("scripts/model/run-speed-benchmark.sh").read_text(encoding="utf-8")
        library = Path("scripts/model/model-speed-lib.sh").read_text(encoding="utf-8")
        cache_harness = Path("scripts/model/run-cache-paired-benchmark.sh").read_text(
            encoding="utf-8"
        )
        self.assertIn('MODEL_SPEED_SAME_JVM_WARMUP_COUNT="${warmup}"', harness)
        self.assertIn(
            'MODEL_SPEED_TIMING_PROTOCOL="same-jvm-measured-phase-v1"',
            harness,
        )
        self.assertIn('MODEL_SPEED_TIMING_PROTOCOL="legacy-process-v0"', cache_harness)
        self.assertNotIn('"${run_root}/warmup/${run_id}"', harness)
        self.assertIn("housing.benchmark.sameJvmWarmupRuns", library)
        self.assertIn("BENCHMARK_MEASURED_WALL_SECONDS", library)
        self.assertIn(
            '"-Dhousing.benchmark.sameJvmWarmupRuns=${same_jvm_warmup_count}"',
            library,
        )
        self.assertIn('wall_clock_seconds="${process_wall_clock_seconds}"', library)
        self.assertIn('MODEL_SPEED_TIMING_PROTOCOL:-legacy-process-v0', library)
        self.assertIn("model_speed_require_timing_tools || return 1", library)
        self.assertIn(
            "wall_clock_seconds_scope=measured_model_phase_only_excludes_warmup_and_jvm_startup",
            library,
        )
        self.assertIn("whole_jvm_process_includes_startup_and_same_jvm_warmup", library)

    def test_median_jfr_uses_the_measured_warmup_protocol_and_is_recorded_after_success(self) -> None:
        harness = Path("scripts/model/run-speed-benchmark.sh").read_text(encoding="utf-8")

        jfr_run = harness.index("-XX:StartFlightRecording=filename=${median_jfr_file}")
        ancillary_reset = harness.index("MODEL_SPEED_SAME_JVM_WARMUP_COUNT=0", jfr_run)
        captured_summary = harness.index("--jfr-captured 1", jfr_run)

        self.assertLess(jfr_run, captured_summary)
        self.assertLess(captured_summary, ancillary_reset)
        self.assertIn("--jfr-captured 0", harness[:jfr_run])

    def test_measured_wall_parser_requires_exactly_one_protocol_value(self) -> None:
        bash = shutil.which("bash")
        self.assertIsNotNone(bash)
        with tempfile.TemporaryDirectory() as tmp:
            stdout_log = Path(tmp) / "model.stdout.log"
            stdout_log.write_text(
                "BENCHMARK_PHASE phase=measured index=1 count=1\n"
                "BENCHMARK_MEASURED_WALL_SECONDS=1.23456789E-3\n",
                encoding="utf-8",
            )
            command = (
                'source scripts/model/model-speed-lib.sh; '
                'model_speed_extract_benchmark_measured_seconds "$1"'
            )
            valid = subprocess.run(
                [bash, "-c", command, "model-speed-parser", str(stdout_log)],
                check=False,
                encoding="utf-8",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.assertEqual(valid.returncode, 0, valid.stderr)
            self.assertEqual("1.23456789E-3", valid.stdout.strip())

            stdout_log.write_text(
                "BENCHMARK_MEASURED_WALL_SECONDS=1.0\n"
                "BENCHMARK_MEASURED_WALL_SECONDS=2.0\n",
                encoding="utf-8",
            )
            duplicate = subprocess.run(
                [bash, "-c", command, "model-speed-parser", str(stdout_log)],
                check=False,
                encoding="utf-8",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.assertNotEqual(duplicate.returncode, 0)

            stdout_log.write_text(
                "BENCHMARK_MEASURED_WALL_SECONDS=0.0\n",
                encoding="utf-8",
            )
            non_positive = subprocess.run(
                [bash, "-c", command, "model-speed-parser", str(stdout_log)],
                check=False,
                encoding="utf-8",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.assertNotEqual(non_positive.returncode, 0)

    def test_protocol_verifier_requires_metadata_and_exact_phase_sequence(self) -> None:
        bash = shutil.which("bash")
        self.assertIsNotNone(bash)
        command = (
            'source scripts/model/model-speed-lib.sh; '
            'model_speed_verify_benchmark_protocol "$1" "$2"'
        )
        with tempfile.TemporaryDirectory() as tmp:
            stdout_log = Path(tmp) / "model.stdout.log"
            stdout_log.write_text(
                "BENCHMARK_PHASE phase=warmup index=1 count=1\n"
                "BENCHMARK_PHASE phase=measured index=1 count=1\n"
                "BENCHMARK_METADATA sameJvmWarmupRuns=1 measuredSimulations=1 "
                "orderBook=array rngMode=mersenne\n"
                "BENCHMARK_MEASURED_WALL_SECONDS=1.25\n",
                encoding="utf-8",
            )
            valid = subprocess.run(
                [bash, "-c", command, "model-speed-protocol", str(stdout_log), "1"],
                check=False,
                encoding="utf-8",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.assertEqual(valid.returncode, 0, valid.stderr)

            wrong_count = subprocess.run(
                [bash, "-c", command, "model-speed-protocol", str(stdout_log), "2"],
                check=False,
                encoding="utf-8",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.assertNotEqual(wrong_count.returncode, 0)
            self.assertIn("sameJvmWarmupRuns", wrong_count.stderr)

            stdout_log.write_text(
                "BENCHMARK_PHASE phase=measured index=1 count=1\n"
                "BENCHMARK_MEASURED_WALL_SECONDS=1.25\n",
                encoding="utf-8",
            )
            missing_metadata = subprocess.run(
                [bash, "-c", command, "model-speed-protocol", str(stdout_log), "0"],
                check=False,
                encoding="utf-8",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.assertNotEqual(missing_metadata.returncode, 0)
            self.assertIn("BENCHMARK_METADATA", missing_metadata.stderr)

    def test_legacy_protocol_rejects_markers_and_reserved_option_injection(self) -> None:
        bash = shutil.which("bash")
        self.assertIsNotNone(bash)
        verify_command = (
            'source scripts/model/model-speed-lib.sh; '
            'model_speed_verify_legacy_protocol "$1"'
        )
        option_command = (
            'source scripts/model/model-speed-lib.sh; '
            'model_speed_reject_reserved_benchmark_options "$1"'
        )
        with tempfile.TemporaryDirectory() as tmp:
            stdout_log = Path(tmp) / "model.stdout.log"
            stdout_log.write_text("Computing time: 1.25\n", encoding="utf-8")
            ordinary = subprocess.run(
                [bash, "-c", verify_command, "legacy-protocol", str(stdout_log)],
                check=False,
                encoding="utf-8",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.assertEqual(ordinary.returncode, 0, ordinary.stderr)

            stdout_log.write_text(
                "BENCHMARK_PHASE phase=measured index=1 count=1\n"
                "BENCHMARK_METADATA sameJvmWarmupRuns=0\n"
                "BENCHMARK_MEASURED_WALL_SECONDS=1.25\n",
                encoding="utf-8",
            )
            injected_output = subprocess.run(
                [bash, "-c", verify_command, "legacy-protocol", str(stdout_log)],
                check=False,
                encoding="utf-8",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.assertNotEqual(injected_output.returncode, 0)
            self.assertIn("unexpected benchmark marker", injected_output.stderr)

            reserved_option = subprocess.run(
                [
                    bash,
                    "-c",
                    option_command,
                    "legacy-protocol",
                    "-Xmx4g -Dhousing.benchmark.sameJvmWarmupRuns=0",
                ],
                check=False,
                encoding="utf-8",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.assertNotEqual(reserved_option.returncode, 0)
            self.assertIn("timing protocol owns", reserved_option.stderr)


if __name__ == "__main__":
    unittest.main()
