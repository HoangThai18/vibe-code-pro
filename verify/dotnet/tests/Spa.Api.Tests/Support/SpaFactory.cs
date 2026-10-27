using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Spa.Api.Data;
using Spa.Api.Jobs;

namespace Spa.Api.Tests.Support;

// The real Program on Db.AppCs (app_user, RLS applies), a header login, a fake SMS provider
public class SpaFactory : WebApplicationFactory<Program>
{
    public FakeSms Sms { get; } = new();
    public CommandCounter Commands { get; } = new();
    public BookingBarrier Barrier { get; } = new();
    protected virtual bool RemindersEnabled => false;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:App", Db.AppCs);
        builder.UseSetting("Logging:LogLevel:Default", "Warning");
        builder.UseSetting("Reminders:Enabled", RemindersEnabled.ToString());
        builder.UseSetting("Reminders:IntervalSeconds", "0.2");
        builder.ConfigureTestServices(s =>
        {
            s.AddAuthentication(TestAuth.SchemeName).AddScheme<AuthenticationSchemeOptions, TestAuth>(TestAuth.SchemeName, null);
            s.AddSingleton<ISmsSender>(Sms);
            s.ConfigureDbContext<SpaDb>(o => o.AddInterceptors(Commands, Barrier));
        });
    }

    public HttpClient As(Guid userId)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Add(TestAuth.Header, userId.ToString());
        return client;
    }

    public ReminderJob NewReminderJob(ISmsSender? sms = null) =>
        new(Services.GetRequiredService<IServiceScopeFactory>(), sms ?? Sms, Services.GetRequiredService<ILogger<ReminderJob>>());
}
