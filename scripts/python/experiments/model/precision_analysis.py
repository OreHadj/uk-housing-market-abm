#!/usr/bin/env python3
"""Frozen paired-block analysis for the active v5o3 B+ precision campaign.

The module deliberately keeps the no-op preflight separate from candidate analysis.  Candidate
score files are not opened until the campaign, scope, and analysis freezes have all verified
against the live program, tests, dependencies, and Python package versions.

Note on reanalysing the reported campaign (report Section 5): the original analysis is frozen to
preserve the experimental method and its inputs. Its verifier checks the source files, the saved
results, the recorded absolute path of the results directory, and the Python package versions.
The matching source is commit 75a2cab, with Python 3.10.13, NumPy 1.26.4 and SciPy 1.15.3.

The original campaign outputs are retained separately and are not stored in git. Cloning this
branch therefore provides the implementation and scripts for new runs, but exact reanalysis of
the reported experiment also requires those saved outputs and the matching setup. The workflow is
configured for the original directory layout, and running it elsewhere would require additional
setup that has not been tested. The outputs and environment details are available from the
author on request.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import random
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from types import MappingProxyType
from typing import Callable, Mapping, Sequence

import numpy as np
import scipy
from scipy import stats


REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.python.experiments.model import precision_sweep as sweep  # noqa: E402
from scripts.python.validation.model.scoring import (  # noqa: E402
    compute_overall_composite_loss,
)


SCHEMA_VERSION = 1
ANALYSIS_ARTIFACT_TYPE = "precision-paired-block-analysis"
CONTROL_ARTIFACT_TYPE = "precision-hq52-analysis-control"
FREEZE_ARTIFACT_TYPE = "precision-analysis-freeze"
REPLAY_ARTIFACT_TYPE = "precision-replay-evidence"
REPLAY_SCHEMA_VERSION = 1
SELECTION_ARTIFACT_TYPE = "precision-selection"
SELECTION_SCHEMA_VERSION = 1
EXTENSION_TRIGGER_ARTIFACT_TYPE = "precision-confirmation-extension-trigger"

CANONICAL_CAMPAIGN_NAME = "precision-bplus-campaign-v5o3-20260904"
REPOSITORY_CAMPAIGN_ROOT = REPO_ROOT / "Results" / CANONICAL_CAMPAIGN_NAME
DURABLE_CAMPAIGN_ROOT = (
    REPO_ROOT.parent
    / "benchmark-artifacts"
    / "uk-housing-market-abm-gpu"
    / "precision-bplus-v5o3-20260904"
)
EXPECTED_CAMPAIGN_SHA256 = "1eb38a43cd5f5776610b454dad33a650f66255be73e3b66143f4e6a6b1f8a311"
EXPECTED_CAMPAIGN_SOURCE_SHA256 = (
    "df1638ba74da0537008ffc260e39ade1ed08d346012711ef402addaa5942ee7b"
)
EXPECTED_MARGINS_SHA256 = "a088de661ae365d29da3ac8ee65ebbaf2fd9b23cfb02aeaaec1804a911cb5fcd"
EXPECTED_REFERENCE_SHA256 = (
    "c199f88d9720eddfbab4ee930fdf8f14db84520c2695e040525f8c80a30eb5dd"
)
EXPECTED_HQ52_SCORE_SHA256 = "e99d0263ea5060c66ff79eadddee8759f6e48b9a3dedfc9f3a4da063fb44898c"
EXPECTED_HQ52_COMPOSITE = 0.6386956451346522

CAMPAIGN_JSON = "campaign.json"
CAMPAIGN_SEAL = "campaign.sha256"
MARGINS_JSON = "analysis/margins.json"
MARGINS_SEAL = "seals/margins.sha256"
REFERENCE_JSON = "analysis/reference-distribution.json"
REFERENCE_SEAL = "seals/reference-distribution.sha256"
SCOPE_JSON = "seals/scope-freeze.json"
SCOPE_SEAL = "seals/scope-freeze.sha256"
ARCHIVED_SCOPE_MANIFEST = "seals/selected-state-v1.csv"
REPOSITORY_SCOPE_MANIFEST = "docs/precision/selected-state-v1.csv"
CONTROL_SCORE_JSON = "blocks/HQ52-seeds-000001-000008.json"
CONTROL_REPORT_JSON = "analysis/hq52-analysis-control.json"
ANALYSIS_FREEZE_JSON = "seals/analysis-freeze.json"
ANALYSIS_FREEZE_SEAL = "seals/analysis-freeze.sha256"
SELECTION_JSON = "seals/selection.json"
SELECTION_SEAL = "seals/selection.sha256"
EXTENSION_TRIGGER_JSON = "seals/confirmation-extension-trigger.json"
EXTENSION_TRIGGER_SEAL = "seals/confirmation-extension-trigger.sha256"
ANALYSIS_PROGRAM_PATH = "scripts/python/experiments/model/precision_analysis.py"
ANALYSIS_TEST_PATH = "scripts/python/tests/test_precision_analysis.py"

RUNTIME_FIELD_SET = "gate-probe-v1-no-age"
SUBSTRATE = "philox-household"
FRONTIER = "array"
DISCOVERY_CANDIDATES = ("HQ51", "HQ40", "HQ32")
NOOP_CONTROL_ARM = "HQ52"
REFERENCE_ARM = "H64"
INVALID_ARMS = ("HQ23", "HQ16", "HQ10", "HQ8", "HQ6", "HQ4")
SAFER_NEIGHBOUR = MappingProxyType({"HQ51": "H64", "HQ40": "HQ51", "HQ32": "HQ40"})

METRIC_IDS = (
    "core_advancesToBTL",
    "core_advancesToFTB",
    "core_advancesToHM",
    "core_debtToIncome",
    "core_housePriceGrowth",
    "core_housingTransactions",
    "core_hpiCyclePeriod",
    "core_hpiMean",
    "core_hpiStd",
    "core_interestRateSpread",
    "core_mortgageApprovals",
    "core_ooDebtToIncome",
    "core_priceToIncome",
    "core_rentalYield",
    "household_owning_share",
    "household_renting_share",
    "rpi_mean",
)
SENTINEL_IDS = (
    "household_owning_share",
    "household_renting_share",
    "core_ooDebtToIncome",
    "core_housingTransactions",
    "core_mortgageApprovals",
    "core_advancesToFTB",
)
PRIMARY_METRIC_FIELD = "seedMean"

# Every numeric field derived by the pinned validation scorer is explicitly classified here.
# Numeric source constants and target-band metadata are deliberately not swept as outcomes.
NUMERIC_SCORING_FIELDS = (
    "seedMean",
    "p25",
    "p75",
    "insideRate",
    "lossScale",
    "additiveScale",
    "normalizedDistance",
    "normalizedIqr",
    "distanceComponent",
    "spreadComponent",
    "levelComponent",
    "insideRateComponent",
    "metricLoss",
    "metricWeight",
)
NULLABLE_NUMERIC_SCORING_FIELDS = frozenset({"lossScale", "additiveScale"})
CATEGORICAL_SCORING_FIELDS = (
    "status",
    "lossTransform",
    "lossScaleBasis",
    "additiveScaleBasis",
)
IMMUTABLE_METRIC_FIELDS = (
    "metricId",
    "label",
    "requirement",
    "units",
    "sourceLabel",
    "sourceIndicatorLabel",
    "sourceDocumentPath",
    "sourceTextPath",
    "sourceTable",
    "sourcePage",
    "rawSourceValue",
    "sourceValue",
    "sourceAsOf",
    "sourceUnits",
    "comparisonUnits",
    "mappingStatus",
    "bandMethod",
    "bandNotes",
    "sourceReferences",
    "targetBand",
    "lossFamily",
)
EXPECTED_METRIC_FIELDS = frozenset(
    (*NUMERIC_SCORING_FIELDS, *CATEGORICAL_SCORING_FIELDS, *IMMUTABLE_METRIC_FIELDS)
)
EXPECTED_SUMMARY_FIELDS = frozenset(
    {
        "schemaVersion",
        "version",
        "validationTargetYear",
        "generatedAt",
        "seeds",
        "window",
        "overallCompositeLoss",
        "metrics",
    }
)
IMMUTABLE_SUMMARY_FIELDS = ("schemaVersion", "version", "validationTargetYear", "window")

BOOTSTRAP_SEED = 20260904
BOOTSTRAP_RESAMPLES = 100_000
BOOTSTRAP_QUANTILES = (0.05, 0.95)
TOST_ALPHA = 0.05
CI_COVERAGE = 0.90


@dataclass(frozen=True)
class PhaseSpec:
    name: str
    first_block: int
    last_block: int
    first_seed: int
    last_seed: int
    scorer_status: str

    @property
    def block_ids(self) -> tuple[str, ...]:
        return tuple(f"B{index:02d}" for index in range(self.first_block, self.last_block + 1))

    @property
    def seeds(self) -> tuple[int, ...]:
        return tuple(range(self.first_seed, self.last_seed + 1))


PHASES: Mapping[str, PhaseSpec] = MappingProxyType(
    {
        "discovery": PhaseSpec("discovery", 1, 8, 1, 64, "exploratory"),
        "confirmation": PhaseSpec("confirmation", 21, 28, 161, 224, "confirmation"),
        "confirmation-extension": PhaseSpec(
            "confirmation-extension", 29, 36, 225, 288, "confirmation"
        ),
    }
)

# This is the complete local Python import closure loaded by this analysis and the pinned scorer.
# Verification also rejects newly loaded repository modules that are absent from this declaration.
LOCAL_DEPENDENCY_PATHS = (
    "scripts/__init__.py",
    "scripts/python/__init__.py",
    "scripts/python/experiments/__init__.py",
    "scripts/python/experiments/model/__init__.py",
    "scripts/python/experiments/model/null_control_provenance.py",
    "scripts/python/experiments/model/precision_sweep.py",
    "scripts/python/helpers/__init__.py",
    "scripts/python/helpers/common/__init__.py",
    "scripts/python/helpers/common/abm_policy_sweep.py",
    "scripts/python/helpers/common/cli.py",
    "scripts/python/helpers/was/__init__.py",
    "scripts/python/helpers/was/config.py",
    "scripts/python/helpers/was/constants.py",
    "scripts/python/helpers/was/derived_columns.py",
    "scripts/python/helpers/was/io.py",
    "scripts/python/helpers/was/row_filters.py",
    "scripts/python/validation/__init__.py",
    "scripts/python/validation/model/__init__.py",
    "scripts/python/validation/model/extractors.py",
    "scripts/python/validation/model/hpi.py",
    "scripts/python/validation/model/publish.py",
    "scripts/python/validation/model/runner.py",
    "scripts/python/validation/model/schema.py",
    "scripts/python/validation/model/scoring.py",
    "scripts/python/validation/model/validation_catalog_2011.py",
    "scripts/python/validation/model/validation_catalog_2024.py",
    "scripts/python/validation/model/validation_profiles.py",
)


class AnalysisError(RuntimeError):
    """Fail-closed error for a frozen-analysis contract violation."""


class ReplayEvidenceError(AnalysisError):
    """Replay evidence is absent or violates its sealed interface."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _finite_number(value: object, label: str) -> float:
    if not _is_number(value):
        raise AnalysisError(f"{label} must be numeric and not boolean")
    result = float(value)
    if not math.isfinite(result):
        raise AnalysisError(f"{label} must be finite")
    return result


def _finite_nonnegative(value: object, label: str) -> float:
    result = _finite_number(value, label)
    if result < 0.0:
        raise AnalysisError(f"{label} must be nonnegative")
    return result


def _sha256_file(path: Path) -> str:
    try:
        return sweep.sha256_file(path)
    except RuntimeError as error:
        raise AnalysisError(str(error)) from error


def _read_json(path: Path) -> dict[str, object]:
    try:
        return sweep.read_json(path)
    except RuntimeError as error:
        raise AnalysisError(str(error)) from error


def _strict_seal_digest(seal_path: Path) -> str:
    if seal_path.is_symlink() or not seal_path.is_file():
        raise AnalysisError(f"required seal is absent or not a regular file: {seal_path}")
    payload = seal_path.read_bytes()
    if not re.fullmatch(rb"[0-9a-f]{64}\n", payload):
        raise AnalysisError(f"seal must contain one lowercase SHA-256 digest and newline: {seal_path}")
    return payload[:-1].decode("ascii")


def verify_sealed_file(path: Path, seal_path: Path) -> tuple[bytes, str]:
    if path.is_symlink() or not path.is_file():
        raise AnalysisError(f"required sealed artifact is absent or not a regular file: {path}")
    digest = _strict_seal_digest(seal_path)
    payload = path.read_bytes()
    actual = hashlib.sha256(payload).hexdigest()
    if actual != digest:
        raise AnalysisError(f"sealed artifact hash mismatch: {path}")
    return payload, actual


def _campaign_path(root: Path, relative: str) -> Path:
    pure = PurePosixPath(relative)
    if pure.is_absolute() or not pure.parts or ".." in pure.parts:
        raise AnalysisError(f"unsafe campaign-relative path: {relative!r}")
    path = root.joinpath(*pure.parts)
    try:
        path.resolve(strict=False).relative_to(root.resolve())
    except ValueError as error:
        raise AnalysisError(f"campaign path escapes its root: {relative!r}") from error
    return path


def _repo_path(relative: str) -> Path:
    pure = PurePosixPath(relative)
    if pure.is_absolute() or not pure.parts or ".." in pure.parts:
        raise AnalysisError(f"unsafe repository-relative path: {relative!r}")
    path = REPO_ROOT.joinpath(*pure.parts)
    try:
        path.resolve(strict=False).relative_to(REPO_ROOT)
    except ValueError as error:
        raise AnalysisError(f"repository path escapes its root: {relative!r}") from error
    return path


def _write_new_or_identical(path: Path, payload: bytes) -> str:
    if path.exists():
        if path.is_symlink() or not path.is_file():
            raise AnalysisError(f"existing artifact is not a regular file: {path}")
        if path.read_bytes() != payload:
            raise AnalysisError(f"existing immutable artifact differs; refusing overwrite: {path}")
        return "reused"
    try:
        sweep.write_new(path, payload)
    except RuntimeError as error:
        raise AnalysisError(str(error)) from error
    return "created"


def _loaded_local_dependency_paths() -> tuple[str, ...]:
    found: set[str] = set()
    for module in tuple(sys.modules.values()):
        raw_path = getattr(module, "__file__", None)
        if not raw_path:
            continue
        try:
            path = Path(raw_path).resolve()
            relative = path.relative_to(REPO_ROOT).as_posix()
        except (OSError, ValueError):
            continue
        if path.suffix == ".py" and relative not in {ANALYSIS_PROGRAM_PATH, ANALYSIS_TEST_PATH}:
            found.add(relative)
    return tuple(sorted(found))


def verify_declared_dependency_closure() -> None:
    observed = set(_loaded_local_dependency_paths())
    declared = set(LOCAL_DEPENDENCY_PATHS)
    if observed != declared:
        raise AnalysisError(
            "local dependency closure changed: "
            f"missing={sorted(declared - observed)} extra={sorted(observed - declared)}"
        )


