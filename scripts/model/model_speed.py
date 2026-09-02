#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Snapshot-local helpers for model-speed benchmarking, regression, and profiling.

@author: Max Stoddard
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import math
import random
import re
import statistics
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RESOURCE_PATH_PATTERN = re.compile(r'"src/main/resources/([^"]+)"')
NUMERIC_PATTERN = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$")
PAUSE_PATTERN = re.compile(r"Pause.*? ([0-9]+(?:\.[0-9]+)?)(us|ms|s)\b")
OUTPUT_FILE_NAME = "Output-run1.csv"
RESULTS_SUMMARY_DEFAULT_RUN_DIR = REPO_ROOT / "Results" / "v4.1-output"
RESULTS_SUMMARY_WINDOW_START_INDEX = 200
RESULTS_SUMMARY_WINDOW_END_INDEX = 2000
RESULTS_SUMMARY_WINDOW_LENGTH = RESULTS_SUMMARY_WINDOW_END_INDEX - RESULTS_SUMMARY_WINDOW_START_INDEX

MODELSTEP_PHASE_LINES: tuple[tuple[int, str], ...] = (
    (185, "demographics.step()"),
    (187, "construction.step()"),
    (189, "household loop"),
    (191, "creditSupply.preClearingResetCounters()"),
    (193, "housingMarketStats.preClearingRecord()"),
    (195, "houseSaleMarket.clearMarket()"),
    (197, "housingMarketStats.postClearingRecord()"),
    (199, "rentalMarketStats.preClearingRecord()"),
    (201, "houseRentalMarket.clearMarket()"),
    (203, "rentalMarketStats.postClearingRecord()"),
    (205, "householdStats.record()"),
    (207, "creditSupply.postClearingRecord()"),
    (209, "bank.step()"),
    (211, "centralBank.step()"),
)
MODELSTEP_PHASE_MAP = dict(MODELSTEP_PHASE_LINES)
MODELSTEP_METHOD_NAME = "housing.Model.modelStep"
FLAMEGRAPH_WIDTH = 3200
FLAMEGRAPH_FRAME_HEIGHT = 18
FLAMEGRAPH_TOP_PADDING = 52
FLAMEGRAPH_SIDE_PADDING = 10
FLAMEGRAPH_FONT_SIZE = 12
METHOD_TABLE_LIMIT = 20


@dataclass(frozen=True)
class ExecutionSample:
    """ExecutionSample data extracted from JFR."""

    whole_stack: tuple[str, ...]
    leaf_method: str
    modelstep_stack: tuple[str, ...] | None
    modelstep_phase_line: int | None


@dataclass(frozen=True)
class MethodRow:
    """One ranked method entry."""

    method: str
    samples: int
    percent: float
    rank: int


@dataclass(frozen=True)
class PhaseRow:
    """One direct-child modelStep phase entry."""

    line_number: int
    phase: str
    samples: int
    percent: float


@dataclass(frozen=True)
class JfrAnalysis:
    """Aggregated JFR execution-sample analysis."""

    label: str
    jfr_path: str
    total_samples: int
    modelstep_samples: int
    whole_run_methods: tuple[MethodRow, ...]
    modelstep_methods: tuple[MethodRow, ...]
    modelstep_phases: tuple[PhaseRow, ...]
    modelstep_stacks: tuple[tuple[str, ...], ...]


@dataclass(frozen=True)
class ResultsSummarySeries:
    """One fixed series emitted by the results-summary CLI."""

    label: str
    file_name: str
    scale: float
    output_column: str | None = None


@dataclass(frozen=True)
class CachePairedRunEntry:
    """One planned seed-1 paired cache benchmark run."""

    phase: str
    run_order_index: int
    pair_index: int
    seed: int
    variant: str
    run_id: str


RESULTS_SUMMARY_SERIES: tuple[ResultsSummarySeries, ...] = (
    ResultsSummarySeries(
        label="Average house prices (£1,000)",
        file_name=OUTPUT_FILE_NAME,
        output_column="Sale AvSalePrice",
        scale=0.001,
    ),
    ResultsSummarySeries(
        label="Housing transactions (1,000)",
        file_name="coreIndicator-housingTransactions.csv",
        scale=0.001,
    ),
    ResultsSummarySeries(
        label="Mortgage approvals (1,000)",
        file_name="coreIndicator-mortgageApprovals.csv",
        scale=0.001,
    ),
    ResultsSummarySeries(
        label="Mortgage debt-to-income ratio (%)",
        file_name="coreIndicator-debtToIncome.csv",
        scale=1.0,
    ),
)

BENCHMARK_NUMERIC_KEYS: tuple[str, ...] = (
    "wall_clock_seconds",
    "process_wall_clock_seconds",
    "model_computing_seconds",
    "seconds_per_household_month",
    "ns_per_household_month",
    "output_bytes",
    "max_rss_kb",
    "user_cpu_seconds",
    "system_cpu_seconds",
    "gc_pause_count",
    "gc_pause_time_ms_total",
)

BENCHMARK_SUMMARY_SCHEMA_VERSION = 2
BENCHMARK_PROTOCOL_ID = "same-jvm-measured-phase-v1"
BENCHMARK_WALL_CLOCK_SCOPE = "measured_model_phase_only_excludes_warmup_and_jvm_startup"
BENCHMARK_PROCESS_WALL_CLOCK_SCOPE = "whole_jvm_process_includes_startup_and_same_jvm_warmup"
BENCHMARK_MODEL_COMPUTING_SCOPE = BENCHMARK_WALL_CLOCK_SCOPE
BENCHMARK_NORMALIZATION_SCOPE = "measured_config_TARGET_POPULATION_x_N_STEPS_x_N_SIMS_only"
LEGACY_BENCHMARK_PROTOCOL_ID = "legacy-whole-jvm-wall-v0"
LEGACY_BENCHMARK_WALL_CLOCK_SCOPE = "whole_jvm_process"

T_CRITICAL_95_TWO_SIDED: dict[int, float] = {
    1: 12.706205,
    2: 4.302653,
    3: 3.182446,
    4: 2.776445,
    5: 2.570582,
    6: 2.446912,
    7: 2.364624,
    8: 2.306004,
    9: 2.262157,
    10: 2.228139,
    11: 2.200985,
    12: 2.178813,
    13: 2.160369,
    14: 2.144787,
    15: 2.131450,
    16: 2.119905,
    17: 2.109816,
    18: 2.100922,
    19: 2.093024,
    20: 2.085963,
    21: 2.079614,
    22: 2.073873,
    23: 2.068658,
    24: 2.063899,
    25: 2.059539,
    26: 2.055529,
    27: 2.051831,
    28: 2.048407,
    29: 2.045230,
    30: 2.042272,
}


def parse_properties(path: Path) -> dict[str, str]:
    overrides: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in raw_line:
            continue
        key, value = raw_line.split("=", 1)
        overrides[key.strip()] = value.strip().strip('"').strip("'")
    return overrides


def load_results_summary_core_values(path: Path) -> list[float]:
    if not path.exists():
        raise SystemExit(f"Missing required file: {path}")
    flattened = path.read_text(encoding="utf-8").replace("\r", "\n").replace("\n", ";")
    values: list[float] = []
    for token in flattened.split(";"):
        stripped = token.strip()
        if not stripped:
            continue
        try:
            values.append(float(stripped))
        except ValueError as error:
            raise SystemExit(f"Non-numeric value in core indicator file {path}: {stripped!r}") from error
    if not values:
        raise SystemExit(f"No numeric values found in core indicator file: {path}")
    return values


def load_results_summary_output_column(path: Path, column_name: str) -> list[float]:
    if not path.exists():
        raise SystemExit(f"Missing required file: {path}")
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle, delimiter=";")
        rows = [[cell.strip() for cell in row] for row in reader if any(cell.strip() for cell in row)]
    if not rows:
        raise SystemExit(f"Output file is empty: {path}")
    header = rows[0]
    if column_name not in header:
        raise SystemExit(f"Missing required output column '{column_name}' in {path}")
    column_index = header.index(column_name)
    values: list[float] = []
    for row_number, row in enumerate(rows[1:], start=2):
        if column_index >= len(row):
            raise SystemExit(
                f"Missing value for output column '{column_name}' at row {row_number} in {path}"
            )
        token = row[column_index].strip()
        if not token:
            raise SystemExit(
                f"Blank value for output column '{column_name}' at row {row_number} in {path}"
            )
        try:
            values.append(float(token))
        except ValueError as error:
            raise SystemExit(
                f"Non-numeric value for output column '{column_name}' at row {row_number} in {path}: {token!r}"
            ) from error
    if not values:
        raise SystemExit(f"No data rows found in output file: {path}")
    return values


def select_results_summary_window(values: list[float], label: str, source_path: Path) -> list[float]:
    window = values[RESULTS_SUMMARY_WINDOW_START_INDEX:RESULTS_SUMMARY_WINDOW_END_INDEX]
    if len(window) != RESULTS_SUMMARY_WINDOW_LENGTH:
        raise SystemExit(
            f"{label}: expected {RESULTS_SUMMARY_WINDOW_LENGTH} values in indices "
            f"{RESULTS_SUMMARY_WINDOW_START_INDEX}:{RESULTS_SUMMARY_WINDOW_END_INDEX}, "
            f"found {len(window)} from {source_path} (raw_count={len(values)})"
        )
    return window


def format_method_name(method: dict[str, object]) -> str:
    type_name = str(method["type"]["name"]).replace("/", ".")
    return f"{type_name}.{method['name']}"


