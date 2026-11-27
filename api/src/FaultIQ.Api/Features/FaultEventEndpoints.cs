using FaultIQ.Api.Common;
using FaultIQ.Api.Data;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FaultIQ.Api.Features;

public sealed record FaultEventResponse(
    Guid Id, Guid AnalysisId, Guid EquipmentId, string EventKey, string Kind, string? Fault,
    DateTimeOffset StartsAt, DateTimeOffset EndsAt, int Hours, double? Confidence, double DetectorScore,
    string ReviewStatus, string? ReviewNote, DateTimeOffset? ReviewedAt);

public sealed record ReviewRequest(string Status, string? Note);

/// <summary>Event counts and hours per kind and fault: the dashboard's fault distribution.</summary>
public sealed record FaultEventSummaryItem(string Kind, string? Fault, int Events, int Hours);

public sealed record FaultEventSummaryResponse(IReadOnlyList<FaultEventSummaryItem> Items, int Events, int Hours);

/// <summary>Event hours on one calendar day of the data, by kind: the Operator's issue calendar.</summary>
public sealed record DailyFaultHours(DateOnly Date, string Kind, int Hours, int Units);

public static class FaultEventEndpoints
{
    private static IQueryable<FaultEvent> Filter(
        FaultIqDbContext db, Guid? equipmentId, Guid? analysisId, string? site, string? kind, string? fault,
        string? reviewStatus, DateTimeOffset? from, DateTimeOffset? to)
    {
        var q = db.FaultEvents.AsNoTracking();
        if (equipmentId is not null)
        {
            q = q.Where(e => e.EquipmentId == equipmentId);
        }

        if (analysisId is not null)
        {
            q = q.Where(e => e.AnalysisId == analysisId);
        }

        if (!string.IsNullOrWhiteSpace(site))
        {
            var ids = db.Equipment.Where(x => x.Site == site).Select(x => x.Id);
            q = q.Where(e => ids.Contains(e.EquipmentId));
        }

        if (kind is not null)
        {
            q = q.Where(e => e.Kind == kind);
        }

        if (fault is not null)
        {
            q = q.Where(e => e.Fault == fault);
        }

        if (reviewStatus is not null)
        {
            q = q.Where(e => e.ReviewStatus == reviewStatus);
        }

        if (from is not null)
        {
            q = q.Where(e => e.EndsAt > from.Value.ToUniversalTime());
        }

        if (to is not null)
        {
            q = q.Where(e => e.StartsAt < to.Value.ToUniversalTime());
        }

        return q;
    }

    internal static FaultEventResponse ToResponse(FaultEvent e) => new(
        e.Id, e.AnalysisId, e.EquipmentId, e.EventKey, e.Kind, e.Fault, e.StartsAt, e.EndsAt, e.Hours,
        e.Confidence, e.DetectorScore, e.ReviewStatus, e.ReviewNote, e.ReviewedAt);

    public static RouteGroupBuilder MapFaultEventEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/fault-events").WithTags("fault-events");

        // Events across analyses, newest first: the dashboard's "recent fault events" (ADR 0023).
        g.MapGet("/", async (
            FaultIqDbContext db, CancellationToken ct,
            [FromQuery(Name = "equipment_id")] Guid? equipmentId,
            [FromQuery(Name = "analysis_id")] Guid? analysisId,
            [FromQuery] string? site, [FromQuery] string? kind, [FromQuery] string? fault,
            [FromQuery(Name = "review_status")] string? reviewStatus,
            [FromQuery] DateTimeOffset? from, [FromQuery] DateTimeOffset? to,
            [FromQuery] string? order,
            [FromQuery] int? page, [FromQuery(Name = "page_size")] int? pageSize) =>
        {
            var p = new PageQuery(page, pageSize);
            var q = Filter(db, equipmentId, analysisId, site, kind, fault, reviewStatus, from, to);
            var total = await q.CountAsync(ct);
            // "hours": longest and most confident first, for the technician's work queue (ADR 0026).
            var ordered = order == "hours"
                ? q.OrderByDescending(e => e.Hours).ThenByDescending(e => e.Confidence).ThenBy(e => e.Id)
                : q.OrderByDescending(e => e.StartsAt).ThenBy(e => e.Id);
            var rows = await ordered.Skip(p.Skip).Take(p.Size).ToListAsync(ct);
            return TypedResults.Ok(new PagedResult<FaultEventResponse>(rows.Select(ToResponse).ToList(),
                p.Number, p.Size, total));
        }).WithName("ListFaultEvents");