def _relocation_destination(record: Mapping[str, object]) -> Path:
    for key in ("canonicalRoot", "destinationRoot", "destination"):
        value = record.get(key)
        if isinstance(value, str) and value:
            return Path(value).expanduser().resolve()
    raise AnalysisError("relocation seal does not name a canonical destination root")


def resolve_canonical_campaign_root(requested: Path) -> Path:
    requested = requested.expanduser().resolve()
    known_existing = [root.resolve() for root in (REPOSITORY_CAMPAIGN_ROOT, DURABLE_CAMPAIGN_ROOT) if root.is_dir()]
    relocation_records: list[tuple[Path, dict[str, object]]] = []
    for root in known_existing:
        relocation_json = root / "seals" / "relocation.json"
        relocation_seal = root / "seals" / "relocation.sha256"
        if relocation_json.exists() or relocation_seal.exists():
            payload, _ = verify_sealed_file(relocation_json, relocation_seal)
            try:
                record = json.loads(payload)
            except json.JSONDecodeError as error:
                raise AnalysisError(f"invalid relocation JSON: {relocation_json}") from error
            if not isinstance(record, dict):
                raise AnalysisError(f"relocation artifact is not an object: {relocation_json}")
            relocation_records.append((root, record))
    if relocation_records:
        destinations = {_relocation_destination(record) for _, record in relocation_records}
        if len(destinations) != 1:
            raise AnalysisError("canonical campaign ownership is ambiguous across relocation seals")
        destination = destinations.pop()
        if not destination.is_dir() or requested != destination:
            raise AnalysisError(f"sealed relocation designates canonical root {destination}")
        return destination
    if len(known_existing) > 1:
        raise AnalysisError("duplicate campaign trees exist without a valid relocation seal")
    if known_existing and requested != known_existing[0]:
        raise AnalysisError(f"canonical campaign root is {known_existing[0]}")
    if not requested.is_dir():
        raise AnalysisError(f"campaign root is absent: {requested}")
    return requested


def _exact_keys(value: Mapping[str, object], expected: frozenset[str], label: str) -> None:
    actual = frozenset(value)
    if actual != expected:
        unknown_numeric = sorted(
            key for key in actual - expected if _is_number(value.get(key))
        )
        suffix = f"; unclassified numeric fields={unknown_numeric}" if unknown_numeric else ""
        raise AnalysisError(
            f"{label} schema differs: missing={sorted(expected - actual)} "
            f"extra={sorted(actual - expected)}{suffix}"
        )


def _metric_map(summary: Mapping[str, object], label: str) -> dict[str, Mapping[str, object]]:
    rows = summary.get("metrics")
    if not isinstance(rows, list):
        raise AnalysisError(f"{label}.metrics must be a list")
    result: dict[str, Mapping[str, object]] = {}
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise AnalysisError(f"{label}.metrics[{index}] must be an object")
        metric_id = row.get("metricId")
        if not isinstance(metric_id, str):
            raise AnalysisError(f"{label}.metrics[{index}].metricId must be a string")
        if metric_id in result:
            raise AnalysisError(f"{label} contains duplicate metric {metric_id}")
        result[metric_id] = row
    if set(result) != set(METRIC_IDS) or len(rows) != len(METRIC_IDS):
        raise AnalysisError(
            f"{label} metric registry differs: missing={sorted(set(METRIC_IDS) - set(result))} "
            f"extra={sorted(set(result) - set(METRIC_IDS))}"
        )
    return result


def validate_summary_schema(
    summary: Mapping[str, object], *, expected_seeds: Sequence[int], label: str
) -> tuple[dict[str, Mapping[str, object]], float]:
    _exact_keys(summary, EXPECTED_SUMMARY_FIELDS, label)
    if summary.get("version") != "v5o3":
        raise AnalysisError(f"{label}.version is not v5o3")
    if summary.get("seeds") != list(expected_seeds):
        raise AnalysisError(f"{label}.seeds do not match the frozen block")
    window = summary.get("window")
    if window != {"startIndex": 200, "endIndex": 2000}:
        raise AnalysisError(f"{label}.window differs from [200,2000)")
    if not isinstance(summary.get("generatedAt"), str) or not summary["generatedAt"]:
        raise AnalysisError(f"{label}.generatedAt must be a nonempty string")
    metric_by_id = _metric_map(summary, label)
    for metric_id, metric in metric_by_id.items():
        _exact_keys(metric, EXPECTED_METRIC_FIELDS, f"{label}.{metric_id}")
        if not isinstance(metric.get("comparisonUnits"), str) or not metric["comparisonUnits"]:
            raise AnalysisError(f"{label}.{metric_id}.comparisonUnits must be nonempty")
        target_band = metric.get("targetBand")
        if not isinstance(target_band, dict) or set(target_band) != {"lower", "upper"}:
            raise AnalysisError(f"{label}.{metric_id}.targetBand schema differs")
        lower = _finite_number(target_band.get("lower"), f"{label}.{metric_id}.targetBand.lower")
        upper = _finite_number(target_band.get("upper"), f"{label}.{metric_id}.targetBand.upper")
        if not lower < upper:
            raise AnalysisError(f"{label}.{metric_id}.targetBand must have lower < upper")
        for field in NUMERIC_SCORING_FIELDS:
            value = metric.get(field)
            if value is None and field in NULLABLE_NUMERIC_SCORING_FIELDS:
                continue
            _finite_number(value, f"{label}.{metric_id}.{field}")
        for field in CATEGORICAL_SCORING_FIELDS:
            if not isinstance(metric.get(field), str) or not metric[field]:
                raise AnalysisError(f"{label}.{metric_id}.{field} must be a nonempty string")
        if _finite_number(metric["metricWeight"], f"{label}.{metric_id}.metricWeight") != 1.0:
            raise AnalysisError(f"{label}.{metric_id}.metricWeight must remain exactly 1.0")
    ordered_rows = summary["metrics"]
    recomputed = compute_overall_composite_loss(
        metric_losses=[_finite_number(row["metricLoss"], f"{label}.metricLoss") for row in ordered_rows],
        metric_weights=[_finite_number(row["metricWeight"], f"{label}.metricWeight") for row in ordered_rows],
    )
    recorded = _finite_number(summary.get("overallCompositeLoss"), f"{label}.overallCompositeLoss")
    if recomputed != recorded:
        raise AnalysisError(
            f"{label}.overallCompositeLoss does not recompute from metricLoss/metricWeight"
        )
    return metric_by_id, recorded


def compare_summaries(
    candidate: Mapping[str, object],
    reference: Mapping[str, object],
    *,
    expected_seeds: Sequence[int],
    label: str,
) -> dict[str, object]:
    candidate_metrics, candidate_composite = validate_summary_schema(
        candidate, expected_seeds=expected_seeds, label=f"{label}.candidate"
    )
    reference_metrics, reference_composite = validate_summary_schema(
        reference, expected_seeds=expected_seeds, label=f"{label}.reference"
    )
    if [row["metricId"] for row in candidate["metrics"]] != [
        row["metricId"] for row in reference["metrics"]
    ]:
        raise AnalysisError(f"{label} candidate metric rows are reordered relative to H64")
    for field in IMMUTABLE_SUMMARY_FIELDS:
        if candidate.get(field) != reference.get(field):
            raise AnalysisError(f"{label} immutable summary field differs: {field}")

    metric_differences: list[dict[str, object]] = []
    all_numeric_zero = True
    status_changes: list[dict[str, object]] = []
    for metric_id in METRIC_IDS:
        candidate_metric = candidate_metrics[metric_id]
        reference_metric = reference_metrics[metric_id]
        for field in IMMUTABLE_METRIC_FIELDS:
            if candidate_metric.get(field) != reference_metric.get(field):
                raise AnalysisError(
                    f"{label}.{metric_id} immutable scoring metadata differs: {field}"
                )
        if candidate_metric.get("metricWeight") != reference_metric.get("metricWeight"):
            raise AnalysisError(f"{label}.{metric_id}.metricWeight differs")
        ingredients: dict[str, object] = {}
        for field in NUMERIC_SCORING_FIELDS:
            candidate_value = candidate_metric.get(field)
            reference_value = reference_metric.get(field)
            if candidate_value is None or reference_value is None:
                if field not in NULLABLE_NUMERIC_SCORING_FIELDS:
                    raise AnalysisError(f"{label}.{metric_id}.{field} unexpectedly null")
                difference: float | None = None
                if (candidate_value is None) != (reference_value is None):
                    all_numeric_zero = False
            else:
                candidate_number = _finite_number(
                    candidate_value, f"{label}.{metric_id}.candidate.{field}"
                )
                reference_number = _finite_number(
                    reference_value, f"{label}.{metric_id}.reference.{field}"
                )
                difference = candidate_number - reference_number
                if difference != 0.0:
                    all_numeric_zero = False
            ingredients[field] = {
                "reference": reference_value,
                "candidate": candidate_value,
                "difference": difference,
            }
        categorical: dict[str, object] = {}
        for field in CATEGORICAL_SCORING_FIELDS:
            reference_value = reference_metric.get(field)
            candidate_value = candidate_metric.get(field)
            changed = candidate_value != reference_value
            categorical[field] = {
                "reference": reference_value,
                "candidate": candidate_value,
                "changed": changed,
            }
            if field == "status" and changed:
                status_changes.append(
                    {
                        "metricId": metric_id,
                        "reference": reference_value,
                        "candidate": candidate_value,
                    }
                )
        metric_differences.append(
            {
                "metricId": metric_id,
                "comparisonUnits": reference_metric["comparisonUnits"],
                "ingredients": ingredients,
                "categorical": categorical,
            }
        )
    composite_difference = candidate_composite - reference_composite
    return {
        "referenceCompositeLoss": reference_composite,
        "candidateCompositeLoss": candidate_composite,
        "pairedCompositeDifference": composite_difference,
        "metrics": metric_differences,
        "statusChanges": status_changes,
        "allNumericScoringDifferencesExactlyZero": all_numeric_zero,
    }


def _tost_values(mean: float, margin: float, standard_error: float, df: int) -> dict[str, float]:
    if standard_error == 0.0:
        lower_position = mean + margin
        upper_position = mean - margin
        t_lower = math.inf if lower_position > 0.0 else (-math.inf if lower_position < 0.0 else 0.0)
        p_lower = 0.0 if lower_position > 0.0 else (1.0 if lower_position < 0.0 else 0.5)
        t_upper = math.inf if upper_position > 0.0 else (-math.inf if upper_position < 0.0 else 0.0)
        p_upper = 0.0 if upper_position < 0.0 else (1.0 if upper_position > 0.0 else 0.5)
        return {
            "tLower": t_lower,
            "pLower": p_lower,
            "tUpper": t_upper,
            "pUpper": p_upper,
        }
    t_lower = (mean + margin) / standard_error
    t_upper = (mean - margin) / standard_error
    return {
        "tLower": t_lower,
        "pLower": 1.0 - float(stats.t.cdf(t_lower, df)),
        "tUpper": t_upper,
        "pUpper": float(stats.t.cdf(t_upper, df)),
    }


def endpoint_inference(values: Sequence[object], margin: object) -> dict[str, object]:
    numeric_values = [_finite_number(value, f"endpoint[{index}]") for index, value in enumerate(values)]
    numeric_margin = _finite_nonnegative(margin, "margin")
    if not numeric_values:
        raise AnalysisError("an endpoint needs at least one paired block")
    mean = math.fsum(numeric_values) / len(numeric_values)
    base: dict[str, object] = {
        "n": len(numeric_values),
        "values": numeric_values,
        "margin": numeric_margin,
        "mean": mean,
        "alpha": TOST_ALPHA,
        "confidenceLevel": CI_COVERAGE,
    }
    if len(numeric_values) < 2:
        base.update(
            {
                "sampleSD": None,
                "standardError": None,
                "degreesOfFreedom": None,
                "tCritical": None,
                "ci90": {"lower": None, "upper": None},
                "tost": None,
                "rule": "insufficient-n",
                "inferenceStatus": "control-only",
                "classification": "insufficient",
            }
        )
        return base
    sample_sd = math.sqrt(
        math.fsum((value - mean) ** 2 for value in numeric_values) / (len(numeric_values) - 1)
    )
    standard_error = sample_sd / math.sqrt(len(numeric_values))
    df = len(numeric_values) - 1
    t_critical = float(stats.t.ppf(0.95, df))
    half_width = t_critical * standard_error
    lower = mean - half_width
    upper = mean + half_width
    base.update(
        {
            "sampleSD": sample_sd,
            "standardError": standard_error,
            "degreesOfFreedom": df,
            "tCritical": t_critical,
            "ci90": {"lower": lower, "upper": upper},
            "inferenceStatus": "estimated",
        }
    )
    if numeric_margin == 0.0:
        base.update(
            {
                "tost": None,
                "rule": "zero-margin-exact-equality",
                "classification": (
                    "pass" if all(value == 0.0 for value in numeric_values) else "fail"
                ),
            }
        )
        return base
    tost = _tost_values(mean, numeric_margin, standard_error, df)
    if mean <= -numeric_margin or mean >= numeric_margin:
        classification = "fail"
    elif lower > -numeric_margin and upper < numeric_margin:
        if not (tost["pLower"] < TOST_ALPHA and tost["pUpper"] < TOST_ALPHA):
            raise AnalysisError("TOST p-values disagree with the strict 90% interval rule")
        classification = "pass"
    else:
        classification = "inconclusive"
    base.update({"tost": tost, "rule": "ordinary-strict-tost", "classification": classification})
    return base


def linear_percentile(sorted_values: Sequence[object], probability: object) -> float:
    values = [_finite_number(value, f"percentile[{index}]") for index, value in enumerate(sorted_values)]
    if not values:
        raise AnalysisError("percentile requires at least one value")
    if values != sorted(values):
        raise AnalysisError("percentile values must already be sorted")
    p = _finite_number(probability, "percentile probability")
    if p < 0.0 or p > 1.0:
        raise AnalysisError("percentile probability must be in [0,1]")
    h = (len(values) - 1) * p
    lower_index = math.floor(h)
    upper_index = math.ceil(h)
    if lower_index == upper_index:
        return values[lower_index]
    fraction = h - lower_index
    return values[lower_index] + fraction * (values[upper_index] - values[lower_index])


def bootstrap_index_tuples(
    n: int, *, resamples: int = BOOTSTRAP_RESAMPLES, seed: int = BOOTSTRAP_SEED
) -> tuple[tuple[int, ...], ...]:
    if isinstance(n, bool) or not isinstance(n, int) or n <= 0:
        raise AnalysisError("bootstrap n must be a positive integer")
    if isinstance(resamples, bool) or not isinstance(resamples, int) or resamples <= 0:
        raise AnalysisError("bootstrap resamples must be a positive integer")
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise AnalysisError("bootstrap seed must be an integer")
    generator = random.Random(seed)
    return tuple(tuple(generator.randrange(n) for _ in range(n)) for _ in range(resamples))


