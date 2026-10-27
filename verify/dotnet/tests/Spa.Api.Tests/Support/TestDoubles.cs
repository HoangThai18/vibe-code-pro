using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Data.Common;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Spa.Api.Jobs;

namespace Spa.Api.Tests.Support;

// Signs in whoever the X-User-Id header names; the real app uses its own scheme (auth.md)
public sealed class TestAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Test", Header = "X-User-Id";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync() =>
        Task.FromResult(Request.Headers.TryGetValue(Header, out var id)
            ? AuthenticateResult.Success(new AuthenticationTicket(
                new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, id.ToString())], SchemeName)), SchemeName))
            : AuthenticateResult.NoResult());
}

public sealed record Sent(string Phone, string Text, Guid Key);

public sealed class FakeSms : ISmsSender
{
    public ConcurrentQueue<Sent> Messages { get; } = new();
    public TimeSpan Delay { get; set; }
    public int FailNext;   // fail this many calls first

    public async Task SendAsync(string phone, string text, Guid idempotencyKey, CancellationToken ct)
    {
        await Task.Delay(Delay, ct);
        if (Interlocked.Decrement(ref FailNext) >= 0) throw new HttpRequestException("provider down");
        Messages.Enqueue(new Sent(phone, text, idempotencyKey));
    }
}

// Counts the SQL commands the app sends (N+1 checks)
public sealed class CommandCounter : DbCommandInterceptor
{
    int _count;
    public int Count => _count;
    public void Reset() => Interlocked.Exchange(ref _count, 0);

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData,
        InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref _count);
        return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
    }

    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData,
        InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref _count);
        return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
    }
}

// Stress tests: holds every booking request just before its first locking statement until all of them got there,
// and counts deadlocks (40P01) the app's commands hit, whatever the HTTP layer mapped them to
public sealed class BookingBarrier : DbCommandInterceptor
{
    int _deadlocks;
    public int Deadlocks => _deadlocks;

    public override Task CommandFailedAsync(DbCommand command, CommandErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        if (eventData.Exception is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.DeadlockDetected })
            Interlocked.Increment(ref _deadlocks);
        return base.CommandFailedAsync(command, eventData, cancellationToken);
    }

    readonly ConditionalWeakTable<object, object> _passed = new();
    TaskCompletionSource? _gate;
    int _parties, _arrived;

    public void Arm(int parties)
    {
        (_parties, _arrived) = (parties, 0);
        _gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    public void Disarm() => _gate = null;

    async Task WaitAsync(DbCommand command, CommandEventData data, CancellationToken ct)
    {
        var gate = _gate;
        if (gate is null || data.Context is null) return;
        var sql = command.CommandText;
        if (!sql.Contains("pg_advisory_xact_lock") && !sql.StartsWith("INSERT INTO appointments")) return;
        if (!_passed.TryAdd(data.Context, new object())) return;   // once per request
        if (Interlocked.Increment(ref _arrived) == _parties) gate.TrySetResult();
        try { await gate.Task.WaitAsync(TimeSpan.FromSeconds(5), ct); }
        catch (TimeoutException) { }
    }

    public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData,
        InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
    {
        await WaitAsync(command, eventData, cancellationToken);
        return result;
    }

    public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData,
        InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        await WaitAsync(command, eventData, cancellationToken);
        return result;
    }
}
