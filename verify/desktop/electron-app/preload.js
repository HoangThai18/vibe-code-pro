// preload.js (chạy trong sandbox: chỉ require được 'electron' và vài module cơ bản)
const { contextBridge, ipcRenderer } = require('electron');

// Expose hàm cụ thể, không expose ipcRenderer, không nhận tên kênh từ renderer
contextBridge.exposeInMainWorld('api', {
  importCustomersCsv: () => ipcRenderer.invoke('customers:import-csv'),
  openHelp: (topic) => ipcRenderer.invoke('app:open-help', topic),
});
