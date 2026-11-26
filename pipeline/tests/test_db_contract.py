"""The worker against a real PostgreSQL schema built from the API's migrations (ADR 0007, 0024).

Needs FAULTIQ_TEST_DATABASE_URL (a SQLAlchemy URL to a disposable database); skipped otherwise.
The schema comes from api/migrations/schema.sql, the script EF Core generates, so these tests break
when the API's schema and the worker's table definitions disagree.
"""

from __future__ import annotations

import os
import threading
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Engine, insert, inspect, select, text

from worker import db

URL = os.environ.get("FAULTIQ_TEST_DATABASE_URL")
SCHEMA_SQL = Path(__file__).parents[2] / "api" / "migrations" / "schema.sql"
pytestmark = pytest.mark.skipif(URL is None, reason="set FAULTIQ_TEST_DATABASE_URL to run")
NOW = datetime(2026, 11, 19, 12, tzinfo=UTC)


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    assert URL is not None
    eng = db.make_engine(URL)
    # The EF script manages its own transaction, so run it the way a DBA would: autocommit.
    with eng.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.exec_driver_sql("DROP SCHEMA public CASCADE")
        conn.exec_driver_sql("CREATE SCHEMA public")
        conn.exec_driver_sql(SCHEMA_SQL.read_text(encoding="utf-8-sig"))  # EF writes a BOM
    yield eng
    eng.dispose()


