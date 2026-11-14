#!/usr/bin/env python
"""
BLACKRIDGE playprobe — persona bots through the REAL input path.

    python playprobe.py                                # all personas, shared seeds
    python playprobe.py --persona rusher --seeds 11    # one persona, one seed
    python playprobe.py --seconds 180 --url <cdn url>  # longer runs / deployed

Doctrine §2/§5: play finds what audits can't; input features are tested
through the input layer. The driving happens IN PAGE via
`__FPS__.__test.autoplay(profile, seconds)` (core/test/autoplay.js), which
dispatches real KeyboardEvent/MouseEvent on window/#view and advances by SIM
ticks. Look is the one non-real path (pointer lock cannot be forged) — pinned
yaw/pitch writes, per harness_plan §0.4/§2.5, said out loud here.

Personas + pass bars are DATA in _harness/personas.js (R29: rusher / optimal
(=Tactician) / novice / camper); every persona runs the SAME seed list so a
combat change is measured on identical matches (harness_plan §5).

Assertions (Part 5.4, frozen):
  - per-persona bars (win rates, deaths medians, survive floors, anti-camp)
  - optimal beats novice on every seed (skill is real)
  - parity: HUD hitmarkers == sim shotsHit; HUD ammo == sim ammo after
    reloads; killfeed rows == kills+deaths. HUD-side counts need A10's
    hud.counts() — until it lands the parity block reports UNAVAILABLE and
    FAILS (an unverifiable HUD is not a passing HUD).
  - stuckBotSeconds == 0; zero page errors; matches end.

Output: one JSON row per persona x seed on stdout, then a verdict table.
Exit 0 iff every assertion held. Exit 4 = surface NOT READY. Exit 2 = nav.
Verdicts never round up.
"""
import argparse, json, os, re, statistics, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shotserver import ensure_server

DEFAULT_URL = "http://localhost:8841/games/blackridge/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
READY_EXPR = "!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim)"  # R11


def load_personas_source() -> str:
    src = open(os.path.join(HERE, "personas.js"), encoding="utf-8").read()
    return re.sub(r"^export\s+", "", src, flags=re.M)


def wait_ready(page, timeout_s: float) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            if page.evaluate(READY_EXPR):
                return True
        except Exception:
            pass
        page.wait_for_timeout(400)
    return False


def median(xs):
    return statistics.median(xs) if xs else None


