'use strict';
const {
  app, BaseWindow, WebContentsView, Menu, Tray, nativeTheme, nativeImage,
  shell, ipcMain, session, dialog, desktopCapturer, screen, clipboard,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const store = require('./store');
const { SKINS, messengerShell, skinOf } = require('./skins');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
// MESSENGER_URL lets you point the app at a local mock page for testing.
const START_URL = process.env.MESSENGER_URL || 'https://www.facebook.com/messages/';
const START = new URL(START_URL);
const PARTITION = 'persist:messenger';
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
let fbView = null;
let railView = null;
let titleView = null;
let tray = null;
let quitting = false;
let loggedIn = false;
let unread = 0;
let fbPalette = null;
let avatar = null;
let activeRoute = null;
let onMessagesPage = false;
let fbMetrics = { banner: null, overlay: false };
let cssKeys = [];

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

  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(chromeUserAgent());
  setupPermissions(ses);
  await refreshLogin(ses);
  ses.cookies.on('changed', (_e, cookie) => {
    if (cookie.name === 'c_user') refreshLogin(ses);
  });

  createWindow();
  createTray();
  registerIpc();
  watchCustomCss();

  nativeTheme.on('updated', () => {
    if (!fbPalette) applyPalette();
  });
}

async function refreshLogin(ses) {
  try {
    const cookies = await ses.cookies.get({ url: START.origin, name: 'c_user' });
    loggedIn = cookies.length > 0;
  } catch {
    loggedIn = false;
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
function classify(raw) {
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
  if (!loggedIn) return 'internal'; // let every login / 2FA step through
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
  return fbPalette || (nativeTheme.shouldUseDarkColors ? PALETTES.dark : PALETTES.light);
}

function currentSkin() {
  return skinOf(store.get('skin'));
}

// Colors for the title bar and sidebar under the current skin.
function shellTheme() {
  const skin = SKINS[currentSkin()];
  return skin.shell || messengerShell(palette());
}

// Yahoo and Zalo are light-only looks, so they pin the app to light mode.
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
  fbView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-fb.js'),
      partition: PARTITION,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });

  // Order matters: the title bar sits on top so it can cover Facebook's own top bar.
  win.contentView.addChildView(railView);
  win.contentView.addChildView(fbView);
  win.contentView.addChildView(titleView);
  for (const v of [railView, fbView, titleView]) v.setBackgroundColor(t.windowBg);

  railView.webContents.loadFile(SHELL_HTML, { query: { part: 'rail' } });
  titleView.webContents.loadFile(SHELL_HTML, { query: { part: 'title' } });
  setupFacebookView(fbView.webContents);
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
    fbView.webContents.focus();
  });
  win.on('close', (e) => {
    if (!quitting && store.get('closeToTray') && tray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    for (const v of [railView, fbView, titleView]) {
      if (v && !v.webContents.isDestroyed()) v.webContents.close();
    }
    win = fbView = railView = titleView = null;
    // Only reached on a real close (close-to-tray hides instead), so quit.
    quit();
  });

  fbView.webContents.loadURL(START_URL);
}

function railWidth() {
  if (!store.get('showRail')) return 0;
  return store.get('railCollapsed') ? RAIL_W.collapsed : RAIL_W.expanded;
}

// How much of Facebook's own top bar to push up under our title bar.
function hiddenBannerHeight() {
  if (!store.get('hideFacebookBar') || !onMessagesPage || fbMetrics.overlay) return 0;
  // Until the page has been measured, reuse the last height to avoid a jump
  // (only when logged in, so the login page is never cropped).
  const h = fbMetrics.banner ?? (loggedIn ? store.get('lastBanner') : 0) ?? 0;
  return Math.max(0, Math.min(140, Math.round(h)));
}

