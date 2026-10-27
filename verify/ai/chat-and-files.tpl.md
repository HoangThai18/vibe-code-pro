# Chat and file input

A staff assistant that keeps a conversation, and features that read a photo or a PDF. Code ran with `@anthropic-ai/sdk` 1.3 and PostgreSQL 16 (FORCE RLS); tests in `testing.md` section 2. Helpers: `errors.ts` (`integration.md` section 3), `usage.ts` (`cost.md` section 2), `withTenant` (the `vibe-backend` skill, `references/postgres-rls.md`).

## Contents
1. Conversation history
2. Token growth and compaction
3. Images and PDFs

## 1. Conversation history

```sql
{{sql/chat.sql}}
```

- **The server owns the history.** The browser sends the conversation id and the new message only. A history posted by the client lets the user write the assistant's earlier turns or slip in instructions.
- **Private per user, inside the tenant**: tenant through RLS, owner through `user_id` in the query; another user's or tenant's conversation id returns 404 (rule 4 in `SKILL.md`).
- **Append-only, as returned.** Store `response.content` unchanged (thinking blocks included) and never edit or delete turns that are still sent. Editing breaks the prompt cache, and on models with preserved thinking (`claude-opus-5-5`; enforced for accounts created from 2026-08-31) a request that replays thinking blocks after an edit returns 400. Per-turn instructions go in a new message, not in the system prompt.
- Retention and deletion follow the rest of the customer data: a deleted customer or user takes their conversations along (the `vibe-backend` skill, `references/privacy.md` section 8).

```ts
{{src/ai/chat.ts}}
```

## 2. Token growth and compaction

Every turn resends the whole context, so turn *n* costs roughly the sum of all earlier turns and a conversation's total cost grows with the square of its length.

- **Automatic caching** (top-level `cache_control`, as in `ask` above): each turn reads the earlier turns at 0.05× the input price on `claude-opus-5-5` instead of paying full price again (`cost.md` section 4).
- **Compaction**: once a call's prompt (`input_tokens + cache_creation_input_tokens + cache_read_input_tokens`) passes a threshold, replace the whole context with a summary and continue from it (`compact` above). Keeping only the last turns, or dropping old ones, is an edit (section 1): replaying the kept turns' thinking blocks then returns 400 on enforced accounts. Server-side compaction (beta) is the provider's alternative: check the current docs.
- Also cap a conversation (turns or tokens) and the per-user call rate (`cost.md` section 3).

## 3. Images and PDFs

| Limit (Claude API, check the current docs) | Value |
|---|---|
| Image types | JPEG, PNG, GIF (first frame), WebP |
| Image size | 10 MB base64 per image, 8000×8000 px; with more than 20 images in a request a stricter limit applies (≤ 2,000 px per side passes) |
| Image cost | ⌈width / 28⌉ × ⌈height / 28⌉ tokens after downscaling; at most 4,784 tokens (long edge 2,576 px) on Claude 4.7 and later |
| PDF | 32 MB per request, 600 pages (100 below a 1M context window); no password |

```ts
{{src/ai/attachments.ts}}
```

```ts
{{src/ai/extract-intake.ts}}
```

- Check type and size on the server before anything else; return 415/413. Downscale photos to what the task needs (≤ 2,000 px also avoids the many-image limit).
- Photos of customers, their intake forms and ID cards are personal data; a face can be biometric data and a phone photo's EXIF can hold GPS location, both on the sensitive list. Before sending: legal basis and notice, and the provider listed as a processor abroad (the `vibe-backend` skill, `references/privacy.md` sections 3, 5, 6). Strip metadata when re-encoding; keep the upload only as long as needed.
- Text in an image or PDF is data written by someone else: indirect prompt injection (`safety.md` section 1). The extraction result goes to a form the staff member checks and saves, never straight into the database.
- In a multi-turn chat, a base64 attachment is resent on every turn: upload it once through the Files API and reference its `file_id` (delete the file with the conversation), or extract the text once and keep that.
