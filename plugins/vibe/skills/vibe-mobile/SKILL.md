---
name: vibe-mobile
description: "Use for any iOS/Android app work (Expo, React Native, Flutter, native), including quick release questions: choosing an approach, navigation, secure token storage (Keychain/Keystore, not AsyncStorage), offline and sync, push, deep links, permissions, tests (Jest, Maestro), EAS Build, EAS Update/OTA and runtime version, TestFlight, App Store/Google Play review, staged rollout, forcing old versions to update. Mobile-browser web: use the frontend skill. Also use for Vietnamese requests like 'app mobile', 'lên store', 'buộc bản cũ cập nhật', 'xin quyền', 'lưu token an toàn', 'phát hành dần'."
---

# Mobile: iOS and Android apps

Read only what the current task needs (paths relative to this skill folder):

| Task | Read |
|---|---|
| Choose approach and stack for a new app, monorepo with web | `references/choose-stack.md` |
| App structure, login, token storage, API calls, offline data and sync, workspace switch, logout | `references/app-data.md` |
| Push notifications, deep links, permissions, background, a11y, UI from design | `references/platform-features.md` |
| Tests: unit, component, E2E on emulator and device | `references/testing.md` |
| Build, signing, store release, OTA update, crash reports, forced update | `references/release.md` |

Parts shared with web live in other skills; do not repeat them here: building UI from design (the `vibe-frontend` skill, `references/design-to-code.md`), server state and tenant switch (the `vibe-frontend` skill, `references/state-management.md`), API contract (the `vibe-backend` skill, `references/api-conventions.md`, which has a section for long-lived clients such as mobile apps).

Expo, React Native and Flutter change APIs between versions. Check the installed version and the docs for that version before using an API you are unsure of (the `vibe-plan` skill, `references/tech-research.md`).

**Scale the effort.** Fixing one screen, changing text or adjusting style: just follow the surrounding code. The rules below are for new features, changes touching login, data or permissions, and every release.

## Rules that always apply

1. **Installed apps cannot be rolled back.** Old versions keep running on users' phones for months. The API must stay compatible with every supported app version; have a minimum-version mechanism to force updates when truly needed (`references/release.md` section 6).
2. **Tokens live only in Keychain/Keystore** (`expo-secure-store`, `flutter_secure_storage`), never in AsyncStorage or plain SharedPreferences. Never embed server secrets in the app: anyone can unpack the app file.
3. **Flaky networks are normal.** Every screen has loading, error and offline states. Writes send an idempotency key so a retry does not create duplicates.
4. **Tenant and session work as on web**: tenant in the request (path), cache keyed by tenant; switching workspace drops the old workspace's cache; logout deletes token, cache and offline data and unregisters the device from push.
5. **Ask for permissions at the right moment** (right before the feature is used) and explain why. If the user declines, the app still works with only that feature disabled.
6. **OTA replaces only JS and assets**, never native code, and must not change the app's main purpose. Native changes need a new store build.
7. **Store rules shape the flows**: in-app account deletion, a privacy-friendly login option when Google/Facebook login exists, digital content sold via in-app purchase, privacy declarations. Check them during planning (`references/release.md` section 3); fixing after a rejection costs days.
8. **Test on real devices before release**: at least one iPhone and one mid-range Android phone, not just simulators.

## Before calling it done

- Runs on iOS simulator and Android emulator (or devices); screenshots compared with the design at the smallest and largest supported screen sizes.
- Unit/component tests pass; main flows have an E2E flow (`references/testing.md`).
- Tried: network off mid-flow, large system font, dark mode, rotation if supported, VoiceOver/TalkBack on main flows.
- API changes: supported old app versions still work with the new server.
