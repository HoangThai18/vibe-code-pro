// Trang mẫu: /customers (bình thường), BROKEN=1 thì chèn banner muộn đẩy nội dung xuống (CLS cao)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const broken = process.env.BROKEN === '1';
http.createServer(async (req, res) => {
  if (req.url === '/customers') {
    const rows = Array.from({ length: 20 }, (_, i) => `<li>Khách ${i + 1} · 09${String(i).padStart(8, '0')}</li>`).join('');
    const late = broken ? `<script>setTimeout(()=>{const b=document.createElement('div');b.style.height='300px';b.textContent='Khuyến mãi';document.body.prepend(b)},400)</script>` : '';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Khách hàng</title></head>
<body><main><h1>Khách hàng</h1><p style="font-size:20px">Danh sách khách mới nhất của spa, cập nhật theo thời gian thực cho nhân viên quầy lễ tân và quản lý.</p><ul>${rows}</ul></main>
<script type="importmap">{"imports":{"web-vitals":"/web-vitals/index.js"}}</script><script type="module">import { reportWebVitals } from '/report.js'; reportWebVitals();</script>${late}</body></html>`);
    return;
  }
  if (req.url === '/report.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' }).end(await readFile('web/dist/report-web-vitals.js'));
    return;
  }
  if (req.url?.startsWith('/web-vitals/')) {
    res.writeHead(200, { 'content-type': 'text/javascript' }).end(await readFile('node_modules/web-vitals/dist/modules/' + req.url.slice('/web-vitals/'.length)));
    return;
  }
  res.writeHead(404).end();
}).listen(3200);
