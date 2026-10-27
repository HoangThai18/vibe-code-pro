// api-client.js (main process): the renderer never holds tokens; it calls IPC handlers that use this client
const { app, net } = require('electron');

// The x-app-platform values the server knows; for any other value it skips the minimum-version check
const PLATFORMS = { darwin: 'macos', win32: 'windows', linux: 'linux' };

function appPlatform(nodePlatform) {
  const platform = PLATFORMS[nodePlatform];
  if (!platform) throw new Error(`Unsupported platform: ${nodePlatform}`);
  return platform;
}

class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// getAccessToken() -> string | null; refreshSession() -> 'refreshed' | 'signed-out' | 'unavailable';
// onUpdateRequired(): block the UI and start the update. The second argument exists only for tests.
function createApiClient({ baseUrl, getAccessToken, refreshSession, onUpdateRequired },
  { fetch = net.fetch, version = app.getVersion(), platform = appPlatform(process.platform) } = {}) {
  return async function api(path, init = {}, retried = false) {
    const token = getAccessToken();
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-app-version': version,
        'x-app-platform': platform,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
    if (res.status === 401 && !retried && (await refreshSession()) === 'refreshed') return api(path, init, true);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (res.status === 426) onUpdateRequired();   // app_update_required
      throw new ApiError(res.status, body?.error?.code ?? 'unknown_error');
    }
    return res.status === 204 ? undefined : res.json();
  };
}

module.exports = { ApiError, appPlatform, createApiClient };
