#!/usr/bin/env python
"""DYEFIELD — mobile gate (CONTRACT_MOBILE M11). Headless Chromium, device emulation, REAL touches.

Every device of the M0 envelope runs in its own Playwright context (viewport, DPR, is_mobile, has_touch, a real mobile
user agent; the notch / home-indicator insets through CDP Emulation.setSafeAreaInsetsOverride; iPhone Safari's missing
element fullscreen emulated on the two iPhones). Input is REAL: CDP Input.dispatchTouchEvent (multi-touch), never a call
into TouchControls. Dev hooks (?dev=1) are used for SETUP only and say so in the check text: the tank level before the
SUB / SLICK checks, the special charge before the SPECIAL press (M11 allows it), own dye under the feet before SLICK.
No ?touch= override: touch mode must come from the game's own M1 detection on the emulated device.

Per device (landscape; the M11 list):
  1 boot → lobby   html.df-touch (detected, not pinned); 0 pointer-lock requests; the title passes the M6 layout checks
                   (layoutcheck.LAYOUT_JS: overlap, clip, safe area, target >= 44, font >= 12/14, wordmark uncovered)
  2 menus by taps  PLAY → MODE FFA → (the device's mode) → map → START, plus LOADOUT (a kit pick), SETTINGS (the TOUCH
                   CONTROLS group, both ends of the panel), HOW TO PLAY (the touch panel), CREDITS — each M6-checked
  3 match          START goes straight into the countdown (no play card, startedBy 'touch'); a tap on the HUD minimap is
                   the 'map' UI action (M2 MAP); the stick moves the runner
                   >= 3 m; a look drag turns >= 0.3 rad; FIRE held raises `painted`; JUMP leaves the ground; SLICK held
                   on own dye → state slick + the tank refills; SUB throws a jelly; SPECIAL fires when charged; stick +
                   look + FIRE together all register; PAUSE → pause card → RESUME; blur / pagehide / hidden pause (no
                   auto-resume); a second match by deep link shows TAP TO PLAY and a tap starts it; the START / TAP TO
                   PLAY gesture asks for full screen + the landscape lock (the lock alone on iPhone); haptics (a
                   recording navigator.vibrate stub): 8 ms per press, [12, 40, 12] when special turns ready, 60 ms on
                   WASHED, nothing with VIBRATION off; SETTINGS from the pause card applies live (LEFT-HANDED + VIBRATION
                   on the Pixel 7; BUTTON SIZE dragged to 130 % on the SE and iPhone 14, whose HUD must still clear
                   every control right- and left-handed with three kill-feed lines and the low-tank toast up)
  4 portrait      the rotate overlay shows and the match pauses; landscape again shows the pause card
  5 hygiene        a pinch on the title and on the live game leaves visualViewport.scale 1; scrollY stays 0; a long-press
                   opens no menu and selects nothing (plus the contextmenu guard itself: a dispatched cancelable
                   contextmenu is prevented on the canvas, not on the profile-name input)
  6 install        manifest + icons 200 with the right fields / pixel sizes; the M5 / M9 meta tags present
  7 perf           informational (never in the verdict): fps + governor scale at device size, sim ms per tick at 4x CPU
                   throttle (CDP Emulation.setCPUThrottlingRate), a texture + buffer byte estimate, JS heap
  8 errors         0 console / page / window / shader errors and 0 failed requests, per device

Mobile review fixes (2026-09-29) — each has a check named after its finding (see the note under PLAN): A-A1 edge
touch-downs, A-A2 portrait during a START load, A-A3 the AAC twins on emulated WebKit < 18.4, A-A4 one map-GLB fetch per
arena, A-A6 BACK / leaving full screen pause, A-A7 the left-handed minimap look, A-A9 the wake lock, A-A10 the 60 fps cap,
A-A11 audio after the map GLB, A-A13 no iPhone tip in an iframe, B-F1 context lost mid-load, B-F2 single-touch releases,
B-F3 / B-F4 the shadow latch + snap, B-F5 the tip counted when shown.
Modes: TEAMS and FFA both run on every device — the START match is one, the deep-link match the other (see PLAN).
Bots: the matches are live, so a bot can wash the human in the middle of an action check. FIRE / the stick / JUMP / SUB /
SPECIAL / SLICK are retried ONCE after the respawn, and only when the read-back proves a wash during the attempt
(washed_retry); the first attempt's result stays in the check detail and the report notes.
Screenshots: _shots/mobile_<device>_<step>.png (CSS px). Report: _harness/_reports/mobile.json. Exit 0 only on PASS.
Run:  python _harness/mobile.py --headless --base http://localhost:5203/
      python _harness/mobile.py --headless --devices se,pixel7 --no-perf
"""
from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import urllib.parse
import struct
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import (FLAGS, INIT_JS, SHADER_MARKERS, SHOTS, HarnessError, build_url, ensure_server,  # noqa: E402
                    is_shader_error, save_report, stop_server)
from layoutcheck import DEVICES as LAYOUT_DEVICES, IOS_INIT, LAYOUT_JS  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass

# M0: the four gate devices (the layout check's specs: viewport, DPR, UA, landscape safe-area insets, iOS fullscreen)
GATE_DEVICES = ("se", "iphone14", "pixel7", "ipad")
# what each device plays. `mode`/`map`/`kit` = the START match (picked by taps in the menus); `deep` = the TAP TO PLAY
# match (a deep link). Every device runs one TEAMS and one FFA match; every map and kit is used.
PLAN = {
    "se":       {"mode": "ffa",   "map": "cinder",   "kit": "mist-rasp",    "deep": {"mode": "teams", "map": "lockwell", "kit": "pop-well"}, "big": True,
                 "webkit": "refuse", "ctxlost": "deep"},
    "iphone14": {"mode": "teams", "map": "pier18",   "kit": "sheet-drum",   "deep": {"mode": "ffa",   "map": "pier18",   "kit": "needle-glint"}, "perf": True, "big": True,
                 "webkit": "canplay", "rotate_load": "lockwell"},
    "pixel7":   {"mode": "ffa",   "map": "lockwell", "kit": "needle-glint", "deep": {"mode": "teams", "map": "cinder",   "kit": "mist-rasp"}, "lefty": True},
    "ipad":     {"mode": "teams", "map": "cinder",   "kit": "pop-well",     "deep": {"mode": "ffa",   "map": "lockwell", "kit": "sheet-drum"}, "ctxlost": "lobby"},
}
# the mobile review fixes (2026-09-29) each device also proves (see the checks named "A-A…" / "B-F…"):
#   every device  A-A1 edge touch-downs read 0 · A-A4 one map-GLB fetch per arena · A-A11 audio after the map GLB ·
#                 A-A6 BACK pauses (+ leaving full screen, where there is one) · A-A9 the wake lock held + re-taken ·
#                 A-A10 the 60 fps cap (driven on 120 / 90 / 60 / 50 Hz timelines) · B-F2 single-touch releases
#   se / iphone14 A-A3 the AAC twins (WebKit before 18.4 emulated: 'refuse' / 'canplay'), B-F5 + A-A13 the iPhone tip
#   iphone14      A-A2 portrait during a START load waits on the play card · A-A6 QUIT drops the back entry ·
#                 B-F3 / B-F4 QUALITY HIGH clears the 512 shadow latch; the snap follows the live map size
#   pixel7        A-A7 a left-handed look drag that starts on the minimap turns the camera
#   se / ipad     B-F1 a context lost mid-load keeps the reset card (deep link / bare-URL lobby)
EXPECT_VIEWPORT = "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"

# every requestPointerLock call is counted (M4: touch mode never asks for the lock)
LOCK_JS = r"""
(() => {
  if (window.__H_LOCKREQ_INIT__) return; window.__H_LOCKREQ_INIT__ = true;
  window.__H_LOCKREQ__ = 0;
  const orig = Element.prototype.requestPointerLock;
  Element.prototype.requestPointerLock = function (...a) { window.__H_LOCKREQ__++; return orig.apply(this, a); };
  // M2 haptics + M4 full screen / orientation lock: each call is recorded, then passed through (headless shows no buzz)
  window.__H_VIB__ = []; window.__H_FS__ = [];
  try {
    const vib = Navigator.prototype.vibrate;
    Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, writable: true, value: function (p) {
      window.__H_VIB__.push(Array.isArray(p) ? p.slice() : p); try { return vib ? vib.call(this, p) : true; } catch (e) { return false; } } });
  } catch (e) {}
  try {
    const rf = Element.prototype.requestFullscreen;
    if (rf) Element.prototype.requestFullscreen = function (o) { window.__H_FS__.push('fullscreen:' + (o && o.navigationUI)); return rf.call(this, o); };
    const SO = window.ScreenOrientation;
    if (SO && SO.prototype.lock) { const lk = SO.prototype.lock; SO.prototype.lock = function (o) { window.__H_FS__.push('lock:' + o); return lk.call(this, o); }; }
  } catch (e) {}
  // every contextmenu, and whether some handler prevented it (read after all listeners ran)
  window.__H_CTX__ = [];
  addEventListener('contextmenu', (e) => { const t = e.target; setTimeout(() => window.__H_CTX__.push({ prevented: e.defaultPrevented,
    target: t && (t.id || t.className || t.tagName) ? String(t.id || t.className || t.tagName).slice(0, 40) : '?' }), 0); }, true);
  // review A-A9: every screen wake lock the page takes (the sentinels, so a check can release one the way the browser does
  // on hide); A-A4 / A-A11: room for every resource timing entry of a long session
  window.__H_WAKE__ = [];
  try {
    const WL = window.WakeLock;
    if (WL && WL.prototype.request) { const rq = WL.prototype.request; WL.prototype.request = function (t) {
      const p = rq.call(this, t); p.then((s) => window.__H_WAKE__.push(s), () => window.__H_WAKE__.push(null)); return p; }; }
  } catch (e) {}
  try { performance.setResourceTimingBufferSize(20000); } catch (e) {}
})();
"""

# review A-A3: WebKit before 18.4 (iOS / iPadOS 16.4–18.3, every iOS browser) cannot decode Ogg. 'refuse': decodeAudioData
# rejects Ogg bytes the way WebKit does while canPlayType still claims Ogg (the engine's decode fallback); 'canplay':
# canPlayType also says no Ogg (the engine fetches the AAC twins directly). The real decodeAudioData stays reachable as
# window.__H_DECODE__ for the alignment check.
OLD_WEBKIT_JS = r"""
((mode) => {
  if (window.__H_WEBKIT__) return; window.__H_WEBKIT__ = mode;
  const B = window.BaseAudioContext || window.AudioContext;
  const orig = B.prototype.decodeAudioData;
  window.__H_DECODE__ = orig;
  window.__H_DECODE_OGG_REFUSED__ = 0;
  B.prototype.decodeAudioData = function (buf, ok, bad) {
    try {
      const u = new Uint8Array(buf, 0, 4);
      if (u[0] === 0x4f && u[1] === 0x67 && u[2] === 0x67 && u[3] === 0x53) {
        window.__H_DECODE_OGG_REFUSED__++;
        const err = new DOMException('Decoding failed', 'EncodingError');
        if (typeof bad === 'function') setTimeout(() => bad(err), 0);
        return Promise.reject(err);
      }
    } catch (e) {}
    return orig.call(this, buf, ok, bad);
  };
  if (mode === 'canplay') {
    const cp = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (t) { return /ogg/i.test(String(t)) ? '' : cp.call(this, t); };
  }
})(%s);
"""

# final QA (2026-09-29): a Vite build content-hashes the Ogg and its twin separately (assets/sfx-<hash A>.m4a next to
# assets/sfx-<hash B>.ogg), so the Ogg's URL cannot be derived from the twin's name there (the derived name fell through
# to the index.html fallback: 200 text/html). On a build, read the Ogg's hashed name from the entry chunk, which carries
# every `new URL('./assets/...', import.meta.url)` of the audio manifest; resolve it against the entry's URL.
BUILD_OGG_JS = r"""
async () => {
  const s = document.querySelector('script[type=module][src]');
  if (!s) return null;
  const t = await (await fetch(s.src)).text();
  const m = t.match(/sfx-[A-Za-z0-9_-]{8}\.ogg/);
  return m ? new URL('./' + m[0], s.src).href : null;
}
"""

# review A-A3: in the page, decode the sprite's Ogg (the real decoder) and its AAC twin at 44.1 kHz and find the lag of the
# twin against the Ogg (normalised correlation on the loudest 0.5 s, lags -1100..1100): it must equal the priming the
# engine skipped (codecs['sfx sprite'].off), i.e. the engine's altOffset reads this browser's decoder right
ALIGN_JS = r"""
async ([oggUrl, m4aUrl]) => {
  const dec = window.__H_DECODE__ || (window.BaseAudioContext || window.AudioContext).prototype.decodeAudioData;
  const oc = new OfflineAudioContext(1, 1, 44100);
  const get = async (u) => dec.call(oc, await (await fetch(u)).arrayBuffer());
  const a = (await get(oggUrl)).getChannelData(0), b = (await get(m4aUrl)).getChannelData(0);
  const W = 22050;
  let best = 0, bestE = -1;
  for (let s = 2000; s + W + 2000 < a.length; s += W) { let e = 0; for (let i = s; i < s + W; i += 8) e += a[i] * a[i]; if (e > bestE) { bestE = e; best = s; } }
  let lag = 0, top = -2;
  for (let l = -1100; l <= 1100; l++) {
    let d = 0, nu = 0, nv = 0;
    for (let i = best; i < best + W; i += 2) { const u = a[i], v = b[i + l] || 0; d += u * v; nu += u * u; nv += v * v; }
    const c = d / (Math.sqrt(nu * nv) + 1e-12);
    if (c > top) { top = c; lag = l; }
  }
  return { lag, corr: Math.round(top * 1000) / 1000, oggLen: a.length, m4aLen: b.length, at: best };
}
"""

