# Dữ liệu cá nhân: làm đúng luật Việt Nam từ trong code

**Đọc trước.** Đây là checklist kỹ thuật, không phải tư vấn pháp lý. Phần luật tóm tắt từ văn bản và các bài phân tích của công ty luật tới tháng 10/2026; số điều, thời hạn, mức phạt phải đối chiếu văn bản gốc (vbpl.vn, thuvienphapluat.vn, Công báo) và hỏi luật sư trước khi dùng làm căn cứ. Luật còn mới, hướng dẫn có thể thay đổi. SQL và code ở đây đã chạy trên PostgreSQL 16 và Node 22.

## Mục lục
1. Văn bản đang áp dụng
2. Bản đồ dữ liệu: biết mình giữ gì
3. Đồng ý (consent)
4. Yêu cầu của chủ dữ liệu
5. Dữ liệu nhạy cảm
6. Chuyển dữ liệu ra nước ngoài, bên xử lý
7. Lộ dữ liệu: 72 giờ
8. Lưu giữ và xoá
9. Trẻ em
10. Doanh nghiệp nhỏ, startup: được miễn gì, không được miễn gì

## 1. Văn bản đang áp dụng

| Văn bản | Hiệu lực | Ghi chú |
|---|---|---|
| Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15 | 01/01/2026 | Luật chính |
| Nghị định 356/2025/NĐ-CP | 01/01/2026 | Hướng dẫn chi tiết; thay thế toàn bộ Nghị định 13/2023/NĐ-CP |
| Nghị định 330/2026/NĐ-CP | 19/08/2026 | Xử phạt vi phạm hành chính về an ninh mạng và bảo vệ dữ liệu cá nhân |

Mẫu chính sách quyền riêng tư, hồ sơ đánh giá viết theo Nghị định 13/2023 đã cũ: làm lại theo luật mới.

Mức phạt tối đa (theo luật và các bản tóm tắt Nghị định 330): mua bán dữ liệu cá nhân tới 10 lần khoản thu từ vi phạm; vi phạm chuyển dữ liệu ra nước ngoài tới 5% doanh thu năm trước; vi phạm khác tới 3 tỷ đồng với tổ chức. Một số mức cụ thể được nêu: xử lý khi chưa có đồng ý hợp lệ 30 đến 50 triệu đồng.

**SaaS nhiều tenant**: với dữ liệu khách hàng của spa, thường spa là bên kiểm soát dữ liệu, còn bạn (nhà cung cấp phần mềm) là bên xử lý theo hợp đồng; với tài khoản người dùng và dữ liệu bạn tự dùng, bạn là bên kiểm soát. Ghi rõ vai trò trong hợp đồng với khách, và làm sẵn tính năng để tenant thực hiện được nghĩa vụ của họ (đồng ý, xuất dữ liệu, xoá).

## 2. Bản đồ dữ liệu: biết mình giữ gì

Tạo `docs/privacy/DATA-MAP.md` khi plan (skill `plan`) và cập nhật mỗi khi thêm bảng hoặc dịch vụ ngoài:

| Dữ liệu | Thuộc ai | Mục đích | Lưu ở đâu (bảng, dịch vụ, quốc gia) | Ai truy cập | Giữ bao lâu |
|---|---|---|---|---|---|
| Họ tên, số điện thoại khách | Khách của spa | Đặt lịch, nhắc lịch | `customers`, Postgres ở Singapore | Nhân viên spa đó | Đến khi spa xoá khách hoặc huỷ hợp đồng + 30 ngày |
| Ghi chú sức khoẻ (dị ứng) | Khách của spa | An toàn khi làm dịch vụ | `customer_notes` | Kỹ thuật viên, quản lý | Như trên |

Bản đồ này là nguồn cho chính sách quyền riêng tư, hồ sơ đánh giá tác động, và trả lời "bạn đang giữ gì về tôi".

## 3. Đồng ý (consent)

Yêu cầu chính (Luật điều 9, Nghị định 356 điều 6): đồng ý rõ ràng, **theo từng mục đích**; im lặng hay không phản hồi không phải là đồng ý; phải ghi lại được ai đồng ý, lúc nào, với nội dung gì; bên kiểm soát lưu bằng chứng và phải chứng minh khi có tranh chấp; người dùng rút lại được.

