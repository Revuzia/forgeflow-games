# -*- coding: utf-8 -*-
"""
qa_rewards.py -- lane R (rewards + the shrine hub) acceptance probe.

Boots the LIVE game (?autoplay&test), dynamically imports the lane-R modules
(main.js does not construct them yet), builds the QUEST ctx from
globalThis.SNOWFLOW, drives them with a rAF loop, and MEASURES every effect:
damage numbers off the registry, the controller's surf cap and ollie apex,
mana regen, the bolt's leash, cooldowns, chill stacks / move speed, max HP,
the vortex's life and reach, mote heals, and real enemy hits through the
enemy runtime. UI flows are driven through the real DOM (clicks + keys).
Then SAVE -> reload -> the same state comes back.

    python qa_rewards.py            # port 8924 (lane R)
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
HERE = Path(__file__).resolve().parent
ROOT = Path(__file__).resolve().parents[3]
PORT = 8924
URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / "_shots"
PAGE_JS = (HERE / "qa_rewards_page.js").read_text(encoding="utf-8")

RESULTS = {}
CHECKS = []


def check(name, ok, detail):
    CHECKS.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + " :: " + json.dumps(detail))


def near(a, b, tol):
    return isinstance(a, (int, float)) and isinstance(b, (int, float)) and abs(a - b) <= tol


def rt(a, b):
    """Division-safe ratio (None when either side is not a positive number)."""
    if not isinstance(a, (int, float)) or not isinstance(b, (int, float)) or b == 0:
        return None
    return round(a / b, 5)


def boot(pg):
    pg.goto(URL, wait_until="domcontentloaded", timeout=900000)
    pg.wait_for_function("() => globalThis.SNOWFLOW && SNOWFLOW.combat && !SNOWFLOW.S.freezeTime",
                         timeout=900000)
    pg.wait_for_timeout(2500)
    # Cheapest frames: none of the measured quantities depend on the preset.
    print("preset:", pg.evaluate("() => { SNOWFLOW.applyPreset('performance'); return SNOWFLOW.S.preset; }"))
    print("page:", pg.evaluate(PAGE_JS))


def ev(pg, expr):
    return pg.evaluate("(async () => { return await (" + expr + "); })()")


def evl(pg, label, expr):
    """ev() that echoes the measured value the moment it lands."""
    t = time.time()
    v = ev(pg, expr)
    print("  measured %-16s %6.1fs  %s" % (label, time.time() - t, json.dumps(v)))
    return v


def main():
    from playwright.sync_api import sync_playwright

    SHOTS.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from qa_rewards_serve import serve
    stop_server = serve(ROOT, PORT)
    errors = []
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 960, "height": 540})
            pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
            pg.on("console", lambda m: errors.append("console.error: " + m.text)
                  if m.type == "error" else None)
            t_start = time.time()
            boot(pg)
            pg.evaluate("() => { try { localStorage.removeItem('driftwake_save'); } catch (e) {} }")

            RESULTS["setup"] = s = ev(pg, "__qa.setup()")
            print("setup:", json.dumps(s))
            check("save sections registered with lane Q's v4 contract",
                  isinstance(s["sections"], list) and all(
                      k in s["sections"] for k in ("boons", "relics", "wakeGlass", "shop",
                                                   "rerolls", "driftmarkPicks")),
                  s["sections"])
            check("consumers wired (controller, spells, spellHits, enemy seam)",
                  all(s["wired"].values()), s["wired"])
            RESULTS["fresh"] = f = ev(pg, "__qa.fresh()")
            print("fresh:", json.dumps(f))

            # ---------------------------------------------------- BASELINES
            B = {}
            B["spikes"] = evl(pg, "spikes", "__qa.spikeHit()")
            B["arcFresh"] = evl(pg, "arcFresh", "__qa.arcHit()")
            B["arcCap"] = evl(pg, "arcCap", "__qa.arcHit((s) => { const r = SNOWFLOW.combat.registry;"
                                 " r.chill[s] = 5; r.chillAt[s] = r.time; r.brittleUntil[s] = r.time + 3; })")
            B["arcOverflow"] = evl(pg, "arcOverflow", "__qa.arcHit((s) => { const r = SNOWFLOW.combat.registry;"
                                      " r.chill[s] = 4; r.chillAt[s] = r.time; r.brittleUntil[s] = 0; })")
            B["chillLinger"] = evl(pg, "chillLinger", "(async () => { const a = await __qa.arcHit(null, true);"
                                      " await new Promise(r => setTimeout(r, 10)); const reg = SNOWFLOW.combat.registry;"
                                      " const t0 = reg.time; while (reg.time - t0 < 3.5) await new Promise(r => requestAnimationFrame(r));"
                                      " const m = reg.speedMult(a.id); reg.remove(a.id); return Math.round(m * 1e4) / 1e4; })()")
            B["surfCap"] = evl(pg, "surfCap", "__qa.surfCap()")
            B["apex"] = evl(pg, "apex", "__qa.ollieApex()")
            B["regen"] = evl(pg, "regen", "__qa.regen()")
            B["bolt"] = evl(pg, "bolt", "__qa.boltRange()")
            B["wave"] = evl(pg, "wave", "__qa.waveHit()")
            B["cdSpikes"] = evl(pg, "cdSpikes", "__qa.cooldownOf(4)")
            B["cdWave"] = evl(pg, "cdWave", "__qa.cooldownOf(1)")
            B["cdArc"] = evl(pg, "cdArc", "__qa.cooldownOf(7)")
            B["vortexNear"] = evl(pg, "vortexNear", "__qa.vortex(3.85)")
            B["mote"] = evl(pg, "mote", "__qa.moteHeal()")
            B["heavy"] = evl(pg, "heavy", "__qa.meleeHit('packIceGolem')")
            B["fodder"] = evl(pg, "fodder", "__qa.meleeHit('rimeImp')")
            B["ignite"] = evl(pg, "ignite", "__qa.igniteBurn()")
            B["spikesStaggered"] = evl(pg, "spikesStaggered", "__qa.spikeHit((s) => { const r = SNOWFLOW.combat.registry;"
                                          " r.staggerUntil[s] = r.time + 10; })")
            B["hpMax"] = evl(pg, "hpMax", "SNOWFLOW.character.healthMax")
            RESULTS["baseline"] = B
            print("baseline:", json.dumps(B))

            # ------------------------------------ BOON PICK through the modal
            print("bossKill:", ev(pg, "__qa.bossKill('cold', 'mini', 'The Icewall')"))
            opened = ev(pg, "__qa.waitModal('#dw-boonpick', 15)")
            st = ev(pg, "__qa.modalState()")
            pg.screenshot(path=str(SHOTS / "rewards_boonpick.png"))
            check("first mini-boss kill opens the boon pick and pauses",
                  opened and st["boonOpen"] and st["freeze"] is True, st)
            pg.click('#dw-boonpick .dwr-card[data-pick="0"]')
            pg.wait_for_timeout(300)
            st2 = ev(pg, "__qa.modalState()")
            state = ev(pg, "__qa.state()")
            check("click on card 1 picks Rime Edge, closes, unpauses",
                  (not st2["boonOpen"]) and st2["freeze"] is False and "boon.rimeEdge" in state["boons"],
                  {"modal": st2["boonOpen"], "freeze": st2["freeze"], "boons": state["boons"]})
            spk = ev(pg, "__qa.spikeHit()")
            check("Rime Edge: +8% frost damage, measured on a Spikes hit",
                  near(rt(spk, B["spikes"]), 1.08, 0.0005),
                  {"base": B["spikes"], "rimeEdge": spk, "ratio": rt(spk, B["spikes"])})

            # ------------------------- SHRINE MENU: E-hook path + free respec
            g = ev(pg, "__qa.goto('cold', 'cold_spawn')")
            check("touching the spawn shrine lights it (progression v4) and puts it in reach",
                  g["lit"] and g["reach"] == "cold_spawn", g)
            ev(pg, "(__qa.bus.emit('ui:open', {panel: 'shrine'}), true)")
            opened = ev(pg, "__qa.waitModal('#dw-shrine', 5)")
            st = ev(pg, "__qa.modalState()")
            pg.screenshot(path=str(SHOTS / "rewards_shrine_rest.png"))
            check("'ui:open' {panel:'shrine'} at an activated shrine opens the hub, paused",
                  opened and st["shrineOpen"] and st["freeze"] is True,
                  {"title": st["shrineTitle"], "purse": st["purse"], "freeze": st["freeze"]})
            pg.click('#dw-shrine .dwr-navb[data-tab="2"]')
            pg.wait_for_timeout(150)
            pg.screenshot(path=str(SHOTS / "rewards_shrine_boons.png"))
            pg.click('#dw-shrine [data-act="swap:cold.mini:1"]')
            pg.wait_for_timeout(150)
            state = ev(pg, "__qa.state()")
            check("shrine Boons page: free respec within the pair (Rime Edge -> Deep Chill)",
                  "boon.deepChill" in state["boons"] and "boon.rimeEdge" not in state["boons"],
                  state["boons"])
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(200)
            st = ev(pg, "__qa.modalState()")
            check("Esc leaves the shrine from the page pane in ONE press and unpauses",
                  (not st["shrineOpen"]) and st["freeze"] is False, st["freeze"])
            spk2 = ev(pg, "__qa.spikeHit()")
            cap = ev(pg, "__qa.arcHit((s) => { const r = SNOWFLOW.combat.registry;"
                         " r.chill[s] = 5; r.chillAt[s] = r.time; r.brittleUntil[s] = r.time + 3; })")
            ovf = ev(pg, "__qa.arcHit((s) => { const r = SNOWFLOW.combat.registry;"
                         " r.chill[s] = 4; r.chillAt[s] = r.time; r.brittleUntil[s] = 0; })")
            check("Deep Chill: a Brittle target's stacks reach 6 (-36% move vs -30%)",
                  cap["chill"] == 6 and B["arcCap"]["chill"] == 5 and cap["speedMult"] < B["arcCap"]["speedMult"],
                  {"base": B["arcCap"], "deepChill": cap})
            check("Deep Chill: the stack that triggers Brittle carries over (1, not 0)",
                  ovf["chill"] == 1 and ovf["brittle"] and B["arcOverflow"]["chill"] == 0,
                  {"base": B["arcOverflow"], "deepChill": ovf})
            check("respec removed Rime Edge's damage (Spikes back to baseline)",
                  near(rt(spk2, B["spikes"]), 1.0, 0.0005), {"spikes": spk2, "base": B["spikes"]})

            # --------------------------- RELICS: two found (lane W events), both measured
            ev(pg, "(__qa.bus.emit('reward', {kind: 'relic', id: 'relic.keelOfTheFirst', name: 'Keel of the First',"
                   " desc: 'surf speed +6%', amount: 1, source: 'trial'}), true)")
            ev(pg, "(__qa.bus.emit('reward', {kind: 'relic', id: 'relic.warmHands', name: 'Warm Hands',"
                   " desc: 'mana regen +20%', amount: 1, source: 'cache'}), true)")
            state = ev(pg, "__qa.state()")
            cap2 = ev(pg, "__qa.surfCap()")
            reg2 = ev(pg, "__qa.regen()")
            check("two relics granted by 'reward' events land in the two slots",
                  state["relicsEquipped"][:2] == ["relic.keelOfTheFirst", "relic.warmHands"], state["relicsEquipped"])
            check("Keel of the First: surf top speed +6% (controller cap, measured)",
                  near(rt(cap2, B["surfCap"]), 1.06, 0.006), {"base": B["surfCap"], "keel": cap2})
            check("Warm Hands: mana regen +20% (measured over 1.5 s)",
                  near(B["regen"], 1.0, 0.01) and near(reg2, 1.20, 0.01),
                  {"base_multiplier": B["regen"], "warmHands_multiplier": reg2})

            # Shrine Relics page: equip via the UI (Rest first to prove it heals).
            ev(pg, "(SNOWFLOW.character.health = 10, true)")
            ev(pg, "(__qa.m.menu.open('cold_spawn'), true)")
            pg.click('#dw-shrine [data-act="rest"]')
            rest = ev(pg, "({hp: SNOWFLOW.character.health, max: SNOWFLOW.character.healthMax,"
                          " last: SNOWFLOW.progression.lastShrineId})")
            check("Rest: full heal + mana, respawn set to this shrine",
                  rest["hp"] == rest["max"] and rest["last"] == "cold_spawn", rest)
            for rid in ["relic.rimeHeart", "relic.frostglassLens", "relic.brassBuckle", "relic.sandGlass",
                        "relic.duneRunner", "relic.scorpionsPatience", "relic.emberCoil",
                        "relic.plateShard", "relic.furnaceCore", "relic.wakemender"]:
                ev(pg, "(__qa.bus.emit('reward', {kind: 'relic', id: '%s', amount: 1, source: 'cache'}), true)" % rid)
            pg.click('#dw-shrine .dwr-navb[data-tab="3"]')
            pg.wait_for_timeout(150)
            pg.click('#dw-shrine [data-act="slot:0"]')
            pg.click('#dw-shrine [data-act="relic:relic.plateShard"]')
            pg.wait_for_timeout(150)
            pg.screenshot(path=str(SHOTS / "rewards_shrine_relics.png"))
            state = ev(pg, "__qa.state()")
            check("shrine Relics page: equip Plate Shard into slot 1 by clicks -> max HP +15%",
                  state["relicsEquipped"][0] == "relic.plateShard" and state["hpMax"] == round(B["hpMax"] * 1.15),
                  {"equipped": state["relicsEquipped"], "hpMax": state["hpMax"], "base": B["hpMax"]})
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(150)

            # One relic at a time in slot 1, everything else off: measure each.
            R = {}
            solo = "(async () => { const m = __qa.m.relics; for (let s = 0; s < 3; s++) m.unequip(s); m.equip('%s', 0); return true; })()"
            ev(pg, solo % "relic.rimeHeart")
            R["rimeHeart"] = evl(pg, "rimeHeart", "(async () => { const a = await __qa.arcHit(null, true); const reg = SNOWFLOW.combat.registry;"
                                    " const t0 = reg.time; while (reg.time - t0 < 3.5) await new Promise(r => requestAnimationFrame(r));"
                                    " const m = reg.speedMult(a.id); reg.remove(a.id); return Math.round(m * 1e4) / 1e4; })()")
            ev(pg, solo % "relic.frostglassLens")
            R["lens"] = evl(pg, "lens", "__qa.boltRange()")
            ev(pg, solo % "relic.brassBuckle")
            R["buckleHeavy"] = evl(pg, "buckleHeavy", "__qa.meleeHit('packIceGolem')")
            R["buckleFodder"] = evl(pg, "buckleFodder", "__qa.meleeHit('rimeImp')")
            ev(pg, solo % "relic.sandGlass")
            R["glassWave"] = evl(pg, "glassWave", "__qa.cooldownOf(1)")
            R["glassArc"] = evl(pg, "glassArc", "__qa.cooldownOf(7)")
            ev(pg, solo % "relic.duneRunner")
            R["apex"] = evl(pg, "apex", "__qa.ollieApex()")
            ev(pg, solo % "relic.scorpionsPatience")
            R["patience"] = evl(pg, "patience", "(async () => {"
                                   " const sp = SNOWFLOW.spells, reg = SNOWFLOW.combat.registry, C = SNOWFLOW.character, T = SNOWFLOW.terrain, inp = SNOWFLOW.input;"
                                   " sp._cdUntil[4] = 0; C.mana = C.manaMax; sp.cast(4); const p = sp._pending;"
                                   " const id = reg.register({x: p.a0, y: T.heightAt(p.a0, p.a2), z: p.a2, radius: 0.5, height: 1.8, tier: 2, level: 10, hp: 4000, poiseMax: 1e9, name: 'QA', kind: 'enemy'});"
                                   " const hp0 = reg.hp[reg.slot(id)]; const x0 = C.position.x, z0 = C.position.z;"
                                   " inp.surf = true; C.surf = 1; inp.jump = true; inp.jumpPressed = true;"
                                   " for (let k = 0; k < 8; k++) { C.surf = 1; C.velocity.set(0, 0, 0); await new Promise(r => requestAnimationFrame(r)); }"
                                   " const dodges = __qa.m.mods.counters.dodges; inp.jump = false; inp.surf = false;"
                                   " const t0 = reg.time; while (reg.time - t0 < 2.0) { C.velocity.set(0, 0, 0); await new Promise(r => requestAnimationFrame(r)); }"
                                   " const dealt = hp0 - reg.hp[reg.slot(id)]; reg.remove(id); C.position.set(x0, T.heightAt(x0, z0), z0);"
                                   " return {dealt: Math.round(dealt * 1e4) / 1e4, dodges}; })()")
            ev(pg, solo % "relic.emberCoil")
            R["ignite"] = evl(pg, "ignite", "__qa.igniteBurn()")
            ev(pg, solo % "relic.furnaceCore")
            R["vortex"] = evl(pg, "vortex", "__qa.vortex(0)")
            ev(pg, solo % "relic.wakemender")
            R["mote"] = evl(pg, "mote", "__qa.moteHeal()")
            ev(pg, "(async () => { const m = __qa.m.relics; for (let s = 0; s < 3; s++) m.unequip(s); return true; })()")
            RESULTS["relics"] = R
            print("relics:", json.dumps(R))
            check("Rime Heart: Chill still slows 3.5 s after the hit (lasts 4 s, not 3)",
                  B["chillLinger"] == 1.0 and R["rimeHeart"] < 1.0, {"base": B["chillLinger"], "rimeHeart": R["rimeHeart"]})
            check("Frostglass Lens: bolt leash +20% (and the bolt flies it)",
                  near(R["lens"]["leash"], B["bolt"]["leash"] * 1.2, 0.01) and R["lens"]["flew"] > B["bolt"]["flew"] + 5,
                  {"base": B["bolt"], "lens": R["lens"]})
            check("Brass Buckle: -15% from a HEAVY's real melee hit, fodder unchanged",
                  near(rt(R["buckleHeavy"].get("lost"), B["heavy"].get("lost")), 0.85, 0.001)
                  and near(R["buckleFodder"].get("lost"), B["fodder"].get("lost"), 1e-3) and B["fodder"].get("lost", 0) > 0,
                  {"heavy": [B["heavy"], R["buckleHeavy"]], "fodder": [B["fodder"]["lost"], R["buckleFodder"]["lost"]]})
            check("Sand Glass: spell cooldowns -8% (wave 4 -> 3.68, arc 1.5 -> 1.38)",
                  near(R["glassWave"], B["cdWave"] * 0.92, 0.01) and near(R["glassArc"], B["cdArc"] * 0.92, 0.01),
                  {"base": [B["cdWave"], B["cdArc"]], "sandGlass": [R["glassWave"], R["glassArc"]]})
            check("Dune Runner: surf-ollie jump height +25% (take-off v0^2/2g; integrated apex alongside)",
                  near(rt(R["apex"]["height"], B["apex"]["height"]), 1.25, 0.005)
                  and near(rt(R["apex"]["apex"], B["apex"]["apex"]), 1.25, 0.04),
                  {"base": B["apex"], "duneRunner": R["apex"],
                   "heightRatio": rt(R["apex"]["height"], B["apex"]["height"]),
                   "apexRatio": rt(R["apex"]["apex"], B["apex"]["apex"])})
            check("Scorpion's Patience: +10% damage in the 2 s after a surf ollie",
                  R["patience"]["dodges"] >= 1 and near(rt(R["patience"]["dealt"], B["spikes"]), 1.10, 0.0005),
                  {"base": B["spikes"], "patience": R["patience"]})
            check("Ember Coil: a bolt hit burns 3 dmg/s for 2 s (4 ticks, 6 at L10)",
                  R["ignite"].get("ticks") == 4 and near(R["ignite"].get("burn", 0), 6.0, 0.35) and B["ignite"].get("burn", 1) == 0,
                  {"base": B["ignite"], "emberCoil": R["ignite"]})
            check("Furnace Core: Great Vortex lives +20%",
                  near(rt(R["vortex"]["life"], B["vortexNear"]["life"]), 1.20, 0.03),
                  {"base": B["vortexNear"]["life"], "furnaceCore": R["vortex"]["life"]})
            check("Wakemender: a mote heals 15% of max instead of 10%",
                  near(B["mote"]["frac"], 0.10, 0.011) and near(R["mote"]["frac"], 0.15, 0.011),
                  {"base": B["mote"], "wakemender": R["mote"]})

            # ------------------------------------------------ SHOP via the UI
            ev(pg, "(__qa.bus.emit('reward', {kind: 'glass', id: 'glass', name: 'Wake Glass', amount: 1200,"
                   " source: 'cache'}), true)")
            ev(pg, "(__qa.m.menu.open('cold_spawn'), true)")
            pg.click('#dw-shrine .dwr-navb[data-tab="4"]')
            pg.wait_for_timeout(150)
            before = ev(pg, "__qa.state()")
            pg.click('#dw-shrine [data-act="buy:shop.vitality"]')
            pg.wait_for_timeout(100)
            after = ev(pg, "__qa.state()")
            check("Shop: Vitality I costs 60 and raises max HP 4% (100 -> 104)",
                  after["glass"] == before["glass"] - 60 and after["hpMax"] == round(before["hpMax"] * 1.04)
                  and after["shop"].get("shop.vitality") == 1,
                  {"glass": [before["glass"], after["glass"]], "hpMax": [before["hpMax"], after["hpMax"]]})
            pg.click('#dw-shrine [data-act="buy:shop.reroll"]')
            pg.click('#dw-shrine [data-act="buy:shop.slot3"]')
            wake0 = ev(pg, "Array.from(SNOWFLOW.wake.wakeUniforms.uWakeAlbedo.value).map(v => Math.round(v * 1e4) / 1e4)")
            pg.click('#dw-shrine [data-act="buy:trail.ember"]')
            pg.wait_for_timeout(100)
            wake1 = ev(pg, "Array.from(SNOWFLOW.wake.wakeUniforms.uWakeAlbedo.value).map(v => Math.round(v * 1e4) / 1e4)")
            pg.screenshot(path=str(SHOTS / "rewards_shrine_shop.png"))
            shop = ev(pg, "__qa.state()")
            check("Shop: reroll 80 + slot 3 400 + a trail 40 -> exact balance, slot 3 open, token held",
                  shop["glass"] == after["glass"] - 80 - 400 - 40 and shop["slot3"] and shop["rerolls"] == 1
                  and shop["trail"] == "trail.ember",
                  {"glass": [after["glass"], shop["glass"]], "slot3": shop["slot3"], "rerolls": shop["rerolls"],
                   "trail": shop["trail"]})
            check("Wake trail is real: the surf wake's albedo uniform changes",
                  wake0 != wake1, {"before": wake0, "ember": wake1})
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(150)

            # ------------------------------------------------- FAST TRAVEL
            g = ev(pg, "__qa.goto('cold', 'shrine_e')")
            check("touching ring shrine E lights it in Cold", g["lit"], g)
            ev(pg, "__qa.goto('cold', 'cold_spawn')")
            ev(pg, "(__qa.bus.emit('ui:open', {panel: 'shrine'}), true)")
            ev(pg, "__qa.waitModal('#dw-shrine', 5)")
            pg.click('#dw-shrine .dwr-navb[data-tab="1"]')
            pg.wait_for_timeout(150)
            pg.screenshot(path=str(SHOTS / "rewards_shrine_travel.png"))
            pg.click('#dw-shrine [data-act="travel:cold:shrine_e"]')
            for _ in range(9000):   # wall cap 15 min: the box may be frame-starved
                w = ev(pg, "__qa.where()")
                if not w["menuOpen"]:
                    break
                pg.wait_for_timeout(100)
            pg.wait_for_timeout(300)
            w = ev(pg, "__qa.where()")
            check("Travel (same realm): lands on shrine E's stand point, menu closed, unpaused",
                  w["nearest"] == "shrine_e" and w["d"] < 0.6 and not w["menuOpen"] and w["freeze"] is False, w)
            # Cross-realm: light Sand's NE shrine, come home, travel there from the menu.
            ev(pg, "(async () => { SNOWFLOW.progression.realmsUnlocked.push('sand'); await __qa.ctx.enterRealm('sand');"
                   " for (let k = 0; k < 12; k++) await new Promise(r => requestAnimationFrame(r)); return true; })()")
            g = ev(pg, "__qa.goto('sand', 'shrine_ne')")
            check("touching Sand's NE shrine lights it in Sand", g["lit"] and g["realm"] == "sand", g)
            ev(pg, "(async () => { await __qa.ctx.enterRealm('cold');"
                   " for (let k = 0; k < 12; k++) await new Promise(r => requestAnimationFrame(r)); return true; })()")
            ev(pg, "__qa.goto('cold', 'cold_spawn')")
            ev(pg, "(__qa.bus.emit('ui:open', {panel: 'shrine'}), true)")
            ev(pg, "__qa.waitModal('#dw-shrine', 5)")
            pg.click('#dw-shrine .dwr-navb[data-tab="1"]')
            pg.wait_for_timeout(150)
            pg.click('#dw-shrine [data-act="travel:sand:shrine_ne"]')
            for _ in range(9000):   # wall cap 15 min (enterRealm loads bodies + re-solves the sky)
                w = ev(pg, "__qa.where()")
                if not w["menuOpen"] and w["realm"] == "sand":
                    break
                pg.wait_for_timeout(100)
            pg.wait_for_timeout(500)
            w = ev(pg, "__qa.where()")
            check("Travel (cross realm): enterRealm('sand') then Sand NE's stand point",
                  w["realm"] == "sand" and w["nearest"] == "shrine_ne" and w["d"] < 0.6 and w["freeze"] is False, w)
            ev(pg, "(async () => { await __qa.ctx.enterRealm('cold');"
                   " for (let k = 0; k < 12; k++) await new Promise(r => requestAnimationFrame(r)); return true; })()")
            ev(pg, "__qa.goto('cold', 'cold_spawn')")

            # ------------------------------------------- THE OTHER FIVE PAIRS
            Bn = {}
            # cold.realm: Glacial Guard vs Frost Nova (API offer/choose/respec)
            ev(pg, "(__qa.m.boons.offer('cold.realm'), __qa.m.boons.choose('cold.realm', 0))")
            Bn["guardHp"] = evl(pg, "guardHp", "__qa.state()")
            ev(pg, "__qa.m.boons.respec('cold.realm', 1, {atShrine: true})")
            Bn["novaHp"] = evl(pg, "novaHp", "__qa.state()")
            Bn["novaArc"] = evl(pg, "novaArc", "__qa.arcHit()")
            check("Glacial Guard: +10% max HP (vs Frost Nova in the same pair)",
                  near(rt(Bn["guardHp"]["maxHpMult"], Bn["novaHp"]["maxHpMult"]), 1.10, 1e-4),
                  {"guard": [Bn["guardHp"]["hpMax"], Bn["guardHp"]["maxHpMult"]],
                   "nova": [Bn["novaHp"]["hpMax"], Bn["novaHp"]["maxHpMult"]]})
            check("Frost Nova: one Frost Arc lays 2 Chill stacks (baseline 1)",
                  B["arcFresh"]["chill"] == 1 and Bn["novaArc"]["chill"] == 2,
                  {"base": B["arcFresh"], "nova": Bn["novaArc"]})
            # sand.mini: offered through the modal, deferred with Esc, taken at the shrine.
            ev(pg, "__qa.bossKill('sand', 'mini', null)")
            ev(pg, "__qa.waitModal('#dw-boonpick', 15)")
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(200)
            st = ev(pg, "__qa.modalState()")
            state = ev(pg, "__qa.state()")
            check("boon pick Esc defers: offer stays pending, game unpaused",
                  (not st["boonOpen"]) and st["freeze"] is False and "sand.mini" in state["pending"],
                  {"pending": state["pending"], "freeze": st["freeze"]})
            ev(pg, "(__qa.m.menu.open('cold_spawn'), true)")
            pg.click('#dw-shrine .dwr-navb[data-tab="2"]')
            pg.wait_for_timeout(100)
            pg.click('#dw-shrine [data-act="choose:sand.mini:0"]')
            pg.wait_for_timeout(100)
            state = ev(pg, "__qa.state()")
            check("a deferred boon is taken at the shrine (Quickened Spikes)",
                  "boon.quickenedSpikes" in state["boons"] and "sand.mini" not in state["pending"], state["boons"])
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(150)
            Bn["qsCd"] = evl(pg, "qsCd", "__qa.cooldownOf(4)")
            ev(pg, "__qa.m.boons.respec('sand.mini', 1, {atShrine: true})")
            Bn["tfWave"] = evl(pg, "tfWave", "__qa.waveHit()")
            Bn["tfCd"] = evl(pg, "tfCd", "__qa.cooldownOf(4)")
            check("Quickened Spikes: Spikes cooldown 10 -> 8 s (Tidal Force: back to 10)",
                  near(Bn["qsCd"], B["cdSpikes"] - 2, 0.01) and near(Bn["tfCd"], B["cdSpikes"], 0.01),
                  {"base": B["cdSpikes"], "quickened": Bn["qsCd"], "tidal": Bn["tfCd"]})
            check("Tidal Force: Wave damage +8% and knockback +30% (birth-swell hit, env pinned 0.45)",
                  near(rt(Bn["tfWave"]["dealt"], B["wave"]["dealt"]), 1.08, 0.002)
                  and near(rt(Bn["tfWave"]["kb"], B["wave"]["kb"]), 1.30, 0.002),
                  {"base": B["wave"], "tidal": Bn["tfWave"]})
            # sand.realm: Sandstep vs Sunder
            ev(pg, "(__qa.m.boons.offer('sand.realm'), __qa.m.boons.choose('sand.realm', 0))")
            Bn["stepCap"] = evl(pg, "stepCap", "__qa.surfCap()")
            Bn["stepStag"] = evl(pg, "stepStag", "__qa.spikeHit((s) => { const r = SNOWFLOW.combat.registry; r.staggerUntil[s] = r.time + 10; })")
            ev(pg, "__qa.m.boons.respec('sand.realm', 1, {atShrine: true})")
            Bn["sunderCap"] = evl(pg, "sunderCap", "__qa.surfCap()")
            Bn["sunderStag"] = evl(pg, "sunderStag", "__qa.spikeHit((s) => { const r = SNOWFLOW.combat.registry; r.staggerUntil[s] = r.time + 10; })")
            check("Sandstep: surf top speed +8% (vs Sunder)",
                  near(rt(Bn["stepCap"], Bn["sunderCap"]), 1.08, 0.006) and near(Bn["sunderCap"], B["surfCap"], 0.08),
                  {"base": B["surfCap"], "sandstep": Bn["stepCap"], "sunder": Bn["sunderCap"]})
            check("Sunder: +12% damage to a staggered foe (vs Sandstep)",
                  near(rt(Bn["sunderStag"], Bn["stepStag"]), 1.12, 0.0005),
                  {"sandstep": Bn["stepStag"], "sunder": Bn["sunderStag"]})
            # ash.mini: Cinderbrand vs Great Vortex
            ev(pg, "(__qa.m.boons.offer('ash.mini'), __qa.m.boons.choose('ash.mini', 0))")
            chilled = "(s) => { const r = SNOWFLOW.combat.registry; r.chill[s] = 2; r.chillAt[s] = r.time + 10; }"
            Bn["cbChilled"] = evl(pg, "cbChilled", "__qa.spikeHit(%s)" % chilled)
            Bn["cbVortex"] = evl(pg, "cbVortex", "__qa.vortex(3.85)")
            ev(pg, "__qa.m.boons.respec('ash.mini', 1, {atShrine: true})")
            Bn["gvChilled"] = evl(pg, "gvChilled", "__qa.spikeHit(%s)" % chilled)
            Bn["gvVortex"] = evl(pg, "gvVortex", "__qa.vortex(3.85)")
            check("Cinderbrand: +8% damage to a chilled foe (vs Great Vortex)",
                  near(rt(Bn["cbChilled"], Bn["gvChilled"]), 1.08, 0.0005),
                  {"cinderbrand": Bn["cbChilled"], "greatVortex": Bn["gvChilled"]})
            check("Great Vortex: radius +15% - a foe at 3.85 m is now inside the ring",
                  B["vortexNear"]["dealt"] == 0 and Bn["cbVortex"]["dealt"] == 0 and Bn["gvVortex"]["dealt"] > 0,
                  {"base": B["vortexNear"], "cinderbrand": Bn["cbVortex"], "greatVortex": Bn["gvVortex"]})
            # ash.realm through the modal by KEYBOARD: 2 = Undying Wake
            ev(pg, "__qa.bossKill('ash', 'realm', 'The Volcanic Plate Knight')")
            ev(pg, "__qa.waitModal('#dw-boonpick', 15)")
            pg.keyboard.press("Digit2")
            pg.wait_for_timeout(200)
            state = ev(pg, "__qa.state()")
            check("boon pick by keyboard: '2' takes Undying Wake",
                  "boon.undyingWake" in state["boons"], state["boons"])
            uw = ev(pg, "(async () => { const C = SNOWFLOW.character, EN = SNOWFLOW.combat.enemies, P = SNOWFLOW.progression;"
                        " C.health = C.healthMax; EN._pIFrameUntil = 0; const armed0 = __qa.m.mods.undyingArmed;"
                        " EN._hurtPlayer(9999, C.position.x + 1, C.position.z); const h1 = C.health;"
                        " EN._pIFrameUntil = 0; EN._hurtPlayer(9999, C.position.x + 1, C.position.z); const h2 = C.health;"
                        " let died = false; for (let k = 0; k < 20; k++) { await new Promise(r => requestAnimationFrame(r)); if (P.dead) died = true; }"
                        " const reg = SNOWFLOW.combat.registry; const t0 = reg.time; while (reg.time - t0 < 2.2) await new Promise(r => requestAnimationFrame(r));"
                        " return {armed0, afterFirst: h1, afterSecond: h2, died, respawnedHp: C.health, rearmed: __qa.m.mods.undyingArmed,"
                        " saves: __qa.m.mods.counters.undyingSaves}; })()")
            check("Undying Wake: first lethal hit leaves 1 HP, the next one kills; re-arms on respawn",
                  uw["armed0"] and uw["afterFirst"] == 1 and uw["afterSecond"] == 0 and uw["died"] and uw["rearmed"],
                  uw)
            await_spk = ev(pg, "__qa.spikeHit()")
            ev(pg, "__qa.m.boons.respec('ash.realm', 0, {atShrine: true})")
            hod_spk = ev(pg, "__qa.spikeHit()")
            check("Heart of the Drift: +12% all damage (vs Undying Wake)",
                  near(rt(hod_spk, await_spk), 1.12, 0.0005), {"undying": await_spk, "heart": hod_spk})
            # Field respec with the token bought earlier (boons.js reading of 'reroll').
            ev(pg, "(__qa.m.pick.openRespec(), true)")
            pg.wait_for_timeout(150)
            pg.screenshot(path=str(SHOTS / "rewards_respec.png"))
            pg.click('#dw-boonpick [data-act="respec:cold.realm:0"]')
            pg.wait_for_timeout(100)
            state = ev(pg, "__qa.state()")
            check("field respec spends one reroll token (Frost Nova -> Glacial Guard)",
                  "boon.glacialGuard" in state["boons"] and state["rerolls"] == 0,
                  {"boons": state["boons"], "rerolls": state["rerolls"]})
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(150)

            # ---------------------------------------------- DRIFTMARK toast
            dm0 = ev(pg, "(async () => { const P = SNOWFLOW.progression; P.level = 30; P.xp = 0; P._refreshNeed();"
                         " P._applyLevelStats(true); await new Promise(r => requestAnimationFrame(r)); return P.xpNeed; })()")
            base30 = ev(pg, "__qa.spikeHit()")
            ev(pg, "(SNOWFLOW.progression.addXP(SNOWFLOW.progression.xpNeed + 10, 'qa'), true)")
            # The offer rides mods.update on the next FRAME; a fixed 400 ms of
            # wall time read 'not shown' on a frame-starved box (run 1).
            try:
                pg.wait_for_function("() => document.getElementById('dw-driftmark').classList.contains('show')",
                                     timeout=900000)
            except Exception as e:  # reported by the check below
                print("toast wait:", str(e)[:200])
            toast = ev(pg, "({shown: document.getElementById('dw-driftmark').classList.contains('show'),"
                           " text: document.getElementById('dw-driftmark').innerText, marks: SNOWFLOW.progression.driftmarks,"
                           " freeze: SNOWFLOW.S.freezeTime})")
            pg.screenshot(path=str(SHOTS / "rewards_driftmark.png"))
            pg.keyboard.press("KeyZ")
            pg.wait_for_timeout(150)
            dm = ev(pg, "__qa.state()")
            mark_spk = ev(pg, "__qa.spikeHit()")
            check("Driftmark: minted at L30 -> non-modal toast; Z picks +0.5% damage (measured)",
                  toast["shown"] and toast["marks"] == 1 and toast["freeze"] is False and dm["drift"]["dmg"] == 1
                  and near(rt(mark_spk, base30), 1.005, 0.0002),
                  {"toast": toast, "drift": dm["drift"], "L30": base30, "withMark": mark_spk, "xpNeed": dm0})

            # ----------------------------------------------- SAVE -> RELOAD
            ev(pg, "(SNOWFLOW.progression.save(), true)")
            s1 = ev(pg, "__qa.state()")
            RESULTS["stateBeforeReload"] = s1
            pg.reload(wait_until="domcontentloaded")
            pg.wait_for_function("() => globalThis.SNOWFLOW && SNOWFLOW.combat && !SNOWFLOW.S.freezeTime",
                                 timeout=900000)
            pg.wait_for_timeout(2000)
            print("page:", pg.evaluate(PAGE_JS))
            ev(pg, "__qa.setup()")
            s2 = ev(pg, "__qa.state()")
            ev(pg, "(SNOWFLOW.progression.continueRun(), true)")
            s3 = ev(pg, "__qa.state()")
            RESULTS["stateAfterReload"] = s2
            keys = ["boons", "picks", "pending", "relicsOwned", "relicsEquipped", "slot3", "glass", "shop",
                    "rerolls", "trail", "drift", "maxHpMult", "hpMax", "level"]
            diff = {k: [s1[k], s2[k]] for k in keys if s1[k] != s2[k]}
            diff3 = {k: [s1[k], s3[k]] for k in keys if s1[k] != s3[k]}
            check("SAVE -> reload restores boons, relics, glass, shop ranks, rerolls, trail, driftmarks",
                  not diff, diff or {k: s2[k] for k in ("boons", "relicsEquipped", "glass", "shop", "drift")})
            check("... and CONTINUE (progression.continueRun) restores the same",
                  not diff3, diff3 or "identical")
            spk_reload = ev(pg, "__qa.spikeHit()")
            check("restored rewards are live after reload (Spikes = HoD x driftmark at L30)",
                  near(spk_reload, mark_spk, 0.01), {"beforeReload": mark_spk, "afterReload": spk_reload})

            RESULTS["log_tail"] = ev(pg, "__qa.log.slice(-25)")
            RESULTS["qa_errors"] = ev(pg, "__qa.errors")
            RESULTS["seconds"] = round(time.time() - t_start, 1)
            br.close()
    finally:
        stop_server()

    RESULTS["page_errors"] = errors
    print("\n=== page errors (%d) ===" % len(errors))
    for e in errors[:40]:
        print(" ", e[:300])
    print("qa errors:", json.dumps(RESULTS.get("qa_errors")))
    passed = sum(1 for c in CHECKS if c[1])
    print("\n=== %d / %d checks PASS ===" % (passed, len(CHECKS)))
    for name, ok, _ in CHECKS:
        print(("  PASS  " if ok else "  FAIL  ") + name)
    out = HERE / "qa_rewards_out.json"
    out.write_text(json.dumps({"checks": [[n, o, d] for n, o, d in CHECKS], "results": RESULTS},
                              indent=1, default=str), encoding="utf-8")
    print("wrote", out)
    return 0 if passed == len(CHECKS) and not errors else 1


if __name__ == "__main__":
    sys.exit(main())
