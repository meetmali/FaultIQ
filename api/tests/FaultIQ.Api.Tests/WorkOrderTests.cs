using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FaultIQ.Api.Data;
using FaultIQ.Api.Features;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace FaultIQ.Api.Tests;

/// <summary>CSV cells are safe to open in a spreadsheet (ADR 0028).</summary>
public sealed class WorkOrderCsvTests
{
    [Theory]
    [InlineData("plain", "plain")]
    [InlineData("=HYPERLINK(\"x\")", "\"'=HYPERLINK(\"\"x\"\")\"")]
    [InlineData("+1", "'+1")]
    [InlineData("-cmd", "'-cmd")]
    [InlineData("@SUM(A1)", "'@SUM(A1)")]
    [InlineData("a,b", "\"a,b\"")]
    [InlineData("line\nbreak", "\"line\nbreak\"")]
    public void CsvCell_QuotesAndDisarmsFormulas(string value, string expected) =>
        Assert.Equal(expected, WorkOrderEndpoints.CsvCell(value));

    [Theory]
    [InlineData("condenser_fouling", 30, "high")]
    [InlineData("condenser_fouling", 24, "high")]
    [InlineData("condenser_fouling", 5, "medium")]
    [InlineData(null, 90, "low")]
    public void SuggestedPriority_FollowsTheWrittenRule(string? fault, int hours, string expected) =>
        Assert.Equal(expected, WorkOrderEndpoints.SuggestPriority(fault, hours).Priority);
}

/// <summary>Work orders against a real, freshly migrated PostgreSQL database (ADR 0028).</summary>
[Collection(DatabaseCollection.Name)]
public sealed class WorkOrderTests(DatabaseFactory factory) : IClassFixture<DatabaseFactory>
{
    private static readonly DateTimeOffset T0 = new(2018, 10, 11, 7, 0, 0, TimeSpan.Zero);
    private static Uri Url(string path) => new(path, UriKind.Relative);

    private static async Task<string?> Code(HttpResponseMessage resp) =>
        JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement.GetProperty("code").GetString();

