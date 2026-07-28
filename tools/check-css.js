// Dead-CSS check: every class/id selector in style.css must be mentioned in
// index.html or a js file (as markup, className, classList, or '#id').
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const code = ['index.html', 'js/game.js', 'js/sfx.js', 'js/preload.js']
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');

// selector names: everything before a '{', split on combinators
const names = new Set();
for (const m of css.matchAll(/(^|\})([^{}@]+)\{/g)) {
  for (const tok of m[2].matchAll(/[.#]([\w-]+)/g)) names.add(tok[0]);
}
const dead = [...names].filter((n) => !code.includes(n.slice(1)));
console.log(dead.length ? 'DEAD SELECTORS:\n  ' + dead.join('\n  ') : 'no dead class/id selectors');

// unused CSS custom properties
const defined = [...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);
const deadVars = defined.filter((v) => !css.includes('var(' + v));
console.log(deadVars.length ? 'DEAD CUSTOM PROPERTIES: ' + deadVars.join(', ') : 'no dead custom properties');
