import { BookOpen, ChevronRight } from "lucide-react";
import { useId, useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";

import { KindBadge, ReviewBadge } from "../../components/Badges";
import { DataQualityCard } from "../../components/DataQuality";
import { WorkOrderPanel } from "../../components/WorkOrderPanel";
import { ChartFigure, type ChartOption } from "../../components/charts";
import { axisName, KIND_SHADE, LINE_COLORS } from "../../components/charts/theme";
import { Empty, ErrorState, Freshness, Loading, QueryView } from "../../components/QueryState";
import { Badge, Button, Card, CardTitle, Field, inputClass, Stat, tableClass } from "../../components/ui";
import {
  useAnalyses,
  useAnalysis,
  useEquipment,
  useFaultEvents,
  useFaultTitles,
  useHealth,
  useLibraryIndex,
  useResult,
  useReview,
  useSeries,
} from "../../hooks/queries";
import { formatConfidence, formatDataTime, formatDateTime, formatNumber } from "../../lib/format";
import { faultTitle, KIND_LABEL, REVIEW_LABEL } from "../../lib/labels";
import type { AnalysisResponse, ChartSeries, DiagnosticResult, FaultEvent, FaultEventResponse, Statement } from "../../types/api";
import { CaseHistory, ContextTimeline, EvidenceWeights, ResidualExplorer, SchematicScrubber, SignatureCheck } from "./panels";

const STATEMENT_LABEL: Record<string, string> = {
  finding: "Model inference",
  measured: "Measured",
  context: "Operating context",
  uncertainty: "How far to trust this",
  recommended: "Suggested check",
};

export default function TechnicianWorkbench() {
  const { equipmentId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const equipment = useEquipment(equipmentId);
  const analyses = useAnalyses(equipmentId);
  const analysisId = params.get("analysis") ?? analyses.data?.items[0]?.id;
  const analysis = useAnalysis(analysisId);
  const ready = analysis.data?.status === "succeeded";
  const result = useResult(analysisId, ready);
  const series = useSeries(analysisId, ready);
  const id = useId();

  const select = (key: string, value: string | null) =>
    setParams((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
      if (key === "analysis") p.delete("event");
      return p;
    });

  if (equipment.isError) return <ErrorState error={equipment.error} onRetry={() => equipment.refetch()} />;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted">
        <Link to="/units" className="text-accent hover:underline">Units</Link>
        <ChevronRight aria-hidden="true" className="size-4" />
        <span aria-current="page">{equipment.data?.name ?? "Equipment"}</span>
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Diagnostic workbench: {equipment.data?.name ?? "…"}</h1>
          <p className="text-sm text-muted">{equipment.data?.site ?? "No site recorded"}</p>
        </div>
        {(analyses.data?.items.length ?? 0) > 0 && (
          <Field label="Analysis" htmlFor={`${id}-analysis`}>
            <select
              id={`${id}-analysis`}
              className={inputClass}
              value={analysisId ?? ""}
              onChange={(e) => select("analysis", e.target.value)}
            >
              {analyses.data!.items.map((a) => (
                <option key={a.id} value={a.id}>
                  {formatDateTime(a.created_at)} · {a.status} · {a.point_set} points
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {analyses.isPending ? (
        <Loading label="Loading analyses…" />
      ) : !analysisId ? (
        <Empty>This unit has no analyses yet. Upload data from the home page to analyse it.</Empty>
      ) : (
        <QueryView query={analysis} loadingLabel="Loading analysis…">
          {(a) =>
            a.status !== "succeeded" ? (
              <AnalysisStatus analysis={a} />
            ) : (
              <QueryView query={result} loadingLabel="Loading results…">
                {(r) => (
                  <Results
                    analysis={a}
                    result={r}
                    series={series.data}
                    eventKey={params.get("event")}
                    onSelect={(k) => select("event", k)}
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

function AnalysisStatus({ analysis }: { analysis: AnalysisResponse }) {
  if (analysis.status === "failed") {
    return (
      <div className="space-y-6">
        <Card>
          <CardTitle>Analysis failed</CardTitle>
          <p role="alert" className="text-sm text-fault">{analysis.error_message ?? "The analysis failed."}</p>
          <p className="mt-1 text-xs text-muted">Error code: {analysis.error_code}</p>
        </Card>
        <DataQualityCard analysis={analysis} detailed />
      </div>
    );
  }
  return (
    <Card>
      <Loading label={analysis.status === "queued" ? "Waiting for the worker to pick up this analysis…" : "Analysing… this page updates by itself."} />
      <p className="text-xs text-muted">A 100-day file usually takes under 10 seconds once started.</p>
    </Card>
  );
}

function defaultEvent(result: DiagnosticResult): string | undefined {
  const named = result.events.filter((e) => e.kind === "fault");
  const pool = named.length ? named : result.events;
  return pool.reduce<FaultEvent | undefined>((best, e) => (!best || e.hours > best.hours ? e : best), undefined)?.id;
}

function Results({
  analysis,
  result,
  series,
  eventKey,
  onSelect,
}: {
  analysis: AnalysisResponse;
  result: DiagnosticResult;
  series?: ChartSeries;
  eventKey: string | null;
  onSelect: (key: string) => void;
}) {
  const titles = useFaultTitles();
  const library = useLibraryIndex();
  const demo = useHealth().data?.demo_mode ?? false;
  const title = (f?: string | null) => (f ? (titles[f] ?? faultTitle(f)) : "No fault named");
  const selected = result.events.find((e) => e.id === (eventKey ?? defaultEvent(result)));
  const rows = useFaultEvents({ analysis_id: analysis.id, page_size: 100 });
  const byKey = new Map(rows.data?.items.map((r) => [r.event_key, r]));

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Hours analysed" value={formatNumber(result.hours_scored)} sample={demo} />
        <Stat label="Hours alarmed" value={formatNumber(result.hours_alarmed)} sample={demo} />
        <Stat label="Fault events" value={formatNumber(result.events.length)} sample={demo} />
        <Stat label="Points used" value={result.point_set === "basic" ? "Basic" : "All"} />
      </dl>
      <p className="text-xs text-muted">
        Event times are shown as recorded in the uploaded data. Model{" "}
        <Link to="/models" className="text-accent underline underline-offset-2">{analysis.model_version}</Link> · pipeline{" "}
        {analysis.pipeline_version} · result schema {result.schema_version}
      </p>

      {series?.hourly ? (
        // The schematic gets the full width so every sensor tag stays readable; the signature
        // check follows directly below it.
        <div className="space-y-6">
          <SchematicScrubber key={selected?.id} hourly={series.hourly} result={result} selected={selected} library={library} />
          {selected && <SignatureCheck event={selected} hourly={series.hourly} library={library} />}
        </div>
      ) : (
        series && (
          <p className="rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-xs text-warn">
            This analysis was stored before the live schematic existed (chart series v{series.version}). Re-run it to see sensor
            readings on the unit schematic, the signature check and the context timeline.
          </p>
        )
      )}

      {series && <OverviewChart series={series} result={result} selected={selected} />}
      {series?.hourly && (
        <div className="grid gap-6 xl:grid-cols-2">
          <ContextTimeline hourly={series.hourly} />
          <ResidualExplorer hourly={series.hourly} />
        </div>
      )}

      <Card aria-labelledby="events-heading">
        <CardTitle id="events-heading" aside={<Freshness query={rows} />}>Fault events</CardTitle>
        {result.events.length === 0 ? (
          <Empty>No alarms in this analysis: the detector found nothing abnormal.</Empty>
        ) : (
          <div className="max-h-80 overflow-auto">
            <table className={tableClass}>
              <caption className="sr-only">Fault events in this analysis; choose one to see its evidence</caption>
              <thead className="sticky top-0 bg-surface text-xs text-muted">
                <tr>
                  <th scope="col" className="py-2 font-medium">Event</th>
                  <th scope="col" className="font-medium">Result</th>
                  <th scope="col" className="font-medium">Fault</th>
                  <th scope="col" className="font-medium">Hours</th>
                  <th scope="col" className="font-medium">Confidence</th>
                  <th scope="col" className="font-medium">Review</th>
                </tr>
              </thead>
              <tbody>
                {result.events.map((e) => (
                  <tr key={e.id} className={e.id === selected?.id ? "bg-accent-soft" : "border-t border-line"}>
                    <td className="py-2 whitespace-nowrap">
                      <button
                        type="button"
                        className="text-left text-accent underline-offset-2 hover:underline"
                        aria-current={e.id === selected?.id ? "true" : undefined}
                        onClick={() => onSelect(e.id)}
                      >
                        {formatDataTime(e.start)}
                      </button>
                    </td>
                    <td><KindBadge kind={e.kind} /></td>
                    <td>{e.kind === "fault" ? title(e.fault) : "–"}</td>
                    <td className="tabular-nums">{e.hours}</td>
                    <td className="tabular-nums">{e.kind === "not_diagnosable" ? "–" : formatConfidence(e.model.confidence)}</td>
                    <td><ReviewBadge status={byKey.get(e.id)?.review_status ?? "unreviewed"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && (
        <EventDetail
          key={selected.id}
          event={selected}
          result={result}
          series={series}
          row={byKey.get(selected.id)}
          analysisId={analysis.id}
          demo={demo}
          title={title}
          rows={byKey}
          onSelect={onSelect}
        />
      )}
      <DataQualityCard analysis={analysis} detailed />
    </div>
  );
}

const DAY = 86_400_000;

function OverviewChart({ series, result, selected }: { series: ChartSeries; result: DiagnosticResult; selected?: FaultEvent }) {
  const entries = Object.entries(series.overview);
  // Open on the selected event with three days either side: 100 days of daily cycles is unreadable.
  const from = selected ? new Date(selected.start).getTime() - 3 * DAY : null;
  const to = selected ? new Date(selected.end).getTime() + 3 * DAY : null;
  const option: ChartOption = useMemo(
    () => ({
      grid: { left: 8, right: 16, top: 36, bottom: 56, containLabel: true },
      legend: { top: 0 },
      tooltip: { trigger: "axis" },
      dataZoom: [
        { type: "inside", ...(from !== null ? { startValue: from, endValue: to } : {}) },
        { type: "slider", height: 18, bottom: 8, ...(from !== null ? { startValue: from, endValue: to } : {}) },
      ],
      xAxis: { type: "time", name: "time (as recorded in the data)", nameLocation: "middle", nameGap: 28 },
      yAxis: { type: "value", name: axisName("degC"), scale: true },
      series: entries.map(([, s], i) => ({
        name: s.label,
        type: "line",
        showSymbol: false,
        lineStyle: { width: 1 },
        color: LINE_COLORS[i % LINE_COLORS.length],
        data: s.t.map((t, j) => [t, s.v[j]]),
        ...(i === 0
          ? {
              markArea: {
                silent: true,
                data: result.events.map((e) => [
                  {
                    xAxis: new Date(e.start).getTime(),
                    itemStyle: {
                      color: KIND_SHADE[e.kind],
                      // The selected event stands out; the others stay as context.
                      opacity: e.id === selected?.id ? 1 : 0.45,
                      borderColor: e.id === selected?.id ? "#0f172a" : undefined,
                      borderWidth: e.id === selected?.id ? 1 : 0,
                    },
                  },
                  { xAxis: new Date(e.end).getTime() },
                ]),
              },
            }
          : {}),
      })),
    }),
    [entries, result.events, selected?.id, from, to],
  );
  return (
    <Card>
      <ChartFigure
        title="Air temperatures over the analysis"
        description="Outdoor, return, mixed and supply air in °C. Shaded bands are fault events, coloured by result; the outlined band is the selected event. Drag the slider to see the whole period."
        option={option}
        height={320}
        summary={entries.map(([, s]) => ({ label: s.label, unit: s.unit, values: s.v }))}
      />
    </Card>
  );
}

function EvidenceChart({ signal, start, end }: { signal: ChartSeries["events"][string]["signals"][string]; start: number; end: number }) {
  const option: ChartOption = useMemo(
    () => ({
      grid: { left: 8, right: 16, top: 30, bottom: 30, containLabel: true },
      legend: { top: 0 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "time" },
      yAxis: { type: "value", name: axisName(signal.unit), scale: true },
      series: [
        {
          name: "Measured",
          type: "line",
          showSymbol: false,
          color: LINE_COLORS[0],
          data: signal.t.map((t, i) => [t, signal.observed[i]]),
          markArea: { silent: true, data: [[{ xAxis: start, itemStyle: { color: KIND_SHADE.fault } }, { xAxis: end }]] },
        },
        ...(signal.expected
          ? [
              {
                name: "Expected (normal model)",
                type: "line",
                showSymbol: false,
                color: LINE_COLORS[1],
                lineStyle: { type: "dashed" },
                data: signal.t.map((t, i) => [t, signal.expected![i]]),
              },
            ]
          : []),
      ],
    }),
    [signal, start, end],
  );
  return (
    <ChartFigure
      title={`${signal.label[0]!.toUpperCase()}${signal.label.slice(1)}: measured${signal.expected ? " against expected" : ""}`}
      description={`The shaded band is the event. ${signal.expected ? "Expected values come from the normal-behaviour model for the same conditions; gaps are where it doesn't apply." : ""}`}
      option={option}
      height={200}
      summary={[
        { label: "Measured", unit: signal.unit, values: signal.observed },
        ...(signal.expected ? [{ label: "Expected", unit: signal.unit, values: signal.expected }] : []),
      ]}
    />
  );
}

function StatementBlock({ s }: { s: Statement }) {
  return (
    <div className="space-y-1">
      <Badge className="border-line bg-raised text-ink-2">{STATEMENT_LABEL[s.kind] ?? s.kind}</Badge>
      <p className="text-sm text-ink">{s.text}</p>
    </div>
  );
}

function EventDetail({
  event,
  result,
  series,
  row,
  analysisId,
  demo,
  title,
  rows,
  onSelect,
}: {
  event: FaultEvent;
  result: DiagnosticResult;
  series?: ChartSeries;
  row?: FaultEventResponse;
  analysisId: string;
  demo: boolean;
  title: (f?: string | null) => string;
  rows: Map<string, FaultEventResponse>;
  onSelect: (key: string) => void;
}) {
  const location = useLocation();
  const from = encodeURIComponent(`${location.pathname}?analysis=${analysisId}&event=${event.id}`);
  const by = (k: string) => event.statements.filter((s) => s.kind === k);
  const chartFor = series?.events[event.id];
  const evidenceStatement = (evId: string) => event.statements.find((s) => s.kind === "measured" && s.refs.includes(evId));
  const sources = new Map(result.sources.map((s) => [s.id, s]));
  const heading = event.kind === "fault" ? title(event.fault) : KIND_LABEL[event.kind];

  return (
    <Card aria-labelledby="event-heading" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <KindBadge kind={event.kind} />
            {row && <ReviewBadge status={row.review_status} />}
          </div>
          <h2 id="event-heading" className="mt-1 text-lg font-semibold">{heading}</h2>
          <p className="text-sm text-muted">
            {formatDataTime(event.start)} to {formatDataTime(event.end)} · {event.hours} h
          </p>
        </div>
        {event.fault && (
          <Link to={`/library/${event.fault}?from=${from}`} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
            <BookOpen aria-hidden="true" className="size-4" />
            About {title(event.fault).toLowerCase()} in the Fault Library
          </Link>
        )}
      </div>

      {by("finding").map((s, i) => <StatementBlock key={i} s={s} />)}

      {(event.model.alternatives?.length ?? 0) > 0 && (
        <section aria-labelledby="alt-heading" className="space-y-2">
          <h3 id="alt-heading" className="text-sm font-semibold">Possible alternatives</h3>
          <p className="text-xs text-muted">
            Mean probability over the event for the classes the model considered most likely. A fault is named only at{" "}
            {event.model.cutoff ? formatConfidence(event.model.cutoff) : "the cut-off"} or above.
          </p>
          <ul className="space-y-1.5">
            {event.model.alternatives!.map((a) => (
              <li key={a.fault} className="grid grid-cols-[minmax(0,12rem)_1fr_4rem] items-center gap-3 text-sm">
                <span>
                  {a.fault === "fault_free" ? "Normal operation" : (
                    <Link to={`/library/${a.fault}?from=${from}`} className="text-accent hover:underline">{title(a.fault)}</Link>
                  )}
                </span>
                <span className="h-2 rounded bg-raised" aria-hidden="true">
                  <span className="block h-2 rounded bg-accent" style={{ width: `${Math.max(1, a.probability * 100)}%` }} />
                </span>
                <span className="text-right tabular-nums">{formatConfidence(a.probability)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="evidence-heading" className="space-y-4">
        <h3 id="evidence-heading" className="text-sm font-semibold">Measured evidence</h3>
        {event.evidence.length === 0 && <Empty>No signal stood out enough to show as evidence.</Empty>}
        {event.evidence.map((ev) => (
          <div key={ev.id} className="space-y-2 border-t border-line pt-3">
            {evidenceStatement(ev.id) && <StatementBlock s={evidenceStatement(ev.id)!} />}
            {chartFor?.signals[ev.id] ? (
              <EvidenceChart signal={chartFor.signals[ev.id]!} start={chartFor.start} end={chartFor.end} />
            ) : (
              <p className="text-xs text-muted">
                {ev.kind === "rule" ? "Rule results are a share of minutes, so there is no single signal to chart." : "No chart stored for this signal."}
              </p>
            )}
          </div>
        ))}
      </section>

      <EvidenceWeights event={event} />

      <div className="grid gap-4 md:grid-cols-2">
        {by("context").map((s, i) => <StatementBlock key={i} s={s} />)}
        {by("uncertainty").map((s, i) => <StatementBlock key={i} s={s} />)}
      </div>

      {by("recommended").length > 0 && (
        <section aria-labelledby="checks-heading" className="space-y-2">
          <h3 id="checks-heading" className="text-sm font-semibold">Suggested checks</h3>
          {result.library_review_status !== "reviewed" && (
            <p className="rounded-md border border-warn-line bg-warn-soft px-3 py-2 text-xs text-warn">
              These come from a fault library that hasn't yet been reviewed by an HVAC professional. Treat them as
              suggestions to verify, not instructions.
            </p>
          )}
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {by("recommended").map((s, i) => (
              <li key={i}>
                {s.text}{" "}
                <span className="text-xs text-muted">[{s.refs.map((r) => sources.get(r)?.citation ?? r).join("; ")}]</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <CaseHistory result={result} event={event} rows={rows} onSelect={onSelect} />

      <WorkOrderPanel eventId={row?.id} kind={event.kind} />

      {row && (demo ? (
        <p className="text-xs text-muted">Reviews are disabled in the public demo.</p>
      ) : (
        // Re-mount when the stored review changes, so the form shows what was saved.
        <ReviewForm key={`${row.id}-${row.reviewed_at ?? "none"}`} row={row} analysisId={analysisId} />
      ))}
    </Card>
  );
}

function ReviewForm({ row, analysisId }: { row: FaultEventResponse; analysisId: string }) {
  const id = useId();
  const review = useReview(analysisId);
  const [status, setStatus] = useState(row.review_status);
  const [note, setNote] = useState(row.review_note ?? "");

  function submit(e: FormEvent) {
    e.preventDefault();
    review.mutate({ eventId: row.id, status, note: note.trim() || undefined });
  }

  return (
    <form onSubmit={submit} aria-labelledby={`${id}-h`} className="space-y-3 rounded-md border border-line bg-raised p-3">
      <h3 id={`${id}-h`} className="text-sm font-semibold">Review this event</h3>
      <p className="text-xs text-muted">Record what a technician found. Confirmed outcomes become labelled data for future models.</p>
      <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
        <Field label="Outcome" htmlFor={`${id}-status`}>
          <select id={`${id}-status`} className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(REVIEW_LABEL).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="Note (optional)" htmlFor={`${id}-note`}>
          <input id={`${id}-note`} className={inputClass} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={review.isPending}>{review.isPending ? "Saving…" : "Save review"}</Button>
        <span aria-live="polite" className="text-xs">
          {review.isSuccess && <span className="text-ok">Saved.</span>}
          {review.isError && <span className="text-fault">{review.error.message}</span>}
        </span>
        {row.reviewed_at && <span className="text-xs text-muted">Last reviewed {formatDateTime(row.reviewed_at)}</span>}
      </div>
    </form>
  );
}
