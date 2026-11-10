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
  document.body.classList.toggle('dark', Boolean(t.dark));
  document.body.classList.toggle('collapsed', Boolean(s.collapsed));

  if (part === 'rail') renderRail(s);
  if (part === 'title') renderBadge(s.unread || 0);
}

function renderRail(s) {
  for (const btn of document.querySelectorAll('.item[data-route]')) {
    btn.classList.toggle('active', btn.dataset.route === s.active);
  }
  const badge = $('.item[data-route="chats"] .badge');
  badge.hidden = !s.unread;
  badge.textContent = s.unread > 99 ? '99+' : String(s.unread || '');

  const img = $('.avatar img');
  if (s.avatar && img.getAttribute('src') !== s.avatar) img.src = s.avatar;
  img.hidden = !s.avatar;

  const collapse = $('#collapse');
  collapse.title = s.collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  collapse.querySelector('.label').textContent = s.collapsed ? 'Expand' : 'Collapse';
}

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
  $('.avatar img').addEventListener('error', (e) => { e.target.hidden = true; });
}

window.shell.onState(applyState);
window.shell.getState().then(applyState);