def bootstrap_intervals(
    series: Mapping[str, Sequence[object]], indices: Sequence[Sequence[int]]
) -> dict[str, dict[str, object]]:
    if not series:
        raise AnalysisError("bootstrap needs at least one endpoint series")
    lengths = {len(values) for values in series.values()}
    if len(lengths) != 1 or not lengths or next(iter(lengths)) <= 0:
        raise AnalysisError("bootstrap endpoint series must share a positive block count")
    n = next(iter(lengths))
    numeric = {
        key: [_finite_number(value, f"bootstrap.{key}[{index}]") for index, value in enumerate(values)]
        for key, values in series.items()
    }
    means: dict[str, list[float]] = {key: [] for key in series}
    for draw_number, draw in enumerate(indices):
        if len(draw) != n or any(
            isinstance(index, bool) or not isinstance(index, int) or index < 0 or index >= n
            for index in draw
        ):
            raise AnalysisError(f"invalid whole-block bootstrap draw at index {draw_number}")
        for key, values in numeric.items():
            means[key].append(math.fsum(values[index] for index in draw) / n)
    return {
        key: {
            "lower": linear_percentile(sorted(values), BOOTSTRAP_QUANTILES[0]),
            "upper": linear_percentile(sorted(values), BOOTSTRAP_QUANTILES[1]),
            "resamples": len(indices),
        }
        for key, values in means.items()
    }


def aggregate_statistical_classification(endpoints: Mapping[str, Mapping[str, object]]) -> str:
    classifications = [endpoint.get("classification") for endpoint in endpoints.values()]
    if not classifications:
        raise AnalysisError("no primary endpoints were supplied")
    if any(value == "fail" for value in classifications):
        return "fail"
    if any(value == "insufficient" for value in classifications):
        return "insufficient"
    if any(value == "inconclusive" for value in classifications):
        return "inconclusive"
    if all(value == "pass" for value in classifications):
        return "pass"
    raise AnalysisError(f"unknown endpoint classification: {classifications}")


def nested_discovery_selection(decisions: Mapping[str, str]) -> dict[str, object]:
    if set(decisions) != set(DISCOVERY_CANDIDATES):
        return {
            "status": "incomplete",
            "recommendedArm": None,
            "reason": "complete-three-arm-grid-required",
        }
    values = [decisions[arm] for arm in DISCOVERY_CANDIDATES]
    if any(value in {"not_eligible", "insufficient"} for value in values):
        return {
            "status": "unavailable",
            "recommendedArm": None,
            "reason": "missing-eligibility-or-sufficient-blocks",
        }
    for index, value in enumerate(values):
        if value == "pass" and any(
            safer in {"fail", "inconclusive"} for safer in values[:index]
        ):
            return {
                "status": "non_monotone",
                "recommendedArm": None,
                "reason": "lower-precision-pass-after-safer-fail-or-inconclusive",
            }
    if values == ["pass", "pass", "pass"]:
        selected = "HQ32"
    elif values[0:2] == ["pass", "pass"]:
        selected = "HQ40"
    elif values[0] == "pass":
        selected = "HQ51"
    else:
        selected = None
    return {
        "status": "selected" if selected else "none",
        "recommendedArm": selected,
        "reason": "nested-safer-to-lower-rule",
    }


def _phase_block_map(campaign: Mapping[str, object], phase: PhaseSpec) -> dict[str, list[int]]:
    fixed = campaign.get("fixedBlocks")
    if not isinstance(fixed, dict):
        raise AnalysisError("campaign.fixedBlocks must be an object")
    result: dict[str, list[int]] = {}
    for block_id in phase.block_ids:
        block_number = int(block_id[1:])
        expected = list(range(1 + (block_number - 1) * 8, 1 + block_number * 8))
        if fixed.get(block_id) != expected:
            raise AnalysisError(f"campaign block map differs for {block_id}")
        result[block_id] = expected
    return result


def audit_pre_freeze_blocks(campaign_root: Path) -> None:
    blocks_root = campaign_root / "blocks"
    if blocks_root.is_symlink() or not blocks_root.is_dir():
        raise AnalysisError(f"campaign blocks directory is absent or unsafe: {blocks_root}")
    allowed = (campaign_root / CONTROL_SCORE_JSON).resolve()
    for path in sorted(blocks_root.iterdir()):
        if path.is_symlink() or not path.is_file():
            raise AnalysisError(f"unexpected blocks entry before freeze: {path}")
        if path.resolve() != allowed:
            raise AnalysisError(f"non-no-op candidate score exists before analysis freeze: {path}")


def verify_campaign_base(campaign_root: Path, *, require_pinned_hashes: bool = True) -> dict[str, object]:
    campaign_payload, campaign_sha = verify_sealed_file(
        campaign_root / CAMPAIGN_JSON, campaign_root / CAMPAIGN_SEAL
    )
    try:
        campaign = json.loads(campaign_payload)
    except json.JSONDecodeError as error:
        raise AnalysisError("campaign.json is invalid JSON") from error
    if not isinstance(campaign, dict):
        raise AnalysisError("campaign.json must contain an object")
    current_source = sweep.fingerprint_files(sweep.collect_files(sweep.SOURCE_ENTRIES))
    if campaign.get("source") != current_source:
        raise AnalysisError("complete live campaign source fingerprint differs from campaign.json")
    source_sha = current_source.get("sha256")
    if not isinstance(source_sha, str):
        raise AnalysisError("campaign source fingerprint has no SHA-256")
    protocol = campaign.get("protocol")
    expected_protocol = {
        "version": "v5o3",
        "population": 10000,
        "steps": 2000,
        "simulationsPerSeed": 1,
        "scoringWindow": [200, 2000],
        "validationMetricCount": 17,
        "orderBook": FRONTIER,
        "rngMode": SUBSTRATE,
        "frontier": "legacy",
        "precisionFieldSet": RUNTIME_FIELD_SET,
    }
    if not isinstance(protocol, dict):
        raise AnalysisError("campaign.protocol must be an object")
    for key, expected in expected_protocol.items():
        if protocol.get(key) != expected:
            raise AnalysisError(
                f"campaign protocol mismatch for {key}: expected={expected!r} observed={protocol.get(key)!r}"
            )
    for phase in PHASES.values():
        _phase_block_map(campaign, phase)

    margins_payload, margins_sha = verify_sealed_file(
        campaign_root / MARGINS_JSON, campaign_root / MARGINS_SEAL
    )
    reference_payload, reference_sha = verify_sealed_file(
        campaign_root / REFERENCE_JSON, campaign_root / REFERENCE_SEAL
    )
    try:
        margins = json.loads(margins_payload)
        reference = json.loads(reference_payload)
    except json.JSONDecodeError as error:
        raise AnalysisError("margins/reference JSON is invalid") from error
    if not isinstance(margins, dict) or not isinstance(reference, dict):
        raise AnalysisError("margins/reference artifacts must contain objects")
    if margins.get("campaignSha256") != campaign_sha or reference.get("campaignSha256") != campaign_sha:
        raise AnalysisError("margins/reference belongs to a different campaign")
    if margins.get("referenceSha256") != reference_sha:
        raise AnalysisError("margins reference hash does not match the sealed reference distribution")
    raw_margins = margins.get("rawMetricMargins")
    if not isinstance(raw_margins, dict) or set(raw_margins) != set(METRIC_IDS):
        raise AnalysisError("margins must contain exactly the frozen 17 metric IDs")
    _finite_nonnegative(margins.get("compositeMargin"), "composite margin")
    for metric_id in METRIC_IDS:
        _finite_nonnegative(raw_margins.get(metric_id), f"margin.{metric_id}")
    blocks = reference.get("blocks")
    if not isinstance(blocks, list) or len(blocks) != 20:
        raise AnalysisError("reference distribution must contain exactly B01-B20")
    for index, block in enumerate(blocks, start=1):
        block_id = f"B{index:02d}"
        seeds = list(range(1 + (index - 1) * 8, 1 + index * 8))
        if not isinstance(block, dict):
            raise AnalysisError(f"reference {block_id} must be an object")
        if block.get("arm") != REFERENCE_ARM or block.get("blockId") != block_id or block.get("seeds") != seeds:
            raise AnalysisError(f"reference distribution identity differs for {block_id}")
        summary = block.get("summary")
        if not isinstance(summary, dict):
            raise AnalysisError(f"reference {block_id} has no summary")
        validate_summary_schema(summary, expected_seeds=seeds, label=f"reference.{block_id}")
    if require_pinned_hashes:
        expected = {
            "campaign": (campaign_sha, EXPECTED_CAMPAIGN_SHA256),
            "campaign source": (source_sha, EXPECTED_CAMPAIGN_SOURCE_SHA256),
            "margins": (margins_sha, EXPECTED_MARGINS_SHA256),
            "reference": (reference_sha, EXPECTED_REFERENCE_SHA256),
        }
        for label, (observed, pinned) in expected.items():
            if observed != pinned:
                raise AnalysisError(f"{label} SHA-256 differs from the active frozen campaign")
    return {
        "root": campaign_root,
        "campaign": campaign,
        "campaignSha256": campaign_sha,
        "campaignSourceSha256": source_sha,
        "margins": margins,
        "marginsSha256": margins_sha,
        "reference": reference,
        "referenceSha256": reference_sha,
    }


def _reference_blocks(reference: Mapping[str, object]) -> dict[str, Mapping[str, object]]:
    return {str(block["blockId"]): block for block in reference["blocks"]}


def _verify_stored_composites(
    row: Mapping[str, object], comparison: Mapping[str, object], label: str
) -> None:
    checks = {
        "referenceCompositeLoss": comparison["referenceCompositeLoss"],
        "candidateCompositeLoss": comparison["candidateCompositeLoss"],
        "pairedCompositeDifference": comparison["pairedCompositeDifference"],
    }
    for field, recomputed in checks.items():
        recorded = _finite_number(row.get(field), f"{label}.{field}")
        if recorded != recomputed:
            raise AnalysisError(f"{label}.{field} does not match the recomputed value")


def _run_identity_findings(
    record: Mapping[str, object], *, arm: str, seed: int, campaign: Mapping[str, object]
) -> list[str]:
    findings: list[str] = []
    arm_spec = sweep.ARM_REGISTRY[arm]
    protocol = campaign["protocol"]
    expected_request = {
        "version": "v5o3",
        "steps": protocol["steps"],
        "population": protocol["population"],
        "orderBook": FRONTIER,
        "rngMode": SUBSTRATE,
        "precision": arm_spec.mode,
        "mantissaBits": arm_spec.mantissa_bits,
        "precisionFieldSet": RUNTIME_FIELD_SET,
        "precisionDiagnostics": True,
        "precisionGateTrace": False,
        "precisionProbe": "off",
    }
    if record.get("request") != expected_request:
        findings.append("run-request-identity-mismatch")
    metadata = record.get("observedMetadata")
    if not isinstance(metadata, dict):
        findings.append("observed-runtime-metadata-missing")
    else:
        rng = metadata.get("rng")
        model = metadata.get("model")
        precision = metadata.get("precision")
        expected_metadata = {
            "rngMode": SUBSTRATE,
            "rngAddressVersion": "1",
            "masterSeed": str(seed),
        }
        if not isinstance(rng, dict) or any(rng.get(k) != v for k, v in expected_metadata.items()):
            findings.append("rng-runtime-identity-mismatch")
        if not isinstance(model, dict) or model.get("orderBook") != FRONTIER:
            findings.append("frontier-runtime-identity-mismatch")
        if (
            not isinstance(precision, dict)
            or precision.get("precision") != arm_spec.mode
            or precision.get("mantissaBits") != str(arm_spec.mantissa_bits)
            or precision.get("fieldSet") != RUNTIME_FIELD_SET
            or precision.get("diagnostics") != "true"
        ):
            findings.append("precision-runtime-identity-mismatch")
    if record.get("status") != "complete" or record.get("exitCode") != 0:
        findings.append("run-not-complete-success")
    return findings


def verify_run_evidence(
    campaign_root: Path,
    *,
    campaign: Mapping[str, object],
    campaign_sha: str,
    arm: str,
    seed: int,
) -> dict[str, object]:
    seed_root = campaign_root / "arms" / arm / "seeds" / f"seed-{seed:06d}"
    try:
        record = sweep.verify_run_record(
            seed_root, campaign_sha=campaign_sha, arm=sweep.ARM_REGISTRY[arm], seed=seed
        )
    except (OSError, RuntimeError, ValueError) as error:
        return {
            "arm": arm,
            "seed": seed,
            "status": "failed",
            "reasonCodes": ["run-sidecar-or-output-hash-verification-failed"],
            "detail": str(error),
        }
    reasons = _run_identity_findings(record, arm=arm, seed=seed, campaign=campaign)
    config = record.get("config")
    if not isinstance(config, dict) or not isinstance(config.get("path"), str) or not isinstance(config.get("sha256"), str):
        reasons.append("config-provenance-missing")
    else:
        try:
            config_path = _campaign_path(campaign_root, config["path"])
            if _sha256_file(config_path) != config["sha256"]:
                reasons.append("config-hash-mismatch")
        except (AnalysisError, OSError):
            reasons.append("config-hash-verification-failed")
    writes = record.get("precisionWrites")
    write_summary: dict[str, dict[str, int]] = {}
    if not isinstance(writes, dict) or set(writes) != set(sweep.EXPECTED_PRECISION_FIELDS):
        reasons.append("precision-write-field-registry-mismatch")
    else:
        for field in sweep.EXPECTED_PRECISION_FIELDS:
            row = writes.get(field)
            if not isinstance(row, dict):
                reasons.append(f"precision-write-row-missing:{field}")
                continue
            attempted = row.get("writes")
            changed = row.get("changedWrites")
            if (
                isinstance(attempted, bool)
                or not isinstance(attempted, int)
                or attempted <= 0
            ):
                reasons.append(f"nonpositive-attempted-writes:{field}")
            if isinstance(changed, bool) or not isinstance(changed, int) or changed < 0:
                reasons.append(f"invalid-changed-writes:{field}")
            if isinstance(attempted, int) and not isinstance(attempted, bool) and isinstance(changed, int) and not isinstance(changed, bool):
                write_summary[field] = {"attemptedWrites": attempted, "changedWrites": changed}
    failure_root = campaign_root / "failures" / arm / f"seed-{seed:06d}"
    if failure_root.exists():
        reasons.append("conflicting-failure-artifact")
    log_finding = "no-recorded-nonfinite-abort-or-invariant-event"
    raw_log = record.get("log")
    if not isinstance(raw_log, str):
        reasons.append("run-log-reference-missing")
        log_finding = "log-reference-missing"
    else:
        try:
            log_path = _campaign_path(campaign_root, raw_log)
            if log_path.is_symlink() or not log_path.is_file():
                reasons.append("run-log-missing")
                log_finding = "log-missing"
            else:
                lowered = log_path.read_text(encoding="utf-8", errors="replace").lower()
                markers = (
                    "invalid-model-invariant",
                    "invalid-nonfinite",
                    "nan detected",
                    "infinity detected",
                    "nonfinite",
                    "aborted",
                )
                if any(marker in lowered for marker in markers):
                    reasons.append("recorded-invalid-nonfinite-or-abort-event")
                    log_finding = "recorded-invalid-nonfinite-or-abort-event"
        except (AnalysisError, OSError):
            reasons.append("run-log-read-failed")
            log_finding = "log-read-failed"
    return {
        "arm": arm,
        "seed": seed,
        "status": "verified" if not reasons else "failed",
        "reasonCodes": reasons,
        "runSidecarPath": (seed_root / sweep.RUN_FILE).relative_to(campaign_root).as_posix(),
        "runSidecarSha256": _sha256_file(seed_root / sweep.RUN_FILE),
        "scientificTreeSha256": record.get("scientificTreeSha256"),
        "wallSeconds": record.get("wallSeconds"),
        "outputBytes": record.get("outputBytes"),
        "precisionWrites": write_summary,
        "logEvidence": log_finding,
        "claimLimit": "no recorded nonfinite, abort, or invariant event; not an exhaustive proof",
    }


