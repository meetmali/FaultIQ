# 0027. Data-quality report and models page (Close the loop, slice A)

- **Status:** Accepted
- **Date:** 2026-11-25
- **Plan:** [docs/plans/close-the-loop.md](../plans/close-the-loop.md) (slices B and C stay proposed)
- **Builds on:** ADR 0007, 0013, 0020, 0023, 0024, 0025

## Context

Two items on the project plan's own MVP list were only partly done:
- **"User can view ingestion status and validation results"** (section 17). The worker produces a
  full validation report for every upload. Only the first three *error* messages reached the user,
  inside `analyses.error_message`, and only when the file was quarantined. Warnings on accepted
  files (gaps, dropouts, unmapped columns, implausible values set to missing) were never shown.
- **`GET /api/v1/models`** (section 10). Every analysis records its `model_version`, but nothing
  said what a version is, how it was trained or how well that method did on held-out data.

Both are the first slice of the "Close the loop" plan. Work orders, fix verification, energy
impact and field accuracy (slices B and C) are extensions that wait until after Phase 8.

## Decision

**Data-quality report.**
- The worker turns the pipeline's per-file report into a `DataQualityReport` and stores it in
  a new nullable JSONB column `analyses.processing_report`. It does this on success and on
  quarantine, in the same transaction that completes or fails the job.
- The report keeps what a user can act on:
  - the validation status and every issue (severity, code, message),
  - row counts, the sampling interval, gaps and segments,
  - the share of missing values per sensor role,
  - unmapped and excluded columns,
  - steady-state and operating-mode shares,
  - the file's SHA-256, the mapping and the pipeline version.
- The server's file name is replaced by the user's everywhere, and no path is ever included.
- Its JSON Schema is committed at `docs/contracts/data-quality-report.schema.json` with a drift
  test, like the diagnostic result. The frontend's types are generated from it.
- `GET /api/v1/analyses/{id}/report` serves the stored JSON unchanged. It returns `404 not_found`
  for an unknown analysis, `409 result_not_ready` while the job is queued or running, and
  `404 report_not_available` when the job failed before validation ran (for example
  `upload_missing` or `model_unavailable`) or predates this change.

**Models page.**
- `python -m faultiq export-models` writes `model-registry.json` into the API project from the
  committed held-out results (`docs/diagnosis/results.json`). A test regenerates it and fails on
  drift, like the fault library.
- The registry has one entry per upload format and point set:
  - the dataset, the adopted model (logistic regression or LightGBM) and the training split,
  - the supported faults,
  - held-out test and validation macro-F1, the share of hours answered, named-fault precision,
    right-fault share on faulty hours and calibration error.
- `GET /api/v1/models` returns those entries, each joined with the model versions actually
  recorded on stored analyses (count, pipeline versions, first and last use). The join is grouped
  by the upload's format and the analysis's point set, never by parsing the version string.
- The held-out numbers describe the **method** at a diagnosis version. Installed model files are
  trained locally from the licensed data with the same method (ADR 0024), so the page says that
  the numbers belong to the method, not to one file. The API never reads the worker's model
  directory and never loads a model.

## Consequences

- One new column, one new endpoint per feature, one new contract file and one exported file. No
  new services or packages (ADR 0013).
- Analyses stored before this change have no report and say so; they are not backfilled, because
  the original uploads would have to be reprocessed.
- The report is a summary: the full per-file pipeline report (thresholds, all column names) stays
  internal.
- `error_message` keeps its short summary, so existing clients are unchanged.
- Revisit the registry when site-specific baselines arrive (Phase 8 backlog), because their models
  will have no LBNL held-out results.
