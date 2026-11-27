import { ClipboardList } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

import { useCreateWorkOrder, useHealth, useWorkOrders } from "../hooks/queries";
import { PRIORITY_LABEL } from "../lib/labels";
import { PriorityBadge, WorkOrderStatusBadge } from "./Badges";
import { Button, Field, inputClass } from "./ui";

// Hand a fault event to whoever will check it on site (ADR 0028). Shows the event's work orders,
// or a short form to open one. A person always decides; nothing is created automatically.

const ACTIVE = new Set(["open", "in_progress"]);

export function WorkOrderPanel({ eventId, kind, compact = false }: { eventId: string | undefined; kind: string; compact?: boolean }) {
  const id = useId();
  const navigate = useNavigate();
  const demo = useHealth().data?.demo_mode ?? false;
  const orders = useWorkOrders({ event_id: eventId, page_size: 5 });
  const create = useCreateWorkOrder();
  const [open, setOpen] = useState(false);
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [notes, setNotes] = useState("");
  const [by, setBy] = useState("");

  if (!eventId || kind === "not_diagnosable") return null;
  const items = orders.data?.items ?? [];
  const active = items.find((o) => ACTIVE.has(o.status));

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const order = await create.mutateAsync({
        event_ids: [eventId!],
        priority: priority || null,
        assignee: assignee.trim() || null,
        notes: notes.trim() || null,
        recorded_by: by.trim() || null,
      });
      navigate(`/work-orders/${order.id}`);
    } catch {
      // The error is shown below the form.
    }
  }

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-3 rounded-md border border-line bg-raised p-3">
      <h3 id={`${id}-h`} className="flex items-center gap-2 text-sm font-semibold">
        <ClipboardList aria-hidden="true" className="size-4 text-accent" />
        Work order
      </h3>
      {items.length > 0 && (
        <ul className="space-y-1 text-sm">
          {items.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-2">
              <Link to={`/work-orders/${o.id}`} className="font-medium text-accent underline underline-offset-2">{o.code}</Link>
              <WorkOrderStatusBadge status={o.status} />
              <PriorityBadge priority={o.priority} />
              {o.assignee && <span className="text-xs text-muted">Assigned to {o.assignee}</span>}
            </li>
          ))}
        </ul>
      )}
      {active ? null : demo ? (
        <p className="text-xs text-muted">Work orders can't be created in the public demo.</p>
      ) : !open ? (
        <div className="space-y-1">
          {!compact && (
            <p className="text-xs text-muted">
              Hand this event to whoever will check the unit. The fault library's checks are copied onto the order, word for word.
            </p>
          )}
          <Button variant="secondary" onClick={() => setOpen(true)}>Create work order</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Priority" htmlFor={`${id}-priority`} hint="The suggestion follows a written rule; you can change it.">
              <select id={`${id}-priority`} className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="">Use the suggestion</option>
                {Object.entries(PRIORITY_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label="Assign to (optional)" htmlFor={`${id}-assignee`} hint="Typed text, not a verified identity.">
              <input id={`${id}-assignee`} className={inputClass} maxLength={200} value={assignee} onChange={(e) => setAssignee(e.target.value)} />
            </Field>
          </div>
          <Field label="Notes (optional)" htmlFor={`${id}-notes`}>
            <textarea id={`${id}-notes`} className={inputClass} rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field label="Your name (optional)" htmlFor={`${id}-by`} hint="Shown in the order's history. Not a verified identity.">
            <input id={`${id}-by`} className={inputClass} maxLength={200} value={by} onChange={(e) => setBy(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create work order"}</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            {create.isError && <span role="alert" className="text-sm text-fault">{create.error.message}</span>}
          </div>
        </form>
      )}
    </section>
  );
}
