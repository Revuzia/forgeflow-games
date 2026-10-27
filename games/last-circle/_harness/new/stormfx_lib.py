#!/usr/bin/env python
"""STORMFX lane (Wave 4) shared helpers: in-page probe installer + image statistics.

Imported by stormfx_storm.py and stormfx_fx.py. Nothing here touches the game's files; the page helpers
(window.__SF__) only read game state and render the scene into private render targets.
"""
from __future__ import annotations

import base64
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import common  # noqa: E402

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

SF_JS = r"""() => {
  if (window.__SF__) return 'already';
  const C = window.__LC__, W = C.W, k = W.kernel, THREE = W.THREE;
  const SF = window.__SF__ = {};
  const cv = () => k.renderer.domElement;

  SF.tp = (x, z) => { const p = W.player; p.pos.x = x; p.pos.z = z; p.pos.y = W.map.heightAt(x, z) + 0.05;
    if (p.vel) { p.vel.x = 0; p.vel.y = 0; p.vel.z = 0; } return [p.pos.x, p.pos.y, p.pos.z]; };
  SF.face = (tx, tz, pitch) => { const p = W.player; const dx = tx - p.pos.x, dz = tz - p.pos.z;
    const y = Math.atan2(-dx, -dz); p.input.yaw = y; p.yaw = y; p.input.pitch = pitch; return y; };
  SF.circle = () => { const q = W.stormCtl.storm.stateAt(W.t); return { phase: q.phase, radius: q.radius, cx: q.center.x, cz: q.center.z, closing: q.closing, t: W.t }; };
  SF.setT = (t) => { W.t = t; return SF.circle(); };
  SF.phaseWindow = (ph) => { const S = W.stormCtl.storm; const tl = S.timeline[ph - 1]; return tl ? { waitStart: tl.waitStart, shrinkStart: tl.shrinkStart, end: tl.end } : null; };
  SF.ground = (x, z) => Math.max(W.map.heightAt(x, z), W.map.waterY);
  SF.ringGround = (cx, cz, R, n) => { const out = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; out.push(SF.ground(cx + Math.sin(a) * R, cz + Math.cos(a) * R)); } return out; };

  // composed frame through the composer (what the player sees), wall + bolts optionally hidden
  SF.grab = (hide) => {
    const ctl = W.stormCtl; const objs = [ctl.wall, ctl.bolts].filter(Boolean); const vis = objs.map((o) => o.visible);
    if (hide) objs.forEach((o) => { o.visible = false; });
    if (k.composer) k.composer.render(0); else k.renderer.render(k.scene, k.camera);
    const url = cv().toDataURL('image/png');
    objs.forEach((o, i) => { o.visible = vis[i]; });
    return url;
  };

  // projected sample points ON the wall: heights hMin..hMax above the ground reference, every azimuth step
  SF.wallPoints = (hMin, hMax, nH, azStepDeg) => {
    const ctl = W.stormCtl, wall = ctl.wall, cam = W.camera; cam.updateMatrixWorld(); const R = wall.scale.x, cx = wall.position.x, cz = wall.position.z;
    const cw = cv().width, ch = cv().height; const v = new THREE.Vector3(); const out = [];
    for (let d = 0; d < 360; d += azStepDeg) {
      const a = d * Math.PI / 180; const x = cx + Math.sin(a) * R, z = cz + Math.cos(a) * R; const g = SF.ground(x, z);
      for (let j = 0; j < nH; j++) {
        const h = nH === 1 ? (hMin + hMax) / 2 : hMin + (hMax - hMin) * j / (nH - 1); const y = g + h;
        v.set(x, y, z).project(cam);
        if (!(v.z > -1 && v.z < 1) || Math.abs(v.x) >= 1 || Math.abs(v.y) >= 1) continue;
        const px = Math.floor((v.x * 0.5 + 0.5) * cw), py = Math.floor((-v.y * 0.5 + 0.5) * ch);
        // occlusion: colliders (map.losBlocked) + terrain stepped along the ray
        const ax = cam.position.x, ay = cam.position.y, az = cam.position.z; let blocked = false;
        try { if (W.map.losBlocked && W.map.losBlocked(ax, ay, az, x, y, z)) blocked = true; } catch (e) {}
        if (!blocked) { const dist = Math.hypot(x - ax, y - ay, z - az); const n = Math.min(80, Math.ceil(dist / 5));
          for (let s = 1; s < n; s++) { const t = s / n; const gx = ax + (x - ax) * t, gz = az + (z - az) * t, gy = ay + (y - ay) * t; if (W.map.heightAt(gx, gz) > gy) { blocked = true; break; } } }
        out.push([px, py, +h.toFixed(2), blocked ? 0 : 1, +Math.hypot(x - ax, z - az).toFixed(1)]);
      }
    }
    return { w: cw, h: ch, pts: out };
  };

  // wall (and optionally the lightning pool / sky dome) drawn ALONE into a float render target over a flat colour.
  // keepNames: extra objects to keep (by name), e.g. ['sky']. Returns base64 float32 RGBA, rows bottom-to-top.
  SF.only = (rgb, withWall, withBolts, keepSky, w, h) => {
    const sc = W.scene, ctl = W.stormCtl, r = k.renderer;
    const keep = new Set(); const add = (o) => { while (o) { keep.add(o); o = o.parent; } };
    if (withWall) add(ctl.wall); if (withBolts) add(ctl.bolts); if (keepSky) { const s = sc.getObjectByName('sky'); if (s) add(s); }
    const saved = []; sc.traverse((o) => { saved.push([o, o.visible]); });
    sc.traverse((o) => { if (!keep.has(o)) o.visible = false; });
    if (withWall) ctl.wall.visible = true; if (withBolts) ctl.bolts.visible = true;
    const bg = sc.background, fog = sc.fog; sc.background = new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]); sc.fog = null;
    let rt = null, out = null;
    try {
      rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
      r.setRenderTarget(rt); r.clear(); r.render(sc, W.camera);
      const buf = new Float32Array(w * h * 4); r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      let s = ''; const u8 = new Uint8Array(buf.buffer); const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
      out = btoa(s);
    } catch (e) { out = null; }
    finally { r.setRenderTarget(null); sc.background = bg; sc.fog = fog; for (const [o, v] of saved) o.visible = v; if (rt) rt.dispose(); }
    return out;
  };

  SF.fogState = () => { const sc = W.scene, f = sc.fog; const su = W.skyUniforms; let top = null, bot = null;
    if (su && su.top && su.bot) { top = su.top.value; bot = su.bot.value; } else { const m = sc.getObjectByName('sky'); const u = m && m.material.uniforms; if (u && u.top) { top = u.top.value; bot = u.bot.value; } }
    const c3 = (c) => c ? [c.r, c.g, c.b] : null;
    return { fogC: f ? c3(f.color) : null, fogD: f ? f.density : null, bg: sc.background && sc.background.isColor ? c3(sc.background) : null, top: c3(top), bot: c3(bot),
             grade: k.outputPass && k.outputPass.uniforms && k.outputPass.uniforms.stormAmt ? k.outputPass.uniforms.stormAmt.value : null,
             inStorm: !!W._playerInStorm, skySrc: su ? 'W.skyUniforms' : 'mesh:sky' }; };
  return 'ok';
}"""