def load_execution_samples(jfr_path: Path) -> list[ExecutionSample]:
    raw = subprocess.check_output(
        ["jfr", "print", "--events", "jdk.ExecutionSample", "--json", "--stack-depth", "96", str(jfr_path)],
        text=True,
    )
    data = json.loads(raw)
    samples: list[ExecutionSample] = []
    for event in data["recording"]["events"]:
        frames = event["values"]["stackTrace"]["frames"]
        whole_stack = tuple(format_method_name(frame["method"]) for frame in reversed(frames))
        leaf_method = format_method_name(frames[0]["method"])
        modelstep_stack: tuple[str, ...] | None = None
        modelstep_phase_line: int | None = None
        for index, frame in enumerate(frames):
            if format_method_name(frame["method"]) == MODELSTEP_METHOD_NAME:
                modelstep_phase_line = int(frame["lineNumber"])
                modelstep_stack = tuple(
                    format_method_name(truncated["method"]) for truncated in reversed(frames[: index + 1])
                )
                break
        samples.append(
            ExecutionSample(
                whole_stack=whole_stack,
                leaf_method=leaf_method,
                modelstep_stack=modelstep_stack,
                modelstep_phase_line=modelstep_phase_line,
            )
        )
    return samples


def ranked_method_rows(counter: Counter[str], total_samples: int) -> tuple[MethodRow, ...]:
    rows: list[MethodRow] = []
    for rank, (method, samples) in enumerate(
        sorted(counter.items(), key=lambda item: (-item[1], item[0])),
        start=1,
    ):
        percent = 0.0 if total_samples == 0 else (samples / total_samples) * 100.0
        rows.append(MethodRow(method=method, samples=samples, percent=percent, rank=rank))
    return tuple(rows)


def phase_rows(counter: Counter[int], total_samples: int) -> tuple[PhaseRow, ...]:
    rows: list[PhaseRow] = []
    for line_number, phase in MODELSTEP_PHASE_LINES:
        samples = counter.get(line_number, 0)
        percent = 0.0 if total_samples == 0 else (samples / total_samples) * 100.0
        rows.append(PhaseRow(line_number=line_number, phase=phase, samples=samples, percent=percent))
    for line_number in sorted(set(counter) - set(MODELSTEP_PHASE_MAP)):
        samples = counter[line_number]
        percent = 0.0 if total_samples == 0 else (samples / total_samples) * 100.0
        rows.append(PhaseRow(line_number=line_number, phase=f"line {line_number}", samples=samples, percent=percent))
    return tuple(rows)


def analyze_execution_samples(
    *,
    label: str,
    jfr_path: Path,
    expected_total_samples: int | None = None,
    expected_modelstep_samples: int | None = None,
) -> JfrAnalysis:
    samples = load_execution_samples(jfr_path)
    total_samples = len(samples)
    if expected_total_samples is not None and total_samples != expected_total_samples:
        raise SystemExit(
            f"{label}: expected {expected_total_samples} ExecutionSample events, got {total_samples} from {jfr_path}"
        )

    whole_run_counter: Counter[str] = Counter()
    modelstep_counter: Counter[str] = Counter()
    phase_counter: Counter[int] = Counter()
    modelstep_stacks: list[tuple[str, ...]] = []
    modelstep_samples = 0

    for sample in samples:
        whole_run_counter[sample.leaf_method] += 1
        if sample.modelstep_stack is not None and sample.modelstep_phase_line is not None:
            modelstep_samples += 1
            modelstep_counter[sample.leaf_method] += 1
            phase_counter[sample.modelstep_phase_line] += 1
            modelstep_stacks.append(sample.modelstep_stack)

    if expected_modelstep_samples is not None and modelstep_samples != expected_modelstep_samples:
        raise SystemExit(
            f"{label}: expected {expected_modelstep_samples} modelStep samples, got {modelstep_samples} from {jfr_path}"
        )

    return JfrAnalysis(
        label=label,
        jfr_path=str(jfr_path),
        total_samples=total_samples,
        modelstep_samples=modelstep_samples,
        whole_run_methods=ranked_method_rows(whole_run_counter, total_samples),
        modelstep_methods=ranked_method_rows(modelstep_counter, modelstep_samples),
        modelstep_phases=phase_rows(phase_counter, modelstep_samples),
        modelstep_stacks=tuple(modelstep_stacks),
    )


def short_profile_title(label: str) -> str:
    return label.replace("-", " ").title()


def rows_with_other(rows: tuple[MethodRow, ...], total_samples: int, limit: int = METHOD_TABLE_LIMIT) -> list[MethodRow]:
    if len(rows) <= limit:
        return list(rows)
    top_rows = list(rows[:limit])
    other_samples = sum(row.samples for row in rows[limit:])
    other_percent = 0.0 if total_samples == 0 else (other_samples / total_samples) * 100.0
    top_rows.append(MethodRow(method="Other", samples=other_samples, percent=other_percent, rank=limit + 1))
    return top_rows


def write_methods_csv(output_path: Path, label: str, whole_rows: tuple[MethodRow, ...], modelstep_rows: tuple[MethodRow, ...]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["profile_id", "view", "rank", "method", "samples", "percent"])
        for view, rows in (("whole-run", whole_rows), ("modelStep-only", modelstep_rows)):
            for row in rows:
                writer.writerow([label, view, row.rank, row.method, row.samples, f"{row.percent:.6f}"])


def analysis_to_json_payload(analysis: JfrAnalysis) -> dict[str, object]:
    return {
        "profile_id": analysis.label,
        "jfr_path": analysis.jfr_path,
        "total_samples": analysis.total_samples,
        "modelstep_samples": analysis.modelstep_samples,
        "whole_run_methods": [
            {"rank": row.rank, "method": row.method, "samples": row.samples, "percent": round(row.percent, 6)}
            for row in analysis.whole_run_methods
        ],
        "modelstep_methods": [
            {"rank": row.rank, "method": row.method, "samples": row.samples, "percent": round(row.percent, 6)}
            for row in analysis.modelstep_methods
        ],
        "modelstep_phases": [
            {
                "line_number": row.line_number,
                "phase": row.phase,
                "samples": row.samples,
                "percent": round(row.percent, 6),
            }
            for row in analysis.modelstep_phases
        ],
    }


def markdown_table_for_methods(rows: list[MethodRow]) -> list[str]:
    lines = [
        "| Rank | Method | Samples | Percent |",
        "| ---: | --- | ---: | ---: |",
    ]
    for row in rows:
        lines.append(f"| {row.rank} | `{row.method}` | {row.samples} | {row.percent:.2f}% |")
    return lines


def markdown_table_for_phases(rows: tuple[PhaseRow, ...]) -> list[str]:
    lines = [
        "| modelStep line | Phase | Samples | Percent |",
        "| ---: | --- | ---: | ---: |",
    ]
    for row in rows:
        lines.append(f"| {row.line_number} | `{row.phase}` | {row.samples} | {row.percent:.2f}% |")
    return lines


def interpretation_lines(analysis: JfrAnalysis) -> list[str]:
    top_phase = max(analysis.modelstep_phases, key=lambda row: row.samples)
    second_phase = sorted(analysis.modelstep_phases, key=lambda row: (-row.samples, row.line_number))[1]
    top_method = analysis.modelstep_methods[0]
    return [
        f"- Dominant `modelStep()` phase: `{top_phase.phase}` at {top_phase.percent:.1f}% of modelStep samples.",
        f"- Second-largest `modelStep()` phase: `{second_phase.phase}` at {second_phase.percent:.1f}% of modelStep samples.",
        f"- Dominant sampled hot method inside this view: `{top_method.method}` at {top_method.percent:.1f}% of modelStep samples.",
    ]


def jfr_method_report(args: argparse.Namespace) -> int:
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    analyses: list[JfrAnalysis] = []
    for profile_id, jfr_path, expected_total, expected_modelstep in args.profile:
        analysis = analyze_execution_samples(
            label=profile_id,
            jfr_path=Path(jfr_path),
            expected_total_samples=int(expected_total),
            expected_modelstep_samples=int(expected_modelstep),
        )
        analyses.append(analysis)
        json_path = output_dir / f"{profile_id}-methods.json"
        csv_path = output_dir / f"{profile_id}-methods.csv"
        json_path.write_text(json.dumps(analysis_to_json_payload(analysis), indent=2) + "\n", encoding="utf-8")
        write_methods_csv(csv_path, profile_id, analysis.whole_run_methods, analysis.modelstep_methods)

    lines = [
        "# JFR Method Breakdown",
        "Author: Max Stoddard",
        "",
        "This report is derived from existing JFR `jdk.ExecutionSample` recordings.",
        "Percentages are sample-share estimates, not exact stopwatch timings.",
        "",
    ]

    for analysis in analyses:
        title = short_profile_title(analysis.label)
        whole_rows = rows_with_other(analysis.whole_run_methods, analysis.total_samples)
        modelstep_rows = rows_with_other(analysis.modelstep_methods, analysis.modelstep_samples)
        lines.extend(
            [
                f"## {title}",
                "",
                f"- Profile id: `{analysis.label}`",
                f"- JFR source: `{analysis.jfr_path}`",
                f"- Whole-run `ExecutionSample` count: `{analysis.total_samples}`",
                f"- `modelStep()`-anchored sample count: `{analysis.modelstep_samples}`",
                f"- JSON companion: `{analysis.label}-methods.json`",
                f"- CSV companion: `{analysis.label}-methods.csv`",
                "",
                "### Whole-Run Hot Methods",
                "",
            ]
        )
        lines.extend(markdown_table_for_methods(whole_rows))
        lines.extend(
            [
                "",
                "### `modelStep()`-Only Hot Methods",
                "",
            ]
        )
        lines.extend(markdown_table_for_methods(modelstep_rows))
        lines.extend(
            [
                "",
                "### Direct `modelStep()` Child Breakdown",
                "",
            ]
        )
        lines.extend(markdown_table_for_phases(analysis.modelstep_phases))
        lines.extend(
            [
                "",
                "### Interpretation",
                "",
            ]
        )
        lines.extend(interpretation_lines(analysis))
        lines.append("")

    markdown_path = Path(args.output_markdown)
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path.write_text("\n".join(lines), encoding="utf-8")
    return 0


