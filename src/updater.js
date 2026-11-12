'use strict';
// Updates. The app checks the GitHub releases for a newer version (each
// release carries a latest.yml next to the installer). Nothing is downloaded
// until you agree; then the installer is downloaded, checked against the
// SHA-512 in latest.yml, run silently, and the app starts again by itself.
const { app, dialog, shell } = require('electron');

const RELEASES_URL = 'https://github.com/khacthebkhn/messenger-classic/releases/latest';
const FIRST_CHECK_DELAY = 15 * 1000;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const BUSY_RETRY = 30 * 1000;

function plainText(notes) {
  if (Array.isArray(notes)) notes = notes.map((n) => n.note || '').join('\n');
  if (!notes) return '';
  const text = String(notes)
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\*\*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > 700 ? `${text.slice(0, 700).trimEnd()}…` : text;
}

/**
 * @param {object} o
 * @param {() => import('electron').BaseWindow | null} o.getWindow
 * @param {{ get: Function, set: Function }} o.store
 * @param {() => void} o.beforeQuit   lets the app quit instead of hiding to the tray
 * @param {() => boolean} o.isBusy    true while a call window is open
 * @param {(text: string) => void} o.onStatus  shown in the tray tooltip and menus
 * @param {Function} o.debug
 */
function createUpdater({ getWindow, store, beforeQuit, isBusy, onStatus, debug }) {
  let updater = null;
  let state = 'idle'; // idle | checking | downloading | ready
  let progress = 0;
  let pending = null; // update found while the window was hidden
  let timer = null;

  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
  // MC_UPDATE_URL points the app at a folder with latest.yml (for testing).
  const testFeed = process.env.MC_UPDATE_URL;
  const enabled = app.isPackaged || Boolean(testFeed);

  function load() {
    if (updater) return updater;
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.logger = { info: debug, warn: debug, error: debug, debug };
    if (testFeed) {
      updater.forceDevUpdateConfig = true;
      updater.setFeedURL({ provider: 'generic', url: testFeed });
    }
    updater.on('download-progress', (p) => {
      progress = Math.round(p.percent || 0);
      getWindow()?.setProgressBar(Math.max(0.01, (p.percent || 0) / 100));
      onStatus(statusText());
    });
    return updater;
  }

  function statusText() {
    if (state === 'checking') return 'Checking for updates…';
    if (state === 'downloading') return `Downloading update… ${progress}%`;
    if (state === 'ready') return 'Update ready, installs after your call';
    return '';
  }

  function setState(next) {
    state = next;
    if (next !== 'downloading') getWindow()?.setProgressBar(-1);
    onStatus(statusText());
  }

  async function message(opts) {
    const win = getWindow();
    const options = { title: 'Messenger Classic', noLink: true, ...opts };
    return win && win.isVisible() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
  }

  async function check({ manual = false } = {}) {
    if (!enabled) {
      if (manual) await message({ type: 'info', message: 'Updates work in the installed app only.' });
      return;
    }
    if (state !== 'idle') {
      if (manual) await message({ type: 'info', message: statusText() || 'An update is already in progress.' });
      return;
    }
    setState('checking');
    let result = null;
    try {
      result = await load().checkForUpdates();
    } catch (err) {
      setState('idle');
      debug('update check failed', err?.message || err);
      if (manual) {
        await message({
          type: 'error',
          message: "Couldn't check for updates.",
          detail: `${err?.message || err}\n\nCheck your connection and try again later.`,
        });
      }
      return;
    }
    setState('idle');
    const info = result?.updateInfo;
    const newer = info && result.isUpdateAvailable !== false && info.version !== app.getVersion();
    if (!newer) {
      if (manual) {
        await message({ type: 'info', message: "You're up to date.", detail: `Messenger Classic ${app.getVersion()} is the newest version.` });
      }
      return;
    }
    if (!manual && store.get('skippedVersion') === info.version) {
      debug('update', info.version, 'skipped by the user');
      return;
    }
    const win = getWindow();
    if (!manual && win && !win.isVisible()) {
      // Ask when the window is opened, not while it sits in the tray.
      if (!pending) win.once('show', () => { const i = pending; pending = null; if (i) offer(i, false); });
      pending = info;
      return;
    }
    await offer(info, manual);
  }

  async function offer(info, manual) {
    if (state !== 'idle') return;
    const notes = plainText(info.releaseNotes);
    const buttons = portable ? ['Open download page', 'Later'] : ['Install now', 'Later'];
    if (!manual) buttons.push('Skip this version');
    const { response } = await message({
      type: 'info',
      message: `Messenger Classic ${info.version} is available.`,
      detail: [
        `You have ${app.getVersion()}.`,
        notes,
        portable ? '' : 'The app closes, installs the update and opens again. Your logins and settings stay.',
      ].filter(Boolean).join('\n\n'),
      buttons,
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 2) {
      store.set('skippedVersion', info.version);
      return;
    }
    if (response !== 0) return;
    if (portable) {
      shell.openExternal(RELEASES_URL);
      return;
    }
    await download();
  }

  async function download() {
    progress = 0;
    setState('downloading');
    try {
      await load().downloadUpdate();
    } catch (err) {
      setState('idle');
      debug('update download failed', err?.message || err);
      await message({
        type: 'error',
        message: "Couldn't download the update.",
        detail: `${err?.message || err}\n\nYou can try again from Preferences → Check for updates.`,
      });
      return;
    }
    setState('ready');
    install();
  }

  function install() {
    if (isBusy()) {
      // Don't cut a call short; install once it ends (or when you quit).
      updater.autoInstallOnAppQuit = true;
      setTimeout(install, BUSY_RETRY);
      return;
    }
    debug('installing update');
    beforeQuit();
    // Silent install, then start the app again.
    setImmediate(() => updater.quitAndInstall(true, true));
    // Still running a while later: the installer didn't start.
    setTimeout(() => setState('idle'), 20 * 1000).unref?.();
  }

  function schedule() {
    clearTimeout(timer);
    if (!enabled || !store.get('autoCheckUpdates')) return;
    timer = setTimeout(function run() {
      check().finally(() => {
        if (store.get('autoCheckUpdates')) timer = setTimeout(run, CHECK_INTERVAL);
      });
    }, FIRST_CHECK_DELAY);
  }

  function setAutoCheck(on) {
    store.set('autoCheckUpdates', on);
    schedule();
  }

  function menuItems() {
    const busy = state !== 'idle';
    return [
      { label: busy ? statusText() : 'Check for updates…', enabled: !busy, click: () => check({ manual: true }) },
      { label: 'Check for updates automatically', type: 'checkbox', checked: store.get('autoCheckUpdates'), click: (i) => setAutoCheck(i.checked) },
      { label: `Version ${app.getVersion()}`, enabled: false },
    ];
  }

  return { check, schedule, menuItems, statusText };
}

module.exports = { createUpdater, plainText };
