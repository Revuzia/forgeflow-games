"""GNASHER FORT playtest helpers — a walker that actually walks in-course.

_playlib.walk_to() breaks the moment gstate == 'playing', which is TRUE for the
whole of a course, so it only ever walked 220 ms. These replace it.
"""
import json, math, time


def walk(pl, x, z, tol=1.2, max_ms=14000, keys=("W",), tag="", die_ok=False, sample=200):
    """Hold W with the camera re-aimed at (x,z) every sample. Returns a dict."""
    pl.face(x, z)
    pl.down(*keys)
    t = 0
    prev = pl.pos()
    stuck = 0
    d0 = ((prev[0] - x) ** 2 + (prev[2] - z) ** 2) ** 0.5
    deaths0 = pl.js("() => CRESTBOUND.game.deaths")
    trail = []
    while t < max_ms:
        pl.wait(sample)
        t += sample
        st = pl.state()
        p = st["pos"]
        trail.append((p[0], p[1], p[2], st["pstate"]))
        d = ((p[0] - x) ** 2 + (p[2] - z) ** 2) ** 0.5
        if d <= tol:
            break
        moved = ((p[0] - prev[0]) ** 2 + (p[1] - prev[1]) ** 2 + (p[2] - prev[2]) ** 2) ** 0.5
        stuck = stuck + 1 if moved < 0.05 else 0
        prev = p
        if stuck >= 8:
            break
        dn = pl.js("() => CRESTBOUND.game.deaths")
        if dn != deaths0 and not die_ok:
            break
        pl.face(x, z)
    pl.up(*keys)
    pl.wait(200)
    st = pl.state()
    p = st["pos"]
    d = ((p[0] - x) ** 2 + (p[2] - z) ** 2) ** 0.5
    dn = pl.js("() => CRESTBOUND.game.deaths")
    res = {"target": [x, z], "end": p, "dist": round(d, 2), "ms": t, "arrived": d <= tol,
           "stuck": stuck >= 8, "died": dn != deaths0, "pstate": st["pstate"],
           "grounded": st["grounded"], "surface": st["surface"], "inWater": st["inWater"]}
    pl.say("  walk->%s %s end=%s d=%.2f t=%dms %s%s%s [%s gr=%s %s]" % (
        [x, z], ("(" + tag + ")") if tag else "", p, d, t,
        "ARRIVED" if res["arrived"] else "NOT-ARRIVED",
        " STUCK" if res["stuck"] else "", " DIED" if res["died"] else "",
        st["pstate"], st["grounded"], st["surface"]))
    return res


def critters(pl, r=30):
    return pl.js("""(r) => { const G=CRESTBOUND.game, P=G.player, C=G.course;
      const M = C && C.critters; if (!M) return 'no critters manager';
      let arr = M.list || M.all || M.critters || M.items || M._list || null;
      if (!arr && typeof M.forEach === 'function') { arr = []; M.forEach(c => arr.push(c)); }
      if (!arr) return {keys: Object.keys(M)};
      return arr.map(c => { const p = c.pos || c.p || (c.group && c.group.position) || null;
        return { k: c.kind || c.type || (c.constructor && c.constructor.name),
                 p: p ? [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] : null,
                 alive: c.alive !== undefined ? c.alive : (c.dead === undefined ? null : !c.dead),
                 hp: c.hp === undefined ? null : c.hp,
                 state: c.state || null,
                 d: p ? +Math.hypot(p.x-P.pos.x, p.y-P.pos.y, p.z-P.pos.z).toFixed(2) : null }; })
        .filter(o => o.d === null || o.d < r).sort((a,b)=>(a.d||0)-(b.d||0)); }""", r)


