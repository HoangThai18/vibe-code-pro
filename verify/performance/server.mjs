// API mẫu để thử tải: danh sách khách mới nhất của một tenant
import http from 'node:http';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
http.createServer(async (req, res) => {
  const m = /^\/v1\/t\/([0-9a-f-]{36})\/customers/.exec(req.url ?? '');
  if (!m) { res.writeHead(404).end(); return; }
  try {
    const { rows } = await pool.query(
      'SELECT id, name, phone, created_at FROM customers WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 20', [m[1]]);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: rows }));
  } catch (e) { res.writeHead(500).end(String(e)); }
}).listen(3100, () => console.log('listening 3100'));
