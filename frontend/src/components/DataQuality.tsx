import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from "lucide-react";

import { useReport } from "../hooks/queries";
import { formatNumber, formatPercent } from "../lib/format";
import { TONE, type Tone } from "../lib/tone";
import type { AnalysisResponse, DataQualityReport, QualityIssue } from "../types/api";
import { QueryView } from "./QueryState";
import { Badge, Card, CardTitle, tableClass } from "./ui";

// The data-quality report for an upload (ADR 0027): every validation issue, how complete the data
// is and how the unit was operating. Operators get the verdict and the reasons in words;
// technicians also get codes, per-sensor completeness and the file's lineage.

const STATUS: Record<DataQualityReport["status"], { label: string; tone: Tone; icon: LucideIcon; summary: string }> = {
  accepted: {
    label: "Accepted",
    tone: "ok",
    icon: CheckCircle2,
    summary: "The file passed every check.",
  },
  accepted_with_warnings: {
    label: "Accepted with warnings",
    tone: "warn",
    icon: AlertTriangle,
    summary: "The file was analysed. The notes below say what was missing or set aside; nothing was filled in.",
  },
  quarantined: {
    label: "Not accepted",
    tone: "fault",
    icon: XCircle,
    summary: "The file was not analysed. Fix the problems below and upload it again.",
  },
};

const MODE_LABEL: Record<string, string> = {
  off: "Off",
  fan_only: "Fan only",
  economizer: "Economizer",
  economizer_cooling: "Economizer and cooling",
  cooling: "Cooling",
  heating: "Heating",
  unknown: "Unknown",
};

export function ReportStatusBadge({ status }: { status: DataQualityReport["status"] }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <Badge className={TONE[s.tone]}>
      <Icon aria-hidden="true" className="size-3.5" />
      {s.label}
    </Badge>
  );
}

function IssueList({ issues, showCodes }: { issues: QualityIssue[]; showCodes: boolean }) {
  // Errors first: they are why a file was not accepted.
  const sorted = [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  return (
    <ul className="space-y-2">
      {sorted.map((issue, i) => {
        const Icon = issue.severity === "error" ? XCircle : AlertTriangle;
        return (
          <li key={`${issue.code}-${i}`} className="flex gap-2 text-sm">
            <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${issue.severity === "error" ? "text-fault" : "text-warn"}`} />
            <span>
              <span className="sr-only">{issue.severity === "error" ? "Problem: " : "Note: "}</span>
              {issue.message}
              {showCodes && <code className="ml-2 rounded bg-raised px-1 text-xs text-muted">{issue.code}</code>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Facts({ report }: { report: DataQualityReport }) {
  const items: [string, string][] = [];
  if (report.load) items.push(["Rows read", formatNumber(report.load.rows)]);
  if (report.grid) {
    items.push(["Sampling interval", `${formatNumber(report.grid.step_seconds / 60, report.grid.step_seconds % 60 ? 1 : 0)} min`]);
    items.push(["Continuous stretches", formatNumber(report.grid.segments)]);
    items.push(["Missing steps flagged", formatNumber(report.grid.inserted_missing_rows)]);
  }
  if (report.operating) items.push(["Time in steady state", formatPercent(report.operating.steady_share)]);
  if (!items.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="font-medium text-ink tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Details({ report }: { report: DataQualityReport }) {
  const missing = Object.entries(report.missing_share ?? {}).sort((a, b) => b[1] - a[1]);
  const modes = Object.entries(report.operating?.mode_share ?? {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const unmapped = report.load?.unmapped_columns ?? [];
  const excluded = Object.entries(report.load?.excluded_columns ?? {});
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">Missing values by sensor</h3>
        {missing.length ? (
          <table className={tableClass}>
            <caption className="sr-only">Share of rows with no usable value, per sensor role</caption>
            <thead>
              <tr><th scope="col" className="font-medium">Sensor role</th><th scope="col" className="text-right font-medium">Rows missing</th></tr>
            </thead>
            <tbody>
              {missing.map(([role, share]) => (
                <tr key={role} className="border-t border-line">
                  <td className="py-1 font-mono text-xs">{role}</td>
                  <td className="py-1 text-right tabular-nums">{formatPercent(share, share < 0.01 ? 1 : 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted">Every mapped sensor has a value on every row.</p>
        )}
      </div>
      <div className="space-y-4">
        {modes.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Operating modes</h3>
            <ul className="flex flex-wrap gap-2">
              {modes.map(([mode, share]) => (
                <li key={mode}><Badge className={TONE.idle}>{MODE_LABEL[mode] ?? mode} · {formatPercent(share)}</Badge></li>
              ))}
            </ul>
          </div>
        )}
        {(unmapped.length > 0 || excluded.length > 0) && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Columns not used</h3>
            <ul className="space-y-1 text-sm">
              {excluded.map(([col, why]) => (
                <li key={col}><span className="font-mono text-xs">{col}</span> <span className="text-muted">excluded: {why}</span></li>
              ))}
              {unmapped.map((col) => (
                <li key={col}><span className="font-mono text-xs">{col}</span> <span className="text-muted">not in the point mapping</span></li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs break-all text-muted">
          File SHA-256 {report.sha256} · mapping {report.mapping} · pipeline {report.pipeline_version}
        </p>
      </div>
    </div>
  );
}

/** The report for one analysis. Renders nothing until the analysis has finished or failed. */
export function DataQualityCard({ analysis, detailed }: { analysis: AnalysisResponse; detailed: boolean }) {
  const finished = analysis.status === "succeeded" || analysis.status === "failed";
  const report = useReport(analysis.id, finished);
  if (!finished) return null;
  return (
    <Card aria-labelledby={`quality-${analysis.id}`}>
      <QueryView query={report} loadingLabel="Loading the data-quality report…">
        {(r) =>
          r === null ? (
            <>
              <CardTitle id={`quality-${analysis.id}`}>Data quality</CardTitle>
              <p className="flex gap-2 text-sm text-muted">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                No data-quality report for this analysis. It stopped before the file was checked, or it ran before reports were kept.
              </p>
            </>
          ) : (
            <div className="space-y-4">
              <CardTitle
                id={`quality-${analysis.id}`}
                sub={`${r.file} · ${STATUS[r.status].summary}`}
                aside={<ReportStatusBadge status={r.status} />}
              >
                Data quality
              </CardTitle>
              <Facts report={r} />
              {r.issues.length > 0 ? (
                <IssueList issues={r.issues} showCodes={detailed} />
              ) : (
                <p className="text-sm text-muted">No problems found.</p>
              )}
              {detailed && <Details report={r} />}
            </div>
          )
        }
      </QueryView>
    </Card>
  );
}
