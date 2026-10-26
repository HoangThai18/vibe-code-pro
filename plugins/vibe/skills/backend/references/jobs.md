# Job nền: hàng đợi, thử lại, chạy theo lịch

Code và SQL dưới đây đã chạy với pg-boss 12.38, node-postgres, PostgreSQL 16 có RLS (`FORCE`), role app không bypass RLS. Bỏ từng lớp bảo vệ (UNIQUE + `ON CONFLICT`, kiểm `status = 'pending'`, kiểm lịch đã huỷ, cận dưới của cửa sổ thời gian) thì lần nào cũng có test fail.

## Mục lục
1. Khi nào cần job nền
2. Chọn công cụ
3. Ví dụ: nhắc lịch hẹn trước 24 giờ
4. Quy tắc cho mọi job
5. Test
6. Vận hành

## 1. Khi nào cần job nền

- Việc chậm hoặc gọi ra ngoài mà người dùng không cần chờ: gửi email/SMS/Zalo, gọi webhook, tạo file xuất, gọi AI hàng loạt.
- Việc phải xảy ra chắc chắn dù request đã trả về: gửi hoá đơn sau khi thanh toán, đồng bộ sang hệ thống khác.
- Việc theo lịch: nhắc lịch hẹn, tổng hợp báo cáo đêm, dọn dữ liệu hết hạn.

Ghi DB và xếp job phải nằm **cùng một transaction** (mẫu outbox, skill `backend`, `data-layer.md`): commit thì job chắc chắn tồn tại; rollback thì không có job "ma" gửi tin cho đơn hàng không tồn tại.

## 2. Chọn công cụ

| Đã có | Dùng | Ghi chú |
|---|---|---|
| PostgreSQL, Node | pg-boss | Job nằm trong DB đang có, xếp job trong cùng transaction được, không thêm hệ thống phải vận hành |
| PostgreSQL, Rails / Elixir / Python | Solid Queue hoặc GoodJob / Oban / Procrastinate | Cùng ý tưởng |
| Redis sẵn có, khối lượng rất lớn | BullMQ, Sidekiq, Celery | Nhanh hơn, nhưng xếp job không cùng transaction với DB: cần bảng outbox |
| Cloud | SQS, Cloud Tasks, Cloud Scheduler | Hợp khi đã chạy serverless |

Mặc định chọn loại chạy trên DB đang có. Chuyển sang Redis hay queue riêng khi đo được DB là nút thắt (skill `ship`, `performance.md`), không chuyển trước.

## 3. Ví dụ: nhắc lịch hẹn trước 24 giờ

Một job theo lịch quét mỗi 10 phút, tạo bản ghi `notifications` và xếp một job gửi cho mỗi lịch hẹn cần nhắc. Worker gửi tin, lỗi thì thử lại với backoff, hết lượt thì vào dead letter queue.

```sql
CREATE TABLE notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  appointment_id uuid NOT NULL REFERENCES appointments (id),
  kind           text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped')),
  sent_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, kind)            -- mỗi lịch hẹn chỉ một lần nhắc mỗi loại
);
CREATE INDEX notifications_tenant ON notifications (tenant_id);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
```

```ts
// apps/api/src/jobs/queues.ts
import { PgBoss } from 'pg-boss';

export const Q = {
  enqueueReminders: 'enqueue-reminders',
  sendReminder: 'send-reminder',
  sendReminderDead: 'send-reminder-dead',
} as const;

export interface SendReminderJob {
  tenantId: string;
  notificationId: string;
}

// Gọi lúc process khởi động; tạo queue và lịch nếu chưa có
export async function setupQueues(boss: PgBoss, retry = { retryLimit: 5, retryDelay: 30 }): Promise<void> {
  await boss.createQueue(Q.sendReminderDead, { retentionSeconds: 30 * 24 * 3600 });
  await boss.createQueue(Q.sendReminder, {
    ...retry,                 // thử lại 5 lần, chờ 30s, 60s, 120s... (backoff có jitter), tối đa 1 giờ
    retryBackoff: true,
    retryDelayMax: 3600,
    expireInSeconds: 120,     // job chạy quá 2 phút coi như treo: thử lại
    deadLetter: Q.sendReminderDead,
  });
  // singleton: mỗi lúc chỉ một lần quét chạy, lần quét chậm không chồng lên lần sau
  await boss.createQueue(Q.enqueueReminders, { policy: 'singleton', retryLimit: 0 });
  await boss.schedule(Q.enqueueReminders, '*/10 * * * *', null, { tz: 'Asia/Ho_Chi_Minh' });
}
```

