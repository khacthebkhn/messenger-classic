'use strict';
// Runs inside the Facebook page (isolated world). It never reads message
// content; it only measures layout, samples colors and routes link clicks.
const { ipcRenderer, contextBridge, webFrame } = require('electron');

// ---------------------------------------------------------------------------
// Notifications: focus the app window when a notification is clicked, and
// honour the app's "Desktop notifications" switch.
// ---------------------------------------------------------------------------
let notificationsEnabled = true;
ipcRenderer.on('mc:settings', (_e, s) => {
  notificationsEnabled = Boolean(s && s.notifications);
});

contextBridge.exposeInMainWorld('__messengerClassic', {
  notificationClicked: () => ipcRenderer.send('fb:notification-click'),
  notificationsEnabled: () => notificationsEnabled,
});

function patchNotifications() {
  const Native = window.Notification;
  const bridge = window.__messengerClassic;
  if (!Native || !bridge || Native.__mcPatched) return;
  function Notification(title, options) {
    if (!bridge.notificationsEnabled()) {
      const silent = new EventTarget();
      silent.close = () => {};
      return silent;
    }
    const n = new Native(title, options);
    n.addEventListener('click', () => bridge.notificationClicked());
    return n;
  }
  Notification.prototype = Native.prototype;
  Notification.__mcPatched = true;
  Object.defineProperty(Notification, 'permission', { get: () => Native.permission });
  Object.defineProperty(Notification, 'maxActions', { get: () => Native.maxActions });
  Notification.requestPermission = (...args) => Native.requestPermission(...args);
  window.Notification = Notification;
}

try {
  contextBridge.executeInMainWorld({ func: patchNotifications });
} catch {
  webFrame.executeJavaScript(`(${patchNotifications.toString()})()`).catch(() => {});
}

// ---------------------------------------------------------------------------
// Links: keep Messenger inside the app, send everything else to the browser.
// ---------------------------------------------------------------------------
function onLinkClick(e) {
  if (e.button > 1) return;
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!a || !/^https?:/i.test(a.href)) return;
  const kind = ipcRenderer.sendSync('fb:classify', a.href);
  if (kind === 'internal') {
    if (e.button === 1) e.preventDefault(); // no stray windows on middle-click
    return;
  }
  e.preventDefault();
  e.stopImmediatePropagation();
  if (kind === 'external' || kind === 'outbound') ipcRenderer.send('fb:open-external', a.href);
}
window.addEventListener('click', onLinkClick, true);
window.addEventListener('auxclick', onLinkClick, true);

