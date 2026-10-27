-- Consent tables from the vibe-backend privacy reference (references/privacy.md)
CREATE TABLE consent_purposes (
  id         text    NOT NULL,              -- 'appointment_reminders', 'marketing_sms', 'ai_summary'
  version    integer NOT NULL,
  text_vi    text    NOT NULL,              -- the exact wording the user saw when consenting
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version)
);

-- Each consent or withdrawal is a new row; no UPDATE, no DELETE: this is evidence
CREATE TABLE consents (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid    NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  subject_id      uuid    NOT NULL,         -- the customer (or user) who is the data subject
  purpose_id      text    NOT NULL,
  purpose_version integer NOT NULL,
  granted         boolean NOT NULL,         -- true: consent; false: withdrawal
  method          text    NOT NULL CHECK (method IN ('web_form', 'app', 'sms', 'call_recording', 'paper')),
  evidence        jsonb   NOT NULL DEFAULT '{}',   -- e.g. IP, device, recording file id, who entered it
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (purpose_id, purpose_version) REFERENCES consent_purposes (id, version)
);
CREATE INDEX consents_lookup ON consents (tenant_id, subject_id, purpose_id, created_at DESC);
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consents
  USING (tenant_id = (SELECT app_current_tenant()))
  WITH CHECK (tenant_id = (SELECT app_current_tenant()));

-- Current state per purpose = the latest row.
-- security_invoker: the view runs with the caller's privileges, so RLS still applies (by default a view runs as its owner and bypasses RLS)
CREATE VIEW current_consents WITH (security_invoker = true) AS
SELECT DISTINCT ON (tenant_id, subject_id, purpose_id)
       tenant_id, subject_id, purpose_id, purpose_version, granted, created_at
  FROM consents
 ORDER BY tenant_id, subject_id, purpose_id, created_at DESC, id DESC;
