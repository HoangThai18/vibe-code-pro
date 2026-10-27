package spa.appointments;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import spa.customers.Customer;

@Entity
@Table(name = "appointments")
public class Appointment {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private UUID tenantId;
    @Column(name = "customer_id")   // the same name as below, or Hibernate sees two logical columns
    private UUID customerId;
    // Read-only view of customer_id. LAZY: the JPA default for @ManyToOne is EAGER
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "customer_id", insertable = false, updatable = false)
    private Customer customer;
    private UUID staffUserId;
    private Instant startsAt;
    private Instant endsAt;
    @Column(insertable = false)   // DB default 'booked'
    private String status;

    protected Appointment() {}

    public Appointment(UUID tenantId, UUID customerId, UUID staffUserId, Instant startsAt, Instant endsAt) {
        this.tenantId = tenantId;
        this.customerId = customerId;
        this.staffUserId = staffUserId;
        this.startsAt = startsAt;
        this.endsAt = endsAt;
    }

    public UUID getId() { return id; }
    public UUID getCustomerId() { return customerId; }
    public Customer getCustomer() { return customer; }
    public UUID getStaffUserId() { return staffUserId; }
    public Instant getStartsAt() { return startsAt; }
    public Instant getEndsAt() { return endsAt; }
    public String getStatus() { return status; }
}
