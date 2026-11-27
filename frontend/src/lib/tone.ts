// Status tones (ADR 0026). Token-based, so they work in both themes; always paired with an icon
// and words, never colour alone.
export type Tone = "fault" | "warn" | "ok" | "info" | "idle" | "accent";

export const TONE: Record<Tone, string> = {
  fault: "border-fault-line bg-fault-soft text-fault",
  warn: "border-warn-line bg-warn-soft text-warn",
  ok: "border-ok-line bg-ok-soft text-ok",
  info: "border-info-line bg-info-soft text-info",
  idle: "border-idle-line bg-idle-soft text-idle",
  accent: "border-accent/40 bg-accent-soft text-accent",
};

/** The CSS variable for a tone's strong colour, for SVG fills and strokes. */
export const TONE_VAR: Record<Tone, string> = {
  fault: "var(--fault-glow)",
  warn: "var(--warn-glow)",
  ok: "var(--ok)",
  info: "var(--info)",
  idle: "var(--idle)",
  accent: "var(--accent)",
};

export const STATUS_TONE: Record<string, Tone> = {
  fault: "fault",
  abnormal: "warn",
  normal: "ok",
  analysing: "accent",
  analysis_failed: "idle",
  no_data: "idle",
};

export const KIND_TONE: Record<string, Tone> = {
  fault: "fault",
  inconclusive: "warn",
  no_supported_fault: "info",
  not_diagnosable: "idle",
};

export const REVIEW_TONE: Record<string, Tone> = {
  unreviewed: "idle",
  needs_review: "warn",
  confirmed: "ok",
  rejected: "idle",
};

export const WORK_ORDER_TONE: Record<string, Tone> = {
  open: "warn",
  in_progress: "accent",
  completed: "ok",
  cancelled: "idle",
};

export const PRIORITY_TONE: Record<string, Tone> = { urgent: "fault", high: "warn", medium: "info", low: "idle" };

export const VERIFICATION_TONE: Record<string, Tone> = {
  not_started: "idle",
  pending: "info",
  verified: "ok",
  persists: "fault",
  not_verifiable: "warn",
  not_applicable: "idle",
};
