# FaultIQ

## Agentic Fault Detection & Diagnostics for HVAC Systems

> **Mission:** Detect abnormal HVAC operating behavior, diagnose
> supported known fault types, and show the evidence behind each result.

FaultIQ is an individual project focused on **HVAC Fault Detection and
Diagnostics (FDD)**. The MVP will begin with historical, labeled Rooftop
Unit (RTU) data and a web dashboard. This README is the project
execution plan: work through the phases in order, produce the listed
deliverables, and do not add complexity before the core workflow is
reliable.

## Table of Contents

1.  [Product Overview](#1-product-overview)
2.  [Problem, Goals, and Boundaries](#2-problem-goals-and-boundaries)
3.  [Users and Workflow](#3-users-and-workflow)
4.  [MVP Scope](#4-mvp-scope)
5.  [Technology Stack](#5-technology-stack)
6.  [Architecture](#6-architecture)
7.  [Data Strategy](#7-data-strategy)
8.  [Development Roadmap](#8-development-roadmap)
9.  [Detection, Diagnosis, and Agentic
    Reasoning](#9-detection-diagnosis-and-agentic-reasoning)
10. [Backend and API](#10-backend-and-api)
11. [Frontend Screens](#11-frontend-screens)
12. [Testing and Quality](#12-testing-and-quality)
13. [Security and Observability](#13-security-and-observability)
14. [Deployment](#14-deployment)
15. [Repository Structure](#15-repository-structure)
16. [Local Setup](#16-local-setup)
17. [MVP Acceptance Criteria](#17-mvp-acceptance-criteria)
18. [Risks and Mitigations](#18-risks-and-mitigations)
19. [Future Extensions](#19-future-extensions)
20. [References](#20-references)

------------------------------------------------------------------------

## 1. Product Overview

HVAC systems generate time-series measurements from sensors and control
points such as supply-air temperature, return-air temperature,
outdoor-air temperature, fan status, damper position, and other
equipment-specific signals. Abnormal readings may indicate a fault, but
an isolated alarm does not necessarily explain the underlying operating
pattern.

FaultIQ will provide a workflow to:

-   Ingest and validate historical HVAC operating data.
-   Establish normal operating patterns and detect abnormal behavior.
-   Classify fault types represented in the available labeled data.
-   Display the sensor evidence and time interval associated with each
    result.
-   Communicate uncertainty when the evidence is weak or multiple
    explanations remain plausible.
-   Help users explore equipment, detected events, and a structured
    fault reference library.

**Product workflow:** Detect → Investigate → Diagnose → Explain.

FaultIQ is a decision-support tool. It does not replace qualified HVAC
personnel or autonomously control building equipment.

## 2. Problem, Goals, and Boundaries

### Problem

Operators and analysts need to move from noticing an unusual measurement
to understanding which known fault may explain it. Threshold alarms can
flag values but may not distinguish faults with similar symptoms or show
how multiple sensor measurements support a diagnosis.

### Goals

1.  Build a reproducible HVAC data ingestion and preprocessing pipeline.
2.  Detect abnormal behavior with measurable false-positive and
    false-negative performance.
3.  Diagnose supported fault classes using labeled examples and relevant
    sensor features.
4.  Show evidence and uncertainty alongside diagnostic results.
5.  Deliver a usable web application for monitoring, investigation, and
    fault reference.
6.  Establish tests, documentation, and deployment practices that
    support maintainability.

### Explicit non-goals for the MVP

-   Predicting future equipment failures.
-   Predictive maintenance scheduling or remaining-useful-life
    estimation.
-   Claiming every anomaly has one identifiable root cause.
-   Controlling HVAC equipment or sending commands to a BMS.
-   Live building-system integration in the first milestone.
-   Supporting every HVAC equipment type from the beginning.

**Scope guardrail:** FaultIQ is an FDD application, not a
failure-forecasting product.

## 3. Users and Workflow

### Intended users

-   **Building operators:** Review equipment condition and investigate
    active or historical faults.
-   **HVAC technicians and analysts:** Examine sensor evidence and
    compare possible fault explanations.
-   **Administrators:** Manage sites, equipment metadata, data imports,
    and access.

The MVP may use a single demonstration role. Fine-grained role-based
access can be introduced later.

### Core workflow

1.  The user selects equipment or uploads a supported CSV file.
2.  FaultIQ validates file structure, timestamps, measurements, and data
    quality.
3.  The pipeline prepares time-series data and derives model features.
4.  Detection logic identifies candidate abnormal intervals.
5.  The diagnostic model evaluates supported fault classes.
6.  The application presents the result with sensor trends, evidence,
    and uncertainty.
7.  The user consults the Fault Library for definitions, symptoms,
    possible causes, and diagnostic checks.
8.  The user can flag the case for human review or record a confirmed
    outcome. Human-confirmed labels must remain distinct from model
    predictions.

## 4. MVP Scope

  -----------------------------------------------------------------------
  Capability                          MVP expectation
  ----------------------------------- -----------------------------------
  Equipment                           Rooftop Units (RTUs)

  Input                               Historical CSV files

  Processing                          Batch ingestion and analysis

  Detection                           Statistical/rule-based baseline
                                      plus at least one evaluated ML
                                      method

  Diagnosis                           Classification of fault types
                                      supported by selected data

  Evidence                            Sensor trends, detected interval,
                                      model output, uncertainty

  Dashboard                           Equipment status, fault summaries,
                                      recent events

  Diagnostics                         One-unit investigation with
                                      evidence

  Fault reference                     Searchable documented fault entries

  Persistence                         PostgreSQL for application records

  Interface                           React + TypeScript

  Deployment                          Docker-based reproducible
                                      environment
  -----------------------------------------------------------------------

**Primary dataset:** LBNL Rooftop Unit (RTU) Fault Detection Dataset:
https://faultdetection.lbl.gov/dataset/rtu/

Start with the documented simulated RTU data. Verify the current
download contents and data dictionary before assuming column names,
units, sampling rates, or label encoding.

## 5. Technology Stack

  -----------------------------------------------------------------------
  Layer                   Technology              Responsibility
  ----------------------- ----------------------- -----------------------
  Data processing         Python, Pandas, NumPy   Ingestion, cleaning,
                                                  feature engineering

  ML                      scikit-learn            Baselines, anomaly
                                                  detection,
                                                  classification,
                                                  evaluation

  Optional ML             XGBoost                 Candidate model only if
                                                  validation shows
                                                  improvement

  API                     FastAPI, Pydantic       Typed REST endpoints
                                                  and validation

  Database                PostgreSQL              Equipment, ingestion,
                                                  event, and analysis
                                                  records

  Time-series extension   TimescaleDB (optional)  Only if query
                                                  requirements justify it

  Frontend                React, TypeScript       Application screens and
                                                  interactions

  Visualization           Plotly                  Sensor trends and
                                                  evaluation charts

  Styling                 Tailwind CSS or         Reusable UI
                          consistent component    
                          library                 

  Testing                 pytest, Vitest, React   Unit through end-to-end
                          Testing Library,        tests
                          Playwright              

  Packaging               Docker, Docker Compose  Reproducible
                                                  environments

  Version control         Git                     Source control
  -----------------------------------------------------------------------

### Engineering choices

-   Start with a **modular monolith**, not microservices.
-   Keep data processing and model inference in reusable Python modules.
-   Use PostgreSQL for application records; retain source CSVs in
    file/object storage rather than forcing every raw sample into
    relational tables.
-   Keep raw inputs immutable and transformations reproducible.
-   Pin dependencies and commit lock files.

## 6. Architecture

``` text
LBNL RTU CSV / Historical HVAC Data
                 |
                 v
         Upload / Import Interface
                 |
                 v
       Ingestion and Validation
       - schema and column checks
       - timestamps and units
       - missing / invalid values
       - source-file tracking
                 |
                 v
        Preprocessing Pipeline
       - cleaning and alignment
       - operating-context checks
       - feature engineering
                 |
                 v
      Detection and Diagnosis Layer
       - normal-operation baseline
       - anomaly / fault detection
       - known-fault classification
       - confidence and uncertainty
                 |
                 v
          Results and Evidence
       - event interval
       - sensor evidence
       - model and pipeline version
       - diagnostic explanation
                 |
          +------+------+
          |             |
          v             v
       FastAPI       PostgreSQL
          |
          v
    React + TypeScript
    - Dashboard
    - Fault Diagnostics
    - Fault Library
```

### Architecture rules

1.  Separate ingestion, feature engineering, inference, and API routing.
2.  Store model and preprocessing versions with every inference.
3.  Preserve source-file identifiers and analysis timestamps.
4.  Use background processing for large files or long analyses.
5.  Do not label a model inference as a confirmed root cause without
    human confirmation.
6.  Treat raw source data as immutable.

## 7. Data Strategy

### 7.1 Primary data source

**Lawrence Berkeley National Laboratory --- Rooftop Unit (RTU) Fault
Detection Dataset**

Official page: https://faultdetection.lbl.gov/dataset/rtu/

Download the dataset and accompanying inventory/documentation. First
inspect the actual files and source documentation. Do not assume that a
proposed schema below exactly matches the source columns.

### 7.2 Dataset discovery checklist

Document:

-   Available files and naming conventions.
-   Equipment and operating conditions represented.
-   Sensor/control-point columns and units.
-   Sampling interval and timestamp format.
-   Fault-free periods and fault labels.
-   Fault categories and severity levels.
-   Whether labels apply to a file, interval, or row.
-   Missing values, duplicate timestamps, outliers, and irregular
    sampling.
-   Dataset limitations and permitted use.

Create a data dictionary from the actual files. A conceptual normalized
representation may include:

  Field              Meaning
  ------------------ -----------------------------------------
  `source_file`      Original file or source identifier
  `equipment_id`     Equipment identifier, if supplied
  `timestamp`        Measurement time
  `sensor_name`      Sensor/control-point name
  `value`            Numeric measurement
  `unit`             Unit, when supplied
  `operating_mode`   Mode, if available
  `fault_label`      Dataset-provided fault label
  `fault_severity`   Dataset-provided severity, if available

This is a proposed internal representation, not a claim that LBNL files
contain these exact fields.

### 7.3 Validation and preprocessing

Validate file type and size, required columns, data types, timestamps,
duplicate samples, numeric values, units, missingness, sampling
irregularity, and label validity. Quarantine invalid inputs and produce
a readable report. Do not silently drop unusual observations or impute
values without recording the method.

Keep raw, validated, and transformed data separate. Every transformation
should be reproducible and tested.

### 7.4 Leakage prevention

Adjacent time-series rows from the same fault episode are highly
related. A random row-level split can put near-duplicate observations
into both training and test sets and inflate performance.

Split by file, equipment, or fault episode according to the dataset
structure. Fit scalers, imputers, feature selection, and other learned
preprocessing only on training data. Keep the final test set untouched
until model selection is complete. Document and audit partition overlap.

### 7.5 Data governance

-   Preserve dataset attribution and usage terms.
-   Do not commit large raw datasets or sensitive building data to Git.
-   Use synthetic or sanitized examples in tests and screenshots.
-   Track manually created mappings and labels explicitly.

## 8. Development Roadmap

Work through these phases sequentially. Each phase must produce a
deliverable and meet its exit criteria before the next phase is
considered complete.

### Phase 0 --- Product Definition and Repository Setup

**Objective:** Establish a controlled scope and clean engineering
foundation.

Tasks: - Confirm RTU-first, batch-data-first MVP scope. - Finalize
Dashboard, Fault Diagnostics, and Fault Library screens. - Create
repository, README, issue board, and development conventions. - Pin
Python and Node versions; create dependency lock files. - Add
`.env.example`, `.gitignore`, and basic Docker Compose configuration. -
Record major architecture choices as short Architecture Decision
Records.

Deliverables: approved scope, repository skeleton, local setup
instructions, initial architecture diagram.

**Exit criteria:** A clean clone can start the empty frontend, API, and
database using documented steps.

### Phase 1 --- Dataset Discovery and EDA

**Objective:** Understand the real RTU data before choosing algorithms.

Tasks: - Download LBNL RTU data and documentation. - Inspect files,
columns, units, sampling, labels, and severity. - Build reproducible
data-loading scripts and EDA notebooks. - Visualize fault-free and
fault-labeled operating periods. - Quantify missingness, outliers, class
imbalance, and data quality. - Create a dataset card with provenance,
intended use, and limitations.

Deliverables: data dictionary, file inventory, EDA report, plots,
reproducible loader.

**Exit criteria:** Every selected feature and label has a documented
meaning and the files load reproducibly.

### Phase 2 --- Ingestion and Preprocessing Pipeline

**Objective:** Convert source files into validated analysis inputs.

Tasks: - Implement CSV import and schema validation. - Validate
timestamps, numeric fields, units, and labels. - Define duplicate,
missing-value, and irregular-sampling handling. - Build reusable
preprocessing and feature-engineering modules. - Add structured logs and
clear validation errors. - Test valid and invalid input fixtures.

Deliverables: ingestion package, per-file validation report, processed
outputs, automated tests.

**Exit criteria:** Repeated runs on the same input produce consistent
outputs and traceable transformation reports.

### Phase 3 --- Fault Detection Baselines

**Objective:** Establish a measurable abnormal-behavior detector.

Tasks: - Define normal/abnormal labels from source documentation. -
Implement transparent statistical or rule-based baselines. - Evaluate a
candidate such as Isolation Forest only if appropriate to the data. -
Tune thresholds using validation data only. - Analyze false positives
and false negatives by fault type and operating condition.

Deliverables: detection module, evaluation scripts, confusion matrix,
precision/recall/F1 report, error analysis.

**Exit criteria:** Performance and limitations are documented;
acceptance is based on held-out evaluation, not visual plausibility.

### Phase 4 --- Known-Fault Diagnosis

**Objective:** Identify which supported fault class best matches a
detected interval.

Tasks: - Define the fault taxonomy from actual dataset labels. -
Establish a simple supervised baseline. - Evaluate candidate models such
as Random Forest or Gradient Boosting; consider XGBoost only if
justified. - Report macro-F1 and per-class precision/recall, not
accuracy alone. - Inspect confusion between similar fault types. - Add
an unknown/inconclusive outcome for weak evidence or unsupported
conditions. - Calibrate probabilities before presenting them as
confidence.

Deliverables: versioned classifier, class mapping, model card, per-class
metrics, confusion matrix, abstention behavior.

**Exit criteria:** The model has documented held-out performance and can
abstain when evidence is insufficient.

### Phase 5 --- Evidence-Grounded Explanations and Agentic Workflow

**Objective:** Explain why the system generated a result without
inventing causal claims.

Tasks: - Identify sensor measurements and intervals relevant to each
output. - Show expected-versus-observed behavior only when a defensible
baseline exists. - Generate concise summaries from structured
evidence. - Separate measured facts, model inference, and recommended
checks. - Test explanations for unsupported statements and misleading
certainty.

Agentic workflow should be bounded: 1. Validate input. 2. Inspect
operating context. 3. Run detection. 4. Run the supported classifier. 5.
Collect sensor evidence. 6. Produce a structured explanation and
uncertainty statement.

The deterministic pipeline and model outputs remain the source of truth.
If an LLM is used to phrase a summary, give it only validated structured
evidence. It must not invent fault labels, sensor readings, confidence
values, or maintenance instructions.

Deliverables: diagnostic result schema, evidence extraction module,
constrained explanation workflow, tests for unsupported claims.

**Exit criteria:** Every diagnostic statement traces to a measurement,
dataset label, model output, or cited reference. Inconclusive cases are
handled explicitly.

### Phase 6 --- Backend API and Persistence

**Objective:** Expose ingestion and diagnostics through stable
interfaces.

Tasks: - Build a versioned FastAPI application. - Define Pydantic
request/response schemas. - Add PostgreSQL models and migrations. -
Track uploads and ingestion jobs. - Persist equipment, fault events,
analyses, evidence, and model versions. - Use background jobs for
long-running processing. - Add pagination, filtering, safe errors, and
API tests.

Deliverables: documented API, database migrations, integration tests,
OpenAPI documentation.

**Exit criteria:** The frontend can submit data, start analysis, and
retrieve persisted results using documented API contracts.

### Phase 7 --- Frontend Application

**Objective:** Build the user experience around the validated FDD
workflow.

Tasks: - Build reusable navigation, cards, tables, filters, and chart
components. - Implement the three screens described in [Frontend
Screens](#11-frontend-screens). - Connect UI components to API
contracts. - Add loading, empty, error, and stale-data states. - Label
chart axes and units; provide accessible chart summaries. - Ensure
status is not conveyed by color alone. - Clearly label
illustrative/sample values in demo mode. - Add responsive layouts and
keyboard navigation.

Deliverables: three connected screens, API-integrated workflow,
component and end-to-end tests.

**Exit criteria:** A user can move from overview to a specific diagnosis
and then to the fault reference without broken navigation or unexplained
placeholder values.

### Phase 8 --- End-to-End Validation and Hardening

**Objective:** Validate the complete application.

Tasks: - Test valid, invalid, incomplete, and large CSV uploads. -
Validate model behavior on held-out data. - Verify source-file and
model-version lineage. - Test API, database, and background-job
failures. - Review authentication, authorization, file validation, and
secrets handling. - Add structured logs, health checks, and basic
metrics. - Profile slow queries and large chart responses. - Run
accessibility and browser checks. - Conduct user acceptance tests using
documented scenarios.

Deliverables: test report, known-issues list, security checklist,
release candidate.

**Exit criteria:** Critical journeys pass, failure states are
understandable, and model limitations are visible.

### Phase 9 --- Deployment and Release

**Objective:** Deploy a reproducible and maintainable MVP.

Tasks: - Containerize frontend, API, and supporting services. -
Configure production environment variables and secrets. - Use managed
PostgreSQL or a backed-up database. - Configure HTTPS, CORS, upload
limits, and access controls. - Test database backup and restore. - Add
health/readiness checks and error monitoring. - Document deployment,
rollback, and recovery. - Tag a release and maintain a changelog.

Deliverables: deployed MVP, deployment runbook, backup/restore
instructions, versioned release.

**Exit criteria:** Deployment is reproducible from documented
configuration and recovery from backup has been tested.

## 9. Detection, Diagnosis, and Agentic Reasoning

### Detection is not diagnosis

-   **Detection:** Is the equipment behaving abnormally during this
    interval?
-   **Diagnosis:** Which supported fault class, if any, best matches the
    evidence?

An anomaly does not necessarily map to a known fault. The system must be
able to say: "Abnormal behavior detected; fault type inconclusive."

### Model progression

1.  Transparent statistical/rule-based baseline.
2.  Simple supervised baseline for known fault labels.
3.  Anomaly-detection candidate if it adds measurable value.
4.  More complex models only when they improve held-out results and
    remain interpretable enough for the use case.

### Evaluation

  -----------------------------------------------------------------------
  Task                    Primary metrics         Additional analysis
  ----------------------- ----------------------- -----------------------
  Detection               Precision, recall, F1   False-positive rate,
                                                  false-negative rate,
                                                  detection delay if
                                                  labels support it

  Classification          Macro-F1, per-class     Confusion matrix, class
                          precision/recall        imbalance, calibration

  Data pipeline           Validation pass/fail    Missingness, rejected
                                                  files, processing time

  Application             Task completion, error  API latency, failed
                          rate                    jobs, usability
                                                  feedback
  -----------------------------------------------------------------------

Report metrics by fault class and severity where labels permit. Document
the split strategy with every reported result.

### Confidence and abstention

A model probability is not automatically a trustworthy confidence score.
If confidence is displayed: - Define what the value represents. -
Evaluate calibration. - Show the supported class set. - Include an
unknown/inconclusive outcome. - Avoid false precision. - Explain that
model confidence is not proof of physical root cause.

## 10. Backend and API

Use `/api/v1` as the initial API prefix.

  -----------------------------------------------------------------------------
  Method                  Endpoint                      Purpose
  ----------------------- ----------------------------- -----------------------
  `GET`                   `/api/v1/health`              Service health

  `POST`                  `/api/v1/ingestions`          Upload/register a
                                                        source file

  `GET`                   `/api/v1/ingestions/{id}`     Ingestion status and
                                                        validation report

  `GET`                   `/api/v1/equipment`           List equipment

  `GET`                   `/api/v1/equipment/{id}`      Equipment metadata and
                                                        summary

  `POST`                  `/api/v1/diagnostics`         Start a diagnostic run

  `GET`                   `/api/v1/diagnostics/{id}`    Retrieve diagnostic
                                                        status/result

  `GET`                   `/api/v1/fault-events`        List events with
                                                        filters

  `GET`                   `/api/v1/fault-events/{id}`   Event details and
                                                        evidence

  `GET`                   `/api/v1/fault-library`       Search fault reference
                                                        entries

  `GET`                   `/api/v1/models`              List deployed model
                                                        versions
  -----------------------------------------------------------------------------

API conventions: - Validate all request parameters and uploaded file
metadata. - Return consistent error objects with safe user-facing
messages. - Paginate list endpoints. - Use timezone-aware ISO 8601
timestamps. - Include source identifiers, `model_version`, and
`pipeline_version` in diagnostic results. - Make long-running jobs
asynchronous and expose job status. - Never expose filesystem paths,
stack traces, secrets, or internal infrastructure details.

Potential core entities: `Site`, `Equipment`, `DataSource`,
`IngestionJob`, `SensorDefinition`, `DiagnosticRun`, `FaultEvent`,
`EvidenceItem`, `FaultDefinition`, `ModelVersion`, and eventually
`User`.

Finalize the database schema only after inspecting the actual source
data and application needs.

## 11. Frontend Screens

### Screen 1 --- Dashboard

**Purpose:** Give users a quick overview of equipment and detected
conditions.

Content: - Site/building selector. - Equipment totals and status
summaries. - Equipment overview. - Recent fault events. - Fault
distribution. - Sensor/system trend summaries.

Interactions: - Filter by site, equipment, status, and time range. -
Select equipment to open its diagnostic workspace. - Select a fault
event to inspect evidence.

### Screen 2 --- Fault Diagnostics

**Purpose:** Explain a selected abnormal interval and its likely
supported fault category.

Content: - Equipment metadata and operating state. - Sensor measurements
and time-series chart. - Detected interval and fault classification. -
Evidence supporting the result. - Confidence/uncertainty and possible
alternatives. - Related events and diagnostic history.

Interactions: - Select a time interval or sensor. - Inspect evidence
behind the diagnosis. - Compare possible fault classes. - Mark a case
for human review or record a confirmed outcome.

### Screen 3 --- Fault Library & Knowledge Base

**Purpose:** Provide searchable reference information for known faults
and diagnostic checks.

Content: - Search and filters. - Supported fault list. - Symptoms and
possible causes. - Diagnostic steps and related faults. - References and
source attribution.

Interactions: - Search by fault name or symptom. - Filter by equipment
type and severity when supported. - Open a fault entry and review its
guidance. - Navigate back to a related diagnostic case.

### UX requirements

-   Keep navigation and terminology consistent.
-   Pair status colors with labels and icons.
-   Label chart axes and measurement units.
-   Show loading, no-data, error, and stale-data states.
-   Distinguish observed measurements from derived features and model
    outputs.
-   Clearly identify sample/demo content.
-   Do not present generated suggestions as verified instructions.

## 12. Testing and Quality

### Python and ML

-   Unit-test parsing, validation, preprocessing, and feature
    engineering.
-   Test missing columns, empty files, malformed timestamps, duplicates,
    and unexpected labels.
-   Test data splitting for leakage.
-   Add regression tests for discovered model failures.
-   Store evaluation outputs with model versions.

### API and database

-   Test request validation and error responses.
-   Test upload limits and unsupported file types.
-   Test migrations and transaction behavior.
-   Test job states: queued, running, succeeded, failed.
-   Test pagination and filters.
-   Test authorization boundaries when authentication is added.

### Frontend

-   Unit-test reusable components.
-   Test loading, empty, and failure states.
-   Test keyboard navigation and accessible labels.
-   Test charts with missing and irregular data.
-   End-to-end test the primary user journey.

### Release quality gates

Do not release if critical tests fail, data leakage is unresolved,
results cannot be traced to source/model versions, the UI overstates
certainty, or secrets/raw data are committed.

## 13. Security and Observability

### Security baseline

-   Keep secrets in environment variables or a secrets manager, never in
    source control.
-   Validate file extension, MIME type, size, and parsed content.
-   Generate safe server-side file identifiers; do not trust uploaded
    filenames as storage paths.
-   Restrict upload and analysis endpoints to authorized users when
    authentication is enabled.
-   Use least-privilege database credentials.
-   Use HTTPS in deployed environments.
-   Avoid logging raw uploaded data or sensitive identifiers.
-   Define retention and deletion behavior for uploaded files.

### Reliability

-   Bound upload size and processing time.
-   Make jobs retry-safe.
-   Track job states and failures.
-   Keep source files immutable.
-   Back up the database and test restoration.
-   Version models and pipelines.

### Observability

Capture API request count, latency, error rate, ingestion
success/failure, validation rejection reasons, processing duration, job
failures, diagnostic volume, and model version. Logs should be
structured and should not contain secrets or unnecessary raw sensor
data.

## 14. Deployment

### Development environment

Use Docker Compose for a repeatable local environment: - `frontend` -
`api` - `postgres` - Optional `worker` for background processing

### Production-minded checklist

-   Separate development and production configuration.
-   Build frontend assets for production.
-   Run migrations as a controlled release step.
-   Configure HTTPS and restrictive CORS.
-   Configure upload limits and storage permissions.
-   Back up the database and test restore.
-   Add health/readiness checks.
-   Pin container images and dependencies.
-   Record application, model, and pipeline versions.
-   Document rollback procedures.

Do not add cloud infrastructure until the local end-to-end workflow is
stable. Choose hosting based on budget, data sensitivity, and
operational requirements.

## 15. Repository Structure

``` text
faultiq/
├── README.md
├── .env.example
├── .gitignore
├── docker-compose.yml
├── docs/
│   ├── architecture.md
│   ├── data-dictionary.md
│   ├── dataset-card.md
│   ├── model-card.md
│   ├── api-contracts.md
│   ├── decisions/
│   └── wireframes/
├── data/
│   ├── raw/                 # ignored by Git
│   ├── interim/             # ignored by Git
│   ├── processed/           # ignored by Git
│   └── sample/
├── notebooks/
│   ├── 01_dataset_exploration.ipynb
│   ├── 02_data_quality.ipynb
│   └── 03_model_baselines.ipynb
├── backend/
│   ├── pyproject.toml
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   ├── core/
│   │   ├── db/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── workers/
│   ├── faultiq/
│   │   ├── ingestion/
│   │   ├── validation/
│   │   ├── preprocessing/
│   │   ├── features/
│   │   ├── detection/
│   │   ├── diagnosis/
│   │   └── evaluation/
│   └── tests/
├── frontend/
│   ├── package.json
│   └── src/
│       ├── app/
│       ├── components/
│       ├── features/
│       │   ├── dashboard/
│       │   ├── diagnostics/
│       │   └── fault-library/
│       ├── services/
│       ├── hooks/
│       └── types/
└── scripts/
    ├── inspect_dataset.py
    └── run_batch_analysis.py
```

Keep notebooks for exploration, but move reusable production logic into
tested Python modules.

## 16. Local Setup

### Prerequisites

-   Git
-   Python version pinned by the project
-   Node.js LTS version pinned by the project
-   Docker and Docker Compose
-   LBNL RTU dataset downloaded separately

### Initial setup sequence

``` bash
git clone <repository-url>
cd faultiq
cp .env.example .env
docker compose up --build
```

Add the exact backend/frontend install and test commands once the
package managers and dependency files are selected. Do not document
commands that the repository does not yet implement.

Example `.env.example`:

``` dotenv
APP_ENV=development
API_V1_PREFIX=/api/v1
DATABASE_URL=postgresql+psycopg://faultiq:change-me@postgres:5432/faultiq
UPLOAD_DIR=/app/data/uploads
MAX_UPLOAD_SIZE_MB=100
CORS_ORIGINS=http://localhost:5173
```

Use local-only credentials for development. Never commit `.env`.

## 17. MVP Acceptance Criteria

### Data and models

-   [ ] Selected LBNL RTU files load through a reproducible script.
-   [ ] Actual source columns, units, labels, and limitations are
    documented.
-   [ ] Invalid or incomplete input is reported clearly.
-   [ ] Preprocessing is reproducible and tested.
-   [ ] Evaluation uses a documented leakage-aware split.
-   [ ] Detection and classification metrics are reported on held-out
    data.
-   [ ] An inconclusive outcome is possible when evidence is
    insufficient.
-   [ ] Every inference records model and pipeline versions.

### Backend and frontend

-   [ ] User can import a supported CSV file.
-   [ ] User can view ingestion status and validation results.
-   [ ] A diagnostic run can be started and retrieved.
-   [ ] Dashboard displays persisted equipment and event data.
-   [ ] Fault Diagnostics displays sensor evidence and diagnostic
    results.
-   [ ] Fault Library supports search and documented entries.
-   [ ] Loading, empty, and error states are implemented.
-   [ ] Core workflow passes end-to-end tests.

### Engineering and delivery

-   [ ] Application starts using documented local setup instructions.
-   [ ] Critical tests pass.
-   [ ] Secrets and raw data are excluded from Git.
-   [ ] Logs and errors are actionable without exposing sensitive data.
-   [ ] Known limitations and unsupported conditions are documented.

## 18. Risks and Mitigations

  -----------------------------------------------------------------------
  Risk                    Impact                  Mitigation
  ----------------------- ----------------------- -----------------------
  Dataset labels or       Invalid training and    Inspect source
  columns misunderstood   evaluation              documentation; build
                                                  data dictionary first

  Leakage across adjacent Inflated performance    Split by
  time windows                                    file/equipment/fault
                                                  episode and audit
                                                  overlap

  Class imbalance         Weak minority-class     Report per-class
                          diagnosis               metrics; handle
                                                  imbalance only within
                                                  training data

  Similar faults share    Overconfident diagnosis Show evidence,
  symptoms                                        alternatives, and
                                                  inconclusive state

  Dataset differs from    Poor generalization     State supported
  real buildings                                  conditions; do not
                                                  claim external validity
                                                  without testing

  Premature live          Delayed MVP             Complete batch workflow
  integration                                     first

  LLM invents             Misleading output       Ground summaries in
  explanations                                    structured evidence and
                                                  test unsupported claims

  Large files block       Poor experience         Background jobs, upload
  requests                                        limits, progress states

  Mockup values mistaken  Misleading              Label sample values;
  for results             demonstration           replace with measured
                                                  outputs before release
  -----------------------------------------------------------------------

## 19. Future Extensions

These are **not MVP commitments**. Consider them only after the core RTU
workflow is validated:

-   Additional equipment categories such as AHUs and chillers after
    reviewing their data and schema.
-   Approved live BMS integrations.
-   MQTT or Kafka streaming telemetry.
-   Multi-site and multi-tenant support.
-   Granular roles and audit history.
-   Human feedback workflows for confirmed fault labels.
-   Model monitoring and controlled retraining.
-   More advanced agent orchestration for bounded investigation.
-   Cloud deployment and managed storage.

Any extension must preserve the current product boundary: detecting and
diagnosing observed faults, not predicting future equipment failure
unless the project scope is deliberately changed.

## 20. References

1.  Lawrence Berkeley National Laboratory, **Rooftop Unit (RTU) Fault
    Detection Dataset**: https://faultdetection.lbl.gov/dataset/rtu/
2.  scikit-learn documentation: https://scikit-learn.org/
3.  FastAPI documentation: https://fastapi.tiangolo.com/
4.  PostgreSQL documentation: https://www.postgresql.org/docs/
5.  React documentation: https://react.dev/
6.  Plotly documentation: https://plotly.com/

------------------------------------------------------------------------

## Project Working Rule

**Do not move to a more complex phase until the current phase has a
working deliverable, tests, and documented limitations.** Prioritize a
correct, explainable RTU fault-detection and diagnostics workflow over a
broad feature set.
