'use strict';
const {
  app, BaseWindow, WebContentsView, Menu, Tray, nativeTheme, nativeImage,
  shell, ipcMain, session, dialog, desktopCapturer, screen, clipboard, net,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const store = require('./store');
const { SKINS, messengerShell, skinOf, skinShell, skinMode } = require('./skins');
const { createUpdater } = require('./updater');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
// MESSENGER_URL lets you point the app at a local mock page for testing.
const START_URL = process.env.MESSENGER_URL || 'https://www.facebook.com/messages/';
const START = new URL(START_URL);
const MAIN_PARTITION = 'persist:messenger'; // the first account (kept from 1.x)
const APP_ID = 'app.messengerclassic.desktop';

// Facebook routes the sidebar buttons open. If Facebook moves these, edit them here.
const ROUTES = {
  chats: '/messages/',
  requests: '/messages/requests/',
  archived: '/messages/archived/',
  compose: '/messages/new/',
};

// Paths that stay inside the app once you're logged in. Everything else on
// facebook.com (feed, profiles, groups...) opens in your normal browser.
const IN_APP_PATHS = [
  /^\/messages(\/|$)/, /^\/messenger_media/, /^\/photo/, /^\/groupcall/,
  /^\/videocall/, /^\/videochat/, /^\/rtc/,
];
const AUTH_PATHS = [
  /^\/login/, /^\/logout/, /^\/checkpoint/, /^\/two_step_verification/, /^\/two_factor/,
  /^\/recover/, /^\/auth_platform/, /^\/privacy\/consent/, /^\/cookie/, /^\/dialog/,
  /^\/device-based/, /^\/confirmemail/, /^\/security/, /^\/ajax/, /^\/r\.php/, /^\/reg/,
];

const TITLE_H = 32;
const RAIL_W = { collapsed: 72, expanded: 240 };
const debug = (...args) => process.env.MC_DEBUG && console.log('[mc]', ...args);

const ASSETS = path.join(__dirname, '..', 'assets');
const ICON = path.join(ASSETS, process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const SHELL_HTML = path.join(__dirname, 'shell', 'shell.html');
const OFFLINE_HTML = path.join(__dirname, 'shell', 'offline.html');
const BASE_CSS = path.join(__dirname, 'inject', 'messenger.css');
const SKINS_CSS = path.join(__dirname, 'inject', 'skins.css');

const PALETTES = {
  light: {
    surface: '#ffffff', text: '#050505', secondary: '#65676b', icon: '#65676b',
    hover: 'rgba(0,0,0,0.05)', active: 'rgba(0,0,0,0.08)', divider: '#e4e6eb',
    accent: '#0866ff', dark: false,
  },
  dark: {
    surface: '#242526', text: '#e4e6eb', secondary: '#b0b3b8', icon: '#b0b3b8',
    hover: 'rgba(255,255,255,0.08)', active: 'rgba(255,255,255,0.12)', divider: '#3e4042',
    accent: '#2d88ff', dark: true,
  },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let win = null;
let railView = null;
let titleView = null;
let tray = null;
let quitting = false;
let updater = null;
const popupWindows = new Set(); // call windows; an update waits until they close

// Accounts. Each one has its own saved session (partition) and its own
// Facebook view. The views of other accounts keep running hidden, so
// switching is instant and their notifications still arrive.
const accounts = new Map(); // id -> account
let activeId = null;
const childOwner = new WeakMap(); // call/pop-up window webContents -> account
const avatarIcons = new Map(); // avatar url -> 16px round nativeImage for menus

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.setAppUserModelId(APP_ID);
  app.userAgentFallback = chromeUserAgent();
  app.whenReady().then(init);
}

function chromeUserAgent() {
  // Facebook blocks "unknown" browsers, so present a plain Chrome user agent.
  const major = process.versions.chrome.split('.')[0];
  const platform = {
    win32: 'Windows NT 10.0; Win64; x64',
    darwin: 'Macintosh; Intel Mac OS X 10_15_7',
  }[process.platform] || 'X11; Linux x86_64';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

async function init() {
  nativeTheme.themeSource = effectiveThemeSource();
  Menu.setApplicationMenu(null);

  loadAccounts();
  removeUnusedPartitions();
  await Promise.all([...accounts.values()].map(prepareSession));

  createWindow();
  createTray();
  registerIpc();
  updater = createUpdater({
    getWindow: () => win,
    store,
    beforeQuit: () => { quitting = true; store.flush(); },
    isBusy: () => popupWindows.size > 0,
    onStatus: updateTray,
    debug,
  });
  updater.schedule();
  watchCustomCss();
  for (const a of accounts.values()) cacheAvatarIcon(a.avatar);

  nativeTheme.on('updated', () => {
    // Viber and Telegram follow the color mode, in the page and around it.
    if (SKINS[currentSkin()].shells) {
      sendFbSettings();
      applyPalette();
    } else if (!active()?.palette) applyPalette();
  });
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
function makeAccount(saved) {
  return {
    id: saved.id,
    partition: saved.partition,
    userId: saved.userId || null,
    name: saved.name || null,
    avatar: saved.avatar || null,
    adding: false, // true until a freshly added account has logged in
    view: null,
    loggedIn: false,
    unread: 0,
    badgeUnread: undefined, // unread chats sent by the page; null: it couldn't tell
    lastTitle: '',
    palette: null,
    metrics: { banner: null, overlay: false },
    onMessagesPage: false,
    activeRoute: null,
    cssKeys: [],
    avatarRetryAt: 0,
    pendingInfo: null, // name sent by the page before the login cookie was read
  };
}

function loadAccounts() {
  let saved = store.get('accounts');
  if (!Array.isArray(saved) || !saved.length) {
    // First run of 1.2: keep the existing login as the first account.
    saved = [{
      id: 'main',
      partition: MAIN_PARTITION,
      userId: store.get('avatarUser') || null,
      avatar: store.get('avatar') || null,
    }];
  }
  for (const s of saved) if (s && s.id && s.partition) accounts.set(s.id, makeAccount(s));
  activeId = accounts.has(store.get('activeAccount')) ? store.get('activeAccount') : accounts.keys().next().value;
  saveAccounts();
}

// A removed account's session folder can't be deleted while its session is
// open, so clear out leftovers on the next start, before any session loads.
function removeUnusedPartitions() {
  const dir = path.join(app.getPath('userData'), 'Partitions');
  const used = new Set([...accounts.values()].map((a) => a.partition.replace(/^persist:/, '')));
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!/^acct-[a-z0-9]+$/.test(name) || used.has(name)) continue;
    try {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    } catch {}
  }
}

function saveAccounts() {
  store.set('accounts', [...accounts.values()].map((a) => ({
    id: a.id, partition: a.partition, userId: a.userId, name: a.name, avatar: a.avatar,
  })));
  store.set('activeAccount', activeId);
}

const active = () => accounts.get(activeId);
const activeView = () => active()?.view || null;
const totalUnread = () => [...accounts.values()].reduce((n, a) => n + a.unread, 0);

function accountLabel(a) {
  if (a.name) return a.name;
  if (a.loggedIn || a.userId) return `Account ${[...accounts.keys()].indexOf(a.id) + 1}`;
  return 'New account (not signed in)';
}

function accountFor(wc) {
  for (const a of accounts.values()) if (a.view && a.view.webContents === wc) return a;
  return null;
}

async function prepareSession(a) {
  const ses = session.fromPartition(a.partition);
  if (!ses.__mcReady) {
    ses.__mcReady = true;
    ses.setUserAgent(chromeUserAgent());
    setupPermissions(ses);
    ses.cookies.on('changed', (_e, cookie) => {
      if (cookie.name === 'c_user') refreshLogin(a);
    });
  }
  await refreshLogin(a);
}

async function refreshLogin(a) {
  let id = null;
  try {
    const cookies = await session.fromPartition(a.partition).cookies.get({ url: START.origin, name: 'c_user' });
    id = cookies.length ? cookies[0].value : null;
  } catch {}
  if (!accounts.has(a.id)) return; // removed meanwhile
  a.loggedIn = Boolean(id);
  if (id && a.userId && id !== a.userId) {
    // A different person logged in on this slot: drop the old name/picture.
    a.name = null;
    a.avatar = null;
  }
  if (id) a.userId = id;
  if (id && a.pendingInfo && String(a.pendingInfo.userId) === id) applyAccountInfo(a, a.pendingInfo);
  a.pendingInfo = null;
  if (id && a.adding) {
    a.adding = false;
    const twin = [...accounts.values()].find((o) => o !== a && o.userId === id);
    if (twin) return duplicateAccount(a, twin);
  }
  saveAccounts();
  if (a.id === activeId) pushShellState();
}

async function duplicateAccount(a, twin) {
  await dialog.showMessageBox(win, {
    type: 'info',
    message: `${accountLabel(twin)} is already added.`,
    detail: 'Switching to that account instead.',
  });
  await removeAccount(a, { confirm: false });
  switchAccount(twin.id);
}

function ensureView(a) {
  if (a.view || !win) return a.view;
  const t = shellTheme();
  a.view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-fb.js'),
      partition: a.partition,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });
  a.view.setBackgroundColor(t.windowBg);
  a.view.setVisible(a.id === activeId);
  win.contentView.addChildView(a.view);
  win.contentView.addChildView(titleView); // keep the title bar on top
  setupFacebookView(a);
  layout();
  a.view.webContents.loadURL(START_URL);
  return a.view;
}

