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
-- Accent-insensitive customer search. Needs: customers(tenant_id, id, full_name, phone) with RLS on tenant_id.
create extension if not exists unaccent;
create extension if not exists pg_trgm;
create extension if not exists btree_gin;

-- unaccent() is STABLE (it looks up its dictionary through search_path), so it cannot be used in an index.
-- This wrapper names the dictionary explicitly; on Supabase replace public. with extensions.
create or replace function f_unaccent(text) returns text
  language sql immutable parallel safe strict
  return public.unaccent('public.unaccent'::regdictionary, $1);

-- One normalization for the index and every query: 'Nguyễn Văn Đức' -> 'nguyen van duc'
create or replace function search_key(text) returns text
  language sql immutable parallel safe strict
  return lower(public.f_unaccent($1));

-- Large table in use: run these outside a transaction (CONCURRENTLY), one per migration
create index concurrently if not exists customers_name_search
  on customers using gin (tenant_id, search_key(full_name) gin_trgm_ops);
create index concurrently if not exists customers_phone_search
  on customers using gin (tenant_id, phone gin_trgm_ops);
-- The list page's index, in Vietnamese order. Short or very common words ('vy', 'thi') walk it
-- in name order instead of collecting every match.
create index concurrently if not exists customers_name_order
  on customers (tenant_id, full_name collate "vi-x-icu", id);

