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
