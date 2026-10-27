import os, shutil, sys
base = 'electron-app'
V = {
 'a_node_noiso': ('main.js', [("      contextIsolation: true,\n      sandbox: true,\n      nodeIntegration: false,", "      contextIsolation: false,\n      sandbox: true,\n      nodeIntegration: true,")]),
 'a2_node_noiso_nosandbox': ('main.js', [("      contextIsolation: true,\n      sandbox: true,\n      nodeIntegration: false,", "      contextIsolation: false,\n      sandbox: false,\n      nodeIntegration: true,")]),
 'b_no_traversal_check': ('main.js', [("if (host !== 'bundle' || !file.startsWith(RENDERER_DIR + path.sep)) {", "if (host !== 'bundle') {")]),
 'c_no_will_navigate': ('main.js', [("""  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== APP_ORIGIN) event.preventDefault();
  });
""", "")]),
 'd_window_open_allow': ('main.js', [("    return { action: 'deny' };", "    return { action: 'allow' };")]),
 'e1_extra_ipc_global': ('preload.js', [("});\n", "});\ncontextBridge.exposeInMainWorld('ipc', ipcRenderer);\n")]),
 'e2_api_is_ipcRenderer': ('preload.js', [("""contextBridge.exposeInMainWorld('api', {
  importCustomersCsv: () => ipcRenderer.invoke('customers:import-csv'),
  openHelp: (topic) => ipcRenderer.invoke('app:open-help', topic),
});""", "contextBridge.exposeInMainWorld('api', ipcRenderer);")]),
 'e3_generic_invoke': ('preload.js', [("  openHelp: (topic) => ipcRenderer.invoke('app:open-help', topic),\n", "  openHelp: (topic) => ipcRenderer.invoke('app:open-help', topic),\n  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),\n")]),
}
os.makedirs('variants', exist_ok=True)
for name, (fn, reps) in V.items():
    d = os.path.join('variants', name)
    if os.path.exists(d): shutil.rmtree(d)
    os.makedirs(d)
    for f in ['main.js', 'preload.js', 'package.json', 'playwright.config.ts', 'fixed.config.ts']:
        shutil.copy(os.path.join(base, f), d)
    shutil.copytree(os.path.join(base, 'renderer'), os.path.join(d, 'renderer'))
    shutil.copytree(os.path.join(base, 'tests'), os.path.join(d, 'tests'), ignore=shutil.ignore_patterns('probe'))
    os.symlink(os.path.abspath(os.path.join(base, 'node_modules')), os.path.join(d, 'node_modules'))
    p = os.path.join(d, fn); s = open(p, encoding='utf-8').read()
    for o, n in reps:
        assert s.count(o) == 1, (name, o)
        s = s.replace(o, n)
    open(p, 'w', encoding='utf-8').write(s)
    print(name, 'ok')
