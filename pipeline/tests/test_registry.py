"""The model registry served at GET /api/v1/models (ADR 0027)."""

from __future__ import annotations

import json
from pathlib import Path

from faultiq.explain.models import FORMATS, POINT_SETS
from faultiq.explain.registry import model_registry, registry_json

ROOT = Path(__file__).parents[2]
RESULTS = json.loads((ROOT / "docs" / "diagnosis" / "results.json").read_text())
SERVED = ROOT / "api" / "src" / "FaultIQ.Api" / "Models" / "model-registry.json"


def test_served_registry_matches_its_sources() -> None:
    """The API embeds a generated file; regenerate with `python -m faultiq export-models`."""
    assert SERVED.read_text() == registry_json(RESULTS)


def test_every_format_and_point_set_has_one_entry_with_the_adopted_scores() -> None:
    reg = model_registry(RESULTS)
    keys = [(m["format"], m["point_set"]) for m in reg["models"]]
    assert sorted(keys) == sorted((f, p) for f in FORMATS for p in POINT_SETS)
    sim_all = next(
        m for m in reg["models"] if m["format"] == "lbnl_simulated" and m["point_set"] == "all"
    )
    assert sim_all["adopted_model"] == "lightgbm"
    assert (
        sim_all["held_out"]["test_macro_f1"]
        == RESULTS["simulated"]["all"]["test_macro_f1"]["lightgbm"]
    )
    assert "fault_free" not in sim_all["faults"] and "condenser_fouling" in sim_all["faults"]
    ornl = next(
        m for m in reg["models"] if m["format"] == "lbnl_experimental" and m["point_set"] == "all"
    )
    assert ornl["adopted_model"] == "logistic"
    assert ornl["trained_on"] == {
        "train": "Fall 2020, Spring 2021, Summer 2021",
        "validation": "Winter 2022",
    }
