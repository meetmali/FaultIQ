"""The model registry the API serves at GET /api/v1/models (ADR 0027).

One entry per upload format and point set: which model the method adopted, what it is trained on,
which faults it supports and how the method did on held-out data. Everything measured comes from
the committed results (docs/diagnosis/results.json), never from a model file: model files are
trained locally from the licensed data, so the numbers describe the method at a diagnosis
version, and the API joins them with the model versions actually recorded on analyses.

The output is committed in the API project and a test regenerates it, so the two can't drift.
"""

from __future__ import annotations

import json
from typing import Any

from faultiq.explain.library_export import DATASET_OF
from faultiq.explain.models import FORMATS, POINT_SETS, training_split

REGISTRY_VERSION = 1
EVALUATION = {
    "simulated": "Day blocks: train on days 0-59, validate on 61-80, test on 82-99.",
    "experimental": "Leave one season out: each season is tested once, the next season "
    "validates and the other two train.",
}


def _split_text(value: Any) -> str:
    """Days or seasons, readable: ["Fall_2020", "Spring_2021"] -> "Fall 2020, Spring 2021"."""
    items = value if isinstance(value, list) else [value]
    return ", ".join(str(v).replace("_", " ") for v in items)


def model_registry(results: dict[str, Any]) -> dict[str, Any]:
    models = []
    for fmt, (dataset, _) in FORMATS.items():
        for ps in POINT_SETS:
            r = results[dataset][ps]
            main = r["main"]
            adopted = r["adopted"]
            answers = main["answers"]
            split = training_split(dataset)
            models.append({
                "format": fmt,
                "point_set": ps,
                "dataset": dataset,
                "dataset_label": DATASET_OF[dataset][1],
                "adopted_model": adopted,
                "trained_on": {k: _split_text(v) for k, v in split.items()},
                "evaluation": EVALUATION[dataset],
                "faults": sorted(
                    c["class"] for c in main["per_class"] if c["class"] != "fault_free"
                ),
                "held_out": {
                    "test_hours": answers["windows"],
                    "test_macro_f1": r["test_macro_f1"][adopted],
                    "validation_macro_f1": r["validation_macro_f1"][adopted],
                    "answered_share": answers["answered_share"],
                    "named_fault_precision": answers["named_fault_precision"],
                    "right_fault_on_faulty_hours": answers["faulty_windows"]["correct_fault"],
                    "calibration_error": main["calibration_error"],
                },
            })  # fmt: skip
    return {
        "version": REGISTRY_VERSION,
        "diagnosis_version": results["diagnosis_version"],
        "pipeline_version": results["pipeline_version"],
        "evaluated_on": results["generated"],
        "target_named_fault_precision": results["target_named_fault_precision"],
        "models": models,
    }


def registry_json(results: dict[str, Any]) -> str:
    return json.dumps(model_registry(results), indent=2, sort_keys=True) + "\n"