def build_folded_stacks(stacks: tuple[tuple[str, ...], ...]) -> dict[tuple[str, ...], int]:
    folded: Counter[tuple[str, ...]] = Counter()
    for stack in stacks:
        if stack:
            folded[stack] += 1
    return dict(folded)


def frame_fill_color(name: str) -> str:
    hue = int(hashlib.sha1(name.encode("utf-8")).hexdigest()[:8], 16) % 360
    return f"hsl({hue},70%,70%)"


def escape_text(value: str) -> str:
    return html.escape(value, quote=True)


def truncate_label(label: str, width_px: float) -> str:
    max_chars = max(int(width_px / 7), 0)
    if max_chars <= 3:
        return ""
    if len(label) <= max_chars:
        return label
    return label[: max_chars - 1] + "…"


def build_flamegraph_svg(
    *,
    title: str,
    subtitle: str,
    sample_count: int,
    stacks: tuple[tuple[str, ...], ...],
) -> str:
    folded = build_folded_stacks(stacks)
    if not folded:
        raise SystemExit("No stacks available to render flame graph.")

    tree: dict[str, dict[str, object]] = {"name": "root", "value": sample_count, "children": {}}
    max_depth = 0
    for stack, count in folded.items():
        node = tree
        max_depth = max(max_depth, len(stack))
        for frame in stack:
            children = node["children"]
            if frame not in children:
                children[frame] = {"name": frame, "value": 0, "children": {}}
            child = children[frame]
            child["value"] += count
            node = child

    svg_height = FLAMEGRAPH_TOP_PADDING + (max_depth * FLAMEGRAPH_FRAME_HEIGHT) + 30
    canvas_width = FLAMEGRAPH_WIDTH - (2 * FLAMEGRAPH_SIDE_PADDING)
    unit_width = canvas_width / sample_count
    elements: list[str] = []

    def render_children(node: dict[str, object], depth: int, x_offset: float) -> None:
        children = list(node["children"].values())
        current_x = x_offset
        for child in children:
            width = float(child["value"]) * unit_width
            if width <= 0:
                continue
            y = svg_height - ((depth + 1) * FLAMEGRAPH_FRAME_HEIGHT) - 10
            rect_x = FLAMEGRAPH_SIDE_PADDING + current_x
            rect_y = y
            label = str(child["name"])
            truncated = truncate_label(label, width - 4)
            elements.append(
                (
                    f'<g>'
                    f'<title>{escape_text(label)} ({child["value"]} samples, {(child["value"] / sample_count) * 100:.2f}%)</title>'
                    f'<rect x="{rect_x:.3f}" y="{rect_y:.3f}" width="{width:.3f}" height="{FLAMEGRAPH_FRAME_HEIGHT - 1}" '
                    f'fill="{frame_fill_color(label)}" stroke="#ffffff" stroke-width="0.5" />'
                )
            )
            if truncated:
                text_y = rect_y + FLAMEGRAPH_FRAME_HEIGHT - 5
                elements.append(
                    f'<text x="{rect_x + 3:.3f}" y="{text_y:.3f}" font-size="{FLAMEGRAPH_FONT_SIZE}" fill="#111111">{escape_text(truncated)}</text>'
                )
            elements.append("</g>")
            render_children(child, depth + 1, current_x)
            current_x += width

    render_children(tree, 0, 0.0)
    return "\n".join(
        [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{FLAMEGRAPH_WIDTH}" height="{svg_height}" viewBox="0 0 {FLAMEGRAPH_WIDTH} {svg_height}">',
            '<style>text { font-family: "DejaVu Sans Mono", monospace; }</style>',
            f'<text x="{FLAMEGRAPH_SIDE_PADDING}" y="20" font-size="20" font-weight="bold" fill="#111111">{escape_text(title)}</text>',
            f'<text x="{FLAMEGRAPH_SIDE_PADDING}" y="38" font-size="12" fill="#444444">{escape_text(subtitle)}</text>',
            f'<text x="{FLAMEGRAPH_SIDE_PADDING}" y="{svg_height - 2}" font-size="11" fill="#444444">Samples: {sample_count} | View: modelStep()-only | Root: housing.Model.modelStep()</text>',
            *elements,
            "</svg>",
        ]
    )


def jfr_flamegraph(args: argparse.Namespace) -> int:
    analysis = analyze_execution_samples(
        label=args.profile_id,
        jfr_path=Path(args.jfr),
        expected_total_samples=args.expected_total_samples,
        expected_modelstep_samples=args.expected_modelstep_samples,
    )
    svg = build_flamegraph_svg(
        title=args.title,
        subtitle=f"Source: {analysis.jfr_path}",
        sample_count=analysis.modelstep_samples,
        stacks=analysis.modelstep_stacks,
    )
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(svg + "\n", encoding="utf-8")
    return 0


def rewrite_version_resource_paths(config_text: str, version_dir: Path) -> str:
    def replace(match: re.Match[str]) -> str:
        candidate = version_dir / match.group(1)
        if candidate.exists():
            return f'"{candidate.relative_to(REPO_ROOT).as_posix()}"'
        return match.group(0)

    return RESOURCE_PATH_PATTERN.sub(replace, config_text)


def apply_property_overrides(config_text: str, overrides: dict[str, str]) -> str:
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
    missing = sorted(set(overrides) - seen)
    if missing:
        raise RuntimeError(f"Missing override keys in config: {missing}")
    return "\n".join(output) + "\n"


def materialize_config(args: argparse.Namespace) -> int:
    version_dir = REPO_ROOT / "input-data-versions" / args.snapshot
    version_config_path = version_dir / "config.properties"
    if not version_config_path.exists():
        raise SystemExit(f"Missing snapshot config: {version_config_path}")
    config_text = version_config_path.read_text(encoding="utf-8")
    config_text = rewrite_version_resource_paths(config_text, version_dir)
    overrides = parse_properties(Path(args.mode_file))
    for item in args.override:
        if "=" not in item:
            raise SystemExit(f"Invalid override '{item}'; expected KEY=VALUE")
        key, value = item.split("=", 1)
        overrides[key.strip()] = value.strip()
    config_text = apply_property_overrides(config_text, overrides)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(config_text, encoding="utf-8")
    return 0


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_manifest(args: argparse.Namespace) -> int:
    output_dir = Path(args.output_dir)
    manifest_path = Path(args.manifest_path)
    files = sorted(path for path in output_dir.rglob("*") if path.is_file())
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with manifest_path.open("w", encoding="utf-8") as handle:
        for path in files:
            rel_path = path.relative_to(output_dir).as_posix()
            handle.write(f"{sha256_file(path)}  {rel_path}\n")
    return 0


def load_manifest(path: Path) -> dict[str, str]:
    manifest: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if "  " in stripped:
            digest, rel_path = stripped.split("  ", 1)
        else:
            digest, rel_path = stripped.split(maxsplit=1)
        manifest[rel_path] = digest
    return manifest


def manifest_differences(
    baseline: dict[str, str],
    candidate: dict[str, str],
) -> tuple[list[str], list[str], list[str]]:
    missing = sorted(set(baseline) - set(candidate))
    extra = sorted(set(candidate) - set(baseline))
    mismatched = sorted(
        rel_path
        for rel_path in baseline
        if rel_path in candidate and baseline[rel_path] != candidate[rel_path]
    )
    return missing, extra, mismatched


def exact_compare(args: argparse.Namespace) -> int:
    baseline = load_manifest(Path(args.baseline_manifest))
    candidate = load_manifest(Path(args.candidate_manifest))
    missing, extra, mismatched = manifest_differences(baseline, candidate)
    lines = [
        "# Exact Regression Report",
        f"baseline_manifest: {args.baseline_manifest}",
        f"candidate_manifest: {args.candidate_manifest}",
        f"status: {'PASS' if not (missing or extra or mismatched) else 'FAIL'}",
        "",
    ]
    if missing:
        lines.append("Missing files:")
        lines.extend(f"- {item}" for item in missing)
        lines.append("")
    if extra:
        lines.append("Extra files:")
        lines.extend(f"- {item}" for item in extra)
        lines.append("")
    if mismatched:
        lines.append("Hash mismatches:")
        for item in mismatched:
            lines.append(f"- {item}")
            lines.append(f"  baseline:  {baseline[item]}")
            lines.append(f"  candidate: {candidate[item]}")
        lines.append("")
    if not (missing or extra or mismatched):
        lines.append("All files matched exactly.")
        lines.append("")
    report_path = Path(args.report_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines), encoding="utf-8")
    return 0 if not (missing or extra or mismatched) else 1


