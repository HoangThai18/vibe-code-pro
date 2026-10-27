using Npgsql;

namespace Spa.Api.Http;

// Rendered as { "error": { "code", "message" } } (api-conventions.md section 2)
public sealed class ApiException(int status, string code, string message) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;

    public IResult ToResult() => Results.Json(new { error = new { code = Code, message = Message } }, statusCode: Status);

    public static ApiException NotFound() => new(404, "not_found", "Không tìm thấy.");
    public static ApiException Forbidden(string action) => new(403, "forbidden", $"forbidden: {action}");
    public static ApiException Invalid(string message) => new(400, "validation_failed", message);
}

public static class PgErrors
{
    // SaveChanges wraps the driver's error in DbUpdateException; ExecuteUpdate/ExecuteDelete and raw SQL throw it as is
    public static string? SqlState(this Exception e) => (e as PostgresException ?? e.InnerException as PostgresException)?.SqlState;
}
