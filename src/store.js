'use strict';
// Tiny JSON settings store kept in the app's userData folder.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  theme: 'system', // color mode: 'system' | 'light' | 'dark'
  skin: 'messenger', // 'messenger' | 'yahoo' | 'zalo'
  hideFacebookBar: true,
  notifications: true,
  closeToTray: true,
  launchAtLogin: false,
  showRail: true,
  railCollapsed: true,
  lastBanner: null,
  avatar: null,
  avatarUser: null,
  zoom: 1,
  bounds: null,
  maximized: false,
  themeHintShown: false,
};

let data = null;
let saveTimer = null;

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  if (data) return data;
  try {
    // Strip a byte-order mark in case the file was edited by hand (e.g. PowerShell).
    const raw = fs.readFileSync(file(), 'utf8').replace(/^﻿/, '');
    data = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    data = { ...DEFAULTS };
  }
  return data;
}

function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    // Write a temp file and rename it over the old one, so a force-quit in the
    // middle of saving can't leave an empty settings file behind.
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = `${file()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(load(), null, 2));
    fs.renameSync(tmp, file());
  } catch (err) {
    console.error('Could not save settings:', err);
  }
}

module.exports = {
  get(key) {
    return load()[key];
  },
  set(key, value) {
    load()[key] = value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 300);
  },
  flush,
};
