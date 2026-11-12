'use strict';
// App themes ("skins").
// - messenger: follows Facebook's own colors, light or dark.
// - yahoo, zalo: fixed light looks.
// - viber, telegram: light and dark looks that follow the app's color mode.
// They color the title bar and sidebar here (`shell`, or `shells.light` and
// `shells.dark`), and restyle Facebook's page through src/inject/skins.css.

const SKINS = {
  messenger: { label: 'Messenger', lightOnly: false },
  yahoo: {
    label: 'Yahoo',
    lightOnly: true,
    shell: {
      titleBg: 'linear-gradient(90deg, #400090, #5f01d1)',
      titleFg: 'rgba(255,255,255,0.92)',
      overlay: '#5f01d1',
      overlaySymbol: '#ffffff',
      joinRail: false,
      railBg: 'linear-gradient(180deg, #400090, #2e0068)',
      railRing: '#3a0083',
      railFg: 'rgba(255,255,255,0.78)',
      railFgActive: '#ffd400',
      railText: '#ffffff',
      railHover: 'rgba(255,255,255,0.10)',
      railActive: 'rgba(255,255,255,0.16)',
      railBorder: 'transparent',
      badgeBg: '#ffd400',
      badgeFg: '#2e0068',
      brand: '#ffd400',
      brandDots: '#400090',
      windowBg: '#ffffff',
      dark: false,
    },
  },
  zalo: {
    label: 'Zalo',
    lightOnly: true,
    shell: {
      titleBg: '#ffffff',
      titleFg: '#7589a3',
      overlay: '#ffffff',
      overlaySymbol: '#081c36',
      joinRail: true,
      railBg: '#0068ff',
      railRing: '#0068ff',
      railFg: 'rgba(255,255,255,0.82)',
      railFgActive: '#ffffff',
      railText: '#ffffff',
      railHover: 'rgba(255,255,255,0.12)',
      railActive: 'rgba(0,0,0,0.2)',
      railBorder: 'transparent',
      badgeBg: '#ff3b30',
      badgeFg: '#ffffff',
      brand: '#0068ff',
      brandDots: '#0068ff',
      windowBg: '#ffffff',
      dark: false,
    },
  },
  viber: {
    label: 'Viber',
    lightOnly: false,
    shells: {
      light: {
        titleBg: '#7360f2',
        titleFg: 'rgba(255,255,255,0.92)',
        overlay: '#7360f2',
        overlaySymbol: '#ffffff',
        joinRail: false,
        railBg: '#f7f6fd',
        railRing: '#f7f6fd',
        railFg: '#8a88a0',
        railFgActive: '#7360f2',
        railText: '#1f1d2b',
        railHover: 'rgba(115,96,242,0.08)',
        railActive: 'rgba(115,96,242,0.14)',
        railBorder: '#ebe9f5',
        badgeBg: '#7360f2',
        badgeFg: '#ffffff',
        brand: '#ffffff',
        brandDots: '#7360f2',
        windowBg: '#ffffff',
        dark: false,
      },
      dark: {
        titleBg: '#1b1a22',
        titleFg: '#a7a4bd',
        overlay: '#1b1a22',
        overlaySymbol: '#ecebf3',
        joinRail: false,
        railBg: '#1b1a22',
        railRing: '#1b1a22',
        railFg: '#8e8ba6',
        railFgActive: '#9d8fff',
        railText: '#ecebf3',
        railHover: 'rgba(255,255,255,0.06)',
        railActive: 'rgba(157,143,255,0.16)',
        railBorder: '#2a2935',
        badgeBg: '#7360f2',
        badgeFg: '#ffffff',
        brand: '#7360f2',
        brandDots: '#ffffff',
        windowBg: '#15141b',
        dark: true,
      },
    },
  },
  telegram: {
    label: 'Telegram',
    lightOnly: false,
    shells: {
      light: {
        titleBg: '#517da2',
        titleFg: 'rgba(255,255,255,0.92)',
        overlay: '#517da2',
        overlaySymbol: '#ffffff',
        joinRail: false,
        railBg: '#ffffff',
        railRing: '#ffffff',
        railFg: '#8d969c',
        railFgActive: '#3390ec',
        railText: '#000000',
        railHover: 'rgba(0,0,0,0.04)',
        railActive: 'rgba(51,144,236,0.12)',
        railBorder: '#dadce0',
        badgeBg: '#3390ec',
        badgeFg: '#ffffff',
        brand: '#2aabee',
        brandDots: '#ffffff',
        windowBg: '#ffffff',
        dark: false,
      },
      dark: {
        titleBg: '#17212b',
        titleFg: '#708499',
        overlay: '#17212b',
        overlaySymbol: '#f5f5f5',
        joinRail: false,
        railBg: '#0e1621',
        railRing: '#0e1621',
        railFg: '#6c7883',
        railFgActive: '#6ab3f3',
        railText: '#f5f5f5',
        railHover: 'rgba(255,255,255,0.05)',
        railActive: 'rgba(106,179,243,0.14)',
        railBorder: '#0b121b',
        badgeBg: '#5288c1',
        badgeFg: '#ffffff',
        brand: '#2aabee',
        brandDots: '#ffffff',
        windowBg: '#0e1621',
        dark: true,
      },
    },
  },
};

// The Messenger skin borrows its colors from Facebook's page.
function messengerShell(p) {
  return {
    titleBg: p.surface,
    titleFg: p.secondary,
    overlay: p.surface,
    overlaySymbol: p.text,
    joinRail: false,
    railBg: p.surface,
    railRing: p.surface,
    railFg: p.icon,
    railFgActive: p.text,
    railText: p.text,
    railHover: p.hover,
    railActive: p.active,
    railBorder: p.divider,
    badgeBg: '#e41e3f',
    badgeFg: '#ffffff',
    brand: '#0084ff',
    brandDots: '#0084ff',
    windowBg: p.surface,
    dark: p.dark,
  };
}

function skinOf(name) {
  return SKINS[name] ? name : 'messenger';
}

// Title bar and sidebar colors of a fixed skin (null for Messenger).
function skinShell(name, dark) {
  const skin = SKINS[skinOf(name)];
  if (skin.shells) return skin.shells[dark ? 'dark' : 'light'];
  return skin.shell || null;
}

// The mode a skin pins Facebook's page to: null for Messenger (Facebook's own).
function skinMode(name, dark) {
  const skin = SKINS[skinOf(name)];
  if (!skin.shell && !skin.shells) return null;
  if (skin.lightOnly) return 'light';
  return dark ? 'dark' : 'light';
}

module.exports = { SKINS, messengerShell, skinOf, skinShell, skinMode };