def build_control_report(campaign_root: Path) -> dict[str, object]:
    base = verify_campaign_base(campaign_root)
    audit_pre_freeze_blocks(campaign_root)
    score_path = campaign_root / CONTROL_SCORE_JSON
    if _sha256_file(score_path) != EXPECTED_HQ52_SCORE_SHA256:
        raise AnalysisError("HQ52 B01 score hash differs from the pinned no-op control")
    score = _read_json(score_path)
    expected_score_keys = frozenset(
        {"schemaVersion", "artifactType", "campaignSha256", "marginsSha256", "status", "rows"}
    )
    _exact_keys(score, expected_score_keys, "HQ52 score")
    if (
        score.get("schemaVersion") != 1
        or score.get("artifactType") != "precision-candidate-block-scores"
        or score.get("campaignSha256") != base["campaignSha256"]
        or score.get("marginsSha256") != base["marginsSha256"]
        or score.get("status") != "exploratory"
    ):
        raise AnalysisError("HQ52 B01 score identity differs")
    rows = score.get("rows")
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        raise AnalysisError("HQ52 score must contain exactly one row")
    row = rows[0]
    expected_row_keys = frozenset(
        {
            "arm",
            "blockId",
            "seeds",
            "referenceCompositeLoss",
            "candidateCompositeLoss",
            "pairedCompositeDifference",
            "candidateSummary",
        }
    )
    _exact_keys(row, expected_row_keys, "HQ52 row")
    seeds = list(range(1, 9))
    if row.get("arm") != NOOP_CONTROL_ARM or row.get("blockId") != "B01" or row.get("seeds") != seeds:
        raise AnalysisError("HQ52 control accepts exactly HQ52 B01 seeds 1-8")
    candidate_summary = row.get("candidateSummary")
    if not isinstance(candidate_summary, dict):
        raise AnalysisError("HQ52 control row has no candidateSummary")
    reference_block = _reference_blocks(base["reference"])["B01"]
    comparison = compare_summaries(
        candidate_summary,
        reference_block["summary"],
        expected_seeds=seeds,
        label="HQ52.B01",
    )
    _verify_stored_composites(row, comparison, "HQ52.B01")
    if comparison["referenceCompositeLoss"] != EXPECTED_HQ52_COMPOSITE:
        raise AnalysisError("H64 B01 composite differs from the pinned control value")
    if comparison["candidateCompositeLoss"] != EXPECTED_HQ52_COMPOSITE:
        raise AnalysisError("HQ52 B01 composite differs from the pinned control value")
    if comparison["pairedCompositeDifference"] != 0.0:
        raise AnalysisError("HQ52 composite difference is not exactly zero")
    metric_rows = {row["metricId"]: row for row in comparison["metrics"]}
    sentinel_differences = {
        metric_id: metric_rows[metric_id]["ingredients"][PRIMARY_METRIC_FIELD]["difference"]
        for metric_id in SENTINEL_IDS
    }
    if any(value != 0.0 for value in sentinel_differences.values()):
        raise AnalysisError("HQ52 sentinel seedMean difference is not exactly zero")
    if not comparison["allNumericScoringDifferencesExactlyZero"] or comparison["statusChanges"]:
        raise AnalysisError("HQ52 and H64 do not agree across all 17 scoring summaries")

    per_run: list[dict[str, object]] = []
    for arm in (REFERENCE_ARM, NOOP_CONTROL_ARM):
        for seed in seeds:
            evidence = verify_run_evidence(
                campaign_root,
                campaign=base["campaign"],
                campaign_sha=base["campaignSha256"],
                arm=arm,
                seed=seed,
            )
            if evidence["status"] != "verified":
                raise AnalysisError(
                    f"HQ52 control provenance failed for {arm} seed {seed}: {evidence['reasonCodes']}"
                )
            per_run.append(evidence)
    inference = endpoint_inference(
        [comparison["pairedCompositeDifference"]], base["margins"]["compositeMargin"]
    )
    if inference["classification"] != "insufficient" or inference["inferenceStatus"] != "control-only":
        raise AnalysisError("one-block HQ52 control was incorrectly treated as statistical inference")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "artifactType": CONTROL_ARTIFACT_TYPE,
        "campaign": {
            "campaignJson": CAMPAIGN_JSON,
            "campaignSha256": base["campaignSha256"],
            "campaignSourceSha256": base["campaignSourceSha256"],
            "marginsJson": MARGINS_JSON,
            "marginsSha256": base["marginsSha256"],
            "referenceJson": REFERENCE_JSON,
            "referenceSha256": base["referenceSha256"],
        },
        "analysisProgram": {
            "path": ANALYSIS_PROGRAM_PATH,
            "sha256": _sha256_file(_repo_path(ANALYSIS_PROGRAM_PATH)),
        },
        "sources": {
            "hq52BlockScore": {
                "path": CONTROL_SCORE_JSON,
                "sha256": EXPECTED_HQ52_SCORE_SHA256,
            },
            "h64ReferenceBlock": {
                "path": REFERENCE_JSON,
                "sha256": base["referenceSha256"],
                "blockId": "B01",
            },
        },
        "control": {
            "arm": NOOP_CONTROL_ARM,
            "referenceArm": REFERENCE_ARM,
            "blockId": "B01",
            "seeds": seeds,
            "comparison": comparison,
            "sentinelSeedMeanDifferences": sentinel_differences,
            "inference": inference,
            "perRunVerification": per_run,
        },
        "assertions": {
            "compositeDifferenceExactlyZero": True,
            "allSixSentinelSeedMeanDifferencesExactlyZero": True,
            "allSeventeenMetricScoringSummariesAgree": True,
            "oneBlockIsControlOnlyAndInsufficientForInference": True,
            "noNonNoopCandidateScoreReadOrCreated": True,
        },
    }


def preflight_control(campaign_root: Path) -> tuple[str, dict[str, object]]:
    root = resolve_canonical_campaign_root(campaign_root)
    report = build_control_report(root)
    state = _write_new_or_identical(root / CONTROL_REPORT_JSON, sweep.canonical_json(report))
    return state, report


def load_candidate_score_rows(
    paths: Sequence[Path],
    *,
    phase: PhaseSpec,
    expected_arms: Sequence[str],
    campaign_sha: str,
    margins_sha: str,
    block_map: Mapping[str, Sequence[int]],
) -> tuple[dict[tuple[str, str], dict[str, object]], list[dict[str, object]]]:
    if not paths:
        raise AnalysisError("at least one candidate block-score JSON path is required")
    resolved_paths: set[Path] = set()
    rows_by_key: dict[tuple[str, str], dict[str, object]] = {}
    inputs: list[dict[str, object]] = []
    expected_pairs = {
        (arm, block_id)
        for arm in expected_arms
        if arm != REFERENCE_ARM
        for block_id in phase.block_ids
    }
    expected_top_keys = frozenset(
        {"schemaVersion", "artifactType", "campaignSha256", "marginsSha256", "status", "rows"}
    )
    expected_row_keys = frozenset(
        {
            "arm",
            "blockId",
            "seeds",
            "referenceCompositeLoss",
            "candidateCompositeLoss",
            "pairedCompositeDifference",
            "candidateSummary",
        }
    )
    for requested_path in paths:
        path = requested_path.expanduser().resolve()
        if path in resolved_paths:
            raise AnalysisError(f"candidate block-score path is repeated: {path}")
        resolved_paths.add(path)
        if path.is_symlink() or not path.is_file():
            raise AnalysisError(f"candidate block-score input is not a regular file: {path}")
        payload = path.read_bytes()
        digest = hashlib.sha256(payload).hexdigest()
        try:
            document = json.loads(payload)
        except json.JSONDecodeError as error:
            raise AnalysisError(f"candidate block-score JSON is malformed: {path}") from error
        if not isinstance(document, dict):
            raise AnalysisError(f"candidate block-score must contain an object: {path}")
        _exact_keys(document, expected_top_keys, f"candidate score {path}")
        if (
            document.get("schemaVersion") != 1
            or document.get("artifactType") != "precision-candidate-block-scores"
            or document.get("campaignSha256") != campaign_sha
            or document.get("marginsSha256") != margins_sha
        ):
            raise AnalysisError(f"candidate block-score identity/hash mismatch: {path}")
        if document.get("status") != phase.scorer_status:
            raise AnalysisError(
                f"candidate scorer status {document.get('status')!r} is incompatible with {phase.name}"
            )
        rows = document.get("rows")
        if not isinstance(rows, list) or not rows:
            raise AnalysisError(f"candidate block-score contains no rows: {path}")
        inputs.append({"path": str(path), "sha256": digest, "rowCount": len(rows)})
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise AnalysisError(f"candidate score row {index} in {path} is not an object")
            _exact_keys(row, expected_row_keys, f"candidate row {path}:{index}")
            arm = row.get("arm")
            block_id = row.get("blockId")
            if not isinstance(arm, str) or not isinstance(block_id, str):
                raise AnalysisError(f"candidate row identity is malformed in {path}:{index}")
            key = (arm, block_id)
            if key not in expected_pairs:
                raise AnalysisError(
                    f"unexpected arm/block for exact {phase.name} grid: {arm} {block_id}"
                )
            if key in rows_by_key:
                raise AnalysisError(f"duplicate candidate arm/block row: {arm} {block_id}")
            expected_seeds = list(block_map[block_id])
            if row.get("seeds") != expected_seeds:
                raise AnalysisError(f"candidate row seed membership differs for {arm} {block_id}")
            summary = row.get("candidateSummary")
            if not isinstance(summary, dict):
                raise AnalysisError(f"candidate row has no summary for {arm} {block_id}")
            rows_by_key[key] = {**row, "_sourcePath": str(path), "_sourceSha256": digest}
    missing = sorted(expected_pairs - set(rows_by_key))
    extra = sorted(set(rows_by_key) - expected_pairs)
    if missing or extra:
        raise AnalysisError(f"candidate grid differs: missing={missing} extra={extra}")
    return rows_by_key, inputs


SummaryBuilder = Callable[..., dict[str, object]]


def reconstruct_confirmation_references(
    campaign_root: Path,
    *,
    phase: PhaseSpec,
    campaign_sha: str,
    profile: object,
    summary_builder: SummaryBuilder = sweep.block_summary,
) -> dict[str, Mapping[str, object]]:
    if phase.name not in {"confirmation", "confirmation-extension"}:
        raise AnalysisError("raw H64 reconstruction is restricted to held-out confirmation phases")
    result: dict[str, Mapping[str, object]] = {}
    for block_id in phase.block_ids:
        block_number = int(block_id[1:])
        seeds = list(range(1 + (block_number - 1) * 8, 1 + block_number * 8))
        block = summary_builder(
            campaign_root,
            arm=sweep.ARM_REGISTRY[REFERENCE_ARM],
            block_id=block_id,
            seeds=seeds,
            campaign_sha=campaign_sha,
            profile=profile,
        )
        if not isinstance(block, dict):
            raise AnalysisError(f"reconstructed H64 {block_id} is not an object")
        if block.get("arm") != REFERENCE_ARM or block.get("blockId") != block_id or block.get("seeds") != seeds:
            raise AnalysisError(f"reconstructed H64 block identity differs for {block_id}")
        summary = block.get("summary")
        if not isinstance(summary, dict):
            raise AnalysisError(f"reconstructed H64 {block_id} has no summary")
        validate_summary_schema(summary, expected_seeds=seeds, label=f"reconstructed-H64.{block_id}")
        result[block_id] = block
    return result


def _selection_contract_expected(base: Mapping[str, object]) -> dict[str, object]:
    return {
        "discovery": {
            "phase": "discovery",
            "blocks": list(PHASES["discovery"].block_ids),
            "seeds": list(PHASES["discovery"].seeds),
        },
        "confirmation": {
            "phase": "confirmation",
            "blocks": list(PHASES["confirmation"].block_ids),
            "seeds": list(PHASES["confirmation"].seeds),
        },
        "confirmationExtension": {
            "phase": "confirmation-extension",
            "blocks": list(PHASES["confirmation-extension"].block_ids),
            "seeds": list(PHASES["confirmation-extension"].seeds),
            "activationRule": "only-if-complete-confirmation-is-statistically-inconclusive",
            "combinationRule": "pool-paired-block-vectors-B21-through-B36",
        },
        "endpoints": {
            "composite": "overallCompositeLoss",
            "sentinelMetricIds": list(SENTINEL_IDS),
            "sentinelField": PRIMARY_METRIC_FIELD,
        },
        "identities": {
            "campaignSha256": base["campaignSha256"],
            "campaignSourceSha256": base["campaignSourceSha256"],
            "marginsSha256": base["marginsSha256"],
            "referenceSha256": base["referenceSha256"],
        },
    }


