'use strict';
// Smoke test for a built app. Start the mock page and the app first:
//   node test/mock-server.js &
//   MESSENGER_URL=http://localhost:8123/messages/t/1/ <app> --remote-debugging-port=9222 &
//   node test/smoke.js [screenshot folder]
// Needs playwright-core (npm install --no-save playwright-core).
const { chromium } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');

const out = process.argv[2] || 'smoke';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function expect(ok, what) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) failed++;
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const pages = () => browser.contexts().flatMap((c) => c.pages());
  let fb;
  for (let i = 0; i < 30 && !fb; i++) {
    fb = pages().find((p) => p.url().includes('localhost:8123/messages'));
    if (!fb) await sleep(500);
  }
  const title = pages().find((p) => p.url().includes('part=title'));
  const rail = pages().find((p) => p.url().includes('part=rail'));
  expect(Boolean(fb && title && rail), 'title bar, sidebar and Facebook views are up');
  if (!fb || !title || !rail) process.exit(1);
  await sleep(3000);

  const platform = await title.evaluate(() => document.body.dataset.platform);
  const pad = await title.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.titlebar')).paddingLeft));
  console.log(`platform=${platform} title padding=${pad}px`);
  if (platform === 'darwin') expect(pad >= 84, 'title bar leaves room for the window buttons');

  const counts = async () => ({
    chats: await rail.evaluate(() => { const b = document.querySelector('.item[data-route="chats"] .badge'); return b.hidden ? 0 : Number(b.textContent); }),
    total: await title.evaluate(() => lastBadge),
  });
  let c = await counts();
  expect(c.chats === 3 && c.total === 3, `3 unread chats + 2 Facebook notifications -> 3 (got ${c.chats}/${c.total})`);
  await fb.evaluate(() => mock.setCounts(0, 4));
  await sleep(1500);
  c = await counts();
  expect(c.total === 0, `Facebook notifications only -> 0 (got ${c.total})`);
  await fb.evaluate(() => mock.setCounts(2, 4));
  await sleep(1500);
  c = await counts();
  expect(c.total === 2, `2 new chats -> 2 (got ${c.total})`);

  await fb.evaluate(() => mock.toast());
  await sleep(500);
  const toast = await fb.evaluate(() => {
    const li = document.querySelector('#toasts li');
    return li ? getComputedStyle(li).display : 'gone';
  });
  expect(toast === 'gone' || toast === 'none', `Facebook notification pop-up closed (${toast})`);

  for (const [name, page] of [['facebook', fb], ['title', title], ['rail', rail]]) {
    await page.screenshot({ path: path.join(out, `${name}.png`) }).catch((e) => console.log(`screenshot ${name}: ${e.message}`));
  }
  console.log(failed ? `${failed} FAILED` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
