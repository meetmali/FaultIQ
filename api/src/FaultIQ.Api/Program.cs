using System.Text.Json;
using System.Text.Json.Serialization;
using FaultIQ.Api.Features;
using FaultIQ.Api.Health;
using FaultIQ.Api.Hosting;
using Microsoft.AspNetCore.Http.Features;

var builder = WebApplication.CreateBuilder(args);

// Structured JSON logs. Never log secrets or raw sensor data (project plan, section 13).
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole(o =>
{
    o.UseUtcTimestamp = true;
    o.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ";
});

// snake_case JSON so the API matches the Python pipeline and the frontend (ADR 0007).
// Numbers must be JSON numbers (no "42" strings), which keeps the OpenAPI contract exact.
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
    o.SerializerOptions.NumberHandling = JsonNumberHandling.Strict;
});

// RFC 9457 Problem Details for every error, with a stable "code" field. No stack traces.
builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx =>
{
    var status = ctx.ProblemDetails.Status ?? StatusCodes.Status500InternalServerError;
    ctx.ProblemDetails.Extensions.TryAdd(
        "code", status >= 500 ? "internal_error" : $"http_{status}");
    ctx.ProblemDetails.Detail = status >= 500 ? "An unexpected error occurred." : ctx.ProblemDetails.Detail;
});

var corsOrigins = (builder.Configuration["Cors:Origins"] ?? string.Empty)
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(corsOrigins)
    .WithMethods("GET", "POST", "PATCH", "DELETE")
    .AllowAnyHeader()));

builder.Services.AddFaultIqHosting(builder.Configuration);
builder.Services.AddFaultIqPersistence(builder.Configuration);
builder.Services.AddFaultIqTelemetry(builder.Configuration);
builder.Services.AddSingleton<FaultLibraryStore>();
builder.Services.AddSingleton<ModelRegistryStore>();

// Uploads may be up to Uploads:MaxSizeMb; allow 1 MB on top for the multipart envelope.
var maxUpload = (builder.Configuration.GetValue<int?>("Uploads:MaxSizeMb") ?? 100) * 1024L * 1024L;
builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = maxUpload + 1024 * 1024);
builder.Services.Configure<FormOptions>(o => o.MultipartBodyLengthLimit = maxUpload + 1024 * 1024);
builder.Services.AddOpenApi("v1");
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<IDatabaseProbe, NpgsqlDatabaseProbe>();

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseFaultIqHosting();
app.UseCors();

app.MapOpenApi("/api/{documentName}/openapi.json");

var v1 = app.MapGroup("/api/v1");
v1.MapHealthEndpoints();
v1.MapEquipmentEndpoints();
v1.MapUploadEndpoints();
v1.MapAnalysisEndpoints();
v1.MapFaultEventEndpoints();
v1.MapFaultLibraryEndpoints();
v1.MapEquipmentTypeEndpoints();
v1.MapModelEndpoints();
v1.MapWorkOrderEndpoints();

await app.MigrateIfConfiguredAsync();

await app.RunAsync();

// Exposed for WebApplicationFactory in integration tests.
public partial class Program;
