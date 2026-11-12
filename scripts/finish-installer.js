'use strict';
// After the Windows installer is signed (which changes its bytes), rebuild
// its .blockmap and latest.yml so the app's updater sees the right SHA-512.
//   node scripts/finish-installer.js dist/MessengerClassic-Setup-1.3.1.exe
const fs = require('node:fs');
const path = require('node:path');
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap');
const { version } = require('../package.json');

(async () => {
  const installer = process.argv[2];
  if (!installer || !fs.existsSync(installer)) {
    console.error('usage: node scripts/finish-installer.js <installer.exe>');
    process.exit(1);
  }
  const info = await buildBlockMap(installer, 'gzip', `${installer}.blockmap`);
  const name = path.basename(installer);
  const yml = [
    `version: ${version}`,
    'files:',
    `  - url: ${name}`,
    `    sha512: ${info.sha512}`,
    `    size: ${info.size}`,
    `path: ${name}`,
    `sha512: ${info.sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(path.dirname(installer), 'latest.yml'), yml);
  console.log(yml);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
