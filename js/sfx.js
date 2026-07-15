/* Procedural sound effects (Web Audio) — kid-friendly spooky carnival:
   ghostly slides, minor-key sparkle bells, cartoon womp-womps, a ghost-choir
   win fanfare, and a soft night ambience (wind + a distant owl).
   Everything is synthesized, so no audio assets are needed. */
(function () {
  'use strict';

  var ctx = null, master = null, verb = null;
  var muted = false, ambienceOn = false;
  var music = null;
  var MUSIC_VOLUME = 0.07;   /* quiet bed so the SFX sit clearly on top */
  var SFX_VOLUME = 0.8;      /* effects well above the music */

  function startMusic() {
    if (music) return;
    music = new Audio('audio/background.mp3');
    music.loop = true;
    music.volume = 0;
    var p = music.play();
    if (p && p.catch) p.catch(function () { music = null; }); /* retry on next gesture */
    var fade = setInterval(function () {
      if (!music) { clearInterval(fade); return; }
      var target = muted ? 0 : MUSIC_VOLUME;
      music.volume = Math.min(target, music.volume + 0.015);
      if (music.volume >= target) clearInterval(fade);
    }, 90);
  }

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : SFX_VOLUME;
    master.connect(ctx.destination);
    /* generated impulse response = cheap ghostly hall */
    verb = ctx.createConvolver();
    verb.buffer = impulse(1.8, 2.6);
    var wet = ctx.createGain();
    wet.gain.value = 0.3;
    verb.connect(wet);
    wet.connect(master);
    return true;
  }

  function impulse(seconds, decay) {
    var rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function noiseBuffer(seconds) {
    var rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(1, len, rate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* ---------- voices ---------- */

  function bell(freq, when, vol, dur) {
    dur = dur || 1.0;
    [[1, 1], [2.76, 0.35]].forEach(function (partial) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * partial[0];
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(vol * partial[1], when + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      o.connect(g); g.connect(master); g.connect(verb);
      o.start(when); o.stop(when + dur + 0.05);
    });
  }

  function ghost(f0, f1, dur, when, vol) {
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, when);
    o.frequency.exponentialRampToValueAtTime(f1, when + dur);
    var lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    var lg = ctx.createGain();
    lg.gain.value = (f0 + f1) * 0.014;
    lfo.connect(lg); lg.connect(o.frequency);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(master); g.connect(verb);
    o.start(when); o.stop(when + dur + 0.05);
    lfo.start(when); lfo.stop(when + dur);
  }

  function womp(when) {
    [[200, 130, 0], [150, 95, 0.28]].forEach(function (w) {
      var t = when + w[2];
      var o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(w[0], t);
      o.frequency.exponentialRampToValueAtTime(w[1], t + 0.22);
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 5;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.15, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
      o.connect(f); f.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.3);
    });
  }

  function thud(when, vol) {
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, when);
    o.frequency.exponentialRampToValueAtTime(65, when + 0.15);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
    o.connect(g); g.connect(master);
    o.start(when); o.stop(when + 0.2);
  }

  function pop(when, vol) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.06);
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 1.6;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(when);
  }

  function splashNoise(when, vol) {
    /* wet impact: noise burst with a fast-closing lowpass */
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.55);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(3400, when);
    f.frequency.exponentialRampToValueAtTime(480, when + 0.42);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.5);
    src.connect(f); f.connect(g); g.connect(master); g.connect(verb);
    src.start(when);
  }

  function sweep(f0, f1, when, dur, vol) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur + 0.1);
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.1;
    f.frequency.setValueAtTime(f0, when);
    f.frequency.exponentialRampToValueAtTime(f1, when + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f); f.connect(g); g.connect(master); g.connect(verb);
    src.start(when);
  }

  function whoosh(when, vol) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.35);
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(500, when);
    f.frequency.exponentialRampToValueAtTime(2400, when + 0.3);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.33);
    src.connect(f); f.connect(g); g.connect(master); g.connect(verb);
    src.start(when);
  }

  function choir(when) {
    /* detuned A-minor pad with slow vibrato — friendly ghost chorus */
    [220, 261.63, 329.63, 440].forEach(function (f) {
      [0.996, 1.005].forEach(function (det) {
        var o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f * det;
        var lfo = ctx.createOscillator();
        lfo.frequency.value = 4.2;
        var lg = ctx.createGain();
        lg.gain.value = f * 0.012;
        lfo.connect(lg); lg.connect(o.frequency);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(0.045, when + 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 2.4);
        o.connect(g); g.connect(master); g.connect(verb);
        o.start(when); o.stop(when + 2.5);
        lfo.start(when); lfo.stop(when + 2.5);
      });
    });
  }

  function grabPop(when) {
    /* tactile suction-pop: fast pitch flick up with a snappy envelope */
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(170, when);
    o.frequency.exponentialRampToValueAtTime(560, when + 0.07);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.22, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.13);
    o.connect(g); g.connect(master);
    o.start(when); o.stop(when + 0.15);
  }

  function boing(f0, f1, when, dur, vol) {
    var o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f0, when);
    o.frequency.exponentialRampToValueAtTime(f1, when + dur * 0.6);
    o.frequency.exponentialRampToValueAtTime(f1 * 0.85, when + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(master);
    o.start(when); o.stop(when + dur + 0.05);
  }

  function blip(f0, f1, when, dur, vol) {
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, when);
    o.frequency.exponentialRampToValueAtTime(f1, when + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(master);
    o.start(when); o.stop(when + dur + 0.05);
  }

  /* sample-based cues (mp3 files); cloned per play so they can overlap */
  var samples = {};
  function playSample(name, vol) {
    var base = samples[name];
    if (!base) {
      base = new Audio('audio/' + name + '.mp3');
      base.preload = 'auto';
      samples[name] = base;
    }
    var inst = base.cloneNode();
    inst.volume = vol;
    var p = inst.play();
    if (p && p.catch) p.catch(function () { /* not unlocked yet */ });
  }

  /* ---------- cues ---------- */

  var cues = {
    /* grab a glass: suction-pop + soft tick, with a faint ghostly tail */
    pickup: function (t) {
      grabPop(t);
      pop(t, 0.05);
      ghost(300, 440, 0.18, t + 0.03, 0.04);
    },
    /* correct tray: whoosh + minor-key sparkle bells (A5 C6 E6 A6) */
    correct: function (t) {
      whoosh(t, 0.05);
      [[880, 0], [1046.5, 0.08], [1318.5, 0.16], [1760, 0.26]].forEach(function (n) {
        bell(n[0], t + n[1], 0.11, 0.9);
      });
    },
    /* wrong glass/tray — spooky "uh-oh": cartoon womp under a ghostly
       wah-wah slide, topped with rattling bone plinks (kid-friendly, not scary) */
    wrong: function (t) {
      womp(t);
      ghost(520, 260, 0.55, t + 0.03, 0.075);            /* ghost wails "ooOOoo" down */
      [523.25, 415.3, 329.63].forEach(function (f, i) {  /* skeleton xylophone: C5 Ab4 E4 */
        bell(f, t + 0.06 + i * 0.11, 0.075, 0.22);
      });
    },
    /* glass settles back on the shelf */
    land: function (t) {
      thud(t, 0.11);
    },
    /* all sorted: bell run up the A-minor arpeggio + ghost choir + confetti pops */
    win: function (t) {
      [440, 523.25, 659.25, 880, 1046.5, 1318.5, 1760].forEach(function (f, i) {
        bell(f, t + i * 0.09, 0.13, 1.1);
      });
      choir(t + 0.35);
      for (var i = 0; i < 6; i++) pop(t + 0.4 + Math.random() * 1.4, 0.07);
    },
    click: function (t) {
      pop(t, 0.12);
      bell(660, t, 0.06, 0.3);
    },
    /* customers waddle in: little footstep thuds + a springy boing */
    arrive: function (t) {
      thud(t, 0.07);
      thud(t + 0.18, 0.07);
      thud(t + 0.36, 0.06);
      boing(160, 470, t + 0.15, 0.35, 0.06);
    },
    /* a customer pipes up with a demand */
    ask: function (t) {
      boing(300, 620, t, 0.2, 0.08);
      pop(t + 0.02, 0.05);
    },
    /* glug glug: descending swallows */
    gulp: function (t) {
      blip(420, 300, t, 0.11, 0.14);
      blip(360, 250, t + 0.14, 0.11, 0.14);
      blip(300, 200, t + 0.28, 0.12, 0.13);
      pop(t + 0.42, 0.06);
    },
    /* satisfied customer */
    happy: function (t) {
      bell(1046.5, t, 0.09, 0.5);
      bell(1318.5, t + 0.1, 0.09, 0.6);
    },
    /* straws/lemons popping onto the glasses */
    garnish: function (t) {
      for (var i = 0; i < 4; i++) pop(t + i * 0.055, 0.06);
      bell(1318.5, t + 0.12, 0.07, 0.45);
      bell(1567.98, t + 0.24, 0.06, 0.45);
    },
    /* soft blip for each typed letter in Agni's dialogue */
    type: function (t) {
      blip(650, 720, t, 0.03, 0.028);
    },
    /* the customer pays: jingling coins fly to the counter */
    coin: function () {
      playSample('coin', 0.75);
    },
    /* the till rings when every customer has been served */
    kaching: function () {
      playSample('cash-register', 0.8);
    },
    /* juice splat bursts over the screen, then drains off the bottom */
    splash: function (t) {
      sweep(500, 1900, t, 0.55, 0.1);    /* liquid rushing outward */
      splashNoise(t + 0.68, 0.22);       /* big wet SPLAT at full cover */
      thud(t + 0.68, 0.18);
      for (var i = 0; i < 7; i++) {      /* droplets pattering down */
        blip(500 + Math.random() * 700, 280 + Math.random() * 300,
          t + 0.78 + Math.random() * 0.5, 0.06, 0.05);
      }
      sweep(900, 180, t + 1.4, 0.9, 0.1); /* draining away */
    }
  };

  /* ---------- night ambience: soft wind + a distant owl ---------- */

  function startAmbience() {
    if (ambienceOn || !ctx) return;
    ambienceOn = true;

    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(2.5);
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.7;
    var g = ctx.createGain();
    g.gain.value = 0.028;
    var sweep = ctx.createOscillator();
    sweep.frequency.value = 0.07;
    var sweepAmt = ctx.createGain();
    sweepAmt.gain.value = 170;
    sweep.connect(sweepAmt); sweepAmt.connect(f.frequency);
    var breathe = ctx.createOscillator();
    breathe.frequency.value = 0.05;
    var breatheAmt = ctx.createGain();
    breatheAmt.gain.value = 0.012;
    breathe.connect(breatheAmt); breatheAmt.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(); sweep.start(); breathe.start();

    (function owl() {
      setTimeout(function () {
        if (ctx && !muted) {
          var t = ctx.currentTime;
          ghost(392, 340, 0.32, t, 0.035);
          ghost(370, 320, 0.4, t + 0.45, 0.03);
        }
        owl();
      }, 9000 + Math.random() * 9000);
    })();
  }

  /* ---------- public API ---------- */

  window.SFX = {
    /* call from a user gesture: creates/resumes the context,
       starts the ambience and the background music */
    unlock: function () {
      if (ensure()) {
        startAmbience();
        startMusic();
      }
    },
    play: function (name) {
      if (muted || !ensure() || !cues[name]) return;
      cues[name](ctx.currentTime);
    },
    toggleMute: function () {
      muted = !muted;
      if (master) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.linearRampToValueAtTime(muted ? 0 : SFX_VOLUME, ctx.currentTime + 0.15);
      }
      if (music) music.volume = muted ? 0 : MUSIC_VOLUME;
      return muted;
    },
    isMuted: function () { return muted; },
    musicPlaying: function () { return !!(music && !music.paused); }
  };
})();
