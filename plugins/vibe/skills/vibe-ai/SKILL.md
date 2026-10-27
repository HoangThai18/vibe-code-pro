---
name: vibe-ai
description: "Add LLM features to a production app (summarize, classify, extract from text, photos or PDFs, draft, chatbot, tool-using assistant, RAG): server-side calls to the Claude API or any provider, streaming to the UI, structured output, prompt-injection defense, tenant isolation, per-tenant cost limits, prompt caching, errors and timeouts, tests and quality evals. Use when adding AI, an LLM, embeddings, prompts or an in-app agent, or for AI cost, accuracy or safety concerns. Also use for Vietnamese requests like 'thêm AI', 'tích hợp Claude', 'tóm tắt bằng AI', 'gợi ý', 'trích xuất', 'đọc ảnh, PDF', 'agent trong app'."
---

# AI: LLM features in an app

Read only what the current task needs:

| Task | Read |
|---|---|
| Choose the feature shape (single call, workflow, agent, document search), model, UX, data sent to the provider | `references/design.md` |
| Server-side API calls, structured output, streaming to the browser, errors, timeouts, refusals | `references/integration.md` |
| Chat with stored history, long conversations, photo and PDF input | `references/chat-and-files.md` |
| Prompt injection, cross-tenant data, tool permissions, output handling, redacting personal data | `references/safety.md` |
| Cost, per-tenant budgets, usage logging, prompt caching, rate limits | `references/cost.md` |
| Free automated tests, quality evals, production monitoring | `references/testing.md` |

Examples are TypeScript with `@anthropic-ai/sdk`. Model IDs, parameters and prices change faster than any other library: read the current docs before writing API code. If your agent has a Claude API skill (Claude Code ships `claude-api`), use it for current model IDs and SDK usage for the installed version; never write from memory. The rules below apply to any provider: with another one, keep them and swap the API calls.

**Scale the effort.** For a prompt wording change, rerun the eval and just do it. Read `references/safety.md` closely when the feature reads data entered by others (notes, emails, documents, web pages) or lets the model call tools.

## Always-on rules

1. **Call the API only from the server.** The API key never goes into a frontend, mobile or desktop app. AI endpoints go through authentication, authorization and tenant resolution like any other endpoint.
2. **Data is not instructions.** Keep the system prompt fixed; never splice user data into it. Put notes, emails, documents and tool results in the user message as JSON or in clearly named tags, with a sentence saying it is data. Do not trust that sentence to stop every injection: the feature's permissions are what limit damage (rule 3).
3. **The model can do only what the current user can do.** Tools run with that user's permissions, in that tenant; consequential actions (messaging a customer, deleting, paying) need the user to click confirm.
4. **Tenant-scope all prompt data**: load it through tenant-filtered repositories (and RLS) like any other query. Never combine several tenants' data in one prompt; cache AI results per tenant.
5. **Model output is untrusted data**: validate with a schema (structured output), render as text (no `innerHTML` with raw markdown), never run it as SQL, shell commands or redirect URLs.
6. **Cap costs**: sensible `max_tokens`, a monthly per-tenant budget, per-user call limits, usage recorded for every call (`references/cost.md`).
7. **AI failure must not break the main flow.** Timeouts, bounded retries (the SDK already retries), handle `stop_reason` (`refusal`, `max_tokens`); show "AI is temporarily unavailable" and let the user continue manually.
8. **Rerun the eval when changing prompt, model or effort**, before merge. Without an eval you cannot tell whether a change helped or hurt.

## Before calling it done

- Automated tests pass without calling the real API (fake fetch in `references/testing.md`) and cover: the request holds no other tenant's data (endpoint test, `references/testing.md` section 2), no call when the budget is exhausted, transient errors give a friendly message.
- The eval against the real API meets the agreed threshold, including a few cases with injected instructions; put score and cost in the PR description.
- Usage is recorded per tenant; alerts fire on abnormal cost or error-rate increases (the `vibe-ship` skill, `references/observability.md`).
- Users can tell content is AI-generated (label, edit before sending), and a tenant can turn the feature off.
