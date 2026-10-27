# Build, store release, OTA, crash reports

The biggest difference from web: **installed builds cannot be rolled back**, and every store release goes through review (usually hours to days). The release plan must account for both.

## Contents
1. Environments and build profiles
2. App signing and credentials
3. Store rules to design for from the start
4. Versions and staged rollout
5. OTA update (EAS Update)
6. Forced update and old-version support
7. Crash reports and post-release monitoring
8. Release checklist

## 1. Environments and build profiles

Three variants install side by side on one device (different bundle ids), pointing at three environments:

```ts
// app.config.ts
import type { ExpoConfig } from 'expo/config';

const variant = process.env.APP_VARIANT || 'production';   // development | preview | production (empty string is also production)
const suffix = variant === 'production' ? '' : `.${variant}`;

const config: ExpoConfig = {
  name: variant === 'production' ? 'Spa CRM' : `Spa CRM (${variant})`,
  slug: 'spa-crm',
  scheme: 'spacrm',
  version: '1.4.0',                                  // user-visible version
  runtimeVersion: { policy: 'fingerprint' },         // section 5
  updates: { url: 'https://u.expo.dev/<project-id>' },
  ios: { bundleIdentifier: `vn.example.spacrm${suffix}` },
  android: { package: `vn.example.spacrm${suffix}` },
  plugins: ['expo-router', 'expo-secure-store'],
  extra: { eas: { projectId: '<project-id>' } },
};

export default config;
```

```json
{
  "cli": { "version": ">= 16.0.0", "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "channel": "development",
      "env": { "APP_VARIANT": "development" }
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview",
      "env": { "APP_VARIANT": "preview" }
    },
    "production": {
      "channel": "production",
      "autoIncrement": true,
      "env": { "APP_VARIANT": "production" }
    }
  },
  "submit": { "production": {} }
}
```

(That is `eas.json`, checked with the config reader of `eas-cli` 25 itself.) `appVersionSource: "remote"` + `autoIncrement`: EAS bumps the build number (iOS `buildNumber`, Android `versionCode`) so you never edit it by hand. The `development` profile needs `expo-dev-client`; EAS Update needs `expo-updates` (`npx expo install expo-dev-client expo-updates`, or `eas update:configure`).

```bash
eas build --profile preview --platform all          # internal build for QA
eas build --profile production --platform all
eas submit --profile production --platform ios      # upload to App Store Connect (TestFlight)
eas submit --profile production --platform android  # upload to Google Play Console
```

Put the API URL and other per-variant config in each environment's `EXPO_PUBLIC_*` variables. Everything in the app is readable: no secrets here.

## 2. App signing and credentials

- Let EAS manage iOS certificates, provisioning profiles and the Android keystore; never commit signing files.
- Android: enable Play App Signing (Google holds the app signing key, you hold the upload key). A lost upload key can be reset; a lost self-managed app signing key means the app can never be updated.
- Push: configure the APNs key (iOS) and FCM (Android) in EAS credentials.
- Record in `AGENTS.md`/runbook who has access to the Apple Developer, Google Play Console and EAS accounts; accounts belong to the company, not an individual.
- **Enroll as an organization**: both stores ask organizations for a D-U-N-S number; request it early. Google Play personal accounts created after 13 November 2023 must run a closed test with at least 12 testers opted in for the last 14 days in a row, then apply for production access; organization accounts skip this (check the current numbers in Play Console).

## 3. Store rules to design for from the start

These commonly get a first release rejected, and fixing them means changing flows:

| Requirement | Rule | Design impact |
|---|---|---|
| Account deletion (Apple 5.1.1(v); Google Play also requires it, plus a web link for deletion) | If the app creates accounts, it must let users delete the account inside the app | Needs an account deletion API, data handling per retention policy, tenants with other members |
| Login (Apple 4.8) | Using Google, Facebook... login for the primary account requires an extra login option meeting privacy criteria (Sign in with Apple is the usual choice) | Add the login provider from the start |
| In-app purchase (Apple 3.1.1, 3.1.3; Google Play Payments policy) | Feature unlocks and digital plans sold in the app must use the store's billing; outside the exceptions below, the app may not point to another way to pay | Decide early: sell with in-app purchase, or sell on the web only and keep the app free of sales (below) |
| Downloaded code (Apple 2.5.2; Google Play bans downloading native code outside the store) | Never download code that adds or changes main features | OTA only for bug fixes and small tweaks (section 5) |
| Privacy | Declare collected data (App Privacy on the App Store, Data safety on Google Play); iOS privacy manifest for APIs that need a reason | List third-party SDKs and the data they collect |
| Review account | Reviewers must be able to log in | Prepare a demo account with sample data that needs no real OTP |

**Sales on the web only** (usual for B2B SaaS such as the spa CRM):

