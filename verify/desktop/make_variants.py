"""Build deliberately broken copies of electron-app and check that the security tests catch each one.

python3 verify/desktop/make_variants.py <out dir>     # then, per variant: cd <out>/<name> && xvfb-run -a npx playwright test --reporter=json > r.json
python3 verify/desktop/summarize.py <out>/<name>/r.json
"""
import os, pathlib, shutil, sys

base = pathlib.Path(__file__).resolve().parent / 'electron-app'
out = pathlib.Path(sys.argv[1]).resolve()
PREFS = "      contextIsolation: true,\n      sandbox: true,\n      nodeIntegration: false,"
V = {
 'a_node_noiso': ('main.js', [(PREFS, "      contextIsolation: false,\n      sandbox: true,\n      nodeIntegration: true,")]),
 'a2_node_noiso_nosandbox': ('main.js', [(PREFS, "      contextIsolation: false,\n      sandbox: false,\n      nodeIntegration: true,")]),
 'b_no_traversal_check': ('main.js', [("if (host !== 'bundle' || !file.startsWith(RENDERER_DIR + path.sep)) {", "if (host !== 'bundle') {")]),
 'c_no_will_navigate': ('main.js', [("""  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
""", "")]),
 'c2_will_navigate_compares_origin': ('main.js', [("    if (!isAppUrl(url)) event.preventDefault();", "    if (new URL(url).origin !== APP_ORIGIN) event.preventDefault();")]),
 'd_window_open_allow': ('main.js', [("    return { action: 'deny' };", "    return { action: 'allow' };")]),
 'e1_extra_ipc_global': ('preload.js', [("});\n", "});\ncontextBridge.exposeInMainWorld('ipc', ipcRenderer);\n")]),
 'e2_api_is_ipcRenderer': ('preload.js', [("""contextBridge.exposeInMainWorld('api', {
  importCustomersCsv: () => ipcRenderer.invoke('customers:import-csv'),
  openHelp: (topic) => ipcRenderer.invoke('app:open-help', topic),
});""", "contextBridge.exposeInMainWorld('api', ipcRenderer);")]),
 'e3_generic_invoke': ('preload.js', [("  openHelp: (topic) => ipcRenderer.invoke('app:open-help', topic),\n", "  openHelp: (topic) => ipcRenderer.invoke('app:open-help', topic),\n  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),\n")]),
 'f1_no_permission_request_handler': ('main.js', [("""  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isAppUrl(details.requestingUrl));
  });
""", "")]),
 'f2_no_permission_check_handler': ('main.js', [("""  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    ALLOWED_PERMISSIONS.has(permission) && isAppUrl(requestingOrigin));
""", "")]),
 'f3_permissions_allow_all': ('main.js', [("const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);", "const ALLOWED_PERMISSIONS = { has: () => true };")]),
}
out.mkdir(parents=True, exist_ok=True)
for name, (fn, reps) in V.items():
    d = out / name
    if d.exists(): shutil.rmtree(d)
    shutil.copytree(base, d, ignore=shutil.ignore_patterns('node_modules', 'test-results'))
    os.symlink(base / 'node_modules', d / 'node_modules')
    p = d / fn; s = p.read_text(encoding='utf-8')
    for o, n in reps:
        assert s.count(o) == 1, (name, o)
        s = s.replace(o, n)
    p.write_text(s, encoding='utf-8')
    print(name, 'ok')
