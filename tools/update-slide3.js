// One-off: process the updated slide-3 assets — plain glass sprites (SVG
// exports with the slide background stripped), the shorter tray sheet, and
// the mascot banner pieces (raw images with alpha).
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, '..', 'assets', 'raw');
const OUT = path.join(__dirname, '..', 'assets', 'img');

function stripBackgroundRects(svg) {
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

(async () => {
  await renderGlass('glass2-full.svg', 'glass-full.webp');
  await renderGlass('glass2-half.svg', 'glass-half.webp');
  await renderGlass('glass2-empty.svg', 'glass-empty.webp');

  await sharp(path.join(RAW, 'trays-new.png'))
    .webp({ quality: 85, alphaQuality: 90, effort: 6 })
    .toFile(path.join(OUT, 'trays.webp'));
  console.log('trays.webp 1834x344');

  await sharp(path.join(RAW, 'raw-banner.png'))
    .webp({ quality: 85, alphaQuality: 90, effort: 6 })
    .toFile(path.join(OUT, 'banner.webp'));
  console.log('banner.webp done');

  await sharp(path.join(RAW, 'raw-mascotbox.png'))
    .webp({ quality: 85, alphaQuality: 90, effort: 6 })
    .toFile(path.join(OUT, 'mascotbox.webp'));
  console.log('mascotbox.webp done');

  /* The dragon head is a crop of a 1920x1080 sheet. From the Figma layout:
     displayed sheet = 643.07% x 410.65% of a 134x118 box, offset
     (-273.79%, -97.72%) — i.e. sheet shown at 861.71x484.57, crop at
     (366.88, 115.31) size 134x118. Scale to raw pixels: 1920/861.71. */
  const k = 1920 / 861.71;
  await sharp(path.join(RAW, 'raw-dragon.png'))
    .extract({
      left: Math.round(366.88 * k),
      top: Math.round(115.31 * k),
      width: Math.round(134 * k),
      height: Math.round(118 * k)
    })
    .webp({ quality: 85, alphaQuality: 90, effort: 6 })
    .toFile(path.join(OUT, 'dragon.webp'));
  console.log('dragon.webp done');
})();