Trong code:

- Mỗi mục đích một ô riêng, **mặc định không chọn**; không gộp "đồng ý điều khoản + nhận quảng cáo + cho dùng AI" vào một nút.
- Việc cần để cung cấp dịch vụ đã ký (nhắc lịch hẹn khách đã đặt) và việc tuỳ chọn (tin khuyến mãi) tách riêng; việc tuỳ chọn không được chặn dịch vụ chính.
- Lưu đúng câu chữ người dùng thấy (có version), cách thu (web, app, ghi âm cuộc gọi, giấy) và bằng chứng.
- Rút lại phải dễ như khi đồng ý (một nút trong cài đặt, một tin "TU CHOI"...), có hiệu lực ngay với các job gửi tin.

```sql
-- Mục đích xử lý, có version: đổi câu chữ thì thêm version mới, không sửa version cũ
CREATE TABLE consent_purposes (
  id         text    NOT NULL,              -- 'appointment_reminders', 'marketing_sms', 'ai_summary'
  version    integer NOT NULL,
  text_vi    text    NOT NULL,              -- đúng câu chữ người dùng đã thấy khi đồng ý
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version)
);

-- Mỗi lần đồng ý hoặc rút lại là một dòng mới; không UPDATE, không DELETE: đây là bằng chứng
CREATE TABLE consents (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid    NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  subject_id      uuid    NOT NULL,         -- khách hàng (hoặc người dùng) là chủ dữ liệu
  purpose_id      text    NOT NULL,
  purpose_version integer NOT NULL,
  granted         boolean NOT NULL,         -- true: đồng ý; false: rút lại
  method          text    NOT NULL CHECK (method IN ('web_form', 'app', 'sms', 'call_recording', 'paper')),
  evidence        jsonb   NOT NULL DEFAULT '{}',   -- vd IP, thiết bị, id file ghi âm, người nhập
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (purpose_id, purpose_version) REFERENCES consent_purposes (id, version)
);
CREATE INDEX consents_lookup ON consents (tenant_id, subject_id, purpose_id, created_at DESC);
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consents
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));

-- Trạng thái hiện tại theo từng mục đích = dòng mới nhất.
-- security_invoker: view chạy với quyền người gọi nên RLS vẫn áp dụng (mặc định view chạy với quyền owner và bỏ qua RLS)
CREATE VIEW current_consents WITH (security_invoker = true) AS
SELECT DISTINCT ON (tenant_id, subject_id, purpose_id)
       tenant_id, subject_id, purpose_id, purpose_version, granted, created_at
  FROM consents
 ORDER BY tenant_id, subject_id, purpose_id, created_at DESC, id DESC;

-- Yêu cầu của chủ dữ liệu và hạn xử lý
CREATE TABLE privacy_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  subject_id      uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('access', 'correction', 'deletion', 'withdraw_consent', 'restrict', 'object')),
  received_at     timestamptz NOT NULL DEFAULT now(),
  ack_due         date NOT NULL,             -- app tính (privacy-deadlines.ts)
  due             date NOT NULL,
  acknowledged_at timestamptz,
  completed_at    timestamptz,
  outcome         text CHECK (outcome IN ('done', 'partially_done', 'refused')),
  CHECK ((completed_at IS NULL) = (outcome IS NULL))
);
ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON privacy_requests
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));
```

Đã kiểm trên Postgres 16: đồng ý rồi rút lại thì `current_consents` trả `granted = false`; role của app không UPDATE được bảng `consents`; tenant B đọc view có `security_invoker` thấy 0 dòng, còn cùng view đó mà thiếu `security_invoker` (owner là superuser) thì tenant B thấy được dòng của tenant A.

Job gửi tin khuyến mãi lọc `current_consents` với `granted = true` cho đúng mục đích, ngay lúc gửi (không phải lúc xếp job).

## 4. Yêu cầu của chủ dữ liệu

