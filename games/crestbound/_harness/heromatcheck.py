#!/usr/bin/env python
"""Audit Nim's MATERIALS numerically.

hero.js `deriveMaterial()` takes a WORLD material's baked albedo/normal/rough
maps and re-uses them on the hero at its own `repeat`. Two things can go wrong,
and both are invisible in code review:

  1. TINT LOSS. three multiplies `material.color` by `map`. The palette in
     hero.js (COL.coat = hot orange-red, "the read-at-40-m silhouette colour")
     is therefore NOT what renders — what renders is colour x the mean of the
     world texture. This prints both, and the product.

  2. TEXEL SCALE. Every world texture is baked for a metres-per-tile that
     `upload(..., repeat)` records. Re-tiling it at `repeat = N` over a hero
     part of size L metres shows (N / L) tiles per metre against a texture
     authored for `repeat` tiles per metre. This prints the ratio: 1.0 is
     correct, 10 means the pattern is ten times too big on the model.

    python heromatcheck.py [--course verdant-1]
"""
import argparse
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "http://localhost:8788/games/crestbound/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]

CLICK_JS = r"""() => {
  const words = ['NEW GAME','NEW RUN','CONTINUE','PLAY','START','BEGIN','ENTER'];
  const btns = Array.from(document.querySelectorAll('button.cb-btn, button, [role=button], .btn'));
  for (const w of words) for (const b of btns) {
    const r = b.getBoundingClientRect();
    if (b.disabled || r.width < 4 || r.height < 4) continue;
    if ((b.textContent||'').toUpperCase().indexOf(w) < 0) continue;
    if (typeof b.__activate === 'function') b.__activate(); else b.click();
    return w;
  }
  const t = document.querySelector('canvas') || document;
  for (const ty of ['keydown','keyup'])
    t.dispatchEvent(new KeyboardEvent(ty,{code:'Enter',key:'Enter',bubbles:true,cancelable:true}));
  return null;
}"""

PROBE_JS = r"""
async () => {
  const A = globalThis.CRESTBOUND, G = A.game;
  const hero = G.hero, Mats = G.mats || (A.mats) || null;
  if (!hero) return {error: 'no hero'};

  // mean sRGB of a texture, by drawing it into a 64x64 canvas
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const ctx = cv.getContext('2d', {willReadFrequently: true});
  const meanOf = (tex) => {
    if (!tex) return null;
    const src = tex.image || (tex.source && tex.source.data);
    if (!src) return null;
    try { ctx.clearRect(0, 0, 64, 64); ctx.drawImage(src, 0, 0, 64, 64); } catch (e) { return null; }
    let d;
    try { d = ctx.getImageData(0, 0, 64, 64).data; } catch (e) { return null; }
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return [+(r / n / 255).toFixed(4), +(g / n / 255).toFixed(4), +(b / n / 255).toFixed(4)];
  };

  const out = [];
  for (const [slot, m] of Object.entries(hero.M)) {
    if (!m || !m.isMaterial) continue;
    const key = m.userData && m.userData.nimKey || null;
    const src = (Mats && typeof Mats.get === 'function' && key)
      ? (() => { try { return Mats.get(key, hero.themeId); } catch (e) { return null; } })() : null;
    out.push({
      slot, key, type: m.type,
      color: '#' + m.color.getHexString(),
      hasMap: !!m.map,
      repeat: m.map ? [+m.map.repeat.x.toFixed(3), +m.map.repeat.y.toFixed(3)] : null,
      srcRepeat: (src && src.map) ? [+src.map.repeat.x.toFixed(3), +src.map.repeat.y.toFixed(3)] : null,
      srcType: src ? src.type : null,
      mapMean: meanOf(m.map),
      roughness: m.roughness === undefined ? null : +m.roughness.toFixed(2),
      metalness: m.metalness === undefined ? null : +m.metalness.toFixed(2),
      sheen: m.sheen === undefined ? null : m.sheen,
      transmission: m.transmission === undefined ? null : m.transmission,
      emissive: m.emissive ? '#' + m.emissive.getHexString() : null,
      emissiveIntensity: m.emissiveIntensity === undefined ? null : m.emissiveIntensity,
    });
  }

  // the scarf chain: rest length vs the longest extension seen over a run
  const P = G.player;
  P.update = function () {};
  if (G.cam) G.cam.update = function () {};
  G._checkDeath = function () {};
  const p0 = P.pos.clone();
  const D = 1 / 60;
  let maxSpan = 0, maxSeg = 0;
  const restSeg = 0.105, links = 7;
  for (let k = 0; k < 240; k++) {
    P.pos.copy(p0); P.prevPos.copy(p0); P.renderPos.copy(p0);
    P.vel.set(k < 60 ? 0 : 9, 0, 0);
    P.facing = 0; P.grounded = true; P.onGround = true;
    P.state = P.anim = (k < 60 ? 'idle' : 'run');
    P.stateT = P.animT = k * D;
    P.speed = k < 60 ? 0 : 9; P.speedNorm = k < 60 ? 0 : 1;
    P.leanX = 0; P.dead = false; P.heroFade = 0; P.inWater = null; P.wallN = null;
    hero.update(D, P);
    const s = hero._scarfP;
    const dx = s[21] - s[0], dy = s[22] - s[1], dz = s[23] - s[2];
    maxSpan = Math.max(maxSpan, Math.hypot(dx, dy, dz));
    for (let i = 0; i < links; i++) {
      const a = i * 3, b = a + 3;
      maxSeg = Math.max(maxSeg, Math.hypot(s[b] - s[a], s[b + 1] - s[a + 1], s[b + 2] - s[a + 2]));
    }
  }
  return {mats: out, themeId: hero.themeId,
          scarf: {links, restSeg, restLength: +(links * restSeg).toFixed(3),
                  maxTipSpan: +maxSpan.toFixed(3), maxSegment: +maxSeg.toFixed(4),
                  stretchPct: +(maxSpan / (links * restSeg) * 100).toFixed(0)}};
}
"""