AA_OFF_JS = r"""() => { const W = window.__LC__.W; if (typeof W.setGfx !== 'function' || typeof W.getGfx !== 'function') return { had: false };
  const g = W.getGfx(); const prev = g && g.prefs ? g.prefs.aa : null; const live = g && g.live ? g.live.aa : null;
  if (live && live !== 'off') W.setGfx('aa', 'off'); return { had: true, prev, live }; }"""


def aa_off(s):
    """P2-F (parity P2+P3, P1-C's open item): switch the anti-aliasing pass OFF for an A/B whose rule is additive / bit-exact (FXAA and SMAA
    are edge-dependent and non-linear: a 2x2 factorial or a bit-identity comparison through them is not additive by construction). The rows
    that judge AA itself live in P1-C's aa probe; every other row of these gates still runs with the build's own AA. Returns the restore token."""
    tok = s.js(AA_OFF_JS)
    if tok.get("had") and tok.get("live") not in (None, "off"):
        s.step_frames(2, 1 / 60, True)
    return tok


def aa_restore(s, tok):
    if tok and tok.get("had") and tok.get("live") not in (None, "off"):
        s.js("(v) => window.__LC__.W.setGfx('aa', v || 'auto')", tok.get("prev"))
        s.step_frames(2, 1 / 60, True)


def install(s):
    return s.js(SF_JS)


def png_to_arr(data_url_or_bytes):
    if isinstance(data_url_or_bytes, str):
        b = base64.b64decode(data_url_or_bytes.split(",", 1)[1])
    else:
        b = data_url_or_bytes
    return np.asarray(Image.open(io.BytesIO(b)).convert("RGB")).astype(np.float32)


