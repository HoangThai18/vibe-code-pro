# Đóng gói, ký số, tự cập nhật

## Mục lục
1. Đóng gói
2. Ký số và notarize
3. Tự cập nhật
4. Phát hành dần và khi bản mới lỗi
5. Crash report
6. CI phát hành
7. Checklist phát hành

## 1. Đóng gói

| | Electron | Tauri |
|---|---|---|
| Công cụ | Electron Forge (của Electron) hoặc electron-builder | `tauri build` |
| Định dạng | Windows: NSIS/Squirrel/MSI; macOS: DMG/ZIP; Linux: AppImage, deb, rpm | Windows: NSIS/MSI; macOS: app/DMG; Linux: AppImage, deb, rpm |
| Lưu ý | Đặt fuses lúc đóng gói (`security.md` mục 5); module native (vd `better-sqlite3`) build lại theo bản Electron | Bộ cài nhỏ; Windows cần WebView2 (bộ cài có thể kèm bootstrapper) |

Build mỗi hệ điều hành trên chính hệ điều hành đó (CI ma trận, mục 6); build chéo dễ thiếu ký số và module native.

## 2. Ký số và notarize

- **macOS**: chứng chỉ "Developer ID Application" của tài khoản Apple Developer, bật hardened runtime, rồi **notarize** (gửi Apple quét, `xcrun notarytool`; Electron Forge/electron-builder và Tauri đều có cấu hình sẵn). Bản không notarize bị Gatekeeper chặn mở.
- **Windows**: ký Authenticode bằng chứng chỉ code signing hoặc dịch vụ ký trên cloud (vd Azure Trusted Signing). Bản không ký bị SmartScreen cảnh báo; chứng chỉ mới cần thời gian tích luỹ uy tín.
- **Linux**: thường không ký file chạy; ký kho phân phối (repo deb/rpm) nếu có.
- Chứng chỉ, mật khẩu, khoá ký để trong secret của CI (GitHub Environments có người duyệt), không trên máy cá nhân, không trong repo. Ghi trong runbook ai giữ, hạn dùng, cách gia hạn.

## 3. Tự cập nhật

| | Electron | Tauri |
|---|---|---|
| Cách làm | `autoUpdater` của Electron với update.electronjs.org (app mã nguồn mở trên GitHub), hoặc `electron-updater` (của electron-builder) với GitHub Releases, S3, server riêng | Plugin `updater`: endpoint trả JSON mô tả bản mới |
| Xác thực bản cập nhật | Dựa vào chữ ký code (macOS, Windows), nên bước 2 là bắt buộc | Chữ ký riêng của Tauri, **bắt buộc, không tắt được**: tạo cặp khoá bằng `tauri signer generate`, build với `TAURI_SIGNING_PRIVATE_KEY`, đặt public key trong `plugins.updater.pubkey` |

Cấu hình updater của Tauri (đã build thử với Tauri 2.12: có file `.sig` kèm bộ cài; thiếu `pubkey` thì app dừng lúc khởi động; có `pubkey` mà thiếu private key thì build báo lỗi):

```json
{
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "<nội dung file .pub do tauri signer generate tạo>",
      "endpoints": ["https://releases.example.vn/spa-crm/{{target}}/{{arch}}/{{current_version}}"]
    }
  }
}
```

Build phát hành với `TAURI_SIGNING_PRIVATE_KEY` (và `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` nếu khoá có mật khẩu) lấy từ secret của CI.

- Mất khoá ký cập nhật của Tauri là **không đẩy được bản cập nhật cho các bản đã cài**: sao lưu khoá ở nơi an toàn, ngoài máy build.
- Endpoint cập nhật dùng HTTPS; không cho người dùng tự nhập URL cập nhật.
- Hỏi người dùng trước khi khởi động lại; đang có thao tác chưa lưu hoặc hàng đợi offline chưa gửi thì chờ.
- Kiểm luồng cập nhật thật: cài bản trước, phát hành bản mới lên kênh thử, xác nhận bản cũ tự lên được bản mới.

## 4. Phát hành dần và khi bản mới lỗi

- Kênh `beta` cho nhóm nội bộ trước kênh `stable`. electron-updater hỗ trợ phát hành theo tỉ lệ (`stagingPercentage`); với Tauri, endpoint tự quyết trả bản mới cho bao nhiêu phần trăm máy.
- **Không rollback được bản đã cài.** Bản mới lỗi: ngừng phát hành bản đó trên endpoint, phát hành bản sửa với số version cao hơn, tắt tính năng lỗi bằng feature flag phía server nếu có.
- API phải tương thích với các bản còn hỗ trợ; bản quá cũ nhận `app_update_required` như mobile (skill `backend`, `api-conventions.md` mục 8; từ file này: `../../backend/references/api-conventions.md`).

## 5. Crash report

- Electron: `@sentry/electron` (bắt lỗi cả main và renderer), hoặc `crashReporter` gửi minidump về server riêng. Tauri: SDK Sentry cho Rust và cho phần web.
- Gắn phiên bản và hệ điều hành cho mỗi báo cáo; upload source map của renderer và symbol của bản build.
- Không gửi dữ liệu cá nhân, đường dẫn file của người dùng (thường chứa tên người dùng) trong log.

## 6. CI phát hành

```yaml
# Khung job đóng gói theo ma trận (kết hợp với ci-cd.md của skill ship)
jobs:
  package:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    environment: release          # secret ký số chỉ có ở environment có người duyệt
    steps:
      - uses: actions/checkout@v4
      # cài Node (và Rust cho Tauri), cài dependency, chạy test
      # đóng gói + ký + notarize bằng công cụ của Electron Forge/electron-builder/Tauri
      # tải bộ cài và file cập nhật lên nơi phát hành (GitHub Releases, S3...)
```

Chi tiết lệnh đóng gói và biến môi trường ký số theo tài liệu hiện hành của công cụ đang dùng; chúng đổi theo bản major.

## 7. Checklist phát hành

- [ ] Test (gồm test bảo mật) pass trên cả ba hệ điều hành phát hành
- [ ] Bản đóng gói đã ký; macOS đã notarize; mở được trên máy sạch không cảnh báo
- [ ] Cập nhật từ bản trước lên bản này chạy được; dữ liệu và phiên đăng nhập còn nguyên; migration DB cục bộ chạy đúng
- [ ] API tương thích với các bản còn hỗ trợ
- [ ] Phát hành lên kênh beta trước; ngưỡng crash để dừng đã ghi rõ
- [ ] Source map, symbol đã upload lên crash reporting
