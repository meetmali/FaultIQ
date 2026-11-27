// API types, generated from the committed contracts (ADR 0008). Never edit the generated files:
// run `npm run generate:api` after the contracts change. JSON is snake_case (ADR 0007).
import type { components } from "./generated/api";

type Schemas = components["schemas"];

export type HealthResponse = Schemas["HealthResponse"];
export type EquipmentResponse = Schemas["EquipmentResponse"];
export type CreateEquipmentRequest = Schemas["CreateEquipmentRequest"];
export type UploadResponse = Schemas["UploadResponse"];
export type AnalysisResponse = Schemas["AnalysisResponse"];
export type CreateAnalysisRequest = Schemas["CreateAnalysisRequest"];
export type FaultEventResponse = Schemas["FaultEventResponse"];
export type EquipmentOverview = Schemas["EquipmentOverview"];
export type SiteResponse = Schemas["SiteResponse"];
export type FaultEventSummaryResponse = Schemas["FaultEventSummaryResponse"];
export type FaultLibraryResponse = Schemas["FaultLibraryResponse"];
export type LibraryFaultResponse = Schemas["LibraryFaultResponse"];
export type LibraryFault = Schemas["LibraryFault"];
export type LibrarySource = Schemas["LibrarySource"];
export type CitedText = Schemas["CitedText"];
export type EquipmentTypeResponse = Schemas["EquipmentTypeResponse"];
export type DailyFaultHours = Schemas["DailyFaultHours"];
export type ModelsResponse = Schemas["ModelsResponse"];
export type ModelResponse = Schemas["ModelResponse"];
export type ModelVersionUse = Schemas["ModelVersionUse"];
export type WorkOrderResponse = Schemas["WorkOrderResponse"];
export type WorkOrderSummary = Schemas["WorkOrderSummary"];
export type WorkOrderCheck = Schemas["WorkOrderCheck"];
export type WorkOrderVerification = Schemas["WorkOrderVerification"];
export type CreateWorkOrderRequest = Schemas["CreateWorkOrderRequest"];
export type UpdateWorkOrderRequest = Schemas["UpdateWorkOrderRequest"];
export type WorkOrderTransitionRequest = Schemas["WorkOrderTransitionRequest"];

/** Derived equipment status (ADR 0025). */
export type EquipmentStatus = "no_data" | "analysing" | "analysis_failed" | "fault" | "abnormal" | "normal";
export type ReviewStatus = "unreviewed" | "needs_review" | "confirmed" | "rejected";

export interface Paged<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

/** Upload formats with bundled models (ADR 0024). */
export type UploadFormat = "lbnl_simulated" | "lbnl_experimental";
export type PointSet = "all" | "basic";

/** RFC 9457 Problem Details, as returned for every API error, with a stable `code`. */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code: string;
  errors?: Record<string, string[]>;
  trace_id?: string;
}

export type {
  Alternative,
  Check,
  Context,
  DiagnosticResult,
  Evidence,
  FaultEvent,
  ModelOutput,
  Source,
  Statement,
} from "./generated/diagnostic-result";

export type { DataQualityReport, QualityIssue } from "./generated/data-quality-report";

/** One hourly column in chart series v2 (ADR 0026). */
export interface HourlyColumn {
  label: string;
  unit: string;
  kind: "signal" | "residual" | "physics" | "rule";
  values: (number | null)[];
  normal_low?: number | null;
  normal_high?: number | null;
}

/** The aligned hourly table in chart series v2: what every sensor did and what the workflow decided. */
export interface HourlyTable {
  t: number[];
  mode: (string | null)[];
  steady_minutes: number[];
  diagnosable: boolean[];
  alarm: boolean[];
  answer: string[];
  confidence: (number | null)[];
  columns: Record<string, HourlyColumn>;
}

/** Chart series stored with each analysis (ADR 0009, 0026). Times are epoch milliseconds. */
export interface ChartSeries {
  version: number;
  hourly?: HourlyTable;
  overview: Record<string, { label: string; unit: string; t: number[]; v: number[] }>;
  events: Record<
    string,
    {
      start: number;
      end: number;
      signals: Record<
        string,
        { label: string; unit: string; t: number[]; observed: number[]; expected?: (number | null)[] }
      >;
    }
  >;
}
