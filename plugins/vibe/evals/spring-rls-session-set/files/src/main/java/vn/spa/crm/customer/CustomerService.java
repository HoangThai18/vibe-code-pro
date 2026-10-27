package vn.spa.crm.customer;

import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CustomerService {
    private final CustomerRepository customers;

    public CustomerService(CustomerRepository customers) {
        this.customers = customers;
    }

    @Transactional(readOnly = true)
    public Page<Customer> list(int page) {
        return customers.findAllByOrderByCreatedAtDesc(PageRequest.of(page, 20));
    }

    @Transactional
    public Customer create(UUID tenantId, String fullName, String phone) {
        return customers.save(new Customer(tenantId, fullName, phone));
    }
}
