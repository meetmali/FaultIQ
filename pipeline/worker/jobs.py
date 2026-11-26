"""One analysis job, start to finish (ADR 0024).

validate + preprocess (Phase 2) -> detect, diagnose, explain and check (Phases 3-5) -> chart series.
Every failure becomes a stable error code and a message safe to show a user. Details stay in the
logs, never in the database or the API.
"""

from __future__ import annotations

import json
import logging
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import polars as pl
from opentelemetry import trace
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from sqlalchemy import Engine

import faultiq
from faultiq.explain.check import ExplanationError
from faultiq.explain.models import FORMATS, ModelError, ModelStore
from faultiq.explain.series import build_series
from faultiq.explain.workflow import analyse_file
from faultiq.ingestion.mapping import bundled_mapping
from faultiq.pipeline import process_file
from faultiq.quality import quality_report
from worker import db
from worker.config import WorkerSettings

log = logging.getLogger("faultiq.worker")
tracer = trace.get_tracer("faultiq.worker")


class JobError(Exception):
    """A failure with a stable code and a message that is safe to show users."""

    def __init__(self, code: str, message: str, report: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.report = report  # the data-quality report, when validation ran (ADR 0027)


@dataclass(frozen=True)
class Outcome:
    result: dict[str, Any]
    series: dict[str, Any]
    model_version: str
    report: dict[str, Any]


MAX_REASON = 240  # characters per reason; a missing-column list can run to thousands


def _validation_message(report: dict[str, Any], job: db.Job) -> str:
    """The first few validation errors, in the user's terms: their file name, not the server's.
    The full list is in the data-quality report stored with the analysis."""
    issues = report.get("validation", {}).get("issues", [])
    reasons = []
    for issue in issues:
        if issue.get("severity") != "error":
            continue
        text = str(issue["message"]).replace(job.stored_name, job.original_name)
        reasons.append(text if len(text) <= MAX_REASON else text[: MAX_REASON - 1] + "…")
    return "The file failed validation: " + ("; ".join(reasons[:3]) or "see the processing report.")


def analyse(job: db.Job, settings: WorkerSettings, store: ModelStore) -> Outcome:
    path = Path(settings.upload_dir) / Path(job.stored_name).name  # server-generated name only
    if not path.is_file():
        raise JobError("upload_missing", "The uploaded file could not be found.")
    if job.format not in FORMATS:
        raise JobError("unsupported_format", f"No analysis is available for format {job.format}.")
    try:
        model = store.get(job.format, job.point_set)
    except ModelError as exc:
        log.error("model_unavailable", extra={"job": str(job.id), "reason": str(exc)})
        raise JobError(
            "model_unavailable",
            "No trained model is available for this format yet. An administrator needs to run "
            "`python -m faultiq train-models`.",
        ) from exc

    _, mapping_name = FORMATS[job.format]
    with (
        tempfile.TemporaryDirectory(prefix="faultiq-") as tmp,
        tracer.start_as_current_span("validate_and_preprocess"),
    ):
        outcome = process_file(path, bundled_mapping(mapping_name), Path(tmp))
        raw_report = json.loads((Path(tmp) / outcome.report).read_text())
        report = db.as_json(
            quality_report(raw_report, job.stored_name, job.original_name).model_dump(mode="json")
        )
        if outcome.status == "quarantined" or outcome.output is None:
            raise JobError("validation_failed", _validation_message(raw_report, job), report)
        minutes = pl.read_parquet(Path(tmp) / outcome.output)

    with tracer.start_as_current_span("detect_diagnose_explain"):
        try:
            result, hours = analyse_file(minutes, model.diagnoser, job.original_name)
        except ExplanationError as exc:
            log.error("explanation_rejected", extra={"job": str(job.id), "reason": str(exc)})
            raise JobError(
                "explanation_rejected",
                "The explanation failed its evidence checks, so no result was published.",
                report,
            ) from exc
    with tracer.start_as_current_span("chart_series"):
        diag = model.diagnoser
        series = build_series(minutes, result, diag.models, hours, diag.ranges)
    return Outcome(
        db.as_json(result.model_dump(mode="json")), db.as_json(series), model.model_version, report
    )


def process_one(engine: Engine, store: ModelStore, settings: WorkerSettings, worker: str) -> bool:
    """Claim and run one job. Returns False when the queue was empty."""
    job = db.claim_next(engine, worker)
    if job is None:
        return False
    # Continue the trace started by the API request that queued the job (ADR 0012).
    parent = (
        TraceContextTextMapPropagator().extract({"traceparent": job.traceparent})
        if job.traceparent
        else None
    )
    started = time.monotonic()
    with tracer.start_as_current_span(
        "analysis", context=parent, attributes={"faultiq.analysis_id": str(job.id)}
    ) as span:
        trace_id = format(span.get_span_context().trace_id, "032x")
        log.info(
            "job_started", extra={"job": str(job.id), "attempt": job.attempts, "trace_id": trace_id}
        )
        try:
            out = analyse(job, settings, store)
            db.complete(
                engine, job, result=out.result, series=out.series, report=out.report,
                model_version=out.model_version, pipeline_version=faultiq.PIPELINE_VERSION,
            )  # fmt: skip
            log.info(
                "job_succeeded",
                extra={
                    "job": str(job.id), "events": len(out.result["events"]), "trace_id": trace_id,
                    "seconds": round(time.monotonic() - started, 2),
                },
            )  # fmt: skip
        except JobError as exc:
            db.fail(engine, job, exc.code, exc.message, report=exc.report)
            span.set_attribute("faultiq.error_code", exc.code)
            log.warning(
                "job_failed", extra={"job": str(job.id), "code": exc.code, "trace_id": trace_id}
            )
        except Exception:
            db.fail(
                engine, job, "internal_error", "The analysis failed unexpectedly. Try again later."
            )
            log.exception("job_crashed", extra={"job": str(job.id), "trace_id": trace_id})
    return True
