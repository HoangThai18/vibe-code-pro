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
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '../api/client';

const PUSH_TOKEN_KEY = 'push.token';

// One registration per device, not per workspace: every spa the user works in reaches it (server side below)
export async function registerForPush(): Promise<'granted' | 'denied' | 'unsupported'> {
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
  await api('/v1/devices', { method: 'PUT', body: JSON.stringify({ pushToken, platform: Platform.OS }) });
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, pushToken);
  return 'granted';
}

// First logout step, while the session still works
export async function unregisterPush(): Promise<void> {
  const pushToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  if (!pushToken) return;
  await api(`/v1/devices/${encodeURIComponent(pushToken)}`, { method: 'DELETE' });   // Expo tokens contain [ ]
  await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
}
```

The server stores **one row per device**, linked to the user, not to a workspace: a staff member of two spas gets pushes from both through one registration, and each spa's worker reaches only its current members:

```sql
-- One row per device (push token), not per workspace. Like users, devices are not tenant data:
-- a staff member of two spas has one row, and each spa reaches it through memberships.
CREATE TABLE devices (
  push_token   text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform     text NOT NULL CHECK (platform IN ('ios', 'android')),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- PUT /v1/devices: the device belongs to whoever registered last on it ($2: user from the session, never the body)
INSERT INTO devices (push_token, user_id, platform) VALUES ($1, $2, $3)
ON CONFLICT (push_token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen_at = now();

-- DELETE /v1/devices/:pushToken (logout)
DELETE FROM devices WHERE push_token = $1 AND user_id = $2;

-- Push worker inside withTenant: the memberships RLS policy keeps only this spa's members
SELECT d.push_token FROM devices d JOIN memberships m ON m.user_id = d.user_id WHERE m.user_id = $1;
```

No RLS on `devices` (not tenant data, like `users`): every query filters by the session user or joins `memberships`. Register on every app start (refreshes `last_seen_at`, catches token changes). Registering moves the row to the new user, so a shared phone stops getting the previous user's pushes as soon as the next user signs in, even if the previous logout call failed offline.

- **Ask at the right moment**: after the user sees the benefit (e.g. when turning on "appointment reminders"), not on the first screen. iOS shows the system dialog only once; after a denial the only way is Settings.
- **Invalid tokens**: when the push service reports one (e.g. Expo's `DeviceNotRegistered`, the matching FCM/APNs error), delete the row.
- **Push content shows on the lock screen**: no sensitive data in title or body (amounts, diagnoses, someone else's OTP). Send an id and let the app load details after opening.
- **Send push from the server via a queue** (outbox + worker, the `vibe-backend` skill), with retry; never send inside a DB transaction.
- Put the `tenantId` in the push data: tapping a push opens the right workspace and screen via deep link (section 2), still checking login and permissions like any route.
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
