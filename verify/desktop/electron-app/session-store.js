// session-store.js (main process)
const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const sessionFile = () => path.join(app.getPath('userData'), 'session.bin');

async function assertSecureStorage() {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('Hệ điều hành chưa sẵn sàng kho khoá');
  // Linux without a keyring: Electron still "encrypts" with a fixed key, which is no encryption
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
    return null;   // no file, cannot decrypt, or no keystore on this machine: log in again
  }
}

module.exports = { saveRefreshToken, loadRefreshToken };
