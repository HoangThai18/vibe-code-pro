package spa.customers;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class CustomerDtos {
    private CustomerDtos() {}

    public record CustomerDto(UUID id, String fullName, String phone, String email, LocalDate birthday, Instant createdAt) {
        static CustomerDto of(Customer c) {
            return new CustomerDto(c.getId(), c.getFullName(), c.getPhone(), c.getEmail(), c.getBirthday(), c.getCreatedAt());
        }
    }

    // No tenantId field: the tenant comes only from the path
    public record NewCustomer(@NotBlank @Size(max = 200) String fullName, @NotBlank String phone,
                              @Email String email, LocalDate birthday) {}

    // Omitted or null: unchanged
    public record CustomerPatch(@Size(min = 1, max = 200) String fullName, String phone,
                                @Email String email, LocalDate birthday) {}

    public record CustomerPage(List<CustomerDto> data, String nextCursor) {}
}
