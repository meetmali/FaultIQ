// One vocabulary for every screen (project plan, section 11: consistent terminology).

export const KIND_LABEL: Record<string, string> = {
  fault: "Named fault",
  inconclusive: "Inconclusive",
  no_supported_fault: "Unrecognised abnormality",
  not_diagnosable: "Not diagnosable",
};

export const KIND_HELP: Record<string, string> = {
  fault: "The model matched a supported fault above its confidence cut-off.",
  inconclusive: "Abnormal, but no supported fault fitted confidently enough to name.",
  no_supported_fault: "Abnormal, but the pattern matched none of the supported faults.",
  not_diagnosable: "Flagged while the equipment wasn't running steadily enough to diagnose.",
};

export const REVIEW_LABEL: Record<string, string> = {
  unreviewed: "Not reviewed",
  needs_review: "Needs review",
  confirmed: "Confirmed on site",
  rejected: "Rejected",
};

/** Plain titles; the Fault Library is the source of truth and overrides these once loaded. */
export const FAULT_TITLE: Record<string, string> = {
  fault_free: "Normal operation",
  condenser_fouling: "Condenser fouling",
  evaporator_fouling: "Evaporator fouling",
  liquid_line_restriction: "Liquid-line restriction",
  suction_line_restriction: "Suction-line restriction",
  refrigerant_overcharge: "Refrigerant overcharge",
  refrigerant_undercharge: "Refrigerant undercharge",
  oa_damper_stuck: "Outdoor-air damper stuck",
  economizer_setpoint_offset: "Economizer setpoint offset",
  sat_sensor_bias: "Supply-air temperature sensor bias",
};

export const faultTitle = (id: string | null | undefined): string =>
  id ? (FAULT_TITLE[id] ?? id.replaceAll("_", " ")) : "No fault named";

export const FORMAT_LABEL: Record<string, string> = {
  lbnl_simulated: "LBNL simulated RTU export",
  lbnl_experimental: "LBNL ORNL test RTU export",
};

export const STATUS_LABEL: Record<string, string> = {
  fault: "Fault detected",
  abnormal: "Abnormal, unexplained",
  normal: "Normal",
  analysing: "Analysing",
  analysis_failed: "Analysis failed",
  no_data: "No data yet",
};

// Work orders (ADR 0028).
export const WORK_ORDER_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const PRIORITY_LABEL: Record<string, string> = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };

export const OUTCOME_LABEL: Record<string, string> = {
  confirmed: "Fault confirmed",
  different_fault: "A different fault was found",
  no_fault_found: "No fault found",
};

export const VERIFICATION_LABEL: Record<string, string> = {
  not_started: "Not completed yet",
  pending: "Waiting for new data",
  verified: "Fix verified",
  persists: "Fault still present",
  not_verifiable: "Not enough data yet",
  not_applicable: "Nothing to verify",
};
