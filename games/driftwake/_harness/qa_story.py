# -*- coding: utf-8 -*-
"""
qa_story.py -- lane N (the writer): prove src/quests/storyText.js in the LIVE page.

Boots the game (?autoplay&test), dynamic-imports storyText.js next to the live
modules it must agree with (world/shrine.js SHRINE_IDS, combat/combatData.js
ENEMIES, world/landmarks.js LANDMARK_TYPES), lets 1 s of GAME time pass, and
asserts:
  - every count the spec and the lane brief give, exactly;
  - every string non-empty; trackers <= 60, titles/names/headings <= 40,
    every other line <= 140;
  - no duplicate ids; no placeholder text (TODO, lorem, XXX, TBD, FIXME);
  - titles, relic effects and boon effects VERBATIM against the spec file on
    disk (_spec/QUEST_DESIGN.md), not against a copy typed here;
  - bounty units are real, non-boss roster rows of their realm; trial
    landmarks are real LANDMARK_TYPES keys of their realm;
  - the object is deep-frozen; zero page errors.
Exit code 0 only if every check passes.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
GAME = Path(__file__).resolve().parents[1]
PORT = 8922
GAME_URL = "http://127.0.0.1:%d/games/driftwake/index.html?autoplay&test" % PORT
# The machine is shared with other lanes; boot is slow. `--boot-wait S`
# overrides (seconds) — the content checks run either way.
BOOT_WAIT_MS = 300000
if "--boot-wait" in sys.argv:
    BOOT_WAIT_MS = int(float(sys.argv[sys.argv.index("--boot-wait") + 1]) * 1000)
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

JS = """(async () => {
    const S = await import('/games/driftwake/src/quests/storyText.js');
    const sh = await import('/games/driftwake/src/world/shrine.js');
    const cd = await import('/games/driftwake/src/combat/combatData.js');
    const lm = await import('/games/driftwake/src/world/landmarks.js');
    const STORY = S.STORY;
    const notFrozen = [];
    const seen = new Set();
    (function walk(o, p) {
        if (!o || typeof o !== 'object' || seen.has(o)) return;
        seen.add(o);
        if (!Object.isFrozen(o)) notFrozen.push(p);
        for (const k of Object.keys(o)) walk(o[k], p + '.' + k);
    })(STORY, 'STORY');
    const before = STORY.intro.lines[0];
    let threw = false;
    try { STORY.intro.lines[0] = 'mutated'; } catch (e) { threw = true; }
    const mutationBlocked = STORY.intro.lines[0] === before;
    // rAF liveness over a 2 s timer window — separates "the page is starved of
    // frames" (environment) from "the page is running" before any game wait.
    let rafCount = 0, rafOn = true;
    const rafTick = () => { rafCount++; if (rafOn) requestAnimationFrame(rafTick); };
    requestAnimationFrame(rafTick);
    await new Promise((r) => setTimeout(r, 2000));
    rafOn = false;
    // One second of GAME time after the import, when the game has booted. The
    // 60 s timer is only a harness safety cap so a starved page cannot hang
    // the probe; the result reports the game time actually observed.
    const booted = !!(globalThis.SNOWFLOW && SNOWFLOW.combat && SNOWFLOW.combat.registry);
    const reg = booted ? SNOWFLOW.combat.registry : null;
    const t0 = booted ? reg.time : 0;
    if (booted) {
        await Promise.race([
            new Promise((res) => {
                const tick = () => (reg.time - t0 >= 1.0) ? res() : requestAnimationFrame(tick);
                tick();
            }),
            new Promise((res) => setTimeout(res, 60000)),
        ]);
    }
    const lmOut = {};
    for (const k of Object.keys(lm.LANDMARK_TYPES)) {
        lmOut[k] = { realm: lm.LANDMARK_TYPES[k].realm, label: lm.LANDMARK_TYPES[k].label };
    }
    return {
        story: JSON.parse(JSON.stringify(STORY)),
        exportNames: Object.keys(S),
        objectsWalked: seen.size,
        notFrozen, mutationBlocked, threw,
        endingSameRef: STORY.echo['echo.ash.6'].lines === STORY.ending.echo,
        shrineIds: Array.from(sh.SHRINE_IDS),
        enemies: cd.ENEMIES.map((e) => ({ key: e.key, name: e.name, realm: e.realm, tier: e.tier })),
        tier: Object.assign({}, cd.TIER),
        landmarks: lmOut,
        booted, rafPer2s: rafCount,
        gameTimeAdvanced: booted ? reg.time - t0 : null,
        bootLabel: (document.getElementById('boot-phase') || {}).textContent || null,
    };
})()"""

REALMS = ("cold", "sand", "ash")
PLACEHOLDER = re.compile(r"\b(TODO|lorem|XXX|TBD|FIXME|TKTK)\b", re.I)
SLANG = re.compile(r"\b(okay|ok|cool|awesome|guys|lol|dude|gonna|wanna|yeah|yep|nope|kinda)\b", re.I)

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))


def spec_facts():
    """Parse the verbatim facts out of the spec on disk."""
    md = (GAME / "_spec" / "QUEST_DESIGN.md").read_text(encoding="utf-8")
    cold = re.findall(r"^\| (cold\.\d) \| ([^|]+?) \|", md, re.M)
    sand_blk = md[md.index("- Sand:"):md.index("- Ash:")]
    ash_blk = md[md.index("- Ash:"):md.index("GATING")]
    # The spec hard-wraps its prose, so a quoted title can span a line break
    # ("The Gatekeeper of<newline>  Brass"): collapse runs of whitespace.
    titles = {sid: " ".join(t.split()) for sid, t in cold}
    for i, t in enumerate(re.findall(r'"([^"]+)"', sand_blk)):
        titles["sand.%d" % (i + 1)] = " ".join(t.split())
    for i, t in enumerate(re.findall(r'"([^"]+)"', ash_blk)):
        titles["ash.%d" % (i + 1)] = " ".join(t.split())
    b41 = md[md.index("### 4.1"):md.index("### 4.2")]
    boons = re.findall(r'"([^"]+?) — ([^"]+)"', b41)
    b42 = md[md.index("Examples (build these; all 12 needed):"):md.index("### 4.3")]
    b42 = b42.split(":", 1)[1]
    b42 = re.sub(r"\s+", " ", b42)
    b42 = re.sub(r"\b(Cold|Sand|Ash):", "", b42)
    relics = re.findall(r"([A-Z][A-Za-z' ]*[A-Za-z]) \(([^)]+)\)", b42)
    return titles, boons, relics


def walk_strings(v, path, out):
    if isinstance(v, str):
        out.append((path, v))
    elif isinstance(v, list):
        for i, x in enumerate(v):
            walk_strings(x, "%s[%d]" % (path, i), out)
    elif isinstance(v, dict):
        for k, x in v.items():
            walk_strings(x, "%s.%s" % (path, k), out)


def walk_ids(v, out):
    if isinstance(v, list):
        for x in v:
            walk_ids(x, out)
    elif isinstance(v, dict):
        if isinstance(v.get("id"), str):
            out.append(v["id"])
        for x in v.values():
            walk_ids(x, out)


def limit_for(path):
    leaf = path.rsplit(".", 1)[-1]
    if leaf == "tracker" or path.startswith("STORY.trackers."):
        return 60, "tracker"
    if leaf in ("title", "name", "heading"):
        return 40, "title"
    return 140, "line"


def verify(d):
    s = d["story"]
    titles, spec_boons, spec_relics = spec_facts()

    # ---- export shape
    check("export: single named export STORY", d["exportNames"] == ["STORY"], str(d["exportNames"]))
    check("frozen: every reachable object/array deep-frozen",
          not d["notFrozen"], "%d objects walked, not frozen: %s" % (d["objectsWalked"], d["notFrozen"][:5]))
    check("frozen: write to STORY.intro.lines[0] did not land", d["mutationBlocked"],
          "threw=%s" % d["threw"])

    # ---- intro
    check("intro: exactly 3 lines", len(s["intro"]["lines"]) == 3, str(len(s["intro"]["lines"])))

    # ---- steps
    steps = s["steps"]
    per = {r: [k for k in steps if k.startswith(r + ".")] for r in REALMS}
    check("steps: 20 total (cold 8, sand 6, ash 6 per the section-2 table)",
          len(steps) == 20 and [len(per[r]) for r in REALMS] == [8, 6, 6],
          "%d total, per realm %s" % (len(steps), [len(per[r]) for r in REALMS]))
    check("steps: stepOrder lists exactly the step ids in order",
          all(s["stepOrder"][r] == ["%s.%d" % (r, i + 1) for i in range(len(per[r]))] for r in REALMS)
          and sorted(sum(s["stepOrder"].values(), [])) == sorted(steps))
    bad_titles = [(k, steps[k]["title"], titles.get(k)) for k in steps if steps[k]["title"] != titles.get(k)]
    check("steps: every title verbatim from QUEST_DESIGN.md (%d parsed)" % len(titles),
          len(titles) == 20 and not bad_titles, str(bad_titles))
    check("steps: id/realm fields match their key",
          all(v["id"] == k and v["realm"] == k.split(".")[0] for k, v in steps.items()))

    # ---- echo
    echo = s["echo"]
    missing = [k for k in steps if ("echo." + k) not in echo]
    check("echo: one entry per step (20)", len(echo) == 20 and not missing,
          "%d entries, missing %s" % (len(echo), missing))
    check("echo: every entry 1-3 lines and names its step",
          all(1 <= len(v["lines"]) <= 3 and v["step"] == k[5:] and v["id"] == k for k, v in echo.items()))
    check("echo: echo.cold.1 is exactly 2 lines (section 6.3)", len(echo["echo.cold.1"]["lines"]) == 2)
    check("echo: echo.ash.6 is the same frozen array as ending.echo", d["endingSameRef"])

    # ---- shrines
    ids = d["shrineIds"]
    ok_keys = all(list(s["shrines"][r].keys()) == ids for r in REALMS)
    check("shrines: each realm keyed exactly by live SHRINE_IDS (%d)" % len(ids),
          ok_keys and len(ids) == 7, str(ids))
    lines = [s["shrines"][r][k]["line"] for r in REALMS for k in ids]
    check("shrines: 21 first-activation lines, all unique",
          len(lines) == 21 and len(set(lines)) == 21, "%d lines, %d unique" % (len(lines), len(set(lines))))
    check("shrines: ids follow shrine.<realm>.<shrineId>",
          all(s["shrines"][r][k]["id"] == "shrine.%s.%s" % (r, k) for r in REALMS for k in ids))

    # ---- lore
    lore = s["lore"]
    counts = [len(lore[r]) for r in REALMS]
    check("lore: 12 shards per realm, 36 total", counts == [12, 12, 12], str(counts))
    check("lore: every shard 1-3 lines, voice echo|inscription",
          all(1 <= len(x["lines"]) <= 3 and x["voice"] in ("echo", "inscription")
              for r in REALMS for x in lore[r]))
    check("lore: each realm mixes both voices",
          all({x["voice"] for x in lore[r]} == {"echo", "inscription"} for r in REALMS),
          str({r: sum(1 for x in lore[r] if x["voice"] == "inscription") for r in REALMS}) + " inscriptions")
    check("lore: ids lore.<realm>.1..12 in order",
          all([x["id"] for x in lore[r]] == ["lore.%s.%d" % (r, i + 1) for i in range(12)] for r in REALMS))
    all_titles = [x["title"] for r in REALMS for x in lore[r]]
    check("lore: 36 unique shard titles", len(set(all_titles)) == 36, "%d unique" % len(set(all_titles)))
    check("chronicle: one titled page per realm",
          all(s["chronicle"][r]["id"] == "chronicle." + r and s["chronicle"][r]["lines"] for r in REALMS))

    # ---- bounties
    enemies = {e["key"]: e for e in d["enemies"]}
    boss_tier = d["tier"].get("BOSS")
    bcounts = [len(s["bounties"][r]) for r in REALMS]
    check("bounties: 3 per realm, 9 total", bcounts == [3, 3, 3], str(bcounts))
    bad_units = []
    for r in REALMS:
        for b in s["bounties"][r]:
            e = enemies.get(b["unit"])
            if not e or e["realm"] != r or e["tier"] == boss_tier:
                bad_units.append((b["id"], b["unit"], e))
    check("bounties: every unit a real non-boss ENEMIES row of its realm (tier BOSS=%s)" % boss_tier,
          not bad_units, str(bad_units) if bad_units else
          "; ".join("%s=%s(%s)" % (b["id"], b["unit"], enemies[b["unit"]]["name"])
                    for r in REALMS for b in s["bounties"][r]))
    bnames = [b["name"] for r in REALMS for b in s["bounties"][r]]
    check("bounties: 9 unique names", len(set(bnames)) == 9)

    # ---- trials
    lmk = d["landmarks"]
    tcounts = [len(s["trials"][r]) for r in REALMS]
    check("trials: 3 per realm, 9 total", tcounts == [3, 3, 3], str(tcounts))
    bad_tr = [(t["id"], t["landmark"]) for r in REALMS for t in s["trials"][r]
              if t["landmark"] not in lmk or lmk[t["landmark"]]["realm"] != r
              or lmk[t["landmark"]]["label"] not in t["name"]]
    check("trials: each names a real landmark of its realm (label in the name)", not bad_tr,
          str(bad_tr) if bad_tr else
          "; ".join("%s -> %s" % (t["name"], lmk[t["landmark"]]["label"]) for r in REALMS for t in s["trials"][r]))

    # ---- relics
    rel = list(s["relics"].values())
    check("relics: 12, 4 per realm", len(rel) == 12 and
          [sum(1 for x in rel if x["realm"] == r) for r in REALMS] == [4, 4, 4])
    mine = [(x["name"], x["effect"]) for x in rel]
    check("relics: names + effects verbatim vs spec section 4.2 (%d parsed)" % len(spec_relics),
          mine == spec_relics, "" if mine == spec_relics else
          str([(a, b) for a, b in zip(mine, spec_relics) if a != b]))
    check("relics: every relic has one flavor line", all(x["flavor"] for x in rel))

    # ---- boons
    bo = s["boons"]
    mine_b = [(x["name"], x["effect"]) for x in bo.values()]
    check("boons: names + effects verbatim vs spec section 4.1 (%d parsed)" % len(spec_boons),
          len(bo) == 12 and mine_b == spec_boons, "" if mine_b == spec_boons else
          str([(a, b) for a, b in zip(mine_b, spec_boons) if a != b]))
    pairs = s["boonPairs"]
    pair_ok = len(pairs) == 6 and all(
        len(v) == 2 and all(bo[b]["realm"] == k.split(".")[0] and bo[b]["kind"] == k.split(".")[1]
                            and bo[b]["pick"] == i for i, b in enumerate(v))
        for k, v in pairs.items())
    check("boons: 6 pairs, each [pick0, pick1] of its realm+kind", pair_ok)

    # ---- ending
    en = s["ending"]
    credit_txt = " ".join(" ".join([c["heading"]] + c["lines"]) for c in en["credits"])
    check("ending: 3 Echo lines", len(en["echo"]) == 3)
    check("ending: card 'The Drift is mended.'", en["card"] == "The Drift is mended.")
    check("ending: post-game tracker verbatim, <= 60",
          s["trackers"]["postGame"]["text"] == "The world is whole. Ride on.")
    need = ["ForgeFlow Games", "LinearAbiltyCastingThreeJS", "mohamedachrefelouafi", "MIT Licence",
            "SNOWFLOW", "Maksymilian Dendura"]
    check("ending: credits name the team and the MIT adaptations", all(n in credit_txt for n in need),
          str([n for n in need if n not in credit_txt]))
    check("ending: 'Wakecaster' title", en["playerTitle"] == "Wakecaster")

    # ---- hints
    h = s["hints"]
    check("hints: surf, bolt, arc, journal/map/interact",
          sorted(h) == ["hint.arc", "hint.bolt", "hint.journal", "hint.surf"], str(sorted(h)))
    check("hints: surf text verbatim 'Hold RMB to surf'", h["hint.surf"]["text"] == "Hold RMB to surf")
    check("hints: journal hint names J, M and E",
          all(k in h["hint.journal"]["text"] for k in ("J — Journal", "M — Map", "E — Interact")))

    # ---- every string
    strs = []
    walk_strings(s, "STORY", strs)
    empty = [p for p, v in strs if not v.strip()]
    check("strings: all %d non-empty" % len(strs), not empty, str(empty[:5]))
    over = []
    worst = {}
    for p, v in strs:
        lim, kind = limit_for(p)
        if len(v) > lim:
            over.append((p, len(v), lim))
        if len(v) > worst.get(kind, (0, ""))[0]:
            worst[kind] = (len(v), p)
    check("strings: trackers <= 60, titles <= 40, lines <= 140", not over,
          str(over) if over else "longest: " + json.dumps(worst))
    ph = [(p, v) for p, v in strs if PLACEHOLDER.search(v)]
    check("strings: no placeholder text (TODO/lorem/XXX/TBD/FIXME)", not ph, str(ph))
    spoken = [(p, v) for p, v in strs if p.startswith(("STORY.echo", "STORY.shrines", "STORY.lore",
                                                        "STORY.chronicle", "STORY.intro", "STORY.ending.echo"))]
    sl = [(p, v) for p, v in spoken if SLANG.search(v)]
    check("strings: no modern slang in %d spoken/lore strings" % len(spoken), not sl, str(sl))

    # ---- ids
    idl = []
    walk_ids(s, idl)
    dup = sorted({i for i in idl if idl.count(i) > 1})
    check("ids: %d ids, no duplicates" % len(idl), not dup, str(dup))


def main():
    from playwright.sync_api import sync_playwright

    # http.server, but NOT the `-m http.server` CLI: its listen backlog is 5,
    # and on a busy machine Chrome's burst of ~150 parallel module fetches
    # overflows it (measured: dozens of net::ERR_CONNECTION_REFUSED on src/
    # modules, boot never finished). Same handler, same root, backlog 256.
    server_src = (
        "import http.server, functools, sys\n"
        "class S(http.server.ThreadingHTTPServer):\n"
        "    request_queue_size = 256\n"
        "    daemon_threads = True\n"
        "h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=sys.argv[1])\n"
        "h.log_message = lambda *a, **k: None\n"
        "S(('127.0.0.1', int(sys.argv[2])), h).serve_forever()\n")
    srv = subprocess.Popen(
        [sys.executable, "-c", server_src, str(ROOT), str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    page_errors, console_errors, failed_requests = [], [], []
    try:
        # Readiness: poll the server (a socket connect, not a sleep) before
        # Chrome navigates, so the first request cannot race the bind.
        import socket
        import time
        for _ in range(100):
            try:
                socket.create_connection(("127.0.0.1", PORT), timeout=0.1).close()
                break
            except OSError:
                time.sleep(0.1)
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("pageerror", lambda e: page_errors.append(str(e)))
            pg.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
            pg.on("requestfailed", lambda r: failed_requests.append(r.url + " " + str(r.failure)))
            pg.goto(GAME_URL, wait_until="commit", timeout=90000)
            boot_ok = True
            try:
                pg.wait_for_function(
                    "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime", timeout=BOOT_WAIT_MS)
            except Exception:
                # Do not abort: the module is still importable in the live
                # page, and the boot failure is reported as its own check.
                boot_ok = False
                print("BOOT NOT REACHED in %d s; failed requests: %s"
                      % (BOOT_WAIT_MS // 1000, failed_requests[:10]))
            d = pg.evaluate(JS)
            br.close()
    finally:
        srv.terminate()

    print("rAF callbacks in a 2 s window: %d; boot label: %r" % (d["rafPer2s"], d["bootLabel"]))
    if d["gameTimeAdvanced"] is not None:
        print("game time advanced after import: %.3f s" % d["gameTimeAdvanced"])
    verify(d)
    check("page: game booted (SNOWFLOW published, time unfrozen) within %d s" % (BOOT_WAIT_MS // 1000),
          boot_ok and d["booted"],
          "boot label %r, rAF/2s %d" % (d["bootLabel"], d["rafPer2s"]))
    if d["booted"]:
        check("page: >= 1 s of game time ran after the import",
              d["gameTimeAdvanced"] is not None and d["gameTimeAdvanced"] >= 1.0,
              "%.3f s" % (d["gameTimeAdvanced"] or 0))
    check("page: zero page errors", not page_errors, str(page_errors[:5]))
    fails = 0
    for name, ok, detail in results:
        print(("PASS " if ok else "FAIL ") + name + ((" | " + detail) if detail else ""))
        fails += 0 if ok else 1
    if console_errors:
        print("console errors (informational, %d): %s" % (len(console_errors), console_errors[:5]))
    print("SUMMARY: %d/%d checks passed" % (len(results) - fails, len(results)))
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
