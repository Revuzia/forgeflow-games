#!/usr/bin/env python
"""CRESTBOUND screenshot battery — the evidence the visual critic judges.

For every course it captures one 1600x900 gameplay-framed shot at every authored
station:

    spawn            the first thing a player ever sees of the course
    cp1..cpN         every checkpoint
    crest-<id>       every crest — the hero is placed AT the crest and the
                     camera pulled to 8 m, so the shot answers "is the goal
                     silhouette unmistakable from a player's distance?"

Files land in `_shots/<course>/<station>.png`, plus `_shots/<course>/_contact.png`
— a labelled contact sheet of that course, which is what a critic actually looks
at first.

    python shots.py                              # every course on disk
    python shots.py --courses verdant-1,ember-2
    python shots.py --headless                   # swiftshader (slow, dimmer AA)
    python shots.py --no-contact

Headed Chrome by default: a hidden pane pauses rAF and the shutter then catches a
half-lit, half-streamed frame (reference_ffg_preview_verification).
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
SHOTS = os.path.join(ROOT, "_shots")
BASE = "http://localhost:8788/games/crestbound/index.html"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=1"]
HEADLESS_FLAGS = [f for f in FLAGS if not f.startswith("--use-angle")] + [
    "--use-gl=angle", "--use-angle=swiftshader"]

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
    if (o.home) return posOf(o.home);
    if (o.p) return Array.isArray(o.p) ? {x:o.p[0], y:o.p[1], z:o.p[2]} : posOf(o.p);
    if (o.spawnAt) return Array.isArray(o.spawnAt) ? {x:o.spawnAt[0], y:o.spawnAt[1], z:o.spawnAt[2]} : posOf(o.spawnAt);
    if (o.position) return posOf(o.position);
    if (Array.isArray(o)) return {x:o[0], y:o[1], z:o[2]};
    return null;
  };
  const out = [];
  const sp = C.spawnFor ? C.spawnFor(0) : null;
  if (sp && sp.pos) out.push({name: 'spawn', kind: 'spawn', p: posOf(sp.pos)});
  (C.checkpoints || []).forEach((c, i) => {
    if (i === 0) return;                                  // [0] IS the spawn
    const p = posOf(c);
    if (p) out.push({name: 'cp' + i, kind: 'checkpoint', p});
  });
  // crests: prefer the LIVE records (a hidden crest knows where it will appear)
  const col = C.collectibles;
  const seen = new Set();
  for (const c of (col && col.crests) || []) {
    const p = posOf(c.home || c);
    const id = c.id || (c.def && c.def.id);
    if (!p || !id || seen.has(id)) continue;
    seen.add(id);
    out.push({name: 'crest-' + id, kind: 'crest', p});
  }
  for (const c of (C.def && C.def.crests) || []) {
    if (!c || seen.has(c.id)) continue;
    const p = posOf(c);
    if (!p) continue;                                     // e.g. a coins crest with no place yet
    seen.add(c.id);
    out.push({name: 'crest-' + c.id, kind: 'crest', p});
  }
  return {stations: out, courseId: G.courseId, theme: G.themeId,
          name: (C.def && C.def.name) || G.courseId};
}
"""

# Place the hero on a station, pull the camera to `dist` metres and settle.
POSE_JS = r"""
async (o) => {
  const A = globalThis.CRESTBOUND, G = A.game, THREE = A.THREE;
  if (!G || !THREE) return {error: 'no game/THREE'};
  const frame = () => new Promise(r => requestAnimationFrame(r));
  let P = G.player;
  const syncP = () => { if (G.player && G.player !== P) P = G.player; return P; };
  syncP();
  if (!P || !P.__test) return {error: 'no player.__test'};
  if (G.state === 'paused') G.resume && G.resume();

  const st = o.st;
  // A crest hangs above its pedestal; standing the hero at the crest's own
  // height and letting gravity settle frames the pedestal AND the crest.
  const lift = st.kind === 'crest' ? 0.2 : 0.5;
  const put = () => {
    P.__test.teleport(new THREE.Vector3(st.p.x, st.p.y + lift, st.p.z));
    P.__test.setVel(new THREE.Vector3(0, 0, 0));
  };
  put();

  const cam = G.cam;
  if (cam) {
    if (Number.isFinite(o.dist)) cam.dist = o.dist;
    if (cam.recenter) cam.recenter();
    if (cam.mode !== 'follow' && 'mode' in cam) cam.mode = 'follow';
  }
  for (let k = 0; k < 55; k++) await frame();

  // Conveyors, slopes and moving decks carry the hero off the station during the
  // settle; a shot taken then is a photo of somewhere else. Re-pin once.
  syncP();
  const drift = Math.hypot(P.pos.x - st.p.x, P.pos.y - (st.p.y + lift), P.pos.z - st.p.z);
  if (drift > 2.5 || P.dead) {
    if (P.dead && G.respawn) { G.respawn(); for (let k = 0; k < 20; k++) await frame(); }
    put();
    if (cam && cam.recenter) cam.recenter();
    for (let k = 0; k < 20; k++) await frame();
  }
  syncP();
  return {ok: true, drift: +drift.toFixed(2), dead: !!P.dead, state: G.state,
          p: [+P.pos.x.toFixed(1), +P.pos.y.toFixed(1), +P.pos.z.toFixed(1)],
          camDist: cam ? +(cam.dist || 0).toFixed(2) : null};
}
"""


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


