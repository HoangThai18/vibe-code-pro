---
type: regex
target:
  source: file
  path: src/customers/import-csv.js
pattern: "(?:from\\s+['\"](?:csv-parse(?:/sync)?|papaparse|fast-csv|@fast-csv/parse|csv-parser)['\"]|require\\(\\s*['\"](?:csv-parse(?:/sync)?|papaparse|fast-csv|@fast-csv/parse|csv-parser)['\"])"
match: contains
---
