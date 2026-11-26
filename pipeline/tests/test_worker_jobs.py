from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

import joblib
import numpy as np
import pytest

from faultiq.explain.models import MANIFEST, ModelError, ModelStore
from faultiq.explain.series import lttb
from tests.test_explain import _diagnoser
from worker import db
from worker.config import WorkerSettings
from worker.jobs import JobError, analyse


def _store(tmp_path: Path) -> Path:
    path = tmp_path / "lbnl_simulated-all.joblib"
    joblib.dump(_diagnoser(), path)
    import hashlib

    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    entry = {
        "format": "lbnl_simulated", "point_set": "all", "file": path.name, "sha256": sha,
        "model_version": f"lbnl_simulated-all@test+{sha[:12]}",
    }  # fmt: skip
    (tmp_path / MANIFEST).write_text(json.dumps({"models": [entry]}))
    return path


def test_model_store_loads_a_verified_model(tmp_path: Path) -> None:
    _store(tmp_path)
    loaded = ModelStore(tmp_path).get("lbnl_simulated", "all")
    assert loaded.model_version.startswith("lbnl_simulated-all@test+")
    assert loaded.diagnoser.dataset == "simulated"


def test_model_store_refuses_a_tampered_file(tmp_path: Path) -> None:
    """Model files are pickles: a file that doesn't match the manifest is never loaded."""
    path = _store(tmp_path)
    path.write_bytes(path.read_bytes() + b"tampered")
    with pytest.raises(ModelError, match="doesn't match"):
        ModelStore(tmp_path).get("lbnl_simulated", "all")


def test_model_store_explains_what_is_missing(tmp_path: Path) -> None:
    with pytest.raises(ModelError, match="train-models"):
        ModelStore(tmp_path).get("lbnl_simulated", "all")
    _store(tmp_path)
    with pytest.raises(ModelError, match="no model"):
        ModelStore(tmp_path).get("lbnl_simulated", "basic")


def test_lttb_keeps_ends_and_spikes_in_order() -> None:
    x = np.arange(10_000, dtype=float)
    y = np.sin(x / 300)
    y[5_000] = 9.0
    keep = lttb(x, y, 200)
    assert len(keep) == 200 and keep[0] == 0 and keep[-1] == 9_999
    assert 5_000 in keep  # a plain average would have flattened it
    assert np.all(np.diff(keep) > 0)
    assert len(lttb(x[:50], y[:50], 200)) == 50  # never upsamples


def _job(fmt: str = "lbnl_simulated", stored: str = "missing.csv") -> db.Job:
    return db.Job(uuid4(), uuid4(), "all", 1, None, stored, fmt, "export.csv")


def test_job_errors_are_safe_and_coded(tmp_path: Path) -> None:
    settings = WorkerSettings(upload_dir=str(tmp_path), model_dir=str(tmp_path))
    store = ModelStore(tmp_path)
    with pytest.raises(JobError) as missing:
        analyse(_job(), settings, store)
    assert missing.value.code == "upload_missing"

    (tmp_path / "x.csv").write_text("a\n1\n")
    with pytest.raises(JobError) as unknown:
        analyse(_job("excel", "x.csv"), settings, store)
    assert unknown.value.code == "unsupported_format"

    with pytest.raises(JobError) as no_model:
        analyse(_job(stored="x.csv"), settings, store)
    assert no_model.value.code == "model_unavailable"
    assert str(tmp_path) not in no_model.value.message  # no server paths leak to users


def test_stored_names_cannot_escape_the_upload_directory(tmp_path: Path) -> None:
    (tmp_path / "secret.csv").write_text("x")
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    settings = WorkerSettings(upload_dir=str(uploads), model_dir=str(tmp_path))
    with pytest.raises(JobError) as exc:
        analyse(_job(stored="../secret.csv"), settings, ModelStore(tmp_path))
    assert exc.value.code == "upload_missing"


def test_validation_failure_reports_the_reason(tmp_path: Path) -> None:
    _store(tmp_path)
    (tmp_path / "bad.csv").write_text("not,a,valid\nexport,at,all\n")
    settings = WorkerSettings(upload_dir=str(tmp_path), model_dir=str(tmp_path))
    with pytest.raises(JobError) as exc:
        analyse(_job(stored="bad.csv"), settings, ModelStore(tmp_path))
    assert exc.value.code == "validation_failed"
    assert exc.value.message.startswith("The file failed validation:")
    assert "bad.csv" not in exc.value.message  # the server's name for the file stays internal
    assert "export.csv" in exc.value.message and len(exc.value.message) < 1000
    # The full data-quality report travels with the failure, in the user's terms (ADR 0027).
    report = exc.value.report
    assert report is not None and report["status"] == "quarantined"
    assert report["file"] == "export.csv" and "bad.csv" not in json.dumps(report)
    assert report["issues"] and all(i["severity"] in ("error", "warning") for i in report["issues"])


def test_errors_before_validation_carry_no_report(tmp_path: Path) -> None:
    settings = WorkerSettings(upload_dir=str(tmp_path), model_dir=str(tmp_path))
    with pytest.raises(JobError) as missing:
        analyse(_job(), settings, ModelStore(tmp_path))
    assert missing.value.report is None
