import { ChevronRight, ClipboardCopy, HardHat } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { usePreferences } from "../../app/preferences";
import { IsometricRtu } from "../../components/illustrations/IsometricRtu";
import { COMPONENT_LABEL, isComponent, type UnitState } from "../../components/illustrations/components";
import { DataQualityCard } from "../../components/DataQuality";
import { Empty, ErrorState, Loading, QueryView } from "../../components/QueryState";
import { Badge, Button, Card, CardTitle } from "../../components/ui";
import { HealthStrip, Meter, type StripSegment } from "../../components/visuals";
import { useAnalyses, useAnalysis, useEquipment, useHealth, useLibraryIndex, useResult, useSeries } from "../../hooks/queries";
import { formatDataTime, formatPercent } from "../../lib/format";
import { faultTitle } from "../../lib/labels";
import { TONE, type Tone } from "../../lib/tone";
import { duration, faultHours, likelihood, mainEvent } from "../../lib/unit";
import type { AnalysisResponse, ChartSeries, DiagnosticResult, LibraryFault } from "../../types/api";

export default function OperatorUnit() {
  const { equipmentId = "" } = useParams();
  const [params] = useSearchParams();
  const equipment = useEquipment(equipmentId);
  const analyses = useAnalyses(equipmentId);
  const analysisId = params.get("analysis") ?? analyses.data?.items[0]?.id;
  const analysis = useAnalysis(analysisId);
  const ready = analysis.data?.status === "succeeded";
  const result = useResult(analysisId, ready);
  const series = useSeries(analysisId, ready);

  if (equipment.isError) return <ErrorState error={equipment.error} onRetry={() => equipment.refetch()} />;
  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted">
        <Link to="/units" className="text-accent hover:underline">Units</Link>
        <ChevronRight aria-hidden="true" className="size-4" />
        <span aria-current="page">{equipment.data?.name ?? "Unit"}</span>
      </nav>
      {analyses.isPending ? (
        <Loading />
      ) : !analysisId ? (
        <Empty>This unit hasn't been analysed yet.</Empty>
      ) : (
        <QueryView query={analysis}>
          {(a) =>
            a.status === "failed" ? (
              <div className="space-y-6">
                <Card><CardTitle>We couldn't analyse this unit's data</CardTitle><p className="text-sm text-ink-2">{a.error_message}</p></Card>
                <DataQualityCard analysis={a} detailed={false} />
              </div>
            ) : a.status !== "succeeded" ? (
              <Card><Loading label="FaultIQ is checking this unit's data. This page updates by itself." /></Card>
            ) : (
              <QueryView query={result}>
                {(r) => (
                  <UnitStory
                    name={equipment.data?.name ?? "This unit"}
                    site={equipment.data?.site ?? null}
                    result={r}
                    series={series.data}
                    analysis={a}
                    history={analyses.data?.items ?? []}
                    eventKey={params.get("event")}
                  />
                )}
              </QueryView>
            )
          }
        </QueryView>
      )}
    </div>
  );
}

