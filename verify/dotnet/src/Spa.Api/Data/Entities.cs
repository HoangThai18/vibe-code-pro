namespace Spa.Api.Data;

// The example schema (multi-tenant.md section 2). Tenant-owned rows carry TenantId as the first key column.
public sealed class Tenant
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public string Status { get; set; } = "active";
    public string TimeZone { get; set; } = "Asia/Ho_Chi_Minh";
    public DateTime CreatedAt { get; set; }
}

public sealed class User
{
    public Guid Id { get; set; }
    public required string Email { get; set; }
    public string? PasswordHash { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class Membership
{
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public required string Role { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class Customer
{
    public Guid TenantId { get; set; }
    public Guid Id { get; set; }
    public required string FullName { get; set; }
    public required string Phone { get; set; }
    public string? Email { get; set; }
    public DateOnly? Birthday { get; set; }
    public DateTime CreatedAt { get; set; }
    public uint Version { get; set; }                   // xmin: concurrency token
    public List<Appointment> Appointments { get; } = [];
}

public sealed class Appointment
{
    public Guid TenantId { get; set; }
    public Guid Id { get; set; }
    public Guid CustomerId { get; set; }
    public Guid StaffUserId { get; set; }
    public DateTime StartsAt { get; set; }
    public DateTime EndsAt { get; set; }
    public string Status { get; set; } = "booked";
    public DateTime CreatedAt { get; set; }
    public Customer? Customer { get; set; }
}

public sealed class Notification
{
    public Guid TenantId { get; set; }
    public Guid Id { get; set; }
    public Guid AppointmentId { get; set; }
    public required string Kind { get; set; }
    public string Status { get; set; } = "pending";
    public DateTime? SentAt { get; set; }
    public DateTime? LockedUntil { get; set; }          // lease of the instance sending it
    public DateTime CreatedAt { get; set; }
}