function destroyView(a) {
  if (!a.view) return;
  try {
    win?.contentView.removeChildView(a.view);
  } catch {}
  if (!a.view.webContents.isDestroyed()) a.view.webContents.close();
  a.view = null;
  a.cssKeys = [];
  a.metrics = { banner: null, overlay: false };
  a.unread = 0; // no longer known once its page is closed
  a.badgeUnread = undefined;
  a.lastTitle = '';
}

function switchAccount(id) {
  if (!accounts.has(id) || !win) return;
  const prev = active();
  activeId = id;
  const next = active();
  ensureView(next);
  for (const a of accounts.values()) a.view?.setVisible(a.id === activeId);
  if (prev && prev !== next && !store.get('keepAccountsRunning')) destroyView(prev);
  saveAccounts();
  layout();
  applyPalette();
  updateWindowTitle();
  updateTray();
  next.view?.webContents.focus();
}

function addAccount() {
  const id = `acct-${Date.now().toString(36)}`;
  const a = makeAccount({ id, partition: `persist:${id}` });
  a.adding = true;
  accounts.set(id, a);
  prepareSession(a);
  switchAccount(id);
}

async function removeAccount(a, { confirm = true } = {}) {
  if (!a || !win) return;
  if (confirm) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Log out', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: accounts.size > 1 ? `Log out of ${accountLabel(a)} and remove it from the app?` : 'Log out of Messenger?',
      detail: 'This clears that login from this app. Your chats stay on Facebook.',
    });
    if (response !== 0) return;
  }
  const ses = session.fromPartition(a.partition);
  if (accounts.size > 1) {
    destroyView(a);
    accounts.delete(a.id);
    if (activeId === a.id) switchAccount(accounts.keys().next().value);
  } else {
    // The only account: log out and show the login page again.
    Object.assign(a, { loggedIn: false, userId: null, name: null, avatar: null, unread: 0, palette: null });
  }
  await ses.clearStorageData();
  await ses.clearCache();
  saveAccounts();
  if (accounts.has(a.id)) a.view?.webContents.loadURL(START_URL);
  applyPalette();
  updateWindowTitle();
  updateTray();
}

