// apps/api/src/privacy/deadlines.ts
// Deadlines per Decree 356/2025/NĐ-CP Article 5 (verify against the original text before use; see privacy.md section 1)
export type RequestKind = 'access' | 'correction' | 'deletion' | 'withdraw_consent' | 'restrict' | 'object';

const COMPLETE_DAYS: Record<RequestKind, number> = {
  access: 10,
  correction: 10,
  deletion: 20,
  withdraw_consent: 15,
  restrict: 15,
  object: 15,
};

// Date in Vietnam time as YYYY-MM-DD
function vnDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Working days: skip Saturdays, Sundays and public holidays (list updated yearly, kept in config or the DB)
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

// Acknowledgement: 2 working days. Completion counts calendar days: no later than counting working days,
// so it meets the deadline under either reading
export function requestDeadlines(kind: RequestKind, receivedAt: Date, holidays: ReadonlySet<string>) {
  const received = vnDate(receivedAt);
  return { ackDue: addWorkingDays(received, 2, holidays), due: addDays(received, COMPLETE_DAYS[kind]) };
}
