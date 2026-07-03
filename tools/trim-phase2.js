// One-off build tool for phase-2 art: the raw Figma source images are
// full-canvas PNGs with real alpha; crop each to its content bounding box
// and emit WebP. The trays sheet keeps its white card (multiply in CSS).
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, '..', 'assets', 'raw');
const OUT = path.join(__dirname, '..', 'assets', 'img');

async function trimToWebp(srcName, outName) {
  const img = sharp(path.join(RAW, srcName));
  const { width, height } = await img.metadata();
  const raw = await img.ensureAlpha().raw().toBuffer();
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (raw[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const region = { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  await sharp(path.join(RAW, srcName)).extract(region)
    .webp({ quality: 85, alphaQuality: 90, effort: 6 })
    .toFile(path.join(OUT, outName));
  console.log(outName, region.width + 'x' + region.height, 'from', width + 'x' + height);
}

(async () => {
  await trimToWebp('raw-reaper-a.png', 'char-reaper.webp');
  await trimToWebp('raw-wolf-a.png', 'char-wolf.webp');
  await trimToWebp('raw-mummy-a.png', 'char-mummy.webp');
  await trimToWebp('raw-lemon-a.png', 'box-a.webp');
  await trimToWebp('raw-straw-a.png', 'box-b.webp');
  await sharp(path.join(RAW, 'trays2.png'))
    .webp({ quality: 85, alphaQuality: 90, effort: 6 })
    .toFile(path.join(OUT, 'trays2.webp'));
  console.log('trays2.webp done');
})();
