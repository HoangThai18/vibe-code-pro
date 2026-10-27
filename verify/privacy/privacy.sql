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
