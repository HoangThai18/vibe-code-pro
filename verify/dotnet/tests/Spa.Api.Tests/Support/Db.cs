using Npgsql;

[assembly: Xunit.v3.Parallelization(Mode = Xunit.Sdk.ParallelMode.None)]   // one database; the job scans every tenant

namespace Spa.Api.Tests.Support;

public static class Db
{
    // DATABASE_URL (verify/tools/run.sh) is a superuser. The app's password differs between machines, so the tests log in
    // as the superuser and switch role at connect time: privileges and RLS are app_user's (Npgsql's reset keeps the role).
    public static readonly string AdminCs = FromUrl(Environment.GetEnvironmentVariable("DATABASE_URL")
        ?? throw new InvalidOperationException("DATABASE_URL is required: verify/tools/run.sh dotnet"));
    public static readonly string AppCs = AdminCs + ";Options=-c role=app_user";

    static string FromUrl(string url)
    {
        var u = new Uri(url);
        var userInfo = u.UserInfo.Split(':', 2);
        return new NpgsqlConnectionStringBuilder
        {
            Host = u.Host, Port = u.Port > 0 ? u.Port : 5432, Database = u.AbsolutePath.TrimStart('/'),
            Username = Uri.UnescapeDataString(userInfo[0]),
            Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : null,
        }.ConnectionString;
    }

    public static async Task<T> ScalarAsync<T>(string cs, string sql, params object[] args)
    {
        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, conn);
        foreach (var a in args) cmd.Parameters.Add(new NpgsqlParameter { Value = a });
        return (T)(await cmd.ExecuteScalarAsync())!;
    }
}
