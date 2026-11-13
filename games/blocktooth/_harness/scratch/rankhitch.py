"""Size I play + every rank-up (I→II→III→IV→V via cheat.rank, which emits the real rankUp beat):
?prof=1 worst frames per phase. Real keys drive the titan in circles; drafts picked with key 1."""
import argparse, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
from common import Session, add_common_args, build_url, set_rank, REPORTS  # noqa
import perfcheck
common_flags = __import__("common").FLAGS; common_flags.append("--enable-precise-memory-info")
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument("--biome", default="grideast"); ap.add_argument("--titan", default="molo")
ap.add_argument("--tag", default="")
args = ap.parse_args()
url = build_url(args.base, autostart=1, dev=1, noslate=1, titan=args.titan, biome=args.biome, seed=5, prof=1)
s = Session(args, "rankhitch"); s.start()
i = 0
def drive(sec):
    global i
    t0 = time.time()
    while time.time() - t0 < sec:
        s.hold(perfcheck.CIRCLE[i % 8]); i += 1; time.sleep(0.3)
        st = s.state() or {}
        if st.get("screen") == "draft": s.release_all(); s.press("Digit1")
        elif st.get("screen") == "pause": s.release_all(); s.press("Escape")
def dump():
    return json.loads(s.js("() => JSON.stringify(window.__BTPROF__.dump())"))
def report(name, d):
    S = d["series"]
    play = [x for x in S if x[5]]
    over = [x for x in S if x[0] > 22]
    st = s.state() or {}
    print("%-14s frames %4d  >22ms %3d (play %d)  rawP %s  gpuP50 %s  scale %s dynres %s" % (
        name, len(S), len(over), sum(1 for x in over if x[5]), d["rawP"], d["gpuP"].get("p50"), st.get("renderScale"), st.get("dynres")))
    for f in d["worst"][:4]:
        p = f.get("prev") or {}
        top = sorted(((p.get("sec") or {})).items(), key=lambda kv: -kv[1])[:4]
        print("     raw %6.1f %-5s note[%s] | prev cpu %5.1f gpu %5.1f note[%s] %s" % (f["raw"], f["screen"], f["note"], p.get("cpu", -1), p.get("gpu", -1), p.get("note", ""), top))
out = {}
try:
    s.goto(url); s.wait_bt(90); s.events_off(); s.wait_screen(("play",), 90)
    s.cheat("god", True)
    drive(float(os.environ.get('PRE_S', '2')))
    s.js("() => window.__BTPROF__.reset()"); drive(15.0); d = dump(); report("Size I play", d); out["I"] = d
    for r in (1, 2, 3, 4):
        s.js("() => window.__BTPROF__.reset()")
        set_rank(s, r, lambda m: None)
        drive(4.0); d = dump(); report("rankUp->%s" % "I II III IV V".split()[r], d); out[str(r)] = d
finally:
    s.close()
json.dump(out, open(os.path.join(REPORTS, "rankhitch%s.json" % args.tag), "w"))