def hazards(pl, r=20):
    return pl.js("""(r) => { const G=CRESTBOUND.game, P=G.player, C=G.course;
      const M = C && C.hazards; if (!M) return 'none';
      let arr = M.list || M.all || M.items || M._list || null;
      if (!arr) return {keys: Object.keys(M)};
      return arr.map(h => { const p = h.pos || h.p || (h.group && h.group.position) || (h.mesh && h.mesh.position) || null;
        return { k: h.kind || h.type, p: p ? [+p.x.toFixed(2),+p.y.toFixed(2),+p.z.toFixed(2)] : null,
                 solid: h.solid === undefined ? null : !!h.solid,
                 on: h.on === undefined ? (h.visible === undefined ? null : h.visible) : h.on,
                 broken: h.broken === undefined ? null : h.broken,
                 d: p ? +Math.hypot(p.x-P.pos.x, p.y-P.pos.y, p.z-P.pos.z).toFixed(2) : null }; })
        .filter(o => o.d === null || o.d < r).sort((a,b)=>(a.d||0)-(b.d||0)); }""", r)


def jump(pl, hold=180, pre=("W",), pre_ms=700):
    """Run-up then a single jump. Returns the apex + landing."""
    if pre:
        pl.down(*pre); pl.wait(pre_ms)
    y0 = pl.pos()[1]
    pl.down("SPACE"); pl.wait(hold); pl.up("SPACE")
    top = y0
    for _ in range(10):
        pl.wait(90)
        st = pl.state()
        top = max(top, st["pos"][1])
        if st["grounded"] and st["pos"][1] < top - 0.05:
            break
    if pre:
        pl.up(*pre)
    pl.wait(200)
    st = pl.state()
    return {"y0": round(y0, 2), "apex": round(top, 2), "rise": round(top - y0, 2), "end": st["pos"], "pstate": st["pstate"]}


def pound(pl):
    """Jump then crouch in the air = ground pound."""
    pl.tap("SPACE", 150)
    pl.wait(320)
    pl.down("C"); pl.wait(500); pl.up("C")
    pl.wait(700)
    return pl.state()


def look(pl, dyaw=0.0, dpitch=0.0):
    return pl.js("""([dy,dp]) => { const c = CRESTBOUND.game.cam;
        c.yaw += dy; c.pitch = Math.max(-1.2, Math.min(1.2, c.pitch + dp));
        c._rcHoldT = 0; return [+c.yaw.toFixed(2), +c.pitch.toFixed(2)]; }""", [dyaw, dpitch])


def dismiss_card(pl, choice="stay"):
    """The COURSE CLEAR card pauses the game. Clear it the way a player would."""
    st = pl.state()
    if st["gstate"] != "clear" and not st["cardOpen"]:
        return False
    pl.js("(c) => CRESTBOUND.game.__dev.clearChoice(c)", choice)
    pl.wait(1500)
    pl.say("  (dismissed the course-clear card ->", pl.state()["gstate"], ")")
    return True


def st2(pl):
    return pl.js("""() => { const G=CRESTBOUND.game,P=G.player; return {
      p:[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)],
      v:[+P.vel.x.toFixed(2),+P.vel.y.toFixed(2),+P.vel.z.toFixed(2)],
      st:P.state, gr:!!P.grounded, sf:P.surface, w:!!P.inWater,
      g:G.state, cp:G.cpIndex, d:G.deaths, clock:+G.course.clock.toFixed(1) }; }""")


def trail(pl, keys, ms, step=300, release_at=None, tag=""):
    """Hold keys, sample every step ms. release_at = index after which keys are released."""
    pl.down(*keys)
    out = []
    n = max(1, ms // step)
    for i in range(n):
        pl.wait(step)
        out.append(st2(pl))
        if release_at is not None and i == release_at:
            pl.up(*keys)
    pl.up(*keys)
    pl.wait(200)
    if tag:
        pl.say("  %s: %s" % (tag, json.dumps([[o["p"], o["st"], o["gr"]] for o in out])))
    return out


def collstate(pl):
    return pl.js("""() => { const C=CRESTBOUND.game.course.collectibles; if(!C) return null;
      return { c: C.counts,
        crests:(C.crests||[]).map(x=>({id:x.id, present:!!x.present, ghost:!!x.ghost})) }; }""")
