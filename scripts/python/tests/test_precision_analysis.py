from __future__ import annotations

import copy
import hashlib
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.python.experiments.model import precision_analysis as analysis
from scripts.python.experiments.model import precision_sweep as sweep
from scripts.python.validation.model.scoring import compute_overall_composite_loss


def synthetic_metric(metric_id: str, index: int, *, seed_mean: float = 0.0) -> dict[str, object]:
    metric_loss = 0.2 + index / 100.0
    return {
        "metricId": metric_id,
        "label": f"Synthetic {metric_id}",
        "requirement": "required",
        "units": "synthetic-units",
        "sourceLabel": "synthetic source",
        "sourceIndicatorLabel": "synthetic indicator",
        "sourceDocumentPath": "synthetic.pdf",
        "sourceTextPath": "synthetic.txt",
        "sourceTable": "table 1",
        "sourcePage": 1,
        "rawSourceValue": 5.0,
        "sourceValue": 5.0,
        "sourceAsOf": "synthetic",
        "sourceUnits": "synthetic-units",
        "comparisonUnits": "synthetic-comparison-units",
        "mappingStatus": "synthetic",
        "bandMethod": "synthetic",
        "bandNotes": "synthetic fixture only",
        "sourceReferences": [],
        "targetBand": {"lower": -10.0, "upper": 10.0},
        "seedMean": seed_mean,
        "p25": seed_mean - 0.25,
        "p75": seed_mean + 0.25,
        "insideRate": 1.0,
        "lossFamily": "signed_additive",
        "lossTransform": "additive_distance",
        "lossScale": 5.0,
        "lossScaleBasis": "source_value",
        "additiveScale": 5.0,
        "additiveScaleBasis": "source_value",
        "normalizedDistance": 0.0,
        "normalizedIqr": 0.1,
        "distanceComponent": 0.0,
        "spreadComponent": 0.025,
        "levelComponent": 0.0,
        "insideRateComponent": 0.0,
        "metricLoss": metric_loss,
        "metricWeight": 1.0,
        "status": "pass",
    }


def synthetic_summary(
    seeds: list[int],
    *,
    seed_mean_delta: float = 0.0,
    metric_loss_delta: float = 0.0,
) -> dict[str, object]:
    metrics = [
        synthetic_metric(metric_id, index, seed_mean=index + seed_mean_delta)
        for index, metric_id in enumerate(analysis.METRIC_IDS)
    ]
    for metric in metrics:
        metric["metricLoss"] = float(metric["metricLoss"]) + metric_loss_delta
    composite = compute_overall_composite_loss(
        metric_losses=[float(metric["metricLoss"]) for metric in metrics],
        metric_weights=[float(metric["metricWeight"]) for metric in metrics],
    )
    return {
        "schemaVersion": 4,
        "version": "v5o3",
        "validationTargetYear": 2024,
        "generatedAt": "2026-09-04T00:00:00Z",
        "seeds": seeds,
        "window": {"startIndex": 200, "endIndex": 2000},
        "overallCompositeLoss": composite,
        "metrics": metrics,
    }


def refresh_composite(summary: dict[str, object]) -> None:
    metrics = summary["metrics"]
    summary["overallCompositeLoss"] = compute_overall_composite_loss(
        metric_losses=[float(metric["metricLoss"]) for metric in metrics],
        metric_weights=[float(metric["metricWeight"]) for metric in metrics],
    )


def synthetic_campaign() -> dict[str, object]:
    return {
        "protocol": {
            "steps": 2000,
            "population": 10000,
        },
        "fixedBlocks": {
            f"B{index:02d}": list(range(1 + (index - 1) * 8, 1 + index * 8))
            for index in range(1, 37)
        },
    }


def synthetic_margins(value: float = 1.0) -> dict[str, object]:
    return {
        "compositeMargin": value,
        "rawMetricMargins": {metric_id: value for metric_id in analysis.METRIC_IDS},
    }


def comparison_for_block(block_id: str, seeds: list[int], delta: float) -> dict[str, object]:
    reference = synthetic_summary(seeds)
    candidate = synthetic_summary(seeds, seed_mean_delta=delta, metric_loss_delta=delta)
    comparison = analysis.compare_summaries(
        candidate, reference, expected_seeds=seeds, label=f"synthetic.{block_id}"
    )
    return {"arm": "HQ51", "blockId": block_id, "seeds": seeds, **comparison}


def score_document(
    rows: list[dict[str, object]],
    *,
    campaign_sha: str = "a" * 64,
    margins_sha: str = "b" * 64,
    status: str = "exploratory",
) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "artifactType": "precision-candidate-block-scores",
        "campaignSha256": campaign_sha,
        "marginsSha256": margins_sha,
        "status": status,
        "rows": rows,
    }


def score_row(arm: str, block_id: str, seeds: list[int], delta: float = 0.0) -> dict[str, object]:
    reference = synthetic_summary(seeds)
    candidate = synthetic_summary(seeds, seed_mean_delta=delta, metric_loss_delta=delta)
    return {
        "arm": arm,
        "blockId": block_id,
        "seeds": seeds,
        "referenceCompositeLoss": reference["overallCompositeLoss"],
        "candidateCompositeLoss": candidate["overallCompositeLoss"],
        "pairedCompositeDifference": float(candidate["overallCompositeLoss"])
        - float(reference["overallCompositeLoss"]),
        "candidateSummary": candidate,
    }