def exact_repeat_compare(args: argparse.Namespace) -> int:
    baseline_path = Path(args.baseline_manifest)
    candidate_paths = [Path(item) for item in args.candidate_manifest]
    baseline = load_manifest(baseline_path)
    candidate_manifests = [(path, load_manifest(path)) for path in candidate_paths]
    failures: list[str] = []
    lines = [
        "# Exact Repeat Regression Report",
        f"baseline_manifest: {args.baseline_manifest}",
        f"candidate_manifest_count: {len(candidate_paths)}",
        "",
    ]
    for index, (path, candidate) in enumerate(candidate_manifests, start=1):
        missing, extra, mismatched = manifest_differences(baseline, candidate)
        label = f"candidate-{index:03d}"
        status = "PASS" if not (missing or extra or mismatched) else "FAIL"
        lines.extend([f"## {label}", f"manifest: {path}", f"baseline_status: {status}", ""])
        if missing:
            failures.append(f"{label}: missing files")
            lines.append("Missing files:")
            lines.extend(f"- {item}" for item in missing)
            lines.append("")
        if extra:
            failures.append(f"{label}: extra files")
            lines.append("Extra files:")
            lines.extend(f"- {item}" for item in extra)
            lines.append("")
        if mismatched:
            failures.append(f"{label}: hash mismatches")
            lines.append("Hash mismatches:")
            for item in mismatched:
                lines.append(f"- {item}")
                lines.append(f"  baseline:  {baseline[item]}")
                lines.append(f"  candidate: {candidate[item]}")
            lines.append("")
        if not (missing or extra or mismatched):
            lines.append("All files matched the baseline exactly.")
            lines.append("")

    if candidate_manifests:
        first_path, first_manifest = candidate_manifests[0]
        lines.extend(["## Candidate Repeat Consistency", f"reference_manifest: {first_path}", ""])
        for index, (path, candidate) in enumerate(candidate_manifests[1:], start=2):
            missing, extra, mismatched = manifest_differences(first_manifest, candidate)
            label = f"candidate-{index:03d}"
            status = "PASS" if not (missing or extra or mismatched) else "FAIL"
            lines.extend([f"- {label}: {status} (`{path}`)"])
            if missing or extra or mismatched:
                failures.append(f"{label}: differs from first candidate manifest")
        if len(candidate_manifests) == 1:
            lines.append("- candidate-001: PASS (only repeat)")
        lines.append("")

    status = "PASS" if not failures else "FAIL"
    lines.insert(3, f"status: {status}")
    lines.insert(4, "")
    if failures:
        lines.extend(["Failures:", *[f"- {failure}" for failure in failures], ""])
    else:
        lines.extend(["All candidate manifests matched the baseline and each other exactly.", ""])
    report_path = Path(args.report_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines), encoding="utf-8")
    return 0 if not failures else 1


def is_numeric_token(token: str) -> bool:
    return bool(NUMERIC_PATTERN.fullmatch(token.strip()))


def compare_csv_files(
    baseline_path: Path,
    candidate_path: Path,
    *,
    abs_tol: float,
    rel_tol: float,
    failures: list[str],
    rel_path: str,
) -> None:
    baseline_lines = baseline_path.read_text(encoding="utf-8").splitlines()
    candidate_lines = candidate_path.read_text(encoding="utf-8").splitlines()
    if len(baseline_lines) != len(candidate_lines):
        failures.append(
            f"{rel_path}: line-count mismatch baseline={len(baseline_lines)} candidate={len(candidate_lines)}"
        )
        return
    for line_no, (baseline_line, candidate_line) in enumerate(zip(baseline_lines, candidate_lines), start=1):
        baseline_tokens = [token.strip() for token in baseline_line.split(";")]
        candidate_tokens = [token.strip() for token in candidate_line.split(";")]
        if len(baseline_tokens) != len(candidate_tokens):
            failures.append(
                f"{rel_path}: line {line_no} column-count mismatch baseline={len(baseline_tokens)} candidate={len(candidate_tokens)}"
            )
            continue
        for col_idx, (baseline_token, candidate_token) in enumerate(zip(baseline_tokens, candidate_tokens), start=1):
            if is_numeric_token(baseline_token) and is_numeric_token(candidate_token):
                baseline_value = float(baseline_token)
                candidate_value = float(candidate_token)
                if not math.isclose(candidate_value, baseline_value, rel_tol=rel_tol, abs_tol=abs_tol):
                    failures.append(
                        f"{rel_path}: line {line_no} col {col_idx} numeric mismatch baseline={baseline_value} candidate={candidate_value}"
                    )
            elif baseline_token != candidate_token:
                failures.append(
                    f"{rel_path}: line {line_no} col {col_idx} text mismatch baseline={baseline_token!r} candidate={candidate_token!r}"
                )


def tolerance_compare(args: argparse.Namespace) -> int:
    spec = json.loads(Path(args.spec).read_text(encoding="utf-8"))
    baseline_dir = Path(spec["baseline_dir"])
    candidate_dir = Path(args.candidate_dir)
    abs_tol = float(spec.get("abs_tol", 0.0))
    rel_tol = float(spec.get("rel_tol", 0.0))
    ignore_files = set(spec.get("ignore_files", []))

    baseline_files = {
        path.relative_to(baseline_dir).as_posix(): path
        for path in baseline_dir.rglob("*")
        if path.is_file() and path.relative_to(baseline_dir).as_posix() not in ignore_files
    }
    candidate_files = {
        path.relative_to(candidate_dir).as_posix(): path
        for path in candidate_dir.rglob("*")
        if path.is_file() and path.relative_to(candidate_dir).as_posix() not in ignore_files
    }

    missing = sorted(set(baseline_files) - set(candidate_files))
    extra = sorted(set(candidate_files) - set(baseline_files))
    failures: list[str] = []
    for rel_path in sorted(set(baseline_files) & set(candidate_files)):
        baseline_path = baseline_files[rel_path]
        candidate_path = candidate_files[rel_path]
        if baseline_path.suffix.lower() == ".csv":
            compare_csv_files(
                baseline_path,
                candidate_path,
                abs_tol=abs_tol,
                rel_tol=rel_tol,
                failures=failures,
                rel_path=rel_path,
            )
        elif baseline_path.read_bytes() != candidate_path.read_bytes():
            failures.append(f"{rel_path}: non-CSV file mismatch")

    lines = [
        "# Tolerance Regression Report",
        f"spec: {args.spec}",
        f"candidate_dir: {args.candidate_dir}",
        f"status: {'PASS' if not (missing or extra or failures) else 'FAIL'}",
        "",
    ]
    if missing:
        lines.append("Missing files:")
        lines.extend(f"- {item}" for item in missing)
        lines.append("")
    if extra:
        lines.append("Extra files:")
        lines.extend(f"- {item}" for item in extra)
        lines.append("")
    if failures:
        lines.append("Mismatches:")
        lines.extend(f"- {item}" for item in failures[:200])
        if len(failures) > 200:
            lines.append(f"- ... truncated after 200 mismatches (total={len(failures)})")
        lines.append("")
    report_path = Path(args.report_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines), encoding="utf-8")
    return 0 if not (missing or extra or failures) else 1


def gc_summary(args: argparse.Namespace) -> int:
    gc_log = Path(args.gc_log)
    pause_count = 0
    young_pause_count = 0
    full_pause_count = 0
    pause_time_ms_total = 0.0
    line_count = 0
    if gc_log.exists():
        for raw_line in gc_log.read_text(encoding="utf-8", errors="replace").splitlines():
            line_count += 1
            pause_match = PAUSE_PATTERN.search(raw_line)
            if pause_match:
                value = float(pause_match.group(1))
                unit = pause_match.group(2)
                if unit == "s":
                    value *= 1000.0
                elif unit == "us":
                    value /= 1000.0
                pause_count += 1
                pause_time_ms_total += value
                if "Pause Young" in raw_line:
                    young_pause_count += 1
                if "Pause Full" in raw_line:
                    full_pause_count += 1
    output = {
        "gc_log": str(gc_log),
        "line_count": line_count,
        "pause_count": pause_count,
        "young_pause_count": young_pause_count,
        "full_pause_count": full_pause_count,
        "pause_time_ms_total": round(pause_time_ms_total, 6),
    }
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    return 0


def t_critical_95_two_sided(df: float) -> float:
    if df <= 0:
        return 0.0
    if df < 1:
        return T_CRITICAL_95_TWO_SIDED[1]
    nearest_df = int(round(df))
    if abs(df - nearest_df) < 1.0e-9 and nearest_df in T_CRITICAL_95_TWO_SIDED:
        return T_CRITICAL_95_TWO_SIDED[nearest_df]
    if df <= 30:
        lower_df = max(item for item in T_CRITICAL_95_TWO_SIDED if item <= df)
        upper_df = min(item for item in T_CRITICAL_95_TWO_SIDED if item >= df)
        if lower_df == upper_df:
            return T_CRITICAL_95_TWO_SIDED[lower_df]
        lower = T_CRITICAL_95_TWO_SIDED[lower_df]
        upper = T_CRITICAL_95_TWO_SIDED[upper_df]
        return lower + ((upper - lower) * ((df - lower_df) / (upper_df - lower_df)))
    return 1.959964


def metric_stats(values: list[float]) -> dict[str, object]:
    if not values:
        return {
            "count": 0,
            "min": None,
            "max": None,
            "mean": None,
            "median": None,
            "stdev": None,
            "sem": None,
            "cv": None,
            "mean_ci95_low": None,
            "mean_ci95_high": None,
            "mean_ci95_half_width": None,
        }
    count = len(values)
    mean = statistics.mean(values)
    stdev = statistics.stdev(values) if count > 1 else 0.0
    sem = stdev / math.sqrt(count) if count > 1 else 0.0
    ci95_half_width = t_critical_95_two_sided(count - 1) * sem if count > 1 else 0.0
    return {
        "count": count,
        "min": min(values),
        "max": max(values),
        "mean": mean,
        "median": statistics.median(values),
        "stdev": stdev,
        "sem": sem,
        "cv": None if mean == 0 else stdev / abs(mean),
        "mean_ci95_low": mean - ci95_half_width,
        "mean_ci95_high": mean + ci95_half_width,
        "mean_ci95_half_width": ci95_half_width,
    }


def read_key_value_properties(path: Path) -> dict[str, str]:
    properties: dict[str, str] = {}
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        key = key.strip()
        if not separator or not key:
            raise SystemExit(f"Malformed property at {path}:{line_number}: {raw_line!r}")
        if key in properties:
            raise SystemExit(f"Duplicate property {key!r} in {path}")
        properties[key] = value.strip()
    return properties


def current_benchmark_protocol(warmup_count: int) -> dict[str, object]:
    return {
        "protocol_id": BENCHMARK_PROTOCOL_ID,
        "primary_metric": "wall_clock_seconds",
        "wall_clock_seconds_scope": BENCHMARK_WALL_CLOCK_SCOPE,
        "process_wall_clock_seconds_scope": BENCHMARK_PROCESS_WALL_CLOCK_SCOPE,
        "model_computing_seconds_scope": BENCHMARK_MODEL_COMPUTING_SCOPE,
        "normalization_scope": BENCHMARK_NORMALIZATION_SCOPE,
        "same_jvm_warmup_count": warmup_count,
    }


