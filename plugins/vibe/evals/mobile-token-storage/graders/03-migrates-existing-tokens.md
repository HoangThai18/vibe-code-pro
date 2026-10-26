---
type: llm
focus: files
---

PASS if the code deals with tokens that existing users already have in AsyncStorage: on startup or first read it either moves them into SecureStore and then removes them from AsyncStorage, or removes them (asking the user to sign in again).
FAIL if old tokens are left in AsyncStorage with no code path that ever removes them.