def verify_selection(
    campaign_root: Path,
    *,
    base: Mapping[str, object],
    scope: Mapping[str, object],
    freeze: Mapping[str, object],
) -> dict[str, object]:
    payload, selection_sha = verify_sealed_file(
        campaign_root / SELECTION_JSON, campaign_root / SELECTION_SEAL
    )
    try:
        selection = json.loads(payload)
    except json.JSONDecodeError as error:
        raise AnalysisError("selection.json is invalid JSON") from error
    if not isinstance(selection, dict):
        raise AnalysisError("selection.json must contain an object")
    expected_keys = frozenset(
        {
            "schemaVersion",
            "artifactType",
            "selectedArm",
            "saferNeighbour",
            "campaignSha256",
            "campaignSourceSha256",
            "marginsSha256",
            "referenceSha256",
            "scopeFreezeSha256",
            "scopeManifestSha256",
            "analysisFreezeSha256",
            "analysisProgramSha256",
            "discovery",
            "confirmation",
            "confirmationExtension",
            "endpoints",
        }
    )
    _exact_keys(selection, expected_keys, "selection")
    selected = selection.get("selectedArm")
    if selected not in DISCOVERY_CANDIDATES:
        raise AnalysisError("selection.selectedArm is not a discovery candidate")
    if selection.get("saferNeighbour") != SAFER_NEIGHBOUR[selected]:
        raise AnalysisError("selection.saferNeighbour is not the next safer tested arm")
    expected = _selection_contract_expected(base)
    direct = {
        "schemaVersion": SELECTION_SCHEMA_VERSION,
        "artifactType": SELECTION_ARTIFACT_TYPE,
        "campaignSha256": base["campaignSha256"],
        "campaignSourceSha256": base["campaignSourceSha256"],
        "marginsSha256": base["marginsSha256"],
        "referenceSha256": base["referenceSha256"],
        "scopeFreezeSha256": scope["scopeSha256"],
        "scopeManifestSha256": scope["manifestSha256"],
        "analysisFreezeSha256": freeze["freezeSha256"],
        "analysisProgramSha256": _sha256_file(_repo_path(ANALYSIS_PROGRAM_PATH)),
    }
    for key, value in direct.items():
        if selection.get(key) != value:
            raise AnalysisError(f"selection identity differs for {key}")
    for key in ("discovery", "confirmation", "confirmationExtension", "endpoints"):
        if selection.get(key) != expected[key]:
            raise AnalysisError(f"selection frozen contract differs for {key}")
    selection["_selectionSha256"] = selection_sha
    return selection


def _strict_replay_endpoint(
    campaign_root: Path,
    *,
    endpoint: Mapping[str, object],
    campaign: Mapping[str, object],
    campaign_sha: str,
    arm: str,
    seed: int,
    label: str,
) -> dict[str, object]:
    if set(endpoint) != {"path", "sidecarSha256", "scientificTreeSha256"}:
        raise ReplayEvidenceError(f"{label} replay endpoint schema differs")
    relative = endpoint.get("path")
    if not isinstance(relative, str):
        raise ReplayEvidenceError(f"{label}.path must be campaign-relative")
    sidecar_path = _campaign_path(campaign_root, relative)
    if sidecar_path.name != sweep.RUN_FILE:
        raise ReplayEvidenceError(f"{label}.path must identify a run.json sidecar")
    expected_sidecar_sha = endpoint.get("sidecarSha256")
    if not isinstance(expected_sidecar_sha, str) or _sha256_file(sidecar_path) != expected_sidecar_sha:
        raise ReplayEvidenceError(f"{label} sidecar hash mismatch")
    try:
        record = sweep.verify_run_record(
            sidecar_path.parent,
            campaign_sha=campaign_sha,
            arm=sweep.ARM_REGISTRY[arm],
            seed=seed,
        )
    except (OSError, RuntimeError, ValueError) as error:
        raise ReplayEvidenceError(f"{label} referenced run does not verify: {error}") from error
    findings = _run_identity_findings(record, arm=arm, seed=seed, campaign=campaign)
    if findings:
        raise ReplayEvidenceError(f"{label} runtime identity differs: {findings}")
    scientific_hash = endpoint.get("scientificTreeSha256")
    if scientific_hash != record.get("scientificTreeSha256"):
        raise ReplayEvidenceError(f"{label} scientific-tree hash mismatch")
    return {
        "path": relative,
        "sidecarSha256": expected_sidecar_sha,
        "scientificTreeSha256": scientific_hash,
    }


def verify_replay_evidence(
    campaign_root: Path,
    *,
    replay_path: Path,
    replay_seal: Path,
    phase: PhaseSpec,
    expected_arms: Sequence[str],
    base: Mapping[str, object],
) -> dict[str, dict[str, object]]:
    payload, replay_sha = verify_sealed_file(replay_path, replay_seal)
    try:
        artifact = json.loads(payload)
    except json.JSONDecodeError as error:
        raise ReplayEvidenceError("replay evidence is invalid JSON") from error
    if not isinstance(artifact, dict):
        raise ReplayEvidenceError("replay evidence must contain an object")
    expected_top = {
        "schemaVersion",
        "artifactType",
        "campaignSha256",
        "campaignSourceSha256",
        "phase",
        "records",
    }
    if set(artifact) != expected_top:
        raise ReplayEvidenceError("replay evidence top-level schema differs")
    if (
        artifact.get("schemaVersion") != REPLAY_SCHEMA_VERSION
        or artifact.get("artifactType") != REPLAY_ARTIFACT_TYPE
        or artifact.get("campaignSha256") != base["campaignSha256"]
        or artifact.get("campaignSourceSha256") != base["campaignSourceSha256"]
        or artifact.get("phase") != phase.name
    ):
        raise ReplayEvidenceError("replay evidence identity differs")
    records = artifact.get("records")
    if not isinstance(records, list):
        raise ReplayEvidenceError("replay evidence records must be a list")
    required = tuple(arm for arm in expected_arms if arm != REFERENCE_ARM)
    by_arm: dict[str, dict[str, object]] = {}
    replay_seed = phase.first_seed
    for index, record in enumerate(records):
        if not isinstance(record, dict) or set(record) != {
            "arm",
            "replaySeed",
            "original",
            "replay",
            "identical",
        }:
            raise ReplayEvidenceError(f"replay record {index} schema differs")
        arm = record.get("arm")
        if arm not in required or arm in by_arm:
            raise ReplayEvidenceError(f"unexpected or duplicate replay arm: {arm!r}")
        if record.get("replaySeed") != replay_seed:
            raise ReplayEvidenceError(
                f"replay seed for {arm} must be the phase-first seed {replay_seed}"
            )
        if record.get("identical") is not True:
            raise ReplayEvidenceError(f"replay identical assertion is not true for {arm}")
        original = record.get("original")
        replay = record.get("replay")
        if not isinstance(original, dict) or not isinstance(replay, dict):
            raise ReplayEvidenceError(f"replay endpoints are malformed for {arm}")
        expected_original = f"arms/{arm}/seeds/seed-{replay_seed:06d}/{sweep.RUN_FILE}"
        if original.get("path") != expected_original:
            raise ReplayEvidenceError(f"original replay path is not canonical for {arm}")
        verified_original = _strict_replay_endpoint(
            campaign_root,
            endpoint=original,
            campaign=base["campaign"],
            campaign_sha=base["campaignSha256"],
            arm=arm,
            seed=replay_seed,
            label=f"{arm}.original",
        )
        verified_replay = _strict_replay_endpoint(
            campaign_root,
            endpoint=replay,
            campaign=base["campaign"],
            campaign_sha=base["campaignSha256"],
            arm=arm,
            seed=replay_seed,
            label=f"{arm}.replay",
        )
        if verified_original["scientificTreeSha256"] != verified_replay["scientificTreeSha256"]:
            raise ReplayEvidenceError(f"original and replay scientific hashes differ for {arm}")
        by_arm[arm] = {
            "status": "verified",
            "replayEvidenceSha256": replay_sha,
            "replaySeed": replay_seed,
            "original": verified_original,
            "replay": verified_replay,
            "identical": True,
        }
    if set(by_arm) != set(required):
        raise ReplayEvidenceError(
            f"replay arm registry differs: missing={sorted(set(required) - set(by_arm))}"
        )
    return by_arm


def replay_eligibility(
    campaign_root: Path,
    *,
    replay_path: Path,
    replay_seal: Path,
    phase: PhaseSpec,
    expected_arms: Sequence[str],
    base: Mapping[str, object],
) -> tuple[dict[str, dict[str, object]], str | None, str]:
    required = tuple(arm for arm in expected_arms if arm != REFERENCE_ARM)
    try:
        verified = verify_replay_evidence(
            campaign_root,
            replay_path=replay_path,
            replay_seal=replay_seal,
            phase=phase,
            expected_arms=expected_arms,
            base=base,
        )
        return verified, None, "verified"
    except (AnalysisError, OSError) as error:
        missing = not replay_path.is_file() or not replay_seal.is_file()
        status = "missing" if missing else "invalid"
        rows = {
            arm: {
                "status": status,
                "identical": False,
                "reason": str(error),
            }
            for arm in required
        }
        return rows, str(error), status


def collect_phase_run_evidence(
    campaign_root: Path,
    *,
    expected_arms: Sequence[str],
    phase: PhaseSpec,
    base: Mapping[str, object],
) -> dict[str, dict[str, object]]:
    cache: dict[tuple[str, int], dict[str, object]] = {}

    def one(arm: str, seed: int) -> dict[str, object]:
        key = (arm, seed)
        if key not in cache:
            cache[key] = verify_run_evidence(
                campaign_root,
                campaign=base["campaign"],
                campaign_sha=base["campaignSha256"],
                arm=arm,
                seed=seed,
            )
        return cache[key]

    h64 = [one(REFERENCE_ARM, seed) for seed in phase.seeds]
    h64_failed = any(row["status"] != "verified" for row in h64)
    result: dict[str, dict[str, object]] = {}
    for arm in expected_arms:
        candidate_runs = h64 if arm == REFERENCE_ARM else [one(arm, seed) for seed in phase.seeds]
        failed = h64_failed or any(row["status"] != "verified" for row in candidate_runs)
        reason_codes = sorted(
            {
                reason
                for row in (*h64, *candidate_runs)
                for reason in row.get("reasonCodes", [])
            }
        )
        result[arm] = {
            "status": "fail" if failed else "eligible-pending-replay",
            "reasonCodes": reason_codes,
            "candidateRuns": candidate_runs,
            "referenceRuns": h64,
            "allSeventeenFieldsAttemptedInEveryRequiredRun": not any(
                reason.startswith("nonpositive-attempted-writes")
                or reason == "precision-write-field-registry-mismatch"
                for reason in reason_codes
            ),
            "changedWritesAreDescriptiveOnly": True,
            "failureArtifactFinding": (
                "conflict-found" if "conflicting-failure-artifact" in reason_codes else "none-found"
            ),
        }
    return result


def _metric_rows_by_id(comparison: Mapping[str, object]) -> dict[str, Mapping[str, object]]:
    return {str(row["metricId"]): row for row in comparison["metrics"]}


def _descriptive_summary(values: Sequence[float]) -> dict[str, object]:
    mean = math.fsum(values) / len(values)
    sample_sd = None
    if len(values) >= 2:
        sample_sd = math.sqrt(
            math.fsum((value - mean) ** 2 for value in values) / (len(values) - 1)
        )
    return {"values": list(values), "mean": mean, "sampleSD": sample_sd}


def _arm_statistical_report(
    arm: str,
    comparisons: Sequence[Mapping[str, object]],
    *,
    margins: Mapping[str, object],
    bootstrap: Mapping[str, Mapping[str, object]],
) -> tuple[dict[str, object], str]:
    composite_values = [float(row["pairedCompositeDifference"]) for row in comparisons]
    composite = endpoint_inference(composite_values, margins["compositeMargin"])
    composite["bootstrapSensitivityCI90"] = bootstrap[f"{arm}::composite"]
    endpoints: dict[str, dict[str, object]] = {"composite": composite}
    descriptive_metrics: dict[str, object] = {}
    for metric_id in METRIC_IDS:
        block_metrics = [_metric_rows_by_id(row)[metric_id] for row in comparisons]
        ingredients: dict[str, object] = {}
        for field in NUMERIC_SCORING_FIELDS:
            differences = [row["ingredients"][field]["difference"] for row in block_metrics]
            numeric_differences = [float(value) for value in differences if value is not None]
            ingredients[field] = {
                "differences": differences,
                "numericSummary": (
                    _descriptive_summary(numeric_differences) if len(numeric_differences) == len(differences) else None
                ),
            }
        status_changes = [
            {
                "blockId": comparisons[index]["blockId"],
                **row["categorical"]["status"],
            }
            for index, row in enumerate(block_metrics)
            if row["categorical"]["status"]["changed"]
        ]
        seed_mean_values = [float(value) for value in ingredients[PRIMARY_METRIC_FIELD]["differences"]]
        descriptive_metrics[metric_id] = {
            "comparisonUnits": block_metrics[0]["comparisonUnits"],
            "ingredients": ingredients,
            "statusChanges": status_changes,
            "seedMeanBootstrapSensitivityCI90": bootstrap[f"{arm}::metric::{metric_id}::seedMean"],
            "affectsSelection": metric_id in SENTINEL_IDS,
        }
        if metric_id in SENTINEL_IDS:
            endpoint = endpoint_inference(seed_mean_values, margins["rawMetricMargins"][metric_id])
            endpoint.update(
                {
                    "metricId": metric_id,
                    "field": PRIMARY_METRIC_FIELD,
                    "comparisonUnits": block_metrics[0]["comparisonUnits"],
                    "bootstrapSensitivityCI90": bootstrap[
                        f"{arm}::metric::{metric_id}::seedMean"
                    ],
                }
            )
            endpoints[metric_id] = endpoint
    classification = aggregate_statistical_classification(endpoints)
    return {
        "primaryEndpoints": endpoints,
        "aggregateStatisticalClassification": classification,
        "allMetricDescriptiveDifferences": descriptive_metrics,
    }, classification


def _final_arm_decision(
    statistical: str,
    run_evidence: Mapping[str, object],
    replay: Mapping[str, object] | None,
    replay_global_status: str,
) -> tuple[str, dict[str, object]]:
    reasons = list(run_evidence.get("reasonCodes", []))
    run_status = run_evidence.get("status")
    if run_status == "fail":
        eligibility_status = "fail"
        eligible = False
    elif replay is None:
        eligibility_status = "not_eligible"
        eligible = False
        reasons.append("replay-evidence-not-applicable-or-missing")
    elif replay.get("status") == "verified":
        eligibility_status = "eligible"
        eligible = True
    elif replay_global_status == "missing":
        eligibility_status = "not_eligible"
        eligible = False
        reasons.append("replay-evidence-missing")
    else:
        eligibility_status = "fail"
        eligible = False
        reasons.append("replay-evidence-invalid-or-mismatching")

    if statistical == "fail" or eligibility_status == "fail":
        decision = "fail"
    elif not eligible:
        decision = "not_eligible"
    elif statistical == "insufficient":
        decision = "insufficient"
    elif statistical == "inconclusive":
        decision = "inconclusive"
    elif statistical == "pass":
        decision = "pass"
    else:
        raise AnalysisError(f"unknown statistical classification {statistical!r}")
    return decision, {
        "status": eligibility_status,
        "eligible": eligible,
        "reasonCodes": sorted(set(reasons)),
        "runVerification": run_evidence,
        "replayVerification": replay,
    }


def confirmation_decision(
    selected_arm: str, safer_arm: str, decisions: Mapping[str, str]
) -> dict[str, object]:
    if set(decisions) != {selected_arm, safer_arm}:
        return {
            "status": "incomplete",
            "recommendedArm": None,
            "extensionEligible": False,
            "reason": "selected-and-safer-results-required",
        }
    selected = decisions[selected_arm]
    safer = decisions[safer_arm]
    if selected == "pass":
        return {
            "status": "confirmed",
            "recommendedArm": selected_arm,
            "extensionEligible": False,
            "reason": "selected-arm-passed-all-frozen-rules",
        }
    if selected == "inconclusive":
        return {
            "status": "inconclusive",
            "recommendedArm": None,
            "extensionEligible": True,
            "reason": "selected-arm-primary-point-estimates-inside-but-ci-crosses-margin",
        }
    if selected == "fail" and safer == "pass":
        return {
            "status": "safer-neighbour-confirmed",
            "recommendedArm": safer_arm,
            "extensionEligible": False,
            "reason": "selected-failed-and-safer-neighbour-passed",
        }
    return {
        "status": "failed" if selected == "fail" else "unavailable",
        "recommendedArm": None,
        "extensionEligible": False,
        "reason": "no-confirmed-reduced-storage-recommendation",
    }


