import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addWorkingDays, requestDeadlines } from '../src/privacy/deadlines';

const holidays = new Set(['2026-09-01', '2026-09-02']);   // National Day 2026 (example)

test('working days skip weekends and public holidays', () => {
  assert.equal(addWorkingDays('2026-10-23', 2, holidays), '2026-10-27');   // Friday + 2 = Tuesday
  assert.equal(addWorkingDays('2026-08-31', 2, holidays), '2026-09-04');   // across two holidays
});

test('deadline per request kind, counted in Vietnam time', () => {
  // 23:30 on 25 Oct UTC is 06:30 on 26 Oct in Vietnam
  assert.deepEqual(requestDeadlines('deletion', new Date('2026-10-25T23:30:00Z'), holidays), { ackDue: '2026-10-28', due: '2026-11-15' });
  assert.deepEqual(requestDeadlines('access', new Date('2026-10-26T03:00:00Z'), holidays), { ackDue: '2026-10-28', due: '2026-11-05' });
});