Quyền: được biết, truy cập, sửa, xoá, hạn chế xử lý, phản đối, rút lại đồng ý (Luật điều 4). Hạn theo Nghị định 356 điều 5 (các bản tóm tắt thống nhất ở các số dưới, đối chiếu văn bản gốc):

| Yêu cầu | Xác nhận đã nhận | Hoàn thành | Có bên xử lý/bên thứ ba tham gia |
|---|---|---|---|
| Truy cập, sửa, cung cấp dữ liệu | 2 ngày làm việc | 10 ngày | 15 ngày |
| Xoá | 2 ngày làm việc | 20 ngày | 30 ngày |
| Rút lại đồng ý, hạn chế, phản đối | 2 ngày làm việc | 15 ngày | 20 ngày |

```ts
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
```

Làm thành tính năng, không làm bằng tay qua email:

- Màn hình cho tenant nhận yêu cầu, xem hạn, đánh dấu đã xác nhận, đã xong (bảng `privacy_requests` ở mục 3). Job hằng ngày nhắc yêu cầu sắp tới hạn.
- **Xuất dữ liệu** của một khách: một nút tạo file JSON/CSV gồm mọi bảng có dữ liệu của người đó (bản đồ ở mục 2 cho biết bảng nào), chạy bằng job nền, gửi link tải có hạn.
- **Xoá**: xoá hoặc ẩn danh trong mọi bảng, file, cache, chỉ mục tìm kiếm, và gửi yêu cầu xoá tới bên xử lý (dịch vụ email, SMS, AI...). Dữ liệu phải giữ theo luật khác (hoá đơn, chứng từ kế toán) thì giữ phần bắt buộc và ghi lý do.
- Xác minh danh tính người yêu cầu trước khi xuất hay xoá, để không giao dữ liệu cho người mạo danh.

## 5. Dữ liệu nhạy cảm

Danh mục ở Nghị định 356 điều 4, gồm (không đầy đủ): tình trạng sức khoẻ, sinh trắc học, di truyền, đời sống tình dục, xu hướng tính dục, chủng tộc, tôn giáo, quan điểm chính trị, **vị trí từ dịch vụ định vị**, thông tin tài khoản ngân hàng, thẻ, lịch sử giao dịch, tín dụng, và theo một số bản tóm tắt cả dữ liệu theo dõi hành vi sử dụng dịch vụ trên mạng.

Với app spa, phòng khám, gym: ghi chú "dị ứng tinh dầu", "đang mang thai", "đau lưng" là **dữ liệu sức khoẻ**. Khi có loại dữ liệu này:

- Tách cột/bảng riêng, chỉ vai trò cần mới đọc được (kiểm ở cả API và RLS, `auth.md`), ghi log mỗi lần xem hoặc xuất.
- Không đưa vào log, analytics, email thông báo; không gửi cho dịch vụ AI nếu chưa có căn cứ và thông báo rõ (skill `ai`, `safety.md` mục 5).
- Mã hoá khi truyền đi (luôn HTTPS) và cân nhắc mã hoá thêm ở tầng ứng dụng cho cột nhạy cảm nhất.
- Xử lý dữ liệu nhạy cảm làm mất quyền miễn trừ của doanh nghiệp nhỏ (mục 10).

## 6. Chuyển dữ liệu ra nước ngoài, bên xử lý

Theo Luật điều 20 và các bài phân tích: dùng nền tảng đặt ở nước ngoài để xử lý dữ liệu thu ở Việt Nam (cloud, dịch vụ email, SMS, analytics, AI) **là chuyển dữ liệu ra nước ngoài**. Cần hồ sơ đánh giá tác động chuyển dữ liệu ra nước ngoài, gửi cơ quan chuyên trách (A05, Bộ Công an) trong 60 ngày kể từ lần chuyển đầu tiên; cập nhật khi có thay đổi.

Trong code và vận hành:

- Danh sách bên xử lý (subprocessor) trong `DATA-MAP.md`: tên, dữ liệu gửi đi, quốc gia, hợp đồng. Thêm dịch vụ mới thì thêm dòng trước khi gửi dữ liệu thật.
- Chỉ gửi trường cần thiết cho bên xử lý (vd dịch vụ SMS chỉ cần số điện thoại và nội dung).
- Chọn vùng đặt dữ liệu khi dịch vụ cho phép; ghi lựa chọn vào ADR.

