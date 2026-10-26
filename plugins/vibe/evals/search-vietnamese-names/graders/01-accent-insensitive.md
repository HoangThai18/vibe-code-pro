---
type: llm
focus: trace
---

PASS if the final solution compares an accent-free form of full_name with an accent-free form of the input (unaccent through an IMMUTABLE wrapper that names the dictionary, or an equivalent normalized column or expression), so 'nguyen thao' and 'thao' match 'Nguyễn Thị Thảo' and đ/Đ match d.
FAIL if matching still depends on accents, or unaccent() is used directly in an index expression (it is not IMMUTABLE, so that migration fails).
