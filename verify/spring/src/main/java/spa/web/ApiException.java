package spa.web;

import org.springframework.http.HttpStatus;

/** An error with its HTTP status and code (api-conventions.md section 2). */
public class ApiException extends RuntimeException {
    private final HttpStatus status;
    private final String code;

    public ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "not_found", "Không tìm thấy.");
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }
}
