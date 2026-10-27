namespace Spa.Api.Data;

// SQL files embedded in the assembly (Spa.Api.csproj), read by the hand-written migrations
public static class SqlScripts
{
    public static string Read(string name)
    {
        using var stream = typeof(SqlScripts).Assembly.GetManifestResourceStream($"sql/{name}")
            ?? throw new InvalidOperationException($"missing embedded sql/{name}");
        return new StreamReader(stream).ReadToEnd();
    }
}
