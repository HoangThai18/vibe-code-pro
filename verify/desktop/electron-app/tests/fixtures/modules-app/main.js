// Not in the docs: an Electron app that only loads the app-data.md modules, for main-modules.spec.ts
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.setPath('userData', path.join(app.getPath('temp'), `spa-crm-test-${process.pid}`));
globalThis.modules = { apiClient: require('../../../api-client.js'), sessionStore: require('../../../session-store.js') };
globalThis.sessionFileExists = () => fs.existsSync(path.join(app.getPath('userData'), 'session.bin'));
app.whenReady().then(() => { globalThis.ready = true; });
