# Personal data: complying with Vietnamese law in code

**Read first.** This is an engineering checklist, not legal advice. The legal parts summarize the texts and law-firm analyses up to October 2026; verify article numbers, deadlines and fines against the original texts (vbpl.vn, thuvienphapluat.vn, the Official Gazette / Công báo) and ask a lawyer before relying on them. The law is new and guidance may change. SQL and code here ran on PostgreSQL 16 (as the app role, from an empty database) and Node 22.

## Contents
1. Applicable texts
2. Data map: know what you hold
3. Consent
4. Data subject requests
5. Sensitive data
6. Cross-border transfer, processors, storing data in Vietnam
7. Data breach: 72 hours
8. Retention and deletion
9. Children
10. Small businesses and startups: what is and is not exempt

## 1. Applicable texts

| Text | In force | Notes |
|---|---|---|
| Personal Data Protection Law No. 91/2025/QH15 (Luật Bảo vệ dữ liệu cá nhân) | 1 Jan 2026 | Main law |
| Decree 356/2025/NĐ-CP (Nghị định 356) | 1 Jan 2026 | Detailed guidance; fully replaces Decree 13/2023/NĐ-CP (Nghị định 13) |
| Decree 330/2026/NĐ-CP (Nghị định 330) | 19 Aug 2026 | Administrative penalties for cybersecurity and personal data protection violations |
| Decree 53/2022/NĐ-CP (Nghị định 53) | 1 Oct 2022 | Guides the 2018 Cybersecurity Law; Article 26: storing data in Vietnam (section 6). Check how it applies now that the 2025 law is in force |
| Cybersecurity Law No. 116/2025/QH15 (Luật An ninh mạng) | 1 Jul 2026 | Replaces the 2018 Cybersecurity Law and keeps an in-country storage duty; its guiding decree was a draft in October 2026 (check) |

Privacy policy templates and assessment dossiers written under Decree 13/2023 are outdated: redo them under the new law.

Maximum fines (per the law and summaries of Decree 330): selling personal data, up to 10 times the revenue from the violation; cross-border transfer violations, up to 5% of the previous year's revenue; other violations, up to VND 3 billion for organizations. One specific figure cited: processing without valid consent, VND 30 to 50 million.

**Multi-tenant SaaS**: for the spa's customer data, the spa is usually the controller and you (the software vendor) the processor under contract; for user accounts and data you use for your own purposes, you are the controller. State the roles in the customer contract, and build features that let tenants meet their obligations (consent, data export, deletion).

## 2. Data map: know what you hold

Create `docs/privacy/DATA-MAP.md` during planning (the `vibe-plan` skill) and update it whenever you add a table or external service:

| Data | Whose | Purpose | Stored where (table, service, country) | Who has access | Retention |
|---|---|---|---|---|---|
| Customer name, phone number | The spa's customers | Booking, reminders | `customers`, Postgres, region per the hosting ADR (section 6) | That spa's staff | Until the spa deletes the customer or ends the contract + 30 days |
| Health notes (allergies) | The spa's customers | Safety during services | `customer_notes` | Technicians, managers | Same as above |

This map feeds the privacy policy, the impact assessment dossier, and the answer to "what do you hold about me".

## 3. Consent

Main requirements (Law Article 9, Decree 356 Article 6): explicit consent, **per purpose**; silence or no response is not consent; you must be able to record who consented, when, and to what wording; the controller keeps the evidence and must prove consent in a dispute; users can withdraw.

In code:

- One checkbox per purpose, **unchecked by default**; never bundle "accept terms + receive marketing + allow AI" into one button.
- Keep what is needed to deliver the contracted service (reminders for appointments the customer booked) separate from optional processing (promotional messages); optional items must not block the main service.
- Store the exact wording the user saw (versioned), the collection method (web, app, call recording, paper) and the evidence.
- Withdrawing must be as easy as consenting (one button in settings, an SMS "TU CHOI"...), and takes effect immediately for messaging jobs.

```sql
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
```

Verified on Postgres 16 as the app role: consenting then withdrawing makes `current_consents` return `granted = false`; the app role cannot UPDATE, DELETE or TRUNCATE `consents` nor write `consent_purposes` (removing the REVOKE fails the test); tenant B reading the view with `security_invoker` sees 0 rows, while the same view without `security_invoker`, owned by a superuser, shows tenant B the rows of tenant A.

The promotional messaging job filters `current_consents` on `granted = true` for the right purpose at send time (not at enqueue time).

## 4. Data subject requests

Rights: to be informed, access, correct, delete, restrict processing, object, withdraw consent (Law Article 4). Deadlines per Decree 356 Article 5 (summaries agree on the figures below; verify against the original text):

| Request | Acknowledge receipt | Complete | With a processor/third party involved |
|---|---|---|---|
| Access, correction, data provision | 2 working days | 10 days | 15 days |
| Deletion | 2 working days | 20 days | 30 days |
| Consent withdrawal, restriction, objection | 2 working days | 15 days | 20 days |

```ts
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
```

Build this as a feature, not as manual work over email:

