---
type: llm
focus: files
---

PASS if the code handles iOS Keychain items surviving an app uninstall: for example it clears the SecureStore tokens on the first launch after a fresh install, detected with a flag stored in AsyncStorage (which is wiped on uninstall).
FAIL if nothing prevents a reinstalled app from silently reusing a refresh token left in the Keychain by the previous install.
