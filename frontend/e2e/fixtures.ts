// Recorded API responses for the CI journey (ADR 0025). Built from files already committed: the
// Phase 5 example explanation and the generated fault library. Chart series are synthetic, so no
// LBNL sensor values are committed (the dataset is downloaded under its own terms).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Page, Route } from "@playwright/test";

const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const result = JSON.parse(readFileSync(root("docs/explanations/examples/simulated-condenser-fouling.json"), "utf8"));
const library = JSON.parse(readFileSync(root("api/src/FaultIQ.Api/FaultLibrary/fault-library.json"), "utf8"));
const registry = JSON.parse(readFileSync(root("api/src/FaultIQ.Api/Models/model-registry.json"), "utf8"));

export const EQUIPMENT_ID = "0190a1f3-0000-7000-8000-000000000001";
export const ANALYSIS_ID = "0190a1f3-0000-7000-8000-000000000002";
export const event = result.events[0];
export const faultTitle: string = library.faults.find((f: { id: string }) => f.id === event.fault).title;

const at = (iso: string) => new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`).getTime();

function wave(start: number, hours: number, base: number, amp: number) {
  const t: number[] = [];
  const v: number[] = [];
  for (let i = 0; i <= hours * 4; i++) {
    t.push(start + i * 15 * 60_000);
    v.push(Math.round((base + amp * Math.sin(i / 8)) * 100) / 100);
  }
  return { t, v };
}

function series() {
  const start = at(result.period_start ?? event.start) ;
  const overview = Object.fromEntries(
    [["oat", "outdoor-air temperature", 20, 6], ["rat", "return-air temperature", 24, 1], ["sat", "supply-air temperature", 12, 2]].map(
      ([k, label, base, amp]) => [k, { label, unit: "degC", ...wave(start, 24 * 20, base as number, amp as number) }],
    ),
  );
  const s = at(event.start);
  const e = at(event.end);
  const signals = Object.fromEntries(
    event.evidence.map((ev: { id: string; signal: string; unit: string; kind: string; observed: number }) => {
      const w = wave(s - 2 * 3_600_000, (e - s) / 3_600_000 + 4, ev.observed, ev.observed * 0.02);
      return [ev.id, { label: ev.signal, unit: ev.unit, t: w.t, observed: w.v, ...(ev.kind === "residual" ? { expected: w.v.map((x) => x * 0.96) } : {}) }];
    }),
  );
  // Series v2 hourly table: synthetic, aligned, with one residual far outside its band in the event.
  const hours = Array.from({ length: 24 * 20 }, (_, i) => start + i * 3_600_000);
  const inEvent = hours.map((t) => t >= s && t < e);
  const hourly = {
    t: hours,
    mode: hours.map(() => "cooling"),
    steady_minutes: hours.map(() => 55),
    diagnosable: hours.map(() => true),
    alarm: inEvent,
    answer: inEvent.map((x) => (x ? event.fault : "fault_free")),
    confidence: inEvent.map((x) => (x ? 0.99 : 0.6)),
    columns: {
      sat: { label: "supply-air temperature", unit: "degC", kind: "signal", values: hours.map(() => 11.2) },
      refg_disc_pres: { label: "discharge pressure", unit: "kPa", kind: "signal", values: hours.map((_, i) => (inEvent[i] ? 1890 : 1800)) },
      "resid:refg_disc_pres": {
        label: "discharge pressure", unit: "errors", kind: "residual", values: hours.map((_, i) => (inEvent[i] ? 5.8 : 0.1)),
        normal_low: -0.8, normal_high: 0.7,
      },
      "med:condensing_approach": {
        label: "condensing approach temperature", unit: "K", kind: "physics", values: hours.map((_, i) => (inEvent[i] ? 15 : 12)),
        normal_low: 9.2, normal_high: 13.3,
      },
    },
  };
  return { version: 2, overview, events: { [event.id]: { start: s, end: e, signals } }, hourly };
}

const analysis = {
  id: ANALYSIS_ID, upload_id: "0190a1f3-0000-7000-8000-000000000003", equipment_id: EQUIPMENT_ID, point_set: "all",
  status: "succeeded", attempts: 1, created_at: "2026-11-19T09:31:00Z", started_at: "2026-11-19T09:31:01Z",
  finished_at: "2026-11-19T09:31:06Z", error_code: null, error_message: null, pipeline_version: result.pipeline_version,
  model_version: "lbnl_simulated-all@diagnosis-0.1.0+fixture", hours_total: result.hours_total, hours_scored: result.hours_scored,
  hours_alarmed: result.hours_alarmed, event_count: result.events.length,
};

const eventRows = result.events.map((ev: { id: string; kind: string; fault: string | null; start: string; end: string; hours: number; model: { confidence: number | null; detector_score: number } }, i: number) => ({
  id: `0190a1f3-0000-7000-8000-0000000001${String(i).padStart(2, "0")}`, analysis_id: ANALYSIS_ID, equipment_id: EQUIPMENT_ID,
  event_key: ev.id, kind: ev.kind, fault: ev.fault, starts_at: ev.start, ends_at: ev.end, hours: ev.hours,
  confidence: ev.model.confidence, detector_score: ev.model.detector_score, review_status: "unreviewed", review_note: null, reviewed_at: null,
}));

const page = <T>(items: T[]) => ({ items, page: 1, page_size: 20, total: items.length });

// Data-quality report (ADR 0027): synthetic counts, shaped like docs/contracts/data-quality-report.schema.json.
const report = {
  version: 1, status: "accepted_with_warnings", file: "rtu-1 export.csv", sha256: "0".repeat(64), mapping: "lbnl_simulated",
  pipeline_version: result.pipeline_version,
  issues: [{ severity: "warning", code: "gaps", message: "2 gaps longer than one minute. Missing minutes are flagged, not filled." }],
  load: {
    rows: result.hours_total * 60, unreadable_timestamps: 0, duplicate_timestamps: 0, gaps_over_1min: 2, dropout_rows: 0,
    unmapped_columns: [], excluded_columns: {},
  },
  missing_share: { sat: 0.002 },
  grid: { step_seconds: 60, segments: 1, inserted_missing_rows: 3, output_rows: result.hours_total * 60 + 3 },
  operating: { steady_share: 0.71, mode_share: { cooling: 0.8, fan_only: 0.05, off: 0.15 } },
};

// GET /models: the committed registry, with the fixture analysis's version recorded on its entry.
const models = {
  diagnosis_version: registry.diagnosis_version, evaluated_with_pipeline_version: registry.pipeline_version,
  evaluated_on: registry.evaluated_on, target_named_fault_precision: registry.target_named_fault_precision,
  items: registry.models.map((m: { format: string; point_set: string }) => ({
    ...m,
    versions: m.format === "lbnl_simulated" && m.point_set === "all"
      ? [{ model_version: analysis.model_version, pipeline_versions: [analysis.pipeline_version], analyses: 1, first_used_at: analysis.finished_at, last_used_at: analysis.finished_at }]
      : [],
  })),
};

/** Answers every /api/v1 call the journey makes. `demo` turns on demo mode. */
export async function mockApi(p: Page, { demo = false, failOverview = false } = {}) {
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: status >= 400 ? "application/problem+json" : "application/json", body: JSON.stringify(body) });

  // A tiny in-memory work-order store (ADR 0028), enough for one order's life in a journey.
  const orders: Record<string, unknown>[] = [];
  const workOrders = (route: Route, path: string, url: URL): Promise<void> | undefined => {
    const method = route.request().method();
    const body = route.request().postDataJSON() as Record<string, unknown> | null;
    const at = "2026-11-27T09:00:00Z";
    if (path === "/work-orders" && method === "POST") {
      const row = eventRows.find((r: { id: string }) => r.id === (body?.event_ids as string[])[0]);
      const fault = library.faults.find((f: { id: string }) => f.id === row.fault);
      const order = {
        id: "0190a1f3-0000-7000-8000-0000000002aa", number: 1, code: "WO-0001", equipment_id: EQUIPMENT_ID,
        equipment_name: "RTU-1", site: "Simulated office", fault: row.fault, title: fault.title, status: "open",
        priority: body?.priority ?? "high", suggested_priority: "high",
        priority_reason: `A named fault lasting ${row.hours} h; long events are the most reliable.`,
        assignee: body?.assignee ?? null, notes: body?.notes ?? null, checks: fault.checks,
        library_version: library.version, library_review_status: library.review_status, outcome: null,
        confirmed_fault: null, findings: null, repair_time: null, cancel_reason: null, created_at: at,
        started_at: null, completed_at: null, cancelled_at: null, events: [row],
        log: [{ at, action: "created", from_status: null, to_status: "open", note: `Opened from 1 event; ${fault.checks.length} checks copied from the fault library.`, recorded_by: body?.recorded_by ?? null }],
        verification: { status: "not_started", analysis_id: null, hours_scored: null, detail: "Verification starts once the work order is completed." },
        version: 1,
      };
      orders.push(order);
      return json(route, order, 201);
    }
    if (path === "/work-orders" && method === "GET") {
      const eventId = url.searchParams.get("event_id");
      const items = orders
        .filter((o) => !eventId || (o.events as { id: string }[]).some((e) => e.id === eventId))
        .map((o) => ({ ...o, event_count: 1, first_event_starts_at: (o.events as { starts_at: string }[])[0]!.starts_at }));
      return json(route, page(items));
    }
    const order = orders.find((o) => path.startsWith(`/work-orders/${o.id}`));
    if (!order) return undefined;
    if (path.endsWith("/transitions") && method === "POST") {
      const to = { start: "in_progress", complete: "completed", cancel: "cancelled" }[body?.to as string]!;
      Object.assign(order, {
        status: to, version: (order.version as number) + 1,
        ...(to === "completed" ? {
          outcome: body?.outcome, findings: body?.findings, repair_time: body?.repair_time, completed_at: at,
          verification: { status: "pending", analysis_id: null, hours_scored: null, detail: "Waiting for an analysis of data recorded after the repair." },
        } : {}),
      });
      (order.log as unknown[]).push({ at, action: to === "in_progress" ? "started" : to, from_status: null, to_status: to, note: body?.findings ?? "Work started.", recorded_by: null });
    }
    return json(route, order);
  };

  await p.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    if (path === "/health") return json(route, { status: "ok", service: "api", api_version: "0.1.0", environment: "test", demo_mode: demo, timestamp: "2026-11-19T00:00:00Z" });
    if (path === "/equipment/overview") {
      if (failOverview) return json(route, { status: 500, code: "internal_error", detail: "An unexpected error occurred." }, 500);
      return json(route, page([{
        id: EQUIPMENT_ID, name: "RTU-1", site: "Simulated office", status: "fault", latest_analysis_id: ANALYSIS_ID,
        latest_analysis_status: "succeeded", latest_analysis_at: analysis.finished_at, hours_scored: result.hours_scored,
        hours_alarmed: result.hours_alarmed, fault_events: 1, other_events: 0, top_fault: event.fault,
      }]));
    }
    if (path === "/equipment/sites") return json(route, [{ site: "Simulated office", equipment: 1 }]);
    if (path === "/equipment-types") {
      return json(route, [
        { id: "rtu", name: "Rooftop units", status: "available", description: "" },
        { id: "ahu", name: "Air handling units", status: "coming_soon", description: "" },
        { id: "vav", name: "VAV boxes / terminal units", status: "coming_soon", description: "" },
      ]);
    }
    if (path === "/fault-events/daily") {
      return json(route, [{ date: event.start.slice(0, 10), kind: "fault", hours: 18, units: 1 }]);
    }
    if (path === `/equipment/${EQUIPMENT_ID}`) return json(route, { id: EQUIPMENT_ID, name: "RTU-1", site: "Simulated office", created_at: "2026-11-19T09:30:00Z" });
    if (path === "/analyses") return json(route, page([analysis]));
    if (path === `/analyses/${ANALYSIS_ID}`) return json(route, analysis);
    if (path === `/analyses/${ANALYSIS_ID}/result`) return json(route, result);
    if (path === `/analyses/${ANALYSIS_ID}/series`) return json(route, series());
    if (path === `/analyses/${ANALYSIS_ID}/report`) return json(route, report);
    if (path === "/models") return json(route, models);
    if (path === "/fault-events/summary") return json(route, { items: [{ kind: event.kind, fault: event.fault, events: 1, hours: event.hours }], events: 1, hours: event.hours });
    if (path === "/fault-events") return json(route, page(eventRows));
    if (path.startsWith("/work-orders")) {
      const handled = workOrders(route, path, url);
      if (handled) return handled;
    }
    if (path === "/fault-library") return json(route, { review_status: library.review_status, sources: library.sources, items: library.faults });
    if (path.startsWith("/fault-library/")) {
      const fault = library.faults.find((f: { id: string }) => f.id === path.split("/").pop());
      return fault
        ? json(route, { review_status: library.review_status, fault, sources: library.sources })
        : json(route, { status: 404, code: "not_found", detail: "Fault was not found." }, 404);
    }
    return json(route, { status: 404, code: "not_found", detail: `No fixture for ${path}` }, 404);
  });
}
