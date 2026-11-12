'use strict';
// A tiny stand-in for facebook.com/messages that copies the parts of its
// structure the app relies on: a fixed role="banner" top bar with the
// Messenger and Notifications buttons, a chat list, role="main", CSS colour
// variables, SPA navigation, l.facebook.com links and notification pop-ups.
// Run: node test/mock-server.js  then  MESSENGER_URL=http://localhost:8123/messages/ npm start
const http = require('node:http');

const PORT = Number(process.env.PORT || 8123);

const chats = ['Linh Tran', 'Minh Nguyen', 'Design team', 'Bao Pham', 'Ha Vu', 'Quang Le', 'Mai Do'];

// Mock Facebook accounts. Run with MOCK_LOGIN=1 to get a login page (for
// testing multiple accounts); otherwise everyone is logged in as 1000.
// unread: chats, notifs: Facebook notifications. Like Facebook, the page title
// shows the two added together. Facebook's /messages has no Messenger button
// in its top bar; open /messages/?nojewel to get that, the default page has one.
const USERS = {
  1000: { name: 'Alex Morgan', unread: 3, notifs: 2, color: '#f5a623' },
  1001: { name: 'Linh Tran', unread: 1, notifs: 4, color: '#10b981' },
  1002: { name: 'Bao Pham', unread: 0, notifs: 0, color: '#ef4444' },
};

function loginPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Facebook – log in or sign up</title>
<style>body{font:15px system-ui;background:#f0f2f5;display:grid;place-items:center;height:100vh;margin:0}
.card{background:#fff;padding:24px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.15);width:320px}
a{display:block;margin:8px 0;padding:10px;border-radius:6px;background:#0866ff;color:#fff;text-align:center;text-decoration:none;font-weight:600}</style></head>
<body><div class="card"><h2>Log in to Facebook</h2>
${Object.entries(USERS).map(([id, u]) => `<a id="login-${id}" href="/login/submit?u=${id}">Log in as ${u.name}</a>`).join('')}
</div></body></html>`;
}

// Facebook's top-bar buttons: <div role="button" aria-label="Messenger, 3 unread">
// with the red badge as <span aria-hidden="true">3</span>.
function jewel(id, name, n) {
  const badge = n ? `<span><span aria-hidden="true">${n > 20 ? '20+' : n}</span></span>` : '';
  return `<div class="jewel" id="${id}" role="button" tabindex="0" aria-label="${n ? `${name}, ${n} unread` : name}"><svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="currentColor"/></svg>${badge}</div>`;
}

function page(path, query, uid = '1000') {
  const user = USERS[uid] || USERS[1000];
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
<title>${user.unread + user.notifs ? `(${user.unread + user.notifs}) ` : ''}Messenger | Facebook</title>
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
  .jewels { display:flex; gap:8px; align-items:center; }
  .jewel { position:relative; width:40px; height:40px; border-radius:50%; background:var(--comment-background); display:grid; place-items:center; }
  .jewel > span { position:absolute; top:-4px; right:-4px; min-width:19px; height:19px; border-radius:10px; background:#e41e3f; color:#fff; font:700 12px/19px system-ui; text-align:center; }
  .toaster { position:fixed; left:0; right:0; bottom:0; z-index:5; pointer-events:none; }
  .toaster ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; }
  .toaster li { padding:16px; pointer-events:auto; max-width:360px; }
  .card { background:var(--surface-background); color:var(--primary-text); border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,.25); padding:8px 12px; }
  .viewer { position:fixed; inset:0; background:#000; z-index:10; color:#fff; display:none; }
  .viewer.open { display:block; } .viewer button { position:absolute; top:12px; left:12px; }
  .dialog-backdrop { position:fixed; inset:0; background:rgba(244,244,244,.8); z-index:9; display:none; }
  .dialog-backdrop.open { display:grid; place-items:center; }
</style>
</head>
<body>
<div role="banner"><div class="fbbar"><span>facebook (top bar that should be hidden)</span>
  <div role="navigation" aria-label="Account Controls and Settings" class="jewels">${query.has('nojewel') ? '' : jewel('jewel-messenger', 'Messenger', user.unread)}${jewel('jewel-notifications', 'Notifications', user.notifs)}<svg id="me" width="40" height="40" aria-label="Your profile"><image href="/avatar/me.svg?u=${uid}" width="40" height="40"/></svg></div></div>
  <!-- Facebook draws pop-ups (notifications...) inside the banner element, below the bar. -->
  <div id="popover" style="position:fixed; top:60px; right:16px; width:340px; padding:8px; background:var(--surface-background); box-shadow:0 4px 16px rgba(0,0,0,.25); border-radius:8px; z-index:4; display:${query.has('popover') ? 'block' : 'none'}">
    ${['Ana', 'Ben', 'Chi'].map((n) => `<div style="display:flex;gap:8px;align-items:center;padding:6px"><svg width="40" height="40"><image href="/avatar/other.svg?${n}" width="40" height="40"/></svg>${n} commented</div>`).join('')}
  </div></div>
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
<!-- Facebook's toaster: a fixed list it adds to <body> (see mock.toast). -->
<div class="toaster"><ul id="toasts"></ul></div>
<div class="viewer __fb-dark-mode" id="viewer" role="dialog"><button id="closeViewer">✕ Close viewer</button></div>
<div class="dialog-backdrop" id="backdrop"><div role="dialog" style="background:var(--surface-background);padding:60px 120px;border-radius:8px">A modal dialog</div></div>
<script type="application/json" data-sjs>{"require":[["ScheduledServerJS","handle",null,[{"define":[["CurrentUserInitialData",[],{"ACCOUNT_ID":"${uid}","USER_ID":"${uid}","NAME":${JSON.stringify(user.name)},"SHORT_NAME":${JSON.stringify(user.name.split(' ')[0])},"IS_MESSENGER_ONLY_USER":false},270]]}]]]}</script>
<script>
  // SPA routing between threads, like Facebook's router.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a.row');
    if (!a) return;
    e.preventDefault();
    history.pushState({}, '', a.getAttribute('href'));
    setTitle();
    document.querySelectorAll('.row').forEach((r) => r.classList.toggle('sel', r === a));
  });
  photo.onclick = () => { viewer.classList.add('open'); history.pushState({}, '', '/messenger_media/?attachment_id=1'); };
  document.getElementById("closeViewer").onclick = () => { viewer.classList.remove('open'); history.back(); };
  dlg.onclick = () => backdrop.classList.add('open');
  backdrop.onclick = () => backdrop.classList.remove('open');
  spa.onclick = () => history.pushState({}, '', '/watch/');
  const counts = { unread: ${user.unread}, notifs: ${user.notifs} };
  function setTitle() {
    const n = counts.unread + counts.notifs;
    document.title = (n ? '(' + n + ') ' : '') + 'Messenger | Facebook';
  }
  // Facebook's button labels: "Messenger" / "Messenger, 2 unread".
  function setJewel(id, name, n) {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('aria-label', n ? name + ', ' + n + ' unread' : name);
    el.querySelector('span')?.remove();
    if (n) el.insertAdjacentHTML('beforeend', '<span><span aria-hidden="true">' + (n > 20 ? '20+' : n) + '</span></span>');
  }
  let toastId = 0;
  function addToast(html) {
    const li = document.createElement('li');
    li.innerHTML = html;
    li.querySelector('[data-close]')?.addEventListener('click', () => li.remove());
    document.getElementById('toasts').appendChild(li);
    setTimeout(() => li.remove(), 8000);
    return li;
  }
  window.mock = {
    // New chats or Facebook notifications arrive: the button badge and the title change.
    setCounts: (unread, notifs) => {
      Object.assign(counts, { unread, notifs });
      setJewel('jewel-messenger', 'Messenger', unread);
      setJewel('jewel-notifications', 'Notifications', notifs);
      setTitle();
    },
    // A Facebook notification pop-up (CometToastNotification), like the real one.
    toast: (text = 'Ana commented on your post.') => {
      const id = 'toast-' + ++toastId;
      return addToast('<div class="card"><div aria-labelledby="' + id + '" role="complementary">'
        + '<div><div style="display:flex;justify-content:space-between"><div id="' + id + '"><h4 style="margin:4px 0">New notification</h4></div>'
        + '<div role="button" aria-label="Close" tabindex="0" data-close>✕</div></div></div>'
        + '<div><div role="listitem"><a href="/permalink.php?story_fbid=1&notif_id=' + toastId + '&notif_t=feedback_comment&ref=notif">' + text + '</a>'
        + '<div role="button" aria-label="Options for this notification">…</div></div></div></div></div>').id = id;
    },
    // Messenger's own toast ("Message unsent"); must stay visible.
    messengerToast: () => { addToast('<div class="card" role="alert" id="mtoast">Message unsent</div>'); },
    // Like DocumentTitle.blink: swap in "Linh Tran messaged you" every 1.5 s.
    blink: (on) => {
      clearInterval(window.__blink);
      setTitle();
      if (on) window.__blink = setInterval(() => { if (document.title.includes('Messenger')) document.title = 'Linh Tran messaged you'; else setTitle(); }, 1500);
    },
    popover: (on) => { document.getElementById('popover').style.display = on ? 'block' : 'none'; },
    // Facebook hands out a new signed link for the same picture now and then.
    newAvatarLink: (path) => document.querySelector('#me image').setAttribute('href', path),
    // Facebook re-renders the account button now and then; drop it for a while.
    dropAvatar: (ms) => { const me = document.getElementById('me'); const parent = me.parentNode; me.remove(); setTimeout(() => parent.appendChild(me), ms); },
  };
  notify.onclick = () => Notification.requestPermission().then((p) => { window.__lastPermission = p; new Notification('Linh Tran', { body: 'New message' }); });
</script>
</body>
</html>`;
}

let avatarFailures = 0;
const face = (bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${bg}"/><circle cx="20" cy="16" r="7" fill="#fff"/><rect x="8" y="26" width="24" height="14" rx="7" fill="#fff"/></svg>`;

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  console.log('[mock]', req.method, url.pathname + url.search);
  // /avatar-fail?n=3 makes the next 3 profile-picture requests fail (network blip).
  if (url.pathname === '/avatar-fail') {
    avatarFailures = Number(url.searchParams.get('n') || 1);
    res.writeHead(204);
    return res.end();
  }
  if (url.pathname.startsWith('/avatar/')) {
    // Fail only the app sidebar's requests (they have no Referer), not the page's own.
    if (url.pathname.startsWith('/avatar/me') && avatarFailures > 0 && !req.headers.referer) {
      avatarFailures--;
      res.writeHead(503);
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
    const who = USERS[url.searchParams.get('u')] || USERS[1000];
    return res.end(face(url.pathname.startsWith('/avatar/me') ? who.color : '#3b82f6'));
  }
  if (url.pathname === '/' || url.pathname === '/home.php') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><title>Facebook</title><h1>HOME FEED (app should never stay here)</h1>');
  }
  const cookie = /(?:^|;\s*)c_user=(\d+)/.exec(req.headers.cookie || '');
  if (url.pathname === '/login/submit') {
    res.writeHead(302, { location: '/messages/', 'set-cookie': `c_user=${url.searchParams.get('u')}; Path=/; Max-Age=86400` });
    return res.end();
  }
  if (!cookie && process.env.MOCK_LOGIN) {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(loginPage());
  }
  const uid = cookie ? cookie[1] : '1000';
  res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': `c_user=${uid}; Path=/; Max-Age=86400` });
  res.end(page(url.pathname, url.searchParams, uid));
}).listen(PORT, () => console.log(`mock facebook on http://localhost:${PORT}/messages/`));
