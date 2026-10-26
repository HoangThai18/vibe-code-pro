# Chọn cách làm app mobile

Câu hỏi đầu tiên không phải "React Native hay Flutter" mà là "có cần app cài từ store không". Mỗi lựa chọn đổi lại một khoản chi phí khác nhau: duyệt store, hai nền tảng, đội ngũ biết ngôn ngữ nào.

## Mục lục
1. Có cần app native không
2. So sánh các cách làm
3. Mặc định khuyến nghị
4. Repo chung với web
5. Expo: những điều cần biết từ đầu
6. Ghi quyết định

## 1. Có cần app native không

Web (responsive, có thể cài dạng PWA) là đủ khi người dùng chủ yếu nhập liệu, xem báo cáo, dùng trong giờ làm việc trên máy tính và thỉnh thoảng trên điện thoại. Cần app native khi có ít nhất một trong các nhu cầu:

- Push notification đáng tin cậy trên cả iOS lẫn Android là phần cốt lõi (nhắc lịch hẹn, đơn mới).
- Dùng phần cứng hoặc API hệ thống: camera quét mã liên tục, Bluetooth, NFC, vị trí nền, sinh trắc học, widget, share extension.
- Phải chạy offline thật sự (nhân viên đi thị trường, kho, vùng sóng yếu).
- Khách hàng của bạn tìm và cài app từ store, hoặc yêu cầu có app trên store.

Không có nhu cầu nào ở trên thì làm web tốt trên điện thoại trước; thêm app sau, dùng lại API và contract.

## 2. So sánh các cách làm

| Cách làm | Hợp khi | Cái giá | Tránh khi |
|---|---|---|---|
| **PWA** (web cài được) | Nhu cầu chủ yếu là xem, nhập liệu; muốn một codebase với web | Push và API phần cứng trên iOS hạn chế hơn app native; không có mặt trên store | Push là tính năng chính, cần phần cứng |
| **Expo / React Native** | Team đã dùng React/TypeScript (stack web mặc định của vibe); dùng chung type, contract, logic với web | Hai nền tảng vẫn khác nhau ở chi tiết; module native lạ thì phải viết thêm | Đồ hoạ nặng, game |
| **Flutter** | Team biết Dart hoặc muốn giao diện tự vẽ giống hệt nhau trên mọi nền tảng | Không dùng chung code với web React; thêm một ngôn ngữ trong dự án | Team chỉ có dev web React |
| **Native** (Swift/SwiftUI, Kotlin/Compose) | Phụ thuộc sâu vào API hệ thống, hiệu năng tối đa, team có người native | Hai codebase, hai team | Team nhỏ cần ra cả hai nền tảng nhanh |
| **Kotlin Multiplatform** | Muốn dùng chung logic nhưng UI native từng nền tảng | Công cụ và hệ sinh thái còn thay đổi nhanh | Team không có người Kotlin |

## 3. Mặc định khuyến nghị

Cho team nhỏ làm SaaS với web React/TypeScript:

- **Expo (React Native) với Expo Router**, TypeScript, cùng monorepo với web.
- Dùng chung `packages/contracts` (zod schema, type của API) giữa web, mobile và backend: lệch contract bị bắt lúc build.
- Server state bằng TanStack Query như web; lưu token bằng `expo-secure-store`; build và phát hành bằng EAS (`release.md`).
- Chọn Flutter khi team đã quen Dart, hoặc giao diện tự vẽ là phần giá trị chính của sản phẩm.

## 4. Repo chung với web

```text
apps/
├── web/            Next.js hoặc Vite
├── mobile/         Expo (app.config.ts, app/ cho Expo Router)
└── api/
packages/
├── contracts/      zod schema + type dùng chung cho web, mobile, api
└── ui-tokens/      design token (màu, spacing, chữ) xuất ra cho web (CSS/Tailwind) và mobile (object TS)
```

- Không dùng chung component UI giữa web và mobile trừ khi đã chọn thư viện làm việc đó (React Native Web, Tamagui...); dùng chung token và logic thì gần như luôn đáng.
- Thêm lệnh của mobile (`start`, `test`, `lint`, `typecheck`) vào `CLAUDE.md` cùng chỗ với web.

## 5. Expo: những điều cần biết từ đầu

- **Expo Go chỉ để thử nhanh.** App thật dùng *development build* (`expo-dev-client`): có đúng các module native của app, giống bản phát hành hơn.
- **Continuous Native Generation**: thư mục `ios/`, `android/` sinh ra từ `app.config.ts` và config plugin (`npx expo prebuild`). Đang dùng cách này thì đừng sửa tay hai thư mục đó (lần prebuild sau sẽ ghi đè); cần đổi gì native thì viết config plugin.
- **Cài thư viện bằng `npx expo install <gói>`**, không phải `npm install`: lệnh này chọn version khớp với SDK đang dùng.
- Mỗi bản SDK Expo gắn với một bản React Native; nâng SDK theo hướng dẫn nâng cấp của Expo, làm thành task riêng có test (skill `ship`, `maintenance.md`).

## 6. Ghi quyết định

Ghi vào `docs/plan/ARCHITECTURE.md` (bảng ADR): nền tảng nào (iOS, Android, PWA), cách làm, version tối thiểu của iOS/Android hỗ trợ, có cần offline không và ở mức nào (`app-data.md` mục 5), chính sách hỗ trợ bản app cũ (`release.md` mục 6).
