---
type: llm
---

PASS if the spa page emits JSON-LD (<script type="application/ld+json">) of type LocalBusiness or DaySpa with address and opening hours, and escapes "<" (for example replacing it with <) or uses a safe serializer, because a spa name containing </script> could otherwise inject HTML.
FAIL if it uses plain JSON.stringify inside dangerouslySetInnerHTML without escaping.
