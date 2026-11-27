import { ClipboardList, Download } from "lucide-react";
import { useId } from "react";
import { Link, useSearchParams } from "react-router";

import { usePreferences } from "../app/preferences";
import { PriorityBadge, WorkOrderStatusBadge } from "../components/Badges";
import { Empty, Freshness, QueryView } from "../components/QueryState";
import { Card, Field, inputClass, tableClass } from "../components/ui";
import { useFaultTitles, useWorkOrders } from "../hooks/queries";
import { formatDataTime, formatDateTime } from "../lib/format";
import { faultTitle, OUTCOME_LABEL, PRIORITY_LABEL, WORK_ORDER_STATUS_LABEL } from "../lib/labels";
import { workOrdersExportUrl } from "../services/api";

// Every work order, with filters kept in the URL so a view can be bookmarked or shared (ADR 0025, 0028).

export default function WorkOrdersPage() {
  const id = useId();
  const [params, setParams] = useSearchParams();
  const { site } = usePreferences();
  const status = params.get("status") ?? "active";
  const priority = params.get("priority") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const filters = { status: status || undefined, priority: priority || undefined, site: site || undefined };
  const orders = useWorkOrders({ ...filters, page, page_size: 25 });
  const titles = useFaultTitles();
  const set = (k: string, v: string) =>
    setParams(
      (p) => {
        p.set(k, v);
        p.delete("page");
        return p;
      },
      { replace: true },
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ClipboardList aria-hidden="true" className="size-6 text-accent" />
            Work orders
          </h1>
          <p className="max-w-3xl text-sm text-muted">
            Diagnosed faults handed to someone to check and fix, what they found, and whether data after the repair still shows the fault.
          </p>
        </div>
        <a
          href={workOrdersExportUrl(filters)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-raised"
        >
          <Download aria-hidden="true" className="size-4" />
          Export CSV
        </a>
      </div>

      <form className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => e.preventDefault()}>
        <Field label="Status" htmlFor={`${id}-status`}>
          <select id={`${id}-status`} className={inputClass} value={status} onChange={(e) => set("status", e.target.value)}>
            <option value="active">Open or in progress</option>
            <option value="">All</option>
            {Object.entries(WORK_ORDER_STATUS_LABEL).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="Priority" htmlFor={`${id}-priority`}>
          <select id={`${id}-priority`} className={inputClass} value={priority} onChange={(e) => set("priority", e.target.value)}>
            <option value="">All</option>
            {Object.entries(PRIORITY_LABEL).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </Field>
      </form>

      <Card aria-labelledby={`${id}-list`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${id}-list`} className="text-base font-semibold">
            {orders.data ? `${orders.data.total} work order${orders.data.total === 1 ? "" : "s"}` : "Work orders"}
          </h2>
          <Freshness query={orders} />
        </div>
        <QueryView query={orders} loadingLabel="Loading work orders…">
          {(data) =>
            data.items.length === 0 ? (
              <Empty>
                No work orders match. Open one from a fault event on a unit's page.
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <caption className="sr-only">Work orders, newest first</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="font-medium">Order</th>
                      <th scope="col" className="font-medium">Unit</th>
                      <th scope="col" className="font-medium">Fault</th>
                      <th scope="col" className="font-medium">Status</th>
                      <th scope="col" className="font-medium">Priority</th>
                      <th scope="col" className="font-medium">Assigned to</th>
                      <th scope="col" className="font-medium">Event starts (as recorded)</th>
                      <th scope="col" className="font-medium">Opened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((o) => (
                      <tr key={o.id} className="border-t border-line align-top">
                        <td className="py-2">
                          <Link to={`/work-orders/${o.id}`} className="font-medium text-accent underline underline-offset-2">{o.code}</Link>
                        </td>
                        <td className="py-2">
                          <Link to={`/equipment/${o.equipment_id}`} className="text-accent underline underline-offset-2">{o.equipment_name}</Link>
                          {o.site && <div className="text-xs text-muted">{o.site}</div>}
                        </td>
                        <td className="py-2">
                          {o.fault ? (titles[o.fault] ?? faultTitle(o.fault)) : "No fault named"}
                          {o.outcome && <div className="text-xs text-muted">{OUTCOME_LABEL[o.outcome] ?? o.outcome}</div>}
                        </td>
                        <td className="py-2"><WorkOrderStatusBadge status={o.status} /></td>
                        <td className="py-2"><PriorityBadge priority={o.priority} /></td>
                        <td className="py-2">{o.assignee ?? <span className="text-muted">Unassigned</span>}</td>
                        <td className="py-2 whitespace-nowrap">{formatDataTime(o.first_event_starts_at)}</td>
                        <td className="py-2 whitespace-nowrap">{formatDateTime(o.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.total > data.page_size && (
                  <nav aria-label="Pages" className="mt-3 flex items-center gap-3 text-sm">
                    <button type="button" disabled={page <= 1} className="text-accent disabled:text-muted" onClick={() => setParams((p) => { p.set("page", String(page - 1)); return p; })}>
                      Previous
                    </button>
                    <span className="text-muted">Page {page} of {Math.ceil(data.total / data.page_size)}</span>
                    <button type="button" disabled={page * data.page_size >= data.total} className="text-accent disabled:text-muted" onClick={() => setParams((p) => { p.set("page", String(page + 1)); return p; })}>
                      Next
                    </button>
                  </nav>
                )}
              </div>
            )
          }
        </QueryView>
      </Card>
    </div>
  );
}
