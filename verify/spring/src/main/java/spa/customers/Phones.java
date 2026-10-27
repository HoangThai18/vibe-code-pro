package spa.customers;

import org.springframework.http.HttpStatus;
import spa.web.ApiException;

/** Stored as 0912345678 (data-import.md has the full normalizer). */
final class Phones {
    private Phones() {}

    static String normalize(String raw) {
        String s = raw.replaceAll("[\\s.()-]", "");
        if (s.startsWith("+84")) s = "0" + s.substring(3);
        else if (s.startsWith("84") && s.length() >= 11) s = "0" + s.substring(2);
        if (!s.matches("0\\d{9,10}")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "validation_failed", "Số điện thoại không hợp lệ.");
        }
        return s;
    }
}
