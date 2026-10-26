# Platform features: push, deep links, permissions, background, UI

## Contents
1. Push notifications
2. Deep links and universal links
3. Permissions
4. Background and reminders
5. UI from design
6. Accessibility (a11y)

## 1. Push notifications

```ts
// src/push/register.ts
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '../api/client';

export async function registerForPush(tenantId: string): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!Device.isDevice) return 'unsupported';                 // simulators get no APNs push
  if (Platform.OS === 'android') {
    // Android 13+: the channel must exist before asking for permission
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Thông báo',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return 'denied';
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const { data: pushToken } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api(`/v1/t/${tenantId}/devices`, {
    method: 'PUT',
    body: JSON.stringify({ pushToken, platform: Platform.OS }),
  });
  return 'granted';
}
```

- **Ask at the right moment**: after the user sees the benefit (e.g. when turning on "appointment reminders"), not on the first screen. iOS shows the system dialog only once; after a denial the only way is Settings.
- **Server stores tokens per device**: table `devices(user_id, tenant_id, push_token UNIQUE, platform, last_seen_at)`. Logout deletes that device's row; when the push service reports an invalid token (e.g. Expo's `DeviceNotRegistered`, the matching FCM/APNs error), delete the token.
- **Push content shows on the lock screen**: no sensitive data in title or body (amounts, diagnoses, someone else's OTP). Send an id and let the app load details after opening.
- **Send push from the server via a queue** (outbox + worker, the `vibe-backend` skill), with retry; never send inside a DB transaction.
- Tapping a push opens the right screen via deep link (section 2), still checking login and permissions like any route.
- Use the Expo push service for simplicity, or send to FCM/APNs directly when needed; both need credentials configured on EAS (`release.md` section 2).

## 2. Deep links and universal links

- **Custom scheme** (`scheme: 'spacrm'` in `app.config.ts`): easy, but another app can register the same scheme. Use for internal flows, never for login or payment.
- **Universal Link (iOS) / App Link (Android)**: `https://app.example.vn/...` opens the app if installed, the web otherwise. Needs `associatedDomains: ['applinks:app.example.vn']` (iOS), `intentFilters` with `autoVerify: true` (Android), and two files on the domain: `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json`.
- Expo Router maps paths to routes automatically. Treat link parameters as **untrusted input**: validate (zod), check permissions as for a normal request, and never perform an action (confirm, pay, delete) just because the user tapped a link.

## 3. Permissions

- Declare only permissions you actually use. Each iOS permission needs a clear usage description in the user's language; vague text like "App cần quyền camera" ("the app needs camera access") is often rejected in review. With Expo, set it through the library's config plugin (e.g. the `cameraPermission` option of the `expo-camera` plugin) in `app.config.ts`.
- Handle all three states: granted, denied but can ask again, permanently blocked (only `Linking.openSettings()` left).
- Location: ask for "while using the app" first; background location only when the feature requires it, and the store will ask why.

## 4. Background and reminders

- iOS strictly limits background work: background tasks are not guaranteed to run on time, sometimes not at all. Do not rely on the app for important scheduled work.
- Appointment reminders, payment due dates: **the server schedules and sends push** (cron/worker per tenant); the app only displays. Use local notifications only for device-only reminders.
- App returns to foreground: refresh data (`app-data.md` section 4) and flush the write queue (section 6 of the same file).

## 5. UI from design

Same process as web (the `vibe-frontend` skill, `references/design-to-code.md`): inventory screens and states, tokens first, components next, screenshot and compare with the design. Mobile differences:

- **Tokens shared** with web from `packages/ui-tokens` (`choose-stack.md` section 4), exported as a TypeScript object for `StyleSheet`; units are dp/pt, not CSS px.
- **Safe area** (notch, navigation bar): `react-native-safe-area-context`. **Keyboard** covering inputs: check every form on a small-screen device.
- **Long lists**: `FlatList` (or `FlashList`) with cursor pagination from the API, never render the whole list with `map`.
- **Platform conventions**: swipe back (iOS), hardware back button (Android), dialogs and pickers in each OS's style.
- **Screenshots for checking**: iOS simulator `xcrun simctl io booted screenshot shot.png`; Android `adb exec-out screencap -p > shot.png`. Compare at the smallest and largest supported devices, light and dark mode.

## 6. Accessibility (a11y)

- Every icon-only button has an `accessibilityLabel`; tappable elements have an `accessibilityRole`.
- Minimum touch target 44×44 pt (iOS) / 48×48 dp (Android).
- Allow large text from system settings (do not disable `allowFontScaling`); check the layout holds at the largest font size.
- Walk the main flows with VoiceOver (iOS) and TalkBack (Android) at least once before release.
