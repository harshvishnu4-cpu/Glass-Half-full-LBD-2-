// Static sweep for dead code: declared-but-never-referenced functions and
// variables, and object-literal keys nothing reads. Reports candidates for
// manual review (it is deliberately loose — verify each hit before deleting).
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

for (const file of ['js/game.js', 'js/sfx.js', 'js/preload.js']) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const names = new Set();
  for (const m of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // additional declarations in comma lists: var a = 1, b = 2;
  for (const m of code.matchAll(/,\s*([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);

  const dead = [];
  for (const n of names) {
    const uses = (code.match(new RegExp('\\b' + n.replace(/\$/g, '\\$') + '\\b', 'g')) || []).length;
    if (uses <= 1) dead.push(n);
  }
  console.log(`\n${file}: ${dead.length ? 'UNUSED -> ' + dead.join(', ') : 'no unused declarations'}`);

  // state object keys that are written but never read
  const stateBlock = code.match(/var state = \{([\s\S]*?)\n  \};/);
  if (stateBlock) {
    const keys = [...stateBlock[1].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]);
    const unread = keys.filter((k) => {
      const reads = (code.match(new RegExp('state\\.' + k + '\\b(?!\\s*=[^=])', 'g')) || []).length;
      return reads === 0;
    });
    console.log('  state keys never read: ' + (unread.length ? unread.join(', ') : 'none'));
  }
}