def verify_scope_freeze(campaign_root: Path, base: Mapping[str, object]) -> dict[str, object]:
    payload, scope_sha = verify_sealed_file(
        campaign_root / SCOPE_JSON, campaign_root / SCOPE_SEAL
    )
    try:
        scope = json.loads(payload)
    except json.JSONDecodeError as error:
        raise AnalysisError("scope-freeze.json is invalid JSON") from error
    if not isinstance(scope, dict):
        raise AnalysisError("scope-freeze.json must contain an object")
    expected_top_keys = {
        "schemaVersion",
        "artifactType",
        "createdAt",
        "additiveCampaignAmendment",
        "campaign",
        "campaignSourceSha256",
        "git",
        "manifestVersion",
        "repositoryManifestPath",
        "archivedManifestPath",
        "manifestSha256",
        "manifestRowCount",
        "runtimeFieldSet",
        "implementationToManifest",
        "runtimeEnums",
        "literalStoreCallSiteCount",
        "roundingRule",
        "precisionTreatment",
        "claimLimitation",
        "exerciseEvidence",
        "nonNoopCandidateScoresViewed",
        "validation",
    }
    if set(scope) != expected_top_keys:
        raise AnalysisError(
            f"scope freeze schema differs: missing={sorted(expected_top_keys - set(scope))} "
            f"extra={sorted(set(scope) - expected_top_keys)}"
        )
    if (
        scope.get("schemaVersion") != 1
        or scope.get("artifactType") != "precision-selected-state-scope-freeze"
        or scope.get("additiveCampaignAmendment") is not True
    ):
        raise AnalysisError("scope freeze schema/type/amendment identity differs")
    campaign = scope.get("campaign")
    if not isinstance(campaign, dict) or campaign.get("sha256") != base["campaignSha256"]:
        raise AnalysisError("scope freeze belongs to a different campaign")
    expected_repo_relative = campaign_root.relative_to(REPO_ROOT).as_posix()
    if (
        campaign.get("canonicalAbsolutePath") != str(campaign_root)
        or campaign.get("repositoryRelativePath") != expected_repo_relative
    ):
        raise AnalysisError("scope freeze canonical campaign path identity differs")
    if scope.get("campaignSourceSha256") != base["campaignSourceSha256"]:
        raise AnalysisError("scope freeze belongs to a different campaign source")
    if scope.get("git") != base["campaign"].get("git"):
        raise AnalysisError("scope freeze campaign-recorded git identity differs")
    if scope.get("runtimeFieldSet") != RUNTIME_FIELD_SET:
        raise AnalysisError("scope freeze runtime field-set label differs")
    if scope.get("implementationToManifest") != {RUNTIME_FIELD_SET: "selected-state-v1"}:
        raise AnalysisError("scope freeze implementation-to-manifest mapping differs")
    if scope.get("manifestVersion") != "selected-state-v1" or scope.get("manifestRowCount") != 17:
        raise AnalysisError("scope freeze manifest version/row count differs")
    repository_path = scope.get("repositoryManifestPath")
    archived_path = scope.get("archivedManifestPath")
    manifest_sha = scope.get("manifestSha256")
    if repository_path != REPOSITORY_SCOPE_MANIFEST or archived_path != ARCHIVED_SCOPE_MANIFEST:
        raise AnalysisError("scope freeze manifest paths differ from the selected-state-v1 contract")
    if not isinstance(manifest_sha, str):
        raise AnalysisError("scope freeze has no manifest SHA-256")
    repository_manifest = _repo_path(repository_path)
    archived_manifest = _campaign_path(campaign_root, archived_path)
    if repository_manifest.read_bytes() != archived_manifest.read_bytes():
        raise AnalysisError("repository and archived selected-state manifests are not byte-identical")
    if _sha256_file(repository_manifest) != manifest_sha or _sha256_file(archived_manifest) != manifest_sha:
        raise AnalysisError("selected-state manifest hash differs from the scope freeze")
    fields = scope.get("runtimeEnums")
    if fields != list(sweep.EXPECTED_PRECISION_FIELDS):
        raise AnalysisError("scope freeze does not preserve the exact ordered 17-field runtime set")
    limitation = scope.get("claimLimitation")
    if not isinstance(limitation, str) or not limitation.strip():
        raise AnalysisError("scope freeze omits the selected-state claim limitation")
    lowered_limitation = limitation.lower()
    if "fp64" not in lowered_limitation or not any(
        phrase in lowered_limitation for phrase in ("outside", "unlisted", "not a whole", "not all")
    ):
        raise AnalysisError("scope freeze weakens the explicit selected-state limitation")
    if scope.get("roundingRule") != "round-to-nearest, ties-to-even":
        raise AnalysisError("scope freeze rounding rule differs")
    treatment = scope.get("precisionTreatment")
    if not isinstance(treatment, dict) or treatment.get("computation") != "FP64":
        raise AnalysisError("scope freeze storage-only/FP64-computation treatment differs")
    assertions = scope.get("validation")
    if not isinstance(assertions, dict):
        raise AnalysisError("scope freeze validation assertions are absent")
    if scope.get("nonNoopCandidateScoresViewed") is not False:
        raise AnalysisError("scope freeze does not assert nonNoopCandidateScoresViewed=false")
    false_assertions = [key for key, value in assertions.items() if value is not True]
    if false_assertions:
        raise AnalysisError(f"scope freeze validation assertions are not all true: {false_assertions}")
    exercise = scope.get("exerciseEvidence")
    if (
        not isinstance(exercise, dict)
        or exercise.get("allSelectedFieldsPositiveAttemptedWrites") is not True
        or exercise.get("changedWritePositivityIsExerciseCriterion") is not False
    ):
        raise AnalysisError("scope freeze write-exercise assertions differ")
    return {
        "scope": scope,
        "scopeSha256": scope_sha,
        "scopeSealSha256": _sha256_file(campaign_root / SCOPE_SEAL),
        "manifestSha256": manifest_sha,
        "repositoryManifestPath": repository_path,
        "archivedManifestPath": archived_path,
        "limitation": limitation,
    }


def analysis_contract_payload() -> dict[str, object]:
    return {
        "runtime": {
            "substrate": SUBSTRATE,
            "frontier": FRONTIER,
            "campaignVersion": "v5o3",
            "runtimeFieldSet": RUNTIME_FIELD_SET,
            "selectedStateManifest": "selected-state-v1",
        },
        "arms": {
            "reference": REFERENCE_ARM,
            "noOpControl": NOOP_CONTROL_ARM,
            "discoveryCandidatesSaferToLower": list(DISCOVERY_CANDIDATES),
            "invalidArmEvidenceNotCandidates": list(INVALID_ARMS),
            "saferNeighbours": dict(SAFER_NEIGHBOUR),
        },
        "phases": {
            name: {
                "seeds": list(spec.seeds),
                "blocks": list(spec.block_ids),
                "blockSize": 8,
                "scorerStatusAcceptedButNotUsedForRange": spec.scorer_status,
            }
            for name, spec in PHASES.items()
        },
        "metrics": {
            "orderedMetricIds": list(METRIC_IDS),
            "sentinelMetricIds": list(SENTINEL_IDS),
            "primarySentinelField": PRIMARY_METRIC_FIELD,
            "numericScoringFields": list(NUMERIC_SCORING_FIELDS),
            "nullableNumericScoringFields": sorted(NULLABLE_NUMERIC_SCORING_FIELDS),
            "categoricalScoringFields": list(CATEGORICAL_SCORING_FIELDS),
            "immutableMetadataFields": list(IMMUTABLE_METRIC_FIELDS),
            "selectionUsesOnly": ["overallCompositeLoss", "six-sentinel-seedMean"],
        },
        "studentT": {
            "mean": "arithmetic-mean-of-paired-block-differences",
            "sampleSDDenominator": "n-1",
            "standardError": "sampleSD/sqrt(n)",
            "criticalValue": "scipy.stats.t.ppf(0.95,n-1)",
            "confidenceLevel": CI_COVERAGE,
            "alpha": TOST_ALPHA,
            "strictBoundary": True,
            "passRule": "ciLower>-margin-and-ciUpper<margin-and-both-one-sided-p-values<0.05",
            "failRule": "point-estimate-on-or-outside-margin-or-correctness-provenance-failure",
            "inconclusiveRule": "point-estimate-strictly-inside-but-ci-touches-or-crosses-margin",
            "zeroStandardErrorPValues": {
                "favourableStrict": 0.0,
                "equality": 0.5,
                "unfavourable": 1.0,
            },
            "zeroMarginRule": "n>=2-pass-only-if-every-paired-difference-is-exactly-zero",
            "insufficientNRule": "n<2-control-only-insufficient-no-finite-student-t-interval",
        },
        "bootstrapSensitivity": {
            "resamples": BOOTSTRAP_RESAMPLES,
            "prng": "random.Random",
            "seed": BOOTSTRAP_SEED,
            "unit": "whole-paired-block-index",
            "sharedIndexTuplesAcrossAllEndpoints": True,
            "quantiles": list(BOOTSTRAP_QUANTILES),
            "interpolation": "h=(N-1)*p-linear-between-floor-and-ceil",
            "affectsSelection": False,
            "productionOverridesExposed": False,
        },
        "evidenceEligibilityRequirements": [
            "composite-and-all-six-sentinel-endpoints-pass",
            "every-required-run-sidecar-and-recorded-output-hash-reverifies",
            "no-recorded-abort-invalid-nonfinite-invariant-or-conflicting-failure-artifact",
            "all-17-selected-fields-have-positive-attempted-writes-in-every-required-run",
            "changed-write-counts-reported-but-not-substituted-for-attempted-writes",
            "sealed-deterministic-replay-evidence-verifies-for-every-required-candidate-arm",
            "campaign-substrate-frontier-mode-q-field-set-window-block-margin-and-source-match",
        ],
        "replayEvidence": {
            "schemaVersion": REPLAY_SCHEMA_VERSION,
            "artifactType": REPLAY_ARTIFACT_TYPE,
            "requiredTopFields": [
                "schemaVersion",
                "artifactType",
                "campaignSha256",
                "campaignSourceSha256",
                "phase",
                "records",
            ],
            "requiredRecordFields": ["arm", "replaySeed", "original", "replay", "identical"],
            "requiredEndpointFields": ["path", "sidecarSha256", "scientificTreeSha256"],
            "replaySeedRule": "first-seed-of-exact-phase",
            "missingRule": "not_eligible-no-selection",
            "falseOrMismatchRule": "fail-no-selection",
        },
        "discoverySelectionRule": [
            "lower-pass-after-any-safer-fail-or-inconclusive=>non_monotone-no-recommendation",
            "HQ51+HQ40+HQ32-pass=>HQ32",
            "HQ51+HQ40-pass=>HQ40",
            "HQ51-pass=>HQ51",
            "otherwise-none",
            "missing-not_eligible-insufficient-or-incomplete-grid=>no-recommendation",
            "HQ52-never-selectable-and-observed-loss-never-minimized",
        ],
        "heldOutConfirmation": {
            "requiresSeparatelySealedSelection": True,
            "analysedArms": "selected-and-next-safer-tested-neighbour",
            "HQ51SaferNeighbour": REFERENCE_ARM,
            "confirmed": "selected-passes-every-primary-and-evidence-rule-on-B21-B28",
            "failed": "primary-point-estimate-on-or-outside-or-correctness-failure-no-extension",
            "inconclusive": "all-primary-point-estimates-inside-but-ci-crosses-boundary",
            "extensionActivation": "sealed-inconclusive-trigger-only",
            "extensionBlocks": list(PHASES["confirmation-extension"].block_ids),
            "extensionCombination": "pool-paired-block-vectors-B21-through-B36",
            "selectedFailsSaferPasses": "move-recommendation-to-safer-and-label",
        },
        "reportingAndSelectionAssertion": (
            "bootstrap-and-non-sentinel-metrics-are-reported-and-do-not-affect-selection"
        ),
    }


def _file_identity(path: Path, relative: str) -> dict[str, object]:
    return {"path": relative, "sha256": _sha256_file(path), "sizeBytes": path.stat().st_size}


def implementation_identity(repo_root: Path = REPO_ROOT) -> dict[str, object]:
    program = repo_root / ANALYSIS_PROGRAM_PATH
    test = repo_root / ANALYSIS_TEST_PATH
    dependencies = [
        _file_identity(repo_root / relative, relative) for relative in LOCAL_DEPENDENCY_PATHS
    ]
    return {
        "analysisProgram": _file_identity(program, ANALYSIS_PROGRAM_PATH),
        "analysisTests": _file_identity(test, ANALYSIS_TEST_PATH),
        "localDependencies": dependencies,
    }


def verify_implementation_identity(
    recorded: Mapping[str, object],
    recorded_environment: Mapping[str, object],
    *,
    repo_root: Path = REPO_ROOT,
    current_versions: Mapping[str, str] | None = None,
) -> None:
    for label, key in (("analysis program", "analysisProgram"), ("analysis tests", "analysisTests")):
        row = recorded.get(key)
        if not isinstance(row, dict) or set(row) != {"path", "sha256", "sizeBytes"}:
            raise AnalysisError(f"frozen {label} identity schema differs")
        path = row.get("path")
        if not isinstance(path, str):
            raise AnalysisError(f"frozen {label} path is malformed")
        actual = _file_identity(repo_root / path, path)
        if row != actual:
            raise AnalysisError(f"frozen {label} hash/size drifted")
    dependencies = recorded.get("localDependencies")
    if not isinstance(dependencies, list):
        raise AnalysisError("frozen local dependency identities are absent")
    if [row.get("path") for row in dependencies if isinstance(row, dict)] != list(LOCAL_DEPENDENCY_PATHS):
        raise AnalysisError("frozen local dependency registry drifted")
    for row in dependencies:
        if not isinstance(row, dict) or set(row) != {"path", "sha256", "sizeBytes"}:
            raise AnalysisError("frozen local dependency identity schema differs")
        relative = row.get("path")
        if not isinstance(relative, str) or row != _file_identity(repo_root / relative, relative):
            raise AnalysisError(f"frozen local dependency drifted: {relative}")
    versions = current_versions or {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "scipy": scipy.__version__,
    }
    expected_environment = {
        "python": versions["python"],
        "numpy": versions["numpy"],
        "scipy": versions["scipy"],
    }
    if dict(recorded_environment) != expected_environment:
        raise AnalysisError("frozen Python/NumPy/SciPy version identity drifted")


