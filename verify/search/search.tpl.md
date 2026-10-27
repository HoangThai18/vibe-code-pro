# Search: customers by name or phone, notes by words

Search-as-you-type that finds "Nguyễn Thị Thảo" from `thao nguyen`, `0912 345`, or `THẢO`, stays inside one tenant, and stays fast under RLS. PostgreSQL only, no extra service.

**Right-size it.** Under ~5,000 rows per tenant, `search_key(full_name) LIKE` with no index is fast enough: skip the indexes and section 3's function, but keep section 2's rules. Add the rest when a tenant's table grows or search shows up in slow-query logs (the `vibe-ship` skill, `references/performance.md`).

## Contents

1. Choosing an approach
2. What Vietnamese search must handle
3. Schema, indexes and the search function
4. API and the search box
5. Notes: full-text search
6. Tests
7. When to move to a search engine

## 1. Choosing an approach

| Approach | Fits | Cost |
|---|---|---|
| `LIKE` on an accent-free key, no index | Small tenants, admin screens | Reads every row of the tenant |
| `pg_trgm` + `unaccent` (this file) | Names, phones, codes; contains-match while typing | 3 extensions, 2 GIN indexes, one function |
| Full-text (`tsvector`) | Notes, descriptions: words anywhere in long text | One GIN index; matches whole words, not fragments |
| Search engine (Meilisearch, Typesense, OpenSearch) | Typo tolerance at scale, facets, relevance tuning over many fields | A second datastore to sync, secure per tenant and back up (section 7) |

## 2. What Vietnamese search must handle

- **Accents and case.** People type `nguyen` for "Nguyễn" and `duc` for "Đức". `unaccent` maps đ/Đ to d. It also maps the lookalike Ð (U+00D0) that appears in data converted from old encodings, and it handles both NFC and NFD input (iOS and macOS can send NFD); all three were tested on PostgreSQL 16. Plain "NFD + strip combining marks" in JavaScript does **not** turn đ into d.
- **Accent-free matching merges words.** `da` (skin), `đã` (already) and `đá` (stone) all become `da`, and `anh` matches both Anh and Ánh. When the user typed accents, rank exact matches first.
- **Word order.** `thao nguyen` must find "Nguyễn Thị Thảo". Match each word separately, not the whole string.
- **Phone formats.** `0912 345 678`, `+84 912 345 678`, `84912345678` and a fragment like `345678` all mean the same customer. Store one format (`0912345678`) and normalize the query the same way.
- **Wildcards are text.** A user typing `%` or `_` must not match everything: escape them before building `LIKE`.
- **Order.** The default collation sorts Ánh and Đặng after Z. Vietnamese order needs ICU (`collate "vi-x-icu"`, present in standard PostgreSQL builds with ICU). Without ICU, order by `search_key(full_name)`.

## 3. Schema, indexes and the search function

**The RLS trap.** `textlike` (the `LIKE` operator) is not `LEAKPROOF`. Under RLS, Postgres must apply the policy before any non-leakproof condition, so it never uses the trigram index for `LIKE`: it reads all of the tenant's rows. This was confirmed even with sequential and index scans disabled. A superuser or table owner bypasses RLS and gets the fast plan, so **measure search as the app's role**, never as a superuser.

The fix below is a `SECURITY DEFINER` function owned by a role that bypasses RLS and applies the same tenant filter itself:

- **Tenant.** It reads the tenant from `app_current_tenant()` (the `vibe-backend` RLS reference, `references/postgres-rls.md`) and raises an error when it is missing.
- **Exposure.** It builds conditions only from `%L`-quoted literals and returns only id and name.
- **Grants.** It is granted only to `app_user`.

Creating a `BYPASSRLS` role needs superuser or your provider's admin role. Where that is impossible, keep the tenant scan; it took 15 ms for 6,000 customers. Or move search to a search engine.

```sql
{{search.sql}}
```

Measured on PostgreSQL 16 with 500,000 customers and the largest tenant holding 200,000. Each figure is the warm-cache execution time as `app_user`:

| Query | `LIKE` directly under RLS | `search_customers` |
|---|---|---|
| `dang anh`, tenant with 200,000 rows | 380 ms | 9 ms |
| `thảo` (accents: exact matches ranked first) | (not run) | 25 ms |
| `vy` (2 letters) | (not run) | 2 ms |
| `0912 34` (phone fragment) | (not run) | 1.6 ms |
| `nguyen`: matches 38% of names | (not run) | 200 ms |
| `dang anh`, tenant with 6,000 rows | 15 ms | 5 ms |

The slow case is a word that most names contain (`nguyen`, `van`, `thi` typed alone). Each extra word narrows the matches, and the box sends the request only after the user pauses (section 4).

