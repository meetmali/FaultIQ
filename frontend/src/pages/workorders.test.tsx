import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkOrderPanel } from "../components/WorkOrderPanel";
import * as api from "../services/api";
import { renderRoute } from "../test/render";
import type { WorkOrderResponse, WorkOrderSummary } from "../types/api";

vi.mock("../services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api")>();
  return {
    ...actual,
    getHealth: vi.fn(),
    listSites: vi.fn(),
    listEquipmentTypes: vi.fn(),
    listFaultLibrary: vi.fn(),
    listWorkOrders: vi.fn(),
    getWorkOrder: vi.fn(),
    createWorkOrder: vi.fn(),
    updateWorkOrder: vi.fn(),
    transitionWorkOrder: vi.fn(),
  };
});

const health = { status: "ok", service: "api", api_version: "0.1.0", environment: "test", demo_mode: false, timestamp: "2026-11-27T00:00:00Z" };
const empty = { items: [], page: 1, page_size: 25, total: 0 };

const summary: WorkOrderSummary = {
  id: "w1", number: 7, code: "WO-0007", equipment_id: "e1", equipment_name: "RTU-1", site: "Demo", fault: "condenser_fouling",
  title: "Condenser fouling", status: "open", priority: "high", assignee: null, event_count: 1,
  first_event_starts_at: "2018-10-11T07:00:00Z", outcome: null, created_at: "2026-11-27T09:00:00Z", completed_at: null,
};

const order: WorkOrderResponse = {
  id: "w1", number: 7, code: "WO-0007", equipment_id: "e1", equipment_name: "RTU-1", site: "Demo", fault: "condenser_fouling",
  title: "Condenser fouling", status: "open", priority: "high", suggested_priority: "high",
  priority_reason: "A named fault lasting 90 h; long events are the most reliable.", assignee: null, notes: null,
  checks: [{ text: "Inspect the condenser coil for dirt, debris or blockage and clean it if needed.", source: "ashrae-180" }],
  library_version: 1, library_review_status: "unreviewed", outcome: null, confirmed_fault: null, findings: null,
  repair_time: null, cancel_reason: null, created_at: "2026-11-27T09:00:00Z", started_at: null, completed_at: null,
  cancelled_at: null,
  events: [{
    id: "f1", analysis_id: "a1", equipment_id: "e1", event_key: "event-1", kind: "fault", fault: "condenser_fouling",
    starts_at: "2018-10-11T07:00:00Z", ends_at: "2018-10-15T01:00:00Z", hours: 90, confidence: 0.999, detector_score: 9,
    review_status: "unreviewed", review_note: null, reviewed_at: null,
  }],
  log: [{ at: "2026-11-27T09:00:00Z", action: "created", from_status: null, to_status: "open", note: "Opened from 1 event.", recorded_by: "Sam" }],
  verification: { status: "not_started", analysis_id: null, hours_scored: null, detail: "Verification starts once the work order is completed." },
  version: 42,
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(api.getHealth).mockResolvedValue(health);
  vi.mocked(api.listSites).mockResolvedValue([]);
  vi.mocked(api.listEquipmentTypes).mockResolvedValue([{ id: "rtu", name: "Rooftop units", status: "available", description: "" }]);
  vi.mocked(api.listFaultLibrary).mockResolvedValue({ review_status: "unreviewed", sources: [], items: [] });
  vi.mocked(api.listWorkOrders).mockResolvedValue(empty);
});

describe("work orders (ADR 0028)", () => {
  it("lists open and in-progress orders by default, with status and priority in words", async () => {
    vi.mocked(api.listWorkOrders).mockResolvedValue({ ...empty, total: 1, items: [summary] });
    renderRoute("/work-orders");
    expect(await screen.findByRole("link", { name: "WO-0007" })).toHaveAttribute("href", "/work-orders/w1");
    expect(vi.mocked(api.listWorkOrders).mock.calls[0]![0]).toMatchObject({ status: "active" });
    const table = screen.getByRole("table");
    expect(within(table).getByText("Open")).toBeInTheDocument();
    expect(within(table).getByText("High")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Export CSV/ })).toHaveAttribute("href", expect.stringContaining("/api/v1/work-orders/export?status=active"));
  });

  it("shows the copied checks and history, and starts work with the order's version", async () => {
    vi.mocked(api.getWorkOrder).mockResolvedValue(order);
    vi.mocked(api.transitionWorkOrder).mockResolvedValue({ ...order, status: "in_progress", version: 43 });
    renderRoute("/work-orders/w1");
    expect(await screen.findByRole("heading", { name: "WO-0007: Condenser fouling" })).toBeInTheDocument();
    expect(screen.getByText(/Inspect the condenser coil/)).toBeInTheDocument();
    expect(screen.getByText(/hasn't yet been reviewed by an HVAC professional/)).toBeInTheDocument();
    expect(screen.getByText(/Opened from 1 event/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Start work" }));
    await waitFor(() => expect(api.transitionWorkOrder).toHaveBeenCalledWith("w1", 42, expect.objectContaining({ to: "start" })));
    expect(await screen.findByText("In progress")).toBeInTheDocument();
  });

  it("asks for findings and a repair time before completing, and explains a stale edit", async () => {
    vi.mocked(api.getWorkOrder).mockResolvedValue({ ...order, status: "in_progress" });
    vi.mocked(api.transitionWorkOrder).mockRejectedValue(
      new api.ApiError(412, { code: "stale_work_order", detail: "Someone changed this work order since you loaded it." }),
    );
    renderRoute("/work-orders/w1");
    await userEvent.click(await screen.findByRole("button", { name: "Complete…" }));
    await userEvent.click(screen.getByRole("button", { name: "Complete work order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Say what was found and done on site.");
    expect(api.transitionWorkOrder).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("What was found and done"), "Coil cleaned.");
    await userEvent.click(screen.getByRole("button", { name: "Complete work order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("repair time");

    await userEvent.type(screen.getByLabelText(/Repair time/), "2018-10-16T09:00");
    await userEvent.click(screen.getByRole("button", { name: "Complete work order" }));
    await waitFor(() =>
      expect(api.transitionWorkOrder).toHaveBeenCalledWith("w1", 42, expect.objectContaining({
        to: "complete", outcome: "confirmed", findings: "Coil cleaned.", repair_time: "2018-10-16T09:00:00Z",
      })),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone changed this order while you were editing");
  });

  it("opens a work order from an event and goes to it", async () => {
    vi.mocked(api.createWorkOrder).mockResolvedValue(order);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(
      [
        { path: "/", element: <WorkOrderPanel eventId="f1" kind="fault" /> },
        { path: "/work-orders/:id", element: <p>Order page</p> },
      ],
      { initialEntries: ["/"] },
    );
    render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Create work order" }));
    await userEvent.type(screen.getByLabelText("Assign to (optional)"), "Alex");
    await userEvent.click(screen.getByRole("button", { name: "Create work order" }));
    await waitFor(() =>
      expect(api.createWorkOrder).toHaveBeenCalledWith(expect.objectContaining({ event_ids: ["f1"], assignee: "Alex", priority: null })),
    );
    expect(await screen.findByText("Order page")).toBeInTheDocument();
  });

  it("links to the event's open order instead of offering a second one", async () => {
    vi.mocked(api.listWorkOrders).mockResolvedValue({ ...empty, total: 1, items: [{ ...summary, status: "in_progress" }] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter([{ path: "/", element: <WorkOrderPanel eventId="f1" kind="fault" /> }]);
    render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
    expect(await screen.findByRole("link", { name: "WO-0007" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create work order" })).toBeNull();
  });
});
