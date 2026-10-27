<?php

namespace App\Support;

use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

// { "error": { "code", "message" } } for every error (references/api-conventions.md section 2)
final class ApiErrors
{
    public static function register(Exceptions $exceptions): void
    {
        $exceptions->dontReport([ApiError::class]);
        // ModelNotFoundException (route model binding, findOrFail) arrives here as NotFoundHttpException
        $exceptions->render(fn (NotFoundHttpException $e) => ApiError::json(404, 'not_found', 'Không tìm thấy.'));
        $exceptions->render(fn (AccessDeniedHttpException $e) => ApiError::json(403, 'forbidden', 'Bạn không có quyền này.'));
        $exceptions->render(fn (AuthenticationException $e) => ApiError::json(401, 'unauthenticated', 'Vui lòng đăng nhập.'));
        $exceptions->render(fn (ValidationException $e) => ApiError::json(400, 'validation_failed', 'Dữ liệu không hợp lệ.', $e->errors()));
        $exceptions->render(function (UniqueConstraintViolationException $e) {
            if ($e->index === 'customers_tenant_id_phone_unique') {   // MySQL error 1062, index name parsed by Laravel
                return ApiError::json(409, 'customer_phone_taken', 'Số điện thoại này đã có trong workspace.');
            }
        });
        $exceptions->render(function (QueryException $e) {
            if (($e->errorInfo[1] ?? null) === 1452) {                 // composite FK: another tenant's row; don't echo the SQL
                return ApiError::json(422, 'invalid_reference', 'Khách hàng hoặc nhân viên không hợp lệ.');
            }
        });
    }
}
