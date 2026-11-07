// VALE harness — round 4 MEM-1: an init script (page.addInitScript) that tallies what the page holds, below three.js, so
// it works in the minified production client with no dev handle:
//   GL       every live texture, buffer and renderbuffer of every WebGL2 context, with the bytes its storage calls asked
//            for (texImage / texStorage / compressed uploads per level and face, bufferData, renderbufferStorage × samples)
//   audio    every AudioBuffer decodeAudioData or createBuffer made that is still reachable (WeakRef, read after a GC)
//   bitmaps  every ImageBitmap createImageBitmap made that is neither closed nor collected
// window.__memTrack() returns the totals and the largest live textures. Load it with page.addInitScript({ path }).
(() => {
  if (window.__memTrack) return;
  const G = WebGL2RenderingContext.prototype;
  const tex = new Map(), buf = new Map(), rb = new Map(); let programs = 0;
  /** per context: the active unit and what is bound */
  const st = new WeakMap();
  const S = (gl) => { let s = st.get(gl); if (!s) { s = { unit: 0, tex: new Map(), buf: new Map(), rb: null }; st.set(gl, s); } return s; };
  const BPP = {
    0x8058: 4, 0x8C43: 4, 0x881A: 8, 0x8814: 16, 0x8229: 1, 0x822B: 2, 0x822D: 2, 0x822F: 4, 0x822E: 4, 0x8230: 8, 0x8051: 4, 0x8C41: 4,
    0x881B: 8, 0x8815: 12, 0x81A6: 4, 0x88F0: 4, 0x8CAC: 4, 0x8CAD: 8, 0x8059: 4, 0x8C3A: 4, 0x8C3D: 4, 0x81A5: 2, 0x8D48: 1, 0x8235: 4, 0x8236: 4, 0x8233: 2, 0x8234: 2,
    0x8232: 1, 0x8231: 1, 0x8237: 1, 0x8238: 1, 0x8D7C: 4, 0x8D7D: 4, 0x8D70: 16, 0x8D71: 12, 0x8D76: 8, 0x8D77: 6,
  };
  /** unsized formats: RGBA 0x1908, RGB 0x1907, LUMINANCE etc; the type picks the size */
  const unsized = (fmt, type) => { const ch = { 0x1908: 4, 0x1907: 3, 0x1909: 1, 0x190A: 2, 0x1906: 1, 0x1902: 4, 0x84F9: 4 }[fmt] ?? 4; const t = { 0x1401: 1, 0x140B: 2, 0x8D61: 2, 0x1406: 4, 0x1405: 4, 0x1403: 2 }[type] ?? 1; return ch * t; };
  const bpp = (ifmt, type) => BPP[ifmt] ?? unsized(ifmt, type);
  const binding = (target) => (target >= 0x8515 && target <= 0x851A ? 0x8513 : target);   // a cube face → the cube binding
  const cur = (gl, target) => S(gl).tex.get(`${S(gl).unit}:${binding(target)}`);
  const setLevel = (t, key, bytes, w, h, d, ifmt) => { if (!t) return; const r = tex.get(t); if (!r) return; r.levels.set(key, bytes); if (key.startsWith('0:')) { r.w = w; r.h = h; r.d = d; r.fmt = ifmt; } };
  const dims = (src) => [src?.width ?? src?.videoWidth ?? src?.displayWidth ?? 0, src?.height ?? src?.videoHeight ?? src?.displayHeight ?? 0];
  const wrap = (name, fn) => { const o = G[name]; if (typeof o !== 'function') return; G[name] = function (...a) { try { fn.call(this, ...a); } catch { /* the tally never breaks the page */ } return o.apply(this, a); }; };
  const wrapRet = (name, fn) => { const o = G[name]; if (typeof o !== 'function') return; G[name] = function (...a) { const r = o.apply(this, a); try { fn.call(this, r, ...a); } catch { /* */ } return r; }; };

  wrapRet('createTexture', (t) => { if (t) tex.set(t, { levels: new Map(), w: 0, h: 0, d: 1, fmt: 0, at: performance.now() }); });
  wrap('deleteTexture', (t) => { tex.delete(t); });
  wrap('activeTexture', function (u) { S(this).unit = u - 0x84C0; });
  wrap('bindTexture', function (target, t) { S(this).tex.set(`${S(this).unit}:${target}`, t); });
  wrap('texImage2D', function (target, level, ifmt, ...r) {
    let w, h, type;
    if (r.length >= 6) { [w, h] = r; type = r[4]; } else { [w, h] = dims(r[2]); type = r[1]; }
    setLevel(cur(this, target), `${level}:${target}`, w * h * bpp(ifmt, type), w, h, 1, ifmt);
  });
  wrap('texImage3D', function (target, level, ifmt, w, h, d, b, fmt, type) { setLevel(cur(this, target), `${level}:${target}`, w * h * d * bpp(ifmt, type), w, h, d, ifmt); });
  wrap('texStorage2D', function (target, levels, ifmt, w, h) {
    const t = cur(this, target), faces = target === 0x8513 ? 6 : 1;
    for (let l = 0; l < levels; l++) setLevel(t, `${l}:${target}`, Math.max(1, w >> l) * Math.max(1, h >> l) * bpp(ifmt) * faces, w, h, 1, ifmt);
  });
  wrap('texStorage3D', function (target, levels, ifmt, w, h, d) {
    const t = cur(this, target), is3d = target === 0x806F;
    for (let l = 0; l < levels; l++) setLevel(t, `${l}:${target}`, Math.max(1, w >> l) * Math.max(1, h >> l) * (is3d ? Math.max(1, d >> l) : d) * bpp(ifmt), w, h, d, ifmt);
  });
  wrap('compressedTexImage2D', function (target, level, ifmt, w, h, b, data) { setLevel(cur(this, target), `${level}:${target}`, data?.byteLength ?? (typeof data === 'number' ? data : 0), w, h, 1, ifmt); });
  wrap('compressedTexImage3D', function (target, level, ifmt, w, h, d, b, data) { setLevel(cur(this, target), `${level}:${target}`, data?.byteLength ?? (typeof data === 'number' ? data : 0), w, h, d, ifmt); });

  wrapRet('createBuffer', (b) => { if (b) buf.set(b, 0); });
  wrap('deleteBuffer', (b) => { buf.delete(b); });
  wrap('bindBuffer', function (target, b) { S(this).buf.set(target, b); });
  wrap('bufferData', function (target, data) { const b = S(this).buf.get(target); if (b && buf.has(b)) buf.set(b, typeof data === 'number' ? data : data?.byteLength ?? 0); });

  wrapRet('createRenderbuffer', (r) => { if (r) rb.set(r, 0); });
  wrap('deleteRenderbuffer', (r) => { rb.delete(r); });
  wrap('bindRenderbuffer', function (target, r) { S(this).rb = r; });
  wrap('renderbufferStorage', function (target, ifmt, w, h) { const r = S(this).rb; if (r && rb.has(r)) rb.set(r, w * h * bpp(ifmt)); });
  wrap('renderbufferStorageMultisample', function (target, samples, ifmt, w, h) { const r = S(this).rb; if (r && rb.has(r)) rb.set(r, w * h * bpp(ifmt) * Math.max(1, samples)); });
  wrapRet('createProgram', (p) => { if (p) programs++; });
  wrap('deleteProgram', (p) => { if (p) programs--; });

  // audio buffers and bitmaps: weakly held, so a GC before the read tells what is still reachable
  const audio = new Set(), bitmaps = new Set();
  // the file each fetched body came from, so a decoded buffer carries its name
  const urlOf = new WeakMap();
  const rab = Response.prototype.arrayBuffer;
  Response.prototype.arrayBuffer = function () { const u = this.url; return rab.call(this).then((b) => { try { urlOf.set(b, u); } catch { /* */ } return b; }); };
  // the page's audio contexts: their clock tells whether sources can end at all (a frozen device clock never ends one)
  const ctxs = [];
  if (window.AudioContext) { const AC = window.AudioContext; window.AudioContext = class extends AC { constructor(...a) { super(...a); ctxs.push(new WeakRef(this)); } }; }
  const A = (window.BaseAudioContext ?? window.AudioContext)?.prototype;
  if (A) {
    const dec = A.decodeAudioData;
    A.decodeAudioData = function (...a) {
      const name = (urlOf.get(a[0]) ?? '').replace(/.*\//, '').replace(/^[0-9a-f]{12}-/, '');
      const p = dec.apply(this, a);
      p?.then?.((ab) => { if (ab) audio.add({ ref: new WeakRef(ab), bytes: ab.length * ab.numberOfChannels * 4, s: +ab.duration.toFixed(1), name }); }, () => {});
      return p;
    };
    const cb = A.createBuffer;
    A.createBuffer = function (...a) { const ab = cb.apply(this, a); audio.add({ ref: new WeakRef(ab), bytes: ab.length * ab.numberOfChannels * 4, s: +ab.duration.toFixed(1) }); return ab; };
  }
  const cib = window.createImageBitmap;
  if (cib) window.createImageBitmap = function (...a) { return cib.apply(this, a).then((bm) => { bitmaps.add({ ref: new WeakRef(bm), bytes: bm.width * bm.height * 4, wh: `${bm.width}x${bm.height}` }); return bm; }); };

  const MB = (b) => +(b / 1048576).toFixed(1);
  window.__memTrack = () => {
    let tb = 0; const tl = [];
    for (const [t, r] of tex) { let s = 0; for (const v of r.levels.values()) s += v; tb += s; tl.push({ s, w: r.w, h: r.h, d: r.d, fmt: r.fmt, at: Math.round(r.at / 1000) }); }
    tl.sort((a, b) => b.s - a.s);
    let bb = 0, bbig = 0; for (const v of buf.values()) { bb += v; if (v >= 1048576) bbig++; }
    let rbb = 0; for (const v of rb.values()) rbb += v;
    let ab = 0, an = 0, al = [];
    for (const e of audio) { if (e.ref.deref()) { ab += e.bytes; an++; al.push(e); } else audio.delete(e); }
    al.sort((a, b) => b.bytes - a.bytes);
    al = al.slice(0, 16).map((e) => `${e.name || '?'} ${e.s}s ${MB(e.bytes)}MB`);
    let bm = 0, bn = 0; const bl = {};
    for (const e of bitmaps) { const x = e.ref.deref(); if (x && x.width > 0) { bm += e.bytes; bn++; bl[e.wh] = (bl[e.wh] ?? 0) + 1; } else bitmaps.delete(e); }
    // textures by size class: what a match leaves is easy to read off these
    const cls = {}; for (const t of tl) { const k = `${t.w}x${t.h}${t.d > 1 ? `x${t.d}` : ''}/0x${t.fmt.toString(16)}`; const c = (cls[k] ??= { n: 0, mb: 0 }); c.n++; c.mb += t.s / 1048576; }
    const classes = Object.entries(cls).sort((a, b) => b[1].mb - a[1].mb).slice(0, 14).map(([k, v]) => `${k} ×${v.n} ${v.mb.toFixed(1)}`);
    return {
      gl: { texN: tex.size, texMb: MB(tb), bufN: buf.size, bufMb: MB(bb), bufBig: bbig, rbN: rb.size, rbMb: MB(rbb), programs, totalMb: MB(tb + bb + rbb) },
      texClasses: classes,
      audio: { n: an, mb: MB(ab), largest: al },
      clock: (() => { const c = ctxs.map((r) => r.deref()).filter(Boolean).at(-1); return c ? { t: +c.currentTime.toFixed(2), state: c.state, n: ctxs.length } : null; })(),
      bitmaps: { n: bn, mb: MB(bm), sizes: bl },
    };
  };
})();
