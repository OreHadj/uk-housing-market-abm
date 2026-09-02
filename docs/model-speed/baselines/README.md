# Model Speed Baselines
Author: Max Stoddard

This folder stores tracked baseline artifacts for the model-speed programme.

Allowed here:
- exact hash manifests for the canonical 5k e2e similarity gate
- accepted benchmark summary snapshots when a speed-baseline snapshot is explicitly refreshed
- tolerance-spec snapshots once a future parallel track is approved

Not allowed here:
- raw model outputs
- JFR recordings
- GC logs
- temporary comparison reports
- generated configs

Those transient artifacts belong under `tmp/model-speed/` while a run is being evaluated.

## Benchmark evidence retention

`tmp/model-speed/`, `/tmp`, and tool scratch directories are not durable evidence stores. Before a
benchmark result is recorded in a persistent results log or used to support an accepted claim, copy
the complete raw campaign or session tree to durable storage outside the repository. Keep the raw
files immutable after preservation.

Every new persistent benchmark entry must record:

- the durable artifact root and the session identifier or relative path for every arm;
- SHA-256 values for each arm's `summary.json`, `measured-runs.tsv`, and `environment.txt`;
- the file count and SHA-256 of a deterministic, relative-path whole-tree manifest;
- the benchmark protocol and warm-up count, plus the source commit and any participating dirty-tree
  diff hashes.

A new benchmark entry is provisional until those locations and hashes are present. Small tracked
baseline snapshots may still live in this directory, but they do not replace preservation of the raw
evidence from which they were derived.

Tracked baseline artifacts should be small, reviewable, and stable enough to support exact or tolerance-based regression checks.

Current canonical baselines:
- `v0-e2e-default-5k-s1`: exact hash similarity contract
- `v0-core-minimal-20k-s1`: primary 10-run execution-time benchmark; current detection evidence is documented in `docs/model-speed/20k-speed-detection-benchmark.md`

Historical tracked summaries:
- `v0-core-minimal-10k-s1.summary.json`: historical 10k summary snapshot from the previous benchmark gate; do not use it as the active speed verdict baseline.
