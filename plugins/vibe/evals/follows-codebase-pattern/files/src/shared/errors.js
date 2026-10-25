// Mọi lỗi nghiệp vụ dùng AppError với code máy đọc được; tầng HTTP map status từ đây.
export class AppError extends Error {
  constructor(code, status = 400, details = undefined) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
