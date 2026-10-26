---
type: llm
focus:
  source: file
  path: src/link-preview.ts
---

PASS if the code resolves the hostname (DNS) and rejects the request when any resolved address is loopback, private, link-local (including 169.254.169.254), unique-local IPv6 or an IPv4-mapped IPv6 form of those, and also rejects IP literals in the URL; the check must use the resolved addresses, not only string matching on the hostname.
FAIL if it only blocks hostnames like "localhost" by string, or does not check resolved addresses.
