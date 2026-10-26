# Packaging, code signing, auto-update

## Contents
1. Packaging
2. Code signing and notarization
3. Auto-update
4. Staged rollout and bad releases
5. Crash reports
6. Release CI
7. Release checklist

## 1. Packaging

| | Electron | Tauri |
|---|---|---|
| Tool | Electron Forge (official) or electron-builder | `tauri build` |
| Formats | Windows: NSIS/Squirrel/MSI; macOS: DMG/ZIP; Linux: AppImage, deb, rpm | Windows: NSIS/MSI; macOS: app/DMG; Linux: AppImage, deb, rpm |
| Notes | Set fuses at packaging (`security.md` section 5); rebuild native modules (e.g. `better-sqlite3`) for the Electron version | Small installer; Windows needs WebView2 (the installer can bundle a bootstrapper) |

Build each OS on that OS (CI matrix, section 6); cross-builds tend to miss signing and native modules.

## 2. Code signing and notarization

- **macOS**: a "Developer ID Application" certificate from the Apple Developer account, hardened runtime on, then **notarize** (Apple scans it, `xcrun notarytool`; Electron Forge/electron-builder and Tauri all have built-in config). Gatekeeper blocks non-notarized builds from opening.
- **Windows**: Authenticode signing with a code signing certificate or a cloud signing service (e.g. Azure Trusted Signing). SmartScreen warns on unsigned builds; new certificates need time to build reputation.
- **Linux**: executables are usually not signed; sign the distribution repo (deb/rpm) if you have one.
- Certificates, passwords and signing keys live in CI secrets (GitHub Environments with required reviewers), never on personal machines or in the repo. Record in the runbook who holds them, expiry dates and how to renew.

## 3. Auto-update

| | Electron | Tauri |
|---|---|---|
| How | Electron's `autoUpdater` with update.electronjs.org (open-source apps on GitHub), or `electron-updater` (from electron-builder) with GitHub Releases, S3, your own server | `updater` plugin: an endpoint returns JSON describing the new version |
| Update verification | Relies on code signing (macOS, Windows), so step 2 is mandatory | Tauri's own signature, **mandatory, cannot be disabled**: create a key pair with `tauri signer generate`, build with `TAURI_SIGNING_PRIVATE_KEY`, put the public key in `plugins.updater.pubkey` |

Tauri updater config (test-built with Tauri 2.12: a `.sig` file comes with the installer; without `pubkey` the app stops at startup; with `pubkey` but no private key the build fails):

```json
{
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "<contents of the .pub file created by tauri signer generate>",
      "endpoints": ["https://releases.example.vn/spa-crm/{{target}}/{{arch}}/{{current_version}}"]
    }
  }
}
```

(`pubkey` placeholder: the contents of the `.pub` file created by `tauri signer generate`.) Build releases with `TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key has a password) from CI secrets.

- Losing the Tauri update signing key means **you can never push updates to installed copies**: back up the key somewhere safe, off the build machine.
- The update endpoint uses HTTPS; never let users enter an update URL.
- Ask the user before restarting; wait if there is unsaved work or an unsent offline queue.
- Test the real update flow: install the previous version, publish the new one to a test channel, confirm the old version updates itself.

## 4. Staged rollout and bad releases

- A `beta` channel for the internal group before `stable`. electron-updater supports percentage rollout (`stagingPercentage`); with Tauri, the endpoint decides what percentage of machines get the new version.
- **Installed builds cannot be rolled back.** For a bad release: stop serving it on the endpoint, ship a fix with a higher version number, turn off the broken feature with a server-side feature flag if you have one.
- The API must stay compatible with supported versions; too-old builds get `app_update_required` as on mobile (the `vibe-backend` skill, `references/api-conventions.md` section 8).

## 5. Crash reports

- Electron: `@sentry/electron` (catches errors in both main and renderer), or `crashReporter` sending minidumps to your own server. Tauri: the Sentry SDKs for Rust and for the web part.
- Tag every report with version and OS; upload renderer source maps and build symbols.
- No personal data or user file paths (they usually contain the username) in logs.

## 6. Release CI

```yaml
# Matrix packaging job skeleton (combine with the ship skill's ci-cd.md)
jobs:
  package:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    environment: release          # signing secrets exist only in the environment with reviewers
    steps:
      - uses: actions/checkout@v4
      # install Node (and Rust for Tauri), install dependencies, run tests
      # package + sign + notarize with Electron Forge/electron-builder/Tauri tooling
      # upload installers and update files to the release host (GitHub Releases, S3...)
```

Exact packaging commands and signing environment variables follow the current docs of your tool; they change between major versions.

## 7. Release checklist

- [ ] Tests (including security tests) pass on all three shipped OSes
- [ ] Packaged builds signed; macOS notarized; opens on a clean machine with no warning
- [ ] Update from the previous version to this one works; data and login session intact; local DB migrations run correctly
- [ ] API compatible with supported versions
- [ ] Released to the beta channel first; crash threshold for halting written down
- [ ] Source maps and symbols uploaded to crash reporting
