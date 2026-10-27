package spa.web;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
class ApiErrors {
    record Body(Error error) {
        record Error(String code, String message) {}
    }

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Body> api(ApiException e) {
        return body(e.status(), e.code(), e.getMessage());
    }

    // @PreAuthorize denied (AuthorizationDeniedException): a member without the permission
    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<Body> forbidden(AccessDeniedException e) {
        return body(HttpStatus.FORBIDDEN, "forbidden", "Bạn không có quyền thực hiện thao tác này.");
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Body> invalid(MethodArgumentNotValidException e) {
        return body(HttpStatus.BAD_REQUEST, "validation_failed", "Dữ liệu không hợp lệ.");
    }

    // A malformed id in the path is "not found", like an id of another tenant
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<Body> mismatch(MethodArgumentTypeMismatchException e) {
        return e.getParameter().hasParameterAnnotation(PathVariable.class)
            ? body(HttpStatus.NOT_FOUND, "not_found", "Không tìm thấy.")
            : body(HttpStatus.BAD_REQUEST, "validation_failed", "Dữ liệu không hợp lệ.");
    }

    private static ResponseEntity<Body> body(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).body(new Body(new Body.Error(code, message)));
    }
}