def validate_benchmark_run_protocol(
    row: dict[str, object],
    *,
    expected_warmup_count: int,
    row_number: int,
) -> None:
    row_label = f"measured run row {row_number} ({row.get('run_id', 'unknown')})"
    for key in (
        "wall_clock_seconds",
        "process_wall_clock_seconds",
        "model_computing_seconds",
        "seconds_per_household_month",
        "ns_per_household_month",
    ):
        value = row.get(key)
        if value is None or float(value) <= 0.0:
            raise SystemExit(f"{row_label}: {key} must be present and positive.")
    wall_clock_seconds = float(row["wall_clock_seconds"])
    process_wall_clock_seconds = float(row["process_wall_clock_seconds"])
    model_computing_seconds = float(row["model_computing_seconds"])
    if process_wall_clock_seconds < wall_clock_seconds:
        raise SystemExit(
            f"{row_label}: process_wall_clock_seconds cannot be less than wall_clock_seconds."
        )
    if model_computing_seconds != wall_clock_seconds:
        raise SystemExit(
            f"{row_label}: model_computing_seconds must equal wall_clock_seconds under "
            f"{BENCHMARK_PROTOCOL_ID}."
        )

    raw_warmup_count = row.get("same_jvm_warmup_count")
    try:
        row_warmup_count = int(str(raw_warmup_count))
    except (TypeError, ValueError) as error:
        raise SystemExit(
            f"{row_label}: same_jvm_warmup_count must be an integer, got {raw_warmup_count!r}."
        ) from error
    if row_warmup_count != expected_warmup_count:
        raise SystemExit(
            f"{row_label}: same_jvm_warmup_count={row_warmup_count} does not match "
            f"--warmup-count={expected_warmup_count}."
        )

    raw_scope_path = str(row.get("measurement_scope_path", "")).strip()
    if not raw_scope_path:
        raise SystemExit(f"{row_label}: measurement_scope_path is required.")
    scope_path = Path(raw_scope_path)
    if not scope_path.is_absolute():
        scope_path = (Path.cwd() / scope_path).resolve()
    if not scope_path.is_file():
        raise SystemExit(f"{row_label}: measurement scope file not found: {scope_path}")
    properties = read_key_value_properties(scope_path)
    expected_properties = {
        "wall_clock_seconds_scope": BENCHMARK_WALL_CLOCK_SCOPE,
        "process_wall_clock_seconds_scope": BENCHMARK_PROCESS_WALL_CLOCK_SCOPE,
        "model_computing_seconds_scope": BENCHMARK_MODEL_COMPUTING_SCOPE,
        "denominator_scope": BENCHMARK_NORMALIZATION_SCOPE,
        "same_jvm_warmup_count": str(expected_warmup_count),
    }
    for key, expected in expected_properties.items():
        actual = properties.get(key)
        if actual != expected:
            raise SystemExit(
                f"{row_label}: {scope_path} has {key}={actual!r}; expected {expected!r}."
            )


def benchmark_protocol_from_summary(
    summary: dict[str, object],
    *,
    label: str,
) -> dict[str, object]:
    raw_protocol = summary.get("benchmark_protocol")
    if raw_protocol is None:
        # Historical tracked summaries predate explicit protocol metadata. The old harness used
        # whole-process wall time only when warm-up count was zero. That one case is unambiguous and
        # remains comparable to another legacy zero-warm-up summary, but never to the new protocol.
        source_run = summary.get("source_run")
        raw_warmup_count = summary.get("warmup_count")
        if raw_warmup_count is None and isinstance(source_run, dict):
            raw_warmup_count = source_run.get("warmup_count")
        try:
            warmup_count = int(str(raw_warmup_count))
        except (TypeError, ValueError) as error:
            raise SystemExit(
                f"{label}: benchmark_protocol is missing and warm-up count cannot be established."
            ) from error
        if warmup_count != 0:
            raise SystemExit(
                f"{label}: benchmark_protocol is missing for warmup_count={warmup_count}; "
                "the historical wall-clock scope is ambiguous. Re-run the benchmark."
            )
        return {
            "protocol_id": LEGACY_BENCHMARK_PROTOCOL_ID,
            "primary_metric": "wall_clock_seconds",
            "wall_clock_seconds_scope": LEGACY_BENCHMARK_WALL_CLOCK_SCOPE,
            "process_wall_clock_seconds_scope": None,
            "model_computing_seconds_scope": "whole_model_invocation",
            "normalization_scope": BENCHMARK_NORMALIZATION_SCOPE,
            "same_jvm_warmup_count": 0,
            "provenance": "inferred_from_legacy_zero_warmup_summary",
        }
    if not isinstance(raw_protocol, dict):
        raise SystemExit(f"{label}: benchmark_protocol must be a JSON object.")

    protocol = dict(raw_protocol)
    protocol_id = protocol.get("protocol_id")
    if protocol_id == BENCHMARK_PROTOCOL_ID:
        expected_fields = {
            "primary_metric": "wall_clock_seconds",
            "wall_clock_seconds_scope": BENCHMARK_WALL_CLOCK_SCOPE,
            "process_wall_clock_seconds_scope": BENCHMARK_PROCESS_WALL_CLOCK_SCOPE,
            "model_computing_seconds_scope": BENCHMARK_MODEL_COMPUTING_SCOPE,
            "normalization_scope": BENCHMARK_NORMALIZATION_SCOPE,
        }
    elif protocol_id == LEGACY_BENCHMARK_PROTOCOL_ID:
        expected_fields = {
            "primary_metric": "wall_clock_seconds",
            "wall_clock_seconds_scope": LEGACY_BENCHMARK_WALL_CLOCK_SCOPE,
            "process_wall_clock_seconds_scope": None,
            "model_computing_seconds_scope": "whole_model_invocation",
            "normalization_scope": BENCHMARK_NORMALIZATION_SCOPE,
        }
    else:
        raise SystemExit(f"{label}: unsupported benchmark protocol {protocol_id!r}.")
    for key, expected in expected_fields.items():
        if protocol.get(key) != expected:
            raise SystemExit(
                f"{label}: benchmark_protocol.{key}={protocol.get(key)!r}; expected {expected!r}."
            )
    try:
        warmup_count = int(str(protocol.get("same_jvm_warmup_count")))
    except (TypeError, ValueError) as error:
        raise SystemExit(
            f"{label}: benchmark_protocol.same_jvm_warmup_count must be a non-negative integer."
        ) from error
    if warmup_count < 0:
        raise SystemExit(
            f"{label}: benchmark_protocol.same_jvm_warmup_count must be a non-negative integer."
        )
    if protocol_id == LEGACY_BENCHMARK_PROTOCOL_ID and warmup_count != 0:
        raise SystemExit(
            f"{label}: {LEGACY_BENCHMARK_PROTOCOL_ID} requires same_jvm_warmup_count=0."
        )
    source_run = summary.get("source_run")
    raw_summary_warmup_count = summary.get("warmup_count")
    if raw_summary_warmup_count is None and isinstance(source_run, dict):
        raw_summary_warmup_count = source_run.get("warmup_count")
    if raw_summary_warmup_count is not None:
        try:
            summary_warmup_count = int(str(raw_summary_warmup_count))
        except (TypeError, ValueError) as error:
            raise SystemExit(f"{label}: summary warm-up count is not an integer.") from error
        if summary_warmup_count != warmup_count:
            raise SystemExit(
                f"{label}: summary warm-up count {summary_warmup_count} disagrees with "
                f"benchmark_protocol.same_jvm_warmup_count={warmup_count}."
            )
    protocol["same_jvm_warmup_count"] = warmup_count
    return protocol


def require_compatible_benchmark_protocols(
    baseline: dict[str, object],
    candidate: dict[str, object],
    *,
    baseline_label: str,
    candidate_label: str,
) -> dict[str, object]:
    baseline_protocol = benchmark_protocol_from_summary(baseline, label=baseline_label)
    candidate_protocol = benchmark_protocol_from_summary(candidate, label=candidate_label)
    compatibility_keys = (
        "protocol_id",
        "primary_metric",
        "wall_clock_seconds_scope",
        "process_wall_clock_seconds_scope",
        "model_computing_seconds_scope",
        "normalization_scope",
        "same_jvm_warmup_count",
    )
    mismatches = [
        f"{key}: baseline={baseline_protocol.get(key)!r}, candidate={candidate_protocol.get(key)!r}"
        for key in compatibility_keys
        if baseline_protocol.get(key) != candidate_protocol.get(key)
    ]
    if mismatches:
        raise SystemExit(
            "Incompatible benchmark protocols; refusing to compare "
            f"{baseline_label} with {candidate_label}: " + "; ".join(mismatches)
        )
    return candidate_protocol