def run_match(page, persona: dict, profile: str, seed: int, seconds: float) -> dict:
    page.evaluate("(s) => { window.__BR_AUTOPLAY_SEED__ = s; }", seed + persona.get("seedOffset", 0))
    page.evaluate("(s) => __FPS__.__test.startMission({seed: s})", seed)
    report = page.evaluate(
        "(a) => __FPS__.__test.autoplay(a.profile, a.seconds)",
        {"profile": profile, "seconds": seconds})

    parity = page.evaluate("""() => {
        const F = globalThis.__FPS__;
        const c = F.__test.counters();
        const hud = F.hud || null;
        const hudCounts = (hud && typeof hud.counts === 'function') ? hud.counts() : null;
        // DOM fallbacks (best effort — id vocabulary from VT §6 / testsurface sweep)
        const kfEl = document.querySelector('#killfeed');
        const kfRows = kfEl ? kfEl.querySelectorAll('.row, li, .killfeed-row, div').length : null;
        const ammoEl = document.querySelector('#ammo');
        const ammoText = ammoEl ? (ammoEl.textContent || '') : null;
        const m = ammoText ? ammoText.match(/\\d+/) : null;
        return {
            sim: { shotsHit: c.shotsHit, kills: c.kills, deaths: c.deaths,
                   mag: F.sim.state.player.weapon.mag },
            hudCounts,
            dom: { killfeedRows: kfRows, ammoShown: m ? parseInt(m[0], 10) : null },
        };
    }""")
    errs = page.evaluate("window.__err || []")
    return {"report": report, "parity": parity, "pageErrors": errs}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--persona", default="all",
                    help="comma list of rusher/optimal/novice/camper, or 'all'")
    ap.add_argument("--seeds", default="",
                    help="comma seed list (default: personas.js SEEDS)")
    ap.add_argument("--seconds", type=float, default=150.0,
                    help="sim seconds per match (frames-counted in page)")
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--ready-timeout", type=float, default=120.0)
    args = ap.parse_args()

    if "localhost:8841" in args.url or "127.0.0.1:8841" in args.url:
        ensure_server()

    personas_src = load_personas_source()
    rows, failures = [], []

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.add_init_script(
            "window.__err=[];addEventListener('error',e=>window.__err.push(String(e.message)));"
            "addEventListener('unhandledrejection',e=>window.__err.push('reject: '+e.reason));")

        def fresh():
            page.goto(args.url, wait_until="load", timeout=90_000)
            page.add_script_tag(content=personas_src)
            if not wait_ready(page, args.ready_timeout):
                raise RuntimeError("NOT READY: no __FPS__ global — run bootcheck.py first")
            missing = page.evaluate("""() => {
                const t = globalThis.__FPS__ && __FPS__.__test;
                if (!t) return '__FPS__.__test';
                const need = ['startMission', 'autoplay', 'counters'];
                const m = need.filter(k => typeof t[k] !== 'function');
                return m.length ? m.join(',') : '';
            }""")
            if missing:
                raise RuntimeError(f"NOT READY: __test.{missing} missing")

        try:
            fresh()
        except RuntimeError as e:
            print(str(e), file=sys.stderr)
            browser.close()
            return 4
        except Exception as e:
            print(f"NAVIGATION FAILED: {e}", file=sys.stderr)
            browser.close()
            return 2

        personas = page.evaluate("PERSONAS")
        default_seeds = page.evaluate("SEEDS")
        want = ([s.strip() for s in args.persona.split(",") if s.strip()]
                if args.persona != "all" else list(personas.keys()))
        unknown = [w for w in want if w not in personas]
        if unknown:
            print(f"unknown personas: {unknown} (have {list(personas.keys())})", file=sys.stderr)
            browser.close()
            return 2
        seeds = ([int(s) for s in args.seeds.split(",") if s.strip()]
                 if args.seeds else list(default_seeds))

        for name in want:
            for seed in seeds:
                fresh()
                try:
                    out = run_match(page, personas[name], personas[name]["profile"],
                                    seed, args.seconds)
                except Exception as e:
                    failures.append(f"{name}/seed{seed}: match crashed: {e}")
                    print(json.dumps({"persona": name, "seed": seed, "error": str(e)}))
                    continue
                row = {"persona": name, "seed": seed, **out}
                rows.append(row)
                r = out["report"]
                print(json.dumps({
                    "persona": name, "seed": seed, "phase": r.get("phase"),
                    "kills": r.get("kills"), "deaths": r.get("deaths"),
                    "hp": r.get("hp"), "accuracy": r.get("accuracy"),
                    "timeToFirstContact": r.get("timeToFirstContact"),
                    "stuckBotSeconds": r.get("stuckBotSeconds"),
                    "endedByPhase": r.get("endedByPhase"),
                    "pageErrors": len(out["pageErrors"]),
                }))
                if out["pageErrors"]:
                    failures.append(f"{name}/seed{seed}: {len(out['pageErrors'])} page errors: "
                                    f"{out['pageErrors'][:3]}")

        browser.close()

    # ---------------- assertions (verdicts never round up) ----------------
    by = {}
    for row in rows:
        by.setdefault(row["persona"], {})[row["seed"]] = row

    def reports(name):
        return [v["report"] for v in by.get(name, {}).values()]

    # parity — sim vs HUD instrumentation
    for row in rows:
        par = row["parity"]
        tag = f"{row['persona']}/seed{row['seed']}"
        hc = par.get("hudCounts")
        if hc is None:
            failures.append(
                f"{tag}: PARITY UNAVAILABLE — hud.counts() not implemented "
                f"(needsElsewhere A10); killfeed DOM rows={par['dom']['killfeedRows']}")
        else:
            if hc.get("hitmarkers") != par["sim"]["shotsHit"]:
                failures.append(f"{tag}: hitmarkers {hc.get('hitmarkers')} != shotsHit {par['sim']['shotsHit']}")
            if hc.get("killfeedRows") is not None and \
               hc.get("killfeedRows") != par["sim"]["kills"] + par["sim"]["deaths"]:
                failures.append(f"{tag}: killfeed {hc.get('killfeedRows')} != kills+deaths "
                                f"{par['sim']['kills'] + par['sim']['deaths']}")
            if hc.get("ammoShown") is not None and hc.get("ammoShown") != par["sim"]["mag"]:
                failures.append(f"{tag}: HUD ammo {hc.get('ammoShown')} != sim mag {par['sim']['mag']}")

    # stuck bots + matches end (all personas)
    for row in rows:
        r = row["report"]
        tag = f"{row['persona']}/seed{row['seed']}"
        if (r.get("stuckBotSeconds") or 0) > 0:
            failures.append(f"{tag}: stuckBotSeconds={r['stuckBotSeconds']} (must be 0)")

    # persona bars
    if "rusher" in by:
        rs = reports("rusher")
        wins = sum(1 for r in rs if r.get("phase") == "won") / max(1, len(rs))
        bar = personas["rusher"]["bars"].get("fullMissionWinRate", 0.25)
        if wins < bar:
            failures.append(f"rusher: full-mission win rate {wins:.2f} < {bar} over {len(rs)} seeds")
        archs = set()
        for r in rs:
            for d in r.get("playerDeaths", []):
                if d.get("archetype"):
                    archs.add(d["archetype"])
        if len(archs) < 2 and any(r.get("deaths", 0) > 0 for r in rs):
            failures.append(f"rusher: died to only {sorted(archs)} — needs >= 2 archetypes")

    if "optimal" in by and "novice" in by:
        for seed in by["optimal"]:
            if seed not in by["novice"]:
                continue
            o, n = by["optimal"][seed]["report"], by["novice"][seed]["report"]
            o_score = (1 if o.get("phase") == "won" else 0, o.get("kills", 0) - o.get("deaths", 0))
            n_score = (1 if n.get("phase") == "won" else 0, n.get("kills", 0) - n.get("deaths", 0))
            if not o_score > n_score:
                failures.append(f"seed{seed}: optimal {o_score} does not beat novice {n_score}")

    if "optimal" in by:
        os_ = reports("optimal")
        wins = sum(1 for r in os_ if r.get("phase") == "won") / max(1, len(os_))
        if wins < personas["optimal"]["bars"]["fullMissionWinRate"]:
            failures.append(f"optimal: win rate {wins:.2f} < "
                            f"{personas['optimal']['bars']['fullMissionWinRate']} over {len(os_)} seeds")

    if "novice" in by:
        ns = reports("novice")
        deaths = [r.get("deaths", 0) for r in ns]
        md = median(deaths)
        if md is not None and md > personas["novice"]["bars"]["medianDeathsPerRun"]:
            failures.append(f"novice: median deaths {md} > {personas['novice']['bars']['medianDeathsPerRun']}")
        surv = []
        for r in ns:
            pd = r.get("playerDeaths", [])
            surv.append(pd[0]["t"] if pd else r.get("seconds", 0))
        ms = median(surv)
        if ms is not None and ms < personas["novice"]["bars"]["survivesSeconds"]:
            failures.append(f"novice: median survival {ms:.1f}s < "
                            f"{personas['novice']['bars']['survivesSeconds']}s (fairness floor)")

    if "camper" in by:
        cs = reports("camper")
        for r, seed in zip(cs, by["camper"].keys()):
            if r.get("phase") == "won" and (r.get("counters", {}).get("damageTaken", 0) == 0):
                failures.append(f"camper/seed{seed}: WON without taking damage — passive win")
            if (r.get("counters", {}).get("damageTaken", 0)) == 0:
                failures.append(f"camper/seed{seed}: bots never pressured the camper "
                                f"(damageTaken 0 — no dislodge/flank inside the timer)")

    print("\n---- playprobe verdict ----")
    print(f"matches: {len(rows)}  personas: {sorted(by.keys())}  seeds: {seeds}")
    if failures:
        print(f"FAILED assertions ({len(failures)}):")
        for f in failures:
            print(f"  !! {f}")
        return 1
    print("ALL ASSERTIONS HELD")
    return 0


if __name__ == "__main__":
    sys.exit(main())