# M7 GPU memory, measured where it is allocated: every WebGL2 texture / buffer / renderbuffer allocation call is
# accounted (bytes by internal format x size x levels; freed on delete), so the total covers every texture the page
# uploaded — map GLBs, the paint atlas, runner kits, the mannequin's environment, shadow maps, render targets — not only
# the ones a scene walk can find. Driver padding and the browser's own copies are not visible to a page.
GLMEM_JS = r"""
(() => {
  if (window.__H_GLMEM_INIT__ || typeof WebGL2RenderingContext === 'undefined') return; window.__H_GLMEM_INIT__ = true;
  const P = WebGL2RenderingContext.prototype;
  const tex = new Map(), buf = new Map(), rb = new Map(), st = new WeakMap();
  const S = (gl) => { let s = st.get(gl); if (!s) { s = { unit: 0x84C0, t: {}, b: {}, r: null }; st.set(gl, s); } return s; };
  const BPP = { 0x8058: 4, 0x8C43: 4, 0x1908: 4, 0x8051: 4, 0x1907: 4, 0x8C41: 4, 0x8229: 1, 0x822B: 2, 0x881A: 8, 0x8814: 16, 0x822D: 2,
    0x822E: 4, 0x822F: 4, 0x8230: 8, 0x81A6: 4, 0x88F0: 4, 0x8CAC: 4, 0x81A5: 2, 0x8C3A: 4, 0x8D62: 2, 0x1903: 1, 0x1909: 1, 0x190A: 2,
    0x8D48: 1, 0x8CAD: 8, 0x1906: 1 };
  const bpp = (fmt, type) => { let b = BPP[fmt] || 4; if (fmt === 0x1908 || fmt === 0x1907) { if (type === 0x1406) b = 16; else if (type === 0x140B || type === 0x8D61) b = 8; } return b; };
  const bindOf = (t) => (t >= 0x8515 && t <= 0x851A) ? 0x8513 : t;
  const setT = (gl, target, key, bytes) => { const s = S(gl); const t = s.t[s.unit + ':' + bindOf(target)]; if (!t) return;
    let m = tex.get(t); if (!m) { m = new Map(); tex.set(t, m); } m.set(key + ':' + target, bytes); };
  const w = (name, fn) => { const o = P[name]; if (typeof o !== 'function') return; P[name] = function (...a) { try { fn(this, a); } catch (e) {} return o.apply(this, a); }; };
  w('activeTexture', (gl, a) => { S(gl).unit = a[0]; });
  w('bindTexture', (gl, a) => { const s = S(gl); s.t[s.unit + ':' + a[0]] = a[1]; });
  w('deleteTexture', (gl, a) => { tex.delete(a[0]); });
  w('texStorage2D', (gl, a) => { const [target, levels, fmt, W, H] = a; let b = 0, x = W, y = H;
    for (let i = 0; i < levels; i++) { b += x * y * bpp(fmt); x = Math.max(1, x >> 1); y = Math.max(1, y >> 1); } setT(gl, target, 's', b * (target === 0x8513 ? 6 : 1)); });
  w('texStorage3D', (gl, a) => { const [target, levels, fmt, W, H, D] = a; let b = 0, x = W, y = H, z = D;
    for (let i = 0; i < levels; i++) { b += x * y * z * bpp(fmt); x = Math.max(1, x >> 1); y = Math.max(1, y >> 1); if (target === 0x806F) z = Math.max(1, z >> 1); } setT(gl, target, 's3', b); });
  w('texImage2D', (gl, a) => { const [target, level, fmt] = a; let W, H, type;
    if (a.length === 6) { const src = a[5]; W = (src && (src.width || src.videoWidth || src.displayWidth)) || 0; H = (src && (src.height || src.videoHeight || src.displayHeight)) || 0; type = a[4]; }
    else { W = a[3]; H = a[4]; type = a[7]; }
    setT(gl, target, 'l' + level, W * H * bpp(fmt, type)); });
  w('texImage3D', (gl, a) => { const [target, level, fmt, W, H, D] = a; setT(gl, target, 'k' + level, W * H * D * bpp(fmt, a[8])); });
  w('compressedTexImage2D', (gl, a) => { const d = a[6]; setT(gl, a[0], 'c' + a[1], d && d.byteLength ? d.byteLength : (typeof d === 'number' ? d : 0)); });
  w('generateMipmap', (gl, a) => { const s = S(gl); const t = s.t[s.unit + ':' + a[0]]; const m = t && tex.get(t); if (!m) return;
    let base = 0; for (const [k, v] of m) if (k.startsWith('l0:')) base += v; if (base) m.set('mips', base / 3); });
  w('bindBuffer', (gl, a) => { S(gl).b[a[0]] = a[1]; });
  w('bufferData', (gl, a) => { const b = S(gl).b[a[0]]; if (!b) return; const d = a[1]; buf.set(b, typeof d === 'number' ? d : (d && d.byteLength) || 0); });
  w('deleteBuffer', (gl, a) => { buf.delete(a[0]); });
  w('bindRenderbuffer', (gl, a) => { S(gl).r = a[1]; });
  w('renderbufferStorage', (gl, a) => { const r = S(gl).r; if (r) rb.set(r, a[2] * a[3] * bpp(a[1])); });
  w('renderbufferStorageMultisample', (gl, a) => { const r = S(gl).r; if (r) rb.set(r, a[3] * a[4] * bpp(a[2]) * Math.max(1, a[1])); });
  w('deleteRenderbuffer', (gl, a) => { rb.delete(a[0]); });
  window.__H_GLMEM__ = () => { let t = 0; const big = [];
    for (const m of tex.values()) { let s = 0; for (const v of m.values()) s += v; t += s; big.push(Math.round(s / 1024)); }
    big.sort((x, y) => y - x);
    let b = 0; for (const v of buf.values()) b += v; let r = 0; for (const v of rb.values()) r += v;
    return { textures: t, textureCount: tex.size, buffers: b, bufferCount: buf.size, renderbuffers: r, renderbufferCount: rb.size, biggestTexKB: big.slice(0, 8) }; };
})();
"""

# tap target: reveal it inside its own scroll panel (never the page), then report its centre and whether a tap there
# reaches it (elementFromPoint) — a covered control is a defect, not something to click around
TARGET_JS = r"""
(sel) => {
  const e = document.querySelector(sel);
  if (!e) return { err: 'missing' };
  for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    const sy = /(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1;
    const sx = /(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1;
    if (!sy && !sx) continue;
    const r = e.getBoundingClientRect(), pr = n.getBoundingClientRect();
    if (sy && (r.top < pr.top || r.bottom > pr.bottom)) n.scrollTop += (r.top + r.height / 2) - (pr.top + pr.height / 2);
    if (sx && (r.left < pr.left || r.right > pr.right)) n.scrollLeft += (r.left + r.width / 2) - (pr.left + pr.width / 2);
  }
  const r = e.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return { err: 'not visible' };
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  const nm = (h) => h ? (h.id ? '#' + h.id : h.tagName.toLowerCase() + (typeof h.className === 'string' && h.className ? '.' + h.className.split(' ')[0] : '')) : null;
  return { x, y, w: r.width, h: r.height, reach: !!hit && (hit === e || e.contains(hit)), hit: nm(hit) };
}
"""

# M7 memory estimate: bytes of every geometry buffer, instance buffer and texture the live scene references, the shadow
# maps and the drawing buffer (MSAA counted when the context has it). An estimate: drivers pad and keep extra copies.
MEM_JS = r"""
() => {
  const d = window.__DF__ && window.__DF__.dev;
  if (!d) return null;
  const { renderer, scene } = d;
  const geos = new Set(), texs = new Set();
  let inst = 0, lights = 0;
  const addTex = (v) => { if (v && v.isTexture) texs.add(v); };
  scene.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    if (o.isInstancedMesh) { inst += o.instanceMatrix.array.byteLength + (o.instanceColor ? o.instanceColor.array.byteLength : 0); }
    if (o.isSkinnedMesh && o.skeleton && o.skeleton.boneTexture) addTex(o.skeleton.boneTexture);
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      for (const v of Object.values(m)) addTex(v);
      if (m.uniforms) for (const u of Object.values(m.uniforms)) { const v = u && u.value; addTex(v); if (Array.isArray(v)) v.forEach(addTex); }
    }
    if (o.isLight && o.castShadow && o.shadow) { const s = o.shadow.mapSize; lights += s.x * s.y * 4; }
  });
  addTex(scene.background); addTex(scene.environment);
  let gb = 0;
  for (const g of geos) {
    for (const a of Object.values(g.attributes || {})) gb += a && a.array ? a.array.byteLength : 0;
    if (g.index) gb += g.index.array.byteLength;
    for (const arr of Object.values(g.morphAttributes || {})) for (const a of arr) gb += a.array ? a.array.byteLength : 0;
  }
  let tb = 0; const big = [];
  for (const t of texs) {
    const img = t.image || {};
    let bytes = 0;
    if (t.isCompressedTexture && t.mipmaps && t.mipmaps.length) { for (const m of t.mipmaps) bytes += m.data ? m.data.byteLength : 0; }
    else {
      const w = img.width || img.videoWidth || 0, h = img.height || img.videoHeight || 0, dep = img.depth || 1;
      let bpp = 4;
      if (img.data && w * h) bpp = img.data.byteLength / (w * h * dep);
      bytes = w * h * dep * bpp;
      if (t.generateMipmaps && t.minFilter !== 1003 && t.minFilter !== 1006) bytes *= 4 / 3;
    }
    tb += bytes;
    big.push([t.name || (img.src ? String(img.src).split('/').pop().slice(0, 40) : (t.isDataTexture ? 'data' : 'tex')), Math.round(bytes / 1024)]);
  }
  big.sort((a, b) => b[1] - a[1]);
  const c = renderer.domElement;
  const aa = !!(renderer.getContext().getContextAttributes() || {}).antialias;
  const fb = c.width * c.height * 8 * (aa ? 5 : 1);
  const mb = (b) => Math.round(b / 1048576 * 10) / 10;
  const mem = performance.memory ? performance.memory.usedJSHeapSize : null;
  const G = window.__H_GLMEM__ ? window.__H_GLMEM__() : null;
  return {
    gl: G ? { texturesMB: mb(G.textures), textureCount: G.textureCount, buffersMB: mb(G.buffers), bufferCount: G.bufferCount,
              renderbuffersMB: mb(G.renderbuffers), drawingBufferMB: mb(fb), totalMB: mb(G.textures + G.buffers + G.renderbuffers + fb),
              biggestTexKB: G.biggestTexKB } : null,
    geometriesMB: mb(gb), instancesMB: mb(inst), texturesMB: mb(tb), shadowMB: mb(lights), framebufferMB: mb(fb),
    totalMB: mb(gb + inst + tb + lights + fb), geometries: geos.size, textures: texs.size,
    info: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
    biggestKB: big.slice(0, 6), buffer: [c.width, c.height], antialias: aa, jsHeapMB: mem === null ? null : mb(mem),
  };
}
"""

# sim ms per tick + a frame breakdown: every real Game.simStep, Game.render and Game.frame is timed (the loop calls
# this.frame / this.simStep / this.render, so own-property wrappers see each call; the originals are kept for a re-arm)
SIM_TIMER_JS = r"""
() => {
  const d = window.__DF__ && window.__DF__.dev;
  if (!d || !d.game) return false;
  const g = d.game;
  if (!g.__hOrig) g.__hOrig = { simStep: g.simStep, render: g.render, frame: g.frame };
  const H = window.__H_PERF__ = { sim: [], render: [], frame: [] };
  const wrap = (name, key, keep) => { const orig = g.__hOrig[name]; g[name] = function (...a) { const t = performance.now(); const r = orig.apply(this, a);
    if (keep(r)) H[key].push(performance.now() - t); return r; }; };
  wrap('simStep', 'sim', (r) => !!r);
  wrap('render', 'render', () => true);
  wrap('frame', 'frame', () => true);
  return true;
}
"""


class Touch:
    """Real multi-touch through CDP Input.dispatchTouchEvent (CSS px). touchStart / touchMove carry every point that is
    down. Releasing ONE of several is a touchEnd that lists exactly that point (review B-F2: a touchMove that merely omits
    a point releases nothing in CDP — the old helper's partial releases were no-ops until the final touchEnd, so the
    gate never released a single touch; measured on this Chrome: touchEnd [B] fires pointerup for B only); the last
    release is a touchEnd with no points."""

    def __init__(self, cdp):
        self.cdp = cdp
        self.pts = {}

    def _send(self, typ):
        pts = [{"x": float(p[0]), "y": float(p[1]), "id": i} for i, p in sorted(self.pts.items())]
        self.cdp.send("Input.dispatchTouchEvent", {"type": typ, "touchPoints": pts})

    def down(self, pid, x, y):
        self.pts[pid] = (x, y)
        self._send("touchStart")

    def move(self, pid, x, y):
        self.pts[pid] = (x, y)
        self._send("touchMove")

    def up(self, pid):
        p = self.pts.pop(pid, None)
        if self.pts and p is not None:
            self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": [{"x": float(p[0]), "y": float(p[1]), "id": pid}]})
        elif not self.pts:
            self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})

    def tap(self, x, y, pid=9, hold=0.07):
        self.down(pid, x, y)
        time.sleep(hold)
        self.up(pid)

    def drag(self, pid, x0, y0, x1, y1, steps=12, dt=0.016, release=True):
        self.down(pid, x0, y0)
        for k in range(1, steps + 1):
            self.move(pid, x0 + (x1 - x0) * k / steps, y0 + (y1 - y0) * k / steps)
            time.sleep(dt)
        if release:
            self.up(pid)

    def pinch(self, cx, cy, spread=120, steps=10):
        self.pts = {}
        self.pts[1] = (cx - 20, cy)
        self.pts[2] = (cx + 20, cy)
        self._send("touchStart")
        for k in range(1, steps + 1):
            self.pts[1] = (cx - 20 - spread / 2 * k / steps, cy - 4 * k)
            self.pts[2] = (cx + 20 + spread / 2 * k / steps, cy + 4 * k)
            self._send("touchMove")
            time.sleep(0.016)
        self.pts = {}
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})

    def release_all(self):
        if self.pts:
            self.pts = {}
            try:
                self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
            except Exception:
                pass


def png_size(data):
    if len(data) >= 24 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    return None


def ang(a, b):
    return (b - a + math.pi) % (2 * math.pi) - math.pi