Migration notes:

- `CREATE INDEX CONCURRENTLY` cannot run inside a transaction: one statement per migration, with the tool's transaction turned off (the `vibe-backend` skill, `references/data-layer.md`).
- Building the name index took 3.3 s for 500,000 rows.
- After changing `search_key`, rebuild the indexes that use it (`REINDEX INDEX CONCURRENTLY`): rows indexed under the old function never match the new one.

## 4. API and the search box

`GET /v1/t/{tenantId}/customers/search?q=` sits behind the same tenant middleware as every route (membership checked, other tenants' data → 404). It also needs a rate limit (`references/app-security.md`): every keystroke pause is a request.

```ts
{{src/search/customers.ts}}
```

The client debounces, cancels the request for the old text, and never shows one workspace's results in another. The key follows the `vibe-frontend` skill's state rules (`references/state-management.md`):

```tsx
{{web/use-customer-search.ts}}
```

UI states:
- Fewer than 2 characters: show a hint ("Nhập ít nhất 2 ký tự").
- Loading with old results on screen: show a quiet spinner.
- No results: say so, and offer "create customer" with the typed name.
- Keyboard: arrow keys and Enter work in the result list.

## 5. Notes: full-text search

For long text (notes, treatment history), match words rather than fragments:

- **Dictionary.** Postgres has no Vietnamese dictionary, so use the `simple` configuration on accent-free text.
- **Phrases.** Vietnamese words are often several syllables ("da nhạy cảm"). Without quotes the query needs all syllables anywhere in the note; with quotes (`"da nhay cam"`), `websearch_to_tsquery` requires them in order.

```sql
{{notes-search.sql}}
```

```sql
{{notes-query.sql}}
```

`@@` is not leakproof either. Under RLS this query reads all of the tenant's notes, the same trap as section 3. Use the same `SECURITY DEFINER` pattern if notes per tenant grow large.

## 6. Tests

These run against a real PostgreSQL with the app role (`options: '-c role=app_user'`), not a superuser. They cover the tenant boundary, the fail-closed context, wildcard escaping, phone formats, accent ranking and the planner behavior that makes section 3 necessary:

```ts
{{test/search.test.ts}}
```

Notes test: `da nhay cam` finds the note, `da` lists notes with "da" before the one with "đã", `"cam on"` matches the phrase and `"on cam"` does not.

Hook tests (Testing Library `renderHook` under `global-jsdom`, `fetch` mocked with a response slower than the debounce):
- fast typing sends one request, for the final text;
- one character sends nothing;
- a newer query aborts the request in flight (`signal.aborted`);
- switching workspace shows no data from the old one.

Two runner details:
- set `gcTime: Infinity` on the test `QueryClient`, or its timers keep the process alive;
- call `cleanup()` in `afterEach`, because `node:test` has no global `afterEach` for Testing Library to hook into.

Removing any one safeguard fails a test: the tenant filter in the function, wildcard escaping, `unaccent`, the `84` prefix rule, accent ranking, `signal`, the tenant-guarded `placeholderData`, the debounce, or the minimum length.

## 7. When to move to a search engine

Move when Postgres is measurably not enough, for example:
- typo tolerance ("ngyuen");
- facets with counts;
- search across many entities with tuned ranking;
- millions of documents per tenant.

The cost is real:
- **Sync.** Keep the index fresh through the outbox and a job (`references/jobs.md`), and plan a full reindex.
- **Isolation.** Every query carries a tenant filter the client cannot remove. Use a server-side filter or a scoped API key per tenant, and cover it with isolation tests (`references/isolation-tests.md`).
- **Privacy.** Deleted customers must disappear from the index too (`references/privacy.md`).

## Done when

- [ ] `nguyen thao`, `THẢO`, `thao nguyen` and `0912 345 678` find the same customer.
- [ ] `%` and `_` match literally; a search never returns another tenant's row (tested as the app role).
- [ ] With accents typed, exact matches come first; results are in Vietnamese order.
- [ ] Measured as the app role on a tenant-sized dataset; the indexes were built `CONCURRENTLY`.
- [ ] The box debounces, cancels stale requests, needs 2+ characters, and is rate limited.

Sources: PostgreSQL 16 docs: [unaccent](https://www.postgresql.org/docs/16/unaccent.html), [pg_trgm](https://www.postgresql.org/docs/16/pgtrgm.html), [btree_gin](https://www.postgresql.org/docs/16/btree-gin.html), [row security and leakproof functions](https://www.postgresql.org/docs/16/ddl-rowsecurity.html), [CREATE FUNCTION (LEAKPROOF)](https://www.postgresql.org/docs/16/sql-createfunction.html), [text search controls](https://www.postgresql.org/docs/16/textsearch-controls.html).
