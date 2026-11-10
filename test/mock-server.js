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

function page(path, query) {
  const thread = (/\/t\/(\d+)/.exec(path) || [, '0'])[1];
  const name = chats[Number(thread)] || chats[0];
  const mode = query.has('dark') ? '__fb-dark-mode' : '__fb-light-mode';
  // Chat themes: Facebook sets these variables inline on many elements inside
  // role=main, plus a background on one big element.
  const theme = query.get('theme');
  const themeVars = theme === 'gradient'
    ? '--chat-outgoing-message-bubble-background-color: transparent; --chat-outgoing-message-background-gradient: linear-gradient(#aa00ff, #0070f6); --mwp-message-row-background: var(--messenger-card-background); --mwp-header-button-color: #aa00ff; --chat-composer-button-color: #0070f6; --mwp-primary-theme-color: #4e4bf5;'
    : theme === 'wallpaper'
      ? '--mwp-message-row-background: transparent; --mwp-header-background-color: #772823; --chat-incoming-message-bubble-background-color: #351715; --chat-composer-input-background-color: #581511; --chat-outgoing-message-bubble-background-color: #f6c12f; --chat-message-text-color: #000; --mwp-header-button-color: #ffd35a; --chat-composer-button-color: #ffd35a; --mwp-primary-theme-color: #f6c12f;'
      : '';
  const wallpaper = theme === 'gradient'
    ? 'background-image: var(--chat-outgoing-message-background-gradient);'
    : theme === 'wallpaper' ? 'background-image: radial-gradient(circle at 30% 30%, #f6c12f, #772823 70%);' : '';
  return `<!doctype html>
<html class="${mode}">
<head>
<meta charset="utf-8">
<title>(3) Messenger | Facebook</title>
<style>
  /* Variable names and scoping copied from facebook.com/messages. */
  :root, .__fb-light-mode:root, .__fb-light-mode { --surface-background:#fff; --messenger-card-background:#fff; --web-wash:#f0f2f5; --primary-text:#080809; --secondary-text:#65686c;
    --primary-icon:#080809; --secondary-icon:#65686c; --hover-overlay:rgba(0,0,0,.05); --divider:#ced0d4; --accent:#0866ff; --comment-background:#f0f2f5;
    --hosted-view-selected-state:rgba(8,102,255,.1); --mwp-header-background-color:#fff; --mwp-message-row-background:#fff; --mwp-header-button-color:#0866ff;
    --chat-incoming-message-bubble-background-color:#f0f0f0; --chat-outgoing-message-bubble-background-color:#0866ff; --chat-composer-input-background-color:var(--comment-background); --chat-composer-button-color:#0866ff; }
  .__fb-dark-mode { --surface-background:#252728; --messenger-card-background:#242526; --web-wash:#1c1c1d; --primary-text:#e2e5e9; --secondary-text:#b0b3b8;
    --primary-icon:#e2e5e9; --secondary-icon:#b0b3b8; --hover-overlay:rgba(255,255,255,.1); --divider:#65686c; --accent:#0866ff; --comment-background:#333334;
    --hosted-view-selected-state:rgba(29,133,252,.1); --mwp-header-background-color:#242526; --mwp-message-row-background:#242526; --mwp-header-button-color:#0866ff;
    --chat-incoming-message-bubble-background-color:#303030; --chat-outgoing-message-bubble-background-color:#0866ff; --chat-composer-input-background-color:var(--comment-background); --chat-composer-button-color:#0866ff; }
  html, body { margin:0; height:100%; font:15px "Segoe UI Historic","Segoe UI",system-ui,sans-serif; background:var(--web-wash); color:var(--primary-text); }
  :root { --header-height: 56px; }
  /* Like Facebook: role=banner is a zero-height wrapper around a fixed bar. */
  [role=banner] { position:static; height:0; }
  .fbbar { position:fixed; top:0; left:0; right:0; height:56px; background:var(--surface-background); box-shadow:0 1px 2px rgba(0,0,0,.2);
    display:flex; align-items:center; justify-content:space-between; padding:0 16px; z-index:3; color:#1877f2; font-weight:700; }
  .page { position:fixed; top:56px; left:0; right:0; bottom:0; display:flex; background:var(--web-wash); }
  [role=navigation] { width:360px; background:var(--messenger-card-background); overflow:auto; }
  [role=navigation] h1 { font-size:24px; margin:12px 16px; }
  .search { margin:0 16px 8px; padding:8px 12px; border-radius:20px; background:var(--comment-background); color:var(--secondary-text); }
  .row { display:flex; gap:12px; align-items:center; padding:8px; margin:0 8px; border-radius:8px; color:inherit; text-decoration:none; }
  .row:hover { background:var(--hover-overlay); } .row.sel { background:var(--hosted-view-selected-state); }
  .row small { color:var(--secondary-text); }
  .av { width:56px; height:56px; border-radius:50%; background:#c9ccd6; flex:none; }
  [role=main] { flex:1; margin:16px; border-radius:12px; overflow:hidden; display:flex; flex-direction:column; background:var(--messenger-card-background); }
  .thread { flex:1; display:flex; flex-direction:column; position:relative; }
  .wallpaper { position:absolute; inset:56px 0 64px 0; }
  .head { position:relative; height:56px; display:flex; align-items:center; gap:12px; padding:0 16px; font-weight:600; background:var(--mwp-header-background-color); border-bottom:1px solid var(--divider); }
  .head a { color:var(--primary-text); text-decoration:none; } .head .tools { margin-left:auto; color:var(--mwp-header-button-color); font-size:22px; letter-spacing:12px; }
  .msgs { position:relative; flex:1; display:flex; flex-direction:column; justify-content:flex-end; padding:12px 0; }
  .r { display:flex; padding:3px 16px; } .r.me { justify-content:flex-end; }
  .b { max-width:60%; padding:8px 12px; border-radius:var(--chat-bubble-border-radius, 18px); background:var(--chat-incoming-message-bubble-background-color); color:var(--chat-incoming-message-text-color, var(--primary-text)); }
  .r.me .b { background:var(--chat-outgoing-message-bubble-background-color); color:var(--chat-message-text-color, #fff); }
  .b a { color:inherit; }
  .composer { position:relative; display:flex; gap:12px; align-items:center; padding:12px 16px; background:var(--chat-composer-background-color, transparent); color:var(--chat-composer-button-color); font-size:20px; }
  .composer div { flex:1; border-radius:20px; background:var(--chat-composer-input-background-color); padding:9px 12px; color:var(--primary-text); font-size:15px; }
  .viewer { position:fixed; inset:0; background:#000; z-index:10; color:#fff; display:none; }
  .viewer.open { display:block; } .viewer button { position:absolute; top:12px; left:12px; }
  .dialog-backdrop { position:fixed; inset:0; background:rgba(244,244,244,.8); z-index:9; display:none; }
  .dialog-backdrop.open { display:grid; place-items:center; }
</style>
</head>
<body>
<div role="banner"><div class="fbbar"><span>facebook (top bar that should be hidden)</span>
  <svg width="40" height="40" aria-label="Your profile"><image href="${avatar}" width="40" height="40"/></svg></div></div>
<div class="page ${mode}">
  <div role="navigation" aria-label="Thread list" class="${mode}">
    <h1>Chats</h1><div class="search">Search Messenger</div>
    ${chats.map((c, i) => `<a class="row ${String(i) === thread ? 'sel' : ''}" href="/messages/t/${i}/"><span class="av"></span><span><b>${c}</b><br><small>Last message · 2h</small></span></a>`).join('')}
  </div>
  <div role="main" class="${mode}">
    <div class="thread" style="${themeVars}">
      <div class="wallpaper" style="${themeVars} ${wallpaper}"></div>
      <div class="head" style="${themeVars}"><span class="av" style="width:40px;height:40px"></span><a id="profile" href="/profile.php?id=4">${name}</a><span class="tools">✆ ▶ ⓘ</span></div>
      <div class="msgs" style="${themeVars}">
        <div class="r ${mode}" role="article" style="${themeVars}"><div class="b">Hey! Did you see <a id="ext" target="_blank" href="https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Farticle">this article</a>?</div></div>
        <div class="r me ${mode}" role="article" style="${themeVars}"><div class="b">Yes, looks great 😄</div></div>
        <div class="r me ${mode}" role="article" style="${themeVars}"><div class="b">See you at 7?</div></div>
        <div class="r ${mode}" role="article" style="${themeVars}"><div class="b"><a id="feed" href="/groups/123">Group post link</a></div></div>
        <div class="r ${mode}" role="article" style="${themeVars}"><div class="b"><button id="photo">Open photo viewer</button> <button id="dlg">Open dialog</button> <button id="spa">SPA to /watch</button> <button id="notify">Notify</button></div></div>
      </div>
      <div class="composer" style="${themeVars}">⊕ ▣ ☺<div contenteditable="true">Aa</div>👍</div>
    </div>
  </div>
</div>
<div class="viewer __fb-dark-mode" id="viewer" role="dialog"><button id="closeViewer">✕ Close viewer</button></div>
<div class="dialog-backdrop" id="backdrop"><div role="dialog" style="background:var(--surface-background);padding:60px 120px;border-radius:8px">A modal dialog</div></div>
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
  res.end(page(url.pathname, url.searchParams));
}).listen(PORT, () => console.log(`mock facebook on http://localhost:${PORT}/messages/`));
