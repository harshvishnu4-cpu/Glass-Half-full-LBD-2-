/* The Glass Half Full — carnival sorting game.
   Scene coordinates are in the fixed 1920x1080 design space; the stage is
   scaled to the window and pointer deltas are divided by that scale. */
(function () {
  'use strict';

  var GLASS_TYPES = {
    full:  { src: 'assets/img/glass-full.webp',  w: 106, h: 157 },
    half:  { src: 'assets/img/glass-half.webp',  w: 106, h: 158 },
    empty: { src: 'assets/img/glass-empty.webp', w: 106, h: 158 }
  };
  /* the garnish art placement below was measured for the original 92px-wide
     glass box; everything scales by this factor */
  var GLASS_ART_SCALE = 106 / 92;

  /* Shelf line-up: 9 tumblers (3 of each fill level) in a centred row */
  var START_GLASSES = (function () {
    var seq = ['empty', 'half', 'empty', 'half', 'full', 'empty', 'full', 'half', 'full'];
    var step = 136;                                  /* 106px glass + 30px gap */
    var startX = Math.round((1920 - (8 * step + 106)) / 2);
    return seq.map(function (type, i) {
      return { type: type, x: startX + i * step };
    });
  })();
  var SHELF_BOTTOM = 621;

  /* Three landing spots per tray: one flat row, same baseline, evenly
     spaced — identical alignment on every tray, glasses at full size. */
  function rowSlots(gap) {
    return [-1, 0, 1].map(function (m) {
      return { dx: m * gap, bottom: 940, s: 1 };
    });
  }
  /* centerX values are measured from the tray artwork at the glass
     baseline (y=940), so each row sits dead-centre on its tray */
  var TRAYS = {
    empty: { zone: { x: 90,   y: 700, w: 550, h: 365 }, centerX: 360,  count: 0, slots: rowSlots(130) },
    half:  { zone: { x: 672,  y: 700, w: 578, h: 365 }, centerX: 957,  count: 0, slots: rowSlots(130) },
    full:  { zone: { x: 1290, y: 700, w: 550, h: 365 }, centerX: 1564, count: 0, slots: rowSlots(130) }
  };

  /* Phase 2 (serving): spooky customers ask for half-full or full glasses.
     Character x-centers/tops match the Figma slide; the full-body sprites
     extend below the counter and are hidden behind it (lower z-index). */
  var PHASE2 = {
    trayCenters: { half: 1000, full: 1608 },
    chars: [
      { key: 'reaper',  center: 356,  top: 305 },
      { key: 'wolf',    center: 1023, top: 305 },
      { key: 'mummy',   center: 1500, top: 305 },
      { key: 'vampire', center: 730,  top: 305 },
      { key: 'zombie',  center: 1268, top: 305 }
    ],
  };

  var stage = document.getElementById('stage');
  var glassLayer = document.getElementById('glass-layer');
  var fxLayer = document.getElementById('fx-layer');
  var winOverlay = document.getElementById('win-overlay');
  var demandBubble = document.getElementById('demand-bubble');
  var zoneCustomer = document.getElementById('zone-customer');
  PHASE2.chars.forEach(function (c) { c.el = document.getElementById('char-' + c.key); });
  var zoneEls = {
    empty: document.getElementById('zone-empty'),
    half: document.getElementById('zone-half'),
    full: document.getElementById('zone-full')
  };
  var plaqueEls = {
    empty: document.getElementById('plaque-empty'),
    half: document.getElementById('plaque-half'),
    full: document.getElementById('plaque-full')
  };

  var stageScale = 1;
  /* dragged glasses live in the 500+ z range, placed ones around 100-200,
     so whatever is in hand always renders on top */
  /* Agni the dragon's tutorial lines */
  var TUT = [
    'Making every drink takes too long.',
    'Let us sort the glasses into trays.',
    'This glass is empty. Put it in the correct tray.',
    'Great job! Now let us serve our customers.',
    'Tap the lemons and the straws.',
    'Awesome! You are ready to serve everyone.'
  ];

  /* how Agni names each fill level in feedback lines */
  var TYPE_NAMES = { empty: 'empty', half: 'half full', full: 'full' };

  /* spooky-but-sweet things the customers say when they get their drink */
  var SERVE_LINES = ['Boo-licious!', 'Fang-tastic!', 'Spook-tacular!', 'Ghoulishly good!', 'Monster yummy!', 'Eek, tasty!'];

  var state = {
    glasses: [], placed: 0, topZ: 500, locked: false,
    phase: 1, served: 0, demand: null, active: null,
    demandQueue: [],
    firstSortDone: false, firstServeDone: false, tutTimers: [],
    wrongStreak: 0, coins: 0, hintGlass: null,
    strawTapped: false, lemonTapped: false, traysCentered: false
  };

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---------- stage scaling ---------- */

  /* the whole 1920x1080 stage is scaled to *contain* the viewport (letterboxed
     and centred), so the layout stays pixel-perfect on any screen size. We read
     the visual viewport when available so mobile browser chrome (the address
     bar) is accounted for, and flip to a rotate prompt on portrait phones. */
  var rotateOverlay = document.getElementById('rotate-overlay');
  function fitStage() {
    var vv = window.visualViewport;
    var vw = vv ? vv.width : window.innerWidth;
    var vh = vv ? vv.height : window.innerHeight;
    stageScale = Math.min(vw / 1920, vh / 1080);
    gsap.set(stage, {
      scale: stageScale,
      x: (vw - 1920 * stageScale) / 2,
      y: (vh - 1080 * stageScale) / 2
    });
    if (rotateOverlay) rotateOverlay.style.display = vh > vw ? 'flex' : 'none';
  }
  window.addEventListener('resize', fitStage);
  /* mobile reports the new size a beat after the orientation flips */
  window.addEventListener('orientationchange', function () {
    fitStage();
    setTimeout(fitStage, 250);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitStage);
    window.visualViewport.addEventListener('scroll', fitStage);
  }

  /* ---------- glasses ---------- */

  function createGlass(type, x, top) {
    var spec = GLASS_TYPES[type];
    var el = document.createElement('div');
    el.className = 'glass';
    el.dataset.type = type;
    el.style.left = x + 'px';
    el.style.top = top + 'px';
    el.style.width = spec.w + 'px';
    el.style.height = spec.h + 'px';

    var img = document.createElement('img');
    img.src = spec.src;
    img.alt = type + ' glass';
    el.appendChild(img);
    glassLayer.appendChild(el);

    var g = {
      el: el, img: img, type: type,
      x: x, y: top, w: spec.w, h: spec.h,
      placed: false, drag: null, homeX: 0,
      setX: gsap.quickSetter(el, 'x', 'px'),
      setY: gsap.quickSetter(el, 'y', 'px')
    };
    gsap.set(el, { transformOrigin: '50% 100%' });
    gsap.set(img, { transformOrigin: '50% 100%' });
    makeDraggable(g);
    state.glasses.push(g);
    return g;
  }

  function buildGlasses() {
    START_GLASSES.forEach(function (def) {
      createGlass(def.type, def.x, SHELF_BOTTOM - GLASS_TYPES[def.type].h);
    });
  }

  /* phase 2: the sorted half/full glasses reappear on the two serving trays.
     Wider slots than phase 1 — once dressed, the composed glass+lemon+straw
     art is ~146px wide, so 130px spacing would make neighbours overlap. */
  function buildGlasses2() {
    ['half', 'full'].forEach(function (type) {
      var spec = GLASS_TYPES[type];
      rowSlots(152).forEach(function (slot, i) {
        var cx = PHASE2.trayCenters[type] + slot.dx;
        var g = createGlass(type, cx - spec.w / 2, slot.bottom - spec.h);
        g.el.style.zIndex = 150 + i;
      });
    });
  }

  function startIdle(g) {
    gsap.to(g.img, {
      rotation: gsap.utils.random(-2.2, 2.2),
      duration: gsap.utils.random(1.6, 2.6),
      yoyo: true, repeat: -1, ease: 'sine.inOut',
      delay: gsap.utils.random(0, 1.2)
    });
  }

  /* ---------- drag & drop ---------- */

  function glassCenter(g) {
    return {
      x: g.x + g.w / 2 + gsap.getProperty(g.el, 'x'),
      y: g.y + g.h / 2 + gsap.getProperty(g.el, 'y')
    };
  }

  function zoneAt(pt) {
    for (var key in TRAYS) {
      var z = TRAYS[key].zone;
      if (pt.x >= z.x && pt.x <= z.x + z.w && pt.y >= z.y && pt.y <= z.y + z.h) return key;
    }
    return null;
  }

  function highlightZone(key) {
    for (var k in zoneEls) {
      gsap.to(zoneEls[k], { opacity: k === key ? 1 : 0, duration: 0.2, overwrite: 'auto' });
    }
  }

  function makeDraggable(g) {
    g.el.addEventListener('pointerdown', function (e) {
      /* g.drag guard: a second finger on the same glass must not re-grab it
         (it would re-capture the pointer and make the glass jump) */
      if (g.placed || state.locked || g.drag) return;
      e.preventDefault();
      try { g.el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no active pointer */ }
      g.drag = {
        px: e.clientX, py: e.clientY,
        ox: gsap.getProperty(g.el, 'x'), oy: gsap.getProperty(g.el, 'y')
      };
      state.topZ += 1;
      g.el.style.zIndex = state.topZ;
      g.el.classList.add('dragging');
      /* the hint has done its job once a glass is in hand — the ghost demo
         stops, this glass loses its glow, and if it is the RIGHT glass the
         whole hint switches off (all glasses back to normal) */
      stopHandDemo();
      g.el.classList.remove('highlight');
      if (state.phase === 2 && state.demand && g.type === state.demand) clearServeHint();
      SFX.unlock();
      SFX.play('pickup');
      gsap.to(g.el, { scale: 1.08, duration: 0.18, ease: 'power2.out' });
      gsap.killTweensOf(g.img);
      gsap.to(g.img, { rotation: 0, scale: 1, duration: 0.2 });
    });

    g.el.addEventListener('pointermove', function (e) {
      if (!g.drag) return;
      g.setX(g.drag.ox + (e.clientX - g.drag.px) / stageScale);
      g.setY(g.drag.oy + (e.clientY - g.drag.py) / stageScale);
      if (state.phase === 2) {
        var over = state.demand && customerHit(glassCenter(g));
        gsap.to(zoneCustomer, { opacity: over ? 1 : 0, duration: 0.2, overwrite: 'auto' });
      } else {
        highlightZone(zoneAt(glassCenter(g)));
      }
    });

    function release(e) {
      if (!g.drag) return;
      g.drag = null;
      g.el.classList.remove('dragging');
      highlightZone(null);
      gsap.to(zoneCustomer, { opacity: 0, duration: 0.2, overwrite: 'auto' });
      if (state.phase === 2) {
        var overCust = state.demand && customerHit(glassCenter(g));
        if (overCust && g.type === state.demand) serveGlass(g);
        else if (overCust) rejectServe(g);
        else returnHome(g);
        return;
      }
      var hit = zoneAt(glassCenter(g));
      if (hit && hit === g.type) placeGlass(g);
      else if (hit) rejectGlass(g);
      else returnHome(g);
    }
    g.el.addEventListener('pointerup', release);
    g.el.addEventListener('pointercancel', release);
  }

  /* ---------- outcomes ---------- */

  function placeGlass(g) {
    g.placed = true;
    g.el.classList.add('placed');
    g.el.classList.remove('highlight'); /* hint satisfied — stop the glow */
    state.placed += 1;

    /* first correct drop ends the sorting tutorial — Agni cheers the player on */
    if (!state.firstSortDone) {
      state.firstSortDone = true;
      stopSortHint();
      agniSays('Sort the rest of the glasses.'); /* clears the tutorial timers, then auto-hides */
    }
    state.wrongStreak = 0;
    clearZoneHints();

    var tray = TRAYS[g.type];
    var slotIndex = tray.count;
    var slot = tray.slots[slotIndex];
    tray.count += 1;

    var tx = tray.centerX + slot.dx - (g.x + g.w / 2);
    var ty = slot.bottom - (g.y + g.h);
    /* stack strictly left-to-right so overlaps all lean the same way */
    g.el.style.zIndex = 150 + slotIndex;

    gsap.timeline()
      .to(g.el, { x: tx, scale: slot.s, duration: 0.55, ease: 'power2.inOut' }, 0)
      .to(g.el, { keyframes: { y: [gsap.getProperty(g.el, 'y'), ty - 90, ty] }, duration: 0.55, ease: 'power1.inOut' }, 0)
      .to(g.el, { scaleY: slot.s * 0.88, scaleX: slot.s * 1.1, duration: 0.09, ease: 'power1.in' })
      .to(g.el, { scaleY: slot.s, scaleX: slot.s, duration: 0.22, ease: 'elastic.out(1.4, 0.5)' })
      .add(function () {
        burstSparks(tray.centerX + slot.dx, slot.bottom - g.h * slot.s * 0.5);
        SFX.play('correct');
      }, 0.55);

    gsap.fromTo(plaqueEls[g.type], { scale: 1 },
      { scale: 1.12, duration: 0.14, yoyo: true, repeat: 1, ease: 'power1.inOut', delay: 0.45 });

    if (state.placed === START_GLASSES.length) {
      state.locked = true;
      gsap.delayedCall(1.1, phase2Intro);
    }
  }

  /* ---------- Agni's tutorial ---------- */

  /* a quick hint spoken by Agni through his speech bubble, then dismissed;
     cancels any pending tutorial line so it can't overwrite the hint */
  var hintTimer = null;
  function agniSays(text) {
    if (hintTimer) hintTimer.kill();
    clearTutTimers();
    showTutMascot(text);
    hintTimer = gsap.delayedCall(3.6, function () { hideTutMascot(); });
  }

  function tutLater(delay, fn) {
    state.tutTimers.push(gsap.delayedCall(delay, fn));
  }

  /* ---------- inactivity nudge ----------
     if the player goes quiet for ~9s while the game is waiting on them,
     Agni gently reminds them what to do (and repeats if they stay idle) */
  var idleCall = null;
  function armIdleNudge() {
    if (idleCall) idleCall.kill();
    idleCall = gsap.delayedCall(9, idleNudge);
  }
  function idleNudge() {
    armIdleNudge(); /* keep watching — nudge again if they stay idle */
    if (!gameStarted || state.locked) return;
    if (state.phase === 1) {
      /* quiet visual nudge: a ghost glass demos the next move (skip if a
         demo is already running from the tutorial or a wrong-drop hint) */
      if (state.placed >= START_GLASSES.length || ghostTl) return;
      for (var i = 0; i < state.glasses.length; i++) {
        if (!state.glasses[i].placed) { startHandDemo(state.glasses[i]); break; }
      }
    } else if (state.strawTapped && state.lemonTapped && state.demand) {
      hintServe(); /* the glasses matching the order glow */
    }
    /* garnish step needs nothing extra — the untapped boxes already glow */
  }
  document.addEventListener('pointerdown', armIdleNudge);
  armIdleNudge();

  /* full-body Agni + speech bubble for the guided tutorial (design node 670-2) */
  var tutMascot = document.getElementById('tut-mascot');
  var tutMascotImg = document.getElementById('tut-mascot-img');
  var tutMascotBubble = document.getElementById('tut-mascot-bubble');
  var tutMascotText = document.getElementById('tut-mascot-text');
  var tutMascotIn = false;
  var typeCall = null;

  /* reveal the line one character at a time, with a soft blip per letter;
     onDone (optional) fires the moment the full line has been typed */
  function typewrite(text, startDelay, onDone) {
    if (typeCall) { typeCall.kill(); typeCall = null; }
    tutMascotText.textContent = '';
    var i = 0;
    function step() {
      if (i >= text.length) {
        typeCall = null;
        if (onDone) onDone();
        return;
      }
      var ch = text.charAt(i);
      tutMascotText.textContent += ch;
      i += 1;
      if (ch !== ' ') SFX.play('type'); /* blip on visible glyphs only */
      typeCall = gsap.delayedCall(ch === ' ' ? 0.02 : 0.045, step);
    }
    typeCall = gsap.delayedCall(startDelay || 0, step);
  }

  function showTutMascot(text, onDone) {
    if (!tutMascotIn) {
      tutMascotIn = true;
      SFX.play('ask');
      /* Agni strolls in from the right and speaks */
      gsap.set(tutMascot, { visibility: 'visible' });
      gsap.fromTo(tutMascotImg, { x: 380, autoAlpha: 0 },
        { x: 0, autoAlpha: 1, duration: 0.6, ease: 'power3.out' });
      gsap.fromTo(tutMascotBubble, { autoAlpha: 0, scale: 0.3 },
        { autoAlpha: 1, scale: 1, duration: 0.5, ease: 'back.out(2)', delay: 0.35, transformOrigin: '54% 100%' });
      typewrite(text, 0.7, onDone); /* start typing once the bubble has popped in */
    } else {
      /* already on screen — pop the bubble and retype the new line */
      SFX.play('ask');
      gsap.fromTo(tutMascotBubble, { scale: 0.9 },
        { scale: 1, duration: 0.3, ease: 'back.out(2.4)', transformOrigin: '54% 100%' });
      typewrite(text, 0.2, onDone);
    }
    /* friendly gesture wiggle */
    gsap.fromTo(tutMascotImg, { rotation: -2 },
      { rotation: 2, duration: 0.14, yoyo: true, repeat: 3, ease: 'sine.inOut',
        onComplete: function () { gsap.set(tutMascotImg, { rotation: 0 }); } });
  }

  function hideTutMascot() {
    if (typeCall) { typeCall.kill(); typeCall = null; }
    if (!tutMascotIn) return;
    tutMascotIn = false;
    gsap.to(tutMascotBubble, { autoAlpha: 0, scale: 0.4, duration: 0.25, ease: 'back.in(1.6)' });
    gsap.to(tutMascotImg, { x: 420, autoAlpha: 0, duration: 0.5, ease: 'power2.in',
      onComplete: function () { gsap.set(tutMascot, { visibility: 'hidden' }); } });
  }

  function clearTutTimers() {
    state.tutTimers.forEach(function (t) { t.kill(); });
    state.tutTimers = [];
  }

  /* glowing-tray hints (also used after two wrong attempts in a row) */
  function hintZone(type) {
    /* the target tray's brass plate glows and pulses — the rest of the
       scene stays exactly as it is */
    plaqueEls[type].classList.add('glow');
    gsap.to(plaqueEls[type], { scale: 1.1, duration: 0.7, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  }

  function clearZoneHints() {
    stopHandDemo();
    for (var k in zoneEls) {
      gsap.killTweensOf(zoneEls[k]);
      gsap.to(zoneEls[k], { opacity: 0, duration: 0.25, overwrite: 'auto' });
      plaqueEls[k].classList.remove('glow');
      gsap.killTweensOf(plaqueEls[k], 'scale');
      gsap.to(plaqueEls[k], { scale: 1, duration: 0.25, overwrite: 'auto' });
    }
  }

  /* a translucent "ghost" of the glass lifts and glides to its tray, on a
     loop, so the player sees the glass is draggable and where it goes */
  var ghostTl = null, ghostGlassEl = null;

  function startHandDemo(g) {
    stopHandDemo();
    var spec = GLASS_TYPES[g.type];
    ghostGlassEl = document.createElement('img');
    ghostGlassEl.src = spec.src;
    ghostGlassEl.className = 'glass-ghost';
    ghostGlassEl.style.width = g.w + 'px';
    ghostGlassEl.style.height = g.h + 'px';
    glassLayer.appendChild(ghostGlassEl);

    var tray = TRAYS[g.type];
    var slot = tray.slots[tray.count] || tray.slots[0];
    var fromX = g.x, fromY = g.y;
    var toX = tray.centerX + slot.dx - g.w / 2;
    var toY = slot.bottom - g.h;
    var midY = Math.min(fromY, toY) - 90;       /* lift arc on the way over */

    gsap.set(ghostGlassEl, { x: fromX, y: fromY, scale: 1, autoAlpha: 0, transformOrigin: '50% 100%' });
    ghostTl = gsap.timeline({ repeat: -1, repeatDelay: 0.75 });
    ghostTl
      .to(ghostGlassEl, { autoAlpha: 0.65, duration: 0.3 })                       /* appears */
      .to(ghostGlassEl, { y: fromY - 34, scale: 1.08, duration: 0.32, ease: 'power2.out' }) /* picked up */
      .to(ghostGlassEl, { x: toX, keyframes: { y: [fromY - 34, midY, toY] },
        duration: 1.1, ease: 'power1.inOut' })                                    /* dragged to tray */
      .to(ghostGlassEl, { scale: 1, duration: 0.16, ease: 'power1.in' })          /* set down */
      .to(ghostGlassEl, { autoAlpha: 0, duration: 0.3 });                         /* released, fades */
  }

  function stopHandDemo() {
    if (ghostTl) { ghostTl.kill(); ghostTl = null; }
    if (ghostGlassEl) { ghostGlassEl.remove(); ghostGlassEl = null; }
  }

  /* spotlight one empty glass AND its matching (empty) tray — fired the moment
     Agni says "This glass is empty", so kids connect the word, the glowing
     glass, and the tray it belongs in all at once */
  function highlightEmptyGlass() {
    state.hintGlass = null;
    for (var i = 0; i < state.glasses.length; i++) {
      if (state.glasses[i].type === 'empty' && !state.glasses[i].placed) { state.hintGlass = state.glasses[i]; break; }
    }
    var g = state.hintGlass;
    if (!g) return;
    g.el.classList.add('highlight');
    gsap.to(g.img, { scale: 1.16, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    hintZone('empty');  /* the empty tray's plate glows together with the glass */
  }

  /* add the ghost drag demo for the hands-on step (glass + tray already glow) */
  function startSortHint() {
    if (!state.hintGlass || state.hintGlass.placed) highlightEmptyGlass();
    var g = state.hintGlass;
    if (!g) return;
    startHandDemo(g);
  }

  function stopSortHint() {
    state.glasses.forEach(function (g) {
      g.el.classList.remove('highlight');
      if (!g.placed) gsap.to(g.img, { scale: 1, duration: 0.25, overwrite: 'auto' });
    });
    state.hintGlass = null;
    clearZoneHints();
    stopHandDemo();
  }

  /* ---------- liquid splash transition ----------
     A juice wave floods up over the stage, midFn swaps the scene while
     everything is covered, then the wave keeps rising off the top. */
  /* droplets that burst outward as the splat hits */
  function spawnSplashDrops() {
    var splashEl = document.getElementById('splash');
    for (var i = 0; i < 16; i++) {
      var d = document.createElement('div');
      d.className = 'splash-drop';
      var size = gsap.utils.random(14, 42);
      d.style.width = size + 'px';
      d.style.height = size + 'px';
      splashEl.appendChild(d);
      var ang = gsap.utils.random(0, Math.PI * 2);
      var dist = gsap.utils.random(560, 1080);
      /* launch from the blob's expanding edge so drops spray ahead of it */
      gsap.fromTo(d, {
        x: 960 - size / 2 + Math.cos(ang) * 260,
        y: 540 - size / 2 + Math.sin(ang) * 200,
        scale: 0.6, opacity: 1
      }, {
        x: 960 - size / 2 + Math.cos(ang) * dist,
        y: 540 - size / 2 + Math.sin(ang) * dist * 0.7,
        scale: gsap.utils.random(0.5, 1.2),
        opacity: 0,
        duration: gsap.utils.random(0.4, 0.6),
        delay: gsap.utils.random(0.12, 0.3),
        ease: 'power2.out',
        onComplete: function (el) { el.remove(); },
        onCompleteParams: [d]
      });
    }
  }

  function splashTransition(midFn, afterFn) {
    SFX.play('splash');
    gsap.set('#splash', { display: 'block' });
    gsap.set('.wave', { y: -2150 }); /* parked out of sight until the drain */
    gsap.set('#splat', { scale: 0, rotation: -15, autoAlpha: 1, transformOrigin: '50% 50%' });
    spawnSplashDrops();
    gsap.timeline()
      /* the juice splat bursts from the centre and swallows the screen... */
      .to('#splat', { scale: 3.6, rotation: 8, duration: 0.65, ease: 'power3.in' }, 0.05)
      .to('#splat', { scale: 3.8, rotation: 10, duration: 0.22, ease: 'power1.out' })
      .add(function () { if (midFn) midFn(); })
      .to({}, { duration: 0.22 })
      .add(function () {
        /* ...then drains off the bottom (same pink, invisible swap) */
        gsap.set(['.wave-back', '.wave-front'], { y: -200 });
        gsap.set('#splat', { autoAlpha: 0 });
      })
      .to('.wave-back', { y: 1350, duration: 1.05, ease: 'power2.in' })
      .to('.wave-front', { y: 1350, duration: 1.05, ease: 'power2.in' }, '<0.12')
      .add(function () {
        gsap.set('#splash', { display: 'none' });
        if (afterFn) afterFn();
      });
  }

  /* ---------- phase 2: serving the customers ---------- */

  /* customers are served one at a time at the centre of the stand */
  var SERVE_X = 960;

  function customerHit(pt) {
    return state.active && Math.abs(pt.x - SERVE_X) < 230 && pt.y > 200 && pt.y < 660;
  }

  function phase2Intro() {
    SFX.play('win');
    confettiBurst(50);
    showTutMascot(TUT[3]); /* Agni: "Great job! Now let us serve our customers." */
    gsap.delayedCall(3.2, function () { hideTutMascot(); });
    gsap.delayedCall(3.6, transitionToPhase2);
  }

  function transitionToPhase2() {
    state.phase = 2;
    splashTransition(function () {
      /* the wave hides the whole swap */
      state.glasses.forEach(function (g) {
        gsap.killTweensOf(g.el);
        gsap.killTweensOf(g.img);
        g.el.remove();
      });
      state.glasses = [];
      gsap.set(['#trays', '#plaque-empty', '#plaque-half', '#plaque-full'], { autoAlpha: 0 });
      gsap.set(['#trays2', '#lemonbox', '#strawbox', '#plaque2-half', '#plaque2-full'],
        { autoAlpha: 1, x: 0, y: 0 });
      buildGlasses2();
      /* one shuffled deck of all six orders — well mixed, never runs dry */
      state.demandQueue = shuffle(['half', 'half', 'half', 'full', 'full', 'full']);
    }, function () {
      /* level 2 opens by asking the player to dress the drinks; no customer
         arrives until both the lemon and straw have been added. The boxes
         become tappable the moment Agni finishes saying the line. */
      showTutMascot(TUT[4], function () { /* "Tap the lemons and the straws." */
        state.locked = false; /* dialogue over — tap away! */
        tutLater(1.5, function () { hideTutMascot(); });
      });
      startGarnishNudge();   /* the garnish boxes glow & bob until tapped */
    });
  }

  /* one customer waddles in from the left to the centre of the stand */
  function walkIn(c, onArrive) {
    state.active = c;
    SFX.play('arrive');
    gsap.set(c.el, { autoAlpha: 1, x: -(c.center + 320), y: 0, rotation: 0, scaleY: 1 });
    var walk = 1.15;
    gsap.to(c.el, { x: SERVE_X - c.center, duration: walk, ease: 'power1.inOut' });
    gsap.to(c.el, { keyframes: { y: [0, -14, 0, -14, 0, -14, 0] }, duration: walk, ease: 'none' });
    gsap.to(c.el, {
      keyframes: { rotation: [0, -2, 2, -2, 2, 0] }, duration: walk, ease: 'none',
      onComplete: function () {
        /* gentle breathing while waiting (scaleY keeps y free for bounces) */
        gsap.to(c.el, {
          scaleY: 1.018, duration: gsap.utils.random(1.3, 1.8),
          yoyo: true, repeat: -1, ease: 'sine.inOut'
        });
        if (onArrive) onArrive();
      }
    });
  }

  /* ...and leaves to the right once served */
  function walkOut(c) {
    gsap.killTweensOf(c.el);
    gsap.set(c.el, { scaleY: 1 });
    var walk = 1.0;
    gsap.to(c.el, { x: (1920 + 400) - c.center, duration: walk, ease: 'power1.in' });
    gsap.to(c.el, { keyframes: { y: [0, -12, 0, -12, 0, -12, 0] }, duration: walk, ease: 'none' });
    gsap.to(c.el, {
      keyframes: { rotation: [0, 2, -2, 2, -2, 0] }, duration: walk, ease: 'none',
      onComplete: function () { gsap.set(c.el, { autoAlpha: 0 }); }
    });
  }

  function startRound() {
    if (!state.demandQueue.length) { finalWin(); return; }
    state.demand = null; /* no orders while the customer is still walking */
    state.wrongStreak = 0;
    clearServeHint();
    var pool = PHASE2.chars.filter(function (c) { return c !== state.lastChar; });
    var c = pool[Math.floor(Math.random() * pool.length)];
    state.lastChar = c;
    walkIn(c, function () {
      state.demand = state.demandQueue.shift();
      zoneCustomer.style.left = (SERVE_X - 220) + 'px';
      showDemandBubble(state.demand);
      SFX.play('ask');
    });
  }

  /* the designed order bubble: half/full glass artwork beside the customer */
  function showDemandBubble(type) {
    demandBubble.src = 'assets/img/bubble-' + type + '.webp';
    gsap.killTweensOf(demandBubble);
    gsap.set(demandBubble, { y: 0, rotation: 0 });
    gsap.fromTo(demandBubble, { autoAlpha: 0, scale: 0.3 },
      { autoAlpha: 1, scale: 1, duration: 0.45, ease: 'back.out(2.2)' });
    gsap.to(demandBubble, { y: -10, duration: 1.1, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 0.45 });
  }

  function hideDemandBubble() {
    gsap.killTweensOf(demandBubble);
    gsap.to(demandBubble, { autoAlpha: 0, scale: 0.5, duration: 0.3, ease: 'back.in(1.6)' });
  }

  /* the customer's coin arcs onto the counter, then is collected (vanishes).
     it lands on the clear left margin so it never overlaps the centred trays */
  function giveCoin() {
    state.coins += 1;
    var lx = gsap.utils.random(70, 220);
    var ly = gsap.utils.random(945, 1000);
    var coin = document.createElement('img');
    coin.src = 'assets/img/coins.webp';
    coin.className = 'coin-fly';
    stage.appendChild(coin);
    SFX.play('coin');
    gsap.timeline({ onComplete: function () { coin.remove(); } })
      .set(coin, { x: SERVE_X - 46, y: 430, scale: 0.4, autoAlpha: 0, transformOrigin: '50% 100%' })
      .to(coin, { autoAlpha: 1, scale: 1, duration: 0.2, ease: 'back.out(2)' })
      .to(coin, { keyframes: { y: [430, 300, ly] }, duration: 0.9, ease: 'power1.inOut' }, 0.25)
      .to(coin, { x: lx, rotation: gsap.utils.random(-20, 20), duration: 0.9, ease: 'power1.inOut' }, 0.25)
      .to(coin, { scaleY: 0.85, duration: 0.08, yoyo: true, repeat: 1, ease: 'power1.inOut' }, 1.15)
      /* collected! */
      .add(function () { burstSparks(lx + 46, ly + 30); }, '+=0.45')
      .to(coin, { autoAlpha: 0, scale: 0.45, y: '-=20', duration: 0.3, ease: 'power2.in' }, '<');
  }

  function serveGlass(g) {
    g.placed = true;
    var demanded = state.demand;
    state.demand = null; /* close the round */
    state.served += 1;
    hideDemandBubble();
    state.wrongStreak = 0;
    clearServeHint();

    /* first successful serve: Agni cheers, then steps aside for free play */
    if (!state.firstServeDone) {
      state.firstServeDone = true;
      gsap.delayedCall(0.8, function () {
        showTutMascot(TUT[5]); /* Agni: "Awesome! You are ready to serve everyone." */
      });
      gsap.delayedCall(4.2, function () { hideTutMascot(); });
    }

    var c = state.active;
    var tx = SERVE_X - (g.x + g.w / 2);
    var ty = 480 - (g.y + g.h);
    state.topZ += 1;
    g.el.style.zIndex = state.topZ;

    gsap.timeline({ onComplete: function () { g.el.remove(); } })
      .to(g.el, { x: tx, y: ty, scale: 0.85, duration: 0.45, ease: 'power2.inOut' })
      .to(g.el, { rotation: -28, duration: 0.25, ease: 'power1.inOut' })
      .to(g.el, { autoAlpha: 0, y: '-=12', duration: 0.3, ease: 'power1.in' }, '-=0.05')
      .add(function () {
        SFX.play('gulp');
        burstSparks(SERVE_X, 420);
      }, 0.45);

    /* happy customer wiggle, a grateful word, pays a coin, then off they waddle */
    gsap.to(c.el, { scaleY: 1.05, duration: 0.16, yoyo: true, repeat: 3, ease: 'sine.inOut', delay: 0.45 });
    gsap.delayedCall(0.6, function () { showServeFeedback(c); });
    gsap.delayedCall(0.8, giveCoin);
    gsap.delayedCall(2.1, function () { walkOut(c); });
    gsap.delayedCall(3.0, startRound);
  }

  /* the served customer beams a little thank-you bubble above their head */
  var serveBubble = document.getElementById('serve-bubble');
  function showServeFeedback(c) {
    serveBubble.textContent = SERVE_LINES[Math.floor(Math.random() * SERVE_LINES.length)];
    gsap.killTweensOf(serveBubble);
    /* the box art's tail sits at ~94% of its width (bottom-right corner), so
       shift the bubble left until the tail points at the customer's head */
    gsap.set(serveBubble, { visibility: 'visible', left: SERVE_X + 'px', xPercent: -94, transformOrigin: '94% 100%' });
    gsap.fromTo(serveBubble, { autoAlpha: 0, scale: 0.3, y: 22 },
      { autoAlpha: 1, scale: 1, y: 0, duration: 0.4, ease: 'back.out(2.4)' });
    SFX.play('happy');
    gsap.to(serveBubble, { autoAlpha: 0, scale: 0.6, duration: 0.3, delay: 1.5, ease: 'back.in(1.6)',
      onComplete: function () { gsap.set(serveBubble, { visibility: 'hidden' }); } });
  }

  /* glow + pulse the glasses that match the current order; fromTo keeps every
     glass in sync even if one had its pulse reset by a pick-up, and the gentle
     1.08 peak keeps the dressed glasses from crowding their neighbours */
  function hintServe() {
    state.glasses.forEach(function (g) {
      if (!g.placed && g.type === state.demand) {
        g.el.classList.add('highlight');
        gsap.killTweensOf(g.img, 'scale');
        gsap.fromTo(g.img, { scale: 1 },
          { scale: 1.08, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' });
      }
    });
  }

  function clearServeHint() {
    state.glasses.forEach(function (g) {
      g.el.classList.remove('highlight');
      gsap.killTweensOf(g.img, 'scale');
      gsap.to(g.img, { scale: 1, duration: 0.2, overwrite: 'auto' });
    });
  }

  function rejectServe(g) {
    SFX.play('wrong');
    /* the order bubble insists: emphatic shake + pulse */
    gsap.to(demandBubble, {
      keyframes: { rotation: [-6, 6, -4, 4, 0], scale: [1.15, 1.1, 1.05, 1] },
      duration: 0.55, ease: 'power1.out'
    });
    gsap.to(state.active.el, { keyframes: { rotation: [-4, 4, -3, 3, 0] }, duration: 0.5 });
    /* two misses in a row: pulse the right glasses and name the order */
    state.wrongStreak += 1;
    if (state.wrongStreak >= 2) {
      hintServe();
      agniSays('Pick a ' + TYPE_NAMES[state.demand] + ' glass.');
    }
    returnHome(g);
  }

  function finalWin() {
    state.locked = true;
    hideDemandBubble();
    stopGarnishNudge();
    SFX.play('kaching'); /* the till rings: all customers paid! */
    showWin();
  }

  /* pre-composed glass+garnish art with the exact placement inside the 92x136
     glass box (from tools/build-garnish.js). straw pokes above, lemon juts left. */
  var GARNISH_ART = {
    full: {
      straw: { src: 'assets/img/garnish-full-straw.webp', w: 102.2, h: 179.8, left: 1.2, top: -43.8 },
      lemon: { src: 'assets/img/garnish-full-lemon.webp', w: 108.1, h: 142.5, left: -17.4, top: -6.5 },
      both:  { src: 'assets/img/garnish-full-both.webp', w: 118.8, h: 179, left: -15.1, top: -43 }
    },
    half: {
      straw: { src: 'assets/img/garnish-half-straw.webp', w: 104.8, h: 182.7, left: 1.5, top: -46.7 },
      lemon: { src: 'assets/img/garnish-half-lemon.webp', w: 114.6, h: 147.3, left: -23.3, top: -11.3 },
      both:  { src: 'assets/img/garnish-half-both.webp', w: 127, h: 182.7, left: -20.7, top: -46.7 }
    }
  };
  // warm the browser cache so the swap is instant
  Object.keys(GARNISH_ART).forEach(function (t) {
    Object.keys(GARNISH_ART[t]).forEach(function (v) { new Image().src = GARNISH_ART[t][v].src; });
  });
  // ...and the phase-2 speech/order bubbles, so their first pop-in is instant
  ['assets/img/bubble-half.webp', 'assets/img/bubble-full.webp', 'assets/img/side-bubble.webp']
    .forEach(function (src) { new Image().src = src; });

  /* swap a glass to its composed garnish art, aligning the glass body exactly
     and popping the new garnish up from the glass base */
  function applyGarnishArt(g) {
    var variant = g.hasStraw && g.hasLemon ? 'both' : (g.hasStraw ? 'straw' : 'lemon');
    var art = GARNISH_ART[g.type] && GARNISH_ART[g.type][variant];
    if (!art) return;
    g.img.src = art.src;
    gsap.killTweensOf(g.img);
    var k = GLASS_ART_SCALE; /* config was measured for the 92px glass box */
    gsap.set(g.img, { position: 'absolute', left: art.left * k + 'px', top: art.top * k + 'px',
      width: art.w * k + 'px', height: art.h * k + 'px', transformOrigin: '50% 100%', rotation: 0 });
    gsap.fromTo(g.img, { scale: 0.82 }, { scale: 1, duration: 0.5, ease: 'back.out(2.2)' });
    burstSparks(g.x + g.w / 2, g.y + 6); /* sparkle at the rim */
  }

  /* nudge: the garnish boxes glow and gently bob so kids know to tap them
     before serving — each box stops once it's been used */
  function nudgeBox(id, on) {
    var el = document.getElementById(id);
    gsap.killTweensOf(el);
    if (on) {
      el.classList.add('nudge-glow');
      gsap.set(el, { transformOrigin: '50% 100%' });
      gsap.to(el, { scale: 1.05, duration: 0.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    } else {
      el.classList.remove('nudge-glow');
      gsap.to(el, { scale: 1, duration: 0.25, overwrite: 'auto' });
    }
  }
  function startGarnishNudge() { nudgeBox('lemonbox', true); nudgeBox('strawbox', true); }
  function stopGarnishNudge() { nudgeBox('lemonbox', false); nudgeBox('strawbox', false); }

  /* tapping a garnish box dresses every glass on the trays */
  function addGarnish(kind, boxEl) {
    if (state.phase !== 2 || state.locked) return;
    SFX.unlock();
    var flag = kind === 'straw' ? 'hasStraw' : 'hasLemon';
    /* this box has done its job — stop nudging it and give it a tap-pop */
    boxEl.classList.remove('nudge-glow');
    gsap.killTweensOf(boxEl);
    gsap.set(boxEl, { transformOrigin: '50% 100%' });
    gsap.fromTo(boxEl, { scale: 1 }, { scale: 1.08, duration: 0.12, yoyo: true, repeat: 1, ease: 'power1.inOut' });
    var added = 0;
    state.glasses.forEach(function (g, i) {
      if (g.placed || g[flag]) return;
      g[flag] = true;
      gsap.delayedCall(0.05 * added, function () { applyGarnishArt(g); });
      added += 1;
    });
    SFX.play(added ? 'garnish' : 'click');

    /* once both garnishes are on, clear the boxes away, centre the trays,
       let Agni cheer, and only THEN send in the first customer */
    if (kind === 'straw') state.strawTapped = true; else state.lemonTapped = true;
    if (state.strawTapped && state.lemonTapped && !state.traysCentered) {
      state.traysCentered = true;
      state.locked = true; /* hold serving until the cheer + walk-in finish */
      clearTutTimers(); /* cancel the intro bubble's pending hide — the cheer owns Agni now */
      gsap.delayedCall(0.35, centerServingTrays);
      gsap.delayedCall(1.1, function () {
        showTutMascot(TUT[5]); /* "Awesome! You are ready to serve everyone." */
      });
      gsap.delayedCall(4.8, function () { hideTutMascot(); });
      gsap.delayedCall(5.2, function () {
        state.firstServeDone = true; /* the cheer already played */
        state.locked = false;
        startRound();
      });
    }
  }

  /* remove the lemon/straw boxes and glide the Half + Full trays (with their
     plaques and glasses) so the pair sits centred on the stage */
  function centerServingTrays() {
    stopGarnishNudge();
    var dx = 960 - (PHASE2.trayCenters.half + PHASE2.trayCenters.full) / 2;
    gsap.to(['#lemonbox', '#strawbox'], {
      x: '-=460', autoAlpha: 0, duration: 0.5, ease: 'power2.in',
      onComplete: function () { gsap.set(['#lemonbox', '#strawbox'], { display: 'none' }); }
    });
    gsap.to(['#trays2', '#plaque2-half', '#plaque2-full'],
      { x: '+=' + dx, duration: 0.75, ease: 'power2.inOut' });
    state.glasses.forEach(function (g) {
      if (g.placed) return; /* served glasses are already gone */
      g.homeX += dx; /* so a rejected serve returns to the centred spot */
      gsap.to(g.el, { x: '+=' + dx, duration: 0.75, ease: 'power2.inOut' });
    });
    PHASE2.trayCenters.half += dx;
    PHASE2.trayCenters.full += dx;
  }
  document.getElementById('strawbox').addEventListener('pointerdown', function () {
    addGarnish('straw', this);
  });
  document.getElementById('lemonbox').addEventListener('pointerdown', function () {
    addGarnish('lemon', this);
  });

  function rejectGlass(g) {
    SFX.play('wrong');
    /* two misses in a row: the glass and its tray's brass plate glow, and a
       ghost glass demos the correct move — the scene itself stays bright */
    state.wrongStreak += 1;
    if (state.wrongStreak >= 2) {
      clearZoneHints();
      hintZone(g.type);
      g.el.classList.add('highlight');
      startHandDemo(g);
      agniSays('This glass is ' + TYPE_NAMES[g.type] + '. Put it in the correct tray.');
    }
    var cx = gsap.getProperty(g.el, 'x');
    gsap.timeline({ onComplete: function () { returnHome(g); } })
      .to(g.el, { keyframes: { x: [cx, cx - 20, cx + 16, cx - 10, cx + 6, cx] }, duration: 0.42, ease: 'power1.out' })
      .fromTo(g.img, { filter: 'brightness(1)' }, { filter: 'brightness(1.35)', duration: 0.1, yoyo: true, repeat: 1 }, 0);
  }

  function returnHome(g) {
    gsap.to(g.el, {
      x: g.homeX, y: 0, scale: 1, duration: 0.55, ease: 'power3.out',
      onComplete: function () {
        SFX.play('land');
        if (!g.placed) startIdle(g);
      }
    });
  }

  /* ---------- effects ---------- */

  function burstSparks(x, y) {
    for (var i = 0; i < 9; i++) {
      var s = document.createElement('div');
      s.className = 'spark';
      s.textContent = '✦';
      s.style.left = x + 'px';
      s.style.top = y + 'px';
      fxLayer.appendChild(s);
      var angle = (i / 9) * Math.PI * 2 + gsap.utils.random(-0.3, 0.3);
      var dist = gsap.utils.random(55, 130);
      gsap.fromTo(s, { scale: 0, x: 0, y: 0, rotation: gsap.utils.random(-90, 90) }, {
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist - 30,
        scale: gsap.utils.random(0.5, 1.2),
        rotation: '+=140',
        opacity: 0,
        duration: gsap.utils.random(0.6, 0.9),
        ease: 'power2.out',
        onComplete: function (el) { el.remove(); },
        onCompleteParams: [s]
      });
    }
  }

  function skySparkles() {
    for (var i = 0; i < 16; i++) {
      var s = document.createElement('div');
      s.className = 'sparkle';
      s.style.left = gsap.utils.random(120, 1800) + 'px';
      s.style.top = gsap.utils.random(70, 380) + 'px';
      document.getElementById('sky-sparkles').appendChild(s);
      gsap.to(s, {
        opacity: gsap.utils.random(0.5, 1),
        scale: gsap.utils.random(1, 2.4),
        duration: gsap.utils.random(0.8, 1.8),
        yoyo: true, repeat: -1, ease: 'sine.inOut',
        delay: gsap.utils.random(0, 2)
      });
    }
  }

  var CONFETTI_COLORS = ['#e23b4b', '#ffc93c', '#ff7bd1', '#7be0ff', '#b6f36a', '#ffa74f'];
  /* spooky-carnival confetti: friendly Halloween glyphs rain down mixed
     with a few colourful paper bits */
  var CONFETTI_GLYPHS = ['🎃', '👻', '🦇', '⭐', '🍬', '🍭'];

  function confettiBurst(count) {
    for (var i = 0; i < count; i++) {
      var c = document.createElement('div');
      c.className = 'confetti';
      if (Math.random() < 0.6) {
        /* themed glyph */
        c.textContent = gsap.utils.random(CONFETTI_GLYPHS);
        c.style.fontSize = gsap.utils.random(26, 48) + 'px';
        c.style.lineHeight = '1';
        c.style.filter = 'drop-shadow(0 2px 3px rgba(0, 0, 0, 0.35))';
      } else {
        /* colourful paper bit */
        c.style.width = gsap.utils.random(9, 16) + 'px';
        c.style.height = gsap.utils.random(9, 20) + 'px';
        c.style.background = gsap.utils.random(CONFETTI_COLORS);
        if (Math.random() < 0.35) c.style.borderRadius = '50%';
      }
      c.style.left = gsap.utils.random(0, 1920) + 'px';
      fxLayer.appendChild(c);
      gsap.to(c, {
        y: 1180,
        x: '+=' + gsap.utils.random(-260, 260),
        rotationX: gsap.utils.random(300, 900),
        rotationZ: gsap.utils.random(-360, 360),
        duration: gsap.utils.random(2.2, 4),
        delay: gsap.utils.random(0, 0.9),
        ease: 'power1.in',
        onComplete: function (el) { el.remove(); },
        onCompleteParams: [c]
      });
    }
  }

  /* ---------- win / replay ---------- */

  /* splash over the win screen, then reload to the title screen. the "?again"
     flag survives the reload so the title shows the "Play Again" button */
  var returning = false;
  function returnToTitle() {
    if (returning) return;
    returning = true;
    splashTransition(function () {
      /* assigning an identical search string does NOT navigate, so replays
         after the first one need an explicit reload */
      if (/[?&]again\b/.test(location.search)) location.reload();
      else location.search = '?again';
    }, null);
  }

  function showWin() {
    SFX.play('win');
    confettiBurst(90);
    gsap.set(winOverlay, { visibility: 'visible' });
    gsap.to(winOverlay, { opacity: 1, duration: 0.4 });
    gsap.fromTo('#win-bg', { scale: 1.06 }, { scale: 1, duration: 0.6, ease: 'power2.out' });
    gsap.delayedCall(1.4, function () { confettiBurst(60); });

    /* play the celebration once — WITH its own audio (the background music
       fades out so the video takes the stage); when it ends, back to the
       title screen. If the browser blocks audible playback, fall back to
       muted so the celebration always plays. */
    var winVideo = document.getElementById('win-bg');
    if (winVideo) {
      winVideo.addEventListener('ended', returnToTitle, { once: true });
      SFX.stopMusic();
      if (winVideo.play) {
        try {
          winVideo.currentTime = 0;
          winVideo.muted = false;
          winVideo.volume = 1;
          var pr = winVideo.play();
          if (pr && pr.catch) pr.catch(function () {
            winVideo.muted = true;
            var p2 = winVideo.play();
            if (p2 && p2.catch) p2.catch(function () {});
          });
        } catch (e) { /* poster stays as fallback */ }
      }
      /* safety net if the video can't autoplay or 'ended' never fires
         (the celebration runs ~4s) */
      gsap.delayedCall(5.5, returnToTitle);
    } else {
      gsap.delayedCall(3.5, returnToTitle);
    }
  }

  /* ---------- title screen ---------- */

  var titleScreen = document.getElementById('title-screen');
  var playBtn = document.getElementById('play-btn');
  var gameStarted = false;

  function showTitle() {
    /* returning from a win ("?again"): show the "Play Again" button instead */
    if (/[?&]again\b/.test(location.search)) {
      playBtn.classList.add('again');
      var pImg = playBtn.querySelector('img');
      pImg.src = 'assets/img/play-again.webp';
      pImg.alt = 'Play Again';
    }
    /* the title pops once and stays still — only the play button pulses */
    gsap.from(playBtn, { scale: 0, autoAlpha: 0, duration: 0.6, ease: 'back.out(2.2)', delay: 0.55 });
    gsap.to(playBtn, { scale: 1.07, duration: 0.8, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 1.2 });
  }

  playBtn.addEventListener('pointerdown', function () {
    if (gameStarted) return;
    gameStarted = true;
    SFX.unlock();
    SFX.play('click');
    gsap.killTweensOf(playBtn);
    gsap.to(playBtn, { scale: 0.85, duration: 0.12, yoyo: true, repeat: 1, ease: 'power2.inOut' });
    gsap.delayedCall(0.25, function () {
      splashTransition(function () {
        titleScreen.style.display = 'none';
        intro(); /* scene builds itself as the wave lifts */
      }, null);
    });
  });

  /* browsers only allow audio after a user gesture — unlock on the first one */
  document.addEventListener('pointerdown', function () { SFX.unlock(); }, { once: true });

  /* ---------- intro ---------- */

  function intro() {
    state.locked = true; /* no dragging until Agni finishes the tutorial */
    var tl = gsap.timeline();
    tl.from('#trays', { y: 220, autoAlpha: 0, duration: 0.7, ease: 'power3.out' }, 0.2)
      .from([plaqueEls.empty, plaqueEls.half, plaqueEls.full],
        { y: -40, autoAlpha: 0, scale: 0.6, duration: 0.55, ease: 'back.out(2)', stagger: 0.12 }, 0.55)
      .from(state.glasses.map(function (g) { return g.el; }),
        { scale: 0, duration: 0.5, ease: 'back.out(2.2)', stagger: 0.06 }, 0.8)
      .add(function () { state.glasses.forEach(startIdle); });

    /* Agni walks in and speaks every line, then steps aside for the hands-on
       step (all skipped if the player just dives in and drops a glass) */
    tutLater(0.9, function () { showTutMascot(TUT[0]); });
    tutLater(4.8, function () { showTutMascot(TUT[1]); });
    tutLater(8.2, function () {
      showTutMascot(TUT[2]);
      highlightEmptyGlass(); /* spotlight the empty glass + empty tray as Agni names it */
    });
    tutLater(12.0, function () {
      hideTutMascot();
      state.locked = false; /* dialogue over — hands on the glasses! */
      startSortHint();
    });
  }

  /* read-only handle for automated tests */
  window.__game = state;

  /* ---------- boot ---------- */

  fitStage();
  buildGlasses();
  skySparkles();
  if (/[?&]ss\b/.test(location.search)) {
    /* screenshot/test mode: skip the title and intro, show the resting state */
    titleScreen.style.display = 'none';
    state.glasses.forEach(startIdle);
  } else {
    showTitle();
  }
})();