- The app shows no prices, upgrade or buy buttons, and no links or text pointing to the web checkout: Apple forbids buttons, external links and other calls to action toward purchase methods other than in-app purchase (3.1.1, 3.1.3). For a feature outside the plan, show a neutral message only (e.g. "not included in this workspace's plan"). Emails and the web app may promote plans (communication outside the app is allowed).
- Apps sold directly to organizations for their employees count as enterprise services (Apple 3.1.3(c)): staff use plans the business bought elsewhere. Consumer, single-user or family sales must use in-app purchase; a consumer app may unlock web purchases only if they are also sold as in-app purchases (3.1.3(b)).
- Exceptions depend on the storefront and change often: Apple's guidelines currently allow purchase buttons and links on the United States storefront, and StoreKit External Purchase Link entitlements allow a link in some other storefronts. Google Play has its own regional programs. Check the current text and ask whoever handles legal before adding any purchase link.

Google Play also requires a recent Android target API level for new apps and updates; check the current deadline in Play Console before each major release.

## 4. Versions and staged rollout

- `version` (user-visible, e.g. 1.4.0) follows feature changes; the build number increases with every build (EAS bumps it).
- iOS: TestFlight for the internal group → release with **phased release** (ramps over 7 days, can be paused).
- Android: internal track → closed testing → production with **staged rollout** (e.g. 5% → 20% → 50% → 100%), can be halted when metrics look bad.
- Increase the percentage only when the new build's crash-free session rate and API errors are no worse than the old build's (section 7).
- Plan for review time: an urgent fix can still wait in review, so risky features should sit behind a server-side feature flag that can be turned off instantly (the `vibe-ship` skill, `references/release-rollback.md` section 3).

## 5. OTA update (EAS Update)

OTA replaces the app's JavaScript and assets without the store. Fast, but limited:

- **Only JS/assets, never native.** Adding or upgrading a library with native code, changing permissions, changing native parts of `app.config.ts`: new build through the store.
- **Runtime version** decides which builds an update can run on. The `fingerprint` policy changes the runtime version whenever native code changes, so pushing an update to an incompatible build is hard; the trade-off is more frequent new builds. With `appVersion` you must remember to bump `version` on every native change.
- **Store rules**: use it for bug fixes and small tweaks; never to add major features or change the app's purpose (section 3).
- **Each variant has its own runtime version.** The three variants in section 1 differ in name and bundle id, so `fingerprint` yields three different runtime versions: an update cannot be promoted from the `preview` channel to `production`. Publish to each channel separately from the same commit.
- `eas update` does not read `env` from the build profile in `eas.json`: without `APP_VARIANT` it computes the production runtime version, and preview builds never receive updates. Set the variable in the command (or as an EAS environment variable). Since SDK 55, `--environment` is required (missing it with `--non-interactive` fails).
- Process, run in CI, not from a dev machine:

```bash
APP_VARIANT=preview eas update --channel preview --environment preview --message "Sửa lỗi lọc khách"
# QA on the preview build; if it passes, publish the same commit to production
APP_VARIANT=production eas update --channel production --environment production --message "Sửa lỗi lọc khách"
```

- Bad update: `eas update:republish` republishes an earlier good update; `eas update:roll-back-to-embedded` returns the app to the code embedded in the build (`eas-cli` 25 commands; check `eas update --help` for other versions).
- Updates download on the next app launch, so users do not get them immediately; fixing serious issues on the server side (feature flag, kill switch) is still faster.

## 6. Forced update and old-version support

- Write the support policy in the ADR, e.g. "support releases from the last 6 months".
- The app sends `x-app-version` and `x-app-platform` on every request (`app-data.md` section 3). The server has a minimum version per platform; older builds get the `app_update_required` error (the `vibe-backend` skill, `references/api-conventions.md` section 8).
- On that error the app switches to the update screen with a button opening the store page; it does not keep working with possibly wrong data.
- Features needing new native code (camera, NFC...) exist only in the new build; users who have not updated keep running the old build, and thanks to the runtime version they do not receive OTA updates written for the new build. Anything shared with old builds (API, server-side feature flags, staff instructions) must account for them: enable features by `x-app-version` or remote flag, never assume everyone has updated.
- Raise the minimum version only when truly needed (security hole, an API change that cannot stay compatible). For ordinary API changes keep backward compatibility so old builds still work.

## 7. Crash reports and post-release monitoring

- Add crash reporting from the first release (e.g. Sentry for React Native, Firebase Crashlytics), with source map (JS), dSYM (iOS) and mapping file (Android) uploads on every build or OTA publish; otherwise stack traces are unreadable.
- Tag every report with `release` and `dist` (version + build number) to know which build the error belongs to.
- Monitor: crash-free session rate per version, API errors by `x-app-version`, share of users on the new version.
- No personal data in logs or breadcrumbs (phone numbers, customer note contents).

## 8. Release checklist

Add to the `vibe-ship` skill's `RELEASE.md` when a release includes the mobile app:

- [ ] API changes in this release are compatible with every supported app version
- [ ] Native changes? If yes, new build; if no, consider OTA
- [ ] Preview build run on a real iPhone and Android phone: main flows, push, deep links
- [ ] Release notes, store screenshots (if UI changed), reviewer demo account still works
- [ ] Sales on the web only: no prices, upgrade buttons or purchase links in the app (section 3)
- [ ] Phased release / staged rollout on; crash threshold for halting written down
- [ ] Source maps, dSYM, mapping uploaded to crash reporting