```ts
// apps/api/src/jobs/reminders.ts
import type { PgBoss } from 'pg-boss';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../db/tenant';
import { Q, type SendReminderJob } from './queues';

export interface SmsSender {
  // Nhà cung cấp SMS/Zalo nhận idempotencyKey: gửi lại cùng key thì không gửi tin thứ hai
  send(input: { to: string; text: string; idempotencyKey: string }): Promise<void>;
}

// pg-boss ghi job bằng chính transaction của bạn: job chỉ tồn tại nếu transaction commit
const inTx = (db: PoolClient) => ({ db: { executeSql: (text: string, values?: unknown[]) => db.query(text, values) } });

// Job theo lịch: tìm lịch hẹn cần nhắc ở từng tenant (giữ RLS), tạo notification + job gửi cùng một transaction
export async function enqueueReminders(pool: Pool, boss: PgBoss): Promise<number> {
  const { rows: tenants } = await pool.query<{ id: string }>('SELECT id FROM tenants');
  let queued = 0;
  for (const tenant of tenants) {
    queued += await withTenant(pool, tenant.id, async (db) => {
      // Cửa sổ rộng (2 đến 24 giờ tới) + UNIQUE: lần quét bị lỡ vẫn bù được, không nhắc hai lần
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO notifications (tenant_id, appointment_id, kind)
         SELECT tenant_id, id, 'reminder_24h' FROM appointments
          WHERE status = 'booked'
            AND starts_at >  now() + interval '2 hours'
            AND starts_at <= now() + interval '24 hours'
         ON CONFLICT (appointment_id, kind) DO NOTHING
         RETURNING id`,
      );
      for (const n of rows) {
        await boss.send(Q.sendReminder, { tenantId: tenant.id, notificationId: n.id } satisfies SendReminderJob, inTx(db));
      }
      return rows.length;
    });
  }
  return queued;
}

// Worker: chạy lại bao nhiêu lần cũng chỉ gửi một tin
export async function sendReminder(pool: Pool, sms: SmsSender, job: SendReminderJob): Promise<'sent' | 'skipped'> {
  const row = await withTenant(pool, job.tenantId, async (db) => {
    const { rows } = await db.query<{ status: string; booked: boolean; phone: string; name: string; starts_at: Date }>(
      `SELECT n.status, a.status = 'booked' AS booked, a.customer_phone AS phone, a.customer_name AS name, a.starts_at
         FROM notifications n JOIN appointments a ON a.id = n.appointment_id
        WHERE n.id = $1`,
      [job.notificationId],
    );
    return rows[0];
  });
  if (!row || row.status !== 'pending') return 'skipped';   // đã gửi, đã bỏ, hoặc không thuộc tenant này (RLS)
  if (!row.booked) {
    await setStatus(pool, job, 'skipped');                    // lịch đã huỷ sau khi xếp job
    return 'skipped';
  }

  const when = row.starts_at.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' });
  // Gọi ra ngoài KHÔNG nằm trong transaction DB; lỗi thì ném ra để pg-boss thử lại
  await sms.send({ to: row.phone, text: `Chào ${row.name}, nhắc lịch hẹn của bạn lúc ${when}.`, idempotencyKey: job.notificationId });
  await setStatus(pool, job, 'sent');
  return 'sent';
}

function setStatus(pool: Pool, job: SendReminderJob, status: 'sent' | 'skipped') {
  return withTenant(pool, job.tenantId, (db) =>
    db.query(
      `UPDATE notifications SET status = $2, sent_at = CASE WHEN $2 = 'sent' THEN now() END
        WHERE id = $1 AND status = 'pending'`,
      [job.notificationId, status],
    ),
  );
}
```

```ts
// apps/api/src/jobs/worker.ts — process riêng: node dist/jobs/worker.js
import { PgBoss } from 'pg-boss';
import pg from 'pg';
import { Q, setupQueues, type SendReminderJob } from './queues';
import { enqueueReminders, sendReminder, type SmsSender } from './reminders';

