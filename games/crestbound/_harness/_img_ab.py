#!/usr/bin/env python
"""IMAGE LANE A/B — the same station, the same frame, PresentPass variants.

Boots one course at a pinned quality tier (default `low`, the auto tier on the
reference Intel UHD — HARNESS_NOTES), teleports to a station, FREEZES the
engine (`engine.stop()` + one hand-stepped `game.update`) so every variant is
the SAME frame, then for each variant sets the PresentPass mode / RCAS
strength, renders once through `engine.post.render(0)` and screenshots the
native canvas.  Writes `<out>_<variant>.png` plus a 2x nearest-neighbour crop
of a centre window (`<out>_<variant>_crop.png`) so a 1.67x upscale's edge
quality can be READ rather than argued about.

    python _img_ab.py --course keep --station spawn --out ../_shots/imgab_keep
    python _img_ab.py --course verdant-1 --station cp3 --variants plain,sharp

Variants: plain (one bilinear tap = the old compositor stretch), nosharp
(Catmull-Rom only), sharp (Catmull-Rom + RCAS at the engine's own strength),
sN (RCAS at strength N/100, e.g. s40).
"""
import argparse
import json
import os
import sys

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "http://localhost:8788/games/crestbound/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
STATE_JS = "globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state"
CLICK_JS = r"""() => { const words=['CONTINUE','NEW GAME','NEW RUN','PLAY','START','BEGIN','ENTER'];
  for (const w of words) for (const b of document.querySelectorAll('button')) {
    const r=b.getBoundingClientRect(); if(b.disabled||r.width<4) continue;
    if((b.textContent||'').toUpperCase().indexOf(w)<0) continue;
    if(b.__activate) b.__activate(); else b.click(); return w; } return null; }"""
LOAD_JS = r"""async (id) => { const G=CRESTBOUND.game; const t0=performance.now();
  const live=()=>G.course&&G.courseId===id&&(G.state==='playing'||G.state==='keep');
  await G.__dev.goto(id);
  const tick=()=>new Promise(r=>{let d=false;const f=()=>{if(!d){d=true;r();}};
    requestAnimationFrame(f);setTimeout(f,60);});
  while(performance.now()<t0+40000&&!live()) await tick(); return live(); }"""
STATION_JS = r"""(name)=>{const A=CRESTBOUND,G=A.game,C=G.course,THREE=A.THREE;
  const posOf=o=>{if(!o)return null;if(typeof o.x==='number')return o;
    if(o.pos)return posOf(o.pos);
    if(o.p)return Array.isArray(o.p)?{x:o.p[0],y:o.p[1],z:o.p[2]}:posOf(o.p);
    if(o.position)return posOf(o.position);return null;};
  let p = null;
  if (name==='spawn') p = posOf((C.spawnFor?C.spawnFor(0):{}).pos);
  else if (/^cp/.test(name)) p = posOf((C.checkpoints||[])[parseInt(name.replace(/\D/g,''),10)-1]);
  else if (C.def && C.def.stations && C.def.stations[name]) p = posOf(C.def.stations[name]);
  else if (C.stations && C.stations[name]) p = posOf(C.stations[name]);
  else if (/^vista-(sw|se|ne|nw)$/.test(name) && C.bounds) {
    /* same construction as shots.py's VISTA stations: a corner of the course
       bounds ~25-120 m out, looking at the bounds centre; the camera is
       parked there directly (the hero stays where it is). */
    const bb = C.bounds, tag = name.slice(6);
    const cx=(bb.min.x+bb.max.x)*0.5, cy=(bb.min.y+bb.max.y)*0.5, cz=(bb.min.z+bb.max.z)*0.5;
    const ex=Math.max(6,(bb.max.x-bb.min.x)*0.5), ez=Math.max(6,(bb.max.z-bb.min.z)*0.5);
    const r=Math.min(120,Math.max(25,Math.hypot(ex,ez)*0.85)), up=Math.max(6,(bb.max.y-bb.min.y)*0.42);
    const sx = tag[1]==='e'?1:-1, sz = tag[0]==='n'?1:-1;
    const cam = A.engine.camera;
    const from = new THREE.Vector3(cx+sx*r*0.7071, cy+up, cz+sz*r*0.7071);
    if (G.cam) G.cam.enabled = false;
    globalThis.__imgab_vista = { from, look: new THREE.Vector3(cx,cy,cz) };
    cam.position.copy(from); cam.lookAt(cx,cy,cz); cam.updateMatrixWorld(true);
    return [from.x, from.y, from.z, 'vista'];
  }
  if(!p) return null;
  const P=G.player; if(P&&P.__test){P.__test.teleport(new THREE.Vector3(p.x,p.y+0.6,p.z));
    P.__test.setVel(new THREE.Vector3(0,0,0));}
  if (G.cam && G.cam.snapToPlayer) G.cam.snapToPlayer();
  return [p.x,p.y,p.z];}"""
