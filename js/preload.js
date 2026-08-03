/* Asset preloader: fetches every file in js/preload-manifest.js behind the
   title screen's juice loading bar, then reveals the Play button. Progress is
   byte-accurate (streaming readers weighted by real on-disk sizes) and the
   bar is strictly monotonic. Files are queued smallest-first so light art
   lands in the first seconds and is never starved behind the big music/video;
   at most 5 transfers run at once.

   Fetched media become blob: URLs (window.PRELOAD.url(path)) so "loaded"
   truly means local; CSS background images and the font share the same
   request URLs, so fetching them here warms the HTTP cache for the styles.

   Failure can NEVER block the game: a failed / stalled / aborted fetch (or
   file:// where fetch is blocked entirely) counts as done and the element
   simply keeps its original src. Each transfer has an abort timeout and the
   whole load has a hard failsafe. */
(function () {
  'use strict';

  var files = (window.PRELOAD_MANIFEST || []).slice().sort(function (a, b) { return a.b - b.b; });
  var CONCURRENCY = 5;
  var TRANSFER_TIMEOUT = 45000;  /* per file */
  var FAILSAFE = 90000;          /* whole load — reveal Play no matter what */

  /* A blob MUST carry its MIME type. An <img> sniffs raster bytes, so a
     typeless WebP still renders — but SVG is NEVER sniffed: an <img> draws it
     only for image/svg+xml, and a typeless blob leaves a broken image. Prefer
     what the server said; fall back to the extension so a server that serves
     .svg as octet-stream/text can't break the art either. */
  var MIME = {
    webp: 'image/webp', svg: 'image/svg+xml', png: 'image/png',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webm: 'video/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', woff2: 'font/woff2'
  };
  function mimeFor(url, res) {
    var ct = res.headers.get('Content-Type');
    if (ct) ct = ct.split(';')[0].trim().toLowerCase();
    if (ct && ct !== 'application/octet-stream' && ct !== 'text/plain') return ct;
    return MIME[(url.split('.').pop() || '').toLowerCase()] || '';
  }

  var blobs = {};
  var readyFns = [];
  var isDone = false;
  var totalBytes = 0, i;
  for (i = 0; i < files.length; i++) totalBytes += files[i].b;
  if (!totalBytes) totalBytes = 1;

  var fill = document.getElementById('load-fill');
  var txt = document.getElementById('load-txt');
  var creditedBytes = 0;   /* fully settled files */
  var partial = {};        /* in-flight progress per url */
  var shownPct = 0;        /* monotonic display value */

  function paint() {
    var got = creditedBytes;
    for (var u in partial) got += partial[u];
    var pct = Math.min(100, Math.floor(got / totalBytes * 100));
    if (pct <= shownPct) return; /* never move backwards */
    shownPct = pct;
    if (fill) fill.style.width = pct + '%';
    if (txt) txt.textContent = 'Pouring the juice… ' + pct + '%';
  }

  function finish() {
    if (isDone) return;
    isDone = true;
    if (fill) fill.style.width = '100%';
    if (txt) txt.textContent = 'Pouring the juice… 100%';
    /* point every already-in-DOM img at its local blob; if a blob ever
       errors, a one-time fallback reverts to the original file URL */
    var imgs = document.querySelectorAll('img[src]');
    for (var k = 0; k < imgs.length; k++) swapToBlob(imgs[k]);
    var fns = readyFns; readyFns = [];
    for (var j = 0; j < fns.length; j++) fns[j]();
  }

  function swapToBlob(el) {
    var orig = el.getAttribute('src');
    var b = blobs[orig];
    if (!b || el.src.indexOf('blob:') === 0) return;
    el.addEventListener('error', function () { el.src = orig; }, { once: true });
    el.src = b;
  }

  function fetchOne(f, next) {
    var settled = false;
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TRANSFER_TIMEOUT);
    function settle() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      delete partial[f.u];
      creditedBytes += f.b; /* success or not, the file counts as done */
      paint();
      next();
    }
    try {
      fetch(f.u, ctrl ? { signal: ctrl.signal } : undefined).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        /* refine the expectation with Content-Length, but never past the
           manifest weight — the bar must stay monotonic */
        var expect = Math.min(f.b, parseInt(res.headers.get('Content-Length'), 10) || f.b);
        if (!res.body || !res.body.getReader) return res.blob(); /* keeps its own type */
        var type = mimeFor(f.u, res);
        var reader = res.body.getReader();
        var chunks = [], got = 0;
        return (function pump() {
          return reader.read().then(function (r) {
            if (r.done) return new Blob(chunks, { type: type });
            chunks.push(r.value);
            got += r.value.byteLength;
            partial[f.u] = Math.min(got, expect);
            paint();
            return pump();
          });
        })();
      }).then(function (blob) {
        if (blob && blob.size) blobs[f.u] = URL.createObjectURL(blob);
        settle();
      }).catch(settle);
    } catch (e) {
      settle(); /* fetch itself threw (old browser, blocked protocol) */
    }
  }

  window.PRELOAD = {
    /* resolve an asset path to its local blob (or itself if the fetch
       failed / was skipped — the game then loads it the normal way) */
    url: function (u) { return blobs[u] || u; },
    onReady: function (fn) { if (isDone) fn(); else readyFns.push(fn); },
    get done() { return isDone; }
  };

  /* route every lazily-created Audio() through the blob map */
  if (window.SFX && SFX.setResolver) SFX.setResolver(window.PRELOAD.url);

  if (location.protocol === 'file:' || !window.fetch || !files.length) {
    /* fetch cannot read file:// — skip straight to ready; the browser
       loads each asset on demand exactly as before */
    finish();
    return;
  }

  setTimeout(finish, FAILSAFE);

  var cursor = 0, inFlight = 0;
  function pumpQueue() {
    while (inFlight < CONCURRENCY && cursor < files.length) {
      inFlight++;
      fetchOne(files[cursor++], function () {
        inFlight--;
        if (cursor >= files.length && inFlight === 0) finish();
        else pumpQueue();
      });
    }
  }
  pumpQueue();
})();
