using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Spa.Api.Data;
using Spa.Api.Http;
using Spa.Api.Tenancy;
using Spa.Api.Tests.Support;

namespace Spa.Api.Tests;

// The usual EF Core pattern: a global query filter reading a tenant field that middleware sets per request
public sealed class FilteredDb(DbContextOptions<FilteredDb> options) : SpaDb(options)
{
    public Guid TenantId { get; set; }

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);
        b.Entity<Customer>().HasQueryFilter("tenant", c => c.TenantId == TenantId);   // named filters: EF Core 10
    }
}

// The same filter written with a local copy: the model is built once per context type and cached
public sealed class BakedDb(DbContextOptions<BakedDb> options) : SpaDb(options)
{
    public Guid TenantId { get; set; }

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);
        var tenantId = TenantId;
        b.Entity<Customer>().HasQueryFilter(c => c.TenantId == tenantId);
    }
}

public sealed class QueryFilterTests(SpaFactory app) : IClassFixture<SpaFactory>
{
    static T Ctx<T>(string cs, Func<DbContextOptions<T>, T> create) where T : DbContext =>
        create(new DbContextOptionsBuilder<T>().UseNpgsql(cs).UseSnakeCaseNamingConvention().Options);

    static FilteredDb Filtered(string cs, Guid tenantId)
    {
        var db = Ctx<FilteredDb>(cs, o => new FilteredDb(o));
        db.TenantId = tenantId;
        return db;
    }

    async Task<(TestTenant A, TestTenant B, Guid ACustomer, Guid BCustomer)> TwoTenants()
    {
        var (a, b) = (await Seed.TenantAsync("A"), await Seed.TenantAsync("B"));
        return (a, b, await app.CustomerAsync(a), await app.CustomerAsync(b));
    }

    // Db.AdminCs bypasses RLS: what a query filter alone gives (MySQL, SQL Server without a security policy, a BYPASSRLS role)
    [Fact]
    public async Task Without_RLS_these_skip_the_query_filter()
    {
        var (a, b, aCustomer, bCustomer) = await TwoTenants();
        await using var db = Filtered(Db.AdminCs, a.Id);
        var mine = db.Customers.Where(c => c.Id == aCustomer || c.Id == bCustomer);

        Assert.Equal([aCustomer], await mine.Select(c => c.Id).ToListAsync());                          // control: filtered
        Assert.Equal(2, await mine.IgnoreQueryFilters().CountAsync());                                   // skips (all filters)
        Assert.Equal(1, await mine.IgnoreQueryFilters(["soft_delete"]).CountAsync());                    // only the named ones
        Assert.Equal([aCustomer], await db.Customers.FromSql($"SELECT * FROM customers")
            .Where(c => c.Id == aCustomer || c.Id == bCustomer).Select(c => c.Id).ToListAsync());      // FromSql: filter applied on top
        Assert.Contains(bCustomer, await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM customers").ToListAsync());   // skips
        Assert.Equal(0, await db.Customers.Where(c => c.Id == bCustomer)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.FullName, "hack")));                         // filter applied
        Assert.Equal(0, await db.Customers.Where(c => c.Id == bCustomer).ExecuteDeleteAsync());          // filter applied

