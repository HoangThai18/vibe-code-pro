using Microsoft.EntityFrameworkCore;
using Spa.Api.Data;

namespace Spa.Api.Webhooks;

public record ZaloOptOut(string OaId, string Phone, string Signature);

public static class ZaloWebhook
{
    // Zalo calls this when a customer blocks the spa's OA: stop sending ZNS to that phone
    public static void MapZaloWebhook(this WebApplication app) =>
        app.MapPost("/webhooks/zalo/opt-out", async (ZaloOptOut body, AppDbContext db, IConfiguration config) =>
        {
            if (!ZaloSignature.IsValid(body, config["Zalo:OaSecret"]!)) return Results.Unauthorized();
            var customer = await db.Customers.FirstOrDefaultAsync(c => c.Phone == body.Phone);
            if (customer is null) return Results.Ok();
            customer.ZaloOptedOut = true;
            await db.SaveChangesAsync();
            return Results.Ok();
        });
}

static class ZaloSignature
{
    public static bool IsValid(ZaloOptOut body, string secret) =>
        Convert.ToHexString(System.Security.Cryptography.HMACSHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(secret), System.Text.Encoding.UTF8.GetBytes($"{body.OaId}{body.Phone}")))
            .Equals(body.Signature, StringComparison.OrdinalIgnoreCase);
}
