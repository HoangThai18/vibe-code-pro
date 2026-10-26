# PRD: Product name

_Version v0.1 · YYYY-MM-DD · Status: draft / approved_

## 1. Problem
Who has what problem, how they solve it today, why that falls short. 3–5 sentences.

## 2. Users and roles
| Role | Who they are | Main jobs in the system |
|---|---|---|
| Shop owner | ... | ... |
| Staff | ... | ... |

## 3. Goals for this version
- Measurable outcomes, e.g. "Staff book an appointment for a customer in under 30 seconds"
- ...

## 4. Main flows
1. As a **role**, I want **action** so that **benefit**.
   - Acceptance criteria: ...
2. ...

## 5. Scope
**In scope:**
- ...

**Out of scope (not in this version):**
- ...

## 6. Non-functional requirements
- Multi-tenant: yes / no. Model: ... (see ARCHITECTURE.md)
- Security and data: which personal data (any sensitive data: health, location, finance, children?), who can see it, retention, which foreign services receive it
- Scale: expected tenants, users, records after 12 months
- Performance: p95 per endpoint group at target load (e.g. lists under 300 ms at 100 requests/second); Core Web Vitals "good" (LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1)
- AI features (if any): what job, can users edit the output, estimated monthly cost, per-tenant budget
- Platforms: web / iOS, Android app / Windows, macOS, Linux app; minimum OS versions
- Languages, devices, browsers: ...
- Offline: not needed / read-only / write while offline (mobile, desktop apps)

## 7. Integrations
| System | Purpose | Required in this version? |
|---|---|---|

## 8. Assumptions and open questions
**Assumptions** (user corrects if wrong):
- ...

**Open questions:**
- ...
