using System.Collections.Concurrent;
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
