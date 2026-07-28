// Loading-bar test over local HTTP with a throttled network (CDP), verifying:
//  - the Play button is hidden while the juice bar shows real progress
//  - progress is monotonic and reaches 100%
//  - the button then pops in and actually starts the game
//  - every <img> is healthy, ZERO console errors, ZERO 4xx/5xx responses
// Run tools/serve.js first (or let this script spawn it itself).
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 8123;
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
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(PORT)], { stdio: 'pipe' });
  await sleep(600);

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--window-size=1920,1080', '--force-device-scale-factor=1']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  const jsErrors = [], badResponses = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') jsErrors.push('console: ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) badResponses.push(r.status() + ' ' + r.url()); });

  // ~4 Mbps down / 20 ms RTT: the 2.8MB payload takes ~6s, so the bar is observable
  const cdp = await page.target().createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 20, downloadThroughput: 4_000_000 / 8, uploadThroughput: 1_000_000 / 8
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });

  // sample the bar until the button reveals
  const samples = [];
  let hiddenDuringLoad = true;
  for (let t = 0; t < 120; t++) {
    const s = await page.evaluate(() => ({
      pct: parseInt(document.getElementById('load-fill').style.width, 10) || 0,
      btnVisible: getComputedStyle(document.getElementById('play-btn')).visibility === 'visible',
      barShown: getComputedStyle(document.getElementById('load-wrap')).display !== 'none'
    }));
    samples.push(s.pct);
    if (s.btnVisible && s.pct < 100) hiddenDuringLoad = false;
    if (s.btnVisible) break;
    if (t === 6) await page.screenshot({ path: path.join(SHOTS, 'load-midway.png') });
    await sleep(250);
  }
  const increases = samples.filter((v, i) => i && v > samples[i - 1]).length;
  const monotonic = samples.every((v, i) => !i || v >= samples[i - 1]);
  expect('bar showed real progress (>=3 increasing samples)', increases >= 3, true);
  expect('bar strictly monotonic', monotonic, true);
  expect('bar reached 100%', samples[samples.length - 1] === 100 ||
    await page.evaluate(() => document.getElementById('load-fill').style.width === '100%'), true);
  expect('play button hidden while loading', hiddenDuringLoad, true);

  await page.waitForFunction(
    () => getComputedStyle(document.getElementById('play-btn')).visibility === 'visible', { timeout: 30000 });
  expect('play button revealed after 100%', true, true);
  await sleep(900);
  await page.screenshot({ path: path.join(SHOTS, 'load-done.png') });

  // programmatic start must work only now (guard passed), and actually starts
  await page.click('#play-btn');
  await sleep(3500); // splash + intro begins
  expect('game started after click', await page.evaluate(
    () => getComputedStyle(document.getElementById('title-screen')).display === 'none'), true);
  await page.screenshot({ path: path.join(SHOTS, 'load-started.png') });

  // every image element healthy (complete, decoded, no error)
  const imgHealth = await page.evaluate(() =>
    Array.from(document.querySelectorAll('img')).map((i) =>
      ({ src: (i.getAttribute('src') || '').slice(0, 60), ok: i.complete && i.naturalWidth > 0 })));
  expect('all images healthy', imgHealth.every((i) => i.ok), true);
  if (!imgHealth.every((i) => i.ok)) console.log(imgHealth.filter((i) => !i.ok));

  expect('zero JS/console errors', jsErrors.length, 0);
  if (jsErrors.length) console.log(jsErrors);
  expect('zero 4xx/5xx responses', badResponses.length, 0);
  if (badResponses.length) console.log(badResponses);

  await browser.close();
  server.kill();
  console.log(failures ? `LOADING TEST FAILED (${failures})` : 'LOADING TEST ALL GREEN');
  process.exit(failures ? 1 : 0);
})();