function layout() {
  if (!win || win.isDestroyed()) return;
  const { width, height } = win.getContentBounds();
  const rail = railWidth();
  const hide = hiddenBannerHeight();
  const body = Math.max(0, height - TITLE_H);
  titleView.setBounds({ x: 0, y: 0, width, height: TITLE_H });
  railView.setVisible(rail > 0);
  railView.setBounds({ x: 0, y: TITLE_H, width: rail, height: body });
  fbView.setBounds({ x: rail, y: TITLE_H - hide, width: Math.max(0, width - rail), height: body + hide });
  debug('layout', { width, height, rail, hide });
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
function setupFacebookView(wc) {
  wc.on('will-navigate', (e, url) => guardNavigation(e, url, wc));
  wc.on('will-redirect', (e, url, _inPage, isMainFrame) => {
    if (isMainFrame && classify(url) === 'home') {
      e.preventDefault();
      setImmediate(() => wc.loadURL(fbUrl('chats')));
    }
  });
  wc.on('did-navigate', (_e, url) => {
    if (classify(url) === 'home') return wc.loadURL(fbUrl('chats'));
    routeChanged(url);
  });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (!isMainFrame) return;
    const kind = classify(url);
    if (kind === 'external') {
      // Facebook routed somewhere outside Messenger without a page load.
      openExternal(url);
      if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      else wc.loadURL(fbUrl('chats'));
      return;
    }
    if (kind === 'home') return wc.loadURL(fbUrl('chats'));
    routeChanged(url);
  });

  wc.on('page-title-updated', (e, title) => {
    e.preventDefault();
    updateUnreadFromTitle(title);
  });

  wc.on('dom-ready', () => {
    injectCss(wc);
    wc.setZoomFactor(store.get('zoom'));
    sendFbSettings();
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
  setupWindowOpen(wc);
}

function guardNavigation(e, url, wc, { popup = false } = {}) {
  const kind = classify(url);
  if (kind === 'internal') return;
  if (popup && isFacebookUrl(url)) return; // call windows may hop between Facebook pages
  e.preventDefault();
  if (kind === 'home') wc.loadURL(fbUrl('chats'));
  else if (kind !== 'blocked') openExternal(url);
}

function setupWindowOpen(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    const kind = classify(url);
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
    child.setMenuBarVisibility(false);
    child.webContents.on('will-navigate', (e, url) => guardNavigation(e, url, child.webContents, { popup: true }));
    setupContextMenu(child.webContents);
    setupWindowOpen(child.webContents);
  });
}

function routeChanged(url) {
  let p = '';
  try {
    p = new URL(url).pathname;
  } catch {}
  onMessagesPage = /^\/messages(\/|$)/.test(p) && isFacebookUrl(url);
  if (p.startsWith(ROUTES.requests)) activeRoute = 'requests';
  else if (p.startsWith(ROUTES.archived)) activeRoute = 'archived';
  else if (onMessagesPage) activeRoute = 'chats';
  else activeRoute = null;
  layout();
  pushShellState();
}

function updateUnreadFromTitle(title) {
  // "(3) Messenger | Facebook" -> 3. Titles like "Anna messaged you" flash
  // between real titles, so only trust titles that carry a count or the brand.
  const m = /^\((\d+)\+?\)/.exec(title);
  let n = null;
  if (m) n = Number(m[1]);
  else if (/messenger|facebook/i.test(title)) n = 0;
  if (n === null || n === unread) return;
  if (n > unread && win && !win.isFocused()) win.flashFrame(true);
  unread = n;
  if (win) win.setTitle(n ? `(${n}) Messenger` : 'Messenger');
  updateTray();
  pushShellState();
}

function goTo(route) {
  if (!fbView) return;
  fbView.webContents.send('mc:navigate', ROUTES[route]);
  fbView.webContents.focus();
}

function setZoom(delta) {
  const z = delta === 0 ? 1 : Math.min(2, Math.max(0.6, Math.round((store.get('zoom') + delta) * 10) / 10));
  store.set('zoom', z);
  fbView?.webContents.setZoomFactor(z);
}

// ---------------------------------------------------------------------------
// CSS injection (base tweaks + the user's custom.css)
// ---------------------------------------------------------------------------
function customCssPath() {
  return path.join(app.getPath('userData'), 'custom.css');
}

