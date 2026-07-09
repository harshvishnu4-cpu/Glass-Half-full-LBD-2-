// Build tool: render the pre-composed garnish glass SVGs to WebP and compute
// how to place each one inside the plain .glass box (92x136) so the glass
// BODY lines up exactly — straw pokes above, lemon juts left. Alignment uses
// the glass base (widest opaque band at the bottom, unambiguous in every art).
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const IMG = path.join(__dirname, '..', 'assets', 'img');
const ELEM_W = 92, ELEM_H = 136;        // plain glass element size
const SPRITE_TO_ELEM = ELEM_W / 184;    // plain sprites are 184px wide

async function baseMetrics(buf) {
  const img = sharp(buf);
  const { width, height } = await img.metadata();
  const raw = await img.ensureAlpha().raw().toBuffer();
  // content bbox
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (raw[(y * width + x) * 4 + 3] > 20) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  // base band = bottom 7% of the content
  const band = Math.max(2, Math.round(ch * 0.07));
  let bMinX = width, bMaxX = 0;
  for (let y = maxY - band; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if (raw[(y * width + x) * 4 + 3] > 20) { if (x < bMinX) bMinX = x; if (x > bMaxX) bMaxX = x; }
  }
  return {
    cw, ch, minX, minY,
    baseWidth: bMaxX - bMinX + 1,
    baseCenterX: (bMinX + bMaxX) / 2 - minX  // relative to trimmed content
  };
}

(async () => {
  // plain glass base reference (in element space)
  const ref = {};
  for (const t of ['full', 'half']) {
    const m = await baseMetrics(fs.readFileSync(path.join(IMG, 'glass-' + t + '.webp')));
    ref[t] = { baseWidth: m.baseWidth * SPRITE_TO_ELEM, centerX: (m.minX + m.baseCenterX) * SPRITE_TO_ELEM };
  }

  const jobs = [
    ['full', 'straw', 'full glass with  strow'],
    ['full', 'lemon', 'full glass with lemon'],
    ['full', 'both',  'complete full glass'],
    ['half', 'straw', 'half glass with strow .'],
    ['half', 'lemon', 'half glass with lemon'],
    ['half', 'both',  'complete the half glass']
  ];

  const cfg = { full: {}, half: {} };
  for (const [type, variant, file] of jobs) {
    const svg = path.join(IMG, file + '.svg');
    const meta = await sharp(svg).metadata();
    // render so content height is ~ 480px for a crisp but small webp
    const density = Math.min(600, Math.max(72, Math.round(72 * 480 / meta.height)));
    let buf = await sharp(svg, { density }).png().toBuffer();
    const m = await baseMetrics(buf);
    // trim to content and save webp
    const out = 'garnish-' + type + '-' + variant + '.webp';
    await sharp(buf).extract({ left: m.minX, top: m.minY, width: m.cw, height: m.ch })
      .webp({ quality: 88, alphaQuality: 95, effort: 6 }).toFile(path.join(IMG, out));
    // uniform scale so the composed glass base equals the plain glass base
    const k = ref[type].baseWidth / m.baseWidth;
    const w = m.cw * k, h = m.ch * k;
    const left = ref[type].centerX - m.baseCenterX * k;
    const top = ELEM_H - h;   // glass base sits on the element's baseline
    cfg[type][variant] = { src: 'assets/img/' + out,
      w: +w.toFixed(1), h: +h.toFixed(1), left: +left.toFixed(1), top: +top.toFixed(1) };
    console.log(out, m.cw + 'x' + m.ch, '->', JSON.stringify(cfg[type][variant]));
  }
  fs.writeFileSync(path.join(__dirname, 'garnish-config.json'), JSON.stringify(cfg, null, 2));
  console.log('\nGARNISH_ART =', JSON.stringify(cfg));
})();
