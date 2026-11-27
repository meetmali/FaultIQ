import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "../services/api";
import type { PointSet, UploadFormat } from "../types/api";

// All server state goes through these hooks (ADR 0008). Keys are shared, so a screen revisited
// loads from cache at once and refreshes in the background.
export const keys = {
  health: ["health"] as const,
  overview: (site?: string) => ["equipment", "overview", site ?? ""] as const,
  sites: ["equipment", "sites"] as const,
  equipment: (id: string) => ["equipment", id] as const,
  analyses: (equipmentId: string) => ["analyses", { equipmentId }] as const,
  analysis: (id: string) => ["analysis", id] as const,
  result: (id: string) => ["analysis", id, "result"] as const,
  series: (id: string) => ["analysis", id, "series"] as const,
  events: (filters: object) => ["fault-events", filters] as const,
  summary: (filters: object) => ["fault-events", "summary", filters] as const,
  library: (q: string, equipment: string) => ["fault-library", q, equipment] as const,
  libraryEntry: (id: string) => ["fault-library", "entry", id] as const,
  types: ["equipment-types"] as const,
  daily: (filters: object) => ["fault-events", "daily", filters] as const,
  report: (id: string) => ["analysis", id, "report"] as const,
  models: ["models"] as const,
  workOrders: (filters: object) => ["work-orders", filters] as const,
  workOrder: (id: string) => ["work-orders", "one", id] as const,
};

const TERMINAL = new Set(["succeeded", "failed"]);

export const useHealth = () =>
  useQuery({ queryKey: keys.health, queryFn: ({ signal }) => api.getHealth(signal), staleTime: 60_000 });

export const useOverview = (site?: string) =>
  useQuery({
    queryKey: keys.overview(site),
    queryFn: () => api.getEquipmentOverview({ site, page_size: 100 }),
    placeholderData: keepPreviousData,
    // Keep polling while any unit is being analysed, so its status flips without a reload.
    refetchInterval: (q) => (q.state.data?.items.some((e) => e.status === "analysing") ? 3_000 : false),
  });

export const useSites = () => useQuery({ queryKey: keys.sites, queryFn: api.listSites, staleTime: 60_000 });

export const useEquipment = (id: string) =>
  useQuery({ queryKey: keys.equipment(id), queryFn: () => api.getEquipment(id) });

export const useAnalyses = (equipmentId: string) =>
  useQuery({
    queryKey: keys.analyses(equipmentId),
    queryFn: () => api.listAnalyses({ equipment_id: equipmentId, page_size: 50 }),
    refetchInterval: (q) => (q.state.data?.items.some((a) => !TERMINAL.has(a.status)) ? 3_000 : false),
  });

/** Polls a queued or running analysis until it succeeds or fails (ADR 0008). */
export const useAnalysis = (id: string | undefined) =>
  useQuery({
    queryKey: keys.analysis(id ?? ""),
    queryFn: ({ signal }) => api.getAnalysis(id!, signal),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data && TERMINAL.has(q.state.data.status) ? false : 2_000),
  });

export const useResult = (id: string | undefined, ready: boolean) =>
  useQuery({
    queryKey: keys.result(id ?? ""),
    queryFn: ({ signal }) => api.getAnalysisResult(id!, signal),
    enabled: Boolean(id) && ready,
    staleTime: Infinity, // a finished result never changes
  });

export const useSeries = (id: string | undefined, ready: boolean) =>
  useQuery({
    queryKey: keys.series(id ?? ""),
    queryFn: ({ signal }) => api.getAnalysisSeries(id!, signal),
    enabled: Boolean(id) && ready,
    staleTime: Infinity,
  });

/** The data-quality report, once the analysis has finished or failed (ADR 0027). */
export const useReport = (id: string | undefined, finished: boolean) =>
  useQuery({
    queryKey: keys.report(id ?? ""),
    queryFn: ({ signal }) => api.getAnalysisReport(id!, signal),
    enabled: Boolean(id) && finished,
    staleTime: Infinity, // written once by the worker
  });

export const useWorkOrders = (filters: api.WorkOrderFilters) =>
  useQuery({ queryKey: keys.workOrders(filters), queryFn: () => api.listWorkOrders(filters), placeholderData: keepPreviousData });

