using System.Diagnostics;
using FaultIQ.Api.Common;
using FaultIQ.Api.Data;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FaultIQ.Api.Features;

public sealed record CreateAnalysisRequest(Guid UploadId, string? PointSet);

public sealed record AnalysisResponse(
    Guid Id, Guid UploadId, Guid EquipmentId, string PointSet, string Status, int Attempts,
    DateTimeOffset CreatedAt, DateTimeOffset? StartedAt, DateTimeOffset? FinishedAt,
    string? ErrorCode, string? ErrorMessage, string? PipelineVersion, string? ModelVersion,
    int? HoursTotal, int? HoursScored, int? HoursAlarmed, int? EventCount)
{
    public static AnalysisResponse From(Analysis a) => new(
        a.Id, a.UploadId, a.EquipmentId, a.PointSet, a.Status, a.Attempts, a.CreatedAt, a.StartedAt,
        a.FinishedAt, a.ErrorCode, a.ErrorMessage, a.PipelineVersion, a.ModelVersion, a.HoursTotal,
        a.HoursScored, a.HoursAlarmed, a.EventCount);
}

public static class AnalysisEndpoints
{
    public static RouteGroupBuilder MapAnalysisEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/analyses").WithTags("analyses");

        // Queues a job. The worker picks it up from the table (ADR 0007); nothing is called directly.
        g.MapPost("/", async Task<Results<Accepted<AnalysisResponse>, ProblemHttpResult>> (
            CreateAnalysisRequest body, FaultIqDbContext db, TimeProvider clock, CancellationToken ct) =>
        {
            var pointSet = body.PointSet ?? "all";
            if (!PointSets.All.Contains(pointSet))
            {
                return Problems.Invalid("point_set", $"Point set must be one of: {string.Join(", ", PointSets.All)}.");
            }

            var upload = await db.Uploads.AsNoTracking().FirstOrDefaultAsync(u => u.Id == body.UploadId, ct);
            if (upload is null)
            {
                return Problems.NotFound("Upload");
            }

            var a = new Analysis
            {
                Id = Guid.CreateVersion7(),
                UploadId = upload.Id,
                EquipmentId = upload.EquipmentId,
                PointSet = pointSet,
                Status = AnalysisStatus.Queued,
                CreatedAt = clock.GetUtcNow(),
                // W3C trace context, so the worker's spans join this request's trace (ADR 0012).
                Traceparent = Activity.Current?.IdFormat == ActivityIdFormat.W3C ? Activity.Current.Id : null,
            };
            db.Analyses.Add(a);
            await db.SaveChangesAsync(ct);
            return TypedResults.Accepted($"/api/v1/analyses/{a.Id}", AnalysisResponse.From(a));
        }).WithName("CreateAnalysis");

        g.MapGet("/", async (
            FaultIqDbContext db, CancellationToken ct,
            [FromQuery] string? status, [FromQuery(Name = "equipment_id")] Guid? equipmentId,
            [FromQuery] int? page, [FromQuery(Name = "page_size")] int? pageSize) =>
        {
            var p = new PageQuery(page, pageSize);
            var q = db.Analyses.AsNoTracking();
            if (status is not null)
            {
                q = q.Where(a => a.Status == status);
            }

            if (equipmentId is not null)
            {
                q = q.Where(a => a.EquipmentId == equipmentId);
            }

            var total = await q.CountAsync(ct);
            var rows = await q.OrderByDescending(a => a.CreatedAt).ThenBy(a => a.Id)
                .Skip(p.Skip).Take(p.Size).ToListAsync(ct);
            return TypedResults.Ok(new PagedResult<AnalysisResponse>(rows.Select(AnalysisResponse.From).ToList(),
                p.Number, p.Size, total));
        }).WithName("ListAnalyses");

        g.MapGet("/{id:guid}", async Task<Results<Ok<AnalysisResponse>, ProblemHttpResult>> (
            Guid id, FaultIqDbContext db, CancellationToken ct) =>
        {
            var a = await db.Analyses.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            return a is null ? Problems.NotFound("Analysis") : TypedResults.Ok(AnalysisResponse.From(a));
        }).WithName("GetAnalysis");

        // The stored DiagnosticResult, passed through unchanged (docs/contracts/diagnostic-result.schema.json).
        g.MapGet("/{id:guid}/result", (Guid id, FaultIqDbContext db, CancellationToken ct) =>
                StoredJsonAsync(db, id, series: false, ct))
            .WithName("GetAnalysisResult")
            .Produces(StatusCodes.Status200OK, contentType: "application/json")
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        // Downsampled chart series, ready to draw (ADR 0009).
        g.MapGet("/{id:guid}/series", (Guid id, FaultIqDbContext db, CancellationToken ct) =>
                StoredJsonAsync(db, id, series: true, ct))
            .WithName("GetAnalysisSeries")
            .Produces(StatusCodes.Status200OK, contentType: "application/json")
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        // The data-quality report: every validation issue, completeness and operation (ADR 0027).
        // Stored for succeeded and quarantined jobs, so it is served for failed analyses too.
        g.MapGet("/{id:guid}/report", async Task<IResult> (Guid id, FaultIqDbContext db, CancellationToken ct) =>
            {
                var row = await db.Analyses.AsNoTracking().Where(a => a.Id == id)
                    .Select(a => new { a.Status, Json = a.ProcessingReport }).FirstOrDefaultAsync(ct);
                if (row is null)
                {
                    return Problems.NotFound("Analysis");
                }

                if (row.Json is not null)
                {
                    return TypedResults.Text(row.Json, "application/json");
                }

                return row.Status is AnalysisStatus.Queued or AnalysisStatus.Running
                    ? Problems.Of(StatusCodes.Status409Conflict, "result_not_ready", "The analysis has not finished yet.")
                    : Problems.Of(StatusCodes.Status404NotFound, "report_not_available",
                        "This analysis has no data-quality report: it stopped before the file was validated, or it ran before reports were kept.");
            })
            .WithName("GetAnalysisReport")
            .Produces(StatusCodes.Status200OK, contentType: "application/json")
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        return api;
    }

    private static async Task<IResult> StoredJsonAsync(
        FaultIqDbContext db, Guid id, bool series, CancellationToken ct)
    {
        // Select only the one JSON column needed; the other can be large.
        var q = db.Analyses.AsNoTracking().Where(a => a.Id == id);
        var row = series
            ? await q.Select(a => new { a.Status, Json = a.ChartSeries }).FirstOrDefaultAsync(ct)
            : await q.Select(a => new { a.Status, Json = a.Result }).FirstOrDefaultAsync(ct);
        if (row is null)
        {
            return Problems.NotFound("Analysis");
        }

        if (row.Status != AnalysisStatus.Succeeded || row.Json is null)
        {
            return Problems.Of(StatusCodes.Status409Conflict,
                row.Status == AnalysisStatus.Failed ? "analysis_failed" : "result_not_ready",
                row.Status == AnalysisStatus.Failed
                    ? "The analysis failed, so there is no result. See the analysis for the reason."
                    : "The analysis has not finished yet.");
        }

        return TypedResults.Text(row.Json, "application/json");
    }
}
