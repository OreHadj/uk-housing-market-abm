"""Compare Mersenne and philox-household runs with the repository's validation code.

Reproduces the random-number evaluation figures:

* the 17-metric composite and metric losses for each mode, scored over the standard
  validation window;
* each metric's change between modes in units of the null-control standard deviation (the
  standard deviation of the 20 eight-seed set scores from scripts/model/run-null-control.sh),
  flagging changes beyond two standard deviations;
* Jensen-Shannon distances between the two modes' pooled household income, housing wealth and
  financial wealth distributions, set against the distances between the 20 null-control sets;
* a file-by-file comparison of the Mersenne runs with the same seeds in the null control.

The three Wealth and Assets Survey indicators are not scored, because the survey microdata are
licensed and not held in the repository.

Usage:
  python3 scripts/python/experiments/model/rng_mode_comparison.py \\
      --mersenne <dir> --hybrid <dir> --null-control <dir> [--rescore-null-control]

Each mode directory holds seed-1 ... seed-8 output folders, as written by
scripts/model/run-rng-evaluation.sh compare. --null-control is the output folder of
scripts/model/run-null-control.sh full: seed-1 ... seed-160 plus summary.json.
--rescore-null-control also re-scores the 20 null-control sets from their raw outputs and checks
them against summary.json.
"""

from __future__ import annotations

import argparse
import dataclasses
import itertools
import json
import math
import statistics
import sys
import warnings
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))

from scripts.python.validation.model.extractors import (  # noqa: E402
    HOUSEHOLD_DISTRIBUTION_SPECS,
    _load_model_distribution_values,
)
from scripts.python.validation.model.runner import (  # noqa: E402
    build_validation_summary,
    load_reused_validation_results,
)
from scripts.python.validation.model.schema import (  # noqa: E402
    VALIDATION_WINDOW_END,
    VALIDATION_WINDOW_START,
)
from scripts.python.validation.model.validation_profiles import (  # noqa: E402
    resolve_validation_profile,
)

VERSION = "v5o3"
SEEDS = list(range(1, 9))
NULL_SETS = 20
SET_SIZE = 8
FLAG_THRESHOLD_SDS = 2.0


def profile_without_household_jsd():
    profile = resolve_validation_profile(VERSION)
    kept = {k: v for k, v in profile.targets_by_id.items() if v.kind != "household_jsd"}
    return dataclasses.replace(
        profile,
        target_catalog=[m for m in profile.target_catalog if m.metric_id in kept],
        targets_by_id=kept,
    )


def score(output_dir: Path, seeds: list[int], profile) -> dict:
    results = load_reused_validation_results(
        output_dir=output_dir,
        seeds=seeds,
        was_data_root=REPO_ROOT,
        validation_profile=profile,
        window_start=VALIDATION_WINDOW_START,
        window_end=VALIDATION_WINDOW_END,
        use_cached_seed_results=False,
    )
    summary = build_validation_summary(
        version=VERSION,
        seed_results=results,
        seeds=seeds,
        validation_profile=profile,
        window_start=VALIDATION_WINDOW_START,
        window_end=VALIDATION_WINDOW_END,
    )
    return {
        "composite": summary["overallCompositeLoss"],
        "metrics": {m["metricId"]: m.get("metricLoss") for m in summary["metrics"]},
    }


def jsd(p: np.ndarray, q: np.ndarray) -> float:
    m = 0.5 * (p + q)

    def kl(a, b):
        return float(np.sum(np.where(a > 0, a * np.log(np.where(a > 0, a, 1) / np.where(b > 0, b, 1)), 0.0)))

    return math.sqrt(0.5 * (kl(p, m) + kl(q, m)))


def histogram(seed_dir: Path, spec) -> np.ndarray:
    values = _load_model_distribution_values(seed_dir / spec.results_file_name, spec)
    return np.histogram(values, bins=spec.bin_edges)[0].astype(float)


def normalise(counts: np.ndarray) -> np.ndarray:
    return counts / counts.sum()


def null_set_seeds(index: int) -> list[int]:
    return list(range(1 + SET_SIZE * index, 1 + SET_SIZE * (index + 1)))


def report_scores(mersenne: dict, hybrid: dict, summary: dict) -> None:
    print(f"window {VALIDATION_WINDOW_START} <= t < {VALIDATION_WINDOW_END}, "
          f"{len(mersenne['metrics'])} metrics, seeds {SEEDS[0]}-{SEEDS[-1]}")
    print(f"mersenne composite {mersenne['composite']!r}")
    print(f"hybrid   composite {hybrid['composite']!r}")
    sd = summary["composite"]["sd"]
    diff = hybrid["composite"] - mersenne["composite"]
    print(f"composite: mersenne={mersenne['composite']:.6f} hybrid={hybrid['composite']:.6f} "
          f"diff={diff:+.6f} = {diff / sd:+.3f} control SD (sd={sd:.6f})")
    rows = []
    for metric_id, m_loss in mersenne["metrics"].items():
        h_loss = hybrid["metrics"][metric_id]
        metric_sd = summary["perMetric"][metric_id]["sd"]
        rows.append((metric_id, m_loss, h_loss, metric_sd, (h_loss - m_loss) / metric_sd))
    for metric_id, m_loss, h_loss, metric_sd, z in sorted(rows, key=lambda r: -abs(r[4])):
        print(f"{metric_id:28s} mersenne={m_loss:.6f} hybrid={h_loss:.6f} "
              f"control_sd={metric_sd:.6f} z={z:+.2f}")
    flagged = sum(abs(r[4]) > FLAG_THRESHOLD_SDS for r in rows)
    print(f"metrics beyond {FLAG_THRESHOLD_SDS:g} control SD: {flagged}")


