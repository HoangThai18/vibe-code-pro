package spa.customers;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

// The table's key is (tenant_id, id); JPA maps id alone (a random UUID). RLS and the composite FKs keep the tenant.
@Entity
@Table(name = "customers")
public class Customer {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private UUID tenantId;
    private String fullName;
    private String phone;
    private String email;
    private LocalDate birthday;
    private Instant createdAt;

    protected Customer() {}

    public Customer(UUID tenantId, String fullName, String phone, String email, LocalDate birthday) {
        this.tenantId = tenantId;
        this.fullName = fullName;
        this.phone = phone;
        this.email = email;
        this.birthday = birthday;
        this.createdAt = Instant.now().truncatedTo(ChronoUnit.MICROS);   // timestamptz keeps microseconds
    }

    public UUID getId() { return id; }
    public UUID getTenantId() { return tenantId; }
    public String getFullName() { return fullName; }
    public String getPhone() { return phone; }
    public String getEmail() { return email; }
    public LocalDate getBirthday() { return birthday; }
    public Instant getCreatedAt() { return createdAt; }

    public void setFullName(String fullName) { this.fullName = fullName; }
    public void setPhone(String phone) { this.phone = phone; }
    public void setEmail(String email) { this.email = email; }
    public void setBirthday(LocalDate birthday) { this.birthday = birthday; }
}
