/* The Glass Half Full — carnival sorting game.
   Scene coordinates are in the fixed 1920x1080 design space; the stage is
   scaled to the window and pointer deltas are divided by that scale. */
(function () {
  'use strict';

  var GLASS_TYPES = {
    full:  { src: 'assets/img/glass-full.webp',  w: 161, h: 189 },
    half:  { src: 'assets/img/glass-half.webp',  w: 146, h: 192 },
    empty: { src: 'assets/img/glass-empty.webp', w: 92,  h: 136 }
  };

  /* Shelf line-up from the Figma frame (left x; tall glasses top-aligned at
     428, the short empty glass at 481 so every bottom rests on the shelf). */
  var START_GLASSES = [
    { type: 'half',  x: 150  }, { type: 'full',  x: 276  }, { type: 'empty', x: 426  },
    { type: 'empty', x: 576  }, { type: 'full',  x: 708  }, { type: 'half',  x: 840  },
    { type: 'empty', x: 996  }, { type: 'full',  x: 1110 }, { type: 'half',  x: 1266 },
    { type: 'half',  x: 1410 }, { type: 'full',  x: 1536 }, { type: 'empty', x: 1684 }
  ];
  var SHELF_BOTTOM = 618;

  /* Four landing spots per tray; glasses keep their original size (s: 1).
     The narrow empty glasses fit in a single row. The wide drink glasses
     land as a cluster: two at the back, then two in front (front slots
     get the higher z-index, so the cluster reads with natural depth). */
  function rowSlots() {
    return [-150, -50, 50, 150].map(function (dx) {
      return { dx: dx, bottom: 940, s: 1 };
    });
  }
  function clusterSlots() {
    return [
      { dx: -60,  bottom: 872, s: 1 }, { dx: 60,  bottom: 872, s: 1 },
      { dx: -128, bottom: 975, s: 1 }, { dx: 128, bottom: 975, s: 1 }
    ];
  }
  var TRAYS = {
    empty: { zone: { x: 120,  y: 700, w: 530, h: 365 }, centerX: 385,  count: 0, slots: rowSlots() },
    half:  { zone: { x: 672,  y: 700, w: 578, h: 365 }, centerX: 961,  count: 0, slots: clusterSlots() },
    full:  { zone: { x: 1290, y: 700, w: 430, h: 365 }, centerX: 1505, count: 0, slots: clusterSlots() }
  };

  /* Phase 2 (serving): spooky customers ask for half-full or full glasses.
     Character x-centers/tops match the Figma slide; the full-body sprites
     extend below the counter and are hidden behind it (lower z-index). */
  var PHASE2 = {
    trayCenters: { half: 990, full: 1590 },
    chars: [
      { key: 'reaper', center: 356,  top: 248 },
      { key: 'wolf',   center: 1023, top: 257 },
      { key: 'mummy',  center: 1500, top: 277 }
    ],
    demandLines: {
      half: [
        'May I have a <b>Half Full</b> glass?',
        'One <b>Half Full</b> glass, please!',
        'Just a <b>Half Full</b> glass for me!'
      ],
      full: [
        'One <b>Full</b> glass, please!',
        'I\'m so thirsty&hellip; a <b>Full</b> glass!',
        'A <b>Full</b> glass of juice, please!'
      ]
    },
    happyLines: ['Yum yum! Thank you!', 'Spook-tacular! Thanks!', 'Mmm&hellip; delicious!'],
    oopsLines: {
      half: 'Oops! I asked for a <b>Half Full</b> glass!',
      full: 'Oops! I asked for a <b>Full</b> glass!'
    }
  };

  var stage = document.getElementById('stage');
  var glassLayer = document.getElementById('glass-layer');
  var fxLayer = document.getElementById('fx-layer');
  var hudCount = document.getElementById('hud-count');
  var hudTotal = document.getElementById('hud-total');
  var instruction = document.getElementById('instruction');
  var winOverlay = document.getElementById('win-overlay');
  var bubble = document.getElementById('bubble');
  var bubbleText = document.getElementById('bubble-text');
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
  var state = {
    glasses: [], placed: 0, topZ: 500, locked: false, hintShown: true,
    phase: 1, served: 0, demand: null, active: null, stock: { half: 4, full: 4 }
  };

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
      var slots = clusterSlots();
      slots.forEach(function (slot) {
        var cx = PHASE2.trayCenters[type] + slot.dx;
        var g = createGlass(type, cx - spec.w / 2, slot.bottom - spec.h);
        g.el.style.zIndex = 100 + Math.round(slot.bottom / 10);
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
      gsap.to(g.img, { rotation: 0, duration: 0.2 });
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
    hudCount.textContent = state.placed;
    hideHint();

    var tray = TRAYS[g.type];
    var slot = tray.slots[tray.count];
    tray.count += 1;

    var tx = tray.centerX + slot.dx - (g.x + g.w / 2);
    var ty = slot.bottom - (g.y + g.h);
    /* front-row glasses draw over back row */
    g.el.style.zIndex = 100 + Math.round(slot.bottom / 10);

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

  /* ---------- phase 2: serving the customers ---------- */

  function customerHit(pt) {
    var c = state.active;
    return c && Math.abs(pt.x - c.center) < 230 && pt.y > 200 && pt.y < 660;
  }

  function phase2Intro() {
    SFX.play('win');
    confettiBurst(50);
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
    var oldEls = state.glasses.map(function (g) { return g.el; });
    state.glasses = [];

    var tl = gsap.timeline();
    tl.to(oldEls, { scale: 0, autoAlpha: 0, duration: 0.35, stagger: 0.025, ease: 'back.in(1.6)' })
      .to(['#trays', '#plaque-empty', '#plaque-half', '#plaque-full'],
        { y: '+=240', autoAlpha: 0, duration: 0.6, ease: 'power2.in' }, 0.2)
      .add(function () {
        oldEls.forEach(function (el) { el.remove(); });
        buildGlasses2();
        state.glasses.forEach(function (g) { gsap.set(g.el, { scale: 0 }); });
        hudCount.textContent = '0';
        hudTotal.textContent = '8';
      })
      .fromTo('#trays2', { y: 240, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 0.6, ease: 'power3.out' })
      .fromTo(['#lemonbox', '#strawbox'], { x: -380, autoAlpha: 0 },
        { x: 0, autoAlpha: 1, duration: 0.55, stagger: 0.12, ease: 'power3.out' }, '<')
      .fromTo(['#plaque2-half', '#plaque2-full'], { y: -40, scale: 0.6, autoAlpha: 0 },
        { y: 0, scale: 1, autoAlpha: 1, duration: 0.5, ease: 'back.out(2)', stagger: 0.12 }, '-=0.25')
      .add(function () {
        state.glasses.forEach(function (g, i) {
          gsap.to(g.el, { scale: 1, duration: 0.45, ease: 'back.out(2)', delay: i * 0.05 });
        });
      }, '-=0.2')
      .add(charsWalkIn, '-=0.1')
      .add(function () {
        state.locked = false;
        instruction.innerHTML = 'Give each customer what they ask for!';
        state.hintShown = true;
        gsap.fromTo(instruction, { autoAlpha: 0, y: -24 }, { autoAlpha: 1, y: 0, duration: 0.5 });
      }, '+=1.7')
      .add(startRound, '+=0.4');
  }

  function charsWalkIn() {
    SFX.play('arrive');
    PHASE2.chars.forEach(function (c, i) {
      /* reaper and wolf stroll in from the left, the mummy from the right */
      var fromX = c.key === 'mummy' ? (1920 - c.center) + 420 : -(c.center + 420);
      var walk = 1.15 + i * 0.15;
      gsap.set(c.el, { autoAlpha: 1, x: fromX });
      gsap.to(c.el, { x: 0, duration: walk, ease: 'power1.inOut', delay: i * 0.2 });
      gsap.to(c.el, { keyframes: { y: [0, -14, 0, -14, 0, -14, 0] }, duration: walk, ease: 'none', delay: i * 0.2 });
      gsap.to(c.el, {
        keyframes: { rotation: [0, -2, 2, -2, 2, 0] }, duration: walk, ease: 'none', delay: i * 0.2,
        onComplete: function () {
          /* gentle breathing while waiting (scaleY keeps y free for bounces) */
          gsap.to(c.el, {
            scaleY: 1.018, duration: gsap.utils.random(1.3, 1.8),
            yoyo: true, repeat: -1, ease: 'sine.inOut'
          });
        }
      });
    });
  }

  function startRound() {
    var avail = ['half', 'full'].filter(function (t) { return state.stock[t] > 0; });
    if (!avail.length) { finalWin(); return; }
    state.demand = avail[Math.floor(Math.random() * avail.length)];
    state.active = PHASE2.chars[Math.floor(Math.random() * PHASE2.chars.length)];
    zoneCustomer.style.left = (state.active.center - 220) + 'px';
    hideHint(); /* the speech bubble takes over from the instruction text */

    var lines = PHASE2.demandLines[state.demand];
    showBubble(lines[Math.floor(Math.random() * lines.length)]);
    SFX.play('ask');
    gsap.to(state.active.el, { y: -26, duration: 0.22, yoyo: true, repeat: 3, ease: 'sine.inOut' });
  }

  function showBubble(html) {
    bubbleText.innerHTML = html;
    var c = state.active;
    bubble.style.left = Math.max(330, Math.min(1590, c.center)) + 'px';
    bubble.style.top = 'auto';
    bubble.style.bottom = (1080 - c.top + 16) + 'px';
    gsap.killTweensOf(bubble);
    gsap.set(bubble, { xPercent: -50, rotation: 0 });
    gsap.fromTo(bubble, { autoAlpha: 0, scale: 0.3 },
      { autoAlpha: 1, scale: 1, duration: 0.45, ease: 'back.out(2.2)' });
  }

  function hideBubble() {
    gsap.to(bubble, { autoAlpha: 0, scale: 0.5, duration: 0.3, ease: 'back.in(1.6)' });
  }

  function serveGlass(g) {
    g.placed = true;
    var demanded = state.demand;
    state.demand = null; /* close the round */
    state.stock[demanded] -= 1;
    state.served += 1;
    hudCount.textContent = state.served;
    hideHint();

    var c = state.active;
    var tx = c.center - (g.x + g.w / 2);
    var ty = 480 - (g.y + g.h);
    state.topZ += 1;
    g.el.style.zIndex = state.topZ;

    gsap.timeline({ onComplete: function () { g.el.remove(); } })
      .to(g.el, { x: tx, y: ty, scale: 0.85, duration: 0.45, ease: 'power2.inOut' })
      .to(g.el, { rotation: -28, duration: 0.25, ease: 'power1.inOut' })
      .to(g.el, { autoAlpha: 0, y: '-=12', duration: 0.3, ease: 'power1.in' }, '-=0.05')
      .add(function () {
        SFX.play('gulp');
        burstSparks(c.center, 420);
      }, 0.45);

    /* happy customer wiggle + thank-you line */
    gsap.to(c.el, { scaleY: 1.05, duration: 0.16, yoyo: true, repeat: 3, ease: 'sine.inOut', delay: 0.45 });
    gsap.delayedCall(0.7, function () {
      SFX.play('happy');
      showBubble(PHASE2.happyLines[Math.floor(Math.random() * PHASE2.happyLines.length)]);
    });
    gsap.delayedCall(1.9, hideBubble);
    gsap.delayedCall(2.4, startRound);
  }

  function rejectServe(g) {
    SFX.play('wrong');
    var line = PHASE2.oopsLines[state.demand];
    var demandLine = bubbleText.innerHTML;
    showBubble(line);
    gsap.to(bubble, { keyframes: { rotation: [-3, 3, -2, 2, 0] }, duration: 0.4, delay: 0.1 });
    gsap.to(state.active.el, { keyframes: { rotation: [-4, 4, -3, 3, 0] }, duration: 0.5 });
    gsap.delayedCall(1.6, function () {
      if (state.demand) showBubble(demandLine);
    });
    returnHome(g);
  }

  function finalWin() {
    state.locked = true;
    hideBubble();
    document.querySelector('.win-inner p').textContent = 'You served all the customers!';
    showWin();
  }

  function rejectGlass(g) {
    SFX.play('wrong');
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

  function hideHint() {
    if (!state.hintShown) return;
    state.hintShown = false;
    gsap.to(instruction, { autoAlpha: 0, y: -24, duration: 0.5, ease: 'power2.in' });
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
    /* both phases have run by now — a clean reload restarts from sorting */
    gsap.delayedCall(0.2, function () { location.reload(); });
  });

  /* ---------- sound toggle ---------- */

  var muteBtn = document.getElementById('mute');
  function syncMuteIcon() { muteBtn.textContent = SFX.isMuted() ? '🔇' : '🔊'; }
  muteBtn.addEventListener('click', function () {
    SFX.unlock();
    SFX.toggleMute();
    syncMuteIcon();
  });
  syncMuteIcon();
  /* browsers only allow audio after a user gesture — unlock on the first one */
  document.addEventListener('pointerdown', function () { SFX.unlock(); }, { once: true });

  /* ---------- intro ---------- */

  function intro() {
    var tl = gsap.timeline();
    tl.from(stage, { autoAlpha: 0, duration: 0.5 })
      .from('#trays', { y: 220, autoAlpha: 0, duration: 0.7, ease: 'power3.out' }, 0.2)
      .from([plaqueEls.empty, plaqueEls.half, plaqueEls.full],
        { y: -40, autoAlpha: 0, scale: 0.6, duration: 0.55, ease: 'back.out(2)', stagger: 0.12 }, 0.55)
      .from(state.glasses.map(function (g) { return g.el; }),
        { scale: 0, duration: 0.5, ease: 'back.out(2.2)', stagger: 0.06 }, 0.8)
      .add(function () { state.glasses.forEach(startIdle); })
      .fromTo(instruction, { autoAlpha: 0, y: -24 }, { autoAlpha: 1, y: 0, duration: 0.5 }, 1.6)
      .from(['#hud', '#mute'], { autoAlpha: 0, x: 40, duration: 0.5 }, 1.6);
  }

  /* read-only handle for automated tests */
  window.__game = state;

  /* ---------- boot ---------- */

  fitStage();
  buildGlasses();
  skySparkles();
  if (/[?&]ss\b/.test(location.search)) {
    /* screenshot/test mode: skip the intro and show the final resting state */
    gsap.set(instruction, { autoAlpha: 1 });
    state.glasses.forEach(startIdle);
  } else {
    intro();
  }
})();
