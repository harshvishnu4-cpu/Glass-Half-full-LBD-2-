/* The Glass Half Full — carnival sorting game.
   Scene coordinates are in the fixed 1920x1080 design space; the stage is
   scaled to the window and pointer deltas are divided by that scale. */
(function () {
  'use strict';

  /* every dynamically-set asset src goes through the preloader's blob map,
     so once loading finishes nothing touches the network again */
  function ASSET(u) { return window.PRELOAD ? window.PRELOAD.url(u) : u; }

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
  /* cut-out tray art laid over the scene layer, lit up for hints */
  var trayGlowEls = {
    empty: document.getElementById('glow-empty'),
    half: document.getElementById('glow-half'),
    full: document.getElementById('glow-full')
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

  /* recorded voice-over for every line Agni speaks, keyed by the exact text;
     the clip plays as the line types out (and replaces the typing blips) */
  var VO = {
    'Making every drink takes too long.': 'audio/vo-too-long.ogg',
    'Let us sort the glasses into trays.': 'audio/vo-sort-trays.ogg',
    'This glass is empty. Put it in the correct tray.': 'audio/vo-glass-empty.ogg',
    'This glass is half full. Put it in the correct tray.': 'audio/vo-glass-half.ogg',
    'This glass is full. Put it in the correct tray.': 'audio/vo-glass-full.ogg',
    'Sort the rest of the glasses.': 'audio/vo-sort-rest.ogg',
    'Great job! Now let us serve our customers.': 'audio/vo-serve-customers.ogg',
    'Tap the lemons and the straws.': 'audio/vo-tap-garnish.ogg',
    'Awesome! You are ready to serve everyone.': 'audio/vo-ready.ogg',
    'Pick a half full glass.': 'audio/vo-pick-half.ogg',
    'Pick a full glass.': 'audio/vo-pick-full.ogg'
  };

  /* spooky-but-sweet things the customers say when they get their drink */
  var SERVE_LINES = ['Boo-licious!', 'Fang-tastic!', 'Spook-tacular!', 'Ghoulishly good!', 'Monster yummy!', 'Eek, tasty!'];

  var state = {
    glasses: [], placed: 0, topZ: 500, locked: false,
    phase: 1, served: 0, demand: null, active: null,
    demandQueue: [], queue: [], speaking: false,
    firstSortDone: false, tutTimers: [],
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
    img.src = ASSET(spec.src);
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

  /* Hover feedback while dragging. pointermove fires dozens of times a
     second, so only retween when the hovered target actually changes —
     rebuilding these tweens every event was the most expensive thing
     happening during a drag. */
  var hoverZone = null, hoverCustomer = false;
  function highlightZone(key) {
    if (key === hoverZone) return;
    hoverZone = key;
    for (var k in zoneEls) {
      gsap.to(zoneEls[k], { opacity: k === key ? 1 : 0, duration: 0.2, overwrite: 'auto' });
    }
  }

  function highlightCustomer(on) {
    if (on === hoverCustomer) return;
    hoverCustomer = on;
    gsap.to(zoneCustomer, { opacity: on ? 1 : 0, duration: 0.2, overwrite: 'auto' });
  }

  function makeDraggable(g) {
    g.el.addEventListener('pointerdown', function (e) {
      /* g.drag guard: a second finger on the same glass must not re-grab it
         (it would re-capture the pointer and make the glass jump).
         state.speaking: while ANY of Agni's lines is mid-type or mid-speech the
         glasses ignore the hand — dialogue first, hands after. Every line gates
         itself (see showTutMascot), so no caller can forget to lock. */
      if (g.placed || state.locked || state.speaking || g.drag) return;
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
      /* autoAlpha too: this kill would otherwise wipe out the fade-back that
         stopHandDemo just started, stranding a demoed glass half-faded */
      gsap.to(g.img, { rotation: 0, scale: 1, autoAlpha: 1, duration: 0.2 });
    });

    g.el.addEventListener('pointermove', function (e) {
      if (!g.drag) return;
      g.setX(g.drag.ox + (e.clientX - g.drag.px) / stageScale);
      g.setY(g.drag.oy + (e.clientY - g.drag.py) / stageScale);
      if (state.phase === 2) {
        highlightCustomer(!!(state.demand && customerHit(glassCenter(g))));
      } else {
        highlightZone(zoneAt(glassCenter(g)));
      }
    });

    function release(e) {
      if (!g.drag) return;
      g.drag = null;
      g.el.classList.remove('dragging');
      highlightZone(null);
      highlightCustomer(false);
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
    /* a correct drop resets the streak, so any glass still pulsing from an
       earlier miss settles back down */
    state.glasses.forEach(function (o) {
      if (o.placed) return;
      o.el.classList.remove('highlight');
      gsap.killTweensOf(o.img, 'scale');
      gsap.to(o.img, { scale: 1, duration: 0.25, overwrite: 'auto' });
    });

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
  function agniSays(text, voText) {
    if (hintTimer) hintTimer.kill();
    clearTutTimers();
    showTutMascot(text, null, null, voText);
    hintTimer = gsap.delayedCall(4.5, function () { hideTutMascot(); }); /* long enough for the spoken line */
  }

  function tutLater(delay, fn) {
    state.tutTimers.push(gsap.delayedCall(delay, fn));
  }

  /* ---------- inactivity nudge ----------
     if the player goes quiet while the game is waiting on them, the glasses
     start pulsing to draw the eye back (and repeat if they stay idle).
     Deliberately just the pulse: running the ghost demo here as well put two
     competing animations on screen at once. */
  var IDLE_DELAY = 12;   /* seconds of no input; wanted in the 10-15s band */
  var idleCall = null, idleWatch = false, idlePulsed = [];

  /* the nudge is over the moment they touch anything */
  function clearIdlePulse() {
    if (!idlePulsed.length) return;
    var list = idlePulsed;
    idlePulsed = [];
    list.forEach(function (g) {
      g.el.classList.remove('highlight');
      gsap.killTweensOf(g.img, 'scale');
      gsap.to(g.img, { scale: 1, duration: 0.2, overwrite: 'auto' });
    });
  }

  function armIdleNudge() {
    clearIdlePulse();
    if (!idleWatch) return; /* nothing to nudge on the title or win screen */
    if (idleCall) idleCall.kill();
    idleCall = gsap.delayedCall(IDLE_DELAY, idleNudge);
  }
  function startIdleWatch() { idleWatch = true; armIdleNudge(); }
  function stopIdleWatch() {
    idleWatch = false;
    clearIdlePulse();
    if (idleCall) { idleCall.kill(); idleCall = null; }
  }
  function idleNudge() {
    armIdleNudge(); /* keep watching — nudge again if they stay idle */
    if (state.locked) return;
    var list = [], i;
    if (state.phase === 1) {
      /* sorting: one glass is enough to say "pick one of these up" */
      if (state.placed >= START_GLASSES.length) return;
      for (i = 0; i < state.glasses.length; i++) {
        if (!state.glasses[i].placed) { list.push(state.glasses[i]); break; }
      }
    } else if (state.strawTapped && state.lemonTapped && state.demand) {
      /* serving: EVERY glass left on the trays, not just the ones matching the
         order — pulsing only the correct set would hand over the answer, and
         answering is what the two-miss hint is for. This only says "these are
         the things you can drag". */
      for (i = 0; i < state.glasses.length; i++) {
        if (!state.glasses[i].placed) list.push(state.glasses[i]);
      }
    }
    /* garnish step needs nothing extra — the untapped boxes already glow */
    if (!list.length) return;
    /* clear whatever the tutorial or an earlier miss left running, so the idle
       state is only ever this pulse and nothing else */
    stopSortHint();
    idlePulsed = list;
    list.forEach(pulseGlass);
  }
  document.addEventListener('pointerdown', armIdleNudge);

  /* Agni carries every line of guidance (design node 670:1298) */
  var qbar = document.getElementById('agni');
  var agniImg = document.getElementById('agni-img');
  var agniBubble = document.getElementById('agni-bubble');
  var tutMascotText = document.getElementById('agni-text');
  var tutMascotIn = false;
  var typeCall = null;
  var voCall = null, lineVoiced = false;

  /* schedule the line's recorded voice to start alongside the typing;
     any not-yet-started clip from a previous line is cancelled */
  function speakLine(text, delay) {
    if (voCall) { voCall.kill(); voCall = null; }
    lineVoiced = !!VO[text];
    if (!lineVoiced) return;
    voCall = gsap.delayedCall(delay, function () {
      voCall = null;
      SFX.voice(VO[text]);
    });
  }

  /* reveal the line one character at a time, with a soft blip per letter.
     onDone (optional) fires the moment the full line has been typed; marks
     (optional) is a list of {at, fn} fired as the typing reaches that
     character, so a cue can land on the words that describe it; voText
     (optional) is the spoken line when it differs from the shown one. */
  var TYPE_CHAR = 0.045, TYPE_SPACE = 0.02;   /* unvoiced fallback rate */

  /* Letters are paced to the recorded voice rather than a fixed rate: at the
     flat 45ms/char the bubble finished about twice as early as Agni's clip and
     then sat there fully typed while he was still talking. When the bubble
     shows only part of the spoken line (the wrong-drop nudge shows just the
     naming sentence), take that line's share of the clip. */
  function typeRate(text, voSrc, voText) {
    var chars = 0, spaces = 0;
    for (var i = 0; i < text.length; i++) {
      if (text.charAt(i) === ' ') spaces++; else chars++;
    }
    var natural = chars * TYPE_CHAR + spaces * TYPE_SPACE;
    var dur = SFX.voiceDuration(voSrc);
    if (!dur || !natural) return { ch: TYPE_CHAR, sp: TYPE_SPACE };
    var share = (voText && voText !== text) ? text.length / voText.length : 1;
    /* finish just shy of the clip so the last word lands with his voice */
    var k = gsap.utils.clamp(0.8, 4, dur * 0.9 * share / natural);
    return { ch: TYPE_CHAR * k, sp: TYPE_SPACE * k };
  }

  function typewrite(text, startDelay, onDone, marks, voText) {
    if (typeCall) { typeCall.kill(); typeCall = null; }
    tutMascotText.textContent = '';
    var pending = marks ? marks.slice() : null;
    var rate = typeRate(text, VO[voText || text], voText);
    var i = 0;
    function step() {
      while (pending && pending.length && pending[0].at <= i) pending.shift().fn();
      if (i >= text.length) {
        typeCall = null;
        if (onDone) onDone();
        return;
      }
      var ch = text.charAt(i);
      tutMascotText.textContent += ch;
      i += 1;
      if (ch !== ' ' && !lineVoiced) SFX.play('type'); /* the voice-over replaces the blips */
      typeCall = gsap.delayedCall(ch === ' ' ? rate.sp : rate.ch, step);
    }
    typeCall = gsap.delayedCall(startDelay || 0, step);
  }

  /* Typing has finished; wait out the tail of the recorded clip (typing is
     paced to land at 0.9x the clip, so a little speech is always left), then
     release the player's hands and hand the moment to the caller. The 2s cap
     means a clip that never reports finishing cannot lock the game for good. */
  var speakRelease = null;
  function lineDone(onDone) {
    var waited = 0;
    (function wait() {
      if (SFX.voicePlaying() && waited < 2) {
        waited += 0.12;
        speakRelease = gsap.delayedCall(0.12, wait);
        return;
      }
      speakRelease = null;
      state.speaking = false; /* dialogue over — the hands come back */
      if (onDone) onDone();
    })();
  }

  /* voText: the recorded line, when the bubble shows less than he says.
     EVERY line locks the glasses while it runs (state.speaking) and releases
     them when it has been fully typed AND spoken — so dialogue always finishes
     before the player can act, no matter which caller started it. onDone
     (optional) fires at that same released moment, never mid-line. */
  function showTutMascot(text, onDone, marks, voText) {
    /* one message at a time: the order bubble would sit behind the bar, so
       it steps aside while Agni talks and comes back when he is done */
    if (state.phase === 2 && state.demand && !demandHiddenByBar) {
      demandHiddenByBar = true;
      hideDemandBubble();
    }
    /* a superseded line hands the gate to this one (its release must not fire) */
    if (speakRelease) { speakRelease.kill(); speakRelease = null; }
    state.speaking = true;
    var handOver = function () { lineDone(onDone); };
    if (!tutMascotIn) {
      tutMascotIn = true;
      SFX.play('ask');
      /* Agni leans in around the left post, then his bubble pops open */
      gsap.set(qbar, { visibility: 'visible' });
      gsap.fromTo(agniImg, { x: -300, autoAlpha: 0 },
        { x: 0, autoAlpha: 1, duration: 0.55, ease: 'power3.out' });
      gsap.fromTo(agniBubble, { autoAlpha: 0, scale: 0.4 },
        { autoAlpha: 1, scale: 1, duration: 0.45, ease: 'back.out(2)', delay: 0.3,
          transformOrigin: '0% 100%' }); /* grows out of the tail, by his head */
      speakLine(voText || text, 0.65);
      typewrite(text, 0.65, handOver, marks, voText); /* type once the bubble is open */
    } else {
      /* already on screen — the bubble pops and the new line types in */
      SFX.play('ask');
      gsap.fromTo(agniBubble, { scale: 0.94 },
        { scale: 1, duration: 0.3, ease: 'back.out(2.4)', transformOrigin: '0% 100%' });
      speakLine(voText || text, 0.2);
      typewrite(text, 0.2, handOver, marks, voText);
    }
    /* friendly wiggle as he talks */
    gsap.fromTo(agniImg, { rotation: -1.6 },
      { rotation: 1.6, duration: 0.16, yoyo: true, repeat: 3, ease: 'sine.inOut',
        transformOrigin: '20% 100%',
        onComplete: function () { gsap.set(agniImg, { rotation: 0 }); } });
  }

  function hideTutMascot() {
    if (typeCall) { typeCall.kill(); typeCall = null; }
    /* a dismissed line no longer gates the hands (e.g. the player earned the
       dismissal by serving correctly while the thank-you was still up) */
    if (speakRelease) { speakRelease.kill(); speakRelease = null; }
    state.speaking = false;
    /* a clip that has not started yet must not speak after the bar leaves
       (one already playing is left to finish naturally — no mid-word cuts) */
    if (voCall) { voCall.kill(); voCall = null; }
    /* the bar is out of the way — the customer's order can come back */
    if (demandHiddenByBar) {
      demandHiddenByBar = false;
      if (state.demand) showDemandBubble(state.demand);
    }
    if (!tutMascotIn) return;
    tutMascotIn = false;
    gsap.to(agniBubble, { autoAlpha: 0, scale: 0.5, duration: 0.25, ease: 'back.in(1.6)',
      transformOrigin: '0% 100%' });
    gsap.to(agniImg, { x: -300, autoAlpha: 0, duration: 0.45, ease: 'power2.in', delay: 0.1,
      onComplete: function () { gsap.set(qbar, { visibility: 'hidden' }); } });
  }

  function clearTutTimers() {
    state.tutTimers.forEach(function (t) { t.kill(); });
    state.tutTimers = [];
  }

  /* glowing-tray hints (also used after three wrong attempts in a row) */
  function hintZone(type) {
    /* the target tray itself lights up and pulses — the rest of the
       scene stays exactly as it is */
    if (trayGlowEls[type]) trayGlowEls[type].classList.add('on');
  }

  function clearZoneHints() {
    stopHandDemo();
    hoverZone = null; /* these zones are being faded out behind highlightZone's back */
    for (var k in zoneEls) {
      if (trayGlowEls[k]) trayGlowEls[k].classList.remove('on');
      gsap.killTweensOf(zoneEls[k]);
      gsap.to(zoneEls[k], { opacity: 0, duration: 0.25, overwrite: 'auto' });
    }
  }

  /* a translucent "ghost" of the glass lifts and glides to its tray, on a
     loop, so the player sees the glass is draggable and where it goes */
  var ghostTl = null, ghostGlassEl = null, ghostGlass = null;

  function startHandDemo(g) {
    stopHandDemo();
    ghostGlass = g;
    var spec = GLASS_TYPES[g.type];
    ghostGlassEl = document.createElement('img');
    ghostGlassEl.src = ASSET(spec.src);
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
      /* the phantom takes over from the real glass on the spot — the glass
         hands off completely (a partly-faded one read as a grey shadow left
         behind), so the demo is simply the glass lifting and flying to its
         tray, and it is back home as the phantom lands */
      .to(ghostGlassEl, { autoAlpha: 0.95, duration: 0.32 })
      .to(g.img, { autoAlpha: 0, duration: 0.32 }, '<')
      .to(ghostGlassEl, { y: fromY - 34, scale: 1.08, duration: 0.32, ease: 'power2.out' }) /* picked up */
      .to(ghostGlassEl, { x: toX, keyframes: { y: [fromY - 34, midY, toY] },
        duration: 1.1, ease: 'power1.inOut' })                                    /* dragged to tray */
      .to(ghostGlassEl, { scale: 1, duration: 0.16, ease: 'power1.in' })          /* set down */
      .to(ghostGlassEl, { autoAlpha: 0, duration: 0.32 })                         /* released, fades */
      .to(g.img, { autoAlpha: 1, duration: 0.32 }, '<');
  }

  function stopHandDemo() {
    if (ghostTl) { ghostTl.kill(); ghostTl = null; }
    if (ghostGlassEl) { ghostGlassEl.remove(); ghostGlassEl = null; }
    /* whatever the loop was mid-way through, the real glass comes back */
    if (ghostGlass) {
      gsap.to(ghostGlass.img, { autoAlpha: 1, duration: 0.2, overwrite: 'auto' });
      ghostGlass = null;
    }
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
    /* same gentle 1.12 peak the miss hints use — a bigger one made this glass
       balloon out of the row and read as the odd one out */
    gsap.to(g.img, { scale: 1.12, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    /* the tray is NOT lit here — it joins in only when Agni reaches the words
       "Put it in the correct tray" (see the typewriter mark in intro) */
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

  /* Customers form a QUEUE: they walk in from the RIGHT, wait their turn in
     line, are served at the centre of the stand, then head off to the LEFT while
     everyone behind shuffles up a place and a new face joins the back. The
     counter is never empty between orders, which reads as a busy stall rather
     than one customer at a time with a gap in between.
     QUEUE_SLOTS are the x-centres of each place in the line; [0] is the counter. */
  var SERVE_X = 960;
  var QUEUE_SLOTS = [SERVE_X, 1330, 1650];
  var OFF_RIGHT = 2320;   /* x-centre off the right edge, behind the stall post */
  var OFF_LEFT = -400;    /* ...and off the left */

  function customerHit(pt) {
    /* only the customer AT the counter can be served — the ones queueing behind
       are well outside this box (the next slot is 370px away) */
    return state.active && Math.abs(pt.x - SERVE_X) < 230 && pt.y > 200 && pt.y < 660;
  }

  function phase2Intro() {
    SFX.play('win');
    confettiBurst(50);
    showTutMascot(TUT[3]); /* Agni: "Great job! Now let us serve our customers." */
    gsap.delayedCall(4.6, function () { hideTutMascot(); }); /* the spoken line runs ~4.6s in */
    gsap.delayedCall(5.0, transitionToPhase2);
  }

  function transitionToPhase2() {
    state.phase = 2;
    splashTransition(function () {
      /* the wave hides the whole swap */
      stopHandDemo(); /* never leave a phantom looping over the new scene */
      state.glasses.forEach(function (g) {
        gsap.killTweensOf(g.el);
        gsap.killTweensOf(g.img);
        g.el.remove();
      });
      state.glasses = [];
      gsap.set(['#trays', '#plaque-empty', '#plaque-half', '#plaque-full'], { autoAlpha: 0 });
      gsap.set(['#trays2', '#lemonbox', '#strawbox'], { autoAlpha: 1, x: 0, y: 0 });
      buildGlasses2();
      /* one shuffled deck of all six orders — well mixed, never runs dry */
      state.demandQueue = shuffle(['half', 'half', 'half', 'full', 'full', 'full']);
    }, function () {
      /* level 2 opens by asking the player to dress the drinks; no customer
         arrives until both the lemon and straw have been added. The boxes
         become tappable the moment Agni finishes saying the line. */
      showTutMascot(TUT[4], function () { /* "Tap the lemons and the straws." */
        state.locked = false; /* line fully typed and spoken — tap away! */
        tutLater(1.5, function () { hideTutMascot(); });
      });
      startGarnishNudge();   /* the garnish boxes glow & bob until tapped */
    });
  }

  /* waddle a customer to an x-centre and settle them there */
  function walkTo(c, centreX, dur, onArrive) {
    gsap.killTweensOf(c.el);
    gsap.set(c.el, { scaleY: 1 });
    gsap.to(c.el, { x: centreX - c.center, duration: dur, ease: 'power1.inOut' });
    gsap.to(c.el, { keyframes: { y: [0, -14, 0, -14, 0, -14, 0] }, duration: dur, ease: 'none' });
    gsap.to(c.el, {
      keyframes: { rotation: [0, -2, 2, -2, 2, 0] }, duration: dur, ease: 'none',
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

  /* ...and off to the LEFT once served, freeing the sprite for reuse */
  function walkOff(c) {
    gsap.killTweensOf(c.el);
    gsap.set(c.el, { scaleY: 1 });
    var walk = 1.0;
    gsap.to(c.el, { x: OFF_LEFT - c.center, duration: walk, ease: 'power1.in' });
    gsap.to(c.el, { keyframes: { y: [0, -12, 0, -12, 0, -12, 0] }, duration: walk, ease: 'none' });
    gsap.to(c.el, {
      keyframes: { rotation: [0, 2, -2, 2, -2, 0] }, duration: walk, ease: 'none',
      onComplete: function () {
        gsap.set(c.el, { autoAlpha: 0 });
        c.busy = false;   /* this face can join the back of the line again */
      }
    });
  }

  /* the customer standing at the counter places their order */
  function frontReady(c) {
    if (state.queue[0] !== c || state.demand) return;
    state.active = c;
    state.demand = c.order;
    state.wrongStreak = 0;
    demandHiddenByBar = false;
    zoneCustomer.style.left = (SERVE_X - 220) + 'px';
    showDemandBubble(state.demand);
    SFX.play('ask');
  }

  /* a new face walks in from the right and takes the last free place. Each one
     carries the order they will ask for, so the line is a real queue of orders
     rather than a single order handed out on arrival. */
  function spawnCustomer() {
    if (!state.demandQueue.length || state.queue.length >= QUEUE_SLOTS.length) return;
    var pool = PHASE2.chars.filter(function (c) { return !c.busy; });
    if (!pool.length) return;
    var c = pool[Math.floor(Math.random() * pool.length)];
    c.busy = true;
    c.order = state.demandQueue.shift();
    state.queue.push(c);
    var slot = state.queue.length - 1;
    SFX.play('arrive');
    gsap.set(c.el, { autoAlpha: 1, x: OFF_RIGHT - c.center, y: 0, rotation: 0, scaleY: 1 });
    walkTo(c, QUEUE_SLOTS[slot], slot === 0 ? 1.15 : 1.3, function () { frontReady(c); });
  }

  /* top the line back up to a full house, staggered so they arrive one by one */
  function fillQueue() {
    var need = QUEUE_SLOTS.length - state.queue.length;
    for (var i = 0; i < need; i++) gsap.delayedCall(i * 0.5, spawnCustomer);
  }

  function startServing() {
    state.demand = null;
    state.wrongStreak = 0;
    demandHiddenByBar = false;
    hideTutMascot();     /* clean slate at the top of the screen for the new order */
    clearServeHint();
    fillQueue();
  }

  /* The served customer leaves at once; the line steps up separately, hung off
     the coin reward finishing (see stepUpQueue / rewardCoins). Every earlier
     attempt at this used a tuned delay and got the ordering subtly wrong — the
     arrival landed on the collection, then merely overlapped its fade. */
  var STEP_UP_WALK = 0.6;

  /* the served customer heads off; the line does NOT move yet */
  function departServed(served) {
    var i = state.queue.indexOf(served);
    if (i !== -1) state.queue.splice(i, 1);
    walkOff(served);
  }

  /* Runs from rewardCoins' completion hook — i.e. the moment the coins have
     finished dissolving. Driving the step-up off the reward itself (rather than
     a delay tuned to match it) is what guarantees the payment is off screen
     before the next customer so much as starts walking. */
  function stepUpQueue() {
    state.queue.forEach(function (c, n) {
      walkTo(c, QUEUE_SLOTS[n], STEP_UP_WALK, function () { frontReady(c); });
    });
    gsap.delayedCall(0.3, spawnCustomer);
    /* nobody left waiting and no orders to come — that was the last customer */
    if (!state.queue.length && !state.demandQueue.length) gsap.delayedCall(0.9, finalWin);
  }

  /* the designed order bubble: half/full glass artwork beside the customer.
     It shares the top of the screen with the question bar, so it yields to
     the bar while Agni is speaking (see showTutMascot). */
  var demandHiddenByBar = false;
  function showDemandBubble(type) {
    /* set directly rather than through the preloader's swap, so carry its
       fallback too: if the local blob ever fails to decode, reload the real
       file instead of leaving the customer with a broken order */
    var path = 'assets/img/bubble-' + type + '.svg';
    demandBubble.onerror = function () {
      demandBubble.onerror = null;
      if (demandBubble.getAttribute('src') !== path) demandBubble.src = path;
    };
    demandBubble.src = ASSET(path);
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

  /* ---------- the coin reward (ported from coin-reward.md) ----------
     The pile MATERIALISES on the counter with a bouncy overshoot, holds fully
     visible, then floats up and dissolves. It is not thrown or carried: tying
     the money sound to the money VISUAL — the register rings exactly as the
     pile lands, not when the drink was handed over a second earlier — is what
     makes the payment read.

     Timings and easing are the reference's; the implementation is GSAP rather
     than CSS keyframes + setTimeout so it shares the rest of the game's
     timeline (and its pause/kill behaviour) instead of needing stored timeout
     handles and a reflow hack to restart. Each reward is its own element with
     its own timeline, so back-to-back rewards cannot fight over shared state.

       0.00s  pile pops in   0.4 -> 1.14 overshoot -> 1     (450ms)
       0.45s  holds fully visible on the counter            (450ms)
       0.90s  floats up ~45% of its height, scales to 1.1,
              dissolves                                     (700ms)
       1.60s  gone -> onGone fires

     onGone is the rhythm marker for "transaction complete, next customer" —
     advanceQueue hangs the whole queue step-up off it, so the line can never
     start moving while money is still on screen. */
  var COIN_H = 62;                 /* 92px wide / 184x123 art => 62 tall */
  var COIN_LAND = 0.45, COIN_SETTLE = 0.45, COIN_FADE = 0.7;

  function rewardCoins(onGone) {
    state.coins += 1;
    var coin = document.createElement('img');
    coin.src = ASSET('assets/img/coins.webp');
    coin.className = 'coin-fly';
    stage.appendChild(coin);
    /* one fixed payment spot: centred on the serve spot with its BASE on
       SHELF_BOTTOM, the line the glasses stand on, so the pile sits on the
       counter top. transformOrigin at the base keeps it planted there while
       it pops — scaling about the centre would sink it into the wood. */
    gsap.set(coin, {
      x: SERVE_X - 46, y: SHELF_BOTTOM - COIN_H,
      scale: 0.4, autoAlpha: 0, transformOrigin: '50% 100%'
    });
    SFX.play('coin');   /* the till, exactly as the pile appears */
    gsap.timeline({ onComplete: function () { coin.remove(); if (onGone) onGone(); } })
      /* magical materialise: overshoot past full size, then settle back */
      .to(coin, { autoAlpha: 1, scale: 1.14, duration: COIN_LAND * 0.55, ease: 'power2.out' })
      .to(coin, { scale: 1, duration: COIN_LAND * 0.45, ease: 'power2.inOut' })
      .to({}, { duration: COIN_SETTLE })            /* ...sits on the counter... */
      .add(function () { SFX.play('collect'); })    /* ...and is taken in */
      .to(coin, {
        y: '-=' + Math.round(COIN_H * 0.45), scale: 1.1, autoAlpha: 0,
        duration: COIN_FADE, ease: 'power1.out'
      });
  }

  function serveGlass(g) {
    g.placed = true;
    state.demand = null; /* close the round */
    state.served += 1;
    hideDemandBubble();
    demandHiddenByBar = false;
    hideTutMascot();  /* they got it right — the hint has done its job */
    state.wrongStreak = 0;
    clearServeHint();

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

    state.active = null;   /* nobody is servable until the next one steps up */

    /* The serve rhythm: they cheer, the coins materialise WITH the cheer, the
       customer waddles off — and only when the coins have finished dissolving
       does the line step up. The reward's own completion hook is the marker for
       "transaction complete, next customer", so no delay here has to be kept in
       sync with the coin animation by hand. */
    gsap.to(c.el, { scaleY: 1.05, duration: 0.16, yoyo: true, repeat: 3, ease: 'sine.inOut', delay: 0.45 });
    gsap.delayedCall(0.6, function () { showServeFeedback(c); });
    gsap.delayedCall(0.8, function () { rewardCoins(stepUpQueue); });
    gsap.delayedCall(1.6, function () { departServed(c); });
  }

  /* the served customer beams a little thank-you bubble above their head */
  var serveBubble = document.getElementById('serve-bubble');
  function showServeFeedback(c) {
    serveBubble.textContent = SERVE_LINES[Math.floor(Math.random() * SERVE_LINES.length)];
    gsap.killTweensOf(serveBubble);
    /* the box art's tail hangs from the bottom at 54% of its width, so shift
       the bubble left until that point sits over the customer's head */
    gsap.set(serveBubble, { visibility: 'visible', left: SERVE_X + 'px', xPercent: -54, transformOrigin: '54% 100%' });
    gsap.fromTo(serveBubble, { autoAlpha: 0, scale: 0.3, y: 22 },
      { autoAlpha: 1, scale: 1, y: 0, duration: 0.4, ease: 'back.out(2.4)' });
    SFX.play('happy');
    /* clear of the counter before the next customer steps up (~2.2s after the
       serve) — the bubble is pinned to the serve spot, not to the customer, so
       a longer dwell would read as the NEW arrival saying thank you */
    gsap.to(serveBubble, { autoAlpha: 0, scale: 0.6, duration: 0.3, delay: 0.9, ease: 'back.in(1.6)',
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

  /* a single glass glows and gently pulses to draw the eye to it */
  function pulseGlass(g) {
    g.el.classList.add('highlight');
    gsap.killTweensOf(g.img, 'scale');
    gsap.fromTo(g.img, { scale: 1 },
      { scale: 1.12, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' });
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
    /* help escalates with the miss streak: 1st — just the shake;
       2nd+ — the glasses matching the order pulse while Agni names it */
    state.wrongStreak += 1;
    if (state.wrongStreak >= 2) {
      hintServe();
      agniSays('Pick a ' + TYPE_NAMES[state.demand] + ' glass.');
    }
    returnHome(g);
  }

  function finalWin() {
    state.locked = true;
    stopIdleWatch();
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
  /* warm the decoders once the preloader has everything as local blobs (on
     file:// this fires immediately and warms the browser cache instead), so
     the first garnish swap, bubble pop-in and spoken line are all instant */
  window.PRELOAD.onReady(function () {
    Object.keys(GARNISH_ART).forEach(function (t) {
      Object.keys(GARNISH_ART[t]).forEach(function (v) { new Image().src = ASSET(GARNISH_ART[t][v].src); });
    });
    ['assets/img/bubble-half.svg', 'assets/img/bubble-full.svg']
      .forEach(function (src) { new Image().src = ASSET(src); });
    SFX.preloadVoices(Object.keys(VO).map(function (t) { return VO[t]; }));
  });

  /* swap a glass to its composed garnish art, aligning the glass body exactly
     and popping the new garnish up from the glass base */
  function applyGarnishArt(g) {
    var variant = g.hasStraw && g.hasLemon ? 'both' : (g.hasStraw ? 'straw' : 'lemon');
    var art = GARNISH_ART[g.type] && GARNISH_ART[g.type][variant];
    if (!art) return;
    g.img.src = ASSET(art.src);
    g.img.dataset.art = art.src; /* logical path (src may be a blob: URL) */
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
      gsap.delayedCall(5.6, function () { hideTutMascot(); }); /* the spoken cheer runs ~5.6s in */
      gsap.delayedCall(6.0, function () {
        state.locked = false;
        startServing();   /* the first three customers file in from the right */
      });
    }
  }

  /* remove the lemon/straw boxes and glide the Half + Full trays (with their
     glasses) so the pair sits centred on the stage */
  function centerServingTrays() {
    stopGarnishNudge();
    var dx = 960 - (PHASE2.trayCenters.half + PHASE2.trayCenters.full) / 2;
    gsap.to(['#lemonbox', '#strawbox'], {
      x: '-=460', autoAlpha: 0, duration: 0.5, ease: 'power2.in',
      onComplete: function () { gsap.set(['#lemonbox', '#strawbox'], { display: 'none' }); }
    });
    gsap.to('#trays2', { x: '+=' + dx, duration: 0.75, ease: 'power2.inOut' });
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
    /* help escalates with the miss streak:
       1st miss  — just the shake, no hint;
       2nd miss  — the glass glows and pulses while Agni names it;
       3rd miss+ — the correct tray lights up and a ghost glass demos the
                   move as well (the scene itself stays bright) */
    state.wrongStreak += 1;
    if (state.wrongStreak >= 2) {
      pulseGlass(g);
      /* the bubble names the glass and stops there — "Put it in the correct
         tray" is still spoken, it just does not crowd the speech box */
      agniSays('This glass is ' + TYPE_NAMES[g.type] + '.',
        'This glass is ' + TYPE_NAMES[g.type] + '. Put it in the correct tray.');
    }
    if (state.wrongStreak >= 3) {
      clearZoneHints();
      hintZone(g.type);
      startHandDemo(g);
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
    SFX.play('confetti'); /* poppers + fluttering paper, per burst */
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

  /* ---------- win ---------- */

  /* Once the ~4s clip has run, hold the celebration instead of freezing on the
     last frame: a slow push-in, confetti showers rolling in on a loop, and the
     music bed fading back up (the video's own audio had taken the stage). Runs
     once — either when the video ends or, if it never plays, on a watchdog. */
  var celebrating = false;
  function sustainCelebration() {
    if (celebrating) return;
    celebrating = true;
    SFX.unlock();  /* stopMusic() cleared the track, so this starts it fresh */
    var video = document.getElementById('win-bg');
    if (video) gsap.to(video, { scale: 1.09, duration: 22, ease: 'none' });
    (function shower() {
      confettiBurst(26);
      gsap.delayedCall(gsap.utils.random(2.4, 3.6), shower);
    })();
  }

  /* The game ends here: the celebration video plays once, then sustainCelebration
     keeps the final frame alive. Nothing navigates away and there is no replay
     button. */
  function showWin() {
    SFX.play('win');
    confettiBurst(90);
    gsap.set(winOverlay, { visibility: 'visible' });
    gsap.to(winOverlay, { opacity: 1, duration: 0.4 });
    gsap.fromTo('#win-bg', { scale: 1.06 }, { scale: 1, duration: 0.6, ease: 'power2.out' });
    gsap.delayedCall(1.4, function () { confettiBurst(60); });

    /* play the celebration once — WITH its own audio (the background music
       fades out so the video takes the stage). If the browser blocks audible
       playback, fall back to muted so the celebration always plays; if it
       cannot play at all, the poster frame stands in as the end screen. */
    var winVideo = document.getElementById('win-bg');
    if (winVideo) {
      SFX.stopMusic();
      var VIDEO_FILE = 'assets/img/endscreen.webm';
      function playVideo() {
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
        } catch (e) { /* poster stays as fallback; the watchdog exits */ }
      }
      /* prefer the preloaded local copy; if the blob somehow errors, fall
         back to the real file once and resume playback */
      winVideo.addEventListener('error', function () {
        if (winVideo.getAttribute('src') !== VIDEO_FILE) {
          winVideo.src = VIDEO_FILE;
          winVideo.load();
          playVideo();
        }
      }, { once: true });
      var local = ASSET(VIDEO_FILE);
      if (local !== VIDEO_FILE) winVideo.src = local;
      /* hold the celebration the moment the clip runs out; the watchdog covers
         the case where playback was blocked outright and the poster stands in */
      winVideo.addEventListener('ended', sustainCelebration, { once: true });
      gsap.delayedCall(6.5, sustainCelebration);
      playVideo();
    }
  }

  /* ---------- title screen ---------- */

  var titleScreen = document.getElementById('title-screen');
  var playBtn = document.getElementById('play-btn');
  var gameStarted = false;

  function showTitle() {
    /* the Play button stays hidden behind the juice loading bar and pops in
       only once EVERY asset is preloaded (the preloader can never stall —
       failures count as done) */
    window.PRELOAD.onReady(function () {
      var wrap = document.getElementById('load-wrap');
      gsap.to(wrap, { autoAlpha: 0, duration: 0.35, delay: 0.3,
        onComplete: function () { wrap.style.display = 'none'; } });
      gsap.set(playBtn, { visibility: 'visible' });
      gsap.from(playBtn, { scale: 0, autoAlpha: 0, duration: 0.6, ease: 'back.out(2.2)', delay: 0.5 });
      gsap.to(playBtn, { scale: 1.07, duration: 0.8, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 1.15 });
    });
  }

  function startGame() {
    /* also guards keyboard (Enter/Space -> click) and programmatic starts:
       nothing begins until the preload is done */
    if (gameStarted || !window.PRELOAD.done) return;
    gameStarted = true;
    SFX.unlock();
    SFX.play('press');
    gsap.killTweensOf(playBtn);
    gsap.to(playBtn, { scale: 0.85, duration: 0.12, yoyo: true, repeat: 1, ease: 'power2.inOut' });
    gsap.delayedCall(0.25, function () {
      /* the scene is only PARKED under the wave; its entrance plays once the
         wave has drained, so the player actually watches the trays arrive and
         the glasses being set out rather than finding them already there */
      splashTransition(function () {
        titleScreen.style.display = 'none';
        introSetup();
      }, intro);
    });
  }
  playBtn.addEventListener('pointerdown', startGame);
  playBtn.addEventListener('click', startGame); /* keyboard Enter/Space */

  /* browsers only allow audio after a user gesture — unlock on the first one */
  document.addEventListener('pointerdown', function () { SFX.unlock(); }, { once: true });

  /* the board is not a document: never let a drag start a native image drag
     or a text selection, and never let a swipe scroll/bounce the page */
  document.addEventListener('dragstart', function (e) { e.preventDefault(); });
  document.addEventListener('selectstart', function (e) { e.preventDefault(); });
  document.addEventListener('touchmove', function (e) {
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); }); /* iOS pinch-zoom */

  /* ---------- intro ---------- */

  /* park the scene in its pre-entrance state. Called while the splash still
     covers the stage, so nothing flashes into place before it animates in —
     the entrance itself then plays on a fully visible screen. */
  function introSetup() {
    gsap.set('#trays', { y: 220, autoAlpha: 0 });
    gsap.set([plaqueEls.empty, plaqueEls.half, plaqueEls.full], { y: -40, autoAlpha: 0, scale: 0.6 });
    gsap.set(state.glasses.map(function (g) { return g.el; }), { scale: 0 });
  }

  function intro() {
    state.locked = true; /* no dragging until Agni finishes the tutorial */
    startIdleWatch();    /* only now is there anything to be idle at */
    var tl = gsap.timeline();
    tl.to('#trays', { y: 0, autoAlpha: 1, duration: 0.7, ease: 'power3.out' }, 0.2)
      .to([plaqueEls.empty, plaqueEls.half, plaqueEls.full],
        { y: 0, autoAlpha: 1, scale: 1, duration: 0.55, ease: 'back.out(2)', stagger: 0.12 }, 0.55)
      /* the nine tumblers tick onto the shelf, one ting per glass */
      .add(function () { SFX.play('shelf'); }, 0.8)
      .to(state.glasses.map(function (g) { return g.el; }),
        { scale: 1, duration: 0.5, ease: 'back.out(2.2)', stagger: 0.06 }, 0.8)
      .add(function () { state.glasses.forEach(startIdle); });

    /* Agni speaks every line, then steps aside for the hands-on step (all
       skipped if the player just dives in and drops a glass). The first line
       waits ~1.5s so the scene has settled before the bar drops in. */
    tutLater(1.5, function () { showTutMascot(TUT[0]); });
    tutLater(5.4, function () {
      /* "Let us sort the glasses into trays" — all three trays light up so the
         player sees the three destinations before any one of them is singled
         out (and well before the ghost demo starts) */
      showTutMascot(TUT[1]);
      hintZone('empty'); hintZone('half'); hintZone('full');
    });
    tutLater(8.8, function () {
      /* narrow from all three to the one he is about to name: the glass lights
         up as Agni says "This glass is empty", and the tray only joins in when
         he says where to put it */
      clearZoneHints();
      highlightEmptyGlass();
      /* hands on the glasses the moment this line is done — onDone fires only
         once the line is fully typed AND spoken, so control can never pass
         mid-sentence */
      showTutMascot(TUT[2], function () {
        hideTutMascot();
        state.locked = false; /* dialogue over — hands on the glasses! */
        startSortHint();
      }, [
        { at: TUT[2].indexOf('Put it'), fn: function () { hintZone('empty'); } }
      ]);
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
