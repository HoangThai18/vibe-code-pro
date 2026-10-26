# Bảo mật app desktop: Electron và Tauri

Lỗi bảo mật của app desktop đắt hơn web: code chạy với quyền của người dùng trên máy họ. Một lỗi XSS trong renderer Electron cấu hình sai là đủ để chạy lệnh tuỳ ý trên máy khách.

Đoạn Electron dưới đây đã chạy với Electron 45; test Playwright ở `testing.md` mục 3 chạy trên chính đoạn code này và bắt được các bản cố ý cấu hình sai.

## Mục lục
1. Electron: mô hình tin cậy
2. Electron: main process
3. Electron: preload
4. Electron: renderer và CSP
5. Electron: fuses lúc đóng gói
6. Tauri: capabilities, CSP, command
7. Checklist review

## 1. Electron: mô hình tin cậy

- **Main process** (Node.js đầy đủ quyền): tạo cửa sổ, đọc file, gọi hệ điều hành.
- **Preload** (sandbox): cầu nối duy nhất, expose vài hàm cụ thể cho renderer qua `contextBridge`.
- **Renderer** (trang web): coi như không tin được, giống một trang web bất kỳ. Không có Node, không có `require`, chỉ thấy `window.api`.

Ba thiết lập mặc định phải giữ nguyên: `contextIsolation: true` (mặc định từ Electron 12), `sandbox: true` (mặc định từ 20), `nodeIntegration: false` (mặc định từ 5). Ghi rõ trong code để không ai tắt nhầm.

## 2. Electron: main process

```js
// main.js
const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_ORIGIN = 'app://bundle';
const RENDERER_DIR = path.join(__dirname, 'renderer');
const EXTERNAL_HOSTS = new Set(['example.vn', 'help.example.vn']);   // chỉ những trang này được mở ra trình duyệt

// Phục vụ giao diện qua scheme riêng thay vì file:// (trang file:// đọc được mọi file trên máy)
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function serveRenderer() {
  protocol.handle('app', (request) => {
    const { host, pathname } = new URL(request.url);
    const file = path.resolve(RENDERER_DIR, '.' + decodeURIComponent(pathname));
    // Chỉ trả file nằm trong thư mục giao diện (chặn app://bundle/..%2fmain.js)
    if (host !== 'bundle' || !file.startsWith(RENDERER_DIR + path.sep)) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

function openExternalSafe(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && EXTERNAL_HOSTS.has(u.hostname)) void shell.openExternal(u.toString());
  } catch {
    // URL không hợp lệ: bỏ qua
  }
}

function assertTrustedSender(event) {
  // So origin của frame gửi, không so URL (about:blank, blob: không cho biết ai điều khiển frame)
  if (event.senderFrame?.origin !== APP_ORIGIN) throw new Error('IPC từ nguồn không tin cậy');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // Không cho trang tự điều hướng sang nơi khác
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== APP_ORIGIN) event.preventDefault();
  });
  // Không mở cửa sổ mới; link ngoài hợp lệ thì mở bằng trình duyệt mặc định
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  void win.loadURL(`${APP_ORIGIN}/index.html`);
  return win;
}

// Mỗi IPC làm đúng một việc hẹp. Renderer không gửi đường dẫn file: main tự mở hộp thoại chọn file.
ipcMain.handle('customers:import-csv', async (event) => {
  assertTrustedSender(event);
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (canceled || filePaths.length === 0) return null;
  const { size } = await fs.stat(filePaths[0]);
  if (size > 5 * 1024 * 1024) throw new Error('File lớn hơn 5 MB');
  return fs.readFile(filePaths[0], 'utf8');
});

ipcMain.handle('app:open-help', (event, topic) => {
  assertTrustedSender(event);
  if (typeof topic !== 'string' || !/^[a-z0-9-]{1,40}$/.test(topic)) throw new Error('topic không hợp lệ');
  openExternalSafe(`https://help.example.vn/${topic}`);
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());   // không dùng <webview>
});