HIDE_HUD_JS = r"""() => { for (const el of document.querySelectorAll('.dev-panel, #dev, .devhud, [data-dev]')) el.style.visibility='hidden'; return true; }"""
FREEZE_JS = r"""async () => {
  const A = CRESTBOUND, E = A.engine, G = A.game;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  /* PIN the tier scale: the dynamic controller steps a headless run down to
     0.45 (measured: renderScale 0.45 at keep/spawn while the tier is 0.60),
     and a frame at 0.45 is one the player at 66 fps never sees. */
  E.renderScaleAuto = false;
  if (E.quality && E.quality.renderScale) E.setRenderScale(E.quality.renderScale);
  for (let i = 0; i < 40; i++) await frame();
  E.stop && E.stop();
  const V = globalThis.__imgab_vista;
  if (V) { /* the game camera ran for 40 frames; park the vista again, now that nothing updates it */
    E.camera.position.copy(V.from); E.camera.lookAt(V.look); E.camera.updateMatrixWorld(true);
    if (E.followShadow) E.followShadow(V.look);
  }
  return { renderScale: E.renderScale, tier: E.quality && E.quality.name, post: E.post.state,
           drawingBuffer: [E.renderer.getContext().drawingBufferWidth, E.renderer.getContext().drawingBufferHeight],
           rt: [E.post.composer.renderTarget1.width, E.post.composer.renderTarget1.height],
           sharpen: E.post.state.sharpen };
}"""
VARIANT_JS = r"""async (v) => {
  const A = CRESTBOUND, E = A.engine, P = E.post;
  const pp = P.presentPass;
  if (!pp) return 'no presentPass';
  const base = globalThis.__imgab_sharp === undefined ? (globalThis.__imgab_sharp = P.state.sharpen) : globalThis.__imgab_sharp;
  if (v === 'plain') { pp.setPlain(true); P.setSharpen(base); }
  else if (v === 'nosharp') { pp.setPlain(false); P.setSharpen(0); }
  else if (v === 'sharp') { pp.setPlain(false); P.setSharpen(base); }
  else if (/^s\d+$/.test(v)) { pp.setPlain(false); P.setSharpen(parseInt(v.slice(1), 10) / 100); }
  else if (v === 'bilin') { pp.setPlain(false); if (pp.setCubic) pp.setCubic(false); P.setSharpen(base); }
  else if (v === 'cubic') { pp.setPlain(false); if (pp.setCubic) pp.setCubic(true); P.setSharpen(base); }
  else if (v === 'nobloom' || v === 'nofog' || v === 'nofogbloom' || v === 'restore') {
    /* attribution probes: which stage makes a frame white */
    const S = E.scene;
    if (globalThis.__imgab_fog === undefined) globalThis.__imgab_fog = S.fog;
    if (P.bloomPass) P.bloomPass.enabled = !(v === 'nobloom' || v === 'nofogbloom');
    S.fog = (v === 'nofog' || v === 'nofogbloom') ? null : globalThis.__imgab_fog;
    pp.setPlain(false); P.setSharpen(base);
  }
  else return 'unknown variant ' + v;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  for (let i = 0; i < 3; i++) { P.render(0); await frame(); }
  return P.state;
}"""


def crop2x(src, dst, box):
    try:
        from PIL import Image
    except ImportError:
        return False
    im = Image.open(src)
    c = im.crop(box)
    c = c.resize((c.width * 2, c.height * 2), Image.NEAREST)
    c.save(dst)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", default="keep")
    ap.add_argument("--station", default="spawn")
    ap.add_argument("--quality", default="low")
    ap.add_argument("--variants", default="plain,nosharp,sharp")
    ap.add_argument("--out", default=os.path.join(HERE, "..", "_shots", "imgab"))
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--crop", default="", help="x0,y0,x1,y1 crop window (default: centre 400x225)")
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    variants = [v.strip() for v in args.variants.split(",") if v.strip()]
    if args.crop:
        box = tuple(int(x) for x in args.crop.split(","))
    else:
        cx, cy = args.width // 2, args.height // 2
        box = (cx - 200, cy - 112, cx + 200, cy + 113)

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=not args.headed, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.goto("%s?dev=1&quality=%s" % (BASE, args.quality), wait_until="load", timeout=60_000)
        for _ in range(150):
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                break
            pg.wait_for_timeout(400)
        for _ in range(80):
            if pg.evaluate(STATE_JS) in ("keep", "playing"):
                break
            pg.evaluate(CLICK_JS)
            pg.wait_for_timeout(400)
        pg.evaluate(LOAD_JS, args.course)
        st = pg.evaluate(STATION_JS, args.station)
        pg.wait_for_timeout(2500)
        info = pg.evaluate(FREEZE_JS)
        print("course %s station %s (%s) tier %s renderScale %s drawingBuffer %s composer rt %s sharpen %s"
              % (args.course, args.station, st, info.get("tier"), info.get("renderScale"),
                 info.get("drawingBuffer"), info.get("rt"), info.get("sharpen")))
        print("post.state:", json.dumps(info.get("post")))
        for v in variants:
            r = pg.evaluate(VARIANT_JS, v)
            path = "%s_%s.png" % (args.out, v)
            pg.screenshot(path=path)
            ok = crop2x(path, "%s_%s_crop.png" % (args.out, v), box)
            print("  %-8s -> %s%s   state: sharpen=%s plain=%s" % (
                v, os.path.relpath(path), " (+crop)" if ok else "",
                (r or {}).get("sharpen") if isinstance(r, dict) else r,
                (r or {}).get("plain") if isinstance(r, dict) else ""))
        br.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
