# Choosing a mobile approach

The first question is not "React Native or Flutter" but "do we need an app installed from a store at all". Each option costs something different: store review, two platforms, which languages the team knows.

## Contents
1. Do you need a native app
2. Approaches compared
3. Recommended default
4. Shared repo with web
5. Expo: know this from the start
6. Record the decision

## 1. Do you need a native app

Web (responsive, optionally installable as a PWA) is enough when users mostly enter data and view reports, during work hours on a computer and only sometimes on a phone. You need a native app when at least one of these holds:

- Reliable push notifications on both iOS and Android are core (appointment reminders, new orders).
- Hardware or system APIs: continuous barcode scanning, Bluetooth, NFC, background location, biometrics, widgets, share extensions.
- Real offline use (field sales, warehouses, weak-signal areas).
- Your customers find and install apps from the store, or require a store app.

If none apply, build a good mobile web experience first; add the app later, reusing the API and contract.

## 2. Approaches compared

| Approach | Fits when | Cost | Avoid when |
|---|---|---|---|
| **PWA** (installable web) | Mostly viewing and data entry; one codebase with web | Push and hardware APIs on iOS more limited than native; not in stores | Push is a main feature, hardware needed |
| **Expo / React Native** | Team already uses React/TypeScript (vibe's default web stack); share types, contract, logic with web | The two platforms still differ in details; unusual native modules must be written | Heavy graphics, games |
| **Flutter** | Team knows Dart or wants identical self-drawn UI on every platform | No code sharing with React web; one more language in the project | Team has only React web devs |
| **Native** (Swift/SwiftUI, Kotlin/Compose) | Deep system API dependence, maximum performance, team has native devs | Two codebases, two teams | Small team must ship both platforms fast |
| **Kotlin Multiplatform** | Shared logic with native UI per platform | Tooling and ecosystem still change fast | No Kotlin dev on the team |

## 3. Recommended default

For a small team building SaaS with React/TypeScript web:

- **Expo (React Native) with Expo Router**, TypeScript, same monorepo as web.
- Share `packages/contracts` (zod schemas, API types) between web, mobile and backend: contract drift is caught at build time.
- Server state with TanStack Query as on web; tokens in `expo-secure-store`; build and release with EAS (`release.md`).
- Pick Flutter when the team already knows Dart, or self-drawn UI is the product's main value.

## 4. Shared repo with web

```text
apps/
├── web/            Next.js or Vite
├── mobile/         Expo (app.config.ts, app/ for Expo Router)
└── api/
packages/
├── contracts/      zod schemas + types shared by web, mobile, api
└── ui-tokens/      design tokens (color, spacing, type) exported for web (CSS/Tailwind) and mobile (TS objects)
```

- Do not share UI components between web and mobile unless you chose a library for it (React Native Web, Tamagui...); sharing tokens and logic is almost always worth it.
- Add the mobile commands (`start`, `test`, `lint`, `typecheck`) to `AGENTS.md` next to the web ones.

## 5. Expo: know this from the start

- **Expo Go is only for quick trials.** Real apps use a *development build* (`expo-dev-client`): it has exactly the app's native modules, closer to the release build.
- **Continuous Native Generation**: `ios/` and `android/` are generated from `app.config.ts` and config plugins (`npx expo prebuild`). With this setup never hand-edit those folders (the next prebuild overwrites them); write a config plugin for native changes.
- **Install libraries with `npx expo install <package>`**, not `npm install`: it picks the version matching the current SDK.
- Each Expo SDK is tied to one React Native version; upgrade the SDK following Expo's upgrade guide, as a separate task with tests (the `vibe-ship` skill, `references/maintenance.md`).

## 6. Record the decision

Write in `docs/plan/ARCHITECTURE.md` (ADR table): platforms (iOS, Android, PWA), approach, minimum supported iOS/Android versions, whether offline is needed and at what level (`app-data.md` section 5), policy for old app versions (`release.md` section 6).
