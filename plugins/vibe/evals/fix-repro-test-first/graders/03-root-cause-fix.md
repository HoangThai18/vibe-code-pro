---
type: llm
focus:
  source: file
  path: src/slugify.js
---

PASS if the code maps đ and Đ to d for any input (root cause: they do not decompose under NFD), for example a replace of /đ/g and /Đ/g or a character map, while keeping the existing diacritic removal.
FAIL if it special-cases the exact string 'Đường Lê Lợi', or breaks the existing behaviour.
