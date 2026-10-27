import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addWorkingDays, requestDeadlines } from '../src/privacy/deadlines';

const holidays = new Set(['2026-09-01', '2026-09-02']);   // Quốc khánh 2026 (ví dụ)

test('ngày làm việc bỏ cuối tuần và ngày lễ', () => {
  assert.equal(addWorkingDays('2026-10-23', 2, holidays), '2026-10-27');   // thứ Sáu + 2 = thứ Ba
  assert.equal(addWorkingDays('2026-08-31', 2, holidays), '2026-09-04');   // qua hai ngày lễ
});

test('hạn theo loại yêu cầu, tính theo ngày giờ Việt Nam', () => {
  // 23:30 ngày 25/10 theo UTC là 06:30 ngày 26/10 ở Việt Nam
  assert.deepEqual(requestDeadlines('deletion', new Date('2026-10-25T23:30:00Z'), holidays), { ackDue: '2026-10-28', due: '2026-11-15' });
  assert.deepEqual(requestDeadlines('access', new Date('2026-10-26T03:00:00Z'), holidays), { ackDue: '2026-10-28', due: '2026-11-05' });
});
