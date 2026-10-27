using Microsoft.EntityFrameworkCore;

namespace Spa.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    // Set by TenantMiddleware at the start of every tenant request
    public Guid TenantId { get; set; }

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Appointment> Appointments => Set<Appointment>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Tenant>().ToTable("tenants");
        b.Entity<Membership>().ToTable("memberships").HasKey(m => new { m.TenantId, m.UserId });
        b.Entity<Customer>().ToTable("customers").HasKey(c => new { c.TenantId, c.Id });
        b.Entity<Appointment>().ToTable("appointments").HasKey(a => new { a.TenantId, a.Id });

        // Every query only sees the current spa's rows (and hides soft-deleted customers)
        b.Entity<Customer>().HasQueryFilter(c => c.TenantId == TenantId && c.DeletedAt == null);
        b.Entity<Appointment>().HasQueryFilter(a => a.TenantId == TenantId);
    }
}
