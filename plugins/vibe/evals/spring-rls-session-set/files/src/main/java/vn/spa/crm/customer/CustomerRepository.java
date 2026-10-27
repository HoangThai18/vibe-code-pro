package vn.spa.crm.customer;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CustomerRepository extends JpaRepository<Customer, UUID> {
    Page<Customer> findAllByOrderByCreatedAtDesc(Pageable pageable);

    List<Customer> findTop20ByPhoneContaining(String phone);
}