## 7. Lộ dữ liệu: 72 giờ

Luật điều 23: khi phát hiện vi phạm có thể gây hại (an ninh, trật tự, hoặc tính mạng, sức khoẻ, danh dự, tài sản của chủ dữ liệu), bên kiểm soát thông báo cơ quan chuyên trách (A05) **trong 72 giờ kể từ khi phát hiện**, và lập biên bản. Bên xử lý phải báo ngay cho bên kiểm soát.

- Runbook sự cố (skill `fix`) có mục "nghi lộ dữ liệu": ai quyết định có phải thông báo không, ai gửi, mẫu thông báo, đồng hồ 72 giờ bắt đầu từ lúc phát hiện.
- Hợp đồng với bên xử lý và với tenant ghi rõ thời hạn báo cho nhau.
- Log đủ để trả lời "dữ liệu của ai, bao nhiêu người, từ lúc nào": log truy cập dữ liệu nhạy cảm, log xuất dữ liệu, log đăng nhập quản trị (`app-security.md` mục 7).

## 8. Lưu giữ và xoá

- Chỉ giữ dữ liệu trong thời gian cần cho mục đích; mục đích xong, hết hạn lưu, hay chủ dữ liệu yêu cầu thì xoá (Luật điều 14). Ghi thời hạn cho từng loại trong `DATA-MAP.md`.
- Job dọn theo lịch (skill `backend`, `jobs.md`): khách không hoạt động quá thời hạn, ứng viên không trúng tuyển, file xuất cũ, log cũ, dữ liệu của tenant đã huỷ hợp đồng.
- Bản sao lưu: không xoá được từng dòng trong backup; ghi rõ dữ liệu đã xoá sẽ biến mất khỏi backup khi backup hết hạn giữ (vd 30 ngày), và khi restore thì chạy lại các yêu cầu xoá đã xử lý trong khoảng đó (skill `ship`, `backup-restore.md`).
- Không dùng bản sao dữ liệu thật cho môi trường dev/test; dùng dữ liệu giả hoặc đã ẩn danh.

## 9. Trẻ em

Xử lý dữ liệu của trẻ em cần đồng ý của cha mẹ hoặc người giám hộ; công khai thông tin đời tư của trẻ từ đủ 7 tuổi cần đồng ý của cả trẻ và người đại diện (Luật điều 24). App có thể có người dùng dưới 16 tuổi thì cần bước hỏi tuổi và luồng xin đồng ý của phụ huynh; cách xác minh tuổi cụ thể chưa có hướng dẫn rõ, ghi quyết định vào ADR.

## 10. Doanh nghiệp nhỏ, startup: được miễn gì, không được miễn gì

Theo Luật điều 38: doanh nghiệp nhỏ và startup được chọn **chưa áp dụng** các quy định về hồ sơ đánh giá tác động xử lý dữ liệu (điều 21, 22) và yêu cầu nhân sự bảo vệ dữ liệu (điều 33 khoản 2) trong **5 năm từ 01/01/2026**; hộ kinh doanh và doanh nghiệp siêu nhỏ được miễn các mục đó.

Mất quyền miễn khi: cung cấp dịch vụ xử lý dữ liệu cá nhân, **trực tiếp xử lý dữ liệu nhạy cảm**, hoặc xử lý dữ liệu của số lượng lớn chủ thể (Nghị định 356 nêu từ 100.000 người, tính cộng dồn).

Không được miễn, áp dụng từ ngày đầu: đồng ý hợp lệ, quyền của chủ dữ liệu và thời hạn xử lý yêu cầu, bảo mật dữ liệu, thông báo lộ dữ liệu trong 72 giờ, và (theo cách đọc thận trọng) hồ sơ chuyển dữ liệu ra nước ngoài khi dùng dịch vụ đặt ở nước ngoài.

Phần mềm cho spa, phòng khám lưu ghi chú sức khoẻ là xử lý dữ liệu nhạy cảm, nên thường **không** được hưởng miễn trừ; tính từ đầu chi phí làm hồ sơ và người phụ trách.
