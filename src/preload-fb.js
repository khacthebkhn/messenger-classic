'use strict';
// Runs inside the Facebook page (isolated world). It never reads message
// content; it only measures layout, samples colors and routes link clicks.
const { ipcRenderer, contextBridge, webFrame } = require('electron');

// ---------------------------------------------------------------------------
// Settings from the app: notifications switch, the current skin and the mode
// that skin pins Facebook's page to ('light', 'dark', or null for Messenger).
// ---------------------------------------------------------------------------
let notificationsEnabled = true;
let skin = 'messenger';
let mode = null;

function applySettings(s) {
  if (!s) return;
  notificationsEnabled = Boolean(s.notifications);
  skin = s.skin || 'messenger';
  mode = s.mode === 'light' || s.mode === 'dark' ? s.mode : null;
  syncSkin();
}

ipcRenderer.on('mc:settings', (_e, s) => applySettings(s));

// ---------------------------------------------------------------------------
// Skins. src/inject/skins.css keys off html[data-mc-skin][data-mc-mode].
// Facebook marks its modes with __fb-light-mode / __fb-dark-mode classes on
// <html> and on many containers inside the page. A skin other than Messenger
// pins all of them to its mode (Yahoo and Zalo: light; Viber and Telegram:
// the app's color mode), whatever Facebook's own dark mode setting is. The
// swapped ones are tagged data-mc-was-dark / data-mc-was-light so they can be
// put back. Full-screen viewers stay dark.
// ---------------------------------------------------------------------------
const DARK = '__fb-dark-mode';
const LIGHT = '__fb-light-mode';
let skinObserver = null;
let pinnedMode = null;

function inFullScreenOverlay(el) {
  const d = el.closest('[role="dialog"], [aria-modal="true"]');
  if (!d) return false;
  const r = d.getBoundingClientRect();
  return r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9;
}

function pin(el) {
  if (mode === 'light') {
    if (!el.classList.contains(DARK) || inFullScreenOverlay(el)) return;
    el.classList.replace(DARK, LIGHT);
    el.setAttribute('data-mc-was-dark', '');
  } else if (mode === 'dark') {
    if (!el.classList.contains(LIGHT)) return;
    el.classList.replace(LIGHT, DARK);
    el.setAttribute('data-mc-was-light', '');
  }
}

function restoreDark(el) {
  el.classList.replace(LIGHT, DARK);
  el.removeAttribute('data-mc-was-dark');
}

function restoreLight(el) {
  el.classList.replace(DARK, LIGHT);
  el.removeAttribute('data-mc-was-light');
}

function unpinAll() {
  for (const el of document.querySelectorAll('[data-mc-was-dark]')) restoreDark(el);
  for (const el of document.querySelectorAll('[data-mc-was-light]')) restoreLight(el);
}

function onSkinMutations(records) {
  if (!mode) return;
  const other = '.' + (mode === 'light' ? DARK : LIGHT);
  let added = false;
  for (const r of records) {
    if (r.type === 'attributes') {
      pin(r.target);
    } else {
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        added = true;
        pin(n);
        for (const el of n.querySelectorAll(other)) pin(el);
      }
    }
  }
  if (added) scheduleReport(); // marks chat wallpapers soon after they appear
}

