"""UI / TEXT / BINDINGS / FIXTURES lane — replay of every playtest station this
lane owns, with REAL KeyboardEvents through the shared Play driver.

    python _harness/_play_uitext.py [keep|rime3|rime2|azure3|ember3|all]

Every station prints a PASS/FAIL line with the number it measured and drops
the PNG a human reads. Stations:

  keep    K6 spawn prompt hidden · K5 Fen prompt in range + E talks
          K8 'THE UNDERCROFT' plate between camera and hero (occluder fade)
          K9 courtyard tree: trunk blocks a walk into it, a walk 2 m beside it
          never climbs
  rime3   #2 camp light has a fixture · #4 no coin in a plate's sight band
          #5 death overlay legible · #6 'LEAN WEST' shows its face to cp-westface
  rime2   #1/#6 the spawn board's clauses are whole lines
  azure3  #0 R tilts the camera and nothing restarts; Backspace restarts
          #7 the station board is inside the boot frame
  ember3  #5 the cp-court hint board is inside the frame and reads whole
  lights  every course: every authored {kind:'light'} site got a fixture
          (course._fixtureLog vs def.objects), mount histogram, draws/tris

K5 rule (game.js, interactions pass 2): FEN_PROMPT_R == FEN_TALK_R (3.2 m) -
the prompt appears ONLY inside the interact radius, so 3.5 m must show nothing
and E must do nothing there.
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play, URL

try:
    from PIL import Image
except Exception:
    Image = None

RESULTS = []


def res(ok, what, detail=""):
    line = "%s %s%s" % ("PASS" if ok else "FAIL", what, (" — " + detail) if detail else "")
    print(line, flush=True)
    RESULTS.append({"ok": bool(ok), "what": what, "detail": detail})
    return ok


def course_url(cid):
    return URL + "&course=" + cid


PROMPT_JS = """() => { const el = document.getElementById('cb-prompt');
  return { show: !!(el && el.classList.contains('show')),
           text: el ? (el.querySelector('.cb-prompt-text')||{}).textContent : null,
           sub: el ? (el.querySelector('.cb-prompt-sub')||{}).textContent : null }; }"""

TOASTS_JS = """() => [...document.querySelectorAll('.ch-toast')].map(n => ({
  t1: (n.querySelector('.t1')||{}).textContent, t2: (n.querySelector('.t2')||{}).textContent,
  cls: n.className }))"""

BOARD_NDC_JS = """([x,y,z]) => {
  const G = CRESTBOUND.game, C = G.course, T = CRESTBOUND.THREE;
  let best = null, bd = 1e9;
  for (const g of C.texts) { const d = g.position.distanceTo(new T.Vector3(x,y,z)); if (d < bd) { bd = d; best = g; } }
  if (!best) return null;
  const box = new T.Box3().setFromObject(best);
  if (box.isEmpty()) { /* merged away: rebuild from the placed record */
    for (const gr of (C._textGroups||[])) { if (!gr.placed) continue; const p = gr.placed;
      const d = Math.hypot(p.cx-x, p.cy-y, p.cz-z); if (d < 0.6) {
        const pts = []; for (const sx of [-1,1]) for (const sy of [-1,1]) pts.push(new T.Vector3(p.cx + p.ux*p.hw*sx, p.cy + p.hh*sy, p.cz + p.uz*p.hw*sx));
        box.setFromPoints(pts); } } }
  const cam = G.engine.camera; cam.updateMatrixWorld(true);
  const out = []; let allIn = true;
  for (const sx of [0,1]) for (const sy of [0,1]) for (const sz of [0,1]) {
    const v = new T.Vector3(sx?box.max.x:box.min.x, sy?box.max.y:box.min.y, sz?box.max.z:box.min.z).project(cam);
    out.push([+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]);
    if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1 || v.z > 1) allIn = false; }
  return { dist: +bd.toFixed(2), corners: out, allIn, center: [best.position.x, best.position.y, best.position.z] }; }"""

LINES_JS = """(needle) => { const C = CRESTBOUND.game.course; const objs = C.def.objects; const out = [];
  for (let i = 0; i < objs.length; i++) { const o = objs[i]; if (!o || o.kind !== 'text') continue;
    if (String(o.text).indexOf(needle) === -1) continue;
    const g = C._textGroupOf && C._textGroupOf.get(i); const head = g ? g.head === i : false;
    out.push({ i, head, lines: C._textLines(o, head).map(L => L.text) }); }
  return out; }"""

COIN_BAND_JS = """() => { const C = CRESTBOUND.game.course; const col = C.collectibles; const out = [];
  const home = col._cHome, n = col._coinAuthored;
  for (const g of (C._textGroups||[])) { const B = g.placed; if (!B) continue;
    for (let i = 0; i < n; i++) { const x = home[i*3], y = home[i*3+1], z = home[i*3+2];
      const dx = x-B.cx, dy = y-B.cy, dz = z-B.cz; const front = dx*B.nx + dz*B.nz;
      if (front < 0.05 || front > 3.0) continue;
      if (Math.abs(dx*B.ux + dz*B.uz) > B.hw + 0.15) continue;
      if (Math.abs(dy) > B.hh + 0.25) continue;
      out.push({ board: [+B.cx.toFixed(1), +B.cy.toFixed(1), +B.cz.toFixed(1)], coin: [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)], front: +front.toFixed(2) }); } }
  return { authored: n, inBand: out }; }"""


def pixel_stats(png, box, pred):
    """Fraction of pixels in box (x0,y0,x1,y1) satisfying pred(r,g,b)."""
    if Image is None:
        return None
    im = Image.open(png).convert("RGB")
    x0, y0, x1, y1 = box
    n = 0; hit = 0
    for y in range(y0, y1, 2):
        for x in range(x0, x1, 2):
            r, g, b = im.getpixel((x, y))
            n += 1
            if pred(r, g, b):
                hit += 1
    return hit / max(1, n)


HEROBOX_JS = """() => {
  const G = CRESTBOUND.game, T = CRESTBOUND.THREE, E = G.engine;
  const cam = E.camera; cam.updateMatrixWorld(true);
  const p = G.player, r = p.radius || 0.38, h = p.height || 1.5;
  const W = E.renderer.domElement.clientWidth, H = E.renderer.domElement.clientHeight;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, any = false;
  const v = new T.Vector3();
  for (const dx of [-r, r]) for (const dz of [-r, r]) for (const dy of [0.02, h * 0.5, h]) {
    v.set(p.pos.x + dx, p.pos.y + dy, p.pos.z + dz).project(cam);
    if (v.z > 1) continue;
    any = true;
    const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
    if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
  }
  if (!any) return null;
  return [Math.max(0, Math.round(x0)), Math.max(0, Math.round(y0)),
          Math.min(W, Math.round(x1)), Math.min(H, Math.round(y1))]; }"""

# Every HUD chip that is actually painting, as a screen rectangle.
HUDRECTS_JS = """() => {
  const out = [];
  for (const s of ['.ch-power', '.ch-toast']) for (const n of document.querySelectorAll(s)) {
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) continue;
    const b = n.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) continue;
    out.push({ cls: n.className, r: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] });
  }
  return out; }"""


def hero_window(P):
    """The hero's OWN on-screen box, padded - the window a visibility test reads.

    The pass-1 stations counted suit pixels in a FIXED centre rectangle
    (560,300)-(720,560). When the camera lane's work changed how a standing
    hero is framed, azure-3 #6 measured 0.0150 against a > 0.0150 threshold and
    failed a frame in which Nim is plainly visible (_shots/play_uitext_azure3/
    03_a3_06_boarding_line_north.png). A driver whose verdict moves with
    someone else's framing is not a gate.
    """
    b = P.js(HEROBOX_JS)
    if not b:
        return (560, 300, 720, 560)
    x0, y0, x1, y1 = b
    px = max(6, int((x1 - x0) * 0.12))
    py = max(6, int((y1 - y0) * 0.06))
    return (max(0, x0 - px), max(0, y0 - py), min(1280, x1 + px), min(720, y1 + py))


def overlap_frac(a, b):
    """Fraction of box a covered by box b (both [x0,y0,x1,y1])."""
    w = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    h = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    area = max(1, (a[2] - a[0]) * (a[3] - a[1]))
    return w * h / area


# ── IS ANY TEXT PLATE BURIED IN THE MASONRY IT HANGS ON? ────────────────────
# playtest verdant-2 #28a: "the wall-kick instruction sign is half-buried in the
# turret's stone pillar - the left third of the board is inside the masonry, so
# from the checkpoint it reads '...E WALL / ...E OTHER'". signcheck.mjs is
# static: it knows where a board is, not what stands in front of it. This asks
# the LIVE course. For a grid of points over the lettering it raycasts the
# VISIBLE geometry from 0.8 m in front of each point back at it; a sample is
# covered when the first opaque mesh in the way is not the sign itself.
BURIED_JS = r"""() => {
  const C = CRESTBOUND.game.course, T = CRESTBOUND.THREE;
  const ray = new T.Raycaster(); ray.far = 60;
  const eye = new T.Vector3(), pt = new T.Vector3(), dir = new T.Vector3();
  /* SHORT BASELINE. A reader's-eye ray from 4 m out answers a different
     question — what is in the ROOM between that point and the board — and the
     answer depends entirely on where you stand: it called the Keep's 'RIME
     SPIRE' 33 % buried from a point inside the gallery slab, while the frame
     (01_buried_keep_301.png) shows the words whole. The defect this gate is
     for is masonry planted ON the lettering (verdant-2 #28a "the left third of
     the board is inside the pillar"; the quay board that the raised causeway
     stair now stands in). So the ray starts 0.8 m in FRONT of each sample and
     comes back at it: anything opaque it meets first, that is not the sign
     itself, is standing on the words from every vantage. */
  const NX = 9, NY = 3, EYE = 0.8;
  const SIGN = /signatlas|\.sign|sign$/i;
  /* OPAQUE WORLD GEOMETRY ONLY.
     - a Sprite raycasts against a camera this probe does not have, and
       Points/Lines never hide a word;
     - a transparent mesh (the checkpoint beacon's rings, a glow shell, water)
       is not an occluder: the first run counted the cp-hall beacon 1.5 m in
       front of the parked eye and called the Keep's own 'THE KEEP / EVERY
       PAINTING IS A DOOR' board 55.6 % buried while the frame shows it whole;
     - collectibles and critters move; a board is judged against the building. */
  const SKIP = /checkpoint|collectible|coin|sigil|crest|critter|particle|fx|beacon|glow|ring/i;
  const meshes = [];
  C.group.updateMatrixWorld(true);
  C.group.traverse(o => {
    /* NOT `o.visible`. Static chunks are culled by distance from the HERO, and
       far-LOD stand-ins swap with them, so a run that sampled while the hero
       stood elsewhere saw a different world: rime-2's 'THE TOP OF THE RIME
       SPIRE' read 0 % in one run and 33.3 % in the next with nothing between
       them but where the hero had drifted. A board is judged against the
       geometry that exists, which is what a reader standing at it would see. */
    if (!o.isMesh || !o.geometry) return;
    if ((o.name || '').indexOf('.far') !== -1) return;      // the distant LOD's stand-in
    if (o.parent && (o.parent.name || '').indexOf('.far') !== -1) return;
    for (let a = o; a; a = a.parent) if (a.name && SKIP.test(a.name)) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.transparent === true || (m.opacity !== undefined && m.opacity < 0.99)) return;
    if (m.depthWrite === false) return;
    meshes.push(o);
  });
  const sph = new T.Vector3();
  const rows = [];
  for (const g of (C._textGroups || [])) {
    const B = g.placed; if (!B) continue;
    let n = 0, cov = 0; const who = {}; let uMin = 99, uMax = -99, dMax = 0;
    for (let ix = 0; ix < NX; ix++) for (let iy = 0; iy < NY; iy++) {
      /* the LETTERING, not the plate's outer edge: a cornice or a sill that
         grazes the last centimetre of the frame is not a covered word. */
      const u = (ix / (NX - 1) - 0.5) * 2 * (B.hw * 0.85);
      const v = (iy / (NY - 1) - 0.5) * 2 * (B.hh * 0.55);
      pt.set(B.cx + B.ux * u + B.nx * 0.05, B.cy + v, B.cz + B.uz * u + B.nz * 0.05);
      eye.set(pt.x + B.nx * EYE, pt.y, pt.z + B.nz * EYE);
      dir.set(-B.nx, 0, -B.nz);
      ray.set(eye, dir); ray.far = EYE;
      const hit = ray.intersectObjects(meshes, false);
      n++;
      for (const h of hit) {
        if (SIGN.test(h.object.name || '')) break;        // the plate itself: clear
        if (h.distance < EYE - 0.06) { cov++; const nm = h.object.name || h.object.type; who[nm] = (who[nm] || 0) + 1;
          if (u < uMin) uMin = u; if (u > uMax) uMax = u;
          const depth = (EYE - h.distance); if (depth > dMax) dMax = depth; }
        break;
      }
    }
    rows.push({ i: g.head !== undefined ? g.head : -1,
                text: String((g.def && g.def.text) || (C.def.objects[g.head] || {}).text || '').slice(0, 42),
                p: [+B.cx.toFixed(1), +B.cy.toFixed(1), +B.cz.toFixed(1)],
                w: +(B.hw * 2).toFixed(2), buried: +(cov / Math.max(1, n)).toFixed(3), by: who,
                uSpan: cov ? [+uMin.toFixed(2), +uMax.toFixed(2)] : null, depth: +dMax.toFixed(2),
                n: [+B.nx.toFixed(2), +B.nz.toFixed(2)], u: [+B.ux.toFixed(2), +B.uz.toFixed(2)] });
  }
  return rows;
}"""


def park(P, eye, look, ms=700):
    """Park the camera at `eye` looking at `look` and hold it there.

    A reader's-eye frame cannot be taken by teleporting the hero: the spot a
    board is read from is often open water, a 20 m drop or a 30-degree snow
    slope, and the follow camera then photographs the moat (see
    _shots/play_uitext_rime2/03_r2_00_lantern_post.png, where the hero slid
    away down the mesa before the shutter). `game.cam.setCinematic` takes a
    two-key path; give both keys the same pose and it holds. Call `park(P,
    None, None)` to hand the camera back.
    """
    if eye is None:
        P.js("() => { CRESTBOUND.game.cam.setCinematic(null); return 1; }")
        return
    P.js("""([e, l]) => { CRESTBOUND.game.cam.setCinematic(
            [{ p: e, look: l, t: 0 }, { p: e, look: l, t: 30 }]); return 1; }""",
         [list(eye), list(look)])
    P.wait(ms)


def is_nim(r, g, b):      # the red/orange suit (lit or in shade)
    return r > 135 and g < 140 and b < 125 and r - g > 45 and r - b > 55


def is_cream(r, g, b):    # a sign plate
    return r > 200 and g > 185 and b > 140 and r - b < 90


# =============================================================================
def station_keep():
    with Play("uitext_keep") as P:
        P.click_title(); P.wait(2500)
        st = P.state(); P.say("keep boot:", st["gstate"], st["pos"])
        # K6 — no prompt on the spawn pad
        pr = P.js(PROMPT_JS)
        png = P.shot("K6_spawn")
        res(not pr["show"], "K6 interact prompt hidden on the spawn pad", json.dumps(pr) + " " + png)

        # K5 — Fen: prompt inside range, E talks (1.2 m and 2.0 m); 3.5 m reported
        FEN_DIST_JS = """() => { const G = CRESTBOUND.game, f = G._fen; if (!f) return null;
          const rp = f.ref && f.ref.pos; const pos = (rp && isFinite(rp.x)) ? rp : f.pos; const pp = G.player.pos;
          return { d: +Math.hypot(pp.x - pos.x, pp.z - pos.z).toFixed(2), fen: [+pos.x.toFixed(2), +pos.y.toFixed(2), +pos.z.toFixed(2)] }; }"""
        for d in (1.2, 2.0, 5.0):
            P.tp(17.0 + d, 6.35, -21.0); P.wait(700); P.face(17.0, -21.0); P.wait(500)
            pr = P.js(PROMPT_JS)
            fd = P.js(FEN_DIST_JS)
            # WHAT WAS MEASURED, NOT WHAT WAS ASKED FOR. The out-of-range case
            # used to teleport to 3.5 m and judge the prompt there; the hero
            # settles toward Fen's nook and the run before this one read
            # d = 2.62 m - INSIDE the 3.2 m talk radius - so a correct prompt
            # was reported as a defect. The case is judged on `measured`, and
            # skipped (not failed) when the placement lands in neither band.
            measured = (fd or {}).get("d")
            before = len(P.js(TOASTS_JS))
            P.tap("E", 90); P.wait(500)
            toasts = P.js(TOASTS_JS)
            talked = any((t.get("t1") or "").upper().find("FEN") >= 0 for t in toasts[before:]) or len(toasts) > before
            png = P.shot("K5_fen_%sm" % str(d).replace(".", "_"))
            if measured is not None and measured <= 3.0:
                res(pr["show"] and talked, "K5 Fen at %.2f m (asked %.1f): prompt shown and E talks" % (measured, d),
                    "prompt=%s toasts=%s %s" % (json.dumps(pr), json.dumps(toasts[-1:]), png))
            elif measured is not None and measured > 3.4:
                # prompt radius == talk radius (3.2 m): outside it NOTHING shows and E does nothing
                res((not pr["show"]) and (not talked), "K5 Fen at %.2f m (asked %.1f): no prompt outside the interact radius, E silent" % (measured, d),
                    "prompt=%s talked=%s %s" % (json.dumps(pr), talked, png))
            else:
                P.say("  K5 skipped: hero settled at %s m, neither clearly in nor clearly out" % measured)
            P.wait(1200)
        P.tp(0, 0.1, -1.0); P.wait(600)
        pr = P.js(PROMPT_JS)
        res(not pr["show"], "K5 prompt gone again 27 m from Fen", json.dumps(pr))

        # K8 — the undercroft plate between the camera and the hero
        P.tp(-13.5, 0.1, 0.92); P.wait(600); P.face(-13.5, -10.0); P.wait(1400)
        st = P.state()
        win = hero_window(P)
        png = P.shot("K8_grate_facing_north")
        # his own on-screen box, not a fixed rectangle (see hero_window)
        nim = pixel_stats(png, win, is_nim)
        cream = pixel_stats(png, (400, 250, 880, 520), is_cream)
        P.say("  K8 camDist %s nim-pixels %s cream-pixels %s" % (st["camDist"], nim, cream))
        res(nim is not None and nim > 0.015, "K8 Nim visible through the UNDERCROFT plate on the grate",
            "suit pixels %.3f of the centre window (plate cream %.3f) %s" % (nim or -1, cream or -1, png))

        # K9 — trees: 2.2 m beside the trunk first (a fresh, un-captured hero), then into it
        P.tp(-10.8, 0.3, 25.5); P.wait(600)
        climbed = False
        P.face(-10.8, 15.0); P.down("W")
        for i in range(24):
            P.wait(180)
            s = P.state()
            if s["climbing"]:
                climbed = True
        P.up("W"); P.wait(200)
        s = P.state()
        png = P.shot("K9_walk_beside_tree")
        res((not climbed) and s["pos"][2] < 18.0, "K9 a walk 2.2 m beside the trunk passes it without climbing",
            "climbed=%s ended %s %s" % (climbed, s["pos"], png))
        P.tp(-13.0, 0.3, 25.5); P.wait(600)
        r1 = P.walk_to(-13.0, 15.0, tol=0.8, max_ms=5000, tag="into the trunk")
        blocked = r1["end"][2] > 19.2
        res(blocked, "K9 walking into the courtyard trunk is stopped by it (bonk or climb)",
            "ended %s state %s (trunk at z 20)" % (r1["end"], r1["state"]["pstate"]))
        P.say("console:", P.console[:6])
        res(not [c for c in P.console if 'error' in c.lower()], "keep: no console errors (sign shader compiled)", str(P.console[:3]))


def station_rime3():
    with Play("uitext_rime3", url=course_url("rime-3")) as P:
        P.wait(2500)
        st = P.state(); P.say("rime-3 boot:", st["gstate"], st["pos"])
        log = P.js("() => CRESTBOUND.game.course._fixtureLog")
        P.say("  fixtures:", json.dumps(log))
        camp = [f for f in log if abs(f["p"][0]) < 0.5 and abs(f["p"][2] - 43.4) < 0.5]
        res(bool(camp) and camp[0]["mount"] in ("post", "lantern", "wall", "hang") and camp[0]["mount"] != "lantern",
            "#2 the camp light has a mount", json.dumps(camp))
        P.face(0.0, 40.0); P.wait(700)
        png = P.shot("r3_02_camp_light_from_spawn")
        P.tp(-2.5, 2.2, 47.0); P.wait(500); P.face(0.0, 43.4); P.wait(700)
        png2 = P.shot("r3_02_camp_light_close")
        P.say("  read", png, png2)

        band = P.js(COIN_BAND_JS)
        res(band["inBand"] == [], "#4 no coin sits in any plate's sight band (%d authored coins)" % band["authored"], json.dumps(band["inBand"])[:300])
        P.tp(3.0, 2.2, 45.5); P.wait(500); P.face(6.0, 42.0); P.wait(700)
        png = P.shot("r3_04_fourteen_rings_board")

        # #6 LEAN WEST from cp-westface
        P.tp(-25.2, 3.5, 32.0); P.wait(700); P.face(-28.6, 30.6); P.wait(900)
        png = P.shot("r3_06_leanwest_from_cp")
        cream = pixel_stats(png, (440, 200, 840, 480), is_cream)
        res(cream is not None and cream > 0.06, "#6 'LEAN WEST' shows its plate face to cp-westface",
            "cream pixels %.3f in the centre window %s" % (cream or -1, png))

        # #5 death overlay: fall into the gorge; read the word the instant the state is dead
        WORD = """() => { const w = document.querySelector('.ch-word'); if (!w) return null;
            const cs = getComputedStyle(w); return { text: w.textContent, on: w.classList.contains('is-on'),
              death: w.classList.contains('is-death'), bg: cs.backgroundColor, color: cs.color, opacity: cs.opacity }; }"""
        P.tp(-35.6, -20.0, -10.4)
        dead_at = None; word0 = None
        for i in range(80):
            P.wait(50)
            s = P.state()
            if s["gstate"] == "dead" or s["pstate"] == "dead":
                dead_at = time.time(); word0 = P.js(WORD); break
        shots = []
        words = [word0]
        if dead_at:
            shots.append(P.shot("r3_05_death_000"))
            words.append(P.js(WORD))
            P.wait(120); shots.append(P.shot("r3_05_death_120")); words.append(P.js(WORD))
            P.wait(250); shots.append(P.shot("r3_05_death_370"))
        P.say("  death words:", json.dumps(words), "shots", shots)
        good = [w for w in words if w and w["death"] and w["on"] and w["text"].strip().upper().startswith("FELL")]
        res(bool(dead_at) and bool(good), "#5 death cause 'FELL' drawn on its dark plate while dead",
            json.dumps(good[:1]) + " " + (shots[1] if len(shots) > 1 else ""))
        P.wait(1500)
        res(not [c for c in P.console if 'error' in c.lower()], "rime-3: no console errors", str(P.console[:3]))


def station_rime2():
    with Play("uitext_rime2", url=course_url("rime-2")) as P:
        P.wait(2500)
        st = P.state(); P.say("rime-2 boot:", st["gstate"], st["pos"])
        L = P.js(LINES_JS, "CROUCH AT SPEED") + P.js(LINES_JS, "THE CHUTE ONLY") + P.js(LINES_JS, "HALF WAY")
        P.say("  lines:", json.dumps(L))
        want = {
            "CROUCH AT SPEED TO TUCK": ["CROUCH AT SPEED TO TUCK", "THE ICE KEEPS THE REST"],
            "THE CHUTE ONLY GOES DOWN.": ["THE CHUTE ONLY GOES DOWN.", "EVERYTHING ELSE GOES UP."],
            "HALF WAY": ["HALF WAY", "THE SECOND HALF IS FASTER"],
        }
        ok = True
        for rec in L:
            for k, v in want.items():
                if rec["lines"] and rec["lines"][0].startswith(k.split()[0]) and k.split()[1] in rec["lines"][0]:
                    if rec["lines"] != v:
                        ok = False; P.say("  MISMATCH", k, rec["lines"])
        res(ok and len(L) >= 3, "#1/#6 spawn + mesa boards: every clause is one whole line", json.dumps([r["lines"] for r in L]))
        P.face(-0.2, -22.6); P.wait(700)
        png = P.shot("r2_01_spawn_board")
        P.tp(0.9, 30.05, -25.2); P.wait(500); P.face(-0.2, -22.6); P.wait(800)
        png2 = P.shot("r2_01_spawn_board_close")
        P.say("  read", png, png2)
        # #0 the BEAT 1 lantern (geometry lane hung it from a post): the light site over it has a fixture
        log = P.js("() => CRESTBOUND.game.course._fixtureLog")
        site = [f for f in log if abs(f["p"][0] + 4.2) < 0.4 and abs(f["p"][2] + 22.6) < 0.4]
        res(bool(site), "#0 BEAT 1 lantern light site got a fixture", json.dumps(site))
        P.tp(-0.6, 30.05, -18.6); P.wait(500); P.face(-4.2, -22.6); P.wait(800)
        png3 = P.shot("r2_00_lantern_post")
        P.say("  read", png3)
        res(not [c for c in P.console if 'error' in c.lower()], "rime-2: no console errors", str(P.console[:3]))


def station_azure3():
    with Play("uitext_azure3", url=course_url("azure-3")) as P:
        P.wait(2500)
        st = P.state(); P.say("azure-3 boot:", st["gstate"], st["pos"])
        png = P.shot("a3_07_boot_frame")
        nd = P.js(BOARD_NDC_JS, [5.2, 33.5, 36.2])
        P.say("  station board ndc:", json.dumps(nd))
        res(nd and nd["allIn"], "#7 PRISM LINE board wholly inside the boot frame", json.dumps(nd)[:300] + " " + png)

        # #0 R orbits, nothing restarts
        before = P.js("() => ({ clock: CRESTBOUND.game.course.clock, pitch: CRESTBOUND.game.cam.pitch, deaths: CRESTBOUND.game.deaths })")
        t_before = len(P.js(TOASTS_JS))
        P.down("R"); P.wait(500); P.up("R"); P.wait(300)
        after = P.js("() => ({ clock: CRESTBOUND.game.course.clock, pitch: CRESTBOUND.game.cam.pitch, deaths: CRESTBOUND.game.deaths })")
        toasts = P.js(TOASTS_JS)[t_before:]
        restarted = any("RESTART" in (t.get("t1") or "").upper() for t in toasts)
        P.say("  R: before %s after %s toasts %s" % (json.dumps(before), json.dumps(after), json.dumps(toasts)))
        png = P.shot("a3_00_after_R")
        res(abs(after["pitch"] - before["pitch"]) > 0.08 and after["clock"] > before["clock"] and not restarted,
            "#0 holding R tilts the camera (pitch moves, view up) and does not restart",
            "pitch %.3f -> %.3f, clock %.2f -> %.2f, restart toast %s" % (before["pitch"], after["pitch"], before["clock"], after["clock"], restarted))
        # Backspace restarts
        t_before = len(P.js(TOASTS_JS))
        P.pg.keyboard.press("Backspace"); P.wait(900)
        toasts = P.js(TOASTS_JS)[t_before:]
        clock = P.js("() => CRESTBOUND.game.course.clock")
        restarted = any("RESTART" in (t.get("t1") or "").upper() for t in toasts)
        res(restarted and clock < after["clock"], "#0 Backspace restarts the course",
            "toasts %s clock %.2f" % (json.dumps(toasts), clock))
        # bindings as loaded
        b = P.js("() => ({ restart: CRESTBOUND.game.input.bindings.restart, orbitUp: CRESTBOUND.game.input.bindings.orbitUp })")
        res(b["restart"] == ["Backspace"] and b["orbitUp"] == ["KeyR"], "#0 live bindings: restart=Backspace, orbitUp=R", json.dumps(b))

        # #6 cart sign off the cart: stand at the boarding line and look north
        P.wait(1500)
        P.tp(-11.0, 30.1, 34.6); P.wait(500); P.face(-11.0, 22.0); P.wait(800)
        win = hero_window(P)
        png = P.shot("a3_06_boarding_line_north")
        nim = pixel_stats(png, win, is_nim)
        res(nim is not None and nim > 0.05, "#6 boarding line: Nim visible, view north clear of the plate",
            "suit pixels %.3f of his own box %s %s" % (nim or -1, win, png))
        res(not [c for c in P.console if 'error' in c.lower()], "azure-3: no console errors", str(P.console[:3]))


def station_ember3():
    with Play("uitext_ember3", url=course_url("ember-3")) as P:
        P.wait(2500)
        st = P.state(); P.say("ember-3 boot:", st["gstate"], st["pos"])
        P.tp(0.0, 6.05, -6.0); P.wait(700); P.face(0.0, -20.0); P.wait(1200)
        png = P.shot("e3_05_cp_court_frame")
        nd = P.js(BOARD_NDC_JS, [2.8, 7.8, -13.5])
        L = P.js(LINES_JS, "WHEN THE LAVA") + P.js(LINES_JS, "falls back")
        P.say("  hint board ndc:", json.dumps(nd), "lines:", json.dumps(L))
        res(nd and nd["allIn"], "#5 'WHEN THE LAVA RISES / PRESS T' board wholly inside the cp-court frame", json.dumps(nd)[:300] + " " + png)
        res(any("PRESS T" in x for r in L for x in r["lines"]) and any("lava" in x for r in L for x in r["lines"]),
            "#5 hint copy names the lava", json.dumps([r["lines"] for r in L]))
        res(not [c for c in P.console if 'error' in c.lower()], "ember-3: no console errors", str(P.console[:3]))


def station_hud():
    """azure-1 #9: "the METAL bar sits across the middle of the screen covering
    Nim from the waist down ... and the CHECKPOINT 1/4 toast lands directly
    under it". The hero's capsule is projected to screen pixels and every
    painting HUD chip's rectangle is read off the page: no chip may cover any
    part of him. Measured before the fix (bottom-centre stack): toast 0.350 of
    his box, power bar 0.112."""
    for cid, tp in (("azure-1", (0.0, 0.9, 12.5)), ("verdant-1", None), ("keep", None)):
        url = URL if cid == "keep" else course_url(cid)
        with Play("uitext_hud", url=url) as P:
            if cid == "keep":
                P.click_title()
            P.wait(2200)
            if tp:
                P.tp(*tp); P.wait(800)
            P.js("() => { CRESTBOUND.game.__dev.power('metal', 20); return 1; }")
            P.js("() => { CRESTBOUND.game.hud.toast('CHECKPOINT', '1 / 4', 'good'); return 1; }")
            P.wait(700)
            hero = P.js(HEROBOX_JS)
            chips = P.js(HUDRECTS_JS)
            worst = 0.0; who = None
            for c in chips:
                f = overlap_frac(hero, c["r"]) if hero else 0.0
                if f > worst: worst = f; who = c
            png = P.shot("%s_hud_over_hero" % cid)
            res(hero is not None and worst < 0.01,
                "%s: no HUD chip stands on the hero (worst %.3f)" % (cid, worst),
                "hero %s chips %s %s" % (hero, json.dumps(chips), png))


def station_boards():
    """No text plate has masonry planted on its lettering (playtest verdant-2
    #28a). Ray test per board — see BURIED_JS above."""
    for cid in COURSES:
        url = URL if cid == 'keep' else course_url(cid)
        with Play("uitext_boards", url=url) as P:
            if cid == 'keep':
                P.click_title()
            P.wait(1600)
            rows = P.js(BURIED_JS)
            bad = [r for r in rows if r["buried"] > 0.15]
            warn = [r for r in rows if 0.06 < r["buried"] <= 0.15]
            res(not bad, "%s: %d boards, none with masonry on the words" % (cid, len(rows)),
                "over 15%%: %s ; grazed 6-15%%: %s"
                % (json.dumps([[r["i"], r["text"], r["buried"]] for r in bad]),
                   json.dumps([[r["i"], r["buried"]] for r in warn])))


def station_shots():
    """Reader's-eye frames for the things this lane moved or mounted, taken with
    a parked camera (see `park`) so the frame is of the board, not of wherever
    the hero fell. Nothing here passes or fails on a pixel count: they are the
    frames a human reads."""
    shots = []
    with Play("uitext_shots", url=course_url("rime-2")) as P:
        P.wait(2000)
        # #0 the BEAT 1 lantern: it hangs on a post now (geometry lane), and the
        # light site over it got a fixture (this lane's rule).
        g = P.js("() => { const C = CRESTBOUND.game.course; return C.terrain && C.terrain.heightfield ? C.terrain.heightfield.heightAt(-4.2, -22.6) : null; }")
        y = (g if g is not None else 30.0)
        park(P, [-1.4, y + 2.6, -20.4], [-4.2, y + 1.9, -22.6])
        shots.append(P.shot("r2_lantern_post_parked"))
        park(P, None, None)
    with Play("uitext_shots", url=course_url("verdant-2")) as P:
        P.wait(2000)
        # the quay briefing pair, moved to the top of the causeway stair
        park(P, [-3.6, 8.6, 32.4], [-6.6, 8.4, 28.2])
        shots.append(P.shot("v2_west_post_board_parked"))
        # the wall-kick board, narrowed by maxW and slid clear of the pillar
        park(P, [-6.6, 20.3, -4.4], [-4.2, 20.2, -5.35])
        shots.append(P.shot("v2_kick_board_parked"))
        park(P, None, None)
    with Play("uitext_shots", url=course_url("verdant-1")) as P:
        P.wait(2000)
        park(P, [-5.3, 10.5, -31.3], [-6.8, 10.4, -29.5])
        shots.append(P.shot("v1_kick_board_parked"))
        park(P, None, None)
    with Play("uitext_shots") as P:
        P.click_title(); P.wait(2000)
        # keep #13: the gallery balcony looking south at the garden loft — the
        # banners that filled this doorway now hang on its jambs (x +-4.3)
        park(P, [0, 7.6, 12.6], [0, 7.0, 26.0])
        shots.append(P.shot("keep_balcony_doorway_parked"))
        park(P, None, None)
    for s in shots:
        print("   read", s, flush=True)
    res(len(shots) == 5, "evidence frames taken (%d)" % len(shots), json.dumps(shots))


COURSES = ['keep', 'verdant-1', 'verdant-2', 'verdant-3', 'ember-1', 'ember-2', 'ember-3', 'ember-4',
           'rime-1', 'rime-2', 'rime-3', 'azure-1', 'azure-2', 'azure-3']

CENSUS_JS = """() => { const C = CRESTBOUND.game.course; const objs = C.def.objects || [];
  let authored = 0, off = 0; const bare = [];
  for (const o of objs) { if (!o || o.kind !== 'light') continue;
    if (o.fixture === false || o.fixture === 'none') off++; else authored++; }
  const hist = {}; for (const f of (C._fixtureLog || [])) { hist[f.mount] = (hist[f.mount] || 0) + 1; if (f.mount === 'lantern') bare.push(f.p.map(v => +v.toFixed(1))); }
  const st = CRESTBOUND.engine.stats || {};
  return { id: C.id, authored, off, sites: C.lights ? C.lights.length : null, fixtures: (C._fixtureLog || []).length,
           hist, cageOnly: bare, draws: st.drawCalls, tris: st.tris }; }"""


def station_lights():
    """Every course: every authored {kind:'light'} that is not fixture:'none'
    must have produced exactly one fixture (bulb + lamp), i.e. no bare ball
    anywhere, not only rime-3's camp light."""
    for cid in COURSES:
        url = URL if cid == 'keep' else course_url(cid)
        with Play("uitext_lights", url=url) as P:
            if cid == 'keep':
                P.click_title()
            P.wait(1500)
            info = P.js(CENSUS_JS)
            # `course.lights` counts every DYNAMIC light SITE - hazards, props and
            # collectibles register their own - so it is not the number of
            # authored {kind:'light'} objects and never was. Asserting the two
            # were equal held only until another lane added a site: on this tree
            # it failed 8 of 14 courses with a fixture on every authored light.
            # What this gate is for is: no authored light is a bare ball.
            res(info["fixtures"] == info["authored"],
                "%s: %d/%d authored lights have a fixture (%s dynamic sites, mounts %s)" % (cid, info["fixtures"], info["authored"], info["sites"], json.dumps(info["hist"])),
                "cage-only sites %s draws %s tris %s" % (json.dumps(info["cageOnly"]), info["draws"], info["tris"]))
            res(not [c for c in P.console if 'error' in c.lower()], "%s: no console errors" % cid, str(P.console[:3]))


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    stations = {"keep": station_keep, "rime3": station_rime3, "rime2": station_rime2,
                "azure3": station_azure3, "ember3": station_ember3, "hud": station_hud,
                "boards": station_boards, "shots": station_shots, "lights": station_lights}
    order = list(stations) if which == "all" else [which]
    for k in order:
        print("\n==== STATION", k, flush=True)
        try:
            stations[k]()
        except Exception as e:
            res(False, "station %s crashed" % k, repr(e))
    fails = [r for r in RESULTS if not r["ok"]]
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_play_uitext%s.json" % ("" if which == "all" else "_" + which))
    with open(out, "w", encoding="utf-8") as f:
        json.dump(RESULTS, f, indent=1)
    print("\nUITEXT REPLAY: %d pass / %d fail -> %s" % (len(RESULTS) - len(fails), len(fails), out))
    sys.exit(1 if fails else 0)
