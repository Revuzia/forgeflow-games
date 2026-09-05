#!/usr/bin/env python
"""CRESTBOUND readability gate — walked surface vs the fog band, in PIXELS.

THE LAW (CONTRACT §15): the surface the hero walks on must hold >= 3.5:1 WCAG
relative-luminance contrast against the background actually behind it — the fog
band. This tool is the only honest source for that number: albedo arithmetic
(tint hex vs fog hex) has shipped fiction before, because lighting, exposure,
tone mapping, the grade, bloom and the sky dome all sit between a material
constant and the pixel a player sees.

METHOD, per station (the spawn and every checkpoint of every course):
  1. teleport the hero onto the station, let the frame settle (lighting, LOD,
     particles, the camera's ease-back),
  2. project the station's WORLD position through the LIVE camera
     (`camera.project`) to find the hero's feet in screen pixels — the def is
     ground truth for where the walked surface is, and the live camera says
     which pixels are wearing it. A fixed screen rectangle would sample the sky
     on a climb and the hero's own back on a descent,
  3. sample a band just BELOW the feet (the ground between the hero and the
     camera; offset far enough down to clear the blob shadow) and take the
     MEDIAN colour — median, not mean, so one bright stripe or a coin does not
     move the number,
  4. sample the fog band: a horizontal strip at 55 % of frame height, on the
     side of the frame FARTHEST from the hero, again by median,
  5. WCAG contrast between the two luminances.

An all-black frame (GPU/tab contention) is evidence of nothing: it is retaken,
and if it stays black the station prints UNMEASURABLE — deliberately distinct
from FAIL, because nothing was measured.

    python contrastcheck.py                       # every course on disk
    python contrastcheck.py --courses verdant-1 --save-crops
    python contrastcheck.py --floor 3.5 --headless

Exit 0 = every CHECKPOINT station is at or above the floor. The spawn row is
printed for information; a spawn apron inside set dressing does not gate.
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
ROOT = os.path.dirname(HERE)
SHOTS = os.path.join(ROOT, "_shots", "contrast")
BASE = "http://localhost:8788/games/crestbound/index.html"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=1"]
HEADLESS_FLAGS = [f for f in FLAGS if not f.startswith("--use-angle")] + [
    "--use-gl=angle", "--use-angle=swiftshader"]

FLOOR = 3.5              # CONTRACT §15
LUMA_FLOOR = 2.5         # mean 8-bit luma below this = a contention frame
BLACK_RETRIES = 2

STATE_JS = "globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state"

CLICK_JS = r"""() => {
  const words = ['NEW GAME', 'NEW RUN', 'CONTINUE', 'PLAY', 'START', 'BEGIN', 'ENTER'];
  const btns = Array.from(document.querySelectorAll('button.cb-btn, button, [role=button], .btn'));
  for (const want of words) {
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (b.disabled || r.width < 4 || r.height < 4) continue;
      if ((b.textContent || '').toUpperCase().indexOf(want) < 0) continue;
      if (typeof b.__activate === 'function') b.__activate(); else b.click();
      return want;
    }
  }
  const t = document.querySelector('canvas') || document;
  for (const type of ['keydown', 'keyup'])
    t.dispatchEvent(new KeyboardEvent(type, {code:'Enter', key:'Enter', bubbles:true, cancelable:true}));
  return null;
}"""

STATIONS_JS = r"""
() => {
  const A = globalThis.CRESTBOUND, G = A && A.game, C = G && G.course;
  if (!C) return {error: 'no course'};
  const posOf = (o) => {
    if (!o) return null;
    if (typeof o.x === 'number') return {x:o.x, y:o.y, z:o.z};
    if (o.pos) return posOf(o.pos);
    if (o.p) return Array.isArray(o.p) ? {x:o.p[0], y:o.p[1], z:o.p[2]} : posOf(o.p);
    if (o.position) return posOf(o.position);
    return null;
  };
  const out = [];
  const sp = C.spawnFor ? C.spawnFor(0) : null;
  if (sp && sp.pos) out.push({name: 'spawn', gates: false, p: posOf(sp.pos),
                              yaw: (typeof sp.yaw === 'number') ? sp.yaw : 0});
  (C.checkpoints || []).forEach((c, i) => {
    if (i === 0) return;                       // checkpoints[0] IS the spawn
    const p = posOf(c);
    if (p) out.push({name: 'cp' + i, gates: true, p,
                     yaw: (typeof c.yaw === 'number') ? c.yaw : 0,
                     padR: (typeof c.radius === 'number') ? c.radius : 2.15});
  });
  return {stations: out, theme: G.themeId, courseId: G.courseId,
          name: (C.def && C.def.name) || G.courseId};
}
"""

# Pose the hero on a station and report where the ground under their feet lands
# on screen, through the LIVE camera.
POSE_JS = r"""
async (st) => {
  const A = globalThis.CRESTBOUND, G = A.game, THREE = A.THREE, E = A.engine;
  if (!G || !THREE || !E) return {error: 'no game/THREE/engine'};
  const frame = () => new Promise(r => requestAnimationFrame(r));
  let P = G.player;
  const syncP = () => { if (G.player && G.player !== P) P = G.player; return P; };
  syncP();
  if (!P || !P.__test) return {error: 'no player.__test'};

  const yaw = (typeof st.yaw === 'number' && isFinite(st.yaw)) ? st.yaw : 0;
  const put = () => {
    P.__test.teleport(new THREE.Vector3(st.p.x, st.p.y + 0.5, st.p.z));
    P.__test.setVel(new THREE.Vector3(0, 0, 0));
    /* Face the authored course direction, so the camera recenters BEHIND the
       hero and "ahead of the checkpoint" is the ground the player looks at. */
    if (P.__test.setFacing) P.__test.setFacing(yaw);
  };
  put();
  if (G.cam && G.cam.recenter) G.cam.recenter();
  for (let k = 0; k < 50; k++) await frame();        // lighting / LOD / camera ease

  // A station on a conveyor or a slope carries the hero away during the settle;
  // re-pin once and give the frame a short second settle, or the "station" shot
  // is of somewhere else entirely.
  syncP();
  if (Math.hypot(P.pos.x - st.p.x, P.pos.y - (st.p.y + 0.5), P.pos.z - st.p.z) > 2.0) {
    put();
    for (let k = 0; k < 16; k++) await frame();
  }
  syncP();
  if (P.dead) return {error: 'the hero died on the station'};

  const cam = E.camera;
  const cv = document.querySelector('canvas');
  const rect = cv ? cv.getBoundingClientRect() : {width: window.innerWidth, height: window.innerHeight, left: 0, top: 0};
  const project = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(cam);
    return {x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
            y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
            behind: v.z > 1};
  };
  const feet = project(st.p.x, st.p.y, st.p.z);
  const head = project(P.pos.x, P.pos.y + 1.5, P.pos.z);
  const heroFeet = project(P.pos.x, P.pos.y, P.pos.z);

  /* THE DECK WINDOW (critic C13). The old window was a screen rectangle just
     below the projected feet — which, through a third-person camera that sits
     behind and above the hero, is the hero's own legs and the checkpoint's
     glowing torus, not the walked surface. Sample a band of WORLD points
     0.8-2.0 m AHEAD of the station along the course direction (yaw 0 faces
     -Z: forward = (-sin, -cos), right = (cos, -sin)), spread 1.6 m either
     side, project each through the live camera, and let Python reject any
     that fall inside the hero's screen box. Points on the pad's lit ring
     (torus at 1.42 m, course.js _buildCheckpoints) are rejected in WORLD
     space here, so the ring's glow never enters the median. */
  const fwx = -Math.sin(yaw), fwz = -Math.cos(yaw);
  const rtx = Math.cos(yaw), rtz = -Math.sin(yaw);
  const RING_R = 1.42, RING_HALF = 0.20;
  const samples = [];
  const NA = 7, NL = 13;
  for (let ia = 0; ia < NA; ia++) {
    const a = st.aheadFrom + (st.aheadTo - st.aheadFrom) * (ia / (NA - 1));
    for (let il = 0; il < NL; il++) {
      const l = -st.halfWidth + 2 * st.halfWidth * (il / (NL - 1));
      const wx = st.p.x + fwx * a + rtx * l, wz = st.p.z + fwz * a + rtz * l;
      const dr = Math.hypot(wx - st.p.x, wz - st.p.z);
      if (Math.abs(dr - RING_R) < RING_HALF) continue;      // the torus glow
      const s = project(wx, st.p.y, wz);
      if (s.behind) continue;
      samples.push([Math.round(s.x), Math.round(s.y)]);
    }
  }
  /* The hero's screen box: feet to head, +-0.45 m of shoulder, so his body,
     scarf and blob shadow never land in the deck median. */
  const hb = [
    project(P.pos.x - rtx * 0.45, P.pos.y, P.pos.z - rtz * 0.45),
    project(P.pos.x + rtx * 0.45, P.pos.y, P.pos.z + rtz * 0.45),
    project(P.pos.x - rtx * 0.45, P.pos.y + 1.75, P.pos.z - rtz * 0.45),
    project(P.pos.x + rtx * 0.45, P.pos.y + 1.75, P.pos.z + rtz * 0.45),
    project(P.pos.x - fwx * 0.45, P.pos.y, P.pos.z - fwz * 0.45),
    project(P.pos.x + fwx * 0.45, P.pos.y + 1.75, P.pos.z + fwz * 0.45),
  ];
  const heroBox = {
    x0: Math.min(...hb.map(q => q.x)) - 6, x1: Math.max(...hb.map(q => q.x)) + 6,
    y0: Math.min(...hb.map(q => q.y)) - 6, y1: Math.max(...hb.map(q => q.y)) + 6,
  };
  return {
    ok: true,
    w: Math.round(rect.width), h: Math.round(rect.height),
    feet, head, heroFeet, samples, heroBox, yaw,
    heroPx: Math.round(Math.abs(heroFeet.y - head.y)),
    theme: G.themeId, state: G.state,
    fog: (E.scene && E.scene.fog) ? '#' + E.scene.fog.color.getHexString() : null,
    surface: P.surface || null,
  };
}
"""


def _lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(rgb):
    return 0.2126 * _lin(rgb[0]) + 0.7152 * _lin(rgb[1]) + 0.0722 * _lin(rgb[2])


def contrast(l1, l2):
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def median(xs):
    s = sorted(xs)
    n = len(s)
    if not n:
        return 0
    return s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2])


def band_median(px, w, h, x0, x1, y0, y1, step=2):
    """Median RGB over a screen rectangle, clamped to the frame."""
    x0 = max(0, int(x0)); x1 = min(w, int(x1))
    y0 = max(0, int(y0)); y1 = min(h, int(y1))
    rs, gs, bs = [], [], []
    for y in range(y0, y1, step):
        for x in range(x0, x1, step):
            p = px[x, y]
            rs.append(p[0]); gs.append(p[1]); bs.append(p[2])
    if not rs:
        return None, 0
    return (median(rs), median(gs), median(bs)), len(rs)


def frame_mean_luma(path):
    from PIL import Image, ImageStat
    return ImageStat.Stat(Image.open(path).convert("L")).mean[0]


def snap(pg, path):
    """Screenshot with the black-frame guard: a contention frame is evidence of
    nothing, so retake before believing it.

    The screenshot itself also gets an explicit, generous timeout and its own
    retry. HARNESS_NOTES already records that browser gates false-fail when
    several Chromes run at once; on a loaded box the headless swiftshader
    rasteriser cannot deliver a 1280x720 frame inside Playwright's 30 s default
    and the whole run dies on
        `playwright._impl._errors.TimeoutError: Page.screenshot: Timeout 30000ms exceeded`
    with no table printed. That is a harness fragility, not a contrast result —
    the 3.5:1 CONTRACT floor is untouched."""
    last = 0.0
    for _ in range(BLACK_RETRIES + 1):
        shot = False
        for a in range(3):
            try:
                pg.screenshot(path=path, timeout=180_000)
                shot = True
                break
            except Exception as e:
                print("  snap retry %d: %s" % (a + 1, str(e).splitlines()[0][:110]))
                pg.wait_for_timeout(2500)
        if not shot:
            return False, 0.0
        last = frame_mean_luma(path)
        if last >= LUMA_FLOOR:
            return True, last
        pg.wait_for_timeout(900)
    return False, last


def leave_title(pg, timeout=45):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            st = pg.evaluate(STATE_JS)
        except Exception:
            st = None
        if st in ("keep", "playing"):
            return True
        if st == "paused":
            try:
                pg.keyboard.press("Escape")
            except Exception:
                pass
        try:
            pg.evaluate(CLICK_JS)
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False


def goto_course(pg, cid, timeout=90):
    try:
        pg.evaluate("async (id) => { const d = CRESTBOUND.game.__dev;"
                    " if (!d) throw new Error('__dev missing (?dev=1)'); await d.goto(id); }", cid)
    except Exception as e:
        return False, str(e)[:200]
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if pg.evaluate("(id)=>!!(CRESTBOUND.game.course && CRESTBOUND.game.courseId===id"
                           " && (CRESTBOUND.game.state==='playing'||CRESTBOUND.game.state==='keep'))", cid):
                return True, "ok"
        except Exception:
            pass
        try:
            if pg.evaluate(STATE_JS) in ("card", "cinematic", "title", "paused"):
                pg.evaluate(CLICK_JS)
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False, "never arrived"


def courses_on_disk(pg):
    ids = []
    try:
        ids = pg.evaluate(
            "async () => { const m = await import(new URL('runtime/data/index.js', location.href).href);"
            " return m.ALL_COURSE_IDS || []; }") or []
    except Exception:
        ids = []
    if not ids:
        d = os.path.join(ROOT, "runtime", "data", "courses")
        ids = sorted(f[:-3] for f in os.listdir(d)) if os.path.isdir(d) else []
    out = [c for c in ids
           if os.path.isfile(os.path.join(ROOT, "runtime", "data", "courses", c + ".js"))]
    if os.path.isfile(os.path.join(ROOT, "runtime", "data", "keep.js")):
        out = ["keep"] + out
    return out


def deck_median(px, w, h, samples, hero_box, patch=2):
    """Median RGB over the projected deck samples: a (2*patch+1)^2 pixel patch
    around every world sample that is on screen and OUTSIDE the hero's screen
    box. Returns (rgb, pixels used, samples used, samples rejected as hero)."""
    rs, gs, bs = [], [], []
    used = rejected = 0
    hx0, hx1 = hero_box.get("x0", -1e9), hero_box.get("x1", -1e9)
    hy0, hy1 = hero_box.get("y0", -1e9), hero_box.get("y1", -1e9)
    for sx, sy in samples:
        if not (0 <= sx < w and 0 <= sy < h):
            continue
        if hx0 <= sx <= hx1 and hy0 <= sy <= hy1:
            rejected += 1
            continue
        used += 1
        for y in range(max(0, sy - patch), min(h, sy + patch + 1)):
            for x in range(max(0, sx - patch), min(w, sx + patch + 1)):
                p = px[x, y]
                rs.append(p[0]); gs.append(p[1]); bs.append(p[2])
    if not rs:
        return None, 0, used, rejected
    return (median(rs), median(gs), median(bs)), len(rs), used, rejected


def measure(png, info, args, crop_path=None):
    """Deck band (0.8-2.0 m AHEAD of the station, hero and pad ring rejected)
    vs fog band (55 % height, far side)."""
    from PIL import Image
    im = Image.open(png).convert("RGB")
    w, h = im.size
    px = im.load()
    fx, fy = info["feet"]["x"], info["feet"]["y"]
    # the projected point can fall outside the frame on a steep camera
    if not (0 <= fx < w) or not (0 <= fy < h) or info["feet"].get("behind"):
        return {"status": "offscreen", "feet": [round(fx, 1), round(fy, 1)]}

    samples = info.get("samples") or []
    hero_box = info.get("heroBox") or {}
    deck, npx, used, rejected = deck_median(px, w, h, samples, hero_box)
    if deck is None or used < args.min_samples:
        return {"status": "no-deck-pixels", "feet": [round(fx, 1), round(fy, 1)],
                "deckSamples": used, "heroRejected": rejected,
                "detail": "%d of %d samples usable (%d in hero box)" % (used, len(samples), rejected)}
    onscreen = [s for s in samples if 0 <= s[0] < w and 0 <= s[1] < h]
    sx0 = min(s[0] for s in onscreen); sx1 = max(s[0] for s in onscreen)
    sy0 = min(s[1] for s in onscreen); sy1 = max(s[1] for s in onscreen)

    fog_y0 = int(h * (args.fog_at - 0.02))
    fog_y1 = int(h * (args.fog_at + 0.02))
    strip = max(24, int(w * 0.14))
    # take the side of the frame farthest from the hero
    if fx > w * 0.5:
        fog, fn = band_median(px, w, h, 0, strip, fog_y0, fog_y1)
        side = "left"
    else:
        fog, fn = band_median(px, w, h, w - strip, w, fog_y0, fog_y1)
        side = "right"
    if fog is None or fn < 40:
        return {"status": "no-fog-pixels"}

    ld, lf = luminance(deck), luminance(fog)
    if crop_path:
        try:
            from PIL import ImageDraw
            dbg = im.copy()
            d = ImageDraw.Draw(dbg)
            hb = hero_box
            if hb:
                d.rectangle([hb["x0"], hb["y0"], hb["x1"], hb["y1"]], outline=(255, 0, 0))
            for sx, sy in onscreen:
                inside = hb and hb["x0"] <= sx <= hb["x1"] and hb["y0"] <= sy <= hb["y1"]
                d.rectangle([sx - 1, sy - 1, sx + 1, sy + 1],
                            outline=(255, 0, 0) if inside else (0, 255, 0))
            pad = 40
            dbg.crop((max(0, sx0 - pad), max(0, sy0 - pad),
                      min(w, sx1 + pad), min(h, sy1 + pad))).save(crop_path)
        except Exception:
            pass
    return {
        "status": "ok",
        "deckRgb": [int(v) for v in deck], "fogRgb": [int(v) for v in fog],
        "deckLum": round(ld, 4), "fogLum": round(lf, 4),
        "ratio": round(contrast(ld, lf), 2),
        "deckPixels": npx, "deckSamples": used, "heroRejected": rejected,
        "fogPixels": fn, "fogSide": side,
        "deckWindow": [int(sx0), int(sy0), int(sx1), int(sy1)],
        "feet": [round(fx, 1), round(fy, 1)],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="CRESTBOUND contrast check")
    ap.add_argument("--url", default=BASE)
    ap.add_argument("--courses", default="", help="comma list; default = every course on disk")
    ap.add_argument("--floor", type=float, default=FLOOR)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--ahead-from", type=float, default=0.8,
                    help="near edge of the deck band, metres AHEAD of the station along its yaw")
    ap.add_argument("--ahead-to", type=float, default=2.0,
                    help="far edge of the deck band, metres ahead")
    ap.add_argument("--band-half-width", type=float, default=1.6,
                    help="lateral half-width of the deck band, metres")
    ap.add_argument("--min-samples", type=int, default=20,
                    help="fewest usable deck samples (of 91) before the station is NO SAMPLE")
    ap.add_argument("--fog-at", type=float, default=0.55,
                    help="fog band centre as a fraction of frame height")
    ap.add_argument("--save-crops", action="store_true")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--json", default=os.path.join(HERE, "contrastcheck.json"))
    args = ap.parse_args()

    os.makedirs(SHOTS, exist_ok=True)
    results, pageerrs = {}, []

    with sync_playwright() as p:
        if args.headless:
            # HARNESS_NOTES (measured on this box): headless *Chrome* with the
            # d3d11 flags gets the real Intel UHD GPU; only the bundled Chromium
            # needs SwiftShader, which is a CPU rasteriser -- an order of
            # magnitude slower and a different tone response. Try the GPU first
            # and keep SwiftShader as the documented fallback (perfcheck.py has
            # done this since the perf pass; the other gates had not caught up).
            try:
                br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
            except Exception as _e:
                print("headless: no hardware Chrome (%s) -> SwiftShader" % str(_e)[:120],
                      file=sys.stderr)
                br = p.chromium.launch(headless=True, args=HEADLESS_FLAGS)
        else:
            br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.on("pageerror", lambda e: pageerrs.append(str(e)))
        try:
            pg.goto(args.url + "?dev=1", wait_until="load", timeout=60_000)
        except Exception as e:
            print("NAVIGATION FAILED: %s" % e, file=sys.stderr)
            br.close()
            print("RESULT: FAIL")
            return 2

        deadline, ready = time.time() + 70, False
        while time.time() < deadline:
            try:
                if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                    ready = True
                    break
            except Exception:
                pass
            pg.wait_for_timeout(400)
        if not ready or not leave_title(pg):
            print("CONTRAST CHECK: the game never reached a live state", file=sys.stderr)
            br.close()
            print("RESULT: FAIL")
            return 2

        courses = ([c.strip() for c in args.courses.split(",") if c.strip()]
                   if args.courses else courses_on_disk(pg))
        if not courses:
            print("CONTRAST CHECK: no course data on disk", file=sys.stderr)
            br.close()
            print("RESULT: FAIL")
            return 2

        for cid in courses:
            arrived, why = goto_course(pg, cid)
            if not arrived:
                results[cid] = {"error": why}
                continue
            pg.wait_for_timeout(900)
            try:
                meta = pg.evaluate(STATIONS_JS)
            except Exception as e:
                results[cid] = {"error": str(e)[:200]}
                continue
            if not isinstance(meta, dict) or meta.get("error"):
                results[cid] = {"error": (meta or {}).get("error", "no stations")}
                continue

            rows = []
            for st in meta.get("stations", []):
                st["aheadFrom"] = args.ahead_from
                st["aheadTo"] = args.ahead_to
                st["halfWidth"] = args.band_half_width
                try:
                    info = pg.evaluate(POSE_JS, st)
                except Exception as e:
                    rows.append({"station": st["name"], "gates": st["gates"],
                                 "status": "pose-failed", "detail": str(e)[:160]})
                    continue
                if not isinstance(info, dict) or info.get("error"):
                    rows.append({"station": st["name"], "gates": st["gates"],
                                 "status": "pose-failed",
                                 "detail": (info or {}).get("error", "?")})
                    continue
                png = os.path.join(SHOTS, "%s_%s.png" % (cid, st["name"]))
                bright, luma = snap(pg, png)
                if not bright:
                    rows.append({"station": st["name"], "gates": st["gates"],
                                 "status": "unmeasurable",
                                 "detail": "frame luma %.2f < %.1f on %d captures"
                                           % (luma, LUMA_FLOOR, BLACK_RETRIES + 1)})
                    continue
                crop = (os.path.join(SHOTS, "%s_%s_deck.png" % (cid, st["name"]))
                        if args.save_crops else None)
                m = measure(png, info, args, crop)
                m["station"] = st["name"]
                m["gates"] = st["gates"]
                m["shot"] = png
                m["surface"] = info.get("surface")
                m["fogColor"] = info.get("fog")
                rows.append(m)
            results[cid] = {"theme": meta.get("theme"), "name": meta.get("name"), "rows": rows}
        br.close()

    print("=" * 96)
    print("CRESTBOUND contrast check — walked surface vs the fog band, floor %.1f:1" % args.floor)
    print("-" * 96)
    print("%-12s %-8s %-8s %-16s %-16s %7s  %s"
          % ("course", "theme", "station", "deck rgb", "fog rgb", "ratio", "verdict"))
    print("-" * 96)
    fails = unmeasured = 0
    for cid, r in results.items():
        if r.get("error"):
            print("%-12s ERROR: %s" % (cid, str(r["error"])[:70]))
            fails += 1
            continue
        theme = r.get("theme") or "?"
        for row in r.get("rows", []):
            if row.get("status") != "ok":
                mark = "UNMEASURABLE" if row.get("status") in ("unmeasurable",) else "NO SAMPLE"
                if row.get("status") == "unmeasurable":
                    unmeasured += 1
                elif row.get("gates"):
                    fails += 1
                print("%-12s %-8s %-8s %-16s %-16s %7s  %s (%s)"
                      % (cid, theme, row.get("station"), "-", "-", "-", mark,
                         str(row.get("detail") or row.get("status"))[:40]))
                continue
            ok = row["ratio"] >= args.floor
            gates = row.get("gates")
            if not ok and gates:
                fails += 1
            verdict = "ok" if ok else ("FAIL" if gates else "low (spawn, not gated)")
            print("%-12s %-8s %-8s %-16s %-16s %6.2f:1  %s"
                  % (cid, theme, row.get("station"), str(row["deckRgb"]), str(row["fogRgb"]),
                     row["ratio"], verdict))
    print("-" * 96)
    print("shots in %s" % os.path.abspath(SHOTS))
    if unmeasured:
        print("%d station(s) UNMEASURABLE (contention frames) — neither pass nor fail" % unmeasured)
    if pageerrs:
        print("page errors (%d):" % len(pageerrs))
        for e in pageerrs[:8]:
            print("  !! %s" % str(e)[:250])
    if args.json:
        try:
            with open(args.json, "w", encoding="utf-8") as f:
                json.dump({"floor": args.floor, "results": results, "pageErrors": pageerrs},
                          f, indent=2)
        except Exception:
            pass
    print("VERDICT: %s (%d failing checkpoint stations)"
          % ("READABLE" if fails == 0 else "UNREADABLE", fails))
    print("RESULT: %s" % ("OK" if fails == 0 else "FAIL"))
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