def benchmark_summary(args: argparse.Namespace) -> int:
    if args.warmup_count < 0:
        raise SystemExit("--warmup-count must be a non-negative integer.")
    rows: list[dict[str, object]] = []
    with Path(args.runs_tsv).open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        for row in reader:
            parsed = dict(row)
            for key in BENCHMARK_NUMERIC_KEYS:
                value = parsed.get(key, "")
                if value in ("", None):
                    parsed[key] = None
                elif key in ("output_bytes", "max_rss_kb", "gc_pause_count"):
                    parsed[key] = int(float(str(value)))
                else:
                    parsed[key] = float(str(value))
            rows.append(parsed)
    if not rows:
        raise SystemExit("No measured runs found in TSV.")
    for row_number, row in enumerate(rows, start=1):
        validate_benchmark_run_protocol(
            row,
            expected_warmup_count=args.warmup_count,
            row_number=row_number,
        )

    metric_summary: dict[str, dict[str, object]] = {}
    for key in BENCHMARK_NUMERIC_KEYS:
        values = [float(row[key]) for row in rows if row[key] is not None]
        metric_summary[key] = metric_stats(values)

    median_sorted_rows = sorted(rows, key=lambda item: float(item["wall_clock_seconds"]))
    median_row = median_sorted_rows[(len(median_sorted_rows) - 1) // 2]
    summary = {
        "summary_schema_version": BENCHMARK_SUMMARY_SCHEMA_VERSION,
        "benchmark_protocol": current_benchmark_protocol(args.warmup_count),
        "run_count": len(rows),
        "warmup_count": args.warmup_count,
        "cooldown_count": args.cooldown_count,
        "median_run_id": median_row["run_id"],
        "best_run_id": min(rows, key=lambda item: float(item["wall_clock_seconds"]))["run_id"],
        "median_jfr_captured": bool(args.jfr_captured),
        "median_jfr_protocol_matches_measured_runs": bool(args.jfr_captured),
        "median_jfr_same_jvm_warmup_count": (
            args.warmup_count if args.jfr_captured else None
        ),
        "metric_summary": metric_summary,
        "runs": rows,
    }
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return 0


def build_cache_paired_run_plan(
    *,
    seed: int,
    repeat: int,
    warmup_pairs: int,
    ordering_seed: int,
) -> list[CachePairedRunEntry]:
    if seed <= 0:
        raise ValueError("seed must be a positive integer.")
    if repeat <= 0:
        raise ValueError("repeat must be a positive integer.")
    if warmup_pairs < 0:
        raise ValueError("warmup_pairs must be a non-negative integer.")

    rng = random.Random(ordering_seed)
    entries: list[CachePairedRunEntry] = []

    def append_pair(phase: str, pair_index: int) -> None:
        variants = ["cache-off", "cache-on"]
        rng.shuffle(variants)
        for variant in variants:
            entries.append(
                CachePairedRunEntry(
                    phase=phase,
                    run_order_index=len(entries) + 1,
                    pair_index=pair_index,
                    seed=seed,
                    variant=variant,
                    run_id=f"{phase}-{pair_index:03d}-{variant}",
                )
            )

    for pair_index in range(1, warmup_pairs + 1):
        append_pair("warmup", pair_index)

    measured_pair_indices = list(range(1, repeat + 1))
    rng.shuffle(measured_pair_indices)
    for pair_index in measured_pair_indices:
        append_pair("measured", pair_index)

    return entries


def write_cache_paired_run_plan(entries: list[CachePairedRunEntry], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["phase", "run_order_index", "pair_index", "seed", "variant", "run_id"],
            delimiter="\t",
            lineterminator="\n",
        )
        writer.writeheader()
        for entry in entries:
            writer.writerow(
                {
                    "phase": entry.phase,
                    "run_order_index": entry.run_order_index,
                    "pair_index": entry.pair_index,
                    "seed": entry.seed,
                    "variant": entry.variant,
                    "run_id": entry.run_id,
                }
            )


def cache_paired_plan(args: argparse.Namespace) -> int:
    entries = build_cache_paired_run_plan(
        seed=args.seed,
        repeat=args.repeat,
        warmup_pairs=args.warmup_pairs,
        ordering_seed=args.ordering_seed,
    )
    write_cache_paired_run_plan(entries, Path(args.output))
    return 0


def read_cache_paired_runs_tsv(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        for row in reader:
            parsed: dict[str, object] = dict(row)
            for key in ("pair_index", "run_order_index", "seed"):
                parsed[key] = int(float(str(parsed[key])))
            for key in BENCHMARK_NUMERIC_KEYS:
                value = parsed.get(key, "")
                if value in ("", None):
                    parsed[key] = None
                elif key in ("output_bytes", "max_rss_kb", "gc_pause_count"):
                    parsed[key] = int(float(str(value)))
                else:
                    parsed[key] = float(str(value))
            rows.append(parsed)
    return rows


def normalize_cache_paired_row(row: dict[str, object]) -> dict[str, object]:
    normalized = dict(row)
    normalized["phase"] = str(row.get("phase", "measured") or "measured")
    normalized["variant"] = str(row["variant"])
    normalized["pair_index"] = int(row["pair_index"])
    normalized["run_order_index"] = int(row["run_order_index"])
    normalized["seed"] = int(row["seed"])
    normalized["run_id"] = str(row["run_id"])
    for key in BENCHMARK_NUMERIC_KEYS:
        value = row.get(key)
        if value is None or value == "":
            normalized[key] = None
        elif key in ("output_bytes", "max_rss_kb", "gc_pause_count"):
            normalized[key] = int(float(str(value)))
        else:
            normalized[key] = float(str(value))
    for key in ("config_path", "output_dir", "stdout_log", "time_file", "manifest_path"):
        normalized[key] = str(row.get(key, ""))
    return normalized


def cache_paired_speedup_summary(log_values: list[float]) -> dict[str, object]:
    if not log_values:
        return {
            "count": 0,
            "geometric_mean": None,
            "lower_95_ci": None,
            "upper_95_ci": None,
            "log_mean": None,
            "log_stdev": None,
            "log_sem": None,
            "log_ci95_half_width": None,
        }
    count = len(log_values)
    mean_log = statistics.mean(log_values)
    estimate = math.exp(mean_log)
    if count == 1:
        return {
            "count": count,
            "geometric_mean": estimate,
            "lower_95_ci": None,
            "upper_95_ci": None,
            "log_mean": mean_log,
            "log_stdev": 0.0,
            "log_sem": 0.0,
            "log_ci95_half_width": None,
        }
    stdev = statistics.stdev(log_values)
    sem = stdev / math.sqrt(count)
    half_width = t_critical_95_two_sided(count - 1) * sem
    return {
        "count": count,
        "geometric_mean": estimate,
        "lower_95_ci": math.exp(mean_log - half_width),
        "upper_95_ci": math.exp(mean_log + half_width),
        "log_mean": mean_log,
        "log_stdev": stdev,
        "log_sem": sem,
        "log_ci95_half_width": half_width,
    }


def compare_cache_pair_manifests(cache_off_path: str, cache_on_path: str) -> dict[str, object]:
    off_path = Path(cache_off_path)
    on_path = Path(cache_on_path)
    if not off_path.exists() or not on_path.exists():
        return {
            "status": "FAIL",
            "cache_off_manifest": cache_off_path,
            "cache_on_manifest": cache_on_path,
            "missing_manifest_paths": [
                str(path)
                for path in (off_path, on_path)
                if not path.exists()
            ],
            "missing_files": [],
            "extra_files": [],
            "mismatched_files": [],
        }
    missing, extra, mismatched = manifest_differences(load_manifest(off_path), load_manifest(on_path))
    return {
        "status": "PASS" if not (missing or extra or mismatched) else "FAIL",
        "cache_off_manifest": cache_off_path,
        "cache_on_manifest": cache_on_path,
        "missing_manifest_paths": [],
        "missing_files": missing,
        "extra_files": extra,
        "mismatched_files": mismatched,
    }


def analyze_cache_paired_runs(rows: list[dict[str, object]]) -> dict[str, object]:
    normalized_rows = [normalize_cache_paired_row(row) for row in rows]
    warmup_rows = [row for row in normalized_rows if row["phase"] != "measured"]
    measured_rows = [row for row in normalized_rows if row["phase"] == "measured"]
    grouped: dict[int, dict[str, list[dict[str, object]]]] = {}
    for row in measured_rows:
        grouped.setdefault(int(row["pair_index"]), {}).setdefault(str(row["variant"]), []).append(row)

    pairs: list[dict[str, object]] = []
    incomplete_pairs: list[dict[str, object]] = []
    manifest_failures: list[dict[str, object]] = []
    for pair_index, variants in sorted(grouped.items()):
        cache_off_rows = variants.get("cache-off", [])
        cache_on_rows = variants.get("cache-on", [])
        if len(cache_off_rows) != 1 or len(cache_on_rows) != 1:
            incomplete_pairs.append(
                {
                    "pair_index": pair_index,
                    "cache_off_count": len(cache_off_rows),
                    "cache_on_count": len(cache_on_rows),
                }
            )
            continue
        cache_off = cache_off_rows[0]
        cache_on = cache_on_rows[0]
        off_seconds = float(cache_off["wall_clock_seconds"])
        on_seconds = float(cache_on["wall_clock_seconds"])
        manifest_comparison = compare_cache_pair_manifests(
            str(cache_off["manifest_path"]),
            str(cache_on["manifest_path"]),
        )
        pair = {
            "pair_index": pair_index,
            "seed": int(cache_off["seed"]),
            "cache_off_run_id": cache_off["run_id"],
            "cache_on_run_id": cache_on["run_id"],
            "cache_off_run_order_index": cache_off["run_order_index"],
            "cache_on_run_order_index": cache_on["run_order_index"],
            "cache_off_seconds": off_seconds,
            "cache_on_seconds": on_seconds,
            "raw_speedup": off_seconds / on_seconds,
            "log_speedup": math.log(off_seconds / on_seconds),
            "output_hash_status": manifest_comparison["status"],
        }
        pairs.append(pair)
        if manifest_comparison["status"] != "PASS":
            manifest_failures.append({"pair_index": pair_index, **manifest_comparison})

    metric_summary_by_variant: dict[str, dict[str, dict[str, object]]] = {}
    for variant in ("cache-off", "cache-on"):
        variant_rows = [row for row in measured_rows if row["variant"] == variant]
        metric_summary_by_variant[variant] = {
            key: metric_stats([float(row[key]) for row in variant_rows if row[key] is not None])
            for key in BENCHMARK_NUMERIC_KEYS
        }

    paired_delta_summary = {
        key: metric_stats(
            [
                float(grouped_pair["cache-on"][0][key]) - float(grouped_pair["cache-off"][0][key])
                for grouped_pair in grouped.values()
                if len(grouped_pair.get("cache-off", [])) == 1
                and len(grouped_pair.get("cache-on", [])) == 1
                and grouped_pair["cache-off"][0][key] is not None
                and grouped_pair["cache-on"][0][key] is not None
            ]
        )
        for key in BENCHMARK_NUMERIC_KEYS
    }

    status = "PASS" if not incomplete_pairs and not manifest_failures else "FAIL"
    return {
        "schema_version": 1,
        "status": status,
        "run_count": len(measured_rows),
        "warmup_rows_ignored": len(warmup_rows),
        "complete_pair_count": len(pairs),
        "incomplete_pair_count": len(incomplete_pairs),
        "speedup": cache_paired_speedup_summary([float(pair["log_speedup"]) for pair in pairs]),
        "metric_summary_by_variant": metric_summary_by_variant,
        "paired_cache_on_minus_cache_off_metric_summary": paired_delta_summary,
        "pairs": pairs,
        "incomplete_pairs": incomplete_pairs,
        "output_hash_comparison": {
            "status": "PASS" if not manifest_failures else "FAIL",
            "mismatched_pair_count": len(manifest_failures),
            "mismatches": manifest_failures,
        },
    }


def cache_paired_summary(args: argparse.Namespace) -> int:
    rows = read_cache_paired_runs_tsv(Path(args.runs_tsv))
    summary = analyze_cache_paired_runs(rows)
    validation_failures: list[str] = []
    if args.expected_repeat is not None and summary["complete_pair_count"] != args.expected_repeat:
        validation_failures.append(
            f"Expected {args.expected_repeat} complete measured pairs, found {summary['complete_pair_count']}."
        )
    if args.expected_seed is not None:
        seeds = sorted({int(row["seed"]) for row in rows if str(row.get("phase", "measured")) == "measured"})
        if seeds != [args.expected_seed]:
            validation_failures.append(f"Expected measured seed [{args.expected_seed}], found {seeds}.")
    if validation_failures:
        summary["status"] = "FAIL"
    summary["validation_failures"] = validation_failures

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return 0 if summary["status"] == "PASS" else 1


def load_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_environment_file(path: Path | None) -> dict[str, object]:
    if path is None or not path.exists():
        return {}
    result: dict[str, object] = {}
    section: str | None = None
    section_lines: dict[str, list[str]] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1]
            section_lines.setdefault(section, [])
            continue
        if section is None and "=" in line:
            key, value = line.split("=", 1)
            result[key] = value
        elif section is not None:
            section_lines.setdefault(section, []).append(line)
    if section_lines.get("uname -a"):
        result["uname"] = section_lines["uname -a"][0]
    if section_lines.get("java -version"):
        result["java"] = section_lines["java -version"][0]
    if section_lines.get("mvn -version"):
        result["maven"] = section_lines["mvn -version"][0]
    if section_lines.get("nproc"):
        result["nproc"] = section_lines["nproc"][0]
    return result


def display_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return resolved.as_posix()


def find_run(summary: dict[str, object], run_id: str) -> dict[str, object]:
    for row in summary["runs"]:
        if row["run_id"] == run_id:
            return row
    raise SystemExit(f"Run id not found in summary: {run_id}")


def baseline_snapshot(args: argparse.Namespace) -> int:
    summary_path = Path(args.summary)
    summary = load_json(summary_path)
    benchmark_protocol = benchmark_protocol_from_summary(summary, label=str(summary_path))
    median_row = find_run(summary, str(summary["median_run_id"]))
    manifest_path = Path(str(median_row["manifest_path"]))
    if not manifest_path.is_absolute():
        manifest_path = (Path.cwd() / manifest_path).resolve()
    file_count = None
    if manifest_path.exists():
        file_count = sum(1 for line in manifest_path.read_text(encoding="utf-8").splitlines() if line.strip())
    metrics = {
        key: median_row[key]
        for key in BENCHMARK_NUMERIC_KEYS
        if key in median_row
    }
    source_run = {
        "type": "snapshot_local_benchmark",
        "benchmark_root": display_path(summary_path.parent),
        "summary_schema_version": summary.get("summary_schema_version"),
        "warmup_count": summary.get("warmup_count", 0),
        "cooldown_count": summary.get("cooldown_count", 0),
        "measured_repeat_count": summary.get("run_count"),
        "median_run_id": summary.get("median_run_id"),
        "best_run_id": summary.get("best_run_id"),
        "median_jfr_captured": summary.get("median_jfr_captured", False),
        "median_jfr_protocol_matches_measured_runs": summary.get(
            "median_jfr_protocol_matches_measured_runs", False
        ),
        "median_jfr_same_jvm_warmup_count": summary.get(
            "median_jfr_same_jvm_warmup_count"
        ),
    }
    payload = {
        "baseline_id": args.baseline_id,
        "status": "canonical",
        "created_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "snapshot": args.snapshot,
        "validation_dataset": args.validation_dataset,
        "mode": args.mode,
        "purpose": args.purpose,
        "contract": args.contract,
        "manifest_path": None if args.manifest_path is None else args.manifest_path,
        "benchmark_protocol": benchmark_protocol,
        "source_run": source_run,
        "environment": parse_environment_file(Path(args.environment) if args.environment else None),
        "output_contract": {
            "file_count": file_count,
            "output_bytes_median": median_row.get("output_bytes"),
        },
        "metrics": metrics,
        "metric_summary": summary["metric_summary"],
        "notes": [
            "Generated by the snapshot-local model-speed harness; raw outputs remain under tmp/model-speed/.",
            "The harness loaded input-data-versions/v0/config.properties and applied only the pinned mode overrides.",
        ],
    }
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return 0


def format_number(value: object, digits: int = 6) -> str:
    if value is None:
        return "n/a"
    number = float(value)
    if number == 0:
        return "0"
    if abs(number) >= 1000 or abs(number) < 0.001:
        return f"{number:.{digits}e}"
    return f"{number:.{digits}f}".rstrip("0").rstrip(".")


def difference_stats(
    baseline_stats: dict[str, object],
    candidate_stats: dict[str, object],
) -> dict[str, object]:
    baseline_mean = baseline_stats["mean"]
    candidate_mean = candidate_stats["mean"]
    if baseline_mean is None or candidate_mean is None:
        return {"mean": None, "ci95_low": None, "ci95_high": None, "ci95_half_width": None}
    diff = float(candidate_mean) - float(baseline_mean)
    baseline_count = int(baseline_stats["count"])
    candidate_count = int(candidate_stats["count"])
    baseline_stdev = float(baseline_stats["stdev"] or 0.0)
    candidate_stdev = float(candidate_stats["stdev"] or 0.0)
    baseline_var_over_n = (baseline_stdev * baseline_stdev) / baseline_count if baseline_count else 0.0
    candidate_var_over_n = (candidate_stdev * candidate_stdev) / candidate_count if candidate_count else 0.0
    se = math.sqrt(baseline_var_over_n + candidate_var_over_n)
    if se == 0.0:
        return {"mean": diff, "ci95_low": diff, "ci95_high": diff, "ci95_half_width": 0.0}
    numerator = (baseline_var_over_n + candidate_var_over_n) ** 2
    denominator = 0.0
    if baseline_count > 1:
        denominator += (baseline_var_over_n * baseline_var_over_n) / (baseline_count - 1)
    if candidate_count > 1:
        denominator += (candidate_var_over_n * candidate_var_over_n) / (candidate_count - 1)
    df = numerator / denominator if denominator else min(baseline_count, candidate_count) - 1
    half_width = t_critical_95_two_sided(df) * se
    return {
        "mean": diff,
        "ci95_low": diff - half_width,
        "ci95_high": diff + half_width,
        "ci95_half_width": half_width,
    }


def primary_metric_verdict(diff_stats: dict[str, object]) -> str:
    low = diff_stats["ci95_low"]
    high = diff_stats["ci95_high"]
    mean = diff_stats["mean"]
    if low is None or high is None or mean is None:
        return "inconclusive/noise-dominated"
    if float(mean) < 0 and float(high) < 0:
        return "faster"
    if float(mean) > 0 and float(low) > 0:
        return "slower"
    return "inconclusive/noise-dominated"


def benchmark_compare(args: argparse.Namespace) -> int:
    verdict_metric = args.verdict_metric
    metrics = (
        "wall_clock_seconds",
        "process_wall_clock_seconds",
        "seconds_per_household_month",
        "max_rss_kb",
        "gc_pause_count",
        "gc_pause_time_ms_total",
        "user_cpu_seconds",
        "system_cpu_seconds",
        "output_bytes",
    )
    lines = [
        "# Rental-Income Running-Total Benchmark",
        "Author: Max Stoddard",
        "",
        "Candidate implementation audit: the current Java change is a lazy cached monthly gross rental income total. It invalidates the cache when rental contracts are added, removed, or expire, then recomputes on demand. It is not a pure incremental running-total update.",
        "",
        f"Verdict rule: `faster` requires the candidate-minus-baseline 95% CI for `{verdict_metric}` to be entirely below zero; `slower` requires it to be entirely above zero; otherwise the result is inconclusive/noise-dominated.",
        "",
    ]
    enough_lines: list[str] = []
    for comparison in args.comparison:
        mode, baseline_summary_path, candidate_summary_path = comparison
        baseline = load_json(Path(baseline_summary_path))
        candidate = load_json(Path(candidate_summary_path))
        protocol = require_compatible_benchmark_protocols(
            baseline,
            candidate,
            baseline_label=baseline_summary_path,
            candidate_label=candidate_summary_path,
        )
        for label, summary in (
            (baseline_summary_path, baseline),
            (candidate_summary_path, candidate),
        ):
            metric_summary = summary.get("metric_summary")
            if (
                not isinstance(metric_summary, dict)
                or verdict_metric not in metric_summary
                or not isinstance(metric_summary[verdict_metric], dict)
                or metric_summary[verdict_metric].get("mean") is None
            ):
                raise SystemExit(
                    f"{label}: verdict metric {verdict_metric!r} is unavailable."
                )
        primary_diff = difference_stats(
            baseline["metric_summary"][verdict_metric],
            candidate["metric_summary"][verdict_metric],
        )
        verdict = primary_metric_verdict(primary_diff)
        repeat_count = candidate.get("run_count", candidate["metric_summary"][verdict_metric]["count"])
        enough_lines.append(f"- `{mode}`: {'yes' if verdict != 'inconclusive/noise-dominated' else 'no'} after {repeat_count} measured repeats; verdict `{verdict}`.")
        lines.extend(
            [
                f"## {mode}",
                f"- Baseline summary: `{baseline_summary_path}`",
                f"- Candidate summary: `{candidate_summary_path}`",
                f"- Headline metric: `{verdict_metric}`",
                f"- Timing protocol: `{protocol['protocol_id']}`",
                f"- Wall-clock scope: `{protocol['wall_clock_seconds_scope']}`",
                f"- Same-JVM warm-ups per measured sample: `{protocol['same_jvm_warmup_count']}`",
                f"- Execution-time verdict: `{verdict}`",
                "",
                "| Metric | Baseline mean ± 95% CI | Candidate mean ± 95% CI | Candidate - baseline mean ± 95% CI | Delta % | Baseline median | Candidate median |",
                "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
            ]
        )
        for metric in metrics:
            if (
                metric not in baseline["metric_summary"]
                or metric not in candidate["metric_summary"]
                or baseline["metric_summary"][metric].get("mean") is None
                or candidate["metric_summary"][metric].get("mean") is None
            ):
                continue
            baseline_stats = baseline["metric_summary"][metric]
            candidate_stats = candidate["metric_summary"][metric]
            diff = difference_stats(baseline_stats, candidate_stats)
            baseline_mean = float(baseline_stats["mean"])
            delta_pct = None if baseline_mean == 0 else (float(diff["mean"]) / baseline_mean) * 100.0
            lines.append(
                "| {metric} | {baseline_mean} +/- {baseline_ci} | {candidate_mean} +/- {candidate_ci} | {diff_mean} +/- {diff_ci} | {delta_pct} | {baseline_median} | {candidate_median} |".format(
                    metric=metric,
                    baseline_mean=format_number(baseline_stats["mean"]),
                    baseline_ci=format_number(baseline_stats["mean_ci95_half_width"]),
                    candidate_mean=format_number(candidate_stats["mean"]),
                    candidate_ci=format_number(candidate_stats["mean_ci95_half_width"]),
                    diff_mean=format_number(diff["mean"]),
                    diff_ci=format_number(diff["ci95_half_width"]),
                    delta_pct="n/a" if delta_pct is None else f"{delta_pct:.3f}%",
                    baseline_median=format_number(baseline_stats["median"]),
                    candidate_median=format_number(candidate_stats["median"]),
                )
            )
        lines.append("")
    lines.extend(["## Were The Contract Runs Enough?", *enough_lines, ""])
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")
    return 0


def results_summary(args: argparse.Namespace) -> int:
    run_dir = (
        RESULTS_SUMMARY_DEFAULT_RUN_DIR
        if args.run_dir is None
        else Path(args.run_dir).expanduser()
    ).resolve()
    if not run_dir.exists() or not run_dir.is_dir():
        raise SystemExit(f"Results run directory not found: {run_dir}")

    lines = [
        f"Run directory: {run_dir}",
        "Window: indices 200:2000 (periods 200..1999 inclusive, 1800 values)",
    ]
    for series in RESULTS_SUMMARY_SERIES:
        source_path = run_dir / series.file_name
        if series.output_column is None:
            raw_values = load_results_summary_core_values(source_path)
        else:
            raw_values = load_results_summary_output_column(source_path, series.output_column)
        window_values = select_results_summary_window(raw_values, series.label, source_path)
        mean_value = statistics.mean(value * series.scale for value in window_values)
        lines.append(f"{series.label}: {mean_value:.6f}")

    print("\n".join(lines))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Model-speed helper CLI.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    materialize = subparsers.add_parser("materialize-config", help="Write a full snapshot-local config.")
    materialize.add_argument("--snapshot", required=True)
    materialize.add_argument("--mode-file", required=True)
    materialize.add_argument("--output", required=True)
    materialize.add_argument("--override", action="append", default=[])
    materialize.set_defaults(func=materialize_config)

    manifest = subparsers.add_parser("manifest", help="Write a SHA-256 manifest for an output directory.")
    manifest.add_argument("--output-dir", required=True)
    manifest.add_argument("--manifest-path", required=True)
    manifest.set_defaults(func=write_manifest)

    exact = subparsers.add_parser("exact-compare", help="Compare two exact manifests.")
    exact.add_argument("--baseline-manifest", required=True)
    exact.add_argument("--candidate-manifest", required=True)
    exact.add_argument("--report-path", required=True)
    exact.set_defaults(func=exact_compare)

    exact_repeat = subparsers.add_parser("exact-repeat-compare", help="Compare exact manifests across repeated runs.")
    exact_repeat.add_argument("--baseline-manifest", required=True)
    exact_repeat.add_argument("--candidate-manifest", action="append", required=True)
    exact_repeat.add_argument("--report-path", required=True)
    exact_repeat.set_defaults(func=exact_repeat_compare)

    tolerance = subparsers.add_parser("tolerance-compare", help="Compare outputs using a tolerance spec.")
    tolerance.add_argument("--spec", required=True)
    tolerance.add_argument("--candidate-dir", required=True)
    tolerance.add_argument("--report-path", required=True)
    tolerance.set_defaults(func=tolerance_compare)

    gc = subparsers.add_parser("gc-summary", help="Summarise a GC log.")
    gc.add_argument("--gc-log", required=True)
    gc.add_argument("--output", required=True)
    gc.set_defaults(func=gc_summary)

    summary = subparsers.add_parser("benchmark-summary", help="Summarise benchmark TSV rows.")
    summary.add_argument("--runs-tsv", required=True)
    summary.add_argument("--output", required=True)
    summary.add_argument("--warmup-count", type=int, default=0)
    summary.add_argument("--cooldown-count", type=int, default=0)
    summary.add_argument("--jfr-captured", type=int, choices=(0, 1), default=0)
    summary.set_defaults(func=benchmark_summary)

    cache_plan = subparsers.add_parser("cache-paired-plan", help="Write a seed-1 paired cache benchmark run plan.")
    cache_plan.add_argument("--seed", type=int, required=True)
    cache_plan.add_argument("--repeat", type=int, required=True)
    cache_plan.add_argument("--warmup-pairs", type=int, required=True)
    cache_plan.add_argument("--ordering-seed", type=int, required=True)
    cache_plan.add_argument("--output", required=True)
    cache_plan.set_defaults(func=cache_paired_plan)

    cache_summary = subparsers.add_parser(
        "cache-paired-summary",
        help="Summarise paired cache benchmark TSV rows and compare paired output manifests.",
    )
    cache_summary.add_argument("--runs-tsv", required=True)
    cache_summary.add_argument("--output", required=True)
    cache_summary.add_argument("--expected-repeat", type=int)
    cache_summary.add_argument("--expected-seed", type=int)
    cache_summary.set_defaults(func=cache_paired_summary)

    snapshot = subparsers.add_parser("baseline-snapshot", help="Create a tracked benchmark baseline summary.")
    snapshot.add_argument("--summary", required=True)
    snapshot.add_argument("--environment", required=True)
    snapshot.add_argument("--output", required=True)
    snapshot.add_argument("--baseline-id", required=True)
    snapshot.add_argument("--snapshot", required=True)
    snapshot.add_argument("--validation-dataset", required=True)
    snapshot.add_argument("--mode", required=True)
    snapshot.add_argument("--purpose", required=True)
    snapshot.add_argument("--contract", required=True)
    snapshot.add_argument("--manifest-path")
    snapshot.set_defaults(func=baseline_snapshot)

    compare = subparsers.add_parser("benchmark-compare", help="Compare baseline and candidate benchmark summaries.")
    compare.add_argument(
        "--comparison",
        action="append",
        nargs=3,
        metavar=("MODE", "BASELINE_SUMMARY", "CANDIDATE_SUMMARY"),
        required=True,
    )
    compare.add_argument("--verdict-metric", default="wall_clock_seconds", choices=BENCHMARK_NUMERIC_KEYS)
    compare.add_argument("--output", required=True)
    compare.set_defaults(func=benchmark_compare)

    results = subparsers.add_parser(
        "results-summary",
        help="Print post-200 simulation means from Results/v4.1-output or an overridden run directory.",
    )
    results.add_argument(
        "--run-dir",
        help="Results run directory to summarise (default: repo-root Results/v4.1-output).",
    )
    results.set_defaults(func=results_summary)

    flamegraph = subparsers.add_parser("jfr-flamegraph", help="Render a modelStep-focused flame graph SVG from JFR.")
    flamegraph.add_argument("--profile-id", required=True)
    flamegraph.add_argument("--jfr", required=True)
    flamegraph.add_argument("--title", required=True)
    flamegraph.add_argument("--output", required=True)
    flamegraph.add_argument("--expected-total-samples", type=int)
    flamegraph.add_argument("--expected-modelstep-samples", type=int)
    flamegraph.set_defaults(func=jfr_flamegraph)

    method_report = subparsers.add_parser(
        "jfr-method-report",
        help="Emit Markdown, CSV, and JSON method-share reports from JFR execution samples.",
    )
    method_report.add_argument(
        "--profile",
        action="append",
        nargs=4,
        metavar=("PROFILE_ID", "JFR_PATH", "EXPECTED_TOTAL", "EXPECTED_MODELSTEP"),
        required=True,
    )
    method_report.add_argument("--output-dir", required=True)
    method_report.add_argument("--output-markdown", required=True)
    method_report.set_defaults(func=jfr_method_report)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
