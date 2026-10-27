using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Spa.Api.Data;

namespace Spa.Api.Migrations;

// Hand-written, before Initial: the tables' DEFAULT app_current_tenant() needs the function
[DbContext(typeof(SpaDb))]
[Migration("20261027000000_CurrentTenant")]
public sealed class CurrentTenant : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) =>
        migrationBuilder.Sql(SqlScripts.Read("current-tenant.sql"));
}