export const useWorkOrder = (id: string) =>
  useQuery({ queryKey: keys.workOrder(id), queryFn: ({ signal }) => api.getWorkOrder(id, signal) });

export function useCreateWorkOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.createWorkOrder>[0]) => api.createWorkOrder(body),
    onSuccess: (order) => {
      qc.setQueryData(keys.workOrder(order.id), order);
      qc.invalidateQueries({ queryKey: ["work-orders"] });
    },
  });
}

/** Edits and moves on one order. The server answers with the whole order, which replaces the cache. */
export function useWorkOrderActions(id: string) {
  const qc = useQueryClient();
  const onSuccess = (order: Awaited<ReturnType<typeof api.getWorkOrder>>) => {
    qc.setQueryData(keys.workOrder(id), order);
    qc.invalidateQueries({ queryKey: ["work-orders"], predicate: (q) => q.queryKey[1] !== "one" });
  };
  return {
    update: useMutation({
      mutationFn: (input: { version: number; body: Parameters<typeof api.updateWorkOrder>[2] }) =>
        api.updateWorkOrder(id, input.version, input.body),
      onSuccess,
    }),
    transition: useMutation({
      mutationFn: (input: { version: number; body: Parameters<typeof api.transitionWorkOrder>[2] }) =>
        api.transitionWorkOrder(id, input.version, input.body),
      onSuccess,
    }),
  };
}

export const useModels = () => useQuery({ queryKey: keys.models, queryFn: api.listModels });

export const useFaultEvents = (filters: Parameters<typeof api.listFaultEvents>[0]) =>
  useQuery({
    queryKey: keys.events(filters ?? {}),
    queryFn: () => api.listFaultEvents(filters),
    placeholderData: keepPreviousData,
  });

export const useEventSummary = (filters: Parameters<typeof api.summariseFaultEvents>[0]) =>
  useQuery({
    queryKey: keys.summary(filters ?? {}),
    queryFn: () => api.summariseFaultEvents(filters),
    placeholderData: keepPreviousData,
  });

export const useLibrary = (q = "", equipment = "") =>
  useQuery({
    queryKey: keys.library(q, equipment),
    queryFn: () => api.listFaultLibrary({ q, equipment }),
    placeholderData: keepPreviousData,
    staleTime: Infinity, // generated at build time; changes only with a new API version
  });

export const useLibraryEntry = (id: string) =>
  useQuery({ queryKey: keys.libraryEntry(id), queryFn: () => api.getFaultLibraryEntry(id), staleTime: Infinity });

/** Fault id -> title from the library, falling back to the built-in labels. */
export function useFaultTitles(): Record<string, string> {
  const { data } = useLibrary();
  return Object.fromEntries((data?.items ?? []).map((f) => [f.id, f.title]));
}

export function useAnalyseNewData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      file: File;
      equipmentId?: string;
      newEquipment?: { name: string; site?: string };
      format: UploadFormat;
      pointSet: PointSet;
    }) => {
      const equipmentId =
        input.equipmentId ??
        (await api.createEquipment(input.newEquipment!.name, input.newEquipment!.site || undefined)).id;
      const upload = await api.uploadFile(input.file, equipmentId, input.format);
      const analysis = await api.startAnalysis(upload.id, input.pointSet);
      return { equipmentId, analysis };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["equipment"] }),
  });
}

export function useReview(analysisId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { eventId: string; status: string; note?: string }) =>
      api.reviewFaultEvent(input.eventId, input.status, input.note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fault-events"] });
      qc.invalidateQueries({ queryKey: keys.analysis(analysisId) });
    },
  });
}

export const useEquipmentTypes = () =>
  useQuery({ queryKey: keys.types, queryFn: api.listEquipmentTypes, staleTime: Infinity });

export const useDailyFaultHours = (filters: Parameters<typeof api.dailyFaultHours>[0]) =>
  useQuery({ queryKey: keys.daily(filters ?? {}), queryFn: () => api.dailyFaultHours(filters), placeholderData: keepPreviousData });

/** Fault id -> library entry, for plain names, components and symptoms. */
export function useLibraryIndex() {
  const { data } = useLibrary();
  return new Map((data?.items ?? []).map((f) => [f.id, f]));
}