# approximate size in metres of the hero part each material dresses, used to
# turn `repeat` into "tiles per metre on the model"
PART_SIZE = {
    "coat": 0.58, "coatDark": 0.58, "trim": 0.20, "scarf": 0.74,
    "skin": 0.50, "hair": 0.30, "boot": 0.30, "metal": 0.08, "gold": 0.05,
    "leather": 0.24, "rope": 0.30, "blanket": 0.23, "lens": 0.10,
    "eyeWhite": 0.12, "eyeDark": 0.06,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", default="verdant-1")
    a = ap.parse_args()
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        pg = br.new_page(viewport={"width": 480, "height": 320})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        pg.goto("%s?dev=1&course=%s" % (BASE, a.course), wait_until="load", timeout=60_000)
        dl, ok = time.time() + 90, False
        while time.time() < dl:
            try:
                if pg.evaluate("(()=>{const g=globalThis.CRESTBOUND&&CRESTBOUND.game;"
                               "return !!(g&&g.hero&&(g.state==='playing'||g.state==='keep'));})()"):
                    ok = True
                    break
                pg.evaluate(CLICK_JS)
            except Exception:
                pass
            pg.wait_for_timeout(400)
        if not ok:
            print("never reached a live state")
            br.close()
            return 2
        pg.wait_for_timeout(1500)
        r = pg.evaluate(PROBE_JS)
        br.close()

    if r.get("error"):
        print("ERROR %s" % r["error"])
        return 2
    print("theme: %s" % r["themeId"])
    print("%-10s %-9s %-22s %-8s %-19s %-19s %-8s" %
          ("slot", "key", "type", "color", "map mean sRGB", "rendered = c x map", "tile err"))
    for m in r["mats"]:
        mm = m["mapMean"]
        col = m["color"]
        prod = ""
        if mm:
            cr = int(col[1:3], 16) / 255.0
            cg = int(col[3:5], 16) / 255.0
            cb = int(col[5:7], 16) / 255.0
            prod = "#%02x%02x%02x" % (int(cr * mm[0] * 255), int(cg * mm[1] * 255), int(cb * mm[2] * 255))
        size = PART_SIZE.get(m["slot"])
        err = ""
        if m["repeat"] and m["srcRepeat"] and size:
            on_model = m["repeat"][0] / size          # tiles per metre on the hero
            authored = m["srcRepeat"][0]              # tiles per metre in the world
            if authored > 0:
                err = "%.1fx" % (authored / on_model) if on_model else ""
        print("%-10s %-9s %-22s %-8s %-19s %-19s %-8s" %
              (m["slot"], m["key"], m["type"], col,
               ("(%.2f %.2f %.2f)" % tuple(mm)) if mm else "-", prod, err))
    print("")
    print("scarf: %s" % json.dumps(r["scarf"]))
    with open(os.path.join(HERE, "heromatcheck.json"), "w", encoding="utf-8") as f:
        json.dump(r, f, indent=2)
    print("page errors: %s" % errs[:5])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
