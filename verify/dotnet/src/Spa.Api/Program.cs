// Spa.Api/Program.cs
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Spa.Api.Appointments;
using Spa.Api.Customers;
using Spa.Api.Data;
using Spa.Api.Jobs;
using Spa.Api.Tenancy;

var builder = WebApplication.CreateBuilder(args);

// Connects as app_user (NOSUPERUSER NOBYPASSRLS, not the table owner)
builder.Services.AddDbContext<SpaDb>(o => o
    .UseNpgsql(builder.Configuration.GetConnectionString("App"))
    .UseSnakeCaseNamingConvention());
builder.Services.AddScoped<RequestTenant>();
builder.Services.AddAuthentication();   // the project's scheme (cookie or JWT, auth.md); tests add a header scheme
builder.Services.AddAuthorization();
builder.Services.AddSingleton<IAuthorizationHandler, PermissionHandler>();
// Worker instances: Reminders:Enabled=true, plus the SMS provider's ISmsSender (notifications.md)
if (builder.Configuration.GetValue<bool>("Reminders:Enabled"))
    builder.Services.AddSingleton<ReminderJob>().AddHostedService<ReminderService>();

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();

var tenant = app.MapGroup("/v1/t/{tenantId:guid}")
    .RequireAuthorization()                // signed in, or 401
    .AddEndpointFilter<TenantFilter>();    // member (404), permission (403), one transaction
tenant.MapCustomers();
tenant.MapAppointments();

app.Run();