class Device:
    def __init__(self, browser, key, args, report):
        self.key = key
        self.spec = LAYOUT_DEVICES[key]
        self.plan = PLAN[key]
        self.args = args
        self.rep = report
        self.checks = report["checks"]
        self.layout = report["layout"]
        self.shots = report["shots"]
        self.console = []
        self.page_errors = []
        self.failed = []
        self.window_errors = []
        self.lock_requests = 0
        s = self.spec
        self.W, self.H = s["w"], s["h"]
        self.ctx = browser.new_context(viewport={"width": s["w"], "height": s["h"]}, device_scale_factor=s["dpr"],
                                       is_mobile=True, has_touch=True, user_agent=s["ua"])
        if s.get("ios"):
            self.ctx.add_init_script(IOS_INIT)
        if self.plan.get("webkit"):
            self.ctx.add_init_script(OLD_WEBKIT_JS % json.dumps(self.plan["webkit"]))
        self.ctx.add_init_script(INIT_JS)
        self.ctx.add_init_script(LOCK_JS)
        self.ctx.add_init_script(GLMEM_JS)
        self.page = self.ctx.new_page()
        self.page.set_default_timeout(30_000)
        self.page.on("console", self._on_console)
        self.page.on("pageerror", lambda e: self.page_errors.append(str(e).splitlines()[0][:300]))
        self.page.on("requestfailed", self._on_reqfail)
        self.page.on("response", self._on_response)
        self.cdp = self.ctx.new_cdp_session(self.page)
        self.T = Touch(self.cdp)
        self.insets(s["safe"])

    # ── collectors
    def _on_console(self, m):
        try:
            self.console.append((m.type, m.text))
        except Exception:
            pass

    def _on_reqfail(self, r):
        try:
            if "favicon" in r.url:
                return
            f = r.failure
            if callable(f):
                f = f()
            if f and "ERR_ABORTED" in str(f):
                return
            self.failed.append("FAILED %s (%s)" % (r.url, f))
        except Exception:
            pass

    def _on_response(self, r):
        try:
            if r.status >= 400 and "favicon" not in r.url:
                self.failed.append("HTTP %d %s" % (r.status, r.url))
        except Exception:
            pass

    # ── small helpers
    def insets(self, safe):
        l, t, r, b = safe
        try:
            self.cdp.send("Emulation.setSafeAreaInsetsOverride", {"insets": {"top": t, "left": l, "right": r, "bottom": b}})
            self.rep["safeOverride"] = True
        except Exception as e:
            self.rep["safeOverride"] = "unsupported: %s" % str(e).splitlines()[0][:120]

    def check(self, name, ok, detail=""):
        self.checks.append({"name": name, "ok": bool(ok), "detail": detail})
        print("  %s  %s — %s" % ("PASS" if ok else "FAIL", name, detail), flush=True)
        return bool(ok)

    def js(self, expr, arg=None):
        try:
            return self.page.evaluate(expr, arg) if arg is not None else self.page.evaluate(expr)
        except Exception as e:
            return {"__error": str(e).splitlines()[0][:200]}

    def wait(self, expr, timeout=30.0, poll=0.15):
        t0 = time.time()
        while time.time() - t0 < timeout:
            v = self.js(expr)
            if v and not (isinstance(v, dict) and v.get("__error")):
                return v
            time.sleep(poll)
        return None

    def phase(self):
        return self.js("() => window.__DF__ ? window.__DF__.state().phase : null")

    def menu(self):
        m = self.js("() => window.__DF__ && window.__DF__.menu ? window.__DF__.menu() : null")
        return m if isinstance(m, dict) and not m.get("__error") else {}

    def touch_rb(self):
        t = self.js("() => window.__DF__ && window.__DF__.touch ? window.__DF__.touch() : null")
        return t if isinstance(t, dict) and not t.get("__error") else {}

    def player(self):
        s = self.js("() => window.__DF__.state().player")
        return s if isinstance(s, dict) and not s.get("__error") else {}

    def human(self):
        m = self.js("() => { const m = window.__DF__.match(); return m ? m.runners[0] : null; }")
        return m if isinstance(m, dict) and not m.get("__error") else {}

    def kit(self):
        k = self.js("() => window.__DF__.kit()")
        return k if isinstance(k, dict) and not k.get("__error") else {}

    def res(self, pattern):
        """resource-timing entries whose URL matches `pattern` (a JS regex): file name, start / responseEnd (ms), bytes.
        The Vite dev server's asset-URL modules (`<file>?import&url`, ~1 KB of JS naming the URL) are not the asset."""
        r = self.js("(p) => performance.getEntriesByType('resource').filter((e) => new RegExp(p).test(e.name) && !/[?&]import\\b/.test(e.name)).map((e) => ({ name: e.name.split('/').pop().split('?')[0],"
                    " url: e.name, start: Math.round(e.startTime), end: Math.round(e.responseEnd), bytes: e.encodedBodySize }))", pattern)
        return r if isinstance(r, list) else []

    def btn_center(self, bid):
        for b in self.touch_rb().get("buttons") or []:
            if b.get("id") == bid:
                r = b["rect"]
                return r["x"] + r["w"] / 2, r["y"] + r["h"] / 2, b
        return None

    def tap_sel(self, sel, settle=0.45, what=None):
        """a REAL touch tap on a DOM control (after revealing it inside its own scroll panel); a control a tap cannot
        reach (covered by another element) is recorded as a failed check"""
        info = self.js(TARGET_JS, sel)
        if not isinstance(info, dict) or info.get("err") or info.get("__error"):
            self.check("tap %s" % (what or sel), False, "target %s: %s" % (sel, info))
            return False
        if not info.get("reach"):
            self.check("tap %s reaches the control" % (what or sel), False, "a tap at (%.0f, %.0f) lands on %s" % (info["x"], info["y"], info.get("hit")))
            return False
        self.T.tap(info["x"], info["y"])
        time.sleep(settle)
        return True

    def screen_is(self, scr, timeout=6.0):
        return bool(self.wait("() => { const m = window.__DF__ && window.__DF__.menu && window.__DF__.menu(); return m && m.visible && m.screen === %s ? true : null; }" % json.dumps(scr), timeout))

    def go(self, sel, scr, what):
        for attempt in range(2):
            if not self.tap_sel(sel, what=what):
                return False
            if self.screen_is(scr, 5.0):
                return True
        return self.check("tap %s opens %s" % (what, scr), False, "menu screen is %r" % self.menu().get("screen"))

    def shot(self, step):
        path = os.path.join(SHOTS, "mobile_%s_%s.png" % (self.key, step))
        try:
            self.page.screenshot(path=path, scale="css", timeout=30_000)
            rel = os.path.relpath(path, os.path.dirname(SHOTS)).replace("\\", "/")
            self.shots.append(rel)
            return rel
        except Exception as e:
            self.page_errors.append("screenshot %s failed: %s" % (step, str(e).splitlines()[0][:160]))
            return None

    def layout_step(self, step, shot=True):
        """M6 on this screen (layoutcheck.LAYOUT_JS) + a screenshot; problems fail the gate"""
        r = None
        for attempt in range(2):
            try:
                r = self.page.evaluate(LAYOUT_JS, {})
                break
            except Exception as e:
                r = {"problems": [{"kind": "flow", "msg": "layout read-back failed: %s" % str(e).splitlines()[0][:160]}]}
                time.sleep(1.0)
        probs = r.get("problems") or []
        self.layout[step] = {"problems": probs, "touch": r.get("touch"), "safe": r.get("safe"), "controls": r.get("controls"),
                             "touchButtons": r.get("touchButtons"), "wordmark": r.get("wordmark"), "pageScroll": r.get("pageScroll")}
        if shot:
            self.layout[step]["shot"] = self.shot(step)
        self.check("M6 layout: %s" % step, not probs,
                   "0 problems (%s controls%s)" % (r.get("controls"), ", %s touch buttons" % r["touchButtons"] if r.get("touchButtons") else "")
                   if not probs else "; ".join("%s: %s" % (p.get("kind"), p.get("msg")) for p in probs[:6]))
        return r

    def harvest_page(self):
        """window errors + lock requests of the current page (INIT_JS / LOCK_JS state dies with a navigation)"""
        we = self.js("() => window.__H_ERR__ || []")
        if isinstance(we, list):
            self.window_errors.extend(str(x)[:300] for x in we)
        n = self.js("() => window.__H_LOCKREQ__ || 0")
        if isinstance(n, (int, float)):
            self.lock_requests += int(n)

    def goto(self, **q):
        self.T.release_all()
        self.harvest_page()
        url = build_url(self.args.base, **q)
        self.page.goto(url, wait_until="commit", timeout=90_000)
        return url

    def close(self):
        self.T.release_all()
        try:
            self.harvest_page()
        except Exception:
            pass
        try:
            self.ctx.close()
        except Exception:
            pass

    def diagnostics(self):
        cerr = [t for (k, t) in self.console if k == "error" and "favicon" not in t]
        shader_all = [(k, t) for (k, t) in self.console if k in ("error", "warning") and any(m in t for m in SHADER_MARKERS)]
        return {
            "consoleErrors": cerr,
            "shader": [t for (k, t) in shader_all if is_shader_error(k, t)],
            "shaderWarnings": [t[:300] for (k, t) in shader_all if not is_shader_error(k, t)],
            "pageErrors": [e for e in self.page_errors if not e.startswith("screenshot")],
            "screenshotErrors": [e for e in self.page_errors if e.startswith("screenshot")],
            "windowErrors": list(self.window_errors),
            "failedRequests": list(self.failed),
            "warnings": [t[:300] for (k, t) in self.console if k == "warning" and not any(m in t for m in SHADER_MARKERS)][:20],
        }


# ─────────────────────────────── the device run ───────────────────────────────
def zones(dev):
    """a stick start point (left 45 % below the top HUD band) and a look start point (right side, clear of the buttons)
    for the current hand; both inside the safe area"""
    l, t, r, b = dev.spec["safe"]
    W, H = dev.W, dev.H
    lefty = bool((dev.touch_rb().get("options") or {}).get("leftHanded"))
    sx = l + (W - l - r) * 0.20
    lx = l + (W - l - r) * 0.62
    if lefty:                                       # the whole layout mirrors (M2 touchLeftHanded)
        sx, lx = W - sx, W - lx
    return (sx, H * 0.70), (lx, H * 0.34), lefty


def run_lobby_and_menus(dev):
    P = dev.plan
    # ?lobby=1 keeps the bare-URL lobby; ?matchSeconds (dev) gives the START match 15 minutes, so the review-fix checks
    # that follow the M11 list (A-A2's QUIT → START, B-F3's overload window) never meet the final horn
    dev.goto(lobby=1, matchSeconds=900, dev=1)
    ok = dev.wait("() => (window.__DF__ && window.__DF__.state && window.__DF__.state().phase === 'menu') || null", 180)
    if not dev.check("boot → lobby (phase menu)", ok, "phase %r" % dev.phase()):
        return False
    time.sleep(1.2)
    tb = dev.touch_rb()
    dev.check("M1: touch mode detected (html.df-touch, not pinned)", tb.get("mode") == "touch" and "df-touch" in (tb.get("htmlClass") or "") and tb.get("pinned") is False,
              "mode %s pinned %s html class %r" % (tb.get("mode"), tb.get("pinned"), tb.get("htmlClass")))
    m = dev.menu()
    dev.check("M4: menus in touch mode (keyboard hint bar hidden)", m.get("touch") is True and m.get("hints") is False, "touch %s hints %s" % (m.get("touch"), m.get("hints")))
    r = dev.layout_step("title")
    dev.check("title: DYEFIELD wordmark present and uncovered", r.get("wordmark") is not None and not [p for p in r.get("problems") or [] if p.get("kind") == "wordmark"],
              "wordmark rect %s" % r.get("wordmark"))
    # review A-A4: ONE fetch of the lobby's map GLB feeds the core geometry AND the view (was: two back-to-back requests)
    glb = dev.res(r"map_pier18[^/]*\.glb")
    dev.check("A-A4: the lobby's map GLB is fetched once (the geometry and the view share one fetch)", len(glb) == 1,
              "%d fetch(es): %s" % (len(glb), [(g["name"], g["start"], g["end"]) for g in glb]))
    # review A-A11: no audio byte competes with the map GLB (nothing is fetched before the arena is up; no gesture yet here)
    aud = dev.res(r"/(sfx|music_[a-z]+)[^/]*\.(ogg|m4a)")
    ast = dev.js("() => window.__DF__.audio()") or {}
    first = min((a["start"] for a in aud), default=None)
    gend = glb[0]["end"] if glb else None
    dev.check("A-A11: the audio downloads start only after the map GLB is in (preload once the arena is up)",
              ast.get("preloaded") is True and gend is not None and first is not None and first >= gend - 1,
              "preloaded %s; map GLB responseEnd %s ms; first audio request at %s ms (%s)" % (ast.get("preloaded"), gend, first, [(a["name"], a["start"]) for a in aud]))
    # M9 on the iPhones: the title shows the one-time tip, and showing it is what uses the device's one time up (B-F5)
    if dev.spec.get("ios"):
        tip = dev.js("() => { const t = document.getElementById('dfm-tip-title'); return { shown: !!t && !t.hidden && t.getBoundingClientRect().width > 0,"
                     " flag: localStorage.getItem('dyefield.homeTip.v1') }; }") or {}
        dev.check("M9 / B-F5: the iPhone title shows the Add-to-Home-Screen tip and remembers it was shown", tip.get("shown") is True and tip.get("flag") == "1", json.dumps(tip))
    # M5 hygiene on the title: pinch, long-press
    pb = dev.js(TARGET_JS, "#dfm-play")
    if isinstance(pb, dict) and not pb.get("err"):
        dev.T.pinch(pb["x"], pb["y"])
        time.sleep(0.4)
        vs = dev.js("() => [visualViewport.scale, scrollY, (document.scrollingElement || document.documentElement).scrollTop]")
        dev.check("M5: pinch on the title keeps visualViewport.scale 1, scrollY 0", isinstance(vs, list) and vs[0] == 1 and vs[1] == 0 and vs[2] == 0, "scale/scrollY/scrollTop %s" % vs)
        dev.js("() => { window.__H_CTX__ = []; getSelection().removeAllRanges(); }")
        dev.T.down(5, pb["x"], pb["y"])
        time.sleep(1.2)
        dev.T.up(5)
        time.sleep(0.5)
        ctx = dev.js("() => window.__H_CTX__")
        sel = dev.js("() => String(getSelection())")
        dev.check("M5: long-press on a title button opens no menu, selects nothing",
                  isinstance(ctx, list) and all(c.get("prevented") for c in ctx) and sel == "",
                  "contextmenu events %s (each must be prevented; headless CDP long-presses may raise none), selection %r" % (ctx, sel))
        scr = dev.menu().get("screen")
        if scr and scr != "title":                  # the long-press ended as a tap on PLAY
            dev.go(".dfm-s-%s .dfm-back" % scr, "title", "BACK")
    # menus by taps
    if not dev.go("#dfm-play", "play", "PLAY"):
        return False
    time.sleep(0.4)
    dev.layout_step("play")
    dev.tap_sel("#dfm-mode-ffa", what="MODE FFA")
    pr = dev.js("() => window.__DF__.profile()")
    dev.check("PLAY → MODE FFA by tap", isinstance(pr, dict) and pr.get("mode") == "ffa", "profile mode %r" % (pr or {}).get("mode"))
    time.sleep(0.3)
    dev.layout_step("play_ffa")
    dev.go(".dfm-s-play .dfm-back", "title", "BACK")
    # LOADOUT: pick the plan's kit
    if dev.go("#dfm-loadout", "loadout", "LOADOUT"):
        time.sleep(0.6)
        dev.tap_sel("#dfm-kit-%s" % P["kit"], what="kit %s" % P["kit"])
        pr = dev.js("() => window.__DF__.profile()")
        dev.check("LOADOUT: kit %s picked by tap" % P["kit"], isinstance(pr, dict) and pr.get("kit") == P["kit"], "profile kit %r" % (pr or {}).get("kit"))
        time.sleep(0.5)
        dev.layout_step("loadout")
        dev.go(".dfm-s-loadout .dfm-back", "title", "BACK")
    # SETTINGS: the TOUCH CONTROLS group (M8)
    if dev.go("#dfm-settings", "settings", "SETTINGS"):
        time.sleep(0.4)
        m = dev.menu()
        vis = dev.js("() => { const g = document.getElementById('dfm-touchset'); const p = document.getElementById('dfm-touch-preview');"
                     " return { group: !!g && !g.hidden && g.getBoundingClientRect().height > 0, rows: g ? g.querySelectorAll('.dfm-row').length : 0,"
                     " preview: !!p && p.innerHTML.length > 0 }; }")
        dev.check("M8: SETTINGS shows the TOUCH CONTROLS group (6 rows + preview)",
                  m.get("touchGroup") is True and isinstance(vis, dict) and vis.get("group") and vis.get("rows") == 6 and vis.get("preview"), "%s" % vis)
        dev.layout_step("settings")
        # the far end of the panel, revealed by a REAL touch drag on the scroll panel
        pan = dev.js("() => { for (const n of document.querySelectorAll('.dfm-s-settings *')) { const s = getComputedStyle(n);"
                     " if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1 && n.getBoundingClientRect().height > 40) {"
                     " const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y0: r.y + r.height * 0.8, y1: r.y + r.height * 0.15, st: n.scrollTop, max: n.scrollHeight - n.clientHeight }; } } return null; }")
        if isinstance(pan, dict) and pan.get("x"):
            for _ in range(6):
                dev.T.drag(7, pan["x"], pan["y0"], pan["x"], pan["y1"], steps=10)
                time.sleep(0.5)
            st = dev.js("() => { for (const n of document.querySelectorAll('.dfm-s-settings *')) { const s = getComputedStyle(n);"
                        " if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1 && n.getBoundingClientRect().height > 40) return [n.scrollTop, n.scrollHeight - n.clientHeight]; } return null; }")
            dev.check("M6: a touch drag scrolls the SETTINGS panel inside itself", isinstance(st, list) and st[0] > pan["st"] + 20,
                      "scrollTop %s → %s (max %s)" % (pan["st"], st and st[0], st and st[1]))
            dev.layout_step("settings_end")
        dev.go(".dfm-s-settings .dfm-back", "title", "BACK")
    # HOW TO PLAY: the touch panel
    if dev.go("#dfm-how-to-play", "howto", "HOW TO PLAY"):
        time.sleep(0.4)
        ht = dev.js("() => { const e = document.getElementById('dfm-how-touch'); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; }")
        dev.check("M4: HOW TO PLAY shows the touch-controls panel", ht is True, "visible %s" % ht)
        dev.layout_step("howto")
        dev.go(".dfm-s-howto .dfm-back", "title", "BACK")
    if dev.go("#dfm-credits", "credits", "CREDITS"):
        time.sleep(0.3)
        dev.layout_step("credits")
        dev.go(".dfm-s-credits .dfm-back", "title", "BACK")
    run_audio_codec(dev)
    # PLAY → MODE FFA (checked above) → the device's mode → map → START
    if not dev.go("#dfm-play", "play", "PLAY"):
        return False
    dev.tap_sel("#dfm-mode-ffa", what="MODE FFA")
    if P["mode"] != "ffa":
        dev.tap_sel("#dfm-mode-%s" % P["mode"], what="MODE %s" % P["mode"].upper())
    dev.tap_sel("#dfm-map-%s" % P["map"], what="map %s" % P["map"])
    pr = dev.js("() => window.__DF__.profile()")
    dev.check("PLAY: mode %s + map %s picked by taps" % (P["mode"], P["map"]),
              isinstance(pr, dict) and pr.get("mode") == P["mode"] and pr.get("map") == P["map"], "profile mode %r map %r" % ((pr or {}).get("mode"), (pr or {}).get("map")))
    # START: straight into the countdown (no play card, no pointer lock)
    dev.js("() => { window.__H_PLAYCARD__ = 0; const iv = setInterval(() => { const b = document.getElementById('df-play');"
           " if (b && b.getBoundingClientRect().width > 0 && !document.getElementById('df-boot').classList.contains('gone')) window.__H_PLAYCARD__++;"
           " if (window.__DF__ && window.__DF__.state().phase === 'play') clearInterval(iv); }, 100); }")
    if not dev.tap_sel("#dfm-start", settle=0.2, what="START"):
        return False
    ok = dev.wait("() => (window.__DF__.state().phase === 'play') || null", 180)
    st = dev.js("() => window.__DF__.state()") or {}
    seen = dev.js("() => window.__H_PLAYCARD__")
    dev.check("M4: START → countdown directly (touch, no play card)", ok and st.get("startedBy") == "touch" and seen == 0,
              "phase %s startedBy %s play card seen %s times" % (st.get("phase"), st.get("startedBy"), seen))
    check_fullscreen(dev, "START")
    return bool(ok)