-- Under RLS the planner cannot use the trigram index for LIKE (textlike is not leakproof), so it
-- reads every row of the tenant. This function runs as a role that bypasses RLS and applies the
-- same tenant filter itself, so the index is used. It returns only id and name.
-- Creating a BYPASSRLS role needs superuser (or your provider's admin role).
do $$ begin
  if not exists (select from pg_roles where rolname = 'search_owner') then
    create role search_owner nologin bypassrls;
  end if;
end $$;
grant usage on schema public to search_owner;
grant select (tenant_id, id, full_name, phone) on customers to search_owner;

-- 'a%b' -> '%a\%b%': what the user typed is text, never a LIKE wildcard
create or replace function like_contains(text) returns text
  language sql immutable parallel safe strict
  return '%' || replace(replace(replace($1, '\', '\\'), '%', '\%'), '_', '\_') || '%';

create or replace function search_customers(q text, max_rows int default 20)
returns table (id uuid, full_name text)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  tenant uuid := public.app_current_tenant();
  digits text := regexp_replace(q, '\D', '', 'g');
  words text[] := array(select w from unnest(string_to_array(lower(q), ' ')) w where w <> '' limit 5);
  cond text;
  rank_first text := '';
begin
  if tenant is null then
    raise exception 'search_customers: no tenant context';  -- never search across tenants
  end if;
  if q ~ '^[\d\s+.()-]+$' and length(digits) >= 4 then
    -- Phone: stored as 0912345678; accept +84 912 345 678 and 84912345678
    digits := regexp_replace(digits, '^84(?=\d{9}$)', '0');
    cond := format('c.phone like %L', public.like_contains(digits));
  elsif cardinality(words) > 0 then
    -- Every word must match, in any order and without accents: 'anh dang' finds 'Đặng Thị Ánh'
    select string_agg(format('public.search_key(c.full_name) like %L',
                             public.like_contains(public.search_key(w))), ' and '),
           '(' || string_agg(format('lower(c.full_name) like %L', public.like_contains(w)), ' and ') || ') desc,'
      into cond, rank_first
      from unnest(words) w;
    -- Typed with accents: names that match as typed come first ('ánh' lists Ánh before Anh).
    -- Without accents, skip it: plain name order lets short and common words use the name index.
    if public.f_unaccent(q) = q then
      rank_first := '';
    end if;
  else
    return;
  end if;
  -- Vietnamese order (Ánh after An, Đ after D) needs the ICU collation; without ICU order by search_key
  return query execute format(
    'select c.id, c.full_name from public.customers c
      where c.tenant_id = $1 and %s
      order by %s c.full_name collate "vi-x-icu", c.id
      limit $2', cond, rank_first)
    using tenant, least(greatest(max_rows, 1), 50);
end
$$;

alter function search_customers(text, int) owner to search_owner;
revoke execute on function search_customers(text, int) from public;
grant execute on function search_customers(text, int) to app_user;
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
import type { Pool } from 'pg';
import { withTenant } from '../db/tenant';

export type CustomerHit = { id: string; fullName: string };

// GET /v1/t/{tenantId}/customers/search?q=... (membership already checked by the tenant middleware)
export async function searchCustomers(pool: Pool, tenantId: string, q: string): Promise<CustomerHit[]> {
  const query = q.normalize('NFC').trim().slice(0, 100);
  if (query.length < 2) return [];
  return withTenant(pool, tenantId, async (db) => {
    const { rows } = await db.query<{ id: string; full_name: string }>(
      'SELECT id, full_name FROM search_customers($1, 20)',
      [query],
    );
    return rows.map((r) => ({ id: r.id, fullName: r.full_name }));
  });
}
```

The client debounces, cancels the request for the old text, and never shows one workspace's results in another. The key follows the `vibe-frontend` skill's state rules (`references/state-management.md`):

```tsx
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export type CustomerHit = { id: string; fullName: string };

export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function useCustomerSearch(tenantId: string, input: string) {
  const q = useDebouncedValue(input.trim(), 250);  // one request per pause, not per keystroke
  return useQuery({
    queryKey: ['tenant', tenantId, 'customers', 'search', q],
    // signal: when q changes, TanStack Query aborts the request for the old q
    queryFn: async ({ signal }): Promise<CustomerHit[]> => {
      const res = await fetch(`/v1/t/${tenantId}/customers/search?q=${encodeURIComponent(q)}`, { signal });
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      return ((await res.json()) as { data: CustomerHit[] }).data;
    },
    enabled: q.length >= 2,
    // Keep the old results while the next ones load, but never across workspaces
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === tenantId ? prev : undefined),
    staleTime: 30_000,
  });
}
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
-- Full-text search in notes. 'simple': no Vietnamese stemmer exists, and syllables are words anyway.
create index concurrently if not exists customer_notes_fts
  on customer_notes using gin (to_tsvector('simple', f_unaccent(body)));
```

```sql
-- $1: what the user typed; $2: tenant. Quotes make a phrase: "cam on" finds the two syllables in a row.
-- Without accents, different words collide (da, đã, đá all become "da"): rank notes that also match
-- the text as typed first. Highlight in the UI: ts_headline would compare accent-free and accented text.
select n.id, n.customer_id, n.body
from customer_notes n
where n.tenant_id = $2
  and to_tsvector('simple', f_unaccent(n.body)) @@ websearch_to_tsquery('simple', f_unaccent($1))
order by to_tsvector('simple', n.body) @@ websearch_to_tsquery('simple', $1) desc,
         ts_rank(to_tsvector('simple', f_unaccent(n.body)), websearch_to_tsquery('simple', f_unaccent($1))) desc,
         n.id
limit 20;
```

`@@` is not leakproof either. Under RLS this query reads all of the tenant's notes, the same trap as section 3. Use the same `SECURITY DEFINER` pattern if notes per tenant grow large.

## 6. Tests

Run them against a real PostgreSQL as the app role (`options: '-c role=app_user'`), never a superuser, with two tenants that both have a "Nguyễn Thị Thảo". Check that:
- `search_key` gives `nguyen van duc` for `Nguyễn Văn ĐỨC`, `phuong` for an NFD `Phượng`, `dong` for `Ðông` (U+00D0);
- `thao`, `thao nguyen`, `ĐẶNG  ánh` and `dang anh` find the one matching customer; `thi` lists three names in Vietnamese order;
- `ánh` lists Ánh before Anh, while `anh` keeps name order;
- `0912 345 678`, `+84 912 345 678`, `84912345678` and `345678` find the same customer;
- `%%` and `__` find nothing;
- a search never returns the other tenant's Thảo, and without a tenant context `search_customers` raises `no tenant context`;
- `EXPLAIN` of `search_key(full_name) LIKE '%thao%'` (sequential and index scans off) has no trigram `Index Cond` as `app_user`, and has one as `search_owner`;
- notes: `da nhay cam` finds the note, `da` lists notes with "da" before the one with "đã", `"cam on"` matches the phrase and `"on cam"` does not.

Hook tests (Testing Library `renderHook` under `global-jsdom`, `fetch` mocked with a response slower than the debounce):
- fast typing sends one request, for the final text;
- one character sends nothing;
- a newer query aborts the request in flight (`signal.aborted`);
- switching workspace shows no data from the old one.

Two runner details:
- set `gcTime: Infinity` on the test `QueryClient`, or its timers keep the process alive;
- call `cleanup()` in `afterEach`, because `node:test` has no global `afterEach` for Testing Library to hook into.

Removing any one safeguard fails a test: the tenant filter in the function, wildcard escaping, `unaccent`, the `84` prefix rule, accent ranking, `signal`, the tenant-guarded `placeholderData`, the debounce, the minimum length.

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
