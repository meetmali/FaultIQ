using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FaultIQ.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace FaultIQ.Api.Tests;

/// <summary>Upload checks that reject a request before the database is ever asked.</summary>
public sealed class UploadValidationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    internal static MultipartFormDataContent Form(byte[] content, string fileName, string format, Guid equipmentId)
    {
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = new MediaTypeHeaderValue("text/csv");
        return new MultipartFormDataContent
        {
            { file, "file", fileName },
            { new StringContent(format), "format" },
            { new StringContent(equipmentId.ToString()), "equipment_id" },
        };
    }

    private static async Task<string?> Code(HttpResponseMessage resp) =>
        JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement.GetProperty("code").GetString();

    [Fact]
    public async Task RejectsUnknownFormat()
    {
        var resp = await factory.CreateClient().PostAsync(new Uri("/api/v1/uploads", UriKind.Relative),
            Form("a,b\n1,2\n"u8.ToArray(), "x.csv", "excel", Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Equal("validation_error", await Code(resp));
    }

    [Fact]
    public async Task RejectsFilesThatAreNotCsv()
    {
        var resp = await factory.CreateClient().PostAsync(new Uri("/api/v1/uploads", UriKind.Relative),
            Form("a,b\n1,2\n"u8.ToArray(), "data.xlsx", "lbnl_simulated", Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, resp.StatusCode);
        Assert.Equal("unsupported_file_type", await Code(resp));
    }

    [Fact]
    public async Task RejectsBinaryContentRenamedToCsv()
    {
        var resp = await factory.CreateClient().PostAsync(new Uri("/api/v1/uploads", UriKind.Relative),
            Form([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00], "data.csv", "lbnl_simulated", Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, resp.StatusCode);
        Assert.Equal("not_text", await Code(resp));
    }

    [Fact]
    public async Task FaultLibrary_ListsSearchesAndCitesSources()
    {
        var client = factory.CreateClient();
        var all = await client.GetFromJsonAsync<JsonElement>(new Uri("/api/v1/fault-library", UriKind.Relative));
        Assert.Equal(9, all.GetProperty("items").GetArrayLength());
        Assert.Equal("unreviewed", all.GetProperty("review_status").GetString());

        // Search reaches the measured symptoms, not just names.
        var hits = await client.GetFromJsonAsync<JsonElement>(
            new Uri("/api/v1/fault-library?q=discharge%20pressure", UriKind.Relative));
        Assert.Contains(hits.GetProperty("items").EnumerateArray(), f => f.GetProperty("id").GetString() == "condenser_fouling");

        var entry = await client.GetFromJsonAsync<JsonElement>(
            new Uri("/api/v1/fault-library/sat_sensor_bias", UriKind.Relative));
        var sources = entry.GetProperty("sources").EnumerateArray().Select(x => x.GetProperty("id").GetString()).ToList();
        Assert.Contains("faultiq-diagnosis", sources);
        Assert.Equal("Sensors", entry.GetProperty("fault").GetProperty("equipment").GetString());

        var missing = await client.GetAsync(new Uri("/api/v1/fault-library/not_a_fault", UriKind.Relative));
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Fact]
    public async Task EquipmentTypes_ListRooftopUnitsAsTheOnlyAvailableType()
    {
        var types = await factory.CreateClient().GetFromJsonAsync<JsonElement>(new Uri("/api/v1/equipment-types", UriKind.Relative));
        var available = types.EnumerateArray().Where(t => t.GetProperty("status").GetString() == "available")
            .Select(t => t.GetProperty("id").GetString()).ToList();
        Assert.Equal(["rtu"], available);
        Assert.Equal(5, types.GetArrayLength());
    }

    [Fact]
    public void ModelRegistry_IsEmbedded_WithOneEntryPerFormatAndPointSet()
    {
        var doc = factory.Services.GetRequiredService<FaultIQ.Api.Features.ModelRegistryStore>().Document;
        Assert.Equal(
            ["lbnl_experimental/all", "lbnl_experimental/basic", "lbnl_simulated/all", "lbnl_simulated/basic"],
            doc.Models.Select(m => $"{m.Format}/{m.PointSet}").Order(StringComparer.Ordinal));
        Assert.All(doc.Models, m => Assert.Contains(m.AdoptedModel, new[] { "logistic", "lightgbm" }));
        Assert.All(doc.Models, m => Assert.DoesNotContain("fault_free", m.Faults));
    }

    [Fact]
    public void Model_HasNoChangesMissingFromMigrations()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<FaultIqDbContext>();
        Assert.False(db.Database.HasPendingModelChanges(),
            "The EF model changed without a migration. Run `dotnet ef migrations add <Name>`.");
    }
}

/// <summary>The API against a real, freshly migrated PostgreSQL database.</summary>
public sealed class DatabaseEndpointTests(DatabaseFactory factory) : IClassFixture<DatabaseFactory>
{
    private static readonly JsonSerializerOptions Snake = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
    private static Uri Url(string path) => new(path, UriKind.Relative);

    private async Task<Guid> CreateEquipmentAsync(HttpClient client, string name = "RTU-1")
    {
        var resp = await client.PostAsJsonAsync(Url("/api/v1/equipment"), new { name, site = "Test site" });
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
    }

    private async Task<JsonElement> UploadAsync(HttpClient client, Guid equipmentId, byte[] content)
    {
        var resp = await client.PostAsync(Url("/api/v1/uploads"),
            UploadValidationTests.Form(content, "my export.csv", "lbnl_simulated", equipmentId));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        return await resp.Content.ReadFromJsonAsync<JsonElement>();
    }

    [DatabaseFact]
    public async Task Equipment_ValidatesAndPaginates()
    {
        var client = factory.CreateClient();
        var bad = await client.PostAsJsonAsync(Url("/api/v1/equipment"), new { name = "  " });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);

        await CreateEquipmentAsync(client, "RTU-A");
        await CreateEquipmentAsync(client, "RTU-B");
        var page = await client.GetFromJsonAsync<JsonElement>(Url("/api/v1/equipment?page=1&page_size=1"));
        Assert.Single(page.GetProperty("items").EnumerateArray());
        Assert.True(page.GetProperty("total").GetInt32() >= 2);
        Assert.Equal(1, page.GetProperty("page_size").GetInt32());
    }

    [DatabaseFact]
    public async Task Upload_StoresUnderServerName_WithHash()
    {
        var client = factory.CreateClient();
        var content = Encoding.UTF8.GetBytes("Timestamp,SAT\n2018-07-20 00:00:00,12.0\n");
        var upload = await UploadAsync(client, await CreateEquipmentAsync(client), content);

        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(content)), upload.GetProperty("sha256").GetString());
        Assert.Equal("my export.csv", upload.GetProperty("original_name").GetString());
        var stored = Directory.GetFiles(factory.UploadDirectory).Select(Path.GetFileName).ToList();
        Assert.Contains($"{upload.GetProperty("id").GetGuid():N}.csv", stored);
        Assert.DoesNotContain("my export.csv", stored);
    }

    [DatabaseFact]
    public async Task Upload_ToUnknownEquipment_IsNotFound()
    {
        var resp = await factory.CreateClient().PostAsync(Url("/api/v1/uploads"),
            UploadValidationTests.Form("a\n1\n"u8.ToArray(), "x.csv", "lbnl_simulated", Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [DatabaseFact]
    public async Task Analysis_QueuesAJob_AndServesTheStoredResultWhenDone()
    {
        var client = factory.CreateClient();
        var equipmentId = await CreateEquipmentAsync(client);
        var upload = await UploadAsync(client, equipmentId, "a\n1\n"u8.ToArray());

        var created = await client.PostAsJsonAsync(Url("/api/v1/analyses"),
            new { upload_id = upload.GetProperty("id").GetGuid() }, Snake);
        Assert.Equal(HttpStatusCode.Accepted, created.StatusCode);
        var analysis = await created.Content.ReadFromJsonAsync<JsonElement>();
        var id = analysis.GetProperty("id").GetGuid();
        Assert.Equal("queued", analysis.GetProperty("status").GetString());
        Assert.Equal($"/api/v1/analyses/{id}", created.Headers.Location?.OriginalString);

        var early = await client.GetAsync(Url($"/api/v1/analyses/{id}/result"));
        Assert.Equal(HttpStatusCode.Conflict, early.StatusCode);

        // Play the worker's part: store a result and an event summary, as worker/db.py does.
        const string result = """{"schema_version": "1.0.0", "events": [{"id": "event-1"}]}""";
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FaultIqDbContext>();
            var row = await db.Analyses.SingleAsync(a => a.Id == id);
            Assert.NotNull(row.Traceparent); // the worker continues this request's trace
            row.Status = AnalysisStatus.Succeeded;
            row.Result = result;
            row.EventCount = 1;
            db.FaultEvents.Add(new FaultEvent
            {
                Id = Guid.NewGuid(),
                AnalysisId = id,
                EquipmentId = equipmentId,
                EventKey = "event-1",
                Kind = "fault",
                Fault = "condenser_fouling",
                StartsAt = DateTimeOffset.UtcNow.AddHours(-3),
                EndsAt = DateTimeOffset.UtcNow,
                Hours = 3,
                Confidence = 0.97,
                DetectorScore = 9.1,
            });
            await db.SaveChangesAsync();
        }

        var stored = await client.GetFromJsonAsync<JsonElement>(Url($"/api/v1/analyses/{id}/result"));
        Assert.Equal("1.0.0", stored.GetProperty("schema_version").GetString());
        var events = await client.GetFromJsonAsync<JsonElement>(
            Url($"/api/v1/fault-events?analysis_id={id}&fault=condenser_fouling"));
        Assert.Equal(1, events.GetProperty("total").GetInt32());
    }

    private async Task<(Guid Equipment, Guid Analysis, Guid Event)> SeedFaultAsync(HttpClient client, string name)
    {
        var equipmentId = await CreateEquipmentAsync(client, name);
        var upload = await UploadAsync(client, equipmentId, "a\n1\n"u8.ToArray());
        var created = await client.PostAsJsonAsync(Url("/api/v1/analyses"),
            new { upload_id = upload.GetProperty("id").GetGuid() }, Snake);
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var eventId = Guid.NewGuid();
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FaultIqDbContext>();
        var row = await db.Analyses.SingleAsync(a => a.Id == id);
        row.Status = AnalysisStatus.Succeeded;
        row.FinishedAt = DateTimeOffset.UtcNow;
        db.FaultEvents.Add(new FaultEvent
        {
            Id = eventId,
            AnalysisId = id,
            EquipmentId = equipmentId,
            EventKey = "event-1",
            Kind = "fault",
            Fault = "oa_damper_stuck",
            StartsAt = DateTimeOffset.UtcNow.AddHours(-5),
            EndsAt = DateTimeOffset.UtcNow,
            Hours = 5,
            Confidence = 0.99,
            DetectorScore = 15.0,
        });
        await db.SaveChangesAsync();
        return (equipmentId, id, eventId);
    }

    [DatabaseFact]
    public async Task Review_RecordsAnOutcome_AndRejectsUnknownStatuses()
    {
        var client = factory.CreateClient();
        var (_, _, eventId) = await SeedFaultAsync(client, "RTU-review");
        Assert.Equal("unreviewed", (await client.GetFromJsonAsync<JsonElement>(Url($"/api/v1/fault-events/{eventId}")))
            .GetProperty("review_status").GetString()); // the database default the worker relies on

        var bad = await client.PatchAsJsonAsync(Url($"/api/v1/fault-events/{eventId}/review"), new { status = "maybe" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);

        var ok = await client.PatchAsJsonAsync(Url($"/api/v1/fault-events/{eventId}/review"),
            new { status = "confirmed", note = "Actuator linkage found slipped on site." });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var reviewed = await ok.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("confirmed", reviewed.GetProperty("review_status").GetString());
        Assert.NotEqual(JsonValueKind.Null, reviewed.GetProperty("reviewed_at").ValueKind);

        var byHours = await client.GetFromJsonAsync<JsonElement>(Url("/api/v1/fault-events?order=hours&page_size=100"));
        var hours = byHours.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("hours").GetInt32()).ToList();
        Assert.Equal(hours.OrderByDescending(h => h), hours);

        var confirmed = await client.GetFromJsonAsync<JsonElement>(Url("/api/v1/fault-events?review_status=confirmed"));
        Assert.Contains(confirmed.GetProperty("items").EnumerateArray(), e => e.GetProperty("id").GetGuid() == eventId);
    }

    [DatabaseFact]
    public async Task Overview_DerivesEachUnitsStatus_AndSummaryCountsEvents()
    {
        var client = factory.CreateClient();
        var idle = await CreateEquipmentAsync(client, "RTU-idle");
        var (faulty, _, _) = await SeedFaultAsync(client, "RTU-faulty");

        var overview = await client.GetFromJsonAsync<JsonElement>(Url("/api/v1/equipment/overview?page_size=100"));
        var byId = overview.GetProperty("items").EnumerateArray().ToDictionary(x => x.GetProperty("id").GetGuid());
        Assert.Equal("no_data", byId[idle].GetProperty("status").GetString());
        Assert.Equal("fault", byId[faulty].GetProperty("status").GetString());
        Assert.Equal("oa_damper_stuck", byId[faulty].GetProperty("top_fault").GetString());

        var summary = await client.GetFromJsonAsync<JsonElement>(Url($"/api/v1/fault-events/summary?equipment_id={faulty}"));
        Assert.Equal(1, summary.GetProperty("events").GetInt32());
        Assert.Equal(5, summary.GetProperty("hours").GetInt32());

        // The 5-hour event is split across the calendar days it covers.
        var daily = await client.GetFromJsonAsync<JsonElement>(Url($"/api/v1/fault-events/daily?equipment_id={faulty}"));
        Assert.Equal(5, daily.EnumerateArray().Sum(d => d.GetProperty("hours").GetInt32()));
        Assert.All(daily.EnumerateArray(), d => Assert.Equal(1, d.GetProperty("units").GetInt32()));

        var sites = await client.GetFromJsonAsync<JsonElement>(Url("/api/v1/equipment/sites"));
        Assert.Contains(sites.EnumerateArray(), x => x.GetProperty("site").GetString() == "Test site");
    }

    private async Task<Guid> QueueAnalysisAsync(HttpClient client, string name)
    {
        var equipmentId = await CreateEquipmentAsync(client, name);
        var upload = await UploadAsync(client, equipmentId, "a\n1\n"u8.ToArray());
        var created = await client.PostAsJsonAsync(Url("/api/v1/analyses"),
            new { upload_id = upload.GetProperty("id").GetGuid() }, Snake);
        return (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
    }

    private async Task UpdateAnalysisAsync(Guid id, Action<Analysis> change)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FaultIqDbContext>();
        change(await db.Analyses.SingleAsync(a => a.Id == id));
        await db.SaveChangesAsync();
    }

    private static async Task<string?> Code(HttpResponseMessage resp) =>
        JsonDocument.Parse(await resp.Content.ReadAsStringAsync()).RootElement.GetProperty("code").GetString();

    [DatabaseFact]
    public async Task Report_IsServedForQuarantinedFiles_AndExplainsWhenThereIsNone()
    {
        var client = factory.CreateClient();
        var id = await QueueAnalysisAsync(client, "RTU-report");

        var early = await client.GetAsync(Url($"/api/v1/analyses/{id}/report"));
        Assert.Equal(HttpStatusCode.Conflict, early.StatusCode);
        Assert.Equal("result_not_ready", await Code(early));

        // A job that failed before validation (for example upload_missing) has no report.
        await UpdateAnalysisAsync(id, a => { a.Status = AnalysisStatus.Failed; a.ErrorCode = "upload_missing"; });
        var none = await client.GetAsync(Url($"/api/v1/analyses/{id}/report"));
        Assert.Equal(HttpStatusCode.NotFound, none.StatusCode);
        Assert.Equal("report_not_available", await Code(none));

        // Play the worker's part for a quarantined file: the report is kept with the failure.
        const string report = """{"version": 1, "status": "quarantined", "file": "my export.csv", "issues": [{"severity": "error", "code": "timestamps_out_of_order", "message": "Timestamps go backwards 1 times. Sort the export by time and upload it again."}]}""";
        await UpdateAnalysisAsync(id, a => { a.ErrorCode = "validation_failed"; a.ProcessingReport = report; });
        var served = await client.GetFromJsonAsync<JsonElement>(Url($"/api/v1/analyses/{id}/report"));
        Assert.Equal("quarantined", served.GetProperty("status").GetString());
        Assert.Equal("timestamps_out_of_order", served.GetProperty("issues")[0].GetProperty("code").GetString());

        var unknown = await client.GetAsync(Url($"/api/v1/analyses/{Guid.NewGuid()}/report"));
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal("not_found", await Code(unknown));
    }

    [DatabaseFact]
    public async Task Models_JoinTheRegistryWithVersionsRecordedOnAnalyses()
    {
        var client = factory.CreateClient();
        var finished = new DateTimeOffset(2026, 11, 20, 12, 0, 0, TimeSpan.Zero);
        const string version = "lbnl_simulated-all@diagnosis-0.1.0+abc123def456";
        foreach (var (name, hours) in new[] { ("RTU-m1", 0), ("RTU-m2", 5) })
        {
            var id = await QueueAnalysisAsync(client, name);
            await UpdateAnalysisAsync(id, a =>
            {
                a.Status = AnalysisStatus.Succeeded;
                a.ModelVersion = version;
                a.PipelineVersion = "0.2.0";
                a.FinishedAt = finished.AddHours(hours);
            });
        }

        var models = await client.GetFromJsonAsync<JsonElement>(Url("/api/v1/models"));
        Assert.Equal("0.1.0", models.GetProperty("diagnosis_version").GetString());
        var items = models.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(4, items.Count);
        var simAll = items.Single(m => m.GetProperty("format").GetString() == "lbnl_simulated"
                                       && m.GetProperty("point_set").GetString() == "all");
        Assert.Equal("lightgbm", simAll.GetProperty("adopted_model").GetString());
        Assert.InRange(simAll.GetProperty("held_out").GetProperty("test_macro_f1").GetDouble(), 0, 1);
        var used = simAll.GetProperty("versions").EnumerateArray().Single(v => v.GetProperty("model_version").GetString() == version);
        Assert.True(used.GetProperty("analyses").GetInt32() >= 2);
        Assert.Equal(["0.2.0"], used.GetProperty("pipeline_versions").EnumerateArray().Select(p => p.GetString()));
        Assert.Equal(finished.AddHours(5), used.GetProperty("last_used_at").GetDateTimeOffset());

        // Versions are matched by the upload's format and point set, never by parsing the string.
        var simBasic = items.Single(m => m.GetProperty("format").GetString() == "lbnl_simulated"
                                         && m.GetProperty("point_set").GetString() == "basic");
        Assert.DoesNotContain(simBasic.GetProperty("versions").EnumerateArray(),
            v => v.GetProperty("model_version").GetString() == version);
    }

    [DatabaseFact]
    public async Task Analysis_RejectsUnknownPointSet_AndUnknownUpload()
    {
        var client = factory.CreateClient();
        var bad = await client.PostAsJsonAsync(Url("/api/v1/analyses"),
            new { upload_id = Guid.NewGuid(), point_set = "everything" }, Snake);
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var missing = await client.PostAsJsonAsync(Url("/api/v1/analyses"), new { upload_id = Guid.NewGuid() }, Snake);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }
}
