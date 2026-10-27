using Microsoft.EntityFrameworkCore;
using Spa.Api.Appointments;
using Spa.Api.Auth;
using Spa.Api.Customers;
using Spa.Api.Data;
using Spa.Api.Tenancy;

var builder = WebApplication.CreateBuilder(args);

// Connects as app_user (no BYPASSRLS); every tenant table has FORCE ROW LEVEL SECURITY
builder.Services.AddDbContext<SpaDb>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("App")));
builder.Services.AddSingleton<TokenService>();
builder.Services.AddAuthentication().AddJwtBearer(o => o.TokenValidationParameters = TokenService.Validation(builder.Configuration));
builder.Services.AddAuthorization();

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();

app.MapAuth();
var tenant = app.MapGroup("/v1/t/{tenantId:guid}")
    .RequireAuthorization()
    .AddEndpointFilter<TenantTransactionFilter>();
tenant.MapCustomers();
tenant.MapAppointments();

app.Run();

public partial class Program;
