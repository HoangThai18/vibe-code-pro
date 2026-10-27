using System.Net.Http.Json;
using Npgsql;

namespace Spa.Api.Tests.Support;

public sealed record TestTenant(Guid Id, Guid Owner, Guid Manager, Guid Staff, Guid Staff2);

public static class Seed
{
    // Like sign-up (createTenant, postgres-rls.md section 4): as app_user, inside the new tenant's transaction
    public static async Task<TestTenant> TenantAsync(string name = "Spa", string status = "active")
    {
        var t = new TestTenant(Guid.CreateVersion7(), Guid.CreateVersion7(), Guid.CreateVersion7(), Guid.CreateVersion7(), Guid.CreateVersion7());
        await using var conn = new NpgsqlConnection(Db.AppCs);
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        async Task Exec(string sql, params object[] args)
        {
            await using var cmd = new NpgsqlCommand(sql, conn, tx);
            foreach (var a in args) cmd.Parameters.Add(new NpgsqlParameter { Value = a });
            await cmd.ExecuteNonQueryAsync();
        }
        await Exec("SELECT set_config('app.tenant_id', $1, true)", t.Id.ToString());
        await Exec("INSERT INTO tenants (id, name, status) VALUES ($1, $2, $3)", t.Id, name, status);
        foreach (var (user, role) in new[] { (t.Owner, "owner"), (t.Manager, "manager"), (t.Staff, "staff"), (t.Staff2, "staff") })
        {
            await Exec("INSERT INTO users (id, email) VALUES ($1, $2)", user, $"{user}@test.vn");
            await Exec("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)", t.Id, user, role);
        }
        await tx.CommitAsync();
        return t;
    }

    public static string NewPhone() => "09" + Random.Shared.NextInt64(10_000_000, 99_999_999);

    public static async Task<Guid> CustomerAsync(this SpaFactory f, TestTenant t, string fullName = "Nguyễn Thị Thảo", string? phone = null)
    {
        var res = await f.As(t.Owner).PostAsJsonAsync($"/v1/t/{t.Id}/customers", new { fullName, phone = phone ?? NewPhone() });
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<Envelope<IdOnly>>())!.Data.Id;
    }
}

public sealed record Envelope<T>(T Data);
public sealed record IdOnly(Guid Id);
public sealed record ErrorBody(ErrorDetail Error);
public sealed record ErrorDetail(string Code, string Message);
