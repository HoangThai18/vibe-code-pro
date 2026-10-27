package spa.reminders;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** Placeholder until a provider is wired in (notifications.md). */
@Component
class LogReminderSender implements ReminderSender {
    private static final Logger log = LoggerFactory.getLogger(LogReminderSender.class);

    @Override
    public void send(String phone, String text, String idempotencyKey) {
        log.info("reminder {} queued for provider", idempotencyKey);
    }
}