def report_distributions(mersenne_dir: Path, hybrid_dir: Path, null_dir: Path) -> None:
    for metric_id, spec in HOUSEHOLD_DISTRIBUTION_SPECS.items():
        counts = {(mode, s): histogram(d / f"seed-{s}", spec)
                  for mode, d in (("mersenne", mersenne_dir), ("hybrid", hybrid_dir)) for s in SEEDS}
        pooled = {mode: normalise(sum(counts[mode, s] for s in SEEDS)) for mode in ("mersenne", "hybrid")}
        cross = jsd(pooled["mersenne"], pooled["hybrid"])
        pairs = [jsd(normalise(counts["mersenne", a]), normalise(counts["mersenne", b]))
                 for a, b in itertools.combinations(SEEDS, 2)]
        print(f"{metric_id:36s} pooled cross-mode JSD={cross:.5f}  mean Mersenne seed-pair "
              f"JSD={np.mean(pairs):.5f} (n={len(pairs)}, min {min(pairs):.5f})")
        sets = [normalise(sum(histogram(null_dir / f"seed-{s}", spec) for s in null_set_seeds(i)))
                for i in range(NULL_SETS)]
        d = np.array([jsd(a, b) for a, b in itertools.combinations(sets, 2)])
        print(f"{'':36s} null-control set-vs-set JSD over {len(d)} pairs: mean {d.mean():.5f} "
              f"median {np.median(d):.5f} min {d.min():.5f} p95 {np.percentile(d, 95):.5f} "
              f"max {d.max():.5f}; share >= cross-mode value {float((d >= cross).mean()):.3f}")


def report_null_control_files(mersenne_dir: Path, null_dir: Path) -> None:
    total = same = 0
    differing = []
    for s in SEEDS:
        for path in sorted((null_dir / f"seed-{s}").glob("*.csv")):
            other = mersenne_dir / f"seed-{s}" / path.name
            if not other.is_file():
                continue
            total += 1
            if path.read_bytes() == other.read_bytes():
                same += 1
            else:
                differing.append(f"seed-{s}/{path.name}")
    print(f"mersenne runs vs null-control seeds {SEEDS[0]}-{SEEDS[-1]}: {same} of {total} CSV files "
          f"identical" + (f"; differing: {', '.join(differing)}" if differing else ""))


def rescore_null_control(null_dir: Path, summary: dict, profile) -> None:
    recorded = summary["sets"]
    rows = [score(null_dir, null_set_seeds(i), profile) for i in range(NULL_SETS)]
    composite_diff = max(abs(r["composite"] - s["compositeLoss"]) for r, s in zip(rows, recorded))
    metric_diff = max(abs(r["metrics"][k] - s["metricLosses"][k])
                      for r, s in zip(rows, recorded) for k in s["metricLosses"])
    print(f"max |rescored - recorded| over {NULL_SETS} sets: composite {composite_diff}, "
          f"any metric {metric_diff}")
    print(f"rescored composite sd {statistics.stdev(r['composite'] for r in rows)!r} "
          f"(recorded {summary['composite']['sd']!r})")
    worst = max(abs(statistics.stdev(r["metrics"][k] for r in rows) - v["sd"])
                for k, v in summary["perMetric"].items())
    print(f"max |rescored - recorded| per-metric sd: {worst}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--mersenne", type=Path, required=True)
    parser.add_argument("--hybrid", type=Path, required=True)
    parser.add_argument("--null-control", type=Path, required=True)
    parser.add_argument("--rescore-null-control", action="store_true")
    args = parser.parse_args(argv)
    warnings.filterwarnings("ignore")

    summary = json.loads((args.null_control / "summary.json").read_text())
    profile = profile_without_household_jsd()
    mersenne = score(args.mersenne, SEEDS, profile)
    hybrid = score(args.hybrid, SEEDS, profile)

    print("== validation scores")
    report_scores(mersenne, hybrid, summary)
    print("\n== household distributions (Jensen-Shannon distance, 0 = identical)")
    report_distributions(args.mersenne, args.hybrid, args.null_control)
    print("\n== Mersenne outputs against the null control")
    report_null_control_files(args.mersenne, args.null_control)
    if args.rescore_null_control:
        print("\n== null-control re-score")
        rescore_null_control(args.null_control, summary, profile)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