// Sidebar buttons: use an on-page link when there is one (instant), or ask
// the main process to load the route.
ipcRenderer.on('mc:navigate', (_e, route) => {
  const here = location.pathname;
  if (route === '/messages/' && /^\/messages\/(e2ee\/)?t\//.test(here)) return;
  if (route !== '/messages/' && here.startsWith(route)) return;
  const want = route.replace(/\/$/, '');
  const link = [...document.querySelectorAll('a[href]')].find((a) => {
    try {
      return new URL(a.href).pathname.replace(/\/$/, '') === want;
    } catch {
      return false;
    }
  });
  if (link) link.click();
  else ipcRenderer.send('fb:load', route);
});

// ---------------------------------------------------------------------------
// Layout + theme reporting
// ---------------------------------------------------------------------------
function parseColor(str) {
  if (!str) return null;
  let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(str.trim());
  if (m) {
    let a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (m[4] && m[4].endsWith('%')) a /= 100;
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(str.trim());
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  return null;
}

const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const luminance = ({ r, g, b }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

function cssVar(name) {
  const el = document.body || document.documentElement;
  return el ? getComputedStyle(el).getPropertyValue(name).trim() : '';
}

function opaqueBackgroundAt(x, y) {
  let el = document.elementFromPoint(x, y);
  while (el && el !== document.documentElement) {
    const c = parseColor(getComputedStyle(el).backgroundColor);
    if (c && c.a > 0.9) return c;
    el = el.parentElement;
  }
  return parseColor(getComputedStyle(document.body).backgroundColor);
}

// Facebook's role="banner" is a zero-height wrapper; the bar you see is a
// position:fixed child inside it. Measure the wrapper and two levels of
// children, then fall back to Facebook's own --header-height variable.
function findBanner() {
  const b = document.querySelector('div[role="banner"]');
  if (!b) return null;
  const cs = getComputedStyle(b);
  if (cs.display === 'none' || cs.visibility === 'hidden') return null;

  let best = null;
  const consider = (el) => {
    const r = el.getBoundingClientRect();
    if (r.top <= 1 && r.height >= 24 && r.height <= 120 && r.width >= innerWidth * 0.6) {
      if (!best || r.bottom > best.bottom) best = r;
    }
  };
  consider(b);
  for (const child of b.children) {
    consider(child);
    for (const grandchild of child.children) consider(grandchild);
  }
  if (!best) {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height'));
    if (v >= 24 && v <= 120) best = { top: 0, bottom: v, height: v, left: 0, width: innerWidth };
  }
  return best ? { el: b, rect: best } : null;
}

// True when a full-screen opaque layer (e.g. the photo viewer) sits over
// Facebook's top bar. Its close button lives up there, so stop hiding it.
function bannerCovered(banner) {
  if (!banner) return false;
  const y = banner.rect.top + banner.rect.height / 2;
  for (const x of [8, innerWidth / 2]) {
    const hit = document.elementFromPoint(x, y);
    if (!hit || banner.el.contains(hit)) return false;
  }
  let el = document.elementFromPoint(8, y);
  while (el && el !== document.body) {
    const r = el.getBoundingClientRect();
    if (r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9) {
      const c = parseColor(getComputedStyle(el).backgroundColor);
      if (c && c.a >= 0.85) return true;
    }
    el = el.parentElement;
  }
  return false;
}

function findAvatar(banner) {
  if (!banner) return null;
  const images = banner.el.querySelectorAll('svg image');
  const img = images[images.length - 1];
  if (!img) return null;
  return img.getAttribute('xlink:href') || img.getAttribute('href') || null;
}

let loadedAt = 0;
window.addEventListener('load', () => { loadedAt = performance.now(); });

let lastMetrics = '';
let lastTheme = '';
let lastAvatar;

function report() {
  if (!document.body) return;
  const banner = findBanner();
  const pageReady = Boolean(document.querySelector('[role="main"]'));
  let bannerHeight = null;
  if (banner) bannerHeight = Math.round(banner.rect.bottom * webFrame.getZoomFactor());
  else if (pageReady || (loadedAt && performance.now() - loadedAt > 4000)) bannerHeight = 0;

  const metrics = { banner: bannerHeight, overlay: bannerCovered(banner) };
  const mKey = JSON.stringify(metrics);
  if (mKey !== lastMetrics) {
    lastMetrics = mKey;
    ipcRenderer.send('fb:metrics', metrics);
  }

  // Sample the chat list's real background so the title bar and sidebar match.
  // Skip while a dialog or viewer covers the page so the chrome doesn't flicker.
  const covered = metrics.overlay || [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
    .some((d) => { const r = d.getBoundingClientRect(); return r.width > 120 && r.height > 60; });
  const y = (banner ? banner.rect.bottom : 0) + 24;
  const surface = covered ? null : opaqueBackgroundAt(24, Math.min(y, innerHeight - 1));
  if (surface) {
    const dark = luminance(surface) < 0.45;
    const text = parseColor(cssVar('--primary-text')) || parseColor(getComputedStyle(document.body).color);
    const theme = {
      dark,
      surface: hex(surface),
      text: text ? hex(text) : '',
      secondary: cssVar('--secondary-text'),
      icon: cssVar('--secondary-icon') || cssVar('--secondary-text'),
      hover: cssVar('--hover-overlay'),
      divider: cssVar('--divider'),
      accent: cssVar('--accent') || cssVar('--primary-button-background'),
    };
    const tKey = JSON.stringify(theme);
    if (tKey !== lastTheme) {
      lastTheme = tKey;
      ipcRenderer.send('fb:theme', theme);
    }
  }

  const av = findAvatar(banner);
  if (av !== lastAvatar && (av || pageReady)) {
    lastAvatar = av;
    ipcRenderer.send('fb:avatar', av);
  }
}

let queued = false;
function scheduleReport() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    try {
      report();
    } catch (err) {
      console.debug('[messenger-classic] report failed', err);
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  scheduleReport();
  setInterval(scheduleReport, 1000);
  window.addEventListener('resize', scheduleReport);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(scheduleReport, 300));
  new MutationObserver(scheduleReport).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
});
