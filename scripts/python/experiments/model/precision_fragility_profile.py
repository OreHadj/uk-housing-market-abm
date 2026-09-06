#!/usr/bin/env python3
"""Run precision-fragility diagnostics without confusing them with validation.

The default ``shadow`` mode executes one canonical FP64 trajectory per seed and evaluates the
entire registered q grid (every q from 52 through 40, then 32, 23, 16, 10, 8, 6, 4, and 2) at
every instrumented boundary. ``stress``
executes one selected low-q arm and may continue only through reviewed BTL preview failures before
stopping at the household-phase boundary. ``candidate`` executes one q arm fail-fast.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.python.experiments.model.precision_decorrelation_gate import (  # noqa: E402
    prepare_classpath,
    prepare_configs,
    reject_ambient_controls,
    sha256_file,
)


Q_GRID = (52, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 32, 23, 16, 10, 8, 6, 4, 2)
EVENT_NAME = "precision-fragility-events-run001.csv"
EVENT_SUMMARY_NAME = "precision-event-summary-run001.csv"
BRANCH_NAME = "precision-branch-summary-run001.csv"
SHADOW_WRITES_NAME = "precision-shadow-writes-run001.csv"
EXECUTING_WRITES_NAME = "precision-writes-run001.csv"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--mode", choices=("shadow", "stress", "candidate"), default="shadow")
    parser.add_argument("--fraction-bits", type=int)
    parser.add_argument("--version", default="v5o3")
    parser.add_argument("--first-seed", type=int, default=1)
    parser.add_argument("--seeds", type=int, default=8)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--n-steps", type=int)
    parser.add_argument("--max-examples", type=int, default=25)
    parser.add_argument("--maven-bin")
    parser.add_argument("--java-bin")
    args = parser.parse_args()
    if args.seeds < 1 or args.first_seed < 1 or args.workers < 1:
        parser.error("--seeds, --first-seed, and --workers must be positive")
    if args.n_steps is not None and args.n_steps < 0:
        parser.error("--n-steps must be non-negative")
    if args.max_examples < 1:
        parser.error("--max-examples must be positive")
    if args.mode == "shadow" and args.fraction_bits is not None:
        parser.error("shadow mode sweeps the complete built-in q grid; omit --fraction-bits")
    if args.mode != "shadow" and args.fraction_bits is None:
        parser.error("executing stress and candidate modes require --fraction-bits")
    if args.fraction_bits is not None and not 0 <= args.fraction_bits <= 52:
        parser.error("--fraction-bits must be in [0, 52]")
    return args


def git_output(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=REPO_ROOT, check=True, capture_output=True, text=True
    ).stdout.strip()


def source_fingerprint() -> dict[str, object]:
    paths = [
        "pom.xml",
        "src/main",
        "scripts/python/experiments/model/precision_fragility_profile.py",
        "scripts/python/experiments/model/precision_decorrelation_gate.py",
    ]
    diff = git_output("diff", "--binary", "HEAD", "--", *paths)
    untracked = git_output(
        "ls-files", "--others", "--exclude-standard", "--", *paths
    ).splitlines()
    return {
        "commit": git_output("rev-parse", "HEAD"),
        "trackedDiffSha256": hashlib.sha256(diff.encode("utf-8")).hexdigest(),
        "untrackedFiles": {
            path: sha256_file(REPO_ROOT / path) for path in sorted(untracked) if path
        },
    }


def config_values(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


def command_for(
    *,
    java_bin: str,
    classpath: str,
    config: Path,
    output: Path,
    mode: str,
    fraction_bits: int | None,
    max_examples: int,
) -> list[str]:
    precision = ["-Dhousing.precision=fp64"]
    diagnostics = "false"
    if mode != "shadow":
        precision = [
            "-Dhousing.precision=mantissa",
            f"-Dhousing.mantissaBits={fraction_bits}",
        ]
        diagnostics = "true"
    return [
        java_bin,
        "-Xms256m",
        "-Xmx2g",
        "-Dhousing.orderbook=array",
        "-Dhousing.rng=philox-household",
        f"-Dhousing.precisionProbe={mode}",
        f"-Dhousing.precisionProbeMaxExamples={max_examples}",
        f"-Dhousing.precisionDiagnostics={diagnostics}",
        "-Dhousing.precisionGateTrace=false",
        *precision,
        "-cp",
        classpath,
        "housing.Model",
        "-configFile",
        str(config),
        "-outputFolder",
        str(output),
        "-dev",
    ]


def verify_metadata(stdout: str, mode: str, fraction_bits: int | None) -> None:
    fragility = [
        line for line in stdout.splitlines() if line.startswith("PRECISION_FRAGILITY_METADATA ")
    ]
    precision = [
        line for line in stdout.splitlines() if line.startswith("PRECISION_METADATA ")
    ]
    rng = [line for line in stdout.splitlines() if line.startswith("RNG_METADATA ")]
    if len(rng) != 1 or "rngMode=philox-household" not in rng[0]:
        raise RuntimeError(f"unexpected RNG metadata: {rng}")
    if len(fragility) != 1 or f"mode={mode}" not in fragility[0]:
        raise RuntimeError(f"unexpected fragility metadata: {fragility}")
    if mode == "shadow":
        expected_grid = ":".join(str(q) for q in Q_GRID)
        if (
            len(precision) != 1
            or "precision=fp64" not in precision[0]
            or f"shadowGrid={expected_grid}" not in precision[0]
        ):
            raise RuntimeError(f"unexpected shadow precision metadata: {precision}")
    elif (
        len(precision) != 1
        or "precision=mantissa" not in precision[0]
        or f"mantissaBits={fraction_bits}" not in precision[0]
    ):
        raise RuntimeError(f"unexpected executing precision metadata: {precision}")


def run_one(
    *,
    seed: int,
    config: Path,
    campaign_root: Path,
    java_bin: str,
    classpath: str,
    mode: str,
    fraction_bits: int | None,
    max_examples: int,
) -> dict[str, object]:
    output = campaign_root / "runs" / f"seed-{seed}"
    output.parent.mkdir(parents=True, exist_ok=True)
    process = subprocess.run(
        command_for(
            java_bin=java_bin,
            classpath=classpath,
            config=config,
            output=output,
            mode=mode,
            fraction_bits=fraction_bits,
            max_examples=max_examples,
        ),
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    log_dir = campaign_root / "logs"
    log_dir.mkdir(exist_ok=True)
    log = log_dir / f"seed-{seed}.log"
    combined_log = process.stdout + process.stderr
    log.write_text(combined_log, encoding="utf-8")
    verify_metadata(process.stdout, mode, fraction_bits)

    status = "complete"
    if process.returncode != 0:
        if mode == "stress" and "precision stress probe collected safe BTL-preview" in combined_log:
            status = "safe-stress-stop"
        elif "Bank.requestApproval produced a down-payment larger" in combined_log:
            status = "invalid-arm"
        else:
            status = "failed"

    expected = [EVENT_NAME, EVENT_SUMMARY_NAME, BRANCH_NAME]
    expected.append(SHADOW_WRITES_NAME if mode == "shadow" else EXECUTING_WRITES_NAME)
    missing = [name for name in expected if not (output / name).is_file()]
    if missing:
        raise RuntimeError(
            f"seed {seed} did not produce {missing}; exit={process.returncode}, log={log}"
        )
    return {
        "seed": seed,
        "status": status,
        "exitCode": process.returncode,
        "output": str(output),
        "log": str(log),
        "eventSha256": sha256_file(output / EVENT_NAME),
        "branchSha256": sha256_file(output / BRANCH_NAME),
        "writeSha256": sha256_file(output / expected[-1]),
    }


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def combine_csv(campaign_root: Path, seeds: list[int], source_name: str, target_name: str) -> None:
    rows: list[dict[str, str]] = []
    fieldnames: list[str] | None = None
    for seed in seeds:
        source = campaign_root / "runs" / f"seed-{seed}" / source_name
        with source.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            if fieldnames is None:
                fieldnames = list(reader.fieldnames or [])
            elif list(reader.fieldnames or []) != fieldnames:
                raise RuntimeError(f"CSV schema mismatch in {source}")
            rows.extend(reader)
    if fieldnames is None:
        raise RuntimeError(f"no rows available for {source_name}")
    with (campaign_root / target_name).open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def aggregate_shadow(campaign_root: Path, seeds: list[int]) -> dict[str, object]:
    by_q: dict[int, dict[str, int]] = {
        q: {
            "writes": 0,
            "changedWrites": 0,
            "branchEvaluations": 0,
            "branchFlips": 0,
            "eventOccurrences": 0,
        }
        for q in Q_GRID
    }
    q52_failures: list[str] = []
    for seed in seeds:
        root = campaign_root / "runs" / f"seed-{seed}"
        for row in read_rows(root / SHADOW_WRITES_NAME):
            q = int(row["q"])
            by_q[q]["writes"] += int(row["writes"])
            by_q[q]["changedWrites"] += int(row["changedWrites"])
            if q == 52 and int(row["changedWrites"]) != 0:
                q52_failures.append(f"seed {seed} field {row['field']} changed at q52")
        for row in read_rows(root / BRANCH_NAME):
            q = int(row["q"])
            by_q[q]["branchEvaluations"] += int(row["evaluations"])
            by_q[q]["branchFlips"] += int(row["flips"])
            by_q[q]["eventOccurrences"] += int(row["eventOccurrences"])
            if q == 52 and int(row["flips"]) != 0:
                q52_failures.append(f"seed {seed} site {row['site']} flipped at q52")
        for row in read_rows(root / EVENT_NAME):
            if int(row["q"]) == 52:
                q52_failures.append(
                    f"seed {seed} emitted q52 {row['eventKind']} at {row['site']}"
                )
    return {
        "qGrid": list(Q_GRID),
        "byQ": {str(q): by_q[q] for q in Q_GRID},
        "q52NoOp": not q52_failures,
        "q52Failures": q52_failures,
        "interpretation": (
            "Canonical-path discovery floor only: q-specific states and branch choices are not "
            "propagated, so executing reduced-precision arms may visit additional states."
        ),
    }


def main() -> int:
    args = parse_args()
    reject_ambient_controls()
    output_dir = args.output_dir.resolve()
    if output_dir.exists():
        raise SystemExit(f"refusing to overwrite existing campaign directory: {output_dir}")
    output_dir.mkdir(parents=True)

    seeds = list(range(args.first_seed, args.first_seed + args.seeds))
    classpath, discovered_java = prepare_classpath(output_dir, args.maven_bin)
    java_bin = args.java_bin or discovered_java
    configs = prepare_configs(
        output_dir,
        version=args.version,
        seeds=seeds,
        n_steps=args.n_steps,
    )
    values = config_values(configs[seeds[0]])
    manifest = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "mode": args.mode,
        "fractionBits": args.fraction_bits,
        "shadowQGrid": list(Q_GRID) if args.mode == "shadow" else None,
        "version": args.version,
        "seeds": seeds,
        "nSteps": int(values["N_STEPS"]),
        "targetPopulation": int(values["TARGET_POPULATION"]),
        "rngMode": "philox-household",
        "orderBook": "array",
        "frontier": "legacy",
        "fieldSet": "gate-probe-v1-no-age",
        "source": source_fingerprint(),
        "java": subprocess.run(
            [java_bin, "-version"], capture_output=True, text=True, check=True
        ).stderr.strip(),
    }
    (output_dir / "campaign.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(
        f"Running {args.mode} precision probe: seeds={len(seeds)}, "
        f"N_STEPS={manifest['nSteps']}, population={manifest['targetPopulation']}, "
        f"workers={args.workers}",
        flush=True,
    )

    records: list[dict[str, object]] = []
    failures: list[dict[str, object]] = []
    with ThreadPoolExecutor(
        max_workers=min(args.workers, len(seeds)), thread_name_prefix="precision-fragility"
    ) as executor:
        futures = {
            executor.submit(
                run_one,
                seed=seed,
                config=configs[seed],
                campaign_root=output_dir,
                java_bin=java_bin,
                classpath=classpath,
                mode=args.mode,
                fraction_bits=args.fraction_bits,
                max_examples=args.max_examples,
            ): seed
            for seed in seeds
        }
        for completed, future in enumerate(as_completed(futures), start=1):
            seed = futures[future]
            try:
                record = future.result()
                records.append(record)
                print(
                    f"Completed {completed}/{len(seeds)}: seed={seed} status={record['status']}",
                    flush=True,
                )
            except Exception as error:  # campaign evidence preserves every per-seed failure
                failures.append({"seed": seed, "error": str(error)})
                print(f"FAILED {completed}/{len(seeds)}: seed={seed}: {error}", flush=True)

    completed_seeds = sorted(int(record["seed"]) for record in records)
    aggregate: dict[str, object] | None = None
    if completed_seeds:
        combine_csv(output_dir, completed_seeds, EVENT_NAME, "events.csv")
        combine_csv(
            output_dir, completed_seeds, EVENT_SUMMARY_NAME, "event-summary.csv"
        )
        combine_csv(output_dir, completed_seeds, BRANCH_NAME, "branches.csv")
        writes_name = SHADOW_WRITES_NAME if args.mode == "shadow" else EXECUTING_WRITES_NAME
        combine_csv(output_dir, completed_seeds, writes_name, "writes.csv")
        if args.mode == "shadow":
            aggregate = aggregate_shadow(output_dir, completed_seeds)

    summary = {
        "campaign": manifest,
        "records": sorted(records, key=lambda row: int(row["seed"])),
        "failures": sorted(failures, key=lambda row: int(row["seed"])),
        "aggregate": aggregate,
    }
    (output_dir / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    if aggregate is not None:
        print(json.dumps(aggregate, indent=2, sort_keys=True), flush=True)
    print(f"Evidence: {output_dir}", flush=True)

    if failures or any(record["status"] == "failed" for record in records):
        return 2
    if args.mode == "shadow" and aggregate is not None and not aggregate["q52NoOp"]:
        return 3
    if any(record["status"] == "invalid-arm" for record in records):
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
