"""Negative control for the validation metric: Mersenne vs Mersenne on disjoint seed sets.

Establishes the *null distribution* of the composite loss and of every individual metric loss
under no code change at all. Without it, no trajectory-changing experiment (Philox, AS241,
the mantissa probe, the exact frontier) has an interpretable acceptance threshold: a composite
of 0.60 against a baseline of 0.586 is meaningless until you know how much the number moves
when nothing has changed. Max makes the same point himself in his report, immediately after
Table 3.2: "the absolute value of the composite loss has no stand-alone statistical meaning."

Design
------
The composite is one number per seed *set* -- `runner.py` averages each metric across seeds
(`seed_mean = np.mean(seed_values)`) before scoring, and `scoring.py` then takes a weighted
mean across metrics. So dispersion cannot be estimated from a single validation run; it needs
disjoint sets.

Each seed is run exactly ONCE (n_sets * set_size model runs total), then the same per-seed
outputs are scored in disjoint groups. This is what makes the control cheap: invoking the
normal CLI n_sets times would rerun everything and, worse, would publish into the tracked
`input-data-versions/validation/` directory on every call.

Set 1 is the canonical seed block, so its composite doubles as the reference baseline.

Usage
-----
    # Generate a new full campaign. The output directory must contain no seed/config material.
    python validation_null_control.py --version v5o3 --n-sets 20 --workers 16 \
        --output-dir /tmp/null-control --json-out /tmp/null-control/summary.json

    # Verify the seal, then rescore a two-set subset without launching the model.
    python validation_null_control.py --version v5o3 --n-sets 2 --workers 16 \
        --output-dir /tmp/null-control --reuse-existing-output \
        --json-out /tmp/null-control/summary-smoke.json

Fresh campaigns write process-observed generation provenance and scored-file hashes beside every
seed. Reuse verifies those sidecars when present. A campaign for which every requested sidecar is
absent predates this contract: it is accepted for scoring as unverified legacy material, carries no
generation Git identity, and is ineligible to become a verified baseline. Generation provenance and
later scoring provenance are recorded separately.

On ccgpu4 keep --workers at 16 or below (the cluster policy allows at most half the cores).
This measurement is DETERMINISTIC -- validation loss for a given seed set is a fixed number
regardless of machine load, core count or day. None of the quiet-machine / same-day / A-B-A
discipline that governs timing benchmarks applies here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shlex
import statistics
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path


MODEL_CONTROL_PROPERTIES = (
    "housing.orderbook",
    "housing.rng",
    "housing.benchmark.sameJvmWarmupRuns",
    "housing.benchmark.warmupOutputRoot",
)
JVM_OPTION_ENVIRONMENT_VARIABLES = (
    "MAVEN_OPTS",
    "MAVEN_ARGS",
    "JAVA_TOOL_OPTIONS",
    "_JAVA_OPTIONS",
    "JDK_JAVA_OPTIONS",
)


def _reserved_model_control_properties(options: str, *, variable_name: str) -> list[str]:
    """Return model-control JVM properties hidden in one ambient option source."""

    try:
        tokens = shlex.split(options)
    except ValueError as error:
        raise SystemExit(f"Could not parse {variable_name}: {error}") from error
    return [
        property_name
        for property_name in MODEL_CONTROL_PROPERTIES
        if any(
            token == f"-D{property_name}" or token.startswith(f"-D{property_name}=")
            for token in tokens
        )
    ]


def _git_provenance(
    repo_root: Path,
    *,
    pathspecs: Sequence[str] = (),
) -> dict[str, object]:
    """Commit and tree of the code that produced these runs.

    Recorded so a null-control artifact carries its own provenance -- otherwise attribution
    to a commit rests on whatever was written in the log at the time, which is exactly the
    caveat the Step 1 control had to record by hand.
    """

    def _git(*args: str) -> str:
        try:
            return subprocess.run(
                ["git", *args], cwd=repo_root, capture_output=True, text=True, check=True
            ).stdout.strip()
        except (OSError, subprocess.CalledProcessError) as error:
            raise RuntimeError(
                f"Could not capture Git provenance with git {' '.join(args)}: {error}"
            ) from error

    scope_args = ["--", *pathspecs] if pathspecs else []
    status = _git("status", "--porcelain=v1", "--untracked-files=all", *scope_args)
    patch = _git("diff", "--binary", "HEAD", *scope_args)
    untracked = sorted(
        path
        for path in _git("ls-files", "--others", "--exclude-standard", *scope_args).splitlines()
        if path
    )
    fingerprint = hashlib.sha256()
    fingerprint.update(b"git-diff-head-v1\0")
    fingerprint.update(patch.encode("utf-8", errors="surrogateescape"))
    for relative_path in untracked:
        path = repo_root / relative_path
        fingerprint.update(b"\0untracked\0")
        fingerprint.update(relative_path.encode("utf-8", errors="surrogateescape"))
        if path.is_symlink():
            fingerprint.update(b"\0symlink\0")
            fingerprint.update(os.readlink(path).encode("utf-8", errors="surrogateescape"))
        elif path.is_file():
            fingerprint.update(b"\0file\0")
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    fingerprint.update(chunk)
        else:
            fingerprint.update(b"\0non-regular\0")

    return {
        "commit": _git("rev-parse", "HEAD"),
        "tree": _git("rev-parse", "HEAD^{tree}"),
        "branch": _git("rev-parse", "--abbrev-ref", "HEAD"),
        # Uncommitted changes mean the commit alone does not identify the code that ran.
        "dirty": bool(status),
        "workingTreeFingerprint": {
            "algorithm": "sha256",
            "sha256": fingerprint.hexdigest(),
            "scope": list(pathspecs) if pathspecs else ["repository"],
            "untrackedFileCount": len(untracked),
        },
    }


def _collect_repo_files(repo_root: Path, entries: Sequence[str]) -> dict[str, Path]:
    """Collect regular repository inputs under stable, checkout-relative names."""

    files: dict[str, Path] = {}
    for entry in entries:
        path = repo_root / entry
        if path.is_symlink():
            raise RuntimeError(f"Provenance input must not be a symlink: {path}")
        candidates = path.rglob("*") if path.is_dir() else (path,)
        for candidate in candidates:
            if candidate.name == "__pycache__" or "__pycache__" in candidate.parts:
                continue
            if candidate.is_symlink():
                raise RuntimeError(f"Provenance input must not be a symlink: {candidate}")
            if candidate.is_dir():
                continue
            if not candidate.is_file():
                raise RuntimeError(f"Provenance input is not a regular file: {candidate}")
            relative = candidate.relative_to(repo_root).as_posix()
            files[relative] = candidate
    missing = [entry for entry in entries if not (repo_root / entry).exists()]
    if missing:
        raise RuntimeError(f"Missing provenance input(s): {', '.join(missing)}")
    return dict(sorted(files.items()))


def _generation_input_files(repo_root: Path, version: str) -> dict[str, Path]:
    return _collect_repo_files(
        repo_root,
        (
            "pom.xml",
            "mvnw",
            ".mvn",
            "src/main",
            f"input-data-versions/{version}",
            "scripts/python/helpers/common/abm_policy_sweep.py",
            "scripts/python/validation/model/runner.py",
            "scripts/python/experiments/model/validation_null_control.py",
            "scripts/python/experiments/model/null_control_provenance.py",
        ),
    )


def _version_input_files(repo_root: Path, version: str) -> dict[str, Path]:
    return _collect_repo_files(repo_root, (f"input-data-versions/{version}",))


def _scoring_input_files(repo_root: Path) -> dict[str, Path]:
    return _collect_repo_files(
        repo_root,
        (
            "scripts/python/helpers/common/abm_policy_sweep.py",
            "scripts/python/helpers/was",
            "scripts/python/validation/model",
            "scripts/python/experiments/model/validation_null_control.py",
            "scripts/python/experiments/model/null_control_provenance.py",
        ),
    )


def _read_int_property(path: Path, property_name: str) -> int:
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if "=" not in line:
            continue
        key, value = (part.strip() for part in line.split("=", 1))
        if key == property_name:
            try:
                return int(value)
            except ValueError as error:
                raise RuntimeError(
                    f"{path} has non-integer {property_name}={value!r}"
                ) from error
    raise RuntimeError(f"{path} is missing required property {property_name}")


def _find_repo_root(explicit: str | None) -> Path:
    if explicit:
        return Path(explicit).resolve()
    here = Path.cwd().resolve()
    for candidate in (here, *here.parents):
        if (candidate / "scripts" / "python" / "validation").is_dir():
            return candidate
    raise SystemExit("Could not locate repo root; pass --repo-root")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", required=True, help="Input-data version folder name, e.g. v5o3")
    parser.add_argument("--output-dir", required=True, help="Transient per-seed output directory")
    parser.add_argument("--n-sets", type=int, default=20, help="Number of disjoint seed sets (default 20)")
    parser.add_argument("--set-size", type=int, default=8, help="Seeds per set; must match the canonical block")
    parser.add_argument("--first-seed", type=int, default=1, help="First seed (default 1, so set 1 is canonical)")
    parser.add_argument("--workers", type=int, default=16, help="Parallel workers (<=16 on ccgpu4)")
    parser.add_argument("--n-steps", type=int, default=None, help="N_STEPS override; omit to keep the snapshot value")
    parser.add_argument("--window-start", type=int, default=None, help="Metric window start; omit for the canonical default")
    parser.add_argument("--window-end", type=int, default=None, help="Metric window end; omit for the canonical default")
    parser.add_argument("--repo-root", default=None, help="Repo root override")
    parser.add_argument("--maven-bin", default=None, help="Maven executable override")
    parser.add_argument("--was-data-root", default=None, help="WAS data root override")
    parser.add_argument(
        "--json-out",
        default=None,
        help=(
            "Result table path (defaults to summary.json for fresh generation and "
            "summary-reuse.json for reuse)"
        ),
    )
    parser.add_argument(
        "--orderbook",
        choices=("array", "tree"),
        default="array",
        help="Order-book implementation to pass explicitly to every model JVM (default: array)",
    )
    parser.add_argument(
        "--rng-mode",
        choices=("mersenne",),
        default="mersenne",
        help="RNG mode to pass explicitly to every model JVM (default: mersenne)",
    )
    operation = parser.add_mutually_exclusive_group()
    operation.add_argument(
        "--reuse-existing-output",
        action="store_true",
        help=(
            "Skip model runs and score per-seed outputs already present in --output-dir; "
            "generation sidecars are verified when present and pre-provenance campaigns are "
            "accepted only as unverified legacy output"
        ),
    )
    operation.add_argument(
        "--adopt-legacy",
        action="store_true",
        help=(
            "Deprecated: legacy output cannot acquire generation-time provenance after the fact"
        ),
    )
    parser.add_argument(
        "--skip-metric-kinds",
        default="",
        help=(
            "Comma-separated metric kinds to exclude, e.g. 'household_jsd' to drop the three "
            "WAS-dependent distributional metrics when private-datasets/was is unavailable. "
            "The resulting composite is a subset quantity and is NOT comparable to published "
            "20-metric baselines -- but it is internally comparable, which is all a null needs."
        ),
    )
    args = parser.parse_args()
    if Path(args.version).name != args.version or args.version in {".", ".."}:
        raise SystemExit("--version must be one input-data version directory name")

    repo_root = _find_repo_root(args.repo_root)
    executing_driver = Path(__file__).resolve()
    selected_driver = (
        repo_root
        / "scripts"
        / "python"
        / "experiments"
        / "model"
        / "validation_null_control.py"
    ).resolve()
    if executing_driver != selected_driver:
        raise SystemExit(
            "The executing validation_null_control.py does not belong to --repo-root: "
            f"executing={executing_driver} selected={selected_driver}. "
            "Run the driver from the same checkout that supplies the fingerprinted inputs."
        )
    sys.path.insert(0, str(repo_root))

    from scripts.python.helpers.common.abm_policy_sweep import resolve_maven_bin
    from scripts.python.experiments.model.null_control_provenance import (
        MANIFEST_FILENAME,
        ProvenanceError,
        SEAL_FILENAME,
        build_scoring_provenance,
        compact_generation_reference,
        fingerprint_files,
        preflight_fresh_generation,
        seal_native_generation,
        sha256_file,
        validate_generation_for_reuse,
    )
    from scripts.python.validation.model.runner import (
        build_validation_summary,
        load_reused_validation_results,
        resolve_was_data_root,
        run_snapshot_local_validation,
        validate_reused_validation_provenance,
    )
    from scripts.python.validation.model.schema import (
        VALIDATION_WINDOW_END,
        VALIDATION_WINDOW_START,
    )
    from scripts.python.validation.model.validation_profiles import resolve_validation_profile

    if args.workers > 16:
        raise SystemExit("Keep --workers at 16 or below on the cc machines (at most half the cores)")
    if args.workers <= 0:
        raise SystemExit("--workers must be positive")
    if args.n_sets <= 0 or args.set_size <= 0:
        raise SystemExit("--n-sets and --set-size must be positive")
    output_dir = Path(args.output_dir).expanduser().resolve()

    sets = [
        list(range(args.first_seed + i * args.set_size, args.first_seed + (i + 1) * args.set_size))
        for i in range(args.n_sets)
    ]
    all_seeds = [seed for seed_set in sets for seed in seed_set]

    if args.adopt_legacy:
        raise SystemExit(
            "--adopt-legacy is disabled: generation-time provenance cannot be reconstructed. "
            "Use --reuse-existing-output; provenance-free output is automatically marked "
            "unverified-legacy and cannot become a verified baseline."
        )

    reserved_by_environment = {
        variable_name: _reserved_model_control_properties(
            os.environ.get(variable_name, ""),
            variable_name=variable_name,
        )
        for variable_name in JVM_OPTION_ENVIRONMENT_VARIABLES
    }
    reserved_by_environment = {
        variable_name: properties
        for variable_name, properties in reserved_by_environment.items()
        if properties
    }
    if reserved_by_environment:
        rendered = "; ".join(
            f"{variable_name}=" + ",".join(f"-D{name}" for name in properties)
            for variable_name, properties in reserved_by_environment.items()
        )
        raise SystemExit(
            f"Ambient JVM/Maven options contain a hidden identity setting: {rendered}. "
            "Remove model-control properties; use --orderbook for the order book. This "
            "entry point always uses --rng-mode mersenne. Unrelated tuning such as -Xmx is "
            "preserved."
        )
    if args.maven_bin:
        raise SystemExit(
            "Null-control generation must use the fingerprinted repository Maven wrapper, and "
            "reuse launches no Maven process; --maven-bin overrides are not allowed"
        )

    if args.json_out:
        json_out = Path(args.json_out).expanduser().resolve()
    elif args.reuse_existing_output:
        # A direct reuse invocation must not replace the canonical full-run summary.
        json_out = output_dir / "summary-reuse.json"
    else:
        json_out = output_dir / "summary.json"

    if args.reuse_existing_output and json_out == output_dir / "summary.json":
        raise SystemExit(
            "Reuse must not overwrite the canonical generation summary; choose a distinct "
            "--json-out such as summary-smoke.json or summary-rescore.json"
        )

    try:
        result_relative = json_out.relative_to(output_dir)
    except ValueError:
        result_relative = None
    if result_relative is not None and result_relative.parts:
        generation_namespace = result_relative.parts[0]
        if generation_namespace == "configs" or generation_namespace.startswith("seed-"):
            raise SystemExit(
                f"--json-out must not write inside immutable generation material: {json_out}"
            )
        if result_relative.as_posix() in {
            MANIFEST_FILENAME,
            SEAL_FILENAME,
        }:
            raise SystemExit(f"--json-out uses a reserved provenance path: {json_out}")

    version_inputs = _version_input_files(repo_root, args.version)
    expected_input_hashes = {
        logical_path: sha256_file(path)
        for logical_path, path in version_inputs.items()
    }
    resolved_window_start = (
        VALIDATION_WINDOW_START if args.window_start is None else int(args.window_start)
    )
    resolved_window_end = VALIDATION_WINDOW_END if args.window_end is None else int(args.window_end)
    if resolved_window_start < 0:
        raise SystemExit("--window-start must be non-negative")
    if resolved_window_end <= resolved_window_start:
        raise SystemExit("--window-end must be greater than --window-start")

    provenance_validation_profile = resolve_validation_profile(args.version)
    profile = provenance_validation_profile

    skipped_kinds = {kind.strip() for kind in args.skip_metric_kinds.split(",") if kind.strip()}
    excluded_metric_ids: list[str] = []
    if skipped_kinds:
        import dataclasses

        known_metric_kinds = {metric.kind for metric in profile.targets_by_id.values()}
        unknown_metric_kinds = sorted(skipped_kinds - known_metric_kinds)
        if unknown_metric_kinds:
            raise SystemExit(
                "--skip-metric-kinds contains unknown kind(s): "
                + ", ".join(unknown_metric_kinds)
            )
        excluded_metric_ids = [
            metric_id
            for metric_id, metric in profile.targets_by_id.items()
            if metric.kind in skipped_kinds
        ]
        kept_ids = {
            metric_id for metric_id in profile.targets_by_id if metric_id not in set(excluded_metric_ids)
        }
        if not kept_ids:
            raise SystemExit("--skip-metric-kinds excluded every metric")
        profile = dataclasses.replace(
            profile,
            target_catalog=[m for m in profile.target_catalog if m.metric_id in kept_ids],
            targets_by_id={k: v for k, v in profile.targets_by_id.items() if k in kept_ids},
        )

    was_root = resolve_was_data_root(
        repo_root=repo_root,
        explicit_root=Path(args.was_data_root) if args.was_data_root else None,
    )

    print(f"repo root      : {repo_root}")
    print(f"version        : {args.version}")
    print(f"sets           : {args.n_sets} x {args.set_size} seeds = {len(all_seeds)} model runs")
    print(f"seed range     : {all_seeds[0]}..{all_seeds[-1]}  (set 1 = {sets[0]})")
    print(f"workers        : {args.workers}")
    print(f"output dir     : {output_dir}")
    print(f"metrics scored : {len(profile.targets_by_id)}")
    print(f"runtime request: orderBook={args.orderbook} rngMode={args.rng_mode}")
    print(f"ambient options: MAVEN_OPTS={os.environ.get('MAVEN_OPTS', '(unset)')}")
    if excluded_metric_ids:
        print(f"EXCLUDED       : {', '.join(excluded_metric_ids)}")
        print("                 (composite is a SUBSET quantity -- not comparable to published baselines)")
    print()

    # Snapshot the scoring implementation before fresh runs start: the runner extracts each
    # seed's metrics immediately after its JVM exits, so later provenance would be too late.
    scoring_inputs = _scoring_input_files(repo_root)
    if any(metric.kind == "household_jsd" for metric in profile.targets_by_id.values()):
        from scripts.python.validation.model.extractors import WAS_DATA_FILE_BY_DATASET

        was_relative_path, _ = WAS_DATA_FILE_BY_DATASET[profile.was_dataset]
        scoring_inputs[f"was-dataset/{profile.was_dataset}"] = was_root / was_relative_path
    scoring_input_snapshot = fingerprint_files(scoring_inputs)
    scoring_scope = (
        "scripts/python/helpers/common/abm_policy_sweep.py",
        "scripts/python/helpers/was",
        "scripts/python/validation/model",
        "scripts/python/experiments/model/validation_null_control.py",
        "scripts/python/experiments/model/null_control_provenance.py",
    )
    scoring_git = _git_provenance(repo_root, pathspecs=scoring_scope)

    # ---- 1. create or verify immutable generation evidence -------------------------------
    generation_results: list[dict[str, object]] = []
    validated_generation: dict[str, object] | None = None
    seed_provenance: dict[str, object]
    campaign_validation_enabled = False
    resolved_n_steps = (
        args.n_steps
        if args.n_steps is not None
        else _read_int_property(
            repo_root / "input-data-versions" / args.version / "config.properties",
            "N_STEPS",
        )
    )
    source_config = repo_root / "input-data-versions" / args.version / "config.properties"
    resolved_n_sims = _read_int_property(source_config, "N_SIMS")
    resolved_target_population = _read_int_property(source_config, "TARGET_POPULATION")
    if resolved_window_end > resolved_n_steps:
        raise SystemExit(
            f"Scoring window end {resolved_window_end} exceeds generated N_STEPS "
            f"{resolved_n_steps}"
        )

    if args.reuse_existing_output:
        try:
            seed_provenance = validate_reused_validation_provenance(
                output_dir=output_dir,
                seeds=all_seeds,
                expected_version=args.version,
                expected_order_book=args.orderbook,
                expected_rng_mode=args.rng_mode,
                validation_profile=profile,
            )
        except RuntimeError as error:
            raise SystemExit(f"Reuse refused: {error}") from error

        manifest_path = output_dir / MANIFEST_FILENAME
        seal_path = output_dir / SEAL_FILENAME
        if seed_provenance["status"] == "verified" and (
            manifest_path.exists() or seal_path.exists()
        ):
            if not manifest_path.is_file() or not seal_path.is_file():
                raise SystemExit(
                    "Reuse refused: campaign generation seal is incomplete; both "
                    f"{MANIFEST_FILENAME} and {SEAL_FILENAME} are required when either exists"
                )
            try:
                validated_generation = validate_generation_for_reuse(
                    output_dir,
                    requested_seeds=all_seeds,
                    expected_version=args.version,
                    expected_order_book=args.orderbook,
                    expected_rng_mode=args.rng_mode,
                    expected_n_steps=resolved_n_steps,
                    expected_n_sims=resolved_n_sims,
                    expected_target_population=resolved_target_population,
                    scoring_window_end=resolved_window_end,
                    expected_generation_input_hashes=expected_input_hashes,
                )
            except ProvenanceError as error:
                raise SystemExit(f"Reuse refused: {error}") from error
            campaign_validation_enabled = True

        if seed_provenance["status"] == "unverified-legacy":
            print(
                "Reusing pre-provenance model outputs as unverified legacy material; "
                "generation Git identity is unknown and this summary is not eligible to be "
                "recorded as a verified baseline.\n"
            )
        else:
            print(
                "Reusing per-seed-provenance-verified model outputs; generation identity "
                "comes from the seed sidecars, never from the current checkout or "
                "MAVEN_OPTS.\n"
            )
    else:
        try:
            preflight_fresh_generation(output_dir, seeds=all_seeds)
        except ProvenanceError as error:
            raise SystemExit(f"Fresh generation refused: {error}") from error
        output_dir.mkdir(parents=True, exist_ok=True)
        generation_inputs = _generation_input_files(repo_root, args.version)
        generation_input_snapshot = fingerprint_files(generation_inputs)
        generation_scope = (
            "pom.xml",
            "mvnw",
            ".mvn",
            "src/main",
            f"input-data-versions/{args.version}",
            "scripts/python/helpers/common/abm_policy_sweep.py",
            "scripts/python/validation/model/runner.py",
            "scripts/python/experiments/model/validation_null_control.py",
            "scripts/python/experiments/model/null_control_provenance.py",
        )
        generation_git = _git_provenance(repo_root, pathspecs=generation_scope)
        print(f"Running {len(all_seeds)} model runs ...")
        generation_results = run_snapshot_local_validation(
            repo_root=repo_root,
            version=args.version,
            seeds=all_seeds,
            output_dir=output_dir,
            maven_bin=resolve_maven_bin(repo_root),
            was_data_root=was_root,
            validation_profile=profile,
            workers=args.workers,
            n_steps=args.n_steps,
            window_start=args.window_start,
            window_end=args.window_end,
            order_book=args.orderbook,
            rng_mode=args.rng_mode,
            clean_compile=True,
            generation_git=generation_git,
            provenance_validation_profile=provenance_validation_profile,
        )
        print("Model runs complete.\n")
        observed = [result.get("runtimeMetadata") for result in generation_results]
        if any(metadata is None for metadata in observed):
            raise RuntimeError("A generated seed result is missing verified runtime metadata")
        unique_observed = {
            json.dumps(metadata, sort_keys=True)
            for metadata in observed
        }
        if len(unique_observed) != 1:
            raise RuntimeError("Generated seed results reported inconsistent runtime metadata")
        try:
            seed_provenance = validate_reused_validation_provenance(
                output_dir=output_dir,
                seeds=all_seeds,
                expected_version=args.version,
                expected_order_book=args.orderbook,
                expected_rng_mode=args.rng_mode,
                validation_profile=profile,
            )
        except RuntimeError as error:
            raise SystemExit(
                f"Generation completed but per-seed provenance validation failed: {error}"
            ) from error
        if seed_provenance["status"] != "verified":
            raise RuntimeError("A fresh generation did not write verified per-seed provenance")
        if seed_provenance["generation_git"] != generation_git:
            raise RuntimeError("Fresh per-seed provenance does not match generation Git identity")
        try:
            current_generation_inputs = _generation_input_files(repo_root, args.version)
            validated_generation = seal_native_generation(
                output_dir,
                version=args.version,
                seeds=all_seeds,
                n_steps=resolved_n_steps,
                runtime_metadata=observed[0],
                git_provenance=generation_git,
                generation_inputs=current_generation_inputs,
                generation_input_snapshot=generation_input_snapshot,
            )
        except ProvenanceError as error:
            raise SystemExit(f"Generation completed but could not be sealed: {error}") from error
        campaign_validation_enabled = True

    generation_warnings = (
        list(validated_generation.get("warnings", []))
        if validated_generation is not None
        else []
    )
    if seed_provenance.get("note"):
        generation_warnings.append(str(seed_provenance["note"]))
    for warning in generation_warnings:
        print(f"PROVENANCE WARNING: {warning}")
    if generation_warnings:
        print()

    # ---- 2. score each disjoint set from the SAME per-seed outputs ----------------------
    rows: list[dict] = []
    for index, seed_set in enumerate(sets, start=1):
        seed_results = load_reused_validation_results(
            output_dir=output_dir,
            seeds=seed_set,
            was_data_root=was_root,
            validation_profile=profile,
            window_start=resolved_window_start,
            window_end=resolved_window_end,
            use_cached_seed_results=False,
        )
        summary = build_validation_summary(
            version=args.version,
            seed_results=seed_results,
            seeds=seed_set,
            validation_profile=profile,
            window_start=resolved_window_start,
            window_end=resolved_window_end,
        )
        rows.append(
            {
                "set": index,
                "seeds": seed_set,
                "compositeLoss": summary["overallCompositeLoss"],
                "metricLosses": {
                    str(metric["metricId"]): metric.get("metricLoss")
                    for metric in summary["metrics"]
                    if metric.get("metricLoss") is not None
                },
            }
        )
        print(f"set {index:>3}  seeds {seed_set[0]:>3}-{seed_set[-1]:<3}  composite = {rows[-1]['compositeLoss']:.6f}")

    # Recheck after every raw read. This makes edits between initial validation and scoring fail
    # before a summary can be published, including removal or insertion of provenance sidecars.
    try:
        post_score_seed_provenance = validate_reused_validation_provenance(
            output_dir=output_dir,
            seeds=all_seeds,
            expected_version=args.version,
            expected_order_book=args.orderbook,
            expected_rng_mode=args.rng_mode,
            validation_profile=profile,
        )
    except RuntimeError as error:
        raise SystemExit(f"Post-score generation integrity check failed: {error}") from error
    if post_score_seed_provenance != seed_provenance:
        raise SystemExit(
            "Post-score generation integrity check failed: per-seed provenance state changed "
            "while outputs were being scored"
        )
    if campaign_validation_enabled:
        try:
            validated_generation = validate_generation_for_reuse(
                output_dir,
                requested_seeds=all_seeds,
                expected_version=args.version,
                expected_order_book=args.orderbook,
                expected_rng_mode=args.rng_mode,
                expected_n_steps=resolved_n_steps,
                expected_n_sims=resolved_n_sims,
                expected_target_population=resolved_target_population,
                scoring_window_end=resolved_window_end,
                expected_generation_input_hashes=expected_input_hashes,
            )
        except ProvenanceError as error:
            raise SystemExit(f"Post-score generation integrity check failed: {error}") from error

    generation_reference = (
        compact_generation_reference(validated_generation)
        if validated_generation is not None
        else {}
    )
    generation_reference.update(
        {
            "status": seed_provenance["status"],
            "git": seed_provenance["generation_git"],
            "note": seed_provenance["note"],
            "baselineEligible": seed_provenance["baseline_eligible"],
            "runtimeMetadata": seed_provenance["runtime_metadata"],
            "seedProvenanceFiles": seed_provenance["provenance_files"],
        }
    )
    generation_reference.setdefault("provenanceClass", seed_provenance["status"])

    # ---- 3. the null distribution ------------------------------------------------------
    composites = [row["compositeLoss"] for row in rows]
    composites_sorted = sorted(composites)

    def pct(p: float) -> float:
        if len(composites_sorted) == 1:
            return composites_sorted[0]
        position = p / 100.0 * (len(composites_sorted) - 1)
        low = int(position)
        high = min(low + 1, len(composites_sorted) - 1)
        return composites_sorted[low] + (composites_sorted[high] - composites_sorted[low]) * (position - low)

    stats = {
        "n_sets": len(composites),
        "baseline_set1": composites[0],
        "mean": statistics.fmean(composites),
        "sd": statistics.stdev(composites) if len(composites) > 1 else 0.0,
        "min": composites_sorted[0],
        "p2_5": pct(2.5),
        "median": pct(50),
        "p97_5": pct(97.5),
        "max": composites_sorted[-1],
    }

    print("\n" + "=" * 72)
    print("COMPOSITE LOSS — NULL DISTRIBUTION (no code change)")
    print("=" * 72)
    baseline_label = (
        "verified reference baseline"
        if seed_provenance["baseline_eligible"]
        else "UNVERIFIED legacy value; not baseline-eligible"
    )
    print(
        f"  set 1 (canonical seeds)  {stats['baseline_set1']:.6f}   <- {baseline_label}"
    )
    print(f"  mean                     {stats['mean']:.6f}")
    print(f"  sd                       {stats['sd']:.6f}")
    print(f"  range                    {stats['min']:.6f} .. {stats['max']:.6f}")
    print(f"  central 95 %             {stats['p2_5']:.6f} .. {stats['p97_5']:.6f}")
    print()
    print(f"  => predeclare the tolerance as +/- {2 * stats['sd']:.6f} (2 sd) around the baseline,")
    print(f"     or require the candidate composite to fall inside [{stats['p2_5']:.6f}, {stats['p97_5']:.6f}].")
    print()

    # per-metric nulls: this is what fixes the multiplicity problem across the 20 metrics
    metric_ids = sorted({metric_id for row in rows for metric_id in row["metricLosses"]})
    per_metric: dict[str, dict[str, float]] = {}
    print("-" * 72)
    print("PER-METRIC NULL BANDS (a candidate metric only 'deteriorates' if it exits its band)")
    print("-" * 72)
    print(f"{'metric':<44}{'mean':>10}{'sd':>10}")
    for metric_id in metric_ids:
        values = [row["metricLosses"][metric_id] for row in rows if metric_id in row["metricLosses"]]
        if not values:
            continue
        entry = {
            "mean": statistics.fmean(values),
            "sd": statistics.stdev(values) if len(values) > 1 else 0.0,
            "min": min(values),
            "max": max(values),
        }
        per_metric[metric_id] = entry
        print(f"{metric_id:<44}{entry['mean']:>10.4f}{entry['sd']:>10.4f}")

    current_scoring_inputs = _scoring_input_files(repo_root)
    if any(metric.kind == "household_jsd" for metric in profile.targets_by_id.values()):
        current_scoring_inputs[f"was-dataset/{profile.was_dataset}"] = (
            was_root / WAS_DATA_FILE_BY_DATASET[profile.was_dataset][0]
        )
    scoring_provenance = build_scoring_provenance(
        git_provenance=scoring_git,
        scoring_config={
            "version": args.version,
            "validationProfile": profile.profile_id,
            "validationTargetYear": profile.validation_target_year,
            "wasDataset": profile.was_dataset,
            "sets": args.n_sets,
            "setSize": args.set_size,
            "firstSeed": args.first_seed,
            "seeds": all_seeds,
            "window": {
                "start": resolved_window_start,
                "end": resolved_window_end,
            },
            "metricIds": list(profile.targets_by_id),
            "excludedMetricIds": excluded_metric_ids,
            "skippedMetricKinds": sorted(skipped_kinds),
        },
        scoring_inputs=current_scoring_inputs,
        scoring_input_snapshot=scoring_input_snapshot,
        ambient_maven_opts=os.environ.get("MAVEN_OPTS", ""),
    )

    runtime_verification = {
        "status": (
            "not-verified-reused-output"
            if args.reuse_existing_output
            else "verified-generated-output"
        ),
        "recorded_runtime_metadata": seed_provenance["runtime_metadata"],
    }
    generation_provenance_summary = {
        "status": seed_provenance["status"],
        "note": seed_provenance["note"],
        "baseline_eligible": seed_provenance["baseline_eligible"],
        "seed_provenance_files": seed_provenance["provenance_files"],
    }

    payload = {
        "schemaVersion": 2,
        "artifactType": "null-control-summary",
        "version": args.version,
        # Scoring always belongs to this checkout. Generation belongs only to the seed sidecars;
        # legacy output deliberately stays unknown rather than inheriting today's Git identity.
        "scoring_git": scoring_git,
        "generation_git": seed_provenance["generation_git"],
        "generation_git_note": seed_provenance["note"],
        "generation_provenance": generation_provenance_summary,
        "runtime_verification": runtime_verification,
        "verified_baseline_eligible": seed_provenance["baseline_eligible"],
        "generationProvenance": generation_reference,
        "scoringProvenance": scoring_provenance,
        "config": {
            "n_sets": args.n_sets,
            "set_size": args.set_size,
            "first_seed": args.first_seed,
            "window_start": resolved_window_start,
            "window_end": resolved_window_end,
            "metrics_scored": len(profile.targets_by_id),
            "excluded_metric_ids": excluded_metric_ids,
        },
        "composite": stats,
        "perMetric": per_metric,
        "sets": rows,
    }
    json_out.parent.mkdir(parents=True, exist_ok=True)
    json_out.write_text(json.dumps(payload, indent=2))
    print(f"\nWrote {json_out}")


if __name__ == "__main__":
    main()
