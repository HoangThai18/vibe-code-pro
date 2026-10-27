package spa.support;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

/** A real server on a random port, the app connected as spring_app (no BYPASSRLS), Flyway run as spring_owner. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "app.reminders.cron=-",                                  // tests run the job themselves
    "spring.jpa.properties.hibernate.generate_statistics=true",
    "logging.level.org.hibernate.engine.internal.StatisticalLoggingSessionEventListener=warn",
})
public abstract class ApiTest {
    @LocalServerPort
    protected int port;
    @Autowired
    protected Seed seed;
    protected Api api;

    @BeforeEach
    void resetDatabase() {
        Admin.reset();
        api = new Api(port);
    }
}
