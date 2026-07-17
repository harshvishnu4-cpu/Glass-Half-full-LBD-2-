// Generates the spooky ghost cursors (PNG — the only format browsers accept
// for cursors). Upright friendly ghost; hotspot goes at the top of its head.
const sharp = require('sharp');

const ghost = (grab) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
  <g${grab ? ' transform="translate(0 4.6) scale(1 0.88)"' : ''}>
    <path d="M20 6 C12.5 6 8.5 11.5 8.5 19 L8.5 33 L12.5 29.5 L16 33.5 L20 30 L24 33.5 L27.5 29.5 L31.5 33 L31.5 19 C31.5 11.5 27.5 6 20 6 Z"
          fill="#f6f0ff" stroke="#2a1b3d" stroke-width="2.4" stroke-linejoin="round"/>
    ${grab
      ? '<path d="M13.6 18.6 Q15.8 16.6 18 18.6 M22 18.6 Q24.2 16.6 26.4 18.6" stroke="#2a1b3d" stroke-width="2" stroke-linecap="round" fill="none"/>'
      : '<circle cx="15.8" cy="18" r="2.2" fill="#2a1b3d"/><circle cx="24.2" cy="18" r="2.2" fill="#2a1b3d"/>'}
    <ellipse cx="20" cy="24.5" rx="1.8" ry="${grab ? 1 : 2.3}" fill="#2a1b3d"/>
  </g>
</svg>`);

(async () => {
  await sharp(ghost(false), { density: 288 }).resize(40, 40).png().toFile('assets/img/cursor-ghost.png');
  await sharp(ghost(true), { density: 288 }).resize(40, 40).png().toFile('assets/img/cursor-ghost-grab.png');
  const fs = require('fs');
  ['cursor-ghost.png', 'cursor-ghost-grab.png'].forEach((f) =>
    console.log(f, (fs.statSync('assets/img/' + f).size / 1024).toFixed(1) + 'KB'));
})();
