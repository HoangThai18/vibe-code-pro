# Tính năng của nền tảng: push, deep link, quyền, background, UI

## Mục lục
1. Push notification
2. Deep link và universal link
3. Xin quyền
4. Background và nhắc việc
5. Dựng UI từ design
6. Truy cập được (a11y)

## 1. Push notification

```ts
// src/push/register.ts
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '../api/client';

export async function registerForPush(tenantId: string): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!Device.isDevice) return 'unsupported';                 // simulator không nhận push từ APNs
  if (Platform.OS === 'android') {
    // Android 13+: phải có channel trước khi xin quyền
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

- **Xin quyền đúng lúc**: sau khi user hiểu lợi ích (vd lúc bật "nhắc lịch hẹn"), không phải ngay màn hình đầu. iOS chỉ hiện hộp thoại hệ thống một lần; bị từ chối thì chỉ còn cách mở Cài đặt.
- **Server lưu token theo thiết bị**: bảng `devices(user_id, tenant_id, push_token UNIQUE, platform, last_seen_at)`. Đăng xuất thì xoá dòng của thiết bị đó; dịch vụ push báo token không còn hợp lệ (vd `DeviceNotRegistered` của Expo, lỗi tương ứng của FCM/APNs) thì xoá token.
- **Nội dung push hiện trên màn hình khoá**: không đưa dữ liệu nhạy cảm vào tiêu đề và nội dung (số tiền, chẩn đoán, mã OTP của người khác). Gửi id để app tự tải chi tiết sau khi mở.
- **Gửi push từ server, qua hàng đợi** (outbox + worker, skill `backend`), có retry; không gửi bên trong transaction DB.
- Bấm vào push mở đúng màn hình qua deep link (mục 2), vẫn kiểm đăng nhập và quyền như mọi route.
- Dùng Expo push service cho gọn, hoặc gửi thẳng FCM/APNs khi cần; cả hai cần cấu hình credentials trên EAS (`release.md` mục 2).

## 2. Deep link và universal link

- **Custom scheme** (`scheme: 'spacrm'` trong `app.config.ts`): dễ làm, nhưng app khác có thể đăng ký cùng scheme. Dùng cho luồng nội bộ, không dùng cho đăng nhập hay thanh toán.
- **Universal link (iOS) / App Link (Android)**: link `https://app.example.vn/...` mở thẳng app nếu đã cài, mở web nếu chưa. Cần `associatedDomains: ['applinks:app.example.vn']` (iOS), `intentFilters` với `autoVerify: true` (Android), và hai file trên domain: `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json`.
- Expo Router tự map đường dẫn vào route. Coi tham số từ link là **đầu vào không tin được**: validate (zod), kiểm quyền như request bình thường, không tự thực hiện hành động (xác nhận, thanh toán, xoá) chỉ vì user bấm link.

## 3. Xin quyền

- Chỉ khai báo quyền thật sự dùng. Mỗi quyền iOS cần câu giải thích (usage description) rõ ràng bằng ngôn ngữ của người dùng; câu chung chung như "App cần quyền camera" dễ bị từ chối khi duyệt. Với Expo, đặt câu này qua config plugin của thư viện (vd tham số `cameraPermission` của plugin `expo-camera`) trong `app.config.ts`.
- Xử lý đủ ba trạng thái: được cấp, bị từ chối nhưng còn hỏi lại được, bị chặn hẳn (chỉ còn `Linking.openSettings()`).
- Vị trí: xin "khi đang dùng app" trước; vị trí nền chỉ khi tính năng bắt buộc, và store sẽ hỏi lý do.

## 4. Background và nhắc việc

- iOS giới hạn chặt việc chạy nền: tác vụ nền không được đảm bảo chạy đúng giờ, có khi không chạy. Đừng dựa vào app để làm việc quan trọng theo lịch.
- Nhắc lịch hẹn, hạn thanh toán: **server lên lịch và gửi push** (cron/worker theo từng tenant), app chỉ hiển thị. Thông báo cục bộ (local notification) chỉ dùng cho nhắc việc của riêng thiết bị.
- App quay lại foreground: làm mới dữ liệu (`app-data.md` mục 4) và gửi hàng đợi ghi (mục 6 cùng file).

## 5. Dựng UI từ design

Quy trình giống web (skill `frontend`, `design-to-code.md`; từ file này: `../../frontend/references/design-to-code.md`): kiểm kê màn hình và state, token trước, component sau, chụp ảnh so với design. Khác biệt của mobile:

- **Token dùng chung** với web từ `packages/ui-tokens` (`choose-stack.md` mục 4), xuất ra object TypeScript cho `StyleSheet`; đơn vị là dp/pt, không phải px của CSS.
- **Safe area** (tai thỏ, thanh điều hướng): `react-native-safe-area-context`. **Bàn phím** che ô nhập: kiểm mọi form trên máy màn hình nhỏ.
- **Danh sách dài**: `FlatList` (hoặc `FlashList`) có phân trang theo cursor từ API, không render cả danh sách bằng `map`.
- **Quy ước nền tảng**: vuốt để quay lại (iOS), nút back cứng (Android), hộp thoại và picker theo kiểu của từng hệ điều hành.
- **Chụp màn hình để kiểm**: iOS simulator `xcrun simctl io booted screenshot shot.png`; Android `adb exec-out screencap -p > shot.png`. So ở máy nhỏ nhất và lớn nhất đang hỗ trợ, chế độ sáng và tối.

## 6. Truy cập được (a11y)

- Mọi nút chỉ có icon phải có `accessibilityLabel`; phần tử bấm được có `accessibilityRole`.
- Vùng chạm tối thiểu 44×44 pt (iOS) / 48×48 dp (Android).
- Cho phép chữ to theo cài đặt hệ thống (không tắt `allowFontScaling`), kiểm layout không vỡ ở cỡ chữ lớn nhất.
- Đi hết luồng chính bằng VoiceOver (iOS) và TalkBack (Android) ít nhất một lần trước khi phát hành.
