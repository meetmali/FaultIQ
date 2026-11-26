# FaultIQ

**Agentic fault detection and diagnostics (FDD) for HVAC rooftop units.** FaultIQ detects abnormal
operating behaviour, diagnoses which supported fault type it matches (or says the result is inconclusive), and
shows the evidence behind each result.

FaultIQ is **pro bono and open source (MIT)**. It's free to use and to self-host, so building owners
without a budget for commercial FDD software can still find and understand faults. FaultIQ supports
decisions. It never controls equipment, doesn't predict future failures, and is not a substitute for a
qualified HVAC technician.

- **Project plan and roadmap:** [`FaultIQ_README.md`](FaultIQ_README.md)
- **Architecture:** [`docs/architecture.md`](docs/architecture.md) · **Decisions:** [`docs/decisions/`](docs/decisions/README.md)
- **Scope and screens:** [`docs/scope.md`](docs/scope.md) · **Conventions:** [`docs/development.md`](docs/development.md)

**Current phase:** Phase 0, repository setup.

## Stack at a glance

| Part | Technology | Arrives |
|------|------------|---------|
| API (`api/`) | ASP.NET Core, .NET 10 LTS, C#, EF Core | Phase 0 / 6 |
| Data and worker (`pipeline/`) | Python 3.13, Polars, PyArrow, uv (DuckDB in notebooks and reports only) | Phase 0 / 1–2 |
| ML | scikit-learn, LightGBM (if it beats the baseline), TreeSHAP attributions from LightGBM | Phase 3–4 |
| Frontend (`frontend/`) | React, TypeScript, Vite, Tailwind + shadcn/ui, TanStack Query, React Router | Phase 0 / 7 |
| Charts | Apache ECharts, drawn from precomputed downsampled series | Phase 6–7 |
| Storage | PostgreSQL 17 for records, Parquet for processed data | Phase 0 / 2 |
| Observability | OpenTelemetry across the API and worker | Phase 6 / 8 |
| Auth | ASP.NET Core Identity (local accounts) + optional OIDC provider | Phase 6 |
| File storage | Local disk by default, optional S3-compatible | Phase 6 |

Deliberately left out: Kafka, Redis, Kubernetes, extra microservices and deep learning
([ADR 0013](docs/decisions/0013-infrastructure-restraint.md)).

The API handles HTTP, uploads, jobs and persistence. All feature engineering, detection, diagnosis and
evaluation happen in Python. The two communicate only through PostgreSQL
([ADR 0007](docs/decisions/0007-hybrid-dotnet-api-python-pipeline.md)).

## Repository layout

```text
api/        ASP.NET Core API (src/FaultIQ.Api) + xUnit tests
pipeline/   Python FDD library (faultiq/) + background worker (worker/) + pytest
frontend/   React + TypeScript + Vite + Tailwind
docs/       architecture, ADRs, scope, (later) data dictionary, dataset and model cards
data/       raw/ interim/ processed/ are git-ignored; sample/ is for synthetic data only
notebooks/  EDA (Phase 1+)
scripts/    dataset inspection and batch analysis (Phase 1+)
```

## Local setup

### Prerequisites

| Tool | Version | Install (macOS) |
|------|---------|-----------------|
| Git | any recent | |
| Docker + Docker Compose | Docker Desktop or OrbStack | `brew install --cask docker` or `brew install orbstack` |
| .NET SDK | 10.0.403 (`api/global.json`) | `brew install dotnet` |
| Python | 3.13 (`.python-version`) | `brew install python@3.13` |
| uv | 0.13+ | `brew install uv` |
| Node.js | 26 LTS (`.nvmrc`; ≥24 works) | `brew install node@26` or nvm |

The .NET SDK, Python, uv and Node are only needed to run things outside Docker or to run tests.

### Option A: everything in Docker