app.whenReady().then(() => {
  serveRenderer();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

## 3. Electron: preload

```js
// preload.js (chạy trong sandbox: chỉ require được 'electron' và vài module cơ bản)
const { contextBridge, ipcRenderer } = require('electron');

// Expose hàm cụ thể, không expose ipcRenderer, không nhận tên kênh từ renderer
contextBridge.exposeInMainWorld('api', {
  importCustomersCsv: () => ipcRenderer.invoke('customers:import-csv'),
  openHelp: (topic) => ipcRenderer.invoke('app:open-help', topic),
});
```

Sai lầm hay gặp: `exposeInMainWorld('ipc', ipcRenderer)` hoặc `send: (channel, ...args) => ipcRenderer.invoke(channel, ...args)`. Như vậy renderer gọi được mọi kênh, kể cả kênh thêm sau này.

## 4. Electron: renderer và CSP

```html
<!-- renderer/index.html -->
<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://api.example.vn"
    />
    <title>Spa CRM</title>
  </head>
  <body>
    <main>
      <h1>Khách hàng</h1>
      <button id="import" type="button">Nhập CSV</button>
      <p id="result" role="status"></p>
    </main>
    <script src="app.js"></script>
  </body>
</html>
```

```js
// renderer/app.js: chỉ dùng window.api, không có Node
document.getElementById('import').addEventListener('click', async () => {
  const text = await window.api.importCustomersCsv();
  if (text === null) return;
  const rows = text.trim().split(/\r?\n/).slice(1).filter(Boolean);   // bỏ dòng tiêu đề
  document.getElementById('result').textContent = `Đã đọc ${rows.length} khách`;
});
```

- Không có `'unsafe-inline'`, `'unsafe-eval'` trong `script-src`. Bundler (Vite...) xuất file JS riêng nên không cần inline.
- Hiển thị dữ liệu người dùng bằng `textContent` hoặc qua framework (React tự escape), không `innerHTML` với dữ liệu chưa làm sạch.

## 5. Electron: fuses lúc đóng gói

Fuses tắt các tính năng của Electron mà app không cần, ghi thẳng vào file chạy lúc đóng gói (`@electron/fuses`; Electron Forge có `FusesPlugin`, electron-builder có cấu hình tương ứng). Nên tắt hoặc bật:

| Fuse | Đặt | Vì sao |
|---|---|---|
| `RunAsNode` | tắt | Chặn chạy file app như `node` qua biến `ELECTRON_RUN_AS_NODE` |
| `EnableNodeOptionsEnvironmentVariable` | tắt | Chặn chèn tuỳ chọn Node qua `NODE_OPTIONS` |
| `EnableNodeCliInspectArguments` | tắt | Chặn gắn debugger bằng `--inspect`. Playwright cần cờ này để điều khiển app: chạy E2E trên bản còn bật, chỉ tắt ở bản phát hành (`testing.md` mục 5) |
| `EnableEmbeddedAsarIntegrityValidation` + `OnlyLoadAppFromAsar` | bật | Chỉ chạy code trong `app.asar` đã kiểm toàn vẹn (macOS, Windows) |
| `EnableCookieEncryption` | bật | Mã hoá cookie trên đĩa |

Kiểm cấu hình fuse trên bản đã đóng gói: `npx @electron/fuses read --app <đường dẫn app>`.

## 6. Tauri: capabilities, CSP, command

Tauri v2 mặc định chỉ cho phép code đóng gói cùng app gọi API, và mỗi plugin chỉ dùng được khi có permission trong file capability:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-window",
  "description": "Quyền của cửa sổ chính",
  "windows": ["main"],
  "permissions": ["core:default", "dialog:allow-open"]
}
```

(`src-tauri/capabilities/main-window.json`). Chỉ cấp đúng permission cần; không thêm `remote.urls` trừ khi thật sự phải cho trang từ xa gọi API, và khi đó đọc kỹ cảnh báo của Tauri về iframe trên Linux, Android.

CSP trong `src-tauri/tauri.conf.json` (`app.security.csp`), cùng nguyên tắc như Electron; Tauri tự thêm nonce/hash cho script của app lúc build.

Command viết bằng Rust là ranh giới tin cậy, như IPC của Electron:

```rust
// src-tauri/src/lib.rs
use tauri_plugin_dialog::DialogExt;

const MAX_CSV_BYTES: u64 = 5 * 1024 * 1024;

// Renderer không gửi đường dẫn: command tự mở hộp thoại chọn file
#[tauri::command]
async fn import_customers_csv(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().add_filter("CSV", &["csv"]).blocking_pick_file() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > MAX_CSV_BYTES {
        return Err("File lớn hơn 5 MB".into());
    }
    std::fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![import_customers_csv])
        .run(tauri::generate_context!())
        .expect("không khởi động được app");
}
```

- Command tự đăng ký mặc định gọi được từ mọi cửa sổ của app; app nhiều cửa sổ thì giới hạn bằng manifest command (xem tài liệu Tauri về `AppManifest::commands`).
- Không viết command nhận đường dẫn hay lệnh shell từ renderer. Cần plugin `fs`/`shell` thì cấp permission có scope hẹp nhất.

## 7. Checklist review

- [ ] `contextIsolation`, `sandbox` bật; `nodeIntegration`, `webSecurity: false`, `allowRunningInsecureContent`, `experimentalFeatures` không xuất hiện
- [ ] Preload chỉ expose hàm cụ thể; không expose `ipcRenderer`, `require`, tên kênh tự do
- [ ] Mọi `ipcMain.handle`/`on` kiểm `senderFrame.origin` và validate tham số; không có IPC đọc/ghi file theo đường dẫn từ renderer hay chạy lệnh
- [ ] `will-navigate` và `setWindowOpenHandler` chặn điều hướng, cửa sổ mới; `shell.openExternal` chỉ với URL trong danh sách cho phép
- [ ] Giao diện nạp qua scheme riêng có chặn path traversal, không `file://`, không nạp trang từ xa vào cửa sổ có preload
- [ ] CSP không có `unsafe-inline`/`unsafe-eval` trong `script-src`
- [ ] Fuses đã đặt; Electron ở bản còn được hỗ trợ
- [ ] Tauri: capability chỉ có permission cần; không `remote.urls` thừa; command validate đầu vào
