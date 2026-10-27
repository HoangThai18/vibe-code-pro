using Microsoft.EntityFrameworkCore;

namespace Spa.Api.Data;

// No tenant filter here: RLS scopes every statement to app.tenant_id (set by TenantTransactionFilter)
public class SpaDb(DbContextOptions<SpaDb> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Appointment> Appointments => Set<Appointment>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>().ToTable("users");
        b.Entity<Membership>().ToTable("memberships").HasKey(m => new { m.TenantId, m.UserId });
        b.Entity<Customer>().ToTable("customers").HasKey(c => new { c.TenantId, c.Id });
        b.Entity<Appointment>().ToTable("appointments").HasKey(a => new { a.TenantId, a.Id });
    }
}
