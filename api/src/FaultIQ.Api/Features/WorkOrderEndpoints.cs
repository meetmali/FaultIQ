using System.Data;
using System.Globalization;
using System.Text;
using System.Text.Json;
using FaultIQ.Api.Common;
using FaultIQ.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace FaultIQ.Api.Features;

// Work orders (ADR 0028): a person turns diagnosed fault events into a request to check and fix a
// unit, records what was found, and later sees whether data after the repair still shows the fault.
// Nothing here schedules maintenance, commands equipment or generates text: checks are copied word
// for word from the fault library, and names are typed text, not verified identities.

public sealed record WorkOrderCheck(string Text, string Source);

public sealed record CreateWorkOrderRequest(
    IReadOnlyList<Guid>? EventIds, string? Priority, string? Assignee, string? Notes, string? RecordedBy);

public sealed record UpdateWorkOrderRequest(string? Priority, string? Assignee, string? Notes, string? RecordedBy);

public sealed record WorkOrderTransitionRequest(
    string? To, string? Outcome, string? ConfirmedFault, string? Findings, DateTimeOffset? RepairTime,
    string? Reason, string? RecordedBy);

public sealed record WorkOrderLogResponse(
    DateTimeOffset At, string Action, string? FromStatus, string? ToStatus, string? Note, string? RecordedBy);

/// <summary>Whether data after the repair still shows the fault. Computed on read, never stored.</summary>
public sealed record WorkOrderVerification(string Status, Guid? AnalysisId, int? HoursScored, string Detail);

public sealed record WorkOrderSummary(
    Guid Id, int Number, string Code, Guid EquipmentId, string EquipmentName, string? Site, string? Fault,
    string Title, string Status, string Priority, string? Assignee, int EventCount,
    DateTimeOffset? FirstEventStartsAt, string? Outcome, DateTimeOffset CreatedAt, DateTimeOffset? CompletedAt);

public sealed record WorkOrderResponse(
    Guid Id, int Number, string Code, Guid EquipmentId, string EquipmentName, string? Site, string? Fault,
    string Title, string Status, string Priority, string SuggestedPriority, string PriorityReason,
    string? Assignee, string? Notes, IReadOnlyList<WorkOrderCheck> Checks, int LibraryVersion,
    string LibraryReviewStatus, string? Outcome, string? ConfirmedFault, string? Findings,
    DateTimeOffset? RepairTime, string? CancelReason, DateTimeOffset CreatedAt, DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt, DateTimeOffset? CancelledAt, IReadOnlyList<FaultEventResponse> Events,
    IReadOnlyList<WorkOrderLogResponse> Log, WorkOrderVerification Verification, long Version);

public static class WorkOrderEndpoints
{
    /// <summary>An event at least this long suggests high priority, and verification needs this many
    /// scored hours after a repair. Starting values, to be checked on fresh data (ADR 0028).</summary>
    public const int LongEventHours = 24;

    public const int MinVerificationHours = 24;

    private const int MaxEvents = 50;
    private const int MaxExportRows = 5000;
    private static readonly JsonSerializerOptions Snake = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    // The whole state machine: which moves are allowed from where.
    private static readonly Dictionary<string, (string[] From, string To)> Transitions = new()
    {
        ["start"] = ([WorkOrderStatuses.Open], WorkOrderStatuses.InProgress),
        ["complete"] = ([WorkOrderStatuses.InProgress], WorkOrderStatuses.Completed),
        ["cancel"] = ([WorkOrderStatuses.Open, WorkOrderStatuses.InProgress], WorkOrderStatuses.Cancelled),
    };

    public static string Code(int number) => $"WO-{number:D4}";

    public static (string Priority, string Reason) SuggestPriority(string? fault, int longestEventHours) =>
        fault is null
            ? ("low", "No fault is named, so this is an investigation.")
            : longestEventHours >= LongEventHours
                ? ("high", $"A named fault lasting {longestEventHours} h; long events are the most reliable.")
                : ("medium", $"A named fault lasting {longestEventHours} h.");

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static string Etag(uint version) => $"\"{version}\"";

