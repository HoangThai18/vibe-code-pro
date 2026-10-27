package vn.spa.crm.appointment;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "appointments")
public class Appointment {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private UUID tenantId;
    private UUID customerId;
    private UUID staffUserId;
    private Instant startsAt;
    private Instant endsAt;
    private String status;

    protected Appointment() {}

    public UUID getId() { return id; }
    public UUID getCustomerId() { return customerId; }
    public UUID getStaffUserId() { return staffUserId; }
    public Instant getStartsAt() { return startsAt; }
    public Instant getEndsAt() { return endsAt; }
    public String getStatus() { return status; }
}
