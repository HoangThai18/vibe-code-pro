namespace Spa.Api.Data;

public class Tenant
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string? ZaloOaId { get; set; }
}

public class Membership
{
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public string Role { get; set; } = "staff";
}

public class Customer
{
    public Guid TenantId { get; set; }
    public Guid Id { get; set; }
    public string FullName { get; set; } = "";
    public string Phone { get; set; } = "";
    public bool ZaloOptedOut { get; set; }
    public DateTime? DeletedAt { get; set; }
}

public class Appointment
{
    public Guid TenantId { get; set; }
    public Guid Id { get; set; }
    public Guid CustomerId { get; set; }
    public DateTime StartsAt { get; set; }
    public string Status { get; set; } = "booked";
    public long Price { get; set; }
}
