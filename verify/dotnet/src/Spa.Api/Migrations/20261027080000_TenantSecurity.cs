// Spa.Api/Migrations/20261027080000_TenantSecurity.cs
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Spa.Api.Data;

namespace Spa.Api.Migrations;

// Hand-written, right after the tables: what EF Core can't model. Same migration, so no table exists without RLS.
[DbContext(typeof(SpaDb))]
[Migration("20261027080000_TenantSecurity")]
public sealed class TenantSecurity : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql(SqlScripts.Read("tenant-isolation.sql"));   // customers, appointments (postgres-rls.md section 2)
        migrationBuilder.Sql(SqlScripts.Read("login.sql"));              // memberships, tenants (section 3)
        migrationBuilder.Sql(SqlScripts.Read("notifications-rls.sql"));
        migrationBuilder.Sql(SqlScripts.Read("no-overlap.sql"));         // EXCLUDE USING gist (data-layer.md section 6)
    }
}