def run_audio_codec(dev):
    """review A-A3: after the menu taps (the first gesture unlocked the audio) the sprite + the lobby music are decoded
    and sounding. The two iPhones emulate WebKit before 18.4 (OLD_WEBKIT_JS): they must end up on the AAC twins —
    'refuse' through the decode fallback, 'canplay' without ever fetching an Ogg — with the priming the engine skips
    equal to the lag this browser's decoder really has (ALIGN_JS). The other devices stay on Ogg."""
    wk = dev.plan.get("webkit")
    ok = dev.wait("() => { const a = window.__DF__.audio(); return a && a.decoded.includes('sfx') && a.decoded.includes('lobby') ? true : null; }", 20)
    # the output meter is sampled from the Game's frame loop (every 3rd tick) and each stats() read restarts it: poll
    # 1 s windows (up to 10) until the lobby music shows, so a loaded box (a few fps) still gets a sample
    dev.js("() => window.__DF__.audio()")
    a = {}
    for _ in range(10):
        time.sleep(1.0)
        a = dev.js("() => window.__DF__.audio()") or {}
        if isinstance((a.get("meter") or {}).get("peakDb"), (int, float)) and a["meter"]["peakDb"] > -60:
            break
    codecs = a.get("codecs") or {}
    want = "aac" if wk else "ogg"
    got = {k: (v or {}).get("codec") for k, v in codecs.items()}
    refused = dev.js("() => window.__H_DECODE_OGG_REFUSED__ || 0")
    oggs = dev.res(r"/(sfx|music_[a-z]+)[^/]*\.ogg")
    extra = True
    if wk == "refuse":
        extra = isinstance(refused, int) and refused >= 2           # the Ogg was fetched, refused, and replaced
    elif wk == "canplay":
        extra = not oggs and refused == 0                          # canPlayType said no Ogg: never fetched one
    peak = (a.get("meter") or {}).get("peakDb")
    dev.check("A-A3: audio decodes and sounds %s (sprite + lobby music from %s)" % (
        "on emulated WebKit before 18.4 (%s)" % wk if wk else "on Ogg", "the AAC twins" if wk else "Ogg"),
        bool(ok) and got.get("sfx sprite") == want and got.get("music lobby") == want and not a.get("errors") and extra
        and isinstance(peak, (int, float)) and peak > -60,
        "decoded %s; codecs %s; errors %s; Ogg decodes refused %s; Ogg requests %d; output peak %s dBFS (context %s, cue %s)" % (
            a.get("decoded"), json.dumps(codecs), a.get("errors"), refused, len(oggs), peak, a.get("state"), a.get("cue")))
    if wk:
        m4a = [r for r in dev.res(r"/sfx[^/]*\.m4a")]
        if not m4a:
            dev.check("A-A3: the AAC sprite's priming offset matches this browser's decoder", False, "no sfx .m4a request seen")
            return
        u = m4a[0]["url"]
        ogg = u[:u.rindex(".m4a")] + ".ogg"                       # dev: /src/audio/assets/sfx.m4a -> sfx.ogg
        if "/assets/sfx-" in u:                                    # build: hashed separately (BUILD_OGG_JS)
            b = dev.js(BUILD_OGG_JS)
            if isinstance(b, str):
                ogg = b
        r = dev.js(ALIGN_JS, [ogg, u])
        if isinstance(r, dict):
            r["ogg"] = ogg.rsplit("/", 1)[-1]
        off = (codecs.get("sfx sprite") or {}).get("off")
        dev.check("A-A3: the AAC sprite's priming offset matches this browser's decoder (sample-exact slices)",
                  isinstance(r, dict) and r.get("lag") == off and (r.get("corr") or 0) > 0.9,
                  "engine skipped %s samples; measured lag of the twin vs the Ogg %s" % (off, json.dumps(r)))


def check_fullscreen(dev, where):
    """M4: the gesture asked for full screen without the browser UI, then a landscape lock (iPhone Safari has no element
    full screen: the lock alone, which Safari refuses silently)"""
    time.sleep(0.5)
    fs = dev.js("() => window.__H_FS__ || []") or []
    ios = bool(dev.spec.get("ios"))
    ok = ("lock:landscape" in fs) and (("fullscreen:hide" in fs) != ios) and (not ios or not any(str(x).startswith("fullscreen") for x in fs))
    dev.check("M4: the %s gesture asks for %s" % (where, "the landscape lock (no element full screen on iPhone)" if ios else "full screen (navigationUI hide) + the landscape lock"),
              ok, "calls %s; document.fullscreenElement %s" % (fs, dev.js("() => !!document.fullscreenElement")))
    dev.js("() => { window.__H_FS__ = []; }")


def ensure_alive(dev, where):
    """the checks below need a live runner: the stick walk can end in the sea (Cinder Reef spawns face open water) or a
    bot can wash the runner; wait out the respawn and say so in the notes"""
    h = dev.human()
    if h.get("alive"):
        return True
    wash = last_wash(dev)                            # read before the respawn wait pushes it out of the event window
    ok = dev.wait("() => window.__DF__.state().player.alive || null", 12)
    dev.wait("() => window.__DF__.state().player.grounded || null", 3)
    time.sleep(0.3)
    dev.rep.setdefault("notes", []).append("%s: the runner was washed (washedCount %s, last wash %s); waited for the respawn: %s" % (
        where, h.get("washedCount"), wash, bool(ok)))
    return bool(ok)


def last_wash(dev):
    """the human's last 'washed' sim event {victim, by, cause} (core/match/events.ts) in the last 400 events, or None"""
    w = dev.js("() => window.__DF__.events(400).filter((e) => e.t === 'washed' && e.victim === 0).pop() || null")
    return json.dumps(w) if isinstance(w, dict) and not w.get("__error") else None


def stick_walk(dev, sx, sy, hold, need):
    """one real stick push (touch id 1 from the stick zone, 56 px up = past the rim) held `hold` s → (ok, detail)"""
    p0 = dev.player()
    dev.T.down(1, sx, sy)
    for i in range(1, 9):
        dev.T.move(1, sx, sy - 7 * i)
        time.sleep(0.02)
    time.sleep(0.3)
    tbm = dev.touch_rb()
    time.sleep(max(0.0, hold - 0.3))
    p1 = dev.player()
    dev.T.up(1)
    d = math.hypot((p1.get("x") or 0) - (p0.get("x") or 0), (p1.get("z") or 0) - (p0.get("z") or 0))
    return d >= need, "%.2f m; stick read-back %s; alive %s → %s" % (d, json.dumps(tbm.get("stick")), p0.get("alive"), p1.get("alive"))


def stick_rect(tb):
    for b in tb.get("buttons") or []:
        if b.get("id") == "stick":
            return b.get("rect") or {}
    return {}


def run_stick_edges(dev):
    """review A-A1: a thumb that lands near the left / bottom edge (where thumbs rest) reads 0 — the touch-down alone never
    moves the runner — while the DRAWN base stays fully inside the safe area; a drag from such a landing reads the way it
    goes (up / right > 0.4 after 30 px). Right-handed (the lefty switch comes later)."""
    l, t, r, b = dev.spec["safe"]
    W, H = dev.W, dev.H
    xz = l + (W - l - r) * 0.20
    pts = [("8 px from the left safe edge", l + 8, H * 0.70), ("8 px above the bottom safe edge", xz, H - b - 8),
           ("the bottom-left corner", l + 8, H - b - 8)]
    if l > 0:
        pts.append(("inside the left inset (x 8)", 8, H * 0.70))
    rows, bad = [], []
    for name, x, y in pts:
        dev.T.down(1, x, y)
        time.sleep(0.15)
        tb = dev.touch_rb()
        dev.T.up(1)
        time.sleep(0.12)
        s = tb.get("stick") or {}
        rc = stick_rect(tb)
        inside = bool(rc) and rc["x"] >= l - 0.6 and rc["x"] + rc["w"] <= W - r + 0.6 and rc["y"] + rc["h"] <= H - b + 0.6
        rows.append("%s (%.0f, %.0f): stick %s drawn base x %.0f..%.0f y ..%.0f" % (name, x, y, json.dumps(s), rc.get("x", -1), rc.get("x", -1) + rc.get("w", 0), rc.get("y", -1) + rc.get("h", 0)))
        if not (s.get("active") is True and s.get("x") == 0 and s.get("y") == 0 and inside):
            bad.append(name)
    dev.check("A-A1: a touch-down near the left / bottom edge reads stick 0 (no ghost input), the drawn base inside the safe area",
              not bad, ("bad: %s · " % bad if bad else "") + " | ".join(rows))
    drags = [("land 20 px above the bottom, drag UP 30 px", (xz, H - b - 20), (0, -30), "y"),
             ("land 8 px from the left, drag RIGHT 30 px", (l + 8, H * 0.70), (30, 0), "x")]
    rows, bad = [], []
    for name, (x0, y0), (ddx, ddy), axis in drags:
        dev.T.down(1, x0, y0)
        for k in range(1, 7):
            dev.T.move(1, x0 + ddx * k / 6, y0 + ddy * k / 6)
            time.sleep(0.02)
        # Chrome dispatches pointermoves aligned to animation frames: on a loaded box (a few fps) the last move lands a
        # frame later — wait for it (up to 2 s) instead of reading after a fixed 0.12 s
        s = dev.wait("() => { const s = (window.__DF__.touch() || {}).stick; return s && Math.abs(s.%s) > 0.4 ? s : null; }" % axis, 2.0, poll=0.1) \
            or dev.touch_rb().get("stick") or {}
        dev.T.up(1)
        time.sleep(0.12)
        rows.append("%s: stick %s" % (name, json.dumps(s)))
        if not ((s.get(axis) or 0) > 0.4):
            bad.append(name)
    dev.check("A-A1: a drag from an edge landing reads the way it goes (> 0.4 after 30 px)", not bad, ("bad: %s · " % bad if bad else "") + " | ".join(rows))


def washed_retry(dev, name, attempt):
    """run one action check (`attempt()` → (ok, detail)). The match is live with bots, so a bot can wash the human in
    the middle of a check: the final run before this helper failed pixel7 FIRE with 'alive True → False' and vibrate
    calls [8, 60] (60 = the WASHED haptic), and se SUB with the runner washed inside the SUB window (SUB dims while
    dead). A failure is retried ONCE, after the respawn, only when the read-back proves a wash during the attempt
    (washedCount rose or alive went false); the first attempt's detail stays in the check detail and the notes."""
    h0 = dev.human()
    w0 = h0.get("washedCount") or 0
    ok, detail = attempt()
    h1 = dev.human()
    washed = (h1.get("washedCount") or 0) > w0 or h1.get("alive") is False
    if not ok and washed:
        dev.rep.setdefault("notes", []).append("%s: first attempt failed while the runner was washed (washedCount %s → %s, alive %s, last wash %s): %s — retried once after the respawn" % (
            name, w0, h1.get("washedCount"), h1.get("alive"), last_wash(dev), detail))
        ensure_alive(dev, "retry of " + name)
        ok, d2 = attempt()
        detail = "%s (retried: the runner was washed during the first attempt, which read: %s)" % (d2, detail)
    return dev.check(name, ok, detail)


