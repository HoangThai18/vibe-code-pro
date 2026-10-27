using Microsoft.EntityFrameworkCore;
using Spa.Api.Customers;
using Spa.Api.Data;
using Spa.Api.Reports;
using Spa.Api.Tenancy;
using Spa.Api.Webhooks;

var builder = WebApplication.CreateBuilder(args);

// Pooling for performance: contexts are reused across requests
builder.Services.AddDbContextPool<AppDbContext>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
builder.Services.AddAuthentication().AddJwtBearer();
builder.Services.AddAuthorization();

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<TenantMiddleware>();

app.MapCustomerEndpoints();
app.MapRevenueEndpoints();
app.MapZaloWebhook();

app.Run();
