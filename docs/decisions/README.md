# Architecture Decision Records

These are short records of significant decisions. Each file is numbered and never renumbered.
When a decision changes, write a new ADR that supersedes the old one. Don't rewrite history.

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-rtu-first-batch-first-mvp-scope.md) | RTU-first, batch-first MVP scope | Accepted |
| [0003](0003-modular-monolith-with-separate-pipeline-library.md) | Modular monolith with a separate pipeline library | Superseded by 0007 |
| [0004](0004-python-toolchain.md) | Python 3.13 with uv (pipeline only, see 0007) | Accepted |
| [0005](0005-frontend-toolchain.md) | React, TypeScript, Vite, Tailwind, npm, Node 26 LTS | Accepted (charting superseded by 0009) |
| [0006](0006-storage-postgres-records-files-for-samples.md) | PostgreSQL for records, files for samples | Accepted |
| [0007](0007-hybrid-dotnet-api-python-pipeline.md) | Hybrid backend: .NET API with a Python data and ML pipeline | Accepted |
| [0008](0008-frontend-ui-data-fetching-and-api-client.md) | Frontend UI kit, data fetching and generated API client | Accepted (amended by 0015) |
| [0009](0009-echarts-and-precomputed-downsampled-series.md) | Apache ECharts for charts, with precomputed downsampled series | Accepted (amended by 0016) |
| [0010](0010-polars-pyarrow-duckdb-data-processing.md) | Polars, PyArrow and DuckDB for data processing | Accepted (amended by 0016) |
| [0011](0011-scikit-learn-lightgbm-shap.md) | scikit-learn and LightGBM for models, SHAP for explanations | Accepted (amended by 0016) |
| [0012](0012-opentelemetry-observability.md) | OpenTelemetry for observability | Accepted (amended by 0015) |
| [0013](0013-infrastructure-restraint.md) | Infrastructure restraint and complexity budget | Accepted |
| [0014](0014-pro-bono-open-source-self-hostable.md) | Pro bono, open source and self-hostable | Accepted |
| [0015](0015-mainstream-free-stack-resolutions.md) | Mainstream, free choices for the remaining open questions | Accepted |
| [0016](0016-corrections-to-chart-zoom-and-shap.md) | Corrections: chart zoom without DuckDB in the API, and SHAP from LightGBM | Accepted |
| [0017](0017-deployable-demo-same-artifacts-as-self-hosting.md) | A deployable demo that uses the same artifacts as self-hosting | Accepted |
| [0018](0018-dataset-roles-and-dual-point-reporting.md) | Dataset roles and dual reporting (all points and basic points) | Accepted |
| [0019](0019-point-mappings-as-toml-with-suggestions.md) | Point mappings as TOML files, with suggestions | Accepted |
| [0020](0020-preprocessing-contract.md) | Preprocessing contract: no filling, steady state by delay, physics features only | Accepted |
| [0021](0021-detection-methodology.md) | Detection methodology and Phase 3 results | Accepted |
| [0022](0022-diagnosis-methodology.md) | Diagnosis methodology and Phase 4 results | Accepted |
| [0023](0023-explanations.md) | Evidence-grounded explanations and the diagnostic result contract | Accepted |
| [0024](0024-api-persistence-and-jobs.md) | API, persistence and the analysis job loop | Accepted |
| [0025](0025-frontend-screens.md) | Frontend screens, fault library content and human review | Accepted |
| [0026](0026-persona-redesign.md) | Persona-based redesign: Operator and Technician views | Accepted |
| [0027](0027-data-quality-report-and-models-page.md) | Data-quality report and models page (Close the loop, slice A) | Accepted |
| [0028](0028-work-orders.md) | Work orders, fix verification and handoff export (Close the loop, slice B) | Accepted |

Template: copy [`template.md`](template.md).
