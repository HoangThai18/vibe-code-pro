// main.js
const { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_ORIGIN = 'app://bundle';
const RENDERER_DIR = path.join(__dirname, 'renderer');
const EXTERNAL_HOSTS = new Set(['example.vn', 'help.example.vn']);   // only these sites may open in the browser
// Web permissions the UI may get, for its own pages only. Electron grants every request by default (camera, microphone, screen...)
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);

// Serve the UI over a custom scheme instead of file:// (a file:// page can read every file on the machine)
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function serveRenderer() {
  protocol.handle('app', (request) => {
    const { host, pathname } = new URL(request.url);
    const file = path.resolve(RENDERER_DIR, '.' + decodeURIComponent(pathname));
    // Serve only files inside the UI folder (blocks app://bundle/..%2fmain.js)
    if (host !== 'bundle' || !file.startsWith(RENDERER_DIR + path.sep)) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

// Node's URL gives custom schemes the origin 'null': compare scheme and host instead
function isAppUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'app:' && u.host === 'bundle';
  } catch {
    return false;
  }
}

function lockDownPermissions(ses) {
  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isAppUrl(details.requestingUrl));
  });
  // Checks come before requests (navigator.permissions.query, Notification.permission...)
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    ALLOWED_PERMISSIONS.has(permission) && isAppUrl(requestingOrigin));
}

function openExternalSafe(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && EXTERNAL_HOSTS.has(u.hostname)) void shell.openExternal(u.toString());
  } catch {
    // invalid URL: ignore
  }
}

function assertTrustedSender(event) {
  // Compare the sending frame's origin, not its URL (about:blank, blob: do not tell who controls the frame)
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
  // The page may not navigate elsewhere
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  // No new windows; allowed external links open in the default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  void win.loadURL(`${APP_ORIGIN}/index.html`);
  return win;
}

// Each IPC does one narrow thing. The renderer sends no file path: main opens the file dialog itself.
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
  contents.on('will-attach-webview', (event) => event.preventDefault());   // no <webview>
});

app.whenReady().then(() => {
  lockDownPermissions(session.defaultSession);   // and every session you create (session.fromPartition)
  serveRenderer();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
