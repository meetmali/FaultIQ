import { ChevronRight, Printer } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router";

import { KindBadge, PriorityBadge, VerificationBadge, WorkOrderStatusBadge } from "../components/Badges";
import { ErrorState, Loading } from "../components/QueryState";
import { Button, Card, CardTitle, Field, inputClass } from "../components/ui";
import { useFaultTitles, useHealth, useLibrary, useWorkOrder, useWorkOrderActions } from "../hooks/queries";
import { formatConfidence, formatDataTime, formatDateTime } from "../lib/format";
import { faultTitle, OUTCOME_LABEL, PRIORITY_LABEL } from "../lib/labels";
import { ApiError } from "../services/api";
import type { WorkOrderResponse, WorkOrderTransitionRequest } from "../types/api";

// One work order (ADR 0028): what was diagnosed, what to check, what was found, and whether data
// after the repair still shows the fault. Prints cleanly for a technician on site.

const ACTION_LABEL: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  started: "Started",
  completed: "Completed",
  cancelled: "Cancelled",
};

function errorText(err: unknown): string {
  if (err instanceof ApiError && err.code === "stale_work_order") {
    return "Someone changed this order while you were editing. The latest version is now shown; check it and try again.";
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

function Row({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

function EditForm({ order, by }: { order: WorkOrderResponse; by: string }) {
  const id = useId();
  const { update } = useWorkOrderActions(order.id);
  const [priority, setPriority] = useState(order.priority);
  const [assignee, setAssignee] = useState(order.assignee ?? "");
  const [notes, setNotes] = useState(order.notes ?? "");
  const changed = priority !== order.priority || assignee.trim() !== (order.assignee ?? "") || notes.trim() !== (order.notes ?? "");

  function submit(e: FormEvent) {
    e.preventDefault();
    update.mutate({
      version: order.version,
      body: { priority, assignee: assignee.trim(), notes: notes.trim(), recorded_by: by.trim() || null },
    });
  }

  return (
    <form onSubmit={submit} aria-labelledby={`${id}-h`} className="space-y-3 print:hidden">
      <h3 id={`${id}-h`} className="text-sm font-semibold">Assignment and priority</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Priority" htmlFor={`${id}-priority`} hint={`Suggested: ${PRIORITY_LABEL[order.suggested_priority]}. ${order.priority_reason}`}>
          <select id={`${id}-priority`} className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value)}>
            {Object.entries(PRIORITY_LABEL).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="Assigned to" htmlFor={`${id}-assignee`} hint="Typed text, not a verified identity.">
          <input id={`${id}-assignee`} className={inputClass} maxLength={200} value={assignee} onChange={(e) => setAssignee(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes" htmlFor={`${id}-notes`}>
        <textarea id={`${id}-notes`} className={inputClass} rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" disabled={!changed || update.isPending}>{update.isPending ? "Saving…" : "Save changes"}</Button>
        <span aria-live="polite" className="text-sm">
          {update.isSuccess && !changed && <span className="text-ok">Saved.</span>}
          {update.isError && <span className="text-fault">{errorText(update.error)}</span>}
        </span>
      </div>
    </form>
  );
}

function Actions({ order, by }: { order: WorkOrderResponse; by: string }) {
  const id = useId();
  const { transition } = useWorkOrderActions(order.id);
  const library = useLibrary().data?.items ?? [];
  const [mode, setMode] = useState<"none" | "complete" | "cancel">("none");
  const [outcome, setOutcome] = useState(order.fault ? "confirmed" : "different_fault");
  const [found, setFound] = useState("");
  const [findings, setFindings] = useState("");
  const [repair, setRepair] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const move = (body: Partial<WorkOrderTransitionRequest> & { to: string }) =>
    transition.mutate(
      {
        version: order.version,
        body: {
          outcome: null, confirmed_fault: null, findings: null, repair_time: null, reason: null,
          ...body,
          recorded_by: by.trim() || null,
        },
      },
      { onSuccess: () => setMode("none") },
    );

  function complete(e: FormEvent) {
    e.preventDefault();
    if (!findings.trim()) return setProblem("Say what was found and done on site.");
    if (outcome === "different_fault" && !found) return setProblem("Choose the fault that was found.");
    if (outcome !== "no_fault_found" && !repair) return setProblem("Give the repair time as it appears in the unit's data.");
    setProblem(null);
    move({
      to: "complete",
      outcome,
      confirmed_fault: outcome === "different_fault" ? found : null,
      findings: findings.trim(),
      // A data time: the clock reading in the unit's export, marked UTC like every data time (ADR 0025).
      repair_time: outcome === "no_fault_found" ? null : `${repair}:00Z`,
    });
  }

  function cancel(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return setProblem("Say why the work order is cancelled.");
    setProblem(null);
    move({ to: "cancel", reason: reason.trim() });
  }

  return (
    <div className="space-y-3 print:hidden">
      <div className="flex flex-wrap gap-2">
        {order.status === "open" && <Button onClick={() => move({ to: "start" })} disabled={transition.isPending}>Start work</Button>}
        {order.status === "in_progress" && mode !== "complete" && <Button onClick={() => setMode("complete")}>Complete…</Button>}
        {mode !== "cancel" && (
          <Button variant="secondary" onClick={() => setMode("cancel")}>Cancel order…</Button>
        )}
      </div>
      {mode === "complete" && (
        <form onSubmit={complete} aria-labelledby={`${id}-c`} className="space-y-3 rounded-md border border-line bg-raised p-3">
          <h3 id={`${id}-c`} className="text-sm font-semibold">Complete the work order</h3>
          <Field label="Outcome" htmlFor={`${id}-outcome`}>
            <select id={`${id}-outcome`} className={inputClass} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {order.fault && <option value="confirmed">Confirmed: {faultTitle(order.fault)}</option>}
              <option value="different_fault">{order.fault ? "A different fault was found" : "A fault was found"}</option>
              <option value="no_fault_found">No fault found</option>
            </select>
          </Field>
          {outcome === "different_fault" && (
            <Field label="Fault found" htmlFor={`${id}-found`}>
              <select id={`${id}-found`} className={inputClass} value={found} onChange={(e) => setFound(e.target.value)}>
                <option value="">Choose…</option>
                {library.filter((f) => f.id !== order.fault).map((f) => (
                  <option key={f.id} value={f.id}>{f.title}</option>
                ))}
              </select>
            </Field>
          )}
          {outcome !== "no_fault_found" && (
            <Field
              label="Repair time, as recorded in the unit's data"
              htmlFor={`${id}-repair`}
              hint="Use the clock in the unit's export, not your local time. The next upload with data after this time verifies the fix."
            >
              <input id={`${id}-repair`} type="datetime-local" className={inputClass} value={repair} onChange={(e) => setRepair(e.target.value)} />
            </Field>
          )}
          <Field label="What was found and done" htmlFor={`${id}-findings`}>
            <textarea id={`${id}-findings`} className={inputClass} rows={3} maxLength={2000} value={findings} onChange={(e) => setFindings(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={transition.isPending}>{transition.isPending ? "Saving…" : "Complete work order"}</Button>
            <Button variant="ghost" onClick={() => setMode("none")}>Back</Button>
          </div>
        </form>
      )}
      {mode === "cancel" && (
        <form onSubmit={cancel} aria-labelledby={`${id}-x`} className="space-y-3 rounded-md border border-line bg-raised p-3">
          <h3 id={`${id}-x`} className="text-sm font-semibold">Cancel the work order</h3>
          <Field label="Reason" htmlFor={`${id}-reason`}>
            <textarea id={`${id}-reason`} className={inputClass} rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={transition.isPending}>Cancel work order</Button>
            <Button variant="ghost" onClick={() => setMode("none")}>Keep it</Button>
          </div>
        </form>
      )}
      {(problem || transition.isError) && (
        <p role="alert" className="text-sm text-fault">{problem ?? errorText(transition.error)}</p>
      )}
    </div>
  );
}

/** Editing and moving an open order. One "your name" field covers every change. */
function Manage({ order }: { order: WorkOrderResponse }) {
  const id = useId();
  const [by, setBy] = useState("");
  return (
    <div className="mt-4 space-y-5 border-t border-line pt-4 print:hidden">
      <Field label="Your name (optional)" htmlFor={`${id}-by`} hint="Shown in the history with each change. Not a verified identity.">
        <input id={`${id}-by`} className={inputClass} maxLength={200} value={by} onChange={(e) => setBy(e.target.value)} />
      </Field>
      <EditForm key={order.version} order={order} by={by} />
      <Actions key={`${order.version}-actions`} order={order} by={by} />
    </div>
  );
}

export default function WorkOrderPage() {
  const { workOrderId = "" } = useParams();
  const query = useWorkOrder(workOrderId);
  const titles = useFaultTitles();
  const demo = useHealth().data?.demo_mode ?? false;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (!query.data) return <Loading label="Loading the work order…" />;
  const o = query.data;
  const title = (f: string | null | undefined) => (f ? (titles[f] ?? faultTitle(f)) : "No fault named");
  const active = o.status === "open" || o.status === "in_progress";

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted print:hidden">
        <Link to="/work-orders" className="text-accent hover:underline">Work orders</Link>
        <ChevronRight aria-hidden="true" className="size-4" />
        <span aria-current="page">{o.code}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{o.code}: {o.title}</h1>
          <p className="text-sm text-muted">
            <Link to={`/equipment/${o.equipment_id}`} className="text-accent underline underline-offset-2">{o.equipment_name}</Link>
            {o.site ? ` · ${o.site}` : ""} · opened {formatDateTime(o.created_at)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <WorkOrderStatusBadge status={o.status} />
            <PriorityBadge priority={o.priority} />
            {o.status === "completed" && <VerificationBadge status={o.verification.status} />}
          </div>
        </div>
        <Button variant="secondary" className="print:hidden" onClick={() => window.print()}>
          <Printer aria-hidden="true" className="size-4" />
          Print
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <Card aria-labelledby="wo-checks">
            <CardTitle id="wo-checks" sub="Copied word for word from the fault library when the order was opened.">Checks to make on site</CardTitle>
            {o.checks.length ? (
              <ol className="list-decimal space-y-2 pl-5 text-sm">
                {o.checks.map((c, i) => (
                  <li key={i}>{c.text} <span className="font-mono text-xs text-muted">[{c.source}]</span></li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-ink-2">
                The events name no fault, so there are no checks to copy. Compare the event's alternatives on the unit's page with the{" "}
                <Link to="/library" className="text-accent underline underline-offset-2">Fault Library</Link>.
              </p>
            )}
            {o.library_review_status !== "reviewed" && (
              <p className="mt-3 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-xs text-warn">
                Suggestions to verify, not instructions. The fault library hasn't yet been reviewed by an HVAC professional.
              </p>
            )}
          </Card>

          <Card aria-labelledby="wo-events">
            <CardTitle id="wo-events" sub="Event times are shown as recorded in the uploaded data.">What FaultIQ detected</CardTitle>
            <ul className="space-y-3">
              {o.events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <KindBadge kind={e.kind} />
                  <span className="font-medium">{title(e.fault)}</span>
                  <span className="text-muted">
                    {formatDataTime(e.starts_at)} to {formatDataTime(e.ends_at)}, {e.hours} h{e.confidence != null ? `, ${formatConfidence(e.confidence)} confidence` : ""}
                  </span>
                  <Link
                    to={`/equipment/${o.equipment_id}?analysis=${e.analysis_id}&event=${e.event_key}`}
                    className="text-accent underline underline-offset-2 print:hidden"
                  >
                    Open the diagnosis
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">A model inference, not a confirmed root cause. The outcome recorded below is kept separately.</p>
          </Card>

          {o.status === "completed" && (
            <Card aria-labelledby="wo-outcome">
              <CardTitle id="wo-outcome" aside={<VerificationBadge status={o.verification.status} />}>Outcome and verification</CardTitle>
              <dl className="grid gap-3 sm:grid-cols-2">
                <Row label="Outcome">
                  {OUTCOME_LABEL[o.outcome ?? ""] ?? o.outcome}
                  {o.confirmed_fault ? `: ${title(o.confirmed_fault)}` : ""}
                </Row>
                <Row label="Repair time (as recorded)">{o.repair_time ? formatDataTime(o.repair_time) : "No repair"}</Row>
                <Row label="Findings" className="sm:col-span-2">{o.findings}</Row>
                <Row label="Verification" className="sm:col-span-2">{o.verification.detail}</Row>
              </dl>
            </Card>
          )}
          {o.status === "cancelled" && (
            <Card aria-labelledby="wo-cancelled">
              <CardTitle id="wo-cancelled">Cancelled</CardTitle>
              <p className="text-sm text-ink-2">{o.cancel_reason}</p>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card aria-labelledby="wo-details">
            <CardTitle id="wo-details">Details</CardTitle>
            <dl className="grid gap-3">
              <Row label="Assigned to">{o.assignee ?? "Unassigned"}</Row>
              <Row label="Priority">
                {PRIORITY_LABEL[o.priority]} <span className="text-xs text-muted">(suggested {PRIORITY_LABEL[o.suggested_priority]}: {o.priority_reason})</span>
              </Row>
              {o.notes && <Row label="Notes">{o.notes}</Row>}
            </dl>
            {active && !demo && <Manage order={o} />}
            {active && demo && <p className="mt-3 text-xs text-muted print:hidden">Work orders can't be changed in the public demo.</p>}
          </Card>

          <Card aria-labelledby="wo-history">
            <CardTitle id="wo-history" sub="Append-only. Names are typed text, not verified identities.">History</CardTitle>
            <ol className="space-y-3 border-l-2 border-line pl-4">
              {o.log.map((l, i) => (
                <li key={i} className="text-sm">
                  <p className="text-xs text-muted">
                    {formatDateTime(l.at)}{l.recorded_by ? ` · ${l.recorded_by}` : ""}
                  </p>
                  <p><span className="font-medium">{ACTION_LABEL[l.action] ?? l.action}.</span> {l.note}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
