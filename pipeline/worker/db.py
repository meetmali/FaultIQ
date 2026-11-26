"""Database access for the worker (ADR 0007, ADR 0024).

The .NET API owns the schema through EF Core migrations. These explicit SQLAlchemy Core tables
describe the columns the worker uses; tests/test_db_contract.py checks them against the migrated
schema (api/migrations/schema.sql), so the two can't drift silently.

Jobs are rows in `analyses`. Claiming uses `FOR UPDATE SKIP LOCKED`: concurrent workers each take a
different row, and nobody waits on a row another worker holds.
"""

from __future__ import annotations

import json
import socket
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Engine,
    Float,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    and_,
    create_engine,
    insert,
    select,
    text,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

metadata = MetaData()
TZ = DateTime(timezone=True)

equipment = Table(
    "equipment",
    metadata,
    Column("id", PG_UUID(as_uuid=True), primary_key=True),
    Column("name", String(200), nullable=False),
    Column("site", String(200)),
    Column("created_at", TZ, nullable=False),
)

uploads = Table(
    "uploads",
    metadata,
    Column("id", PG_UUID(as_uuid=True), primary_key=True),
    Column("equipment_id", PG_UUID(as_uuid=True), ForeignKey("equipment.id"), nullable=False),
    Column("original_name", String(255), nullable=False),
    Column("stored_name", String(100), nullable=False),
    Column("format", String(50), nullable=False),
    Column("size_bytes", BigInteger, nullable=False),
    Column("sha256", String(64), nullable=False),
    Column("created_at", TZ, nullable=False),
)

analyses = Table(
    "analyses",
    metadata,
    Column("id", PG_UUID(as_uuid=True), primary_key=True),
    Column("upload_id", PG_UUID(as_uuid=True), ForeignKey("uploads.id"), nullable=False),
    Column("equipment_id", PG_UUID(as_uuid=True), ForeignKey("equipment.id"), nullable=False),
    Column("point_set", String(20), nullable=False),
    Column("status", String(20), nullable=False),
    Column("attempts", Integer, nullable=False),
    Column("created_at", TZ, nullable=False),
    Column("started_at", TZ),
    Column("finished_at", TZ),
    Column("worker_id", String(200)),
    Column("traceparent", String(55)),
    Column("error_code", String(100)),
    Column("error_message", String(1000)),
    Column("pipeline_version", String(50)),
    Column("model_version", String(200)),
    Column("hours_total", Integer),
    Column("hours_scored", Integer),
    Column("hours_alarmed", Integer),
    Column("event_count", Integer),
    Column("result", JSONB),
    Column("chart_series", JSONB),
    Column("processing_report", JSONB),
)

fault_events = Table(
    "fault_events",
    metadata,
    Column("id", PG_UUID(as_uuid=True), primary_key=True),
    Column("analysis_id", PG_UUID(as_uuid=True), ForeignKey("analyses.id"), nullable=False),
    Column("equipment_id", PG_UUID(as_uuid=True), ForeignKey("equipment.id"), nullable=False),
    Column("event_key", String(50), nullable=False),
    Column("kind", String(30), nullable=False),
    Column("fault", String(100)),
    Column("starts_at", TZ, nullable=False),
    Column("ends_at", TZ, nullable=False),
    Column("hours", Integer, nullable=False),
    Column("confidence", Float),
    Column("detector_score", Float, nullable=False),
)

MAX_ATTEMPTS = 3


def make_engine(database_url: str) -> Engine:
    return create_engine(database_url, pool_pre_ping=True, connect_args={"connect_timeout": 3})