function applyAccountInfo(a, info) {
  const name = typeof info.name === 'string' ? info.name.trim().slice(0, 80) : '';
  if (!name || name === a.name) return;
  a.name = name;
  saveAccounts();
  updateTray();
  if (a.id === activeId) pushShellState();
}

function cycleAccount(step) {
  const ids = [...accounts.keys()];
  if (ids.length < 2) return;
  const i = ids.indexOf(activeId);
  switchAccount(ids[(i + step + ids.length) % ids.length]);
}

// Round 16px avatar for the account menu (32px bitmap for sharp HiDPI).
async function cacheAvatarIcon(url) {
  if (!url || avatarIcons.has(url)) return;
  avatarIcons.set(url, null);
  try {
    const res = await net.fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer())).resize({ width: 32, height: 32 });
    const bmp = img.toBitmap();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const dx = x - 15.5;
        const dy = y - 15.5;
        if (dx * dx + dy * dy > 16 * 16) bmp.fill(0, (y * 32 + x) * 4, (y * 32 + x) * 4 + 4);
      }
    }
    avatarIcons.set(url, nativeImage.createFromBitmap(bmp, { width: 32, height: 32, scaleFactor: 2 }));
  } catch {
    avatarIcons.delete(url);
  }
}

// Real profile pictures come from Facebook's photo CDN. Static rsrc.php
// assets are generic placeholders, so they never replace a real picture.
function isProfilePicture(url) {
  try {
    const u = new URL(url);
    if (process.env.MESSENGER_URL && u.host === START.host) return true; // local mock
    return u.protocol === 'https:' && /(^|\.)fbcdn\.net$/.test(u.hostname) && !u.hostname.startsWith('static.');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// URL policy
// ---------------------------------------------------------------------------
function isFacebookHost(host) {
  return host === START.hostname || /(^|\.)facebook\.com$/.test(host) || /(^|\.)messenger\.com$/.test(host);
}

function isFacebookUrl(raw) {
  try {
    return isFacebookHost(new URL(raw).hostname);
  } catch {
    return false;
  }
}

// internal  -> load inside the app
// home      -> facebook.com home feed; send the user to their chats instead
// outbound  -> l.facebook.com link wrapper; open the real target in the browser
// external  -> open in the default browser
function classify(raw, a = active()) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return 'external';
  }
  if (['about:', 'blob:', 'data:'].includes(u.protocol)) return 'internal';
  if (u.protocol === 'file:') return u.pathname.endsWith('/offline.html') ? 'internal' : 'blocked';
  if (!['http:', 'https:'].includes(u.protocol)) return 'external';
  if (u.hostname === 'l.facebook.com' || u.hostname === 'lm.facebook.com') return 'outbound';
  if (!isFacebookHost(u.hostname)) return 'external';
  if (/(^|\.)messenger\.com$/.test(u.hostname)) return 'internal';

  const p = u.pathname;
  if (!a || !a.loggedIn) return 'internal'; // let every login / 2FA step through
  if (p === '/' || p === '/home.php') return 'home';
  if (IN_APP_PATHS.some((r) => r.test(p)) || AUTH_PATHS.some((r) => r.test(p))) return 'internal';
  return 'external';
}

function unwrapOutbound(raw) {
  try {
    const u = new URL(raw);
    if (u.hostname === 'l.facebook.com' || u.hostname === 'lm.facebook.com') {
      return u.searchParams.get('u') || raw;
    }
  } catch {}
  return raw;
}

function openExternal(raw) {
  const target = unwrapOutbound(raw);
  try {
    const { protocol } = new URL(target);
    if (['http:', 'https:', 'mailto:'].includes(protocol)) {
      debug('open-external', target);
      shell.openExternal(target).catch(() => {});
    }
  } catch {}
}

function fbUrl(route) {
  return new URL(ROUTES[route] || route, START.origin).href;
}

// ---------------------------------------------------------------------------
// Window and views
// ---------------------------------------------------------------------------
function palette() {
  return active()?.palette || (nativeTheme.shouldUseDarkColors ? PALETTES.dark : PALETTES.light);
}

function currentSkin() {
  return skinOf(store.get('skin'));
}

// Colors for the title bar and sidebar under the current skin.
function shellTheme() {
  return skinShell(currentSkin(), nativeTheme.shouldUseDarkColors) || messengerShell(palette());
}

// Yahoo and Zalo are light-only looks, so they pin the app to light mode.
// Viber and Telegram have both and follow the Color mode setting.
function effectiveThemeSource() {
  return SKINS[currentSkin()].lightOnly ? 'light' : store.get('theme');
}

