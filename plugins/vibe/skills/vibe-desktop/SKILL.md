---
name: vibe-desktop
description: "Build Windows, macOS and Linux desktop apps: choosing an approach (Tauri, Electron, PWA, native), Electron security (context isolation, sandbox, preload, IPC checks, CSP) and Tauri capabilities, local files and secrets, offline, tests (Playwright for Electron), packaging, code signing, notarization, auto-update. Use when the user builds a desktop app or mentions 'desktop app', 'Electron', 'Tauri', 'installer', 'auto update', 'code signing', 'notarize', 'preload'. Also use for Vietnamese requests like 'app máy tính', 'app Windows', 'app macOS', 'ký số', 'tự cập nhật', 'đóng gói'."
---

# Desktop: Windows, macOS and Linux apps

Read only what the current task needs (paths relative to this skill folder):

| Task | Read |
|---|---|
| Choose an approach (PWA, Tauri, Electron, native) for a new app | `references/choose-stack.md` |
| Window config, preload, IPC, CSP, opening links, Tauri permissions | `references/security.md` |
| Local data, files, tokens; API client and version headers; offline; multiple tenants | `references/app-data.md` |
| Tests: unit, Electron E2E with Playwright, Tauri | `references/testing.md` |
| Packaging, code signing, notarization, auto-update, crash reports | `references/release.md` |

Parts shared with web live in other skills: UI from design and state (the `vibe-frontend` skill), API contract and long-lived clients (the `vibe-backend` skill, `references/api-conventions.md` section 8), offline and the write queue (the `vibe-mobile` skill, `references/app-data.md` sections 5–6, same approach).

Electron and Tauri change APIs between major versions. Check the installed version and the docs for that version before using an API you are unsure of (the `vibe-plan` skill, `references/tech-research.md`).

**Scale the effort.** UI, text and style changes in the renderer: work as on web. Read `references/security.md` carefully when touching the main process, preload, IPC, window config, Tauri capabilities, or when the app loads external content.

## Rules that always apply

1. **The renderer is an untrusted web page.** Never enable `nodeIntegration`; never disable `contextIsolation`, `sandbox` or `webSecurity`. The renderer can call only a few specific functions via preload (Electron) or permitted commands (Tauri), never `fs`, `child_process` or a raw `ipcRenderer`. Electron grants camera, microphone and other web permissions unless you set deny-by-default permission handlers.
2. **Every IPC message is untrusted input**: check the sender, validate parameters, do one narrow thing. No IPC like "read a file at any path" or "run a command".
3. **Run only code packaged with the app.** Never load remote pages into a privileged window; block navigation and new windows; `shell.openExternal` only with URLs checked against an allowlist.
4. **Data goes in the app's data folder** (e.g. `app.getPath('userData')`), not next to the executable. Tokens go in the OS keystore (`safeStorage`, keychain), never plain text.
5. **Installed apps cannot be rolled back**, as on mobile: the API stays compatible with supported versions and has a minimum version, which works only if every request sends `x-app-version` and `x-app-platform` (`references/app-data.md`); for a bad release, ship a newer version via auto-update.
6. **Sign every release.** macOS needs signing and notarization, Windows needs Authenticode signing with the key in a (cloud) HSM; unsigned builds are warned about or blocked by the OS, and auto-update is not safe.
7. **Test on every OS you ship**: Tauri uses the OS webview (WebView2, WKWebView, WebKitGTK), so rendering and web APIs can differ.

## Before calling it done

- Main-flow E2E passes (Electron: Playwright; Tauri: WebDriver or manual checklist), including the security tests in `references/testing.md`.
- Run the packaged build (not only dev) on every OS you ship; install, open, and update from the previous version to this one.
- Screenshots compared with the design as on web (the `vibe-frontend` skill).
