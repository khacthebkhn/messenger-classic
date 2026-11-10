'use strict';
const part = new URLSearchParams(location.search).get('part') || 'rail';
document.body.dataset.part = part;

const $ = (sel) => document.querySelector(sel);
let lastBadge = -1;

function applyState(s) {
  if (!s) return;
  const p = s.palette || {};
  const root = document.documentElement.style;
  for (const [key, value] of Object.entries({
    surface: p.surface, text: p.text, secondary: p.secondary, icon: p.icon,
    hover: p.hover, active: p.active, divider: p.divider, accent: p.accent,
  })) {
    if (value) root.setProperty(`--${key}`, value);
  }
  document.body.classList.toggle('dark', Boolean(p.dark));
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
  $('#settings').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    window.shell.openMenu(r.right + 4, r.top);
  });
  $('#collapse').addEventListener('click', () => window.shell.toggleRail());
  $('.avatar img').addEventListener('error', (e) => { e.target.hidden = true; });
}

window.shell.onState(applyState);
window.shell.getState().then(applyState);
