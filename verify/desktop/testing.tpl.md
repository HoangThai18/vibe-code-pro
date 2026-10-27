# Testing desktop apps

Principles as in the `vibe-build` skill (`references/testing.md`). The renderer is a web app: unit and component tests as on web. Desktop-specific parts are the main process, IPC, security config and the packaged build.

## Contents
1. Choose the test level
2. Electron E2E with Playwright
3. Security config tests
4. Tauri
5. Running in CI

## 1. Choose the test level

| What to check | Level |
|---|---|
| Pure logic (pricing, CSV parsing, sync) | Unit, separated from Electron/Tauri |
| Renderer: screens, forms, state | Component tests as on web, mock `window.api` |
| Main process + preload + renderer together, IPC, file dialogs | E2E (Playwright for Electron) |
| Security config (no Node in renderer, navigation blocked, path traversal blocked, permissions denied) | E2E, on every PR (section 3) |
| Install, signing, auto-update | Try the packaged build on each OS before release |

Main-process modules that take Electron APIs as parameters run under plain `node --test`, e.g. the API client (`app-data.md` section 3):

```js
{{electron-app/tests/unit/api-client.test.js}}
```

## 2. Electron E2E with Playwright

Playwright can drive Electron apps (the `_electron` API, still experimental): launch the app, get windows, run code in the main process.

```ts
{{electron-app/tests/e2e/app.spec.ts}}
```

## 3. Security config tests

Security config is easy to change by mistake (one `nodeIntegration: true` while debugging). Lock it with tests on every PR. The suite below ran with Electron 45 and Playwright 1.64 (100 consecutive runs, no flakes) and caught each deliberately broken app version: `nodeIntegration` on/`contextIsolation` off, path traversal check removed, navigation block removed, new windows allowed, preload also exposing `ipcRenderer` or a generic `invoke(channel)`, either permission handler removed or allowing everything.

```ts
{{electron-app/tests/e2e/security.spec.ts}}
```

## 4. Tauri

- Command logic: `cargo test` (separate the handler from dialog and OS calls).
- Renderer: component tests as on web, fake IPC with `mockIPC` from `@tauri-apps/api/mocks`.
- E2E: WebDriver via `tauri-driver` works on Linux and Windows; macOS has no WKWebView driver yet, so test main flows on macOS manually from a checklist.

## 5. Running in CI

- Linux needs a virtual display to open windows: `xvfb-run -a npx playwright test` (install the `xvfb` package).
- OS matrix (`ubuntu-latest`, `windows-latest`, `macos-latest`) for tests and packaging; the section 3 security tests run on every PR.
- Test the packaged build (not only from source) at least before each release: `electron.launch({ executablePath: '<path to executable>' })`.
- Playwright launches Electron with the `--inspect` flag, so a build with the `EnableNodeCliInspectArguments` fuse off (`security.md` section 5) cannot run under `electron.launch` (it times out). Run automated tests on a packaged build with this fuse still on; test the final release build (fuse off) manually from a checklist and verify fuses with `npx @electron/fuses read`.
