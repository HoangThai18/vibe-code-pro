package vn.spa.crm.customer;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/customers")
public class CustomerController {
    private final CustomerService service;
    private final CustomerRepository customers;

    public CustomerController(CustomerService service, CustomerRepository customers) {
        this.service = service;
        this.customers = customers;
    }

    @GetMapping
    public Page<Customer> list(@RequestParam(defaultValue = "0") int page) {
        return service.list(page);
    }

    // Search box on the booking screen
    @GetMapping("/search")
    public List<Customer> search(@RequestParam String phone) {
        return customers.findTop20ByPhoneContaining(phone);
    }

    public record NewCustomer(String fullName, String phone) {}

    @PostMapping
    public Customer create(@AuthenticationPrincipal Jwt jwt, @RequestBody NewCustomer in) {
        return service.create(UUID.fromString(jwt.getClaimAsString("tenant_id")), in.fullName(), in.phone());
    }
}
