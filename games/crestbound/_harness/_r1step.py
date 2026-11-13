"""rime-1 PLAYTEST — deterministic hand-stepped driver.

Under lane contention a wall-clock harness cannot tell "the move did not fire"
from "the frame never arrived" (HARNESS_NOTES). This stops the engine and steps
`game.update(1/60)` itself, driving REAL key presses through
`input.__test.press/release`, exactly as feelshots.py does. Every number it
prints is frames, not milliseconds of a contended box.

  python _harness/_r1step.py <scene> [more scenes]
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from _playlib import Play

SETUP = r"""() => {
  const A = globalThis.CRESTBOUND, G = A.game, E = A.engine;
  const F = (globalThis.__R1 = { i: 0, dt: 1 / 60, log: [], err: [] });
  const P = () => G.player, IN = () => G.input;
  F.press = (c) => IN().__test.press(c);
  F.release = (c) => IN().__test.release(c);
  F.allUp = () => ['Space','KeyC','KeyW','KeyA','KeyS','KeyD','ControlLeft','KeyF','ShiftLeft']
      .forEach(c => { try { IN().__test.release(c); } catch (e) {} });
  F.stick = (x, y) => IN().__test.stick(x, y);
  F.place = (x, y, z, yaw) => { const p = P();
    p.__test.teleport(new A.THREE.Vector3(x, y, z));
    p.__test.setVel({ x: 0, y: 0, z: 0 });
    if (Number.isFinite(yaw)) p.__test.setFacing(yaw);
    if (G.cam) { G.cam.yaw = Number.isFinite(yaw) ? yaw : G.cam.yaw; G.cam.recenter && G.cam.recenter(); } };
  F.begin = () => { F.i = 0; F.log = []; F.err = []; F.allUp(); if (E && E.running) E.stop(); return true; };
  F.step = (n) => { for (let k = 0; k < (n || 1); k++) {
      try { G.update(F.dt); } catch (e) { F.err.push(String(e).slice(0, 200)); }
      F.i++; } return F.i; };
  F.s = () => { const p = P();
    return { i: F.i, t: +(F.i * F.dt).toFixed(3),
      p: [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2)],
      v: [+p.vel.x.toFixed(2), +p.vel.y.toFixed(2), +p.vel.z.toFixed(2)],
      st: p.state, g: p.grounded ? 1 : 0, sur: p.surface || '',
      jc: p.jumpCount | 0, w: p.wallN ? +Math.hypot(p.wallN.x, p.wallN.z).toFixed(2) : 0,
      water: p.inWater ? 1 : 0, sub: p.submerged ? 1 : 0,
      slope: +(p.groundSlopeDeg || 0).toFixed(1),
      cam: G.cam ? [+G.cam.dist.toFixed(2), +G.cam.yaw.toFixed(2), +G.cam.pitch.toFixed(2)] : null }; };
  F.haz = () => (G.course.hazards || []).map(h => ({
      k: h.kind || (h.def && h.def.kind), p: h.def && h.def.p,
      broken: !!(h.broken || (h.h && h.h.broken)),
      trig: h.def && h.def.trigger,
      act: (h.colliders || []).map(c => !!c.active) })).filter(h => h.k === 'breakable');
  F.snap = () => { const s = G.__dev.state();
      return { coins: s.coins, sigils: s.sigils, crests: s.crests, cp: s.cpIndex, deaths: s.deaths }; };
  F.render = () => { try { E.render(1 / 60); } catch (e) {} };
  return true; }"""


class Step(Play):
    def boot(self, course="rime-1"):
        # the shared boot loop gives up after 80 s; on a contended box the page
        # needs longer, and giving up silently produces "CRESTBOUND is not defined".
        for _ in range(240):
            if self.js("() => !!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                break
            self.wait(1000)
        else:
            raise RuntimeError("page never defined CRESTBOUND in 240 s")
        self.wait(1500)
        self.click_title(); self.wait(1200)
        self.js("() => CRESTBOUND.game.__dev.unlockAll()")
        # the local server is single-threaded and 20 concurrent headless Chromes
        # can starve it into a failed dynamic import -- retry the load.
        loaded = False
        for attempt in range(5):
            try:
                self.js("(c) => CRESTBOUND.game.__dev.goto(c)", course)
            except Exception as e:
                self.say("  course load attempt %d threw %s" % (attempt + 1, str(e)[:120]))
                self.wait(4000)
                continue
            for _ in range(120):
                self.wait(300)
                s = self.state()
                if s["course"] == course and s["gstate"] == "playing":
                    loaded = True
                    break
            if loaded:
                break
            self.say("  course load attempt %d did not settle; retrying" % (attempt + 1))
            self.wait(3000)
        if not loaded:
            raise RuntimeError("could not load " + course + " after 5 attempts")
        self.wait(2000)
        self.js(SETUP)
        self.js("() => __R1.begin()")
        self.say("booted %s, engine stopped" % course)

    def place(self, x, y, z, yaw=0.0):
        self.js("([x,y,z,yaw]) => __R1.place(x,y,z,yaw)", [x, y, z, yaw])
        self.js("() => __R1.step(4)")

    def press(self, *c):
        for k in c:
            self.js("(k) => __R1.press(k)", k)

    def release(self, *c):
        for k in c:
            self.js("(k) => __R1.release(k)", k)

    def stick(self, x, y):
        self.js("([x,y]) => __R1.stick(x,y)", [x, y])

    def run(self, frames, every=4):
        """Step `frames` frames, sampling every `every`."""
        return self.js("([n,e]) => { const out = []; for (let k = 0; k < n; k++) {"
                       " __R1.step(1); if (k % e === 0) out.push(__R1.s()); } "
                       "out.push(__R1.s()); return out; }", [frames, every])

    def shotnow(self, what):
        self.js("() => __R1.render()")
        return self.shot(what)

    def brk(self):
        return self.js("() => __R1.haz()")

    def snapc(self):
        return self.js("() => __R1.snap()")


def brief(samples):
    return [(s["i"], s["st"], s["p"], s["g"]) for s in samples]


def sc_pound_plug(p):
    p.say("\n### POUND THE ICE PLUG (5, 42) — the course's first taught verb ###")
    p.say("  before:", json.dumps(p.brk()))
    p.place(5.0, 1.60, 42.0, 0.0)
    p.say("  placed:", json.dumps(p.js("() => __R1.s()")))
    # settle briefly then pound IMMEDIATELY (something respawns you if you loiter here)
    s = p.run(14, 4)
    p.say("  settle:", brief(s))
    # jump
    p.press("Space")
    s1 = p.run(10, 3)
    p.release("Space")
    s2 = p.run(8, 3)
    p.say("  jump:", brief(s1 + s2))
    # POUND
    p.press("KeyC")
    s3 = p.run(10, 2)
    p.release("KeyC")
    s4 = p.run(50, 5)
    p.say("  pound:", brief(s3 + s4))
    p.say("  after:", json.dumps(p.js("() => __R1.s()")))
    p.say("  breakables:", json.dumps(p.brk()))
    p.say("  flags:", json.dumps(p.js("() => ['ice-hole-open','hay-wall-broken']"
                                      ".map(k => [k, CRESTBOUND.game.save.flags.get(k)])")))
    p.shotnow("step_pound_plug")
    # and now: can he get into the water and out again?
    s5 = p.run(90, 10)
    p.say("  60 frames later:", brief(s5))
    p.say("  in water?", json.dumps(p.js("() => __R1.s()")))
    p.shotnow("step_after_plug")


def sc_pound_hay(p):
    p.say("\n### POUND THE HAY WALL on the barn gantry (-27.2, 2.9) ###")
    p.place(-27.2, 8.90, 4.4, 0.0)   # yaw 0 faces -Z, i.e. toward the hay at z 2.9
    s = p.run(40, 8)
    p.say("  on the gantry:", brief(s))
    p.shotnow("step_gantry")
    # walk into the hay
    p.stick(0, 1)
    s = p.run(50, 8)
    p.stick(0, 0)
    p.say("  walked at the hay:", brief(s))
    p.press("Space")
    s1 = p.run(10, 3)
    p.release("Space")
    s2 = p.run(6, 3)
    p.press("KeyC")
    s3 = p.run(10, 2)
    p.release("KeyC")
    s4 = p.run(50, 5)
    p.say("  pound:", brief(s1 + s2 + s3 + s4))
    p.say("  breakables:", json.dumps(p.brk()))
    p.say("  crests:", json.dumps(p.snapc()))
    p.shotnow("step_hay_after")


def sc_shaft(p):
    p.say("\n### THE BELL TOWER WALL-KICK SHAFT (0, 15.10 -> 23.10, -47) ###")
    p.place(0.0, 15.50, -47.0, 3.1416)
    s = p.run(30, 6)
    p.say("  in the shaft:", brief(s))
    p.say("  camera:", json.dumps(p.js("() => __R1.s().cam")))
    p.shotnow("step_shaft_floor")
    # jump, then kick alternate walls: press into the wall and jump on contact
    p.press("Space")
    p.run(8, 8)
    p.release("Space")
    hist = []
    ys = []
    for k in range(14):
        # aim at the wall we are heading for
        yaw = 3.1416 if k % 2 == 0 else 0.0
        p.js("(y) => { const G = CRESTBOUND.game; G.player.__test.setFacing(y); if (G.cam) G.cam.yaw = y; }", yaw)
        p.stick(0, 1)
        s = p.run(6, 3)
        # jump the moment a wall is in contact
        p.press("Space")
        s2 = p.run(4, 2)
        p.release("Space")
        s3 = p.run(6, 3)
        hist += s + s2 + s3
        cur = p.js("() => __R1.s()")
        ys.append(cur["p"][1])
        p.say("    kick %d -> y=%.2f st=%s w=%.2f cam=%s" % (k + 1, cur["p"][1], cur["st"], cur["w"], cur["cam"]))
        if cur["p"][1] > 23.2 or (cur["g"] and cur["p"][1] < 15.4 and k > 3):
            break
    p.stick(0, 0)
    p.say("  highest y reached in the shaft: %.2f (deck is 23.10)" % max(ys))
    p.say("  camera dist range in the shaft:",
          json.dumps(sorted(set(s["cam"][0] for s in hist))[:8]))
    p.shotnow("step_shaft_top")


def sc_drift(p):
    p.say("\n### THE DRIFT: 41 deg slide, jump at the lip, catch ledge ###")
    p.place(-6.0, 10.10, -13.4, 0.0)     # on the cornice, facing -Z? lip is at z -8.9 => +Z
    p.js("() => { const G = CRESTBOUND.game; const y = Math.atan2(0, -(-8.9 + 13.4));"
         " G.player.__test.setFacing(y); if (G.cam) G.cam.yaw = y; }")
    s = p.run(30, 6)
    p.say("  on the cornice:", brief(s))
    p.shotnow("step_cornice")
    p.stick(0, 1)
    s = p.run(70, 5)
    p.say("  riding:", brief(s))
    p.say("  states seen:", sorted(set(x["st"] for x in s)))
    p.say("  slope deg seen:", sorted(set(x["slope"] for x in s)))
    p.press("Space")
    s2 = p.run(8, 4)
    p.release("Space")
    s3 = p.run(60, 6)
    p.stick(0, 0)
    p.say("  after the lip jump:", brief(s2 + s3))
    p.say("  landed:", json.dumps(p.js("() => __R1.s()")))
    p.say("  sigils:", json.dumps(p.snapc()))
    p.shotnow("step_catch_ledge")


def sc_chute(p):
    p.say("\n### THE CHUTE into the gorge, and the jump ledge ###")
    p.place(17.0, 11.80, -23.8, 0.0)
    p.js("() => { const G = CRESTBOUND.game; const y = Math.atan2(-(22.2-17.0), -(-29.0+23.8));"
         " G.player.__test.setFacing(y); if (G.cam) G.cam.yaw = y; }")
    s = p.run(30, 6)
    p.say("  launch block:", brief(s))
    p.shotnow("step_launch_block")
    p.stick(0, 1)
    s = p.run(80, 5)
    p.say("  chute:", brief(s))
    p.say("  states:", sorted(set(x["st"] for x in s)))
    p.press("Space")
    s2 = p.run(8, 4)
    p.release("Space")
    s3 = p.run(70, 6)
    p.stick(0, 0)
    p.say("  after:", brief(s2 + s3))
    p.say("  landed:", json.dumps(p.js("() => __R1.s()")))
    p.shotnow("step_chute_end")


def sc_geyser(p):
    p.say("\n### THE GEYSER PAD on the gorge floor (23.3, -27.9), apex 8.5 ###")
    p.place(23.3, 6.20, -25.6, 0.0)
    s = p.run(30, 6)
    p.say("  gorge floor:", brief(s))
    p.shotnow("step_gorge_floor")
    p.js("() => { const G = CRESTBOUND.game; const y = Math.atan2(0, -(-27.9 + 25.6));"
         " G.player.__test.setFacing(y); if (G.cam) G.cam.yaw = y; }")
    p.stick(0, 1)
    s = p.run(40, 4)
    p.stick(0, 0)
    s2 = p.run(70, 5)
    all_ = s + s2
    p.say("  onto the pad:", brief(all_))
    p.say("  apex y: %.2f" % max(x["p"][1] for x in all_))
    p.say("  ledge is 10.20 — reached it?" )
    p.shotnow("step_geyser")


def sc_bridge(p):
    p.say("\n### THE VANISHING ICE BRIDGE ledge -> knoll ###")
    p.place(19.0, 10.80, -24.5, 0.0)
    p.js("() => { const G = CRESTBOUND.game; const y = Math.atan2(-(34-19), -(-33+24.5));"
         " G.player.__test.setFacing(y); if (G.cam) G.cam.yaw = y; }")
    s = p.run(30, 6)
    p.say("  bridge start:", brief(s))
    p.say("  tiles:", json.dumps(p.js(
        "() => (CRESTBOUND.game.course.hazards||[]).filter(h => (h.kind||(h.def&&h.def.kind))==='vanish')"
        ".map(h => [h.def && h.def.p, (h.colliders||[]).map(c => !!c.active)])")))
    p.shotnow("step_bridge_start")
    p.stick(0, 1)
    s = p.run(220, 12)
    p.stick(0, 0)
    p.say("  crossing:", brief(s))
    p.say("  ended:", json.dumps(p.js("() => __R1.s()")))
    p.shotnow("step_bridge_end")


def sc_lift(p):
    p.say("\n### THE SLEIGH LIFT green -> crest shelf ###")
    m = p.js("() => { const h = (CRESTBOUND.game.course.hazards||[])"
             ".find(h => (h.kind||(h.def&&h.def.kind))==='mover');"
             " return h && h.mesh ? [+h.mesh.position.x.toFixed(2), +h.mesh.position.y.toFixed(2), +h.mesh.position.z.toFixed(2)] : null; }")
    p.say("  sleigh at:", m)
    # step until the sleigh is near the bottom
    for _ in range(60):
        m = p.js("() => { const h = (CRESTBOUND.game.course.hazards||[])"
                 ".find(h => (h.kind||(h.def&&h.def.kind))==='mover');"
                 " return h && h.mesh ? [+h.mesh.position.x.toFixed(2), +h.mesh.position.y.toFixed(2), +h.mesh.position.z.toFixed(2)] : null; }")
        if m and m[1] < 15.9:
            break
        p.js("() => __R1.step(20)")
    p.say("  sleigh at the bottom:", m)
    p.place(m[0], m[1] + 0.9, m[2], 0.0)
    s = p.run(1200, 120)
    p.say("  ride:", brief(s))
    p.say("  final:", json.dumps(p.js("() => __R1.s()")))
    p.shotnow("step_lift")


def sc_face(p):
    p.say("\n### THE CREST FACE: ride the slope, hit the kicker, land on the belfry ###")
    p.place(0.0, 40.80, -79.0, 3.1416)   # the face falls toward +Z (the green), so yaw PI
    p.js("() => { const G = CRESTBOUND.game; G.player.__test.setFacing(Math.PI); if (G.cam) G.cam.yaw = Math.PI; }")
    s = p.run(30, 6)
    p.say("  shelf:", brief(s))
    p.say("  sigils here:", json.dumps(p.snapc()))
    p.shotnow("step_shelf")
    p.stick(0, 1)
    s = p.run(200, 10)
    p.say("  the face:", brief(s))
    p.say("  states:", sorted(set(x["st"] for x in s)))
    p.say("  max speed:", max(round((x["v"][0] ** 2 + x["v"][2] ** 2) ** 0.5, 2) for x in s))
    p.stick(0, 0)
    p.say("  ended:", json.dumps(p.js("() => __R1.s()")))
    p.shotnow("step_face_end")


SCENES = {"plug": sc_pound_plug, "hay": sc_pound_hay, "shaft": sc_shaft,
          "drift": sc_drift, "chute": sc_chute, "geyser": sc_geyser,
          "bridge": sc_bridge, "lift": sc_lift, "face": sc_face}

if __name__ == "__main__":
    want = sys.argv[1:] or ["plug"]
    with Step("rime1step") as p:
        p.boot("rime-1")
        for w in want:
            fn = SCENES.get(w)
            if not fn:
                continue
            try:
                p.js("() => __R1.begin()")
                fn(p)
            except Exception as e:
                p.say("  !! %s raised %r" % (w, e))
                import traceback
                traceback.print_exc()
        p.say("\nconsole:", p.console[:20])
        p.say("\nerrors:", p.js("() => __R1.err.slice(0,10)"))
