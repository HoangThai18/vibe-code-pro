// App demo cho eval: CRM spa nhiều workspace. Không cần dependency.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 3100);
const HOUR = 3_600_000;

const users = [
  { id: 'u1', email: 'owner-a@example.test', password: 'pass', memberships: { 'spa-a': 'owner' } },
  { id: 'u2', email: 'staff-a@example.test', password: 'pass', memberships: { 'spa-a': 'staff' } },
  { id: 'u3', email: 'multi@example.test', password: 'pass', memberships: { 'spa-a': 'owner', 'spa-b': 'owner' } },
  { id: 'u4', email: 'owner-b@example.test', password: 'pass', memberships: { 'spa-b': 'owner' } },
];
const tenants = { 'spa-a': 'Spa Hoa Mai', 'spa-b': 'Spa Bạch Dương' };
const customers = [
  { id: randomUUID(), tenant: 'spa-a', name: 'Nguyễn Thị A1' },
  { id: randomUUID(), tenant: 'spa-b', name: 'Trần Văn B1' },
];
const appointments = [];
const sessions = new Map();

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}
function currentUser(req) {
  const sid = /(?:^|; )sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  return sid ? users.find((u) => u.id === sessions.get(sid)) : undefined;
}

const page = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spa CRM</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; color: #1a1a1a; background: #fff; }
  header { display: flex; gap: 16px; align-items: center; padding: 12px 16px; border-bottom: 1px solid #ddd; }
  main { padding: 16px; max-width: 880px; }
  table { border-collapse: collapse; width: 100%; } td, th { text-align: left; padding: 8px; border-bottom: 1px solid #eee; }
  button { padding: 8px 12px; } .error { color: #b00020; } label { display: block; margin: 8px 0 4px; }
  @media (prefers-reduced-motion: no-preference) { .fade { transition: opacity .2s; } }
</style></head>
<body><div id="app"></div>
<script>
const app = document.getElementById('app');
let renderToken = 0;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Chào buổi sáng' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
function go(path) { history.pushState({}, '', path); render(); }
window.addEventListener('popstate', render);

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function shell(tenant, me, inner) {
  const options = Object.keys(me.memberships).map((t) =>
    '<option value="' + t + '"' + (t === tenant ? ' selected' : '') + '>' + esc(me.tenantNames[t]) + '</option>').join('');
  return '<header><span data-testid="greeting">' + greeting() + '</span>' +
    '<label for="ws" style="margin:0">Workspace</label><select id="ws">' + options + '</select>' +
    '<nav aria-label="Chính"><a href="/t/' + tenant + '/customers">Khách hàng</a> · <a href="/t/' + tenant + '/appointments">Lịch hẹn</a></nav></header>' +
    '<main>' + inner + '</main>';
}

async function render() {
  const token = ++renderToken;
  const path = location.pathname;
  if (path === '/login' || path === '/') return renderLogin();
  const m = /^\\/t\\/([a-z0-9-]+)\\/(customers|appointments)(?:\\/([\\w-]+))?$/.exec(path);
  if (!m) { app.innerHTML = '<main><h1>Không tìm thấy</h1></main>'; return; }
  const [, tenant, section, id] = m;
  const meRes = await api('/api/me');
  if (meRes.status !== 200) return go('/login');
  const me = meRes.body;
  if (section === 'customers' && id) {
    const r = await api('/t/' + tenant + '/api/customers/' + id);
    if (token !== renderToken) return;
    app.innerHTML = shell(tenant, me, r.status === 200
      ? '<h1>' + esc(r.body.name) + '</h1>'
      : '<h1>Không tìm thấy</h1><p>Khách hàng không tồn tại hoặc bạn không có quyền xem.</p>');
  } else if (section === 'customers') {
    app.innerHTML = shell(tenant, me, '<h1>Khách hàng</h1><p role="status">Đang tải…</p>');
    bindShell(tenant);
    const r = await api('/t/' + tenant + '/api/customers');
    if (token !== renderToken) return;
    const main = document.querySelector('main');
    if (r.status !== 200) {
      main.innerHTML = '<h1>Khách hàng</h1><p class="error" role="alert">Không tải được danh sách.</p><button id="retry">Thử lại</button>';
      document.getElementById('retry').onclick = render;
      return;
    }
    const rows = r.body.data.map((c) => '<tr><td><a href="/t/' + tenant + '/customers/' + c.id + '">' + esc(c.name) + '</a></td></tr>').join('');
    main.innerHTML = '<h1>Khách hàng</h1><button id="add">Thêm khách</button>' +
      '<form id="f" hidden novalidate><label for="name">Họ tên</label><input id="name" name="name" aria-describedby="name-err">' +
      '<p id="name-err" class="error"></p><button type="submit">Lưu</button></form>' +
      (rows ? '<table><thead><tr><th>Họ tên</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p>Chưa có khách nào.</p>');
    document.getElementById('add').onclick = () => { document.getElementById('f').hidden = false; document.getElementById('name').focus(); };
    document.getElementById('f').onsubmit = async (e) => {
      e.preventDefault();
      const res = await api('/t/' + tenant + '/api/customers', { method: 'POST', body: JSON.stringify({ name: document.getElementById('name').value }) });
      if (res.status === 422) { document.getElementById('name-err').textContent = 'Vui lòng nhập họ tên'; return; }
      render();
    };
  } else {
    const r = await api('/t/' + tenant + '/api/appointments');
    if (token !== renderToken) return;
    const rows = r.body.data.map((a) => '<tr><td>' + esc(a.customerName) + '</td><td>' + a.status + '</td><td>' +
      (a.status === 'pending' && me.memberships[tenant] === 'owner' ? '<button data-confirm="' + a.id + '" aria-label="Xác nhận lịch của ' + esc(a.customerName) + '">Xác nhận</button>' : '') +
      (a.status !== 'cancelled' ? '<button data-cancel="' + a.id + '" aria-label="Huỷ lịch của ' + esc(a.customerName) + '">Huỷ</button>' : '') +
      (a.refund !== undefined ? (a.refund > 0 ? ' Hoàn cọc ' + a.refund : ' Không hoàn cọc') : '') + '</td></tr>').join('');
    app.innerHTML = shell(tenant, me, '<h1>Lịch hẹn</h1><table><tbody>' + rows + '</tbody></table>');
    document.querySelectorAll('[data-confirm]').forEach((b) => (b.onclick = async () => { await api('/t/' + tenant + '/api/appointments/' + b.dataset.confirm + '/confirm', { method: 'POST' }); render(); }));
    document.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = async () => { await api('/t/' + tenant + '/api/appointments/' + b.dataset.cancel + '/cancel', { method: 'POST' }); render(); }));
  }
  bindShell(tenant);
}
function bindShell(tenant) {
  const ws = document.getElementById('ws');
  if (ws) ws.onchange = () => go('/t/' + ws.value + '/customers');
}
function renderLogin() {
  app.innerHTML = '<main><h1>Đăng nhập</h1><form id="login" novalidate><label for="email">Email</label><input id="email" type="email" autocomplete="username">' +
    '<label for="pw">Mật khẩu</label><input id="pw" type="password" autocomplete="current-password"><p id="login-err" class="error" role="alert"></p><button type="submit">Đăng nhập</button></form></main>';
  document.getElementById('login').onsubmit = async (e) => {
    e.preventDefault();
    const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('pw').value }) });
    if (r.status !== 200) { document.getElementById('login-err').textContent = 'Sai email hoặc mật khẩu'; return; }
    go('/t/' + r.body.tenants[0] + '/customers');
  };
}
render();
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  if (req.method === 'GET' && !p.startsWith('/api/') && !p.includes('/api/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page);
  }
  if (p === '/api/health') return json(res, 200, { ok: true });
  if (p === '/api/login' && req.method === 'POST') {
    const { email, password } = await readBody(req);
    const u = users.find((x) => x.email === email && x.password === password);
    if (!u) return json(res, 401, { code: 'invalid_credentials' });
    const sid = randomUUID();
    sessions.set(sid, u.id);
    res.setHeader('set-cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
    return json(res, 200, { tenants: Object.keys(u.memberships) });
  }
  const me = currentUser(req);
  if (!me) return json(res, 401, { code: 'unauthenticated' });
  if (p === '/api/me') {
    return json(res, 200, { email: me.email, memberships: me.memberships, tenantNames: tenants });
  }
  const m = /^\/t\/([a-z0-9-]+)\/api\/(customers|appointments)(?:\/([\w-]+))?(?:\/(confirm|cancel))?$/.exec(p);
  if (!m) return json(res, 404, { code: 'not_found' });
  const [, tenant, kind, id, action] = m;
  const role = me.memberships[tenant];
  if (!role) return json(res, 404, { code: 'not_found' });   // not a member: same as missing
  if (kind === 'customers') {
    if (req.method === 'GET' && !id) return json(res, 200, { data: customers.filter((c) => c.tenant === tenant) });
    if (req.method === 'GET') {
      const c = customers.find((x) => x.id === id && x.tenant === tenant);
      return c ? json(res, 200, c) : json(res, 404, { code: 'not_found' });
    }
    if (req.method === 'POST') {
      const { name } = await readBody(req);
      if (!name || !String(name).trim()) return json(res, 422, { code: 'validation_failed', fields: { name: 'required' } });
      const c = { id: randomUUID(), tenant, name: String(name).trim() };
      customers.push(c);
      return json(res, 201, c);
    }
  }
  if (kind === 'appointments') {
    if (req.method === 'GET') return json(res, 200, { data: appointments.filter((a) => a.tenant === tenant) });
    if (req.method === 'POST' && !id) {
      const { customerName, startsAt } = await readBody(req);
      const a = { id: randomUUID(), tenant, customerName, startsAt, status: 'pending', deposit: 200000 };
      appointments.push(a);
      return json(res, 201, a);
    }
    const a = appointments.find((x) => x.id === id && x.tenant === tenant);
    if (!a) return json(res, 404, { code: 'not_found' });
    if (action === 'confirm') {
      if (role !== 'owner') return json(res, 403, { code: 'forbidden' });
      if (a.status !== 'pending') return json(res, 409, { code: 'appointment_not_pending' });
      a.status = 'confirmed';
      return json(res, 200, a);
    }
    if (action === 'cancel') {
      const hoursLeft = (new Date(a.startsAt).getTime() - Date.now()) / HOUR;   // server time, not browser time
      a.refund = a.status === 'confirmed' && hoursLeft >= 24 ? a.deposit : 0;
      a.status = 'cancelled';
      return json(res, 200, a);
    }
  }
  json(res, 404, { code: 'not_found' });
});
server.listen(PORT, () => console.log(`demo on http://localhost:${PORT}`));
