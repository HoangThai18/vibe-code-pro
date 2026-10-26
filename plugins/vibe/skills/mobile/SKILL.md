---
name: mobile
description: "Làm app mobile iOS và Android: chọn cách làm (Expo/React Native, Flutter, native, PWA), điều hướng, lưu token an toàn (Keychain/Keystore), offline và đồng bộ, push, deep link, xin quyền, test (Jest, Maestro), build và lên App Store/Google Play, OTA update, buộc bản cũ cập nhật. Dùng khi user làm app điện thoại hoặc nhắc 'mobile', 'app iOS', 'app Android', 'React Native', 'Expo', 'Flutter', 'TestFlight', 'lên store', 'EAS', 'push notification', 'deep link'. Web trên trình duyệt điện thoại thì dùng skill frontend."
---

# Mobile: app iOS và Android

Thư mục skill: `${CLAUDE_SKILL_DIR}`. Chỉ đọc phần cần cho việc đang làm:

| Việc | Đọc |
|---|---|
| Chọn cách làm và stack cho app mới, monorepo với web | `references/choose-stack.md` |
| Cấu trúc app, đăng nhập, lưu token, gọi API, dữ liệu offline và đồng bộ, đổi workspace, đăng xuất | `references/app-data.md` |
| Push notification, deep link, xin quyền, background, a11y, dựng UI từ design | `references/platform-features.md` |
| Test: unit, component, E2E trên emulator và thiết bị | `references/testing.md` |
| Build, ký, phát hành store, OTA update, crash report, buộc cập nhật | `references/release.md` |

Phần dùng chung với web giữ ở skill khác, không lặp lại ở đây: nguyên tắc dựng UI từ design (`${CLAUDE_SKILL_DIR}/../frontend/references/design-to-code.md`), server state và đổi tenant (`${CLAUDE_SKILL_DIR}/../frontend/references/state-management.md`), API contract (`${CLAUDE_SKILL_DIR}/../backend/references/api-conventions.md`, có mục riêng cho client sống lâu như app mobile).

Expo, React Native, Flutter đổi API theo từng bản. Kiểm version đang cài và tài liệu đúng version trước khi dùng API chưa chắc (`${CLAUDE_SKILL_DIR}/../plan/references/tech-research.md`).

**Cân đúng mức.** Sửa một màn hình, đổi chữ, chỉnh style thì làm thẳng theo code xung quanh. Các quy tắc dưới là cho tính năng mới, thay đổi chạm tới đăng nhập, dữ liệu, quyền, và mỗi lần phát hành.

## Quy tắc luôn áp dụng

1. **App đã cài không rollback được.** Bản cũ còn chạy trên máy người dùng nhiều tháng. API phải tương thích với mọi bản app còn hỗ trợ; có cơ chế phiên bản tối thiểu để buộc cập nhật khi thật cần (`references/release.md` mục 6).
2. **Token chỉ nằm trong Keychain/Keystore** (`expo-secure-store`, `flutter_secure_storage`), không trong AsyncStorage hay SharedPreferences thường. Không nhúng secret của server vào app: ai cũng giải nén được file app.
3. **Mạng chập chờn là bình thường.** Mọi màn hình có trạng thái đang tải, lỗi, offline. Thao tác ghi gửi kèm idempotency key để gửi lại không tạo bản ghi trùng.
4. **Tenant và phiên như web**: tenant nằm trong request (path), cache theo tenant; đổi workspace thì bỏ cache của workspace cũ; đăng xuất thì xoá token, cache, dữ liệu offline và hủy đăng ký push của thiết bị.
5. **Xin quyền đúng lúc** (ngay trước khi dùng tính năng), giải thích vì sao. User từ chối thì app vẫn chạy, chỉ tính năng đó bị tắt.
6. **OTA chỉ thay JS và asset**, không thay code native, và không đổi mục đích chính của app. Đổi native thì build mới qua store.
7. **Luật của store quyết định thiết kế luồng**: xoá tài khoản trong app, lựa chọn đăng nhập riêng tư khi có đăng nhập qua Google/Facebook, mua nội dung số qua in-app purchase, khai báo quyền riêng tư. Kiểm ngay lúc plan (`references/release.md` mục 3); bị từ chối rồi mới sửa thì mất nhiều ngày.
8. **Thử trên thiết bị thật trước khi phát hành**: ít nhất một iPhone và một máy Android tầm trung, không chỉ simulator.

## Trước khi coi là xong

- Chạy trên iOS simulator và Android emulator (hoặc thiết bị), chụp màn hình so với design ở cỡ máy nhỏ nhất và lớn nhất đang hỗ trợ.
- Test unit/component pass; luồng chính có flow E2E (`references/testing.md`).
- Thử tắt mạng giữa chừng, cỡ chữ hệ thống lớn, chế độ tối, xoay màn hình nếu app hỗ trợ, đọc màn hình bằng VoiceOver/TalkBack ở luồng chính.
- Thay đổi chạm API: bản app cũ còn hỗ trợ vẫn chạy với server mới.
