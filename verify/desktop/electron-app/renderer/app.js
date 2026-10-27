// renderer/app.js: uses only window.api, no Node
document.getElementById('import').addEventListener('click', async () => {
  const text = await window.api.importCustomersCsv();
  if (text === null) return;
  const rows = text.trim().split(/\r?\n/).slice(1).filter(Boolean);   // skip the header row
  document.getElementById('result').textContent = `Đã đọc ${rows.length} khách`;
});
