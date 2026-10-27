namespace Spa.Api.Data;

public class User
{
    public Guid Id { get; set; }
    public string Email { get; set; } = "";
    public string? PasswordHash { get; set; }
}

public class Membership
{
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public string Role { get; set; } = "staff";   // owner | manager | staff (CHECK in the migration)
}

public class Customer
{
    public Guid TenantId { get; set; }
    public Guid Id { get; set; }
    public string FullName { get; set; } = "";
    public string Phone { get; set; } = "";
}

public class Appointment
{
    public Guid TenantId { get; set; }
    public Guid Id { get; set; }
    public Guid CustomerId { get; set; }
    public Guid StaffUserId { get; set; }
    public DateTime StartsAt { get; set; }
    public DateTime EndsAt { get; set; }
    public string Status { get; set; } = "booked";
}