function UnitStory({
  name,
  site,
  result,
  series,
  analysis,
  history,
  eventKey,
}: {
  name: string;
  site: string | null;
  result: DiagnosticResult;
  series?: ChartSeries;
  analysis: AnalysisResponse;
  history: AnalysisResponse[];
  eventKey: string | null;
}) {
  const library = useLibraryIndex();
  const { setPersona } = usePreferences();
  const demo = useHealth().data?.demo_mode ?? false;
  const [copied, setCopied] = useState(false);
  const event = result.events.find((e) => e.id === eventKey) ?? mainEvent(result.events);
  const fault: LibraryFault | undefined = event?.fault ? library.get(event.fault) : undefined;
  const totals = faultHours(result.events);
  const hoursOfMain = event?.fault ? (totals.find(([f]) => f === event.fault)?.[1] ?? event.hours) : (event?.hours ?? 0);
  const state: UnitState = !event ? "normal" : event.kind === "fault" ? "fault" : event.kind === "not_diagnosable" ? "normal" : "unclear";
  const comp = fault && isComponent(fault.component) ? fault.component : null;
  const like = event ? likelihood(event) : null;
  const plainName = event?.kind === "fault" ? (fault?.plain_name ?? faultTitle(event.fault)) : "Unusual behaviour, cause unclear";

  const summary = event
    ? `${name}${site ? ` (${site})` : ""}: ${plainName}. ${like} after ${duration(hoursOfMain)} of data, first seen ${formatDataTime(event.start)}.` +
      (fault?.what_to_do ? ` Suggested next step: ${fault.what_to_do.text}` : "") +
      ` Details for the technician: ${window.location.origin}${window.location.pathname}?analysis=${analysis.id}&event=${event.id}`
    : `${name}: no faults found in the latest analysis.`;

  return (
    <div className="space-y-6">
      <div className="grid items-center gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <h1 className="text-2xl font-semibold text-ink">{name}</h1>
          <p className="text-sm text-muted">{site ?? "No site recorded"} · rooftop unit</p>
          <IsometricRtu
            state={state}
            component={comp}
            title={`${name}, ${state === "normal" ? "healthy" : "running"}.${comp ? ` Problem area: ${COMPONENT_LABEL[comp]}.` : ""}`}
            className="mt-2 max-w-2xl"
          />
        </div>
        <Card className="lg:col-span-2" aria-labelledby="summary-heading">
          {!event ? (
            <>
              <CardTitle id="summary-heading">No faults found</CardTitle>
              <p className="text-base text-ink-2">FaultIQ found nothing abnormal in this unit's latest data.</p>
            </>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge className={TONE[like === "Likely" ? "fault" : "warn"]}>{like}</Badge>
                {demo && <Badge className={TONE.warn}>Sample data</Badge>}
              </div>
              <h2 id="summary-heading" className="text-xl font-semibold text-ink">{plainName}</h2>
              {event.kind === "fault" && fault?.plain_summary && <p className="mt-2 text-base text-ink-2">{fault.plain_summary.text}</p>}
              {event.kind !== "fault" && (
                <p className="mt-2 text-base text-ink-2">The unit behaved unusually, but not like any fault FaultIQ knows well enough to name. A technician should take a look.</p>
              )}
              <p className="mt-3 text-sm text-muted">
                Seen for {duration(hoursOfMain)} · first seen {formatDataTime(event.start)}
              </p>
              {event.kind === "fault" && fault?.what_to_do && (
                <div className="mt-4 rounded-xl border border-line bg-raised p-3">
                  <p className="text-xs font-semibold tracking-wide text-muted uppercase">What to do</p>
                  <p className="mt-1 text-sm text-ink">{fault.what_to_do.text}</p>
                  <p className="mt-1 text-xs text-muted">A suggestion to verify, not an instruction. The fault library hasn't yet been reviewed by an HVAC professional.</p>
                </div>
              )}
              {event.kind === "fault" && fault && (
                <div className="mt-4"><Meter value={fault.measured.performance.precision} label="How often FaultIQ is right when it names this fault" /></div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(summary);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  <ClipboardCopy aria-hidden="true" className="size-4" />
                  {copied ? "Copied" : "Copy summary for my technician"}
                </Button>
                <Button variant="ghost" onClick={() => setPersona("technician")}>
                  <HardHat aria-hidden="true" className="size-4" />
                  Open technician view
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      <Card aria-labelledby="timeline-heading">
        <CardTitle id="timeline-heading" sub="Every hour of this analysis. Red: a named fault. Amber: unusual, cause unclear. Green: running normally. Grey: off or not enough data.">
          When was something wrong?
        </CardTitle>
        <Timeline result={result} series={series} />
      </Card>

      {totals.length > 1 && (
        <Card aria-labelledby="other-heading">
          <CardTitle id="other-heading">Other findings on this unit</CardTitle>
          <ul className="flex flex-wrap gap-2">
            {totals.filter(([f]) => f !== event?.fault).map(([f, h]) => (
              <li key={f}><Badge className={TONE.idle}>{library.get(f)?.plain_name ?? faultTitle(f)} · {duration(h)}</Badge></li>
            ))}
          </ul>
        </Card>
      )}

      <BeforeAfter history={history} current={analysis} />
      <DataQualityCard analysis={analysis} detailed={false} />
    </div>
  );
}

function Timeline({ result, series }: { result: DiagnosticResult; series?: ChartSeries }) {
  const h = series?.hourly;
  let segments: StripSegment[];
  if (h) {
    segments = h.t.map((_, i) => {
      const tone: Tone | "none" = !h.diagnosable[i] && !h.alarm[i]
        ? "none"
        : !h.alarm[i]
          ? "ok"
          : ["fault_free", "inconclusive", "not_diagnosable"].includes(h.answer[i] ?? "")
            ? "warn"
            : "fault";
      return { tone };
    });
  } else {
    // Older analyses: rebuild from events (hours outside events count as normal).
    const start = Date.parse(result.period_start ?? result.events[0]?.start ?? "");
    segments = Array.from({ length: result.hours_total }, () => ({ tone: "ok" as Tone | "none" }));
    for (const e of result.events) {
      const a = Math.floor((Date.parse(e.start) - start) / 3_600_000);
      for (let i = a; i < a + e.hours && i < segments.length; i++) segments[i] = { tone: e.kind === "fault" ? "fault" : "warn" };
    }
  }
  const count = (t: Tone | "none") => segments.filter((s) => s.tone === t).length;
  return (
    <HealthStrip
      segments={segments}
      start={formatDataTime(result.period_start)}
      end={formatDataTime(result.period_end)}
      label="Hourly health of this unit"
      legend={[
        { tone: "fault", text: "Named fault", count: count("fault") },
        { tone: "warn", text: "Unusual", count: count("warn") },
        { tone: "ok", text: "Normal", count: count("ok") },
        { tone: "none", text: "Off or not enough data", count: count("none") },
      ]}
    />
  );
}

function BeforeAfter({ history, current }: { history: AnalysisResponse[]; current: AnalysisResponse }) {
  const done = history.filter((a) => a.status === "succeeded" && a.hours_scored);
  const i = done.findIndex((a) => a.id === current.id);
  const previous = i >= 0 ? done[i + 1] : undefined;
  if (!previous) return null;
  const share = (a: AnalysisResponse) => (a.hours_alarmed ?? 0) / (a.hours_scored || 1);
  return (
    <Card aria-labelledby="ba-heading">
      <CardTitle id="ba-heading" sub="Share of running hours with a detector alarm, this analysis against the one before.">Getting better?</CardTitle>
      <div className="flex flex-wrap items-center gap-6 text-ink">
        <div><p className="text-xs text-muted">Before</p><p className="text-3xl font-semibold tabular-nums">{formatPercent(share(previous))}</p></div>
        <ChevronRight aria-hidden="true" className="size-6 text-muted" />
        <div><p className="text-xs text-muted">Now</p><p className="text-3xl font-semibold tabular-nums">{formatPercent(share(current))}</p></div>
      </div>
    </Card>
  );
}