def run_match_checks(dev, label):
    """M11 step 3 / 4 / 5 inside a live match started by touch"""
    P = dev.plan
    ok = dev.wait("() => (window.__DF__.match() && window.__DF__.match().phase === 'live') || null", 20)
    mi = dev.js("() => { const m = window.__DF__.match(); return m ? { phase: m.phase, mode: m.matchMode } : null; }") or {}
    dev.check("%s: match live (%s)" % (label, mi.get("mode")), ok, "match phase %s" % mi.get("phase"))
    time.sleep(0.5)
    tb = dev.touch_rb()
    btns = {b["id"]: b for b in tb.get("buttons") or []}
    small = [(k, b["rect"]["w"], b["rect"]["h"]) for k, b in btns.items() if k != "stick" and (b["rect"]["w"] < 44 or b["rect"]["h"] < 44)]
    dev.check("M2: overlay visible with every control >= 44 px", tb.get("visible") is True and not small and len(btns) >= 7,
              "visible %s buttons %s small %s" % (tb.get("visible"), sorted(btns), small))
    rnd = tb.get("renderer") or {}
    dpr = dev.spec["dpr"]
    dev.check("M7: renderer touch profile (MSAA off at DPR >= 2, shadow <= 1024)",
              rnd.get("touch") is True and (rnd.get("antialias") is False or dpr < 2) and (rnd.get("shadowCap") or 99999) <= 1024,
              json.dumps(rnd))
    dev.layout_step("hud")
    (sx, sy), (lx, ly), lefty = zones(dev)

    # MAP (M2): a real tap on the HUD minimap is the 'map' UI action (read back as __DF__.touch().mapActions; no screen
    # consumes 'map' yet — KeyM has had no listener since 1.2.0 — so the action reaching the Input is the contract)
    mm = dev.js("() => { const e = document.getElementById('df-minimap'); if (!e) return null; const r = e.getBoundingClientRect();"
                " return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }")
    if isinstance(mm, dict) and not mm.get("__error") and mm.get("w"):
        m0 = dev.touch_rb().get("mapActions")
        dev.T.tap(mm["x"], mm["y"])
        # the pointerup handler runs in the page's task queue: on a loaded box (final run 2026-09-29: a few fps, every
        # device read 0 → 0 at a fixed 0.25 s while a standalone tap on the same build counted) wait up to 2 s for it
        if isinstance(m0, int):
            dev.wait("() => { const t = window.__DF__.touch(); return t && t.mapActions > %d ? true : null; }" % m0, 2.0, poll=0.1)
        time.sleep(0.1)
        tm = dev.touch_rb()
        dev.check("M2: a tap on the HUD minimap is the 'map' UI action (not the stick, not a look)",
                  isinstance(m0, int) and tm.get("mapActions") == m0 + 1 and not (tm.get("stick") or {}).get("active") and tm.get("active") == 0,
                  "mapActions %s → %s at (%.0f, %.0f) (minimap %.0f×%.0f); stick %s" % (m0, tm.get("mapActions"), mm["x"], mm["y"], mm["w"], mm["h"], json.dumps(tm.get("stick"))))
    else:
        dev.check("M2: a tap on the HUD minimap is the 'map' UI action (not the stick, not a look)", False, "no #df-minimap on screen: %s" % mm)

    # FIRE held — first, from the spawn at the rest pitch, facing the way the spawn faces (into its court). Fired after the
    # stick walk, the runner can stand in the Cinder Reef shallows with only water in reach: the iPad runs measured 0
    # painted there with the bursts fired, while the same pop-well from the spawn painted 6.9 (scratch dbg_popwell.py) —
    # a harness aim problem, not a game one.
    ensure_alive(dev, "before FIRE")
    fire_vib = []

    def fire_attempt():
        fc = dev.btn_center("fire")
        h0 = dev.human()
        k0 = dev.kit()
        dev.js("() => { window.__H_VIB__ = []; }")
        dev.T.down(3, fc[0], fc[1])
        time.sleep(0.3)
        held = dev.touch_rb().get("held")
        time.sleep(1.2)
        dev.T.up(3)
        time.sleep(1.0)
        h1 = dev.human()
        k1 = dev.kit()
        fire_vib[:] = dev.js("() => window.__H_VIB__") or []
        return ((h1.get("painted") or 0) > (h0.get("painted") or 0),
                "painted %.2f → %.2f; shots %s → %s; held while down %s; kit %s; alive %s → %s; at (%.1f, %.1f, %.1f)" % (
                    h0.get("painted") or 0, h1.get("painted") or 0, k0.get("shots"), k1.get("shots"), held, h0.get("kit"),
                    h0.get("alive"), h1.get("alive"), h1.get("x") or 0, h1.get("y") or 0, h1.get("z") or 0))
    washed_retry(dev, "FIRE held raises the human's painted", fire_attempt)
    vib = fire_vib
    dev.check("M2 haptics: a button press vibrates 8 ms", vib[:1] == [8], "navigator.vibrate calls %s" % vib)

    # the stick. It needs a live runner like every action check: the FIRE window above can end with the runner washed
    # (final run 2026-09-29 18:16, se: FIRE read 'alive True → False' + the 60 ms WASHED haptic, then the stick check
    # read 0.20 m with the stick read-back at y 0.924 active — input registered, the runner was down)
    ensure_alive(dev, "before the stick")
    washed_retry(dev, "stick moves the runner >= 3 m", lambda: stick_walk(dev, sx, sy, 1.5, 3.0))
    time.sleep(0.3)
    st = dev.touch_rb().get("stick") or {}
    dev.check("stick released → 0", st.get("x") == 0 and st.get("y") == 0 and not st.get("active"), json.dumps(st))
    run_stick_edges(dev)

    # look: a drag left turns the camera; a drag back right returns it (about) to the spawn facing
    a0 = dev.js("() => window.__DF__.aim()") or {}
    dev.T.drag(2, lx, ly, lx - 220, ly, steps=16)
    time.sleep(0.2)
    a1 = dev.js("() => window.__DF__.aim()") or {}
    dy = ang(a0.get("yaw", 0), a1.get("yaw", 0)) if isinstance(a0.get("yaw"), (int, float)) and isinstance(a1.get("yaw"), (int, float)) else 0.0
    dev.check("a look drag turns the camera >= 0.3 rad", abs(dy) >= 0.3, "dyaw %.3f rad (assist %s)" % (dy, json.dumps(dev.touch_rb().get("assist"))))
    dev.T.drag(2, lx, ly, lx + 220, ly, steps=16)     # a new touch from the same clear spot (the left end is the stick side)
    time.sleep(0.2)
    a2 = dev.js("() => window.__DF__.aim()") or {}
    dev.rep.setdefault("notes", []).append("look: yaw %.3f → %.3f → back %.3f; pitch %.3f → %.3f" % (
        a0.get("yaw", 0), a1.get("yaw", 0), a2.get("yaw", 0), a1.get("pitch", 0), a2.get("pitch", 0)))

    # JUMP
    ensure_alive(dev, "before JUMP")

    def jump_attempt():
        jc = dev.btn_center("jump")
        dev.wait("() => window.__DF__.state().player.grounded || null", 3)
        ya = dev.player()
        dev.T.down(4, jc[0], jc[1])
        air, ymax = False, ya.get("y") or 0
        for _ in range(14):
            time.sleep(0.03)
            s = dev.player()
            ymax = max(ymax, s.get("y") or 0)
            if s.get("grounded") is False:
                air = True
        dev.T.up(4)
        return air and ymax > (ya.get("y") or 0) + 0.1, "y %.2f → max %.2f" % (ya.get("y") or 0, ymax)
    washed_retry(dev, "JUMP leaves the ground", jump_attempt)
    dev.wait("() => window.__DF__.state().player.grounded || null", 3)
    time.sleep(0.4)

    # SUB: dimmed below its cost, bright at a full tank, a press throws a jelly
    ensure_alive(dev, "before SUB")

    def sub_attempt():
        dev.js("() => window.__DF__.setTank(0, 5)")
        time.sleep(0.25)
        dim_low = (dev.btn_center("sub") or (0, 0, {}))[2].get("dimmed")
        dev.js("() => window.__DF__.setTank(0, 100)")
        dev.wait("() => { const k = window.__DF__.kit(); return k && k.subCooldown <= 0 ? true : null; }", 4)
        time.sleep(0.25)
        sc = dev.btn_center("sub")
        subs0 = dev.kit().get("subs") or 0
        dev.T.tap(sc[0], sc[1])
        ok = dev.wait("() => (window.__DF__.kit().subs > %d) || null" % subs0, 1.5)
        return (bool(ok) and dim_low is True and sc[2].get("dimmed") is False,
                "subs %s → %s; SUB dimmed at tank 5: %s, at 100: %s; alive %s" % (
                    subs0, dev.kit().get("subs"), dim_low, sc[2].get("dimmed"), dev.human().get("alive")))
    washed_retry(dev, "SUB throws a jelly (setup: tank set to 100 by the dev hook)", sub_attempt)
    time.sleep(0.6)

    # SPECIAL: dimmed until charged; charged by the dev hook (setup, allowed by M11); the PRESS is a real touch
    # a wash in this window keeps only half the charge (core/match/world.ts: v.special *= specialPts.keep, and
    # specialReady false below 1) — final run 2026-09-29 18:16, pixel7: vibrate [[12, 40, 12], 60] then 'ready False;
    # fired drained' — so SPECIAL takes the same wash-proven single retry as FIRE / JUMP / SUB / SLICK
    ensure_alive(dev, "before SPECIAL")
    sp_vib = []

    def special_attempt():
        sp_dim0 = (dev.btn_center("special") or (0, 0, {}))[2].get("dimmed")
        dev.js("() => { window.__H_VIB__ = []; window.__DF__.fillSpecial(0); }")
        ready = dev.wait("() => { const t = window.__DF__.touch(); const b = (t.buttons || []).find((x) => x.id === 'special'); return b && !b.dimmed ? true : null; }", 3)
        time.sleep(0.2)
        sp_vib[:] = dev.js("() => window.__H_VIB__") or []
        spc = dev.btn_center("special")
        dev.T.tap(spc[0], spc[1])
        fired = dev.wait("() => { const k = window.__DF__.kit(); return k && (k.specialActive !== '' || k.special < 0.9) ? k.specialActive || 'drained' : null; }", 2.0)
        return (bool(fired) and fired != "drained" and bool(ready) and sp_dim0 is True,
                "dimmed before charge %s; ready %s; fired %r; vibrate %s" % (sp_dim0, bool(ready), fired, sp_vib))
    washed_retry(dev, "SPECIAL fires when charged (setup: charge by the dev hook)", special_attempt)
    dev.check("M2 haptics: special turning ready vibrates [12, 40, 12]", [12, 40, 12] in sp_vib, "navigator.vibrate calls %s" % sp_vib)
    dev.wait("() => { const k = window.__DF__.kit(); return k && k.specialActive === '' ? true : null; }", 12)
    dev.wait("() => window.__DF__.state().player.grounded || null", 3)
    time.sleep(0.5)

    # SLICK on own dye: state slick + the tank refills (setup: own dye under the feet + tank 20 via dev hooks)
    # the floor under the runner must take paint (a drop pad or a prop top does not): splat, read the colour under the
    # feet, and if it is not ours step off with the stick and splat again
    ensure_alive(dev, "before SLICK")

    def slick_attempt():
        under = None
        for attempt in range(4):
            p = dev.player()
            dev.js("([x, y, z, t]) => window.__DF__.splat(x, y, z, 3.2, t)", [p.get("x"), p.get("y"), p.get("z"), p.get("team")])
            time.sleep(0.15)
            under = dev.js("() => window.__DF__.teamUnderFeet()")
            if under == p.get("team"):
                break
            dev.T.down(1, sx, sy)
            for i in range(1, 9):
                dev.T.move(1, sx + 5 * i * (1 if attempt % 2 else -1), sy - 5 * i)
                time.sleep(0.02)
            time.sleep(0.6)
            dev.T.up(1)
            dev.wait("() => window.__DF__.state().player.grounded || null", 3)
        dev.rep.setdefault("notes", []).append("slick setup: own colour under the feet after %d splat(s): %s (team %s)" % (attempt + 1, under, dev.player().get("team")))
        dev.js("() => window.__DF__.setTank(0, 20)")
        time.sleep(0.3)
        kc = dev.btn_center("slick")
        t0 = dev.player().get("tank") or 0
        dev.T.down(6, kc[0], kc[1])
        states = set()
        for _ in range(12):
            time.sleep(0.1)
            states.add(dev.player().get("state"))
        t1 = dev.player().get("tank") or 0
        held = dev.touch_rb().get("held")
        dev.T.up(6)
        return "slick" in states and t1 >= t0 + 10, "states %s; tank %.1f → %.1f; held %s" % (sorted(s for s in states if s), t0, t1, held)
    washed_retry(dev, "SLICK held on own dye → state slick + the tank refills (setup: own dye + tank 20 via dev hooks)", slick_attempt)
    time.sleep(0.4)

    # three touches together
    ensure_alive(dev, "before the three touches")
    lr0 = (dev.touch_rb().get("lookRad") or {}).get("yaw") or 0
    fc = dev.btn_center("fire")
    dev.T.down(1, sx, sy)
    dev.T.down(2, lx, ly)
    dev.T.down(3, fc[0], fc[1])
    for i in range(1, 9):
        dev.T.pts[1] = (sx + 4 * i, sy - 6 * i)
        dev.T.pts[2] = (lx + 9 * i, ly + 2 * i)
        dev.T.move(3, fc[0], fc[1])
        time.sleep(0.02)
    time.sleep(0.2)
    t3 = dev.touch_rb()
    # review B-F2: ONE touch released at a time (Touch.up now sends a touchEnd for that point only), read back after each
    dev.T.up(3)
    time.sleep(0.15)
    tA = dev.touch_rb()
    dev.T.up(2)
    time.sleep(0.15)
    tB = dev.touch_rb()
    dev.T.up(1)
    ok3 = t3.get("active") == 3 and (t3.get("stick") or {}).get("active") and "fire" in (t3.get("held") or []) and abs(((t3.get("lookRad") or {}).get("yaw") or 0) - lr0) > 0.05
    dev.check("stick + look + FIRE at once all register", ok3, "active %s stick %s held %s dLook %.3f" % (
        t3.get("active"), json.dumps(t3.get("stick")), t3.get("held"), ((t3.get("lookRad") or {}).get("yaw") or 0) - lr0))
    time.sleep(0.3)
    t0 = dev.touch_rb()
    dev.check("B-F2: releasing one touch at a time — active 3 → 2 → 1 → 0; FIRE up drops 'fire' while the stick stays on",
              t3.get("active") == 3 and tA.get("active") == 2 and "fire" not in (tA.get("held") or []) and (tA.get("stick") or {}).get("active") is True
              and tB.get("active") == 1 and (tB.get("stick") or {}).get("active") is True and t0.get("active") == 0,
              "active %s → %s → %s → %s; held after FIRE up %s; stick after FIRE up %s, after the look up %s" % (
                  t3.get("active"), tA.get("active"), tB.get("active"), t0.get("active"), tA.get("held"), json.dumps(tA.get("stick")), json.dumps(tB.get("stick"))))
    t4 = dev.touch_rb()
    dev.check("every touch released", t4.get("active") == 0 and not t4.get("held") and not (t4.get("stick") or {}).get("active"),
              "active %s held %s" % (t4.get("active"), t4.get("held")))

    # M5 hygiene on the live game: pinch, long-press, the contextmenu guard
    dev.T.pinch(dev.W * 0.5, dev.H * 0.42)
    time.sleep(0.4)
    vs = dev.js("() => [visualViewport.scale, scrollY, (document.scrollingElement || document.documentElement).scrollTop]")
    dev.check("M5: pinch on the live game keeps visualViewport.scale 1, scrollY 0", isinstance(vs, list) and vs[0] == 1 and vs[1] == 0 and vs[2] == 0, "scale/scrollY/scrollTop %s" % vs)
    dev.js("() => { window.__H_CTX__ = []; getSelection().removeAllRanges(); }")
    dev.T.down(5, lx, ly)
    time.sleep(1.2)
    dev.T.up(5)
    time.sleep(0.4)
    ctx = dev.js("() => window.__H_CTX__")
    sel = dev.js("() => String(getSelection())")
    guard = dev.js("() => { const mk = (t) => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); t.dispatchEvent(e); return e.defaultPrevented; };"
                   " return { canvas: mk(document.getElementById('game')), overlay: mk(document.getElementById('df-touch') || document.body) }; }")
    dev.check("M5: long-press on the game opens no menu, selects nothing; the contextmenu guard prevents it",
              isinstance(ctx, list) and all(c.get("prevented") for c in ctx) and sel == "" and isinstance(guard, dict) and guard.get("canvas") is True and guard.get("overlay") is True,
              "long-press contextmenu events %s; selection %r; dispatched contextmenu prevented %s" % (ctx, sel, guard))
    dev.js("() => { window.__H_CTX__ = []; }")

    # PAUSE → pause card → (no auto-resume) → RESUME
    pc = dev.btn_center("pause")
    dev.T.tap(pc[0], pc[1])
    ok = dev.wait("() => { const m = window.__DF__.menu(); return window.__DF__.state().phase === 'paused' && m && m.context === 'pause' && m.visible ? true : null; }", 3)
    time.sleep(1.0)
    still = dev.phase()
    dev.check("PAUSE button → pause card, no auto-resume", bool(ok) and still == "paused", "phase after 1 s %s" % still)
    dev.layout_step("pause")
    dev.tap_sel("#df-resume", what="RESUME")
    ok = dev.wait("() => (window.__DF__.state().phase === 'play') || null", 3)
    dev.check("RESUME tap → play", bool(ok), "phase %s" % dev.phase())

    # the other touch pause triggers: blur (a call / app switch), pagehide, the page hidden
    for name, fire in (("window blur", "() => window.dispatchEvent(new Event('blur'))"),
                       ("pagehide", "() => window.dispatchEvent(new PageTransitionEvent('pagehide'))"),
                       ("page hidden", "() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });"
                                       " document.dispatchEvent(new Event('visibilitychange')); delete document.visibilityState; }")):
        dev.js(fire)
        time.sleep(0.8)
        ph = dev.phase()
        dev.tap_sel("#df-resume", what="RESUME")
        back = dev.wait("() => (window.__DF__.state().phase === 'play') || null", 3)
        dev.check("M4: %s → paused (no auto-resume) → RESUME tap → play" % name, ph == "paused" and bool(back), "after %s: %s; after RESUME: %s" % (name, ph, dev.phase()))
    run_back_wake_cap(dev)

    # portrait: the rotate overlay + a pause; landscape again: the pause card
    s = dev.spec
    notch = s["safe"][0] > 0
    # a rotation changes the insets and the viewport together: insets first, so the resize the page sees carries the
    # portrait insets (the other order is an emulation artifact: a real device never reports landscape insets upright)
    dev.insets((0, s["safe"][0] if notch else 0, 0, 34 if notch else s["safe"][3]))
    dev.page.set_viewport_size({"width": dev.H, "height": dev.W})
    time.sleep(1.0)
    rot = dev.js("() => { const o = document.getElementById('df-rotate'); return o ? { shown: !o.hidden && o.getBoundingClientRect().width > 0, text: o.textContent.trim() } : null; }") or {}
    ph = dev.phase()
    dev.check("M4 portrait: the rotate overlay shows and the match pauses", rot.get("shown") is True and ph == "paused"
              and "Turn your device sideways to play" in (rot.get("text") or ""), "overlay %s phase %s" % (rot, ph))
    dev.layout_step("portrait")
    dev.insets(s["safe"])
    dev.page.set_viewport_size({"width": dev.W, "height": dev.H})
    time.sleep(1.0)
    m = dev.menu()
    rot2 = dev.js("() => { const o = document.getElementById('df-rotate'); return o ? !o.hidden : null; }")
    dev.check("M4 landscape again: overlay gone, the pause card (no auto-resume)", dev.phase() == "paused" and m.get("context") == "pause" and m.get("visible") and rot2 is False,
              "phase %s menu %s/%s overlay %s" % (dev.phase(), m.get("context"), m.get("screen"), rot2))
    dev.tap_sel("#df-resume", what="RESUME")
    dev.wait("() => (window.__DF__.state().phase === 'play') || null", 3)

    # left-handed, switched LIVE from the pause card's SETTINGS (M8: settings.on → TouchControls.setOptions)
    if P.get("lefty"):
        def lefty_and_quiet():
            dev.tap_sel("#dfm-touch-left", what="LEFT-HANDED")
            dev.tap_sel("#dfm-haptics", what="VIBRATION")
        if settings_from_pause(dev, lefty_and_quiet):
            hp = dev.js("() => window.__DF__.settings().haptics")
            dev.js("() => { window.__H_VIB__ = []; }")
            jc = dev.btn_center("jump")
            dev.T.tap(jc[0], jc[1])
            time.sleep(0.3)
            vib = dev.js("() => window.__H_VIB__") or []
            dev.check("M8 live: VIBRATION off from the pause card silences the button haptics", hp is False and vib == [], "setting haptics %s; vibrate calls after a JUMP press %s" % (hp, vib))
            dev.wait("() => window.__DF__.state().player.grounded || null", 3)
            s1 = dev.js("() => window.__DF__.settings().touchLeftHanded")
            tb = dev.touch_rb()
            bt = {b["id"]: b["rect"] for b in tb.get("buttons") or []}
            fx = bt.get("fire", {}).get("x", 9999) + bt.get("fire", {}).get("w", 0) / 2
            stx = bt.get("stick", {}).get("x", 0) + bt.get("stick", {}).get("w", 0) / 2
            dev.check("M8 live: LEFT-HANDED from the pause card mirrors the overlay at once",
                      s1 is True and (tb.get("options") or {}).get("leftHanded") is True and fx < dev.W / 2 and stx > dev.W / 2,
                      "setting %s overlay leftHanded %s FIRE centre x %.0f, stick home x %.0f (W %d)" % (s1, (tb.get("options") or {}).get("leftHanded"), fx, stx, dev.W))
            dev.layout_step("hud_lefthanded")
            (sx2, sy2), _, _ = zones(dev)
            dev.T.down(1, sx2, sy2)
            for i in range(1, 9):
                dev.T.move(1, sx2, sy2 - 7 * i)
                time.sleep(0.02)
            time.sleep(0.3)
            stk = dev.touch_rb().get("stick") or {}
            dev.T.up(1)
            dev.check("left-handed: the stick works on the right side", stk.get("active") is True and (stk.get("y") or 0) > 0.5, json.dumps(stk))
            # review A-A7: left-handed, the HUD minimap sits on the LOOK side — a look drag that starts on it turns the camera
            # (it used to go dead past the tap slop); a tap on it is still the MAP action
            mm = dev.js("() => { const e = document.getElementById('df-minimap'); if (!e) return null; const r = e.getBoundingClientRect();"
                        " return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }")
            if isinstance(mm, dict) and mm.get("w"):
                y0 = (dev.touch_rb().get("lookRad") or {}).get("yaw") or 0
                dev.T.drag(6, mm["x"], mm["y"], mm["x"] + 160, mm["y"], steps=15, dt=0.02)
                time.sleep(0.2)
                tb = dev.touch_rb()
                dyaw = ((tb.get("lookRad") or {}).get("yaw") or 0) - y0
                m0 = tb.get("mapActions")
                dev.T.tap(mm["x"], mm["y"])
                time.sleep(0.25)
                m1 = dev.touch_rb().get("mapActions")
                dev.check("A-A7: left-handed, a look drag that starts on the minimap turns the camera; a tap there is still MAP",
                          abs(dyaw) >= 0.3 and isinstance(m0, int) and m1 == m0 + 1,
                          "160 px drag from the minimap (%.0f, %.0f): look yaw %+.3f rad; MAP actions %s → %s" % (mm["x"], mm["y"], dyaw, m0, m1))
            else:
                dev.check("A-A7: left-handed, a look drag that starts on the minimap turns the camera; a tap there is still MAP", False, "no minimap: %s" % mm)


