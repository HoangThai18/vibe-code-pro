using System.Globalization;
using System.Text;

namespace Spa.Api.Jobs;

public interface ISmsSender
{
    // The provider dedupes by idempotencyKey: a resend with the same key sends no second message
    Task SendAsync(string phone, string text, Guid idempotencyKey, CancellationToken ct);
}

public static class ReminderText
{
    // Brandname SMS: no diacritics, time in the tenant's zone (jobs.md section 3)
    public static string For(DueReminder r)
    {
        var local = TimeZoneInfo.ConvertTimeFromUtc(r.StartsAt, TimeZoneInfo.FindSystemTimeZoneById(r.TimeZone));
        return $"Chao {Unaccent(r.FullName)}, nhac lich hen cua ban luc {local.ToString("HH:mm dd/MM/yyyy", CultureInfo.InvariantCulture)}.";
    }

    static string Unaccent(string s) =>
        string.Concat(s.Normalize(NormalizationForm.FormD)
                .Where(ch => CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark))
            .Replace('đ', 'd').Replace('Đ', 'D');
}
