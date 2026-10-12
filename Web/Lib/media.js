// ─────────────────────────────────────────────────────────────────────────────
//  Afterbell · Lib/media.js
//
//  Media plumbing for the clip side of the app:
//    store    – IndexedDB wrapper (blobs in, blobs out, no schema drama)
//    codec    – MediaRecorder / canPlayType probing and preference chains
//    net      – ranged fetch with progress, probe-before-download, failover
//    archive  – archive.org advancedsearch + metadata + download, audio first
//    video    – duration, evenly spaced frame grids, thumbnails
//    hash     – 64 bit perceptual hash (pHash) + hamming distance
//
//  Plain script: <script src="Lib/media.js"></script> gives you global AbMedia.
//  The pure helpers (frameTimes, pHashFromGray, hashDistance, URL builders,
//  audio file ranking, codec chain order) are also require()-able in node so
//  they can be unit tested without a browser.
// ─────────────────────────────────────────────────────────────────────────────
;(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbMedia = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ── small helpers ──────────────────────────────────────────────────────────
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clamp = (n, lo, hi) => n < lo ? lo : n > hi ? hi : n;

  function bytesLabel(n) {
    if (!isFinite(n) || n <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0, v = +n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    const shown = v % 1 === 0 ? Math.round(v) : Math.round(v * 10) / 10;
    return shown + ' ' + u[i];
  }

  // encode one path segment, keep the slashes that separate them
  function encodePath(p) {
    return String(p).split('/').map(encodeURIComponent).join('/');
  }

  // ── store — IndexedDB ──────────────────────────────────────────────────────
  //  open("afterbell", 1, db => { if (!db.objectStoreNames.contains("clips"))
  //                                 db.createObjectStore("clips", {keyPath:"id"}); })
  //  put("afterbell", "clips", {id:"c1", blob})
  const store = (() => {
    const open = Object.create(null);   // name -> Promise<IDBDatabase>

    function raw(name, version, upgrade) {
      if (open[name]) return open[name];
      open[name] = new Promise((res, rej) => {
        if (typeof indexedDB === 'undefined') return rej(new Error('no IndexedDB in this environment'));
        let req;
        try { req = indexedDB.open(name, version || 1); }
        catch (e) { return rej(e); }
        req.onupgradeneeded = e => { try { upgrade && upgrade(e.target.result, e.oldVersion, e.newVersion); } catch (err) { req.transaction.abort(); rej(err); } };
        req.onsuccess = e => {
          const db = e.target.result;
          db.onversionchange = () => { try { db.close(); } catch (_) {} delete open[name]; };
          res(db);
        };
        req.onerror = () => { delete open[name]; rej(req.error || new Error('open failed: ' + name)); };
        req.onblocked = () => rej(new Error('blocked: another tab holds ' + name));
      });
      return open[name];
    }

    // run a request against one object store, resolving with IDBRequest results
    function tx(name, storeName, mode, fn) {
      return raw(name).then(db => new Promise((res, rej) => {
        if (!db.objectStoreNames.contains(storeName)) return rej(new Error('no store "' + storeName + '" in ' + name));
        const t = db.transaction(storeName, mode || 'readonly');
        let out;
        try { out = fn(t.objectStore(storeName), t); }
        catch (e) { try { t.abort(); } catch (_) {} return rej(e); }
        t.oncomplete = () => {
          // every store op returns an IDBRequest. resolve with its .result so a
          // missing key comes back as undefined — not the request object, which
          // is truthy and made lookups of absent records look like hits.
          const isReq = out != null && typeof out === 'object' && 'onsuccess' in out && 'result' in out;
          res(isReq ? out.result : out);
        };
        t.onerror = () => rej(t.error || new Error('tx failed'));
        t.onabort = () => rej(t.error || new Error('tx aborted'));
      }));
    }

    return {
      open: raw,
      /** put a record, returns its key */
      put(name, storeName, value, key) {
        return tx(name, storeName, 'readwrite', st => (key === undefined ? st.put(value) : st.put(value, key)));
      },
      get(name, storeName, key) {
        return tx(name, storeName, 'readonly', st => st.get(key));
      },
      del(name, storeName, key) {
        return tx(name, storeName, 'readwrite', st => st.delete(key));
      },
      all(name, storeName) {
        return tx(name, storeName, 'readonly', st => st.getAll());
      },
      keys(name, storeName) {
        return tx(name, storeName, 'readonly', st => st.getAllKeys());
      },
      count(name, storeName) {
        return tx(name, storeName, 'readonly', st => st.count());
      },
      clear(name, storeName) {
        return tx(name, storeName, 'readwrite', st => st.clear());
      },
      /** read-modify-write a record in one transaction */
      async update(name, storeName, key, mutate) {
        const cur = await this.get(name, storeName, key);
        const next = mutate(cur);
        if (next === undefined) return cur;
        await this.put(name, storeName, next);
        return next;
      },
      _cache: open
    };
  })();

  // ── codec — what will this browser actually record and play ────────────────
  const codec = (() => {
    // preference chain: webm vp9 first (desktop quality), mp4 h264 second
    // (safari + everything), then whatever else is lying around.
    const CHAIN = [
      'video/webm;codecs=vp9,opus',
      'video/mp4;codecs=avc1,aac',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
      'video/mp4'
    ];
    const AUDIO_CHAIN = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

    const isRec = m => { try { return !!(window.MediaRecorder && MediaRecorder.isTypeSupported(m)); } catch (_) { return false; } };
    const canPlay = m => { try { return !!(document.createElement('video').canPlayType(m)); } catch (_) { return false; } };

    return {
      CHAIN, AUDIO_CHAIN,
      supports: m => isRec(m),
      plays: m => canPlay(m),
      /** first supported mime from `chain`, or "" */
      pick(chain, test) {
        const t = test || isRec;
        for (const m of chain) if (t(m)) return m;
        return '';
      },
      /** best recording mime for this browser */
      recorder(opts) {
        const o = opts || {};
        if (o.mime) return isRec(o.mime) ? o.mime : this.pick(CHAIN);
        if (o.audioOnly) return this.pick(AUDIO_CHAIN) || this.pick(CHAIN);
        return this.pick(o.chain || CHAIN);
      },
      /** does a blob of this type decode in a <video>? */
      playable(type) { return canPlay((type || '').split(';')[0]); },
      /** 720p / 30fps target. audio stays at or under 128k. */
      rates(w, h, fps) {
        const pixels = Math.max(1, (w || 1280) * (h || 720));
        const frames = clamp(fps || 30, 1, 60);
        // ~0.16 bits per pixel per frame, floor 600k, ceiling 8M
        const v = Math.round(clamp(pixels * frames * 0.16, 600e3, 8e6));
        return { videoBitsPerSecond: v, audioBitsPerSecond: 128000 };
      },
      isRec
    };
  })();

  // ── net — ranged fetch, probes, failover ───────────────────────────────────
  const net = (() => {
    // Optional secondary metadata hosts. Left empty on purpose — archive.org is
    // the source of truth; fill this in if you want a mirrored lookup.
    const fallbacks = [];

    async function probe(url, opts) {
      const o = opts || {};
      const init = { method: o.method || 'GET', headers: {} };
      if (o.range !== false) init.headers.Range = 'bytes=0-0';
      if (o.headers) Object.assign(init.headers, o.headers);
      let res;
      try { res = await fetch(url, init); }
      catch (e) { return { ok: false, error: String(e && e.message || e), url }; }
      const len = +(res.headers.get('content-length') || 0);
      const cr = res.headers.get('content-range');
      const partial = res.status === 206 || !!cr;
      // Content-Range can be "bytes 0-0/*" when the server will not say how
      // big the file is. Report 0 (unknown) rather than the 1 byte we asked for.
      const raw = cr ? +((cr.split('/')[1] || '0')) : len;
      const total = isFinite(raw) && raw > 1 ? raw : 0;
      // no body wanted — drop it
      try { if (o.body !== true && res.body && res.body.cancel) res.body.cancel(); } catch (_) {}
      return {
        ok: res.ok, status: res.status, url, partial, len, total,
        type: (res.headers.get('content-type') || '').split(';')[0],
        length: total,
        acceptRanges: (res.headers.get('accept-ranges') || '').includes('bytes')
      };
    }

    /** fetch a url as a Blob, optionally ranged, with byte progress */
    function blob(url, opts) {
      const o = opts || {};
      const init = { headers: Object.assign({}, o.headers) };
      if (o.range) init.headers.Range = 'bytes=' + o.range;
      if (o.signal) init.signal = o.signal;
      return fetch(url, init).then(res => {
        if (!res.ok && res.status !== 206) throw new Error('HTTP ' + res.status + ' for ' + url);
        const total = +(res.headers.get('content-length') || 0);
        if (!o.onProgress || !res.body || !res.body.getReader) return res.blob().then(b => { o.onProgress && o.onProgress(1, total || b.size); return b; });
        const reader = res.body.getReader();
        const chunks = [];
        let got = 0;
        return (function pump() {
          return reader.read().then(r => {
            if (r.done) {
              const out = new Blob(chunks, { type: (res.headers.get('content-type') || o.type || '').split(';')[0] || 'application/octet-stream' });
              o.onProgress(1, out.size);
              return out;
            }
            chunks.push(r.value); got += r.value.byteLength;
            o.onProgress(total ? Math.min(1, got / total) : 0, got, total);
            return pump();
          });
        })();
      });
    }

    /** try urls in order until one resolves */
    function failover(urls, fn) {
      const list = (urls || []).filter(Boolean);
      let i = 0, last;
      const step = () => {
        if (i >= list.length) return Promise.reject(last || new Error('no url to try'));
        const u = list[i++];
        return Promise.resolve().then(() => fn(u)).catch(e => { last = e; return step(); });
      };
      return step();
    }

    return { probe, blob, failover, fallbacks };
  })();

  // ── archive — archive.org ──────────────────────────────────────────────────
  const archive = (() => {
    const HOST = 'https://archive.org';

    const searchUrl = (q, o) => {
      const opt = o || {};
      const rows = clamp(opt.rows || 20, 1, 100);
      // one q only — advancedsearch takes the first q= it sees, so bolting a
      // second one on the end quietly returns zero results.
      const query = opt.mediaType ? '(' + q + ') AND mediatype:(' + opt.mediaType + ')' : q;
      const p = new URLSearchParams();
      p.set('q', query);
      (opt.fields || ['identifier', 'title', 'creator', 'year', 'downloads', 'mediatype', 'item_size'])
        .forEach(f => p.append('fl[]', f));
      p.append('sort[]', opt.sort || 'downloads desc');
      p.set('rows', rows);
      p.set('page', opt.page || 1);
      p.set('output', 'json');
      return HOST + '/advancedsearch.php?' + p.toString();
    };

    const metadataUrl = id => HOST + '/metadata/' + encodeURIComponent(id);

    const downloadUrl = (id, file) => HOST + '/download/' + encodeURIComponent(id) + '/' + encodePath(file);

    // audio-ish formats we would rather serve than a 600MB lossless rip
    const AUDIO_FMT = ['VBR MP3', 'MP3', '128Kbps MP3', 'Ogg Vorbis', 'Vorbis', 'opus', 'Ogg Opus', 'flac', 'Flac', 'AIFF', 'Wave'];
    const rankFmt = f => { const i = AUDIO_FMT.indexOf(f); return i < 0 ? 99 : i; };

    function audioFiles(meta) {
      const files = (meta && meta.files) || [];
      return files
        .filter(f => f && f.name && /audio|mp3|ogg|opus|flac|wav|m4a|aiff/i.test((f.format || '') + ' ' + f.name) && !/\.(torrent|xml|json|gz|jpg|png|pdf)$/i.test(f.name))
        .map(f => ({
          name: f.name,
          format: f.format || '',
          size: +(f.size || 0),
          length: +(f.length || 0),
          bitrate: +(f.bitrate || 0),
          source: f.source || '',
          rank: rankFmt(f.format)
        }))
        .sort((a, b) => a.rank - b.rank || a.size - b.size);
    }

    const search = (q, o) => fetch(searchUrl(q, o)).then(r => {
      if (!r.ok) throw new Error('search HTTP ' + r.status);
      return r.json();
    }).then(j => (j && j.response && j.response.docs) || []);

    const metadata = id => fetch(metadataUrl(id)).then(r => {
      if (!r.ok) throw new Error('metadata HTTP ' + r.status);
      return r.json();
    });

    /** one call: search → metadata → ranked audio file → verified url */
    async function audio(query, opts) {
      const o = opts || {};
      let id = o.id;
      if (!id) {
        const docs = await search(query, { rows: o.rows || 8, mediaType: 'audio', sort: o.sort });
        if (!docs.length) throw new Error('no audio matches for "' + query + '"');
        id = (o.prefer && docs.find(d => d.identifier === o.prefer) || docs[0]).identifier;
      }
      const meta = await metadata(id);
      const files = audioFiles(meta);
      if (!files.length) throw new Error('"' + id + '" has no playable audio file');
      const file = files[0];
      const url = downloadUrl(id, file.name);
      const out = {
        id,
        title: (meta.metadata && (meta.metadata.title || meta.metadata.identifier)) || id,
        creator: (meta.metadata && (meta.metadata.creator || '')) || '',
        year: (meta.metadata && (meta.metadata.year || '')) || '',
        file, url, files, meta
      };
      if (o.probe !== false) {
        const p = await net.probe(url);
        out.probe = p;
        if (!p.ok) {
          // next file down the list, then give up loudly
          for (let i = 1; i < files.length; i++) {
            const alt = downloadUrl(id, files[i].name);
            const ap = await net.probe(alt);
            if (ap.ok) { out.file = files[i]; out.url = alt; out.probe = ap; return out; }
          }
          throw new Error('every audio file for "' + id + '" failed its range probe');
        }
      }
      return out;
    }

    /** download the audio of a match as a Blob */
    function fetchAudio(hit, opts) {
      return net.blob(hit.url, opts);
    }

    return { HOST, searchUrl, metadataUrl, downloadUrl, search, metadata, audio, audioFiles, fetchAudio, rankFmt };
  })();

  // ── video — load, measure, cut a frame grid ────────────────────────────────
  const video = (() => {
    function el(url) {
      const v = document.createElement('video');
      v.preload = 'auto'; v.muted = true; v.playsInline = true;
      v.crossOrigin = 'anonymous';
      v.src = url;
      return v;
    }
    const revocable = blob => { const u = URL.createObjectURL(blob); return { url: u, done: () => { try { URL.revokeObjectURL(u); } catch (_) {} } }; };

    function loaded(v, ev, timeout) {
      return new Promise((res, rej) => {
        if (ev === 'loadedmetadata' && v.readyState >= 1) return res();
        let settled = false;
        const cleanup = () => {
          clearTimeout(guard);
          v.removeEventListener(ev, ok); v.removeEventListener('error', bad);
        };
        const ok = () => { if (settled) return; settled = true; cleanup(); res(); };
        const bad = () => { if (settled) return; settled = true; cleanup(); rej(new Error('video ' + ev + ' failed')); };
        const guard = setTimeout(bad, timeout === undefined ? 8000 : timeout);
        v.addEventListener(ev, ok, { once: true });
        v.addEventListener('error', bad, { once: true });
        if (v.readyState >= 1 && ev === 'loadedmetadata') ok();
      });
    }

    function seek(v, t, timeout) {
      return new Promise((res, rej) => {
        if (Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) return res();
        let settled = false;
        const cleanup = () => { clearTimeout(guard); v.removeEventListener('seeked', ok); v.removeEventListener('error', bad); };
        const ok = () => { if (settled) return; settled = true; cleanup(); res(); };
        const bad = () => { if (settled) return; settled = true; cleanup(); rej(new Error('seek to ' + t + 's failed')); };
        const guard = setTimeout(bad, timeout === undefined ? 8000 : timeout);
        v.addEventListener('seeked', ok, { once: true });
        v.addEventListener('error', bad, { once: true });
        try { v.currentTime = t; } catch (e) { bad(); }
      });
    }

    /**
     * A webm written by MediaRecorder carries no duration header, so
     * video.duration comes back as Infinity until something forces the
     * demuxer to walk to the end. That is what this does — without it every
     * "evenly spaced stills" grid would be the same first frame.
     */
    function resolveDuration(v) {
      if (isFinite(v.duration) && v.duration > 0) return Promise.resolve(v.duration);
      return new Promise(res => {
        let done = false, guard = null;
        const finish = () => {
          if (done) return;
          done = true;
          if (guard) clearTimeout(guard);
          v.removeEventListener('durationchange', check);
          v.removeEventListener('seeked', check);
          let d = isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
          if (!d) { try { const s = v.seekable; if (s && s.length) d = s.end(s.length - 1); } catch (_) {} }
          try { if (v.currentTime !== 0) v.currentTime = 0; } catch (_) {}
          res(d || 0);
        };
        const check = () => { if (isFinite(v.duration) && v.duration > 0) finish(); };
        v.addEventListener('durationchange', check);
        v.addEventListener('seeked', check);
        guard = setTimeout(finish, 1500);
        try { v.currentTime = 1e6; } catch (_) { finish(); }
      });
    }

    const duration = blob => {
      const r = revocable(blob);
      const v = el(r.url);
      return loaded(v, 'loadedmetadata')
        .then(() => resolveDuration(v))
        .then(d => { v.removeAttribute('src'); v.load(); r.done(); return d; })
        .catch(e => { r.done(); throw e; });
    };

    /**
     * Where to stand to grab `count` stills across `d` seconds.
     * Centre of each equal slice — the first and last frame never come out
     * black or half-decoded, which is what 0 and d give you.
     * Pure function, unit tested.
     */
    function frameTimes(d, count) {
      const dur = isFinite(d) && d > 0 ? d : 0;
      const n = Math.max(1, Math.min(64, Math.round(count) || 1));
      if (!dur) return new Array(n).fill(0);
      const out = [];
      for (let i = 0; i < n; i++) out.push(((i + 0.5) / n) * dur);
      return out;
    }

    /**
     * The review grid: `count` jpegs pulled evenly across the clip.
     * Returns [{blob,time,width,height}]. Uses one seek per still.
     */
    async function frames(blob, count, opts) {
      const o = opts || {};
      const r = revocable(blob);
      const v = el(r.url);
      try {
        await loaded(v, 'loadedmetadata');
        const d = await resolveDuration(v);
        const times = frameTimes(d, count);
        const vw = v.videoWidth || o.width || 640;
        const vh = v.videoHeight || o.height || 360;
        const scale = o.max ? Math.min(1, o.max / Math.max(vw, vh)) : 1;
        const w = Math.max(2, Math.round(vw * scale)), h = Math.max(2, Math.round(vh * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        const type = o.type || 'image/jpeg';
        const q = o.quality === undefined ? 0.82 : o.quality;
        const out = [];
        for (const t of times) {
          await seek(v, Math.min(d ? d - 0.02 : 0, Math.max(0, t)));
          ctx.drawImage(v, 0, 0, w, h);
          const b = await new Promise(res => cv.toBlob(res, type, q));
          if (b) out.push({ blob: b, time: Math.round(t * 100) / 100, width: w, height: h });
        }
        return out;
      } finally {
        try { v.removeAttribute('src'); v.load(); } catch (_) {}
        r.done();
      }
    }

    /** first decent frame, for cover art */
    async function thumb(blob, opts) {
      const got = await frames(blob, 1, opts);
      return got.length ? got[0].blob : null;
    }

    return { el, duration, resolveDuration, frameTimes, frames, thumb };
  })();

  // ── hash — 64 bit perceptual fingerprint ───────────────────────────────────
  //  Project spec §4: a rejected clip is fingerprinted so a re-upload of the
  //  same footage auto-flags without a second manual review.
  const hash = (() => {
    /** box-average a grayscale buffer down to size×size */
    function resizeGray(src, sw, sh, size) {
      const out = new Float64Array(size * size);
      const xr = sw / size, yr = sh / size;
      for (let y = 0; y < size; y++) {
        const y0 = Math.floor(y * yr), y1 = Math.max(y0 + 1, Math.floor((y + 1) * yr));
        for (let x = 0; x < size; x++) {
          const x0 = Math.floor(x * xr), x1 = Math.max(x0 + 1, Math.floor((x + 1) * xr));
          let s = 0, n = 0;
          for (let yy = y0; yy < y1 && yy < sh; yy++)
            for (let xx = x0; xx < x1 && xx < sw; xx++) { s += src[yy * sw + xx]; n++; }
          out[y * size + x] = n ? s / n : 0;
        }
      }
      return out;
    }

    /** orthonormal DCT-II, separable, n is a power of two (32 here) */
    function dct2(g, n) {
      const cos = [];
      for (let u = 0; u < n; u++) {
        cos[u] = new Float64Array(n);
        for (let x = 0; x < n; x++) cos[u][x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n));
      }
      const cu = u => (u === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n));
      const tmp = new Float64Array(n * n);
      for (let y = 0; y < n; y++)            // rows
        for (let u = 0; u < n; u++) {
          let s = 0;
          for (let x = 0; x < n; x++) s += g[y * n + x] * cos[u][x];
          tmp[y * n + u] = s * cu(u);
        }
      const out = new Float64Array(n * n);
      for (let u = 0; u < n; u++)            // cols
        for (let v = 0; v < n; v++) {
          let s = 0;
          for (let y = 0; y < n; y++) s += tmp[y * n + v] * cos[u][y];
          out[u * n + v] = s * cu(u);
        }
      return out;
    }

    /**
     * pHash from an already grayscale buffer. Pure — no canvas, no DOM.
     * Returns a 16 char hex string.
     */
    function pHashFromGray(gray, w, h) {
      const small = resizeGray(gray, w, h, 32);
      const d = dct2(small, 32);
      const low = [];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) low.push(d[y * 32 + x]);
      const rest = low.slice(1);                       // drop the DC term
      const sorted = rest.slice().sort((a, b) => a - b);
      const mid = sorted[Math.floor(sorted.length / 2)];
      // Smooth frames pile a lot of coefficients onto zero, so the median is
      // often a tie. Comparing with a relative epsilon keeps those bits from
      // flipping on float noise — which is what makes hashes stable across
      // re-encodes and resolution changes.
      const eps = Math.max(1e-6, Math.abs(sorted[sorted.length - 1] - sorted[0]) * 1e-6);
      // 64 on/off decisions → 16 hex chars. Kept as a byte array on purpose:
      // a Number cannot hold 64 bits without losing the tail.
      const bit = new Uint8Array(64);
      for (let i = 0; i < 64; i++) bit[i] = low[i] > mid + eps ? 1 : 0;
      let hex = '';
      for (let i = 0; i < 64; i += 4)
        hex += (bit[i] * 8 + bit[i + 1] * 4 + bit[i + 2] * 2 + bit[i + 3]).toString(16);
      return hex;
    }

    /** ImageData / canvas → pHash */
    function pHash(data, w, h) {
      const n = w * h;
      const g = new Float64Array(n);
      for (let i = 0, p = 0; i < n; i++, p += 4)
        g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      return pHashFromGray(g, w, h);
    }

    /** hamming distance between two hex hashes, 0..64 */
    function hashDistance(a, b) {
      if (!a || !b || a.length !== b.length) return 64;
      let dist = 0;
      for (let i = 0; i < a.length; i++) {
        let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
        while (x) { dist += x & 1; x >>= 1; }
      }
      return dist;
    }

    /** true when two hashes are the same footage */
    const matches = (a, b, threshold) => hashDistance(a, b) <= (threshold === undefined ? 8 : threshold);

    return { pHashFromGray, pHash, hashDistance, matches, _resizeGray: resizeGray, _dct2: dct2 };
  })();

  return { uid, clamp, bytesLabel, encodePath, store, codec, net, archive, video, hash };
});