    /// <summary>The version from If-Match, or null when it is missing or not one of ours.</summary>
    private static uint? IfMatch(HttpRequest request)
    {
        var raw = request.Headers.IfMatch.ToString().Trim();
        if (raw.StartsWith("W/", StringComparison.Ordinal))
        {
            raw = raw[2..];
        }

        return uint.TryParse(raw.Trim('"'), NumberStyles.None, CultureInfo.InvariantCulture, out var v) ? v : null;
    }

    private static IResult? CheckVersion(HttpRequest request, WorkOrder o)
    {
        if (string.IsNullOrWhiteSpace(request.Headers.IfMatch))
        {
            return Problems.Of(StatusCodes.Status428PreconditionRequired, "precondition_required",
                "Send If-Match with the work order's version (its ETag), so changes made by someone else aren't overwritten.");
        }

        return IfMatch(request) == o.Version ? null : Stale();
    }

    private static IResult Stale() => Problems.Of(StatusCodes.Status412PreconditionFailed, "stale_work_order",
        "Someone changed this work order since you loaded it. Reload it and try again.");

    private static IResult? TooLong(string field, string? value, int max) =>
        value is { Length: var n } && n > max ? Problems.Invalid(field, $"At most {max} characters.") : null;

    private static void Log(FaultIqDbContext db, WorkOrder o, DateTimeOffset at, string action, string? note,
        string? by, string? from = null, string? to = null) =>
        db.WorkOrderLog.Add(new WorkOrderLogEntry
        {
            Id = Guid.CreateVersion7(),
            WorkOrderId = o.Id,
            At = at,
            Action = action,
            FromStatus = from,
            ToStatus = to,
            Note = note,
            RecordedBy = by,
        });

    private static IQueryable<WorkOrder> Filter(
        FaultIqDbContext db, string? status, string? priority, string? fault, Guid? equipmentId, string? site,
        Guid? eventId)
    {
        var q = db.WorkOrders.AsNoTracking();
        if (status == "active")
        {
            q = q.Where(o => WorkOrderStatuses.Active.Contains(o.Status));
        }
        else if (status is not null)
        {
            q = q.Where(o => o.Status == status);
        }

        if (priority is not null)
        {
            q = q.Where(o => o.Priority == priority);
        }

        if (fault is not null)
        {
            q = q.Where(o => o.Fault == fault);
        }

        if (equipmentId is not null)
        {
            q = q.Where(o => o.EquipmentId == equipmentId);
        }

        if (!string.IsNullOrWhiteSpace(site))
        {
            var ids = db.Equipment.Where(x => x.Site == site).Select(x => x.Id);
            q = q.Where(o => ids.Contains(o.EquipmentId));
        }

        if (eventId is not null)
        {
            var orders = db.WorkOrderEvents.Where(l => l.FaultEventId == eventId).Select(l => l.WorkOrderId);
            q = q.Where(o => orders.Contains(o.Id));
        }

        return q;
    }

    private static IQueryable<WorkOrderSummary> Summaries(FaultIqDbContext db, IQueryable<WorkOrder> q) =>
        from o in q
        join e in db.Equipment on o.EquipmentId equals e.Id
        select new WorkOrderSummary(
            o.Id, o.Number, "", o.EquipmentId, e.Name, e.Site, o.Fault, o.Title, o.Status, o.Priority, o.Assignee,
            db.WorkOrderEvents.Count(l => l.WorkOrderId == o.Id),
            db.WorkOrderEvents.Where(l => l.WorkOrderId == o.Id)
                .Join(db.FaultEvents, l => l.FaultEventId, f => f.Id, (l, f) => (DateTimeOffset?)f.StartsAt).Min(),
            o.Outcome, o.CreatedAt, o.CompletedAt);