def check_database(engine: Engine) -> bool:
    """Return True if the database answers a trivial query."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        return False
    return True


def worker_id() -> str:
    return f"{socket.gethostname()}:{uuid4().hex[:8]}"


@dataclass(frozen=True)
class Job:
    id: UUID
    equipment_id: UUID
    point_set: str
    attempts: int
    traceparent: str | None
    stored_name: str
    format: str
    original_name: str


def claim_next(engine: Engine, worker: str, now: datetime | None = None) -> Job | None:
    """Atomically take the oldest queued job, or return None if there is none."""
    now = now or datetime.now(UTC)
    oldest = (
        select(analyses.c.id)
        .where(analyses.c.status == "queued")
        .order_by(analyses.c.created_at, analyses.c.id)
        .limit(1)
        .with_for_update(skip_locked=True)
        .scalar_subquery()
    )
    claim = (
        update(analyses)
        .where(analyses.c.id == oldest)
        .values(
            status="running",
            started_at=now,
            finished_at=None,
            worker_id=worker,
            attempts=analyses.c.attempts + 1,
            error_code=None,
            error_message=None,
        )
        .returning(
            analyses.c.id,
            analyses.c.equipment_id,
            analyses.c.point_set,
            analyses.c.attempts,
            analyses.c.traceparent,
            analyses.c.upload_id,
        )
    )
    with engine.begin() as conn:
        row = conn.execute(claim).first()
        if row is None:
            return None
        up = conn.execute(
            select(uploads.c.stored_name, uploads.c.format, uploads.c.original_name).where(
                uploads.c.id == row.upload_id
            )
        ).one()
    return Job(
        row.id,
        row.equipment_id,
        row.point_set,
        row.attempts,
        row.traceparent,
        up.stored_name,
        up.format,
        up.original_name,
    )


def complete(
    engine: Engine,
    job: Job,
    *,
    result: dict[str, Any],
    series: dict[str, Any],
    model_version: str,
    pipeline_version: str,
    report: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> None:
    """Store the result, its event summaries and the series, and mark the job succeeded, in one
    transaction. Only the worker that holds the job (status running) can complete it."""
    now = now or datetime.now(UTC)
    events = result["events"]
    with engine.begin() as conn:
        conn.execute(fault_events.delete().where(fault_events.c.analysis_id == job.id))
        if events:
            conn.execute(
                insert(fault_events),
                [
                    {
                        "id": uuid4(),
                        "analysis_id": job.id,
                        "equipment_id": job.equipment_id,
                        "event_key": e["id"],
                        "kind": e["kind"],
                        "fault": e["fault"],
                        "starts_at": datetime.fromisoformat(e["start"]),
                        "ends_at": datetime.fromisoformat(e["end"]),
                        "hours": e["hours"],
                        "confidence": e["model"]["confidence"],
                        "detector_score": e["model"]["detector_score"],
                    }
                    for e in events
                ],
            )
        done = conn.execute(
            update(analyses)
            .where(and_(analyses.c.id == job.id, analyses.c.status == "running"))
            .values(
                status="succeeded",
                finished_at=now,
                result=result,
                chart_series=series,
                processing_report=report,
                model_version=model_version,
                pipeline_version=pipeline_version,
                hours_total=result["hours_total"],
                hours_scored=result["hours_scored"],
                hours_alarmed=result["hours_alarmed"],
                event_count=len(events),
            )
        )
        if done.rowcount != 1:
            raise RuntimeError(f"job {job.id} is no longer running; result discarded")


def fail(
    engine: Engine,
    job: Job,
    code: str,
    message: str,
    now: datetime | None = None,
    report: dict[str, Any] | None = None,
) -> None:
    """Mark the job failed with a safe, user-facing message (never a stack trace), keeping the
    data-quality report when validation ran (ADR 0027)."""
    with engine.begin() as conn:
        conn.execute(
            update(analyses)
            .where(and_(analyses.c.id == job.id, analyses.c.status == "running"))
            .values(
                status="failed",
                finished_at=now or datetime.now(UTC),
                error_code=code[:100],
                error_message=message[:1000],
                processing_report=report,
            )
        )


def recover_stale(engine: Engine, timeout: timedelta, now: datetime | None = None) -> int:
    """Jobs left running by a worker that died: retry them, or fail them after MAX_ATTEMPTS."""
    now = now or datetime.now(UTC)
    stale = and_(analyses.c.status == "running", analyses.c.started_at < now - timeout)
    with engine.begin() as conn:
        retried = conn.execute(
            update(analyses)
            .where(and_(stale, analyses.c.attempts < MAX_ATTEMPTS))
            .values(status="queued", worker_id=None)
        ).rowcount
        conn.execute(
            update(analyses)
            .where(and_(stale, analyses.c.attempts >= MAX_ATTEMPTS))
            .values(
                status="failed",
                finished_at=now,
                error_code="worker_timeout",
                error_message="The analysis did not finish after several attempts.",
            )
        )
    return int(retried)


def as_json(payload: Any) -> Any:
    """Round-trip through JSON so JSONB receives plain types (dates as ISO strings)."""
    return json.loads(json.dumps(payload, default=str))
