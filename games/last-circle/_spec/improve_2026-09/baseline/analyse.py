import json, sys, collections
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
files = sys.argv[1:] or ["runA.json", "runB.json"]
runs = []
for f in files:
    try: runs += json.load(open(f, encoding="utf-8"))["results"]
    except Exception as e: print("skip", f, e)

def first_t(series, key, frac):
    for s in series:
        if s["landed"] >= 20 and s[key] >= frac * s["landed"]:
            return s["t"]
    return None

def pct(a, b): return f"{100*a/max(1,b):.1f}%"
tot = collections.Counter()
for r in runs:
    ag = r["agg"]; n = ag["nBots"]
    ei = r["endInv"]
    starter = sum(1 for e in ei if not e["upgraded"])
    notbetter = sum(1 for e in ei if not e["better"])
    activeP = sum(1 for e in ei if e["active"] == "pistol")
    # bots that lived past t=90 (landed + >= ~60 s on the ground)
    lived = [e for e in ei if e["t"] >= 90]
    starterL = sum(1 for e in lived if not e["upgraded"])
    activePL = sum(1 for e in lived if e["active"] == "pistol")
    carrySL_holdP = sum(1 for e in ei if e["active"] == "pistol" and any(g.split(":")[0] in ("sniper", "glauncher") for g in e["guns"]))
    kills = r["kills"]
    wids = collections.Counter(k["wid"] or "none" for k in kills)
    gunKills = sum(v for k, v in wids.items() if k not in ("storm", "none", None))
    botKills = [k for k in kills if k["killerBot"]]
    bw = collections.Counter(k["wid"] for k in botKills)
    early = sum(1 for k in kills if k["t"] < 60)
    pdeath = next((k["t"] for k in kills if k["victim"] == "s0"), None)
    print(f"\n=== seed {r['seed']} map {r['map']} patch {r['patch']}  simT {r['simT']} over {r['over']} winner {r['winner']} sim-loop {r['wallS']} s")
    print(f"  END-OF-LIFE inventory ({len(ei)} bots): starter-only {starter} ({pct(starter,len(ei))}), no gun better than common pistol {notbetter} ({pct(notbetter,len(ei))}), ACTIVE weapon = pistol {activeP} ({pct(activeP,len(ei))})")
    print(f"     bots alive at t>=90: {len(lived)}: starter-only {starterL} ({pct(starterL,len(lived))}), active pistol {activePL} ({pct(activePL,len(lived))}); carry sniper/launcher but died holding pistol: {carrySL_holdP}")
    for key, lab in (("up", "carry any upgrade"), ("better", "carry gun > common pistol"), ("holdNP", "HOLD non-pistol")):
        print(f"  time until {lab}: 50% {first_t(r['series'], key, .5)}  80% {first_t(r['series'], key, .8)}")
    ser = r["series"]
    for tt in (40, 60, 90, 150, 240, 400):
        s = min(ser, key=lambda x: abs(x["t"] - tt))
        if abs(s["t"] - tt) < 1.5 and s["landed"]:
            print(f"   t={s['t']:>6}: landed alive {s['landed']:>2}  upgraded {pct(s['up'],s['landed'])}  better {pct(s['better'],s['landed'])}  holdNonPistol {pct(s['holdNP'],s['landed'])}  allDry {s['dryAll']}  inLOOT {s['lootState']}")
    print(f"  STUCK (net<0.4m over 3.2 s, all 7 samples in a moving state): {ag['stuckNetN']}/{ag['movingN']} = {pct(ag['stuckNetN'],ag['movingN'])}  (box<0.4m: {pct(ag['stuckBoxN'],ag['movingN'])}); bots ever stuck {ag['everStuck']}/{n}; episodes {len(r['stuckEp'])}")
    wat = sum(1 for e in r["stuckEp"] if e["inWater"])
    st = collections.Counter(e["st"].split(">")[-1] for e in r["stuckEp"])
    print(f"     episodes in water {wat}; last-state {dict(st)}")
    for e in r["stuckEp"][:6]: print("      ", e)
    print(f"  DRY: all-guns-dry {ag['allDryN']}/{ag['landedN']} = {pct(ag['allDryN'],ag['landedN'])}; active-gun dry {pct(ag['activeDryN'],ag['landedN'])}; bots ever fully dry {ag['everAllDry']}/{n}; died fully dry {sum(1 for e in ei if e['died'] and e['allDry'])}")
    print(f"  carrying sniper/launcher but HOLDING pistol: {ag['carryNotHoldN']}/{ag['carrySniperLauncherN']} samples = {pct(ag['carryNotHoldN'],ag['carrySniperLauncherN'])}")
    print(f"  KILLS {len(kills)} by weapon {dict(wids)}; pistol share of gun kills {pct(wids.get('pistol',0),gunKills)}; deaths in first 60 s: {early}; player died t={pdeath}")
    print(f"  states {ag['stateCount']}")
    tot["ei"] += len(ei); tot["starter"] += starter; tot["activeP"] += activeP; tot["notbetter"] += notbetter
    tot["lived"] += len(lived); tot["starterL"] += starterL; tot["activePL"] += activePL
    tot["movingN"] += ag["movingN"]; tot["stuckNetN"] += ag["stuckNetN"]; tot["stuckBoxN"] += ag["stuckBoxN"]
    tot["landedN"] += ag["landedN"]; tot["allDryN"] += ag["allDryN"]; tot["activeDryN"] += ag["activeDryN"]
    tot["gunKills"] += gunKills; tot["pistolKills"] += wids.get("pistol", 0); tot["kills"] += len(kills)
    for k2, v in wids.items(): tot["w_" + str(k2)] += v
    tot["cSL"] += ag["carrySniperLauncherN"]; tot["cNH"] += ag["carryNotHoldN"]
print("\n=== POOLED (unpatched + patched runs) ===")
print(f"  starter-only at end-of-life {pct(tot['starter'],tot['ei'])}; ACTIVE pistol at end-of-life {pct(tot['activeP'],tot['ei'])}; no gun>pistol {pct(tot['notbetter'],tot['ei'])}")
print(f"  (bots alive at t>=90) starter-only {pct(tot['starterL'],tot['lived'])}; active pistol {pct(tot['activePL'],tot['lived'])}  n={tot['lived']}")
print(f"  stuck {pct(tot['stuckNetN'],tot['movingN'])} (box {pct(tot['stuckBoxN'],tot['movingN'])}); all-dry {pct(tot['allDryN'],tot['landedN'])}; active-dry {pct(tot['activeDryN'],tot['landedN'])}")
print(f"  kills {tot['kills']}, pistol share of gun kills {pct(tot['pistolKills'],tot['gunKills'])}; by weapon " + str({k[2:]: v for k, v in tot.items() if k.startswith('w_')}))
print(f"  carry sniper/launcher but hold pistol {pct(tot['cNH'],tot['cSL'])}")
# determinism
by = collections.defaultdict(list)
for r in runs: by[(r["seed"], r["map"], r["patch"])].append(r)
print("\n=== DETERMINISM ===")
for k, rs in by.items():
    if len(rs) < 2: continue
    a, b = rs[0]["fp"], rs[1]["fp"]
    div = next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), None)
    same_pl = rs[0]["placements"] == rs[1]["placements"]
    print(f"  seed {k[0]} map {k[1]} patchRandom={k[2]}: fingerprints {len(a)} vs {len(b)}; first divergence at sample {div} (~t={None if div is None else div*5} s); same placements {same_pl}; winners {rs[0]['winner']} vs {rs[1]['winner']}; simT {rs[0]['simT']} vs {rs[1]['simT']}")