```bash
git clone https://github.com/meetmali/FaultIQ.git
cd FaultIQ
cp .env.example .env
docker compose up --build
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| API health | http://localhost:8000/api/v1/health |
| API readiness (checks the DB) | http://localhost:8000/api/v1/health/ready |
| OpenAPI document | http://localhost:8000/api/v1/openapi.json |
| PostgreSQL | `localhost:5432` (credentials from `.env`) |

All ports bind to `127.0.0.1` only. Check the worker with `docker compose logs worker`. Stop everything with
`docker compose down`. Add `-v` to also delete the database volume.

### Option B: run each part natively

Without Docker, run PostgreSQL 17 locally (for example `brew install postgresql@17 && brew services start postgresql@17`)
and create the role and databases from `.env.example`:

```bash
psql -d postgres -c "CREATE ROLE faultiq LOGIN PASSWORD 'change-me' CREATEDB"
createdb -O faultiq faultiq && createdb -O faultiq faultiq_test
```

Then:

```bash
make setup         # dotnet restore + uv sync + npm ci
make train-models  # once: trained model files in models/ (needs processed LBNL data, see below)
make api           # http://localhost:8000; applies database migrations on start
make worker        # second terminal: claims and runs analysis jobs
make frontend      # third terminal: http://localhost:5173
```

Without PostgreSQL running, `/health` still returns `200`, while `/health/ready` returns `503`
with `database: unavailable`. That's the expected behaviour.

### Using the API

The full contract is the OpenAPI document at `/api/v1/openapi.json`, committed as
[docs/contracts/openapi.json](docs/contracts/openapi.json). A complete analysis takes four calls:

```bash
curl -X POST localhost:8000/api/v1/equipment -H 'content-type: application/json' -d '{"name": "RTU-1"}'
curl -F file=@export.csv -F equipment_id=<id> -F format=lbnl_simulated localhost:8000/api/v1/uploads
curl -X POST localhost:8000/api/v1/analyses -H 'content-type: application/json' -d '{"upload_id": "<id>"}'
curl localhost:8000/api/v1/analyses/<id>/result     # once its status is "succeeded"
```

`/analyses/<id>/report` returns the upload's data-quality report: every validation issue, gaps and
missing values, also for quarantined files. `/models` lists each model with its held-out results and
the versions this installation has used (ADR 0027).

Lists (`/equipment`, `/analyses`, `/fault-events`) take `page` and `page_size` (at most 100) and return
`items`, `page`, `page_size` and `total`. Errors are RFC 9457 problems with a stable `code`.

### Seeing it with sample data

With the API and worker running and models trained, load eight sample units through the API:

```bash
python3 scripts/seed_demo.py data/raw/LBNL_FDD_Data_Sets_RTU_all_3 --api http://localhost:8000
```

Then open http://localhost:5173. Two views share every screen; switch with the toggle in the header
(ADR 0026):

- **Operator** (default): fleet health, units needing attention drawn as animated rooftop units with the
  faulty part highlighted, plain-language summaries with what to do, and an issue calendar.
- **Technician**: a work queue of unreviewed faults and a diagnostic workbench with a live unit schematic,
  a fault signature check, expected-versus-measured explorer, operating-context timeline, evidence,
  cited checks and a review form.

Both have light and dark themes, and both lead into the **Fault Library**. For the public demo, seed first, then set
`DEMO_MODE=true`: the demo rejects every write.

### Tests and checks

```bash
make check      # dotnet format/build/test, ruff, mypy, pytest, eslint, tsc, vitest
```

Database tests run when these point at a disposable database, and are skipped otherwise:

```bash
export FAULTIQ_TEST_DB="Host=localhost;Database=faultiq_test;Username=faultiq;Password=change-me"
export FAULTIQ_TEST_DATABASE_URL="postgresql+psycopg://faultiq:change-me@localhost:5432/faultiq_test"
```

End-to-end tests (Playwright) run in CI against the built app with recorded API responses:
`cd frontend && npx playwright install chromium && npm run test:e2e`. To run the same journey against
the real, seeded stack: `E2E_REAL=1 E2E_BASE_URL=http://localhost:5173 npx playwright test e2e/real.spec.ts`.

After changing an API contract, regenerate the committed contracts and the frontend types:
`cd api && UPDATE_CONTRACTS=1 dotnet test`, then `cd frontend && npm run generate:api`. CI fails if they drift.

Run `make help` to list all targets.

## Running the data pipeline

```bash
make process-lbnl                                   # all 81 LBNL files -> data/processed/v<version>/
cd pipeline && uv run python -m faultiq draft-mapping ../my_export.csv > ../my_rtu.toml
cd pipeline && uv run python -m faultiq process ../my_export.csv --mapping ../my_rtu.toml
```

