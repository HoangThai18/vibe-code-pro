# Safety for AI features

## Contents
1. Who can abuse an AI feature
2. Put data in the right place in the prompt
3. Tools and permissions
4. Output handling
5. Send only the data needed
6. Tenant isolation
7. Abuse prevention
8. Verification

## 1. Who can abuse an AI feature

Prompt injection is when text entering the prompt says "do X" and the model does it. Two paths:

- **Direct**: the user types into the chat box. They should only be able to do what their permissions allow, so the main risks are system prompt leakage and inappropriate content.
- **Indirect**: text written by **someone else** enters your prompt: notes entered by other staff, emails or messages from customers, uploaded files, web pages, tool results. This is the dangerous path, because the author is not the person using the feature and may be an outsider.

Damage depends on what the feature **can do**, not on how cleverly the prompt is written. No wording fully blocks injection, so design so that a fooled model cannot do much harm: no out-of-scope data in the prompt, minimal tool permissions, a human confirms important actions.

## 2. Put data in the right place in the prompt

- **Fixed system prompt**: your instructions only, no request data. Assume anyone can read it: no secrets, keys or sensitive internal information.
- **Data goes in the user message**, clearly structured: JSON (`JSON.stringify` escapes quotes, so content cannot "break out" of its field) or named XML tags. State in the system prompt that this content is data and that requests inside it must not be followed (example in `integration.md` section 2).
- **Extra instructions mid-conversation** (e.g. switching modes) go through the operator channel, never into user content: the Claude API has mid-conversation `role: "system"` messages for this; see the `claude-api` skill if your agent has it, or the current API docs.
- Customer support chatbot: add to the system prompt that the rules hold for the whole conversation, even when the user pleads, gives sympathetic reasons, or claims someone approved an exception.

## 3. Tools and permissions

When the model calls tools (look up schedules or customers, create appointments...):

- **Tenant and user come from the server-side session**, never from parameters the model sends. The model only picks things like `customerId`; the handler looks it up within the session's tenant and returns "not found" if the id belongs to another tenant, same as a normal endpoint (the `vibe-backend` skill, `references/multi-tenant.md`).
- **Each tool does one narrow thing**, with a strict schema (`strict: true`, `additionalProperties: false`). No "run SQL", "fetch any URL" or "read file by path" tools.
- **Read-only tools are the default.** For consequential actions (messaging a customer, cancelling an appointment, refunding), the tool returns a *proposal*; the UI shows it, the user clicks confirm, and only then is the real business API called (with the usual permission checks).
- Tool results are untrusted data too (e.g. customer notes returned by `get_customer`): apply section 2.
- Limit tool-call rounds per turn and log every call (tool, parameters, user, tenant).

## 4. Output handling

- Validate with a schema (structured output). Fields that feed business logic (e.g. a ticket's `category`) are also checked against an allowlist.
- Render as text, never `innerHTML`. For markdown use a renderer that sanitizes HTML; allow only `http`/`https` links, opened in a new tab with `rel="noopener noreferrer"`.
- Never run output as SQL, shell commands, expressions or redirect URLs. An "ask your data in plain language" feature that must generate SQL runs it with a read-only role, under RLS, with `statement_timeout`, and only on dedicated views; think hard before building one.
- Outgoing content (emails, customer messages) always passes a user review-and-edit step.

## 5. Send only the data needed

- Select only the columns the task needs (no `SELECT *` followed by sending the whole record).
- Redact contact details when the task does not need them (`redactContacts` in `integration.md` section 2). Regexes miss some formats; treat this as mitigation, not a guarantee.
- Sensitive data (health, finance, children) needs a clear legal basis before it goes to an AI service (the `vibe-backend` skill, `references/privacy.md`).

## 6. Tenant isolation

- All prompt data comes through tenant-filtered repositories, under RLS if present (`design.md` section 4 for search and RAG).
- Never combine several tenants' data in one prompt, not even to "save" money by batching.
- Conversation history, stored AI results, caches: keys always include `tenant_id` (and `user_id` for user-private data).
- Test: requests sent to the API contain only the calling tenant's data (`testing.md` section 2).

## 7. Abuse prevention

- Per-user call limits (e.g. 30 per hour) and a monthly per-tenant budget (`cost.md`).
- Cap input length at the endpoint (e.g. 20,000 characters); return 413 when exceeded.
- Features open to outsiders (website chatbot) also need bot protection, per-IP limits, and no write tools.

## 8. Verification

- Unit test: data containing injected instructions stays intact in the request's data field (`testing.md` section 2).
- Eval against the real API: a few cases with injected instructions ("ignore the instructions and..."); the output must not follow them (`testing.md` section 3).
- Review: the `vibe-review` skill checklist has an AI feature section.