def verify_analysis_freeze(
    campaign_root: Path,
    *,
    base: Mapping[str, object],
    scope: Mapping[str, object],
) -> dict[str, object]:
    payload, freeze_sha = verify_sealed_file(
        campaign_root / ANALYSIS_FREEZE_JSON, campaign_root / ANALYSIS_FREEZE_SEAL
    )
    try:
        freeze = json.loads(payload)
    except json.JSONDecodeError as error:
        raise AnalysisError("analysis-freeze.json is invalid JSON") from error
    if not isinstance(freeze, dict):
        raise AnalysisError("analysis-freeze.json must contain an object")
    if freeze.get("schemaVersion") != SCHEMA_VERSION or freeze.get("artifactType") != FREEZE_ARTIFACT_TYPE:
        raise AnalysisError("analysis freeze schema/artifact type differs")
    campaign = freeze.get("campaign")
    expected_campaign = {
        "campaignJsonPath": CAMPAIGN_JSON,
        "campaignJsonSha256": base["campaignSha256"],
        "campaignSealPath": CAMPAIGN_SEAL,
        "campaignSealSha256": _sha256_file(campaign_root / CAMPAIGN_SEAL),
        "campaignSourceSha256": base["campaignSourceSha256"],
        "recordedGitIdentity": base["campaign"]["git"],
    }
    if not isinstance(campaign, dict):
        raise AnalysisError("analysis freeze campaign identity is absent")
    for key, value in expected_campaign.items():
        if campaign.get(key) != value:
            raise AnalysisError(f"analysis freeze campaign identity drifted for {key}")
    scope_record = freeze.get("scope")
    expected_scope = {
        "scopeJsonPath": SCOPE_JSON,
        "scopeJsonSha256": scope["scopeSha256"],
        "scopeSealPath": SCOPE_SEAL,
        "scopeSealSha256": scope["scopeSealSha256"],
        "repositoryManifestPath": scope["repositoryManifestPath"],
        "archivedManifestPath": scope["archivedManifestPath"],
        "manifestSha256": scope["manifestSha256"],
        "selectedStateLimitation": scope["limitation"],
    }
    if scope_record != expected_scope:
        raise AnalysisError("analysis freeze scope identity drifted")
    inputs = freeze.get("sealedInputs")
    expected_inputs = {
        "margins": {
            "path": MARGINS_JSON,
            "sha256": base["marginsSha256"],
            "sealPath": MARGINS_SEAL,
            "sealSha256": _sha256_file(campaign_root / MARGINS_SEAL),
        },
        "referenceDistribution": {
            "path": REFERENCE_JSON,
            "sha256": base["referenceSha256"],
            "sealPath": REFERENCE_SEAL,
            "sealSha256": _sha256_file(campaign_root / REFERENCE_SEAL),
        },
        "hq52BlockScore": {
            "path": CONTROL_SCORE_JSON,
            "sha256": EXPECTED_HQ52_SCORE_SHA256,
        },
        "hq52ControlReport": {
            "path": CONTROL_REPORT_JSON,
            "sha256": _sha256_file(campaign_root / CONTROL_REPORT_JSON),
        },
    }
    if inputs != expected_inputs:
        raise AnalysisError("analysis freeze sealed-input identities drifted")
    implementation = freeze.get("implementation")
    environment = freeze.get("environment")
    if not isinstance(implementation, dict) or not isinstance(environment, dict):
        raise AnalysisError("analysis freeze implementation/environment identity is absent")
    verify_implementation_identity(implementation, environment)
    verify_declared_dependency_closure()
    if freeze.get("analysisContract") != analysis_contract_payload():
        raise AnalysisError("analysis freeze statistical/evidence contract drifted")
    tests = freeze.get("tests")
    if not isinstance(tests, list) or not tests or any(
        not isinstance(row, dict) or row.get("result") != "success" or not isinstance(row.get("testCount"), int)
        for row in tests
    ):
        raise AnalysisError("analysis freeze does not record successful test commands/counts")
    assertions = freeze.get("assertions")
    required_true = {
        "hq52CompositeDifferenceExactlyZero",
        "hq52SixSentinelSeedMeanDifferencesExactlyZero",
        "hq52IsControlOnlyInsufficientAtN1",
        "noNonNoopCandidateScoreOpenedCalculatedDisplayedOrCreatedBeforeFreeze",
        "scopeSealVerified",
        "allPreexistingCampaignSealsVerified",
    }
    if not isinstance(assertions, dict) or set(assertions) != required_true or any(
        assertions[key] is not True for key in required_true
    ):
        raise AnalysisError("analysis freeze assertions differ or are not all true")
    freeze["freezeSha256"] = freeze_sha
    return freeze


def verify_analysis_gate(campaign_root: Path) -> tuple[dict[str, object], dict[str, object], dict[str, object]]:
    base = verify_campaign_base(campaign_root)
    scope = verify_scope_freeze(campaign_root, base)
    freeze = verify_analysis_freeze(campaign_root, base=base, scope=scope)
    return base, scope, freeze


TEST_COMMANDS = (
    (
        "focused-analysis",
        ("python", "-B", "-m", "unittest", "scripts.python.tests.test_precision_analysis"),
    ),
    (
        "precision-suite",
        (
            "python",
            "-B",
            "-m",
            "unittest",
            "discover",
            "-s",
            "scripts/python/tests",
            "-p",
            "test_precision*.py",
        ),
    ),
    (
        "scoring-dependencies",
        (
            "python",
            "-B",
            "-m",
            "unittest",
            "scripts.python.tests.test_validation_framework_scoring",
            "scripts.python.tests.test_validation_framework_profiles",
        ),
    ),
)


def run_declared_tests() -> list[dict[str, object]]:
    results: list[dict[str, object]] = []
    for label, display_command in TEST_COMMANDS:
        executable_command = (sys.executable, *display_command[1:])
        environment = dict(os.environ)
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        process = subprocess.run(
            executable_command,
            cwd=REPO_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        combined = process.stdout + "\n" + process.stderr
        match = re.search(r"Ran (\d+) tests?", combined)
        if process.returncode != 0 or match is None or not re.search(r"\nOK(?:\s|$)", combined):
            raise AnalysisError(
                f"freeze test command failed ({' '.join(display_command)}):\n{combined[-4000:]}"
            )
        results.append(
            {
                "label": label,
                "command": " ".join(display_command),
                "testCount": int(match.group(1)),
                "result": "success",
            }
        )
    return results


def create_analysis_freeze(campaign_root: Path) -> tuple[str, dict[str, object]]:
    root = resolve_canonical_campaign_root(campaign_root)
    base = verify_campaign_base(root)
    audit_pre_freeze_blocks(root)
    control_path = root / CONTROL_REPORT_JSON
    if not control_path.is_file():
        raise AnalysisError("deterministic HQ52 analysis control is absent")
    expected_control = build_control_report(root)
    if control_path.read_bytes() != sweep.canonical_json(expected_control):
        raise AnalysisError("deterministic HQ52 analysis control differs from live verification")
    scope = verify_scope_freeze(root, base)
    freeze_path = root / ANALYSIS_FREEZE_JSON
    seal_path = root / ANALYSIS_FREEZE_SEAL
    if freeze_path.exists() or seal_path.exists():
        if not freeze_path.is_file() or not seal_path.is_file():
            raise AnalysisError("analysis freeze is only partially present")
        freeze = verify_analysis_freeze(root, base=base, scope=scope)
        return "reused", freeze
    verify_declared_dependency_closure()
    tests = run_declared_tests()
    # Recheck every mutable prerequisite after the tests and immediately before capture.
    base = verify_campaign_base(root)
    audit_pre_freeze_blocks(root)
    scope = verify_scope_freeze(root, base)
    expected_control = build_control_report(root)
    if control_path.read_bytes() != sweep.canonical_json(expected_control):
        raise AnalysisError("HQ52 control changed during freeze preparation")
    created_at = _utc_now()
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "artifactType": FREEZE_ARTIFACT_TYPE,
        "createdAt": created_at,
        "campaign": {
            "canonicalRootAtFreeze": str(root),
            "campaignJsonPath": CAMPAIGN_JSON,
            "campaignJsonSha256": base["campaignSha256"],
            "campaignSealPath": CAMPAIGN_SEAL,
            "campaignSealSha256": _sha256_file(root / CAMPAIGN_SEAL),
            "campaignSourceSha256": base["campaignSourceSha256"],
            "recordedGitIdentity": base["campaign"]["git"],
        },
        "scope": {
            "scopeJsonPath": SCOPE_JSON,
            "scopeJsonSha256": scope["scopeSha256"],
            "scopeSealPath": SCOPE_SEAL,
            "scopeSealSha256": scope["scopeSealSha256"],
            "repositoryManifestPath": scope["repositoryManifestPath"],
            "archivedManifestPath": scope["archivedManifestPath"],
            "manifestSha256": scope["manifestSha256"],
            "selectedStateLimitation": scope["limitation"],
        },
        "sealedInputs": {
            "margins": {
                "path": MARGINS_JSON,
                "sha256": base["marginsSha256"],
                "sealPath": MARGINS_SEAL,
                "sealSha256": _sha256_file(root / MARGINS_SEAL),
            },
            "referenceDistribution": {
                "path": REFERENCE_JSON,
                "sha256": base["referenceSha256"],
                "sealPath": REFERENCE_SEAL,
                "sealSha256": _sha256_file(root / REFERENCE_SEAL),
            },
            "hq52BlockScore": {
                "path": CONTROL_SCORE_JSON,
                "sha256": EXPECTED_HQ52_SCORE_SHA256,
            },
            "hq52ControlReport": {
                "path": CONTROL_REPORT_JSON,
                "sha256": _sha256_file(control_path),
            },
        },
        "implementation": implementation_identity(),
        "environment": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "scipy": scipy.__version__,
        },
        "analysisContract": analysis_contract_payload(),
        "tests": tests,
        "assertions": {
            "hq52CompositeDifferenceExactlyZero": True,
            "hq52SixSentinelSeedMeanDifferencesExactlyZero": True,
            "hq52IsControlOnlyInsufficientAtN1": True,
            "noNonNoopCandidateScoreOpenedCalculatedDisplayedOrCreatedBeforeFreeze": True,
            "scopeSealVerified": True,
            "allPreexistingCampaignSealsVerified": True,
        },
    }
    freeze_bytes = sweep.canonical_json(payload)
    freeze_digest = hashlib.sha256(freeze_bytes).hexdigest()
    try:
        sweep.write_new(freeze_path, freeze_bytes)
        sweep.write_new(seal_path, (freeze_digest + "\n").encode("ascii"))
    except RuntimeError as error:
        raise AnalysisError(str(error)) from error
    verified = verify_analysis_freeze(root, base=base, scope=scope)
    return "created", verified


def _references_for_phase(
    campaign_root: Path,
    *,
    phase: PhaseSpec,
    base: Mapping[str, object],
) -> dict[str, Mapping[str, object]]:
    if phase.name == "discovery":
        all_reference = _reference_blocks(base["reference"])
        return {block_id: all_reference[block_id] for block_id in phase.block_ids}
    return reconstruct_confirmation_references(
        campaign_root,
        phase=phase,
        campaign_sha=base["campaignSha256"],
        profile=sweep.filtered_profile(),
    )


def build_block_comparisons(
    rows: Mapping[tuple[str, str], Mapping[str, object]],
    *,
    phase: PhaseSpec,
    expected_arms: Sequence[str],
    block_map: Mapping[str, Sequence[int]],
    references: Mapping[str, Mapping[str, object]],
) -> dict[str, list[dict[str, object]]]:
    comparisons: dict[str, list[dict[str, object]]] = {arm: [] for arm in expected_arms}
    for arm in expected_arms:
        for block_id in phase.block_ids:
            seeds = list(block_map[block_id])
            reference_block = references.get(block_id)
            if not isinstance(reference_block, dict) or not isinstance(reference_block.get("summary"), dict):
                raise AnalysisError(f"complete H64 reference summary is absent for {block_id}")
            reference_summary = reference_block["summary"]
            if arm == REFERENCE_ARM:
                comparison = compare_summaries(
                    reference_summary,
                    reference_summary,
                    expected_seeds=seeds,
                    label=f"{arm}.{block_id}",
                )
                source = {
                    "kind": "H64-self-comparison-for-safer-neighbour",
                    "candidateScorePath": None,
                    "candidateScoreSha256": None,
                }
            else:
                row = rows[(arm, block_id)]
                comparison = compare_summaries(
                    row["candidateSummary"],
                    reference_summary,
                    expected_seeds=seeds,
                    label=f"{arm}.{block_id}",
                )
                _verify_stored_composites(row, comparison, f"{arm}.{block_id}")
                source = {
                    "kind": "candidate-block-score",
                    "candidateScorePath": row["_sourcePath"],
                    "candidateScoreSha256": row["_sourceSha256"],
                }
            comparisons[arm].append(
                {
                    "arm": arm,
                    "blockId": block_id,
                    "seeds": seeds,
                    "referenceSource": (
                        "sealed-reference-distribution"
                        if phase.name == "discovery"
                        else "reconstructed-from-verified-immutable-H64-seed-outputs"
                    ),
                    **source,
                    **comparison,
                }
            )
    return comparisons


def statistical_reports_for_grid(
    comparisons: Mapping[str, Sequence[Mapping[str, object]]],
    *,
    margins: Mapping[str, object],
    bootstrap_resamples: int = BOOTSTRAP_RESAMPLES,
) -> dict[str, tuple[dict[str, object], str]]:
    if not comparisons:
        raise AnalysisError("statistical grid is empty")
    block_counts = {len(rows) for rows in comparisons.values()}
    if len(block_counts) != 1 or not block_counts or next(iter(block_counts)) <= 0:
        raise AnalysisError("all arms must have the same positive paired-block count")
    n = next(iter(block_counts))
    series: dict[str, Sequence[object]] = {}
    for arm, rows in comparisons.items():
        series[f"{arm}::composite"] = [row["pairedCompositeDifference"] for row in rows]
        for metric_id in METRIC_IDS:
            series[f"{arm}::metric::{metric_id}::seedMean"] = [
                _metric_rows_by_id(row)[metric_id]["ingredients"][PRIMARY_METRIC_FIELD]["difference"]
                for row in rows
            ]
    shared_indices = bootstrap_index_tuples(n, resamples=bootstrap_resamples, seed=BOOTSTRAP_SEED)
    bootstrap = bootstrap_intervals(series, shared_indices)
    return {
        arm: _arm_statistical_report(arm, rows, margins=margins, bootstrap=bootstrap)
        for arm, rows in comparisons.items()
    }