Every input gets a JSON report (accepted, accepted with warnings, or quarantined, and why). Outputs are
Parquet files described in [docs/processed-data.md](docs/processed-data.md).

Detection baselines (Phase 3) and their held-out results: [docs/detection-report.md](docs/detection-report.md)
and [ADR 0021](docs/decisions/0021-detection-methodology.md). Rebuild them with
`cd pipeline && uv run python -I ../scripts/detection_report.py ../data/processed/v0.2.0 --json ../docs/detection/results.json --out ../docs/detection-report.md`.

Known-fault diagnosis (Phase 4): [docs/diagnosis-report.md](docs/diagnosis-report.md), the
[model card](docs/model-card.md) and [ADR 0022](docs/decisions/0022-diagnosis-methodology.md). Rebuild with
`cd pipeline && uv run python -I ../scripts/diagnosis_report.py ../data/processed/v0.2.0 --json ../docs/diagnosis/results.json --out ../docs/diagnosis-report.md`.

Evidence-grounded explanations (Phase 5): every alarm becomes a fault event with a finding, measured evidence,
an uncertainty statement and, for a named fault, checks from a cited [fault library](pipeline/faultiq/explain/fault_library.toml).
A claim checker rejects any statement the evidence doesn't support. See the
[explanation report](docs/explanation-report.md), [example explanations](docs/explanations/examples/),
the result [contract](docs/contracts/diagnostic-result.schema.json) and
[ADR 0023](docs/decisions/0023-explanations.md). Rebuild with
`cd pipeline && uv run python -I ../scripts/explain_report.py ../data/processed/v0.2.0 --docs ../docs`.

## Deploying (public demo or self-hosting)

One production setup serves both purposes. Set `DEMO_MODE=true` for a read-only, sample-data demo, or `false`
to analyse your own data:

```bash
cp .env.prod.example .env.prod      # set SITE_ADDRESS (your domain) and POSTGRES_PASSWORD
docker compose -f compose.prod.yml --env-file .env.prod pull
docker compose -f compose.prod.yml --env-file .env.prod up -d
```

Caddy handles HTTPS automatically. The full guide, including backups and updates, is in
[docs/deployment.md](docs/deployment.md).

## Contributing

HVAC and BAS experts, developers and testers are all welcome. See [CONTRIBUTING.md](CONTRIBUTING.md),
the [Code of Conduct](CODE_OF_CONDUCT.md) and the [security policy](SECURITY.md).

## Dataset

The MVP uses the [LBNL Rooftop Unit Fault Detection Dataset](https://faultdetection.lbl.gov/dataset/rtu/):
simulated, experimental and field RTU data at 1-minute resolution. Download it after the free registration
on that page, and unzip it into `data/raw/`. **Never commit it.** See the [dataset card](docs/dataset-card.md)
and [data dictionary](docs/data-dictionary.md).

Citation: Lawrence Berkeley National Laboratory, LBNL FDD Data Sets. DOI: https://dx.doi.org/10.25984/1881324

## Known issues

- **No login yet** (Phase 8). Don't expose a writable instance (`DEMO_MODE=false`) to the internet.
- Source files carry no time zone, and point mappings can't declare one yet. Event times are shown exactly
  as recorded in the uploaded data (ADR 0025).
- Bundled models only analyse LBNL-format uploads (`lbnl_simulated`, `lbnl_experimental`). Other files are
  validated, then refused with `model_unavailable` or `validation_failed` (ADR 0024).
- Analysing an LBNL file overlaps the data the bundled models were trained on, so those results are a
  demonstration, not an evaluation. The held-out evaluation is in the detection, diagnosis and explanation reports.
- Neither Compose stack (development or production) has been run yet, because Docker isn't installed on the
  development machine. The API, worker, frontend and Caddy configuration have been verified natively, and CI
  builds all three images on every pull request.
- No release images have been published yet. The first `v*` tag publishes them. Until then, use `up -d --build`.
- The API container has no `HEALTHCHECK`, because the chiseled .NET image has no shell or curl. Use `/api/v1/health/ready` instead.
- `npm audit` reports moderate advisories in ESLint's own dependency chain. These are dev tooling only and don't ship to the browser.
- Playwright (end-to-end tests) is deferred to Phase 7, when the first real user journey exists.

## License

[MIT](LICENSE). FaultIQ is provided "as is", without warranty. Results are decision support only.