        g.MapGet("/summary", async (
            FaultIqDbContext db, CancellationToken ct,
            [FromQuery(Name = "equipment_id")] Guid? equipmentId, [FromQuery] string? site,
            [FromQuery] DateTimeOffset? from, [FromQuery] DateTimeOffset? to) =>
        {
            var items = await Filter(db, equipmentId, null, site, null, null, null, from, to)
                .GroupBy(e => new { e.Kind, e.Fault })
                .Select(x => new FaultEventSummaryItem(x.Key.Kind, x.Key.Fault, x.Count(), x.Sum(e => e.Hours)))
                .ToListAsync(ct);
            items = items.OrderByDescending(i => i.Hours).ThenBy(i => i.Fault).ToList();
            return TypedResults.Ok(new FaultEventSummaryResponse(items, items.Sum(i => i.Events), items.Sum(i => i.Hours)));
        }).WithName("SummariseFaultEvents");

        // Events can span days, so each event's alarmed hours are split across the days they fall on.
        g.MapGet("/daily", async (
            FaultIqDbContext db, CancellationToken ct,
            [FromQuery(Name = "equipment_id")] Guid? equipmentId, [FromQuery] string? site,
            [FromQuery] DateTimeOffset? from, [FromQuery] DateTimeOffset? to) =>
        {
            var events = await Filter(db, equipmentId, null, site, null, null, null, from, to)
                .Select(e => new { e.EquipmentId, e.Kind, e.StartsAt, e.Hours }).ToListAsync(ct);
            var cells = new Dictionary<(DateOnly, string), (int Hours, HashSet<Guid> Units)>();
            foreach (var e in events)
            {
                // Count the event's alarmed hours (not its clock span, which can include a quiet hour).
                for (var i = 0; i < e.Hours; i++)
                {
                    var h = e.StartsAt.UtcDateTime.AddHours(i);
                    var key = (DateOnly.FromDateTime(h), e.Kind);
                    var cell = cells.TryGetValue(key, out var found) ? found : (Hours: 0, Units: new HashSet<Guid>());
                    cell.Units.Add(e.EquipmentId);
                    cells[key] = (cell.Hours + 1, cell.Units);
                }
            }

            return TypedResults.Ok(cells.OrderBy(c => c.Key.Item1).ThenBy(c => c.Key.Item2)
                .Select(c => new DailyFaultHours(c.Key.Item1, c.Key.Item2, c.Value.Hours, c.Value.Units.Count)).ToList());
        }).WithName("DailyFaultHours");

        g.MapGet("/{id:guid}", async Task<Results<Ok<FaultEventResponse>, ProblemHttpResult>> (
            Guid id, FaultIqDbContext db, CancellationToken ct) =>
        {
            var e = await db.FaultEvents.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            return e is null ? Problems.NotFound("Fault event") : TypedResults.Ok(ToResponse(e));
        }).WithName("GetFaultEvent");

        // A person's verdict: needs review, confirmed or rejected. Confirmed outcomes are future
        // labelled data. Who reviewed is recorded once login exists (Phase 8).
        g.MapPatch("/{id:guid}/review", async Task<Results<Ok<FaultEventResponse>, ProblemHttpResult>> (
            Guid id, ReviewRequest body, FaultIqDbContext db, TimeProvider clock, CancellationToken ct) =>
        {
            if (!ReviewStatuses.All.Contains(body.Status))
            {
                return Problems.Invalid("status", $"Status must be one of: {string.Join(", ", ReviewStatuses.All)}.");
            }

            var note = string.IsNullOrWhiteSpace(body.Note) ? null : body.Note.Trim();
            if (note is { Length: > 1000 })
            {
                return Problems.Invalid("note", "Notes may be at most 1000 characters.");
            }

            var e = await db.FaultEvents.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (e is null)
            {
                return Problems.NotFound("Fault event");
            }

            e.ReviewStatus = body.Status;
            e.ReviewNote = note;
            e.ReviewedAt = body.Status == ReviewStatuses.Unreviewed ? null : clock.GetUtcNow();
            await db.SaveChangesAsync(ct);
            return TypedResults.Ok(ToResponse(e));
        }).WithName("ReviewFaultEvent");

        return api;
    }
}
