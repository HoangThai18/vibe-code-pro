namespace Spa.Api.Tenancy;

// Fixed roles, resource.action permissions, deny by default (auth.md section 4)
public static class Permissions
{
    public static readonly string[] Actions =
    [
        "customer.read", "customer.write", "customer.import",
        "appointment.write", "appointment.confirm",
        "billing.manage", "member.invite", "member.role_change", "api_key.manage",
    ];

    static readonly Dictionary<string, HashSet<string>> ByRole = new()
    {
        ["owner"] = [.. Actions],
        ["manager"] = ["customer.read", "customer.write", "customer.import", "appointment.write",
            "appointment.confirm", "member.invite", "member.role_change"],
        ["staff"] = ["customer.read", "appointment.write"],   // own appointments only: checked in the use case
    };

    public static bool Can(string role, string action) => ByRole.TryGetValue(role, out var set) && set.Contains(action);
}

public sealed record Member(Guid TenantId, Guid UserId, string Role);
