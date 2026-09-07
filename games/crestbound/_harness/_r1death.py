"""rime-1 PLAYTEST — what kills a player who is STANDING STILL?

Hooks game.onDeath so every death reports its cause, then parks Nim, motionless,
at the stations a player would naturally stop at, and steps the game by hand.
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from _r1step import Step, SETUP

OUT = os.path.join(HERE, "_r1death.txt")
lines = []

STATIONS = [
    ("the ice, right of the coin line", 0.0, 1.60, 50.0),
    ("the ice plug (5, 42) -- the pound target", 5.0, 1.60, 42.0),
    ("the ice, west slab", -8.0, 1.60, 44.0),
    ("the north shore, cp2", 0.0, 1.70, 30.0),
    ("the village square, cp3", 0.0, 5.00, 3.0),
    ("the barn yard, outside the fence", -21.0, 5.30, 4.0),
    ("the barn door, inside the gnasher's reach", -19.5, 5.30, 6.5),
    ("cottage cap 2 (roof line)", -1.5, 10.80, 18.0),
    ("between the bells (sigil 4)", 2.2, 10.80, 16.5),
    ("the hillside ledge, cp4", 14.0, 10.50, -22.0),
    ("the gorge floor by the geyser", 23.3, 6.20, -25.6),
    ("the chapel track under the bell frame", 6.0, 8.60, -31.0),
    ("the chapel green, cp5", 0.0, 15.40, -42.0),
    ("the belfry deck", 0.0, 23.40, -50.9),
    ("the crest shelf", 0.0, 40.50, -79.0),
]


def P(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    lines.append(s)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


HOOK = r"""() => {
  const G = CRESTBOUND.game;
  if (!G.__deathHooked) {
    G.__deaths = [];
    const orig = G.onDeath.bind(G);
    G.onDeath = function (cause) { G.__deaths.push({ cause: String(cause),
        p: [+G.player.pos.x.toFixed(2), +G.player.pos.y.toFixed(2), +G.player.pos.z.toFixed(2)],
        st: G.player.state, t: G.course ? +G.course.clock.toFixed(2) : -1 });
      return orig(cause); };
    G.__deathHooked = true;
  }
  G.__deaths.length = 0; return true; }"""

if __name__ == "__main__":
    with Step("rime1death") as p:
        p.boot("rime-1")
        p.js(HOOK)
        for (name, x, y, z) in STATIONS:
            p.js("() => { CRESTBOUND.game.__deaths.length = 0; }")
            p.js("([x,y,z]) => __R1.place(x,y,z,0)", [x, y, z])
            p.js("() => __R1.step(6)")
            start = p.js("() => __R1.s()")
            # 10 seconds of standing perfectly still
            s = p.run(600, 60)
            d = p.js("() => CRESTBOUND.game.__deaths")
            end = p.js("() => __R1.s()")
            moved = ((end["p"][0] - start["p"][0]) ** 2 + (end["p"][2] - start["p"][2]) ** 2) ** 0.5
            P("%-46s start %s -> end %s  moved %.2f m  states %s  DEATHS %s"
              % (name, start["p"], end["p"], moved,
                 sorted(set(q["st"] for q in s)), json.dumps(d)))
        P("\nconsole:", json.dumps(p.console[:20]))
