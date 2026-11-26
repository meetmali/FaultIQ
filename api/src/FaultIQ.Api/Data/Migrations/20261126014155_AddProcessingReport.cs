using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FaultIQ.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddProcessingReport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "processing_report",
                table: "analyses",
                type: "jsonb",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "processing_report",
                table: "analyses");
        }
    }
}
