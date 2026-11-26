"""The data-quality report a user sees for each upload (ADR 0027).

`process_file` writes a detailed per-file report for the pipeline. This module turns it into the
part a person can act on: the validation status, every issue, how complete the data is and how
the unit was operating. The worker stores it with the analysis, and the API serves it unchanged.

Its JSON Schema is committed at docs/contracts/data-quality-report.schema.json, and a test fails
if the two drift apart, so a change here is a deliberate contract change.

The server's file name never appears: it is replaced by the user's, and no path is included.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

REPORT_VERSION = 1

ValidationStatus = Literal["accepted", "accepted_with_warnings", "quarantined"]


class Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class QualityIssue(Frozen):
    severity: Literal["error", "warning"]
    code: str = Field(description="Stable code, e.g. timestamps_out_of_order")
    message: str = Field(description="What is wrong and, where possible, how to fix it")


class LoadSummary(Frozen):
    rows: int = Field(description="Data rows read from the file")
    unreadable_timestamps: int
    duplicate_timestamps: int
    gaps_over_1min: int
    dropout_rows: int = Field(description="Rows where every probe sensor read exactly 0")
    unmapped_columns: list[str] = Field(
        description="Columns ignored because the mapping omits them"
    )
    excluded_columns: dict[str, str] = Field(description="Columns the mapping excludes, with why")


class GridSummary(Frozen):
    step_seconds: int = Field(description="The file's sampling interval")
    segments: int = Field(description="Continuous stretches; a gap over an hour starts a new one")
    inserted_missing_rows: int = Field(
        description="Missing steps flagged as not observed, not filled"
    )
    output_rows: int


class OperatingSummary(Frozen):
    steady_share: float = Field(description="Share of rows in steady state")
    mode_share: dict[str, float] = Field(description="Share of rows in each operating mode")


class DataQualityReport(Frozen):
    """What FaultIQ found in one uploaded file before any analysis ran."""

    version: int = REPORT_VERSION
    status: ValidationStatus
    file: str = Field(description="The user's file name, for display only")
    sha256: str
    mapping: str = Field(description="Point mapping used to read the file")
    pipeline_version: str
    issues: list[QualityIssue]
    load: LoadSummary | None = Field(None, description="Absent when the columns could not be read")
    missing_share: dict[str, float] = Field(
        default_factory=dict,
        description="Share of rows with no usable value, per sensor role, after loading",
    )
    grid: GridSummary | None = Field(None, description="Absent when the file was quarantined")
    operating: OperatingSummary | None = Field(None, description="Absent when quarantined")


def _clean(text: str, stored_name: str, original_name: str) -> str:
    """Show the user's file name, never the server-generated one."""
    return text.replace(stored_name, original_name) if stored_name else text


def quality_report(
    report: dict[str, Any], stored_name: str, original_name: str
) -> DataQualityReport:
    """Build the user-facing report from a `process_file` report."""

    def clean(text: str) -> str:
        return _clean(text, stored_name, original_name)

    validation = report.get("validation", {})
    issues = [
        QualityIssue(severity=i["severity"], code=i["code"], message=clean(str(i["message"])))
        for i in validation.get("issues", [])
    ]
    load = report.get("load")
    load_summary = None
    missing: dict[str, float] = {}
    if load:
        rows = int(load.get("rows", 0))
        load_summary = LoadSummary(
            rows=rows,
            unreadable_timestamps=int(load.get("timestamp_unparsed", 0)),
            duplicate_timestamps=int(load.get("duplicate_timestamps", 0)),
            gaps_over_1min=int(load.get("gaps_over_1min", 0)),
            dropout_rows=int(load.get("dropout_rows", 0)),
            unmapped_columns=[clean(c) for c in load.get("unmapped_columns", [])],
            excluded_columns={
                clean(c): clean(why) for c, why in sorted(load.get("excluded_columns", {}).items())
            },
        )
        if rows:
            missing = {
                role: round(n / rows, 4)
                for role, n in sorted(load.get("final_nulls", {}).items())
                if n
            }
    grid = report.get("grid")
    state = report.get("operating_state")
    return DataQualityReport(
        status=validation.get("status", "quarantined"),
        file=original_name,
        sha256=str(report.get("source_sha256", "")),
        mapping=str(report.get("mapping", "")),
        pipeline_version=str(report.get("pipeline_version", "")),
        issues=issues,
        load=load_summary,
        missing_share=missing,
        grid=None
        if grid is None
        else GridSummary(
            step_seconds=int(grid["step_seconds"]),
            segments=int(grid["segments"]),
            inserted_missing_rows=int(grid["inserted_missing_rows"]),
            output_rows=int(grid["output_rows"]),
        ),
        operating=None
        if state is None
        else OperatingSummary(
            steady_share=float(state["steady_share"]),
            mode_share={k: float(v) for k, v in sorted(state["mode_share"].items())},
        ),
    )


def json_schema() -> str:
    """The contract file committed at docs/contracts/data-quality-report.schema.json."""
    from faultiq.explain.schema import _drop_field_titles

    schema = DataQualityReport.model_json_schema()
    _drop_field_titles(schema)
    schema["$id"] = f"https://github.com/meetmali/FaultIQ/data-quality-report/{REPORT_VERSION}"
    return json.dumps(schema, indent=2, sort_keys=True) + "\n"
