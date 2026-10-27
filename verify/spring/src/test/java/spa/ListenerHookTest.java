package spa;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import jakarta.persistence.EntityManagerFactory;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.transaction.TransactionExecution;
import org.springframework.transaction.TransactionExecutionListener;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import spa.support.ApiTest;

/** Why set_config is not in a TransactionExecutionListener: a failure in afterBegin is not cleaned up. */
class ListenerHookTest extends ApiTest {
    static volatile boolean fail;

    @TestConfiguration
    static class FailingListener {
        @Bean
        TransactionExecutionListener failingAfterBegin() {   // Boot adds listener beans to the transaction manager
            return new TransactionExecutionListener() {
                @Override
                public void afterBegin(TransactionExecution transaction, Throwable beginFailure) {
                    if (fail) throw new IllegalStateException("set_config failed");
                }
            };
        }
    }

    @Autowired
    TransactionTemplate tx;
    @Autowired
    EntityManagerFactory emf;

    @Test
    void anExceptionInAfterBeginLeavesTheTransactionBoundToTheThread() {
        fail = true;
        try {
            assertThatThrownBy(() -> tx.execute(s -> 1)).hasMessage("set_config failed");
            assertThat(TransactionSynchronizationManager.hasResource(emf)).isTrue();   // the EntityManager is still bound
        } finally {
            fail = false;
            var holder = (org.springframework.orm.jpa.EntityManagerHolder) TransactionSynchronizationManager.unbindResource(emf);
            holder.getEntityManager().getTransaction().rollback();
            holder.getEntityManager().close();
            new java.util.ArrayList<>(TransactionSynchronizationManager.getResourceMap().keySet())
                .forEach(TransactionSynchronizationManager::unbindResource);   // the JDBC connection holder
            TransactionSynchronizationManager.clear();
        }
    }
}
