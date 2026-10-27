using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Spa.Api.Data;

namespace Spa.Api.Auth;

public class TokenService(IConfiguration config)
{
    public static TokenValidationParameters Validation(IConfiguration config) => new()
    {
        ValidIssuer = config["Jwt:Issuer"],
        ValidAudience = config["Jwt:Audience"],
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(config["Jwt:Key"]!)),
    };

    public string Issue(User user)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(config["Jwt:Key"]!));
        var token = new JwtSecurityToken(config["Jwt:Issuer"], config["Jwt:Audience"],
            [new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()), new Claim(ClaimTypes.Email, user.Email)],
            expires: DateTime.UtcNow.AddMinutes(15),
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

public record LoginRequest(string Email, string Password);

public static class AuthEndpoints
{
    public static void MapAuth(this WebApplication app) =>
        app.MapPost("/v1/auth/login", async (LoginRequest body, SpaDb db, TokenService tokens) =>
        {
            var user = await db.Users.SingleOrDefaultAsync(u => u.Email == body.Email.ToLowerInvariant());
            if (user?.PasswordHash is null || !BCryptLike.Verify(body.Password, user.PasswordHash)) return Results.Unauthorized();
            return Results.Ok(new { accessToken = tokens.Issue(user) });
        });
}

// Stand-in for the project's password hasher (argon2id in production)
static class BCryptLike
{
    public static bool Verify(string password, string hash) => hash == Convert.ToBase64String(
        System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(password)));
}
