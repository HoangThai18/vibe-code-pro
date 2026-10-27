package spa.support;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;
import spa.reminders.ReminderSender;

@Primary
@Component
public class FakeSender implements ReminderSender {
    public record Sent(String phone, String text, String idempotencyKey) {}

    public final List<Sent> sent = new CopyOnWriteArrayList<>();
    public final AtomicInteger failNext = new AtomicInteger();
    public volatile CountDownLatch entered;   // set by a test to hold the first send
    public volatile CountDownLatch release;

    public void reset() {
        sent.clear();
        failNext.set(0);
        entered = null;
        release = null;
    }

    @Override
    public void send(String phone, String text, String idempotencyKey) {
        if (failNext.getAndUpdate(n -> Math.max(0, n - 1)) > 0) throw new IllegalStateException("provider down");
        CountDownLatch hold = release;
        if (hold != null) {
            entered.countDown();
            try {
                hold.await(10, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        sent.add(new Sent(phone, text, idempotencyKey));
    }
}
