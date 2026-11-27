import { AlertTriangle, ArrowUp, CheckCircle2, CircleDot, CircleHelp, Clock, Loader2, MinusCircle, CirclePlay, XCircle, type LucideIcon } from "lucide-react";

import { cn } from "../lib/cn";
import {
  KIND_HELP,
  KIND_LABEL,
  PRIORITY_LABEL,
  REVIEW_LABEL,
  STATUS_LABEL,
  VERIFICATION_LABEL,
  WORK_ORDER_STATUS_LABEL,
} from "../lib/labels";
import { KIND_TONE, PRIORITY_TONE, REVIEW_TONE, STATUS_TONE, TONE, VERIFICATION_TONE, WORK_ORDER_TONE } from "../lib/tone";
import { Badge } from "./ui";

// Status is never shown by colour alone: every badge has an icon and a text label (section 11).

const STATUS_ICON: Record<string, LucideIcon> = {
  fault: AlertTriangle,
  abnormal: CircleHelp,
  normal: CheckCircle2,
  analysing: Loader2,
  analysis_failed: XCircle,
  no_data: MinusCircle,
};

export function StatusBadge({ status }: { status: string }) {
  const Icon = STATUS_ICON[status] ?? MinusCircle;
  return (
    <Badge className={TONE[STATUS_TONE[status] ?? "idle"]}>
      <Icon aria-hidden="true" className={cn("size-3.5", status === "analysing" && "animate-spin")} />
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

const KIND_ICON: Record<string, LucideIcon> = {
  fault: AlertTriangle,
  inconclusive: CircleHelp,
  no_supported_fault: CircleHelp,
  not_diagnosable: MinusCircle,
};

export function KindBadge({ kind }: { kind: string }) {
  const Icon = KIND_ICON[kind] ?? MinusCircle;
  return (
    <Badge className={TONE[KIND_TONE[kind] ?? "idle"]} title={KIND_HELP[kind]}>
      <Icon aria-hidden="true" className="size-3.5" />
      {KIND_LABEL[kind] ?? kind}
    </Badge>
  );
}

const REVIEW_ICON: Record<string, LucideIcon> = {
  unreviewed: MinusCircle,
  needs_review: CircleHelp,
  confirmed: CheckCircle2,
  rejected: XCircle,
};

export function ReviewBadge({ status }: { status: string }) {
  const Icon = REVIEW_ICON[status] ?? MinusCircle;
  return (
    <Badge className={TONE[REVIEW_TONE[status] ?? "idle"]}>
      <Icon aria-hidden="true" className="size-3.5" />
      {REVIEW_LABEL[status] ?? status}
    </Badge>
  );
}

const WORK_ORDER_ICON: Record<string, LucideIcon> = {
  open: CircleDot,
  in_progress: CirclePlay,
  completed: CheckCircle2,
  cancelled: XCircle,
};

export function WorkOrderStatusBadge({ status }: { status: string }) {
  const Icon = WORK_ORDER_ICON[status] ?? MinusCircle;
  return (
    <Badge className={TONE[WORK_ORDER_TONE[status] ?? "idle"]}>
      <Icon aria-hidden="true" className="size-3.5" />
      {WORK_ORDER_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge className={TONE[PRIORITY_TONE[priority] ?? "idle"]}>
      <ArrowUp aria-hidden="true" className="size-3.5" />
      <span className="sr-only">Priority: </span>
      {PRIORITY_LABEL[priority] ?? priority}
    </Badge>
  );
}

const VERIFICATION_ICON: Record<string, LucideIcon> = {
  not_started: MinusCircle,
  pending: Clock,
  verified: CheckCircle2,
  persists: AlertTriangle,
  not_verifiable: CircleHelp,
  not_applicable: MinusCircle,
};

export function VerificationBadge({ status }: { status: string }) {
  const Icon = VERIFICATION_ICON[status] ?? MinusCircle;
  return (
    <Badge className={TONE[VERIFICATION_TONE[status] ?? "idle"]}>
      <Icon aria-hidden="true" className="size-3.5" />
      {VERIFICATION_LABEL[status] ?? status}
    </Badge>
  );
}
