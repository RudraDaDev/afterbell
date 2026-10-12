// ─────────────────────────────────────────────────────────────────────────────
//  Afterbell · Lib/clipstudio.js
//
//  Capture → trim → filter → draw → export, in the browser, no build step.
//
//    capture()        record a MediaStream (camera / screen) to a Blob
//    compose()        play a list of clips back through a canvas, apply
//                     filters + freehand strokes + text, record the result
//    FILTERS          filter presets, filterString() to render one
//    clampRange / totalDuration / splitTimeline   timeline maths (pure)
//    exportMime()     the mime this browser should write out
//
//  Depends on Lib/media.js (global AbMedia) for codec + storage. Plain script:
//  <script src="Lib/media.js"></script><script src="Lib/clipstudio.js"></script>
//  The pure helpers are require()-able in node for tests.
// ─────────────────────────────────────────────────────────────────────────────
;(function (root, factory) {
  const api = factory(root.AbMedia);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbStudio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (AbMedia) {
  'use strict';

  const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

  // media.js may load before or after this file — ask for it at call time
  const AM = () => (typeof globalThis !== 'undefined' && globalThis.AbMedia) || AbMedia || null;

  // ── timeline maths (pure) ──────────────────────────────────────────────────

  /** keep a {start,end} window inside a known duration */
  function clampRange(r, duration) {
    const d = Math.max(0, duration || 0);
    let a = r.start || 0;
    let b = r.end === undefined ? d : r.end;
    if (b < a) { const s = a; a = b; b = s; }          // the window was written backwards
    a = clamp(a, 0, d); b = clamp(b, 0, d);
    if (b < a) { const s = a; a = b; b = s; }          // clamping can put it backwards again
    if (b - a < 0.05 && d > 0.05) b = Math.min(d, a + 0.05);   // never a zero-length cut
    return { start: a, end: b, length: Math.max(0, b - a) };
  }

  /** total seconds of output a clip list produces */
  function totalDuration(clips) {
    return (clips || []).reduce((sum, c) => sum + Math.max(0, (c.end === undefined ? (c.duration || 0) : c.end) - (c.start || 0)), 0);
  }

  /**
   * Turn a list of clips into wall-clock positions in the finished video.
   * [{clip, outStart, outEnd, srcStart, srcEnd}]
   */
  function splitTimeline(clips) {
    let at = 0;
    return (clips || []).map((c, i) => {
      const start = c.start || 0;
      const end = c.end === undefined ? (c.duration || 0) : c.end;
      const len = Math.max(0, end - start);
      const row = { index: i, clip: c, outStart: at, outEnd: at + len, srcStart: start, srcEnd: end, length: len };
      at += len;
      return row;
    });
  }

  // ── filters ────────────────────────────────────────────────────────────────
  //  Named presets, then whatever the caller passes through adjusts.
  const FILTERS = {
    none:    {},
    warm:    { saturate: 1.15, sepia: 0.22, contrast: 1.05 },
    cold:    { saturate: 0.9,  hue: -12,  brightness: 1.05 },
    mono:    { grayscale: 1 },
    sepia:   { sepia: 0.85, contrast: 1.05 },
    punch:   { contrast: 1.25, saturate: 1.35 },
    faded:   { contrast: 0.85, brightness: 1.1, saturate: 0.8 },
    night:   { brightness: 0.8, contrast: 1.2, saturate: 0.85 },
    school:  { saturate: 1.1, contrast: 1.08, brightness: 1.04 },
    sketch:  { grayscale: 1, contrast: 1.6, brightness: 1.1 }
  };

  const FILTER_PROPS = ['blur', 'brightness', 'contrast', 'grayscale', 'hue', 'invert', 'opacity', 'saturate', 'sepia'];

  // what each property looks like when it is doing nothing. Only non-default
  // values are worth writing into the filter string.
  const IDENTITY = { brightness: 1, contrast: 1, saturate: 1, opacity: 1, grayscale: 0, sepia: 0, invert: 0, hue: 0, blur: 0 };

  /** CSS filter string for a preset name plus free-form adjustments */
  function filterString(name, adjust) {
    const spec = Object.assign({}, FILTERS[name] || FILTERS.none, adjust || {});
    const parts = [];
    FILTER_PROPS.forEach(p => {
      const v = spec[p];
      if (v === undefined || v === null || v === '' || isNaN(+v)) return;
      const n = +v;
      if (n === IDENTITY[p]) return;
      if (p === 'hue') { parts.push('hue-rotate(' + n + 'deg)'); return; }
      if (p === 'blur') { parts.push('blur(' + n + 'px)'); return; }
      parts.push(p + '(' + n + ')');
    });
    return parts.join(' ');
  }

  // ── overlays ───────────────────────────────────────────────────────────────
  //  Coordinates are normalised 0..1 against the output frame, so the same
  //  drawing survives a 720p and a 360p export.

  /**
   * strokes: [{pts:[[x,y],...], color, width, t0, t1, cap}]
   * t0/t1 optional — when present the stroke only shows in that window.
   */
  function paintDraw(ctx, strokes, W, H, t) {
    (strokes || []).forEach(s => {
      if (!s || !s.pts || s.pts.length < 2) return;
      if (s.t0 !== undefined && t < s.t0) return;
      if (s.t1 !== undefined && t > s.t1) return;
      ctx.save();
      ctx.strokeStyle = s.color || '#CF3F2C';
      ctx.lineWidth = Math.max(1, (s.width || 3) * (W / 720));
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.beginPath();
      s.pts.forEach((p, i) => {
        const x = p[0] * W, y = p[1] * H;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.restore();
    });
  }

  /**
   * texts: [{text, x, y, size, color, bg, weight, family, t0, t1, align, shadow}]
   */
  function paintText(ctx, items, W, H, t) {
    (items || []).forEach(o => {
      if (!o || !o.text) return;
      if (o.t0 !== undefined && t < o.t0) return;
      if (o.t1 !== undefined && t > o.t1) return;
      const size = Math.max(8, (o.size || 0.06) * H);
      const x = (o.x === undefined ? 0.5 : o.x) * W;
      const y = (o.y === undefined ? 0.9 : o.y) * H;
      ctx.save();
      ctx.font = (o.weight || 700) + ' ' + Math.round(size) + 'px ' + (o.family || 'system-ui, sans-serif');
      ctx.textAlign = o.align || 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(o.text).width;
      if (o.bg) {
        const pad = Math.round(size * 0.35);
        ctx.fillStyle = o.bg;
        const bx = ctx.textAlign === 'center' ? x - w / 2 - pad : ctx.textAlign === 'right' ? x - w - pad : x - pad;
        ctx.fillRect(bx, y - size / 2 - pad / 2, w + pad * 2, size + pad);
      }
      if (o.shadow !== false) { ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillText(o.text, x + 2, y + 2); }
      ctx.fillStyle = o.color || '#FCFBF6';
      ctx.fillText(o.text, x, y);
      ctx.restore();
    });
  }

  // ── mime ───────────────────────────────────────────────────────────────────
  const EXPORT_CHAIN = [
    'video/webm;codecs=vp9,opus',
    'video/mp4;codecs=avc1,aac',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4'
  ];

  function exportMime(chain) {
    const M = AM();
    if (M && M.codec && M.codec.pick) {
      const m = M.codec.pick(chain || EXPORT_CHAIN);
      if (m) return m;
    }
    return (chain || EXPORT_CHAIN)[0];
  }

  // ── media element helpers (browser only) ───────────────────────────────────
  function makeVideo(src) {
    const v = document.createElement('video');
    v.preload = 'auto'; v.muted = false; v.playsInline = true; v.crossOrigin = 'anonymous';
    v.src = src;
    return v;
  }
  const when = (v, ev, timeout) => new Promise((res, rej) => {
    if (ev === 'loadedmetadata' && v.readyState >= 1) return res();
    let settled = false;
    const cleanup = () => { clearTimeout(guard); v.removeEventListener(ev, ok); v.removeEventListener('error', bad); };
    const ok = () => { if (settled) return; settled = true; cleanup(); res(); };
    const bad = () => { if (settled) return; settled = true; cleanup(); rej(new Error('video ' + ev + ' failed')); };
    const guard = setTimeout(bad, timeout === undefined ? 8000 : timeout);
    v.addEventListener(ev, ok, { once: true });
    v.addEventListener('error', bad, { once: true });
  });
  const seekTo = (v, t, timeout) => new Promise((res, rej) => {
    if (Math.abs((v.currentTime || 0) - t) < 0.001 && v.readyState >= 2) return res();
    let settled = false;
    const cleanup = () => { clearTimeout(guard); v.removeEventListener('seeked', ok); v.removeEventListener('error', bad); };
    const ok = () => { if (settled) return; settled = true; cleanup(); res(); };
    const bad = () => { if (settled) return; settled = true; cleanup(); rej(new Error('seek to ' + t + 's failed')); };
    const guard = setTimeout(bad, timeout === undefined ? 8000 : timeout);
    v.addEventListener('seeked', ok, { once: true });
    v.addEventListener('error', bad, { once: true });
    try { v.currentTime = t; } catch (e) { bad(); }
  });

  // ── capture ────────────────────────────────────────────────────────────────
  /**
   * capture({stream, width, height, fps, maxMs, audio, onTick}) →
   *   { start(), pause(), resume(), stop() -> Promise<Blob>, ms, state }
   */
  function capture(opts) {
    const o = opts || {};
    const stream = o.stream;
    if (!stream) throw new Error('capture needs a MediaStream');
    if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder is not available here');

    const hasVideo = !!(stream.getVideoTracks && stream.getVideoTracks().length);
    const M = AM();
    const rates = (M && M.codec && M.codec.rates) ? M.codec.rates(o.width, o.height, o.fps)
      : { videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000 };
    const mime = o.mime || (M && M.codec ? M.codec.recorder({ audioOnly: !hasVideo }) : '') ||
      'video/webm;codecs=vp8,opus';

    const recOpts = { videoBitsPerSecond: o.videoBitsPerSecond || rates.videoBitsPerSecond, audioBitsPerSecond: 128000 };
    if (mime) recOpts.mimeType = mime;
    if (o.audio === false) delete recOpts.audioBitsPerSecond;

    let rec;
    try { rec = new MediaRecorder(stream, recOpts); }
    catch (e) {
      try { rec = new MediaRecorder(stream); }
      catch (e2) { throw new Error('cannot start a recorder: ' + e2.message); }
    }

    const chunks = [];
    let t0 = 0, acc = 0, capTimer = null, tickTimer = null, stopped = null;
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };

    // attach onstop before rec.stop() so the final chunk can never be dropped
    const finish = () => new Promise(res => {
      const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
      const done = () => res(new Blob(chunks, { type }));
      if (rec.state === 'inactive') return done();
      rec.onstop = done;
    });

    const handle = {
      get mime() { return rec.mimeType || mime; },
      get state() { return rec.state; },
      get ms() { return acc + (rec.state === 'recording' && t0 ? Date.now() - t0 : 0); },
      start(delay) {
        if (rec.state !== 'inactive') return handle;
        chunks.length = 0; acc = 0; t0 = Date.now();
        rec.start(delay === undefined ? 250 : delay);
        if (o.maxMs) capTimer = setTimeout(() => handle.stop(), o.maxMs);
        if (o.onTick) tickTimer = setInterval(() => o.onTick(handle.ms), 250);
        return handle;
      },
      pause() { if (rec.state === 'recording') { acc += Date.now() - t0; rec.pause(); } return handle; },
      resume() { if (rec.state === 'paused') { t0 = Date.now(); rec.resume(); } return handle; },
      stop() {
        if (stopped) return stopped;
        stopped = finish();
        if (capTimer) { clearTimeout(capTimer); capTimer = null; }
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
        if (rec.state === 'recording' || rec.state === 'paused') {
          acc += Date.now() - t0;
          try { rec.requestData(); } catch (_) {}
          try { rec.stop(); } catch (_) {}
        }
        return stopped;
      }
    };
    return handle;
  }

  // ── compose ────────────────────────────────────────────────────────────────
  /**
   * compose({clips, width, height, fps, filter, draws, texts, onProgress, mime})
   *   clips: [{src|blob, start, end, filter, adjust}]
   *
   * Plays each clip in a hidden video, paints it (plus overlays) onto a canvas
   * and records the canvas — one pass, audio and picture stay in step.
   */
  async function compose(opts) {
    const o = opts || {};
    const input = (o.clips || []).filter(c => c && (c.src || c.blob || c.url));
    if (!input.length) throw new Error('compose: no clips given');
    if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder is not available here');

    const W = Math.round(o.width || 1280);
    const H = Math.round(o.height || 720);
    const fps = Math.round(o.fps || 30);
    const mime = o.mime || exportMime();
    const M = AM();
    const rates = (M && M.codec && M.codec.rates) ? M.codec.rates(W, H, fps) : { videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000 };

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

    // load everything first so the recording pass never stalls on a decode
    const AMV = AM();
    const readDur = v => (AMV && AMV.video && AMV.video.resolveDuration)
      ? AMV.video.resolveDuration(v)
      : Promise.resolve(isFinite(v.duration) && v.duration > 0 ? v.duration : 0);
    const items = [];
    for (const c of input) {
      const url = c.blob ? URL.createObjectURL(c.blob) : (c.src || c.url);
      const v = makeVideo(url);
      await when(v, 'loadedmetadata');
      const dur = await readDur(v);
      const range = clampRange({ start: c.start || 0, end: c.end === undefined ? dur : c.end }, dur);
      items.push({ clip: c, video: v, url, range });
    }

    const total = items.reduce((s, it) => s + it.range.length, 0);
    if (!(total > 0)) { items.forEach(it => { try { it.video.removeAttribute('src'); it.video.load(); } catch (_) {} }); throw new Error('compose: total length is zero'); }

    const canvasStream = canvas.captureStream(fps);
    let tracks = canvasStream.getVideoTracks().slice();

    // audio: route every source through one context, silent (no speaker echo)
    let actx = null, dest = null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC && o.audio !== false) {
        actx = new AC();
        dest = actx.createMediaStreamDestination();
        items.forEach(it => {
          const node = actx.createMediaElementSource(it.video);
          node.connect(dest);
        });
        tracks = tracks.concat(dest.stream.getAudioTracks());
        if (actx.state === 'suspended') await actx.resume();
      }
    } catch (e) { actx = null; dest = null; }

    const recOpts = { videoBitsPerSecond: o.videoBitsPerSecond || rates.videoBitsPerSecond, audioBitsPerSecond: 128000 };
    if (mime) recOpts.mimeType = mime;
    let rec;
    try { rec = new MediaRecorder(new MediaStream(tracks), recOpts); }
    catch (e) {
      try { rec = new MediaRecorder(new MediaStream(tracks)); }
      catch (e2) { cleanup(); throw new Error('compose: recorder refused to start (' + e2.message + ')'); }
    }

    const chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };

    function cleanup() {
      items.forEach(it => {
        try { it.video.pause(); it.video.removeAttribute('src'); it.video.load(); } catch (_) {}
        if (it.clip.blob && it.url) { try { URL.revokeObjectURL(it.url); } catch (_) {} }
      });
      try { canvasStream.getTracks().forEach(t => t.stop()); } catch (_) {}
      if (actx) { try { actx.close(); } catch (_) {} }
    }

    const done = new Promise((res, rej) => {
      rec.onerror = e => { cleanup(); rej(new Error('compose: ' + (e.error && e.error.message || 'recording error'))); };
      rec.onstop = () => {
        const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
        const out = new Blob(chunks, { type });
        cleanup();
        res(out);
      };
    });

    rec.start(500);

    try {
      let elapsed = 0;
      for (const it of items) {
        const v = it.video;
        v.currentTime = it.range.start;
        await seekTo(v, it.range.start);
        try { await v.play(); }
        catch (e) {
          // autoplay refused the unmuted element — retry silent rather than fail
          try { v.muted = true; await v.play(); }
          catch (e2) { throw new Error('compose: playback blocked (' + e.message + ')'); }
        }

        await new Promise((res, rej) => {
          let settled = false;
          const done = () => { if (settled) return; settled = true; clearTimeout(guard); res(); };
          const fail = e => { if (settled) return; settled = true; clearTimeout(guard); rej(e); };
          // a stalled compositor must not hang the export for ever
          const guard = setTimeout(() => fail(new Error('compose: the ' + it.range.length.toFixed(2) + 's clip never finished playing')),
            (it.range.length + 3) * 1000);
          const t01 = () => (elapsed + (v.currentTime - it.range.start)) / total;
          const step = () => {
            if (settled) return;
            if (v.currentTime >= it.range.end - 0.02 || v.ended) { done(); return; }
            try {
              const f = o.filter || it.clip.filter;
              const css = filterString(f, it.clip.adjust || o.adjust);
              ctx.filter = css || 'none';
              ctx.drawImage(v, 0, 0, W, H);
              ctx.filter = 'none';
              const t = elapsed + (v.currentTime - it.range.start);
              paintDraw(ctx, it.clip.draws || o.draws, W, H, t);
              paintText(ctx, it.clip.texts || o.texts, W, H, t);
            } catch (e) { fail(e); return; }
            if (o.onProgress) o.onProgress(clamp(t01(), 0, 1));
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }).catch(e => { try { v.pause(); } catch (_) {} throw e; });

        v.pause();
        elapsed += it.range.length;
      }
      // let the last frame land before cutting the recorder
      await new Promise(r => setTimeout(r, 180));
      rec.stop();
    } catch (e) {
      try { if (rec.state !== 'inactive') rec.stop(); } catch (_) {}
      cleanup();
      throw e;
    }
    return done;
  }

  // ── small inspection helpers ───────────────────────────────────────────────
  async function inspect(blob) {
    const M = AM();
    const url = URL.createObjectURL(blob);
    try {
      const v = makeVideo(url);
      await when(v, 'loadedmetadata');
      const dur = (M && M.video && M.video.resolveDuration) ? await M.video.resolveDuration(v)
        : (isFinite(v.duration) ? v.duration : 0);
      const out = {
        duration: dur,
        width: v.videoWidth, height: v.videoHeight,
        size: blob.size, type: blob.type
      };
      try { v.removeAttribute('src'); v.load(); } catch (_) {}
      return out;
    } finally { try { URL.revokeObjectURL(url); } catch (_) {} }
  }

  return {
    clampRange, totalDuration, splitTimeline,
    FILTERS, filterString, paintDraw, paintText,
    EXPORT_CHAIN, exportMime,
    capture, compose, inspect
  };
});
