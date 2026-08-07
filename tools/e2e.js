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

  // Snapshot the instant the tutorial hands control over. The glasses must not
  // become draggable until Agni's line has finished typing AND speaking.
  // Trapped with a property setter rather than polled: a poll can tick after the
  // unlock, by which point the line has finished and an early hand-over looks
  // clean. Verified to fail when the unlock is put back on a fixed timer.
  await page.evaluateOnNewDocument(() => {
    window.__unlockSnapshot = null;
    const install = setInterval(() => {
      const g = window.__game;
      if (!g) return;
      clearInterval(install);
      let held = g.locked;
      Object.defineProperty(g, 'locked', {
        configurable: true,
        get: function () { return held; },
        set: function (next) {
          if (held === true && next === false && !window.__unlockSnapshot) {
            window.__unlockSnapshot = {
              text: document.getElementById('agni-text').textContent,
              voice: window.SFX ? window.SFX.voicePlaying() : null
            };
          }
          held = next;
        }
      });
    }, 10);
  });

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
  const unlock = await page.evaluate(() => window.__unlockSnapshot);
  expect('glasses unlock only after the line has fully typed',
    unlock && unlock.text.trim(), 'This glass is empty. Put it in the correct tray.');
  expect('glasses unlock only after Agni has stopped speaking',
    unlock && unlock.voice, false);

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
  // ...and sitting idle pulses ONE glass to draw the eye back. The nudge is
  // deliberately pulse-only — no ghost demo — so the idle stage never shows two
  // competing animations at once.
  await page.waitForFunction(
    () => document.querySelectorAll('.glass.highlight').length === 1, { timeout: 26000 });
  expect('idle nudge pulses exactly one glass', await page.evaluate(
    () => document.querySelectorAll('.glass.highlight').length), 1);
  expect('idle nudge runs no ghost demo', await page.evaluate(
    () => !document.querySelector('.glass-ghost')), true);
  // and touching anything calls it off
  await page.mouse.click(20, 20);
  await sleep(400);
  expect('idle pulse cleared on interaction', await page.evaluate(
    () => document.querySelectorAll('.glass.highlight').length), 0);

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
  // the bubble names the glass and stops; the instruction is voice-only. Wait
  // for the whole sentence — the line types out, so a substring match lands
  // before the final full stop has been typed.
  await page.waitForFunction(
    () => document.getElementById('agni-text').textContent.trim() === 'This glass is half full.',
    { timeout: 8000 });
  expect('wrong-drop bubble omits the spoken instruction', await page.evaluate(
    () => document.getElementById('agni-text').textContent.trim()), 'This glass is half full.');
  // while the line is still being SPOKEN (the bubble's short text finishes ~2s
  // before the voice), a grab must be ignored — dialogue first, hands after
  expect('hint line still speaking once its text is up', await page.evaluate(
    () => window.__game.speaking), true);
  const gGate = await center('.glass', 1);
  await page.mouse.move(gGate.x, gGate.y);
  await page.mouse.down();
  await sleep(150);
  expect('grab ignored while Agni is speaking', await page.evaluate(
    () => !document.querySelector('.glass.dragging')), true);
  await page.mouse.up();
  // ...and the hands come back the moment the line has been spoken out
  await page.waitForFunction(() => !window.__game.speaking, { timeout: 8000 });
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
  // the 3rd miss re-speaks the hint; drags are gated until it finishes
  await page.waitForFunction(() => !window.__game.speaking, { timeout: 8000 });

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

  // only now (after Agni's cheer) do the customers file in and the first orders
  await page.waitForFunction(() => window.__game.demand !== null, { timeout: 25000 });
  await sleep(1400); // let the rest of the line finish walking in
  console.log('order sequence:', await page.evaluate(
    () => window.__game.queue.map((c) => c.order).concat(window.__game.demandQueue).join(', ')));
  await page.screenshot({ path: path.join(SHOTS, '3-customers.png') });

  // customers queue: more than one is on the counter at a time, and they line up
  // to the RIGHT of the one being served (they enter from the right)
  const line = await page.evaluate(() => window.__game.queue.map((c) => {
    const r = c.el.getBoundingClientRect();
    return Math.round(r.left + r.width / 2);
  }));
  console.log('   queue x-centres: ' + JSON.stringify(line));
  expect('customers form a queue rather than arriving one at a time', line.length > 1, true);
  expect('the line stands to the right of the counter',
    line.every((x, i) => i === 0 || x > line[i - 1]), true);
  expect('the front of the queue is at the serve spot', Math.abs(line[0] - 960) < 40, true);

  // the order bubble FLOATS above the customer — its tail points down at the
  // head with a gap, rather than overlapping it (which read as the bubble being
  // stuck to the head). The art's drawn box is rows 31..132 of a 132-tall
  // canvas and the tail tip sits at 99% of the element height.
  // Measured from LAYOUT (offsetTop/offsetHeight), not getBoundingClientRect:
  // the bubble bobs 10px up on a loop, so the live rect flatters the gap. Layout
  // gives the resting pose, which is the worst case. The head is the design
  // constant — every sprite is placed so its VISIBLE top is y=305 (the element
  // rect starts higher, inside the sprite's transparent margin).
  const bub = await page.evaluate(() => {
    const el = document.getElementById('demand-bubble');
    return {
      top: Math.round(el.offsetTop + el.offsetHeight * 31 / 132),
      tail: Math.round(el.offsetTop + el.offsetHeight * 0.99),
      head: 305
    };
  });
  console.log('   bubble visible top y=' + bub.top + ', tail tip y=' + bub.tail +
    ' (at rest), head top y=' + bub.head + '  => gap ' + (bub.head - bub.tail) + 'px');
  expect('the order bubble clears the customer\'s head', bub.head - bub.tail > 0, true);
  expect('...but still points at it (not adrift)', bub.head - bub.tail < 60, true);
  expect('the order bubble stays on stage', bub.top > 0, true);

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
  // ONE miss must not give anything away: no glass may pulse and Agni stays
  // quiet. Help only arrives on the second miss.
  expect('no glass pulses after 1st wrong serve', await page.evaluate(
    () => document.querySelectorAll('.glass.highlight').length), 0);
  expect('no dialogue after 1st wrong serve', await page.evaluate(
    () => document.getElementById('agni-text').textContent.startsWith('Pick a')), false);
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

  // idle in the serving half pulses EVERY glass left on the trays, both types.
  // Pulsing only the ones matching the order would hand over the answer — that
  // is what the two-miss hint is for, not an inactivity prompt.
  await page.waitForFunction(() => {
    const unplaced = window.__game.glasses.filter((g) => !g.placed).length;
    return unplaced > 1 && document.querySelectorAll('.glass.highlight').length === unplaced;
  }, { timeout: 26000 });
  const idle2 = await page.evaluate(() => ({
    lit: document.querySelectorAll('.glass.highlight').length,
    unplaced: window.__game.glasses.filter((g) => !g.placed).length,
    types: new Set(Array.from(document.querySelectorAll('.glass.highlight'))
      .map((el) => el.dataset.type)).size
  }));
  expect('level 2 idle nudge pulses every glass', idle2.lit, idle2.unplaced);
  expect('level 2 idle nudge reveals neither type', idle2.types, 2);

  // serve all 6 correctly
  let rounds = 0;
  while ((await served()) < 6 && rounds++ < 12) {
    demand = await page.evaluate(() => window.__game.demand);
    if (!demand) { await sleep(400); continue; }
    const before = await served();
    if (before === 1) {
      // record every SFX cue through a payment: the coin must announce
      // itself when it is HANDED OVER and again when it is TAKEN IN — two
      // separate beats, so a silent disappearance is a regression
      await page.evaluate(() => {
        window.__cues = [];
        window.__sfxOrig = window.SFX.play;
        window.SFX.play = function (n) { window.__cues.push(n); return window.__sfxOrig.call(window.SFX, n); };
      });
    }
    const tServe = Date.now();
    await dragTo(await glassIdxOf(demand), '#zone-customer');
    await page.waitForFunction((n) => window.__game.served === n + 1, { timeout: 6000 }, before);
    if (before === 0) {
      // the served customer heads off to the LEFT, past the serve spot
      await page.waitForFunction(() => Array.from(document.querySelectorAll('.customer'))
        .some((el) => {
          const r = el.getBoundingClientRect();
          return +getComputedStyle(el).opacity > 0.5 && r.left + r.width / 2 < 700;
        }), { timeout: 6000 });
      expect('the served customer leaves to the left', true, true);
      // The coin finishes disappearing BEFORE the next customer moves. Timing
      // this by the ask alone is not enough — an earlier attempt had the coin
      // gone 0.3s before the order appeared, yet the customer had already been
      // WALKING for that whole time, so the coin still vanished under a moving
      // sprite. Record when the queue starts moving, not just when it arrives.
      await page.waitForFunction(() => !!document.querySelector('.coin-fly'), { timeout: 8000 });
      const restX = await page.evaluate(
        () => window.__game.queue[0] ? Math.round(window.__game.queue[0].el.getBoundingClientRect().left) : null);
      await page.waitForFunction(() => !document.querySelector('.coin-fly'), { timeout: 10000 });
      const tGone = (Date.now() - tServe) / 1000;
      const stillParked = await page.evaluate(
        (x0) => window.__game.queue[0] &&
          Math.abs(Math.round(window.__game.queue[0].el.getBoundingClientRect().left) - x0) < 8,
        restX);
      expect('the next customer has not started moving while the coin is on screen',
        stillParked, true);
      await page.waitForFunction(() => window.__game.demand !== null, { timeout: 12000 });
      const tAsk = (Date.now() - tServe) / 1000;
      console.log('   coin gone ' + tGone.toFixed(2) + 's / next order ' +
        tAsk.toFixed(2) + 's after the serve');
      expect('the coin disappears before the next customer arrives', tGone < tAsk, true);
      expect('the next order arrives promptly', tAsk < 6, true);
    }
    if (before === 1) {
      // the coin pile sits ON the counter top: its BASE must be on the same line
      // the level-1 glasses stand on (SHELF_BOTTOM = 621), not floating against
      // the counter's front panel below it.
      // Sample during the HOLD — the pile is settled from 0.45s to 0.90s, then
      // floats up as it dissolves. 0.65s is the middle of that window.
      await page.waitForFunction(() => !!document.querySelector('.coin-fly'), { timeout: 8000 });
      await sleep(650);
      // MEASURE FIRST, screenshot after: a screenshot costs a few hundred ms,
      // which would push the reading past the hold and into the float-up.
      const rest = await page.evaluate(() => {
        const c = document.querySelector('.coin-fly');
        if (!c) return null;
        const m = new DOMMatrixReadOnly(getComputedStyle(c).transform);
        return { x: Math.round(m.e), y: Math.round(m.f), h: Math.round(c.getBoundingClientRect().height) };
      });
      await page.screenshot({ path: path.join(SHOTS, '3d-coin.png'),
        clip: { x: 0, y: 560, width: 1920, height: 260 } });
      // rest.y is the coin's TOP; it is 62 tall, so base = y + 62 must be 621
      expect('coin base rests on the counter top', rest &&
        Math.abs(rest.x - 914) <= 100 && Math.abs(rest.y + 62 - 621) <= 6
        ? 'yes' : 'no @ ' + JSON.stringify(rest), 'yes');
      console.log('   coin rest: top y=' + (rest && rest.y) + ', height=' + (rest && rest.h) +
        ', base y=' + (rest && rest.y + 62) + ' (counter top = 621)');

      // the collect cue fires ~1.6s into the flight, as the coin fades out
      await page.waitForFunction(() => !document.querySelector('.coin-fly'), { timeout: 6000 });
      const cues = await page.evaluate(() => window.__cues.slice());
      // anchor on the LAST pair: now that the queue keeps things moving, the
      // previous customer's 'collect' can still land inside this window
      const iCoin = cues.lastIndexOf('coin'), iCollect = cues.lastIndexOf('collect');
      expect('coin announces the payment', iCoin !== -1, true);
      expect('coin announces being collected', iCollect !== -1, true);
      expect('payment and collection are separate cues',
        iCoin !== -1 && iCollect > iCoin, true);
      console.log('   cues through the payment: ' + cues.join(', '));
      // put the real SFX.play back — leaving the wrapper in place while dropping
      // the array it writes to makes every later cue throw
      await page.evaluate(() => { window.SFX.play = window.__sfxOrig; });
    }
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
  // the LAST customer's coin has no follower to trigger its collection, so
  // finalWin has to sweep it — otherwise it is stranded behind the win overlay
  expect('the last coin is taken in too, none stranded', await page.evaluate(
    () => document.querySelectorAll('.coin-fly').length), 0);
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
  // the clip is short, so the end screen must not freeze on the last frame:
  // confetti keeps showering and the frame keeps pushing in
  expect('celebration still running after the clip ends', await page.evaluate(
    () => document.querySelectorAll('.confetti').length > 0), true);
  expect('end frame keeps pushing in', await page.evaluate(() => {
    const m = new DOMMatrixReadOnly(getComputedStyle(document.getElementById('win-bg')).transform);
    return m.a > 1.001;
  }), true);
  expect('music bed returns for the end screen', await page.evaluate(
    () => window.SFX.musicPlaying()), true);
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
