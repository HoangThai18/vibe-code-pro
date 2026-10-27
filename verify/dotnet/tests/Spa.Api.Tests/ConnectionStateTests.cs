using Microsoft.EntityFrameworkCore;
using Npgsql;
using Spa.Api.Data;
using Spa.Api.Tenancy;
using Spa.Api.Tests.Support;

namespace Spa.Api.Tests;

// Where tenant context lives: the transaction, the session, the pooled connection
public sealed class ConnectionStateTests(SpaFactory app) : IClassFixture<SpaFactory>
{
    static SpaDb AppDb(string? cs = null) =>
        new(new DbContextOptionsBuilder<SpaDb>().UseNpgsql(cs ?? Db.AppCs).UseSnakeCaseNamingConvention().Options);

    [Fact]
    public async Task Set_config_local_outside_a_transaction_lasts_one_statement()
    {
        var t = await Seed.TenantAsync();
        await app.CustomerAsync(t);
        await using var db = AppDb();

        // No transaction: EF Core runs each statement on its own (and returns the connection to the pool after it)
        await db.Database.ExecuteSqlAsync($"SELECT set_config('app.tenant_id', {t.Id.ToString()}, true)");
        Assert.Equal(0, await db.Customers.CountAsync());

        await using var tx = await db.BeginTenantAsync(t.Id, default);   // control
        Assert.Equal(1, await db.Customers.CountAsync());
    }

    [Fact]
    public async Task A_session_setting_is_cleared_when_Npgsql_takes_the_connection_back_unless_No_Reset_On_Close()
    {
        var t = await Seed.TenantAsync();
        await app.CustomerAsync(t);

        async Task<(int Pid, string Tenant, long Rows)> NextRequest(string cs)
        {
            await using var conn = new NpgsqlConnection(cs);
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand(
                "SELECT pg_backend_pid(), current_setting('app.tenant_id', true), (SELECT count(*) FROM customers)", conn);
            await using var r = await cmd.ExecuteReaderAsync();
            await r.ReadAsync();
            return (r.GetInt32(0), r.GetString(1), r.GetInt64(2));
        }

        foreach (var (noReset, leaks) in new[] { (false, false), (true, true) })
        {
            // One physical connection per pool, so the "next request" gets the same backend
            var cs = $"{Db.AppCs};Maximum Pool Size=1;No Reset On Close={noReset};Application Name=reset-{noReset}";
            int pid;
            await using (var conn = new NpgsqlConnection(cs))
            {
                await conn.OpenAsync();
                await using var set = new NpgsqlCommand("SELECT set_config('app.tenant_id', $1, false), pg_backend_pid()", conn);
                set.Parameters.Add(new NpgsqlParameter { Value = t.Id.ToString() });   // session-level, like SET app.tenant_id
                await using var r = await set.ExecuteReaderAsync();
                await r.ReadAsync();
                pid = r.GetInt32(1);
            }
            var next = await NextRequest(cs);
            Assert.Equal(pid, next.Pid);
            Assert.Equal(leaks ? t.Id.ToString() : "", next.Tenant);
            Assert.Equal(leaks ? 1 : 0, next.Rows);   // the next request sees the previous tenant's rows
        }
    }

    [Fact]
    public async Task A_session_advisory_lock_stays_held_while_its_connection_idles_in_the_pool()
    {
        var key = Random.Shared.NextInt64();
        var pooled = $"{Db.AdminCs};Maximum Pool Size=1;Application Name=lock-test";
        async Task<bool> OtherInstanceGets()
        {
            await using var conn = new NpgsqlConnection($"{Db.AdminCs};Pooling=false");
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand("SELECT pg_try_advisory_lock($1)", conn) { Parameters = { new() { Value = key } } };
            return (bool)(await cmd.ExecuteScalarAsync())!;   // closing a non-pooled connection releases it
        }

        await using (var conn = new NpgsqlConnection(pooled))
        {
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand("SELECT pg_advisory_lock($1)", conn) { Parameters = { new() { Value = key } } };
            await cmd.ExecuteNonQueryAsync();
        }   // closed without pg_advisory_unlock: back in the pool
        Assert.False(await OtherInstanceGets());   // the reset is sent lazily, with the next command on that connection

        await using (var conn = new NpgsqlConnection(pooled))
        {
            await conn.OpenAsync();
            await new NpgsqlCommand("SELECT 1", conn).ExecuteScalarAsync();
        }
        Assert.True(await OtherInstanceGets());
    }

    [Fact]
    public async Task The_app_connection_is_app_user_without_bypass_even_after_reuse()
    {
        for (var i = 0; i < 3; i++)
        {
            Assert.Equal("app_user", await Db.ScalarAsync<string>(Db.AppCs, "SELECT current_user::text"));
            Assert.False(await Db.ScalarAsync<bool>(Db.AppCs, "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user"));
        }
    }

    [Fact]
    public async Task The_retrying_execution_strategy_refuses_the_request_transaction()
    {
        await using var db = new SpaDb(new DbContextOptionsBuilder<SpaDb>()
            .UseNpgsql(Db.AppCs, o => o.EnableRetryOnFailure()).UseSnakeCaseNamingConvention().Options);
        await using var tx = await db.BeginTenantAsync(Guid.NewGuid(), default);   // BeginTransaction and ExecuteSql pass
        var e = await Assert.ThrowsAsync<InvalidOperationException>(() => db.Customers.CountAsync());
        Assert.Contains("does not support user-initiated transactions", e.Message);
    }
}
