'use strict';
// A tiny stand-in for facebook.com/messages that copies the parts of its
// structure the app relies on: a fixed role="banner" top bar, a chat list,
// role="main", CSS colour variables, SPA navigation and l.facebook.com links.
// Run: node test/mock-server.js  then  MESSENGER_URL=http://localhost:8123/messages/ npm start
const http = require('node:http');

const PORT = Number(process.env.PORT || 8123);
const avatar = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#f5a623"/><circle cx="20" cy="16" r="7" fill="#fff"/><rect x="8" y="26" width="24" height="14" rx="7" fill="#fff"/></svg>');

const chats = ['Linh Tran', 'Minh Nguyen', 'Design team', 'Bao Pham', 'Ha Vu', 'Quang Le', 'Mai Do'];

function page(path) {
  const thread = (/\/t\/(\d+)/.exec(path) || [, '0'])[1];
  const name = chats[Number(thread)] || chats[0];
  return `<!doctype html>
<html class="__fb-light-mode">
<head>
<meta charset="utf-8">
<title>(3) Messenger | Facebook</title>
<style>
  .__fb-light-mode { --surface-background:#fff; --web-wash:#f0f2f5; --primary-text:#050505; --secondary-text:#65676b;
    --secondary-icon:#65676b; --hover-overlay:rgba(0,0,0,.05); --divider:#ced0d4; --accent:#0866ff; }
  .__fb-dark-mode { --surface-background:#242526; --web-wash:#18191a; --primary-text:#e4e6eb; --secondary-text:#b0b3b8;
    --secondary-icon:#b0b3b8; --hover-overlay:rgba(255,255,255,.1); --divider:#3e4042; --accent:#2d88ff; }
  @media (prefers-color-scheme: dark) { html.auto { --surface-background:#242526; --primary-text:#e4e6eb; --secondary-text:#b0b3b8; --divider:#3e4042; } }
  html, body { margin:0; height:100%; font:15px "Segoe UI",system-ui,sans-serif; background:var(--web-wash); color:var(--primary-text); }
  :root { --header-height: 56px; }
  /* Like Facebook: role=banner is a zero-height wrapper around a fixed bar. */
  [role=banner] { position:static; height:0; }
  .fbbar { position:fixed; top:0; left:0; right:0; height:56px; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.2);
    display:flex; align-items:center; justify-content:space-between; padding:0 16px; z-index:3; color:#1877f2; font-weight:700; }
  .page { position:fixed; top:56px; left:0; right:0; bottom:0; display:flex; }
  [role=navigation] { width:360px; background:var(--surface-background); border-right:1px solid var(--divider); overflow:auto; }
  [role=navigation] h1 { font-size:24px; margin:12px 16px; }
  .search { margin:0 16px 8px; padding:8px 12px; border-radius:20px; background:var(--web-wash); color:var(--secondary-text); }
  .row { display:flex; gap:12px; align-items:center; padding:8px; margin:0 8px; border-radius:8px; color:inherit; text-decoration:none; }
  .row:hover { background:var(--hover-overlay); } .row.sel { background:rgba(0,0,0,.08); }
  .av { width:56px; height:56px; border-radius:50%; background:#ccd; flex:none; }
  [role=main] { flex:1; background:var(--surface-background); display:flex; flex-direction:column; }
  .head { height:56px; border-bottom:1px solid var(--divider); display:flex; align-items:center; gap:12px; padding:0 16px; font-weight:600; }
  .msgs { flex:1; padding:16px; display:flex; flex-direction:column; gap:6px; }
  .b { max-width:60%; padding:8px 12px; border-radius:18px; background:var(--web-wash); align-self:flex-start; }
  .b.me { align-self:flex-end; background:linear-gradient(#a033ff,#0866ff); color:#fff; }
  .composer { padding:12px 16px; } .composer div { border-radius:20px; background:var(--web-wash); padding:9px 12px; color:var(--secondary-text); }
  .viewer { position:fixed; inset:0; background:#000; z-index:10; color:#fff; display:none; }
  .viewer.open { display:block; } .viewer button { position:absolute; top:12px; left:12px; }
  .dialog-backdrop { position:fixed; inset:0; background:rgba(244,244,244,.8); z-index:9; display:none; }
  .dialog-backdrop.open { display:grid; place-items:center; }
</style>
</head>
<body>
<div role="banner"><div class="fbbar"><span>facebook (top bar that should be hidden)</span>
  <svg width="40" height="40" aria-label="Your profile"><image href="${avatar}" width="40" height="40"/></svg></div></div>
<div class="page">
  <div role="navigation" aria-label="Chats">
    <h1>Chats</h1><div class="search">Search Messenger</div>
    ${chats.map((c, i) => `<a class="row ${String(i) === thread ? 'sel' : ''}" href="/messages/t/${i}/"><span class="av"></span><span><b>${c}</b><br><small>Last message · 2h</small></span></a>`).join('')}
  </div>
  <div role="main">
    <div class="head"><span class="av" style="width:40px;height:40px"></span><a id="profile" href="/profile.php?id=4">${name}</a></div>
    <div class="msgs">
      <div class="b">Hey! Did you see <a id="ext" target="_blank" href="https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Farticle">this article</a>?</div>
      <div class="b me">Yes, looks great</div>
      <div class="b"><a id="feed" href="/groups/123">Group post link</a></div>
      <div class="b"><button id="photo">Open photo viewer</button> <button id="dlg">Open dialog</button> <button id="spa">SPA to /watch</button> <button id="notify">Notify</button></div>
    </div>
    <div class="composer"><div contenteditable="true">Aa</div></div>
  </div>
</div>
<div class="viewer" id="viewer"><button id="closeViewer">✕ Close viewer</button></div>
<div class="dialog-backdrop" id="backdrop"><div role="dialog" style="background:#fff;padding:60px 120px;border-radius:8px">A modal dialog</div></div>
<script>
  // SPA routing between threads, like Facebook's router.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a.row');
    if (!a) return;
    e.preventDefault();
    history.pushState({}, '', a.getAttribute('href'));
    document.title = '(3) Messenger | Facebook';
    document.querySelectorAll('.row').forEach((r) => r.classList.toggle('sel', r === a));
  });
  photo.onclick = () => { viewer.classList.add('open'); history.pushState({}, '', '/messenger_media/?attachment_id=1'); };
  document.getElementById("closeViewer").onclick = () => { viewer.classList.remove('open'); history.back(); };
  dlg.onclick = () => backdrop.classList.add('open');
  backdrop.onclick = () => backdrop.classList.remove('open');
  spa.onclick = () => history.pushState({}, '', '/watch/');
  notify.onclick = () => Notification.requestPermission().then((p) => { window.__lastPermission = p; new Notification('Linh Tran', { body: 'New message' }); });
  if (new URLSearchParams(location.search).has('dark')) document.documentElement.className = '__fb-dark-mode';
</script>
</body>
</html>`;
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  console.log('[mock]', req.method, url.pathname + url.search);
  if (url.pathname === '/' || url.pathname === '/home.php') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><title>Facebook</title><h1>HOME FEED (app should never stay here)</h1>');
  }
  res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'c_user=1000; Path=/; Max-Age=86400' });
  res.end(page(url.pathname));
}).listen(PORT, () => console.log(`mock facebook on http://localhost:${PORT}/messages/`));