function createWindow() {
  const t = shellTheme();
  const bounds = validBounds(store.get('bounds')) || { width: 1200, height: 800 };

  win = new BaseWindow({
    ...bounds,
    minWidth: 480,
    minHeight: 420,
    title: 'Messenger',
    icon: ICON,
    show: false,
    backgroundColor: t.windowBg,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: t.overlay, symbolColor: t.overlaySymbol, height: TITLE_H },
  });

  const shellPrefs = {
    preload: path.join(__dirname, 'preload-shell.js'),
    contextIsolation: true,
    sandbox: true,
  };
  railView = new WebContentsView({ webPreferences: shellPrefs });
  titleView = new WebContentsView({ webPreferences: shellPrefs });

  // Order matters: the title bar sits on top so it can cover Facebook's own
  // top bar; account views are slotted in between (see ensureView).
  win.contentView.addChildView(railView);
  win.contentView.addChildView(titleView);
  for (const v of [railView, titleView]) v.setBackgroundColor(t.windowBg);

  railView.webContents.loadFile(SHELL_HTML, { query: { part: 'rail' } });
  titleView.webContents.loadFile(SHELL_HTML, { query: { part: 'title' } });
  for (const v of [railView, titleView]) {
    v.webContents.on('before-input-event', handleShortcut);
    v.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    v.webContents.on('will-navigate', (e) => e.preventDefault());
  }

  layout();
  if (store.get('maximized')) win.maximize();
  if (!process.argv.includes('--hidden')) win.show();

  const saveBounds = debounce(() => {
    if (!win || win.isDestroyed() || win.isMaximized() || win.isMinimized() || win.isFullScreen()) return;
    store.set('bounds', win.getBounds());
  }, 400);
  win.on('resize', () => { layout(); saveBounds(); });
  win.on('move', saveBounds);
  win.on('maximize', () => { store.set('maximized', true); layout(); });
  win.on('unmaximize', () => { store.set('maximized', false); layout(); });
  win.on('restore', layout);
  win.on('focus', () => {
    win.flashFrame(false);
    activeView()?.webContents.focus();
  });
  win.on('close', (e) => {
    if (!quitting && store.get('closeToTray') && tray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    for (const a of accounts.values()) destroyView(a);
    for (const v of [railView, titleView]) {
      if (v && !v.webContents.isDestroyed()) v.webContents.close();
    }
    win = railView = titleView = null;
    // Only reached on a real close (close-to-tray hides instead), so quit.
    quit();
  });

  // Load every account so all of them get notifications (or only the active
  // one when "Keep other accounts running" is off).
  for (const a of accounts.values()) {
    if (a.id === activeId || store.get('keepAccountsRunning')) ensureView(a);
  }
}

function railWidth() {
  if (!store.get('showRail')) return 0;
  return store.get('railCollapsed') ? RAIL_W.collapsed : RAIL_W.expanded;
}

// How much of Facebook's own top bar to push up under our title bar.
function hiddenBannerHeight(a) {
  if (!a || !store.get('hideFacebookBar') || !a.onMessagesPage || a.metrics.overlay) return 0;
  // Until the page has been measured, reuse the last height to avoid a jump
  // (only when logged in, so the login page is never cropped).
  const h = a.metrics.banner ?? (a.loggedIn ? store.get('lastBanner') : 0) ?? 0;
  return Math.max(0, Math.min(140, Math.round(h)));
}

function layout() {
  if (!win || win.isDestroyed()) return;
  const { width, height } = win.getContentBounds();
  const rail = railWidth();
  const body = Math.max(0, height - TITLE_H);
  titleView.setBounds({ x: 0, y: 0, width, height: TITLE_H });
  railView.setVisible(rail > 0);
  railView.setBounds({ x: 0, y: TITLE_H, width: rail, height: body });
  // Hidden accounts get the same size so they're ready to show instantly.
  for (const a of accounts.values()) {
    if (!a.view) continue;
    const hide = hiddenBannerHeight(a);
    a.view.setBounds({ x: rail, y: TITLE_H - hide, width: Math.max(0, width - rail), height: body + hide });
  }
  debug('layout', { width, height, rail, hide: hiddenBannerHeight(active()), account: activeId });
}

function validBounds(b) {
  if (!b || !b.width || !b.height) return null;
  const visible = screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width - 50 && b.x + b.width > a.x + 50 && b.y >= a.y - 10 && b.y < a.y + a.height - 50);
  return visible ? b : { width: b.width, height: b.height };
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) win.hide();
  else showWindow();
}

function quit() {
  quitting = true;
  app.quit();
}

app.on('before-quit', () => {
  quitting = true;
  store.flush();
});

app.on('window-all-closed', () => {
  if (quitting || !tray) app.quit();
});

// ---------------------------------------------------------------------------
// Facebook view
// ---------------------------------------------------------------------------
function setupFacebookView(a) {
  const wc = a.view.webContents;
  wc.on('will-navigate', (e, url) => guardNavigation(e, url, wc, a));
  wc.on('will-redirect', (e, url, _inPage, isMainFrame) => {
    if (isMainFrame && classify(url, a) === 'home') {
      e.preventDefault();
      setImmediate(() => wc.loadURL(fbUrl('chats')));
    }
  });
  wc.on('did-navigate', (_e, url) => {
    if (classify(url, a) === 'home') return wc.loadURL(fbUrl('chats'));
    routeChanged(a, url);
  });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (!isMainFrame) return;
    const kind = classify(url, a);
    if (kind === 'external') {
      // Facebook routed somewhere outside Messenger without a page load.
      openExternal(url);
      if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      else wc.loadURL(fbUrl('chats'));
      return;
    }
    if (kind === 'home') return wc.loadURL(fbUrl('chats'));
    routeChanged(a, url);
  });

  wc.on('page-title-updated', (e, title) => {
    e.preventDefault();
    updateUnreadFromTitle(a, title);
  });

  wc.on('dom-ready', () => {
    injectCss(a);
    wc.setZoomFactor(store.get('zoom'));
    wc.send('mc:settings', fbSettings());
  });

  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    // -3 = aborted (normal when Facebook redirects); ignore those.
    if (!isMainFrame || code === -3 || url.startsWith('file:')) return;
    wc.loadFile(OFFLINE_HTML, { query: { url: START_URL, reason: desc } });
  });

  wc.on('render-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit') setTimeout(() => wc.reload(), 1000);
  });

  wc.on('before-input-event', handleShortcut);
  setupContextMenu(wc);
  setupWindowOpen(wc, a);
}