        // SaveChanges writes rows by key, no filter: a tenant id taken from the request body lands in B
        db.Customers.Add(new Customer { TenantId = b.Id, Id = Guid.CreateVersion7(), FullName = "Lậu", Phone = Seed.NewPhone() });
        Assert.Equal(1, await db.SaveChangesAsync());
    }

    [Fact]
    public async Task With_RLS_the_same_operations_stay_in_the_tenant()
    {
        var (a, b, aCustomer, bCustomer) = await TwoTenants();
        await using var db = Filtered(Db.AppCs, a.Id);
        await using var tx = await db.BeginTenantAsync(a.Id, default);

        Assert.Equal([aCustomer], await db.Customers.IgnoreQueryFilters()
            .Where(c => c.Id == aCustomer || c.Id == bCustomer).Select(c => c.Id).ToListAsync());
        Assert.Equal([aCustomer], await db.Customers.IgnoreQueryFilters(["soft_delete"])
            .Where(c => c.Id == aCustomer || c.Id == bCustomer).Select(c => c.Id).ToListAsync());
        Assert.Equal([aCustomer], await db.Customers.FromSql($"SELECT * FROM customers").IgnoreQueryFilters()
            .Where(c => c.Id == aCustomer || c.Id == bCustomer).Select(c => c.Id).ToListAsync());
        Assert.DoesNotContain(bCustomer, await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM customers").ToListAsync());
        Assert.Equal(0, await db.Customers.IgnoreQueryFilters().Where(c => c.Id == bCustomer)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.FullName, "hack")));
        Assert.Equal(0, await db.Customers.IgnoreQueryFilters().Where(c => c.Id == bCustomer).ExecuteDeleteAsync());
        Assert.Equal(0, await db.Database.ExecuteSqlAsync($"DELETE FROM customers WHERE id = {bCustomer}"));

        db.Customers.Add(new Customer { TenantId = b.Id, Id = Guid.CreateVersion7(), FullName = "Lậu", Phone = Seed.NewPhone() });
        var e = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, e.SqlState());   // 42501: new row violates row-level security policy
    }

    [Fact]
    public async Task A_pooled_context_keeps_the_previous_requests_tenant()
    {
        var (a, _, aCustomer, _) = await TwoTenants();
        await using var services = new ServiceCollection()
            .AddDbContextPool<FilteredDb>(o => o.UseNpgsql(Db.AdminCs).UseSnakeCaseNamingConvention())
            .BuildServiceProvider();

        await using (var request1 = services.CreateAsyncScope())
        {
            var db = request1.ServiceProvider.GetRequiredService<FilteredDb>();
            db.TenantId = a.Id;   // what the tenant middleware does
            await db.Customers.CountAsync();
        }
        await using (var request2 = services.CreateAsyncScope())   // a path that never sets it: a job, a webhook, a health check
        {
            var db = request2.ServiceProvider.GetRequiredService<FilteredDb>();
            Assert.Equal(a.Id, db.TenantId);
            Assert.Contains(aCustomer, await db.Customers.Select(c => c.Id).ToListAsync());
        }

        // Not pooled: a new instance has Guid.Empty, so the filter matches nothing
        await using var plain = new ServiceCollection()
            .AddDbContext<FilteredDb>(o => o.UseNpgsql(Db.AdminCs).UseSnakeCaseNamingConvention()).BuildServiceProvider();
        await using var scope = plain.CreateAsyncScope();
        Assert.Equal(0, await scope.ServiceProvider.GetRequiredService<FilteredDb>().Customers.CountAsync());
    }

    [Fact]
    public async Task A_pooled_context_under_RLS_has_no_tenant_until_the_transaction_sets_it()
    {
        var (a, _, aCustomer, _) = await TwoTenants();
        await using var services = new ServiceCollection()
            .AddDbContextPool<SpaDb>(o => o.UseNpgsql(Db.AppCs).UseSnakeCaseNamingConvention()).BuildServiceProvider();

        await using (var request1 = services.CreateAsyncScope())
        {
            var db = request1.ServiceProvider.GetRequiredService<SpaDb>();
            await using var tx = await db.BeginTenantAsync(a.Id, default);
            Assert.Contains(aCustomer, await db.Customers.Select(c => c.Id).ToListAsync());   // control
            await tx.CommitAsync();
        }
        await using var request2 = services.CreateAsyncScope();
        Assert.Equal(0, await request2.ServiceProvider.GetRequiredService<SpaDb>().Customers.CountAsync());
    }

    [Fact]
    public async Task A_filter_that_copies_the_tenant_into_a_local_serves_the_first_tenant_to_everyone()
    {
        var (a, b, aCustomer, bCustomer) = await TwoTenants();
        await using var first = Ctx<BakedDb>(Db.AdminCs, o => new BakedDb(o));
        first.TenantId = a.Id;
        Assert.Contains(aCustomer, await first.Customers.Select(c => c.Id).ToListAsync());

        await using var second = Ctx<BakedDb>(Db.AdminCs, o => new BakedDb(o));
        second.TenantId = b.Id;
        var seen = await second.Customers.Select(c => c.Id).ToListAsync();
        Assert.Contains(aCustomer, seen);
        Assert.DoesNotContain(bCustomer, seen);
    }
}
