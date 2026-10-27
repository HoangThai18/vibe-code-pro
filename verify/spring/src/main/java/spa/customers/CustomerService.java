package spa.customers;

import java.text.Normalizer;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Limit;
import org.springframework.data.domain.Sort;
import org.springframework.data.domain.Window;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import spa.customers.CustomerDtos.CustomerDto;
import spa.customers.CustomerDtos.CustomerPage;
import spa.customers.CustomerDtos.CustomerPatch;
import spa.customers.CustomerDtos.NewCustomer;
import spa.tenant.TenantContext;
import spa.web.ApiException;
import spa.web.SqlState;

@Service
public class CustomerService {
    private static final Sort NEWEST_FIRST = Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"));
    private final CustomerRepository customers;

    CustomerService(CustomerRepository customers) {
        this.customers = customers;
    }

    @PreAuthorize("@authz.can('customer.read')")
    @Transactional(readOnly = true)
    public CustomerPage list(int limit, String cursor) {
        Window<Customer> page = customers.findAllBy(Cursors.decode(cursor), NEWEST_FIRST, Limit.of(Math.clamp(limit, 1, 100)));
        String next = page.hasNext() ? Cursors.encode(page.positionAt(page.size() - 1)) : null;
        return new CustomerPage(page.map(CustomerDto::of).getContent(), next);
    }

    @PreAuthorize("@authz.can('customer.read')")
    @Transactional(readOnly = true)
    public CustomerDto get(UUID id) {
        return customers.findById(id).map(CustomerDto::of).orElseThrow(ApiException::notFound);   // other tenant: RLS hides it
    }

    @PreAuthorize("@authz.can('customer.write')")
    @Transactional
    public CustomerDto create(NewCustomer in) {
        var customer = new Customer(TenantContext.current().id(), nfc(in.fullName()), Phones.normalize(in.phone()),
            in.email(), in.birthday());
        return CustomerDto.of(saveOrConflict(customer));
    }

    @PreAuthorize("@authz.can('customer.write')")
    @Transactional
    public CustomerDto update(UUID id, CustomerPatch in) {
        Customer c = customers.findById(id).orElseThrow(ApiException::notFound);
        if (in.fullName() != null) c.setFullName(nfc(in.fullName()));
        if (in.phone() != null) c.setPhone(Phones.normalize(in.phone()));
        if (in.email() != null) c.setEmail(in.email());
        if (in.birthday() != null) c.setBirthday(in.birthday());
        return CustomerDto.of(saveOrConflict(c));
    }

    private Customer saveOrConflict(Customer c) {
        try {
            return customers.saveAndFlush(c);   // flush now, so a unique violation surfaces here and not at commit
        } catch (DataIntegrityViolationException e) {
            if ("23505".equals(SqlState.of(e))) {   // UNIQUE (tenant_id, phone)
                throw new ApiException(HttpStatus.CONFLICT, "customer_phone_taken", "Số điện thoại này đã có trong workspace.");
            }
            throw e;
        }
    }

    private static String nfc(String s) {
        return Normalizer.normalize(s.strip(), Normalizer.Form.NFC);   // full_name CHECK (... IS NFC NORMALIZED)
    }
}