function guardNavigation(e, url, wc, a, { popup = false } = {}) {
  const kind = classify(url, a);
  if (kind === 'internal') return;
  if (popup && isFacebookUrl(url)) return; // call windows may hop between Facebook pages
  e.preventDefault();
  if (kind === 'home') wc.loadURL(fbUrl('chats'));
  else if (kind !== 'blocked') openExternal(url);
}

function setupWindowOpen(wc, a) {
  wc.setWindowOpenHandler(({ url }) => {
    const kind = classify(url, a);
    if (url === '' || url === 'about:blank' || (kind === 'internal' && isFacebookUrl(url))) {
      // Calls and other Facebook pop-ups open as their own app window.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1100,
          height: 720,
          icon: ICON,
          autoHideMenuBar: true,
          backgroundColor: '#000000',
        },
      };
    }
    if (kind !== 'blocked') openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => {
    childOwner.set(child.webContents, a);
    popupWindows.add(child);
    child.on('closed', () => popupWindows.delete(child));
    child.setMenuBarVisibility(false);
    child.webContents.on('will-navigate', (e, url) => guardNavigation(e, url, child.webContents, a, { popup: true }));
    setupContextMenu(child.webContents);
    setupWindowOpen(child.webContents, a);
  });
}

function routeChanged(a, url) {
  let p = '';
  try {
    p = new URL(url).pathname;
  } catch {}
  a.onMessagesPage = /^\/messages(\/|$)/.test(p) && isFacebookUrl(url);
  if (p.startsWith(ROUTES.requests)) a.activeRoute = 'requests';
  else if (p.startsWith(ROUTES.archived)) a.activeRoute = 'archived';
  else if (a.onMessagesPage) a.activeRoute = 'chats';
  else a.activeRoute = null;
  layout();
  if (a.id === activeId) pushShellState();
}

// Facebook's title count ("(3) Messenger | Facebook") adds Facebook
// notifications to the unread chats, so the page works out the chats alone
// and sends it (fb:unread, see preload-fb.js). The title is only used when
// the page can't (badgeUnread === null).
function updateUnreadFromTitle(a, title) {
  a.lastTitle = title;
  if (a.badgeUnread !== null) return;
  // "(3) Messenger | Facebook" -> 3. Titles like "Anna messaged you" flash
  // between real titles, so only trust titles that carry a count or the brand.
  const m = /^\((\d+)\+?\)/.exec(title);
  let n = null;
  if (m) n = Number(m[1]);
  else if (/messenger|facebook/i.test(title)) n = 0;
  if (n !== null) setUnread(a, n);
}

function setUnread(a, n) {
  if (n === a.unread) return;
  if (n > a.unread && win && (!win.isFocused() || a.id !== activeId)) win.flashFrame(true);
  a.unread = n;
  updateWindowTitle();
  updateTray();
  pushShellState();
}

function updateWindowTitle() {
  const n = totalUnread();
  win?.setTitle(n ? `(${n}) Messenger` : 'Messenger');
}

function goTo(route) {
  const v = activeView();
  if (!v) return;
  v.webContents.send('mc:navigate', ROUTES[route]);
  v.webContents.focus();
}

function setZoom(delta) {
  const z = delta === 0 ? 1 : Math.min(2, Math.max(0.6, Math.round((store.get('zoom') + delta) * 10) / 10));
  store.set('zoom', z);
  for (const a of accounts.values()) a.view?.webContents.setZoomFactor(z);
}

// ---------------------------------------------------------------------------
// CSS injection (base tweaks + the user's custom.css)
// ---------------------------------------------------------------------------
function customCssPath() {
  return path.join(app.getPath('userData'), 'custom.css');
}

async function injectCss(a) {
  const wc = a.view?.webContents;
  if (!wc || wc.isDestroyed()) return;
  for (const key of a.cssKeys) wc.removeInsertedCSS(key).catch(() => {});
  a.cssKeys = [];
  for (const file of [BASE_CSS, SKINS_CSS, customCssPath()]) {
    try {
      const css = fs.readFileSync(file, 'utf8');
      if (css.trim()) a.cssKeys.push(await wc.insertCSS(css, { cssOrigin: 'user' }));
    } catch {}
  }
}

function watchCustomCss() {
  const file = customCssPath();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, [
      '/* Custom CSS for Messenger Classic.',
      '   Saved changes apply right away. Example:',
      '   [role="main"] { font-size: 15px; } */',
      '',
    ].join('\n'));
  }
  fs.watchFile(file, { interval: 1000 }, () => {
    for (const a of accounts.values()) injectCss(a);
  });
}

// ---------------------------------------------------------------------------
// Permissions, screen sharing
// ---------------------------------------------------------------------------
const ALLOWED_PERMISSIONS = new Set([
  'media', 'mediaKeySystem', 'fullscreen', 'clipboard-sanitized-write', 'clipboard-read',
  'display-capture', 'speaker-selection', 'pointerLock',
]);

