---
name: desktop
description: "Làm app desktop Windows, macOS, Linux: chọn cách làm (Tauri, Electron, PWA, native), bảo mật Electron (context isolation, sandbox, preload, kiểm IPC, CSP) và Tauri (capabilities), lưu file và bí mật trên máy, offline, test (Playwright cho Electron), đóng gói, ký số, notarize, tự cập nhật. Dùng khi user làm app máy tính hoặc nhắc 'desktop app', 'Electron', 'Tauri', 'app Windows', 'app macOS', 'installer', 'auto update', 'code signing', 'notarize', 'preload'."
---

# Desktop: app Windows, macOS, Linux

Thư mục skill: `${CLAUDE_SKILL_DIR}`. Chỉ đọc phần cần cho việc đang làm:

| Việc | Đọc |
|---|---|
| Chọn cách làm (PWA, Tauri, Electron, native) cho app mới | `references/choose-stack.md` |
| Cấu hình cửa sổ, preload, IPC, CSP, mở link, quyền của Tauri | `references/security.md` |
| Lưu dữ liệu, file, token trên máy; offline; nhiều tenant | `references/app-data.md` |
| Test: unit, E2E Electron bằng Playwright, Tauri | `references/testing.md` |
| Đóng gói, ký số, notarize, tự cập nhật, crash report | `references/release.md` |

Phần dùng chung với web giữ ở skill khác: dựng UI từ design và state (`${CLAUDE_SKILL_DIR}/../frontend/SKILL.md`), API contract và client sống lâu (`${CLAUDE_SKILL_DIR}/../backend/references/api-conventions.md` mục 8), offline và hàng đợi ghi (`${CLAUDE_SKILL_DIR}/../mobile/references/app-data.md` mục 5–6, cùng cách làm).

Electron và Tauri đổi API theo bản major. Kiểm version đang cài và tài liệu đúng version trước khi dùng API chưa chắc (`${CLAUDE_SKILL_DIR}/../plan/references/tech-research.md`).

**Cân đúng mức.** Sửa giao diện, chữ, style trong renderer thì làm như web. Đọc kỹ `references/security.md` khi chạm main process, preload, IPC, cấu hình cửa sổ, capabilities của Tauri, hoặc khi app tải nội dung từ ngoài.

## Quy tắc luôn áp dụng

1. **Renderer là trang web không tin được.** Không bật `nodeIntegration`, không tắt `contextIsolation`, `sandbox`, `webSecurity`. Renderer chỉ gọi được vài hàm cụ thể qua preload (Electron) hoặc command có permission (Tauri), không bao giờ có `fs`, `child_process`, hay `ipcRenderer` trần.
2. **Mọi IPC là đầu vào không tin được**: kiểm nguồn gửi, validate tham số, chỉ làm đúng một việc hẹp. Không có IPC kiểu "đọc file theo đường dẫn bất kỳ" hay "chạy lệnh".
3. **Chỉ chạy code đóng gói cùng app.** Không nạp trang web từ xa vào cửa sổ có quyền; chặn điều hướng và cửa sổ mới; `shell.openExternal` chỉ với URL đã kiểm theo danh sách cho phép.
4. **Dữ liệu ở thư mục dữ liệu của app** (vd `app.getPath('userData')`), không cạnh file chạy. Token trong kho khoá của hệ điều hành (`safeStorage`, keychain), không ghi text thường.
5. **App đã cài không rollback được**, như mobile: API tương thích với các bản còn hỗ trợ, có phiên bản tối thiểu; bản lỗi thì phát hành bản mới hơn qua auto-update.
6. **Ký số mọi bản phát hành.** macOS cần ký và notarize, Windows cần ký Authenticode; bản không ký bị hệ điều hành cảnh báo hoặc chặn, và auto-update không an toàn.
7. **Thử trên từng hệ điều hành phát hành**: Tauri dùng webview của hệ điều hành (WebView2, WKWebView, WebKitGTK) nên hiển thị và API web có thể khác nhau.

## Trước khi coi là xong

- E2E luồng chính pass (Electron: Playwright; Tauri: WebDriver hoặc test thủ công theo checklist), cả test bảo mật ở `references/testing.md`.
- Chạy bản đóng gói (không chỉ bản dev) trên từng hệ điều hành phát hành; cài, mở, cập nhật từ bản trước lên bản này.
- Chụp màn hình so với design như web (skill `frontend`).
