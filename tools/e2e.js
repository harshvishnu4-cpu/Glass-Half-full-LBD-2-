// End-to-end gameplay test: drives the real game in headless Edge with
// trusted pointer input. Verifies wrong-drop rejection, all 12 placements,
// the win overlay, and replay. Screenshots land in tools/e2e-shots/.
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/%3A/, ':');
const SHOTS = path.join(__dirname, 'e2e-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function expect(label, actual, wanted) {
  const ok = actual === wanted;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + ` ${label}: ${actual}` + (ok ? '' : ` (expected ${wanted})`));
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--window-size=1920,1080', '--force-device-scale-factor=1']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(URL);
  await sleep(1400); // title screen entrance
  expect('title screen visible', await page.evaluate(
    () => getComputedStyle(document.getElementById('title-screen')).display !== 'none'), true);
  await page.screenshot({ path: path.join(SHOTS, '0-title.png') });
  await page.click('#play-btn');
  await sleep(800); // mid-splash
  await page.screenshot({ path: path.join(SHOTS, '0b-splash.png') });
  await sleep(4400); // rest of splash + intro
  expect('background music playing', await page.evaluate(() => window.SFX.musicPlaying()), true);

  const center = (sel, idx = 0) => page.evaluate((s, i) => {
    const el = document.querySelectorAll(s)[i];
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel, idx);

  async function dragTo(glassIdx, zoneSel, { shotDuringDrag } = {}) {
    const a = await center('.glass', glassIdx);
    const b = await center(zoneSel);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(a.x + (b.x - a.x) * i / 10, a.y + (b.y - a.y) * i / 10);
    }
    if (shotDuringDrag) await page.screenshot({ path: path.join(SHOTS, shotDuringDrag) });
    await page.mouse.up();
    await sleep(950); // let place/reject animation settle
  }

  const placed = () => page.evaluate(() => window.__game.placed);
  const types = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.glass img')).map((i) => i.alt.split(' ')[0]));
  expect('glass count', types.length, 9);

  await page.screenshot({ path: path.join(SHOTS, '0-start.png') });

  // 1. wrong drop: glass 0 is half-full; the Full tray must reject it
  await dragTo(0, '#zone-full', { shotDuringDrag: '1-dragging.png' });
  await sleep(400); // return-home tween
  expect('placed after wrong drop', await placed(), 0);
  // a second miss in a row must trigger the glowing-tray hint (spoken by Agni)
  await dragTo(0, '#zone-full');
  await page.waitForFunction(
    () => document.getElementById('tut-mascot-text').textContent.includes('glowing tray'),
    { timeout: 8000 });
  expect('hint after two wrong attempts', true, true);
  await page.screenshot({ path: path.join(SHOTS, '2-after-reject.png') });

  // 2. sort everything correctly
  const zoneFor = { empty: '#zone-empty', half: '#zone-half', full: '#zone-full' };
  for (let i = 0; i < types.length; i++) await dragTo(i, zoneFor[types[i]]);
  expect('placed after sorting all', await placed(), 9);
  await page.screenshot({ path: path.join(SHOTS, '2b-sorted.png') });

  // 3. phase 2: dress the drinks FIRST, then customers arrive to order
  await page.waitForFunction(() => window.__game.phase === 2, { timeout: 15000 });
  // the garnish boxes glow once the trays are ready to be dressed
  await page.waitForFunction(
    () => document.getElementById('lemonbox').classList.contains('nudge-glow'), { timeout: 15000 });

  // garnish: one tap on each box dresses every glass on the trays
  await page.click('#strawbox');
  await sleep(900);
  expect('straws added to all glasses', await page.evaluate(() => {
    const gs = window.__game.glasses;
    return gs.length === 6 && gs.every((g) => g.hasStraw && /garnish-\w+-straw/.test(g.img.src));
  }), true);
  await page.click('#lemonbox');
  await sleep(900);
  expect('lemons added to all glasses', await page.evaluate(() => {
    const gs = window.__game.glasses;
    return gs.length === 6 && gs.every((g) => g.hasLemon && /garnish-\w+-both/.test(g.img.src));
  }), true);
  await page.screenshot({ path: path.join(SHOTS, '3b-garnished.png') });

  // only now (after Agni's cheer) does the first customer walk in and demand
  await page.waitForFunction(() => window.__game.demand !== null, { timeout: 25000 });
  console.log('order sequence:', await page.evaluate(
    () => [window.__game.demand].concat(window.__game.demandQueue).join(', ')));
  await sleep(700); // bubble pop-in
  await page.screenshot({ path: path.join(SHOTS, '3-customers.png') });

  const served = () => page.evaluate(() => window.__game.served);
  const glassIdxOf = (t) => page.evaluate(
    (ty) => Array.from(document.querySelectorAll('.glass')).findIndex((el) => el.dataset.type === ty), t);

  // wrong serve: hand over the type the customer did NOT ask for
  let demand = await page.evaluate(() => window.__game.demand);
  await dragTo(await glassIdxOf(demand === 'half' ? 'full' : 'half'), '#zone-customer');
  await sleep(500);
  expect('served after wrong serve', await served(), 0);

  // serve all 6 correctly
  let rounds = 0;
  while ((await served()) < 6 && rounds++ < 12) {
    demand = await page.evaluate(() => window.__game.demand);
    if (!demand) { await sleep(400); continue; }
    const before = await served();
    await dragTo(await glassIdxOf(demand), '#zone-customer');
    await page.waitForFunction((n) => window.__game.served === n + 1, { timeout: 6000 }, before);
    await page.waitForFunction(
      () => window.__game.demand !== null || window.__game.served === 6, { timeout: 10000 });
  }
  expect('customers served', await served(), 6);
  await sleep(2000); // last coin flight
  expect('coins collected', await page.evaluate(() => window.__game.coins), 6);

  await sleep(2600); // win overlay + confetti
  await page.screenshot({ path: path.join(SHOTS, '4-win.png') });
  expect('win overlay visible', await page.evaluate(() => {
    const s = getComputedStyle(document.getElementById('win-overlay'));
    return s.visibility === 'visible' && parseFloat(s.opacity) > 0.9;
  }), true);

  // 4. replay reloads back to the sorting phase
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#replay')]);
  await sleep(1500);
  expect('placed after replay', await placed(), 0);
  expect('glasses after replay', await page.evaluate(() => document.querySelectorAll('.glass').length), 9);
  await page.screenshot({ path: path.join(SHOTS, '5-replay.png') });

  console.log('page errors:', errors.length ? errors.join(' | ') : 'none');
  if (errors.length) failures++;
  await browser.close();
  console.log(failures ? `E2E FAILED (${failures})` : 'E2E ALL GREEN');
  process.exit(failures ? 1 : 0);
})();