export async function startWorker(opts: {
  databaseUrl: string;
  sms: SmsSender;
  pollingIntervalSeconds?: number;
  retry?: { retryLimit: number; retryDelay: number };
}) {
  const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 10 });
  const boss = new PgBoss(opts.databaseUrl);
  boss.on('error', (err) => console.error('pg-boss', err));   // dùng logger của dự án
  await boss.start();
  await setupQueues(boss, opts.retry);

  const polling = { pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 2 };
  await boss.work(Q.enqueueReminders, polling, async () => {
    await enqueueReminders(pool, boss);
  });
  await boss.work<SendReminderJob>(Q.sendReminder, { ...polling, localConcurrency: 5 }, async ([job]) => {
    await sendReminder(pool, opts.sms, job!.data);
  });

  // Deploy gửi SIGTERM: nhận thêm job thì dừng, chờ job đang chạy xong (tối đa 30s) rồi mới thoát
  const stop = async () => {
    await boss.stop({ graceful: true, timeout: 30_000 });
    await pool.end();
  };
  process.once('SIGTERM', () => void stop());
  return { boss, pool, stop };
}
```

`withTenant` lấy từ `postgres-rls.md` mục 4. Role của app cần quyền tạo schema `pgboss` ở lần chạy đầu (hoặc chạy migration của pg-boss bằng CLI `pg-boss` trong bước migrate của CI, rồi chỉ cấp quyền dùng); bảng của pg-boss không thuộc tenant nên không có RLS.

Vì sao viết như vậy:

- **Quét theo tenant, trong `withTenant`**: job không có request nên không có tenant sẵn; lặp từng tenant giữ được RLS, không cần role bypass. Hàng nghìn tenant thì vẫn ổn; nhiều hơn nữa thì quét bằng role maintenance và xếp job mang theo `tenantId`.
- **Job chỉ chứa id** (`tenantId`, `notificationId`), không chứa số điện thoại hay nội dung tin: dữ liệu đọc lại lúc chạy nên luôn mới (lịch đã huỷ thì không gửi), và không nằm rải rác trong bảng job.
- **Gọi nhà cung cấp ngoài transaction**, cập nhật trạng thái sau. Nếu process chết đúng lúc giữa hai bước, lần thử lại gửi lại với cùng `idempotencyKey`: nhà cung cấp có hỗ trợ khoá này thì không gửi trùng; không hỗ trợ thì chấp nhận hiếm khi trùng một tin, hoặc thêm trạng thái `sending` và cho người kiểm khi thấy kẹt.

## 4. Quy tắc cho mọi job

1. **Idempotent**: chạy hai lần cho cùng kết quả như một lần. Queue nào cũng có lúc giao job hai lần (worker chết, hết `expireInSeconds`).
2. **Payload nhỏ, có `tenantId`**, đọc dữ liệu mới nhất lúc chạy. Đổi cấu trúc payload thì worker mới phải đọc được payload cũ còn trong hàng đợi.
3. **Thử lại có giới hạn và backoff**; lỗi không thể tự hết (dữ liệu sai, 4xx từ API ngoài) thì đừng thử lại vô ích: đánh dấu bỏ qua và ghi log, hoặc đưa thẳng vào dead letter.
4. **Có dead letter queue và cảnh báo khi nó có job.** Job trong đó cần người xem: sửa nguyên nhân rồi chạy lại (`boss.redrive(...)`).
5. **Timeout cho mọi lệnh gọi ra ngoài** ngắn hơn `expireInSeconds` của queue, để job không bị coi là treo khi vẫn đang chạy.
6. **Dừng êm khi deploy**: nhận `SIGTERM` thì thôi nhận job mới, chờ job đang chạy xong (`boss.stop({ graceful: true })`).
7. **Job theo lịch không chồng nhau**: queue `singleton`, hoặc khoá; và chịu được việc bị lỡ một lần chạy (cửa sổ thời gian rộng + ràng buộc UNIQUE như ví dụ).
8. **Giờ theo múi giờ của nghiệp vụ** (`tz: 'Asia/Ho_Chi_Minh'`), không theo giờ máy chủ.

## 5. Test

Test với DB thật (như `isolation-tests.md`), worker thật, nhà cung cấp SMS giả:

```ts
// test/reminders.test.ts — chạy với DB test thật: DATABASE_URL=postgres://... node --import tsx --test
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { withTenant } from '../src/db/tenant';
import { Q, setupQueues, type SendReminderJob } from '../src/jobs/queues';
import { enqueueReminders, sendReminder, type SmsSender } from '../src/jobs/reminders';
import { startWorker } from '../src/jobs/worker';

