package vn.spa.crm.customer;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "customers")
public class Customer {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private UUID tenantId;
    private String fullName;
    private String phone;
    private Instant createdAt = Instant.now();

    protected Customer() {}

    public Customer(UUID tenantId, String fullName, String phone) {
        this.tenantId = tenantId;
        this.fullName = fullName;
        this.phone = phone;
    }

    public UUID getId() { return id; }
    public UUID getTenantId() { return tenantId; }
    public String getFullName() { return fullName; }
    public String getPhone() { return phone; }
    public Instant getCreatedAt() { return createdAt; }
}
