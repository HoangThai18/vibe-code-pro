package spa.reminders;

import java.text.Normalizer;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/** Brandname SMS templates have no diacritics (notifications.md section 5); the time is in the tenant's zone. */
final class ReminderText {
    private ReminderText() {}

    static String of(String fullName, Instant startsAt, String timeZone) {
        String name = Normalizer.normalize(fullName, Normalizer.Form.NFD).replaceAll("\\p{M}", "")
            .replace('đ', 'd').replace('Đ', 'D');
        String when = DateTimeFormatter.ofPattern("HH:mm dd/MM/yyyy").withZone(ZoneId.of(timeZone)).format(startsAt);
        return "Chao " + name + ", nhac lich hen cua ban luc " + when + ".";
    }
}
