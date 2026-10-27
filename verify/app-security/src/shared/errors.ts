// src/shared/errors.ts — the HTTP layer renders these as { error: { code, message } } (api-conventions.md section 2)
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string = code) {
    super(message);
  }
}

export class NotFoundError extends HttpError {
  constructor() {
    super(404, 'not_found', 'Không tìm thấy.');
  }
}
