package spa.customers;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.KeysetScrollPosition;
import org.springframework.data.domain.ScrollPosition;
import org.springframework.http.HttpStatus;
import spa.web.ApiException;

/** Opaque cursor = base64url("createdAt|id") of the last row (api-conventions.md section 3). */
final class Cursors {
    private Cursors() {}

    static String encode(ScrollPosition position) {
        Map<String, Object> keys = ((KeysetScrollPosition) position).getKeys();
        String raw = keys.get("createdAt") + "|" + keys.get("id");
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    static KeysetScrollPosition decode(String cursor) {
        if (cursor == null || cursor.isEmpty()) return ScrollPosition.keyset();
        try {
            String[] parts = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8).split("\\|", 2);
            return ScrollPosition.forward(Map.of("createdAt", Instant.parse(parts[0]), "id", UUID.fromString(parts[1])));
        } catch (RuntimeException e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_cursor", "Cursor không hợp lệ.");
        }
    }
}