    /// <summary>
    /// The first succeeded analysis of the unit whose data starts at or after the repair decides
    /// (ADR 0028). Data times are compared with data times, never with the system clock (ADR 0025).
    /// </summary>
    private static async Task<WorkOrderVerification> VerifyAsync(FaultIqDbContext db, WorkOrder o, CancellationToken ct)
    {
        if (o.Status != WorkOrderStatuses.Completed)
        {
            return new("not_started", null, null, "Verification starts once the work order is completed.");
        }

        if (o.Outcome == WorkOrderOutcomes.NoFaultFound || o.RepairTime is null)
        {
            return new("not_applicable", null, null, "No fault was found, so there is no repair to verify.");
        }

        var fault = o.Outcome == WorkOrderOutcomes.DifferentFault ? o.ConfirmedFault : o.Fault;
        Guid? analysisId = null;
        int hours = 0;
        var conn = db.Database.GetDbConnection();
        var opened = conn.State != ConnectionState.Open;
        if (opened)
        {
            await db.Database.OpenConnectionAsync(ct);
        }

        try
        {
            await using var cmd = conn.CreateCommand();
            // The result's period_start is an ISO time marked UTC by the pipeline (ADR 0025).
            cmd.CommandText = """
                SELECT id, coalesce(hours_scored, 0) FROM analyses
                WHERE equipment_id = @unit AND status = 'succeeded'
                  AND (result->>'period_start')::timestamptz >= @repair
                ORDER BY (result->>'period_start')::timestamptz, created_at, id
                LIMIT 1
                """;
            cmd.Parameters.Add(new NpgsqlParameter("unit", o.EquipmentId));
            cmd.Parameters.Add(new NpgsqlParameter("repair", o.RepairTime.Value.ToUniversalTime()));
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            if (await reader.ReadAsync(ct))
            {
                analysisId = reader.GetGuid(0);
                hours = reader.GetInt32(1);
            }
        }
        finally
        {
            if (opened)
            {
                await db.Database.CloseConnectionAsync();
            }
        }

        if (analysisId is null)
        {
            return new("pending", null, null, "Waiting for an analysis of data recorded after the repair.");
        }

        var name = fault?.Replace('_', ' ') ?? "the fault";
        if (fault is not null && await db.FaultEvents.AnyAsync(e => e.AnalysisId == analysisId && e.Fault == fault, ct))
        {
            return new("persists", analysisId, hours, $"The analysis of data after the repair names {name} again.");
        }

        return hours >= MinVerificationHours
            ? new("verified", analysisId, hours, $"{hours} scored hours after the repair, and no event names {name}.")
            : new("not_verifiable", analysisId, hours,
                $"Only {hours} scored hours after the repair; at least {MinVerificationHours} are needed.");
    }

    private static async Task<WorkOrderResponse?> LoadAsync(FaultIqDbContext db, Guid id, CancellationToken ct)
    {
        var o = await db.WorkOrders.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (o is null)
        {
            return null;
        }

        var unit = await db.Equipment.AsNoTracking().SingleAsync(e => e.Id == o.EquipmentId, ct);
        var events = await db.WorkOrderEvents.Where(l => l.WorkOrderId == id)
            .Join(db.FaultEvents, l => l.FaultEventId, f => f.Id, (l, f) => f)
            .OrderBy(f => f.StartsAt).AsNoTracking().ToListAsync(ct);
        var log = await db.WorkOrderLog.AsNoTracking().Where(l => l.WorkOrderId == id)
            .OrderBy(l => l.Sequence)
            .Select(l => new WorkOrderLogResponse(l.At, l.Action, l.FromStatus, l.ToStatus, l.Note, l.RecordedBy))
            .ToListAsync(ct);
        var checks = JsonSerializer.Deserialize<List<WorkOrderCheck>>(o.Checks, Snake) ?? [];
        return new WorkOrderResponse(
            o.Id, o.Number, Code(o.Number), o.EquipmentId, unit.Name, unit.Site, o.Fault, o.Title, o.Status, o.Priority,
            o.SuggestedPriority, o.PriorityReason, o.Assignee, o.Notes, checks, o.LibraryVersion, o.LibraryReviewStatus,
            o.Outcome, o.ConfirmedFault, o.Findings, o.RepairTime, o.CancelReason, o.CreatedAt, o.StartedAt,
            o.CompletedAt, o.CancelledAt, events.Select(FaultEventEndpoints.ToResponse).ToList(), log,
            await VerifyAsync(db, o, ct), o.Version);
    }