# review A-A10: the Game's touch frame cap driven with synthetic rAF timelines (the headless Chrome here draws at ~50 Hz
# even with vsync off, so a real 90 / 120 / 144 Hz clock cannot be produced): rendered frames per second at each rate.
# One synchronous task (no real rAF interleaves); the cap's live state is restored after.
CAP_JS = r"""
() => { const g = window.__DF__.dev && window.__DF__.dev.game;
  if (!g || typeof g.frameCapped !== 'function') return null;
  const saved = g.capSlot, savedSkips = g.capSkips;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const run = (hz, jitter, secs) => { g.capSlot = -1; let n = 0, t = 1e7; const dt = 1000 / hz;
    for (let i = 0; i < Math.round(hz * secs); i++) { t += dt + jitter * rnd(); if (!g.frameCapped(t)) n++; } return Math.round(n / secs * 10) / 10; };
  const out = { hz144: run(144, 0.4, 5), hz120: run(120, 0.4, 5), hz90: run(90, 0.4, 5), hz60: run(60, 1.0, 5), hz50: run(50, 1.0, 5) };
  g.capSlot = saved; g.capSkips = savedSkips; return out; }
"""


def run_back_wake_cap(dev):
    """review A-A9 (the screen wake lock), A-A6 (BACK / leaving full screen pause a live touch match), A-A10 (the 60 fps
    cap) — inside the START match, in play"""
    # A-A9: held since the START gesture; the browser drops it whenever the page hides (simulated: the sentinel
    # released, then visibilitychange while visible) → the page takes it again
    w0 = dev.touch_rb().get("wake") or {}
    rel = dev.js("() => { const s = (window.__H_WAKE__ || []).filter(Boolean).pop(); if (!s || s.released) return false; s.release(); return true; }")
    time.sleep(0.4)
    w1 = dev.touch_rb().get("wake") or {}
    dev.js("() => document.dispatchEvent(new Event('visibilitychange'))")
    w2 = dev.wait("() => { const w = (window.__DF__.touch() || {}).wake; return w && w.held ? w : null; }", 4) or {}
    dev.check("A-A9: a screen wake lock is held through the touch match and taken again after the browser drops it",
              w0.get("held") is True and (w0.get("requests") or 0) >= 1 and rel is True and w1.get("held") is False
              and w2.get("held") is True and (w2.get("requests") or 0) > (w0.get("requests") or 0),
              "in play %s; released by the 'browser' %s → %s; after visible again %s" % (json.dumps(w0), rel, json.dumps(w1), json.dumps(w2)))

    # A-A6: leaving full screen (Android's first back in full screen only exits it) pauses — where there is element full
    # screen. Before the BACK check: Chrome also leaves full screen on a history traversal.
    if dev.js("() => !!document.fullscreenElement") is True:
        dev.js("() => document.exitFullscreen()")
        time.sleep(0.8)
        ph = dev.phase()
        dev.check("A-A6: leaving full screen in a live touch match → paused", ph == "paused", "phase %s fullscreen %s" % (ph, dev.js("() => !!document.fullscreenElement")))
        dev.tap_sel("#df-resume", what="RESUME")
        dev.wait("() => (window.__DF__.state().phase === 'play') || null", 3)
    else:
        dev.rep.setdefault("notes", []).append("A-A6 fullscreen exit: no element full screen on this device/emulation (%s) — not exercised" % (
            "iPhone Safari" if dev.spec.get("ios") else "fullscreenElement null"))

    # A-A6: the system BACK pops the trap entry → the pause card, the page stays; RESUME re-arms the entry
    url0 = dev.page.url
    bt0 = dev.touch_rb().get("backTrap")
    nav = "ok"
    try:
        dev.page.go_back(wait_until="commit", timeout=4000)
    except Exception as e:
        nav = str(e).splitlines()[0][:120]
    time.sleep(0.8)
    alive = dev.js("() => !!(window.__DF__ && window.__DF__.state)") is True
    ph = dev.phase() if alive else None
    m = dev.menu() if alive else {}
    dev.check("A-A6: BACK in a live touch match → the pause card; the page stays",
              bt0 is True and alive and dev.page.url == url0 and ph == "paused" and m.get("context") == "pause" and m.get("visible"),
              "back entry armed %s; go_back: %s; same page %s (url %s); phase %s; menu %s/%s" % (bt0, nav, alive, dev.page.url == url0, ph, m.get("context"), m.get("visible")))
    if not alive:
        return
    dev.tap_sel("#df-resume", what="RESUME")
    ok = dev.wait("() => (window.__DF__.state().phase === 'play') || null", 3)
    dev.check("A-A6: RESUME after BACK → play, the back entry armed again", bool(ok) and dev.touch_rb().get("backTrap") is True,
              "phase %s backTrap %s" % (dev.phase(), dev.touch_rb().get("backTrap")))
    # A-A10: the cap on 144 / 120 / 90 Hz clocks renders ~60 fps; 60 / 50 Hz lose no frame; the real ~50 Hz run skipped none
    c = dev.js(CAP_JS) or {}
    tb = dev.touch_rb()
    rr = dev.js("() => window.__DF__.render()") or {}
    frames = rr.get("frames") or 0
    skips = tb.get("frameCapSkips")
    ok = (isinstance(c, dict) and 55 <= (c.get("hz144") or 0) <= 61 and 57 <= (c.get("hz120") or 0) <= 61 and 57 <= (c.get("hz90") or 0) <= 61
          and (c.get("hz60") or 0) >= 59.5 and (c.get("hz50") or 0) >= 49.5)
    dev.check("A-A10: touch renders at most ~60 fps on 90 / 120 / 144 Hz clocks and drops nothing at 60 / 50 Hz",
              ok and isinstance(skips, int) and skips <= max(3, frames * 0.02),
              "rendered fps by rAF clock %s; this headless run (~50 Hz): %s rAFs skipped of %s frames" % (json.dumps(c), skips, frames))


FEED_JS = r"""
() => { const d = window.__DF__.dev; if (!d || !d.parts || !d.parts.hud) return false;
  const h = d.parts.hud, ffa = d.game.matchMode === 'ffa';
  const t = (a, b) => ffa ? [a, b] : [1, 2];
  for (const [a, b, ta, tb] of [['Halyard', 'Tully', ...t(2, 3)], ['Brine', 'Skerry', ...t(4, 5)], ['Marlo', 'Wren', ...t(6, 7)]])
    h.killFeed({ name: a, team: ta }, { name: b, team: tb });
  return true; }
"""


def settings_from_pause(dev, fn):
    """PAUSE (the touch button) → SETTINGS on the pause card → fn() → BACK → RESUME, all by real taps"""
    pc = dev.btn_center("pause")
    dev.T.tap(pc[0], pc[1])
    dev.wait("() => (window.__DF__.state().phase === 'paused') || null", 3)
    time.sleep(0.4)
    if not dev.go("#df-p-settings", "settings", "SETTINGS (pause card)"):
        return False
    time.sleep(0.4)
    fn()
    dev.go(".dfm-s-settings .dfm-back", "pause", "BACK")
    dev.tap_sel("#df-resume", what="RESUME")
    ok = dev.wait("() => (window.__DF__.state().phase === 'play') || null", 3)
    time.sleep(0.5)
    return bool(ok)


def run_big_buttons(dev):
    """M2 / M6 at the largest BUTTON SIZE (130 %, set by a real touch drag on the slider): the HUD still keeps every
    touch control clear, right- and left-handed, with three kill-feed lines and the low-tank toast up (setup)"""
    def drag_slider():
        info = dev.js(TARGET_JS, "#dfm-touch-scale")
        if not isinstance(info, dict) or info.get("err") or not info.get("reach"):
            dev.check("BUTTON SIZE slider reachable by touch", False, "%s" % info)
            return
        s = dev.js("() => window.__DF__.settings().touchScale") or 1
        x0 = info["x"] - info["w"] / 2 + info["w"] * (s - 0.8) / 0.5
        dev.T.drag(8, x0, info["y"], info["x"] + info["w"] / 2 + 30, info["y"], steps=14, dt=0.02)
        time.sleep(0.4)
    ok = settings_from_pause(dev, drag_slider)
    s = dev.js("() => window.__DF__.settings().touchScale")
    tb = dev.touch_rb()
    dev.check("M8 live: BUTTON SIZE dragged to 130 % by touch resizes the overlay at once",
              ok and isinstance(s, (int, float)) and abs(s - 1.3) < 1e-6 and abs(((tb.get("options") or {}).get("scale") or 0) - 1.3) < 1e-6,
              "setting %s, overlay scale %s" % (s, (tb.get("options") or {}).get("scale")))
    for step, flip in (("hud_big", False), ("hud_big_lh", True)):
        if flip:
            settings_from_pause(dev, lambda: dev.tap_sel("#dfm-touch-left", what="LEFT-HANDED"))
            lh = (dev.touch_rb().get("options") or {}).get("leftHanded")
            dev.check("LEFT-HANDED on at 130 %", lh is True, "overlay leftHanded %s" % lh)
        dev.js("() => window.__DF__.setTank(0, 5)")
        fed = dev.js(FEED_JS)
        time.sleep(0.6)
        dev.rep.setdefault("notes", []).append("%s: 3 kill-feed lines injected via hud.killFeed (setup): %s" % (step, fed))
        dev.layout_step(step)
        dev.js("() => window.__DF__.setTank(0, 100)")


def run_washed(dev):
    """M2 haptics: being WASHED vibrates 60 ms when VIBRATION is on, nothing when it is off (setup: the dev damage hook
    stands in for an opponent's hit)"""
    hp = dev.js("() => window.__DF__.settings().haptics")
    # a bot may have washed the runner already (it then respawns in a few seconds): the damage must land on a live one
    alive = dev.wait("() => window.__DF__.state().player.alive || null", 10)
    n0 = dev.human().get("washedCount") or 0
    dev.js("() => { window.__H_VIB__ = []; window.__DF__.damage(0, 1000); }")
    dead = dev.wait("() => (window.__DF__.match().runners[0].washedCount > %d) || null" % n0, 3)
    time.sleep(0.4)
    vib = dev.js("() => window.__H_VIB__") or []
    want = (60 in vib) if hp else (vib == [])
    dev.check("M2 haptics: WASHED → %s (setup: washed by the dev damage hook)" % ("60 ms" if hp else "silent, VIBRATION off"),
              bool(alive) and bool(dead) and want, "alive before %s; washed %s; haptics %s; vibrate calls %s" % (bool(alive), bool(dead), hp, vib))