function setupPermissions(ses) {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (!isFacebookUrl(details.requestingUrl || wc.getURL())) return callback(false);
    if (permission === 'notifications') return callback(Boolean(store.get('notifications')));
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => {
    if (!isFacebookUrl(origin)) return false;
    if (permission === 'notifications') return Boolean(store.get('notifications'));
    return ALLOWED_PERMISSIONS.has(permission);
  });

  // Screen sharing in calls: let the user pick a screen or window.
  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      callback(value);
    };
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const menu = Menu.buildFromTemplate([
        { label: 'Share…', enabled: false },
        ...sources.map((s) => ({ label: s.name.slice(0, 60), click: () => finish({ video: s }) })),
        { type: 'separator' },
        { label: 'Cancel', click: () => finish({}) },
      ]);
      menu.popup({ callback: () => setTimeout(() => finish({}), 100) });
    } catch {
      finish({});
    }
  });

  ses.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({
      defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
    });
  });
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------
function setupContextMenu(wc) {
  wc.on('context-menu', (_e, p) => {
    const t = [];
    const sep = { type: 'separator' };
    if (p.misspelledWord) {
      for (const s of p.dictionarySuggestions.slice(0, 6)) {
        t.push({ label: s, click: () => wc.replaceMisspelling(s) });
      }
      if (!p.dictionarySuggestions.length) t.push({ label: 'No suggestions', enabled: false });
      t.push({ label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, sep);
    }
    if (p.linkURL) {
      const link = unwrapOutbound(p.linkURL);
      t.push(
        { label: 'Open link in browser', click: () => openExternal(link) },
        { label: 'Copy link address', click: () => clipboard.writeText(link) },
        sep,
      );
    }
    if (p.mediaType === 'image' && p.srcURL) {
      t.push(
        { label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) },
        { label: 'Save image as…', click: () => wc.downloadURL(p.srcURL) },
        sep,
      );
    }
    if (p.isEditable) {
      t.push(
        { label: 'Undo', enabled: p.editFlags.canUndo, click: () => wc.undo() },
        { label: 'Redo', enabled: p.editFlags.canRedo, click: () => wc.redo() },
        sep,
        { label: 'Cut', enabled: p.editFlags.canCut, click: () => wc.cut() },
        { label: 'Copy', enabled: p.editFlags.canCopy, click: () => wc.copy() },
        { label: 'Paste', enabled: p.editFlags.canPaste, click: () => wc.paste() },
        { label: 'Select all', click: () => wc.selectAll() },
      );
    } else if (p.selectionText && p.selectionText.trim()) {
      t.push({ label: 'Copy', click: () => wc.copy() });
    }
    while (t.length && t[t.length - 1].type === 'separator') t.pop();
    if (t.length) Menu.buildFromTemplate(t).popup();
  });
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
function handleShortcut(e, input) {
  const v = activeView();
  if (input.type !== 'keyDown' || !v) return;
  const wc = v.webContents;
  const ctrl = input.control || input.meta;
  const key = input.key.toLowerCase();
  const actions = [
    [ctrl && input.shift && key === 'b', toggleFacebookBar],
    [ctrl && input.shift && key === 'r', () => wc.reloadIgnoringCache()],
    [(ctrl && !input.shift && key === 'r') || input.key === 'F5', () => wc.reload()],
    [input.key === 'F12' || (ctrl && input.shift && key === 'i'), () => wc.toggleDevTools()],
    [ctrl && (key === '=' || key === '+'), () => setZoom(0.1)],
    [ctrl && key === '-', () => setZoom(-0.1)],
    [ctrl && key === '0', () => setZoom(0)],
    [ctrl && !input.shift && key === 'n', () => goTo('compose')],
    [ctrl && !input.shift && key === '1', () => goTo('chats')],
    [ctrl && !input.shift && key === '2', () => goTo('requests')],
    [ctrl && !input.shift && key === '3', () => goTo('archived')],
    [ctrl && key === ',', () => popupSettings()],
    [ctrl && key === 'tab', () => cycleAccount(input.shift ? -1 : 1)],
    [ctrl && input.shift && /^digit[1-9]$/i.test(input.code || ''), () => {
      const id = [...accounts.keys()][Number(input.code.slice(-1)) - 1];
      if (id) switchAccount(id);
    }],
    [ctrl && key === 'q', quit],
    [ctrl && key === 'w', () => win?.close()],
    [input.alt && input.key === 'ArrowLeft', () => wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack()],
  ];
  const hit = actions.find(([match]) => match);
  if (hit) {
    e.preventDefault();
    hit[1]();
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function settingsTemplate() {
  const lightOnly = SKINS[currentSkin()].lightOnly;
  const modeItem = (value, label) => ({
    label, type: 'radio', enabled: !lightOnly, checked: store.get('theme') === value, click: () => setTheme(value),
  });
  return [
    { label: 'Theme', submenu: themeMenuTemplate() },
    {
      label: 'Color mode',
      submenu: [
        modeItem('system', 'Use system setting'), modeItem('light', 'Light'), modeItem('dark', 'Dark'),
        ...(lightOnly ? [{ type: 'separator' }, { label: `${SKINS[currentSkin()].label} theme is light only`, enabled: false }] : []),
      ],
    },
    { label: 'Show sidebar', type: 'checkbox', checked: store.get('showRail'), click: (i) => { store.set('showRail', i.checked); layout(); pushShellState(); } },
    { label: 'Show Facebook bar', type: 'checkbox', checked: !store.get('hideFacebookBar'), accelerator: 'CmdOrCtrl+Shift+B', click: toggleFacebookBar },
    { type: 'separator' },
    { label: 'Desktop notifications', type: 'checkbox', checked: store.get('notifications'), click: (i) => { store.set('notifications', i.checked); sendFbSettings(); } },
    { label: 'Keep other accounts running', type: 'checkbox', checked: store.get('keepAccountsRunning'), click: (i) => setKeepAccountsRunning(i.checked) },
    { label: 'Close to tray', type: 'checkbox', checked: store.get('closeToTray'), click: (i) => store.set('closeToTray', i.checked) },
    { label: 'Start with Windows', type: 'checkbox', checked: store.get('launchAtLogin'), click: (i) => setLaunchAtLogin(i.checked) },
    {
      label: 'Zoom',
      submenu: [
        { label: 'Zoom in', accelerator: 'CmdOrCtrl+=', click: () => setZoom(0.1) },
        { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: () => setZoom(-0.1) },
        { label: 'Actual size', accelerator: 'CmdOrCtrl+0', click: () => setZoom(0) },
      ],
    },
    { type: 'separator' },
    ...(updater ? updater.menuItems() : []),
    { type: 'separator' },
    { label: 'New message', accelerator: 'CmdOrCtrl+N', click: () => goTo('compose') },
    { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => activeView()?.webContents.reload() },
    { label: 'Open this page in browser', click: () => activeView() && openExternal(activeView().webContents.getURL()) },
    { label: 'Edit custom CSS…', click: () => shell.openPath(customCssPath()) },
    { label: 'Developer tools', accelerator: 'F12', click: () => activeView()?.webContents.toggleDevTools() },
    { type: 'separator' },
    { label: `Log out of ${accountLabel(active())}…`, click: () => removeAccount(active()) },
    { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: quit },
  ];
}

// The menu behind your profile picture: accounts first, then preferences.
function accountMenuTemplate() {
  const list = [...accounts.values()].map((a, i) => ({
    label: accountLabel(a) + (a.unread ? `   (${a.unread})` : ''),
    type: 'radio',
    checked: a.id === activeId,
    icon: avatarIcons.get(a.avatar) || undefined,
    accelerator: i < 9 ? `CmdOrCtrl+Shift+${i + 1}` : undefined,
    click: () => switchAccount(a.id),
  }));
  return [
    ...list,
    { label: 'Add account…', click: addAccount },
    { type: 'separator' },
    { label: 'Preferences', submenu: settingsTemplate() },
    { type: 'separator' },
    { label: `Log out of ${accountLabel(active())}…`, click: () => removeAccount(active()) },
    { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: quit },
  ];
}

function popupAccountMenu(pos) {
  if (!win) return;
  const opts = { window: win };
  if (pos) Object.assign(opts, { x: Math.round(pos.x), y: Math.round(TITLE_H + pos.y) });
  Menu.buildFromTemplate(accountMenuTemplate()).popup(opts);
}

function setKeepAccountsRunning(on) {
  store.set('keepAccountsRunning', on);
  for (const a of accounts.values()) {
    if (on) ensureView(a);
    else if (a.id !== activeId) destroyView(a);
  }
}

function themeMenuTemplate() {
  return Object.entries(SKINS).map(([key, skin]) => ({
    label: skin.label, type: 'radio', checked: currentSkin() === key, click: () => setSkin(key),
  }));
}

function popupThemeMenu(pos) {
  if (!win) return;
  const opts = { window: win };
  if (pos) Object.assign(opts, { x: Math.round(pos.x), y: Math.round(TITLE_H + pos.y) });
  Menu.buildFromTemplate(themeMenuTemplate()).popup(opts);
}

function setSkin(value) {
  const skin = skinOf(value);
  store.set('skin', skin);
  nativeTheme.themeSource = effectiveThemeSource();
  sendFbSettings();
  applyPalette();
}

function popupSettings(pos) {
  if (!win) return;
  const menu = Menu.buildFromTemplate(settingsTemplate());
  const opts = { window: win };
  if (pos) Object.assign(opts, { x: Math.round(pos.x), y: Math.round(TITLE_H + pos.y) });
  menu.popup(opts);
}

function toggleFacebookBar() {
  store.set('hideFacebookBar', !store.get('hideFacebookBar'));
  layout();
}

function setTheme(value) {
  store.set('theme', value);
  nativeTheme.themeSource = effectiveThemeSource();
  if (currentSkin() !== 'messenger') return;
  // Facebook decides its own colors. If its Dark mode isn't set to
  // "Automatic", it won't follow us; explain once how to fix that.
  setTimeout(() => {
    const p = active()?.palette;
    if (!p || store.get('themeHintShown') || !win) return;
    if (p.dark === nativeTheme.shouldUseDarkColors) return;
    store.set('themeHintShown', true);
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Facebook theme',
      message: "Facebook is using its own dark mode setting.",
      detail: 'To let the app switch themes, set it once to Automatic: show the Facebook bar (Ctrl+Shift+B), open your profile picture menu, then Display & accessibility → Dark mode → Automatic.',
      buttons: ['Show Facebook bar', 'OK'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0 && store.get('hideFacebookBar')) toggleFacebookBar();
    });
  }, 2500);
}

function setLaunchAtLogin(enabled) {
  store.set('launchAtLogin', enabled);
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: exe,
    args: app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'],
  });
  updateTray();
}