def save_png(arr_or_url, path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    if isinstance(arr_or_url, str):
        with open(path, "wb") as f:
            f.write(base64.b64decode(arr_or_url.split(",", 1)[1]))
    else:
        Image.fromarray(np.clip(arr_or_url, 0, 255).astype(np.uint8)).save(path)


def luma(a):
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def float_buf(b64, w, h):
    """base64 float32 RGBA (rows bottom-to-top) -> (h, w, 4) array, top row first."""
    a = np.frombuffer(base64.b64decode(b64), dtype=np.float32).reshape(h, w, 4)
    return a[::-1].copy()


def region_stats(on, off, pts, w, h, hmin, hmax, exclude=None):
    """Mean abs RGB delta (0..255 per channel) and luma ratio over the VISIBLE wall sample pixels with hmin <= hAbove <= hmax."""
    xs, ys = [], []
    sx, sy = on.shape[1] / float(w), on.shape[0] / float(h)
    seen = set()
    for (px, py, ha, vis, dist) in pts:
        if not vis or ha < hmin or ha > hmax:
            continue
        x, y = int(px * sx), int(py * sy)
        if x < 0 or y < 0 or x >= on.shape[1] or y >= on.shape[0] or (x, y) in seen:
            continue
        if exclude and exclude[0] <= x <= exclude[2] and exclude[1] <= y <= exclude[3]:
            continue
        seen.add((x, y))
        xs.append(x)
        ys.append(y)
    if not xs:
        return None
    xs = np.array(xs)
    ys = np.array(ys)
    a, b = on[ys, xs], off[ys, xs]
    d = np.abs(a - b).mean()
    la, lb = luma(a).mean(), luma(b).mean()
    return {"n": int(len(xs)), "meanAbsDelta": float(d), "lumaOn": float(la), "lumaOff": float(lb), "lumaRatio": float(la / max(lb, 1e-6)),
            "rgbOn": [round(float(x), 1) for x in a.mean(axis=0)], "rgbOff": [round(float(x), 1) for x in b.mean(axis=0)]}


def row_peaks(on, off, pts, w, h, hmin, hmax, thr=4.0, exclude=None, step=24):
    """Streak visibility: for sampled image rows inside the wall's hmin..hmax region, take the HORIZONTAL profile of the SIGNED
    A/B luma delta (on - off; verticals converge in perspective, so a column profile smears them), subtract a 31 px moving median
    and count distinct peaks more than `thr` (0..255 luma) ABOVE it: a streak is a line that is LIGHTER than the veil around it.
    (An absolute delta turns a light streak in a darkening veil into a dip - it is closer to the 'off' frame than its neighbours.)
    Returns the MEDIAN peak count over the rows and the per-row counts."""
    sx, sy = on.shape[1] / float(w), on.shape[0] / float(h)
    rows = {}
    for (px, py, ha, vis, dist) in pts:
        if not vis or ha < hmin or ha > hmax:
            continue
        x, y = int(px * sx), int(py * sy)
        if exclude and exclude[0] <= x <= exclude[2] and exclude[1] <= y <= exclude[3]:
            continue
        if 0 <= y < on.shape[0] and 0 <= x < on.shape[1]:
            r = rows.setdefault(y // step, [y, x, x])
            r[1] = min(r[1], x)
            r[2] = max(r[2], x)
    counts = []
    dl = luma(on) - luma(off)
    for key, (y, x0, x1) in sorted(rows.items()):
        if x1 - x0 < 60:
            continue
        y0, y1 = max(0, y - 1), min(dl.shape[0], y + 3)
        prof = dl[y0:y1, x0:x1 + 1].mean(axis=0)
        k = 31
        pad = np.pad(prof, (k // 2, k // 2), mode="edge")
        med = np.median(np.lib.stride_tricks.sliding_window_view(pad, k), axis=1)
        ex = prof - med
        kk = 5
        padx = np.pad(ex, (kk // 2, kk // 2), mode="edge")
        win = np.lib.stride_tricks.sliding_window_view(padx, kk).max(axis=1)
        pk = (ex >= win) & (ex > thr)
        xs = np.where(pk)[0]
        n, last = 0, -10
        for xx in xs:
            if xx - last > 2:
                n += 1
            last = xx
        counts.append(n)
    if not counts:
        return 0, []
    return int(np.median(counts)), counts
