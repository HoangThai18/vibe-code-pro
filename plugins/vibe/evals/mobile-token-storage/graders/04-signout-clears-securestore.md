---
type: llm
focus:
  source: file
  path: src/auth/session.ts
---

PASS if signing out deletes the stored tokens from SecureStore (deleteItemAsync or equivalent) and also clears any token kept in memory.
FAIL if signOut only clears AsyncStorage, or leaves a token in SecureStore or in memory.