    private static async Task<IResult> Respond(FaultIqDbContext db, HttpResponse response, Guid id, CancellationToken ct,
        bool created = false)
    {
        var body = (await LoadAsync(db, id, ct))!;
        response.Headers.ETag = Etag((uint)body.Version);
        return created ? TypedResults.Created($"/api/v1/work-orders/{id}", body) : TypedResults.Ok(body);
    }

    public static RouteGroupBuilder MapWorkOrderEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/work-orders").WithTags("work-orders");

        g.MapPost("/", async Task<IResult> (
            CreateWorkOrderRequest body, FaultIqDbContext db, FaultLibraryStore library, TimeProvider clock,
            HttpResponse response, CancellationToken ct) =>
        {
            var ids = (body.EventIds ?? []).Distinct().ToArray();
            if (ids.Length is 0 or > MaxEvents)
            {
                return Problems.Invalid("event_ids", $"Give between 1 and {MaxEvents} fault events.");
            }

            if (body.Priority is not null && !WorkOrderPriorities.All.Contains(body.Priority))
            {
                return Problems.Invalid("priority", $"Priority must be one of: {string.Join(", ", WorkOrderPriorities.All)}.");
            }

            var assignee = Clean(body.Assignee);
            var notes = Clean(body.Notes);
            var by = Clean(body.RecordedBy);
            if ((TooLong("assignee", assignee, 200) ?? TooLong("notes", notes, 2000) ?? TooLong("recorded_by", by, 200))
                is { } tooLong)
            {
                return tooLong;
            }

            await using var tx = await db.Database.BeginTransactionAsync(ct);
            // Lock the events, so two people can't both open an order for the same event.
            var events = await db.FaultEvents
                .FromSql($"SELECT * FROM fault_events WHERE id = ANY({ids}) FOR UPDATE")
                .ToListAsync(ct);
            if (events.Count != ids.Length)
            {
                return Problems.NotFound("Fault event");
            }

            if (events.Select(e => e.EquipmentId).Distinct().Count() > 1)
            {
                return Problems.Invalid("event_ids", "All events must belong to one unit.");
            }

            if (events.Any(e => e.Kind == "not_diagnosable"))
            {
                return Problems.Invalid("event_ids",
                    "Events marked not diagnosable can't start a work order: the unit wasn't running steadily enough to judge.");
            }

            var faults = events.Select(e => e.Fault).Distinct().ToList();
            if (faults.Count > 1)
            {
                return Problems.Invalid("event_ids", "The events name different faults. Open one work order per fault.");
            }

            var taken = await db.WorkOrderEvents.Where(l => ids.Contains(l.FaultEventId))
                .Join(db.WorkOrders.Where(o => WorkOrderStatuses.Active.Contains(o.Status)),
                    l => l.WorkOrderId, o => o.Id, (l, o) => o.Number)
                .FirstOrDefaultAsync(ct);
            if (taken != 0)
            {
                return Problems.Of(StatusCodes.Status409Conflict, "event_already_on_order",
                    $"An event is already on open work order {Code(taken)}.");
            }

            var fault = faults[0];
            var doc = library.Document;
            var entry = fault is null ? null : doc.Faults.FirstOrDefault(f => f.Id == fault);
            var checks = entry?.Checks.Select(c => new WorkOrderCheck(c.Text, c.Source)).ToList() ?? [];
            var (suggested, reason) = SuggestPriority(fault, events.Max(e => e.Hours));
            var now = clock.GetUtcNow();
            var o = new WorkOrder
            {
                Id = Guid.CreateVersion7(),
                EquipmentId = events[0].EquipmentId,
                Fault = fault,
                Title = entry?.Title ?? (fault is null ? "Investigate unexplained abnormal behaviour" : fault.Replace('_', ' ')),
                Status = WorkOrderStatuses.Open,
                Priority = body.Priority ?? suggested,
                SuggestedPriority = suggested,
                PriorityReason = reason,
                Assignee = assignee,
                Notes = notes,
                Checks = JsonSerializer.Serialize(checks, Snake),
                LibraryVersion = doc.Version,
                LibraryReviewStatus = doc.ReviewStatus,
                CreatedAt = now,
            };
            db.WorkOrders.Add(o);
            db.WorkOrderEvents.AddRange(ids.Select(e => new WorkOrderEvent { WorkOrderId = o.Id, FaultEventId = e }));
            Log(db, o, now, "created",
                $"Opened from {ids.Length} event{(ids.Length == 1 ? "" : "s")}; {checks.Count} checks copied from the fault library. Suggested priority: {suggested}.",
                by, to: WorkOrderStatuses.Open);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return await Respond(db, response, o.Id, ct, created: true);
        })
        .WithName("CreateWorkOrder")
        .Produces<WorkOrderResponse>(StatusCodes.Status201Created)
        .ProducesProblem(StatusCodes.Status400BadRequest)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict);

        g.MapGet("/", async (
            FaultIqDbContext db, CancellationToken ct,
            [FromQuery] string? status, [FromQuery] string? priority, [FromQuery] string? fault,
            [FromQuery(Name = "equipment_id")] Guid? equipmentId, [FromQuery] string? site,
            [FromQuery(Name = "event_id")] Guid? eventId,
            [FromQuery] int? page, [FromQuery(Name = "page_size")] int? pageSize) =>
        {
            var p = new PageQuery(page, pageSize);
            var q = Filter(db, status, priority, fault, equipmentId, site, eventId);
            var total = await q.CountAsync(ct);
            var rows = await Summaries(db, q.OrderByDescending(o => o.CreatedAt).ThenBy(o => o.Id).Skip(p.Skip).Take(p.Size))
                .ToListAsync(ct);
            return TypedResults.Ok(new PagedResult<WorkOrderSummary>(
                rows.Select(r => r with { Code = Code(r.Number) }).ToList(), p.Number, p.Size, total));
        }).WithName("ListWorkOrders");

        // A CSV for contractors with their own maintenance system (ADR 0028).
        g.MapGet("/export", async (
            FaultIqDbContext db, CancellationToken ct,
            [FromQuery] string? status, [FromQuery] string? priority, [FromQuery] string? fault,
            [FromQuery(Name = "equipment_id")] Guid? equipmentId, [FromQuery] string? site) =>
        {
            var q = Filter(db, status, priority, fault, equipmentId, site, null);
            var rows = await (from o in q
                              join e in db.Equipment on o.EquipmentId equals e.Id
                              orderby o.Number
                              select new
                              {
                                  o.Number,
                                  e.Name,
                                  e.Site,
                                  o.Fault,
                                  o.Title,
                                  o.Status,
                                  o.Priority,
                                  o.Assignee,
                                  o.Outcome,
                                  o.ConfirmedFault,
                                  o.RepairTime,
                                  o.Findings,
                                  o.CreatedAt,
                                  o.CompletedAt,
                              }).Take(MaxExportRows).ToListAsync(ct);
            var csv = new StringBuilder();
            csv.AppendLine("work_order,unit,site,fault,title,status,priority,assignee,outcome,confirmed_fault,repair_time_as_recorded,findings,created_at_utc,completed_at_utc");
            foreach (var r in rows)
            {
                csv.AppendLine(string.Join(',', new[]
                {
                    Code(r.Number), r.Name, r.Site, r.Fault, r.Title, r.Status, r.Priority, r.Assignee, r.Outcome,
                    r.ConfirmedFault, Iso(r.RepairTime), r.Findings, Iso(r.CreatedAt), Iso(r.CompletedAt),
                }.Select(CsvCell)));
            }

            return TypedResults.File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", "work-orders.csv");
        })
        .WithName("ExportWorkOrders")
        .Produces(StatusCodes.Status200OK, contentType: "text/csv");

        g.MapGet("/{id:guid}", async Task<IResult> (Guid id, FaultIqDbContext db, HttpResponse response, CancellationToken ct) =>
            await db.WorkOrders.AnyAsync(o => o.Id == id, ct)
                ? await Respond(db, response, id, ct)
                : Problems.NotFound("Work order"))
        .WithName("GetWorkOrder")
        .Produces<WorkOrderResponse>()
        .ProducesProblem(StatusCodes.Status404NotFound);

        g.MapPatch("/{id:guid}", async Task<IResult> (
            Guid id, UpdateWorkOrderRequest body, FaultIqDbContext db, TimeProvider clock, HttpRequest request,
            HttpResponse response, CancellationToken ct) =>
        {
            if (body.Priority is not null && !WorkOrderPriorities.All.Contains(body.Priority))
            {
                return Problems.Invalid("priority", $"Priority must be one of: {string.Join(", ", WorkOrderPriorities.All)}.");
            }

            var by = Clean(body.RecordedBy);
            if ((TooLong("assignee", body.Assignee?.Trim(), 200) ?? TooLong("notes", body.Notes?.Trim(), 2000)
                    ?? TooLong("recorded_by", by, 200)) is { } tooLong)
            {
                return tooLong;
            }

            var o = await db.WorkOrders.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (o is null)
            {
                return Problems.NotFound("Work order");
            }

            if (CheckVersion(request, o) is { } precondition)
            {
                return precondition;
            }

            if (!WorkOrderStatuses.Active.Contains(o.Status))
            {
                return Problems.Of(StatusCodes.Status409Conflict, "work_order_closed",
                    $"This work order is {o.Status.Replace('_', ' ')} and can no longer be changed.");
            }

            // null leaves a field unchanged; an empty string clears assignee or notes. One request
            // writes one history entry listing every change, so the history order is never ambiguous.
            var changes = new List<string>();
            if (body.Priority is not null && body.Priority != o.Priority)
            {
                changes.Add($"Priority {o.Priority} to {body.Priority} (suggested: {o.SuggestedPriority}).");
                o.Priority = body.Priority;
            }

            if (body.Assignee is not null && Clean(body.Assignee) != o.Assignee)
            {
                o.Assignee = Clean(body.Assignee);
                changes.Add(o.Assignee is null ? "Unassigned." : $"Assigned to {o.Assignee}.");
            }

            if (body.Notes is not null && Clean(body.Notes) != o.Notes)
            {
                o.Notes = Clean(body.Notes);
                changes.Add(o.Notes is null ? "Notes cleared." : $"Notes: {o.Notes}");
            }

            if (changes.Count == 0)
            {
                return await Respond(db, response, id, ct);
            }

            Log(db, o, clock.GetUtcNow(), "updated", string.Join(" ", changes), by);

            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateConcurrencyException)
            {
                return Stale();
            }

            return await Respond(db, response, id, ct);
        })
        .WithName("UpdateWorkOrder")
        .Produces<WorkOrderResponse>()
        .ProducesProblem(StatusCodes.Status400BadRequest)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .ProducesProblem(StatusCodes.Status412PreconditionFailed)
        .ProducesProblem(StatusCodes.Status428PreconditionRequired);

        g.MapPost("/{id:guid}/transitions", async Task<IResult> (
            Guid id, WorkOrderTransitionRequest body, FaultIqDbContext db, FaultLibraryStore library,
            TimeProvider clock, HttpRequest request, HttpResponse response, CancellationToken ct) =>
        {
            if (body.To is null || !Transitions.TryGetValue(body.To, out var move))
            {
                return Problems.Invalid("to", $"Move must be one of: {string.Join(", ", Transitions.Keys)}.");
            }

            var o = await db.WorkOrders.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (o is null)
            {
                return Problems.NotFound("Work order");
            }

            if (CheckVersion(request, o) is { } precondition)
            {
                return precondition;
            }

            if (!move.From.Contains(o.Status))
            {
                return Problems.Of(StatusCodes.Status409Conflict, "invalid_transition",
                    $"A work order that is {o.Status.Replace('_', ' ')} can't be moved with '{body.To}'.");
            }

            var by = Clean(body.RecordedBy);
            if (TooLong("recorded_by", by, 200) is { } byTooLong)
            {
                return byTooLong;
            }

            var now = clock.GetUtcNow();
            var from = o.Status;
            string note;
            switch (body.To)
            {
                case "complete":
                    var findings = Clean(body.Findings);
                    if (findings is null)
                    {
                        return Problems.Invalid("findings", "Say what was found and done on site.");
                    }

                    if (TooLong("findings", findings, 2000) is { } findingsTooLong)
                    {
                        return findingsTooLong;
                    }

                    if (body.Outcome is null || !WorkOrderOutcomes.All.Contains(body.Outcome))
                    {
                        return Problems.Invalid("outcome", $"Outcome must be one of: {string.Join(", ", WorkOrderOutcomes.All)}.");
                    }

                    if (body.Outcome == WorkOrderOutcomes.Confirmed && o.Fault is null)
                    {
                        return Problems.Invalid("outcome",
                            "This work order names no fault. Choose 'different_fault' with the fault found, or 'no_fault_found'.");
                    }

                    string? confirmed = null;
                    if (body.Outcome == WorkOrderOutcomes.DifferentFault)
                    {
                        confirmed = Clean(body.ConfirmedFault);
                        if (confirmed is null || library.Document.Faults.All(f => f.Id != confirmed) || confirmed == o.Fault)
                        {
                            return Problems.Invalid("confirmed_fault",
                                "Name the fault that was found: a fault library id other than the one on this order.");
                        }
                    }

                    if (body.Outcome != WorkOrderOutcomes.NoFaultFound && body.RepairTime is null)
                    {
                        return Problems.Invalid("repair_time",
                            "Give the repair time as recorded in the unit's data, so the next upload can verify the fix.");
                    }

                    o.Outcome = body.Outcome;
                    o.ConfirmedFault = confirmed;
                    o.Findings = findings;
                    o.RepairTime = body.Outcome == WorkOrderOutcomes.NoFaultFound ? null : body.RepairTime?.ToUniversalTime();
                    o.CompletedAt = now;
                    note = $"Outcome: {body.Outcome.Replace('_', ' ')}{(confirmed is null ? "" : $" ({confirmed.Replace('_', ' ')})")}. Findings: {findings}";
                    break;
                case "cancel":
                    var reason = Clean(body.Reason);
                    if (reason is null)
                    {
                        return Problems.Invalid("reason", "Say why the work order is cancelled.");
                    }

                    if (TooLong("reason", reason, 1000) is { } reasonTooLong)
                    {
                        return reasonTooLong;
                    }

                    o.CancelReason = reason;
                    o.CancelledAt = now;
                    note = $"Reason: {reason}";
                    break;
                default:
                    o.StartedAt = now;
                    note = o.Assignee is null ? "Work started." : $"Work started by {o.Assignee}.";
                    break;
            }

            o.Status = move.To;
            Log(db, o, now, body.To == "start" ? "started" : body.To == "complete" ? "completed" : "cancelled", note, by, from,
                move.To);
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateConcurrencyException)
            {
                return Stale();
            }

            return await Respond(db, response, id, ct);
        })
        .WithName("TransitionWorkOrder")
        .Produces<WorkOrderResponse>()
        .ProducesProblem(StatusCodes.Status400BadRequest)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .ProducesProblem(StatusCodes.Status412PreconditionFailed)
        .ProducesProblem(StatusCodes.Status428PreconditionRequired);

        return api;
    }

    private static string? Iso(DateTimeOffset? t) =>
        t?.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);

    /// <summary>Quotes a CSV cell, and stops spreadsheets running text that starts like a formula.</summary>
    public static string CsvCell(string? value)
    {
        var v = value ?? "";
        if (v.Length > 0 && "=+-@\t\r".Contains(v[0], StringComparison.Ordinal))
        {
            v = "'" + v;
        }

        return v.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? $"\"{v.Replace("\"", "\"\"", StringComparison.Ordinal)}\"" : v;
    }
}
