package vn.spa.crm.appointment;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/appointments")
public class AppointmentController {
    private static final ZoneId VN = ZoneId.of("Asia/Ho_Chi_Minh");
    private final AppointmentRepository appointments;

    public AppointmentController(AppointmentRepository appointments) {
        this.appointments = appointments;
    }

    // Day view of the calendar
    @GetMapping
    public List<Appointment> day(@RequestParam LocalDate date) {
        Instant from = date.atStartOfDay(VN).toInstant();
        Instant to = date.plusDays(1).atStartOfDay(VN).toInstant();
        return appointments.findByStartsAtBetweenOrderByStartsAt(from, to);
    }
}