function syncSkin() {
  const html = document.documentElement;
  if (!html) return;
  if (html.dataset.mcSkin !== skin) html.dataset.mcSkin = skin;
  if (mode) html.dataset.mcMode = mode;
  else delete html.dataset.mcMode;

  if (pinnedMode !== mode) {
    unpinAll();
    pinnedMode = mode;
  }
  if (!mode) {
    skinObserver?.disconnect();
    skinObserver = null;
    return;
  }
  pin(html);
  for (const el of document.querySelectorAll('.' + (mode === 'light' ? DARK : LIGHT))) pin(el);
  if (!skinObserver) {
    skinObserver = new MutationObserver(onSkinMutations);
    skinObserver.observe(html, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  }
}

// Viewers get laid out after they're inserted; put them back to dark once
// they turn out to be full-screen.
function keepViewersDark() {
  if (mode !== 'light') return;
  for (const el of document.querySelectorAll('[data-mc-was-dark]')) {
    if (inFullScreenOverlay(el)) restoreDark(el);
  }
}

// A chat theme's wallpaper is an inline background image on one big element.
function markWallpapers() {
  const main = document.querySelector('[role="main"]');
  if (!main) return;
  const mr = main.getBoundingClientRect();
  for (const n of main.querySelectorAll('[style*="background"]')) {
    if (n.hasAttribute('data-mc-wallpaper') || !(n.style.backgroundImage || n.style.background)) continue;
    const r = n.getBoundingClientRect();
    if (r.width >= mr.width * 0.5 && r.height >= mr.height * 0.4) n.setAttribute('data-mc-wallpaper', '');
  }
}

try {
  applySettings(ipcRenderer.sendSync('fb:get-settings'));
} catch {}
document.addEventListener('readystatechange', syncSkin);

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
// Unread chats. Facebook's title count is unread chats plus Facebook
// notifications ("(3) Messenger | Facebook" can be 3 notifications and no
// chats), so the Facebook part is taken off again:
// - where Facebook's top bar has a Messenger button ("Messenger, 2 unread";
//   its label names Messenger in every language), its count is used;
// - on /messages it has none, so the count on the other top-bar buttons
//   (Notifications) is taken off the title count.
// Between counts, the title blinks "Anna messaged you", which is skipped.
// Facebook also swaps the tab icon for a badged one exactly when there are
// unread chats (data-badged-icon on the icon link), which settles the
// yes-or-no: no badged icon, no unread chats, whatever the title says.
// ---------------------------------------------------------------------------
const MESSENGER_BUTTON = /\bMessenger\b|^Messaging\b/;
const BRAND = /Messenger|Facebook/;
const TITLE_COUNT = /^\((\d+)\+?\)/;

// The red badge on a top-bar button: <span aria-hidden="true">3</span>,
// "20+" when there are more. The label carries the exact number.
function badgeCount(button) {
  for (const s of button.querySelectorAll('span[aria-hidden="true"]')) {
    const m = /^(\d+)(\+?)$/.exec(s.textContent.trim());
    if (!m) continue;
    const label = /\d+/.exec(button.getAttribute('aria-label') || '');
    return m[2] && label ? Math.max(Number(m[1]), Number(label[0])) : Number(m[1]);
  }
  return 0;
}

function topBarButtons(banner) {
  // Pop-ups such as the notifications list are drawn inside the bar too.
  return [...banner.querySelectorAll('[role="button"][aria-label], a[aria-label]')]
    .filter((el) => !el.closest('[role="dialog"]'));
}

let titleTotal = null;
let titleSeenAt = 0;
function readTitleTotal() {
  const t = document.title;
  const now = performance.now();
  const m = TITLE_COUNT.exec(t);
  if (m) {
    titleTotal = Number(m[1]);
    titleSeenAt = now;
  } else if (BRAND.test(t) || now - titleSeenAt > 4000) {
    // No count: nothing unread. Blinks never last 4 s.
    titleTotal = 0;
    titleSeenAt = now;
  }
  return titleTotal;
}

// 'badged' while Facebook shows unread chats in its tab icon, 'plain' when
// not, null when this page doesn't use those icons.
function faviconState() {
  const link = document.querySelector('link[rel*="icon"][href*=".ico"]');
  if (!link) return null;
  const { badgedIcon, defaultIcon } = link.dataset;
  if (!badgedIcon || !defaultIcon) return null;
  const href = link.href;
  const same = (a) => {
    try {
      return new URL(a, location.href).href === href;
    } catch {
      return false;
    }
  };
  if (same(badgedIcon)) return 'badged';
  if (same(defaultIcon)) return 'plain';
  return null;
}

function messengerUnread() {
  const total = readTitleTotal();
  const banner = document.querySelector('div[role="banner"]');
  if (!banner) return null;
  const buttons = topBarButtons(banner);
  if (!buttons.length) return null; // bar not drawn yet
  const messenger = buttons.find((el) => MESSENGER_BUTTON.test(el.getAttribute('aria-label')));
  if (messenger) {
    const label = /\d+/.exec(messenger.getAttribute('aria-label'));
    return label ? Number(label[0]) : badgeCount(messenger);
  }
  const icon = faviconState();
  if (icon === 'plain') return 0;
  if (total === null) return icon === 'badged' ? 1 : null;
  // The bar's buttons (Menu, Notifications, Account); the links in the
  // middle (Home, Marketplace...) have counts the title doesn't include.
  let notifications = 0;
  for (const el of buttons) {
    if (el.matches('[role="button"]')) notifications = Math.max(notifications, badgeCount(el));
  }
  const chats = Math.max(0, total - notifications);
  return icon === 'badged' ? Math.max(1, chats) : chats;
}

// The bar is drawn a moment after the page; only give up on it (and let the
// app use the title as it is) when it has been missing for a while. A rise is
// only sent once it holds for two reads, so a title that changes a moment
// before the badges never counts a Facebook notification as a chat.
const MISSING_GRACE = 8000;
const RISE_HOLD = 600;
let lastUnread;
let missingSince = 0;
let rising = null;
function reportUnread() {
  let n = null;
  try {
    n = messengerUnread();
  } catch {}
  const now = performance.now();
  if (n === null) {
    missingSince ||= now;
    if (now - missingSince < MISSING_GRACE) return;
  } else {
    missingSince = 0;
  }
  if (n === lastUnread) {
    rising = null;
    return;
  }
  if (n !== null && typeof lastUnread === 'number' && n > lastUnread) {
    if (!rising || rising.n !== n) {
      rising = { n, at: now };
      setTimeout(reportUnread, RISE_HOLD + 50);
      return;
    }
    if (now - rising.at < RISE_HOLD) return;
  }
  rising = null;
  lastUnread = n;
  ipcRenderer.send('fb:unread', n);
}

// ---------------------------------------------------------------------------
// Facebook notification pop-ups. Facebook shows new notifications (comments,
// reactions, friend requests...) as cards in the bottom-left corner of every
// page, /messages too. Such a card is a role="complementary" toast holding a
// notification row (role="listitem"), in a fixed list Facebook adds to
// <body>. Messenger's own toasts look different and are left alone.
// ---------------------------------------------------------------------------
function isFacebookNotificationToast(card) {
  if (!card.hasAttribute('aria-labelledby') || !card.querySelector('[role="listitem"]')) return false;
  if (card.closest('[role="main"], [role="banner"], [role="navigation"], [role="dialog"]')) return false;
  const item = card.closest('li');
  if (!item || item.parentElement?.tagName !== 'UL') return false;
  for (let el = item.parentElement; el && el !== document.body; el = el.parentElement) {
    if (getComputedStyle(el).position === 'fixed') return true;
  }
  return false;
}

function closeFacebookToasts() {
  for (const card of document.querySelectorAll('[role="complementary"]')) {
    if (card.hasAttribute('data-mc-closed') || !isFacebookNotificationToast(card)) continue;
    card.setAttribute('data-mc-closed', '');
    card.closest('li').style.setProperty('display', 'none', 'important');
    // Press its close button too, so it leaves Facebook's toast queue now
    // instead of holding back the next toast until it expires.
    card.firstElementChild?.querySelector('[role="button"]')?.click();
    ipcRenderer.send('fb:toast-closed');
  }
}

let toastCheckQueued = false;
function queueToastCheck() {
  if (toastCheckQueued) return;
  toastCheckQueued = true;
  // Before the next paint, so the card never shows. Hidden pages don't
  // paint; their cards are closed when they are shown again.
  requestAnimationFrame(() => {
    toastCheckQueued = false;
    try {
      closeFacebookToasts();
    } catch {}
  });
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

// Your profile picture is the round 40px image at the right end of Facebook's
// top bar ("Account Controls and Settings"). Pop-ups such as notifications are
// also drawn inside the bar's element, below it, and are full of other
// people's pictures, so only images that sit inside the bar itself count.
function findAvatar(banner) {
  if (!banner) return null;
  let best = null;
  for (const n of banner.el.querySelectorAll('svg image, img')) {
    const r = n.getBoundingClientRect();
    const inBar = r.top >= banner.rect.top - 1 && r.bottom <= banner.rect.bottom + 1;
    const avatarSized = r.width >= 24 && r.width <= 56 && Math.abs(r.width - r.height) <= 2;
    const rightSide = r.left + r.width / 2 > innerWidth * 0.6;
    if (!inBar || !avatarSized || !rightSide) continue;
    if (!best || r.right > best.rect.right) best = { el: n, rect: r };
  }
  if (!best) return null;
  const href = best.el.getAttribute('xlink:href') || best.el.getAttribute('href') || best.el.getAttribute('src');
  try {
    return href ? new URL(href, location.href).href : null;
  } catch {
    return null;
  }
}

let loadedAt = 0;
window.addEventListener('load', () => { loadedAt = performance.now(); });

let lastMetrics = '';
let lastTheme = '';
let lastAvatar;

function report() {
  if (!document.body) return;
  markWallpapers();
  keepViewersDark();
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
  // Under the Yahoo/Zalo skins the page colors are ours, not Facebook's, so
  // keep the last Facebook palette for when the Messenger skin comes back.
  const surface = covered || skin !== 'messenger' ? null : opaqueBackgroundAt(24, Math.min(y, innerHeight - 1));
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

  reportAccount();

  // Only report a picture we actually found; a missing one (page still
  // loading, bar re-rendering) must not wipe out the last good one.
  const av = findAvatar(banner);
  if (av && av !== lastAvatar) {
    lastAvatar = av;
    ipcRenderer.send('fb:avatar', av);
  }
}

// Who is logged in on this page: Facebook embeds it as JSON
// (CurrentUserInitialData: USER_ID, NAME). Used to label accounts.
let lastAccount = '';
function reportAccount() {
  if (lastAccount) return;
  for (const script of document.querySelectorAll('script[type="application/json"]')) {
    const text = script.textContent;
    const at = text.indexOf('"CurrentUserInitialData"');
    if (at < 0) continue;
    const seg = text.slice(at, at + 2000);
    const pick = (key) => {
      const m = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`).exec(seg);
      try {
        return m ? JSON.parse(`"${m[1]}"`) : null;
      } catch {
        return null;
      }
    };
    const info = { userId: pick('USER_ID'), name: pick('NAME'), shortName: pick('SHORT_NAME') };
    if (info.userId && info.userId !== '0' && info.name) {
      lastAccount = JSON.stringify(info);
      ipcRenderer.send('fb:account', info);
    }
    return;
  }
}

// The sidebar couldn't load the picture we sent; send it again next time.
ipcRenderer.on('mc:resend-avatar', () => {
  lastAvatar = undefined;
  scheduleReport();
});

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
  // Timers keep running for accounts in the background (no rAF there).
  reportUnread();
  setInterval(reportUnread, 1000);
  // Facebook changes the title whenever a count changes; read the badge then.
  let unreadTimer = null;
  new MutationObserver(() => {
    if (unreadTimer) return;
    unreadTimer = setTimeout(() => { unreadTimer = null; reportUnread(); }, 50);
  }).observe(document.head, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href'] });
  new MutationObserver(queueToastCheck).observe(document.body, { subtree: true, childList: true });
  window.addEventListener('resize', scheduleReport);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(scheduleReport, 300));
  new MutationObserver(scheduleReport).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
});
