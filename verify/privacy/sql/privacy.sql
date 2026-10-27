-- Processing purposes, versioned: new wording means a new version, never edit an old one.
-- Global, so read-only for the app: purposes are added by a migration or an audited admin flow.
CREATE TABLE consent_purposes (
  id         text    NOT NULL,              -- 'appointment_reminders', 'marketing_sms', 'ai_summary'
  version    integer NOT NULL,
  text_vi    text    NOT NULL,              -- the exact wording the user saw when consenting
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version)
);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON consent_purposes FROM app_user;
GRANT SELECT ON consent_purposes TO app_user;

-- Each consent or withdrawal is a new row: this is evidence
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
-- Append-only: the default privileges (postgres-rls.md section 1) also granted UPDATE and DELETE
REVOKE UPDATE, DELETE, TRUNCATE ON consents FROM app_user;

-- Current state per purpose = the latest row.
-- security_invoker: RLS applies to the caller, whoever owns the view (postgres-rls.md section 7, pitfall 7)
CREATE VIEW current_consents WITH (security_invoker = true) AS
SELECT DISTINCT ON (tenant_id, subject_id, purpose_id)
       tenant_id, subject_id, purpose_id, purpose_version, granted, created_at
  FROM consents
 ORDER BY tenant_id, subject_id, purpose_id, created_at DESC, id DESC;

-- Data subject requests and their deadlines
CREATE TABLE privacy_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant() REFERENCES tenants (id),
  subject_id      uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('access', 'correction', 'deletion', 'withdraw_consent', 'restrict', 'object')),
  received_at     timestamptz NOT NULL DEFAULT now(),
  ack_due         date NOT NULL,             -- computed by the app (privacy/deadlines.ts)
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