def verify_extension_trigger(
    campaign_root: Path,
    *,
    base: Mapping[str, object],
    freeze: Mapping[str, object],
    selection: Mapping[str, object],
) -> dict[str, object]:
    payload, trigger_sha = verify_sealed_file(
        campaign_root / EXTENSION_TRIGGER_JSON,
        campaign_root / EXTENSION_TRIGGER_SEAL,
    )
    try:
        trigger = json.loads(payload)
    except json.JSONDecodeError as error:
        raise AnalysisError("confirmation extension trigger is invalid JSON") from error
    expected_keys = {
        "schemaVersion",
        "artifactType",
        "campaignSha256",
        "campaignSourceSha256",
        "analysisFreezeSha256",
        "selectionSha256",
        "activationRule",
        "confirmationResult",
        "confirmationReport",
    }
    if not isinstance(trigger, dict) or set(trigger) != expected_keys:
        raise AnalysisError("confirmation extension trigger schema differs")
    direct = {
        "schemaVersion": 1,
        "artifactType": EXTENSION_TRIGGER_ARTIFACT_TYPE,
        "campaignSha256": base["campaignSha256"],
        "campaignSourceSha256": base["campaignSourceSha256"],
        "analysisFreezeSha256": freeze["freezeSha256"],
        "selectionSha256": selection["_selectionSha256"],
        "activationRule": "only-if-complete-confirmation-is-statistically-inconclusive",
        "confirmationResult": "inconclusive",
    }
    for key, value in direct.items():
        if trigger.get(key) != value:
            raise AnalysisError(f"confirmation extension trigger differs for {key}")
    report_identity = trigger.get("confirmationReport")
    if not isinstance(report_identity, dict) or set(report_identity) != {"path", "sha256"}:
        raise AnalysisError("confirmation extension trigger report identity differs")
    relative = report_identity.get("path")
    if not isinstance(relative, str):
        raise AnalysisError("confirmation extension report path must be campaign-relative")
    report_path = _campaign_path(campaign_root, relative)
    report_sha = report_identity.get("sha256")
    if not isinstance(report_sha, str) or _sha256_file(report_path) != report_sha:
        raise AnalysisError("confirmation report does not match the sealed extension trigger")
    report = _read_json(report_path)
    if (
        report.get("artifactType") != ANALYSIS_ARTIFACT_TYPE
        or report.get("phase") != "confirmation"
        or report.get("campaign", {}).get("campaignSha256") != base["campaignSha256"]
        or report.get("analysisProgram", {}).get("analysisFreezeSha256") != freeze["freezeSha256"]
        or report.get("mechanicalResult", {}).get("status") != "inconclusive"
        or report.get("mechanicalResult", {}).get("extensionEligible") is not True
    ):
        raise AnalysisError("sealed trigger does not identify a complete inconclusive confirmation")
    trigger["_triggerSha256"] = trigger_sha
    trigger["_confirmationReportDocument"] = report
    trigger["_confirmationReportPath"] = report_path
    return trigger


def _prior_confirmation_inputs(
    trigger: Mapping[str, object], expected_arms: Sequence[str]
) -> list[Path]:
    report = trigger["_confirmationReportDocument"]
    inputs = report.get("inputArtifacts", {}).get("candidateBlockScores")
    if not isinstance(inputs, list) or not inputs:
        raise AnalysisError("triggered confirmation report has no candidate block-score identities")
    paths: list[Path] = []
    for row in inputs:
        if not isinstance(row, dict) or not isinstance(row.get("path"), str) or not isinstance(row.get("sha256"), str):
            raise AnalysisError("triggered confirmation input identity is malformed")
        path = Path(row["path"])
        if _sha256_file(path) != row["sha256"]:
            raise AnalysisError("triggered confirmation candidate input hash drifted")
        paths.append(path)
    reported_arms = {row.get("arm") for row in report.get("arms", []) if isinstance(row, dict)}
    if reported_arms != set(expected_arms):
        raise AnalysisError("triggered confirmation report arm grid differs")
    return paths


def _combine_run_evidence(
    earlier: Mapping[str, Mapping[str, object]],
    later: Mapping[str, Mapping[str, object]],
) -> dict[str, dict[str, object]]:
    combined: dict[str, dict[str, object]] = {}
    for arm in earlier:
        left = earlier[arm]
        right = later[arm]
        reasons = sorted(set((*left.get("reasonCodes", []), *right.get("reasonCodes", []))))
        combined[arm] = {
            "status": (
                "fail"
                if left.get("status") == "fail" or right.get("status") == "fail"
                else "eligible-pending-replay"
            ),
            "reasonCodes": reasons,
            "candidateRuns": [*left.get("candidateRuns", []), *right.get("candidateRuns", [])],
            "referenceRuns": [*left.get("referenceRuns", []), *right.get("referenceRuns", [])],
            "allSeventeenFieldsAttemptedInEveryRequiredRun": bool(
                left.get("allSeventeenFieldsAttemptedInEveryRequiredRun")
                and right.get("allSeventeenFieldsAttemptedInEveryRequiredRun")
            ),
            "changedWritesAreDescriptiveOnly": True,
            "failureArtifactFinding": (
                "conflict-found"
                if left.get("failureArtifactFinding") == "conflict-found"
                or right.get("failureArtifactFinding") == "conflict-found"
                else "none-found"
            ),
            "combinedPhases": ["confirmation", "confirmation-extension"],
        }
    return combined


def run_analysis(
    *,
    campaign_root: Path,
    phase_name: str,
    candidate_paths: Sequence[Path],
    replay_path: Path,
    replay_seal: Path,
    output_path: Path,
) -> dict[str, object]:
    # Result-bearing paths are intentionally untouched until this entire gate succeeds.
    root = resolve_canonical_campaign_root(campaign_root)
    base, scope, freeze = verify_analysis_gate(root)
    phase = PHASES[phase_name]
    output = output_path.expanduser().resolve()
    if output.exists():
        raise AnalysisError(f"refusing to overwrite analysis report: {output}")

    selection: dict[str, object] | None = None
    extension_trigger: dict[str, object] | None = None
    if phase.name == "discovery":
        expected_arms = DISCOVERY_CANDIDATES
    else:
        selection = verify_selection(root, base=base, scope=scope, freeze=freeze)
        expected_arms = (str(selection["selectedArm"]), str(selection["saferNeighbour"]))
        if phase.name == "confirmation-extension":
            extension_trigger = verify_extension_trigger(
                root, base=base, freeze=freeze, selection=selection
            )

    block_map = _phase_block_map(base["campaign"], phase)
    rows, input_files = load_candidate_score_rows(
        candidate_paths,
        phase=phase,
        expected_arms=expected_arms,
        campaign_sha=base["campaignSha256"],
        margins_sha=base["marginsSha256"],
        block_map=block_map,
    )
    references = _references_for_phase(root, phase=phase, base=base)
    comparisons = build_block_comparisons(
        rows,
        phase=phase,
        expected_arms=expected_arms,
        block_map=block_map,
        references=references,
    )
    run_evidence = collect_phase_run_evidence(
        root, expected_arms=expected_arms, phase=phase, base=base
    )

    analysed_blocks = list(phase.block_ids)
    analysed_seeds = list(phase.seeds)
    if extension_trigger is not None:
        earlier_phase = PHASES["confirmation"]
        earlier_map = _phase_block_map(base["campaign"], earlier_phase)
        earlier_paths = _prior_confirmation_inputs(extension_trigger, expected_arms)
        earlier_rows, _ = load_candidate_score_rows(
            earlier_paths,
            phase=earlier_phase,
            expected_arms=expected_arms,
            campaign_sha=base["campaignSha256"],
            margins_sha=base["marginsSha256"],
            block_map=earlier_map,
        )
        earlier_references = _references_for_phase(root, phase=earlier_phase, base=base)
        earlier_comparisons = build_block_comparisons(
            earlier_rows,
            phase=earlier_phase,
            expected_arms=expected_arms,
            block_map=earlier_map,
            references=earlier_references,
        )
        comparisons = {
            arm: [*earlier_comparisons[arm], *comparisons[arm]] for arm in expected_arms
        }
        earlier_evidence = collect_phase_run_evidence(
            root, expected_arms=expected_arms, phase=earlier_phase, base=base
        )
        run_evidence = _combine_run_evidence(earlier_evidence, run_evidence)
        analysed_blocks = [*earlier_phase.block_ids, *phase.block_ids]
        analysed_seeds = [*earlier_phase.seeds, *phase.seeds]

    statistics_by_arm = statistical_reports_for_grid(
        comparisons, margins=base["margins"], bootstrap_resamples=BOOTSTRAP_RESAMPLES
    )
    replay_by_arm, replay_error, replay_status = replay_eligibility(
        root,
        replay_path=replay_path.expanduser().resolve(),
        replay_seal=replay_seal.expanduser().resolve(),
        phase=phase,
        expected_arms=expected_arms,
        base=base,
    )
    arm_reports: list[dict[str, object]] = []
    decisions: dict[str, str] = {}
    for arm in expected_arms:
        statistical_report, statistical_classification = statistics_by_arm[arm]
        replay = replay_by_arm.get(arm)
        if arm == REFERENCE_ARM:
            replay = {
                "status": "verified",
                "notRequired": True,
                "reason": "H64 is the paired reference and not a replay-required candidate",
            }
        decision, eligibility = _final_arm_decision(
            statistical_classification,
            run_evidence[arm],
            replay,
            replay_status,
        )
        decisions[arm] = decision
        arm_reports.append(
            {
                "arm": arm,
                "blocks": comparisons[arm],
                "statisticalAnalysis": statistical_report,
                "evidenceEligibility": eligibility,
                "finalDecision": decision,
            }
        )
    if phase.name == "discovery":
        mechanical = nested_discovery_selection(decisions)
    else:
        assert selection is not None
        mechanical = confirmation_decision(
            str(selection["selectedArm"]), str(selection["saferNeighbour"]), decisions
        )
        if phase.name == "confirmation-extension":
            mechanical["combinedBlocks"] = analysed_blocks
            mechanical["combinationRule"] = "pool-paired-block-vectors-B21-through-B36"
            mechanical["extensionEligible"] = False

    report = {
        "schemaVersion": SCHEMA_VERSION,
        "artifactType": ANALYSIS_ARTIFACT_TYPE,
        "campaign": {
            "campaignRoot": str(root),
            "campaignSha256": base["campaignSha256"],
            "campaignSourceSha256": base["campaignSourceSha256"],
            "scopeFreezeSha256": scope["scopeSha256"],
            "scopeManifestSha256": scope["manifestSha256"],
            "marginsSha256": base["marginsSha256"],
            "referenceSha256": base["referenceSha256"],
            "substrate": SUBSTRATE,
            "frontier": FRONTIER,
            "runtimeFieldSet": RUNTIME_FIELD_SET,
        },
        "analysisProgram": {
            "path": ANALYSIS_PROGRAM_PATH,
            "sha256": _sha256_file(_repo_path(ANALYSIS_PROGRAM_PATH)),
            "analysisFreezeSha256": freeze["freezeSha256"],
        },
        "phase": phase.name,
        "inputPhase": {
            "blocks": list(phase.block_ids),
            "seeds": list(phase.seeds),
            "blockMap": block_map,
        },
        "analysedBlockMap": {
            "blocks": analysed_blocks,
            "seeds": analysed_seeds,
            "pairedBlockCount": len(analysed_blocks),
        },
        "armRegistry": list(expected_arms),
        "metricRegistry": list(METRIC_IDS),
        "sentinelRegistry": list(SENTINEL_IDS),
        "primarySentinelField": PRIMARY_METRIC_FIELD,
        "inputArtifacts": {
            "candidateBlockScores": input_files,
            "replayEvidence": {
                "path": str(replay_path.expanduser().resolve()),
                "sealPath": str(replay_seal.expanduser().resolve()),
                "status": replay_status,
                "error": replay_error,
            },
            "selection": (
                None
                if selection is None
                else {"path": SELECTION_JSON, "sha256": selection["_selectionSha256"]}
            ),
            "extensionTrigger": (
                None
                if extension_trigger is None
                else {
                    "path": EXTENSION_TRIGGER_JSON,
                    "sha256": extension_trigger["_triggerSha256"],
                }
            ),
        },
        "arms": arm_reports,
        "mechanicalResult": mechanical,
        "selectionGuard": {
            "bootstrapAffectedSelection": False,
            "nonSentinelMetricsAffectedSelection": False,
            "onlyCompositeAndSixSentinelSeedMeanEndpointsAffectedStatisticalSelection": True,
            "correctnessReplayAndProvenanceRemainMandatoryEligibilityGates": True,
        },
    }
    payload = sweep.canonical_json(report)
    try:
        sweep.write_new(output, payload)
    except RuntimeError as error:
        raise AnalysisError(str(error)) from error
    return report


def _print_analysis_table(report: Mapping[str, object]) -> None:
    print("arm\tdecision\tcomposite_mean\tci90_lower\tci90_upper")
    for arm in report["arms"]:
        composite = arm["statisticalAnalysis"]["primaryEndpoints"]["composite"]
        interval = composite["ci90"]
        print(
            f"{arm['arm']}\t{arm['finalDecision']}\t{composite['mean']:.12g}\t"
            f"{interval['lower']:.12g}\t{interval['upper']:.12g}"
        )
    result = report["mechanicalResult"]
    print(
        f"result\t{result['status']}\trecommendation="
        f"{result.get('recommendedArm') or 'none'}"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    control = subparsers.add_parser(
        "preflight-control", help="Verify and materialize only the real HQ52 B01 no-op control"
    )
    control.add_argument("--campaign-root", type=Path, required=True)

    analyse = subparsers.add_parser(
        "analyse", help="Apply the sealed method to an exact post-freeze candidate phase"
    )
    analyse.add_argument("--campaign-root", type=Path, required=True)
    analyse.add_argument("--phase", choices=tuple(PHASES), required=True)
    analyse.add_argument(
        "--candidate-block-score", type=Path, action="append", required=True
    )
    analyse.add_argument("--replay-evidence", type=Path, required=True)
    analyse.add_argument("--replay-seal", type=Path, required=True)
    analyse.add_argument("--output", type=Path, required=True)

    freeze = subparsers.add_parser(
        "freeze", help="Verify scope/control/tests and create or verify the analysis freeze"
    )
    freeze.add_argument("--campaign-root", type=Path, required=True)
    return parser


def dispatch(args: argparse.Namespace) -> int:
    if args.command == "preflight-control":
        state, _ = preflight_control(args.campaign_root)
        print(
            "HQ52 B01 analysis control "
            f"{state}: composite delta=0; six sentinel seedMean deltas=0; "
            "n=1 control-only/insufficient"
        )
        return 0
    if args.command == "freeze":
        state, freeze = create_analysis_freeze(args.campaign_root)
        print(
            f"Analysis freeze {state}: sha256={freeze['freezeSha256']} "
            f"tests={sum(row['testCount'] for row in freeze['tests'])}"
        )
        return 0
    if args.command == "analyse":
        report = run_analysis(
            campaign_root=args.campaign_root,
            phase_name=args.phase,
            candidate_paths=args.candidate_block_score,
            replay_path=args.replay_evidence,
            replay_seal=args.replay_seal,
            output_path=args.output,
        )
        _print_analysis_table(report)
        return 0
    raise AssertionError(args.command)


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return dispatch(args)
    except (AnalysisError, OSError, ValueError, KeyError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
