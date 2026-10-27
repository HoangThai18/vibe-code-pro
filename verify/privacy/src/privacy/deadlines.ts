// apps/api/src/privacy/deadlines.ts
// Hạn theo Nghị định 356/2025/NĐ-CP điều 5 (đối chiếu văn bản gốc trước khi dùng; xem privacy.md mục 1)
export type RequestKind = 'access' | 'correction' | 'deletion' | 'withdraw_consent' | 'restrict' | 'object';

const COMPLETE_DAYS: Record<RequestKind, number> = {
  access: 10,
  correction: 10,
  deletion: 20,
  withdraw_consent: 15,
  restrict: 15,
  object: 15,
};

// Ngày theo giờ Việt Nam dạng YYYY-MM-DD
function vnDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Ngày làm việc: bỏ thứ Bảy, Chủ nhật và ngày nghỉ lễ (danh sách cập nhật hằng năm, lưu trong config hoặc DB)
export function addWorkingDays(isoDate: string, days: number, holidays: ReadonlySet<string>): string {
  let date = isoDate;
  let left = days;
  while (left > 0) {
    date = addDays(date, 1);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(date)) left--;
  }
  return date;
}

// Xác nhận đã nhận: 2 ngày làm việc. Hạn hoàn thành tính theo ngày lịch: sớm hơn hoặc bằng cách tính theo ngày làm việc,
// nên đúng hạn với cả hai cách hiểu
export function requestDeadlines(kind: RequestKind, receivedAt: Date, holidays: ReadonlySet<string>) {
  const received = vnDate(receivedAt);
  return { ackDue: addWorkingDays(received, 2, holidays), due: addDays(received, COMPLETE_DAYS[kind]) };
}