    /// <summary>A unit with one succeeded analysis, its data starting at <paramref name="periodStart"/>.</summary>
    private async Task<(Guid Unit, Guid Analysis)> SeedUnitAsync(string name, DateTimeOffset? periodStart = null, int hoursScored = 400)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FaultIqDbContext>();
        var unit = new Equipment { Id = Guid.CreateVersion7(), Name = name, Site = "WO site", CreatedAt = DateTimeOffset.UtcNow };
        db.Equipment.Add(unit);
        await db.SaveChangesAsync();
        return (unit.Id, await AddAnalysisAsync(unit.Id, periodStart ?? T0.AddDays(-1), hoursScored));
    }

    private async Task<Guid> AddAnalysisAsync(Guid unit, DateTimeOffset periodStart, int hoursScored)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FaultIqDbContext>();
        var upload = new Upload
        {
            Id = Guid.CreateVersion7(),
            EquipmentId = unit,
            OriginalName = "a.csv",
            StoredName = $"{Guid.NewGuid():N}.csv",
            Format = "lbnl_simulated",
            SizeBytes = 10,
            Sha256 = new string('0', 64),
            CreatedAt = DateTimeOffset.UtcNow,
        };
        var a = new Analysis
        {
            Id = Guid.CreateVersion7(),
            UploadId = upload.Id,
            EquipmentId = unit,
            PointSet = "all",
            Status = AnalysisStatus.Succeeded,
            CreatedAt = DateTimeOffset.UtcNow,
            FinishedAt = DateTimeOffset.UtcNow,
            HoursScored = hoursScored,
            Result = $$"""{"schema_version": "1.1.0", "period_start": "{{periodStart.UtcDateTime:yyyy-MM-ddTHH:mm:ss}}Z", "events": []}""",
        };
        db.Uploads.Add(upload);
        db.Analyses.Add(a);
        await db.SaveChangesAsync();
        return a.Id;
    }

    private async Task<Guid> AddEventAsync(Guid unit, Guid analysis, string kind, string? fault, int hours, DateTimeOffset? start = null)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FaultIqDbContext>();
        var s = start ?? T0;
        var e = new FaultEvent
        {
            Id = Guid.CreateVersion7(),
            AnalysisId = analysis,
            EquipmentId = unit,
            EventKey = $"event-{Guid.NewGuid():N}",
            Kind = kind,
            Fault = fault,
            StartsAt = s,
            EndsAt = s.AddHours(hours),
            Hours = hours,
            Confidence = fault is null ? null : 0.99,
            DetectorScore = 9.0,
        };
        db.FaultEvents.Add(e);
        await db.SaveChangesAsync();
        return e.Id;
    }

    private async Task<HttpResponseMessage> CreateAsync(HttpClient client, params Guid[] events) =>
        await client.PostAsJsonAsync(Url("/api/v1/work-orders"), new { event_ids = events, recorded_by = "Sam" });

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, HttpMethod method, string path, object body, string? etag)
    {
        using var req = new HttpRequestMessage(method, Url(path)) { Content = JsonContent.Create(body) };
        if (etag is not null)
        {
            req.Headers.IfMatch.Add(EntityTagHeaderValue.Parse(etag));
        }

        return await client.SendAsync(req);
    }

    private static string Etag(HttpResponseMessage resp) => resp.Headers.ETag!.ToString();

    [DatabaseFact]
    public async Task Create_ValidatesTheEvents()
    {
        var client = factory.CreateClient();
        var (unitA, analysisA) = await SeedUnitAsync("WO-validate-A");
        var (unitB, analysisB) = await SeedUnitAsync("WO-validate-B");
        var a = await AddEventAsync(unitA, analysisA, "fault", "condenser_fouling", 10);
        var other = await AddEventAsync(unitA, analysisA, "fault", "refrigerant_undercharge", 10);
        var b = await AddEventAsync(unitB, analysisB, "fault", "condenser_fouling", 10);
        var off = await AddEventAsync(unitA, analysisA, "not_diagnosable", null, 3);

        Assert.Equal(HttpStatusCode.BadRequest, (await CreateAsync(client)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await CreateAsync(client, Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await CreateAsync(client, a, b)).StatusCode);        // two units
        Assert.Equal(HttpStatusCode.BadRequest, (await CreateAsync(client, a, other)).StatusCode);    // two faults
        Assert.Equal(HttpStatusCode.BadRequest, (await CreateAsync(client, off)).StatusCode);         // not diagnosable
    }

    [DatabaseFact]
    public async Task Create_CopiesChecksWordForWord_AndSuggestsPriority()
    {
        var client = factory.CreateClient();
        var (unit, analysis) = await SeedUnitAsync("WO-create");
        var longEvent = await AddEventAsync(unit, analysis, "fault", "condenser_fouling", 90);

        var created = await CreateAsync(client, longEvent);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.NotNull(created.Headers.ETag);
        var order = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Matches("^WO-\\d{4}$", order.GetProperty("code").GetString());
        Assert.Equal("open", order.GetProperty("status").GetString());
        Assert.Equal("high", order.GetProperty("priority").GetString());
        Assert.Equal("high", order.GetProperty("suggested_priority").GetString());
        Assert.Equal("Condenser fouling", order.GetProperty("title").GetString());

        var library = factory.Services.GetRequiredService<FaultLibraryStore>().Document;
        var expected = library.Faults.Single(f => f.Id == "condenser_fouling").Checks.Select(c => (c.Text, c.Source)).ToList();
        var copied = order.GetProperty("checks").EnumerateArray()
            .Select(c => (c.GetProperty("text").GetString()!, c.GetProperty("source").GetString()!)).ToList();
        Assert.Equal(expected, copied);
        Assert.Equal(library.ReviewStatus, order.GetProperty("library_review_status").GetString());
        var log = order.GetProperty("log").EnumerateArray().Single();
        Assert.Equal("created", log.GetProperty("action").GetString());
        Assert.Equal("Sam", log.GetProperty("recorded_by").GetString());
        Assert.Equal("not_started", order.GetProperty("verification").GetProperty("status").GetString());

        // No named fault: an investigation, with no checks to copy.
        var unclear = await AddEventAsync(unit, analysis, "inconclusive", null, 12, T0.AddDays(5));
        var investigation = await (await CreateAsync(client, unclear)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("low", investigation.GetProperty("priority").GetString());
        Assert.Equal(0, investigation.GetProperty("checks").GetArrayLength());

        var listed = await client.GetFromJsonAsync<JsonElement>(Url($"/api/v1/work-orders?event_id={longEvent}"));
        Assert.Equal(1, listed.GetProperty("total").GetInt32());
        Assert.Equal(1, listed.GetProperty("items")[0].GetProperty("event_count").GetInt32());
    }

    [DatabaseFact]
    public async Task Create_RefusesAnEventAlreadyOnAnOpenOrder_UntilItIsCancelled()
    {
        var client = factory.CreateClient();
        var (unit, analysis) = await SeedUnitAsync("WO-conflict");
        var ev = await AddEventAsync(unit, analysis, "fault", "evaporator_fouling", 6);
        var first = await CreateAsync(client, ev);
        var again = await CreateAsync(client, ev);
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal("event_already_on_order", await Code(again));

        var id = (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var cancelled = await SendAsync(client, HttpMethod.Post, $"/api/v1/work-orders/{id}/transitions",
            new { to = "cancel", reason = "Duplicate of a contractor ticket." }, Etag(first));
        Assert.Equal(HttpStatusCode.OK, cancelled.StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await CreateAsync(client, ev)).StatusCode);
    }

    [DatabaseFact]
    public async Task Lifecycle_EnforcesTheStateMachine_AndVersions_AndNeverTouchesTheModelResult()
    {
        var client = factory.CreateClient();
        var (unit, analysis) = await SeedUnitAsync("WO-lifecycle");
        var ev = await AddEventAsync(unit, analysis, "fault", "oa_damper_stuck", 30);
        var created = await CreateAsync(client, ev);
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var path = $"/api/v1/work-orders/{id}";
        var v1 = Etag(created);

        var noVersion = await SendAsync(client, HttpMethod.Patch, path, new { assignee = "Alex" }, null);
        Assert.Equal(HttpStatusCode.PreconditionRequired, noVersion.StatusCode);

        var assigned = await SendAsync(client, HttpMethod.Patch, path, new { assignee = "Alex", priority = "urgent", recorded_by = "Sam" }, v1);
        Assert.Equal(HttpStatusCode.OK, assigned.StatusCode);
        var v2 = Etag(assigned);
        Assert.NotEqual(v1, v2);

        var stale = await SendAsync(client, HttpMethod.Patch, path, new { notes = "late edit" }, v1);
        Assert.Equal(HttpStatusCode.PreconditionFailed, stale.StatusCode);
        Assert.Equal("stale_work_order", await Code(stale));

        var tooEarly = await SendAsync(client, HttpMethod.Post, $"{path}/transitions", new { to = "complete" }, v2);
        Assert.Equal(HttpStatusCode.Conflict, tooEarly.StatusCode);
        Assert.Equal("invalid_transition", await Code(tooEarly));

        var started = await SendAsync(client, HttpMethod.Post, $"{path}/transitions", new { to = "start" }, v2);
        Assert.Equal(HttpStatusCode.OK, started.StatusCode);
        var v3 = Etag(started);

        var noFindings = await SendAsync(client, HttpMethod.Post, $"{path}/transitions", new { to = "complete", outcome = "confirmed" }, v3);
        Assert.Equal(HttpStatusCode.BadRequest, noFindings.StatusCode);
        var noRepair = await SendAsync(client, HttpMethod.Post, $"{path}/transitions",
            new { to = "complete", outcome = "confirmed", findings = "Linkage slipped." }, v3);
        Assert.Equal(HttpStatusCode.BadRequest, noRepair.StatusCode);
        var sameFault = await SendAsync(client, HttpMethod.Post, $"{path}/transitions",
            new { to = "complete", outcome = "different_fault", confirmed_fault = "oa_damper_stuck", findings = "x", repair_time = T0.AddDays(2) }, v3);
        Assert.Equal(HttpStatusCode.BadRequest, sameFault.StatusCode);

        var done = await SendAsync(client, HttpMethod.Post, $"{path}/transitions",
            new { to = "complete", outcome = "confirmed", findings = "Actuator linkage slipped; refastened, damper follows command.", repair_time = T0.AddDays(2) }, v3);
        Assert.Equal(HttpStatusCode.OK, done.StatusCode);
        var order = await done.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("completed", order.GetProperty("status").GetString());
        var log = order.GetProperty("log").EnumerateArray().ToList();
        Assert.Equal(["created", "updated", "started", "completed"], log.Select(l => l.GetProperty("action").GetString()));
        Assert.Equal("Priority high to urgent (suggested: high). Assigned to Alex.", log[1].GetProperty("note").GetString());
        Assert.Equal("Sam", log[1].GetProperty("recorded_by").GetString());

        var closed = await SendAsync(client, HttpMethod.Patch, path, new { notes = "after" }, Etag(done));
        Assert.Equal(HttpStatusCode.Conflict, closed.StatusCode);
        Assert.Equal("work_order_closed", await Code(closed));

        // The outcome is the order's own label: the event's review and the model result are untouched.
        var eventAfter = await client.GetFromJsonAsync<JsonElement>(Url($"/api/v1/fault-events/{ev}"));
        Assert.Equal("unreviewed", eventAfter.GetProperty("review_status").GetString());
        var resultAfter = await client.GetFromJsonAsync<JsonElement>(Url($"/api/v1/analyses/{analysis}/result"));
        Assert.Equal("1.1.0", resultAfter.GetProperty("schema_version").GetString());
    }

    private async Task<JsonElement> CompleteAsync(HttpClient client, Guid ev, object completion)
    {
        var created = await CreateAsync(client, ev);
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var started = await SendAsync(client, HttpMethod.Post, $"/api/v1/work-orders/{id}/transitions", new { to = "start" }, Etag(created));
        var done = await SendAsync(client, HttpMethod.Post, $"/api/v1/work-orders/{id}/transitions", completion, Etag(started));
        Assert.Equal(HttpStatusCode.OK, done.StatusCode);
        return await done.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static string Verification(JsonElement order) => order.GetProperty("verification").GetProperty("status").GetString()!;

    [DatabaseFact]
    public async Task Verification_UsesTheFirstAnalysisOfDataAfterTheRepair()
    {
        var client = factory.CreateClient();
        var repair = T0.AddDays(10);
        var complete = new { to = "complete", outcome = "confirmed", findings = "Coil cleaned.", repair_time = repair };

        // Pending, then verified once 48 clean hours after the repair are analysed.
        var (unit, analysis) = await SeedUnitAsync("WO-verify-ok");
        var ok = await CompleteAsync(client, await AddEventAsync(unit, analysis, "fault", "condenser_fouling", 40), complete);
        Assert.Equal("pending", Verification(ok));
        await AddAnalysisAsync(unit, repair.AddHours(6), 48);
        var path = $"/api/v1/work-orders/{ok.GetProperty("id").GetGuid()}";
        Assert.Equal("verified", Verification(await client.GetFromJsonAsync<JsonElement>(Url(path))));

        // Still present: the next analysis names the same fault.
        var (unit2, analysis2) = await SeedUnitAsync("WO-verify-persists");
        var persists = await CompleteAsync(client, await AddEventAsync(unit2, analysis2, "fault", "condenser_fouling", 40), complete);
        var after = await AddAnalysisAsync(unit2, repair.AddDays(1), 200);
        await AddEventAsync(unit2, after, "fault", "condenser_fouling", 20, repair.AddDays(2));
        Assert.Equal("persists", Verification(await client.GetFromJsonAsync<JsonElement>(
            Url($"/api/v1/work-orders/{persists.GetProperty("id").GetGuid()}"))));

        // Too little data after the repair to judge.
        var (unit3, analysis3) = await SeedUnitAsync("WO-verify-short");
        var shortOrder = await CompleteAsync(client, await AddEventAsync(unit3, analysis3, "fault", "condenser_fouling", 40), complete);
        await AddAnalysisAsync(unit3, repair.AddDays(1), 6);
        Assert.Equal("not_verifiable", Verification(await client.GetFromJsonAsync<JsonElement>(
            Url($"/api/v1/work-orders/{shortOrder.GetProperty("id").GetGuid()}"))));

        // No fault found: nothing to verify.
        var (unit4, analysis4) = await SeedUnitAsync("WO-verify-none");
        var none = await CompleteAsync(client, await AddEventAsync(unit4, analysis4, "fault", "condenser_fouling", 40),
            new { to = "complete", outcome = "no_fault_found", findings = "Coil clean, fans fine." });
        Assert.Equal("not_applicable", Verification(none));
    }

    [DatabaseFact]
    public async Task Export_IsACsvWithDisarmedFormulas()
    {
        var client = factory.CreateClient();
        var (unit, analysis) = await SeedUnitAsync("WO-export");
        var ev = await AddEventAsync(unit, analysis, "fault", "sat_sensor_bias", 8);
        var created = await CreateAsync(client, ev);
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        await SendAsync(client, HttpMethod.Patch, $"/api/v1/work-orders/{id}", new { assignee = "=cmd|' /C calc'!A0" }, Etag(created));

        var resp = await client.GetAsync(Url($"/api/v1/work-orders/export?equipment_id={unit}"));
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Equal("text/csv", resp.Content.Headers.ContentType?.MediaType);
        var lines = (await resp.Content.ReadAsStringAsync()).TrimEnd().Split('\n');
        Assert.StartsWith("work_order,unit,site,fault", lines[0]);
        Assert.Equal(2, lines.Length);
        Assert.Contains(",'=cmd|' /C calc'!A0,", lines[1]);
        Assert.DoesNotContain(",=cmd", lines[1]);
    }

    [DatabaseFact]
    public async Task DemoMode_RefusesWorkOrderWrites()
    {
        var client = factory.WithWebHostBuilder(b => b.UseSetting("Demo:Enabled", "true")).CreateClient();
        var resp = await client.PostAsJsonAsync(Url("/api/v1/work-orders"), new { event_ids = new[] { Guid.NewGuid() } });
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        Assert.Equal("demo_read_only", await Code(resp));
    }
}