def summ(a):
    a = [x for x in a if isinstance(x, (int, float))]
    if not a:
        return None
    a2 = sorted(a)
    return {"n": len(a), "mean": round(statistics.mean(a), 3), "p50": round(a2[len(a2) // 2], 3),
            "p90": round(a2[min(len(a2) - 1, int(len(a2) * 0.9))], 3), "max": round(a2[-1], 3)}


def perf_window(dev, rate, seconds):
    """one measurement window at a CPU throttle rate (CDP Emulation.setCPUThrottlingRate): the game's fps + governor, the
    frames and sim ticks actually run per second, ms per sim tick, ms per Game.frame and per Game.render"""
    dev.cdp.send("Emulation.setCPUThrottlingRate", {"rate": rate})
    time.sleep(2.0 if rate > 1 else 0.5)             # settle into the rate before the window opens
    dev.js(SIM_TIMER_JS)
    f0 = dev.js("() => window.__DF__.render().frames")
    t0 = time.time()
    time.sleep(seconds)
    H = dev.js("() => window.__H_PERF__") or {}
    rr = dev.js("() => window.__DF__.render()") or {}
    el = time.time() - t0
    f1 = rr.get("frames")
    out = {"rate": rate, "seconds": round(el, 1), "fps": rr.get("fps"), "scale": rr.get("scale"), "p90": rr.get("p90"), "buffer": rr.get("buffer"),
           "framesPerS": round((f1 - f0) / el, 1) if isinstance(f0, (int, float)) and isinstance(f1, (int, float)) else None,
           "ticksPerS": round(len(H.get("sim") or []) / el, 1),
           "simMsPerTick": summ(H.get("sim") or []), "frameMs": summ(H.get("frame") or []), "renderMs": summ(H.get("render") or [])}
    return out


def run_perf(dev, report):
    """M7 (informational): steady fps / governor scale at device size and the GPU memory; on the perf device, windows at
    1x, 2x and 4x CPU throttle (sim ms per tick against the <= 8 ms budget at 4x, and where a frame's time goes)"""
    out = {}
    time.sleep(5.0)
    r = dev.js("() => window.__DF__.render()") or {}
    out["steady"] = {k: r.get(k) for k in ("fps", "scale", "scaleMin", "scaleMax", "buffer", "p90", "targetMs", "quality", "scaleChanges", "scaleLast", "calls", "triangles", "gpu")}
    out["mobileRenderer"] = dev.touch_rb().get("renderer")
    out["memory"] = dev.js(MEM_JS)
    if dev.plan.get("perf") and not dev.args.no_perf:
        out["windows"] = []
        try:
            for rate, secs in ((1, 6.0), (2, 8.0), (4, 10.0)):
                w = perf_window(dev, rate, secs)
                out["windows"].append(w)
                print("  perf  x%d: fps %s (%s frames/s), %s sim ticks/s; sim ms/tick %s; Game.frame ms %s; render ms %s" % (
                    rate, round(w["fps"] or 0, 1), w["framesPerS"], w["ticksPerS"], json.dumps(w["simMsPerTick"]), json.dumps(w["frameMs"]), json.dumps(w["renderMs"])))
        finally:
            dev.cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
        # M7 shadow cap under a real overload and after it: the 4x window holds the floor over budget for > 5 s (the
        # 512 drop); back at 1x the renderer probes 1024 again after 15 s within budget (renderer.ts SHADOW_PROBE_S).
        # Informational like the rest of M7 (the timings are the shared iGPU's), but the transitions are recorded.
        after = dev.touch_rb().get("renderer") or {}
        t0 = time.time()
        back = dev.wait("() => { const r = (window.__DF__.touch() || {}).renderer; return r && r.shadowCap === 1024 ? r : null; }", 45, poll=0.5)
        out["shadowProbe"] = {"afterThrottle": after, "back1024": bool(back), "backAfterS": round(time.time() - t0, 1) if back else None,
                              "final": dev.touch_rb().get("renderer")}
        print("  perf  shadow cap: right after the 4x window %s (drops %s); 1024 again at 1x: %s after %s s" % (
            after.get("shadowCap"), after.get("shadowDrops"), bool(back), out["shadowProbe"]["backAfterS"]))
        time.sleep(1.0)
    report["perf"] = out
    st = out["steady"]
    g = (out.get("memory") or {}).get("gl") or {}
    print("  perf  steady fps %s scale %s (floor %s cap %s) buffer %s p90 %s; GL-allocated %s MB (textures %s, buffers %s, drawing buffer %s); renderer %s" % (
        st.get("fps"), st.get("scale"), st.get("scaleMin"), st.get("scaleMax"), st.get("buffer"), st.get("p90"),
        g.get("totalMB"), g.get("texturesMB"), g.get("buffersMB"), g.get("drawingBufferMB"), json.dumps(out.get("mobileRenderer"))))


# review B-F4: the sun's snapped shadow-box position in texels of the LIVE shadow map (48 m box: SUN_SHADOW.half = 24).
# Snapped to the live size, u / v are whole texels; snapped to the authored 1024 while the map is 512 they would sit on
# half texels about half the time.
SNAP_JS = r"""
() => { const d = window.__DF__.dev; if (!d || !d.parts || !d.parts.sky) return null;
  const sky = d.parts.sky, sun = sky.sun;
  const lz = sky.sunDir.clone().normalize();
  const lx = lz.clone().set(0, 1, 0).cross(lz); if (lx.lengthSq() < 1e-8) lx.set(1, 0, 0); lx.normalize();
  const ly = lz.clone().cross(lx).normalize();
  const map = sun.shadow.mapSize.x, texel = 48 / map, p = sun.target.position;
  const u = p.dot(lx) / texel, v = p.dot(ly) / texel;
  return { map, u: Math.round(u * 1000) / 1000, v: Math.round(v * 1000) / 1000, fu: Math.abs(u - Math.round(u)), fv: Math.abs(v - Math.round(v)) }; }
"""


def run_shadow_latch(dev):
    """review B-F3 / B-F4 on the perf device: a CPU overload latches the touch shadow cap at 512 (M7); while it holds, the
    sun's box snaps to the 512 map's texel (B-F4); QUALITY HIGH picked in SETTINGS then restores 1024 at once (B-F3: the
    latch used to outlive every QUALITY pick); AUTO again afterwards"""
    snaps = []
    dev.cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
    try:
        low = dev.wait("() => { const r = (window.__DF__.touch() || {}).renderer; return r && r.shadowCap === 512 ? r : null; }", 40, poll=0.5)
        time.sleep(0.6)                                # the Game applies the cap on its next render
        if low:
            (sx, sy), _, _ = zones(dev)
            dev.T.down(1, sx, sy)                      # walk (and turn) meanwhile, so the box centre moves between samples
            for i in range(24):
                dev.T.move(1, sx + 30 * math.sin(i * 0.7), sy - 50)
                time.sleep(0.12)
                s = dev.js(SNAP_JS)
                if isinstance(s, dict) and not s.get("__error"):
                    snaps.append(s)
            dev.T.up(1)
    finally:
        dev.cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
    at512 = [s for s in snaps if s.get("map") == 512]
    distinct = len({(s["u"], s["v"]) for s in at512})
    worst = max([max(s["fu"], s["fv"]) for s in at512], default=None)
    dev.check("B-F4: at the 512 shadow map the sun's box snaps to whole 512-map texels", bool(low) and len(at512) >= 10 and distinct >= 3 and worst is not None and worst < 0.01,
              "latched %s; %d samples at 512 (%d distinct positions); worst fraction of a texel %s" % (
                  json.dumps(low) if low else None, len(at512), distinct, worst))
    if not low:
        return
    ok = settings_from_pause(dev, lambda: dev.tap_sel("#dfm-quality-high", what="QUALITY HIGH"))
    time.sleep(1.0)
    q = dev.js("() => window.__DF__.settings().quality")
    rnd = dev.touch_rb().get("renderer") or {}
    sm = dev.js("() => window.__DF__.dev.parts.sky.sun.shadow.mapSize.x")
    dev.check("B-F3: QUALITY HIGH picked while the 512 latch holds → the 1024 shadow map at once",
              ok and q == "high" and rnd.get("shadowCap") == 1024 and sm == 1024,
              "quality %s; renderer %s; sun map %s" % (q, json.dumps(rnd), sm))
    settings_from_pause(dev, lambda: dev.tap_sel("#dfm-quality-auto", what="QUALITY AUTO"))
    dev.rep.setdefault("notes", []).append("B-F3 setup: QUALITY back to %s" % dev.js("() => window.__DF__.settings().quality"))


def run_rotate_during_load(dev):
    """review A-A2 (+ A-A6 / A-A9 on QUIT, A-A4 on START): QUIT MATCH to the lobby drops the back entry and releases the
    wake lock; PLAY → another map → START, then the phone turns upright while the arena loads: no countdown under the
    rotate overlay — TAP TO PLAY waits behind it with the clock at rest; landscape again → a tap starts the match. That
    START fetched the new map's GLB exactly once."""
    target = dev.plan["rotate_load"]
    s = dev.spec
    pc = dev.btn_center("pause")
    dev.T.tap(pc[0], pc[1])
    dev.wait("() => (window.__DF__.state().phase === 'paused') || null", 3)
    time.sleep(0.4)
    dev.tap_sel("#df-p-quit", what="QUIT MATCH")
    time.sleep(0.3)
    dev.tap_sel("#dfm-quit-yes", what="QUIT MATCH confirm")
    ok = dev.wait("() => (window.__DF__.state().phase === 'menu') || null", 120)
    time.sleep(1.0)
    tb = dev.touch_rb()
    dev.check("A-A6 / A-A9: QUIT MATCH → the lobby with no back entry left and the wake lock released",
              bool(ok) and tb.get("backTrap") is False and (tb.get("wake") or {}).get("held") is False,
              "phase %s backTrap %s wake %s history.length %s" % (dev.phase(), tb.get("backTrap"), json.dumps(tb.get("wake")), dev.js("() => history.length")))
    if not ok or not dev.go("#dfm-play", "play", "PLAY"):
        return
    dev.tap_sel("#dfm-map-%s" % target, what="map %s" % target)
    n0 = len(dev.res(r"map_%s[^/]*\.glb" % target))
    if not dev.tap_sel("#dfm-start", settle=0.02, what="START (the phone turns upright during the load)"):
        return
    notch = s["safe"][0] > 0
    dev.insets((0, s["safe"][0] if notch else 0, 0, 34 if notch else s["safe"][3]))
    dev.page.set_viewport_size({"width": dev.H, "height": dev.W})
    ph = dev.wait("() => { const p = window.__DF__.state().phase; return p === 'ready' || p === 'play' || p === 'error' ? p : null; }", 180)
    time.sleep(2.5)
    st = dev.js("() => { const S = window.__DF__.state(), m = window.__DF__.match(), g = window.__DF__.dev && window.__DF__.dev.game;"
                " const o = document.getElementById('df-rotate'), b = document.getElementById('df-play');"
                " return { phase: S.phase, startedBy: S.startedBy, tick: g ? g.tick : null, match: m ? m.phase : null, timeLeft: m ? m.timeLeft : null,"
                " overlay: !!o && !o.hidden, card: !!b && !document.getElementById('df-boot').classList.contains('gone') }; }") or {}
    dev.check("A-A2: upright during a START load → no countdown under the rotate overlay (TAP TO PLAY waits behind it)",
              ph == "ready" and st.get("phase") == "ready" and st.get("tick") == 0 and st.get("overlay") is True and st.get("card") is True,
              "2.5 s after the load: %s" % json.dumps(st))
    dev.layout_step("rotate_load")
    dev.insets(s["safe"])
    dev.page.set_viewport_size({"width": dev.W, "height": dev.H})
    # the page sees the resize on its next animation frame: on a loaded box that can take a while — wait for the overlay
    # to go (up to 8 s) rather than a fixed second
    dev.wait("() => { const o = document.getElementById('df-rotate'); return o && o.hidden ? true : null; }", 8.0, poll=0.2)
    time.sleep(0.5)
    st2 = dev.js("() => { const g = window.__DF__.dev && window.__DF__.dev.game; const m = window.__DF__.match(); const b = document.getElementById('df-play');"
                 " return { phase: window.__DF__.state().phase, tick: g ? g.tick : null, timeLeft: m ? m.timeLeft : null,"
                 " card: !!b && b.getBoundingClientRect().width > 0 && !document.getElementById('df-boot').classList.contains('gone'),"
                 " overlay: !document.getElementById('df-rotate').hidden }; }") or {}
    tapped = dev.tap_sel("#df-play", settle=0.2, what="TAP TO PLAY (after turning back)")
    ok = dev.wait("() => (window.__DF__.state().phase === 'play') || null", 5)
    dev.check("A-A2: landscape again → the play card with the clock at rest; a tap starts the match",
              st2.get("phase") == "ready" and st2.get("tick") == 0 and st2.get("card") is True and st2.get("overlay") is False and tapped and bool(ok),
              "landscape: %s; after the tap: phase %s startedBy %s" % (json.dumps(st2), dev.phase(), (dev.js("() => window.__DF__.state()") or {}).get("startedBy")))
    n1 = len(dev.res(r"map_%s[^/]*\.glb" % target))
    dev.check("A-A4: START on %s fetched its map GLB once" % target, n1 - n0 == 1, "fetches %d → %d" % (n0, n1))


def run_ctx_lost(dev, how):
    """review B-F1: the WebGL context is lost while the arena loads (a deep link, or the bare-URL lobby boot): the
    "Graphics were reset by the device" card must still be there after the load — no TAP TO PLAY, no menus, no match —
    and a restored context reloads the page. A separate page (its errors are this broken state's, reported not gated)."""
    pg = dev.ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e).splitlines()[0][:160]))
    pg.on("console", lambda m: errs.append("console.%s: %s" % (m.type, m.text[:160])) if m.type == "error" else None)
    D = dev.plan["deep"]
    url = build_url(dev.args.base, map=D["map"], mode=D["mode"], kit=D["kit"], seed=5, dev=1) if how == "deep" else build_url(dev.args.base, dev=1)
    lost = None
    try:
        pg.goto(url, wait_until="commit", timeout=90_000)
        t0 = time.time()
        while time.time() - t0 < 90 and not lost:
            lost = pg.evaluate("() => { const D = window.__DF__; if (!D || !D.state || D.state().phase !== 'loading' || !D.touch || !D.touch()) return null;"
                               " const gl = document.getElementById('game').getContext('webgl2'); const x = gl && gl.getExtension('WEBGL_lose_context');"
                               " if (!x) return 'no WEBGL_lose_context'; window.__H_LC__ = x; x.loseContext(); return 'lost'; }")
            if not lost:
                time.sleep(0.05)
        time.sleep(0.5)
        early = pg.evaluate("() => ({ phase: window.__DF__.state().phase, card: (document.querySelector('#df-boot h2') || {}).textContent || null })")
        # the load runs on (it does not fail on a lost context): wait for its session, then give the flow time to finish
        pg.wait_for_function("() => window.__DF__ && window.__DF__.session && window.__DF__.session()", timeout=150_000)
        time.sleep(2.5)
        # the sim must stand still: a lobby world is 'live' from its first tick (no countdown), so what matters is that its
        # tick does not advance (the lobby runs only in phase 'menu', a match only in 'play')
        TICK = "() => { const d = window.__DF__.dev; return d && d.game ? d.game.tick : null; }"
        tk0 = pg.evaluate(TICK)
        time.sleep(1.0)
        after = pg.evaluate("() => { const boot = document.getElementById('df-boot'), m = window.__DF__.menu && window.__DF__.menu(), w = window.__DF__.match && window.__DF__.match(),"
                            " s = window.__DF__.session && window.__DF__.session();"
                            " return { phase: window.__DF__.state().phase, card: (document.querySelector('#df-boot h2') || {}).textContent || null,"
                            " cardShown: !!boot && !boot.classList.contains('gone'), play: !!document.getElementById('df-play'),"
                            " menu: !!(m && m.visible), session: s ? s.mode : null, match: w ? w.phase : null }; }")
        after["tick"] = [tk0, pg.evaluate(TICK)]
        pg.evaluate("() => { window.__H_MARK__ = 1; window.__H_LC__ && window.__H_LC__.restoreContext(); }")
        reloaded = False
        try:
            pg.wait_for_function("() => !window.__H_MARK__", timeout=20_000)
            reloaded = True
        except Exception:
            reloaded = False
        dev.check("B-F1: a context lost mid-load (%s) keeps the reset card after the load; a restored context reloads" % (
            "deep link" if how == "deep" else "bare-URL lobby boot"),
            lost == "lost" and after.get("phase") == "error" and after.get("card") == "Graphics were reset by the device" and after.get("cardShown") is True
            and not after.get("play") and not after.get("menu") and after["tick"][0] is not None and after["tick"][0] == after["tick"][1]
            and (after.get("match") in (None, "countdown") or after.get("session") == "lobby") and reloaded,
            "lose %s; right after %s; after the load %s; reloaded on restore %s" % (lost, json.dumps(early), json.dumps(after), reloaded))
    except Exception as e:
        dev.check("B-F1: a context lost mid-load (%s) keeps the reset card after the load; a restored context reloads" % how, False,
                  "stopped: %s (lose %s)" % (str(e).splitlines()[0][:200], lost))
    finally:
        if errs:
            dev.rep.setdefault("notes", []).append("B-F1 page (context deliberately lost) logged %d error(s), not gated: %s" % (len(errs), errs[:4]))
        try:
            pg.close()
        except Exception:
            pass


