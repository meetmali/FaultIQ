using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace FaultIQ.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddWorkOrders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "work_orders",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    equipment_id = table.Column<Guid>(type: "uuid", nullable: false),
                    fault = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    priority = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    suggested_priority = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    priority_reason = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    assignee = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    checks = table.Column<string>(type: "jsonb", nullable: false),
                    library_version = table.Column<int>(type: "integer", nullable: false),
                    library_review_status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    outcome = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    confirmed_fault = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    findings = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    repair_time = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    cancel_reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    cancelled_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_work_orders", x => x.id);
                    table.CheckConstraint("ck_work_orders_cancelled", "status <> 'cancelled' OR (cancel_reason IS NOT NULL AND cancelled_at IS NOT NULL)");
                    table.CheckConstraint("ck_work_orders_completed", "status <> 'completed' OR (outcome IS NOT NULL AND findings IS NOT NULL AND completed_at IS NOT NULL)");
                    table.CheckConstraint("ck_work_orders_outcome", "outcome IS NULL OR outcome IN ('confirmed', 'different_fault', 'no_fault_found')");
                    table.CheckConstraint("ck_work_orders_priority", "priority IN ('urgent', 'high', 'medium', 'low')");
                    table.CheckConstraint("ck_work_orders_status", "status IN ('open', 'in_progress', 'completed', 'cancelled')");
                    table.CheckConstraint("ck_work_orders_suggested_priority", "suggested_priority IN ('urgent', 'high', 'medium', 'low')");
                    table.ForeignKey(
                        name: "fk_work_orders_equipment_equipment_id",
                        column: x => x.equipment_id,
                        principalTable: "equipment",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "work_order_events",
                columns: table => new
                {
                    work_order_id = table.Column<Guid>(type: "uuid", nullable: false),
                    fault_event_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_work_order_events", x => new { x.work_order_id, x.fault_event_id });
                    table.ForeignKey(
                        name: "fk_work_order_events_fault_events_fault_event_id",
                        column: x => x.fault_event_id,
                        principalTable: "fault_events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_work_order_events_work_orders_work_order_id",
                        column: x => x.work_order_id,
                        principalTable: "work_orders",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "work_order_log",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    sequence = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    work_order_id = table.Column<Guid>(type: "uuid", nullable: false),
                    at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    action = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    from_status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    to_status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    note = table.Column<string>(type: "character varying(2500)", maxLength: 2500, nullable: true),
                    recorded_by = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_work_order_log", x => x.id);
                    table.ForeignKey(
                        name: "fk_work_order_log_work_orders_work_order_id",
                        column: x => x.work_order_id,
                        principalTable: "work_orders",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_work_order_events_fault_event_id",
                table: "work_order_events",
                column: "fault_event_id");

            migrationBuilder.CreateIndex(
                name: "ix_work_order_log_work_order_id_sequence",
                table: "work_order_log",
                columns: new[] { "work_order_id", "sequence" });

            migrationBuilder.CreateIndex(
                name: "ix_work_orders_equipment_id_created_at",
                table: "work_orders",
                columns: new[] { "equipment_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_work_orders_number",
                table: "work_orders",
                column: "number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_work_orders_status_created_at",
                table: "work_orders",
                columns: new[] { "status", "created_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "work_order_events");

            migrationBuilder.DropTable(
                name: "work_order_log");

            migrationBuilder.DropTable(
                name: "work_orders");
        }
    }
}
