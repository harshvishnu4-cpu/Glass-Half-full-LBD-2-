// One-off build tool: converts the raw Figma PNG exports in assets/raw to WebP in assets/img
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'assets', 'raw');
const OUT = path.join(__dirname, '..', 'assets', 'img');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.png'));
  for (const f of files) {
    const name = f.replace(/\.png$/, '.webp');
    const src = path.join(SRC, f);
    const out = path.join(OUT, name);
    await sharp(src).webp({ quality: 85, alphaQuality: 90, effort: 6 }).toFile(out);
    const before = fs.statSync(src).size;
    const after = fs.statSync(out).size;
    console.log(`${f.padEnd(18)} ${(before / 1024).toFixed(0).padStart(5)} KB -> ${name.padEnd(19)} ${(after / 1024).toFixed(0).padStart(5)} KB  (${(100 - (after / before) * 100).toFixed(0)}% smaller)`);
  }
})();