def contact_sheet(course_dir, shots, title, cols=4, cell=(400, 225)):
    """A labelled grid of a course's shots — the first thing a critic reads."""
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return None
    if not shots:
        return None
    rows = (len(shots) + cols - 1) // cols
    pad, label_h = 8, 18
    W = cols * (cell[0] + pad) + pad
    H = rows * (cell[1] + label_h + pad) + pad + 26
    sheet = Image.new("RGB", (W, H), (16, 16, 22))
    d = ImageDraw.Draw(sheet)
    d.text((pad, 6), title, fill=(235, 235, 240))
    for i, (name, path) in enumerate(shots):
        try:
            im = Image.open(path).convert("RGB").resize(cell)
        except Exception:
            continue
        cx = pad + (i % cols) * (cell[0] + pad)
        cy = 26 + pad + (i // cols) * (cell[1] + label_h + pad)
        sheet.paste(im, (cx, cy))
        d.text((cx + 2, cy + cell[1] + 3), name, fill=(190, 195, 205))
    out = os.path.join(course_dir, "_contact.png")
    sheet.save(out)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="CRESTBOUND screenshot battery")
    ap.add_argument("--url", default=BASE)
    ap.add_argument("--courses", default="", help="comma list; default = every course on disk")
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--dist", type=float, default=8.0, help="camera distance at each station")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--no-contact", action="store_true")
    ap.add_argument("--json", default=os.path.join(HERE, "shots.json"))
    args = ap.parse_args()

    os.makedirs(SHOTS, exist_ok=True)
    taken, report, pageerrs = [], {}, []

    with sync_playwright() as p:
        if args.headless:
            br = p.chromium.launch(headless=True, args=HEADLESS_FLAGS)
        else:
            br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.on("pageerror", lambda e: pageerrs.append(str(e)))
        try:
            pg.goto("%s?dev=1&quality=%s" % (args.url, args.quality),
                    wait_until="load", timeout=60_000)
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
            print("SHOTS: the game never reached a live state", file=sys.stderr)
            br.close()
            print("RESULT: FAIL")
            return 2

        courses = ([c.strip() for c in args.courses.split(",") if c.strip()]
                   if args.courses else courses_on_disk(pg))
        if not courses:
            print("SHOTS: no course data on disk", file=sys.stderr)
            br.close()
            print("RESULT: FAIL")
            return 2

        for cid in courses:
            arrived, why = goto_course(pg, cid)
            if not arrived:
                report[cid] = {"error": why}
                print("%s: %s" % (cid, why))
                continue
            pg.wait_for_timeout(1000)
            try:
                meta = pg.evaluate(STATIONS_JS)
            except Exception as e:
                report[cid] = {"error": str(e)[:200]}
                continue
            if not isinstance(meta, dict) or meta.get("error"):
                report[cid] = {"error": (meta or {}).get("error", "no stations")}
                continue

            cdir = os.path.join(SHOTS, cid)
            os.makedirs(cdir, exist_ok=True)
            rows, sheet_items = [], []
            for st in meta.get("stations", []):
                try:
                    info = pg.evaluate(POSE_JS, {"st": st, "dist": args.dist})
                except Exception as e:
                    rows.append({"station": st["name"], "error": str(e)[:160]})
                    continue
                if not isinstance(info, dict) or info.get("error"):
                    rows.append({"station": st["name"], "error": (info or {}).get("error", "?")})
                    continue
                out = os.path.join(cdir, "%s.png" % st["name"])
                try:
                    pg.screenshot(path=out)
                except Exception as e:
                    rows.append({"station": st["name"], "error": "screenshot: %s" % str(e)[:120]})
                    continue
                taken.append(out)
                sheet_items.append((st["name"], out))
                rows.append({"station": st["name"], "kind": st.get("kind"),
                             "shot": out, "pose": info})
                print("%s[%s] -> %s  drift %s  cam %s"
                      % (cid, st["name"], out, info.get("drift"), info.get("camDist")))
            sheet = None if args.no_contact else contact_sheet(
                cdir, sheet_items, "%s — %s (%s)" % (cid, meta.get("name"), meta.get("theme")))
            report[cid] = {"name": meta.get("name"), "theme": meta.get("theme"),
                           "rows": rows, "contact": sheet}
        br.close()

    print("-" * 78)
    print("%d shots under %s" % (len(taken), os.path.abspath(SHOTS)))
    for cid, r in report.items():
        if r.get("error"):
            print("  %-12s ERROR %s" % (cid, str(r["error"])[:60]))
        else:
            bad = [x for x in r.get("rows", []) if x.get("error")]
            print("  %-12s %d shots%s%s"
                  % (cid, len([x for x in r.get("rows", []) if x.get("shot")]),
                     ("  contact %s" % os.path.basename(r["contact"])) if r.get("contact") else "",
                     ("  (%d failed)" % len(bad)) if bad else ""))
    if pageerrs:
        print("page errors (%d):" % len(pageerrs))
        for e in pageerrs[:8]:
            print("  !! %s" % str(e)[:250])
    if args.json:
        try:
            with open(args.json, "w", encoding="utf-8") as f:
                json.dump({"shots": taken, "courses": report, "pageErrors": pageerrs},
                          f, indent=2)
        except Exception:
            pass
    good = len(taken) > 0 and not any(r.get("error") for r in report.values())
    print("RESULT: %s" % ("OK" if good else "FAIL"))
    return 0 if good else 1


if __name__ == "__main__":
    raise SystemExit(main())
