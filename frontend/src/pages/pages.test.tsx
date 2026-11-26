import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../services/api";
import { renderRoute } from "../test/render";

vi.mock("../services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api")>();
  return {
    ...actual,
    getHealth: vi.fn(),
    getEquipmentOverview: vi.fn(),
    listSites: vi.fn(),
    listFaultEvents: vi.fn(),
    summariseFaultEvents: vi.fn(),
    listFaultLibrary: vi.fn(),
    listEquipmentTypes: vi.fn(),
    dailyFaultHours: vi.fn(),
    getEquipment: vi.fn(),
    listAnalyses: vi.fn(),
    getAnalysis: vi.fn(),
    getAnalysisReport: vi.fn(),
    listModels: vi.fn(),
  };
});

const health = (demo: boolean) => ({
  status: "ok", service: "api", api_version: "0.1.0", environment: "test", demo_mode: demo, timestamp: "2026-11-19T00:00:00Z",
});
const empty = { items: [], page: 1, page_size: 20, total: 0 };
const unit = {
  id: "e1", name: "RTU-1", site: "Demo", status: "fault", latest_analysis_id: "a1", latest_analysis_status: "succeeded",
  latest_analysis_at: "2026-11-19T00:00:00Z", hours_scored: 100, hours_alarmed: 20, fault_events: 2, other_events: 0,
  top_fault: "condenser_fouling",
};

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(api.getHealth).mockResolvedValue(health(false));
  vi.mocked(api.listSites).mockResolvedValue([]);
  vi.mocked(api.listFaultEvents).mockResolvedValue(empty);
  vi.mocked(api.summariseFaultEvents).mockResolvedValue({ items: [], events: 0, hours: 0 });
  vi.mocked(api.listFaultLibrary).mockResolvedValue({ review_status: "unreviewed", sources: [], items: [] });
  vi.mocked(api.dailyFaultHours).mockResolvedValue([]);
  vi.mocked(api.listEquipmentTypes).mockResolvedValue([
    { id: "rtu", name: "Rooftop units", status: "available", description: "" },
    { id: "ahu", name: "Air handling units", status: "coming_soon", description: "" },
  ]);
});

