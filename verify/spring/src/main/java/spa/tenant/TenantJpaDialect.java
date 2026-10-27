package spa.tenant;

import jakarta.persistence.EntityManager;
import java.sql.SQLException;
import org.springframework.orm.jpa.vendor.HibernateJpaDialect;
import org.springframework.transaction.TransactionDefinition;

/** set_config as the first statement of every JPA transaction, inside Spring's begin step. */
public class TenantJpaDialect extends HibernateJpaDialect {
    @Override
    public Object beginTransaction(EntityManager em, TransactionDefinition definition) throws SQLException {
        Object transactionData = super.beginTransaction(em, definition);
        Tenant tenant = TenantContext.current();
        if (tenant != null) {
            // true = local to this transaction: the pooled connection never carries it to the next request
            em.createNativeQuery("SELECT set_config('app.tenant_id', ?1, true)")
                .setParameter(1, tenant.id().toString())
                .getSingleResult();
        }
        return transactionData;
    }
}
