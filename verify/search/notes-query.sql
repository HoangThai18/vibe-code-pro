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
