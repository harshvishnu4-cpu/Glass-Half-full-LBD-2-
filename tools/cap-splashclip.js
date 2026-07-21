const puppeteer = require('puppeteer-core');
const sharp = require('sharp');
const path = require('path');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/%3A/, ':');
const SHOTS = path.join(__dirname, 'e2e-shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// letterboxed window: 1500x1000 (stage scales to 1500x844, bars top+bottom ~78px)
(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--window-size=1500,1000', '--force-device-scale-factor=1'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1500, height: 1000 });
  await p.goto(URL);
  await sleep(1400);
  await p.click('#play-btn');
  // grab frames through the splash (drain phase ~1.3-2.3s after click)
  for (let k = 0; k < 5; k++) {
    await sleep(420);
    await p.screenshot({ path: path.join(SHOTS, `clip-${k}.png`) });
  }
  // measure: any bright/pink pixels in the top & bottom letterbox bars?
  let spill = 0;
  for (let k = 0; k < 5; k++) {
    const raw = await sharp(path.join(SHOTS, `clip-${k}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = raw.info.width, H = raw.info.height;
    const bar = 70; // safely inside the ~78px letterbox bars
    const check = (y) => { for (let x = 0; x < W; x += 7) { const i = (y * W + x) * 4; const r = raw.data[i], g = raw.data[i + 1], bl = raw.data[i + 2]; if (r > 90 && bl > 90 && g < r - 30) spill++; } };
    for (let y = 4; y < bar; y += 12) check(y);
    for (let y = H - bar; y < H - 4; y += 12) check(y);
  }
  console.log('pink pixels found in letterbox bars across 5 frames:', spill);
  console.log(spill === 0 ? 'PASS splash stays inside the stage' : 'FAIL splash spills into letterbox');
  await b.close();
})();