const url = process.env.DATABASE_URL!;
const pool = new pg.Pool({ connectionString: url });
const boss = new PgBoss(url);
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function fakeSms(failTimes = 0) {
  const sent: { to: string; text: string; idempotencyKey: string }[] = [];
  let failuresLeft = failTimes;
  const sms: SmsSender = {
    async send(message) {
      if (failuresLeft-- > 0) throw new Error('Nhà cung cấp SMS lỗi');
      sent.push(message);
    },
  };
  return { sms, sent };
}

async function seed(tenantId: string, rows: { name: string; inHours: number; status?: string }[]) {
  return withTenant(pool, tenantId, async (db) => {
    const ids: string[] = [];
    for (const r of rows) {
      const { rows: [row] } = await db.query<{ id: string }>(
        `INSERT INTO appointments (tenant_id, customer_name, customer_phone, starts_at, status)
         VALUES ($1, $2, '0912345678', now() + make_interval(hours => $3), $4) RETURNING id`,
        [tenantId, r.name, r.inHours, r.status ?? 'booked'],
      );
      ids.push(row!.id);
    }
    return ids;
  });
}

const notificationStatus = (tenantId: string) =>
  withTenant(pool, tenantId, async (db) => (await db.query<{ status: string }>('SELECT status FROM notifications')).rows.map((r) => r.status));

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 20_000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('Hết thời gian chờ');
    await new Promise((r) => setTimeout(r, 200));
  }
}

before(async () => {
  boss.on('error', console.error);
  await boss.start();
});
after(async () => {
  await boss.stop({ graceful: false });
  await pool.end();
});
beforeEach(async () => {
  await pool.query('TRUNCATE notifications, appointments');
  for (const name of Object.values(Q)) await boss.deleteQueue(name);
});

test('quét: chỉ lịch hẹn trong 2 đến 24 giờ tới, của mọi tenant, mỗi lịch một lần', async () => {
  await setupQueues(boss);
  await seed(A, [{ name: 'Lan', inHours: 10 }, { name: 'Sớm', inHours: 1 }, { name: 'Xa', inHours: 30 }, { name: 'Huỷ', inHours: 20, status: 'cancelled' }]);
  await seed(B, [{ name: 'Minh', inHours: 5 }]);

  assert.equal(await enqueueReminders(pool, boss), 2);
  assert.equal(await enqueueReminders(pool, boss), 0);          // chạy lại: không nhắc trùng
  const jobs = await boss.fetch<SendReminderJob>(Q.sendReminder, { batchSize: 10 });
  assert.deepEqual(jobs.map((j) => j.data.tenantId).sort(), [A, B]);
});

test('transaction rollback thì job cũng không tồn tại', async () => {
  await setupQueues(boss);
  await assert.rejects(
    withTenant(pool, A, async (db) => {
      await boss.send(Q.sendReminder, { tenantId: A, notificationId: 'x' }, { db: { executeSql: (t, v) => db.query(t, v) } });
      throw new Error('lỗi nghiệp vụ sau khi xếp job');
    }),
  );
  assert.equal((await boss.fetch(Q.sendReminder)).length, 0);
});

