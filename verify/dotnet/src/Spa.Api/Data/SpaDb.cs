using Microsoft.EntityFrameworkCore;

namespace Spa.Api.Data;

// No tenant query filter: RLS scopes every statement (postgres-rls.md). Snake_case names: UseSnakeCaseNamingConvention().
public class SpaDb : DbContext
{
    public SpaDb(DbContextOptions<SpaDb> options) : base(options) { }
    protected SpaDb(DbContextOptions options) : base(options) { }   // test subclasses

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Appointment> Appointments => Set<Appointment>();
    public DbSet<Notification> Notifications => Set<Notification>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Tenant>(e =>
        {
            e.Property(t => t.Id).HasDefaultValueSql("gen_random_uuid()");
            e.Property(t => t.Status).HasDefaultValue("active");
            e.Property(t => t.TimeZone).HasDefaultValue("Asia/Ho_Chi_Minh");
            e.Property(t => t.CreatedAt).HasDefaultValueSql("now()");
            e.ToTable(t => t.HasCheckConstraint("tenants_status_check", "status IN ('active', 'suspended', 'closed')"));
        });
        b.Entity<User>(e =>
        {
            e.Property(u => u.Id).HasDefaultValueSql("gen_random_uuid()");
            e.HasIndex(u => u.Email).IsUnique();
            e.Property(u => u.CreatedAt).HasDefaultValueSql("now()");
            e.ToTable(t => t.HasCheckConstraint("users_email_check", "email = lower(email)"));
        });
        b.Entity<Membership>(e =>
        {
            e.HasKey(m => new { m.TenantId, m.UserId });
            e.HasOne<Tenant>().WithMany().HasForeignKey(m => m.TenantId).OnDelete(DeleteBehavior.NoAction);
            e.HasOne<User>().WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.NoAction);
            e.HasIndex(m => m.UserId).HasDatabaseName("memberships_user");
            e.Property(m => m.CreatedAt).HasDefaultValueSql("now()");
            e.ToTable(t => t.HasCheckConstraint("memberships_role_check", "role IN ('owner', 'manager', 'staff')"));
        });
        b.Entity<Customer>(e =>
        {
            e.HasKey(c => new { c.TenantId, c.Id });
            e.Property(c => c.TenantId).HasDefaultValueSql("app_current_tenant()");
            e.Property(c => c.Id).HasDefaultValueSql("gen_random_uuid()");
            e.HasOne<Tenant>().WithMany().HasForeignKey(c => c.TenantId).OnDelete(DeleteBehavior.NoAction);
            e.HasIndex(c => new { c.TenantId, c.Phone }).IsUnique();             // unique per tenant, never global
            e.HasIndex(c => new { c.TenantId, c.CreatedAt, c.Id }).HasDatabaseName("customers_created");   // keyset pages
            e.Property(c => c.CreatedAt).HasDefaultValueSql("now()");
            e.Property(c => c.Version).IsRowVersion();                           // Npgsql maps a uint row version to xmin
            e.ToTable(t =>
            {
                t.HasCheckConstraint("customers_full_name_check", "full_name IS NFC NORMALIZED AND length(full_name) BETWEEN 1 AND 200");
                t.HasCheckConstraint("customers_phone_check", "phone ~ '^0[0-9]{9,10}$'");
            });
        });
        b.Entity<Appointment>(e =>
        {
            e.HasKey(a => new { a.TenantId, a.Id });
            e.Property(a => a.TenantId).HasDefaultValueSql("app_current_tenant()");
            e.Property(a => a.Id).HasDefaultValueSql("gen_random_uuid()");
            e.HasOne<Tenant>().WithMany().HasForeignKey(a => a.TenantId).OnDelete(DeleteBehavior.NoAction);
            // Composite FKs: an appointment can't point at another tenant's customer or staff
            e.HasOne(a => a.Customer).WithMany(c => c.Appointments)
                .HasForeignKey(a => new { a.TenantId, a.CustomerId }).OnDelete(DeleteBehavior.NoAction);
            e.HasOne<Membership>().WithMany()
                .HasForeignKey(a => new { a.TenantId, a.StaffUserId }).OnDelete(DeleteBehavior.NoAction);
            e.HasIndex(a => new { a.TenantId, a.CustomerId }).HasDatabaseName("appointments_customer");
            e.HasIndex(a => new { a.TenantId, a.StartsAt }).HasDatabaseName("appointments_starts");
            e.Property(a => a.Status).HasDefaultValue("booked");
            e.Property(a => a.CreatedAt).HasDefaultValueSql("now()");
            e.ToTable(t =>
            {
                t.HasCheckConstraint("appointments_status_check", "status IN ('booked', 'confirmed', 'done', 'cancelled', 'no_show')");
                t.HasCheckConstraint("appointments_check", "ends_at > starts_at");
            });
        });
        b.Entity<Notification>(e =>   // jobs.md section 3, plus locked_until (the table is the queue)
        {
            e.HasKey(n => new { n.TenantId, n.Id });
            e.Property(n => n.TenantId).HasDefaultValueSql("app_current_tenant()");
            e.Property(n => n.Id).HasDefaultValueSql("gen_random_uuid()");
            e.HasOne<Tenant>().WithMany().HasForeignKey(n => n.TenantId).OnDelete(DeleteBehavior.NoAction);
            e.HasOne<Appointment>().WithMany()
                .HasForeignKey(n => new { n.TenantId, n.AppointmentId }).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(n => new { n.TenantId, n.AppointmentId, n.Kind }).IsUnique();   // one reminder of each kind
            e.Property(n => n.Status).HasDefaultValue("pending");
            e.Property(n => n.CreatedAt).HasDefaultValueSql("now()");
            e.ToTable(t => t.HasCheckConstraint("notifications_status_check", "status IN ('pending', 'sent', 'skipped')"));
        });
    }
}
