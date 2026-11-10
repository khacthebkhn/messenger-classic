'use strict';
// App themes ("skins").
// - messenger: follows Facebook's own colors, light or dark.
// - yahoo, zalo: fixed light looks. They color the title bar and sidebar
//   here, and restyle Facebook's page through src/inject/skins.css.

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

module.exports = { SKINS, messengerShell, skinOf };