- A tenant screen to receive requests, see deadlines, and mark them acknowledged and done (`privacy_requests` table in section 3). A daily job reminds about requests close to their deadline; it lists tenants with `app_tenant_ids()` and reads each inside `withTenant` (`references/jobs.md`), since a plain `SELECT` on `tenants` returns 0 rows to a worker.
- **Data export** for one customer: one button that produces a JSON/CSV file with every table holding that person's data (the map in section 2 says which), run as a background job, sending an expiring download link.
- **Deletion**: delete or anonymize across all tables, files, caches and search indexes, and send deletion requests to processors (email, SMS, AI services...). For data other laws require you to keep (invoices, accounting records), keep the mandatory part and record the reason.
- Verify the requester's identity before exporting or deleting, so data does not go to an impersonator.

## 5. Sensitive data

The list is in Decree 356 Article 4 and includes (not exhaustive): health status, biometrics, genetics, sex life, sexual orientation, race, religion, political opinions, **location from location services**, bank account information, cards, transaction history, credit, and, according to some summaries, data tracking online service usage behavior.

For spa, clinic and gym apps, notes like "essential oil allergy", "pregnant" or "back pain" are **health data**. When you hold this kind of data:

- Put it in a separate column/table readable only by roles that need it, checked in both the API (`auth.md`) and RLS (a policy on `app.member_role`, `postgres-rls.md` section 4); log every view or export.
- Keep it out of logs, analytics and notification emails; do not send it to an AI service without a legal basis and clear notice (the `vibe-ai` skill, `references/safety.md` section 5).
- Encrypt in transit (always HTTPS) and consider extra application-level encryption for the most sensitive columns.
- Processing sensitive data forfeits the small-business exemption (section 10).

## 6. Cross-border transfer, processors, storing data in Vietnam

Per Law Article 20 and published analyses: using a platform located abroad to process data collected in Vietnam (cloud, email, SMS, analytics, AI services) **is a cross-border transfer**. You need a cross-border transfer impact assessment dossier, filed with the specialized agency (A05, Ministry of Public Security / Bộ Công an) within 60 days of the first transfer; update it when things change.

In code and operations:

- A processor (subprocessor) list in `DATA-MAP.md`: name, data sent, country, contract. When adding a new service, add the row before sending real data.
- Send processors only the fields they need (e.g. an SMS service needs only the phone number and message text).
- Choose the data region when the service allows it; record the choice in an ADR.

**Storing data in Vietnam.** Decree 53/2022/NĐ-CP Article 26 requires **domestic enterprises** providing services over telecom networks or the internet to store in Vietnam the personal data of their users in Vietnam, the data those users create, and data on their relationships, for at least 24 months per published summaries (the clause is ambiguous: verify). The Cybersecurity Law No. 116/2025/QH15 (in force 1 July 2026) keeps an in-country storage duty; its guiding decree was still a draft in October 2026. A Vietnamese company selling SaaS is a domestic enterprise. Decide the hosting region for the database, backups and logs with a lawyer before launch, record it in an ADR (the `vibe-plan` skill), and revisit it when the decree is issued.

## 7. Data breach: 72 hours

Law Article 23: on discovering a violation that may cause harm (to national security, public order, or the data subject's life, health, honor or property), the controller notifies the specialized agency (A05) **within 72 hours of discovery** and makes a written record. A processor must notify the controller immediately.

- The incident runbook (the `vibe-fix` skill) has a "suspected data leak" section: who decides whether notification is required, who sends it, the notice template, and the 72-hour clock starting at discovery.
- Contracts with processors and with tenants state the deadline for notifying each other.
- Logs good enough to answer "whose data, how many people, since when": sensitive-data access logs, export logs, admin login logs (`app-security.md` section 7).

## 8. Retention and deletion

- Keep data only as long as the purpose requires; delete it when the purpose is fulfilled, the retention period ends, or the data subject asks (Law Article 14). Record the retention period for each type in `DATA-MAP.md`.
- Scheduled cleanup jobs (`jobs.md`): customers inactive beyond the retention period, rejected job applicants, old export files, old logs, data of tenants whose contracts ended.
- Backups: single rows cannot be deleted from a backup; state that deleted data disappears from backups once they expire (e.g. 30 days), and on restore, replay the deletion requests processed in that window (the `vibe-ship` skill, `references/backup-restore.md`).
- Never use copies of real data in dev/test environments; use fake or anonymized data.

## 9. Children

Processing children's data requires consent from a parent or guardian; publishing private information of a child aged 7 or older requires consent from both the child and their representative (Law Article 24). If the app may have users under 16, add an age question and a parental consent flow; there is no clear guidance yet on how to verify age, so record the decision in an ADR.

## 10. Small businesses and startups: what is and is not exempt

Per Law Article 38: small businesses and startups may choose **not to apply yet** the rules on data processing impact assessment dossiers (Articles 21, 22) and the data protection staff requirement (Article 33, clause 2) for **5 years from 1 Jan 2026**; household businesses and micro-enterprises are exempt from those items.

The exemption is lost when you provide personal data processing services, **directly process sensitive data**, or process data of a large number of data subjects (Decree 356 sets this at 100,000 people, cumulative).

Not exempt, applying from day one: valid consent, data subject rights and request deadlines, data security, 72-hour breach notification, and (on a cautious reading) the cross-border transfer dossier when using services located abroad.

Software for spas and clinics that stores health notes processes sensitive data, so it usually does **not** qualify for the exemption; budget for the dossiers and a responsible person from the start.
