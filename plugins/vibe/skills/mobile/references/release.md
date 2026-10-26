# Build, phát hành store, OTA, crash report

Khác biệt lớn nhất với web: **không rollback được bản đã cài**, và mỗi bản lên store phải qua duyệt (thường vài giờ tới vài ngày). Kế hoạch phát hành phải tính cả hai điều đó.

## Mục lục
1. Môi trường và profile build
2. Ký app và credentials
3. Luật của store cần thiết kế từ đầu
4. Phiên bản và phát hành dần
5. OTA update (EAS Update)
6. Buộc cập nhật và hỗ trợ bản cũ
7. Crash report và theo dõi sau phát hành
8. Checklist phát hành

## 1. Môi trường và profile build

Ba biến thể cài được cạnh nhau trên cùng một máy (khác bundle id), trỏ vào ba môi trường:

```ts
// app.config.ts
import type { ExpoConfig } from 'expo/config';

const variant = process.env.APP_VARIANT || 'production';   // development | preview | production (chuỗi rỗng cũng là production)
const suffix = variant === 'production' ? '' : `.${variant}`;

const config: ExpoConfig = {
  name: variant === 'production' ? 'Spa CRM' : `Spa CRM (${variant})`,
  slug: 'spa-crm',
  scheme: 'spacrm',
  version: '1.4.0',                                  // phiên bản người dùng thấy
  runtimeVersion: { policy: 'fingerprint' },         // mục 5
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

(đó là `eas.json`, đã kiểm bằng chính bộ đọc cấu hình của `eas-cli` 25). `appVersionSource: "remote"` + `autoIncrement`: EAS tự tăng số build (iOS `buildNumber`, Android `versionCode`), không phải nhớ sửa tay. Profile `development` cần cài `expo-dev-client`; EAS Update cần `expo-updates` (`npx expo install expo-dev-client expo-updates`, hoặc `eas update:configure`).

```bash
eas build --profile preview --platform all          # bản cài nội bộ cho QA
eas build --profile production --platform all
eas submit --profile production --platform ios      # đẩy lên App Store Connect (TestFlight)
eas submit --profile production --platform android  # đẩy lên Google Play Console
```

URL API và các cấu hình khác theo biến thể đặt trong biến `EXPO_PUBLIC_*` của từng môi trường. Mọi thứ trong app đều đọc được: không có secret nào ở đây.

## 2. Ký app và credentials

- Để EAS quản lý chứng chỉ iOS, provisioning profile, keystore Android; không commit file ký vào repo.
- Android: bật Play App Signing (Google giữ khoá ký app, bạn giữ upload key). Mất upload key thì xin reset được; mất khoá ký app khi tự quản là không cập nhật app được nữa.
- Push: cấu hình APNs key (iOS) và FCM (Android) trong EAS credentials.
- Ghi vào `CLAUDE.md`/runbook: ai có quyền tài khoản Apple Developer, Google Play Console, EAS; tài khoản thuộc công ty, không thuộc cá nhân.

## 3. Luật của store cần thiết kế từ đầu

Những điều sau thường làm bản đầu bị từ chối, và sửa thì phải đổi luồng:

| Yêu cầu | Nội dung | Ảnh hưởng thiết kế |
|---|---|---|
| Xoá tài khoản (Apple 5.1.1(v); Google Play cũng yêu cầu, kèm một link web để xoá) | App có tạo tài khoản thì phải cho xoá tài khoản ngay trong app | Cần API xoá tài khoản, xử lý dữ liệu theo chính sách lưu trữ, tenant còn thành viên khác |
| Đăng nhập (Apple 4.8) | Dùng đăng nhập qua Google, Facebook... cho tài khoản chính thì phải có thêm một lựa chọn đăng nhập đáp ứng tiêu chí riêng tư (Sign in with Apple là cách thường dùng) | Thêm nhà cung cấp đăng nhập từ đầu |
| Mua trong app (Apple 3.1.1, Google Play Billing) | Mở khoá tính năng, gói dịch vụ số bán trong app phải qua hệ thống thanh toán của store | Quyết định sớm: bán trong app, hay app chỉ để dùng còn mua bán ở web. Quy định có ngoại lệ và đổi theo khu vực: đọc bản hiện hành, hỏi người phụ trách pháp lý |
| Code tải về (Apple 2.5.2; Google Play cấm tải code native ngoài store) | Không tải về code làm thêm hoặc đổi tính năng chính | OTA chỉ để sửa lỗi và chỉnh nhỏ (mục 5) |
| Quyền riêng tư | Khai báo dữ liệu thu thập (App Privacy trên App Store, Data safety trên Google Play); privacy manifest của iOS cho các API cần lý do | Liệt kê SDK bên thứ ba và dữ liệu chúng thu |
| Tài khoản để duyệt | Người duyệt phải đăng nhập được | Chuẩn bị tài khoản demo có dữ liệu mẫu, không cần OTP thật |

Google Play còn yêu cầu target API level Android gần đây cho bản mới và bản cập nhật; kiểm mốc hiện hành trong Play Console trước mỗi đợt phát hành lớn.

## 4. Phiên bản và phát hành dần

- `version` (người dùng thấy, vd 1.4.0) theo thay đổi tính năng; số build tăng mỗi lần build (EAS tự tăng).
- iOS: TestFlight cho nhóm nội bộ → phát hành với **phased release** (tăng dần trong 7 ngày, tạm dừng được).
- Android: track internal → closed testing → production với **staged rollout** (vd 5% → 20% → 50% → 100%), dừng được khi chỉ số xấu.
- Tăng tỉ lệ chỉ khi tỉ lệ phiên không crash và lỗi API của bản mới không xấu hơn bản cũ (mục 7).
- Tính thời gian duyệt vào kế hoạch: bản sửa lỗi gấp vẫn có thể chờ duyệt; vì vậy tính năng rủi ro nên đi sau feature flag phía server để tắt được ngay (skill `ship`, `release-rollback.md` mục 3).

## 5. OTA update (EAS Update)

OTA thay phần JavaScript và asset của app mà không qua store. Nhanh, nhưng có giới hạn:

- **Chỉ thay JS/asset, không thay native.** Thêm hoặc nâng thư viện có code native, đổi quyền, đổi `app.config.ts` phần native: phải build mới và qua store.
- **Runtime version** quyết định bản update chạy được trên bản build nào. Chính sách `fingerprint` tự đổi runtime version mỗi khi phần native thay đổi, nên khó đẩy nhầm update lên bản build không tương thích; đánh đổi là build mới thường xuyên hơn. Dùng `appVersion` thì phải nhớ tăng `version` mỗi lần đổi native.
- **Theo luật store**: dùng để sửa lỗi, chỉnh nhỏ; không dùng để thêm tính năng lớn hay đổi mục đích app (mục 3).
- **Mỗi biến thể có runtime version riêng.** Ba biến thể ở mục 1 khác tên và bundle id, nên chính sách `fingerprint` cho ra ba runtime version khác nhau: không chuyển được một bản update từ kênh `preview` sang `production`. Đẩy riêng cho từng kênh từ cùng một commit.
- `eas update` không đọc `env` trong profile build của `eas.json`: thiếu `APP_VARIANT` thì nó tính runtime version của bản production, và bản preview không bao giờ nhận được update. Đặt biến này ngay trong lệnh (hoặc thành biến môi trường trên EAS). Từ SDK 55 phải có `--environment` (chạy `--non-interactive` mà thiếu thì lỗi).
- Quy trình, chạy trong CI, không từ máy dev:

```bash
APP_VARIANT=preview eas update --channel preview --environment preview --message "Sửa lỗi lọc khách"
# QA trên bản preview, đạt thì đẩy cùng commit lên production
APP_VARIANT=production eas update --channel production --environment production --message "Sửa lỗi lọc khách"
```

- Bản update lỗi: `eas update:republish` đẩy lại một bản update tốt trước đó; `eas update:roll-back-to-embedded` đưa app về code đi kèm bản build (lệnh của `eas-cli` 25; xem `eas update --help` nếu bản khác).
- Update tải về ở lần mở app sau, nên người dùng không nhận ngay; sửa lỗi nghiêm trọng phía server (feature flag, kill switch) vẫn nhanh hơn.

## 6. Buộc cập nhật và hỗ trợ bản cũ

- Chính sách hỗ trợ ghi vào ADR, vd "hỗ trợ các bản phát hành trong 6 tháng gần nhất".
- App gửi `x-app-version`, `x-app-platform` mỗi request (`app-data.md` mục 3). Server có cấu hình phiên bản tối thiểu theo nền tảng; bản thấp hơn nhận lỗi `app_update_required` (skill `backend`, `api-conventions.md` mục 8; từ file này: `../../backend/references/api-conventions.md`).
- App gặp lỗi đó thì chuyển sang màn hình cập nhật, có nút mở trang app trên store; không cho dùng tiếp với dữ liệu có thể sai.
- Tính năng cần code native mới (camera, NFC...) chỉ có ở bản build mới; người dùng chưa cập nhật vẫn chạy bản cũ, và nhờ runtime version họ không nhận các OTA update viết cho bản mới. Phần dùng chung với bản cũ (API, cờ bật tính năng từ server, hướng dẫn cho nhân viên) phải tính đến họ: bật tính năng theo `x-app-version` hoặc remote flag, không giả định mọi người đã cập nhật.
- Chỉ nâng phiên bản tối thiểu khi thật cần (lỗ hổng bảo mật, thay đổi API không giữ tương thích được). Thay đổi API thông thường thì giữ tương thích ngược để bản cũ vẫn chạy.

## 7. Crash report và theo dõi sau phát hành

- Gắn crash reporting ngay từ bản đầu (vd Sentry cho React Native, Firebase Crashlytics), kèm upload source map (JS), dSYM (iOS), mapping file (Android) mỗi lần build hoặc đẩy OTA, nếu không stack trace không đọc được.
- Gắn `release` và `dist` (phiên bản + số build) cho mỗi báo cáo để biết lỗi thuộc bản nào.
- Theo dõi: tỉ lệ phiên không crash theo phiên bản, lỗi API theo `x-app-version`, tỉ lệ người dùng đã lên bản mới.
- Không gửi dữ liệu cá nhân trong log và breadcrumb (số điện thoại, nội dung ghi chú của khách).

## 8. Checklist phát hành

Thêm vào `RELEASE.md` của skill `ship` khi bản phát hành có app mobile:

- [ ] Thay đổi API của bản này tương thích với mọi bản app còn hỗ trợ
- [ ] Đổi native? Có thì build mới; không thì cân nhắc OTA
- [ ] Đã chạy bản preview trên iPhone và máy Android thật, luồng chính và push, deep link
- [ ] Ghi chú phát hành, ảnh màn hình store (nếu đổi giao diện), tài khoản demo cho người duyệt còn dùng được
- [ ] Phased release / staged rollout bật; ngưỡng crash để dừng đã ghi rõ
- [ ] Source map, dSYM, mapping đã upload lên crash reporting
