package spa.customers;

import jakarta.validation.Valid;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import spa.customers.CustomerDtos.CustomerDto;
import spa.customers.CustomerDtos.CustomerPage;
import spa.customers.CustomerDtos.CustomerPatch;
import spa.customers.CustomerDtos.NewCustomer;

// {tenantId} is read by MembershipInterceptor; the service takes the tenant from TenantContext
@RestController
@RequestMapping("/v1/t/{tenantId}/customers")
class CustomerController {
    private final CustomerService service;

    CustomerController(CustomerService service) {
        this.service = service;
    }

    @GetMapping
    CustomerPage list(@RequestParam(defaultValue = "20") int limit, @RequestParam(required = false) String cursor) {
        return service.list(limit, cursor);
    }

    @GetMapping("/{id}")
    Map<String, CustomerDto> get(@PathVariable UUID id) {
        return Map.of("data", service.get(id));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    Map<String, CustomerDto> create(@Valid @RequestBody NewCustomer in) {
        return Map.of("data", service.create(in));
    }

    @PatchMapping("/{id}")
    Map<String, CustomerDto> update(@PathVariable UUID id, @Valid @RequestBody CustomerPatch in) {
        return Map.of("data", service.update(id, in));
    }
}
