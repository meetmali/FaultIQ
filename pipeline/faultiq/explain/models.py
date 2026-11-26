"""Trained model files for the worker (ADR 0024).

`train_models` fits one frozen Diagnoser per supported upload format and point set and writes them
to a model directory with a manifest. The worker loads them by format.

Model files are pickles (joblib), so they can run code when loaded. They are only ever loaded from
the configured model directory, and only after their SHA-256 matches the manifest. Uploaded files
are never unpickled.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import joblib

import faultiq
from faultiq.detection.windows import SEASONS
from faultiq.diagnosis.experiment import DIAGNOSIS_VERSION
from faultiq.explain.workflow import Diagnoser, fit_experimental_roles, fit_simulated

log = logging.getLogger("faultiq.models")

# Upload format -> (dataset, bundled point mapping). Matches Formats.All in the API.
FORMATS = {
    "lbnl_simulated": ("simulated", "lbnl_simulated"),
    "lbnl_experimental": ("experimental", "lbnl_experimental"),
}
POINT_SETS = ("all", "basic")
PRODUCTION_VAL_SEASON = "Winter_2022"  # ORNL production models train on the other three seasons
MANIFEST = "manifest.json"


class ModelError(RuntimeError):
    """A model file is missing, unknown or doesn't match its manifest."""


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _production_roles() -> dict[str, str]:
    return {s: ("val" if s == PRODUCTION_VAL_SEASON else "train") for s in SEASONS}


def training_split(dataset: str) -> dict[str, Any]:
    """What the installed model for a dataset is trained and validated on (shown on /models)."""
    if dataset == "simulated":
        return {"train": "days 0-59", "validation": "days 61-80"}
    roles = _production_roles()
    return {
        "train": [s for s, r in roles.items() if r == "train"],
        "validation": PRODUCTION_VAL_SEASON,
    }


def _fit(processed: Path, dataset: str, point_set: str) -> tuple[Diagnoser, dict[str, Any]]:
    if dataset == "simulated":
        return fit_simulated(processed, point_set), training_split(dataset)
    model = fit_experimental_roles(processed, _production_roles(), point_set)
    return model, training_split(dataset)


def train_models(processed: Path, out: Path) -> Path:
    """Fit every format and point set, write model files and the manifest. Returns the manifest."""
    out.mkdir(parents=True, exist_ok=True)
    entries = []
    for fmt, (dataset, _) in FORMATS.items():
        for ps in POINT_SETS:
            diag, data = _fit(processed, dataset, ps)
            path = out / f"{fmt}-{ps}.joblib"
            joblib.dump(diag, path, compress=3)
            sha = _sha256(path)
            entries.append(
                {
                    "format": fmt,
                    "point_set": ps,
                    "file": path.name,
                    "sha256": sha,
                    "model_version": f"{fmt}-{ps}@diagnosis-{DIAGNOSIS_VERSION}+{sha[:12]}",
                    "trained_on": data,
                }
            )
            log.info("model_trained", extra={"format": fmt, "point_set": ps, "file": path.name})
    manifest = out / MANIFEST
    manifest.write_text(
        json.dumps(
            {
                "pipeline_version": faultiq.PIPELINE_VERSION,
                "diagnosis_version": DIAGNOSIS_VERSION,
                "trained_at": datetime.now(UTC).isoformat(timespec="seconds"),
                "models": entries,
            },
            indent=2,
        )
        + "\n"
    )
    return manifest


@dataclass(frozen=True)
class LoadedModel:
    diagnoser: Diagnoser
    model_version: str


class ModelStore:
    """Loads and caches verified model files from one directory."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self._cache: dict[tuple[str, str], LoadedModel] = {}

    def _manifest(self) -> dict[str, Any]:
        path = self.directory / MANIFEST
        if not path.exists():
            raise ModelError(f"no model manifest in {self.directory}; run `train-models` first")
        data: dict[str, Any] = json.loads(path.read_text())
        return data

    def get(self, fmt: str, point_set: str) -> LoadedModel:
        key = (fmt, point_set)
        if key in self._cache:
            return self._cache[key]
        entry = next(
            (
                m
                for m in self._manifest()["models"]
                if m["format"] == fmt and m["point_set"] == point_set
            ),
            None,
        )
        if entry is None:
            raise ModelError(f"no model for format {fmt!r} and point set {point_set!r}")
        path = self.directory / Path(entry["file"]).name
        if not path.exists() or _sha256(path) != entry["sha256"]:
            raise ModelError(f"model file {path.name} is missing or doesn't match its manifest")
        diag = joblib.load(path)
        if not isinstance(diag, Diagnoser):
            raise ModelError(f"{path.name} does not contain a Diagnoser")
        loaded = LoadedModel(diag, entry["model_version"])
        self._cache[key] = loaded
        return loaded
