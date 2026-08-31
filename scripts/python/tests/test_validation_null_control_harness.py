#!/usr/bin/env python3
"""Contract tests for the null-control shell entry point."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "scripts" / "model" / "run-null-control.sh"


class TestValidationNullControlHarness(unittest.TestCase):
    def _run_with_recording_python(
        self,
        temp_root: Path,
        mode: str,
        *,
        output_dir: Path | None = None,
        extra_env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        fake_bin = temp_root / "bin"
        fake_bin.mkdir(exist_ok=True)
        fake_python = fake_bin / "python3"
        fake_python.write_text(
            "#!/bin/sh\nprintf '%s\\n' \"$@\"\n",
            encoding="utf-8",
        )
        fake_python.chmod(0o755)

        resolved_output_dir = output_dir or temp_root / "output"
        env = os.environ.copy()
        env.update(
            {
                "HOME": str(temp_root),
                "OUTPUT_DIR": str(resolved_output_dir),
                "PATH": f"{fake_bin}{os.pathsep}{env['PATH']}",
            }
        )
        if extra_env:
            env.update(extra_env)
        return subprocess.run(
            ["bash", str(SCRIPT), mode],
            cwd=REPO_ROOT,
            env=env,
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def _assert_option_value(
        self,
        lines: list[str],
        option: str,
        expected: str,
    ) -> None:
        option_index = lines.index(option)
        self.assertEqual(lines[option_index + 1], expected)

    def test_wrapper_passes_identity_settings_explicitly_and_keeps_jvm_tuning(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            fake_bin = temp_root / "bin"
            fake_bin.mkdir()
            fake_python = fake_bin / "python3"
            fake_python.write_text(
                "#!/bin/sh\nprintf '%s\\n' \"$@\"\n",
                encoding="utf-8",
            )
            fake_python.chmod(0o755)

            env = os.environ.copy()
            env.update(
                {
                    "HOME": str(temp_root),
                    "OUTPUT_DIR": str(temp_root / "output"),
                    "PATH": f"{fake_bin}{os.pathsep}{env['PATH']}",
                    "MAVEN_OPTS": "-Xms1g -Xmx2g",
                }
            )
            result = subprocess.run(
                ["bash", str(SCRIPT), "smoke"],
                cwd=REPO_ROOT,
                env=env,
                check=False,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            lines = result.stdout.splitlines()
            self.assertIn("--orderbook", lines)
            self.assertIn("array", lines)
            self.assertIn("--rng-mode", lines)
            self.assertIn("mersenne", lines)
            self.assertIn("--reuse-existing-output", lines)
            self.assertIn("MAVEN_OPTS  : -Xms1g -Xmx2g", result.stdout)

    def test_modes_select_reuse_and_distinct_summary_outputs(self) -> None:
        cases = (
            ("smoke", True, "summary-smoke.json"),
            ("rescore", True, "summary-rescore.json"),
            ("full", False, "summary.json"),
        )
        for mode, expects_reuse, summary_name in cases:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp_dir:
                temp_root = Path(tmp_dir)
                output_dir = temp_root / "output"
                result = self._run_with_recording_python(
                    temp_root,
                    mode,
                    output_dir=output_dir,
                )

                self.assertEqual(result.returncode, 0, result.stderr)
                lines = result.stdout.splitlines()
                self._assert_option_value(
                    lines,
                    "--json-out",
                    str(output_dir / summary_name),
                )
                self.assertEqual(
                    "--reuse-existing-output" in lines,
                    expects_reuse,
                )

    def test_adopt_legacy_is_manifest_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            result = self._run_with_recording_python(temp_root, "adopt-legacy")

            self.assertEqual(result.returncode, 0, result.stderr)
            lines = result.stdout.splitlines()
            self.assertIn("--adopt-legacy", lines)
            self.assertNotIn("--json-out", lines)
            self.assertNotIn("--reuse-existing-output", lines)

    def test_adopt_legacy_does_not_treat_current_maven_opts_as_generation_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            result = self._run_with_recording_python(
                temp_root,
                "adopt-legacy",
                extra_env={"MAVEN_OPTS": "-Xmx2g -Dhousing.orderbook=tree"},
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("--adopt-legacy", result.stdout.splitlines())

    def test_logs_are_unique_and_do_not_truncate_legacy_log(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            output_dir = temp_root / "output"
            output_dir.mkdir()
            legacy_log = output_dir / "run-full.log"
            sentinel = "hash-anchored legacy evidence\n"
            legacy_log.write_text(sentinel, encoding="utf-8")

            first = self._run_with_recording_python(
                temp_root,
                "full",
                output_dir=output_dir,
            )
            second = self._run_with_recording_python(
                temp_root,
                "full",
                output_dir=output_dir,
            )

            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(legacy_log.read_text(encoding="utf-8"), sentinel)
            log_dir = Path(f"{output_dir}-logs")
            logs = sorted(log_dir.glob("run-full.*"))
            self.assertEqual(len(logs), 2)
            self.assertEqual(len({path.name for path in logs}), 2)
            self.assertTrue(all(path.parent == log_dir for path in logs))
            self.assertEqual(sorted(output_dir.iterdir()), [legacy_log])

    def test_wrapper_rejects_hidden_model_controls_in_ambient_jvm_options(self) -> None:
        cases = (
            ("MAVEN_OPTS", "housing.orderbook"),
            ("MAVEN_ARGS", "housing.rng"),
            ("JAVA_TOOL_OPTIONS", "housing.benchmark.sameJvmWarmupRuns"),
            ("_JAVA_OPTIONS", "housing.benchmark.warmupOutputRoot"),
            ("JDK_JAVA_OPTIONS", "housing.orderbook"),
        )
        for variable_name, property_name in cases:
            with self.subTest(
                variable_name=variable_name,
                property_name=property_name,
            ), tempfile.TemporaryDirectory() as tmp_dir:
                env = os.environ.copy()
                env.update(
                    {
                        "HOME": tmp_dir,
                        "OUTPUT_DIR": str(Path(tmp_dir) / "output"),
                        variable_name: f"-Xmx2g -D{property_name}=conflict",
                    }
                )
                result = subprocess.run(
                    ["bash", str(SCRIPT), "smoke"],
                    cwd=REPO_ROOT,
                    env=env,
                    check=False,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )

                self.assertEqual(result.returncode, 2)
                self.assertIn(f"must not set -D{property_name}", result.stderr)
                self.assertIn(variable_name, result.stderr)
                self.assertFalse((Path(tmp_dir) / "output").exists())

    def test_direct_python_entry_rejects_ambient_model_control_flags(self) -> None:
        python_entry = REPO_ROOT / "scripts" / "python" / "experiments" / "model" \
            / "validation_null_control.py"
        for variable_name, property_name, value in (
            ("MAVEN_OPTS", "housing.orderbook", "tree"),
            ("MAVEN_ARGS", "housing.rng", "philox-household"),
            ("JAVA_TOOL_OPTIONS", "housing.benchmark.sameJvmWarmupRuns", "1"),
            ("_JAVA_OPTIONS", "housing.benchmark.warmupOutputRoot", "/tmp/warmup"),
            ("JDK_JAVA_OPTIONS", "housing.benchmark.sameJvmWarmupRuns", "1"),
        ):
            with self.subTest(
                variable_name=variable_name,
                property_name=property_name,
            ), tempfile.TemporaryDirectory() as tmp_dir:
                output_dir = Path(tmp_dir) / "must-not-be-created"
                env = os.environ.copy()
                env[variable_name] = f"-Xmx2g -D{property_name}={value}"
                result = subprocess.run(
                    [
                        sys.executable,
                        str(python_entry),
                        "--version",
                        "v5o3",
                        "--output-dir",
                        str(output_dir),
                    ],
                    cwd=REPO_ROOT,
                    env=env,
                    check=False,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )

                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"-D{property_name}", result.stderr)
                self.assertIn("hidden identity setting", result.stderr)
                self.assertFalse(output_dir.exists())


if __name__ == "__main__":
    unittest.main()
