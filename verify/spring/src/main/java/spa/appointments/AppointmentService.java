package spa.appointments;

import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import spa.appointments.AppointmentDtos.AppointmentDto;
import spa.appointments.AppointmentDtos.NewAppointment;
import spa.tenant.TenantContext;
import spa.web.ApiException;
import spa.web.SqlState;

@Service
public class AppointmentService {
    private final AppointmentRepository appointments;

    AppointmentService(AppointmentRepository appointments) {
        this.appointments = appointments;
    }

    @PreAuthorize("@authz.canBookFor(#in.staffUserId())")
    @Transactional
    public AppointmentDto book(NewAppointment in) {
        UUID tenantId = TenantContext.current().id();
        // Without it, concurrent inserts can deadlock inside the exclusion check (40P01) instead of failing with 23P01
        appointments.lockStaff(tenantId, in.staffUserId());
        var a = new Appointment(tenantId, in.customerId(), in.staffUserId(), in.startsAt(), in.endsAt());
        try {
            return AppointmentDto.of(appointments.saveAndFlush(a));   // flush: the violation surfaces here, not at commit
        } catch (DataIntegrityViolationException e) {
            switch (String.valueOf(SqlState.of(e))) {
                // exclusion_violation: an overlapping appointment of that staff member, also under concurrency
                case "23P01" -> throw new ApiException(HttpStatus.CONFLICT, "appointment_slot_taken", "Khung giờ này đã có lịch.");
                // foreign_key_violation: customer or staff not in this tenant (composite FKs)
                case "23503" -> throw new ApiException(HttpStatus.UNPROCESSABLE_CONTENT, "invalid_reference",
                    "Khách hàng hoặc nhân viên không hợp lệ.");
                default -> throw e;
            }
        }
    }
}
