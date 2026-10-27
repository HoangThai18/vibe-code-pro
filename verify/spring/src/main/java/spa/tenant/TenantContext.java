package spa.tenant;

import java.util.function.Supplier;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** The current tenant, read once when a transaction begins (TenantJpaDialect). */
public final class TenantContext {
    private static final ThreadLocal<Tenant> CURRENT = new ThreadLocal<>();

    private TenantContext() {}

    public static Tenant current() {
        return CURRENT.get();   // null: no tenant, so RLS shows no rows
    }

    /** Jobs and workers: run fn with this tenant. fn opens its own transactions. */
    public static <T> T call(Tenant tenant, Supplier<T> fn) {
        // A transaction keeps the tenant it began with: switching inside one would silently do nothing
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("set the tenant before the transaction begins");
        }
        Tenant previous = CURRENT.get();
        CURRENT.set(tenant);
        try {
            return fn.get();
        } finally {
            if (previous == null) CURRENT.remove();
            else CURRENT.set(previous);
        }
    }

    static void set(Tenant tenant) {
        CURRENT.set(tenant);
    }

    static void clear() {
        CURRENT.remove();
    }
}
