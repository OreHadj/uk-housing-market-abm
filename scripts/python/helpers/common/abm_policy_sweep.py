#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Shared helpers for snapshot-local ABM policy sweeps.

These helpers run the Java housing model against versioned input snapshots
without mutating `src/main/resources`.

@author: Max Stoddard
"""

from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Mapping, Sequence

from scripts.python.helpers.common.cli import format_float

RESOURCE_PATH_PATTERN = re.compile(r'"src/main/resources/([^"]+)"')
KPI_WINDOW_START_INDEX = 200
KPI_WINDOW_END_INDEX = 2000
KPI_WINDOW_SPEC = {
    "mode": "post_burn_in_slice",
    "start_index": KPI_WINDOW_START_INDEX,
    "end_index": KPI_WINDOW_END_INDEX,
}


@dataclass(frozen=True)
class IndicatorDefinition:
    """Definition of a supported core indicator output."""

    id: str
    title: str
    units: str
    file_name: str


@dataclass(frozen=True)
class SweepPoint:
    """One point on a policy sweep curve."""

    point_id: str
    point_index: int
    label: str
    x_value: float
    updates: dict[str, str]
    is_baseline: bool


@dataclass(frozen=True)
class RunRequest:
    """One model execution request."""

    stage_name: str
    story_id: str
    version: str
    seed: int
    point: SweepPoint


@dataclass(frozen=True)
class KpiValues:
    """KPI values computed from the fixed post-burn-in model window."""

    mean: float | None
    cv: float | None
    annualised_trend: float | None
    range: float | None


@dataclass(frozen=True)
class RunResult:
    """Per-run extracted KPI output."""

    stage_name: str
    story_id: str
    version: str
    seed: int
    point_id: str
    point_index: int
    point_label: str
    x_value: float
    updates: dict[str, str]
    is_baseline: bool
    output_dir: str
    config_path: str
    cached: bool
    indicators: dict[str, KpiValues]


@dataclass(frozen=True)
class AggregateStat:
    """Aggregated statistic over seeds."""

    mean: float
    stdev: float
    ci_low: float
    ci_high: float
    n: int


@dataclass(frozen=True)
class AggregatedIndicator:
    """Aggregated KPI bundle for one indicator."""

    mean: AggregateStat | None
    cv: AggregateStat | None
    annualised_trend: AggregateStat | None
    range: AggregateStat | None


@dataclass(frozen=True)
class AggregatedPoint:
    """Aggregated multi-seed point result."""

    point_id: str
    point_index: int
    label: str
    x_value: float
    updates: dict[str, str]
    is_baseline: bool
    indicators: dict[str, AggregatedIndicator]
    delta_indicators: dict[str, AggregatedIndicator]


@dataclass(frozen=True)
class AggregatedStoryResults:
    """Aggregated sweep results for one story and one stage."""

    stage_name: str
    story_id: str
    versions: dict[str, list[AggregatedPoint]]


POLICY_INDICATORS: dict[str, IndicatorDefinition] = {
    "core_mortgageApprovals": IndicatorDefinition(
        id="core_mortgageApprovals",
        title="Mortgage Approvals",
        units="count/month",
        file_name="coreIndicator-mortgageApprovals.csv",
    ),
    "core_debtToIncome": IndicatorDefinition(
        id="core_debtToIncome",
        title="Mortgage Debt to Income",
        units="%",
        file_name="coreIndicator-debtToIncome.csv",
    ),
    "core_housePriceGrowth": IndicatorDefinition(
        id="core_housePriceGrowth",
        title="House Price Growth (QoQ)",
        units="%",
        file_name="coreIndicator-housePriceGrowth.csv",
    ),
    "core_priceToIncome": IndicatorDefinition(
        id="core_priceToIncome",
        title="Price to Income",
        units="ratio",
        file_name="coreIndicator-priceToIncome.csv",
    ),
    "core_advancesToFTB": IndicatorDefinition(
        id="core_advancesToFTB",
        title="Advances to FTB",
        units="count/month",
        file_name="coreIndicator-advancesToFTB.csv",
    ),
    "core_advancesToHM": IndicatorDefinition(
        id="core_advancesToHM",
        title="Advances to Home Movers",
        units="count/month",
        file_name="coreIndicator-advancesToHM.csv",
    ),
    "core_advancesToBTL": IndicatorDefinition(
        id="core_advancesToBTL",
        title="Advances to BTL",
        units="count/month",
        file_name="coreIndicator-advancesToBTL.csv",
    ),
    "core_housingTransactions": IndicatorDefinition(
        id="core_housingTransactions",
        title="Housing Transactions",
        units="count/month",
        file_name="coreIndicator-housingTransactions.csv",
    ),
    "core_ooDebtToIncome": IndicatorDefinition(
        id="core_ooDebtToIncome",
        title="Owner-Occupier Debt to Income",
        units="%",
        file_name="coreIndicator-ooDebtToIncome.csv",
    ),
    "core_rentalYield": IndicatorDefinition(
        id="core_rentalYield",
        title="Rental Yield",
        units="%",
        file_name="coreIndicator-rentalYield.csv",
    ),
    "core_interestRateSpread": IndicatorDefinition(
        id="core_interestRateSpread",
        title="Interest Rate Spread",
        units="percentage points",
        file_name="coreIndicator-interestRateSpread.csv",
    ),
}

SLIM_RECORDING_OVERRIDES = {
    "recordTransactions": "false",
    "recordNBidUpFrequency": "false",
    "recordCoreIndicators": "true",
    "recordQualityBandPrice": "false",
    "recordHouseholdID": "false",
    "recordEmploymentIncome": "false",
    "recordRentalIncome": "false",
    "recordBankBalance": "false",
    "recordHousingWealth": "false",
    "recordNHousesOwned": "false",
    "recordAge": "false",
    "recordSavingRate": "false",
}


def default_maven_bin(repo_root: Path) -> str:
    """Return the repo-local Maven wrapper executable for this platform."""

    return str(repo_root / ("mvnw.cmd" if os.name == "nt" else "mvnw"))


def resolve_maven_bin(repo_root: Path, maven_bin: str | None = None) -> str:
    """Use an explicit Maven override or fall back to the repo-local wrapper."""

    return maven_bin if maven_bin else default_maven_bin(repo_root)


def ensure_project_compiled(
    repo_root: Path,
    maven_bin: str | None = None,
    *,
    clean: bool = False,
) -> None:
    """Compile the Java project once before launching sweeps.

    Provenance-sensitive callers can request a clean build so deleted or renamed classes cannot
    survive in ``target/classes`` and execute without a corresponding source input.
    """

    resolved_maven_bin = resolve_maven_bin(repo_root, maven_bin)
    goals = ["clean", "compile"] if clean else ["compile"]
    subprocess.run(
        [resolved_maven_bin, "-q", *goals],
        cwd=repo_root,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


def rewrite_version_resource_paths(config_text: str, version_dir: Path) -> str:
    """Rewrite snapshot-local resource paths to absolute versioned files."""

    def replace(match: re.Match[str]) -> str:
        candidate = version_dir / match.group(1)
        if candidate.exists():
            return f'"{candidate}"'
        return match.group(0)

    return RESOURCE_PATH_PATTERN.sub(replace, config_text)


def apply_property_overrides(config_text: str, overrides: Mapping[str, str]) -> str:
    """Apply key=value overrides to a Java properties file."""

    lines = config_text.splitlines()
    output: list[str] = []
    seen: set[str] = set()
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            output.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key in overrides:
            output.append(f"{key} = {overrides[key]}")
            seen.add(key)
        else:
            output.append(line)
    missing = sorted(set(overrides.keys()) - seen)
    if missing:
        raise RuntimeError(f"Missing override keys in config: {missing}")
    return "\n".join(output) + "\n"


def build_snapshot_local_config_text(
    version_config_path: Path,
    overrides: Mapping[str, str],
) -> str:
    """Create a runnable config text from a version snapshot and overrides."""

    version_dir = version_config_path.parent
    config_text = version_config_path.read_text(encoding="utf-8")
    config_text = rewrite_version_resource_paths(config_text, version_dir)
    merged_overrides = dict(SLIM_RECORDING_OVERRIDES)
    merged_overrides.update(overrides)
    return apply_property_overrides(config_text, merged_overrides)


def load_core_indicator_values(path: Path) -> list[float]:
    """Parse semicolon-separated core indicator output."""

    flattened = path.read_text(encoding="utf-8").replace("\n", ";")
    values: list[float] = []
    for token in flattened.split(";"):
        stripped = token.strip()
        if not stripped:
            continue
        values.append(float(stripped))
    if not values:
        raise RuntimeError(f"No numeric values found in core indicator file: {path}")
    return values


def select_post_burn_in_window(
    values: Sequence[float],
    start_index: int = KPI_WINDOW_START_INDEX,
    end_index: int = KPI_WINDOW_END_INDEX,
) -> list[float]:
    """Select the post-burn-in KPI window from a full model output series."""

    if not values or len(values) <= start_index:
        return []
    return list(values[start_index : min(len(values), end_index)])


def _percentile(sorted_values: Sequence[float], percentile_value: float) -> float | None:
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return sorted_values[0]
    clamped = max(0.0, min(100.0, percentile_value))
    position = (clamped / 100.0) * (len(sorted_values) - 1)
    lower_index = math.floor(position)
    upper_index = math.ceil(position)
    if lower_index == upper_index:
        return sorted_values[lower_index]
    fraction = position - lower_index
    lower_value = sorted_values[lower_index]
    upper_value = sorted_values[upper_index]
    return lower_value + (upper_value - lower_value) * fraction


def compute_kpi_from_values(values: Sequence[float]) -> KpiValues:
    """Compute KPI values using the same formulas as the dashboard."""

    if not values:
        return KpiValues(mean=None, cv=None, annualised_trend=None, range=None)

    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    stdev = math.sqrt(max(0.0, variance))
    cv = None if abs(mean) < 1e-12 else stdev / abs(mean)

    annualised_trend: float | None = None
    if len(values) >= 2:
        n = len(values)
        sum_x = ((n - 1) * n) / 2
        sum_xx = ((n - 1) * n * (2 * n - 1)) / 6
        sum_y = sum(values)
        sum_xy = sum(index * value for index, value in enumerate(values))
        denominator = n * sum_xx - sum_x * sum_x
        if abs(denominator) >= 1e-12:
            slope_per_month = (n * sum_xy - sum_x * sum_y) / denominator
            annualised_trend = slope_per_month * 12.0

    sorted_values = sorted(values)
    p95 = _percentile(sorted_values, 95.0)
    p5 = _percentile(sorted_values, 5.0)
    range_value = None if p95 is None or p5 is None else p95 - p5

    return KpiValues(
        mean=mean,
        cv=cv,
        annualised_trend=annualised_trend,
        range=range_value,
    )


def compute_indicator_kpis(output_dir: Path, indicator_ids: Sequence[str]) -> dict[str, KpiValues]:
    """Read the requested indicators from a run output directory."""

    result: dict[str, KpiValues] = {}
    for indicator_id in indicator_ids:
        definition = POLICY_INDICATORS[indicator_id]
        raw_values = load_core_indicator_values(output_dir / definition.file_name)
        result[indicator_id] = compute_kpi_from_values(select_post_burn_in_window(raw_values))
    return result


def _aggregate_numeric_values(values: Sequence[float | None]) -> AggregateStat | None:
    clean = [value for value in values if value is not None]
    if not clean:
        return None
    mean = sum(clean) / len(clean)
    variance = sum((value - mean) ** 2 for value in clean) / len(clean) if len(clean) > 1 else 0.0
    stdev = math.sqrt(max(0.0, variance))
    half_width = 1.96 * stdev / math.sqrt(len(clean)) if len(clean) > 1 else 0.0
    return AggregateStat(
        mean=mean,
        stdev=stdev,
        ci_low=mean - half_width,
        ci_high=mean + half_width,
        n=len(clean),
    )


def _aggregate_indicator_bundle(indicator_runs: Sequence[KpiValues]) -> AggregatedIndicator:
    return AggregatedIndicator(
        mean=_aggregate_numeric_values([item.mean for item in indicator_runs]),
        cv=_aggregate_numeric_values([item.cv for item in indicator_runs]),
        annualised_trend=_aggregate_numeric_values([item.annualised_trend for item in indicator_runs]),
        range=_aggregate_numeric_values([item.range for item in indicator_runs]),
    )


def _subtract_nullable(left: float | None, right: float | None) -> float | None:
    if left is None or right is None:
        return None
    return left - right


def aggregate_story_results(run_results: Sequence[RunResult]) -> AggregatedStoryResults:
    """Aggregate run-level results into raw and delta-to-baseline point summaries."""

    if not run_results:
        raise RuntimeError("Cannot aggregate an empty sweep.")

    stage_name = run_results[0].stage_name
    story_id = run_results[0].story_id
    grouped_runs: dict[tuple[str, str], list[RunResult]] = {}
    baseline_runs: dict[tuple[str, int], RunResult] = {}
    for run in run_results:
        grouped_runs.setdefault((run.version, run.point_id), []).append(run)
        if run.is_baseline:
            baseline_runs[(run.version, run.seed)] = run

    versions: dict[str, list[AggregatedPoint]] = {}
    version_points: dict[str, list[RunResult]] = {}
    for run in run_results:
        version_points.setdefault(run.version, []).append(run)

    for version, version_run_results in version_points.items():
        ordered_keys = sorted(
            {(run.point_index, run.point_id) for run in version_run_results},
            key=lambda item: item[0],
        )
        aggregated_points: list[AggregatedPoint] = []
        for point_index, point_id in ordered_keys:
            point_runs = grouped_runs[(version, point_id)]
            indicator_ids = sorted(point_runs[0].indicators.keys())
            aggregated_indicators: dict[str, AggregatedIndicator] = {}
            aggregated_delta_indicators: dict[str, AggregatedIndicator] = {}
            for indicator_id in indicator_ids:
                aggregated_indicators[indicator_id] = _aggregate_indicator_bundle(
                    [run.indicators[indicator_id] for run in point_runs]
                )
                delta_runs: list[KpiValues] = []
                for run in point_runs:
                    baseline = baseline_runs.get((version, run.seed))
                    if baseline is None:
                        raise RuntimeError(
                            f"Missing baseline run for story={story_id}, version={version}, seed={run.seed}"
                        )
                    baseline_indicator = baseline.indicators[indicator_id]
                    current_indicator = run.indicators[indicator_id]
                    delta_runs.append(
                        KpiValues(
                            mean=_subtract_nullable(current_indicator.mean, baseline_indicator.mean),
                            cv=_subtract_nullable(current_indicator.cv, baseline_indicator.cv),
                            annualised_trend=_subtract_nullable(
                                current_indicator.annualised_trend,
                                baseline_indicator.annualised_trend,
                            ),
                            range=_subtract_nullable(current_indicator.range, baseline_indicator.range),
                        )
                    )
                aggregated_delta_indicators[indicator_id] = _aggregate_indicator_bundle(delta_runs)

            exemplar = point_runs[0]
            aggregated_points.append(
                AggregatedPoint(
                    point_id=point_id,
                    point_index=point_index,
                    label=exemplar.point_label,
                    x_value=exemplar.x_value,
                    updates=exemplar.updates,
                    is_baseline=exemplar.is_baseline,
                    indicators=aggregated_indicators,
                    delta_indicators=aggregated_delta_indicators,
                )
            )
        versions[version] = aggregated_points

    return AggregatedStoryResults(stage_name=stage_name, story_id=story_id, versions=versions)


def build_sweep_points(
    values: Sequence[float],
    baseline_value: float,
    fixed_updates: Mapping[str, str],
    swept_keys: Sequence[str],
) -> list[SweepPoint]:
    """Create ordered sweep points for a one-dimensional policy instrument."""

    points: list[SweepPoint] = []
    for index, value in enumerate(values):
        updates = dict(fixed_updates)
        formatted_value = format_float(value)
        for key in swept_keys:
            updates[key] = formatted_value
        safe_label = formatted_value.replace("-", "m").replace(".", "p")
        points.append(
            SweepPoint(
                point_id=f"point_{index:02d}_{safe_label}",
                point_index=index,
                label=formatted_value,
                x_value=value,
                updates=updates,
                is_baseline=math.isclose(value, baseline_value, rel_tol=0.0, abs_tol=1e-9),
            )
        )
    if not any(point.is_baseline for point in points):
        raise RuntimeError(f"Baseline value {baseline_value} was not present in the sweep grid.")
    return points


def run_story_sweep(
    *,
    repo_root: Path,
    output_root: Path,
    stage_name: str,
    story_id: str,
    versions: Sequence[str],
    seeds: Sequence[int],
    points: Sequence[SweepPoint],
    indicator_ids: Sequence[str],
    workers: int,
    force_rerun: bool,
    maven_bin: str | None = None,
) -> tuple[list[RunResult], AggregatedStoryResults]:
    """Run all story/version/seed/point combinations and aggregate them."""

    resolved_maven_bin = resolve_maven_bin(repo_root, maven_bin)
    requests = [
        RunRequest(stage_name=stage_name, story_id=story_id, version=version, seed=seed, point=point)
        for version in versions
        for seed in seeds
        for point in points
    ]

    total_requests = len(requests)
    sweep_start = time.monotonic()
    print(
        f"[policy-sweep] start stage={stage_name} story={story_id} "
        f"runs={total_requests} workers={max(1, workers)} force_rerun={'yes' if force_rerun else 'no'}"
    )

    run_results: list[RunResult] = []
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = [
            executor.submit(
                _execute_run_request,
                repo_root=repo_root,
                output_root=output_root,
                request=request,
                indicator_ids=indicator_ids,
                force_rerun=force_rerun,
                maven_bin=resolved_maven_bin,
            )
            for request in requests
        ]
        completed = 0
        for future in as_completed(futures):
            run_result = future.result()
            run_results.append(run_result)
            completed += 1
            elapsed_seconds = max(1e-9, time.monotonic() - sweep_start)
            average_seconds = elapsed_seconds / completed
            remaining = total_requests - completed
            eta_seconds = remaining * average_seconds
            print(
                f"[policy-sweep] stage={stage_name} story={story_id} "
                f"progress={completed}/{total_requests} ({(100.0 * completed / total_requests):.1f}%) "
                f"elapsed={_format_duration(elapsed_seconds)} "
                f"avg={average_seconds:.1f}s/run "
                f"eta={_format_duration(eta_seconds)} "
                f"last={run_result.version}/seed-{run_result.seed}/{run_result.point_label}"
                f"{' [cached]' if run_result.cached else ''}"
            )

    run_results.sort(key=lambda item: (item.version, item.seed, item.point_index))
    total_elapsed = time.monotonic() - sweep_start
    print(
        f"[policy-sweep] done stage={stage_name} story={story_id} "
        f"runs={total_requests} elapsed={_format_duration(total_elapsed)}"
    )
    return run_results, aggregate_story_results(run_results)


def _execute_run_request(
    *,
    repo_root: Path,
    output_root: Path,
    request: RunRequest,
    indicator_ids: Sequence[str],
    force_rerun: bool,
    maven_bin: str,
) -> RunResult:
    story_root = output_root / request.story_id
    run_dir = story_root / "runs" / request.stage_name / request.version / f"seed-{request.seed}" / request.point.point_id
    config_path = story_root / "configs" / request.stage_name / request.version / f"{request.point.point_id}-seed-{request.seed}.properties"
    metrics_cache_path = run_dir / "run_metrics.json"

    if metrics_cache_path.exists() and not force_rerun:
        cached_result = _load_cached_run_result(metrics_cache_path, indicator_ids)
        if cached_result is not None:
            return cached_result

    version_config_path = repo_root / "input-data-versions" / request.version / "config.properties"
    if not version_config_path.exists():
        raise RuntimeError(f"Missing version config: {version_config_path}")

    overrides = dict(request.point.updates)
    overrides["SEED"] = str(request.seed)
    config_text = build_snapshot_local_config_text(version_config_path, overrides)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(config_text, encoding="utf-8")

    if run_dir.exists():
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)

    exec_args = f'-configFile "{config_path}" -outputFolder "{run_dir}" -dev'
    proc = subprocess.run(
        [maven_bin, "-q", "exec:java", f"-Dexec.args={exec_args}"],
        cwd=repo_root,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            "Model run failed.\n"
            f"story={request.story_id} stage={request.stage_name} version={request.version} "
            f"seed={request.seed} point={request.point.label}\n"
            f"Output tail:\n{proc.stdout[-3000:]}"
        )

    run_result = RunResult(
        stage_name=request.stage_name,
        story_id=request.story_id,
        version=request.version,
        seed=request.seed,
        point_id=request.point.point_id,
        point_index=request.point.point_index,
        point_label=request.point.label,
        x_value=request.point.x_value,
        updates=dict(request.point.updates),
        is_baseline=request.point.is_baseline,
        output_dir=str(run_dir),
        config_path=str(config_path),
        cached=False,
        indicators=compute_indicator_kpis(run_dir, indicator_ids),
    )
    metrics_cache_path.write_text(json.dumps(_serialize_run_result(run_result), indent=2) + "\n", encoding="utf-8")
    return run_result


def _serialize_run_result(run_result: RunResult) -> dict[str, object]:
    payload = asdict(run_result)
    payload["kpi_window"] = dict(KPI_WINDOW_SPEC)
    payload["indicators"] = {
        key: asdict(value)
        for key, value in run_result.indicators.items()
    }
    return payload


def _load_cached_run_result(path: Path, indicator_ids: Sequence[str]) -> RunResult | None:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("kpi_window") == KPI_WINDOW_SPEC:
        return _deserialize_run_result(raw)

    output_dir = Path(raw["output_dir"])
    if not output_dir.exists():
        return None

    run_result = RunResult(
        stage_name=raw["stage_name"],
        story_id=raw["story_id"],
        version=raw["version"],
        seed=int(raw["seed"]),
        point_id=raw["point_id"],
        point_index=int(raw["point_index"]),
        point_label=raw["point_label"],
        x_value=float(raw["x_value"]),
        updates={key: str(value) for key, value in raw["updates"].items()},
        is_baseline=bool(raw["is_baseline"]),
        output_dir=raw["output_dir"],
        config_path=raw["config_path"],
        cached=True,
        indicators=compute_indicator_kpis(output_dir, indicator_ids),
    )
    path.write_text(json.dumps(_serialize_run_result(run_result), indent=2) + "\n", encoding="utf-8")
    return run_result


def _deserialize_run_result(raw: Mapping[str, object]) -> RunResult:
    indicators = {
        key: KpiValues(**value)
        for key, value in raw["indicators"].items()
    }
    return RunResult(
        stage_name=raw["stage_name"],
        story_id=raw["story_id"],
        version=raw["version"],
        seed=int(raw["seed"]),
        point_id=raw["point_id"],
        point_index=int(raw["point_index"]),
        point_label=raw["point_label"],
        x_value=float(raw["x_value"]),
        updates={key: str(value) for key, value in raw["updates"].items()},
        is_baseline=bool(raw["is_baseline"]),
        output_dir=raw["output_dir"],
        config_path=raw["config_path"],
        cached=True,
        indicators=indicators,
    )


def _format_duration(seconds: float) -> str:
    rounded = max(0, int(round(seconds)))
    hours, remainder = divmod(rounded, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"
