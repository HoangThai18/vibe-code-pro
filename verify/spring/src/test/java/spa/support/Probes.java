package spa.support;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import spa.appointments.Appointment;
import spa.appointments.AppointmentRepository;
import spa.customers.CustomerRepository;
import spa.tenant.Tenant;
import spa.tenant.TenantContext;

/** Test-only code that shows the traps: @Async without the tenant, lazy loading after the transaction. */
public final class Probes {
    private Probes() {}

    @Configuration
    @EnableAsync
    static class AsyncConfig {}

    @Component
    public static class AsyncCounter {
        private final CustomerRepository customers;
        private final TransactionTemplate tx;

        AsyncCounter(CustomerRepository customers, TransactionTemplate tx) {
            this.customers = customers;
            this.tx = tx;
        }

        @Async
        public CompletableFuture<Long> countInCallersTenant() {
            return CompletableFuture.completedFuture(tx.execute(s -> customers.count()));   // another thread: no TenantContext
        }

        @Async
        public CompletableFuture<Long> count(UUID tenantId) {
            return CompletableFuture.completedFuture(TenantContext.call(Tenant.of(tenantId), () -> tx.execute(s -> customers.count())));
        }
    }

    @RestController
    static class LazyLoadAfterTransaction {
        private final AppointmentRepository appointments;
        private final TransactionTemplate tx;

        LazyLoadAfterTransaction(AppointmentRepository appointments, TransactionTemplate tx) {
            this.appointments = appointments;
            this.tx = tx;
        }

        @GetMapping("/v1/t/{tenantId}/probe/appointments/{id}/customer-name")
        Map<String, String> customerName(@PathVariable UUID id) {
            Appointment a = tx.execute(s -> appointments.findById(id).orElseThrow());   // the transaction ends here
            try {
                return Map.of("name", a.getCustomer().getFullName());                  // lazy load after it
            } catch (RuntimeException e) {
                return Map.of("error", e.getClass().getName());
            }
        }
    }
}
