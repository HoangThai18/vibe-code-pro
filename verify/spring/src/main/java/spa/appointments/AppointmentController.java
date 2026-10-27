package spa.appointments;

import jakarta.validation.Valid;
import java.time.Instant;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import spa.appointments.AppointmentDtos.Agenda;
import spa.appointments.AppointmentDtos.AppointmentDto;
import spa.appointments.AppointmentDtos.NewAppointment;

@RestController
@RequestMapping("/v1/t/{tenantId}/appointments")
class AppointmentController {
    private final AppointmentService service;
    private final AgendaService agenda;

    AppointmentController(AppointmentService service, AgendaService agenda) {
        this.service = service;
        this.agenda = agenda;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    Map<String, AppointmentDto> book(@Valid @RequestBody NewAppointment in) {
        return Map.of("data", service.book(in));
    }

    @GetMapping
    Agenda between(@RequestParam Instant from, @RequestParam Instant to, @RequestParam(defaultValue = "100") int limit) {
        return agenda.between(from, to, limit);
    }
}