function fbSettings() {
  return {
    notifications: Boolean(store.get('notifications')),
    skin: currentSkin(),
    mode: skinMode(currentSkin(), nativeTheme.shouldUseDarkColors),
  };
}

function sendFbSettings() {
  for (const a of accounts.values()) a.view?.webContents.send('mc:settings', fbSettings());
}

// ---------------------------------------------------------------------------
// Theme coming from the Facebook page
// ---------------------------------------------------------------------------
function applyPalette() {
  if (!win) return;
  const t = shellTheme();
  try {
    win.setTitleBarOverlay({ color: t.overlay, symbolColor: t.overlaySymbol, height: TITLE_H });
  } catch {}
  win.setBackgroundColor(t.windowBg);
  for (const v of [railView, titleView]) v?.setBackgroundColor(t.windowBg);
  pushShellState();
}

function shellState() {
  const a = active();
  const total = totalUnread();
  return {
    skin: currentSkin(),
    shell: shellTheme(),
    railWidth: railWidth(),
    active: a?.activeRoute || null,
    unread: a?.unread || 0, // this account (Chats badge)
    totalUnread: total, // all accounts (taskbar badge)
    otherUnread: total - (a?.unread || 0), // other accounts (dot on your picture)
    avatar: a?.avatar || null,
    accountName: a ? accountLabel(a) : '',
    accountCount: accounts.size,
    collapsed: store.get('railCollapsed'),
  };
}

