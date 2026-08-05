# The Glass Half Full — Sorting Game

A drag-and-drop learning game implemented from the
[Figma design](https://www.figma.com/design/p2dk5xOnWCGxgnCU2mWm68/The-Glass-Half-Full-LBDs?node-id=629-634)
using plain **HTML / CSS / JavaScript** with **GSAP** for animation.

**Phase 1 — Sort:** drag the 15 glasses on the carnival shelf onto the right
tray — **Empty**, **Half Full**, or **Full** — guided by the dragon mascot's
instruction banner. Wrong tray: the glass shakes and flies back. Right tray:
it lands with a sparkle burst.

**Phase 2 — Serve:** three spooky customers (a little reaper, a wolf, and a
mummy) waddle up behind the counter. One at a time they ask — via a comic
speech bubble — for a **Half Full** or **Full** glass at random; drag the
right glass from the trays to the customer, who drinks it with a glug-glug.
Serve all 10 drinks for the confetti finale.

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
| `assets/img/` | All artwork: WebP raster + SVG for the order bubbles |
| `assets/fonts/` | Self-hosted Lilita One |
| `tools/` | Dev only: static server, e2e tests, asset/CSS/dead-code checks |

## Assets

Everything was exported from the Figma file and converted to WebP ahead of
time (the conversion scripts are not kept in the repo — the committed WebP
files are the source of truth). Two exceptions:

- The order bubbles (`bubble-half.svg` / `bubble-full.svg`) stay vector so the
  baked-in lettering is crisp at any stage scale.
- The trays artwork is drawn on a white card in the source file; the game
  reproduces the Figma composite with `mix-blend-mode: multiply`.

`js/preload-manifest.js` is generated — re-run `npm run check` after adding,
removing or re-exporting any asset. It rewrites the size table the loading bar
uses and reports anything referenced-but-missing or present-but-unused.

## Sound

Most SFX are synthesized live with the Web Audio API (`js/sfx.js`), so they
need no asset files. The palette is "spooky, but friendly": a ghostly rise when
you grab a glass, minor-key sparkle bells on a correct drop, a cartoon
womp-womp on a wrong one, and a bell run with a ghost-choir pad for the win —
over a soft night ambience of wind and a distant owl. `audio/` holds the pieces
that cannot be synthesized: Agni's recorded voice-over lines, the two coin beats
(`cash-register.ogg` when a customer pays, `coin-disappear.ogg` when the coin is
taken off the counter), and the looping music bed. Audio starts on the first tap
or click (browser autoplay policy).

Sample cues can be cut short — `playSample(name, vol, stopAfter)` fades a clip
out early. Both coin clips use it: they would otherwise still be ringing when the
next cue fires, and the two beats would blur into one.

## Testing

```
npm test         # tools/e2e.js — full playthrough
npm run check    # regenerate the preload manifest + dead CSS/JS scan
```

`npm test` drives the real game in headless Edge with trusted pointer input and
verifies: wrong-drop rejection, all 12 placements, hint escalation, the idle
nudges, the coin flight, the win overlay and the sustained end screen.
Screenshots land in `tools/e2e-shots/` (gitignored).

Set `GAME_URL` to test over HTTP instead of `file://` — worth doing, because the
preloader only fetches (and hands the game `blob:` URLs) over HTTP, so a whole
class of asset bug is invisible on `file://`:

```
node tools/serve.js 8123
GAME_URL=http://localhost:8123/ npm test
```

`index.html?ss=1` skips the intro animation (useful for screenshots).
