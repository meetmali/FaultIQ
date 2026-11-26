using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace FaultIQ.Api.Data;

public sealed class FaultIqDbContext(DbContextOptions<FaultIqDbContext> options) : DbContext(options)
{
    public DbSet<Equipment> Equipment => Set<Equipment>();
    public DbSet<Upload> Uploads => Set<Upload>();
    public DbSet<Analysis> Analyses => Set<Analysis>();
    public DbSet<FaultEvent> FaultEvents => Set<FaultEvent>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Equipment>(e =>
        {
            e.ToTable("equipment");
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Site).HasMaxLength(200);
            e.HasIndex(x => x.Site);
        });

        b.Entity<Upload>(e =>
        {
            e.Property(x => x.OriginalName).HasMaxLength(255);
            e.Property(x => x.StoredName).HasMaxLength(100);
            e.Property(x => x.Format).HasMaxLength(50);
            e.Property(x => x.Sha256).HasMaxLength(64).IsFixedLength();
            e.HasIndex(x => x.StoredName).IsUnique();
            e.HasIndex(x => x.Sha256);
            e.HasOne(x => x.Equipment).WithMany().HasForeignKey(x => x.EquipmentId)
                .OnDelete(DeleteBehavior.Restrict);
            e.ToTable("uploads", t =>
            {
                t.HasCheckConstraint("ck_uploads_format", Sql.In("format", Formats.All));
                t.HasCheckConstraint("ck_uploads_size_bytes", "size_bytes > 0");
            });
        });

        b.Entity<Analysis>(e =>
        {
            e.Property(x => x.PointSet).HasMaxLength(20);
            e.Property(x => x.Status).HasMaxLength(20);
            e.Property(x => x.WorkerId).HasMaxLength(200);
            e.Property(x => x.Traceparent).HasMaxLength(55);
            e.Property(x => x.ErrorCode).HasMaxLength(100);
            e.Property(x => x.ErrorMessage).HasMaxLength(1000);
            e.Property(x => x.PipelineVersion).HasMaxLength(50);
            e.Property(x => x.ModelVersion).HasMaxLength(200);
            e.Property(x => x.Result).HasColumnType("jsonb");
            e.Property(x => x.ChartSeries).HasColumnType("jsonb");
            e.Property(x => x.ProcessingReport).HasColumnType("jsonb");
            e.HasOne(x => x.Upload).WithMany().HasForeignKey(x => x.UploadId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Equipment>().WithMany().HasForeignKey(x => x.EquipmentId)
                .OnDelete(DeleteBehavior.Restrict);
            // The worker claims the oldest queued job; this index serves that query.
            e.HasIndex(x => new { x.Status, x.CreatedAt });
            e.HasIndex(x => new { x.EquipmentId, x.CreatedAt });
            e.ToTable("analyses", t =>
            {
                t.HasCheckConstraint("ck_analyses_status", Sql.In("status", AnalysisStatus.All));
                t.HasCheckConstraint("ck_analyses_point_set", Sql.In("point_set", PointSets.All));
                t.HasCheckConstraint("ck_analyses_attempts", "attempts >= 0");
            });
        });

        b.Entity<FaultEvent>(e =>
        {
            e.Property(x => x.EventKey).HasMaxLength(50);
            e.Property(x => x.Kind).HasMaxLength(30);
            e.Property(x => x.Fault).HasMaxLength(100);
            // The worker inserts events without review fields, so the database supplies the default.
            e.Property(x => x.ReviewStatus).HasMaxLength(20).HasDefaultValue(ReviewStatuses.Unreviewed);
            e.Property(x => x.ReviewNote).HasMaxLength(1000);
            e.HasOne<Analysis>().WithMany().HasForeignKey(x => x.AnalysisId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Equipment>().WithMany().HasForeignKey(x => x.EquipmentId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => new { x.AnalysisId, x.EventKey }).IsUnique();
            e.HasIndex(x => new { x.EquipmentId, x.StartsAt });
            e.HasIndex(x => new { x.Fault, x.StartsAt });
            e.ToTable("fault_events", t =>
            {
                t.HasCheckConstraint("ck_fault_events_kind", Sql.In("kind", EventKinds.All));
                t.HasCheckConstraint("ck_fault_events_span", "ends_at > starts_at");
                t.HasCheckConstraint("ck_fault_events_hours", "hours > 0");
                t.HasCheckConstraint("ck_fault_events_review_status", Sql.In("review_status", ReviewStatuses.All));
            });
        });
    }

    private static class Sql
    {
        public static string In(string column, IEnumerable<string> values) =>
            $"{column} IN ({string.Join(", ", values.Select(v => $"'{v}'"))})";
    }
}

/// <summary>Lets `dotnet ef` build migrations without a running database or app configuration.</summary>
public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<FaultIqDbContext>
{
    public FaultIqDbContext CreateDbContext(string[] args) => new(
        new DbContextOptionsBuilder<FaultIqDbContext>()
            .UseNpgsql("Host=localhost;Database=faultiq_design")
            .UseSnakeCaseNamingConvention()
            .Options);
}
