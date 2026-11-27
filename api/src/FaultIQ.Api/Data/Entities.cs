namespace FaultIQ.Api.Data;

// Application records (ADR 0006). The API owns this schema through EF Core migrations; the Python
// worker reads and writes the same tables through explicit SQLAlchemy definitions (ADR 0007),
// checked against the migrated schema by a contract test.

/// <summary>A rooftop unit (or other piece of equipment) that data is uploaded for.</summary>
public sealed class Equipment
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public string? Site { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>An uploaded CSV. The file lives on disk under a server-generated name.</summary>
public sealed class Upload
{
    public Guid Id { get; set; }
    public Guid EquipmentId { get; set; }
    public Equipment? Equipment { get; set; }

    /// <summary>The user's file name, kept for display only and never used as a path.</summary>
    public required string OriginalName { get; set; }

    public required string StoredName { get; set; }
    public required string Format { get; set; }
    public long SizeBytes { get; set; }
    public required string Sha256 { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>
/// One analysis of one upload, and the job row the worker claims (ADR 0007): queued, running,
/// succeeded or failed. The full diagnostic result is stored as the JSON contract from Phase 5.
/// </summary>
public sealed class Analysis
{
    public Guid Id { get; set; }
    public Guid UploadId { get; set; }
    public Upload? Upload { get; set; }
    public Guid EquipmentId { get; set; }
    public required string PointSet { get; set; }
    public required string Status { get; set; }
    public int Attempts { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? FinishedAt { get; set; }
    public string? WorkerId { get; set; }

    /// <summary>W3C trace context of the request that created the job, continued by the worker.</summary>
    public string? Traceparent { get; set; }

    public string? ErrorCode { get; set; }
    public string? ErrorMessage { get; set; }
    public string? PipelineVersion { get; set; }
    public string? ModelVersion { get; set; }
    public int? HoursTotal { get; set; }
    public int? HoursScored { get; set; }
    public int? HoursAlarmed { get; set; }
    public int? EventCount { get; set; }

    /// <summary>The DiagnosticResult JSON (docs/contracts/diagnostic-result.schema.json).</summary>
    public string? Result { get; set; }

    /// <summary>Downsampled, ready-to-draw chart series written by the worker (ADR 0009).</summary>
    public string? ChartSeries { get; set; }

    /// <summary>
    /// The DataQualityReport JSON (docs/contracts/data-quality-report.schema.json), written by the
    /// worker on success and on quarantine (ADR 0027). Null when the job failed before validation.
    /// </summary>
    public string? ProcessingReport { get; set; }
}

/// <summary>Summary of one fault event, so events can be listed and filtered across analyses.</summary>
public sealed class FaultEvent
{
    public Guid Id { get; set; }
    public Guid AnalysisId { get; set; }
    public Guid EquipmentId { get; set; }
    public required string EventKey { get; set; }
    public required string Kind { get; set; }
    public string? Fault { get; set; }
    public DateTimeOffset StartsAt { get; set; }
    public DateTimeOffset EndsAt { get; set; }
    public int Hours { get; set; }
    public double? Confidence { get; set; }
    public double DetectorScore { get; set; }

    /// <summary>A person's verdict on the event (ADR 0025). Defaults to unreviewed.</summary>
    public string ReviewStatus { get; set; } = ReviewStatuses.Unreviewed;

    public string? ReviewNote { get; set; }
    public DateTimeOffset? ReviewedAt { get; set; }
}

/// <summary>
/// A person's request to check and fix a diagnosed fault on one unit (ADR 0028). The outcome
/// recorded on completion is a human label, kept apart from the model's stored result.
/// </summary>
public sealed class WorkOrder
{
    public Guid Id { get; set; }

    /// <summary>Display number from an identity column, shown as WO-0007.</summary>
    public int Number { get; set; }

    public Guid EquipmentId { get; set; }

    /// <summary>The fault the events name, or null when they name none.</summary>
    public string? Fault { get; set; }

    public required string Title { get; set; }
    public required string Status { get; set; }
    public required string Priority { get; set; }
    public required string SuggestedPriority { get; set; }
    public required string PriorityReason { get; set; }

    /// <summary>Typed text, not a verified identity.</summary>
    public string? Assignee { get; set; }

    public string? Notes { get; set; }

    /// <summary>The fault library's checks, copied word for word with their source ids (JSON).</summary>
    public required string Checks { get; set; }

    public int LibraryVersion { get; set; }
    public required string LibraryReviewStatus { get; set; }
    public string? Outcome { get; set; }
    public string? ConfirmedFault { get; set; }
    public string? Findings { get; set; }

    /// <summary>When the repair was made, as recorded in the unit's data (ADR 0025).</summary>
    public DateTimeOffset? RepairTime { get; set; }

    public string? CancelReason { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public DateTimeOffset? CancelledAt { get; set; }

    /// <summary>PostgreSQL's xmin row version, the optimistic concurrency token (ETag).</summary>
    public uint Version { get; set; }
}

/// <summary>Links a work order to one of the fault events it was opened from.</summary>
public sealed class WorkOrderEvent
{
    public Guid WorkOrderId { get; set; }
    public Guid FaultEventId { get; set; }
}

/// <summary>Append-only history of a work order, written in the same transaction as each change.</summary>
public sealed class WorkOrderLogEntry
{
    public Guid Id { get; set; }

    /// <summary>Insertion order from an identity column: entries saved together share a timestamp.</summary>
    public long Sequence { get; set; }

    public Guid WorkOrderId { get; set; }
    public DateTimeOffset At { get; set; }
    public required string Action { get; set; }
    public string? FromStatus { get; set; }
    public string? ToStatus { get; set; }
    public string? Note { get; set; }

    /// <summary>Typed text, not a verified identity.</summary>
    public string? RecordedBy { get; set; }
}

public static class WorkOrderStatuses
{
    public const string Open = "open";
    public const string InProgress = "in_progress";
    public const string Completed = "completed";
    public const string Cancelled = "cancelled";
    public static readonly string[] All = [Open, InProgress, Completed, Cancelled];
    public static readonly string[] Active = [Open, InProgress];
}

public static class WorkOrderPriorities
{
    public static readonly string[] All = ["urgent", "high", "medium", "low"];
}

public static class WorkOrderOutcomes
{
    public const string Confirmed = "confirmed";
    public const string DifferentFault = "different_fault";
    public const string NoFaultFound = "no_fault_found";
    public static readonly string[] All = [Confirmed, DifferentFault, NoFaultFound];
}

public static class ReviewStatuses
{
    public const string Unreviewed = "unreviewed";
    public static readonly string[] All = [Unreviewed, "needs_review", "confirmed", "rejected"];
}

public static class AnalysisStatus
{
    public const string Queued = "queued";
    public const string Running = "running";
    public const string Succeeded = "succeeded";
    public const string Failed = "failed";
    public static readonly string[] All = [Queued, Running, Succeeded, Failed];
}

public static class Formats
{
    // Upload formats with a bundled point mapping and trained models (ADR 0024).
    public static readonly string[] All = ["lbnl_simulated", "lbnl_experimental"];
}

public static class PointSets
{
    public static readonly string[] All = ["all", "basic"];
}

public static class EventKinds
{
    public static readonly string[] All = ["fault", "inconclusive", "no_supported_fault", "not_diagnosable"];
}