@pytest.fixture(autouse=True)
def clean(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE fault_events, analyses, uploads, equipment CASCADE"))


def _queue(engine: Engine, n: int = 1, created: datetime = NOW) -> list[UUID]:
    eid, uid = uuid4(), uuid4()
    with engine.begin() as conn:
        conn.execute(insert(db.equipment).values(id=eid, name="RTU", created_at=NOW))
        conn.execute(
            insert(db.uploads).values(
                id=uid,
                equipment_id=eid,
                original_name="a.csv",
                stored_name=f"{uid.hex}.csv",
                format="lbnl_simulated",
                size_bytes=10,
                sha256="0" * 64,
                created_at=NOW,
            )
        )
        ids = [uuid4() for _ in range(n)]
        for i, aid in enumerate(ids):
            conn.execute(
                insert(db.analyses).values(
                    id=aid,
                    upload_id=uid,
                    equipment_id=eid,
                    point_set="all",
                    status="queued",
                    attempts=0,
                    created_at=created + timedelta(seconds=i),
                    traceparent="00-3053e710ff5d0b1838fadb0e01580cb9-3ac577690f58b289-01",
                )
            )
    return ids


def _status(engine: Engine, aid: UUID) -> tuple[str, int, str | None]:
    with engine.connect() as conn:
        row = conn.execute(
            select(db.analyses.c.status, db.analyses.c.attempts, db.analyses.c.error_code).where(
                db.analyses.c.id == aid
            )
        ).one()
    return row.status, row.attempts, row.error_code


def test_worker_tables_match_the_migrated_schema(engine: Engine) -> None:
    live = inspect(engine)
    for table in db.metadata.sorted_tables:
        columns = {c["name"]: c for c in live.get_columns(table.name)}
        for col in table.columns:
            assert col.name in columns, f"{table.name}.{col.name} is not in the API's schema"
            actual = columns[col.name]
            assert actual["nullable"] == col.nullable, f"{table.name}.{col.name} nullability"
            assert type(actual["type"]).__name__.lower() in _compatible(col), (
                f"{table.name}.{col.name}: schema has {actual['type']}, worker expects {col.type}"
            )
        required = {n for n, c in columns.items() if not c["nullable"] and c.get("default") is None}
        missing = required - {c.name for c in table.columns}
        assert not missing, f"{table.name}: worker can't fill required columns {missing}"


def _compatible(col: object) -> set[str]:
    name = type(col.type).__name__.lower()  # type: ignore[attr-defined]
    return {
        "uuid": {"uuid"},
        "string": {"varchar", "char", "string", "text"},
        "integer": {"integer"},
        "biginteger": {"biginteger", "bigint"},
        "float": {"double_precision", "float"},
        "datetime": {"timestamp"},
        "jsonb": {"jsonb"},
    }.get(name, {name})


def test_claim_takes_the_oldest_job_and_marks_it_running(engine: Engine) -> None:
    first, second = _queue(engine, 2)
    job = db.claim_next(engine, "w1", now=NOW)
    assert job is not None and job.id == first
    assert job.traceparent is not None and job.stored_name.endswith(".csv")
    assert _status(engine, first) == ("running", 1, None)
    assert _status(engine, second)[0] == "queued"


def test_concurrent_workers_never_claim_the_same_job(engine: Engine) -> None:
    ids = set(_queue(engine, 20))
    claimed: list[UUID] = []
    lock = threading.Lock()

    def work(name: str) -> None:
        while (job := db.claim_next(engine, name, now=NOW)) is not None:
            with lock:
                claimed.append(job.id)

    threads = [threading.Thread(target=work, args=(f"w{i}",)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(claimed) == sorted(ids)  # every job once, none twice


def test_complete_stores_result_and_events_in_one_step(engine: Engine) -> None:
    (aid,) = _queue(engine)
    job = db.claim_next(engine, "w1", now=NOW)
    assert job is not None
    result = {
        "hours_total": 24, "hours_scored": 20, "hours_alarmed": 5,
        "events": [{
            "id": "event-1", "kind": "fault", "fault": "condenser_fouling",
            "start": "2018-08-01T10:00:00+00:00", "end": "2018-08-01T15:00:00+00:00", "hours": 5,
            "model": {"confidence": 0.97, "detector_score": 9.2},
        }],
    }  # fmt: skip
    report = {"version": 1, "status": "accepted", "file": "a.csv", "issues": []}
    db.complete(
        engine, job, result=result, series={"version": 1}, model_version="m", pipeline_version="p",
        report=report,
    )  # fmt: skip
    assert _status(engine, aid)[0] == "succeeded"
    with engine.connect() as conn:
        row = conn.execute(select(db.analyses).where(db.analyses.c.id == aid)).one()
        events = conn.execute(select(db.fault_events)).all()
    assert row.event_count == 1 and row.result["hours_alarmed"] == 5
    assert row.processing_report == report
    assert [(e.event_key, e.fault, e.hours) for e in events] == [
        ("event-1", "condenser_fouling", 5)
    ]


def test_a_job_that_is_not_running_cannot_be_completed(engine: Engine) -> None:
    """If a job was requeued while a slow worker still held it, the slow worker's result loses."""
    _queue(engine)
    job = db.claim_next(engine, "slow", now=NOW)
    assert job is not None
    db.recover_stale(engine, timedelta(minutes=30), now=NOW + timedelta(hours=1))
    with pytest.raises(RuntimeError, match="no longer running"):
        empty = {"hours_total": 1, "hours_scored": 1, "hours_alarmed": 0, "events": []}
        db.complete(engine, job, result=empty, series={}, model_version="m", pipeline_version="p")


def test_failure_keeps_a_safe_code_and_message(engine: Engine) -> None:
    (aid,) = _queue(engine)
    job = db.claim_next(engine, "w1", now=NOW)
    assert job is not None
    report = {"version": 1, "status": "quarantined", "file": "a.csv", "issues": []}
    db.fail(
        engine, job, "validation_failed", "The file failed validation: no timestamp column",
        report=report,
    )  # fmt: skip
    assert _status(engine, aid) == ("failed", 1, "validation_failed")
    with engine.connect() as conn:
        stored = conn.execute(
            select(db.analyses.c.processing_report).where(db.analyses.c.id == aid)
        ).scalar_one()
    assert stored == report  # kept with the failure, so users see every reason (ADR 0027)


def test_stale_jobs_are_retried_then_failed(engine: Engine) -> None:
    (aid,) = _queue(engine)
    later = NOW
    for attempt in range(1, db.MAX_ATTEMPTS + 1):
        assert db.claim_next(engine, "dying", now=later) is not None
        assert _status(engine, aid)[1] == attempt
        later += timedelta(hours=1)
        db.recover_stale(engine, timedelta(minutes=30), now=later)
    assert _status(engine, aid) == ("failed", db.MAX_ATTEMPTS, "worker_timeout")
