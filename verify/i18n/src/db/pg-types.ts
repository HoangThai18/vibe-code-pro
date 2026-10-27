// src/db/pg-types.ts — import once at startup
import pg from 'pg';

// date stays 'YYYY-MM-DD'; the default builds a Date at the server's local midnight (a day off once serialized)
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
// bigint (money) arrives as a string; parse it, refusing values a JS number can't hold
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new RangeError(`int8 out of range: ${v}`);
  return n;
});
