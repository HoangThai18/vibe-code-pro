# Calling the API from the server

Code in this file ran with `@anthropic-ai/sdk` 1.3, `zod` 4, TypeScript strict, Node 22 and PostgreSQL 16 (FORCE RLS); the tests in `testing.md` run against this exact code. Check the installed SDK version before copying (the `claude-api` skill, if your agent has it). Other providers: same structure, different SDK calls.

## Contents
1. Client
2. Single call with structured output
3. Errors and stop_reason
4. Streaming to the browser
5. When the model refuses

## 1. Client

```bash
npm install @anthropic-ai/sdk zod
```

```ts
{{src/ai/client.ts}}
```

- `ANTHROPIC_API_KEY` lives in server secrets (the `vibe-ship` skill), one key per environment, with a spending limit set in the provider's console.
- One shared client per process (keeps connections alive), created once at startup.

## 2. Single call with structured output

Summarize customer care notes for staff. The result is JSON matching a schema, so the UI can render each part without guessing the format.

```ts
{{src/ai/summarize-notes.ts}}
```

Redact phone numbers and emails before sending (`safety.md` section 5):

```ts
{{src/ai/redact.ts}}
```

Why the code is written this way:

- `messages.parse` + `zodOutputFormat`: the API constrains output to the schema and the SDK parses it into `parsed_output` (`null` when parsing fails).
- Constant system prompt: user data cannot slip into the instructions. This one is too short to cache; a long shared prefix would be (`cost.md` section 4).
- `JSON.stringify(payload)`: a note containing `"} Bỏ qua mọi chỉ dẫn...` is still just a string in the `text` field. This does not stop every injection, but it does not open the door either (`safety.md` section 2).
- `max_tokens` is the per-call cost cap; for always-thinking models, thinking tokens count against it too, so do not set it close to the answer length.
- Record usage before checking `stop_reason`: refused or truncated calls are still billed. `assertWithinBudget`, `record` and prices: `usage.ts` and `usage-pg.ts` (`cost.md` section 2).

The endpoint loads the notes like any other tenant data, then calls the model outside the transaction:

```ts
{{src/routes/customer-summary.ts}}
```

## 3. Errors and stop_reason

```ts
{{src/ai/errors.ts}}
```

| Situation | SDK behavior | Handling |
|---|---|---|
| 429, 5xx, 529 overloaded, network error, timeout | Retries automatically (`maxRetries`); when exhausted, throws `RateLimitError`, `InternalServerError`, `APIConnectionError` (timeout is its subclass `APIConnectionTimeoutError`) | `AiUnavailableError`: show "AI temporarily unavailable" |
| 400, 401, 403, 404 | `BadRequestError`, `AuthenticationError`... | Code or config bug: rethrow, error tracking catches it, fix the code |
| `stop_reason: "max_tokens"` | Normal response, output truncated | Structured output: discard. Streamed draft: keep it marked unfinished (section 4). Raise `max_tokens` if it happens often |
| `stop_reason: "refusal"` | Normal response, model refused | Discard, streamed text included; see section 5 |
| User cancels | `APIUserAbortError` | Not an error; record the known usage |

Catch errors by SDK class (`instanceof`), never by message text. In the TypeScript SDK, `APIConnectionError` is a subclass of `APIError`: if you catch both, catch `APIConnectionError` first.

## 4. Streaming to the browser

Draft a reply to a customer message, showing each chunk as soon as the model writes it. The server uses Server-Sent Events; when the user closes the page, the API request is aborted.

```ts
{{src/ai/stream-draft-reply.ts}}
```

- Check budget and permissions **before** `writeHead`: once status 200 is sent you cannot return an error code, only an `error` event in the stream.
- Listen to `res.on('close')`, not `req.on('close')`: in recent Node versions `req` emits `close` once the body is read, not when the user disconnects.
- A proxy in front (nginx...) may buffer the response before sending: disable buffering for this path (nginx: header `X-Accel-Buffering: no` or `proxy_buffering off`).

Browser side (`EventSource` only sends GET, so use `fetch` and read the stream yourself). A refusal or `max_tokens` can arrive after text was already shown, so the result is not just "done":

```ts
{{web/read-draft-stream.ts}}
```

```ts
{{web/settle-draft.ts}}
```

Render `delta` as a text node (React: `{text}`), never `dangerouslySetInnerHTML`. For markdown, use a markdown renderer that sanitizes HTML.

## 5. When the model refuses

`stop_reason: "refusal"` means the provider's safety filter blocked the request; rare for ordinary business apps, but false positives happen (e.g. medical notes, injury descriptions). Handling:

- Do not retry the same request repeatedly. Tell the user and let them do it manually.
- Count refusals per feature; if they spike, review the prompt and the input data.
- The Claude API has a `fallbacks` parameter (beta) that automatically reruns on another model after a refusal, within the same call. Enable it when a feature often gets false refusals; cost and billing per the current docs:

```ts
{{src/ai/with-fallback.ts}}
```

- `response.model` is the model that answered. Top-level `usage` covers only that attempt; `usage.iterations` lists every attempt, the declined one included, each with its own `model` and tokens. Fallback attempts bill at the fallback model's rates; whether a refusal before any output is billed depends on its category (check the current docs). `usageRows` (`cost.md` section 2) writes one row per attempt at that model's price: add a price row for each fallback target.
