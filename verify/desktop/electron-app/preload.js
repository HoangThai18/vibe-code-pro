// preload.js (sandboxed: can require only 'electron' and a few basic modules)
const { contextBridge, ipcRenderer } = require('electron');

// Expose specific functions; never expose ipcRenderer or take channel names from the renderer
contextBridge.exposeInMainWorld('api', {
  importCustomersCsv: () => ipcRenderer.invoke('customers:import-csv'),
  openHelp: (topic) => ipcRenderer.invoke('app:open-help', topic),
});
