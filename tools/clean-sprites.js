// One-off build tool: strips the slide-background rects Figma bakes into the
// glass SVG exports, renders them to 2x PNG, removes the white backdrop from
// the plaque via border-connected flood fill, then writes WebP sprites.
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, '..', 'assets', 'raw');
const OUT = path.join(__dirname, '..', 'assets', 'img');

function stripBackgroundRects(svg) {
  // background rects appear before the artwork: a solid rect the size of the
  // viewBox and the parent slide's translated 1920x1080 white rect
  return svg
    .replace(/<rect width="\d+" height="\d+" fill="#9D9D9D"\/>/g, '')
    .replace(/<rect width="1920" height="1080" transform="[^"]*" fill="white"\/>/g, '');
}

async function renderGlass(svgFile, outName) {
  const svg = stripBackgroundRects(fs.readFileSync(path.join(RAW, svgFile), 'utf8'));
  const cleaned = path.join(RAW, svgFile.replace('.svg', '.clean.svg'));
  fs.writeFileSync(cleaned, svg);
  await sharp(cleaned, { density: 144 }) // 2x of librsvg's 72dpi default
    .webp({ quality: 85, alphaQuality: 90, effort: 6 })
    .toFile(path.join(OUT, outName));
  const m = await sharp(path.join(OUT, outName)).metadata();
  console.log(outName, m.width + 'x' + m.height);
}

async function cleanPlaque() {
  const img = sharp(path.join(RAW, 'plaque.png')).ensureAlpha();
  const { width, height } = await sharp(path.join(RAW, 'plaque.png')).metadata();
  const raw = await img.raw().toBuffer();
  const isBg = (i) => raw[i] >= 246 && raw[i + 1] >= 246 && raw[i + 2] >= 246;
  const visited = new Uint8Array(width * height);
  const queue = [];
  for (let x = 0; x < width; x++) { queue.push(x, (height - 1) * width + x); }
  for (let y = 0; y < height; y++) { queue.push(y * width, y * width + width - 1); }
  while (queue.length) {
    const p = queue.pop();
    if (visited[p]) continue;
    visited[p] = 1;
    if (!isBg(p * 4)) continue;
    raw[p * 4 + 3] = 0;
    const x = p % width, y = (p / width) | 0;
    if (x > 0) queue.push(p - 1);
    if (x < width - 1) queue.push(p + 1);
    if (y > 0) queue.push(p - width);
    if (y < height - 1) queue.push(p + width);
  }
  // feather: soften pixels bordering the removed background
  const alpha = (p) => raw[p * 4 + 3];
  const soft = [];
  for (let p = 0; p < width * height; p++) {
    if (alpha(p) === 0) continue;
    const x = p % width, y = (p / width) | 0;
    const nearClear = (x > 0 && alpha(p - 1) === 0) || (x < width - 1 && alpha(p + 1) === 0) ||
      (y > 0 && alpha(p - width) === 0) || (y < height - 1 && alpha(p + width) === 0);
    if (nearClear) soft.push(p);
  }
  soft.forEach((p) => { raw[p * 4 + 3] = 140; });
  await sharp(raw, { raw: { width, height, channels: 4 } })
    .webp({ quality: 85, alphaQuality: 90, effort: 6 })
    .toFile(path.join(OUT, 'plaque.webp'));
  console.log('plaque.webp cleaned');
}

(async () => {
  await renderGlass('glass-half.svg', 'glass-half.webp');
  await renderGlass('glass-full.svg', 'glass-full.webp');
  await renderGlass('glass-empty.svg', 'glass-empty.webp');
  await cleanPlaque();
})();