def write_synthetic_run(
    root: Path,
    *,
    arm: str,
    seed: int,
    relative_parent: str,
    campaign_sha: str,
) -> Path:
    seed_root = root / relative_parent
    seed_root.mkdir(parents=True, exist_ok=True)
    (seed_root / "Output-run1.csv").write_text("synthetic scientific output\n", encoding="utf-8")
    (seed_root / sweep.PRECISION_WRITES_FILE).write_text(
        "field,writes,changedWrites\n" + "\n".join(
            f"{field},1,0" for field in sweep.EXPECTED_PRECISION_FIELDS
        )
        + "\n",
        encoding="utf-8",
    )
    files = sweep.tree_inventory(seed_root)
    scientific = sweep.tree_inventory(seed_root, scientific_only=True)
    arm_spec = sweep.ARM_REGISTRY[arm]
    record = {
        "schemaVersion": 1,
        "artifactType": "precision-storage-seed-run",
        "campaignSha256": campaign_sha,
        "arm": arm,
        "seed": seed,
        "status": "complete",
        "exitCode": 0,
        "request": {
            "version": "v5o3",
            "steps": 2000,
            "population": 10000,
            "orderBook": "array",
            "rngMode": "philox-household",
            "precision": arm_spec.mode,
            "mantissaBits": arm_spec.mantissa_bits,
            "precisionFieldSet": analysis.RUNTIME_FIELD_SET,
            "precisionDiagnostics": True,
            "precisionGateTrace": False,
            "precisionProbe": "off",
        },
        "observedMetadata": {
            "rng": {
                "rngMode": "philox-household",
                "rngAddressVersion": "1",
                "masterSeed": str(seed),
            },
            "model": {"orderBook": "array"},
            "precision": {
                "precision": arm_spec.mode,
                "mantissaBits": str(arm_spec.mantissa_bits),
                "fieldSet": analysis.RUNTIME_FIELD_SET,
                "diagnostics": "true",
            },
        },
        "scientificTreeSha256": sweep.inventory_hash(scientific),
        "files": files,
    }
    sidecar = seed_root / sweep.RUN_FILE
    sidecar.write_bytes(sweep.canonical_json(record))
    return sidecar


class EndpointInferenceTest(unittest.TestCase):
    def test_mean_sample_sd_se_tcritical_and_ci_match_independent_values(self) -> None:
        result = analysis.endpoint_inference([1.0, 2.0, 3.0, 4.0], 10.0)
        self.assertEqual(result["mean"], 2.5)
        self.assertAlmostEqual(result["sampleSD"], 1.2909944487358056, places=15)
        self.assertAlmostEqual(result["standardError"], 0.6454972243679028, places=15)
        self.assertAlmostEqual(result["tCritical"], 2.353363434801826, places=15)
        self.assertAlmostEqual(result["ci90"]["lower"], 0.9809104349065074, places=15)
        self.assertAlmostEqual(result["ci90"]["upper"], 4.019089565093493, places=15)

    def test_ordinary_pass_fail_and_inconclusive(self) -> None:
        self.assertEqual(analysis.endpoint_inference([0.1] * 8, 1.0)["classification"], "pass")
        self.assertEqual(analysis.endpoint_inference([1.0] * 8, 1.0)["classification"], "fail")
        values = [-2.0, 2.0] * 4
        self.assertEqual(analysis.endpoint_inference(values, 1.0)["classification"], "inconclusive")

    def test_interval_touching_boundary_is_not_pass(self) -> None:
        values = [-0.5, 0.5] * 4
        provisional = analysis.endpoint_inference(values, 10.0)
        margin = provisional["ci90"]["upper"]
        result = analysis.endpoint_inference(values, margin)
        self.assertEqual(result["ci90"]["upper"], margin)
        self.assertEqual(result["classification"], "inconclusive")

    def test_tost_values_match_independent_formula(self) -> None:
        result = analysis.endpoint_inference([1.0, 2.0, 3.0, 4.0], 10.0)
        self.assertAlmostEqual(result["tost"]["tLower"], 19.364916731037084, places=14)
        self.assertAlmostEqual(result["tost"]["pLower"], 0.0001503973779064527, places=16)
        self.assertAlmostEqual(result["tost"]["tUpper"], -11.61895003862225, places=14)
        self.assertAlmostEqual(result["tost"]["pUpper"], 0.000684665618440538, places=16)

    def test_zero_standard_error_p_values(self) -> None:
        favourable = analysis.endpoint_inference([0.0] * 8, 1.0)["tost"]
        self.assertEqual((favourable["pLower"], favourable["pUpper"]), (0.0, 0.0))
        lower_equal = analysis.endpoint_inference([-1.0] * 8, 1.0)["tost"]
        self.assertEqual((lower_equal["pLower"], lower_equal["pUpper"]), (0.5, 0.0))
        lower_bad = analysis.endpoint_inference([-2.0] * 8, 1.0)["tost"]
        self.assertEqual(lower_bad["pLower"], 1.0)
        upper_equal = analysis.endpoint_inference([1.0] * 8, 1.0)["tost"]
        self.assertEqual((upper_equal["pLower"], upper_equal["pUpper"]), (0.0, 0.5))
        upper_bad = analysis.endpoint_inference([2.0] * 8, 1.0)["tost"]
        self.assertEqual(upper_bad["pUpper"], 1.0)

    def test_n_one_is_control_only_and_insufficient(self) -> None:
        result = analysis.endpoint_inference([0.0], 1.0)
        self.assertEqual(result["classification"], "insufficient")
        self.assertEqual(result["inferenceStatus"], "control-only")
        self.assertIsNone(result["sampleSD"])
        self.assertEqual(result["ci90"], {"lower": None, "upper": None})
        self.assertIsNone(result["tost"])

    def test_zero_margin_exact_equality_rule(self) -> None:
        equal = analysis.endpoint_inference([0.0] * 8, 0.0)
        unequal = analysis.endpoint_inference([0.0] * 7 + [1e-300], 0.0)
        self.assertEqual(equal["classification"], "pass")
        self.assertEqual(equal["rule"], "zero-margin-exact-equality")
        self.assertEqual(unequal["classification"], "fail")
        self.assertIsNone(equal["tost"])

    def test_rejects_nonfinite_boolean_missing_and_invalid_margins(self) -> None:
        invalid_values = [math.nan, math.inf, -math.inf, True, None]
        for value in invalid_values:
            with self.subTest(value=value), self.assertRaises(analysis.AnalysisError):
                analysis.endpoint_inference([0.0, value], 1.0)
        for margin in (math.nan, math.inf, -1.0, True, None):
            with self.subTest(margin=margin), self.assertRaises(analysis.AnalysisError):
                analysis.endpoint_inference([0.0, 0.0], margin)
        with self.assertRaises(analysis.AnalysisError):
            analysis.endpoint_inference([], 1.0)


