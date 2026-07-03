# The Glass Half Full — Sorting Game

A drag-and-drop learning game implemented from the
[Figma design](https://www.figma.com/design/p2dk5xOnWCGxgnCU2mWm68/The-Glass-Half-Full-LBDs?node-id=629-634)
using plain **HTML / CSS / JavaScript** with **GSAP** for animation.

**Phase 1 — Sort:** drag the 12 glasses on the carnival shelf onto the right
tray — **Empty**, **Half Full**, or **Full**. Wrong tray: the glass shakes
and flies back. Right tray: it lands with a sparkle burst.

**Phase 2 — Serve:** three spooky customers (a little reaper, a wolf, and a
mummy) waddle up behind the counter. One at a time they ask — via a comic
speech bubble — for a **Half Full** or **Full** glass at random; drag the
right glass from the trays to the customer, who drinks it with a glug-glug.
Serve all 8 drinks for the confetti finale.

## Run it

Open `index.html` directly in a browser, or serve the folder:

```
npm start        # npx serve .
```

## Project layout

| Path | What it is |
| --- | --- |
| `index.html` | Scene layers, trays, plaques, HUD, win overlay |
| `css/style.css` | Fixed 1920x1080 stage styling (scaled to fit any window) |
| `js/game.js` | Game logic: pointer drag, drop zones, GSAP animations |
| `js/sfx.js` | Procedural Web Audio SFX (kid-friendly spooky) + night ambience |
| `js/vendor/gsap.min.js` | GSAP 3 (vendored from npm) |
| `assets/img/*.webp` | All artwork, exported from Figma and converted to WebP |
| `assets/raw/` | Original Figma exports (PNG/SVG sources for the WebP files) |
| `assets/fonts/` | Self-hosted Lilita One |
| `tools/` | Asset pipeline + e2e test (dev only, uses `sharp` / `puppeteer-core`) |

## Asset pipeline

Assets were exported straight from the Figma file, then converted to WebP
(~3.9 MB of PNG → ~230 KB):

```
npm run build:assets
```

- `tools/convert-webp.js` — converts the raw PNG exports to WebP (`sharp`).
- `tools/clean-sprites.js` — the glass artwork exports carry the slide's
  white background; this strips the background rects from the SVG exports,
  renders them at 2x, and removes the plaque's white backdrop via
  border-connected flood fill.
- The trays artwork is drawn on a white card in the source file; the game
  reproduces the Figma composite with `mix-blend-mode: multiply`.

## Sound

All SFX are synthesized live with the Web Audio API (`js/sfx.js`) — no audio
files. The palette is "spooky, but friendly": a ghostly rise when you grab a
glass, minor-key sparkle bells on a correct drop, a cartoon womp-womp on a
wrong one, and a bell run with a ghost-choir pad for the win — over a soft
night ambience of wind and a distant owl. The 🔊 button (top right) mutes
everything and remembers the choice in `localStorage`.

## Testing

```
npm test         # tools/e2e.js
```

Drives the real game in headless Edge with trusted pointer input and
verifies: wrong-drop rejection, all 12 placements, the win overlay, and
replay. Screenshots land in `tools/e2e-shots/`.

`index.html?ss=1` skips the intro animation (useful for screenshots).
