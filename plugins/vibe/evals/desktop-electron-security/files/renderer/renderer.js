const fs = require('fs');

document.getElementById('import').addEventListener('click', () => {
  const file = document.getElementById('path').value;
  const text = fs.readFileSync(file, 'utf8');
  const rows = text.trim().split('\n').slice(1);
  document.getElementById('result').innerHTML = `Đã đọc ${rows.length} khách`;
});
