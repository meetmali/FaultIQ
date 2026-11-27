using FaultIQ.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace FaultIQ.Api.Tests;

/// <summary>
/// The API under test. It runs in a "Testing" environment, so the developer's database settings
/// (appsettings.Development.json) never apply and nothing is migrated by accident. Database tests
/// get a connection from FAULTIQ_TEST_DB and are skipped when it isn't set.
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>
{
    public static readonly string? TestDatabase = Environment.GetEnvironmentVariable("FAULTIQ_TEST_DB");

    public string UploadDirectory { get; } =
        Path.Combine(Path.GetTempPath(), "faultiq-tests", Guid.NewGuid().ToString("N"));

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("Database:MigrateOnStartup", "false");
        builder.UseSetting("ConnectionStrings:FaultIQ", TestDatabase ?? "");
        builder.UseSetting("Uploads:Directory", UploadDirectory);
        builder.UseSetting("RateLimiting:PermitPerMinute", "0");
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (Directory.Exists(UploadDirectory))
        {
            Directory.Delete(UploadDirectory, recursive: true);
        }
    }
}

/// <summary>A fresh, migrated test database shared by the tests in one class.</summary>
public sealed class DatabaseFactory : ApiFactory, IAsyncLifetime
{
    public async Task InitializeAsync()
    {
        if (TestDatabase is null)
        {
            return;
        }

        await using var scope = Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FaultIqDbContext>();
        await db.Database.EnsureDeletedAsync();
        await db.Database.MigrateAsync();
    }

    Task IAsyncLifetime.DisposeAsync() => Task.CompletedTask;
}

/// <summary>A test that needs PostgreSQL. Skipped, with a reason, when FAULTIQ_TEST_DB isn't set.</summary>
public sealed class DatabaseFactAttribute : FactAttribute
{
    public DatabaseFactAttribute()
    {
        if (ApiFactory.TestDatabase is null)
        {
            Skip = "Set FAULTIQ_TEST_DB to a PostgreSQL connection string to run database tests.";
        }
    }
}

/// <summary>
/// Test classes that recreate the shared test database run one after another, never in parallel,
/// because each one drops and migrates the same database.
/// </summary>
[CollectionDefinition(Name)]
public sealed class DatabaseCollection
{
    public const string Name = "PostgreSQL";
}