class BootstrapTest(unittest.TestCase):
    def test_seeded_indices_are_reproducible_and_whole_block(self) -> None:
        first = analysis.bootstrap_index_tuples(3, resamples=5, seed=analysis.BOOTSTRAP_SEED)
        second = analysis.bootstrap_index_tuples(3, resamples=5, seed=analysis.BOOTSTRAP_SEED)
        self.assertEqual(first, second)
        self.assertEqual(len(first), 5)
        self.assertTrue(all(len(draw) == 3 and all(0 <= index < 3 for index in draw) for draw in first))

    def test_shared_indices_preserve_joint_endpoint_scaling(self) -> None:
        indices = analysis.bootstrap_index_tuples(4, resamples=101, seed=17)
        intervals = analysis.bootstrap_intervals(
            {"x": [1.0, 2.0, 4.0, 8.0], "ten_x": [10.0, 20.0, 40.0, 80.0]},
            indices,
        )
        self.assertAlmostEqual(intervals["ten_x"]["lower"], 10 * intervals["x"]["lower"])
        self.assertAlmostEqual(intervals["ten_x"]["upper"], 10 * intervals["x"]["upper"])
        self.assertEqual(intervals["x"]["resamples"], 101)

    def test_linear_percentile_interpolation(self) -> None:
        values = [0.0, 10.0, 20.0, 30.0]
        self.assertEqual(analysis.linear_percentile(values, 0.25), 7.5)
        self.assertAlmostEqual(analysis.linear_percentile(values, 0.05), 1.5)
        self.assertAlmostEqual(analysis.linear_percentile(values, 0.95), 28.5)

    def test_bootstrap_rejects_independent_or_malformed_draws(self) -> None:
        with self.assertRaises(analysis.AnalysisError):
            analysis.bootstrap_intervals({"a": [1, 2], "b": [1]}, [(0, 1)])
        with self.assertRaises(analysis.AnalysisError):
            analysis.bootstrap_intervals({"a": [1, 2]}, [(0,)])