def run_tip_iframe(dev):
    """review A-A13: inside a portal's iframe the Add-to-Home-Screen tip must not show (following it would install the
    portal page). The tip's one-time flag is cleared first (setup), so only the frame check can hide it."""
    dev.js("() => localStorage.removeItem('dyefield.homeTip.v1')")
    pg = dev.ctx.new_page()
    try:
        pg.set_content("<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><style>html,body{margin:0}</style>"
                       "<iframe id=f src='%s' style='border:0;width:100vw;height:100vh' allow='fullscreen; autoplay'></iframe>" % build_url(dev.args.base, dev=1))
        fr = None
        t0 = time.time()
        while time.time() - t0 < 60:
            # the game frame = the one served from the gate's --base host (localhost dev/preview OR the live CDN)
            game_host = urllib.parse.urlsplit(dev.args.base).netloc
            fr = next((f for f in pg.frames if f != pg.main_frame and game_host in (f.url or "")), None)
            if fr:
                try:
                    if fr.evaluate("() => !!document.getElementById('dfm-tip-title')"):
                        break
                except Exception:
                    pass
            time.sleep(0.2)
        # a third-party frame may be denied storage here (Chrome: "Access is denied for this document"); the game reads it
        # in try/catch (unreadable = not seen yet), so the frame check alone decides whether the tip shows
        r = fr.evaluate("() => { const t = document.getElementById('dfm-tip-title'); let flag;"
                        " try { flag = localStorage.getItem('dyefield.homeTip.v1'); } catch (e) { flag = 'storage denied (' + e.name + ')'; }"
                        " return { framed: window.top !== window.self, exists: !!t, hidden: t ? t.hidden : null, flag }; }") if fr else None
        dev.check("A-A13: inside an iframe (a portal) the iPhone Add-to-Home-Screen tip stays hidden",
                  isinstance(r, dict) and r.get("framed") is True and r.get("exists") is True and r.get("hidden") is True and r.get("flag") != "1", json.dumps(r))
    except Exception as e:
        dev.check("A-A13: inside an iframe (a portal) the iPhone Add-to-Home-Screen tip stays hidden", False, "stopped: %s" % str(e).splitlines()[0][:200])
    finally:
        try:
            pg.close()
        except Exception:
            pass


def run_deep_link(dev):
    D = dev.plan["deep"]
    ios = bool(dev.spec.get("ios"))
    if ios:
        dev.js("() => localStorage.removeItem('dyefield.homeTip.v1')")    # B-F5 setup: this device's one time not used yet
    dev.goto(map=D["map"], mode=D["mode"], kit=D["kit"], seed=7, dev=1)
    ok = dev.wait("() => { const b = document.getElementById('df-play'); return b && b.getBoundingClientRect().width > 0 ? true : null; }", 180)
    txt = dev.js("() => { const b = document.getElementById('df-play'); return b ? b.textContent : null; }")
    dev.check("deep link (%s %s): the play card reads TAP TO PLAY" % (D["mode"], D["map"]), bool(ok) and txt == "TAP TO PLAY", "text %r phase %s" % (txt, dev.phase()))
    if not ok:
        return
    glb = dev.res(r"map_%s[^/]*\.glb" % D["map"])
    dev.check("A-A4: the deep link's map GLB is fetched once", len(glb) == 1, "%d fetch(es): %s" % (len(glb), [g["name"] for g in glb]))
    if ios:
        fl = dev.js("() => localStorage.getItem('dyefield.homeTip.v1')")
        dev.check("B-F5: a deep link that has shown no tip yet leaves the iPhone's one-time tip unused", fl is None, "flag %r at the play card" % fl)
    time.sleep(0.4)
    dev.layout_step("playcard")
    if not dev.tap_sel("#df-play", settle=0.2, what="TAP TO PLAY"):
        return
    ok = dev.wait("() => (window.__DF__.state().phase === 'play') || null", 5)
    st = dev.js("() => window.__DF__.state()") or {}
    dev.check("TAP TO PLAY → play (touch, no lock)", bool(ok) and st.get("startedBy") == "touch" and not st.get("pointerLocked"),
              "phase %s startedBy %s pointerLocked %s" % (st.get("phase"), st.get("startedBy"), st.get("pointerLocked")))
    check_fullscreen(dev, "TAP TO PLAY")
    live = dev.wait("() => (window.__DF__.match() && window.__DF__.match().phase === 'live') || null", 20)
    time.sleep(0.8)
    tb = dev.touch_rb()
    mm = dev.js("() => window.__DF__.match().matchMode")
    dev.check("deep-link match live with the overlay (%s)" % mm, bool(live) and tb.get("visible") is True and mm == D["mode"],
              "live %s visible %s mode %s" % (bool(live), tb.get("visible"), mm))
    dev.layout_step("hud_%s" % D["mode"])
    # the play card's own tap is a gesture: quick sanity that the match takes input (the stick)
    (sx, sy), _, _ = zones(dev)
    ensure_alive(dev, "before the deep-link stick")
    washed_retry(dev, "deep-link match: the stick moves the runner", lambda: stick_walk(dev, sx, sy, 1.2, 2.0))
    if ios:
        # B-F5: the first card that SHOWS the tip (here the pause card) is what uses the one time up
        pc = dev.btn_center("pause")
        dev.T.tap(pc[0], pc[1])
        dev.wait("() => (window.__DF__.state().phase === 'paused') || null", 3)
        time.sleep(0.5)
        tip = dev.js("() => { const t = document.getElementById('dfm-tip-pause'); return { shown: !!t && !t.hidden && t.getBoundingClientRect().width > 0,"
                     " flag: localStorage.getItem('dyefield.homeTip.v1') }; }") or {}
        dev.check("B-F5: the pause card shows the tip and only then remembers it", tip.get("shown") is True and tip.get("flag") == "1", json.dumps(tip))
        dev.tap_sel("#df-resume", what="RESUME")
        dev.wait("() => (window.__DF__.state().phase === 'play') || null", 3)


def install_checks(ctx, base, page, out):
    """M5 / M9: meta tags in the DOM; manifest + icons over HTTP with their pixel sizes"""
    res = []

    def chk(name, ok, detail=""):
        res.append({"name": name, "ok": bool(ok), "detail": detail})
        print("  %s  %s — %s" % ("PASS" if ok else "FAIL", name, detail))
    meta = page.evaluate("""() => { const m = (n) => { const e = document.querySelector('meta[name="' + n + '"]'); return e ? e.getAttribute('content') : null; };
        const l = (r) => { const e = document.querySelector('link[rel="' + r + '"]'); return e ? { href: e.href, sizes: e.getAttribute('sizes') } : null; };
        return { viewport: m('viewport'), capable: m('apple-mobile-web-app-capable'), mcapable: m('mobile-web-app-capable'),
                 status: m('apple-mobile-web-app-status-bar-style'), title: m('apple-mobile-web-app-title'), theme: m('theme-color'),
                 manifest: l('manifest'), apple: l('apple-touch-icon') }; }""")
    chk("M5 viewport meta", meta.get("viewport") == EXPECT_VIEWPORT, repr(meta.get("viewport")))
    chk("M9 meta tags (apple/mobile capable, status bar black-translucent, title DYEFIELD)",
        meta.get("capable") == "yes" and meta.get("mcapable") == "yes" and meta.get("status") == "black-translucent" and meta.get("title") == "DYEFIELD",
        json.dumps({k: meta.get(k) for k in ("capable", "mcapable", "status", "title", "theme")}))
    man = meta.get("manifest") or {}
    mj = None
    if man.get("href"):
        r = ctx.request.get(man["href"])
        try:
            mj = json.loads(r.body().decode("utf-8"))
        except Exception as e:
            mj = {"__error": str(e)[:120]}
        chk("M9 manifest 200 + JSON", r.status == 200 and isinstance(mj, dict) and not mj.get("__error"), "%s %s" % (r.status, man["href"]))
    else:
        chk("M9 manifest linked", False, "no link rel=manifest")
    if isinstance(mj, dict) and not mj.get("__error"):
        want = {"name": "DYEFIELD", "short_name": "DYEFIELD", "start_url": "./index.html", "scope": "./", "display": "fullscreen",
                "orientation": "landscape", "background_color": "#2f86dc", "theme_color": "#2f86dc"}
        bad = {k: mj.get(k) for k, v in want.items() if mj.get(k) != v}
        if mj.get("display_override") != ["fullscreen", "standalone"]:
            bad["display_override"] = mj.get("display_override")
        chk("M9 manifest fields", not bad, "mismatched %s" % bad if bad else "all M9 fields match")
        sizes = []
        for ic in mj.get("icons") or []:
            u = urllib.parse.urljoin(man["href"], ic.get("src", ""))
            r = ctx.request.get(u)
            ps = png_size(r.body()) if r.status == 200 else None
            want_px = int(str(ic.get("sizes", "0x0")).split("x")[0] or 0)
            sizes.append({"src": ic.get("src"), "status": r.status, "px": ps, "declared": ic.get("sizes"), "purpose": ic.get("purpose")})
            chk("M9 icon %s (%s)" % (ic.get("src"), ic.get("purpose")), r.status == 200 and ps == (want_px, want_px), "HTTP %s, PNG %s, declared %s" % (r.status, ps, ic.get("sizes")))
        have = {(s["px"][0] if s["px"] else 0, s.get("purpose")) for s in sizes}
        chk("M9 icon set 192 + 512 + maskable 512", (192, "any") in have and (512, "any") in have and (512, "maskable") in have, json.dumps(sorted(have, key=str)))
    ap = meta.get("apple") or {}
    if ap.get("href"):
        r = ctx.request.get(ap["href"])
        ps = png_size(r.body()) if r.status == 200 else None
        chk("M9 apple-touch-icon 180", r.status == 200 and ps == (180, 180), "HTTP %s PNG %s" % (r.status, ps))
    else:
        chk("M9 apple-touch-icon linked", False, "missing")
    out["install"] = {"checks": res, "meta": meta, "manifest": mj}
    return res


def pinch_control(ctx, out):
    """Does this harness's CDP pinch zoom a page at all? A zoomable page must reach visualViewport.scale > 1, else the M5
    pinch checks would pass vacuously."""
    pg = ctx.new_page()
    try:
        pg.set_content("<meta name='viewport' content='width=device-width, initial-scale=1'><div style='height:3000px;font:20px sans-serif'>zoomable control page</div>")
        cdp = ctx.new_cdp_session(pg)
        T = Touch(cdp)
        time.sleep(0.3)
        T.pinch(200, 180, spread=220, steps=14)
        time.sleep(0.6)
        sc = pg.evaluate("() => visualViewport.scale")
        out["pinchControl"] = {"scale": sc, "discriminates": isinstance(sc, (int, float)) and sc > 1.05}
        print("  pinch control on a zoomable page: visualViewport.scale %s → the pinch checks %s" % (
            sc, "discriminate" if out["pinchControl"]["discriminates"] else "DO NOT discriminate (pinch did not zoom even a zoomable page)"))
    except Exception as e:
        out["pinchControl"] = {"error": str(e).splitlines()[0][:200]}
    finally:
        try:
            pg.close()
        except Exception:
            pass


def run_device(browser, key, args, out, first):
    spec = LAYOUT_DEVICES[key]
    rep = {"device": key, "spec": {k: v for k, v in spec.items() if k != "ua"}, "ua": spec["ua"], "plan": PLAN[key],
           "checks": [], "layout": {}, "shots": []}
    out["devices"][key] = rep
    print("%s %dx%d @%sx (START %s %s %s; deep link %s %s)" % (key, spec["w"], spec["h"], spec["dpr"], PLAN[key]["mode"], PLAN[key]["map"],
                                                              PLAN[key]["kit"], PLAN[key]["deep"]["mode"], PLAN[key]["deep"]["map"]))
    dev = Device(browser, key, args, rep)
    try:
        try:
            if run_lobby_and_menus(dev):
                run_match_checks(dev, "START match")
                run_perf(dev, rep)
                if PLAN[key].get("perf") and not args.no_perf:
                    run_shadow_latch(dev)
                if PLAN[key].get("big"):
                    run_big_buttons(dev)
                run_washed(dev)
                if PLAN[key].get("rotate_load"):
                    run_rotate_during_load(dev)
            if first:
                install_checks(dev.ctx, args.base, dev.page, out)
                pinch_control(dev.ctx, out)
            run_deep_link(dev)
            if spec.get("ios"):
                run_tip_iframe(dev)
            if PLAN[key].get("ctxlost"):
                run_ctx_lost(dev, PLAN[key]["ctxlost"])
        except Exception as e:
            import traceback
            dev.check("the device run completed", False, "stopped: %s" % traceback.format_exc().strip().splitlines()[-1][:300])
        dev.T.release_all()
        dev.harvest_page()
        dev.check("M4: 0 pointer-lock requests on this device", dev.lock_requests == 0, "%d requestPointerLock calls" % dev.lock_requests)
        d = dev.diagnostics()
        rep["errors"] = d
        for k, label in (("consoleErrors", "console errors"), ("pageErrors", "page errors"), ("windowErrors", "window errors"),
                         ("shader", "shader/GL errors"), ("failedRequests", "failed requests")):
            dev.check("0 %s" % label, not d[k], "%d: %s" % (len(d[k]), json.dumps(d[k][:4])[:600]) if d[k] else "0")
        if d["shaderWarnings"]:
            print("  note: %d shader compiler warnings (not gating)" % len(d["shaderWarnings"]))
    finally:
        dev.close()
    fails = [c for c in rep["checks"] if not c["ok"]]
    rep["verdict"] = "PASS" if not fails else "FAIL (%d)" % len(fails)
    print("%s: %s (%d checks, %d fail)" % (key, rep["verdict"], len(rep["checks"]), len(fails)))


def main():
    ap = argparse.ArgumentParser(description="DYEFIELD mobile gate (CONTRACT_MOBILE M11), headless device emulation")
    ap.add_argument("--base", default="http://localhost:5203/")
    ap.add_argument("--headless", action="store_true", help="accepted for symmetry: this gate always runs headless")
    ap.add_argument("--no-serve", action="store_true")
    ap.add_argument("--devices", default=",".join(GATE_DEVICES))
    ap.add_argument("--no-perf", action="store_true", help="skip the 4x CPU-throttle measurement (informational anyway)")
    ap.add_argument("--report", default="mobile")
    args = ap.parse_args()
    devs = [k.strip() for k in args.devices.split(",") if k.strip()]
    bad = [k for k in devs if k not in PLAN]
    if bad:
        print("unknown device(s): %s (have %s)" % (bad, ", ".join(PLAN)))
        return 2
    try:
        server = ensure_server(args.base, not args.no_serve)
    except HarnessError as e:
        print("SETUP FAIL:", e)
        return 2
    out = {"t": time.strftime("%Y-%m-%d %H:%M:%S"), "base": args.base, "devices": {},
           "caveat": "headless Chromium device emulation on the dev box's shared Intel iGPU (other sessions draw on it): "
                     "not a real phone; perf numbers are informational"}
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
            out["browser"] = browser.version
            try:
                for i, k in enumerate(devs):
                    run_device(browser, k, args, out, first=(i == 0))
            finally:
                browser.close()
    finally:
        stop_server(server)
    fails = []
    for k, r in out["devices"].items():
        fails += ["%s: %s — %s" % (k, c["name"], c["detail"]) for c in r["checks"] if not c["ok"]]
    for c in (out.get("install") or {}).get("checks") or []:
        if not c["ok"]:
            fails.append("install: %s — %s" % (c["name"], c["detail"]))
    total = sum(len(r["checks"]) for r in out["devices"].values()) + len((out.get("install") or {}).get("checks") or [])
    out["verdict"] = "MOBILE PASS" if not fails else "MOBILE FAIL (%d of %d checks)" % (len(fails), total)
    out["failures"] = fails
    path = save_report(args.report, out, args.base)
    print()
    for k, r in out["devices"].items():
        print("%-9s %s" % (k, r.get("verdict")))
    for f in fails:
        print("FAIL", f[:400])
    print(out["verdict"], "(%d checks)" % total)
    print("report:", path)
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
