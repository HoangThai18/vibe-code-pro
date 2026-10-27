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
    // Chỉ trả file nằm trong thư mục giao diện (chặn app://bundle/%2e%2e/main.js)
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