class SummarySchemaTest(unittest.TestCase):
    def setUp(self) -> None:
        self.seeds = list(range(1, 9))
        self.reference = synthetic_summary(self.seeds)

    def test_exact_seventeen_metric_registry(self) -> None:
        metric_map, _ = analysis.validate_summary_schema(
            self.reference, expected_seeds=self.seeds, label="fixture"
        )
        self.assertEqual(set(metric_map), set(analysis.METRIC_IDS))
        self.assertEqual(len(metric_map), 17)

    def test_missing_duplicate_and_unexpected_metric_rejected(self) -> None:
        missing = copy.deepcopy(self.reference)
        missing["metrics"].pop()
        duplicate = copy.deepcopy(self.reference)
        duplicate["metrics"][-1]["metricId"] = duplicate["metrics"][0]["metricId"]
        unexpected = copy.deepcopy(self.reference)
        unexpected["metrics"][-1]["metricId"] = "unexpected_metric"
        for name, summary in (("missing", missing), ("duplicate", duplicate), ("unexpected", unexpected)):
            with self.subTest(name=name), self.assertRaises(analysis.AnalysisError):
                analysis.validate_summary_schema(summary, expected_seeds=self.seeds, label=name)

    def test_unit_and_immutable_scoring_metadata_mismatch_rejected(self) -> None:
        candidate = copy.deepcopy(self.reference)
        candidate["metrics"][0]["comparisonUnits"] = "wrong-units"
        with self.assertRaisesRegex(analysis.AnalysisError, "immutable scoring metadata"):
            analysis.compare_summaries(
                candidate, self.reference, expected_seeds=self.seeds, label="units"
            )

    def test_unclassified_numeric_component_rejected(self) -> None:
        candidate = copy.deepcopy(self.reference)
        candidate["metrics"][0]["newModelLossComponent"] = 0.25
        with self.assertRaisesRegex(analysis.AnalysisError, "unclassified numeric"):
            analysis.validate_summary_schema(candidate, expected_seeds=self.seeds, label="new")

    def test_reordered_metric_rows_rejected(self) -> None:
        candidate = copy.deepcopy(self.reference)
        candidate["metrics"][0], candidate["metrics"][1] = (
            candidate["metrics"][1],
            candidate["metrics"][0],
        )
        refresh_composite(candidate)
        with self.assertRaisesRegex(analysis.AnalysisError, "reordered"):
            analysis.compare_summaries(
                candidate, self.reference, expected_seeds=self.seeds, label="order"
            )

    def test_composite_is_recomputed_not_trusted(self) -> None:
        candidate = copy.deepcopy(self.reference)
        candidate["overallCompositeLoss"] = float(candidate["overallCompositeLoss"]) + 1.0
        with self.assertRaisesRegex(analysis.AnalysisError, "does not recompute"):
            analysis.compare_summaries(
                candidate, self.reference, expected_seeds=self.seeds, label="composite"
            )

    def test_all_numeric_ingredients_and_status_changes_are_reported(self) -> None:
        candidate = copy.deepcopy(self.reference)
        candidate["metrics"][0]["seedMean"] = float(candidate["metrics"][0]["seedMean"]) + 0.5
        candidate["metrics"][0]["status"] = "warn"
        comparison = analysis.compare_summaries(
            candidate, self.reference, expected_seeds=self.seeds, label="report"
        )
        row = {item["metricId"]: item for item in comparison["metrics"]}[analysis.METRIC_IDS[0]]
        self.assertEqual(tuple(row["ingredients"]), analysis.NUMERIC_SCORING_FIELDS)
        self.assertEqual(row["ingredients"]["seedMean"]["difference"], 0.5)
        self.assertEqual(len(comparison["statusChanges"]), 1)

    def test_stored_duplicate_composites_are_cross_checked(self) -> None:
        comparison = analysis.compare_summaries(
            self.reference, self.reference, expected_seeds=self.seeds, label="stored"
        )
        row = {
            "referenceCompositeLoss": comparison["referenceCompositeLoss"],
            "candidateCompositeLoss": comparison["candidateCompositeLoss"],
            "pairedCompositeDifference": 0.1,
        }
        with self.assertRaisesRegex(analysis.AnalysisError, "recomputed"):
            analysis._verify_stored_composites(row, comparison, "stored")


class StatisticalGridTest(unittest.TestCase):
    def test_synthetic_eight_block_analysis_and_seedmean_sentinel(self) -> None:
        rows = []
        for index in range(1, 9):
            seeds = list(range(1 + (index - 1) * 8, 1 + index * 8))
            rows.append(comparison_for_block(f"B{index:02d}", seeds, 0.05))
        reports = analysis.statistical_reports_for_grid(
            {"HQ51": rows}, margins=synthetic_margins(1.0), bootstrap_resamples=301
        )
        report, classification = reports["HQ51"]
        self.assertEqual(classification, "pass")
        self.assertEqual(report["primaryEndpoints"]["composite"]["n"], 8)
        for sentinel in analysis.SENTINEL_IDS:
            endpoint = report["primaryEndpoints"][sentinel]
            self.assertEqual(endpoint["field"], "seedMean")
            self.assertEqual(endpoint["classification"], "pass")
            self.assertEqual(endpoint["bootstrapSensitivityCI90"]["resamples"], 301)

    def test_sentinel_gate_uses_seedmean_not_other_ingredients(self) -> None:
        rows = []
        for index in range(1, 9):
            seeds = list(range(1 + (index - 1) * 8, 1 + index * 8))
            reference = synthetic_summary(seeds)
            candidate = copy.deepcopy(reference)
            for metric in candidate["metrics"]:
                if metric["metricId"] in analysis.SENTINEL_IDS:
                    metric["p25"] = float(metric["p25"]) + 1000.0
                    metric["p75"] = float(metric["p75"]) + 1000.0
                    metric["insideRate"] = 0.0
                    metric["metricLoss"] = float(metric["metricLoss"]) + 1000.0
            refresh_composite(candidate)
            comparison = analysis.compare_summaries(
                candidate, reference, expected_seeds=seeds, label=f"sentinel.B{index:02d}"
            )
            rows.append({"arm": "HQ51", "blockId": f"B{index:02d}", "seeds": seeds, **comparison})
        report, _ = analysis.statistical_reports_for_grid(
            {"HQ51": rows}, margins=synthetic_margins(1.0), bootstrap_resamples=51
        )["HQ51"]
        self.assertEqual(report["primaryEndpoints"]["composite"]["classification"], "fail")
        for sentinel in analysis.SENTINEL_IDS:
            self.assertEqual(report["primaryEndpoints"][sentinel]["classification"], "pass")


