'use strict';
const part = new URLSearchParams(location.search).get('part') || 'rail';
document.body.dataset.part = part;

const $ = (sel) => document.querySelector(sel);
let lastBadge = -1;

const TOKENS = {
  titleBg: '--title-bg',
  titleFg: '--title-fg',
  railBg: '--rail-bg',
  railRing: '--rail-ring',
  railFg: '--rail-fg',
  railFgActive: '--rail-fg-active',
  railText: '--rail-text',
  railHover: '--rail-hover',
  railActive: '--rail-active',
  railBorder: '--rail-border',
  badgeBg: '--badge-bg',
  badgeFg: '--badge-fg',
  brand: '--brand',
  brandDots: '--brand-dots',
};

function applyState(s) {
  if (!s) return;
  const t = s.shell || {};
  const root = document.documentElement.style;
  for (const [key, prop] of Object.entries(TOKENS)) {
    if (t[key]) root.setProperty(prop, t[key]);
  }
  root.setProperty('--title-pad', t.joinRail ? `${s.railWidth || 0}px` : '0px');
  document.body.dataset.skin = s.skin || 'messenger';
  document.body.dataset.platform = s.platform || '';
  document.body.classList.toggle('dark', Boolean(t.dark));
  document.body.classList.toggle('collapsed', Boolean(s.collapsed));

  if (part === 'rail') renderRail(s);
  if (part === 'title') renderBadge(s.totalUnread || 0);
}

function renderRail(s) {
  for (const btn of document.querySelectorAll('.item[data-route]')) {
    btn.classList.toggle('active', btn.dataset.route === s.active);
  }
  const badge = $('.item[data-route="chats"] .badge');
  badge.hidden = !s.unread;
  badge.textContent = s.unread > 99 ? '99+' : String(s.unread || '');

  setAvatar(s.avatar || null);

  const settings = $('#settings');
  const others = s.otherUnread || 0;
  $('.other-unread').hidden = !others;
  settings.querySelector('.label').textContent = s.accountName || 'Preferences';
  settings.title = [
    s.accountName,
    others ? `${others} unread in your other accounts` : '',
    s.accountCount > 1 ? 'Switch account, add an account, preferences' : 'Add an account, preferences',
  ].filter(Boolean).join('\n');

  const collapse = $('#collapse');
  collapse.title = s.collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  collapse.querySelector('.label').textContent = s.collapsed ? 'Expand' : 'Collapse';
}

// Profile picture. A new link is loaded off-screen first and swapped in only
// once it works, so a failed load keeps the picture already showing. If it
// fails (offline after sleep, or Facebook's signed link expired), the app asks
// the page for a fresh link and retries with backoff. The person icon only
// shows while no picture has loaded yet.
const avatarImg = $('.avatar img');
let avatarUrl = null; // the link we want to show
let shownUrl = null; // the link currently on screen
let avatarRetry = null;
let avatarDelay = 5000;

function setAvatar(url) {
  if (url === avatarUrl) return;
  avatarUrl = url;
  clearTimeout(avatarRetry);
  avatarDelay = 5000;
  if (!url) {
    shownUrl = null;
    avatarImg.removeAttribute('src');
    avatarImg.hidden = true;
    return;
  }
  loadAvatar();
}

function loadAvatar() {
  const url = avatarUrl;
  if (!url) return;
  const probe = new Image();
  probe.referrerPolicy = 'no-referrer';
  probe.onload = () => {
    if (url !== avatarUrl) return;
    avatarImg.src = url;
    avatarImg.hidden = false;
    shownUrl = url;
    avatarDelay = 5000;
  };
  probe.onerror = () => {
    if (url !== avatarUrl) return;
    if (!shownUrl) avatarImg.hidden = true;
    window.shell.avatarFailed(url);
    clearTimeout(avatarRetry);
    avatarRetry = setTimeout(loadAvatar, avatarDelay);
    avatarDelay = Math.min(avatarDelay * 3, 5 * 60 * 1000);
  };
  probe.src = url;
}

window.addEventListener('online', () => {
  if (avatarUrl && shownUrl !== avatarUrl) loadAvatar();
});

// Draw the red taskbar badge the main process puts over the app icon.
function renderBadge(n) {
  if (n === lastBadge) return;
  lastBadge = n;
  if (!n) return window.shell.setBadge(null, 0);
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#e41e3f';
  g.beginPath();
  g.arc(16, 16, 16, 0, Math.PI * 2);
  g.fill();
  const text = n > 99 ? '99+' : String(n);
  g.fillStyle = '#fff';
  g.font = `bold ${text.length > 2 ? 13 : text.length > 1 ? 17 : 20}px "Segoe UI", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 16, 17);
  window.shell.setBadge(c.toDataURL('image/png'), n);
}

if (part === 'rail') {
  for (const btn of document.querySelectorAll('.item[data-route]')) {
    btn.addEventListener('click', () => window.shell.navigate(btn.dataset.route));
  }
  const menuAt = (fn) => (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    fn(r.right + 4, r.top);
  };
  $('#theme').addEventListener('click', menuAt(window.shell.openThemeMenu));
  $('#settings').addEventListener('click', menuAt(window.shell.openMenu));
  $('#collapse').addEventListener('click', () => window.shell.toggleRail());
}

window.shell.onState(applyState);
window.shell.getState().then(applyState);