function pushShellState() {
  const state = shellState();
  for (const v of [railView, titleView]) {
    if (v && !v.webContents.isDestroyed()) v.webContents.send('shell:state', state);
  }
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function trayImage(hasUnread) {
  return nativeImage.createFromPath(path.join(ASSETS, hasUnread ? 'tray-unread.png' : 'tray.png'));
}

function createTray() {
  tray = new Tray(trayImage(false));
  tray.on('click', toggleWindow);
  updateTray();
}

function updateTray() {
  if (!tray) return;
  const total = totalUnread();
  tray.setImage(trayImage(total > 0));
  const status = updater?.statusText();
  tray.setToolTip([total ? `Messenger: ${total} unread` : 'Messenger', status].filter(Boolean).join('\n'));
  const list = accounts.size > 1 ? [...accounts.values()].map((a) => ({
    label: accountLabel(a) + (a.unread ? `   (${a.unread})` : ''),
    type: 'radio',
    checked: a.id === activeId,
    click: () => { switchAccount(a.id); showWindow(); },
  })) : [];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Messenger', click: showWindow },
    ...(list.length ? [{ type: 'separator' }, ...list] : []),
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: store.get('launchAtLogin'), click: (i) => setLaunchAtLogin(i.checked) },
    updater?.menuItems()[0] || { label: 'Check for updates…', enabled: false },
    { label: 'Quit', click: quit },
  ]));
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.on('fb:get-settings', (e) => {
    e.returnValue = fbSettings();
  });
  ipcMain.on('fb:classify', (e, url) => {
    e.returnValue = classify(url, accountFor(e.sender) || childOwner.get(e.sender) || active());
  });
  ipcMain.on('fb:open-external', (_e, url) => openExternal(url));
  ipcMain.on('fb:notification-click', (e) => {
    // A notification from another account opens that account.
    const a = accountFor(e.sender);
    if (a && a.id !== activeId) switchAccount(a.id);
    showWindow();
  });
  ipcMain.on('fb:unread', (e, n) => {
    const a = accountFor(e.sender);
    if (!a) return;
    a.badgeUnread = Number.isInteger(n) && n >= 0 ? n : null;
    debug('unread', a.id, 'chats:', a.badgeUnread, 'title count:', (/^\((\d+)/.exec(a.lastTitle) || [, 0])[1]);
    if (a.badgeUnread !== null) setUnread(a, a.badgeUnread);
    else if (a.lastTitle) updateUnreadFromTitle(a, a.lastTitle);
  });
  ipcMain.on('fb:toast-closed', (e) => debug('closed a Facebook notification pop-up', accountFor(e.sender)?.id));
  ipcMain.on('fb:load', (e, route) => {
    if (accountFor(e.sender) && Object.values(ROUTES).includes(route)) e.sender.loadURL(fbUrl(route));
  });

  ipcMain.on('fb:metrics', (e, m) => {
    const a = accountFor(e.sender);
    if (!a) return;
    const next = {
      banner: typeof m.banner === 'number' ? m.banner : a.metrics.banner,
      overlay: Boolean(m.overlay),
    };
    if (typeof m.banner === 'number' && m.banner > 0) store.set('lastBanner', m.banner);
    if (next.banner !== a.metrics.banner || next.overlay !== a.metrics.overlay) {
      a.metrics = next;
      layout();
    }
  });

  ipcMain.on('fb:theme', (e, p) => {
    const a = accountFor(e.sender);
    if (!a || !p) return;
    const base = p.dark ? PALETTES.dark : PALETTES.light;
    const merged = { ...base };
    for (const k of Object.keys(base)) if (p[k] !== undefined && p[k] !== '') merged[k] = p[k];
    a.palette = merged;
    if (a.id === activeId) applyPalette();
  });

  ipcMain.on('fb:avatar', (e, url) => {
    const a = accountFor(e.sender);
    if (!a || !a.loggedIn || typeof url !== 'string' || !isProfilePicture(url)) return;
    if (url === a.avatar) return;
    a.avatar = url;
    saveAccounts();
    cacheAvatarIcon(url);
    if (a.id === activeId) pushShellState();
  });

  // Your name, from the user data Facebook puts in the page. It is only
  // trusted when it matches the login cookie of that account's session.
  ipcMain.on('fb:account', (e, info) => {
    const a = accountFor(e.sender);
    if (!a || !info) return;
    if (!a.userId || !a.loggedIn) a.pendingInfo = info;
    else if (String(info.userId) === a.userId) applyAccountInfo(a, info);
  });

  // The sidebar couldn't load the picture (offline, or Facebook's signed link
  // expired). Ask the page for its current one, at most once a minute.
  ipcMain.on('shell:avatar-failed', (_e, url) => {
    const a = active();
    if (!a || url !== a.avatar || Date.now() - a.avatarRetryAt < 60_000) return;
    a.avatarRetryAt = Date.now();
    a.view?.webContents.send('mc:resend-avatar');
  });

  ipcMain.handle('shell:get-state', () => shellState());
  ipcMain.on('shell:navigate', (_e, route) => goTo(route));
  ipcMain.on('shell:menu', (_e, pos) => popupAccountMenu(pos));
  ipcMain.on('shell:theme-menu', (_e, pos) => popupThemeMenu(pos));
  ipcMain.on('shell:toggle-rail', () => {
    store.set('railCollapsed', !store.get('railCollapsed'));
    layout();
    pushShellState();
  });
  ipcMain.on('shell:badge', (_e, { dataUrl, count }) => {
    if (!win || process.platform !== 'win32') return;
    const img = count && dataUrl ? nativeImage.createFromDataURL(dataUrl) : null;
    win.setOverlayIcon(img, count ? `${count} unread` : '');
  });
}

// ---------------------------------------------------------------------------
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