class PhaseAndInputGridTest(unittest.TestCase):
    def test_exact_phase_block_and_seed_maps(self) -> None:
        expected = {
            "discovery": ("B01", "B08", 1, 64),
            "confirmation": ("B21", "B28", 161, 224),
            "confirmation-extension": ("B29", "B36", 225, 288),
        }
        campaign = synthetic_campaign()
        for name, (first_block, last_block, first_seed, last_seed) in expected.items():
            with self.subTest(phase=name):
                spec = analysis.PHASES[name]
                mapping = analysis._phase_block_map(campaign, spec)
                self.assertEqual((spec.block_ids[0], spec.block_ids[-1]), (first_block, last_block))
                self.assertEqual((spec.seeds[0], spec.seeds[-1]), (first_seed, last_seed))
                self.assertEqual(mapping[first_block][0], first_seed)
                self.assertEqual(mapping[last_block][-1], last_seed)

    def _complete_rows(self, arms: tuple[str, ...], phase: analysis.PhaseSpec) -> list[dict[str, object]]:
        campaign = synthetic_campaign()
        mapping = analysis._phase_block_map(campaign, phase)
        return [score_row(arm, block_id, mapping[block_id]) for arm in arms for block_id in phase.block_ids]

    def test_complete_grid_loads_and_duplicate_missing_extra_reject(self) -> None:
        phase = analysis.PHASES["discovery"]
        arms = analysis.DISCOVERY_CANDIDATES
        mapping = analysis._phase_block_map(synthetic_campaign(), phase)
        complete = self._complete_rows(arms, phase)
        cases = {
            "duplicate": [*complete, copy.deepcopy(complete[0])],
            "missing": complete[:-1],
            "extra": [*complete, score_row("HQ52", "B01", mapping["B01"])],
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            valid_path = root / "valid.json"
            valid_path.write_bytes(sweep.canonical_json(score_document(complete)))
            loaded, inputs = analysis.load_candidate_score_rows(
                [valid_path],
                phase=phase,
                expected_arms=arms,
                campaign_sha="a" * 64,
                margins_sha="b" * 64,
                block_map=mapping,
            )
            self.assertEqual(len(loaded), 24)
            self.assertEqual(inputs[0]["rowCount"], 24)
            for name, rows in cases.items():
                path = root / f"{name}.json"
                path.write_bytes(sweep.canonical_json(score_document(rows)))
                with self.subTest(name=name), self.assertRaises(analysis.AnalysisError):
                    analysis.load_candidate_score_rows(
                        [path],
                        phase=phase,
                        expected_arms=arms,
                        campaign_sha="a" * 64,
                        margins_sha="b" * 64,
                        block_map=mapping,
                    )

    def test_campaign_margins_and_hash_identity_mismatches_reject(self) -> None:
        phase = analysis.PHASES["discovery"]
        mapping = analysis._phase_block_map(synthetic_campaign(), phase)
        rows = self._complete_rows(analysis.DISCOVERY_CANDIDATES, phase)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, document in (
                ("campaign", score_document(rows, campaign_sha="c" * 64)),
                ("margins", score_document(rows, margins_sha="d" * 64)),
            ):
                path = root / f"{name}.json"
                path.write_bytes(sweep.canonical_json(document))
                with self.subTest(name=name), self.assertRaises(analysis.AnalysisError):
                    analysis.load_candidate_score_rows(
                        [path],
                        phase=phase,
                        expected_arms=analysis.DISCOVERY_CANDIDATES,
                        campaign_sha="a" * 64,
                        margins_sha="b" * 64,
                        block_map=mapping,
                    )

    def test_loose_scorer_label_cannot_activate_wrong_seed_range(self) -> None:
        phase = analysis.PHASES["discovery"]
        mapping = analysis._phase_block_map(synthetic_campaign(), phase)
        misleading = [score_row("HQ51", "B21", list(range(161, 169)))]
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "misleading.json"
            path.write_bytes(sweep.canonical_json(score_document(misleading, status="exploratory")))
            with self.assertRaisesRegex(analysis.AnalysisError, "exact discovery grid"):
                analysis.load_candidate_score_rows(
                    [path],
                    phase=phase,
                    expected_arms=analysis.DISCOVERY_CANDIDATES,
                    campaign_sha="a" * 64,
                    margins_sha="b" * 64,
                    block_map=mapping,
                )

    def test_confirmation_extension_not_accepted_as_confirmation(self) -> None:
        confirmation = analysis.PHASES["confirmation"]
        mapping = analysis._phase_block_map(synthetic_campaign(), confirmation)
        rows = [score_row("HQ51", "B29", list(range(225, 233)))]
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "extension-labelled-confirmation.json"
            path.write_bytes(sweep.canonical_json(score_document(rows, status="confirmation")))
            with self.assertRaisesRegex(analysis.AnalysisError, "exact confirmation grid"):
                analysis.load_candidate_score_rows(
                    [path],
                    phase=confirmation,
                    expected_arms=("HQ51",),
                    campaign_sha="a" * 64,
                    margins_sha="b" * 64,
                    block_map=mapping,
                )


class SelectionRuleTest(unittest.TestCase):
    def test_nested_selects_hq32_hq40_hq51_or_none(self) -> None:
        cases = (
            ({"HQ51": "pass", "HQ40": "pass", "HQ32": "pass"}, "HQ32", "selected"),
            ({"HQ51": "pass", "HQ40": "pass", "HQ32": "fail"}, "HQ40", "selected"),
            ({"HQ51": "pass", "HQ40": "fail", "HQ32": "fail"}, "HQ51", "selected"),
            ({"HQ51": "fail", "HQ40": "fail", "HQ32": "fail"}, None, "none"),
        )
        for decisions, selected, status in cases:
            with self.subTest(decisions=decisions):
                result = analysis.nested_discovery_selection(decisions)
                self.assertEqual(result["recommendedArm"], selected)
                self.assertEqual(result["status"], status)

    def test_incomplete_noteligible_and_insufficient_cannot_select(self) -> None:
        incomplete = analysis.nested_discovery_selection({"HQ51": "pass"})
        self.assertEqual(incomplete["status"], "incomplete")
        for unavailable in ("not_eligible", "insufficient"):
            decisions = {"HQ51": "pass", "HQ40": "pass", "HQ32": unavailable}
            result = analysis.nested_discovery_selection(decisions)
            self.assertEqual(result["status"], "unavailable")
            self.assertIsNone(result["recommendedArm"])

    def test_lower_pass_after_safer_fail_or_inconclusive_is_nonmonotone(self) -> None:
        for safer in ("fail", "inconclusive"):
            decisions = {"HQ51": safer, "HQ40": "pass", "HQ32": "pass"}
            result = analysis.nested_discovery_selection(decisions)
            self.assertEqual(result["status"], "non_monotone")
            self.assertIsNone(result["recommendedArm"])

    def test_hq52_cannot_enter_selection_grid(self) -> None:
        result = analysis.nested_discovery_selection(
            {"HQ51": "pass", "HQ40": "pass", "HQ32": "pass", "HQ52": "pass"}
        )
        self.assertEqual(result["status"], "incomplete")
        self.assertIsNone(result["recommendedArm"])

    def test_confirmation_outcomes_and_extension_trigger(self) -> None:
        confirmed = analysis.confirmation_decision(
            "HQ40", "HQ51", {"HQ40": "pass", "HQ51": "pass"}
        )
        inconclusive = analysis.confirmation_decision(
            "HQ40", "HQ51", {"HQ40": "inconclusive", "HQ51": "pass"}
        )
        fallback = analysis.confirmation_decision(
            "HQ40", "HQ51", {"HQ40": "fail", "HQ51": "pass"}
        )
        self.assertEqual(confirmed["status"], "confirmed")
        self.assertFalse(confirmed["extensionEligible"])
        self.assertEqual(inconclusive["status"], "inconclusive")
        self.assertTrue(inconclusive["extensionEligible"])
        self.assertEqual(fallback["recommendedArm"], "HQ51")


class ReplayEvidenceTest(unittest.TestCase):
    campaign_sha = "a" * 64
    source_sha = "c" * 64

    def make_fixture(self, root: Path, *, identical: bool = True) -> tuple[Path, Path, dict[str, object]]:
        original = write_synthetic_run(
            root,
            arm="HQ51",
            seed=1,
            relative_parent="arms/HQ51/seeds/seed-000001",
            campaign_sha=self.campaign_sha,
        )
        replay = write_synthetic_run(
            root,
            arm="HQ51",
            seed=1,
            relative_parent="replays/discovery/HQ51/seed-000001",
            campaign_sha=self.campaign_sha,
        )
        original_record = json.loads(original.read_text(encoding="utf-8"))
        replay_record = json.loads(replay.read_text(encoding="utf-8"))
        artifact = {
            "schemaVersion": 1,
            "artifactType": analysis.REPLAY_ARTIFACT_TYPE,
            "campaignSha256": self.campaign_sha,
            "campaignSourceSha256": self.source_sha,
            "phase": "discovery",
            "records": [
                {
                    "arm": "HQ51",
                    "replaySeed": 1,
                    "original": {
                        "path": "arms/HQ51/seeds/seed-000001/run.json",
                        "sidecarSha256": sweep.sha256_file(original),
                        "scientificTreeSha256": original_record["scientificTreeSha256"],
                    },
                    "replay": {
                        "path": "replays/discovery/HQ51/seed-000001/run.json",
                        "sidecarSha256": sweep.sha256_file(replay),
                        "scientificTreeSha256": replay_record["scientificTreeSha256"],
                    },
                    "identical": identical,
                }
            ],
        }
        evidence = root / "analysis" / "replay-evidence.json"
        seal = root / "seals" / "replay-evidence.sha256"
        evidence.parent.mkdir(parents=True)
        seal.parent.mkdir(parents=True)
        payload = sweep.canonical_json(artifact)
        evidence.write_bytes(payload)
        seal.write_text(hashlib.sha256(payload).hexdigest() + "\n", encoding="ascii")
        base = {
            "campaignSha256": self.campaign_sha,
            "campaignSourceSha256": self.source_sha,
            "campaign": synthetic_campaign(),
        }
        return evidence, seal, base

    def test_correctly_sealed_replay_allows_eligibility(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            evidence, seal, base = self.make_fixture(root)
            verified = analysis.verify_replay_evidence(
                root,
                replay_path=evidence,
                replay_seal=seal,
                phase=analysis.PHASES["discovery"],
                expected_arms=("HQ51",),
                base=base,
            )
            self.assertEqual(verified["HQ51"]["status"], "verified")
            run_evidence = {"status": "eligible-pending-replay", "reasonCodes": []}
            decision, eligibility = analysis._final_arm_decision(
                "pass", run_evidence, verified["HQ51"], "verified"
            )
            self.assertEqual(decision, "pass")
            self.assertTrue(eligibility["eligible"])
            selection = analysis.nested_discovery_selection(
                {"HQ51": decision, "HQ40": "pass", "HQ32": "pass"}
            )
            self.assertEqual(selection["recommendedArm"], "HQ32")

    def test_missing_replay_prevents_selection(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = {
                "campaignSha256": self.campaign_sha,
                "campaignSourceSha256": self.source_sha,
                "campaign": synthetic_campaign(),
            }
            rows, error, status = analysis.replay_eligibility(
                root,
                replay_path=root / "missing.json",
                replay_seal=root / "missing.sha256",
                phase=analysis.PHASES["discovery"],
                expected_arms=("HQ51",),
                base=base,
            )
            self.assertEqual(status, "missing")
            self.assertIsNotNone(error)
            decision, eligibility = analysis._final_arm_decision(
                "pass",
                {"status": "eligible-pending-replay", "reasonCodes": []},
                rows["HQ51"],
                status,
            )
            self.assertEqual(decision, "not_eligible")
            self.assertFalse(eligibility["eligible"])
            selection = analysis.nested_discovery_selection(
                {"HQ51": "pass", "HQ40": "pass", "HQ32": decision}
            )
            self.assertIsNone(selection["recommendedArm"])

    def test_false_or_mismatching_replay_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            evidence, seal, base = self.make_fixture(root, identical=False)
            with self.assertRaises(analysis.ReplayEvidenceError):
                analysis.verify_replay_evidence(
                    root,
                    replay_path=evidence,
                    replay_seal=seal,
                    phase=analysis.PHASES["discovery"],
                    expected_arms=("HQ51",),
                    base=base,
                )
            artifact = json.loads(evidence.read_text(encoding="utf-8"))
            artifact["records"][0]["identical"] = True
            artifact["records"][0]["replay"]["scientificTreeSha256"] = "f" * 64
            payload = sweep.canonical_json(artifact)
            evidence.write_bytes(payload)
            seal.write_text(hashlib.sha256(payload).hexdigest() + "\n", encoding="ascii")
            with self.assertRaises(analysis.ReplayEvidenceError):
                analysis.verify_replay_evidence(
                    root,
                    replay_path=evidence,
                    replay_seal=seal,
                    phase=analysis.PHASES["discovery"],
                    expected_arms=("HQ51",),
                    base=base,
                )

    def test_replay_seal_mismatch_prevents_selection(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            evidence, seal, base = self.make_fixture(root)
            seal.write_text("0" * 64 + "\n", encoding="ascii")
            rows, _, status = analysis.replay_eligibility(
                root,
                replay_path=evidence,
                replay_seal=seal,
                phase=analysis.PHASES["discovery"],
                expected_arms=("HQ51",),
                base=base,
            )
            self.assertEqual(status, "invalid")
            decision, _ = analysis._final_arm_decision(
                "pass",
                {"status": "eligible-pending-replay", "reasonCodes": []},
                rows["HQ51"],
                status,
            )
            self.assertEqual(decision, "fail")


class ConfirmationReferenceReconstructionTest(unittest.TestCase):
    def test_synthetic_h64_run_records_drive_exact_confirmation_blocks(self) -> None:
        campaign_sha = "a" * 64
        phase = analysis.PHASES["confirmation"]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for seed in phase.seeds:
                write_synthetic_run(
                    root,
                    arm="H64",
                    seed=seed,
                    relative_parent=f"arms/H64/seeds/seed-{seed:06d}",
                    campaign_sha=campaign_sha,
                )
            calls: list[tuple[str, tuple[int, ...]]] = []

            def builder(
                output_root: Path,
                *,
                arm: sweep.Arm,
                block_id: str,
                seeds: list[int],
                campaign_sha: str,
                profile: object,
            ) -> dict[str, object]:
                del profile
                for seed in seeds:
                    sweep.verify_run_record(
                        output_root / "arms" / "H64" / "seeds" / f"seed-{seed:06d}",
                        campaign_sha=campaign_sha,
                        arm=arm,
                        seed=seed,
                    )
                calls.append((block_id, tuple(seeds)))
                return {
                    "arm": "H64",
                    "blockId": block_id,
                    "seeds": seeds,
                    "summary": synthetic_summary(seeds),
                }

            references = analysis.reconstruct_confirmation_references(
                root,
                phase=phase,
                campaign_sha=campaign_sha,
                profile=None,
                summary_builder=builder,
            )
            self.assertEqual(tuple(references), phase.block_ids)
            self.assertEqual(len(calls), 8)
            self.assertEqual(calls[0], ("B21", tuple(range(161, 169))))
            self.assertEqual(calls[-1], ("B28", tuple(range(217, 225))))


class FreezeAndOutputSafetyTest(unittest.TestCase):
    def make_implementation_fixture(self, root: Path) -> tuple[dict[str, object], dict[str, str]]:
        all_paths = (
            analysis.ANALYSIS_PROGRAM_PATH,
            analysis.ANALYSIS_TEST_PATH,
            *analysis.LOCAL_DEPENDENCY_PATHS,
        )
        for relative in all_paths:
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"synthetic {relative}\n", encoding="utf-8")
        identity = analysis.implementation_identity(root)
        versions = {"python": "3.10.13", "numpy": "1.26.4", "scipy": "1.15.3"}
        return identity, versions

    def test_freeze_verification_rejects_program_test_dependency_and_version_drift(self) -> None:
        mutations = (
            analysis.ANALYSIS_PROGRAM_PATH,
            analysis.ANALYSIS_TEST_PATH,
            analysis.LOCAL_DEPENDENCY_PATHS[-1],
        )
        for relative in mutations:
            with self.subTest(path=relative), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                identity, versions = self.make_implementation_fixture(root)
                (root / relative).write_text("drift\n", encoding="utf-8")
                with self.assertRaises(analysis.AnalysisError):
                    analysis.verify_implementation_identity(
                        identity, versions, repo_root=root, current_versions=versions
                    )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            identity, versions = self.make_implementation_fixture(root)
            drifted = {**versions, "scipy": "9.9.9"}
            with self.assertRaisesRegex(analysis.AnalysisError, "version"):
                analysis.verify_implementation_identity(
                    identity, versions, repo_root=root, current_versions=drifted
                )

    def test_seal_drift_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            document = root / "artifact.json"
            seal = root / "artifact.sha256"
            document.write_text("{}\n", encoding="utf-8")
            seal.write_text(hashlib.sha256(document.read_bytes()).hexdigest() + "\n", encoding="ascii")
            analysis.verify_sealed_file(document, seal)
            document.write_text('{"drift":true}\n', encoding="utf-8")
            with self.assertRaisesRegex(analysis.AnalysisError, "hash mismatch"):
                analysis.verify_sealed_file(document, seal)

    def test_candidate_file_is_not_read_before_freeze_gate(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate = root / "candidate.json"
            candidate.write_text("this is deliberately not JSON", encoding="utf-8")
            output = root / "report.json"
            with mock.patch.object(analysis, "resolve_canonical_campaign_root", return_value=root), mock.patch.object(
                analysis, "verify_analysis_gate", side_effect=analysis.AnalysisError("analysis freeze missing")
            ):
                with self.assertRaisesRegex(analysis.AnalysisError, "analysis freeze missing"):
                    analysis.run_analysis(
                        campaign_root=root,
                        phase_name="discovery",
                        candidate_paths=[candidate],
                        replay_path=root / "replay.json",
                        replay_seal=root / "replay.sha256",
                        output_path=output,
                    )
            self.assertFalse(output.exists())

    def test_create_new_behavior_and_no_partial_output_on_input_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifact = root / "artifact.json"
            payload = b"{}\n"
            self.assertEqual(analysis._write_new_or_identical(artifact, payload), "created")
            self.assertEqual(analysis._write_new_or_identical(artifact, payload), "reused")
            with self.assertRaises(analysis.AnalysisError):
                analysis._write_new_or_identical(artifact, b'{"different":true}\n')
            output = root / "never-created.json"
            malformed = root / "malformed.json"
            malformed.write_text("not-json", encoding="utf-8")
            phase = analysis.PHASES["discovery"]
            with self.assertRaises(analysis.AnalysisError):
                analysis.load_candidate_score_rows(
                    [malformed],
                    phase=phase,
                    expected_arms=analysis.DISCOVERY_CANDIDATES,
                    campaign_sha="a" * 64,
                    margins_sha="b" * 64,
                    block_map=analysis._phase_block_map(synthetic_campaign(), phase),
                )
            self.assertFalse(output.exists())


class RealHQ52ControlIntegrationTest(unittest.TestCase):
    def test_real_existing_hq52_b01_control_only(self) -> None:
        root = analysis.REPOSITORY_CAMPAIGN_ROOT
        before_control = (
            sweep.sha256_file(root / analysis.CONTROL_REPORT_JSON)
            if (root / analysis.CONTROL_REPORT_JSON).is_file()
            else None
        )
        analysis.audit_pre_freeze_blocks(root)
        self.assertEqual(
            sweep.sha256_file(root / analysis.CAMPAIGN_JSON), analysis.EXPECTED_CAMPAIGN_SHA256
        )
        self.assertEqual(
            sweep.sha256_file(root / analysis.MARGINS_JSON), analysis.EXPECTED_MARGINS_SHA256
        )
        self.assertEqual(
            sweep.sha256_file(root / analysis.REFERENCE_JSON), analysis.EXPECTED_REFERENCE_SHA256
        )
        self.assertEqual(
            sweep.sha256_file(root / analysis.CONTROL_SCORE_JSON),
            analysis.EXPECTED_HQ52_SCORE_SHA256,
        )
        report = analysis.build_control_report(root)
        control = report["control"]
        comparison = control["comparison"]
        self.assertEqual(control["arm"], "HQ52")
        self.assertEqual(control["blockId"], "B01")
        self.assertEqual(control["seeds"], list(range(1, 9)))
        self.assertEqual(comparison["referenceCompositeLoss"], 0.6386956451346522)
        self.assertEqual(comparison["candidateCompositeLoss"], 0.6386956451346522)
        self.assertEqual(comparison["pairedCompositeDifference"], 0.0)
        self.assertTrue(comparison["allNumericScoringDifferencesExactlyZero"])
        self.assertEqual(set(control["sentinelSeedMeanDifferences"]), set(analysis.SENTINEL_IDS))
        self.assertTrue(all(value == 0.0 for value in control["sentinelSeedMeanDifferences"].values()))
        self.assertEqual(control["inference"]["n"], 1)
        self.assertEqual(control["inference"]["classification"], "insufficient")
        self.assertEqual(control["inference"]["inferenceStatus"], "control-only")
        after_control = (
            sweep.sha256_file(root / analysis.CONTROL_REPORT_JSON)
            if (root / analysis.CONTROL_REPORT_JSON).is_file()
            else None
        )
        self.assertEqual(before_control, after_control)
        self.assertEqual(
            sorted(path.name for path in (root / "blocks").iterdir()),
            ["HQ52-seeds-000001-000008.json"],
        )


if __name__ == "__main__":
    unittest.main()
