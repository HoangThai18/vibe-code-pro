package spa.reminders;

public interface ReminderSender {
    // The SMS/Zalo provider dedupes on idempotencyKey: a resend after a crash sends nothing twice
    void send(String phone, String text, String idempotencyKey);
}
