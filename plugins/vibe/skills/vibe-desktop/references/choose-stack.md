# Choosing a desktop approach

## Contents
1. Do you need a desktop app
2. Approaches compared
3. Recommended default
4. Record the decision

## 1. Do you need a desktop app

A web app (optionally installable as a PWA) is enough for most business software. You need a desktop app when at least one of these holds:

- Working with local files and devices: receipt printers, barcode scanners, electronic scales, sync folders, large files.
- Offline all day (checkout counter, warehouse) with sync when online.
- OS integration: system tray, global shortcuts, launch at startup, system notifications.
- Business customers require an installer managed through IT tools.

## 2. Approaches compared

| Approach | Fits when | Cost | Avoid when |
|---|---|---|---|
| **PWA** | Mostly a web app that needs a desktop icon and its own window | Limited file and device access, varies by browser | Peripherals or background running needed |
| **Tauri** (v2) | Small installer, low RAM, web UI (React/Vue/Svelte), native parts in Rust | Uses the OS webview: rendering differs across Windows, macOS, Linux; the native backend needs Rust | Team does not want to touch Rust, needs exactly one Chromium engine |
| **Electron** | Needs the Node.js ecosystem, identical rendering everywhere (bundled Chromium), many ready libraries | Large installer (usually over 100 MB), RAM-hungry; you must keep the security config right yourself | Low-spec machines are the main target |
| **Native** (WinUI/.NET, SwiftUI, Qt) | One main OS, deep integration or high performance | One codebase per platform, no web code reuse | All three OSes with a small team |
| **Flutter desktop** | Already have a Flutter mobile app to share with | Smaller desktop ecosystem than mobile | React web team |

## 3. Recommended default

For a React/TypeScript web team:

- **Tauri** when the app is mostly UI + API calls, needs a light installer, and you accept writing a few Rust commands for native parts (files, devices).
- **Electron** when you need Node.js libraries (printer drivers, SQLite via Node, Node-only SDKs), or absolutely uniform rendering.
- Share `packages/contracts` and UI tokens with web (the `vibe-mobile` skill, `references/choose-stack.md` section 4); write the renderer as a web app (the `vibe-frontend` skill).

## 4. Record the decision

Write in `docs/plan/ARCHITECTURE.md` (ADR): supported OSes and minimum versions, approach, offline level (as on mobile), distribution channel (web download, Microsoft Store, Mac App Store, the customer's IT tools), auto-update method, old-version support policy.