describe("personas", () => {
  it("opens in the Operator view by default and remembers a switch to Technician", async () => {
    vi.mocked(api.getEquipmentOverview).mockResolvedValue({ ...empty, total: 1, items: [unit] });
    renderRoute("/");
    expect(await screen.findByRole("heading", { name: "How are your rooftop units?" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Operator" })).toHaveAttribute("aria-checked", "true");

    await userEvent.click(screen.getByRole("radio", { name: "Technician" }));
    expect(await screen.findByRole("heading", { name: "Work queue" })).toBeInTheDocument();
    expect(window.localStorage.getItem("faultiq.persona")).toBe("technician");
  });

  it("switches theme and remembers it", async () => {
    vi.mocked(api.getEquipmentOverview).mockResolvedValue(empty);
    renderRoute("/");
    await userEvent.click(await screen.findByRole("radio", { name: "Dark theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("faultiq.theme")).toBe("dark");
  });

  it("announces equipment types that aren't supported yet instead of opening an empty page", async () => {
    vi.mocked(api.getEquipmentOverview).mockResolvedValue(empty);
    renderRoute("/");
    await userEvent.click(await screen.findByRole("button", { name: /Equipment type/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Air handling units/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/available in a future release/)).toBeInTheDocument();
  });
});

describe("states", () => {
  it("explains what to do when there are no units yet", async () => {
    vi.mocked(api.getEquipmentOverview).mockResolvedValue(empty);
    renderRoute("/");
    expect(await screen.findByText(/No units analysed yet/)).toBeInTheDocument();
  });

  it("shows an error with a retry instead of a blank page", async () => {
    vi.mocked(api.getEquipmentOverview).mockRejectedValue(new api.ApiError(500, { code: "internal_error", detail: "An unexpected error occurred." }));
    renderRoute("/");
    expect(await screen.findByRole("alert")).toHaveTextContent("An unexpected error occurred.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("marks sample data and hides uploads in demo mode", async () => {
    window.localStorage.setItem("faultiq.persona", "technician");
    vi.mocked(api.getHealth).mockResolvedValue(health(true));
    vi.mocked(api.getEquipmentOverview).mockResolvedValue({ ...empty, total: 1, items: [unit] });
    renderRoute("/");
    expect(await screen.findByRole("note", { name: "Public demo notice" })).toBeInTheDocument();
    expect((await screen.findAllByText("sample data")).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Analyse new data/ })).toBeNull());
  });

  it("shows a helpful page for unknown routes", async () => {
    renderRoute("/nowhere");
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
  });
});

describe("data quality and models (ADR 0027)", () => {
  const failed = {
    id: "a9", upload_id: "u9", equipment_id: "e9", point_set: "all", status: "failed", attempts: 1,
    created_at: "2026-11-25T10:00:00Z", started_at: "2026-11-25T10:00:01Z", finished_at: "2026-11-25T10:00:02Z",
    error_code: "validation_failed", error_message: "The file failed validation: Timestamps go backwards 2 times.",
    pipeline_version: null, model_version: null, hours_total: null, hours_scored: null, hours_alarmed: null, event_count: null,
  };
  const report = {
    version: 1, status: "quarantined" as const, file: "Building A export.csv", sha256: "ab".repeat(32),
    mapping: "lbnl_simulated", pipeline_version: "0.2.0",
    issues: [
      { severity: "warning" as const, code: "gaps", message: "3 gaps longer than one minute. Missing minutes are flagged, not filled." },
      { severity: "error" as const, code: "timestamps_out_of_order", message: "Timestamps go backwards 2 times. Sort the export by time and upload it again." },
    ],
    load: { rows: 1440, unreadable_timestamps: 0, duplicate_timestamps: 0, gaps_over_1min: 3, dropout_rows: 0, unmapped_columns: ["Spare AI"], excluded_columns: {} },
    missing_share: { sat: 0.25 },
    grid: null,
    operating: null,
  };

  beforeEach(() => {
    vi.mocked(api.getEquipment).mockResolvedValue({ id: "e9", name: "RTU-9", site: null, created_at: "2026-11-25T09:00:00Z" });
    vi.mocked(api.listAnalyses).mockResolvedValue({ ...empty, total: 1, items: [failed] });
    vi.mocked(api.getAnalysis).mockResolvedValue(failed);
  });

  it("shows every reason a file was not accepted, with codes for technicians", async () => {
    window.localStorage.setItem("faultiq.persona", "technician");
    vi.mocked(api.getAnalysisReport).mockResolvedValue(report);
    renderRoute("/equipment/e9?analysis=a9");
    expect(await screen.findByText("Not accepted")).toBeInTheDocument();
    expect(screen.getByText(/Sort the export by time and upload it again/)).toBeInTheDocument();
    expect(screen.getByText(/Missing minutes are flagged, not filled/)).toBeInTheDocument();
    expect(screen.getByText("timestamps_out_of_order")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("Spare AI")).toBeInTheDocument();
  });

  it("gives operators the reasons in words, and says when there is no report", async () => {
    vi.mocked(api.getAnalysisReport).mockResolvedValue(report);
    const { unmount } = renderRoute("/equipment/e9?analysis=a9");
    expect(await screen.findByText("Not accepted")).toBeInTheDocument();
    expect(screen.queryByText("timestamps_out_of_order")).toBeNull();
    unmount();

    vi.mocked(api.getAnalysisReport).mockResolvedValue(null);
    renderRoute("/equipment/e9?analysis=a9");
    expect(await screen.findByText(/No data-quality report for this analysis/)).toBeInTheDocument();
  });

  it("lists each model with its held-out results and the versions used here", async () => {
    const heldOut = {
      test_hours: 10465, test_macro_f1: 0.7749, validation_macro_f1: 0.8389, answered_share: 0.9978,
      named_fault_precision: 0.9049, right_fault_on_faulty_hours: 0.9227, calibration_error: 0.0775,
    };
    const model = {
      format: "lbnl_simulated", point_set: "all", dataset: "simulated", dataset_label: "Simulated rooftop unit (LBNL)",
      adopted_model: "lightgbm", trained_on: { train: "days 0-59", validation: "days 61-80" },
      evaluation: "Day blocks: train on days 0-59, validate on 61-80, test on 82-99.", faults: ["condenser_fouling"],
      held_out: heldOut,
      versions: [{
        model_version: "lbnl_simulated-all@diagnosis-0.1.0+abc123def456", pipeline_versions: ["0.2.0"], analyses: 3,
        first_used_at: "2026-11-20T10:00:00Z", last_used_at: "2026-11-21T10:00:00Z",
      }],
    };
    vi.mocked(api.listModels).mockResolvedValue({
      diagnosis_version: "0.1.0", evaluated_with_pipeline_version: "0.2.0", evaluated_on: "2026-11-19",
      target_named_fault_precision: 0.9,
      items: [model, { ...model, point_set: "basic", adopted_model: "logistic", held_out: { ...heldOut, named_fault_precision: 0.8375 }, versions: [] }],
    });
    renderRoute("/models");
    expect(await screen.findByRole("heading", { name: "All points" })).toBeInTheDocument();
    expect(screen.getByText("LightGBM")).toBeInTheDocument();
    expect(screen.getByText("meets the 90% target")).toBeInTheDocument();
    expect(screen.getByText("below the 90% target")).toBeInTheDocument();
    expect(screen.getByText("lbnl_simulated-all@diagnosis-0.1.0+abc123def456")).toBeInTheDocument();
    expect(screen.getByText("No analysis has used this model yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Models" })).toHaveAttribute("aria-current", "page");
  });
});
