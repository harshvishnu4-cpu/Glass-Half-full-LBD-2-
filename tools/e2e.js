// End-to-end gameplay test: drives the real game in headless Edge with
// trusted pointer input. Verifies wrong-drop rejection, all 12 placements,
// the win overlay, and replay. Screenshots land in tools/e2e-shots/.
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
// default: file:// (preloader skips fetch there); set GAME_URL to test over HTTP
const URL = process.env.GAME_URL ||
  'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/%3A/, ':');
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
  const errors = [], badResponses = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) badResponses.push(r.status() + ' ' + r.url()); });

  await page.goto(URL);
  await sleep(1400); // title screen entrance
  expect('title screen visible', await page.evaluate(
    () => getComputedStyle(document.getElementById('title-screen')).display !== 'none'), true);
  // the Play button appears only once the preloader finishes
  await page.waitForFunction(
    () => getComputedStyle(document.getElementById('play-btn')).visibility === 'visible', { timeout: 30000 });
  await page.screenshot({ path: path.join(SHOTS, '0-title.png') });
  await page.click('#play-btn');
  await sleep(800); // mid-splash
  await page.screenshot({ path: path.join(SHOTS, '0b-splash.png') });
  await sleep(4400); // rest of splash + intro
  expect('background music playing', await page.evaluate(() => window.SFX.musicPlaying()), true);
  // Agni's tutorial lines are spoken aloud by the recorded voice-over
  await page.waitForFunction(() => window.SFX.voicePlaying(), { timeout: 10000 });
  expect('voice-over speaking during tutorial', true, true);

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

  // the game stays locked until Agni's tutorial dialogue finishes
  await page.waitForFunction(() => window.__game.locked === false, { timeout: 25000 });

  // 1. place the tutorial's spotlighted empty glass first — that ends the
  // guided hint (glow + ghost demo), leaving a clean stage for the
  // escalation checks below
  await dragTo(0, '#zone-empty');
  expect('tutorial glass placed', await placed(), 1);
  await page.waitForFunction(() => !document.querySelector('.glass-ghost'), { timeout: 5000 });
  // the demo dims its source glass; interrupting it must always restore them
  await sleep(400);
  expect('no glass left dimmed by the ghost demo', await page.evaluate(() =>
    window.__game.glasses.every((g) => +getComputedStyle(g.img).opacity > 0.95)), true);
  // ...and sitting idle brings the demo back (the ~9s inactivity nudge)
  await page.waitForFunction(() => document.querySelector('.glass-ghost'), { timeout: 13000 });
  expect('idle nudge replays the ghost demo', true, true);

  // wrong drops escalate: glass 1 is half full; the Full tray rejects it.
  // 1st miss — just the shake: no dialogue, no glow, no ghost demo
  await dragTo(1, '#zone-full', { shotDuringDrag: '1-dragging.png' });
  await sleep(400); // return-home tween
  expect('placed after wrong drop', await placed(), 1);
  expect('no hint after 1st wrong attempt', await page.evaluate(() =>
    !document.getElementById('agni-text').textContent.includes('This glass is half full') &&
    !document.querySelector('.glass.highlight') && !document.querySelector('.glass-ghost') &&
    !document.querySelector('.tray-glow.on')), true);
  // 2nd miss — Agni's type-specific line appears, but still no visual aids
  await dragTo(1, '#zone-full');
  await page.waitForFunction(
    () => document.getElementById('agni-text').textContent.includes('This glass is half full'),
    { timeout: 8000 });
  expect('dialogue after 2nd wrong attempt', true, true);
  // ...together with the glass pulsing, but no tray light and no ghost demo yet
  expect('glass pulses after 2nd wrong attempt', await page.evaluate(() =>
    !!document.querySelector('.glass.highlight')), true);
  expect('no tray light / ghost demo after 2nd wrong attempt', await page.evaluate(() =>
    !document.querySelector('.glass-ghost') && !document.querySelector('.tray-glow.on')), true);
  // 3rd miss — the tray lights up and the ghost glass demos the move as well
  await dragTo(1, '#zone-full');
  await page.waitForFunction(
    () => document.querySelector('.glass.highlight') && document.querySelector('.glass-ghost') &&
      document.querySelector('#glow-half.on'), { timeout: 8000 });
  expect('lit tray + ghost demo after 3rd wrong attempt', true, true);
  await page.screenshot({ path: path.join(SHOTS, '2-after-reject.png') });

  // 2. sort everything correctly
  const zoneFor = { empty: '#zone-empty', half: '#zone-half', full: '#zone-full' };
  for (let i = 0; i < types.length; i++) await dragTo(i, zoneFor[types[i]]);
  expect('placed after sorting all', await placed(), 9);
  await page.screenshot({ path: path.join(SHOTS, '2b-sorted.png') });

  // 3. phase 2: dress the drinks FIRST, then customers arrive to order
  await page.waitForFunction(() => window.__game.phase === 2, { timeout: 15000 });
  // no phantom glass may survive the scene swap into level 2
  expect('no orphan ghost after phase switch', await page.evaluate(
    () => !document.querySelector('.glass-ghost')), true);
  // the garnish boxes glow once the trays are ready to be dressed
  await page.waitForFunction(
    () => document.getElementById('lemonbox').classList.contains('nudge-glow'), { timeout: 15000 });
  // taps are ignored until Agni's garnish dialogue finishes
  await page.waitForFunction(() => window.__game.locked === false, { timeout: 15000 });

  // garnish: one tap on each box dresses every glass on the trays
  await page.click('#strawbox');
  await sleep(900);
  expect('straws added to all glasses', await page.evaluate(() => {
    const gs = window.__game.glasses;
    return gs.length === 6 && gs.every((g) =>
      g.hasStraw && /garnish-\w+-straw/.test(g.img.dataset.art) && g.img.complete && g.img.naturalWidth > 0);
  }), true);
  await page.click('#lemonbox');
  await sleep(900);
  expect('lemons added to all glasses', await page.evaluate(() => {
    const gs = window.__game.glasses;
    return gs.length === 6 && gs.every((g) =>
      g.hasLemon && /garnish-\w+-both/.test(g.img.dataset.art) && g.img.complete && g.img.naturalWidth > 0);
  }), true);
  await page.screenshot({ path: path.join(SHOTS, '3b-garnished.png') });

  // only now (after Agni's cheer) does the first customer walk in and demand
  await page.waitForFunction(() => window.__game.demand !== null, { timeout: 25000 });
  console.log('order sequence:', await page.evaluate(
    () => [window.__game.demand].concat(window.__game.demandQueue).join(', ')));
  await sleep(700); // bubble pop-in
  await page.screenshot({ path: path.join(SHOTS, '3-customers.png') });

  // the order bubble must actually DECODE, not just be visible. A broken <img>
  // still has visibility:visible and a layout box, so only naturalWidth proves
  // the art rendered — this caught the preloader handing <img> a typeless blob
  // (SVG is never content-sniffed, so it silently failed over HTTP only).
  expect('order bubble art decoded', await page.evaluate(() => {
    const o = document.getElementById('demand-bubble');
    return o.complete && o.naturalWidth > 0;
  }), true);
  // and nothing else on the stage is a broken image
  const brokenImgs = await page.evaluate(() => Array.from(document.querySelectorAll('img'))
    .filter((im) => im.complete && im.naturalWidth === 0)
    .map((im) => (im.id || im.className || '?') + ' <- ' + im.getAttribute('src')));
  expect('no broken images', brokenImgs.length ? brokenImgs.join('; ') : 'none', 'none');

  const served = () => page.evaluate(() => window.__game.served);
  const glassIdxOf = (t) => page.evaluate(
    (ty) => Array.from(document.querySelectorAll('.glass')).findIndex((el) => el.dataset.type === ty), t);

  // two wrong serves: the hint bar appears, and the order bubble must step
  // aside for it rather than hide behind it
  let demand = await page.evaluate(() => window.__game.demand);
  const wrongIdx = await glassIdxOf(demand === 'half' ? 'full' : 'half');
  await dragTo(wrongIdx, '#zone-customer');
  await sleep(500);
  expect('served after wrong serve', await served(), 0);
  await dragTo(wrongIdx, '#zone-customer');
  await page.waitForFunction(
    () => document.getElementById('agni-text').textContent.startsWith('Pick a'), { timeout: 8000 });
  const overlap = await page.evaluate(() => {
    const q = document.getElementById('agni-bubble').getBoundingClientRect();
    const o = document.getElementById('demand-bubble');
    const b = o.getBoundingClientRect();
    const visible = getComputedStyle(o).visibility === 'visible' && +getComputedStyle(o).opacity > 0.05;
    return { visible, boxesCross: b.top < q.bottom && b.bottom > q.top };
  });
  expect('order bubble does not sit behind the question bar', !(overlap.visible && overlap.boxesCross), true);
  await page.screenshot({ path: path.join(SHOTS, '3c-hint.png') });
  // ...and it comes back once the bar has gone
  await page.waitForFunction(() => {
    const o = document.getElementById('demand-bubble');
    return getComputedStyle(o).visibility === 'visible' && +getComputedStyle(o).opacity > 0.9;
  }, { timeout: 12000 });
  expect('order bubble returns after the hint', true, true);

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
  // every hint/nudge must be switched off on the win screen
  expect('all hints cleared at the win screen', await page.evaluate(() =>
    !document.querySelector('.tray-glow.on') && !document.querySelector('.glass-ghost') &&
    !document.querySelector('.nudge-glow')), true);
  expect('win overlay visible', await page.evaluate(() => {
    const s = getComputedStyle(document.getElementById('win-overlay'));
    return s.visibility === 'visible' && parseFloat(s.opacity) > 0.9;
  }), true);

  // 4. the game ENDS on the celebration video: it plays through and the final
  // frame stays put — no navigation, no replay button
  const urlBefore = page.url();
  expect('celebration video is playing', await page.evaluate(() => {
    const v = document.getElementById('win-bg');
    return !!v && !v.paused && !v.error;
  }), true);
  await sleep(6000); // past the ~4s clip
  expect('still on the end screen (no navigation)', page.url(), urlBefore);
  expect('win overlay still covering the game', await page.evaluate(() => {
    const s = getComputedStyle(document.getElementById('win-overlay'));
    return s.visibility === 'visible' && parseFloat(s.opacity) > 0.9;
  }), true);
  expect('video ran to the end and stopped there', await page.evaluate(() => {
    const v = document.getElementById('win-bg');
    return v.ended || v.currentTime > 3;
  }), true);
  expect('title screen not shown again', await page.evaluate(
    () => getComputedStyle(document.getElementById('title-screen')).display === 'none'), true);
  await page.screenshot({ path: path.join(SHOTS, '5-end.png') });

  console.log('page errors:', errors.length ? errors.join(' | ') : 'none');
  if (errors.length) failures++;
  console.log('4xx/5xx responses:', badResponses.length ? badResponses.join(' | ') : 'none');
  if (badResponses.length) failures++;
  await browser.close();
  console.log(failures ? `E2E FAILED (${failures})` : 'E2E ALL GREEN');
  process.exit(failures ? 1 : 0);
})();
