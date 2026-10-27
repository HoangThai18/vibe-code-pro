package spa.customers;

import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.domain.ScrollPosition;
import org.springframework.data.domain.Sort;
import org.springframework.data.domain.Window;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CustomerRepository extends JpaRepository<Customer, UUID> {
    // Keyset scrolling: WHERE (created_at, id) < (last row) instead of OFFSET
    Window<Customer> findAllBy(ScrollPosition position, Sort sort, Limit limit);
}
