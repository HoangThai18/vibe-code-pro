// renderer/app.js: chỉ dùng window.api, không có Node
document.getElementById('import').addEventListener('click', async () => {
  const text = await window.api.importCustomersCsv();
  if (text === null) return;
  const rows = text.trim().split(/\r?\n/).slice(1).filter(Boolean);   // bỏ dòng tiêu đề
  document.getElementById('result').textContent = `Đã đọc ${rows.length} khách`;
});
