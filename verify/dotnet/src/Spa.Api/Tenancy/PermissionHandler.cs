using Microsoft.AspNetCore.Authorization;

namespace Spa.Api.Tenancy;

// Endpoint metadata, checked by TenantFilter after the membership check
public sealed record PermissionRequirement(string Action) : IAuthorizationRequirement;

// Resource-based authorization: the resource is the membership loaded for this request
public sealed class PermissionHandler : AuthorizationHandler<PermissionRequirement, Member>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, PermissionRequirement requirement, Member member)
    {
        if (Permissions.Can(member.Role, requirement.Action)) context.Succeed(requirement);
        return Task.CompletedTask;
    }
}

public static class PermissionEndpoints
{
    public static RouteHandlerBuilder RequirePermission(this RouteHandlerBuilder builder, string action) =>
        Permissions.Actions.Contains(action)
            ? builder.WithMetadata(new PermissionRequirement(action))
            : throw new ArgumentException($"unknown permission {action}");   // a typo fails at startup
}