async function injectCss(wc) {
  if (wc.isDestroyed()) return;
  for (const key of cssKeys) wc.removeInsertedCSS(key).catch(() => {});
  cssKeys = [];
  for (const file of [BASE_CSS, SKINS_CSS, customCssPath()]) {
    try {
      const css = fs.readFileSync(file, 'utf8');
      if (css.trim()) cssKeys.push(await wc.insertCSS(css, { cssOrigin: 'user' }));
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
  fs.watchFile(file, { interval: 1000 }, () => fbView && injectCss(fbView.webContents));
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
  if (input.type !== 'keyDown' || !fbView) return;
  const wc = fbView.webContents;
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
    [ctrl && key === '1', () => goTo('chats')],
    [ctrl && key === '2', () => goTo('requests')],
    [ctrl && key === '3', () => goTo('archived')],
    [ctrl && key === ',', () => popupSettings()],
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
    { label: 'New message', accelerator: 'CmdOrCtrl+N', click: () => goTo('compose') },
    { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => fbView?.webContents.reload() },
    { label: 'Open this page in browser', click: () => fbView && openExternal(fbView.webContents.getURL()) },
    { label: 'Edit custom CSS…', click: () => shell.openPath(customCssPath()) },
    { label: 'Developer tools', accelerator: 'F12', click: () => fbView?.webContents.toggleDevTools() },
    { type: 'separator' },
    { label: 'Log out…', click: logOut },
    { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: quit },
  ];
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
    if (!fbPalette || store.get('themeHintShown') || !win) return;
    if (fbPalette.dark === nativeTheme.shouldUseDarkColors) return;
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
  return { notifications: Boolean(store.get('notifications')), skin: currentSkin() };
}

function sendFbSettings() {
  fbView?.webContents.send('mc:settings', fbSettings());
}

async function logOut() {
  if (!win || !fbView) return;
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Log out', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Log out of Messenger?',
    detail: 'This clears your session from this app. Your chats stay on Facebook.',
  });
  if (response !== 0) return;
  const ses = fbView.webContents.session;
  await ses.clearStorageData();
  await ses.clearCache();
  loggedIn = false;
  avatar = null;
  fbPalette = null;
  updateUnreadFromTitle('Messenger');
  fbView.webContents.loadURL(START_URL);
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
  return {
    skin: currentSkin(),
    shell: shellTheme(),
    railWidth: railWidth(),
    active: activeRoute,
    unread,
    avatar,
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
  tray.setImage(trayImage(unread > 0));
  tray.setToolTip(unread ? `Messenger: ${unread} unread` : 'Messenger');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Messenger', click: showWindow },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: store.get('launchAtLogin'), click: (i) => setLaunchAtLogin(i.checked) },
    { label: 'Quit', click: quit },
  ]));
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function fromFbView(e) {
  return fbView && e.sender === fbView.webContents;
}

function registerIpc() {
  ipcMain.on('fb:get-settings', (e) => {
    e.returnValue = fbSettings();
  });
  ipcMain.on('fb:classify', (e, url) => {
    e.returnValue = classify(url);
  });
  ipcMain.on('fb:open-external', (_e, url) => openExternal(url));
  ipcMain.on('fb:notification-click', () => showWindow());
  ipcMain.on('fb:load', (e, route) => {
    if (fromFbView(e) && Object.values(ROUTES).includes(route)) e.sender.loadURL(fbUrl(route));
  });

  ipcMain.on('fb:metrics', (e, m) => {
    if (!fromFbView(e)) return;
    const next = {
      banner: typeof m.banner === 'number' ? m.banner : fbMetrics.banner,
      overlay: Boolean(m.overlay),
    };
    if (typeof m.banner === 'number' && m.banner > 0) store.set('lastBanner', m.banner);
    if (next.banner !== fbMetrics.banner || next.overlay !== fbMetrics.overlay) {
      fbMetrics = next;
      layout();
    }
  });

  ipcMain.on('fb:theme', (e, p) => {
    if (!fromFbView(e) || !p) return;
    const base = p.dark ? PALETTES.dark : PALETTES.light;
    const merged = { ...base };
    for (const k of Object.keys(base)) if (p[k] !== undefined && p[k] !== '') merged[k] = p[k];
    fbPalette = merged;
    applyPalette();
  });

  ipcMain.on('fb:avatar', (e, url) => {
    if (!fromFbView(e) || url === avatar) return;
    avatar = typeof url === 'string' && /^https:\/\//.test(url) ? url : null;
    pushShellState();
  });

  ipcMain.handle('shell:get-state', () => shellState());
  ipcMain.on('shell:navigate', (_e, route) => goTo(route));
  ipcMain.on('shell:menu', (_e, pos) => popupSettings(pos));
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
