-- Full-text search in notes. 'simple': no Vietnamese stemmer exists, and syllables are words anyway.
create index concurrently if not exists customer_notes_fts
  on customer_notes using gin (to_tsvector('simple', f_unaccent(body)));
