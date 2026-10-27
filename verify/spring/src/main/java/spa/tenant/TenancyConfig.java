package spa.tenant;

import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;

@Configuration
class TenancyConfig {
    // Runs before the EntityManagerFactory initializes; JpaTransactionManager then takes the dialect from it
    @Bean
    static BeanPostProcessor tenantJpaDialect() {
        return new BeanPostProcessor() {
            @Override
            public Object postProcessBeforeInitialization(Object bean, String name) {
                if (bean instanceof LocalContainerEntityManagerFactoryBean emf) {
                    emf.setJpaDialect(new TenantJpaDialect());
                }
                return bean;
            }
        };
    }
}
