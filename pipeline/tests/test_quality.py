"""The data-quality report users see for each upload (ADR 0027)."""

from __future__ import annotations

import json
import tomllib
from pathlib import Path

from faultiq.ingestion.mapping import parse_mapping
from faultiq.pipeline import process_file
from faultiq.quality import DataQualityReport, json_schema, quality_report
from tests.helpers import USER_COLUMNS, USER_MAPPING_TOML, user_rows, write_csv

MAPPING = parse_mapping(tomllib.loads(USER_MAPPING_TOML))
CONTRACT = Path(__file__).parents[2] / "docs" / "contracts" / "data-quality-report.schema.json"
STORED = "01a1f68d79e372a8b5e89d9b1d27c712.csv"


def _report(
    tmp_path: Path, rows: list[list[object]], columns: list[str] = USER_COLUMNS
) -> DataQualityReport:
    src = write_csv(tmp_path / STORED, columns, rows)
    outcome = process_file(src, MAPPING, tmp_path / "out")
    raw = json.loads((tmp_path / "out" / outcome.report).read_text())
    return quality_report(raw, STORED, "Building A export.csv")


def test_accepted_file_reports_completeness_and_operation(tmp_path: Path) -> None:
    rows = user_rows(90)
    for r in rows[10:40]:
        r[1] = None  # 30 of 90 supply-air readings missing
    report = _report(tmp_path, rows)
    assert report.status == "accepted_with_warnings"
    assert report.file == "Building A export.csv"
    assert report.load is not None and report.load.rows == 90
    assert report.missing_share["sat"] == round(30 / 90, 4)
    assert "oat" not in report.missing_share  # only roles with gaps are listed
    assert report.load.excluded_columns == {"Spare AI": "not connected"}
    assert report.grid is not None and report.grid.step_seconds == 60
    assert report.operating is not None and 0 <= report.operating.steady_share <= 1
    assert [i.code for i in report.issues] == ["missing_values"]


def test_quarantined_file_lists_every_issue_without_server_names(tmp_path: Path) -> None:
    rows = user_rows(5)
    rows[1][0], rows[2][0] = rows[2][0], rows[1][0]
    report = _report(tmp_path, rows)
    assert report.status == "quarantined"
    assert report.grid is None and report.operating is None
    codes = [i.code for i in report.issues]
    assert "timestamps_out_of_order" in codes
    assert any(
        i.message.endswith("Sort the export by time and upload it again.") for i in report.issues
    )
    text = report.model_dump_json()
    assert STORED not in text and str(tmp_path) not in text


def test_unreadable_columns_still_give_a_report(tmp_path: Path) -> None:
    report = _report(tmp_path, [r[:-2] for r in user_rows(5)], USER_COLUMNS[:-2])
    assert report.status == "quarantined" and report.load is None
    (issue,) = report.issues
    assert issue.code == "schema"
    assert issue.message.startswith("Building A export.csv: missing columns")
    assert STORED not in issue.message


def test_committed_contract_matches_the_schema() -> None:
    """The API serves this JSON and the frontend's types come from this file."""
    assert CONTRACT.read_text() == json_schema()
