/* The Glass Half Full — carnival sorting game.
   Scene coordinates are in the fixed 1920x1080 design space; the stage is
   scaled to the window and pointer deltas are divided by that scale. */
(function () {
  'use strict';

  var GLASS_TYPES = {
    full:  { src: 'assets/img/glass-full.webp',  w: 92, h: 136 },
    half:  { src: 'assets/img/glass-half.webp',  w: 92, h: 137 },
    empty: { src: 'assets/img/glass-empty.webp', w: 92, h: 137 }
  };

  /* Shelf line-up from the Figma frame: 15 identical tumblers (5 of each
     fill level), evenly spaced from x=99 to x=1767. */
  var START_GLASSES = (function () {
    var seq = ['half', 'full', 'empty', 'empty', 'full', 'half', 'half', 'full',
      'empty', 'half', 'full', 'empty', 'half', 'full', 'empty'];
    return seq.map(function (type, i) {
      return { type: type, x: Math.round(99 + i * (1668 / 14)) };
    });
  })();
  var SHELF_BOTTOM = 621;

  /* Five landing spots per tray: one flat row, same baseline, evenly
     spaced — identical alignment on every tray, glasses at full size. */
  function rowSlots(gap) {
    return [-2, -1, 0, 1, 2].map(function (m) {
      return { dx: m * gap, bottom: 940, s: 1 };
    });
  }
  /* centerX values are measured from the tray artwork at the glass
     baseline (y=940), so each row sits dead-centre on its tray */
  var TRAYS = {
    empty: { zone: { x: 90,   y: 700, w: 550, h: 365 }, centerX: 360,  count: 0, slots: rowSlots(84) },
    half:  { zone: { x: 672,  y: 700, w: 578, h: 365 }, centerX: 957,  count: 0, slots: rowSlots(84) },
    full:  { zone: { x: 1290, y: 700, w: 550, h: 365 }, centerX: 1564, count: 0, slots: rowSlots(84) }
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
  var bannerText = document.getElementById('banner-text');
  var winOverlay = document.getElementById('win-overlay');
  var demandBubble = document.getElementById('demand-bubble');
  var banner = document.getElementById('phase-banner');
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
    'Making every drink one by one takes too much time.',
    'Let\'s keep similar drinks together!',
    'This glass is full. Put it in the correct tray.',
    'Great! Now let\'s serve our customers.',
    'Drag the correct drink to the customer.',
    'Awesome! You\'re ready to serve everyone!'
  ];

  var state = {
    glasses: [], placed: 0, topZ: 500, locked: false,
    phase: 1, served: 0, demand: null, active: null,
    stock: { half: 5, full: 5 }, demandQueue: [],
    firstSortDone: false, firstServeDone: false, tutTimers: [],
    wrongStreak: 0, coins: 0
  };

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---------- stage scaling ---------- */

  function fitStage() {
    stageScale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    gsap.set(stage, {
      scale: stageScale,
      x: (window.innerWidth - 1920 * stageScale) / 2,
      y: (window.innerHeight - 1080 * stageScale) / 2
    });
  }
  window.addEventListener('resize', fitStage);

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
      placed: false, drag: null,
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

  /* phase 2: the sorted half/full glasses reappear on the two serving trays */
  function buildGlasses2() {
    ['half', 'full'].forEach(function (type) {
      var spec = GLASS_TYPES[type];
      rowSlots(84).forEach(function (slot, i) {
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
      if (g.placed || state.locked) return;
      e.preventDefault();
      try { g.el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no active pointer */ }
      g.drag = {
        px: e.clientX, py: e.clientY,
        ox: gsap.getProperty(g.el, 'x'), oy: gsap.getProperty(g.el, 'y')
      };
      state.topZ += 1;
      g.el.style.zIndex = state.topZ;
      g.el.classList.add('dragging');
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
    state.placed += 1;

    /* first correct drop ends the sorting tutorial */
    var hadHint = state.wrongStreak >= 2;
    if (!state.firstSortDone) {
      state.firstSortDone = true;
      clearTutTimers();
      stopSortHint();
      agniSays('Sort the glasses into correct trays.');
    } else if (hadHint) {
      bannerText.textContent = 'Sort the glasses into correct trays.';
      gsap.fromTo(bannerText, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35 });
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

  function agniSays(text) {
    bannerText.textContent = text;
    gsap.fromTo(bannerText, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.35 });
    gsap.set('#mascot', { transformOrigin: '50% 90%' });
    gsap.fromTo('#mascot', { rotation: -4 }, {
      rotation: 4, duration: 0.12, yoyo: true, repeat: 5, ease: 'sine.inOut',
      onComplete: function () { gsap.set('#mascot', { rotation: 0 }); }
    });
    SFX.play('ask');
  }

  function tutLater(delay, fn) {
    state.tutTimers.push(gsap.delayedCall(delay, fn));
  }

  function clearTutTimers() {
    state.tutTimers.forEach(function (t) { t.kill(); });
    state.tutTimers = [];
  }

  /* glowing-tray hints (also used after two wrong attempts in a row) */
  function hintZone(type) {
    gsap.to(zoneEls[type], { opacity: 0.9, duration: 0.7, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  }

  function clearZoneHints() {
    for (var k in zoneEls) {
      gsap.killTweensOf(zoneEls[k]);
      gsap.to(zoneEls[k], { opacity: 0, duration: 0.25, overwrite: 'auto' });
    }
  }

  /* animated hand that demonstrates dragging the glass to its tray */
  var tutHand = document.getElementById('tut-hand');
  var handTl = null;

  function startHandDemo(g) {
    var fx = g.x + g.w / 2 - 24;
    var fy = g.y + g.h - 40;
    var tx = TRAYS[g.type].centerX - 24;
    var ty = 860;
    handTl = gsap.timeline({ repeat: -1, repeatDelay: 0.7 });
    handTl.set(tutHand, { x: fx, y: fy, scale: 1, autoAlpha: 0 })
      .to(tutHand, { autoAlpha: 1, duration: 0.25 })
      .to(tutHand, { scale: 0.8, duration: 0.18, ease: 'power2.out' }) /* press */
      .to(tutHand, { x: tx, y: ty, duration: 1.05, ease: 'power1.inOut' })
      .to(tutHand, { scale: 1, duration: 0.18 }) /* release */
      .to(tutHand, { autoAlpha: 0, duration: 0.25 });
  }

  function stopHandDemo() {
    if (handTl) { handTl.kill(); handTl = null; }
    gsap.to(tutHand, { autoAlpha: 0, duration: 0.2, overwrite: 'auto' });
  }

  /* pulse a full glass, glow its tray, and demonstrate the drag */
  function startSortHint() {
    var g = null;
    for (var i = 0; i < state.glasses.length; i++) {
      if (state.glasses[i].type === 'full' && !state.glasses[i].placed) { g = state.glasses[i]; break; }
    }
    if (!g) return;
    gsap.to(g.img, { scale: 1.14, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    hintZone('full');
    startHandDemo(g);
  }

  function stopSortHint() {
    state.glasses.forEach(function (g) {
      if (!g.placed) gsap.to(g.img, { scale: 1, duration: 0.25, overwrite: 'auto' });
    });
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
    banner.textContent = TUT[3]; /* "Great! Now let's serve our customers." */
    gsap.fromTo(banner, { autoAlpha: 0, scale: 0.4 },
      { autoAlpha: 1, scale: 1, duration: 0.5, ease: 'back.out(1.8)' });
    gsap.to(banner, {
      autoAlpha: 0, y: -50, delay: 1.6, duration: 0.4, ease: 'power2.in',
      onComplete: function () { gsap.set(banner, { y: 0 }); }
    });
    gsap.delayedCall(2.0, transitionToPhase2);
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
      /* one shuffled deck of all ten orders — well mixed, never runs dry */
      state.demandQueue = shuffle(['half', 'half', 'half', 'half', 'half',
        'full', 'full', 'full', 'full', 'full']);
    }, function () {
      state.locked = false;
      agniSays(TUT[4]); /* "Drag the correct drink to the customer." */
      gsap.delayedCall(0.4, startRound);
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
    if (bannerText.textContent === 'Pick a glowing glass from the tray!') {
      bannerText.textContent = 'Give each customer what they ask for!';
    }
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
    demandBubble.src = 'assets/img/bubble-' + type + '.svg';
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

  /* the customer's coin arcs onto the counter, then is collected (vanishes) */
  function giveCoin() {
    state.coins += 1;
    var lx = gsap.utils.random(180, 520);
    var ly = gsap.utils.random(945, 1005);
    var coin = document.createElement('img');
    coin.src = 'assets/img/coins.svg';
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
    state.stock[demanded] -= 1;
    state.served += 1;
    hideDemandBubble();
    state.wrongStreak = 0;
    clearServeHint();

    /* first successful serve: Agni cheers, then back to the standing tip */
    if (!state.firstServeDone) {
      state.firstServeDone = true;
      gsap.delayedCall(0.9, function () {
        agniSays(TUT[5]); /* "Awesome! You're ready to serve everyone!" */
      });
      gsap.delayedCall(3.6, function () {
        bannerText.textContent = 'Give each customer what they ask for!';
        gsap.fromTo(bannerText, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 });
      });
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

    /* happy customer wiggle, pays a coin, then off they waddle */
    gsap.to(c.el, { scaleY: 1.05, duration: 0.16, yoyo: true, repeat: 3, ease: 'sine.inOut', delay: 0.45 });
    gsap.delayedCall(0.8, giveCoin);
    gsap.delayedCall(2.1, function () { walkOut(c); });
    gsap.delayedCall(3.0, startRound);
  }

  /* pulse the glasses that match the current order */
  function hintServe() {
    state.glasses.forEach(function (g) {
      if (!g.placed && g.type === state.demand) {
        gsap.to(g.img, { scale: 1.14, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' });
      }
    });
  }

  function clearServeHint() {
    state.glasses.forEach(function (g) {
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
    /* two misses in a row: pulse the right glasses on the tray */
    state.wrongStreak += 1;
    if (state.wrongStreak >= 2) {
      hintServe();
      agniSays('Pick a glowing glass from the tray!');
    }
    returnHome(g);
  }

  function finalWin() {
    state.locked = true;
    hideDemandBubble();
    SFX.play('kaching'); /* the till rings: all customers paid! */
    document.querySelector('.win-inner p').textContent = 'You served all the customers!';
    showWin();
  }

  /* tapping a garnish box dresses every glass on the trays */
  function addGarnish(kind, boxEl) {
    if (state.phase !== 2 || state.locked) return;
    SFX.unlock();
    gsap.set(boxEl, { transformOrigin: '50% 100%' });
    gsap.fromTo(boxEl, { scale: 1 }, { scale: 1.08, duration: 0.12, yoyo: true, repeat: 1, ease: 'power1.inOut' });
    var added = 0;
    state.glasses.forEach(function (g) {
      if (g.placed || g.el.querySelector('.' + kind)) return;
      var img = document.createElement('img');
      img.src = 'assets/img/' + kind + '.webp';
      img.className = 'garnish ' + kind;
      g.el.appendChild(img);
      gsap.set(img, { transformOrigin: '50% 100%' });
      gsap.from(img, { scale: 0, rotation: -25, duration: 0.45, ease: 'back.out(2.5)', delay: 0.045 * added });
      added += 1;
    });
    SFX.play(added ? 'garnish' : 'click');
  }
  document.getElementById('strawbox').addEventListener('pointerdown', function () {
    addGarnish('straw', this);
  });
  document.getElementById('lemonbox').addEventListener('pointerdown', function () {
    addGarnish('lemon', this);
  });

  function rejectGlass(g) {
    SFX.play('wrong');
    /* two misses in a row: glow the tray this glass belongs to */
    state.wrongStreak += 1;
    if (state.wrongStreak >= 2) {
      clearZoneHints();
      hintZone(g.type);
      agniSays('Look! This glass goes in the glowing tray.');
    }
    var cx = gsap.getProperty(g.el, 'x');
    gsap.timeline({ onComplete: function () { returnHome(g); } })
      .to(g.el, { keyframes: { x: [cx, cx - 20, cx + 16, cx - 10, cx + 6, cx] }, duration: 0.42, ease: 'power1.out' })
      .fromTo(g.img, { filter: 'brightness(1)' }, { filter: 'brightness(1.35)', duration: 0.1, yoyo: true, repeat: 1 }, 0);
  }

  function returnHome(g) {
    gsap.to(g.el, {
      x: 0, y: 0, scale: 1, duration: 0.55, ease: 'power3.out',
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

  function confettiBurst(count) {
    for (var i = 0; i < count; i++) {
      var c = document.createElement('div');
      c.className = 'confetti';
      var w = gsap.utils.random(9, 16);
      c.style.width = w + 'px';
      c.style.height = gsap.utils.random(9, 20) + 'px';
      c.style.background = gsap.utils.random(CONFETTI_COLORS);
      c.style.left = gsap.utils.random(0, 1920) + 'px';
      if (Math.random() < 0.35) c.style.borderRadius = '50%';
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

  function showWin() {
    SFX.play('win');
    confettiBurst(90);
    gsap.set(winOverlay, { visibility: 'visible' });
    gsap.to(winOverlay, { opacity: 1, duration: 0.4 });
    gsap.fromTo('.win-inner h1', { scale: 0.3, rotation: -6 },
      { scale: 1, rotation: 0, duration: 0.7, ease: 'back.out(1.8)', delay: 0.15 });
    gsap.fromTo('.win-inner p', { autoAlpha: 0, y: 30 },
      { autoAlpha: 1, y: 0, duration: 0.5, delay: 0.5 });
    gsap.fromTo('#replay', { autoAlpha: 0, scale: 0.5 },
      { autoAlpha: 1, scale: 1, duration: 0.5, ease: 'back.out(2)', delay: 0.7 });
    gsap.delayedCall(1.4, function () { confettiBurst(60); });
  }

  document.getElementById('replay').addEventListener('click', function () {
    SFX.play('click');
    /* splash over the win screen, then a clean reload back to the title */
    splashTransition(function () { location.reload(); }, null);
  });

  /* ---------- title screen ---------- */

  var titleScreen = document.getElementById('title-screen');
  var playBtn = document.getElementById('play-btn');
  var gameStarted = false;

  function showTitle() {
    /* the title pops once and stays still — only the play button pulses */
    gsap.from('#game-title', { scale: 0.3, rotation: -4, autoAlpha: 0, duration: 0.7, ease: 'back.out(1.6)', delay: 0.15 });
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
    bannerText.textContent = TUT[0];
    var tl = gsap.timeline();
    tl.from('#trays', { y: 220, autoAlpha: 0, duration: 0.7, ease: 'power3.out' }, 0.2)
      .from([plaqueEls.empty, plaqueEls.half, plaqueEls.full],
        { y: -40, autoAlpha: 0, scale: 0.6, duration: 0.55, ease: 'back.out(2)', stagger: 0.12 }, 0.55)
      .from(state.glasses.map(function (g) { return g.el; }),
        { scale: 0, duration: 0.5, ease: 'back.out(2.2)', stagger: 0.06 }, 0.8)
      .add(function () { state.glasses.forEach(startIdle); })
      .from('#banner', { y: -230, autoAlpha: 0, duration: 0.6, ease: 'power3.out' }, 0.15);

    /* Agni talks the player through it (skipped early if they just dive in) */
    tutLater(0.9, function () { agniSays(TUT[0]); });
    tutLater(3.5, function () { agniSays(TUT[1]); });
    tutLater(6.0, function () {
      agniSays(TUT[2]);
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
