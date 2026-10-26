# Dữ liệu, file và bí mật trên máy

## Mục lục
1. Đặt dữ liệu ở đâu
2. Token và bí mật
3. DB cục bộ
4. Offline và đồng bộ
5. Nhiều tenant, nhiều tài khoản trên cùng máy

## 1. Đặt dữ liệu ở đâu

| Loại | Electron | Tauri | Ghi chú |
|---|---|---|---|
| Dữ liệu của app (DB, cache, cấu hình) | `app.getPath('userData')` | `appDataDir()` (`@tauri-apps/api/path`) hoặc `app.path().app_data_dir()` (Rust) | Theo từng người dùng hệ điều hành |
| Log | `app.getPath('logs')` | `appLogDir()` | Không ghi dữ liệu cá nhân vào log |
| File tạm | `app.getPath('temp')` | `tempDir()` | Xoá sau khi dùng |
| File người dùng chọn | Hộp thoại mở/lưu file của hệ điều hành | Plugin `dialog` | Chỉ đọc/ghi file người dùng vừa chọn |

- Không ghi vào thư mục cài đặt (Program Files, `/Applications`): thường chỉ đọc, và bị xoá khi cập nhật.
- Không ghép đường dẫn từ dữ liệu người dùng (`path.join(base, userInput)`) mà không kiểm kết quả còn nằm trong `base`.

## 2. Token và bí mật

Electron có `safeStorage` dùng kho khoá của hệ điều hành (Keychain trên macOS, DPAPI trên Windows, libsecret/kwallet trên Linux). Từ Electron 44 dùng bản async; các hàm sync (`isEncryptionAvailable`, `encryptString`...) bị đánh dấu deprecated ở Electron 45. Đoạn dưới đã chạy với Electron 45, kể cả trên máy Linux không có keyring (lưu thì báo lỗi, đọc trả `null`, không ghi file):

```js
// main process
const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const sessionFile = () => path.join(app.getPath('userData'), 'session.bin');

async function assertSecureStorage() {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('Hệ điều hành chưa sẵn sàng kho khoá');
  // Linux không có keyring: Electron vẫn "mã hoá" bằng khoá cố định, coi như không mã hoá
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error('Không có keyring (libsecret/kwallet): không lưu token xuống đĩa');
  }
}

async function saveRefreshToken(token) {
  await assertSecureStorage();
  await fs.writeFile(sessionFile(), await safeStorage.encryptStringAsync(token), { mode: 0o600 });
}

async function loadRefreshToken() {
  try {
    await assertSecureStorage();
    const { result } = await safeStorage.decryptStringAsync(await fs.readFile(sessionFile()));
    return result;
  } catch {
    return null;   // không có file, không giải mã được, hoặc máy không có kho khoá: đăng nhập lại
  }
}
```

- Chỉ main process đọc/ghi token; renderer nhận access token ngắn hạn qua IPC nếu cần gọi API, hoặc main process gọi API thay.
- Tauri: dùng plugin lưu bí mật vào keychain của hệ điều hành (tìm plugin chính thức hoặc cộng đồng còn được bảo trì, đọc kỹ cách nó lưu); không lưu token bằng `localStorage` hay plugin `store` dạng file thường.
- Không nhúng secret của server (API key quản trị, khoá ký) vào app: ai cũng giải nén được.

## 3. DB cục bộ

- SQLite là lựa chọn mặc định: Electron dùng `better-sqlite3` trong main process (module native: phải build lại theo đúng bản Electron, Electron Forge/electron-builder lo việc này); Tauri dùng plugin `sql` hoặc `rusqlite` trong command.
- Migration của DB cục bộ có version (`PRAGMA user_version`), chạy lúc mở app, test cả trường hợp nâng từ bản cũ nhiều version.
- Renderer không truy vấn SQL trực tiếp: gọi IPC/command có tên theo nghiệp vụ (`customers:list`), main/Rust làm truy vấn có tham số.

## 4. Offline và đồng bộ

Giống mobile: chọn mức offline thấp nhất đáp ứng nghiệp vụ, hàng đợi ghi có idempotency key, server là nguồn đúng khi xung đột (skill `mobile`, `app-data.md` mục 5–6; từ file này: `../../mobile/references/app-data.md`). App desktop chạy cả ngày nên còn phải:

- Làm mới dữ liệu khi máy thức dậy sau khi ngủ, khi có mạng lại (`online` event của renderer, `powerMonitor` của Electron).
- Giới hạn kích thước cache, dọn dữ liệu cũ.

## 5. Nhiều tenant, nhiều tài khoản trên cùng máy

- Một máy ở quầy có thể nhiều nhân viên dùng chung: đăng xuất phải xoá token, cache và dữ liệu cục bộ của tài khoản đó (như mobile, `app-data.md` mục 7).
- Dữ liệu cục bộ đặt theo tenant (thư mục hoặc cột `tenant_id`), đổi workspace không đọc nhầm dữ liệu workspace cũ; tenant đi trong request như web.