test('worker gửi đúng một tin; chạy lại job cũng không gửi lại', async () => {
  const { sms, sent } = fakeSms();
  await seed(A, [{ name: 'Lan', inHours: 10 }]);
  const worker = await startWorker({ databaseUrl: url, sms, pollingIntervalSeconds: 0.5 });
  try {
    await enqueueReminders(pool, worker.boss);
    await waitFor(async () => (await notificationStatus(A))[0] === 'sent');
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.text, /Chào Lan, nhắc lịch hẹn của bạn lúc/);
    const { rows: [n] } = await withTenant(pool, A, (db) => db.query<{ id: string }>('SELECT id FROM notifications'));
    assert.equal(sent[0]!.idempotencyKey, n!.id);
    assert.equal(await sendReminder(pool, sms, { tenantId: A, notificationId: n!.id }), 'skipped');
    assert.equal(sent.length, 1);
  } finally {
    await worker.stop();
  }
});

test('nhà cung cấp lỗi thì thử lại; hết lượt thì job vào dead letter', async () => {
  const flaky = fakeSms(1);
  await seed(A, [{ name: 'Lan', inHours: 10 }]);
  let worker = await startWorker({ databaseUrl: url, sms: flaky.sms, pollingIntervalSeconds: 0.5, retry: { retryLimit: 2, retryDelay: 1 } });
  try {
    await enqueueReminders(pool, worker.boss);
    await waitFor(() => flaky.sent.length === 1);                 // lỗi lần đầu, lần thử lại thành công
  } finally {
    await worker.stop();
  }

  await pool.query('TRUNCATE notifications, appointments');
  const down = fakeSms(100);
  await seed(B, [{ name: 'Minh', inHours: 10 }]);
  worker = await startWorker({ databaseUrl: url, sms: down.sms, pollingIntervalSeconds: 0.5, retry: { retryLimit: 1, retryDelay: 1 } });
  try {
    await enqueueReminders(pool, worker.boss);
    await waitFor(async () => (await boss.fetch(Q.sendReminderDead)).length === 1);
    assert.deepEqual(await notificationStatus(B), ['pending']);    // chưa gửi: xử lý tay rồi redrive
    assert.equal(down.sent.length, 0);
  } finally {
    await worker.stop();
  }
});

test('id của tenant khác hoặc lịch đã huỷ thì không gửi', async () => {
  await setupQueues(boss);
  const { sms, sent } = fakeSms();
  const [appointmentId] = await seed(A, [{ name: 'Lan', inHours: 10 }]);
  await enqueueReminders(pool, boss);
  const { rows: [n] } = await withTenant(pool, A, (db) => db.query<{ id: string }>('SELECT id FROM notifications'));

  assert.equal(await sendReminder(pool, sms, { tenantId: B, notificationId: n!.id }), 'skipped');   // RLS: B không thấy
  await withTenant(pool, A, (db) => db.query("UPDATE appointments SET status = 'cancelled' WHERE id = $1", [appointmentId]));
  assert.equal(await sendReminder(pool, sms, { tenantId: A, notificationId: n!.id }), 'skipped');
  assert.deepEqual(await notificationStatus(A), ['skipped']);
  assert.equal(sent.length, 0);
});

test('lịch quét chạy mỗi 10 phút theo giờ Việt Nam', async () => {
  await setupQueues(boss);
  const [schedule] = await boss.getSchedules(Q.enqueueReminders);
  assert.equal(schedule?.cron, '*/10 * * * *');
  assert.equal(schedule?.timezone, 'Asia/Ho_Chi_Minh');
});
```

- Chạy tuần tự (`--test-concurrency=1`) vì các test dùng chung DB và queue.
- `pollingIntervalSeconds: 0.5` và retry ngắn chỉ dùng trong test để chạy nhanh.

## 6. Vận hành

- Chạy worker thành process riêng (cùng image với API, khác lệnh chạy) để scale và deploy độc lập; API chỉ xếp job.
- Theo dõi (skill `ship`, `observability.md`): số job đang chờ theo queue (`boss.getQueue(name)` có `queuedCount`, `activeCount`, `failedCount`), thời gian chờ của job cũ nhất, tỉ lệ lỗi, số job trong dead letter. Cảnh báo khi hàng đợi tăng mãi hoặc dead letter khác 0.
- pg-boss tự xoá job đã xong sau `deleteAfterSeconds` (mặc định 7 ngày); kiểm dung lượng bảng job nếu khối lượng lớn.
- Tắt một loại job khi có sự cố: `boss.offWork(name)` hoặc cờ cấu hình, rồi xếp lại sau.
